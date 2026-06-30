import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MockJobRunner } from './mock-job-runner.mjs';
import { MockMarlin } from './mock-marlin.mjs';
import { MockSD } from './mock-sd.mjs';

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
  if (/exists|active|armed|stale|changed|paused|running|generated/i.test(message)) return 409;
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
  const runner = new MockJobRunner({ sd, marlin, lineDelayMs: config.lineDelayMs });
  const jog = {
    state: 'IDLE', safeJog: true, zLiftedForJog: false, safeLiftZ: 70,
    restoreZAfterJog: true, xyFeedMax: 3000, zFeedMax: 400, lastCommand: '', lastError: '',
    lastUpdateAt: 0,
  };
  return { projectRoot, wwwRoot: path.join(projectRoot, 'www'), config, sd, marlin, runner, jog, startedAt: Date.now() };
}

export async function createMockServer(options = {}) {
  const env = await createMockEnvironment(options);
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
        return send(res, 200, body, CONTENT_TYPES[path.extname(espPath).toLowerCase()] || 'application/octet-stream');
      }
      if (req.method === 'POST' && pathname === '/api/upload') {
        const body = await readBody(req);
        const parts = parseMultipart(body, req.headers['content-type'] || '');
        const dir = parts.find((part) => part.name === 'path')?.data.toString('utf8') || '/gcode';
        const file = parts.find((part) => part.name === 'file' && part.filename);
        if (!file || !file.data.length) throw new Error('no file provided or empty upload');
        const target = `${dir.replace(/\/$/, '')}/${safeUploadName(file.filename)}`;
        await env.sd.write(target, file.data, { overwrite: url.searchParams.get('overwrite') === 'true' });
        return json(res, 200, { ok: true, path: target });
      }
      if (req.method === 'POST' && pathname === '/api/delete') {
        await env.sd.delete((await readJson(req)).path);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/mkdir') {
        await env.sd.mkdir((await readJson(req)).path);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/rename') {
        const body = await readJson(req);
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
        return json(res, result.ok ? 200 : 400, result);
      }
      if (req.method === 'GET' && pathname === '/api/job/status') return json(res, 200, env.runner.snapshot());
      if (req.method === 'POST' && pathname === '/api/job/start') return json(res, 200, await env.runner.start(await readJson(req)));
      if (req.method === 'POST' && pathname === '/api/job/pause') return json(res, 200, env.runner.pause());
      if (req.method === 'POST' && pathname === '/api/job/resume') return json(res, 200, env.runner.resume());
      if (req.method === 'POST' && pathname === '/api/job/stop') return json(res, 200, env.runner.stop());
      if (req.method === 'POST' && pathname === '/api/job/feed-override') {
        return json(res, 200, env.runner.setFeedOverride((await readJson(req)).percent));
      }
      if (req.method === 'POST' && pathname === '/api/work-zero/goto') {
        if (env.runner.isActive()) return json(res, 409, { ok: false, error: 'go to work zero rejected while job is active' });
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
      if (req.method === 'GET' && pathname === '/api/jog/status') {
        const age = env.jog.lastUpdateAt ? Date.now() - env.jog.lastUpdateAt : 0;
        if (env.jog.state === 'JOGGING' && age > 500) {
          env.jog.state = 'IDLE';
          env.jog.lastError = 'jog heartbeat timeout; stopped jogging';
        }
        return json(res, 200, { ...env.jog, heartbeatAgeMs: age, uptimeMs: Date.now() - env.startedAt });
      }
      if (req.method === 'POST' && pathname === '/api/jog/start') {
        if (env.runner.isActive()) return json(res, 409, { ok: false, error: 'jog rejected while job is active' });
        const body = await readJson(req);
        env.jog = {
          ...env.jog,
          state: 'JOGGING',
          safeJog: body.safeJog !== false,
          safeLiftZ: Number(body.safeLiftZ ?? 70),
          restoreZAfterJog: body.restoreZAfterJog !== false,
          xyFeedMax: Number(body.xyFeedMax ?? 3000),
          zFeedMax: Number(body.zFeedMax ?? 400),
          zLiftedForJog: false,
          lastError: '',
          lastUpdateAt: Date.now(),
        };
        if (env.jog.safeJog) {
          for (const command of ['M5', 'G90', `G0 Z${env.jog.safeLiftZ.toFixed(3)} F${env.jog.zFeedMax}`, 'G90']) {
            const result = env.marlin.execute(command, { priority: true });
            if (!result.ok) {
              env.jog.state = 'ERROR';
              env.jog.lastError = result.error;
              return json(res, 400, { ok: false, error: result.error });
            }
            env.jog.lastCommand = command;
          }
          env.jog.zLiftedForJog = true;
        }
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
        if (Math.abs(dx) >= 0.01 || Math.abs(dy) >= 0.01 || Math.abs(dz) >= 0.005) {
          const distance = Math.hypot(dx, dy);
          const feed = Math.abs(dz) >= 0.005 && distance < 0.01
            ? Math.max(20, Math.min(env.jog.zFeedMax, Math.abs(dz) / 0.15 * 60))
            : Math.max(60, Math.min(env.jog.xyFeedMax, distance / 0.15 * 60));
          const move = `G0${Math.abs(dx) >= 0.01 ? ` X${dx.toFixed(3)}` : ''}${Math.abs(dy) >= 0.01 ? ` Y${dy.toFixed(3)}` : ''}${Math.abs(dz) >= 0.005 ? ` Z${dz.toFixed(3)}` : ''} F${feed.toFixed(0)}`;
          for (const command of ['G91', move, 'G90']) {
            const result = env.marlin.execute(command, { priority: true });
            if (!result.ok) {
              env.jog.state = 'ERROR';
              env.jog.lastError = result.error;
              return json(res, 400, { ok: false, error: result.error });
            }
            env.jog.lastCommand = command;
          }
        }
        env.jog.lastUpdateAt = Date.now();
        return json(res, 200, { ...env.jog, heartbeatAgeMs: 0 });
      }
      if (req.method === 'POST' && pathname === '/api/jog/stop') {
        env.marlin.execute('M410', { priority: true });
        env.marlin.execute('M5', { priority: true });
        env.jog.state = 'IDLE';
        env.jog.lastCommand = 'M5';
        env.jog.lastUpdateAt = Date.now();
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
