import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');

// Extract the full body of a top-level function by name (brace matching).
// Returns null if not found. Anchors in the tests guard against silent extraction failures.
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

// Field failure 2026-09-15 (session 0F4DC42C): Stop pressed during an active
// Home All injected M410 into the running G28 homing sequence; this Marlin
// build wedged (no ack, no M115 response, power cycle required). The stop
// path is now homing-aware: while a Home operation owns the machine, the
// priority sequence carries spindle-safe M5 ONLY - never M410 - and the
// finish message reports "Homing interrupted". Repeated Stop presses are
// idempotent via the existing Stopping-state gate.
describe('homing-aware stop (stop-during-Home-All field failure)', () => {
  it('routes stop-during-homing through the M5-only priority sequence', () => {
    const performJobStop = extractFunction(source, 'performJobStop');
    expect(performJobStop).not.toBeNull();
    expect(performJobStop).toContain('homeOperationInterrupted');
    expect(performJobStop).toContain('startHomingStopPrioritySequence()');
    expect(performJobStop).toContain('startImmediateStopPrioritySequence()');
  });

  it('withholds M410 for the whole Home operation window', () => {
    const stopBody = extractFunction(source, 'performJobStop');
    const machineOpBranch = stopBody.slice(
      stopBody.indexOf('if (machineOperationActive())'),
      stopBody.indexOf('if (jogIsActive())'),
    );
    // Both machine-op kinds are handled in the one branch: a Home keeps the
    // M410 out; other ops (SetWorkZero/SetZZero, no homing motion) keep the
    // immediate quickstop.
    expect(machineOpBranch).toContain('if (homeOperationInterrupted) {');
    expect(machineOpBranch).toContain('startHomingStopPrioritySequence();');
    expect(machineOpBranch).toContain('startImmediateStopPrioritySequence();');
  });

  it('keeps the M410+M5 quickstop for non-homing stops (job stop unchanged)', () => {
    const immediate = extractFunction(source, 'startImmediateStopPrioritySequence');
    expect(immediate).toContain('queuePriorityCommands("M410", "M5")');
    const jobStop = extractFunction(source, 'performJobStop');
    expect(jobStop).toContain('startImmediateStopPrioritySequence()');
  });

  it('gives the queued M5 the extended homing ack budget', () => {
    const homingStop = extractFunction(source, 'startHomingStopPrioritySequence');
    expect(homingStop).toContain('kMarlinHomingAckTimeoutMs');
    expect(homingStop).toContain("queuePriorityCommands(\"M5\")");
    expect(homingStop).not.toContain('M410');
  });

  it('is idempotent: a second Stop while Stopping does not re-send the quickstop', () => {
    const performJobStop = extractFunction(source, 'performJobStop');
    expect(performJobStop).toContain('JobRunnerState::Stopping');
    expect(performJobStop).toContain('M410 quickstop is in progress');
  });

  it('reports "Homing interrupted" on the terminal transition', () => {
    const finish = extractFunction(source, 'finishPrioritySequence');
    expect(finish).toContain('Homing interrupted by Stop. Home All is required before further motion.');
  });
});
