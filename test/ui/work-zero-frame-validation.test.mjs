import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');

describe('fresh Work Zero frame validation', () => {
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
  });

  it('replaces the preparing status when an operator cancels either confirmation', () => {
    expect(preview).toContain("reportReadinessAction('Bounds Check cancelled. No motion was sent.')");
    expect(preview).toContain("reportReadinessAction('Bounds Check cancelled at the preflight warning. No motion was sent.')");
    expect(preview).toContain("reportReadinessAction('Aircut cancelled. No motion was sent.')");
    expect(preview).toContain("reportReadinessAction('Aircut cancelled at the preflight warning. No motion was sent.')");
  });
});
