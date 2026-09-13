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

// Every job-ending path must leave the SAME required substate cleaned up:
// pause flags, direct-resume authority, and tool-change state (F-4 parity set).
const PAUSE_CLEARED = /jobStatus\.pauseRequested\s*=\s*false/;
const STOP_CLEARED = /jobStatus\.stopRequested\s*=\s*false/;
const DIRECT_RESUME_REVOKED = /jobStatus\.directResumeValid\s*=\s*false/;
const TOOL_CHANGE_PENDING_CLEARED = /jobStatus\.toolChangePending\s*=\s*false/;
const TOOL_CHANGE_PHASE_RESET = /jobStatus\.toolChangePhase\s*=\s*"NONE"/;

describe('stop-cleanup parity anchors (F-4 audit evidence)', () => {
  it('extracts all five job-ending paths', () => {
    expect(extractFunction(source, 'performJobStop')).not.toBeNull();
    expect(extractFunction(source, 'beginPausedManualInterruption')).not.toBeNull();
    expect(extractFunction(source, 'finishPrioritySequence')).not.toBeNull();
    expect(extractFunction(source, 'setJobError')).not.toBeNull();
    expect(extractFunction(source, 'completeJob')).not.toBeNull();
  });

  it('anchors the terminal and error transitions to their current cleanup code', () => {
    const finishPrioritySequence = extractFunction(source, 'finishPrioritySequence');
    expect(finishPrioritySequence).toContain('resetFeedOverrideAfterJobIfNeeded()');
    expect(finishPrioritySequence).toContain('jobStatus.pauseMode = "none"');
    const completeJob = extractFunction(source, 'completeJob');
    expect(completeJob).toContain('jobStatus.toolChangePhase = "NONE"');
    const setJobError = extractFunction(source, 'setJobError');
    expect(setJobError).toContain('jobWaitingForOk = false');
  });

  it('documents the cleanup facts that already hold today', () => {
    const performJobStop = extractFunction(source, 'performJobStop');
    expect(countMatches(performJobStop, PAUSE_CLEARED)).toBeGreaterThanOrEqual(2);
    const finishPrioritySequence = extractFunction(source, 'finishPrioritySequence');
    expect(countMatches(finishPrioritySequence, STOP_CLEARED)).toBeGreaterThanOrEqual(1);
  });
});

describe('stop-cleanup parity invariants (F-4 acceptance fences)', () => {
  it.fails('SAFETY FENCE (F-4, expected failing until fixed): performJobStop cleans the full substate set in both stop branches', () => {
    const performJobStop = extractFunction(source, 'performJobStop');
    expect(countMatches(performJobStop, PAUSE_CLEARED)).toBeGreaterThanOrEqual(2);
    expect(countMatches(performJobStop, DIRECT_RESUME_REVOKED)).toBeGreaterThanOrEqual(2);
    expect(countMatches(performJobStop, TOOL_CHANGE_PENDING_CLEARED)).toBeGreaterThanOrEqual(2);
    expect(countMatches(performJobStop, TOOL_CHANGE_PHASE_RESET)).toBeGreaterThanOrEqual(2);
  });

  it.fails('SAFETY FENCE (F-4, expected failing until fixed): beginPausedManualInterruption cleans the full substate set', () => {
    const beginPausedManualInterruption = extractFunction(source, 'beginPausedManualInterruption');
    expect(countMatches(beginPausedManualInterruption, PAUSE_CLEARED)).toBeGreaterThanOrEqual(1);
    expect(countMatches(beginPausedManualInterruption, DIRECT_RESUME_REVOKED)).toBeGreaterThanOrEqual(1);
    expect(countMatches(beginPausedManualInterruption, TOOL_CHANGE_PENDING_CLEARED)).toBeGreaterThanOrEqual(1);
    expect(countMatches(beginPausedManualInterruption, TOOL_CHANGE_PHASE_RESET)).toBeGreaterThanOrEqual(1);
  });

  it.fails('SAFETY FENCE (F-4, expected failing until fixed): finishPrioritySequence Stopping transition cleans the full substate set', () => {
    const finishPrioritySequence = extractFunction(source, 'finishPrioritySequence');
    expect(countMatches(finishPrioritySequence, PAUSE_CLEARED)).toBeGreaterThanOrEqual(1);
    expect(countMatches(finishPrioritySequence, STOP_CLEARED)).toBeGreaterThanOrEqual(1);
    expect(countMatches(finishPrioritySequence, DIRECT_RESUME_REVOKED)).toBeGreaterThanOrEqual(1);
    expect(countMatches(finishPrioritySequence, TOOL_CHANGE_PENDING_CLEARED)).toBeGreaterThanOrEqual(1);
    expect(countMatches(finishPrioritySequence, TOOL_CHANGE_PHASE_RESET)).toBeGreaterThanOrEqual(1);
  });

  it.fails('SAFETY FENCE (F-4, expected failing until fixed): setJobError cleans the full substate set', () => {
    const setJobError = extractFunction(source, 'setJobError');
    expect(countMatches(setJobError, PAUSE_CLEARED)).toBeGreaterThanOrEqual(1);
    expect(countMatches(setJobError, STOP_CLEARED)).toBeGreaterThanOrEqual(1);
    expect(countMatches(setJobError, DIRECT_RESUME_REVOKED)).toBeGreaterThanOrEqual(1);
    expect(countMatches(setJobError, TOOL_CHANGE_PENDING_CLEARED)).toBeGreaterThanOrEqual(1);
    expect(countMatches(setJobError, TOOL_CHANGE_PHASE_RESET)).toBeGreaterThanOrEqual(1);
  });

  it.fails('SAFETY FENCE (F-4, expected failing until fixed): completeJob cleans the full substate set', () => {
    const completeJob = extractFunction(source, 'completeJob');
    expect(countMatches(completeJob, PAUSE_CLEARED)).toBeGreaterThanOrEqual(1);
    expect(countMatches(completeJob, STOP_CLEARED)).toBeGreaterThanOrEqual(1);
    expect(countMatches(completeJob, DIRECT_RESUME_REVOKED)).toBeGreaterThanOrEqual(1);
    expect(countMatches(completeJob, TOOL_CHANGE_PENDING_CLEARED)).toBeGreaterThanOrEqual(1);
    expect(countMatches(completeJob, TOOL_CHANGE_PHASE_RESET)).toBeGreaterThanOrEqual(1);
  });
});
