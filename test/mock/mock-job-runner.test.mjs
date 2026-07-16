import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { MockJobRunner } from '../../dev/mock-job-runner.mjs';
import { MockMarlin } from '../../dev/mock-marlin.mjs';
import { MockSD } from '../../dev/mock-sd.mjs';

const roots = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture({ gcode, gcodePath = '/gcode/job.gc', mode = 'source', validation = 'valid', delay = 1, toolChangeSettings = null } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cnc-mock-runner-'));
  roots.push(root);
  const sd = new MockSD(root);
  await sd.ensure();
  await sd.writeText(gcodePath, gcode || 'G21\nG90\nG0 Z15\nG1 X20 Y20\n');
  const sourcePath = mode === 'source' ? gcodePath : '/gcode/source.gc';
  if (mode === 'generated') await sd.writeText(sourcePath, 'G21\nG90\n');
  const activeText = await sd.readText(gcodePath);
  const sizeBytes = Buffer.byteLength(activeText);
  const fingerprint = createHash('sha256').update(Buffer.from(activeText)).digest('hex');
  const job = {
    gcodePath: sourcePath,
    sourceGcodePath: sourcePath,
    placement: mode === 'generated' ? { rotationDeg: 90, generatedRunPath: gcodePath, dirty: validation !== 'valid' } : { rotationDeg: 0 },
    activeRun: { mode, path: gcodePath, sizeBytes, generatedFingerprint: mode === 'generated' ? fingerprint : '', sourceFingerprint: mode === 'source' ? fingerprint : '', transformFingerprint: 'transform' },
    generatedValidation: mode === 'generated' ? { status: validation, generatedFingerprint: fingerprint, transformFingerprint: 'transform' } : null,
    schemaVersion: 3,
    startAuthorizationToken: 'AUTHORIZED',
    activeWorkZeroId: 'zero-test',
    startAuthorization: {
      state: 'authorized', activeRunMode: mode, activeRunPath: gcodePath,
      activeRunFingerprint: fingerprint, activeRunSizeBytes: sizeBytes,
      workZeroId: 'zero-test', homingEpoch: 1, homingSessionId: '',
    },
    arm: {
      state: 'ARMED', activeRunMode: mode, activeRunPath: gcodePath,
      activeRunFingerprint: fingerprint, activeRunSizeBytes: sizeBytes,
    },
    verificationDecision: {
      result: 'complete', type: 'bounds', activeRunPath: gcodePath,
      activeRunFingerprint: fingerprint, activeRunSizeBytes: sizeBytes,
    },
    feedOverride: { startPercent: 100, resetTo100AfterJob: true },
  };
  const jobPath = '/jobs/job.job.json';
  await sd.writeText(jobPath, JSON.stringify(job));
  const marlin = new MockMarlin();
  const frame = { trusted: true, absoluteFromHome: true, homingEpoch: 1, workZeroMachine: { x: 0, y: 0, z: 0 } };
  const runner = new MockJobRunner({
    sd, marlin, frame, lineDelayMs: delay,
    toolChangeSettings: toolChangeSettings || { handling: 'pause', zZeroMethod: 'manual' },
  });
  return { sd, marlin, runner, job, jobPath, gcodePath, request: {
    gcodePath, jobPath, activeRunMode: mode, activeRunFingerprint: fingerprint, activeRunSizeBytes: sizeBytes,
    startMode: 'use_active_work_zero', workZeroId: 'zero-test', homingEpoch: 1,
    workZeroMachineX: 0, workZeroMachineY: 0, workZeroMachineZ: 0,
  } };
}

