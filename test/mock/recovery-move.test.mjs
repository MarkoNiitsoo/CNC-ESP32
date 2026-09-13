import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockServer } from '../../dev/mock-server.mjs';

const instances = [];

async function start(config = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cnc-mock-recovery-'));
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
  for (const instance of instances.splice(0)) {
    await rm(instance.root, { recursive: true, force: true });
    instance.server.close();
  }
});

async function post(base, pathname, body) {
  const res = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function enterRecovery(env) {
  env.runner.status.state = 'RECOVERY_REQUIRED';
}

// Decisive F-2 acceptance scenarios, exercised through direct HTTP calls that
// bypass every browser check (state-ownership audit phase 5, step 11).
describe('firmware-owned recovery-motion authority (mock parity)', () => {
  it('rejects recovery motion on an untrusted frame even when the client claims trust', async () => {
    const { base, env } = await start();
    enterRecovery(env);
    env.frame.trusted = false;
    env.frame.workZeroValid = true;
    const result = await post(base, '/api/recovery/move', { command: 'G0 X5 Y5 F600', trusted: true, positionTrust: true });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('FRAME_UNTRUSTED');
  });

  it('rejects recovery motion when the work zero is invalid', async () => {
    const { base, env } = await start();
    enterRecovery(env);
    env.frame.trusted = true;
    env.frame.workZeroValid = false;
    const result = await post(base, '/api/recovery/move', { command: 'G0 X5 Y5 F600' });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('FRAME_UNTRUSTED');
  });

  it('rejects recovery motion outside the RECOVERY_REQUIRED state', async () => {
    const { base, env } = await start();
    env.frame.trusted = true;
    env.frame.workZeroValid = true;
    const result = await post(base, '/api/recovery/move', { command: 'G0 X5 Y5 F600' });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('RECOVERY_STATE_REQUIRED');
  });

  it('rejects recovery motion while a jog is active', async () => {
    const { base, env } = await start();
    enterRecovery(env);
    env.frame.trusted = true;
    env.frame.workZeroValid = true;
    env.jog.state = 'JOGGING';
    const result = await post(base, '/api/recovery/move', { command: 'G0 X5 Y5 F600' });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('JOG_ACTIVE');
  });

  it('accepts a valid recovery command with a trusted frame and idle machine', async () => {
    const { base, env } = await start();
    enterRecovery(env);
    env.frame.trusted = true;
    env.frame.workZeroValid = true;
    const spindle = await post(base, '/api/recovery/move', { command: 'M5' });
    expect(spindle.status).toBe(200);
    const lift = await post(base, '/api/recovery/move', { command: 'G0 Z10 F400' });
    expect(lift.status).toBe(200);
  });

  it('rejects commands outside the recovery class', async () => {
    const { base, env } = await start();
    enterRecovery(env);
    env.frame.trusted = true;
    env.frame.workZeroValid = true;
    for (const command of ['G28', 'G53 G0 Z5', 'G92 X0', 'M3 S1000', 'M4', 'G1 X5 F600', 'G0 X5; M400']) {
      const result = await post(base, '/api/recovery/move', { command });
      expect(result.status, command).toBe(400);
      expect(result.body.code, command).toBe('COMMAND_FORBIDDEN');
    }
  });

  it('locks the generic /api/cmd terminal during recovery but keeps diagnostics and M5 paths honest', async () => {
    const { base, env } = await start();
    enterRecovery(env);
    env.frame.trusted = true;
    env.frame.workZeroValid = true;

    const motion = await post(base, '/api/cmd', { cmd: 'G0 X5' });
    expect(motion.status).toBe(409);

    const diagnostic = await post(base, '/api/cmd', { cmd: 'M114' });
    expect(diagnostic.status).toBe(200);

    const standaloneM5 = await post(base, '/api/cmd', { cmd: 'M5' });
    expect(standaloneM5.status).toBe(409);
  });
});
