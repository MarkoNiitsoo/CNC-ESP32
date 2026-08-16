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

async function prepareAuthorizedJob(base, env, name) {
  const gcodePath = `/gcode/${name}.gc`;
  const jobPath = `/jobs/${name}.job.json`;
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
  const workZeroId = `zero-${name}`;
  await env.sd.writeText(jobPath, JSON.stringify({
    gcodePath, sourceGcodePath: gcodePath, placement: { rotationDeg: 0 },
    activeRun: { mode: 'source', path: gcodePath, sizeBytes, sourceFingerprint: fingerprint },
    schemaVersion: 3, startAuthorizationToken: 'AUTHORIZED', activeWorkZeroId: workZeroId,
    projectSafeZ: {
      version: 2, source: 'rapid', programSafeZ: 15, extraClearanceMm: 0, effectiveSafeZ: 15, resolved: true, errors: [],
    },
    startAuthorization: {
      state: 'authorized', activeRunMode: 'source', activeRunPath: gcodePath,
      activeRunFingerprint: fingerprint, activeRunSizeBytes: sizeBytes, workZeroId,
      homingEpoch: zeroFrame.frame.homingEpoch, homingSessionId: zeroFrame.frame.homingSessionId,
    },
    arm: {
      state: 'ARMED', activeRunMode: 'source', activeRunPath: gcodePath,
      activeRunFingerprint: fingerprint, activeRunSizeBytes: sizeBytes,
    },
    verificationDecision: {
      result: 'complete', type: 'bounds', activeRunPath: gcodePath,
      activeRunFingerprint: fingerprint, activeRunSizeBytes: sizeBytes,
    },
    feedOverride: { startPercent: 100, resetTo100AfterJob: true },
  }));
  return {
    gcodePath,
    jobPath,
    request: {
      gcodePath, jobPath, activeRunMode: 'source', activeRunFingerprint: fingerprint,
      activeRunSizeBytes: sizeBytes, safeStartZ: 15,
      startMode: 'use_active_work_zero', workZeroId,
      homingEpoch: zeroFrame.frame.homingEpoch, homingSessionId: zeroFrame.frame.homingSessionId,
      workZeroMachineX: zeroFrame.frame.workZeroMachine.x,
      workZeroMachineY: zeroFrame.frame.workZeroMachine.y,
      workZeroMachineZ: zeroFrame.frame.workZeroMachine.z,
    },
  };
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map(async ({ server, root }) => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }));
});

