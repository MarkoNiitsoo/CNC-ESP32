import { describe, expect, it } from 'vitest';
import { generateRunGcode, normalizePlacement } from '../../www/lib/toolpath-transform.js';
import { parseGCodeToToolpath } from '../../www/lib/toolpath-model.js';
import {
  defaultActiveRun,
  desiredRunModeForPlacement,
  ensureActiveRun,
  fingerprintsMatch,
  assertCanUseActiveRunForExecution,
  getActiveRun,
  getActiveRunFingerprint,
  getExecutionPath,
  getSourceGcodePath,
  isGeneratedRunUsable,
  markPlacementChanged,
  markExecutionStateStaleIfPathChanged,
  requiresGeneratedRun,
  selectGeneratedRun,
  selectSourceRun,
  validateGeneratedRun,
} from '../../www/lib/job-active-run.js';

const source = [
  'G21',
  'G90',
  'G17',
  'G54',
  'G0 X0 Y0 Z5',
  'G1 Z-1 F300',
  'G1 X10 Y0 F600',
  'G0 Z5',
].join('\n');

function generatedFixture() {
  const model = parseGCodeToToolpath(source);
  const placement = normalizePlacement(model, { rotationDeg: 0 });
  return generateRunGcode(model, placement, {
    sourcePath: '/gcode/test.gc',
    sourceFingerprint: 'source-a',
    generatedRunPath: '/jobs/generated/test.run.gc',
    generatedAt: '2026-06-23T12:00:00.000Z',
  });
}

