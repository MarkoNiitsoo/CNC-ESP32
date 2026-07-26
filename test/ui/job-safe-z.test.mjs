import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  calculateProjectSafeZ,
  effectiveProjectSafeZ,
  migrateProjectSafeZ,
  updateProjectSafeZ,
  validateProjectSafeZForFrame,
} from '../../www/lib/job-safe-z.js';
import { startRunHistory } from '../../www/lib/job-history.js';

const previewSource = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const previewHtml = await readFile(new URL('../../www/preview.html', import.meta.url), 'utf8');
const machineBarSource = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
const safeZSource = await readFile(new URL('../../www/lib/job-safe-z.js', import.meta.url), 'utf8');

describe('project Safe Z', () => {
  it('adds clearance above stock top for bottom/object Z0', () => {
    expect(calculateProjectSafeZ({
      workpieceHeightMm: 24,
      workZeroReference: 'bottom',
      safeZClearanceMm: 5,
    })).toMatchObject({ stockTopWorkZ: 24, effectiveSafeZ: 29, resolved: true });
  });

  it('uses zero stock-top work Z when Work Zero is at stock top', () => {
    expect(calculateProjectSafeZ({
      workZeroReference: 'top',
      safeZClearanceMm: 5,
    })).toMatchObject({ stockTopWorkZ: 0, effectiveSafeZ: 5, resolved: true });
  });

  it('rejects negative clearance and leaves unknown geometry unresolved', () => {
    expect(calculateProjectSafeZ({
      workZeroReference: 'top',
      safeZClearanceMm: -1,
    })).toMatchObject({ effectiveSafeZ: null, resolved: false });
    const unknown = calculateProjectSafeZ({
      workZeroReference: 'bottom',
      safeZClearanceMm: 5,
    });
    expect(unknown.effectiveSafeZ).toBeNull();
    expect(unknown.errors.join(' ')).toMatch(/Workpiece height/);
    expect(() => updateProjectSafeZ({
      projectSafeZ: calculateProjectSafeZ({ workZeroReference: 'top', safeZClearanceMm: 5 }),
    }, { safeZClearanceMm: -1 })).toThrow(/non-negative/);
  });

  it('migrates an absolute Safe Z once when stock top is known', () => {
    const job = {
      safeStartZ: 29,
      workpieceHeightMm: 24,
      workZeroReference: 'bottom',
    };
    expect(migrateProjectSafeZ(job)).toMatchObject({
      stockTopWorkZ: 24,
      safeZClearanceMm: 5,
      effectiveSafeZ: 29,
      migratedFromAbsoluteSafeZ: true,
    });
    const once = structuredClone(job.projectSafeZ);
    migrateProjectSafeZ(job);
    expect(job.projectSafeZ).toEqual(once);
    expect(effectiveProjectSafeZ(job)).toBe(29);
  });

  it('does not infer stock height from toolpath or preserve an unsafe negative migration', () => {
    const unknown = { safeStartZ: 29, preview: { bounds: { zMax: 90 } } };
    expect(migrateProjectSafeZ(unknown)).toMatchObject({ resolved: false, effectiveSafeZ: null });
    const unsafe = { safeStartZ: 10, workpieceHeightMm: 24, workZeroReference: 'bottom' };
    expect(migrateProjectSafeZ(unsafe)).toMatchObject({ resolved: false, effectiveSafeZ: null });
  });

  it('marks dependent checks stale when clearance changes', () => {
    const job = {
      projectSafeZ: calculateProjectSafeZ({ workZeroReference: 'top', safeZClearanceMm: 5 }),
      verificationDecision: { result: 'complete' },
      dryRun: { lastBoundingBoxTraceStatus: 'complete', lastAircutStatus: 'complete' },
      generatedValidation: { status: 'valid' },
      recoveries: [{ id: 'recovery-1', status: 'ready' }],
      arm: { state: 'ARMED' },
      startAuthorization: { state: 'authorized' },
      startAuthorizationToken: 'AUTHORIZED',
    };
    updateProjectSafeZ(job, { safeZClearanceMm: 7 }, { now: '2026-07-26T12:00:00.000Z' });
    expect(job.projectSafeZ.effectiveSafeZ).toBe(7);
    expect(job.verificationDecision.staleReason).toMatch(/Safe Z/);
    expect(job.dryRun).toMatchObject({
      lastBoundingBoxTraceStatus: 'stale',
      lastAircutStatus: 'stale',
    });
    expect(job.recoveries[0].safeZValidationStaleAt).toBeTruthy();
    expect(job.startAuthorizationToken).toBe('');
  });

  it('invalidates Work Zero confirmation when its stock reference changes', () => {
    const job = {
      activeWorkZeroId: 'zero-1',
      projectSafeZ: calculateProjectSafeZ({ workZeroReference: 'top', safeZClearanceMm: 5 }),
    };
    updateProjectSafeZ(job, {
      workZeroReference: 'bottom',
      workpieceHeightMm: 24,
      safeZClearanceMm: 5,
    });
    expect(job.activeWorkZeroId).toBeNull();
    expect(job.projectSafeZ.effectiveSafeZ).toBe(29);
  });

  it('converts through Work Zero and blocks unreachable values without clamping', () => {
    const safeZ = calculateProjectSafeZ({
      workpieceHeightMm: 24,
      workZeroReference: 'bottom',
      safeZClearanceMm: 5,
    });
    const frame = { trusted: true, workZeroValid: true, workZeroMachine: { z: 30 } };
    expect(validateProjectSafeZForFrame(safeZ, frame, { zMin: -30, zMax: 70 }))
      .toMatchObject({ ok: true, workZ: 29, machineZ: 59 });
    expect(validateProjectSafeZForFrame(safeZ, {
      ...frame, workZeroMachine: { z: 50 },
    }, { zMin: -30, zMax: 70 })).toMatchObject({ ok: false, workZ: 29, machineZ: 79 });
  });

  it('records the effective Safe Z snapshot on each run', () => {
    const job = {
      gcodePath: '/gcode/panel.gc',
      sourceGcodePath: '/gcode/panel.gc',
      activeRun: { mode: 'source', path: '/gcode/panel.gc' },
      projectSafeZ: calculateProjectSafeZ({
        workpieceHeightMm: 24,
        workZeroReference: 'bottom',
        safeZClearanceMm: 5,
      }),
    };
    expect(startRunHistory(job, {}, '2026-07-26T12:00:00.000Z').safeZSnapshot)
      .toMatchObject({ stockTopWorkZ: 24, safeZClearanceMm: 5, effectiveSafeZ: 29 });
  });

  it('routes start, Bounding Box, Aircut, recovery, and Safe Jog through the shared value', () => {
    expect(previewHtml).toContain('id="safe-z-clearance"');
    expect(previewHtml).toContain('id="effective-safe-z"');
    expect(previewHtml).not.toContain('id="run-safe-start-z"');
    expect(previewHtml).not.toContain('id="recovery-safe-z"');
    expect(previewHtml).not.toContain('id="safe-z"');
    expect(previewSource).toMatch(/safeStartZ: projectSafeZValue\(\)/);
    expect(previewSource).toMatch(/function generateTraceCommands\(\)[\s\S]*const safeZ = projectSafeZValue\(\)/);
    expect(previewSource).toMatch(/function generateAircutCommands\(\)[\s\S]*const safeZ = projectSafeZValue\(\)/);
    expect(previewSource).toMatch(/function recoverySafeZ\(\)[\s\S]*return projectSafeZValue\(\)/);
    expect(machineBarSource).toMatch(/activeSafeWorkZ\(\)[\s\S]*safeWorkZToMachine\(safeWorkZ\)/);
    expect(machineBarSource).toContain('Project Safe Z unresolved');
  });

  it('does not derive from or rewrite a higher CAM retract', () => {
    const source = 'G21\nG90\nG0 Z30\nG1 X10 Z-2\n';
    const unchanged = String(source);
    const safeZ = calculateProjectSafeZ({
      workpieceHeightMm: 24,
      workZeroReference: 'bottom',
      safeZClearanceMm: 5,
    });
    expect(safeZ.effectiveSafeZ).toBe(29);
    expect(source).toBe(unchanged);
    const calculator = safeZSource.slice(
      safeZSource.indexOf('export function calculateProjectSafeZ'),
      safeZSource.indexOf('export function migrateProjectSafeZ'),
    );
    expect(calculator).not.toMatch(/toolpath|gcode|zMax|maxZ/i);
  });
});
