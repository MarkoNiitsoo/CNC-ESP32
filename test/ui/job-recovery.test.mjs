import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseGCodeToToolpath } from '../../www/lib/toolpath-model.js';
import {
  activeRecoveries,
  appendFreshRestartEvent,
  buildMotionOnlyRecoveryCommands,
  normalizeRecoveries,
  planMotionOnlyRecovery,
  recoveriesForSource,
  updateRecoveryStatus,
} from '../../www/lib/job-recovery.js';
import { startRunHistory } from '../../www/lib/job-history.js';

const source = await readFile(new URL('../fixtures/simple-square.gc', import.meta.url), 'utf8');
const previewSource = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const previewHtml = await readFile(new URL('../../www/preview.html', import.meta.url), 'utf8');
const machineBarSource = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
const controllerSource = await readFile(new URL('../../www/lib/workbench-controller.js', import.meta.url), 'utf8');
const model = parseGCodeToToolpath(source);
const limits = { xMin: 0, xMax: 1625, yMin: 0, yMax: 5800, zMin: 0, zMax: 70 };
const workZeroMachine = { x: 0, y: 0, z: 35 };

function jobFor(state = 'interrupted', overrides = {}) {
  return {
    gcodePath: '/gcode/simple-square.gc',
    sourceGcodePath: '/gcode/simple-square.gc',
    activeRun: { mode: 'source', path: '/gcode/simple-square.gc', sourceFingerprint: 'size:100:fnv1a:abcd' },
    activeWorkZeroId: 'work-1',
    activeZZeroId: 'z-1',
    runHistory: [{
      id: 'run-1', state, activeRunPath: '/gcode/simple-square.gc',
      activeRunFingerprint: 'size:100:fnv1a:abcd', zeroId: 'work-1', zZeroId: 'z-1',
      lastAckedLineNumber: 9, currentLineNumber: 10, lastSentLineNumber: 10,
      lastKnownPosition: { x: 10, y: 10, z: -2 },
      ...overrides,
    }],
  };
}

function plan(job = jobFor(), options = {}) {
  return planMotionOnlyRecovery({ job, toolpathModel: model, safeZ: 15, limits, workZeroMachine, positionTrusted: true, workZeroFrameMatches: true, ...options });
}

