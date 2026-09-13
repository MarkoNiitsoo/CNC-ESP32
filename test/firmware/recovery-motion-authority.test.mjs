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

// F-2 promoted invariants: recovery-motion authority is firmware-owned. Admission
// derives from canonical firmware state only; the browser carries no trust authority.
describe('recovery-motion authority (F-2, firmware-owned)', () => {
  it('exposes a dedicated operator-gated recovery endpoint', () => {
    expect(source).toContain('operatorRoute("/api/recovery/move", HTTP_POST, handleRecoveryMove)');
    expect(extractFunction(source, 'handleRecoveryMove')).not.toBeNull();
  });

  it('admits recovery motion only in the RECOVERY_REQUIRED state', () => {
    const admit = extractFunction(source, 'admitRecoveryMotion');
    expect(admit).toContain('jobStatus.state != JobRunnerState::RecoveryRequired');
    expect(admit).toContain('RECOVERY_STATE_REQUIRED');
  });

  it('requires a trusted homed frame and a valid work zero', () => {
    const admit = extractFunction(source, 'admitRecoveryMotion');
    expect(admit).toContain('machineFrame.machineValid && machineFrame.absoluteFromHome');
    expect(admit).toContain('machineFrame.homedX && machineFrame.homedY && machineFrame.homedZ');
    expect(admit).toContain('machineFrame.workZeroValid');
    expect(admit).toContain('FRAME_UNTRUSTED');
    // A manually declared work frame is not a Home-All frame; recovery motion must
    // not accept it as a substitute.
    expect(admit).not.toContain('manualWorkFrameValid');
  });

  it('respects motion ownership (jog, machine operation, stop sequence)', () => {
    const admit = extractFunction(source, 'admitRecoveryMotion');
    expect(admit).toContain('jogIsActive()');
    expect(admit).toContain('machineOperationActive()');
    expect(admit).toContain('priorityCommandCount > 0');
  });

  it('uses a strict recovery command class with no dangerous commands', () => {
    const allowlist = extractFunction(source, 'recoveryMotionCommandAllowed');
    expect(allowlist).not.toBeNull();
    expect(allowlist).toContain('"M5"');
    expect(allowlist).toContain('"M400"');
    expect(allowlist).toContain('"G21"');
    expect(allowlist).toContain('"G90"');
    expect(allowlist).toContain('"G54"');
    expect(allowlist).toContain('startsWith("G0 ")');
    // The allowlist must not admit the explicitly forbidden commands.
    expect(allowlist).not.toMatch(/\bG28\b/);
    expect(allowlist).not.toMatch(/\bG53\b/);
    expect(allowlist).not.toMatch(/\bG92\b/);
    expect(allowlist).not.toMatch(/"M3"/);
    expect(allowlist).not.toMatch(/\bG1\b/);
  });

  it('validates recovery targets against the discovered machine envelope', () => {
    const limits = extractFunction(source, 'recoveryMoveTargetWithinLimits');
    expect(limits).not.toBeNull();
    expect(limits).toContain('machineFrame.workZeroMachineX');
    expect(limits).toContain('machineProfile.fullXMax');
    expect(limits).toContain('isfinite');
  });
});

describe('generic /api/cmd recovery bypass closure (F-2)', () => {
  it('locks the generic terminal to read-only diagnostics during RECOVERY_REQUIRED', () => {
    const handleCommand = extractFunction(source, 'handleCommand');
    expect(handleCommand).toContain('JobRunnerState::RecoveryRequired');
    expect(handleCommand).toContain('kRecoveryDiagnostics');
    for (const diagnostic of ['"M114"', '"M115"', '"M503"', '"M119"', '"M105"']) {
      expect(handleCommand).toContain(diagnostic);
    }
    expect(handleCommand).toContain('/api/recovery/move');
  });

  it('keeps the diagnostic lock semantic: motion-capable words are rejected, not blacklisted strings', () => {
    const handleCommand = extractFunction(source, 'handleCommand');
    const lock = handleCommand.slice(
      handleCommand.indexOf('JobRunnerState::RecoveryRequired'),
      handleCommand.indexOf('jobIsActive()'),
    );
    // The lock matches the whole normalized command against the diagnostic set,
    // so any motion/coordinate word falls through to rejection.
    expect(lock).toContain('diagnostic');
    expect(lock).toContain('return');
  });
});