describe('active run selection', () => {
  it('keeps old source-only job JSON compatible without deleting setup metadata', () => {
    const job = {
      gcodePath: '/gcode/old.gc',
      workZero: { method: 'G92 X0 Y0 Z0' },
      toolZero: { method: 'G92 Z0' },
      dryRun: { lastAircutStatus: 'complete' },
      arm: { state: 'ARMED' },
    };

    ensureActiveRun(job);

    expect(getSourceGcodePath(job)).toBe('/gcode/old.gc');
    expect(getActiveRun(job)).toMatchObject({ mode: 'source', path: '/gcode/old.gc' });
    expect(getExecutionPath(job)).toBe('/gcode/old.gc');
    expect(assertCanUseActiveRunForExecution(job).ok).toBe(true);
    expect(job.workZero.method).toBe('G92 X0 Y0 Z0');
    expect(job.toolZero.method).toBe('G92 Z0');
    expect(job.dryRun.lastAircutStatus).toBe('complete');
    expect(job.arm.state).toBe('ARMED');
  });

  it('defaults activeRun to source for identity/default placement', () => {
    const job = { gcodePath: '/gcode/test.gc', generatedRunPath: '/jobs/generated/test.run.gc' };
    ensureActiveRun(job);

    expect(job.sourceGcodePath).toBe('/gcode/test.gc');
    expect(job.activeRun).toMatchObject({ mode: 'source', path: '/gcode/test.gc' });
    expect(defaultActiveRun('/gcode/a.gc').mode).toBe('source');
    expect(desiredRunModeForPlacement({ rotationDeg: 0 })).toBe('source');
    expect(desiredRunModeForPlacement({ rotationDeg: 0, autoShiftToWorkZero: true })).toBe('generated');
    expect(desiredRunModeForPlacement({ rotationDeg: 17.5 })).toBe('generated');
  });

  it('marks placement changes as generated intent without separate confirmation', () => {
    const job = {
      gcodePath: '/gcode/test.gc',
      placement: { rotationDeg: 17.5, generatedRunPath: '/jobs/generated/test.run.gc' },
      arm: { state: 'ARMED' },
      dryRun: { lastBoundingBoxTraceStatus: 'complete', lastAircutStatus: 'complete' },
      preview: { lineCount: 1 },
      workZero: { method: 'G92 X0 Y0 Z0' },
      toolZero: { method: 'G92 Z0' },
      feedOverride: { startPercent: 80 },
      zeroHistory: [{ id: 'zero-a' }],
      runHistory: [{ id: 'run-a' }],
    };

    const desired = markPlacementChanged(job, {
      placement: job.placement,
      generatedRunPath: '/jobs/generated/test.run.gc',
      sourceFingerprint: 'source-a',
      transformFingerprint: 'placement-a',
    }, '2026-06-23T12:00:00.000Z');

    expect(desired).toBe('generated');
    expect(job.activeRun).toMatchObject({
      mode: 'generated',
      path: '/jobs/generated/test.run.gc',
      reason: 'placement-transform',
      selectedBy: 'placement',
    });
    expect(job.generatedValidation.status).toBe('pending');
    expect(job.placement.dirty).toBe(true);
    expect(job.arm.state).toBe('STALE');
    expect(job.dryRun.lastBoundingBoxTraceStatus).toBe('stale');
    expect(job.preview.lineCount).toBe(1);
    expect(job.workZero.method).toBe('G92 X0 Y0 Z0');
    expect(job.toolZero.method).toBe('G92 Z0');
    expect(job.feedOverride.startPercent).toBe(80);
    expect(job.zeroHistory).toHaveLength(1);
    expect(job.runHistory).toHaveLength(1);
  });

  it('selects generated automatically after successful generation and validation', () => {
    const job = {
      gcodePath: '/gcode/test.gc',
      placement: { generatedRunPath: '/jobs/generated/test.run.gc' },
      arm: { state: 'ARMED' },
      dryRun: { lastBoundingBoxTraceStatus: 'complete', lastAircutStatus: 'complete' },
    };
    ensureActiveRun(job);
    expect(selectGeneratedRun(job, { status: 'stale' })).toBe(false);

    const generated = generatedFixture();
    const validation = validateGeneratedRun({
      text: generated.gcode,
      generatedPath: '/jobs/generated/test.run.gc',
      sourceFingerprint: 'source-a',
      transformFingerprint: generated.placement.transformFingerprint,
    });
    expect(selectGeneratedRun(job, validation, '2026-06-23T12:01:00.000Z')).toBe(true);
    expect(job.activeRun).toMatchObject({
      mode: 'generated',
      path: '/jobs/generated/test.run.gc',
      selectedBy: 'placement',
    });
    expect(job.placement.dirty).toBe(false);
    expect(job.arm.state).toBe('STALE');
    expect(job.dryRun.lastBoundingBoxTraceStatus).toBe('stale');
    expect(getExecutionPath(job)).toBe('/jobs/generated/test.run.gc');
    expect(getActiveRunFingerprint(job)).toBe(validation.generatedFingerprint);
    expect(isGeneratedRunUsable(job).ok).toBe(true);
    expect(assertCanUseActiveRunForExecution(job).ok).toBe(true);
  });

  it('blocks transformed placement when generated output is not valid and never falls back to source', () => {
    const job = {
      gcodePath: '/gcode/test.gc',
      sourceGcodePath: '/gcode/test.gc',
      placement: { rotationDeg: 10, generatedRunPath: '/jobs/generated/test.run.gc', dirty: true },
      activeRun: { mode: 'source', path: '/gcode/test.gc' },
      generatedValidation: { status: 'stale' },
    };

    expect(requiresGeneratedRun(job)).toBe(true);
    expect(assertCanUseActiveRunForExecution(job)).toMatchObject({
      ok: false,
      reason: 'generated_missing',
    });

    markPlacementChanged(job, {
      placement: job.placement,
      generatedRunPath: '/jobs/generated/test.run.gc',
      sourceFingerprint: 'source-a',
      transformFingerprint: 'placement-a',
    });

    expect(getActiveRun(job)).toMatchObject({ mode: 'generated', path: '/jobs/generated/test.run.gc' });
    expect(getExecutionPath(job)).toBe('/jobs/generated/test.run.gc');
    expect(assertCanUseActiveRunForExecution(job).ok).toBe(false);
    expect(assertCanUseActiveRunForExecution(job).message).toContain('Update Run File');
  });

  it('marks arm and dry-run stale when active run changes', () => {
    const job = {
      gcodePath: '/gcode/test.gc',
      activeRun: { mode: 'source', path: '/gcode/test.gc' },
      arm: { state: 'ARMED' },
      dryRun: { lastBoundingBoxTraceStatus: 'complete', lastAircutStatus: 'complete' },
    };
    const previous = getActiveRun(job);
    job.activeRun = { mode: 'generated', path: '/jobs/generated/test.run.gc' };

    expect(markExecutionStateStaleIfPathChanged(job, previous)).toBe(true);
    expect(job.arm.state).toBe('STALE');
    expect(job.dryRun.lastBoundingBoxTraceStatus).toBe('stale');
  });

  it('resets placement back to source and preserves other job metadata', () => {
    const job = {
      gcodePath: '/gcode/test.gc',
      sourceGcodePath: '/gcode/test.gc',
      activeRun: { mode: 'generated', path: '/jobs/generated/test.run.gc' },
      preview: { lineCount: 1 },
      placement: { rotationDeg: 5 },
      workZero: { method: 'G92 X0 Y0 Z0' },
      toolZero: { method: 'G92 Z0' },
      feedOverride: { startPercent: 80 },
      zeroHistory: [{ id: 'zero-a' }],
      runHistory: [{ id: 'run-a' }],
    };
    selectSourceRun(job, '/gcode/test.gc');

    expect(job.activeRun.mode).toBe('source');
    expect(job.preview.lineCount).toBe(1);
    expect(job.placement.rotationDeg).toBe(5);
    expect(job.workZero.method).toBe('G92 X0 Y0 Z0');
    expect(job.toolZero.method).toBe('G92 Z0');
    expect(job.feedOverride.startPercent).toBe(80);
    expect(job.zeroHistory).toHaveLength(1);
    expect(job.runHistory).toHaveLength(1);
  });
});