describe('motion-only recovery planner', () => {
  it('finds a previous safe point for interrupted and stopped runs', () => {
    for (const state of ['interrupted', 'stopped', 'error']) {
      const result = plan(jobFor(state));
      expect(result.status).toBe('available');
      expect(result.resumeCandidate.position.z).toBe(15);
      expect(result.resumeCandidate.lineNumber).toBeLessThanOrEqual(9);
    }
  });

  it('returns not_available for a completed run', () => {
    expect(plan(jobFor('completed')).status).toBe('not_available');
  });

  it('can open an older interruption after newer history entries exist', () => {
    const job = jobFor('interrupted');
    job.runHistory.push({ id: 'run-2', state: 'completed' });
    normalizeRecoveries(job);

    expect(plan(job, { recoveryId: 'recovery-run-1' })).toMatchObject({
      status: 'available',
      run: { id: 'run-1' },
      recovery: { runId: 'run-1' },
    });
  });

  it('uses acknowledged progress before current or sent progress', () => {
    const result = plan(jobFor('stopped', {
      lastAckedLineNumber: 7,
      currentLineNumber: 11,
      lastSentLineNumber: 12,
    }));
    expect(result.interruption.lineNumber).toBe(7);
    expect(result.run).toMatchObject({ lastAckedLineNumber: 7, lastSentLineNumber: 12 });
    expect(result.visual.completedSegments.every((segment) => segment.commandNumber <= 7)).toBe(true);
  });

  it('blocks missing inputs, fingerprint mismatch, and missing safe points', () => {
    expect(planMotionOnlyRecovery({ job: {}, toolpathModel: model, limits, positionTrusted: true }).status).toBe('blocked');
    expect(planMotionOnlyRecovery({ job: jobFor(), toolpathModel: null, limits, positionTrusted: true }).status).toBe('blocked');
    expect(plan(jobFor('error', { activeRunFingerprint: 'size:101:fnv1a:ffff' })).blockingReasons.map((x) => x.id)).toContain('fingerprintMismatch');
    expect(plan(jobFor('error', { activeRunPath: '' })).blockingReasons.map((x) => x.id)).toContain('runActivePathMissing');
    expect(plan(jobFor('error', { activeRunMode: 'generated' })).blockingReasons.map((x) => x.id)).toContain('activeRunMode');
    const unsafeModel = { segments: [{ commandNumber: 1, lineNumber: 1, from: { x: 1, y: 1, z: -2 }, to: { x: 2, y: 2, z: -2 } }] };
    expect(planMotionOnlyRecovery({ job: jobFor('error', { lastAckedLineNumber: 1 }), toolpathModel: unsafeModel, safeZ: 15, limits, positionTrusted: true }).blockingReasons.map((x) => x.id)).toContain('safePoint');
  });

  it('blocks work-zero changes, warns for Z-zero changes, and blocks missing progress', () => {
    expect(plan(jobFor('stopped', { zeroId: 'old-work' })).blockingReasons.map((x) => x.id)).toContain('workZeroMismatch');
    const zChanged = plan(jobFor('stopped', { zZeroId: 'old-z' }));
    expect(zChanged.status).toBe('available');
    expect(zChanged.zZeroChanged).toBe(true);
    expect(zChanged.warnings.map((x) => x.id)).toContain('zZeroChanged');
    const noProgress = jobFor('stopped', {
      lastAckedLineNumber: null,
      currentLineNumber: null,
      lastSentLineNumber: null,
    });
    expect(plan(noProgress).blockingReasons.map((x) => x.id)).toContain('interruptionLine');
  });

  it('blocks stale or invalid generated runs without falling back to source', () => {
    for (const status of ['stale', 'invalid', 'pending', 'missing']) {
      const job = jobFor('stopped');
      job.generatedRunPath = '/jobs/generated/simple-square.run.gc';
      job.placement = { generatedRunPath: job.generatedRunPath, dirty: status === 'pending' };
      job.activeRun = {
        mode: 'generated', path: job.generatedRunPath,
        generatedFingerprint: 'size:100:fnv1a:abcd', transformFingerprint: 'transform-a',
      };
      job.generatedValidation = {
        status, generatedFingerprint: 'size:100:fnv1a:abcd', transformFingerprint: 'transform-a',
      };
      job.runHistory[0].activeRunPath = job.generatedRunPath;
      job.runHistory[0].activeRunMode = 'generated';
      const result = plan(job);
      expect(result.status).toBe('blocked');
      expect(result.activeRunPath).toBe(job.generatedRunPath);
      expect(result.blockingReasons.map((x) => x.id)).toContain('generatedValidation');
    }
  });

  it('splits completed/remaining geometry and creates safe-Z markers/travel', () => {
    const result = plan();
    expect(result.visual.completedSegments.every((segment) => segment.commandNumber <= 9)).toBe(true);
    expect(result.visual.remainingSegments.every((segment) => segment.commandNumber > 9)).toBe(true);
    expect(result.visual.interruptionMarker).toBeTruthy();
    expect(result.visual.resumeMarker).toEqual(result.resumeCandidate.position);
    expect(result.visual.recoveryTravelPath.every((point) => point.z === 15)).toBe(true);
  });

  it('blocks untrusted position and targets outside limits', () => {
    expect(plan(jobFor(), { positionTrusted: false }).blockingReasons.map((x) => x.id)).toContain('positionUntrusted');
    expect(plan(jobFor(), { limits: { ...limits, xMin: 1 } }).blockingReasons.map((x) => x.id)).toContain('limits');
  });

  it('blocks missing limits and Safe Z outside Z limits', () => {
    expect(plan(jobFor(), { limits: null }).blockingReasons.map((x) => x.id)).toContain('limitsMissing');
    expect(plan(jobFor(), { safeZ: 80 }).blockingReasons.map((x) => x.id)).toContain('safeZLimits');
  });

  it('revalidates recovery against current Project Safe Z and reports a changed snapshot', () => {
    const result = plan(jobFor('stopped', {
      safeZSnapshot: { effectiveSafeZ: 10, safeZClearanceMm: 5 },
    }), { safeZ: 15 });
    expect(result.safeZChanged).toBe(true);
    expect(result.originalSafeZ).toBe(10);
    expect(result.resumeCandidate.safeZ).toBe(15);
    expect(result.warnings.map((item) => item.id)).toContain('safeZChanged');
  });

  it('does not mutate activeRun or job execution metadata', () => {
    const job = jobFor('error');
    const before = structuredClone(job);
    plan(job);
    expect(job).toEqual(before);
  });

  it('blocks recovery motion while a machine job state is active', () => {
    expect(plan(jobFor(), { machineState: 'RUNNING' }).blockingReasons.map((x) => x.id)).toContain('machineBusy');
    expect(plan(jobFor(), { machineState: 'PAUSED' }).blockingReasons.map((x) => x.id)).toContain('machineBusy');
  });
});

