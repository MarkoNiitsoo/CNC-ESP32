import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockServer } from '../../dev/mock-server.mjs';

const instances = [];

async function start(config = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cnc-mock-testconsole-'));
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
    server.close();
    await rm(root, { recursive: true, force: true });
  }));
});

describe('test console serving', () => {
  it('serves www/test.html through the generic static path', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/test.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('S1 Hardware Acceptance Tests');
    // The suite identifiers F-1..F-5 must all be present (finding badges/cards).
    for (const id of ['F-1', 'F-2', 'F-3', 'F-4', 'F-5']) {
      expect(body).toContain(id);
    }
  });
});