async function waitForState(runner, states, timeout = 1000) {
  const expected = new Set(Array.isArray(states) ? states : [states]);
  const started = Date.now();
  while (!expected.has(runner.status.state) && Date.now() - started < timeout) await wait(5);
  return runner.status.state;
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('MockJobRunner', () => {
  it('accepts an explicitly authorized manual frame only in the same boot session', async () => {
    const ctx = await fixture();
    ctx.runner.frame.trusted = false;
    ctx.runner.frame.workZeroMachine = null;
    ctx.runner.frame.manualWorkFrameValid = true;
    ctx.runner.frame.workZeroValid = true;
    ctx.runner.frame.bootSessionId = 'boot-one';
    ctx.request.startMode = 'use_manual_work_frame';
    ctx.request.bootSessionId = 'boot-one';
    await ctx.runner.start(ctx.request);
    expect(await waitForState(ctx.runner, 'COMPLETED')).toBe('COMPLETED');

    const expired = await fixture();
    Object.assign(expired.runner.frame, {
      trusted: false, workZeroMachine: null, manualWorkFrameValid: true,
      workZeroValid: true, bootSessionId: 'boot-two',
    });
    expired.request.startMode = 'use_manual_work_frame';
    expired.request.bootSessionId = 'old-boot';
    await expect(expired.runner.start(expired.request)).rejects.toThrow(/expired/i);
  });

  it('streams an armed source job to completion', async () => {
    const ctx = await fixture();
    await ctx.runner.start(ctx.request);
    expect(await waitForState(ctx.runner, 'COMPLETED')).toBe('COMPLETED');
    expect(ctx.runner.status.acknowledgedLineCount).toBeGreaterThan(0);
    expect(ctx.runner.status.gcodePath).toBe('/gcode/job.gc');
  });

  it('streams the exact generated active run and blocks stale generated state', async () => {
    const valid = await fixture({ mode: 'generated', gcodePath: '/jobs/generated/job.run.gc' });
    await valid.runner.start(valid.request);
    expect(await waitForState(valid.runner, 'COMPLETED')).toBe('COMPLETED');
    expect(valid.runner.status.gcodePath).toBe('/jobs/generated/job.run.gc');

    const stale = await fixture({ mode: 'generated', validation: 'stale', gcodePath: '/jobs/generated/stale.run.gc' });
    await expect(stale.runner.start(stale.request)).rejects.toThrow(/not valid|stale/i);
  });

  it('does not silently fall back to source after a transformed run is missing', async () => {
    const ctx = await fixture({ mode: 'generated', gcodePath: '/jobs/generated/missing.run.gc' });
    await ctx.sd.delete(ctx.gcodePath);
    await expect(ctx.runner.start(ctx.request)).rejects.toThrow();
    expect(ctx.marlin.log).toHaveLength(0);
  });

  it('enters ERROR on a dangerous Z move', async () => {
    const ctx = await fixture({ gcode: 'G21\nG90\nG1 Z-45 F200\n' });
    await ctx.runner.start(ctx.request);
    expect(await waitForState(ctx.runner, 'ERROR')).toBe('ERROR');
    expect(ctx.runner.status.lastError).toMatch(/soft limit.*Z/i);
  });

  it('pauses, resumes, and stops without continuing the stream', async () => {
    const lines = ['G21', 'G90', ...Array.from({ length: 80 }, (_, index) => `G1 X${index + 1} Y1 F600`)].join('\n');
    const ctx = await fixture({ gcode: lines, delay: 5 });
    await ctx.runner.start(ctx.request);
    await wait(20);
    ctx.runner.pause();
    const pausedAt = ctx.runner.status.sentLineCount;
    await wait(30);
    expect(ctx.runner.status.sentLineCount).toBe(pausedAt);
    ctx.runner.resume();
    await wait(20);
    ctx.runner.stop();
    const stoppedAt = ctx.runner.status.sentLineCount;
    await wait(30);
    expect(ctx.runner.status.state).toBe('STOPPED');
    expect(ctx.runner.status.sentLineCount).toBe(stoppedAt);
    expect(ctx.marlin.spindleOff).toBe(true);
    expect(ctx.runner.frame).toMatchObject({
      trusted: false, absoluteFromHome: false, positionValid: false,
      workZeroValid: false, frameMode: 'untrusted',
    });
    expect(ctx.marlin.log.filter((entry) => entry.direction === 'tx').slice(-2).map((entry) => entry.text))
      .toEqual(['M5', 'M410']);
  });

  it('rejects a same-size active file changed after authorization', async () => {
    const ctx = await fixture({ gcode: 'G21\nG90\nG1 X10 Y10\n' });
    await ctx.sd.writeText(ctx.gcodePath, 'G21\nG90\nG1 X20 Y20\n', { overwrite: true });
    await expect(ctx.runner.start(ctx.request)).rejects.toThrow(/identity/i);
    expect(ctx.marlin.log).toHaveLength(0);
  });

  it('intercepts T/M6, waits for Z zero and confirmation, then continues without sending M6 to Marlin', async () => {
    const ctx = await fixture({
      gcode: 'G21\nG90\nG0 X10 Y20 Z15\nT2\nM6\nS18000 M3\nG1 X20 Y20 F600\n',
      delay: 2,
    });
    await ctx.runner.start(ctx.request);
    expect(await waitForState(ctx.runner, 'PAUSED')).toBe('PAUSED');
    expect(ctx.runner.status).toMatchObject({
      toolChangePending: true, toolChangeReady: true, toolChangeToolNumber: 2,
      toolChangeZZeroCompleted: false, toolChangePhase: 'WAITING_FOR_TOOL',
    });
    const sent = ctx.marlin.log.filter((entry) => entry.direction === 'tx').map((entry) => entry.text);
    expect(sent).not.toContain('T2');
    expect(sent).not.toContain('M6');
    const stopIndex = sent.lastIndexOf('M5');
    expect(sent[stopIndex - 1]).toBe('M400');
    expect(() => ctx.runner.resume()).toThrow(/complete.*tool change/i);
    expect(() => ctx.runner.completeToolChange({ confirmed: true, routerReady: true })).toThrow(/set Z zero/i);
    ctx.runner.markToolChangeZZero('manual');
    expect(ctx.runner.status.toolChangePhase).toBe('READY_TO_CONTINUE');
    expect(() => ctx.runner.completeToolChange({ confirmed: true })).toThrow(/routerReady/i);
    ctx.runner.completeToolChange({ confirmed: true, routerReady: true });
    expect(await waitForState(ctx.runner, 'COMPLETED')).toBe('COMPLETED');
    expect(ctx.runner.status.activeToolNumber).toBe(2);
  });

  it('parks in machine coordinates and returns to the captured work position after M6 confirmation', async () => {
    const settings = {
      handling: 'park', parkMachineX: 100, parkMachineY: 200, parkMachineZ: 70,
      zZeroMethod: 'manual',
    };
    const ctx = await fixture({
      gcode: 'G21\nG90\nG0 X10 Y20 Z15\nT3 M6\nG1 X30 Y20 F600\n',
      toolChangeSettings: settings,
    });
    await ctx.runner.start(ctx.request);
    expect(await waitForState(ctx.runner, 'PAUSED')).toBe('PAUSED');
    expect(ctx.runner.status.toolChangeReturnPosition).toEqual({ x: 10, y: 20, z: 15 });
    expect(ctx.runner.status).toMatchObject({ toolChangePhase: 'WAITING_FOR_TOOL', toolChangeParked: true });
    expect(ctx.marlin.machinePosition).toMatchObject({ x: 100, y: 200, z: 70 });
    ctx.runner.markToolChangeZZero('manual');
    ctx.runner.completeToolChange({ confirmed: true, routerReady: true });
    expect(ctx.marlin.position).toMatchObject({ x: 10, y: 20, z: 15 });
    expect(await waitForState(ctx.runner, 'COMPLETED')).toBe('COMPLETED');
  });

  it('supports priority M5 and live feed override while running', async () => {
    const lines = ['G21', 'G90', ...Array.from({ length: 40 }, (_, index) => `G1 X${index + 1}`)].join('\n');
    const ctx = await fixture({ gcode: lines, delay: 5 });
    await ctx.runner.start(ctx.request);
    ctx.marlin.execute('M3');
    expect(ctx.marlin.spindleOff).toBe(false);
    ctx.marlin.execute('M5', { priority: true });
    expect(ctx.marlin.spindleOff).toBe(true);
    ctx.runner.setFeedOverride(75);
    expect(ctx.runner.status.feedOverridePercent).toBe(75);
    ctx.runner.stop();
  });

  it('streams validated native-arc test motion without job arming', async () => {
    const ctx = await fixture();
    const motionPath = '/jobs/generated/job.aircut.gc';
    await ctx.sd.writeText(motionPath, [
      'M5', 'G21', 'G90', 'G54', 'G0 Z15 F400',
      'G2 X10 Y0 I5 J0 F600', 'G3 X0 Y0 I-5 J0 F600', 'M400',
    ].join('\n'));
    await ctx.runner.startTestMotion({ path: motionPath, mode: 'aircut', safeZ: 15 });
    expect(await waitForState(ctx.runner, 'COMPLETED')).toBe('COMPLETED');
    expect(ctx.runner.status.streamMode).toBe('aircut');
    expect(ctx.marlin.log.filter((entry) => /^G[23] /.test(entry.text))).toHaveLength(2);
  });

  it('rejects forbidden test motion and Aircut cutting Z before streaming', async () => {
    const forbidden = await fixture();
    const forbiddenPath = '/jobs/generated/forbidden.toolless.gc';
    await forbidden.sd.writeText(forbiddenPath, 'M5\nG21\nM3\nG1 X10 F600\nM400\n');
    await expect(forbidden.runner.startTestMotion({ path: forbiddenPath, mode: 'toolless', safeZ: 15 })).rejects.toThrow(/forbidden|unsupported/i);
    expect(forbidden.marlin.log).toHaveLength(0);

    const cutting = await fixture();
    const cuttingPath = '/jobs/generated/cutting.aircut.gc';
    await cutting.sd.writeText(cuttingPath, 'M5\nG21\nG90\nG0 Z15 F400\nG1 X10 Z-1 F600\nM400\n');
    await expect(cutting.runner.startTestMotion({ path: cuttingPath, mode: 'aircut', safeZ: 15 })).rejects.toThrow(/Safe Z/i);
    expect(cutting.marlin.log).toHaveLength(0);
  });
});
