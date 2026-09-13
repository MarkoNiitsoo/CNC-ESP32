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

// F-5 promoted invariants: the client-writable constant token contract is gone.
// Job start authority is a firmware-issued, bound, one-time, short-lived
// capability; the sidecar carries browser-writable evidence only.
describe('start authorization anchors (F-5, firmware grant lifecycle)', () => {
  it('exposes the operator-gated authorize endpoint', () => {
    expect(source).toContain('operatorRoute("/api/job/authorize-start", HTTP_POST, handleJobAuthorizeStart)');
    const handler = extractFunction(source, 'handleJobAuthorizeStart');
    expect(handler).not.toBeNull();
    expect(handler).toContain('admitMotionStream(MotionStreamKind::Job)');
    expect(handler).toContain('esp_random()');
    expect(handler).toContain('loadJobExecutionAuthorization');
    expect(handler).toContain('validateJobExecutionAuthorization');
  });

  it('backs the capability with a byte re-hash of the referenced run file', () => {
    expect(source).toContain('activeRunFileMatches');
  });

  it('keeps the start checklist advisory: written by the UI, never read by firmware', () => {
    expect(preview).toContain('startChecklist');
    expect(source).not.toMatch(/checklist/i);
    const validate = extractFunction(source, 'validateJobExecutionAuthorization');
    expect(validate).not.toBeNull();
    expect(validate).not.toMatch(/checklist/i);
  });
});

describe('start authorization invariants (F-5, promoted after the grant lifecycle)', () => {
  it('removes the client-writable constant token contract completely', () => {
    expect(source).not.toContain('startAuthorizationToken');
    expect(source).not.toMatch(/startAuthorizationState/);
    expect(source).not.toContain('"AUTHORIZED"');
    expect(preview).not.toContain('startAuthorizationToken');
    expect(preview).not.toContain("'AUTHORIZED'");
  });

  it('keeps grant issuance, validation/consumption, and clearing as single writers', () => {
    expect(countMatches(source, /void issueJobStartGrant\(/)).toBe(1);
    expect(countMatches(source, /JobGrantCheck checkAndConsumeJobStartGrant\(/)).toBe(1);
    expect(countMatches(source, /void clearJobStartGrant\(\) \{/)).toBe(1);
  });

  it('binds the grant to the run and frame identity at use time', () => {
    const check = extractFunction(source, 'checkAndConsumeJobStartGrant');
    expect(check).toContain('jobStartGrant.consumed = true');
    expect(check).toContain('millis() - jobStartGrant.issuedAtMs');
    for (const field of ['gcodePath', 'jobPath', 'activeRunMode', 'activeRunFingerprint',
                         'activeRunSizeBytes', 'workZeroId', 'homingEpoch', 'homingSessionId']) {
      expect(check).toContain(`jobStartGrant.${field} != ${field}`);
    }
  });

  it('requires job.start to carry a grant and fails closed on every violation', () => {
    const admit = extractFunction(source, 'admitJobStart');
    expect(admit).toContain('checkAndConsumeJobStartGrant(');
    for (const code of ['START_GRANT_REQUIRED', 'START_GRANT_INVALID', 'START_GRANT_EXPIRED',
                        'START_GRANT_IDENTITY_CHANGED']) {
      expect(admit).toContain(code);
    }
  });

  it('invalidates the grant whenever the frame is invalidated', () => {
    const invalidate = extractFunction(source, 'invalidateMachineFrame');
    expect(invalidate).toContain('clearJobStartGrant()');
  });

  it('keeps the browser grant in memory only for the immediate request', () => {
    expect(preview).toContain("'/api/job/authorize-start'");
    expect(preview).toContain('await requestStartGrant(');
    expect(preview).not.toMatch(/localStorage[^\n]*startGrant/i);
    expect(preview).not.toMatch(/sessionStorage[^\n]*startGrant/i);
    expect(preview).not.toMatch(/job\.startGrant\s*=/);
  });
});

function countMatches(text, regex) {
  return (text.match(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`)) || []).length;
}
