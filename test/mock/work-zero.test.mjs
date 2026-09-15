import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockServer } from '../../dev/mock-server.mjs';

const instances = [];

async function start(config = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cnc-mock-workzero-'));
  const instance = await createMockServer({
    mockRoot: root,
    config: { lineDelayMs: 1, operatorLockEnabled: false, ...config },
  });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  instances.push({ ...instance, root });
  return { ...instance, base, env: instance.env };
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map(async ({ server, root }) => {
    server.close();
    await rm(root, { recursive: true, force: true });
  }));
});

async function post(base, pathname, body) {
  const res = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// Work Zero ownership: firmware is the single authority for workZeroValid, and
// the canonical admission rules refuse the operation with clear reasons.
describe('Work Zero firmware authority (mock parity)', () => {
  it('refuses Set Work Zero while a jog is active (case 5)', async () => {
    const { base, env } = await start();
    env.frame.trusted = true;
    env.frame.workZeroValid = true;
    env.jog.state = 'JOGGING';
    const result = await post(base, '/api/work-zero/set', {});
    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/jog/i);
  });

  it('refuses Set Work Zero while a job is active (case 5)', async () => {
    const { base, env } = await start();
    env.frame.trusted = true;
    env.frame.workZeroValid = true;
    env.runner.status.state = 'RUNNING';
    const result = await post(base, '/api/work-zero/set', {});
    expect(result.status).toBe(409);
  });

  it('establishes a valid work zero from a trusted frame (cases 1/2/6)', async () => {
    const { base, env } = await start();
    env.frame.trusted = true;
    env.frame.workZeroValid = false;
    const result = await post(base, '/api/work-zero/set', {});
    expect(result.status).toBe(200);
    // The same authoritative state is visible to a fresh read (page reload
    // recovers VALID from firmware, not from browser state).
    const frame = await fetch(`${base}/api/machine/frame`).then((res) => res.json());
    expect(frame.workZeroValid).toBe(true);
    expect(frame.trusted).toBe(true);
  });

  it('rejects Set Work Zero on an untrusted frame with the Home All reason (case 4)', async () => {
    const { base, env } = await start();
    env.frame.trusted = false;
    env.frame.workZeroValid = false;
    const result = await post(base, '/api/work-zero/set', {});
    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/Home All|manual work frame/i);
  });
});