describe('generated validation safety', () => {
  it('treats size+fnv1a and size+fnv1a+cyrb53 as the same generated file', () => {
    const shortFingerprint = 'size:471:fnv1a:620fdd86';
    const browserFingerprint = `${shortFingerprint}:cyrb53:48b19ad93e0d9`;
    const job = {
      gcodePath: '/gcode/test.gc',
      sourceGcodePath: '/gcode/test.gc',
      placement: { rotationDeg: 10, generatedRunPath: '/jobs/generated/test.run.gc', dirty: false },
      activeRun: {
        mode: 'generated', path: '/jobs/generated/test.run.gc',
        generatedFingerprint: browserFingerprint, transformFingerprint: 'placement-a',
      },
      generatedValidation: {
        status: 'valid', generatedFingerprint: shortFingerprint, transformFingerprint: 'placement-a',
      },
    };

    expect(fingerprintsMatch(browserFingerprint, shortFingerprint)).toBe(true);
    expect(isGeneratedRunUsable(job)).toMatchObject({ ok: true });
    expect(assertCanUseActiveRunForExecution(job)).toMatchObject({ ok: true });
    expect(fingerprintsMatch(browserFingerprint, 'size:471:fnv1a:deadbeef')).toBe(false);
    expect(fingerprintsMatch(browserFingerprint, 'size:470:fnv1a:620fdd86')).toBe(false);
  });

  it('accepts a generated file with expected preamble', () => {
    const generated = generatedFixture();
    const validation = validateGeneratedRun({
      text: generated.gcode,
      generatedPath: '/jobs/generated/test.run.gc',
      sourceFingerprint: 'source-a',
      expectedSourceFingerprint: 'source-a',
      transformFingerprint: generated.placement.transformFingerprint,
      expectedTransformFingerprint: generated.placement.transformFingerprint,
    });

    expect(validation.status).toBe('valid');
    expect(validation.errors).toEqual([]);
    expect(validation.generatedFingerprint).toContain('size:');
  });

  it('marks missing and stale generated files', () => {
    expect(validateGeneratedRun({ text: null, generatedPath: '/jobs/generated/missing.run.gc' }).status).toBe('missing');
    const generated = generatedFixture();
    const stale = validateGeneratedRun({
      text: generated.gcode,
      generatedPath: '/jobs/generated/test.run.gc',
      sourceFingerprint: 'source-b',
      expectedSourceFingerprint: 'source-a',
    });
    expect(stale.status).toBe('stale');
    expect(stale.errors.join('\n')).toContain('Source file fingerprint changed');
  });

  it('rejects unsafe generated commands', () => {
    ['G28', 'G53', 'G92', 'G91', 'G55', 'M3', 'M4'].forEach((cmd) => {
      const validation = validateGeneratedRun({
        text: `; Generated by CNC-ESP32 browser ToolpathModel\nG21\nG90\nG17\nG54\n${cmd}\n`,
        generatedPath: '/jobs/generated/bad.run.gc',
      });
      expect(validation.status).toBe('invalid');
      expect(validation.errors.join('\n')).toContain(cmd);
    });
  });

  it('reports negative lead-in outside placement bounds without calling the fitted job out-of-area', () => {
    const validation = validateGeneratedRun({
      text: [
        '; Generated by CNC-ESP32 browser ToolpathModel',
        'G21',
        'G90',
        'G17',
        'G54',
        'G0 Z5',
        'G1 X-5 Y-5 Z-1 F300',
        'G1 X10 Y0',
        'M5',
        'M400',
      ].join('\n'),
      generatedPath: '/jobs/generated/lead-in.run.gc',
      placementBounds: { xMin: 0, xMax: 10, yMin: 0, yMax: 10, zMin: -1, zMax: 5 },
    });

    expect(validation.status).toBe('valid');
    expect(validation.warnings.join('\n')).toContain('travel or lead-in moves');
    expect(validation.warnings.join('\n')).not.toContain('Generated bounds exceed configured machine work area');
  });

  it('does not create movement commands during validation or selection', () => {
    const job = { gcodePath: '/gcode/test.gc', placement: { generatedRunPath: '/jobs/generated/test.run.gc' } };
    const validation = validateGeneratedRun({ text: generatedFixture().gcode, generatedPath: '/jobs/generated/test.run.gc' });
    markPlacementChanged(job, {
      placement: { rotationDeg: 17.5, generatedRunPath: '/jobs/generated/test.run.gc' },
      generatedRunPath: '/jobs/generated/test.run.gc',
      sourceFingerprint: 'source-a',
      transformFingerprint: 'placement-a',
    });
    selectGeneratedRun(job, validation);
    selectSourceRun(job, '/gcode/test.gc');
    const metadata = JSON.stringify({ activeRun: job.activeRun, generatedValidation: validation });

    expect(metadata).not.toMatch(/\bG28\b|\bG53\b|\bG92\b|\bM3\b|\bM4\b/);
  });
});
