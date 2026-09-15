import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const telemetry = await readFile(new URL('../../www/telemetry.js', import.meta.url), 'utf8');
const machineBar = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const previewHtml = await readFile(new URL('../../www/preview.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../../www/app.js', import.meta.url), 'utf8');

// Work Zero ownership regression coverage (field failure 2026-09-14: three
// competing zero controls + WS-cycling left the operator unable to establish a
// usable Work Zero). Phase: canonical Work Zero ownership.

describe('canonical Work Zero enable rule (firmware-derived)', () => {
  it('derives the Set Work Zero gate from the firmware frame mirror only', () => {
    const gate = preview.slice(preview.indexOf('function renderZeroGate()'));
    expect(gate).toContain('currentMachineFrame?.trusted === true');
    expect(gate).toContain('manualWorkFrameValid');
    // Work Zero validity must NOT be required to set Work Zero (circular).
    expect(gate).not.toContain('workZeroValid');
    // DOM text and local browser belief must not gate the control.
    expect(gate).not.toContain('POSITION TRUSTED');
    expect(gate).not.toContain('ARMED');
    expect(gate).not.toContain('positionTrust');
  });

  it('explains the refusal instead of leaving grey buttons', () => {
    expect(preview).toContain('Home All is required before setting Work Zero.');
    expect(preview).toContain('zeroGateEl.style.display');
  });
});

describe('single browser frame mirror with WS + HTTP reconciliation', () => {
  it('reconciles the authoritative frame over HTTP while the WS is down', () => {
    expect(telemetry).toContain('reconcileMachineFrameOverHttp');
    expect(telemetry).toContain("fetch('/api/machine/frame', { cache: 'no-store' })");
    expect(telemetry).toContain("transportStatus === 'synchronized'");
    expect(telemetry).toContain("emit('machine'");
  });

  it('drops stale HTTP frames by revision so they cannot overwrite newer WS state', () => {
    expect(telemetry).toContain('Number(frame.revision) <= currentRevision) return;');
  });

  it('confirms machine operations over HTTP when the WS drops mid-confirmation', () => {
    expect(machineBar).toContain('waitForMachineFrameHttp');
    expect(machineBar).toContain("fetch('/api/machine/frame', { cache: 'no-store' })");
    expect(machineBar).toContain("if (!socketLiveStateSynchronized()) {");
  });

  it('resolves HTTP confirmations as SLICE-shaped objects (field bug: raw frames lost homing info)', () => {
    const httpWait = machineBar.slice(machineBar.indexOf('function waitForMachineFrameHttp'));
    expect(httpWait).toContain('frame,');
    expect(httpWait).toContain('position: { work: frame.work || null, machine: frame.machine || null }');
    expect(httpWait).toContain('(slice) => slice');
    // Consumers re-extract .frame from the resolved value; the raw frame must
    // never be resolved bare.
    const dispatch = machineBar.slice(machineBar.indexOf('function dispatchConfirmedMachineEvent'));
    // Consumers re-extract .frame from the machine slice; the confirmed value
    // must therefore BE a slice (with .frame), never the bare frame JSON.
    expect(dispatch).toContain('machineFrameFromSlice(machineSlice)');
  });
});

describe('single operator-facing Work Zero control (consolidation)', () => {
  it('keeps exactly one primary Set Work Zero control in the Preview Zero panel', () => {
    expect(countMatches(previewHtml, /id="set-work-zero"/)).toBe(1);
    expect(previewHtml).toContain('Set Work Zero</button>');
  });

  it('hides per-axis zeroing behind advanced options', () => {
    expect(previewHtml).toContain('advanced-zero-options');
    const advanced = previewHtml.slice(previewHtml.indexOf('advanced-zero-options'));
    expect(advanced).toContain('id="set-zero-x"');
    expect(advanced).toContain('id="set-zero-y"');
  });

  it('labels the tool-domain Z zero separately from the job Work Zero', () => {
    expect(previewHtml).toContain('Set Tool Z Zero');
    expect(previewHtml).not.toContain('>Set Zero Z<');
  });

  it('removed the machine drawer zero controls, capture wrappers, and G92 intercepts', () => {
    expect(machineBar).not.toContain('mb-set-work-zero');
    expect(machineBar).not.toContain('mb-set-z-zero');
    expect(machineBar).not.toContain('mb-capture-work-zero');
    expect(machineBar).not.toContain('mb-capture-z-zero');
    expect(machineBar).not.toContain('mb-touch-plate-z-zero');
    expect(machineBar).not.toContain('captureAndSet');
    expect(machineBar).not.toContain("'G92 X0 Y0 Z0'");
    expect(machineBar).not.toContain("'G92 Z0'");
  });

  it('keeps exactly ONE Work Zero transport implementation (WS-first + HTTP fallback)', () => {
    expect(countMatches(machineBar, /async function setWorkZero\(/)).toBe(1);
    expect(countMatches(machineBar, /beginCommand\('machine\.setWorkZero'/)).toBe(1);
    expect(countMatches(machineBar, /apiPost\('\/api\/work-zero\/set'/)).toBe(1);
  });

  it('routes every zero button through the ONE canonical flow', () => {
    for (const marker of [
      "setWorkZeroButton?.addEventListener",
      "setZeroXButton?.addEventListener",
      "setZeroYButton?.addEventListener",
      "readinessSetWorkZeroButton?.addEventListener",
      "window.LowRiderMachineBar?.setWorkZero(",
    ]) {
      expect(preview).toContain(marker);
    }
    expect(countMatches(preview, /setWorkZeroWithCapture\(null/)).toBe(0);
  });

  it('keeps the dashboard free of zero establishment controls', () => {
    expect(app).not.toContain('work-zero/set');
    expect(app).not.toContain('setWorkZero');
  });
});

function countMatches(text, regex) {
  return (text.match(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`)) || []).length;
}
