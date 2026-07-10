import { describe, expect, it } from 'vitest';
import {
  buildJobReadiness,
  getBlockingReasons,
  getPrimaryNextAction,
  getReadinessBadges,
  getSecondaryActions,
} from '../../www/lib/job-readiness.js';

const currentJob = { gcodePath: '/gcode/test.gc', jobPath: '/jobs/test.gc.job.json' };
const workZero = {
  beforeG92: { rawM114: 'X:10 Y:20 Z:30\nok\n' },
  afterG92: { rawM114: 'X:0 Y:0 Z:0\nok\n' },
};
const toolZero = {
  afterG92Z: { rawM114: 'X:0 Y:0 Z:0\nok\n' },
};

function baseJob(extra = {}) {
  return {
    gcodePath: '/gcode/test.gc',
    sourceGcodePath: '/gcode/test.gc',
    ...extra,
  };
}

function readySourceJob(extra = {}) {
  return baseJob({
    workZero,
    toolZero,
    dryRun: {
      lastBoundingBoxTraceStatus: 'complete',
      activeRunPath: '/gcode/test.gc',
    },
    arm: {
      state: 'ARMED',
      activeRunPath: '/gcode/test.gc',
      activeRunMode: 'source',
    },
    ...extra,
  });
}

function validGeneratedJob(extra = {}) {
  return baseJob({
    placement: {
      rotationDeg: 15,
      generatedRunPath: '/jobs/generated/test.run.gc',
      dirty: false,
    },
    activeRun: {
      mode: 'generated',
      path: '/jobs/generated/test.run.gc',
      generatedFingerprint: 'generated-a',
      sourceFingerprint: 'source-a',
      transformFingerprint: 'transform-a',
    },
    generatedValidation: {
      status: 'valid',
      generatedPath: '/jobs/generated/test.run.gc',
      generatedFingerprint: 'generated-a',
      sourceFingerprint: 'source-a',
      transformFingerprint: 'transform-a',
    },
    ...extra,
  });
}

describe('job readiness source workflow', () => {
  it('starts with choosing a file when no job is selected', () => {
    expect(getPrimaryNextAction({}, {}).label).toBe('Choose G-code File');
  });

  it('walks source jobs through zero and dry run into one review-and-start action', () => {
    expect(getPrimaryNextAction(baseJob(), { currentJob }).label).toBe('Set Work Zero');
    expect(getPrimaryNextAction(baseJob({ workZero }), { currentJob }).label).toBe('Set Z Zero');
    expect(getPrimaryNextAction(baseJob({ workZero, toolZero }), { currentJob }).label).toBe('Run Bounding Box / Dry Run');
    expect(getPrimaryNextAction(baseJob({
      workZero,
      toolZero,
      dryRun: { lastBoundingBoxTraceStatus: 'complete', activeRunPath: '/gcode/test.gc' },
    }), { currentJob }).label).toBe('Review & Start Cut');
    expect(getPrimaryNextAction(readySourceJob(), { currentJob }).label).toBe('Start Cut');
  });

  it('shows source active path and original badge for older source-only jobs', () => {
    const readiness = buildJobReadiness({ workZero }, { currentJob });

    expect(readiness.sourcePath).toBe('/gcode/test.gc');
    expect(readiness.activeRun).toMatchObject({ mode: 'source', path: '/gcode/test.gc' });
    expect(readiness.badges.map((badge) => badge.label)).toContain('USING ORIGINAL');
  });
});

