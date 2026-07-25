import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  JOB_SCHEMA_VERSION,
  createVerificationDecision,
  emptyWorkflow,
  evaluateWorkflow,
  invalidateDependentSetup,
  verificationStatus,
} from '../../www/lib/job-workflow.js';

const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');

function job(overrides = {}) {
  return {
    schemaVersion: JOB_SCHEMA_VERSION,
    gcodePath: '/gcode/test.gc',
    activeRun: { mode: 'generated', path: '/jobs/generated/test.run.gc', generatedFingerprint: 'fp', transformFingerprint: 'tx' },
    activeWorkZeroId: 'zero-1',
    ...emptyWorkflow(),
    ...overrides,
  };
}

const homed = { machineFrame: { trusted: true, absoluteFromHome: true }, bootSessionId: 'boot-1' };

describe('Job JSON v3 workflow gates', () => {
  it('walks frame, work zero, verification, then cut', () => {
    const current = job();
    expect(evaluateWorkflow(current, { bootSessionId: 'boot-1' }).gate).toBe('frame');
    current.frameDecision = { mode: 'manual-unhomed', bootSessionId: 'boot-1', acknowledgedAt: 'now' };
    expect(evaluateWorkflow(current, { bootSessionId: 'boot-1' }).gate).toBe('work-zero');
    current.workZeroDecision = { mode: 'existing-marlin', token: 'manual-1', bootSessionId: 'boot-1', capturedAt: 'now' };
    expect(evaluateWorkflow(current, { bootSessionId: 'boot-1' }).gate).toBe('verification');
    current.verificationDecision = createVerificationDecision(current, { type: 'skipped', decidedAt: 'now' });
    expect(evaluateWorkflow(current, { bootSessionId: 'boot-1' }).gate).toBe('cut');
  });

  it('keeps the real homed workflow ordered Home, Zero, Bounds/Aircut, Cut', () => {
    const current = job({ activeWorkZeroId: '' });
    expect(evaluateWorkflow(current, homed).gate).toBe('work-zero');
    current.activeWorkZeroId = 'zero-1';
    current.workZeroDecision = { mode: 'homed', token: 'zero-1', capturedAt: 'now' };
    expect(evaluateWorkflow(current, homed).gate).toBe('verification');
    current.verificationDecision = createVerificationDecision(current, { type: 'aircut', safeZ: 15, decidedAt: 'now' });
    expect(evaluateWorkflow(current, homed).gate).toBe('cut');
  });

  it('does not let ordinary preflight problems hide Home, Zero, or Bounds/Aircut', () => {
    const current = job({ activeWorkZeroId: '' });
    const context = { ...homed, hardBlockers: ['Toolpath bounds need review'] };
    expect(evaluateWorkflow(current, context).gate).toBe('work-zero');
    current.activeWorkZeroId = 'zero-1';
    current.workZeroDecision = { mode: 'homed', token: 'zero-1', capturedAt: 'now' };
    expect(evaluateWorkflow(current, context).gate).toBe('verification');
    current.verificationDecision = createVerificationDecision(current, { type: 'bounds', decidedAt: 'now' });
    expect(evaluateWorkflow(current, context).gate).toBe('blocked');
    expect(evaluateWorkflow(current, { ...context, blockPreparation: true }).gate).toBe('blocked');
  });

  it('shows the exact failed-operation reason and a visible route to required steps', () => {
    expect(preview).toContain('Aircut/cutting stopped because Marlin stopped answering');
    expect(preview).toContain('Cut did not start because the saved run-file identity was stale');
    expect(preview).toContain('Show Required Steps');
    expect(preview).toContain('openRequiredSteps();');
    expect(preview).toContain('Cut did not start: ${err.message}');
  });

  it('accepts one current verification without stale sibling modes', () => {
    const current = job({
      workZeroDecision: { mode: 'homed', token: 'zero-1', capturedAt: 'now' },
    });
    current.verificationDecision = createVerificationDecision(current, { type: 'bounds', safeZ: 15, margin: 0, decidedAt: 'now' });
    expect(verificationStatus(current, homed)).toMatchObject({ ok: true, type: 'bounds' });
  });

  it('invalidates verification when run, transform, or work zero changes', () => {
    const current = job({ workZeroDecision: { mode: 'homed', token: 'zero-1', capturedAt: 'now' } });
    current.verificationDecision = createVerificationDecision(current, { type: 'bounds', decidedAt: 'now' });
    current.activeRun.transformFingerprint = 'changed';
    expect(verificationStatus(current, homed)).toMatchObject({ ok: false, reason: 'placement-changed' });
    current.activeRun.transformFingerprint = 'tx';
    current.workZeroDecision.token = 'zero-2';
    expect(verificationStatus(current, homed)).toMatchObject({ ok: false, reason: 'zero-changed' });
  });

  it('preserves completed verification as stale and invalidates temporary authorization after re-zeroing', () => {
    const current = job({
      workZeroDecision: { mode: 'homed', token: 'zero-1', capturedAt: 'now' },
      dryRun: { lastBoundingBoxTraceStatus: 'complete', lastAircutStatus: 'idle' },
      arm: { state: 'ARMED' },
      startAuthorization: { state: 'authorized', authorizedAt: 'now' },
    });
    current.verificationDecision = createVerificationDecision(current, { type: 'bounds', decidedAt: 'now' });
    const previousDecision = structuredClone(current.verificationDecision);

    invalidateDependentSetup(current, 'Work zero changed.');
    current.workZeroDecision.token = 'zero-2';

    expect(current.verificationDecision).toMatchObject({
      ...previousDecision,
      staleReason: 'Work zero changed.',
    });
    expect(verificationStatus(current, homed)).toMatchObject({ ok: false, reason: 'zero-changed' });
    expect(current.dryRun.lastBoundingBoxTraceStatus).toBe('stale');
    expect(current.arm.state).toBe('STALE');
    expect(current.startAuthorization.state).toBe('pending');
  });

  it('keeps repeatable setup actions in one persistent readiness location', async () => {
    const previewHtml = await readFile(new URL('../../www/preview.html', import.meta.url), 'utf8');
    for (const id of [
      'readiness-set-work-zero',
      'readiness-set-z-zero',
      'readiness-run-bounds',
      'readiness-run-aircut',
      'readiness-inspect-preflight',
      'readiness-inspect-recoveries',
    ]) {
      expect(previewHtml).toContain(`id="${id}"`);
    }
    expect(preview).toContain("'Set Work Zero Again'");
    expect(preview).toContain("'Run Bounding Box Again'");
    expect(preview).toContain("'Run Aircut Again'");
  });

  it('expires an unhomed decision on firmware boot-session change', () => {
    const current = job({ frameDecision: { mode: 'manual-unhomed', bootSessionId: 'boot-1', acknowledgedAt: 'now' } });
    expect(evaluateWorkflow(current, { bootSessionId: 'boot-2' }).gate).toBe('frame');
  });
});
