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

const FULL_JOB_QUICKSTOP = /invalidateMachineFrame\(FrameInvalidationScope::Full, FrameInvalidationReason::JobQuickstop\)/;
const FULL_JOG_QUICKSTOP = /invalidateMachineFrame\(FrameInvalidationScope::Full, FrameInvalidationReason::JogQuickstop\)/;
const FULL_PAUSED_INTERRUPTION = /invalidateMachineFrame\(FrameInvalidationScope::Full, FrameInvalidationReason::PausedManualInterruption\)/;

describe('frame-trust invalidation anchors (F-1 audit evidence)', () => {
  it('extracts the canonical policy function and every quickstop entry point', () => {
    const canonical = extractFunction(source, 'invalidateMachineFrame');
    expect(canonical).not.toBeNull();
    expect(canonical).toContain('FrameInvalidationScope scope');
    expect(canonical).toContain('FrameInvalidationReason reason');
    expect(canonical).toContain('machineFrame = MachineFrameState()');
    expect(canonical).toContain('marlinPosition = PositionTelemetry()');
    expect(canonical).toContain('touchPositionStatus()');
    const performJobStop = extractFunction(source, 'performJobStop');
    expect(performJobStop).not.toBeNull();
    expect(performJobStop).toContain('startImmediateStopPrioritySequence');
    expect(performJobStop).toContain('stopWarning');
    const beginPausedManualInterruption = extractFunction(source, 'beginPausedManualInterruption');
    expect(beginPausedManualInterruption).not.toBeNull();
    const stopJogInternal = extractFunction(source, 'stopJogInternal');
    expect(stopJogInternal).not.toBeNull();
    expect(stopJogInternal).toContain('sendJogCommand("M410")');
    expect(stopJogInternal).toContain('sendJogCommand("G90")');
    const processJogRunner = extractFunction(source, 'processJogRunner');
    expect(processJogRunner).not.toBeNull();
    expect(processJogRunner).toContain('Marlin jog acknowledgement timed out');
    expect(processJogRunner).toContain('Marlin graceful jog stop acknowledgement timed out');
  });

  it('invalidates the machine frame through the canonical policy on job-side quickstops', () => {
    const performJobStop = extractFunction(source, 'performJobStop');
    expect(countMatches(performJobStop, FULL_JOB_QUICKSTOP)).toBeGreaterThanOrEqual(2);
    const beginPausedManualInterruption = extractFunction(source, 'beginPausedManualInterruption');
    expect(countMatches(beginPausedManualInterruption, FULL_PAUSED_INTERRUPTION)).toBeGreaterThanOrEqual(1);
  });

  it('routes stop-during-jog through the emergency jog quickstop path', () => {
    const performJobStop = extractFunction(source, 'performJobStop');
    expect(performJobStop).toContain('stopJogInternal(true)');
  });

  it('keeps the 10 s jog session teardown intentionally M410-free under the motion-grant model', () => {
    const processJogRunner = extractFunction(source, 'processJogRunner');
    expect(processJogRunner).toContain('kJogSessionResetMs');
    const finishGracefulJogStop = extractFunction(source, 'finishGracefulJogStop');
    if (finishGracefulJogStop === null) {
      expect(source).toContain('kJogSessionResetMs');
      return;
    }
    expect(finishGracefulJogStop).not.toContain('M410');
  });
});

// F-1 promoted invariants: same physical uncertainty => same frame-trust result,
// independent of which entry point fired. These were inverted it.fails fences until
// the canonical invalidateMachineFrame(scope, reason) policy landed.
describe('frame-trust invariants (F-1, promoted after canonical invalidation)', () => {
  it('emergency jog quickstop (M410) fully invalidates the machine frame', () => {
    const stopJogInternal = extractFunction(source, 'stopJogInternal');
    expect(countMatches(stopJogInternal, FULL_JOG_QUICKSTOP)).toBe(1);
  });

  it('jog move-ack timeout escalation (M410) fully invalidates the machine frame', () => {
    const processJogRunner = extractFunction(source, 'processJogRunner');
    const lines = processJogRunner.split('\n');
    const escalationEnd = lines.findIndex((line) => line.includes('Marlin jog acknowledgement timed out'));
    const escalation = lines.slice(Math.max(0, escalationEnd - 12), escalationEnd + 1).join('\n');
    expect(escalation).toContain('invalidateMachineFrame(FrameInvalidationScope::Full, FrameInvalidationReason::JogQuickstop)');
  });

  it('graceful jog stop ack-timeout escalation (M410) fully invalidates the machine frame', () => {
    const processJogRunner = extractFunction(source, 'processJogRunner');
    const lines = processJogRunner.split('\n');
    const escalationEnd = lines.findIndex((line) => line.includes('Marlin graceful jog stop acknowledgement timed out'));
    const escalation = lines.slice(Math.max(0, escalationEnd - 12), escalationEnd + 1).join('\n');
    expect(escalation).toContain('invalidateMachineFrame(FrameInvalidationScope::Full, FrameInvalidationReason::JogQuickstop)');
  });

  it('ordinary jog release keeps the frame trusted when position certainty survives', () => {
    const stopJogInternal = extractFunction(source, 'stopJogInternal');
    // Exactly one invalidation (the emergency branch); the graceful pointer-release
    // tail drains the planner horizon without M410 and must not touch frame trust.
    expect(countMatches(stopJogInternal, /invalidateMachineFrame\(/)).toBe(1);
    expect(stopJogInternal).toContain('// Normal pointer release');
    expect(stopJogInternal.indexOf('invalidateMachineFrame('))
      .toBeLessThan(stopJogInternal.indexOf('// Normal pointer release'));
  });
});

describe('canonical frame invalidation single-writer guards (F-1)', () => {
  it('replaces the old ad-hoc helper with one canonical policy function', () => {
    expect(source).not.toContain('invalidateMachineFrameAfterQuickstop');
    const canonical = extractFunction(source, 'invalidateMachineFrame');
    expect(canonical).not.toBeNull();
  });

  it('keeps the canonical function the only writer of wholesale frame reset', () => {
    expect(countMatches(source, /machineFrame = MachineFrameState\(\)/)).toBe(1);
    expect(countMatches(source, /marlinPosition = PositionTelemetry\(\)/)).toBe(1);
  });

  it('routes baseline machine-operation failures through the canonical policy', () => {
    expect(countMatches(source, /invalidateMachineFrame\(FrameInvalidationScope::Baseline, FrameInvalidationReason::MachineOperationFailure\)/)).toBe(2);
  });

  it('routes boot interrupted-job and controller-reset through the canonical policy', () => {
    expect(source).toContain('invalidateMachineFrame(FrameInvalidationScope::Full, FrameInvalidationReason::BootInterruptedJob)');
    expect(source).toContain('invalidateMachineFrame(FrameInvalidationScope::Full, FrameInvalidationReason::ControllerReset)');
    // The homing epoch is only ever zeroed by the wholesale struct reset inside the
    // canonical function; no invalidation site may hand-clear frame fields anymore.
    expect(countMatches(source, /machineFrame\.homingEpoch = 0;/)).toBe(0);
  });
});
