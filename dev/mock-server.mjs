import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MockJobRunner } from './mock-job-runner.mjs';
import { MockMarlin } from './mock-marlin.mjs';
import { MockSD } from './mock-sd.mjs';
import { deviceIdentityLocked, localUrlForHostname, sanitizeHostnameInput } from '../www/lib/device-settings.js';
import { DEFAULT_TOOL_CHANGE_SETTINGS, normalizeToolChangeSettings } from '../www/lib/tool-change-settings.js';

const DEV_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(DEV_DIR, '..');

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8', '.gc': 'text/plain; charset=utf-8', '.gcode': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.nc': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.tap': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, contentType = 'application/json; charset=utf-8', headers = {}) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': data.length, 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function json(res, status, value) {
  send(res, status, JSON.stringify(value));
}

function errorStatus(message) {
  if (/not found|ENOENT/i.test(message)) return 404;
  if (/exists|active|armed|stale|changed|paused|running|generated|only when.*idle/i.test(message)) return 409;
  if (/unsafe|outside|invalid|must|percent|missing/i.test(message)) return 400;
  return 500;
}

async function readBody(req, limit = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const body = await readBody(req);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new Error('invalid JSON body');
  }
}

function parseMultipart(buffer, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean);
  if (!boundary) throw new Error('multipart boundary missing');
  const marker = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = buffer.indexOf(marker);
  while (cursor >= 0) {
    cursor += marker.length;
    if (buffer.subarray(cursor, cursor + 2).toString() === '--') break;
    if (buffer.subarray(cursor, cursor + 2).toString() === '\r\n') cursor += 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd < 0) break;
    const headers = buffer.subarray(cursor, headerEnd).toString('utf8');
    const next = buffer.indexOf(marker, headerEnd + 4);
    if (next < 0) break;
    const disposition = headers.match(/content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
    let end = next;
    if (buffer.subarray(end - 2, end).toString() === '\r\n') end -= 2;
    if (disposition) parts.push({ name: disposition[1], filename: disposition[2] || '', data: buffer.subarray(headerEnd + 4, end) });
    cursor = next;
  }
  return parts;
}

function safeUploadName(filename) {
  const name = String(filename || '');
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) throw new Error('unsafe file name');
  return name;
}

function syncMockFrame(env) {
  env.frame.machine = { ...env.marlin.machinePosition };
  env.frame.work = { ...env.marlin.position };
  env.frame.revision += 1;
}

async function staticFile(wwwRoot, pathname) {
  const route = pathname === '/' ? '/index.html' : pathname === '/files' ? '/files.html' : pathname;
  const decoded = decodeURIComponent(route);
  if (decoded.includes('..') || decoded.includes('\\') || !decoded.startsWith('/')) throw new Error('unsafe static path');
  const target = path.resolve(wwwRoot, `.${decoded}`);
  if (!target.startsWith(`${wwwRoot}${path.sep}`)) throw new Error('unsafe static path');
  const info = await stat(target);
  if (!info.isFile()) throw new Error('static file not found');
  return { body: await readFile(target), contentType: CONTENT_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream' };
}

export async function createMockEnvironment(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || DEFAULT_PROJECT_ROOT);
  const configPath = options.configPath || path.join(projectRoot, 'dev', 'mock-config.json');
  const config = { ...JSON.parse(await readFile(configPath, 'utf8')), ...(options.config || {}) };
  const sd = new MockSD(options.mockRoot || path.join(projectRoot, 'dev', 'mock-sd'));
  await sd.seedSamples();
  const marlin = new MockMarlin(config);
  const frame = {
    machine: null, work: { ...marlin.position }, workZeroMachine: null,
    homedAxes: { x: false, y: false, z: false }, homingEpoch: 0, homingSessionId: '',
    bootSessionId: `mock-boot-${Date.now()}`, absoluteFromHome: false, manualWorkFrameValid: false,
    workZeroValid: false, frameMode: 'untrusted', homeReference: null, revision: 0, trusted: false,
  };
  const toolChangeSettings = { ...DEFAULT_TOOL_CHANGE_SETTINGS };
  const runner = new MockJobRunner({ sd, marlin, frame, toolChangeSettings, lineDelayMs: config.lineDelayMs });
  const jog = {
    state: 'IDLE', safeJog: true, zLiftedForJog: false, safeLiftZ: 70,
    zRestoreAvailable: false, originalZ: null, safeLiftWorkZ: null, zChangedDuringJog: false,
    commandedPositionCaptured: false, commandedWorkX: null, commandedWorkY: null, commandedWorkZ: null,
    xyFeedMax: 3000, zFeedMax: 400, lastCommand: '', lastError: '',
    lastUpdateAt: 0,
  };
  const device = {
    deviceId: 'DEVM01', hostname: 'cnc', friendlyName: 'ESP32 CNC Dev Mock', ip: '127.0.0.1',
    mode: 'mock', mdnsEnabled: true,
    bluetooth: { enabled: true, advertiseName: true, started: true, name: 'CNC cnc.local' },
    configSource: 'mock',
  };
  const recoveryCheckpoint = {
    available: false, requiresReview: false, bootInterrupted: false,
    requiresHoming: false, resetReason: '', checkpoint: null,
  };
  return {
    projectRoot, wwwRoot: path.join(projectRoot, 'www'), config, sd, marlin, runner, frame, jog, device,
    toolChangeSettings, recoveryCheckpoint, startedAt: Date.now(),
  };
}

