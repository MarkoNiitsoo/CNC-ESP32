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

describe('motion-stream admission anchors (F-3 audit evidence)', () => {
  it('extracts all four motion-stream admission predicates', () => {
    expect(extractFunction(source, 'admitJobStart')).not.toBeNull();
    expect(extractFunction(source, 'handleJogStart')).not.toBeNull();
    expect(extractFunction(source, 'handleTestMotionStart')).not.toBeNull();
    expect(extractFunction(source, 'handleProductionResumeStart')).not.toBeNull();
  });

  it('characterizes the current job-start admission checks', () => {
    const admitJobStart = extractFunction(source, 'admitJobStart');
    expect(admitJobStart).toContain('jobIsActive()');
    expect(admitJobStart).toContain('machineOperationActive()');
    expect(admitJobStart).toContain('sdMounted');
    expect(admitJobStart).toContain('machineFrame');
  });

  it('characterizes the current jog-start two-literal-state gate', () => {
    const handleJogStart = extractFunction(source, 'handleJogStart');
    expect(handleJogStart).toContain('JobRunnerState::PausedIntact');
    expect(handleJogStart).toContain('JobRunnerState::Running');
    expect(handleJogStart).toContain('jog rejected while job is RUNNING');
  });

  it('characterizes the current test-motion admission checks', () => {
    const handleTestMotionStart = extractFunction(source, 'handleTestMotionStart');
    expect(handleTestMotionStart).toContain('jobIsActive()');
  });
});

describe('motion-stream admission invariants (F-3 acceptance fences)', () => {
  it.fails('SAFETY FENCE (F-3, expected failing until fixed): job start rejects while a jog session is active', () => {
    const admitJobStart = extractFunction(source, 'admitJobStart');
    expect(admitJobStart).toMatch(/jogIsActive\(\)/);
  });

  it.fails('SAFETY FENCE (F-3, expected failing until fixed): test motion rejects while a jog session is active', () => {
    const handleTestMotionStart = extractFunction(source, 'handleTestMotionStart');
    expect(handleTestMotionStart).toMatch(/jogIsActive\(\)/);
  });

  it.fails('SAFETY FENCE (F-3, expected failing until fixed): test motion rejects while a machine operation is active', () => {
    const handleTestMotionStart = extractFunction(source, 'handleTestMotionStart');
    expect(handleTestMotionStart).toMatch(/machineOperationActive\(\)/);
  });

  it.fails('SAFETY FENCE (F-3, expected failing until fixed): production resume start rejects while a jog session is active', () => {
    const handleProductionResumeStart = extractFunction(source, 'handleProductionResumeStart');
    expect(handleProductionResumeStart).toMatch(/jogIsActive\(\)/);
  });

  it.fails('SAFETY FENCE (F-3, expected failing until fixed): production resume start requires a trusted/valid machine frame', () => {
    const handleProductionResumeStart = extractFunction(source, 'handleProductionResumeStart');
    expect(handleProductionResumeStart).toMatch(/machineFrame/);
  });

  it.fails('SAFETY FENCE (F-3, expected failing until fixed): jog start rejects during any active job state', () => {
    const handleJogStart = extractFunction(source, 'handleJogStart');
    expect(handleJogStart).toMatch(/jobIsActive\(\)/);
  });
});
