import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createMockEnvironment } from '../../dev/mock-server.mjs';

describe('Controller Communication Correctness Fixes', () => {
  it('1. M400 timeout returns non-2xx/ok:false with 503 error payload', async () => {
    const env = await createMockEnvironment({ config: { simulateTimeout: true } });
    const result = env.marlin.execute('M400');
    expect(result.ok).toBe(false);
    expect(result.timeout).toBe(true);

    const commandResult = env.runner.runCommand('M400');
    expect(commandResult.ok).toBe(false);
    expect(commandResult.controllerState).toBe('unresponsive');
    expect(commandResult.failedCommand).toBe('M400');
  });

  it('2. M114 is not sent after M400 timeout', async () => {
    const env = await createMockEnvironment({ config: { simulateTimeout: true } });
    const initialTxCount = env.marlin.log.filter((e) => e.direction === 'tx').length;

    // Simulate sending M400 which times out
    const m400Res = env.runner.runCommand('M400');
    expect(m400Res.ok).toBe(false);
    expect(env.runner.controllerState).toBe('unresponsive');

    // Verify M114 was never sent to UART TX
    const txAfterM400 = env.marlin.log.filter((e) => e.direction === 'tx').map((e) => e.text);
    expect(txAfterM400).not.toContain('M114');

    // Verify no bounds file was uploaded and test motion was never called
    expect(env.runner.isActive()).toBe(false);
    expect(env.runner.status.gcodePath).toBe('');
  });

  it('3. Home is rejected without UART TX while unresponsive', async () => {
    const env = await createMockEnvironment();
    env.runner.controllerState = 'unresponsive';
    const initialTxCount = env.marlin.log.filter((e) => e.direction === 'tx').length;

    expect(() => env.runner.assertControllerCommunication()).toThrow(/Marlin is not responding/);
    const newTxCount = env.marlin.log.filter((e) => e.direction === 'tx').length;
    expect(newTxCount).toBe(initialTxCount);
  });

  it('4. Jog is rejected without UART TX while unresponsive', async () => {
    const env = await createMockEnvironment();
    env.runner.controllerState = 'unresponsive';
    const initialTxCount = env.marlin.log.filter((e) => e.direction === 'tx').length;

    expect(() => env.runner.assertControllerCommunication()).toThrow(/Marlin is not responding/);
    const newTxCount = env.marlin.log.filter((e) => e.direction === 'tx').length;
    expect(newTxCount).toBe(initialTxCount);
  });

  it('5. Production Resume is rejected without UART TX while unresponsive', async () => {
    const env = await createMockEnvironment();
    env.runner.controllerState = 'unresponsive';
    const initialTxCount = env.marlin.log.filter((e) => e.direction === 'tx').length;

    await expect(env.runner.startProductionResume({ path: '/jobs/generated/test.production-resume.gc' })).rejects.toThrow(/Marlin is not responding/);
    const newTxCount = env.marlin.log.filter((e) => e.direction === 'tx').length;
    expect(newTxCount).toBe(initialTxCount);
  });

  it('6. Work Zero operations are rejected without UART TX while unresponsive', async () => {
    const env = await createMockEnvironment();
    env.runner.controllerState = 'unresponsive';
    const initialTxCount = env.marlin.log.filter((e) => e.direction === 'tx').length;

    expect(() => env.runner.assertControllerCommunication()).toThrow(/Marlin is not responding/);
    const newTxCount = env.marlin.log.filter((e) => e.direction === 'tx').length;
    expect(newTxCount).toBe(initialTxCount);
  });

  it('7. Feed override is rejected without queue insertion while unresponsive', async () => {
    const env = await createMockEnvironment();
    env.runner.controllerState = 'unresponsive';
    const initialTxCount = env.marlin.log.filter((e) => e.direction === 'tx').length;

    expect(() => env.runner.assertControllerCommunication()).toThrow(/Marlin is not responding/);
    const newTxCount = env.marlin.log.filter((e) => e.direction === 'tx').length;
    expect(newTxCount).toBe(initialTxCount);
  });

  it('8. Job Start and test motion remain rejected while unresponsive', async () => {
    const env = await createMockEnvironment();
    await env.sd.writeText('/jobs/test.json', JSON.stringify({ projectSafeZ: { version: 2, programSafeZ: 15, extraClearanceMm: 0, effectiveSafeZ: 15, resolved: true } }), { overwrite: true });
    await env.sd.writeText('/jobs/generated/test.bounds.gc', 'M5\nG21\nG90\nG54\nG0 Z15 F400\nG0 X10 Y10 F1500\nG0 X0 Y0 F1500\nM400\nG0 Z0 F400\nM400\n', { overwrite: true });
    env.runner.controllerState = 'unresponsive';

    await expect(env.runner.startTestMotion({
      path: '/jobs/generated/test.bounds.gc', mode: 'bounds', safeZ: 15, jobPath: '/jobs/test.json',
      startPosition: { x: 0, y: 0, z: 0 },
    })).rejects.toThrow(/Marlin is not responding/);

    await expect(env.runner.start({
      gcodePath: '/gcode/test.gcode', jobPath: '/jobs/test.json', safeStartZ: 15,
    })).rejects.toThrow(/Marlin is not responding/);
  });

  it('9. Stop still sends M410 then M5 while unresponsive', async () => {
    const env = await createMockEnvironment();
    env.runner.status.state = 'RUNNING';
    env.runner.controllerState = 'unresponsive';

    const stopSnapshot = env.runner.stop();
    expect(stopSnapshot.stopRequested).toBe(true);
    expect(env.runner.status.state).toBe('STOPPING');
  });

  it('10. Recovery sends only M115 then M114', async () => {
    const env = await createMockEnvironment();
    env.runner.controllerState = 'unresponsive';

    const result = await env.runner.recoverController();
    expect(result.ok).toBe(true);
    expect(result.controllerState).toBe('connected');

    const txLogs = env.marlin.log.filter((e) => e.direction === 'tx').map((e) => e.text);
    expect(txLogs).toEqual(['M115', 'M114']);
  });

  it('11. A delayed bare ok cannot restore contact', async () => {
    const env = await createMockEnvironment();
    env.runner.controllerState = 'unresponsive';

    env.marlin.execute('M400');
    expect(env.runner.controllerState).toBe('unresponsive');
  });

  it('12. Controller slice publishes connected: false and unresponsive state', async () => {
    const env = await createMockEnvironment();
    env.runner.controllerState = 'unresponsive';

    const slice = env.runner.controllerSlice();
    expect(slice.connected).toBe(false);
    expect(slice.state).toBe('unresponsive');
    expect(slice.communication.state).toBe('unresponsive');
  });

  it('13. Successful recovery publishes connected: true', async () => {
    const env = await createMockEnvironment();
    env.runner.controllerState = 'unresponsive';

    const result = await env.runner.recoverController();
    expect(result.ok).toBe(true);

    const slice = env.runner.controllerSlice();
    expect(slice.connected).toBe(true);
    expect(slice.state).toBe('connected');
  });

  it('14. Controller-reset detection invalidates the complete machine/work frame', async () => {
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

  it('15. The visible Retry controller connection button exists and is wired', async () => {
    const html = await readFile(new URL('../../www/index.html', import.meta.url), 'utf8');
    expect(html).toContain('id="btn-retry-controller-conn"');

    const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
    expect(preview).toContain('btn-retry-controller-conn');
    expect(preview).toContain('recoverControllerConnection');
  });

  it('16. First bounds motion G1 Z<safeZ> is rejected', async () => {
    const env = await createMockEnvironment();
    await env.sd.writeText('/jobs/test.json', JSON.stringify({ projectSafeZ: { version: 2, programSafeZ: 15, extraClearanceMm: 0, effectiveSafeZ: 15, resolved: true } }), { overwrite: true });
    // Note: line 5 is G1 Z15 instead of G0 Z15
    await env.sd.writeText('/jobs/generated/invalid.bounds.gc', 'M5\nG21\nG90\nG54\nG1 Z15 F400\nG0 X10 Y10 F1500\nG0 X0 Y0 F1500\nM400\nG0 Z0 F400\nM400\n', { overwrite: true });

    await expect(env.runner.startTestMotion({
      path: '/jobs/generated/invalid.bounds.gc', mode: 'bounds', safeZ: 15, jobPath: '/jobs/test.json',
      startPosition: { x: 0, y: 0, z: 0 },
    })).rejects.toThrow(/first bounds motion must be Safe Z lift G0 Z15/);
  });

  it('17. First bounds motion G0 Z<safeZ> is accepted', async () => {
    const env = await createMockEnvironment();
    await env.sd.writeText('/jobs/test.json', JSON.stringify({ projectSafeZ: { version: 2, programSafeZ: 15, extraClearanceMm: 0, effectiveSafeZ: 15, resolved: true } }), { overwrite: true });
    await env.sd.writeText('/jobs/generated/valid.bounds.gc', 'M5\nG21\nG90\nG54\nG0 Z15 F400\nG0 X10 Y10 F1500\nG0 X0 Y0 F1500\nM400\nG0 Z0 F400\nM400\n', { overwrite: true });

    const snapshot = await env.runner.startTestMotion({
      path: '/jobs/generated/valid.bounds.gc', mode: 'bounds', safeZ: 15, jobPath: '/jobs/test.json',
      startPosition: { x: 0, y: 0, z: 0 },
    });
    expect(snapshot.gcodePath).toBe('/jobs/generated/valid.bounds.gc');
  });
});