describe('mock HTTP API', () => {
  it('rejects standalone M5 for active and recovery-required jobs', async () => {
    const { base, env } = await start();
    env.runner.status.state = 'RUNNING';
    expect((await fetch(`${base}/api/cmd`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'M5' }),
    })).status).toBe(409);
    env.runner.status.state = 'RECOVERY_REQUIRED';
    expect((await fetch(`${base}/api/cmd`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'M5' }),
    })).status).toBe(409);
    env.runner.status.state = 'IDLE';
    expect((await fetch(`${base}/api/cmd`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'M5' }),
    })).ok).toBe(true);
  });

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
    const claimed = await claim.json();
    env.operator.lastSeenAt = Date.now() - 20;

    expect(await fetch(`${base}/api/operator/status`, { headers: { Cookie: cookie } }).then((res) => res.json()))
      .toMatchObject({ active: false, controller: false, readOnly: true, owner: null, controlSessionEpoch: 0 });
    expect(await fetch(`${base}/api/operator/status`).then((res) => res.json()))
      .toMatchObject({ active: false, controller: false, readOnly: true, owner: null, canClaim: true });
    expect((await fetch(`${base}/api/cmd`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ cmd: 'M5' }),
    })).status).toBe(423);

    const reconnect = await fetch(`${base}/api/operator/reconnect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserId: markoBrowserId }),
    });
    const reconnected = await reconnect.json();
    expect(reconnected).toMatchObject({ active: true, controller: true, owner: 'Marko phone' });
    expect(reconnected.controlSessionEpoch).toBeGreaterThan(claimed.controlSessionEpoch);
    const reconnectedCookie = reconnect.headers.get('set-cookie').split(';')[0];
    expect((await fetch(`${base}/api/cmd`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: reconnectedCookie },
      body: JSON.stringify({ cmd: 'M5' }),
    })).ok).toBe(true);
  });

  it('preserves one active control session across heartbeat and remembered-browser reconnect', async () => {
    const { base } = await start({ operatorLockEnabled: true });
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '741852', browserId: markoBrowserId }),
    });
    const claimed = await claim.json();
    const cookie = claim.headers.get('set-cookie').split(';')[0];

    const heartbeat = await fetch(`${base}/api/operator/heartbeat`, {
      method: 'POST', headers: { Cookie: cookie },
    }).then((res) => res.json());
    expect(heartbeat.controlSessionEpoch).toBe(claimed.controlSessionEpoch);

    const reconnect = await fetch(`${base}/api/operator/reconnect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserId: markoBrowserId }),
    }).then((res) => res.json());
    expect(reconnect).toMatchObject({
      controller: true,
      owner: 'Alice',
      controlSessionEpoch: claimed.controlSessionEpoch,
    });
  });

  it('renews the controller lease deterministically throughout a simulated long job', async () => {
    const { base, env } = await start({ operatorLockEnabled: true });
    env.operator.leaseMs = 100;
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Long job browser', pin: '123456', browserId: 'd'.repeat(64) }),
    });
    const cookie = claim.headers.get('set-cookie').split(';')[0];
    env.runner.status.state = 'RUNNING';

    for (let interval = 0; interval < 5; interval += 1) {
      const beforeRenewal = env.operator.lastSeenAt;
      env.operator.lastSeenAt -= 75;
      const heartbeat = await fetch(`${base}/api/operator/heartbeat`, {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      expect(heartbeat.status).toBe(200);
      expect(await heartbeat.json()).toMatchObject({ active: true, controller: true });
      expect(env.operator.lastSeenAt).toBeGreaterThan(beforeRenewal - 75);
    }
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

  it('keeps Job A recovery evidence available while a valid Job B starts', async () => {
    const { base, env } = await start();
    const jobB = await prepareAuthorizedJob(base, env, 'job-b');
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
    const started = await fetch(`${base}/api/job/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jobB.request),
    });
    const startedBody = await started.json();
    expect(started.ok).toBe(true);
    expect(startedBody).toMatchObject({ state: 'RUNNING', gcodePath: jobB.gcodePath });
    expect(env.recoveryCheckpoint).toMatchObject({
      available: true,
      requiresReview: true,
      checkpoint: { gcodePath: '/gcode/sample.gc' },
    });
    expect((await fetch(`${base}/api/recovery/checkpoint/acknowledge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: false }),
    })).status).toBe(400);
    for (let attempt = 0; attempt < 100 && env.runner.isActive(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
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
      projectSafeZ: {
        version: 2, source: 'rapid', programSafeZ: 15, extraClearanceMm: 0, effectiveSafeZ: 15, resolved: true, errors: [],
      },
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
        safeStartZ: 15,
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
    const jobPath = '/jobs/http-aircut.job.json';
    const program = 'M5\nG21\nG90\nG54\nG0 Z15 F400\nG2 X10 Y0 I5 J0 F600\nM400\n';
    const form = new FormData();
    form.append('path', '/jobs/generated');
    form.append('file', new Blob([program]), 'http.aircut.gc');
    const upload = await fetch(`${base}/api/upload?overwrite=true`, { method: 'POST', body: form });
    expect(await upload.json()).toMatchObject({ ok: true, path: motionPath });
    await env.sd.writeText(jobPath, JSON.stringify({
      projectSafeZ: {
        version: 2, source: 'rapid', programSafeZ: 15, extraClearanceMm: 0, effectiveSafeZ: 15, resolved: true, errors: [],
      },
    }), { overwrite: true });

    const response = await fetch(`${base}/api/test-motion/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: motionPath, mode: 'aircut', safeZ: 15, jobPath }),
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

  it('uses project Safe Z for Safe Jog and blocks an unreachable converted target', async () => {
    const { base, env } = await start();
    const jobPath = '/jobs/safe-jog.job.json';
    Object.assign(env.frame, {
      trusted: true,
      absoluteFromHome: true,
      workZeroValid: true,
      workZeroMachine: { x: 0, y: 0, z: 30 },
    });
    await env.sd.writeText(jobPath, JSON.stringify({
      projectSafeZ: {
        version: 2, source: 'rapid', programSafeZ: 29, extraClearanceMm: 0, effectiveSafeZ: 29, resolved: true, errors: [],
      },
    }));
    const started = await fetch(`${base}/api/jog/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        safeJog: true, safeWorkZ: 29, projectSafeZ: 29, safeLiftZ: 59, jobPath,
      }),
    });
    expect(started.ok).toBe(true);
    expect(env.marlin.log.some((entry) => entry.text.startsWith('G53 G0 Z59.000'))).toBe(true);
    await fetch(`${base}/api/jog/stop`, { method: 'POST' });

    await env.sd.writeText(jobPath, JSON.stringify({
      projectSafeZ: {
        version: 2, source: 'rapid', programSafeZ: 100, extraClearanceMm: 0, effectiveSafeZ: 100, resolved: true, errors: [],
      },
    }), { overwrite: true });
    const unreachable = await fetch(`${base}/api/jog/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        safeJog: true, safeWorkZ: 100, projectSafeZ: 100, safeLiftZ: 130, jobPath,
      }),
    });
    expect(unreachable.status).toBe(400);
    expect(await unreachable.json()).toMatchObject({ ok: false });
  });

  it('serves machine info, applies M203, and saves with explicit M500', async () => {
    const { base, env } = await start();
    const info = await fetch(`${base}/api/machine/info`).then((res) => res.json());
    expect(info).toMatchObject({
      available: true,
      machineType: 'DEV-MOCK',
      full: { xMax: 1625, yMax: 5800 },
      capabilities: { emergencyParser: true, realtimeHold: true },
    });
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
      projectSafeZ: {
        version: 2, source: 'rapid', programSafeZ: 15, extraClearanceMm: 0, effectiveSafeZ: 15, resolved: true, errors: [],
      },
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
        streamFingerprint, streamSizeBytes, safeZ: 15,
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

// ── Phase 3A: WebSocket command protocol ─────────────────────────────────────

/** Open a raw WebSocket to the mock server and perform the hello handshake.
 *  Returns { socket, recv } where recv() returns the next parsed message. */
async function connectWs(base) {
  // Node 21+ has a built-in global WebSocket (WHATWG API); no external dependency needed.
  const wsUrl = base.replace(/^http/, 'ws');
  const socket = new WebSocket(wsUrl);

  const queue = [];
  const waiters = [];

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
    if (waiters.length > 0) {
      waiters.shift()(msg);
    } else {
      queue.push(msg);
    }
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  const recv = () => new Promise((resolve) => {
    if (queue.length > 0) resolve(queue.shift());
    else waiters.push(resolve);
  });

  // Perform hello handshake and drain the snapshot.
  let seq = 1;
  socket.send(JSON.stringify({ protocolVersion: 1, type: 'hello', seq: seq++, ack: 0, knownBootId: null, lastStateRevision: 0, utcMs: Date.now(), timezoneOffsetMinutes: 0, timeZone: 'UTC' }));
  const snapshot = await recv();
  expect(snapshot.type).toBe('snapshot');

  const send = (obj) => { obj.seq = seq++; obj.ack = snapshot.seq; socket.send(JSON.stringify(obj)); };
  return { socket, send, recv, close: () => socket.close() };
}

describe('WS command protocol (Phase 3A)', () => {
  it('returns socketCommandToken in Claim response and not in heartbeat', async () => {
    const { base, env } = await start({ operatorLockEnabled: true });
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());
    expect(typeof claim.socketCommandToken).toBe('string');
    expect(claim.socketCommandToken.length).toBeGreaterThan(0);
    expect(claim.controlSessionEpoch).toBeGreaterThan(0);

    // Heartbeat must NOT expose the token.
    const cookie = `cnc_operator=${claim.ok ? undefined : ''}`;
    const hb = await fetch(`${base}/api/operator/heartbeat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    }).then((r) => r.json());
    expect(hb.socketCommandToken).toBeUndefined();
  });

  it('returns socketCommandToken in Reconnect response for a new session', async () => {
    const { base, env } = await start({ operatorLockEnabled: true });
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());
    // Expire the session to force a new one on reconnect.
    env.operator.lastSeenAt = Date.now() - 60000;
    const reconnect = await fetch(`${base}/api/operator/reconnect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserId: markoBrowserId }),
    }).then((r) => r.json());
    expect(typeof reconnect.socketCommandToken).toBe('string');
    expect(reconnect.socketCommandToken.length).toBeGreaterThan(0);
    expect(reconnect.controlSessionEpoch).toBeGreaterThan(claim.controlSessionEpoch);
    expect(reconnect.socketCommandToken).not.toBe(claim.socketCommandToken);
  });

  it('clears socketCommandToken on Release', async () => {
    const { base, env } = await start({ operatorLockEnabled: true });
    await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    });
    expect(env.operator.socketCommandToken.length).toBeGreaterThan(0);
    const cookie = `cnc_operator=${env.operator.token}`;
    await fetch(`${base}/api/operator/release`, {
      method: 'POST', headers: { Cookie: cookie },
    });
    expect(env.operator.socketCommandToken).toBe('');
  });

  it('rejects a WS command with missing or short commandId', async () => {
    const { base, env } = await start();
    // Set up a valid operator session.
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());

    const ws = await connectWs(base);
    ws.send({
      protocolVersion: 1, type: 'command',
      commandId: '', action: 'safety.stop',
      authorization: { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken },
    });
    const ack = await ws.recv();
    expect(ack.type).toBe('commandAck');
    expect(ack.accepted).toBe(false);
    expect(ack.code).toBe('INVALID_COMMAND');
    ws.close();
  });

  it('rejects a WS command with wrong token', async () => {
    const { base } = await start();
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());

    const ws = await connectWs(base);
    ws.send({
      protocolVersion: 1, type: 'command',
      commandId: 'cmd-wrong-token', action: 'safety.stop',
      authorization: { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: 'wrong-token' },
    });
    const ack = await ws.recv();
    expect(ack.type).toBe('commandAck');
    expect(ack.accepted).toBe(false);
    expect(ack.code).toBe('UNAUTHORIZED');
    ws.close();
  });

  it('rejects a WS command with wrong epoch', async () => {
    const { base } = await start();
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());

    const ws = await connectWs(base);
    ws.send({
      protocolVersion: 1, type: 'command',
      commandId: 'cmd-wrong-epoch', action: 'safety.stop',
      authorization: { controlSessionEpoch: 9999, socketCommandToken: claim.socketCommandToken },
    });
    const ack = await ws.recv();
    expect(ack.type).toBe('commandAck');
    expect(ack.accepted).toBe(false);
    expect(ack.code).toBe('UNAUTHORIZED');
    ws.close();
  });

  it('accepts safety.stop on an active job and returns commandResult', async () => {
    const { base, env } = await start();
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());
    env.runner.status.state = 'RUNNING';

    const ws = await connectWs(base);
    ws.send({
      protocolVersion: 1, type: 'command',
      commandId: 'cmd-stop-1', action: 'safety.stop',
      authorization: { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken },
    });
    const ack = await ws.recv();
    expect(ack.type).toBe('commandAck');
    expect(ack.commandId).toBe('cmd-stop-1');
    expect(ack.accepted).toBe(true);

    const result = await ws.recv();
    expect(result.type).toBe('commandResult');
    expect(result.commandId).toBe('cmd-stop-1');
    expect(result.ok).toBe(true);
    expect(result.code).toBe('OK');
    ws.close();
  });

  it('returns JOB_STATE_CONFLICT for safety.stop when job is idle', async () => {
    const { base, env } = await start();
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());
    env.runner.status.state = 'IDLE';

    const ws = await connectWs(base);
    ws.send({
      protocolVersion: 1, type: 'command',
      commandId: 'cmd-stop-idle', action: 'safety.stop',
      authorization: { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken },
    });
    await ws.recv(); // commandAck
    const result = await ws.recv();
    expect(result.type).toBe('commandResult');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('JOB_STATE_CONFLICT');
    ws.close();
  });

  it('returns INVALID_COMMAND for an unknown action', async () => {
    const { base } = await start();
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());

    const ws = await connectWs(base);
    ws.send({
      protocolVersion: 1, type: 'command',
      commandId: 'cmd-unknown', action: 'robot.dance',
      authorization: { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken },
    });
    await ws.recv(); // commandAck
    const result = await ws.recv();
    expect(result.type).toBe('commandResult');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID_COMMAND');
    ws.close();
  });

  it('handles commandQuery for a completed command (idempotency)', async () => {
    const { base, env } = await start();
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());
    env.runner.status.state = 'RUNNING';

    const ws = await connectWs(base);
    ws.send({
      protocolVersion: 1, type: 'command',
      commandId: 'cmd-idempotent-1', action: 'safety.stop',
      authorization: { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken },
    });
    await ws.recv(); // ack
    await ws.recv(); // result
    await expect(ws.recv()).resolves.toMatchObject({ type: 'patch', patch: { job: { state: 'STOPPING' } } });

    // Send the same commandId again — expect cached result.
    ws.send({
      protocolVersion: 1, type: 'command',
      commandId: 'cmd-idempotent-1', action: 'safety.stop',
      authorization: { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken },
    });
    const cached = await ws.recv();
    expect(cached.type).toBe('commandResult');
    expect(cached.commandId).toBe('cmd-idempotent-1');
    expect(cached.ok).toBe(true);

    // Also test commandQuery directly.
    ws.send({ protocolVersion: 1, type: 'commandQuery', commandId: 'cmd-idempotent-1',
      authorization: { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken } });
    const queried = await ws.recv();
    expect(queried.type).toBe('commandResult');
    expect(queried.commandId).toBe('cmd-idempotent-1');
    expect(queried.ok).toBe(true);
    ws.close();
  });

  it('commandQuery returns INVALID_COMMAND for an unknown commandId', async () => {
    const { base } = await start();
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());
    const ws = await connectWs(base);
    ws.send({ protocolVersion: 1, type: 'commandQuery', commandId: 'never-sent',
      authorization: { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken } });
    const resp = await ws.recv();
    expect(resp.type).toBe('commandAck');
    expect(resp.accepted).toBe(false);
    expect(resp.code).toBe('INVALID_COMMAND');
    ws.close();
  });

  it('uses complete unsequenced responses and naturally sequences authoritative job patches', async () => {
    const { base, env, listClientProtocolStates } = await start();
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());
    env.runner.status.state = 'RUNNING';
    const ws = await connectWs(base);
    const auth = { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken };
    const commands = [
      { commandId: 'cmd-pause-patch', action: 'job.pause', state: 'PAUSED_INTACT' },
      { commandId: 'cmd-resume-patch', action: 'job.resume', state: 'RUNNING' },
      { commandId: 'cmd-feed-patch', action: 'job.setFeedOverride', payload: { percent: 125 }, state: 'RUNNING', feedOverridePercent: 125 },
      { commandId: 'cmd-stop-patch', action: 'safety.stop', state: 'STOPPING' },
    ];
    let expectedPatchSeq = listClientProtocolStates()[0].nextServerSeq;
    for (const command of commands) {
      ws.send({ protocolVersion: 1, type: 'command', commandId: command.commandId,
        action: command.action, payload: command.payload, authorization: auth });
      const ack = await ws.recv();
      const result = await ws.recv();
      for (const response of [ack, result]) {
        expect(Object.keys(response).sort()).toEqual(['accepted', 'code', 'commandId', 'inProgress', 'message', 'ok', 'protocolVersion', 'type'].sort());
        expect(response.protocolVersion).toBe(1);
        expect(response.seq).toBeUndefined();
        expect(response.stateRevision).toBeUndefined();
      }
      const patch = await ws.recv();
      expect(patch).toMatchObject({ type: 'patch', seq: expectedPatchSeq,
        patch: { job: { state: command.state } } });
      if (command.feedOverridePercent) {
        expect(patch.patch.job.feedOverridePercent).toBe(command.feedOverridePercent);
      }
      expectedPatchSeq += 1;
    }
    ws.close();
  });

  it('uses insertion-order payload identity for exact retries and reordered-key conflicts', async () => {
    const { base, env } = await start();
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());
    env.runner.status.state = 'RUNNING';
    const auth = { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken };
    const ws = await connectWs(base);
    ws.send({ protocolVersion: 1, type: 'command', commandId: 'cmd-conflict', action: 'job.setFeedOverride',
      payload: { percent: 110, source: 'dial' }, authorization: auth });
    await ws.recv();
    await ws.recv();
    await ws.recv(); // authoritative job patch
    ws.send({ protocolVersion: 1, type: 'command', commandId: 'cmd-conflict', action: 'job.setFeedOverride',
      payload: { percent: 110, source: 'dial' }, authorization: auth });
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandResult', commandId: 'cmd-conflict', ok: true });
    ws.send({ protocolVersion: 1, type: 'command', commandId: 'cmd-conflict', action: 'job.setFeedOverride',
      payload: { source: 'dial', percent: 110 }, authorization: auth });
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandAck', accepted: false, code: 'IDEMPOTENCY_CONFLICT' });
    ws.close();
  });

  it('discards deferred commands when Release clears the command session', async () => {
    const { base, env, flushDeferredWsCommands } = await start({ deferWsCommandExecution: true });
    const claimResponse = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    });
    const cookie = claimResponse.headers.get('set-cookie').split(';')[0];
    const claim = await claimResponse.json();
    env.runner.status.state = 'RUNNING';
    const ws = await connectWs(base);
    ws.send({ protocolVersion: 1, type: 'command', commandId: 'cmd-release-stale', action: 'job.pause',
      authorization: { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken } });
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandAck', accepted: true });
    await fetch(`${base}/api/operator/release`, { method: 'POST', headers: { Cookie: cookie } });
    flushDeferredWsCommands();
    expect(env.runner.status.state).toBe('RUNNING');
    ws.close();
  });

  it('discards deferred commands when inactive Reconnect creates a new epoch', async () => {
    const { base, env, flushDeferredWsCommands } = await start({ deferWsCommandExecution: true });
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());
    env.runner.status.state = 'RUNNING';
    const ws = await connectWs(base);
    ws.send({ protocolVersion: 1, type: 'command', commandId: 'cmd-epoch-stale', action: 'job.pause',
      authorization: { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken } });
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandAck', accepted: true });
    env.operator.lastSeenAt = Date.now() - 60000;
    const reconnect = await fetch(`${base}/api/operator/reconnect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserId: markoBrowserId }),
    }).then((r) => r.json());
    flushDeferredWsCommands();
    expect(env.runner.status.state).toBe('RUNNING');
    ws.send({ protocolVersion: 1, type: 'commandQuery', commandId: 'cmd-epoch-stale',
      authorization: { controlSessionEpoch: reconnect.controlSessionEpoch, socketCommandToken: reconnect.socketCommandToken } });
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandAck', accepted: false, code: 'INVALID_COMMAND' });
    ws.close();
  });

  it('discards deferred commands when a new Claim creates a new epoch', async () => {
    const { base, env, flushDeferredWsCommands } = await start({ deferWsCommandExecution: true });
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());
    env.runner.status.state = 'RUNNING';
    const ws = await connectWs(base);
    ws.send({ protocolVersion: 1, type: 'command', commandId: 'cmd-claim-stale', action: 'job.pause',
      authorization: { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken } });
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandAck', accepted: true });
    env.operator.lastSeenAt = Date.now() - 60000;
    const nextClaim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Bob', pin: '111222', browserId: workshopBrowserId }),
    }).then((r) => r.json());
    flushDeferredWsCommands();
    expect(env.runner.status.state).toBe('RUNNING');
    ws.send({ protocolVersion: 1, type: 'commandQuery', commandId: 'cmd-claim-stale',
      authorization: { controlSessionEpoch: nextClaim.controlSessionEpoch, socketCommandToken: nextClaim.socketCommandToken } });
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandAck', accepted: false, code: 'INVALID_COMMAND' });
    ws.close();
  });

  it('revalidates an active session immediately before deferred execution', async () => {
    const { base, env, flushDeferredWsCommands } = await start({ deferWsCommandExecution: true });
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());
    env.runner.status.state = 'RUNNING';
    const ws = await connectWs(base);
    ws.send({ protocolVersion: 1, type: 'command', commandId: 'cmd-expired-stale', action: 'job.pause',
      authorization: { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken } });
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandAck', accepted: true });
    env.operator.lastSeenAt = Date.now() - 60000;
    flushDeferredWsCommands();
    expect(env.runner.status.state).toBe('RUNNING');
    ws.close();
  });

  it('recovers a completed result on a new socket but never across a new control epoch', async () => {
    const { base, env } = await start();
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());
    env.runner.status.state = 'RUNNING';
    const auth = { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken };
    const first = await connectWs(base);
    first.send({ protocolVersion: 1, type: 'command', commandId: 'cmd-cross-socket', action: 'job.pause', authorization: auth });
    await first.recv();
    await first.recv();
    first.close();
    const second = await connectWs(base);
    second.send({ protocolVersion: 1, type: 'commandQuery', commandId: 'cmd-cross-socket', authorization: auth });
    await expect(second.recv()).resolves.toMatchObject({ type: 'commandResult', commandId: 'cmd-cross-socket', ok: true });

    env.operator.lastSeenAt = Date.now() - 60000;
    const next = await fetch(`${base}/api/operator/reconnect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserId: markoBrowserId }),
    }).then((r) => r.json());
    second.send({ protocolVersion: 1, type: 'commandQuery', commandId: 'cmd-cross-socket',
      authorization: { controlSessionEpoch: next.controlSessionEpoch, socketCommandToken: next.socketCommandToken } });
    await expect(second.recv()).resolves.toMatchObject({ type: 'commandAck', accepted: false, code: 'INVALID_COMMAND' });
    second.close();
  });

  it('keeps escaped error text valid JSON and queryable after an outbound result write failure', async () => {
    const { base, simulateNextOutboundWriteFailure } = await start();
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());
    const auth = { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken };
    const ws = await connectWs(base);
    simulateNextOutboundWriteFailure(0);
    ws.send({ protocolVersion: 1, type: 'command', commandId: 'cmd-escaped', action: 'unknown.action', authorization: auth });
    const result = await ws.recv();
    expect(result.type).toBe('commandResult');
    expect(result.message).toContain('unknown.action');
    ws.send({ protocolVersion: 1, type: 'commandQuery', commandId: 'cmd-escaped', authorization: auth });
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandResult', code: 'INVALID_COMMAND' });
    ws.close();
  });

  it('rolls back queue-full registration and preserves completed ledger state after disconnect', async () => {
    const { base, flushDeferredWsCommands } = await start({ deferWsCommandExecution: true });
    const claim = await fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());
    const auth = { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken };
    const first = await connectWs(base);
    for (let index = 0; index < 8; index++) {
      first.send({ protocolVersion: 1, type: 'command', commandId: `cmd-queued-${index}`,
        action: 'unknown.action', authorization: auth });
      await expect(first.recv()).resolves.toMatchObject({ accepted: true, code: 'ACCEPTED' });
    }
    first.send({ protocolVersion: 1, type: 'command', commandId: 'cmd-queue-full',
      action: 'unknown.action', authorization: auth });
    await expect(first.recv()).resolves.toMatchObject({ accepted: false, code: 'QUEUE_FULL' });
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    flushDeferredWsCommands();

    const second = await connectWs(base);
    second.send({ protocolVersion: 1, type: 'commandQuery', commandId: 'cmd-queued-0', authorization: auth });
    await expect(second.recv()).resolves.toMatchObject({ type: 'commandResult', code: 'INVALID_COMMAND' });
    second.send({ protocolVersion: 1, type: 'commandQuery', commandId: 'cmd-queue-full', authorization: auth });
    await expect(second.recv()).resolves.toMatchObject({ type: 'commandAck', accepted: false, code: 'INVALID_COMMAND' });
    second.close();
  });
});

describe('WS machine commands (Phase 3C)', () => {
  async function claimController(base) {
    return fetch(`${base}/api/operator/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'Alice', pin: '111222', browserId: markoBrowserId }),
    }).then((r) => r.json());
  }

  function machineCommand(ws, claim, commandId, action, payload = {}) {
    ws.send({
      protocolVersion: 1, type: 'command', commandId, action, payload,
      authorization: { controlSessionEpoch: claim.controlSessionEpoch, socketCommandToken: claim.socketCommandToken },
    });
  }

  it('homes all axes over WS and establishes a trusted frame', async () => {
    const { base, env } = await start();
    const claim = await claimController(base);
    expect(env.frame.trusted).toBe(false);

    const ws = await connectWs(base);
    machineCommand(ws, claim, 'cmd-home-all-1', 'machine.home', { axes: 'all' });
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandAck', accepted: true, commandId: 'cmd-home-all-1' });
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandResult', ok: true, code: 'OK', commandId: 'cmd-home-all-1' });

    expect(env.frame.trusted).toBe(true);
    expect(env.frame.homedAxes).toMatchObject({ x: true, y: true, z: true });
    expect(Number(env.frame.homingEpoch)).toBeGreaterThan(0);
    expect(env.frame.workZeroValid).toBe(true);
    // Exactly one G28 reached the controller for one accepted command.
    const g28Count = env.marlin.log.filter(
      (entry) => entry.direction === 'tx' && /^G28(\s|$)/i.test(String(entry.text || '').trim())).length;
    expect(g28Count).toBe(1);
    ws.close();
  });

  it('rejects machine.home with invalid axes payload', async () => {
    const { base } = await start();
    const claim = await claimController(base);

    const ws = await connectWs(base);
    machineCommand(ws, claim, 'cmd-home-bad-axes', 'machine.home', { axes: 'q' });
    await ws.recv(); // commandAck
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandResult', ok: false, code: 'INVALID_PAYLOAD' });
    ws.close();
  });

  it('rejects machine.home with MACHINE_STATE_CONFLICT while a job is active', async () => {
    const { base, env } = await start();
    const claim = await claimController(base);
    env.runner.status.state = 'RUNNING';

    const ws = await connectWs(base);
    machineCommand(ws, claim, 'cmd-home-active-job', 'machine.home', { axes: 'all' });
    await ws.recv(); // commandAck
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandResult', ok: false, code: 'MACHINE_STATE_CONFLICT' });
    expect(env.frame.trusted).toBe(false);
    ws.close();
  });

  it('sets work zero over WS after homing and captures work-zero machine coordinates', async () => {
    const { base, env } = await start();
    const claim = await claimController(base);

    const ws = await connectWs(base);
    machineCommand(ws, claim, 'cmd-zero-1', 'machine.home', { axes: 'all' });
    await ws.recv(); // commandAck
    await ws.recv(); // commandResult

    env.marlin.execute('G0 X25 Y40 Z5');
    machineCommand(ws, claim, 'cmd-zero-2', 'machine.setWorkZero', { axes: 'xyz' });
    await ws.recv(); // commandAck
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandResult', ok: true, code: 'OK' });

    expect(env.frame.workZeroValid).toBe(true);
    expect(env.frame.workZeroMachine).toBeDefined();
    ws.close();
  });

  it('rejects machine.setWorkZero with invalid axes instead of silently zeroing XYZ', async () => {
    const { base, env } = await start();
    const claim = await claimController(base);

    const ws = await connectWs(base);
    machineCommand(ws, claim, 'cmd-zero-bad-axes-1', 'machine.home', { axes: 'all' });
    await ws.recv(); // commandAck
    await ws.recv(); // commandResult

    machineCommand(ws, claim, 'cmd-zero-bad-axes-2', 'machine.setWorkZero', { axes: 'z' });
    await ws.recv(); // commandAck
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandResult', ok: false, code: 'INVALID_PAYLOAD' });
    ws.close();
  });

  it('rejects machine.setZZero without a trusted work frame', async () => {
    const { base, env } = await start();
    const claim = await claimController(base);

    const ws = await connectWs(base);
    machineCommand(ws, claim, 'cmd-zzero-no-frame', 'machine.setZZero');
    await ws.recv(); // commandAck
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandResult', ok: false, code: 'MACHINE_STATE_CONFLICT' });
    ws.close();
  });

  it('marks the M6 tool-change Z zero when machine.setZZero runs in the tool-change window', async () => {
    const { base, env } = await start();
    const claim = await claimController(base);

    const ws = await connectWs(base);
    machineCommand(ws, claim, 'cmd-tc-1', 'machine.home', { axes: 'all' });
    await ws.recv(); // commandAck
    await ws.recv(); // commandResult
    machineCommand(ws, claim, 'cmd-tc-2', 'machine.setWorkZero', { axes: 'xyz' });
    await ws.recv(); // commandAck
    await ws.recv(); // commandResult

    env.runner.status.state = 'PAUSED';
    env.runner.status.toolChangePending = true;
    env.runner.status.toolChangeReady = true;
    machineCommand(ws, claim, 'cmd-tc-3', 'machine.setZZero');
    await ws.recv(); // commandAck
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandResult', ok: true, code: 'OK' });
    expect(env.runner.status.toolChangeZZeroCompleted).toBe(true);
    ws.close();
  });

  it('deduplicates machine.home by commandId and replays the completed result', async () => {
    const { base, env } = await start();
    const claim = await claimController(base);

    const ws = await connectWs(base);
    machineCommand(ws, claim, 'cmd-home-dedupe', 'machine.home', { axes: 'all' });
    await ws.recv(); // commandAck
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandResult', ok: true });

    machineCommand(ws, claim, 'cmd-home-dedupe', 'machine.home', { axes: 'all' });
    await expect(ws.recv()).resolves.toMatchObject({ type: 'commandResult', ok: true, commandId: 'cmd-home-dedupe' });
    expect(env.frame.trusted).toBe(true);
    ws.close();
  });

  it('keeps the HTTP work-zero contract: optional body, XYZ default, full envelope', async () => {
    const { base } = await start();
    await fetch(`${base}/api/machine/home`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ axes: 'all' }),
    });

    const post = async (body) => fetch(`${base}/api/work-zero/set`, {
      method: 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((res) => res.json().then((data) => ({ status: res.status, data })));

    const emptyBody = await post(undefined);
    expect(emptyBody.status).toBe(200);
    expect(emptyBody.data.ok).toBe(true);
    expect(emptyBody.data.axes).toBe('xyz');
    expect(typeof emptyBody.data.before).toBe('string');
    expect(typeof emptyBody.data.after).toBe('string');
    expect(emptyBody.data.frame).toBeDefined();
    expect(emptyBody.data.frame.workZeroValid).toBe(true);

    const xOnly = await post({ axes: 'x' });
    expect(xOnly.status).toBe(200);
    expect(xOnly.data.axes).toBe('x');

    const invalid = await post({ axes: 'z' });
    expect(invalid.status).toBe(400);
    expect(invalid.data.ok).toBe(false);
    expect(invalid.data.error).toContain('axes must be x, y, or xyz');
  });

  it('keeps the HTTP Z-zero contract: {ok, before, after, frame} envelope', async () => {
    const { base } = await start();
    await fetch(`${base}/api/machine/home`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ axes: 'all' }),
    });

    const res = await fetch(`${base}/api/work-zero/set-z`, { method: 'POST' });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(typeof data.before).toBe('string');
    expect(typeof data.after).toBe('string');
    expect(data.frame).toBeDefined();
    expect(data.frame.workZeroValid).toBe(true);
  });
});