describe('saved recovery collection', () => {
  it('migrates eligible legacy runs once and preserves multiple recoveries', () => {
    const job = jobFor('stopped');
    job.runHistory.push({
      ...job.runHistory[0],
      id: 'run-2',
      state: 'interrupted',
      endedAt: '2026-07-24T10:00:00.000Z',
    });

    normalizeRecoveries(job);
    normalizeRecoveries(job);

    expect(job.recoveries.map((entry) => entry.runId)).toEqual(['run-1', 'run-2']);
    expect(job.recoveries).toHaveLength(2);
  });

  it('loads metadata without a recovery collection', () => {
    const job = jobFor('completed');
    delete job.recoveries;

    expect(normalizeRecoveries(job)).toEqual([]);
    expect(job.recoveryHistory).toEqual([]);
  });

  it('abandons or marks a recovery finished without changing run history', () => {
    const job = jobFor('stopped');
    normalizeRecoveries(job);
    const originalRun = structuredClone(job.runHistory[0]);

    updateRecoveryStatus(job, 'recovery-run-1', 'abandoned', {
      now: '2026-07-25T10:00:00.000Z',
      note: 'Operator will recut.',
    });

    expect(activeRecoveries(job)).toEqual([]);
    expect(job.runHistory[0]).toEqual(originalRun);
    expect(job.recoveryHistory.at(-1)).toMatchObject({
      type: 'recovery-status',
      runId: 'run-1',
      status: 'abandoned',
    });

    updateRecoveryStatus(job, 'recovery-run-1', 'marked_finished', {
      now: '2026-07-25T10:01:00.000Z',
    });
    expect(job.runHistory[0]).toEqual(originalRun);
    expect(job.recoveryHistory).toHaveLength(2);
  });

  it('starts a new same-file run from the beginning without closing the old recovery', () => {
    const job = jobFor('stopped');
    normalizeRecoveries(job);
    const recovery = recoveriesForSource(job, '/gcode/simple-square.gc')[0];
    const oldRun = structuredClone(job.runHistory[0]);

    appendFreshRestartEvent(job, recovery.id, {
      now: '2026-07-26T10:00:00.000Z',
      executionTarget: '/gcode/simple-square.gc',
    });
    const fresh = startRunHistory(job, {}, '2026-07-26T10:00:01.000Z');

    expect(fresh.id).not.toBe(oldRun.id);
    expect(job.runHistory[0]).toEqual(oldRun);
    expect(activeRecoveries(job).map((entry) => entry.id)).toContain(recovery.id);
    expect(job.recoveryHistory.at(-1)).toMatchObject({
      type: 'recovery-fresh-restart',
      recoveryId: recovery.id,
      runId: oldRun.id,
    });
  });

  it('does not apply job A recoveries to selected job B', () => {
    const jobA = jobFor('stopped');
    normalizeRecoveries(jobA);
    const jobB = {
      gcodePath: '/gcode/job-b.gc',
      sourceGcodePath: '/gcode/job-b.gc',
      runHistory: [],
      recoveries: [],
    };

    expect(recoveriesForSource(jobB, '/gcode/job-b.gc')).toEqual([]);
    startRunHistory(jobB, {}, '2026-07-26T11:00:00.000Z');
    expect(activeRecoveries(jobA)).toHaveLength(1);
  });

  it('offers explicit Review, Restart, and Cancel choices without auto-resuming', () => {
    expect(previewHtml).toContain('id="interrupted-start-dialog"');
    expect(previewHtml).toContain('Review / Resume Recovery');
    expect(previewHtml).toContain('Restart From Beginning');
    expect(previewHtml).toContain('>Cancel</button>');
    expect(previewSource).toMatch(/choice === 'review'[\s\S]*selectedRecoveryId = recovery\.id[\s\S]*refreshRecoveryPlan/);
    expect(previewSource).toMatch(/choice !== 'restart'[\s\S]*return[\s\S]*appendFreshRestartEvent[\s\S]*await startJobRun/);
  });
});