describe('job readiness generated workflow', () => {
  it('requires Update Run File when transformed placement has no valid generated output', () => {
    const job = baseJob({
      placement: { rotationDeg: 10, generatedRunPath: '/jobs/generated/test.run.gc', dirty: true },
      activeRun: { mode: 'source', path: '/gcode/test.gc' },
      generatedValidation: { status: 'stale' },
    });
    const readiness = buildJobReadiness(job, { currentJob });

    expect(readiness.primaryAction.label).toBe('Update Run File');
    expect(readiness.activeRun.path).toBe('/gcode/test.gc');
    expect(readiness.blockingReasons.map((reason) => reason.message).join('\n')).toContain('Update Run File');
  });

  it('keeps transformed jobs on the generated path and blocks invalid generated files', () => {
    const job = validGeneratedJob({
      placement: { rotationDeg: 10, generatedRunPath: '/jobs/generated/test.run.gc', dirty: true },
      generatedValidation: { status: 'invalid', errors: ['bad generated file'] },
    });
    const readiness = buildJobReadiness(job, { currentJob });

    expect(readiness.activeRun).toMatchObject({ mode: 'generated', path: '/jobs/generated/test.run.gc' });
    expect(readiness.primaryAction.label).toBe('Update Run File');
    expect(readiness.primaryAction.label).not.toBe('Start Cut');
  });

  it('walks valid generated jobs through the same readiness gates', () => {
    expect(getPrimaryNextAction(validGeneratedJob(), { currentJob }).label).toBe('Set Work Zero');
    expect(getPrimaryNextAction(validGeneratedJob({ workZero }), { currentJob }).label).toBe('Set Z Zero');
    expect(getPrimaryNextAction(validGeneratedJob({ workZero, toolZero }), { currentJob }).label).toBe('Run Bounding Box / Dry Run');
    expect(getPrimaryNextAction(validGeneratedJob({
      workZero,
      toolZero,
      dryRun: { lastAircutStatus: 'complete', activeRunPath: '/jobs/generated/test.run.gc', activeRunFingerprint: 'generated-a' },
    }), { currentJob }).label).toBe('Review & Start Cut');
    expect(getPrimaryNextAction(validGeneratedJob({
      workZero,
      toolZero,
      dryRun: { lastAircutStatus: 'complete', activeRunPath: '/jobs/generated/test.run.gc', activeRunFingerprint: 'generated-a' },
      arm: { state: 'ARMED', activeRunPath: '/jobs/generated/test.run.gc', activeRunMode: 'generated', activeRunFingerprint: 'generated-a' },
    }), { currentJob }).label).toBe('Start Cut');
  });

  it('reports generated badges and blocker text', () => {
    const job = validGeneratedJob({ generatedValidation: { status: 'stale' } });

    expect(getReadinessBadges(job, { currentJob }).map((badge) => badge.label)).toContain('USING GENERATED');
    expect(getBlockingReasons(job, { currentJob }).some((reason) => /generated run file is not valid/i.test(reason.message))).toBe(true);
  });
});

describe('job readiness stale and live states', () => {
  it('returns Dry Run when dry run belongs to another active path', () => {
    const job = readySourceJob({
      dryRun: { lastBoundingBoxTraceStatus: 'complete', activeRunPath: '/gcode/old.gc' },
      arm: { state: 'ARMED', activeRunPath: '/gcode/test.gc', activeRunMode: 'source' },
    });

    expect(getPrimaryNextAction(job, { currentJob }).label).toBe('Run Bounding Box / Dry Run');
  });

  it('returns Review & Start when the internal arm belongs to another active path', () => {
    const job = readySourceJob({
      dryRun: { lastBoundingBoxTraceStatus: 'complete', activeRunPath: '/gcode/test.gc' },
      arm: { state: 'ARMED', activeRunPath: '/gcode/old.gc', activeRunMode: 'source' },
    });

    expect(getPrimaryNextAction(job, { currentJob }).label).toBe('Review & Start Cut');
    expect(getPrimaryNextAction(job, { currentJob }).target).toBe('run');
  });

  it('prioritizes running and paused live states', () => {
    expect(getPrimaryNextAction(baseJob(), { currentJob, jobStatus: { state: 'RUNNING' } }).label).toBe('Monitor Job');
    expect(getSecondaryActions(baseJob(), { currentJob, jobStatus: { state: 'RUNNING' } }).map((item) => item.label)).toEqual(['Pause', 'Stop', 'M5']);
    expect(getPrimaryNextAction(baseJob(), { currentJob, jobStatus: { state: 'PAUSED' } }).label).toBe('Resume Job');
    expect(getSecondaryActions(baseJob(), { currentJob, jobStatus: { state: 'PAUSED' } }).map((item) => item.label)).toEqual(['Stop', 'M5']);
  });

  it('reviews stopped or interrupted runs without offering resume execution', () => {
    const job = readySourceJob({ runHistory: [{ state: 'interrupted', startedAt: '2026-06-23T12:00:00.000Z' }] });
    const readiness = buildJobReadiness(job, { currentJob });

    expect(readiness.primaryAction.label).toBe('Review Last Run');
    expect(readiness.secondaryActions.map((item) => item.label)).toEqual(['Start Over', 'Re-run Dry Run']);
    expect(JSON.stringify(readiness.secondaryActions)).not.toMatch(/resume/i);
  });
});

describe('job readiness safety invariants', () => {
  it('does not encode movement or homing commands in next-action metadata', () => {
    const readiness = buildJobReadiness(validGeneratedJob({ workZero, toolZero }), { currentJob });
    const serialized = JSON.stringify(readiness);

    expect(serialized).not.toMatch(/\bG28\b|\bG92\b|\bM3\b|\bM4\b/);
  });
});
