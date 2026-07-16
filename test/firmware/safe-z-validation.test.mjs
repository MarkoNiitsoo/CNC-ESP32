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
    expect(source).toContain('toolLengthReference\\\":\\\"active-work-zero');
    expect(source).toContain('toolChangeParkIsWithinMachine(parkError)');
  });
});
