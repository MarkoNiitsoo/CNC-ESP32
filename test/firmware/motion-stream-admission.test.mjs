import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');

// Extract the full body of a top-level function by name (brace matching).
// Returns null if not found. Anchors in the tests guard against silent extraction failures.
// Unlike a first-'{'-stop scan this keeps consuming lines until braces balance, so
// 'Type name() {' same-line-brace definitions (main.cpp style) extract correctly.
function extractFunction(source, name) {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!new RegExp(`^\\s*[A-Za-z_].*\\b${name}\\s*\\(`).test(lines[i])) continue;
    if (/^\s*(if|for|while|switch|return|else|case)\b/.test(lines[i])) continue;
    let text = lines[i];
    let j = i;
    while (j < lines.length - 1 && !text.includes('{')) { j += 1; text += `\n${lines[j]}`; }
    const open = text.indexOf('{');
    if (open === -1) continue;
    if (text.slice(0, open).includes(';')) continue; // call or declaration, not a definition
    let depth = 0;
    for (let k = open; k < text.length; k++) {
      if (text[k] === '{') depth += 1;
      else if (text[k] === '}') depth -= 1;
    }
    while (depth > 0 && j < lines.length - 1) {
      j += 1;
      text += `\n${lines[j]}`;
      for (let k = 0; k < lines[j].length; k++) {
        if (lines[j][k] === '{') depth += 1;
        else if (lines[j][k] === '}') depth -= 1;
      }
    }
    if (depth === 0) return text;
  }
  return null;
}

function countMatches(text, regex) {
  return (text.match(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`)) || []).length;
}

const OWNER_LADDER = /jobIsActive\(\)|jogIsActive\(\)|machineOperationActive\(\)/;

// F-3 promoted invariants: one canonical shared machine-exclusivity policy
// (admitMotionStream) answers "may this motion owner start now?" for every
// motion-producing entry point. These were inverted it.fails fences until the
// canonical admission layer landed (phase 4).
describe('motion-stream admission (F-3, promoted after canonical admission layer)', () => {
  it('normal job start routes through the canonical admission policy', () => {
    const admitJobStart = extractFunction(source, 'admitJobStart');
    expect(admitJobStart).toContain('admitMotionStream(MotionStreamKind::Job)');
  });

  it('test-motion start routes through the canonical admission policy', () => {
    const handleTestMotionStart = extractFunction(source, 'handleTestMotionStart');
    expect(handleTestMotionStart).toContain('admitMotionStream(MotionStreamKind::TestMotion)');
  });

  it('production-resume start routes through the canonical admission policy', () => {
    const handleProductionResumeStart = extractFunction(source, 'handleProductionResumeStart');
    expect(handleProductionResumeStart).toContain('admitMotionStream(MotionStreamKind::ProductionResume)');
  });

  it('jog start routes through the canonical admission policy', () => {
    const handleJogStart = extractFunction(source, 'handleJogStart');
    expect(handleJogStart).toContain('admitMotionStream(MotionStreamKind::Jog)');
  });

  it('production-resume start requires a trusted (or manually confirmed) machine frame', () => {
    const handleProductionResumeStart = extractFunction(source, 'handleProductionResumeStart');
    expect(handleProductionResumeStart).toContain('machineFrame.machineValid && machineFrame.absoluteFromHome');
    expect(handleProductionResumeStart).toContain('manualWorkFrameValid');
    expect(handleProductionResumeStart).toContain('machineFrame.workZeroValid');
  });

  it('jog start during an intact pause keeps its deliberate RecoveryRequired interruption', () => {
    const handleJogStart = extractFunction(source, 'handleJogStart');
    expect(handleJogStart).toContain('JobRunnerState::PausedIntact');
    expect(handleJogStart).toContain('beginPausedManualInterruption()');
  });
});

describe('stream-specific admission stays explicit (F-3 boundary)', () => {
  it('job start keeps its frame-echo and sidecar-authorization checks', () => {
    const admitJobStart = extractFunction(source, 'admitJobStart');
    expect(admitJobStart).toContain('FRAME_STATE_CONFLICT');
    expect(admitJobStart).toContain('loadJobExecutionAuthorization');
  });

  it('test-motion start keeps its generated-file validation', () => {
    const handleTestMotionStart = extractFunction(source, 'handleTestMotionStart');
    expect(handleTestMotionStart).toContain('/jobs/generated');
  });

  it('production-resume start keeps its recovery identity validation', () => {
    const handleProductionResumeStart = extractFunction(source, 'handleProductionResumeStart');
    expect(handleProductionResumeStart).toContain('activeRunFingerprint');
  });
});

describe('canonical admission single-policy guards (F-3)', () => {
  it('the shared owner ladder exists exactly once, inside admitMotionStream', () => {
    const canonical = extractFunction(source, 'admitMotionStream');
    expect(canonical).not.toBeNull();
    expect(canonical).toContain('MotionStreamKind kind');
    expect(countMatches(canonical, /jobIsActive\(\)/)).toBe(1);
    expect(countMatches(canonical, /jogIsActive\(\)/)).toBe(1);
    expect(countMatches(canonical, /machineOperationActive\(\)/)).toBe(1);
  });

  it('no stream handler reimplements the owner ladder', () => {
    for (const name of ['admitJobStart', 'handleTestMotionStart', 'handleProductionResumeStart', 'handleJogStart']) {
      const body = extractFunction(source, name);
      expect(body, name).not.toBeNull();
      expect(countMatches(body, OWNER_LADDER), name).toBe(0);
    }
  });

  it('every motion-stream entry point uses the canonical policy', () => {
    // Four stream handlers plus the F-5 authorize-start endpoint, which applies
    // the same exclusivity ladder before minting a capability.
    expect(countMatches(source, /admitMotionStream\(MotionStreamKind::/)).toBe(5);
  });

  it('active jog blocks job/test/production but never the deliberate pause interruption', () => {
    const canonical = extractFunction(source, 'admitMotionStream');
    expect(canonical).toMatch(/jogIsActive\(\) && kind != MotionStreamKind::Jog/);
    expect(canonical).toContain('JobRunnerState::PausedIntact');
    expect(canonical).toContain('jobStatus.directResumeValid');
  });

  it('active machine operation blocks every stream kind, and active job blocks jog', () => {
    const canonical = extractFunction(source, 'admitMotionStream');
    expect(canonical).toContain('machineOperationActive()');
    expect(canonical).toContain('"MACHINE_OPERATION_ACTIVE"');
    expect(canonical).toContain('jobIsActive()');
    expect(canonical).toContain('"JOB_STATE_CONFLICT"');
  });
});
