import { describe, expect, it, vi } from 'vitest';
import {
  appendMotionOnlyRecoveryEvent,
  appendWorkZeroHistory,
  appendZZeroHistory,
  ensureHistory,
  finishLatestRun,
  markActiveZero,
  markActiveZZero,
  recordWorkZeroRestore,
  runStateLabel,
  startRunHistory,
  updateRunHistoryFromStatus,
  zeroStatus,
} from '../../www/lib/job-history.js';

const capture = (raw, x = 0, y = 0, z = 0) => ({
  rawM114: raw,
  position: { x, y, z },
  counts: { x: Math.round(x * 100), y: Math.round(y * 100), z: Math.round(z * 100) },
});

describe('job history metadata', () => {
  it('appends work-zero and Z-zero history without replacing compatibility fields', () => {
    const job = {
      gcodePath: '/gcode/test.gc',
      jobPath: '/jobs/test.gc.job.json',
      preview: { bounds: { xMin: 0, xMax: 1 } },
      workZero: { method: 'G92 X0 Y0 Z0' },
      toolZero: { method: 'G92 Z0' },
      dryRun: { lastAircutStatus: 'complete' },
      arm: { state: 'ARMED' },
      feedOverride: { startPercent: 75 },
    };

    const work = appendWorkZeroHistory(job, {
      before: capture('before', 10, 20, 30),
      after: capture('after'),
      capturedAt: '2026-06-23T10:00:00.000Z',
    });
    const z = appendZZeroHistory(job, {
      before: capture('before z', 1, 2, 3),
      after: capture('after z', 1, 2, 0),
      capturedAt: '2026-06-23T10:01:00.000Z',
    });

    expect(job.workZero.method).toBe('G92 X0 Y0 Z0');
    expect(job.toolZero.method).toBe('G92 Z0');
    expect(job.preview.bounds.xMax).toBe(1);
    expect(job.dryRun.lastAircutStatus).toBe('complete');
    expect(job.arm.state).toBe('ARMED');
    expect(job.feedOverride.startPercent).toBe(75);
    expect(work).toMatchObject({ type: 'workZero', method: 'G92 X0 Y0 Z0', workspace: 'G54' });
    expect(z).toMatchObject({ type: 'zZero', method: 'G92 Z0', workspace: 'G54' });
    expect(job.activeWorkZeroId).toBe(work.id);
    expect(job.activeZZeroId).toBe(z.id);
  });

  it('marks previous zeros active in metadata only', () => {
    const job = ensureHistory({});
    const first = appendWorkZeroHistory(job, { before: capture('a'), after: capture('b') });
    const second = appendWorkZeroHistory(job, { before: capture('c'), after: capture('d') });
    const zFirst = appendZZeroHistory(job, { before: capture('za'), after: capture('zb') });
    appendZZeroHistory(job, { before: capture('zc'), after: capture('zd') });

    expect(job.activeWorkZeroId).toBe(second.id);
    const historyLength = job.zeroHistory.length;
    expect(markActiveZero(job, first.id)).toBe(true);
    expect(markActiveZZero(job, zFirst.id)).toBe(true);
    expect(job.activeWorkZeroId).toBe(first.id);
    expect(job.activeZZeroId).toBe(zFirst.id);
    expect(job.zeroHistory).toHaveLength(historyLength);
  });

  it('records a saved work-zero restore without replacing its identity', () => {
    const job = ensureHistory({});
    const zero = appendWorkZeroHistory(job, { before: capture('before'), after: capture('after') });
    job.activeWorkZeroId = null;
    const restored = recordWorkZeroRestore(job, zero.id, {
      machinePosition: { x: 100, y: 500, z: 70 }, stepsPerMm: { x: 100, y: 100, z: 400 }, safeMachineZ: 70,
    });
    expect(restored.id).toBe(zero.id);
    expect(job.activeWorkZeroId).toBe(zero.id);
    expect(restored.restores).toHaveLength(1);
  });

  it('starts and completes run history linked to active zero ids', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);
    const job = {
      gcodePath: '/gcode/test.gc',
      jobPath: '/jobs/test.gc.job.json',
      feedOverride: { startPercent: 80 },
    };
    const work = appendWorkZeroHistory(job, { before: capture('w1'), after: capture('w2') });
    const z = appendZZeroHistory(job, { before: capture('z1'), after: capture('z2') });
    const run = startRunHistory(job, {}, '2026-06-23T10:00:00.000Z');

    expect(run.zeroId).toBe(work.id);
    expect(run.zZeroId).toBe(z.id);
    expect(work.usedByRuns).toContain(run.id);
    expect(z.usedByRuns).toContain(run.id);

    updateRunHistoryFromStatus(job, {
      state: 'COMPLETED',
      feedOverridePercent: 90,
      currentLineNumber: 42,
      lastSentCommand: 'G1 X1',
      lastMarlinResponse: 'ok',
    }, '2026-06-23T10:02:00.000Z');

    expect(job.runHistory[0]).toMatchObject({
      state: 'completed',
      feedOverrideStart: 80,
      feedOverrideLast: 90,
      currentLineNumber: 42,
      lastSentCommand: 'G1 X1',
      lastMarlinResponse: 'ok',
      actualDurationSeconds: 120,
    });
    expect(zeroStatus(job, work)).toBe('Current active zero');
    vi.restoreAllMocks();
  });

  it('records active generated run metadata in run history', () => {
    const job = {
      gcodePath: '/gcode/source.gc',
      sourceGcodePath: '/gcode/source.gc',
      generatedRunPath: '/jobs/generated/source.run.gc',
      jobPath: '/jobs/source.gc.job.json',
      activeRun: {
        mode: 'generated',
        path: '/jobs/generated/source.run.gc',
        sourceFingerprint: 'source-fp',
        generatedFingerprint: 'generated-fp',
        transformFingerprint: 'transform-fp',
      },
      generatedValidation: { generatedFingerprint: 'generated-fp' },
      feedOverride: { startPercent: 100 },
    };

    const run = startRunHistory(job);

    expect(run).toMatchObject({
      gcodePath: '/gcode/source.gc',
      sourceGcodePath: '/gcode/source.gc',
      activeRunMode: 'generated',
      activeRunPath: '/jobs/generated/source.run.gc',
      activeRunFingerprint: 'generated-fp',
      generatedRunPath: '/jobs/generated/source.run.gc',
      sourceFingerprint: 'source-fp',
      generatedFingerprint: 'generated-fp',
      transformFingerprint: 'transform-fp',
    });
  });

  it('updates stopped and error run states without deleting existing metadata', () => {
    const job = {
      preview: { lineCount: 10 },
      workZero: { beforeG92: { rawM114: 'before' } },
      toolZero: { afterG92Z: { rawM114: 'after' } },
      dryRun: { margin: 2 },
      feedOverride: { startPercent: 100 },
    };
    appendWorkZeroHistory(job, { before: capture('w1'), after: capture('w2') });
    startRunHistory(job);
    finishLatestRun(job, 'stopped', 'Operator stop');

    expect(job.runHistory[0].state).toBe('stopped');
    expect(job.runHistory[0].reason).toBe('Operator stop');
    expect(job.preview.lineCount).toBe(10);
    expect(job.workZero.beforeG92.rawM114).toBe('before');
    expect(job.toolZero.afterG92Z.rawM114).toBe('after');
    expect(job.dryRun.margin).toBe(2);
    expect(job.feedOverride.startPercent).toBe(100);

    startRunHistory(job);
    updateRunHistoryFromStatus(job, { state: 'ERROR', lastError: 'Marlin error' });
    expect(job.runHistory[1].state).toBe('error');
    expect(job.runHistory[1].reason).toBe('Marlin error');
  });

  it('provides display labels and zero usage categories', () => {
    const job = {};
    const zero = appendWorkZeroHistory(job, { before: capture('w1'), after: capture('w2') });
    expect(runStateLabel('interrupted')).toBe('Interrupted');
    expect(zeroStatus(job, zero)).toBe('Current active zero');
    job.activeWorkZeroId = null;
    expect(zeroStatus(job, zero)).toBe('Unused');
    markActiveZero(job, zero.id);
    const run = startRunHistory(job);
    run.state = 'interrupted';
    job.activeWorkZeroId = null;
    expect(zeroStatus(job, zero)).toBe('Used by stopped/interrupted run');
  });

  it('records motion-only recovery without changing the interrupted run state', () => {
    const job = {
      runHistory: [{ id: 'run-1', state: 'interrupted' }],
    };
    const event = appendMotionOnlyRecoveryEvent(job, {
      runId: 'run-1',
      activeRunPath: '/gcode/test.gc',
      activeRunFingerprint: 'size:1:fnv1a:abcd',
      resumeLineNumber: 12,
      resumePoint: { x: 20, y: 30, z: 15 },
      safeZ: 15,
      executedAt: '2026-06-30T20:00:00.000Z',
      activeRunMode: 'source',
      result: 'completed',
      commandsSent: ['M5', 'G21', 'G90', 'G54', 'G0 Z15', 'G0 X20 Y30', 'M400'],
    });

    expect(event).toMatchObject({
      type: 'motion-only-recovery-move', motionOnly: true, runId: 'run-1',
      activeRunMode: 'source', resumeLineNumber: 12,
      resumePoint: { x: 20, y: 30, z: 15 }, result: 'completed',
    });
    expect(job.runHistory[0].state).toBe('interrupted');
    expect(job).not.toHaveProperty('resume.state');

    const blocked = appendMotionOnlyRecoveryEvent(job, {
      runId: 'run-1', activeRunPath: '/gcode/test.gc', activeRunMode: 'source',
      safeZ: 15, result: 'blocked', reason: 'Position is not trusted.', commandsSent: [],
    });
    expect(blocked).toMatchObject({ result: 'blocked', reason: 'Position is not trusted.', commandsSent: [] });
    expect(job.runHistory[0].state).toBe('interrupted');
  });
});
