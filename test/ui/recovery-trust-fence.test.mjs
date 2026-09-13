import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const jobRecovery = await readFile(new URL('../../www/lib/job-recovery.js', import.meta.url), 'utf8');

// F-2 promoted invariants: browser position-trust belief is display state only.
// Recovery-motion authority is firmware-owned (machineFrame.trusted + work-zero
// validity enforced by /api/recovery/move). These were inverted it.fails fences
// until the browser trust demotion landed (phase 5).
describe('recovery trust authority (F-2, promoted after firmware ownership)', () => {
  it('does not persist or restore a trust belief through sessionStorage', () => {
    expect(preview).not.toContain('positionTrustKey');
    expect(preview).not.toMatch(/sessionStorage\.(setItem|getItem)\(/);
  });

  it('has no operator self-grant path for position trust', () => {
    expect(preview).not.toContain("'operator-confirmed-home-all'");
    expect(preview).not.toContain('recoveryTrustButton');
    expect(preview).not.toContain('setPositionTrust');
  });

  it('derives trust presentation from the firmware machine-frame slice', () => {
    expect(preview).toContain('currentMachineFrame?.trusted === true');
    expect(preview).toContain('firmwareFrameTrusted()');
    expect(preview).toContain('firmwareHomeFrameEstablished()');
  });

  it('sends recovery motion to the firmware-owned endpoint without trust fields', () => {
    expect(preview).toContain("'/api/recovery/move'");
    expect(countMatches(preview, /await recoveryMove\(command\)/)).toBe(2);
    expect(preview).not.toMatch(/trusted:\s*true/);
    expect(preview).not.toMatch(/positionTrust:\s*true/);
  });

  it('keeps the planner-level trust gate as early UI rejection only', () => {
    expect(jobRecovery).toContain('positionTrusted === true');
    expect(jobRecovery).toContain('Machine position is not trusted');
  });
});

function countMatches(text, regex) {
  return (text.match(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`)) || []).length;
}
