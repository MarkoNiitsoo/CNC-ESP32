import { mkdtemp, rm } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockServer } from '../../dev/mock-server.mjs';

const instances = [];

async function startServer(config = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cnc-mock-comm-http-'));
  const instance = await createMockServer({
    mockRoot: root,
    config: { lineDelayMs: 1, operatorLockEnabled: false, ...config },
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

describe('Controller Communication Correctness Fixes', () => {
  it('1. POST /api/cmd with M400 timeout returns non-2xx and ok:false', async () => {
    const { base, env } = await startServer({ simulateTimeout: true });
    const res = await fetch(`${base}/api/cmd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'M400' }),
    });
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.controllerState).toBe('unresponsive');
  });

  it('2. Response includes failedCommand:"M400"', async () => {
    const { base } = await startServer({ simulateTimeout: true });
    const res = await fetch(`${base}/api/cmd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'M400' }),
    });
    const data = await res.json();
    expect(data.failedCommand).toBe('M400');
  });

  it('3. Browser capture sends M400 but never M114 after that response', async () => {
    const { base, env } = await startServer({ simulateTimeout: true });

    const res = await fetch(`${base}/api/cmd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'M400' }),
    });
    expect(res.status).toBe(503);

    const txLogs = env.marlin.log.filter((e) => e.direction === 'tx').map((e) => e.text);
    expect(txLogs).toContain('M400');
    expect(txLogs).not.toContain('M114');
  });

  it('4. POST /api/machine/home is rejected without UART TX while unresponsive', async () => {
    const { base, env } = await startServer();
    env.runner.controllerState = 'unresponsive';
    const initialTx = env.marlin.log.filter((e) => e.direction === 'tx').length;

    const res = await fetch(`${base}/api/machine/home`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ axes: 'all' }),
    });
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.ok).toBe(false);
    const newTx = env.marlin.log.filter((e) => e.direction === 'tx').length;
    expect(newTx).toBe(initialTx);
  });

  it('5. POST /api/jog/start is rejected without UART TX', async () => {
    const { base, env } = await startServer();
    env.runner.controllerState = 'unresponsive';
    const initialTx = env.marlin.log.filter((e) => e.direction === 'tx').length;

    const res = await fetch(`${base}/api/jog/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ safeJog: false, xyFeedMax: 1200, zFeedMax: 300 }),
    });
    expect(res.status).toBe(503);
    const newTx = env.marlin.log.filter((e) => e.direction === 'tx').length;
    expect(newTx).toBe(initialTx);
  });

  it('6. POST /api/jog/update is rejected without state mutation', async () => {
    const { base, env } = await startServer();
    env.runner.controllerState = 'unresponsive';

    const res = await fetch(`${base}/api/jog/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 1, y: 0, z: 0, speed: 1 }),
    });
    expect(res.status).toBe(503);
    expect(env.runner.status.state).toBe('IDLE');
  });

  it('7. POST /api/recovery/production/start is rejected', async () => {
    const { base, env } = await startServer();
    env.runner.controllerState = 'unresponsive';

    const res = await fetch(`${base}/api/recovery/production/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/jobs/generated/test.production-resume.gc' }),
    });
    expect(res.status).toBe(503);
  });

  it('8. Work Zero endpoints are rejected', async () => {
    const { base, env } = await startServer();
    env.runner.controllerState = 'unresponsive';

    const setRes = await fetch(`${base}/api/work-zero/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ axes: 'xyz' }),
    });
    expect(setRes.status).toBe(503);

    const gotoRes = await fetch(`${base}/api/work-zero/goto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ axes: 'x', safeMove: true, safeZ: 70 }),
    });
    expect(gotoRes.status).toBe(503);
  });

  it('9. POST /api/job/feed-override creates no priority command', async () => {
    const { base, env } = await startServer();
    env.runner.controllerState = 'unresponsive';

    const res = await fetch(`${base}/api/job/feed-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ percent: 120 }),
    });
    expect(res.status).toBe(503);
    const priorityLogs = env.marlin.log.filter((e) => e.priority);
    expect(priorityLogs.length).toBe(0);
  });

  it('10. Ordinary direct UART dispatch is rejected while Waiting', async () => {
    const { base, env } = await startServer();
    env.runner.controllerState = 'waiting';

    const res = await fetch(`${base}/api/cmd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'G0 X10' }),
    });
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toContain('processing a synchronous command');
  });

  it('11. M410 then M5 remain available as SafetyStop commands', async () => {
    const { base, env } = await startServer();
    env.runner.status.state = 'RUNNING';
    env.runner.controllerState = 'unresponsive';

    const stopRes = await fetch(`${base}/api/job/stop`, { method: 'POST' });
    expect(stopRes.ok).toBe(true);
    expect(['STOPPING', 'STOPPED']).toContain(env.runner.status.state);
  });

  it('12. Recovery publishes Recovering during both M115 and M114', async () => {
    const { base, env } = await startServer();
    env.runner.controllerState = 'unresponsive';

    const statesDuringRecovery = [];
    const origExecute = env.marlin.execute.bind(env.marlin);
    env.marlin.execute = (cmd, opts) => {
      statesDuringRecovery.push({ cmd, state: env.runner.controllerState });
      return origExecute(cmd, opts);
    };

    await env.runner.recoverController();
    expect(statesDuringRecovery).toEqual([
      { cmd: 'M115', state: 'recovering' },
      { cmd: 'M114', state: 'recovering' },
    ]);
    expect(env.runner.controllerState).toBe('connected');
  });

  it('13. Recovery never publishes Connected between M115 and M114', async () => {
    const { base, env } = await startServer();
    env.runner.controllerState = 'unresponsive';

    let stateBetweenProbes = null;
    const origExecute = env.marlin.execute.bind(env.marlin);
    env.marlin.execute = (cmd, opts) => {
      if (cmd === 'M114') {
        stateBetweenProbes = env.runner.controllerState;
      }
      return origExecute(cmd, opts);
    };

    await env.runner.recoverController();
    expect(stateBetweenProbes).toBe('recovering');
  });

  it('14. Failed M114 recovery returns to Unresponsive', async () => {
    const { base, env } = await startServer();
    env.runner.controllerState = 'unresponsive';
    env.marlin.failCommands.add('M114');

    const res = await fetch(`${base}/api/controller/recover`, { method: 'POST' });
    expect(res.status).toBe(503);
    expect(env.runner.controllerState).toBe('unresponsive');
  });

  it('15. Successful M114 recovery publishes Connected', async () => {
    const { base, env } = await startServer();
    env.runner.controllerState = 'unresponsive';

    const res = await fetch(`${base}/api/controller/recover`, { method: 'POST' });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.controllerState).toBe('connected');
    expect(env.runner.controllerState).toBe('connected');
  });

  it('16. Reset invalidates the complete machine/work frame', async () => {
    const { base, env } = await startServer({ controllerResetDetected: true });
    env.frame.trusted = true;
    env.frame.absoluteFromHome = true;
    env.frame.machineValid = true;
    env.frame.manualWorkFrameValid = true;
    env.frame.workZeroValid = true;

    env.runner.controllerState = 'unresponsive';
    const res = await fetch(`${base}/api/controller/recover`, { method: 'POST' });
    expect(res.ok).toBe(true);
    expect(env.frame.machineValid).toBe(false);
    expect(env.frame.absoluteFromHome).toBe(false);
    expect(env.frame.manualWorkFrameValid).toBe(false);
    expect(env.frame.workZeroValid).toBe(false);
  });

  it('17. Both index and preview pages expose a working recovery control in machine-bar.js', async () => {
    const indexHtml = await readFile(new URL('../../www/index.html', import.meta.url), 'utf8');
    expect(indexHtml).toContain('id="btn-retry-controller-conn"');
    expect(indexHtml).toContain('id="controller-comm-status"');
    expect(indexHtml).toContain('id="controller-comm-message"');

    const previewHtml = await readFile(new URL('../../www/preview.html', import.meta.url), 'utf8');
    expect(previewHtml).toContain('id="btn-retry-controller-conn"');
    expect(previewHtml).toContain('id="controller-comm-status"');
    expect(previewHtml).toContain('id="controller-comm-message"');

    const machineBarJs = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
    expect(machineBarJs).toContain('btn-retry-controller-conn');
    expect(machineBarJs).toContain('recoverControllerConnection');
    expect(machineBarJs).toContain('renderControllerStatus');
  });

  it('18. The browser does not promote Connected from an unrelated HTTP 200 response', async () => {
    const previewJs = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
    expect(previewJs).not.toMatch(/controllerCommState\s*=\s*['"]connected['"]/);
  });

  it('19. Marlin Error/Alarm/!! returns ok:false without marking contact unresponsive', async () => {
    const { base, env } = await startServer();
    env.marlin.failCommands.add('G0 X99999');

    const res = await fetch(`${base}/api/cmd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'G0 X99999' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.controllerState).toBe('connected');
    expect(env.runner.controllerState).toBe('connected');
  });

  it('20. Existing G0-first bounds validation remains passing', async () => {
    const { base, env } = await startServer();
    await env.sd.writeText('/jobs/test.json', JSON.stringify({ projectSafeZ: { version: 2, programSafeZ: 15, extraClearanceMm: 0, effectiveSafeZ: 15, resolved: true } }), { overwrite: true });
    await env.sd.writeText('/jobs/generated/invalid.bounds.gc', 'M5\nG21\nG90\nG54\nG1 Z15 F400\nG0 X10 Y10 F1500\nG0 X0 Y0 F1500\nM400\nG0 Z0 F400\nM400\n', { overwrite: true });
    await env.sd.writeText('/jobs/generated/valid.bounds.gc', 'M5\nG21\nG90\nG54\nG0 Z15 F400\nG0 X10 Y10 F1500\nG0 X0 Y0 F1500\nM400\nG0 Z0 F400\nM400\n', { overwrite: true });

    await expect(env.runner.startTestMotion({
      path: '/jobs/generated/invalid.bounds.gc', mode: 'bounds', safeZ: 15, jobPath: '/jobs/test.json',
      startPosition: { x: 0, y: 0, z: 0 },
    })).rejects.toThrow(/first bounds motion must be Safe Z lift G0 Z15/);

    const snapshot = await env.runner.startTestMotion({
      path: '/jobs/generated/valid.bounds.gc', mode: 'bounds', safeZ: 15, jobPath: '/jobs/test.json',
      startPosition: { x: 0, y: 0, z: 0 },
    });
    expect(snapshot.gcodePath).toBe('/jobs/generated/valid.bounds.gc');
  });
});
