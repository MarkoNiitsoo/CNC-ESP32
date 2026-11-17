import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockServer } from '../../dev/mock-server.mjs';

const instances = [];

async function startServer(config = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cnc-select-sync-'));
  const instance = await createMockServer({
    mockRoot: root,
    config: { lineDelayMs: 1, operatorLockEnabled: false, ...config },
  });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const port = instance.server.address().port;
  instances.push({ ...instance, root });
  return { ...instance, base: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}` };
}

afterEach(async () => {
  while (instances.length) {
    const inst = instances.pop();
    await new Promise((resolve) => inst.server.close(resolve));
    await rm(inst.root, { recursive: true, force: true });
  }
});

describe('session-wide file selection synchronization', () => {
  it('broadcasts selectedGcodePath and selectedJobPath to other connected clients over WebSocket', async () => {
    const { base, wsUrl, env } = await startServer();
    await env.sd.writeText('/gcode/alpha.gc', 'G21\nG0 X0 Y0\n');
    await env.sd.writeText('/gcode/beta.gc', 'G21\nG0 X10 Y10\n');

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.type === 'snapshot') {
          ws.removeEventListener('message', onMessage);
          resolve();
        }
      };
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          protocolVersion: 1,
          type: 'hello',
          seq: 1,
          ack: 0,
          knownBootId: null,
          lastStateRevision: 0,
          utcMs: Date.now(),
          timezoneOffsetMinutes: 0,
          timeZone: 'UTC',
        }));
      }, { once: true });
      ws.addEventListener('message', onMessage);
      ws.addEventListener('error', reject, { once: true });
    });

    const patchPromise = new Promise((resolve) => {
      const onMessage = (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.type === 'patch' && msg.patch?.job?.selectedGcodePath === '/gcode/beta.gc') {
          ws.removeEventListener('message', onMessage);
          resolve(msg.patch.job);
        }
      };
      ws.addEventListener('message', onMessage);
    });

    const selectRes = await fetch(`${base}/api/job/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gcodePath: '/gcode/beta.gc', jobPath: '/jobs/beta.gc.job.json' }),
    });
    expect(selectRes.status).toBe(200);
    const selectBody = await selectRes.json();
    expect(selectBody.selectedGcodePath).toBe('/gcode/beta.gc');
    expect(selectBody.selectedJobPath).toBe('/jobs/beta.gc.job.json');

    const wsJobSlice = await patchPromise;
    expect(wsJobSlice.selectedGcodePath).toBe('/gcode/beta.gc');
    expect(wsJobSlice.selectedJobPath).toBe('/jobs/beta.gc.job.json');

    const statusRes = await fetch(`${base}/api/job/status`);
    const statusBody = await statusRes.json();
    expect(statusBody.selectedGcodePath).toBe('/gcode/beta.gc');
    expect(statusBody.selectedJobPath).toBe('/jobs/beta.gc.job.json');

    const missingRes = await fetch(`${base}/api/job/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gcodePath: '/gcode/does-not-exist.gc', jobPath: '/jobs/does-not-exist.gc.job.json' }),
    });
    expect(missingRes.status).toBe(404);

    ws.close();
  });

  it('wires UI file selection publishing and cross-client synchronization', async () => {
    const filesJs = await readFile(new URL('../../www/files.js', import.meta.url), 'utf8');
    const appJs = await readFile(new URL('../../www/app.js', import.meta.url), 'utf8');
    const machineBarJs = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
    const previewJs = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');

    expect(filesJs).toContain('/api/job/select');
    expect(appJs).toContain('/api/job/select');
    expect(appJs).toContain('cnc-selected-job-changed');
    expect(machineBarJs).toContain('syncSelectedJobFromSlice');
    expect(machineBarJs).toContain('cnc-selected-job-changed');
    expect(previewJs).toContain('syncSelectedJob');
  });
});
