import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockServer } from '../../dev/mock-server.mjs';

const instances = [];
const markoBrowserId = 'a'.repeat(64);
const workshopBrowserId = 'b'.repeat(64);
async function start(config = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cnc-mock-http-'));
  const instance = await createMockServer({
    mockRoot: root, config: { lineDelayMs: 1, operatorLockEnabled: false, ...config },
  });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  instances.push({ ...instance, root });
  return { ...instance, base };
}
afterEach(async () => {
  await Promise.all(instances.splice(0).map(async ({ server, root }) => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }));
});

describe('mock HTTP API', () => {
  it('allows one PIN-authenticated controller while other clients stay read-only', async () => {
    const { base } = await start({ operatorLockEnabled: true });
    const locked = await fetch(`${base}/api/cmd`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'M5' }),
    });
    expect(locked.status).toBe(423);
    expect(await fetch(`${base}/api/health`).then((res) => res.json())).toMatchObject({ mockMode: true });

    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Marko phone', pin: '741852', browserId: markoBrowserId }),
    });
    expect(claim.ok).toBe(true);
    expect(claim.headers.get('set-cookie')).toContain('Max-Age=31536000');
    const cookie = claim.headers.get('set-cookie').split(';')[0];
    expect(await claim.json()).toMatchObject({ configured: true, controller: true, owner: 'Marko phone' });
    expect(await fetch(`${base}/api/operator/status`).then((res) => res.json()))
      .toMatchObject({ controller: false, readOnly: true, owner: 'Marko phone' });
    expect((await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Workshop laptop', pin: '741852', browserId: workshopBrowserId }),
    })).status).toBe(423);
    expect((await fetch(`${base}/api/cmd`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ cmd: 'M5' }),
    })).ok).toBe(true);
    expect((await fetch(`${base}/api/operator/ota-unlock`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ pin: '741852' }),
    })).ok).toBe(true);
    expect((await fetch(`${base}/api/operator/release`, { method: 'POST', headers: { Cookie: cookie } })).ok).toBe(true);
  });

  it('lets the remembered controller revive an expired lease without another PIN', async () => {
    const { base, env } = await start({ operatorLockEnabled: true });
    env.operator.leaseMs = 5;
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Marko phone', pin: '741852', browserId: markoBrowserId }),
    });
    const cookie = claim.headers.get('set-cookie').split(';')[0];
    env.operator.lastSeenAt = Date.now() - 20;

    expect(await fetch(`${base}/api/operator/status`, { headers: { Cookie: cookie } }).then((res) => res.json()))
      .toMatchObject({ active: false, controller: true, readOnly: false, owner: 'Marko phone' });
    expect(await fetch(`${base}/api/operator/status`).then((res) => res.json()))
      .toMatchObject({ active: false, controller: false, readOnly: true, owner: null, canClaim: true });
    expect((await fetch(`${base}/api/cmd`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ cmd: 'M5' }),
    })).ok).toBe(true);
    expect(env.operator.lastSeenAt).toBeGreaterThan(Date.now() - 20);
  });

  it('silently restores only the remembered browser after an ESP restart', async () => {
    const { base, env } = await start({ operatorLockEnabled: true });
    await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Marko phone', pin: '741852', browserId: markoBrowserId }),
    });
    Object.assign(env.operator, { token: '', owner: '', browserId: '', lastSeenAt: 0 });

    expect((await fetch(`${base}/api/operator/reconnect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserId: workshopBrowserId }),
    })).status).toBe(403);

    const reconnect = await fetch(`${base}/api/operator/reconnect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserId: markoBrowserId }),
    });
    expect(reconnect.ok).toBe(true);
    expect(reconnect.headers.get('set-cookie')).toContain('cnc_operator=');
    expect(await reconnect.json()).toMatchObject({
      controller: true, readOnly: false, owner: 'Marko phone',
    });
  });

  it('locks only active/recovery job artifacts against upload, delete, and rename', async () => {
    const { base, env } = await start();
    const gcodePath = '/gcode/locked.gc';
    const jobPath = '/jobs/locked.job.json';
    await env.sd.writeText(gcodePath, 'G21\n');
    await env.sd.writeText(jobPath, '{}');
    await env.sd.writeText('/gcode/free.gc', 'G90\n');
    Object.assign(env.runner.status, {
      state: 'RUNNING', gcodePath, jobPath, authorizationActiveRunPath: gcodePath,
    });

    const form = new FormData();
    form.append('path', '/gcode');
    form.append('file', new Blob(['M3\n']), 'locked.gc');
    expect((await fetch(`${base}/api/upload?overwrite=true`, { method: 'POST', body: form })).status).toBe(423);
    expect(await env.sd.readText(gcodePath)).toBe('G21\n');
    expect((await fetch(`${base}/api/delete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: jobPath }),
    })).status).toBe(423);
    expect((await fetch(`${base}/api/rename`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: gcodePath, to: '/gcode/moved.gc' }),
    })).status).toBe(423);

    const unrelated = await fetch(`${base}/api/rename`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: '/gcode/free.gc', to: '/gcode/free-moved.gc' }),
    });
    expect(unrelated.ok).toBe(true);

    env.runner.status.state = 'ERROR';
    env.recoveryCheckpoint.requiresReview = true;
    env.recoveryCheckpoint.checkpoint = { gcodePath, jobPath, authorizationActiveRunPath: gcodePath };
    expect((await fetch(`${base}/api/delete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: gcodePath }),
    })).status).toBe(423);
  });

  it('blocks new motion until persistent recovery evidence is acknowledged', async () => {
    const { base, env } = await start();
    env.recoveryCheckpoint.available = true;
    env.recoveryCheckpoint.requiresReview = true;
    env.recoveryCheckpoint.bootInterrupted = true;
    env.recoveryCheckpoint.requiresHoming = true;
    env.recoveryCheckpoint.resetReason = 'BROWNOUT';
    env.recoveryCheckpoint.checkpoint = {
      state: 'RUNNING', gcodePath: '/gcode/sample.gc', jobPath: '/jobs/sample.job.json',
      lastAcknowledgedByteOffset: 120, lastAcknowledgedLineNumber: 8,
    };

    const checkpoint = await fetch(`${base}/api/recovery/checkpoint`).then((res) => res.json());
    expect(checkpoint).toMatchObject({ available: true, requiresReview: true, resetReason: 'BROWNOUT' });
    expect((await fetch(`${base}/api/job/start`, { method: 'POST' })).status).toBe(409);
    expect((await fetch(`${base}/api/recovery/checkpoint/acknowledge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: false }),
    })).status).toBe(400);
    const acknowledged = await fetch(`${base}/api/recovery/checkpoint/acknowledge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }),
    });
    expect(await acknowledged.json()).toMatchObject({ ok: true });
    expect(env.recoveryCheckpoint).toMatchObject({ available: false, requiresReview: false, checkpoint: null });
  });

  it('serves UI, health, command, list, upload, download, and rename APIs', async () => {
    const { base } = await start();
    expect(await fetch(`${base}/`).then((res) => res.text())).toContain('G-code CNC');
    expect(await fetch(`${base}/api/health`).then((res) => res.json())).toMatchObject({ mockMode: true, wifiMode: 'mock' });
    expect(await fetch(`${base}/api/cmd`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'M115' }) }).then((res) => res.json())).toMatchObject({ ok: true });
    expect((await fetch(`${base}/api/files?path=%2Fgcode`).then((res) => res.json())).items.length).toBeGreaterThan(3);

    const form = new FormData();
    form.append('path', '/gcode');
    form.append('file', new Blob(['G21\nG90\n']), 'upload.gc');
    expect(await fetch(`${base}/api/upload`, { method: 'POST', body: form }).then((res) => res.json())).toMatchObject({ ok: true, path: '/gcode/upload.gc' });
    const download = await fetch(`${base}/api/download?path=%2Fgcode%2Fupload.gc`);
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="upload.gc"');
    expect(await download.text()).toContain('G90');
    const renamed = await fetch(`${base}/api/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: '/gcode/upload.gc', to: '/gcode/renamed.gc' }) });
    expect(renamed.ok).toBe(true);
  });

  it('supports the Machine Identity save and restart workflow', async () => {
    const { base, env } = await start();
    expect(await fetch(`${base}/api/device`).then((res) => res.json())).toMatchObject({ hostname: 'cnc', localUrl: 'http://cnc.local' });
    const saved = await fetch(`${base}/api/device`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname: 'Low Rider 3', friendlyName: 'G-code CNC 3' }),
    });
    expect(await saved.json()).toMatchObject({
      ok: true, requiresRestart: true, sdConfigWritten: true,
      device: { hostname: 'low-rider-3', localUrl: 'http://low-rider-3.local', bleName: 'CNC low-rider-3.local' },
    });
    expect(JSON.parse(await env.sd.readText('/esp32-cnc/config.json'))).toMatchObject({ device: { hostname: 'low-rider-3' } });
    expect((await fetch(`${base}/api/system/restart`, { method: 'POST' })).status).toBe(202);
    env.runner.status.state = 'PAUSED';
    expect((await fetch(`${base}/api/device`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname: 'blocked', friendlyName: 'Blocked' }),
    })).status).toBe(409);
    expect((await fetch(`${base}/api/system/restart`, { method: 'POST' })).status).toBe(409);
  });

  it('starts an armed job and reports completion through compatible status', async () => {
    const { base, env } = await start();
    const gcodePath = '/gcode/api-job.gc';
    const jobPath = '/jobs/api-job.job.json';
    const gcode = 'G21\nG90\nG0 Z15\nG1 X10 Y10\n';
    const sizeBytes = Buffer.byteLength(gcode);
    const fingerprint = createHash('sha256').update(Buffer.from(gcode)).digest('hex');
    await env.sd.writeText(gcodePath, gcode);
    await fetch(`${base}/api/machine/home`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ axes: 'all' }),
    });
    env.marlin.execute('G0 X100 Y500 Z-20');
    const zeroFrame = await fetch(`${base}/api/work-zero/set`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then((res) => res.json());
    const startLogIndex = env.marlin.log.length;
    await env.sd.writeText(jobPath, JSON.stringify({
      gcodePath, sourceGcodePath: gcodePath, placement: { rotationDeg: 0 },
      activeRun: { mode: 'source', path: gcodePath, sizeBytes, sourceFingerprint: fingerprint },
      schemaVersion: 3, startAuthorizationToken: 'AUTHORIZED',
      activeWorkZeroId: 'zero-api',
      startAuthorization: {
        state: 'authorized', activeRunMode: 'source', activeRunPath: gcodePath,
        activeRunFingerprint: fingerprint, activeRunSizeBytes: sizeBytes, workZeroId: 'zero-api',
        homingEpoch: zeroFrame.frame.homingEpoch, homingSessionId: zeroFrame.frame.homingSessionId,
      },
      arm: { state: 'ARMED', activeRunMode: 'source', activeRunPath: gcodePath, activeRunFingerprint: fingerprint, activeRunSizeBytes: sizeBytes },
      verificationDecision: { result: 'complete', type: 'bounds', activeRunPath: gcodePath, activeRunFingerprint: fingerprint, activeRunSizeBytes: sizeBytes },
      feedOverride: { startPercent: 100, resetTo100AfterJob: true },
    }));
    const startResponse = await fetch(`${base}/api/job/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gcodePath, jobPath, activeRunMode: 'source', activeRunFingerprint: fingerprint, activeRunSizeBytes: sizeBytes,
        startMode: 'use_active_work_zero', workZeroId: 'zero-api', homingEpoch: zeroFrame.frame.homingEpoch,
        homingSessionId: zeroFrame.frame.homingSessionId,
        workZeroMachineX: zeroFrame.frame.workZeroMachine.x,
        workZeroMachineY: zeroFrame.frame.workZeroMachine.y,
        workZeroMachineZ: zeroFrame.frame.workZeroMachine.z,
      }),
    });
    expect(startResponse.ok).toBe(true);
    let status;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      status = await fetch(`${base}/api/job/status`).then((res) => res.json());
      if (status.state === 'COMPLETED') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(status).toMatchObject({ state: 'COMPLETED', gcodePath, progressPercent: 100 });
    expect(env.marlin.g92Offset).toMatchObject({ x: 100, y: 500, z: 100 });
    expect(env.marlin.log.slice(startLogIndex).map((entry) => entry.text).join('\n')).not.toMatch(/\bG92\b/);
  });

  it('sets a single work axis without changing the other work coordinates', async () => {
    const { base, env } = await start();
    await fetch(`${base}/api/machine/home`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ axes: 'all' }),
    });
    env.marlin.execute('G0 X100 Y500');
    const result = await fetch(`${base}/api/work-zero/set`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ axes: 'x' }),
    }).then((res) => res.json());

    expect(result).toMatchObject({ ok: true, axes: 'x' });
    expect(env.marlin.position.x).toBe(0);
    expect(env.marlin.position.y).toBe(500);
    expect(result.frame.workZeroMachine.x).toBe(100);
  });

  it('persists tool-change and touch-plate settings in the mock device', async () => {
    const { base, env } = await start();
    expect(await fetch(`${base}/api/tool-change/settings`).then((res) => res.json())).toMatchObject({
      settings: { handling: 'pause', zZeroMethod: 'manual', touchPlateEnabled: false },
    });
    const response = await fetch(`${base}/api/tool-change/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handling: 'park', parkMachineX: 12, parkMachineY: 34, parkMachineZ: 70,
        zZeroMethod: 'touchplate', touchPlateEnabled: true, touchPlateThickness: 12.7,
        touchPlateProbeDistance: 25, touchPlateProbeFeed: 80, touchPlateRetractDistance: 2,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      settings: { handling: 'park', zZeroMethod: 'touchplate', touchPlateThickness: 12.7 },
    });
    env.runner.status.state = 'PAUSED';
    expect((await fetch(`${base}/api/tool-change/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })).status).toBe(409);
  });

  it('supports a manual unhomed frame without inventing machine coordinates', async () => {
    const { base } = await start();
    const confirmed = await fetch(`${base}/api/machine/manual-frame`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'confirm' }),
    }).then((res) => res.json());
    expect(confirmed.frame).toMatchObject({
      frameMode: 'manual-unhomed', manualWorkFrameValid: true,
      workZeroValid: false, machine: null, workZeroMachine: null,
    });
    const zero = await fetch(`${base}/api/machine/manual-frame`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'set-zero' }),
    }).then((res) => res.json());
    expect(zero.frame).toMatchObject({ workZeroValid: true, machine: null, workZeroMachine: null });
    expect(zero.after).toMatch(/X:0\.0+ Y:0\.0+ Z:0\.0+/);
  });

  it('uploads and streams validated native-arc Aircut through one start request', async () => {
    const { base, env } = await start();
    const motionPath = '/jobs/generated/http.aircut.gc';
    const program = 'M5\nG21\nG90\nG54\nG0 Z15 F400\nG2 X10 Y0 I5 J0 F600\nM400\n';
    const form = new FormData();
    form.append('path', '/jobs/generated');
    form.append('file', new Blob([program]), 'http.aircut.gc');
    const upload = await fetch(`${base}/api/upload?overwrite=true`, { method: 'POST', body: form });
    expect(await upload.json()).toMatchObject({ ok: true, path: motionPath });

    const response = await fetch(`${base}/api/test-motion/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: motionPath, mode: 'aircut', safeZ: 15 }),
    });
    expect(response.ok).toBe(true);
    let status;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      status = await fetch(`${base}/api/job/status`).then((res) => res.json());
      if (status.state === 'COMPLETED') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(status).toMatchObject({ state: 'COMPLETED', streamMode: 'aircut', gcodePath: motionPath });
    expect(env.marlin.log.some((entry) => entry.text.startsWith('G2 '))).toBe(true);
  });

  it('supports bounded work-zero moves and mock jog without hardware', async () => {
    const { base, env } = await start();
    const blockedGoto = await fetch(`${base}/api/work-zero/goto`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ axes: 'x', safeMove: true, safeZ: 70 }),
    });
    expect(blockedGoto.status).toBe(409);
    expect(await blockedGoto.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining('active work zero'),
    });

    const home = await fetch(`${base}/api/machine/home`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ axes: 'all' }),
    });
    expect(home.ok).toBe(true);
    expect(env.marlin.execute('G53 G0 X0 Y0 Z0', { allowMachineCoordinates: true }).ok).toBe(true);
    const setZero = await fetch(`${base}/api/work-zero/set`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ axes: 'xyz' }),
    });
    expect(setZero.ok).toBe(true);
    await fetch(`${base}/api/cmd`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'G0 X20 Y30 Z10' }),
    });
    const unsafeGoto = await fetch(`${base}/api/work-zero/goto`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ axes: 'x', safeMove: true, safeZ: 130 }),
    });
    expect(unsafeGoto.status).toBe(400);
    expect(await unsafeGoto.json()).toMatchObject({ error: expect.stringContaining('work-frame lift range') });
    const goto = await fetch(`${base}/api/work-zero/goto`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ axes: 'x', safeMove: true, safeZ: 70 }),
    });
    expect(await goto.json()).toMatchObject({ ok: true, axes: 'x', safeMove: true });
    expect(env.marlin.position).toMatchObject({ x: 0, y: 30, z: 70 });

    const jogStart = await fetch(`${base}/api/jog/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ safeJog: false, xyFeedMax: 1200, zFeedMax: 300 }),
    });
    expect(await jogStart.json()).toMatchObject({
      state: 'JOGGING', commandedPositionCaptured: true,
      commandedWorkX: 0, commandedWorkY: 30, commandedWorkZ: 70,
    });
    const jogLogStart = env.marlin.log.length;
    const jogUpdate = await fetch(`${base}/api/jog/update`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 1, y: 0, z: 0, speed: 1 }),
    });
    expect(await jogUpdate.json()).toMatchObject({ state: 'JOGGING', commandedPositionCaptured: true, commandedWorkX: 3 });
    expect(env.marlin.position.x).toBeGreaterThan(0);
    expect(env.marlin.log.slice(jogLogStart).map((entry) => entry.text)).toContain('G1 X3.000 F1200');
    expect(env.marlin.log.slice(jogLogStart).map((entry) => entry.text)).not.toContain('G91');
    const jogStop = await fetch(`${base}/api/jog/stop`, { method: 'POST' });
    expect(await jogStop.json()).toMatchObject({ state: 'IDLE' });
    expect(env.marlin.spindleOff).toBe(true);
  });

  it('restores a saved XYZ origin from Home using Safe Z first', async () => {
    const { base, env } = await start();
    env.marlin.machine.zMax = 70;
    env.marlin.execute('G0 X25 Y30 Z10');
    env.marlin.execute('G92 X0 Y0 Z0');
    const logStart = env.marlin.log.length;
    const response = await fetch(`${base}/api/work-zero/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        machineX: 100, machineY: 500, machineZ: 12, safeMachineZ: 70,
        travelFeedMmMin: 3000, axes: 'xyz', moveToZ: true,
      }),
    });
    expect(response.ok).toBe(true);
    expect(env.marlin.machinePosition).toEqual({ x: 100, y: 500, z: 12 });
    expect(env.marlin.position).toEqual({ x: 0, y: 0, z: 0 });
    const commands = env.marlin.log.slice(logStart).map((entry) => entry.text);
    expect(commands.indexOf('G53 G0 Z70.000 F400')).toBeLessThan(commands.indexOf('G53 G0 X100.000 Y500.000 F3000'));
    expect(commands.indexOf('G53 G0 X100.000 Y500.000 F3000')).toBeLessThan(commands.indexOf('G53 G0 Z12.000 F400'));
    expect(commands.indexOf('G53 G0 Z12.000 F400')).toBeLessThan(commands.indexOf('G92 X0 Y0 Z0'));
  });

  it('rejects an invalid Safe Jog Z and uses a valid machine-coordinate target after G92', async () => {
    const { base, env } = await start();
    env.marlin.machine.zMax = 70;
    env.marlin.execute('G0 Z40');
    env.marlin.execute('G92 Z0');

    const response = await fetch(`${base}/api/jog/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ safeJog: true, safeLiftZ: 999 }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('outside the current machine limits') });

    const validResponse = await fetch(`${base}/api/jog/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ safeJog: true, safeLiftZ: 70 }),
    });
    const status = await validResponse.json();
    expect(validResponse.ok).toBe(true);
    expect(status).toMatchObject({
      state: 'JOGGING', safeLiftZ: 70, originalZ: 0, safeLiftWorkZ: 30, zLiftedForJog: true,
      commandedPositionCaptured: true, commandedWorkZ: 30,
    });
    expect(env.marlin.machinePosition.z).toBe(70);
    const stopped = await fetch(`${base}/api/jog/stop`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emergency: false }),
    }).then((res) => res.json());
    expect(stopped).toMatchObject({ state: 'IDLE', zRestoreAvailable: true, originalZ: 0 });
    expect(env.marlin.position.z).toBe(30);

    const restored = await fetch(`${base}/api/jog/restore-z`, { method: 'POST' }).then((res) => res.json());
    expect(restored).toMatchObject({
      state: 'IDLE', zRestoreAvailable: false, originalZ: null,
      commandedPositionCaptured: true, commandedWorkZ: 0,
    });
    expect(env.marlin.position.z).toBe(0);
  });

  it('serves machine info, applies M203, and saves with explicit M500', async () => {
    const { base, env } = await start();
    const info = await fetch(`${base}/api/machine/info`).then((res) => res.json());
    expect(info).toMatchObject({ available: true, machineType: 'DEV-MOCK', full: { xMax: 1625, yMax: 5800 } });
    const applied = await fetch(`${base}/api/machine/apply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: 'M203', x: 120, y: 80, z: 6 }),
    });
    expect(await applied.json()).toMatchObject({ ok: true, command: 'M203 X120 Y80 Z6' });
    expect(env.marlin.maxFeedrates).toEqual({ x: 120, y: 80, z: 6 });
    const saved = await fetch(`${base}/api/machine/save`, { method: 'POST' });
    expect(await saved.json()).toMatchObject({ ok: true, command: 'M500' });
    expect(env.marlin.eepromSaves).toBe(1);
  });

  it('streams prepared Production Resume Phase 2 in the mock firmware runner', async () => {
    const { base, env } = await start();
    const jobPath = '/jobs/recovery.job.json';
    const activeRunPath = '/gcode/recovery.gc';
    const streamPath = '/jobs/generated/recovery.gc.production-resume.gc';
    const eventId = 'production-resume-1';
    const runId = 'run-interrupted-1';
    const fingerprint = 'fp-recovery';
    const streamText = 'G21\nG90\nG54\nG0 Z5 F400\nG1 Z-2 F300\nG2 X10 Y10 I5 J0 F600\nM400\n';
    const streamSizeBytes = Buffer.byteLength(streamText);
    const streamFingerprint = createHash('sha256').update(Buffer.from(streamText)).digest('hex');
    await env.sd.writeText(activeRunPath, 'G21\nG90\nG1 X10 Y10 F600\n');
    await env.sd.writeText(streamPath, streamText);
    await env.sd.writeText(jobPath, JSON.stringify({
      activeRun: { mode: 'source', path: activeRunPath, sourceFingerprint: fingerprint },
      feedOverride: { startPercent: 100, resetTo100AfterJob: true },
      productionResumeAuthorization: {
        authorized: true, eventId, interruptedRunId: runId, activeRunPath,
        activeRunMode: 'source', activeRunFingerprint: fingerprint, streamPath,
        streamFingerprint, streamSizeBytes,
      },
      recoveryHistory: [{
        id: eventId, type: 'production-resume', state: 'started', runId,
        activeRunPath, activeRunMode: 'source', activeRunFingerprint: fingerprint,
        phase1CompletedAt: '2026-07-03T10:01:00.000Z',
        manualRouterConfirmedAt: '2026-07-03T10:02:00.000Z', streamPath,
      }],
    }));

    const response = await fetch(`${base}/api/recovery/production/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: streamPath, jobPath, activeRunPath, activeRunMode: 'source',
        activeRunFingerprint: fingerprint, eventId, interruptedRunId: runId,
        streamFingerprint, streamSizeBytes,
      }),
    });
    expect(response.ok).toBe(true);
    let status;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      status = await fetch(`${base}/api/job/status`).then((res) => res.json());
      if (status.state === 'COMPLETED') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(status).toMatchObject({ state: 'COMPLETED', streamMode: 'production-resume', gcodePath: streamPath });
    expect(env.marlin.log.some((entry) => entry.text.startsWith('G2 '))).toBe(true);
    expect(env.marlin.log.map((entry) => entry.text).join('\n')).not.toMatch(/\b(G28|G53|G92|M3|M4)\b/);
  });

  it('rejects traversal and exposes unknown APIs as explicit mock TODOs', async () => {
    const { base } = await start();
    const traversal = await fetch(`${base}/api/files?path=${encodeURIComponent('/gcode/../secret')}`);
    expect(traversal.status).toBe(400);
    const unsupported = await fetch(`${base}/api/not-implemented`);
    expect(unsupported.status).toBe(501);
    expect((await unsupported.json()).error).toMatch(/not implemented/i);
  });
});
