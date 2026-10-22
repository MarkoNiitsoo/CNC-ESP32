import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');

function evaluateCapturedZero(savedPosition, livePosition, raw = '') {
  const extract = (start, end) => preview.slice(preview.indexOf(start), preview.indexOf(end, preview.indexOf(start)));
  const functions = extract('function hasRawCapture(', 'function addCheck(') +
    extract('function hasWorkZero()', 'function workZeroValidationMessage');
  const jobState = {
    activeWorkZeroId: 'field-zero', workZeroDecision: { mode: 'homed', token: 'field-zero' },
    workZero: { beforeG92: { rawM114: raw }, afterG92: { rawM114: raw } },
    zeroHistory: [{ type: 'workZero', id: 'field-zero', machineReference: { position: savedPosition },
      frame: { homingEpoch: 1, homingSessionId: 'field-home' } }],
  };
  const currentMachineFrame = { trusted: true, absoluteFromHome: true, workZeroValid: true,
    homingEpoch: 1, homingSessionId: 'field-home', workZeroMachine: livePosition };
  return new Function('jobState', 'currentMachineFrame', `${functions}; return {
    captured: hasWorkZero(), matches: workZeroMatchesMachineFrame()
  };`)(jobState, currentMachineFrame);
}

describe('fresh Work Zero frame validation', () => {
  it('accepts actual empty-raw WS capture evidence with matching saved and live coordinates', () => {
    const position = { x: 283.802, y: 431.449, z: 38.28 };
    expect(evaluateCapturedZero(position, position)).toEqual({ captured: true, matches: true });
  });

  it('reproduces the field job mismatch and rejects stale XY even when Z agrees', () => {
    const stale = { x: 0, y: 0, z: 38.28 };
    const live = { x: 283.802, y: 431.449, z: 38.28 };
    expect(evaluateCapturedZero(stale, live)).toEqual({ captured: false, matches: false });
    // Legacy raw text remains capture evidence, but the separate live-frame guard must reject it.
    expect(evaluateCapturedZero(stale, live, 'X:0 Y:0 Z:0')).toEqual({ captured: true, matches: false });
  });

  it('accepts socket-confirmed Work Zero only when it belongs to the active homed decision and live frame', () => {
    const hasWorkZero = preview.slice(preview.indexOf('function hasWorkZero()'), preview.indexOf('function workZeroValidationMessage'));
    expect(hasWorkZero).toContain('frame?.trusted === true');
    expect(hasWorkZero).toContain('frame.absoluteFromHome === true');
    expect(hasWorkZero).toContain('frame.workZeroValid === true');
    expect(hasWorkZero).toContain('jobState?.workZeroDecision?.mode === \'homed\'');
    expect(hasWorkZero).toContain('jobState?.workZeroDecision?.token === reference.id');
    expect(hasWorkZero).toContain('workZeroMatchesMachineFrame()');
  });

  it('blocks stale homed zero in readiness and gives an actionable physical verification error', () => {
    expect(preview).toContain('status.frame.mode === \'homed\' && status.workZero.ok && !workZeroMatchesMachineFrame()');
    expect(preview).toContain('Set Work Zero again before sending');
    expect(preview).toContain('Saved Work Zero does not match the current Home All frame. Set Work Zero again.');
  });

  it('requires the firmware zeroRevision for both direct and touch-plate Z Zero confirmation', () => {
    expect(preview.match(/Number\(candidate\.zeroRevision\) > previousRevision/g)).toHaveLength(2);
  });

  it('does not carry a saved Work Zero forward through Z Zero when XY or home session changed', () => {
    expect(preview).toContain('const xyStillMatches = savedWork.position && liveWork');
    expect(preview).toContain('const sameHome = savedWork.homingEpoch === Number(frame?.homingEpoch)');
    expect(preview).toContain('if (Number.isFinite(machineZ) && xyStillMatches && sameHome');
  });
});

describe('physical verification feedback', () => {
  it('exposes an accessible readiness status and serializes repeated Bounds/Aircut attempts', () => {
    expect(preview).toContain('role="status" aria-live="polite"');
    expect(preview).toContain('if (dryRunActionBusy) return;');
    expect(preview).toContain('reportReadinessAction(`Aircut blocked: ${blocker}`, true)');
    expect(preview).toContain('reportReadinessAction(`Aircut failed: ${err.message}`, true)');
    expect(preview).toContain('reportReadinessAction(`Bounds Check failed: ${err.message}. ${stopMsg}`, true)');
    expect(preview).toContain('reportReadinessAction(`Bounds Check running:');
    expect(preview).toContain('reportReadinessAction(`Aircut running:');
  });

  it('replaces the preparing status when an operator cancels either confirmation', () => {
    expect(preview).toContain("reportReadinessAction('Bounds Check cancelled. No motion was sent.')");
    expect(preview).toContain("reportReadinessAction('Bounds Check cancelled at the preflight warning. No motion was sent.')");
    expect(preview).toContain("reportReadinessAction('Aircut cancelled. No motion was sent.')");
    expect(preview).toContain("reportReadinessAction('Aircut cancelled at the preflight warning. No motion was sent.')");
  });
});
