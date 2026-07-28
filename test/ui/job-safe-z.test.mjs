import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  calculateProjectSafeZ,
  effectiveProjectSafeZ,
  migrateProjectSafeZ,
  updateProjectSafeZ,
  validateProjectSafeZForFrame,
} from '../../www/lib/job-safe-z.js';
import { parseGCodeToToolpath } from '../../www/lib/toolpath-model.js';
import { startRunHistory } from '../../www/lib/job-history.js';

const previewSource = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const previewHtml = await readFile(new URL('../../www/preview.html', import.meta.url), 'utf8');
const machineBarSource = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');

describe('Project Safe Z Version 2', () => {
  it('Explicit XY rapid at Z15 selects programSafeZ 15', () => {
    const model = parseGCodeToToolpath('G21\nG90\nG0 Z15\nG0 X20 Y20\nG1 Z-2 F100\n');
    expect(model.programZ).toMatchObject({
      selectedSafeZ: 15,
      selectedSource: 'rapid',
      confidence: 'high',
      highestRapidZ: 15,
      highestExplicitZ: 15,
    });
  });

  it('Pure retract fallback selects its highest explicit Z', () => {
    const model = parseGCodeToToolpath('G21\nG90\nG1 X10 Y10 Z-5 F100\nG1 Z12 F400\n');
    expect(model.programZ).toMatchObject({
      selectedSafeZ: 12,
      selectedSource: 'retract',
      confidence: 'medium',
      highestRetractZ: 12,
    });
  });

  it('Highest explicit Z is used when no rapid/retract candidate exists', () => {
    const model = parseGCodeToToolpath('G21\nG90\nG1 X10 Y10 Z8 F100\n');
    expect(model.programZ).toMatchObject({
      selectedSafeZ: 8,
      selectedSource: 'explicit',
      confidence: 'medium',
      highestExplicitZ: 8,
    });
  });

  it('Synthetic initial Z0 is not treated as explicit Safe Z', () => {
    const model = parseGCodeToToolpath('G21\nG90\nG1 X10 Y10 F100\n');
    expect(model.programZ).toMatchObject({
      selectedSafeZ: null,
      selectedSource: 'machine-max',
      confidence: 'fallback',
      highestExplicitZ: null,
      evidenceLineNumbers: [],
    });
  });

  it('G20 values are converted to millimetres', () => {
    const model = parseGCodeToToolpath('G20\nG90\nG0 Z1\n');
    expect(model.programZ.selectedSafeZ).toBeCloseTo(25.4);
  });

  it('G91 explicit Z movements are resolved correctly or rejected consistently according to current parser policy', () => {
    const model = parseGCodeToToolpath('G21\nG91\nG0 Z10\n');
    expect(model.programZ.highestExplicitZ).toBe(10);
    expect(model.unsupportedCommands.some((c) => c.command === 'G91')).toBe(true);
  });

  it('File without explicit Z uses machine maximum fallback', () => {
    const model = parseGCodeToToolpath('G21\nG90\nG1 X10 Y10 F100\n');
    const frame = { trusted: true, workZeroValid: true, workZeroMachine: { z: 25 } };
    const safeZ = calculateProjectSafeZ({
      programZ: model.programZ,
      frame,
      limits: { zMax: 70 },
    });
    expect(safeZ).toMatchObject({
      version: 2,
      source: 'machine-max',
      programSafeZ: 45,
      effectiveSafeZ: 45,
      confidence: 'fallback',
      resolved: true,
    });
  });

  it('Machine fallback converts machine maximum through active Work Zero', () => {
    const frame = { trusted: true, workZeroValid: true, workZeroMachine: { z: 20 } };
    const safeZ = calculateProjectSafeZ({ frame, limits: { zMax: 70 } });
    expect(safeZ.effectiveSafeZ).toBe(50);
  });

  it('Extra clearance defaults to 0 and adds to programSafeZ', () => {
    const model = parseGCodeToToolpath('G21\nG90\nG0 Z15\n');
    const safeZDefault = calculateProjectSafeZ({ programZ: model.programZ });
    expect(safeZDefault).toMatchObject({
      programSafeZ: 15,
      extraClearanceMm: 0,
      effectiveSafeZ: 15,
    });
    const safeZWithClearance = calculateProjectSafeZ({
      programZ: model.programZ,
      extraClearanceMm: 3.5,
    });
    expect(safeZWithClearance).toMatchObject({
      programSafeZ: 15,
      extraClearanceMm: 3.5,
      effectiveSafeZ: 18.5,
    });
  });

  it('Unreachable extra clearance is rejected without clamping', () => {
    const frame = { trusted: true, workZeroValid: true, workZeroMachine: { z: 55 } };
    const safeZ = calculateProjectSafeZ({
      programZ: { selectedSafeZ: 10, confidence: 'high' },
      extraClearanceMm: 10,
      frame,
      limits: { zMax: 70 },
    });
    expect(safeZ.resolved).toBe(false);
    expect(safeZ.effectiveSafeZ).toBeNull();
    expect(safeZ.errors.join(' ')).toMatch(/machine Z75\.0.*machine maximum is Z70\.0/);
  });

  it('Version-1 migration is idempotent and old stock fields are no longer required', () => {
    const legacyJob = {
      projectSafeZ: {
        version: 1,
        workpieceHeightMm: 24,
        workZeroReference: 'bottom',
        stockTopWorkZ: 24,
        safeZClearanceMm: 5,
        effectiveSafeZ: 29,
        resolved: true,
      },
      programZ: { selectedSafeZ: 15, confidence: 'high' },
    };
    const migrated = migrateProjectSafeZ(legacyJob);
    expect(migrated.version).toBe(2);
    expect(migrated.extraClearanceMm).toBe(14);
    expect(migrated.programSafeZ).toBe(15);
    expect(migrated.effectiveSafeZ).toBe(29);

    const once = structuredClone(legacyJob.projectSafeZ);
    migrateProjectSafeZ(legacyJob);
    expect(legacyJob.projectSafeZ).toEqual(once);
  });

  it('All shared motion consumers use the same effective Safe Z value', () => {
    expect(previewHtml).toContain('id="safe-z-clearance"');
    expect(previewHtml).toContain('id="effective-safe-z"');
    expect(previewHtml).not.toContain('id="run-safe-start-z"');
    expect(previewSource).toMatch(/safeStartZ: projectSafeZValue\(\)/);
    expect(previewSource).toMatch(/function generateTraceCommands[\s\S]*const safeZ = projectSafeZValue\(\)/);
    expect(previewSource).toMatch(/function generateAircutCommands\(\)[\s\S]*const safeZ = projectSafeZValue\(\)/);
    expect(machineBarSource).toMatch(/activeSafeWorkZ\(\)[\s\S]*safeWorkZToMachine\(safeWorkZ\)/);
  });

  it('marks dependent checks stale when clearance changes', () => {
    const job = {
      programZ: { selectedSafeZ: 15, confidence: 'high' },
      projectSafeZ: calculateProjectSafeZ({ programZ: { selectedSafeZ: 15, confidence: 'high' } }),
      verificationDecision: { result: 'complete' },
      dryRun: { lastBoundingBoxTraceStatus: 'complete', lastAircutStatus: 'complete' },
      generatedValidation: { status: 'valid' },
      recoveries: [{ id: 'recovery-1', status: 'ready' }],
      arm: { state: 'ARMED' },
    };
    updateProjectSafeZ(job, { extraClearanceMm: 5 }, { now: '2026-07-28T12:00:00.000Z' });
    expect(job.projectSafeZ.effectiveSafeZ).toBe(20);
    expect(job.verificationDecision.staleReason).toMatch(/Safe Z/);
    expect(job.dryRun).toMatchObject({
      lastBoundingBoxTraceStatus: 'stale',
      lastAircutStatus: 'stale',
    });
  });

  it('converts through Work Zero and blocks unreachable values without clamping', () => {
    const safeZ = calculateProjectSafeZ({ programZ: { selectedSafeZ: 15, confidence: 'high' }, extraClearanceMm: 5 });
    const frame = { trusted: true, workZeroValid: true, workZeroMachine: { z: 30 } };
    expect(validateProjectSafeZForFrame(safeZ, frame, { zMin: -30, zMax: 70 }))
      .toMatchObject({ ok: true, workZ: 20, machineZ: 50 });
    expect(validateProjectSafeZForFrame(safeZ, {
      ...frame, workZeroMachine: { z: 55 },
    }, { zMin: -30, zMax: 70 })).toMatchObject({ ok: false });
  });

  it('records the effective Safe Z snapshot on each run', () => {
    const job = {
      gcodePath: '/gcode/panel.gc',
      sourceGcodePath: '/gcode/panel.gc',
      activeRun: { mode: 'source', path: '/gcode/panel.gc' },
      programZ: { selectedSafeZ: 15, confidence: 'high' },
      projectSafeZ: calculateProjectSafeZ({ programZ: { selectedSafeZ: 15, confidence: 'high' }, extraClearanceMm: 5 }),
    };
    expect(startRunHistory(job, {}, '2026-07-28T12:00:00.000Z').safeZSnapshot)
      .toMatchObject({ programSafeZ: 15, extraClearanceMm: 5, effectiveSafeZ: 20 });
  });

  it('creates a new job with programZ parsing G0 Z15 and resolves projectSafeZ correctly', () => {
    const model = parseGCodeToToolpath('G21\nG90\nG0 Z15\nG0 X10 Y10\n');
    const safeZ = calculateProjectSafeZ({ programZ: model.programZ, extraClearanceMm: 0 });
    expect(safeZ.programSafeZ).toBe(15);
    expect(safeZ.extraClearanceMm).toBe(0);
    expect(safeZ.effectiveSafeZ).toBe(15);
    expect(safeZ.source).toBe('rapid');
    expect(safeZ.resolved).toBe(true);
  });

  it('newly created job extra clearance defaults to exactly 0 mm', () => {
    const newJob = {
      projectSafeZ: {
        version: 2,
        source: null,
        programSafeZ: null,
        extraClearanceMm: 0,
        effectiveSafeZ: null,
        confidence: 'fallback',
        evidence: { highestExplicitZ: null, highestRapidZ: null, highestRetractZ: null, lineNumbers: [] },
        resolved: false,
        errors: [],
      },
    };
    const migrated = migrateProjectSafeZ(newJob);
    expect(migrated.extraClearanceMm).toBe(0);
    expect(migrated.version).toBe(2);
  });

  it('machineZMax = 70 and workZeroMachineZ = 25 produces work Safe Z 45', () => {
    const frame = { trusted: true, workZeroValid: true, workZeroMachine: { z: 25 } };
    const safeZ = calculateProjectSafeZ({ frame, limits: { zMax: 70 } });
    expect(safeZ.programSafeZ).toBe(45);
    expect(safeZ.effectiveSafeZ).toBe(45);
    expect(safeZ.source).toBe('machine-max');
    expect(safeZ.resolved).toBe(true);
  });

  it('changing workZeroMachineZ from 25 to 30 recalculates Safe Z from 45 to 40', () => {
    const frame1 = { trusted: true, workZeroValid: true, workZeroMachine: { z: 25 } };
    const safeZ1 = calculateProjectSafeZ({ frame: frame1, limits: { zMax: 70 } });
    expect(safeZ1.effectiveSafeZ).toBe(45);

    const frame2 = { trusted: true, workZeroValid: true, workZeroMachine: { z: 30 } };
    const safeZ2 = calculateProjectSafeZ({ frame: frame2, limits: { zMax: 70 } });
    expect(safeZ2.effectiveSafeZ).toBe(40);
  });

  it('missing discovered zMax leaves Safe Z unresolved', () => {
    const frame = { trusted: true, workZeroValid: true, workZeroMachine: { z: 25 } };
    const safeZ = calculateProjectSafeZ({ frame, limits: { zMax: null } });
    expect(safeZ.resolved).toBe(false);
    expect(safeZ.effectiveSafeZ).toBeNull();
    expect(safeZ.errors[0]).toMatch(/waiting for a trusted machine position/);
  });

  it('stale machine-max value is not reused after frame identity changes', () => {
    const oldJob = {
      projectSafeZ: {
        version: 2,
        source: 'machine-max',
        programSafeZ: 50,
        extraClearanceMm: 0,
        effectiveSafeZ: 50,
        resolved: true,
        evidence: { frameIdentity: 'epoch-1' },
      },
    };
    const unhomedFrame = { trusted: false, workZeroValid: false };
    const recalculated = calculateProjectSafeZ({ job: oldJob, frame: unhomedFrame });
    expect(recalculated.resolved).toBe(false);
    expect(recalculated.effectiveSafeZ).toBeNull();
  });

  it('effectiveProjectSafeZ helper maintains resolved machine-max Safe Z across frame workZeroMachineZ changes', () => {
    const job = {
      programZ: { selectedSafeZ: null, selectedSource: 'machine-max', confidence: 'fallback' },
      projectSafeZ: { version: 2, extraClearanceMm: 0 },
    };
    const frame1 = { trusted: true, workZeroValid: true, workZeroMachine: { z: 25 } };
    const limits = { zMax: 70 };
    expect(effectiveProjectSafeZ(job, { frame: frame1, limits })).toBe(45);

    const frame2 = { trusted: true, workZeroValid: true, workZeroMachine: { z: 30 } };
    expect(effectiveProjectSafeZ(job, { frame: frame2, limits })).toBe(40);
  });
});
