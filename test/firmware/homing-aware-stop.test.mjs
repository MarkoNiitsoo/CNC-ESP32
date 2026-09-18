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

// Field failure 2026-09-15 (session 0F4DC42C): an emergency-injected M410
// during the G28 homing sequence wedges this Marlin build (no ack, no M115
// response, power cycle required). The homing stop therefore sends M112 ALONE
// - first on the wire - trading the Marlin session for an immediate physical
// stop. Steppers disable on kill: the gantry may drop; first test protocol
// requires the router disabled, tool high, nothing below.
describe('homing emergency stop (M112, stop-during-Home-All field failure)', () => {
  it('sends M112 ALONE as the homing emergency stop sequence', () => {
    const emergency = extractFunction(source, 'startHomingEmergencyStopSequence');
    expect(emergency).not.toBeNull();
    expect(emergency).toContain('queuePriorityCommands("M112")');
    expect(emergency).toContain('drainMarlinInput()');
    expect(emergency).toContain('startNextPriorityCommand()');
    expect(emergency).toContain('controllerKilledByEmergencyStop = true');
    // M112 must go out ALONE - never queued behind M410 or M5.
    expect(emergency).not.toContain('M410');
    expect(emergency).not.toContain('"M5"');
  });

  it('never sends M410 while homing motion is in flight', () => {
    const performJobStop = extractFunction(source, 'performJobStop');
    const machineOpBranch = performJobStop.slice(
      performJobStop.indexOf('if (machineOperationActive())'),
      performJobStop.indexOf('if (jogIsActive())'),
    );
    expect(machineOpBranch).toContain('if (homeOperationInterrupted) {');
    expect(machineOpBranch).toContain('startHomingEmergencyStopSequence();');
    // The non-homing machine ops (SetWorkZero/SetZZero - no homing motion)
    // keep the ordinary quickstop.
    expect(machineOpBranch).toContain('startImmediateStopPrioritySequence();');
    const homeArm = machineOpBranch.slice(
      0, machineOpBranch.indexOf('} else {'),
    );
    // No M410 command may be issued from the Home arm (comments may mention
    // the policy; only actual command strings matter).
    expect(homeArm).not.toContain('"M410"');
  });

  it('gates the emergency path on the G28 leg actually being in flight', () => {
    const inFlight = extractFunction(source, 'homeOperationInFlight');
    expect(inFlight).toContain("machineOp.kind == MachineOpKind::Home");
    expect(inFlight).toContain('machineOp.stepIndex == 0');
    // Later Home steps (M400/G92/M114/M503) carry no homing motion: the
    // ordinary quickstop path is safe there.
  });

  it('treats position and homing state as completely lost after the kill', () => {
    const performJobStop = extractFunction(source, 'performJobStop');
    const machineOpBranch = performJobStop.slice(
      performJobStop.indexOf('if (machineOperationActive())'),
      performJobStop.indexOf('if (jogIsActive())'),
    );
    expect(machineOpBranch).toContain(
      'invalidateMachineFrame(FrameInvalidationScope::Full, FrameInvalidationReason::JobQuickstop)');
    expect(machineOpBranch).toContain('resetJobSubstates(JobSubstateResetScope::StopInitiated)');
  });

  it('announces EMERGENCY STOPPING during the kill and the killed-state contract after', () => {
    const stopBody = extractFunction(source, 'performJobStop');
    expect(stopBody).toContain('EMERGENCY STOPPING');
    // The killed-state message lands in the ack-timeout handler (a different
    // function), asserted at source level here.
    expect(source).toContain(
      'EMERGENCY STOP. Controller killed. Restart required: power-cycle the printer, then Home All.');
    expect(source).toContain("jobStatus.lastPriorityCommand == \"M112\"");
  });

  it('flags the controller as killed for the recovery sequence and admission gates', () => {
    expect(source).toContain('bool controllerKilledByEmergencyStop = false;');
    expect(source).toContain('controllerKilledByEmergencyStop = true;');
    // Ack-timeout handler locks the killed messaging in.
    expect(source).toContain(
      'controllerKilledByEmergencyStop && jobStatus.lastPriorityCommand == "M112"');
  });

  it('attempts a best-effort M999 reboot during recovery probes', () => {
    const recovery = extractFunction(source, 'attemptControllerRecoverySequence');
    expect(recovery).not.toBeNull();
    expect(recovery).toContain('controllerKilledByEmergencyStop');
    expect(recovery).toContain('"M999"');
  });

  it('is idempotent: Stop after the kill does not re-send anything', () => {
    const performJobStop = extractFunction(source, 'performJobStop');
    expect(performJobStop).toContain('if (controllerKilledByEmergencyStop) {');
    expect(performJobStop).toContain(
      'EMERGENCY STOP already sent. The controller is killed; restart the printer (power cycle), then Home All.');
  });
});
