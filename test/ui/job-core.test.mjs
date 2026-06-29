import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGcode } from '../../www/lib/gcode-core.mjs';
import { clampFeedPercent, computePreflight, effectiveFeedRange, nextJobAction } from '../../www/lib/job-core.mjs';

const fixture = (name) => readFileSync(join('test', 'fixtures', name), 'utf8');
const now = () => '2026-06-23T00:00:00.000Z';

const completeZeroJob = {
  workZero: {
    beforeG92: { rawM114: 'X:1 Y:2 Z:3' },
    afterG92: { rawM114: 'X:0 Y:0 Z:0' },
  },
  toolZero: {
    afterG92Z: { rawM114: 'Z:0' },
  },
};

describe('feed override math', () => {
  it('clamps configured feed override to the supported 10-200 range', () => {
    expect(clampFeedPercent(0)).toBe(10);
    expect(clampFeedPercent(75.4)).toBe(75);
    expect(clampFeedPercent(250)).toBe(200);
    expect(clampFeedPercent('bad', 100)).toBe(100);
  });

  it('calculates effective feed range from G-code feed values and start override', () => {
    expect(effectiveFeedRange({ minFeed: 300, maxFeed: 1200, feedCommandCount: 2 }, 70)).toEqual({
      percent: 70,
      min: 210,
      max: 840,
    });
  });
});

describe('preflight readiness', () => {
  it('allows G54 as the normal default workspace but warns about unsaved job JSON and arcs/other warnings', () => {
    const parsed = parseGcode(fixture('freecad-g54-square.gcode'));
    const result = computePreflight({ parsed, job: completeZeroJob, jobExists: false, now });

    expect(result.updatedAt).toBe('2026-06-23T00:00:00.000Z');
    expect(result.checks.find((check) => check.id === 'workspaceCommands')).toMatchObject({
      level: 'pass',
      message: 'G54 default workspace command found.',
    });
    expect(result.checks.find((check) => check.id === 'workZero')).toMatchObject({ level: 'pass' });
    expect(result.checks.find((check) => check.id === 'jobJson')).toMatchObject({ level: 'warning' });
    expect(result.state).toBe('WARNINGS');
  });

  it('fails preflight for G20, G91, G55, missing work zero, and deep Z', () => {
    const parsed = parseGcode(fixture('unsafe-relative-inch-workspace.gcode'));
    const result = computePreflight({ parsed, job: {}, jobExists: true, now });
    const levels = Object.fromEntries(result.checks.map((check) => [check.id, check.level]));

    expect(result.state).toBe('NOT_READY');
    expect(levels.units).toBe('fail');
    expect(levels.coordinateMode).toBe('fail');
    expect(levels.workspaceCommands).toBe('fail');
    expect(levels.workZero).toBe('fail');
    expect(levels.zRange).toBe('warning');
    expect(levels.spindle).toBe('warning');
  });

  it('fails preflight when transformed placement requires an invalid generated run file', () => {
    const parsed = parseGcode(fixture('freecad-g54-square.gcode'));
    const result = computePreflight({
      parsed,
      job: {
        ...completeZeroJob,
        placement: { rotationDeg: 5, generatedRunPath: '/jobs/generated/test.run.gc', dirty: true },
        activeRun: { mode: 'generated', path: '/jobs/generated/test.run.gc' },
        generatedValidation: { status: 'stale' },
      },
      jobExists: true,
      now,
    });

    expect(result.state).toBe('NOT_READY');
    expect(result.checks.find((check) => check.id === 'activeRun')).toMatchObject({
      level: 'fail',
      message: 'Placement is transformed, but generated run file is not valid. Update Run File before dry run or cutting.',
    });
  });
});

describe('current job next action', () => {
  it('starts with choosing a file when no current job exists', () => {
    expect(nextJobAction({ currentJob: null }).label).toBe('Choose G-code File');
  });

  it('walks the operator through preview, zero, dry run, arm, then start', () => {
    const currentJob = { gcodePath: '/gcode/test.gc' };

    expect(nextJobAction({ currentJob, job: {} }).label).toBe('Open Preview');
    expect(nextJobAction({
      currentJob,
      job: {
        preview: { bounds: {} },
        activeRun: { mode: 'generated', path: '/jobs/generated/test.run.gc' },
        placement: { rotationDeg: 5, generatedRunPath: '/jobs/generated/test.run.gc' },
        generatedValidation: { status: 'valid', generatedFingerprint: 'generated-a' },
      },
    }).label).toBe('Set Work Zero');
    expect(nextJobAction({
      currentJob,
      job: {
        preview: { bounds: {} },
        activeRun: { mode: 'generated', path: '/jobs/generated/test.run.gc' },
        placement: { dirty: true },
        generatedValidation: { status: 'stale' },
      },
    }).label).toBe('Update Run File');
    expect(nextJobAction({ currentJob, job: { preview: { bounds: {} } } }).label).toBe('Set Work Zero');
    expect(nextJobAction({ currentJob, job: { preview: { bounds: {} }, workZero: completeZeroJob.workZero } }).label).toBe('Set Z Zero');
    expect(nextJobAction({
      currentJob,
      job: { preview: { bounds: {} }, ...completeZeroJob },
    }).label).toBe('Run Bounding Box');
    expect(nextJobAction({
      currentJob,
      job: { preview: { bounds: {} }, ...completeZeroJob, dryRun: { lastBoundingBoxTraceStatus: 'complete' } },
    }).label).toBe('Arm Job');
    expect(nextJobAction({
      currentJob,
      job: { preview: { bounds: {} }, ...completeZeroJob, dryRun: { lastBoundingBoxTraceStatus: 'complete' }, arm: { state: 'ARMED' } },
    }).label).toBe('Start Cut');
  });

  it('prioritizes live job states over setup actions', () => {
    const currentJob = { gcodePath: '/gcode/test.gc' };

    expect(nextJobAction({ currentJob, jobStatus: { state: 'RUNNING' }, job: {} }).label).toBe('Monitor Job');
    expect(nextJobAction({ currentJob, jobStatus: { state: 'PAUSED' }, job: {} }).label).toBe('Resume Job');
    expect(nextJobAction({ currentJob, jobStatus: { state: 'ERROR' }, job: {} }).label).toBe('Open Log');
  });
});