describe('motion-only recovery commands', () => {
  it('lifts before XY and contains no cutting, homing, machine-coordinate, or zero commands', () => {
    const result = buildMotionOnlyRecoveryCommands(plan(), { positionTrusted: true, limits, workZeroMachine });
    expect(result.ok).toBe(true);
    expect(result.commands[0]).toBe('M5');
    expect(result.commands).toEqual(expect.arrayContaining(['G21', 'G90', 'G54', 'G0 Z15 F400', 'G0 X0 Y0 F3000', 'M400']));
    expect(result.commands.findIndex((cmd) => cmd.startsWith('G0 Z'))).toBeLessThan(result.commands.findIndex((cmd) => cmd.startsWith('G0 X')));
    expect(result.commands.join('\n')).not.toMatch(/\b(G28|G53|G92|M3|M4)\b/);
    expect(result.commands.filter((cmd) => /\bZ-/.test(cmd))).toHaveLength(0);
  });

  it('does not generate commands for untrusted or out-of-bounds motion', () => {
    expect(buildMotionOnlyRecoveryCommands(plan(), { positionTrusted: false, limits, workZeroMachine }).ok).toBe(false);
    expect(buildMotionOnlyRecoveryCommands(plan(), { positionTrusted: true, limits: { ...limits, xMin: 1 }, workZeroMachine }).ok).toBe(false);
  });

  it('blocks motion until the saved zero is restored into the current Home All session', () => {
    expect(plan(jobFor(), { workZeroFrameMatches: false }).blockingReasons.map((x) => x.id)).toContain('workZeroFrame');
  });
});

describe('motion-only recovery UI safety contract', () => {
  it('keeps motion-only recovery distinct from the guarded cutting resume action', () => {
    expect(previewHtml).toContain('data-preview-tab-button="recovery"');
    expect(previewHtml).toContain('id="move-to-resume-point"');
    expect(previewHtml).toContain('Show Recovery Overlay');
    expect(previewHtml).toContain('Hide Recovery');
    expect(previewHtml).toMatch(/id="move-to-resume-point"[^>]*>Move Axes to Resume Point<\/button>/);
    expect(previewHtml).toContain('class="production-resume-panel"');
    expect(controllerSource).toContain("'recovery'");
    expect(previewHtml).toContain('id="recovery-collection"');
    expect(previewSource).toContain('Review / Resume');
    expect(previewSource).toContain('Abandon Recovery');
    expect(previewSource).toContain('Mark as Finished');
    expect(previewSource).toContain('recoveryId: selectedRecoveryId');
  });

  it('requires session position trust and clears it on firmware reboot', () => {
    expect(previewSource).toContain("const positionTrustKey = 'lowrider.positionTrust'");
    expect(previewSource).toContain('sessionStorage.setItem(positionTrustKey');
    expect(previewSource).toMatch(/uptime < positionTrust\.bootUptimeMs[\s\S]*setPositionTrust\(false, 'firmware-reboot'\)/);
    expect(machineBarSource).toContain("detail: { trusted: frame.trusted === true, fullHoming, homingEpoch: frame.homingEpoch");
    expect(machineBarSource).toMatch(/home\('G28',[\s\S]*true\)/);
  });

  it('sends generated recovery commands one at a time and records a recovery event', () => {
    expect(previewSource).toMatch(/for \(const command of generated\.commands\)[\s\S]*await sendCmd\(command\)/);
    expect(previewSource).toContain('appendMotionOnlyRecoveryEvent');
    expect(previewSource).not.toMatch(/runMotionOnlyRecoveryMove[\s\S]{0,2500}\/api\/job\/start/);
    expect(previewSource).toContain("recordRecoveryMove('completed', sent)");
    expect(previewSource).toContain("recordRecoveryMove('blocked', [], reason)");
  });

  it('adds firmware-compatible command numbers to parsed segments', () => {
    expect(model.segments.every((segment) => Number.isFinite(segment.commandNumber))).toBe(true);
    expect(model.segments[0].commandNumber).toBeGreaterThan(0);
  });
});
