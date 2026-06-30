import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockServer } from '../../dev/mock-server.mjs';

const instances = [];
async function start() {
  const root = await mkdtemp(path.join(tmpdir(), 'cnc-mock-http-'));
  const instance = await createMockServer({ mockRoot: root, config: { lineDelayMs: 1 } });
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
  it('serves UI, health, command, list, upload, download, and rename APIs', async () => {
    const { base } = await start();
    expect(await fetch(`${base}/`).then((res) => res.text())).toContain('LowRider CNC');
    expect(await fetch(`${base}/api/health`).then((res) => res.json())).toMatchObject({ mockMode: true, wifiMode: 'mock' });
    expect(await fetch(`${base}/api/cmd`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'M115' }) }).then((res) => res.json())).toMatchObject({ ok: true });
    expect((await fetch(`${base}/api/files?path=%2Fgcode`).then((res) => res.json())).items.length).toBeGreaterThan(3);

    const form = new FormData();
    form.append('path', '/gcode');
    form.append('file', new Blob(['G21\nG90\n']), 'upload.gc');
    expect(await fetch(`${base}/api/upload`, { method: 'POST', body: form }).then((res) => res.json())).toMatchObject({ ok: true, path: '/gcode/upload.gc' });
    expect(await fetch(`${base}/api/download?path=%2Fgcode%2Fupload.gc`).then((res) => res.text())).toContain('G90');
    const renamed = await fetch(`${base}/api/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: '/gcode/upload.gc', to: '/gcode/renamed.gc' }) });
    expect(renamed.ok).toBe(true);
  });

  it('starts an armed job and reports completion through compatible status', async () => {
    const { base, env } = await start();
    const gcodePath = '/gcode/api-job.gc';
    const jobPath = '/jobs/api-job.job.json';
    const fingerprint = 'api-test';
    await env.sd.writeText(gcodePath, 'G21\nG90\nG0 Z15\nG1 X10 Y10\n');
    await env.sd.writeText(jobPath, JSON.stringify({
      gcodePath, sourceGcodePath: gcodePath, placement: { rotationDeg: 0 },
      activeRun: { mode: 'source', path: gcodePath, sourceFingerprint: fingerprint },
      arm: { state: 'ARMED', activeRunMode: 'source', activeRunPath: gcodePath, activeRunFingerprint: fingerprint },
      feedOverride: { startPercent: 100, resetTo100AfterJob: true },
    }));
    const startResponse = await fetch(`${base}/api/job/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gcodePath, jobPath, activeRunMode: 'source', activeRunFingerprint: fingerprint }),
    });
    expect(startResponse.ok).toBe(true);
    let status;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      status = await fetch(`${base}/api/job/status`).then((res) => res.json());
      if (status.state === 'COMPLETED') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(status).toMatchObject({ state: 'COMPLETED', gcodePath, progressPercent: 100 });
  });

  it('supports bounded work-zero moves and mock jog without hardware', async () => {
    const { base, env } = await start();
    await fetch(`${base}/api/cmd`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'G0 X20 Y30 Z10' }),
    });
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
    expect(await jogStart.json()).toMatchObject({ state: 'JOGGING' });
    const jogUpdate = await fetch(`${base}/api/jog/update`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 1, y: 0, z: 0, speed: 1 }),
    });
    expect(await jogUpdate.json()).toMatchObject({ state: 'JOGGING' });
    expect(env.marlin.position.x).toBeGreaterThan(0);
    const jogStop = await fetch(`${base}/api/jog/stop`, { method: 'POST' });
    expect(await jogStop.json()).toMatchObject({ state: 'IDLE' });
    expect(env.marlin.spindleOff).toBe(true);
  });

  it('clamps Safe Jog to machine Z max in native coordinates after G92', async () => {
    const { base, env } = await start();
    env.marlin.machine.zMax = 70;
    env.marlin.execute('G0 Z40');
    env.marlin.execute('G92 Z0');

    const response = await fetch(`${base}/api/jog/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ safeJog: true, safeLiftZ: 999, restoreZAfterJog: true }),
    });
    const status = await response.json();

    expect(response.ok).toBe(true);
    expect(status).toMatchObject({ state: 'JOGGING', safeLiftZ: 70, safeLiftWorkZ: 30, zLiftedForJog: true });
    expect(env.marlin.machinePosition.z).toBe(70);
    await fetch(`${base}/api/jog/stop`, { method: 'POST' });
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
