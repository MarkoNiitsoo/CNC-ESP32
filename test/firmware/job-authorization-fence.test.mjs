import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');
const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');

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

describe('job authorization anchors (F-5 audit evidence)', () => {
  it('authorizes job start with a client-writable constant token today', () => {
    expect(source).toContain('startAuthorizationToken != "AUTHORIZED"');
  });

  it('backs the token with a byte re-hash of the referenced run file', () => {
    expect(source).toContain('activeRunFileMatches');
  });
});

describe('job authorization boundary documentation (F-5)', () => {
  it('treats the browser start checklist as advisory: written by the UI, never read by firmware', () => {
    expect(preview).toContain('startChecklist');
    expect(source).not.toMatch(/checklist/i);
    const validateJobExecutionAuthorization = extractFunction(source, 'validateJobExecutionAuthorization');
    expect(validateJobExecutionAuthorization).not.toBeNull();
    expect(validateJobExecutionAuthorization).not.toMatch(/checklist/i);
  });
});

describe('job authorization invariants (F-5 acceptance fences)', () => {
  it.fails('SAFETY FENCE (F-5, expected failing until fixed): job start authorization must not accept a client-writable constant token', () => {
    expect(source).not.toMatch(/startAuthorizationToken\s*!=\s*"AUTHORIZED"/);
  });
});