export async function createMockServer(options = {}) {
  const env = await createMockEnvironment(options);
  const mutationTouchesLockedFile = (candidate) => {
    if (!env.runner.isActive() && !env.recoveryCheckpoint.requiresReview) return false;
    const normalized = String(candidate || '').replace(/\/$/, '');
    const locked = [
      env.runner.status.gcodePath, env.runner.status.jobPath, env.runner.status.authorizationActiveRunPath,
      env.recoveryCheckpoint.checkpoint?.gcodePath, env.recoveryCheckpoint.checkpoint?.jobPath,
      env.recoveryCheckpoint.checkpoint?.authorizationActiveRunPath,
    ].filter(Boolean);
    return locked.some((item) => item === normalized || item.startsWith(`${normalized}/`));
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const pathname = url.pathname;

      if (req.method === 'GET' && pathname === '/api/health') {
        return json(res, 200, {
          firmware: 'CNC-ESP32 Mock Dev Server', firmwareVersion: 'mock-dev', buildDate: new Date().toISOString().slice(0, 10),
          buildTime: 'local', uptimeMs: Date.now() - env.startedAt, freeHeap: 0, flashSize: 0, sketchSize: 0,
          freeSketchSpace: 0, baudrate: 250000, wifiMode: 'mock', ipAddress: '127.0.0.1', ssid: 'DEV MOCK', rssi: 0,
          sdMounted: true, sdCardType: 'MOCK_FS', sdTotalBytes: 0, sdUsedBytes: 0, sdFreeBytes: 0,
          mockMode: true, modeLabel: 'DEV MOCK - NO REAL MACHINE',
        });
      }
      if (req.method === 'GET' && pathname === '/api/device') {
        return json(res, 200, { ...env.device, localUrl: localUrlForHostname(env.device.hostname) });
      }
      if (req.method === 'PATCH' && pathname === '/api/device') {
        if (deviceIdentityLocked(env.runner.status.state)) throw new Error('Device address can be changed only when the machine is idle.');
        const body = await readJson(req);
        const hostname = sanitizeHostnameInput(body.hostname);
        const friendlyName = String(body.friendlyName || '').trim();
        if (!friendlyName) throw new Error('friendlyName is required');
        env.device.hostname = hostname;
        env.device.friendlyName = friendlyName;
        env.device.bluetooth.name = `CNC ${hostname}.local`;
        await env.sd.writeText('/esp32-cnc/config.json', JSON.stringify({
          device: { hostname, friendlyName }, bluetooth: { enabled: true, advertiseName: true },
        }, null, 2), { overwrite: true });
        return json(res, 200, {
          ok: true, requiresRestart: true, sdConfigWritten: true,
          device: { hostname, friendlyName, localUrl: localUrlForHostname(hostname), bleName: env.device.bluetooth.name },
        });
      }
      if (req.method === 'POST' && pathname === '/api/system/restart') {
        if (deviceIdentityLocked(env.runner.status.state)) throw new Error('Restart is allowed only when the machine is idle.');
        return json(res, 202, { ok: true, restarting: true, mockMode: true });
      }
      if (req.method === 'GET' && pathname === '/api/ui/status') {
        return json(res, 200, { sdUiAvailable: true, indexFromSd: false, wwwPath: '/www', mockMode: true });
      }
      if (req.method === 'GET' && pathname === '/api/sd/status') {
        return json(res, 200, { mounted: true, cardType: 'MOCK_FS', totalBytes: 0, usedBytes: 0, freeBytes: 0 });
      }
      if (req.method === 'GET' && pathname === '/api/files') return json(res, 200, await env.sd.list(url.searchParams.get('path') || '/gcode'));
      if (req.method === 'GET' && pathname === '/api/download') {
        const espPath = url.searchParams.get('path') || '';
        const body = await env.sd.read(espPath);
        const fileName = path.basename(espPath).replace(/["\r\n]/g, '_');
        return send(res, 200, body, CONTENT_TYPES[path.extname(espPath).toLowerCase()] || 'application/octet-stream', {
          'Content-Disposition': `attachment; filename="${fileName}"`,
        });
      }
      if (req.method === 'POST' && pathname === '/api/upload') {
        const body = await readBody(req);
        const parts = parseMultipart(body, req.headers['content-type'] || '');
        const dir = parts.find((part) => part.name === 'path')?.data.toString('utf8') || '/gcode';
        const file = parts.find((part) => part.name === 'file' && part.filename);
        if (!file || !file.data.length) throw new Error('no file provided or empty upload');
        const target = `${dir.replace(/\/$/, '')}/${safeUploadName(file.filename)}`;
        if (mutationTouchesLockedFile(target)) return json(res, 423, { ok: false, error: `file is locked by the active or interrupted job: ${target}` });
        await env.sd.write(target, file.data, { overwrite: url.searchParams.get('overwrite') === 'true' });
        return json(res, 200, { ok: true, path: target });
      }
      if (req.method === 'POST' && pathname === '/api/delete') {
        const target = (await readJson(req)).path;
        if (mutationTouchesLockedFile(target)) return json(res, 423, { ok: false, error: `file is locked by the active or interrupted job: ${target}` });
        await env.sd.delete(target);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/mkdir') {
        await env.sd.mkdir((await readJson(req)).path);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/rename') {
        const body = await readJson(req);
        if (mutationTouchesLockedFile(body.from) || mutationTouchesLockedFile(body.to)) {
          return json(res, 423, { ok: false, error: 'file is locked by the active or interrupted job' });
        }
        await env.sd.rename(body.from, body.to);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && pathname === '/api/marlin/log') {
        const errors = env.marlin.log.filter((entry) => entry.level === 'error');
        return json(res, 200, { ok: true, entries: env.marlin.log.slice(-100), lastCritical: errors.at(-1)?.text || null });
      }
      if (req.method === 'POST' && pathname === '/api/cmd') {
        const command = String((await readJson(req)).cmd || '').trim();
        if (!command) throw new Error('missing cmd');
        const upper = command.toUpperCase();
        if (env.runner.status.state === 'RUNNING' && !['M114', 'M115', 'M119', 'M400', 'M5'].includes(upper)) {
          return json(res, 409, { ok: false, error: 'job is running; manual command rejected' });
        }
        const result = env.marlin.execute(command, { priority: upper === 'M5' });
        if (result.ok && env.frame.trusted) syncMockFrame(env);
        return json(res, result.ok ? 200 : 400, result);
      }
      if (req.method === 'GET' && pathname === '/api/job/status') {
        return json(res, 200, {
          ...env.runner.snapshot(),
          recoveryCheckpoint: {
            requiresReview: env.recoveryCheckpoint.requiresReview,
            bootInterrupted: env.recoveryCheckpoint.bootInterrupted,
            gcodePath: env.recoveryCheckpoint.checkpoint?.gcodePath || '',
            jobPath: env.recoveryCheckpoint.checkpoint?.jobPath || '',
            resetReason: env.recoveryCheckpoint.resetReason,
          },
        });
      }
      if (req.method === 'GET' && pathname === '/api/recovery/checkpoint') return json(res, 200, env.recoveryCheckpoint);
      if (req.method === 'POST' && pathname === '/api/recovery/checkpoint/acknowledge') {
        const body = await readJson(req);
        if (body.confirmed !== true) return json(res, 400, { ok: false, error: 'confirmed true is required' });
        if (env.runner.isActive()) return json(res, 409, { ok: false, error: 'cannot clear recovery evidence while a job is active' });
        Object.assign(env.recoveryCheckpoint, {
          available: false, requiresReview: false, bootInterrupted: false,
          requiresHoming: false, resetReason: '', checkpoint: null,
        });
        return json(res, 200, { ok: true, message: 'Recovery checkpoint cleared. Machine position remains untrusted until Home All.' });
      }
      const requireReviewedCheckpoint = () => {
        if (!env.recoveryCheckpoint.requiresReview) return false;
        json(res, 409, { ok: false, error: 'review and import or dismiss the interrupted-job checkpoint before starting motion' });
        return true;
      };
      if (req.method === 'POST' && pathname === '/api/job/start') {
        if (requireReviewedCheckpoint()) return;
        return json(res, 200, await env.runner.start(await readJson(req)));
      }
      if (req.method === 'POST' && pathname === '/api/test-motion/start') {
        if (requireReviewedCheckpoint()) return;
        return json(res, 200, await env.runner.startTestMotion(await readJson(req)));
      }
      if (req.method === 'POST' && pathname === '/api/recovery/production/start') {
        if (requireReviewedCheckpoint()) return;
        return json(res, 200, await env.runner.startProductionResume(await readJson(req)));
      }
      if (req.method === 'POST' && pathname === '/api/job/pause') return json(res, 200, env.runner.pause());
      if (req.method === 'POST' && pathname === '/api/job/resume') return json(res, 200, env.runner.resume());
      if (req.method === 'POST' && pathname === '/api/job/tool-change/complete') {
        return json(res, 200, env.runner.completeToolChange(await readJson(req)));
      }
      if (req.method === 'POST' && pathname === '/api/job/stop') return json(res, 200, env.runner.stop());
      if (req.method === 'POST' && pathname === '/api/job/feed-override') {
        return json(res, 200, env.runner.setFeedOverride((await readJson(req)).percent));
      }
      if (req.method === 'POST' && pathname === '/api/work-zero/goto') {
        if (env.runner.isActive()) return json(res, 409, { ok: false, error: 'go to work zero rejected while job is active' });
        if (!env.frame.workZeroValid) {
          return json(res, 409, {
            ok: false,
            error: 'go to work zero requires an active work zero; set it or restore one from history first',
          });
        }
        const body = await readJson(req);
        const axes = String(body.axes || '').toLowerCase();
        if (!['x', 'y', 'xy'].includes(axes)) throw new Error('axes must be x, y, or xy');
        const safeMove = body.safeMove !== false;
        const safeZ = Number(body.safeZ ?? 70);
        if (safeMove && (!Number.isFinite(safeZ) || safeZ <= 0 || safeZ > 200)) {
          throw new Error('safeZ must be greater than 0 and no more than 200 mm');
        }
        const commands = ['M5', 'G21', 'G90', 'G54'];
        if (safeMove) commands.push(`G0 Z${safeZ.toFixed(3)} F400`);
        commands.push(`G0${axes.includes('x') ? ' X0' : ''}${axes.includes('y') ? ' Y0' : ''} F3000`, 'G90');
        for (const command of commands) {
          const result = env.marlin.execute(command, { priority: true });
          if (!result.ok) return json(res, 502, result);
        }
        return json(res, 200, {
          ok: true, axes, safeMove, safeZ,
          message: 'Work-zero move accepted. Z will remain at safe height after XY movement.',
        });
      }
      if (req.method === 'GET' && pathname === '/api/machine/frame') return json(res, 200, env.frame);
      if (req.method === 'POST' && pathname === '/api/machine/home') {
        if (env.runner.isActive()) return json(res, 409, { ok: false, error: 'homing requires idle Marlin transport' });
        const axes = String((await readJson(req)).axes || 'all').toLowerCase();
        if (!['x', 'y', 'z', 'xy', 'all'].includes(axes)) throw new Error('axes must be x, y, z, xy, or all');
        env.marlin.allowHoming = true;
        const suffix = axes === 'all' ? '' : ` ${axes.toUpperCase().split('').join(' ')}`;
        const result = env.marlin.execute(`G28${suffix}`);
        env.marlin.allowHoming = false;
        if (!result.ok) return json(res, 502, result);
        if (axes === 'all') {
          env.marlin.execute('G54');
          env.marlin.execute('G92 X0 Y0 Z0');
          env.frame.homedAxes = { x: true, y: true, z: true };
          env.frame.homingEpoch += 1;
          env.frame.homingSessionId = `mock-home-${env.frame.homingEpoch}-${Date.now()}`;
          env.frame.absoluteFromHome = true;
          env.frame.manualWorkFrameValid = false;
          env.frame.workZeroValid = true;
          env.frame.frameMode = 'homed';
          env.frame.homeReference = {
            counts: Object.fromEntries(['x', 'y', 'z'].map((axis) => [axis, Math.round(env.marlin.machinePosition[axis] * env.marlin.stepsPerMm[axis])])),
            stepsPerMm: { ...env.marlin.stepsPerMm },
          };
          env.frame.trusted = true;
          env.frame.workZeroMachine = { ...env.marlin.machinePosition };
        } else {
          for (const axis of axes) env.frame.homedAxes[axis] = true;
          env.frame.trusted = false;
          env.frame.absoluteFromHome = false;
          env.frame.manualWorkFrameValid = false;
          env.frame.workZeroValid = false;
          env.frame.frameMode = 'untrusted';
          env.frame.homingSessionId = '';
          env.frame.homeReference = null;
          env.frame.workZeroMachine = null;
        }
        env.frame.machine = { ...env.marlin.machinePosition };
        env.frame.work = { ...env.marlin.position };
        env.frame.revision += 1;
        return json(res, 200, env.frame);
      }
      if (req.method === 'POST' && pathname === '/api/machine/manual-frame') {
        if (env.runner.isActive()) return json(res, 409, { ok: false, error: 'confirming a manual work frame requires idle Marlin transport' });
        const mode = String((await readJson(req)).mode || '').toLowerCase();
        if (!['confirm', 'preserve', 'set-zero'].includes(mode)) throw new Error('mode must be confirm, preserve, or set-zero');
        const before = env.marlin.execute('M114').response;
        if (mode !== 'confirm') env.marlin.execute('G54');
        if (mode === 'set-zero') env.marlin.execute('G92 X0 Y0 Z0');
        const after = env.marlin.execute('M114').response;
        env.frame.machine = null;
        env.frame.work = { ...env.marlin.position };
        env.frame.workZeroMachine = null;
        env.frame.homedAxes = { x: false, y: false, z: false };
        env.frame.homingSessionId = '';
        env.frame.absoluteFromHome = false;
        env.frame.manualWorkFrameValid = true;
        env.frame.workZeroValid = mode !== 'confirm';
        env.frame.frameMode = 'manual-unhomed';
        env.frame.homeReference = null;
        env.frame.trusted = false;
        env.frame.revision += 1;
        return json(res, 200, { ok: true, mode, before, after, frame: env.frame });
      }
      if (req.method === 'POST' && pathname === '/api/work-zero/set') {
        if ((!env.frame.trusted && !env.frame.manualWorkFrameValid) || env.runner.isActive()) return json(res, 409, { ok: false, error: 'Home All or a confirmed manual work frame is required before setting work zero' });
        const body = await readJson(req);
        const axes = ['x', 'y'].includes(String(body.axes || '').toLowerCase()) ? String(body.axes).toLowerCase() : 'xyz';
        const before = env.marlin.execute('M114').response;
        env.marlin.execute(axes === 'x' ? 'G92 X0' : axes === 'y' ? 'G92 Y0' : 'G92 X0 Y0 Z0');
        const after = env.marlin.execute('M114').response;
        syncMockFrame(env);
        if (env.frame.absoluteFromHome) {
          env.frame.workZeroMachine ||= { ...env.marlin.machinePosition };
          if (axes === 'x' || axes === 'xyz') env.frame.workZeroMachine.x = env.marlin.machinePosition.x;
          if (axes === 'y' || axes === 'xyz') env.frame.workZeroMachine.y = env.marlin.machinePosition.y;
          if (axes === 'xyz') env.frame.workZeroMachine.z = env.marlin.machinePosition.z;
        }
        env.frame.workZeroValid = true;
        env.frame.revision += 1;
        return json(res, 200, { ok: true, axes, before, after, frame: env.frame });
      }
      if (req.method === 'POST' && pathname === '/api/work-zero/set-z') {
        const toolChangeWindow = env.runner.status.state === 'PAUSED' && env.runner.status.toolChangePending && env.runner.status.toolChangeReady;
        if ((!env.frame.trusted && !env.frame.manualWorkFrameValid) || !env.frame.workZeroValid ||
            (env.runner.isActive() && !toolChangeWindow)) {
          return json(res, 409, { ok: false, error: 'Home All and an active work frame are required before setting Z zero' });
        }
        const before = env.marlin.execute('M114').response;
        env.marlin.execute('G92 Z0');
        const after = env.marlin.execute('M114').response;
        syncMockFrame(env);
        if (env.frame.workZeroMachine) env.frame.workZeroMachine.z = env.marlin.machinePosition.z;
        env.runner.markToolChangeZZero('manual');
        return json(res, 200, { ok: true, before, after, frame: env.frame });
      }
      if (req.method === 'POST' && pathname === '/api/work-zero/touch-plate') {
        const toolChangeWindow = env.runner.status.state === 'PAUSED' && env.runner.status.toolChangePending && env.runner.status.toolChangeReady;
        if (!env.toolChangeSettings.touchPlateEnabled) throw new Error('touch plate is not enabled in Tool Change settings');
        if ((!env.frame.trusted && !env.frame.manualWorkFrameValid) || !env.frame.workZeroValid ||
            (env.runner.isActive() && !toolChangeWindow)) {
          throw new Error('an active work frame and idle transport or a ready M6 stop are required before probing Z zero');
        }
        const settings = env.toolChangeSettings;
        const before = env.marlin.execute('M114').response;
        const probeCommand = `G38.2 Z-${settings.touchPlateProbeDistance.toFixed(3)} F${settings.touchPlateProbeFeed.toFixed(1)}`;
        const commands = ['M5', 'M400', 'G21', 'G90', 'G54', 'G91', probeCommand, 'G90', 'M400', 'M114'];
        let result;
        for (const command of commands) {
          result = env.marlin.execute(command, { priority: true });
          if (!result.ok) throw new Error(result.error);
        }
        const contact = result.response;
        const contactMachineZ = env.marlin.machinePosition.z;
        for (const command of [
          `G92 Z${settings.touchPlateThickness.toFixed(3)}`,
          `G0 Z${(settings.touchPlateThickness + settings.touchPlateRetractDistance).toFixed(3)} F${settings.touchPlateProbeFeed.toFixed(1)}`,
          'M400', 'M114',
        ]) {
          result = env.marlin.execute(command, { priority: true });
          if (!result.ok) throw new Error(result.error);
        }
        syncMockFrame(env);
        if (env.frame.workZeroMachine) env.frame.workZeroMachine.z = contactMachineZ - settings.touchPlateThickness;
        env.runner.markToolChangeZZero('touchplate');
        return json(res, 200, { ok: true, method: 'touchplate', probeCommand, before, contact, after: result.response, frame: env.frame });
      }
      if (req.method === 'GET' && pathname === '/api/machine/info') {
        const m = env.marlin.machine;
        return json(res, 200, {
          available: true, refreshing: false, firmwareName: 'MockMarlin 2.1.1', machineType: 'DEV-MOCK', sourceCodeUrl: 'local',
          full: { xMin: m.xMin, xMax: m.xMax, yMin: m.yMin, yMax: m.yMax, zMin: m.zMin, zMax: m.zMax },
          work: { xMin: m.xMin, xMax: m.xMax, yMin: m.yMin, yMax: m.yMax, zMin: m.zMin, zMax: m.zMax },
          capabilities: { emergencyParser: true, arcs: true, autoreportPosition: true, eeprom: true, sdCard: true, motionModes: true },
          refreshedAtMs: Date.now() - env.startedAt, lastError: '',
        });
      }
      if (req.method === 'GET' && pathname === '/api/tool-change/settings') {
        return json(res, 200, { ok: true, settings: env.toolChangeSettings });
      }
      if (req.method === 'PUT' && pathname === '/api/tool-change/settings') {
        if (env.runner.isActive()) throw new Error('Tool-change settings can be changed only when the machine is idle.');
        const body = await readJson(req);
        const settings = normalizeToolChangeSettings(body);
        const machine = env.marlin.machine;
        if (settings.zZeroMethod === 'touchplate' && !settings.touchPlateEnabled) {
          throw new Error('touchplate Z zero requires an enabled touch plate');
        }
        if (settings.parkMachineX < machine.xMin || settings.parkMachineX > machine.xMax ||
            settings.parkMachineY < machine.yMin || settings.parkMachineY > machine.yMax ||
            settings.parkMachineZ < machine.zMin || settings.parkMachineZ > machine.zMax) {
          throw new Error('tool-change position is outside configured machine limits');
        }
        Object.assign(env.toolChangeSettings, settings);
        return json(res, 200, { ok: true, settings });
      }
      if (req.method === 'POST' && pathname === '/api/machine/refresh') {
        env.marlin.execute('M115');
        return json(res, 202, { ok: true, message: 'M115 discovery queued' });
      }
      if (req.method === 'POST' && pathname === '/api/machine/apply') {
        if (env.runner.isActive()) return json(res, 409, { ok: false, error: 'machine configuration requires idle Marlin transport' });
        const body = await readJson(req);
        const group = String(body.group || '').toUpperCase();
        const fields = group === 'M204' ? ['p', 'r', 't'] : ['x', 'y', 'z'];
        if (!['M92', 'M203', 'M201', 'M204'].includes(group) || fields.some((field) => !Number.isFinite(Number(body[field])))) {
          throw new Error('editable group or values are invalid');
        }
        const command = `${group} ${fields.map((field) => `${field.toUpperCase()}${Number(body[field])}`).join(' ')}`;
        const result = env.marlin.execute(command);
        return json(res, result.ok ? 200 : 400, { ...result, command });
      }
      if (req.method === 'POST' && pathname === '/api/machine/save') {
        if (env.runner.isActive()) return json(res, 409, { ok: false, error: 'M500 requires idle Marlin transport' });
        const result = env.marlin.execute('M500');
        return json(res, result.ok ? 200 : 400, { ...result, command: 'M500', message: 'Changes saved to Marlin EEPROM' });
      }
      if (req.method === 'POST' && pathname === '/api/work-zero/restore') {
        if (env.runner.isActive()) return json(res, 409, { ok: false, error: 'work-zero restore rejected while motion is active' });
        const body = await readJson(req);
        const machineX = Number(body.machineX);
        const machineY = Number(body.machineY);
        const machineZ = Number(body.machineZ);
        const safeMachineZ = Number(body.safeMachineZ ?? 70);
        const travelFeed = Number(body.travelFeedMmMin ?? 3000);
        const axes = String(body.axes || 'xy').toLowerCase();
        const moveToZ = body.moveToZ === true;
        if (!Number.isFinite(machineX) || !Number.isFinite(machineY) || machineX < 0 || machineX > 1625 || machineY < 0 || machineY > 5800) {
          throw new Error('saved work-zero XY is outside configured machine limits');
        }
        if (!Number.isFinite(safeMachineZ) || safeMachineZ <= 0 || safeMachineZ > 70) throw new Error('Safe machine Z is outside configured limits');
        if (!['x', 'y', 'z', 'xy', 'xyz'].includes(axes)) throw new Error('axes must be x, y, z, xy, or xyz');
        if (moveToZ && (!Number.isFinite(machineZ) || machineZ < 0 || machineZ > 70)) throw new Error('saved zero Z is outside configured machine limits');
        if (moveToZ && machineZ > safeMachineZ) throw new Error('saved zero Z cannot be above Safe machine Z');
        const commands = [
          'M5', 'G21', 'G90', 'M400', `G53 G0 Z${safeMachineZ.toFixed(3)} F400`, 'M400',
          `G53 G0 X${machineX.toFixed(3)} Y${machineY.toFixed(3)} F${travelFeed.toFixed(0)}`,
          'M400',
        ];
        if (moveToZ) commands.push(`G53 G0 Z${machineZ.toFixed(3)} F400`, 'M400');
        const zeroWords = [
          ['x', 'xy', 'xyz'].includes(axes) ? 'X0' : '',
          ['y', 'xy', 'xyz'].includes(axes) ? 'Y0' : '',
          ['z', 'xyz'].includes(axes) ? 'Z0' : '',
        ].filter(Boolean).join(' ');
        commands.push('G54', `G92 ${zeroWords}`, 'M114');
        let last;
        for (const command of commands) {
          last = env.marlin.execute(command, { priority: true, allowMachineCoordinates: true });
          if (!last.ok) return json(res, 502, last);
        }
        syncMockFrame(env);
        return json(res, 200, {
          ok: true, machineX, machineY, machineZ: moveToZ ? machineZ : null, axes, moveToZ, safeMachineZ,
          response: last.response, frame: env.machineFrame, message: 'Saved zero restored and activated.',
        });
      }
      if (req.method === 'GET' && pathname === '/api/jog/status') {
        const age = env.jog.lastUpdateAt ? Date.now() - env.jog.lastUpdateAt : 0;
        if (env.jog.state === 'JOGGING' && age > 500) {
          env.jog.state = 'IDLE';
          env.jog.zRestoreAvailable = false;
          env.jog.commandedPositionCaptured = false;
          env.jog.lastError = 'jog heartbeat timeout; stopped jogging';
        }
        return json(res, 200, { ...env.jog, heartbeatAgeMs: age, uptimeMs: Date.now() - env.startedAt });
      }
      if (req.method === 'POST' && pathname === '/api/jog/start') {
        if (env.runner.isActive() && env.runner.status.state !== 'PAUSED') {
          return json(res, 409, { ok: false, error: 'jog rejected while job is active' });
        }
        const body = await readJson(req);
        const continuePendingRestore = env.jog.zRestoreAvailable && Number.isFinite(env.jog.originalZ) && body.safeJog !== false;
        const pendingOriginalZ = env.jog.originalZ;
        const originalZ = env.marlin.position.z;
        env.jog = {
          ...env.jog,
          state: 'JOGGING',
          safeJog: body.safeJog !== false,
          safeLiftZ: Math.max(0, Math.min(70, Number(body.safeLiftZ ?? 70))),
          zRestoreAvailable: false,
          originalZ: continuePendingRestore ? pendingOriginalZ : null,
          safeLiftWorkZ: null,
          zChangedDuringJog: false,
          commandedPositionCaptured: false,
          commandedWorkX: null,
          commandedWorkY: null,
          commandedWorkZ: null,
          xyFeedMax: Number(body.xyFeedMax ?? 3000),
          zFeedMax: Number(body.zFeedMax ?? 400),
          zLiftedForJog: false,
          lastError: '',
          lastUpdateAt: Date.now(),
        };
        if (env.jog.safeJog) {
          if (!Number.isFinite(env.jog.originalZ)) env.jog.originalZ = originalZ;
          for (const command of ['M5', 'G90', `G53 G0 Z${env.jog.safeLiftZ.toFixed(3)} F${env.jog.zFeedMax}`, 'G90']) {
            const result = env.marlin.execute(command, { priority: true, allowMachineCoordinates: command.startsWith('G53 ') });
            if (!result.ok) {
              env.jog.state = 'ERROR';
              env.jog.lastError = result.error;
              return json(res, 400, { ok: false, error: result.error });
            }
            env.jog.lastCommand = command;
          }
          env.jog.safeLiftWorkZ = env.marlin.position.z;
          env.jog.zLiftedForJog = true;
        }
        env.jog.commandedWorkX = env.marlin.position.x;
        env.jog.commandedWorkY = env.marlin.position.y;
        env.jog.commandedWorkZ = env.marlin.position.z;
        env.jog.commandedPositionCaptured = true;
        env.marlin.execute('G90', { priority: true });
        return json(res, 200, { ...env.jog, heartbeatAgeMs: 0 });
      }
      if (req.method === 'POST' && pathname === '/api/jog/update') {
        if (env.jog.state !== 'JOGGING') return json(res, 409, { ok: false, error: 'jog is not active' });
        const body = await readJson(req);
        const x = Math.max(-1, Math.min(1, Number(body.x || 0)));
        const y = Math.max(-1, Math.min(1, Number(body.y || 0)));
        const z = Math.max(-1, Math.min(1, Number(body.z || 0)));
        const speed = Math.max(0, Math.min(1, Number(body.speed || 0)));
        const dx = x * Math.min(15, env.jog.xyFeedMax / 60 * 0.15);
        const dy = y * Math.min(15, env.jog.xyFeedMax / 60 * 0.15);
        const dz = z * speed * Math.min(0.5, env.jog.zFeedMax / 60 * 0.15);
        if (Math.abs(dz) >= 0.005) {
          env.jog.zChangedDuringJog = true;
          env.jog.zRestoreAvailable = false;
        }
        if (Math.abs(dx) >= 0.01 || Math.abs(dy) >= 0.01 || Math.abs(dz) >= 0.005) {
          const distance = Math.hypot(dx, dy);
          const feed = Math.abs(dz) >= 0.005 && distance < 0.01
            ? Math.max(20, Math.min(env.jog.zFeedMax, Math.abs(dz) / 0.15 * 60))
            : Math.max(60, Math.min(env.jog.xyFeedMax, distance / 0.15 * 60));
          if (Math.abs(dx) >= 0.01) env.jog.commandedWorkX += dx;
          if (Math.abs(dy) >= 0.01) env.jog.commandedWorkY += dy;
          if (Math.abs(dz) >= 0.005) env.jog.commandedWorkZ += dz;
          const move = `G1${Math.abs(dx) >= 0.01 ? ` X${env.jog.commandedWorkX.toFixed(3)}` : ''}${Math.abs(dy) >= 0.01 ? ` Y${env.jog.commandedWorkY.toFixed(3)}` : ''}${Math.abs(dz) >= 0.005 ? ` Z${env.jog.commandedWorkZ.toFixed(3)}` : ''} F${feed.toFixed(0)}`;
          const result = env.marlin.execute(move, { priority: true });
          if (!result.ok) {
            env.jog.state = 'ERROR';
            env.jog.lastError = result.error;
            env.jog.commandedPositionCaptured = false;
            return json(res, 400, { ok: false, error: result.error });
          }
          env.jog.lastCommand = move;
        }
        env.jog.lastUpdateAt = Date.now();
        return json(res, 200, { ...env.jog, heartbeatAgeMs: 0 });
      }
      if (req.method === 'POST' && pathname === '/api/jog/stop') {
        const body = await readJson(req);
        const emergency = body.emergency === true;
        if (emergency) {
          env.marlin.execute('M410', { priority: true });
          env.marlin.execute('M5', { priority: true });
          env.jog.zRestoreAvailable = false;
          env.jog.commandedPositionCaptured = false;
        } else {
          env.jog.zRestoreAvailable = env.jog.safeJog && env.jog.zLiftedForJog &&
            Number.isFinite(env.jog.originalZ) && !env.jog.zChangedDuringJog;
        }
        env.jog.state = 'IDLE';
        env.jog.lastCommand = emergency ? 'M5' : 'G90';
        env.jog.lastUpdateAt = Date.now();
        return json(res, 200, { ...env.jog, heartbeatAgeMs: 0 });
      }
      if (req.method === 'POST' && pathname === '/api/jog/restore-z') {
        if (env.runner.isActive() || env.jog.state !== 'IDLE') {
          return json(res, 409, { ok: false, error: 'Z restore is unavailable while motion is active' });
        }
        if (!env.jog.zRestoreAvailable || !Number.isFinite(env.jog.originalZ) ||
            !Number.isFinite(env.jog.safeLiftWorkZ) || Math.abs(env.marlin.position.z - env.jog.safeLiftWorkZ) > 0.5) {
          env.jog.zRestoreAvailable = false;
          return json(res, 409, { ok: false, error: 'saved jog Z is not available at the current Z position' });
        }
        const targetZ = env.jog.originalZ;
        for (const command of ['G90', `G0 Z${targetZ.toFixed(3)} F${env.jog.zFeedMax}`, 'G90']) {
          const result = env.marlin.execute(command, { priority: true });
          if (!result.ok) return json(res, 400, { ok: false, error: result.error });
          env.jog.lastCommand = command;
        }
        env.jog.zRestoreAvailable = false;
        env.jog.zLiftedForJog = false;
        env.jog.commandedWorkZ = targetZ;
        env.jog.commandedPositionCaptured = true;
        env.jog.originalZ = null;
        env.jog.safeLiftWorkZ = null;
        return json(res, 200, { ...env.jog, heartbeatAgeMs: 0 });
      }
      if (pathname.startsWith('/api/')) return json(res, 501, { ok: false, error: `Mock API not implemented: ${pathname}` });
      if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
      const file = await staticFile(env.wwwRoot, pathname);
      return send(res, 200, file.body, file.contentType);
    } catch (error) {
      return json(res, errorStatus(error.message), { ok: false, error: error.message });
    }
  });
  return { server, env };
}

export async function startMockServer(options = {}) {
  const instance = await createMockServer(options);
  const port = Number(options.port ?? instance.env.config.port ?? 8080);
  const host = String(options.host ?? instance.env.config.host ?? '127.0.0.1');
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(port, host, resolve);
  });
  const actualPort = instance.server.address().port;
  console.log('CNC-ESP32 mock dev server');
  console.log(`UI: http://localhost:${actualPort}`);
  if (host === '0.0.0.0' || host === '::') {
    const addresses = Object.values(networkInterfaces()).flatMap((items) => items || [])
      .filter((item) => item.family === 'IPv4' && !item.internal)
      .map((item) => item.address)
      .filter((address, index, all) => all.indexOf(address) === index);
    for (const address of addresses) console.log(`LAN: http://${address}:${actualPort}`);
    console.log('LAN access has no authentication. Use only on a trusted private network.');
  }
  console.log(`Mock SD: ${path.relative(instance.env.projectRoot, instance.env.sd.rootPath)}`);
  console.log('Mode: DEV MOCK - NO REAL MACHINE');
  return { ...instance, port: actualPort, host };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startMockServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
