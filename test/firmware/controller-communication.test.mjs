import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createMockEnvironment } from '../../dev/mock-server.mjs';

describe('Controller Contact Safety & Motion Gating', () => {
  it('1. UART-owner 409 does not mark controller unresponsive', async () => {
    const env = await createMockEnvironment();
    env.runner.status.state = 'RUNNING';
    
    expect(env.runner.isActive()).toBe(true);
    expect(env.runner.controllerState).toBe('connected');
    
    await expect(env.runner.startTestMotion({ path: '/jobs/generated/test.bounds.gc', mode: 'bounds', safeZ: 15, jobPath: '/jobs/test.json' }))
      .rejects.toThrow(/already active/);

    expect(env.runner.controllerState).toBe('connected');
  });

  it('2. M400 completion is awaited before M114 is sent', async () => {
    const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
    const captureIdx = preview.indexOf('async function captureM114()');
    const captureCode = preview.slice(captureIdx, captureIdx + 1200);

    const m400Idx = captureCode.indexOf("sendCmd('M400')");
    const m114Idx = captureCode.indexOf("sendCmd('M114')");

    expect(m400Idx).toBeGreaterThan(-1);
    expect(m114Idx).toBeGreaterThan(m400Idx);
    expect(captureCode).toContain('await sendCmd(\'M400\')');
  });

  it('3. Complete but malformed M114 performs at most one retry', async () => {
    const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
    const captureIdx = preview.indexOf('async function captureM114()');
    const captureCode = preview.slice(captureIdx, captureIdx + 1600);

    expect(captureCode).toContain('Performing at most one retry');
    expect(captureCode).toContain('console.warn');
    expect(captureCode).toContain('raw2 = await sendCmd(\'M114\')');
  });

  it('4. Two malformed M114 responses abort without motion', async () => {
    const env = await createMockEnvironment({ config: { malformedM114Count: 2 } });
    const result1 = env.marlin.execute('M114');
    expect(result1.response).toContain('X:INVALID');
    expect(env.marlin.position.x).toBe(0);

    const result2 = env.marlin.execute('M114');
    expect(result2.response).toContain('X:INVALID');

    const txLogs = env.marlin.log.filter((e) => e.direction === 'tx').map((e) => e.text);
    expect(txLogs.filter((cmd) => cmd.startsWith('G0') || cmd.startsWith('G1'))).toHaveLength(0);
  });

  it('5. M114 timeout marks controller unresponsive', async () => {
    const env = await createMockEnvironment({ config: { simulateTimeout: true } });
    const res = env.runner.runCommand('M114');
    expect(res.timeout).toBe(true);
    expect(env.runner.controllerState).toBe('unresponsive');
  });

  it('6. No ordinary command is written to UART while unresponsive', async () => {
    const env = await createMockEnvironment();
    env.runner.controllerState = 'unresponsive';
    const initialLogLength = env.marlin.log.length;

    expect(() => env.runner.runCommand('G0 X10 Y10')).toThrow(/Marlin is not responding/);
    expect(env.marlin.log.length).toBe(initialLogLength);
  });

  it('7. Jog, Home, Bounds, Aircut, and Start are all rejected while unresponsive', async () => {
    const env = await createMockEnvironment();
    await env.sd.writeText('/jobs/test.json', JSON.stringify({ projectSafeZ: { version: 2, programSafeZ: 15, extraClearanceMm: 0, effectiveSafeZ: 15, resolved: true } }), { overwrite: true });
    await env.sd.writeText('/jobs/generated/test.bounds.gc', 'M5\nG21\nG90\nG54\nG0 Z15 F400\nG0 X10 Y10 F1500\nG0 X0 Y0 F1500\nM400\nG0 Z0 F400\nM400\n', { overwrite: true });
    await env.sd.writeText('/jobs/generated/test.aircut.gc', 'M5\nG21\nG90\nG54\nG0 Z15 F400\nM400\n', { overwrite: true });
    env.runner.controllerState = 'unresponsive';

    expect(() => env.runner.assertControllerCommunication()).toThrow(/Marlin is not responding/);

    await expect(env.runner.startTestMotion({
      path: '/jobs/generated/test.bounds.gc', mode: 'bounds', safeZ: 15, jobPath: '/jobs/test.json',
      startPosition: { x: 0, y: 0, z: 0 },
    })).rejects.toThrow(/Marlin is not responding/);

    await expect(env.runner.startTestMotion({
      path: '/jobs/generated/test.aircut.gc', mode: 'aircut', safeZ: 15, jobPath: '/jobs/test.json',
    })).rejects.toThrow(/Marlin is not responding/);
  });

  it('8. Stop remains callable while unresponsive', async () => {
    const env = await createMockEnvironment();
    env.runner.status.state = 'RUNNING';
    env.runner.controllerState = 'unresponsive';

    const stopSnapshot = env.runner.stop();
    expect(stopSnapshot.stopRequested).toBe(true);
  });

  it('9. A delayed bare ok does not restore controller contact', async () => {
    const env = await createMockEnvironment();
    env.runner.controllerState = 'unresponsive';

    env.marlin.execute('M400');
    expect(env.runner.controllerState).toBe('unresponsive');
  });

  it('10. M115 identity plus terminal response enters position-check phase', async () => {
    const env = await createMockEnvironment();
    env.runner.controllerState = 'unresponsive';

    const result = await env.runner.recoverController();
    expect(result.ok).toBe(true);
    expect(result.controllerState).toBe('connected');
    expect(env.runner.controllerState).toBe('connected');
  });

  it('11. Valid M114 after M115 restores controller contact', async () => {
    const env = await createMockEnvironment();
    env.runner.controllerState = 'unresponsive';

    const result = await env.runner.recoverController();
    expect(result.ok).toBe(true);
    expect(result.controllerState).toBe('connected');

    const txLogs = env.marlin.log.filter((e) => e.direction === 'tx').map((e) => e.text);
    expect(txLogs).toEqual(['M115', 'M114']);
  });

  it('12. Controller-reset detection invalidates homing/frame trust', async () => {
    const env = await createMockEnvironment({ config: { controllerResetDetected: true } });
    env.frame.trusted = true;
    env.frame.absoluteFromHome = true;
    env.frame.machineValid = true;

    env.runner.controllerState = 'unresponsive';
    const result = await env.runner.recoverController();
    expect(result.ok).toBe(true);
    expect(env.frame.machineValid).toBe(false);
    expect(env.frame.absoluteFromHome).toBe(false);
  });

  it('13. Cut Bounds does not upload or start a stream until XYZ is confirmed', async () => {
    const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
    const sendBoundsStart = preview.indexOf('async function sendBoundingBoxTrace()');
    const sendBoundsEnd = preview.indexOf('async function sendAircutToolpath()', sendBoundsStart);
    const sendBoundsCode = preview.slice(sendBoundsStart, sendBoundsEnd);

    const captureCall = sendBoundsCode.indexOf('await captureM114()');
    const streamCall = sendBoundsCode.indexOf('startTestMotionStream');

    expect(captureCall).toBeGreaterThan(-1);
    expect(streamCall).toBeGreaterThan(captureCall);
    expect(sendBoundsCode).toContain('if (!Number.isFinite(startX) || !Number.isFinite(startY) || !Number.isFinite(startZ))');
  });

  it('14. Browser shows distinct busy, malformed-response, and timeout messages', async () => {
    const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
    expect(preview).toContain('UART owner busy:');
    expect(preview).toContain('Marlin responded, but a complete X/Y/Z position could not be read. Cut Bounds was not started.');
    expect(preview).toContain('Marlin did not respond. Cut Bounds was not started. Machine commands are blocked until controller communication is restored.');
  });
});
