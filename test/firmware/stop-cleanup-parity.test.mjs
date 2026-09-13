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

const STOP_INITIATED = /resetJobSubstates\(JobSubstateResetScope::StopInitiated\)/;
const TERMINAL = /resetJobSubstates\(JobSubstateResetScope::Terminal\)/;

// F-4 promoted invariants: same terminal semantic outcome => same transient job-control
// cleanup, through one canonical resetJobSubstates(scope) policy. These were inverted
// it.fails fences until the canonical cleanup landed (phase 3).
describe('stop-cleanup parity (F-4, promoted after canonical resetJobSubstates)', () => {
  it('normal/safety Stop cleans the full substate set via the canonical policy', () => {
    const performJobStop = extractFunction(source, 'performJobStop');
    // Main branch (Stop/Safety Stop) and machine-operation branch (stop during an
    // active machine operation) both enter Stopping through the canonical reset.
    expect(countMatches(performJobStop, STOP_INITIATED)).toBe(2);
  });

  it('paused manual interruption cleans the full substate set via the canonical policy', () => {
    const beginPausedManualInterruption = extractFunction(source, 'beginPausedManualInterruption');
    expect(countMatches(beginPausedManualInterruption, STOP_INITIATED)).toBe(1);
  });

  it('the Stopping terminal transition cleans the full substate set via the canonical policy', () => {
    const finishPrioritySequence = extractFunction(source, 'finishPrioritySequence');
    expect(finishPrioritySequence).toContain('JobRunnerState::Stopping');
    expect(countMatches(finishPrioritySequence, TERMINAL)).toBe(1);
  });

  it('job error cleans the full substate set via the canonical policy', () => {
    const setJobError = extractFunction(source, 'setJobError');
    expect(setJobError).toContain('JobRunnerState::Error');
    expect(countMatches(setJobError, TERMINAL)).toBe(1);
  });

  it('job completion cleans the full substate set via the canonical policy', () => {
    const completeJob = extractFunction(source, 'completeJob');
    expect(completeJob).toContain('JobRunnerState::Completed');
    expect(countMatches(completeJob, TERMINAL)).toBe(1);
  });

  it('successful resume discards the tool-change window via the canonical policy', () => {
    const processJobRunner = extractFunction(source, 'processJobRunner');
    const advance = processJobRunner.slice(
      processJobRunner.indexOf('JobRunnerState::Resuming'),
      processJobRunner.indexOf('JobRunnerState::Running') + 1,
    );
    expect(advance).toContain('JobRunnerState::Resuming');
    expect(countMatches(processJobRunner, TERMINAL)).toBe(1);
  });
});

describe('critical ordering and evidence preservation (F-4)', () => {
  it('persists recovery evidence BEFORE transient cleanup on the manual-interruption path', () => {
    const beginPausedManualInterruption = extractFunction(source, 'beginPausedManualInterruption');
    expect(beginPausedManualInterruption.indexOf('writePersistentJobCheckpoint(false, true'))
      .toBeLessThan(beginPausedManualInterruption.indexOf('resetJobSubstates('));
  });

  it('the canonical reset never touches recovery evidence or the RecoveryRequired decision input', () => {
    const canonical = extractFunction(source, 'resetJobSubstates');
    // pauseInterruptedForManualMotion decides Stopped vs RecoveryRequired at the terminal
    // transition and must survive cleanup; callers own it explicitly.
    expect(canonical).not.toContain('pauseInterruptedForManualMotion');
    expect(canonical).not.toContain('streamingPausedReason');
    expect(canonical).not.toContain('lastError');
    expect(canonical).not.toContain('stopWarning');
    expect(canonical).not.toContain('homingEpoch');
  });

  it('still reports RecoveryRequired for a manual-motion interruption after cleanup', () => {
    const finishPrioritySequence = extractFunction(source, 'finishPrioritySequence');
    const stopping = finishPrioritySequence.slice(finishPrioritySequence.indexOf('JobRunnerState::Stopping'));
    expect(stopping).toMatch(/pauseInterruptedForManualMotion[\s\S]*JobRunnerState::RecoveryRequired[\s\S]*JobRunnerState::Stopped/);
  });
});

describe('non-terminal pause and resume stay intact (F-4 boundary)', () => {
  it('ordinary Pause retains exactly the state direct Resume needs', () => {
    const performJobPause = extractFunction(source, 'performJobPause');
    expect(performJobPause).not.toContain('resetJobSubstates');
    expect(countMatches(performJobPause, /jobStatus\.directResumeValid = true/)).toBe(2);
    expect(countMatches(performJobPause, /jobStatus\.pauseRequested = true/)).toBe(2);
    expect(performJobPause).toContain('pauseMode = "realtime"');
    expect(performJobPause).toContain('pauseMode = "boundary"');
  });

  it('direct Resume consumes its own authority without the terminal cleanup', () => {
    const performJobResume = extractFunction(source, 'performJobResume');
    expect(performJobResume).not.toContain('resetJobSubstates');
    expect(performJobResume).toContain('jobStatus.directResumeValid = false');
    expect(performJobResume).toContain('JobRunnerState::PausedIntact');
  });
});

describe('canonical substate cleanup single-writer guards (F-4)', () => {
  it('owns the tool-change terminal reset: exactly one toolChangePhase="NONE" writer', () => {
    const canonical = extractFunction(source, 'resetJobSubstates');
    expect(canonical).not.toBeNull();
    expect(canonical).toContain('JobSubstateResetScope scope');
    expect(canonical).toContain('jobStatus.toolChangePhase = "NONE"');
    expect(countMatches(source, /jobStatus\.toolChangePhase\s*=\s*"NONE"/)).toBe(1);
  });

  it('keeps the old per-path field-slam blocks out of the stop paths', () => {
    expect(countMatches(source, /jobStatus\.toolChangePending\s*=\s*false/)).toBe(2);
    const canonical = extractFunction(source, 'resetJobSubstates');
    const toolChangeComplete = extractFunction(source, 'handleToolChangeComplete');
    // One writer is the canonical reset; the other is the deliberate tool-change
    // completion flow transition (window closed, stream resumes).
    expect(countMatches(canonical, /jobStatus\.toolChangePending\s*=\s*false/)).toBe(1);
    expect(countMatches(toolChangeComplete, /jobStatus\.toolChangePending\s*=\s*false/)).toBe(1);
  });
});
