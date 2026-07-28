import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');

describe('dynamic Safe Z validation', () => {
  it('maps work Z through the active work zero and discovered machine limits', () => {
    const range = source.slice(source.indexOf('void safeWorkZRange'), source.indexOf('bool validateSafeWorkZ'));
    expect(range).toContain('machineZMin() - machineFrame.workZeroMachineZ');
    expect(range).toContain('machineZMax() - machineFrame.workZeroMachineZ');
    expect(range).toContain('machineProfile.workZMin');
    expect(range).toContain('machineProfile.workZMax');
  });

  it('rejects an out-of-range or downward safety move instead of clamping it', () => {
    const validation = source.slice(source.indexOf('bool validateSafeWorkZ'), source.indexOf('bool toolChangeParkIsWithinMachine'));
    expect(validation).toContain('safeWorkZ < minimum');
    expect(validation).toContain('safeWorkZ > maximum');
    expect(validation).toContain('safeWorkZ < marlinPosition.z');
    expect(source).not.toContain('clampFloat(extractJsonFloat(body, "safeStartZ", 15.0f), 0.0f, 200.0f)');
    expect(source).toContain('validateSafeWorkZ(safeStartZ, true, safeZError)');
    expect(source).toContain('validateSafeWorkZ(safeZ, true, safeZError)');
  });

  it('publishes work-frame Safe Z limits and rechecks tool-change park coordinates at execution time', () => {
    expect(source).toContain('safeZMinimum');
    expect(source).toContain('toolLengthReference\\":\\"active-work-zero');
    expect(source).toContain('toolChangeParkIsWithinMachine(parkError)');
  });

  it('reads Project Safe Z and checks every project motion request', () => {
    const metadata = source.slice(source.indexOf('bool loadProjectSafeZ'), source.indexOf('bool loadJobExecutionAuthorization'));
    expect(metadata).toContain('effectiveSafeZ');
    expect(metadata).toContain('resolved');
    expect(metadata).toContain('programSafeZ');
    expect(metadata).toContain('extraClearanceMm');
    expect(metadata).toContain('fabsf(storedEffective - expectedEffective) > 0.001f');
    expect(metadata).toContain('extraClearanceMm < 0.0f');
    for (const handler of ['handleTestMotionStart', 'handleProductionResumeStart', 'handleJobStart', 'handleJogStart', 'handleGoToWorkZero']) {
      const start = source.indexOf(`void ${handler}()`);
      const end = source.indexOf('\nvoid ', start + 1);
      expect(source.slice(start, end)).toContain('loadProjectSafeZ');
    }
  });

  it('enforces stateful sequence validation for mode: "bounds" test motion', () => {
    expect(source).toContain('bool validateBoundsSequence(');
    expect(source).toContain('extractJsonObjectFloat(body, "startPosition", "x", NAN)');
    expect(source).toContain('bounds motion requires G21, G90, and G54 established before motion');
    expect(source).toContain('first bounds motion must be Safe Z lift G0 Z');
    expect(source).toContain('bounds motion Z descends below Safe Z before start position restoration');
    expect(source).toContain('bounds Z restoration command must be G0 Z');
  });
});
