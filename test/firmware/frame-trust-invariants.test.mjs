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

describe('frame-trust invalidation anchors (F-1 audit evidence)', () => {
  it('extracts the computed frame-trust core and every quickstop entry point', () => {
    expect(extractFunction(source, 'invalidateMachineFrameAfterQuickstop')).not.toBeNull();
    const performJobStop = extractFunction(source, 'performJobStop');
    expect(performJobStop).not.toBeNull();
    expect(performJobStop).toContain('startImmediateStopPrioritySequence');
    expect(performJobStop).toContain('stopWarning');
    const beginPausedManualInterruption = extractFunction(source, 'beginPausedManualInterruption');
    expect(beginPausedManualInterruption).not.toBeNull();
    expect(beginPausedManualInterruption).toContain('invalidateMachineFrameAfterQuickstop()');
    const stopJogInternal = extractFunction(source, 'stopJogInternal');
    expect(stopJogInternal).not.toBeNull();
    expect(stopJogInternal).toContain('sendJogCommand("M410")');
    expect(stopJogInternal).toContain('sendJogCommand("G90")');
    const processJogRunner = extractFunction(source, 'processJogRunner');
    expect(processJogRunner).not.toBeNull();
    expect(processJogRunner).toContain('Marlin jog acknowledgement timed out');
    expect(processJogRunner).toContain('Marlin graceful jog stop acknowledgement timed out');
  });

  it('invalidates the machine frame on job-side quickstops today', () => {
    const performJobStop = extractFunction(source, 'performJobStop');
    expect(countMatches(performJobStop, /invalidateMachineFrameAfterQuickstop\(\)/)).toBeGreaterThanOrEqual(2);
    const beginPausedManualInterruption = extractFunction(source, 'beginPausedManualInterruption');
    expect(countMatches(beginPausedManualInterruption, /invalidateMachineFrameAfterQuickstop\(\)/)).toBeGreaterThanOrEqual(1);
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

describe('frame-trust invariants (F-1 acceptance fences)', () => {
  it.fails('SAFETY FENCE (F-1, expected failing until fixed): emergency jog quickstop (M410) invalidates the machine frame', () => {
    const stopJogInternal = extractFunction(source, 'stopJogInternal');
    expect(stopJogInternal).toMatch(/invalidateMachineFrame/);
  });

  it.fails('SAFETY FENCE (F-1, expected failing until fixed): jog move-ack timeout escalation (M410) invalidates the machine frame', () => {
    const processJogRunner = extractFunction(source, 'processJogRunner');
    const lines = processJogRunner.split('\n');
    const escalationEnd = lines.findIndex((line) => line.includes('Marlin jog acknowledgement timed out'));
    const escalation = lines.slice(Math.max(0, escalationEnd - 10), escalationEnd + 1).join('\n');
    expect(escalation).toMatch(/invalidateMachineFrame/);
  });

  it.fails('SAFETY FENCE (F-1, expected failing until fixed): graceful jog stop ack-timeout escalation (M410) invalidates the machine frame', () => {
    const processJogRunner = extractFunction(source, 'processJogRunner');
    const lines = processJogRunner.split('\n');
    const escalationEnd = lines.findIndex((line) => line.includes('Marlin graceful jog stop acknowledgement timed out'));
    const escalation = lines.slice(Math.max(0, escalationEnd - 10), escalationEnd + 1).join('\n');
    expect(escalation).toMatch(/invalidateMachineFrame/);
  });
});
