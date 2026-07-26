import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseGCodeToToolpath } from '../../www/lib/toolpath-model.js';
import {
  buildProductionResumeCommands,
  buildProductionResumePlan,
  buildToollessResumePlan,
  planMotionOnlyRecovery,
} from '../../www/lib/job-recovery.js';
import {
  appendProductionResumeEvent,
  finishProductionResumeEvent,
  markProductionResumePrepared,
  markProductionResumeRouterConfirmed,
} from '../../www/lib/job-history.js';

const source = await readFile(new URL('../fixtures/simple-square.gc', import.meta.url), 'utf8');
const previewSource = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const previewHtml = await readFile(new URL('../../www/preview.html', import.meta.url), 'utf8');
const machineBar = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
const model = parseGCodeToToolpath(source);
const limits = { xMin: 0, xMax: 1625, yMin: 0, yMax: 5800, zMin: 0, zMax: 70 };
const workZeroMachine = { x: 0, y: 0, z: 35 };
const checklist = {
  materialUnmoved: true, toolAndZeroCorrect: true, routerReady: true,
};

function jobFor(overrides = {}) {
  return {
    gcodePath: '/gcode/simple-square.gc', sourceGcodePath: '/gcode/simple-square.gc',
    activeRun: { mode: 'source', path: '/gcode/simple-square.gc', sourceFingerprint: 'fp-a' },
    activeWorkZeroId: 'work-1', activeZZeroId: 'z-1',
    runHistory: [{
      id: 'run-1', state: 'interrupted', activeRunMode: 'source', activeRunPath: '/gcode/simple-square.gc',
      activeRunFingerprint: 'fp-a', zeroId: 'work-1', zZeroId: 'z-1', lastAckedLineNumber: 9,
      lastSentLineNumber: 10, lastKnownPosition: { x: 10, y: 10, z: -2 }, ...overrides,
    }],
  };
}

function production(job = jobFor(), options = {}) {
  const recovery = planMotionOnlyRecovery({
    job, toolpathModel: model, safeZ: 15, limits, workZeroMachine, positionTrusted: true, workZeroFrameMatches: true,
    ...(options.recovery || {}),
  });
  return {
    recovery,
    plan: buildProductionResumePlan(recovery, model, {
      limits, workZeroMachine, travelFeedMmMin: 3000, zFeedMmMin: 400, checklist,
      ...(options.production || {}),
    }),
  };
}

describe('Guarded Production Resume planner', () => {
  it('is available only for a recoverable matching run with complete checklist', () => {
    const { plan } = production();
    expect(plan.status).toBe('available');
    expect(plan.mode).toBe('production-resume');
    expect(plan.minZ).toBe(-2);
    expect(plan.checklist).toMatchObject(checklist);
    expect(production(jobFor({ state: 'completed' })).plan.status).toBe('blocked');
  });

  it('blocks activeRun, generated validation, work-zero, trust, and checklist failures', () => {
    expect(production(jobFor({ activeRunPath: '/gcode/other.gc' })).plan.status).toBe('blocked');
    expect(production(jobFor({ zeroId: 'old-work' })).plan.blockingReasons.map((item) => item.id)).toContain('workZeroMismatch');
    expect(production(jobFor(), { recovery: { positionTrusted: false } }).plan.status).toBe('blocked');
    expect(production(jobFor(), { production: { checklist: {} } }).plan.blockingReasons.map((item) => item.id)).toContain('checklist');

    const generated = jobFor({ activeRunMode: 'generated', activeRunPath: '/jobs/generated/test.run.gc' });
    generated.generatedRunPath = '/jobs/generated/test.run.gc';
    generated.placement = { generatedRunPath: generated.generatedRunPath };
    generated.activeRun = { mode: 'generated', path: generated.generatedRunPath, generatedFingerprint: 'fp-a' };
    generated.generatedValidation = { status: 'stale', generatedFingerprint: 'fp-a' };
    expect(production(generated).plan.blockingReasons.map((item) => item.id)).toContain('generatedValidation');
  });

  it('allows intentional Z-zero change only after two extra acknowledgements', () => {
    const changedJob = jobFor({ zZeroId: 'old-z' });
    const recovery = production(changedJob).recovery;
    expect(recovery.status).toBe('available');
    expect(recovery.zZeroChanged).toBe(true);
    expect(buildToollessResumePlan(recovery, model, { limits, workZeroMachine }).status).toBe('available');

    const missingAck = production(changedJob).plan;
    expect(missingAck.status).toBe('blocked');
    expect(missingAck.missingChecklist).toEqual(expect.arrayContaining(['toolChangeIntentional', 'newZZeroCorrect']));
    const acknowledged = production(changedJob, {
      production: { checklist: { ...checklist, toolChangeIntentional: true, newZZeroCorrect: true } },
    }).plan;
    expect(acknowledged.status).toBe('available');
    expect(acknowledged.zZeroChangeAcknowledged).toBe(true);
    expect(acknowledged).toMatchObject({ previousZZeroId: 'old-z', currentZZeroId: 'z-1' });
  });

  it('enforces XY/Z limits and reports minimum Z', () => {
    expect(production(jobFor(), { production: { limits: { ...limits, zMin: 34 } } }).plan.blockingReasons.map((item) => item.id)).toContain('pathLimits');
    expect(production(jobFor(), { production: { limits: { ...limits, xMax: 5 } } }).plan.blockingReasons.map((item) => item.id)).toContain('pathLimits');
    expect(production(jobFor(), { production: { limits: null } }).plan.blockingReasons.map((item) => item.id)).toContain('limitsMissing');
  });
});

describe('two-phase Production Resume commands', () => {
  it('Phase 1 repositions at Safe Z and ends before cutting motion', () => {
    const { plan } = production();
    const phase1 = buildProductionResumeCommands(plan, 'phase1');
    expect(phase1.ok).toBe(true);
    expect(phase1.commands).toEqual(['M5', 'G21', 'G90', 'G54', 'G0 Z15 F400', 'G0 X0 Y0 F3000', 'M400']);
    expect(phase1.commands.join('\n')).not.toMatch(/Z-/);
  });

  it('Phase 2 requires manual checkpoint and follows only remaining X/Y/Z', () => {
    const waiting = production().plan;
    expect(buildProductionResumeCommands(waiting, 'phase2').ok).toBe(false);
    const ready = production(jobFor(), { production: { phase1Complete: true, manualRouterConfirmed: true } }).plan;
    const phase2 = buildProductionResumeCommands(ready, 'phase2');
    expect(phase2.ok).toBe(true);
    expect(phase2.commands.slice(0, 4)).toEqual(['G21', 'G90', 'G54', 'G0 Z5 F400']);
    expect(phase2.commands).toContain('G1 Z-2 F300');
    expect(phase2.commands.join('\n')).not.toMatch(/\b(G28|G53|G92|M3|M4)\b/);
    expect(ready.remainingSegments.every((segment) => segment.commandNumber > ready.startLineNumber)).toBe(true);
  });
});

describe('Production Resume history and UI guards', () => {
  it('records checklist and Z-zero metadata without mutating original run', () => {
    const job = jobFor({ zZeroId: 'old-z' });
    const event = appendProductionResumeEvent(job, {
      runId: 'run-1', activeRunPath: '/gcode/simple-square.gc', activeRunMode: 'source',
      startLineNumber: 6, resumePoint: { x: 0, y: 0, z: 15 }, safeZ: 15, minZ: -2,
      commandsCount: 15, checklist, zZeroChanged: true, previousZZeroId: 'old-z',
      currentZZeroId: 'z-1', zZeroChangeAcknowledged: true,
    });
    markProductionResumePrepared(event, '2026-07-03T10:01:00.000Z');
    markProductionResumeRouterConfirmed(event, {
      confirmedAt: '2026-07-03T10:02:00.000Z',
      streamPath: '/jobs/generated/simple.production-resume.gc',
    });
    finishProductionResumeEvent(event, { state: 'completed', commandsSent: 15 });
    expect(event).toMatchObject({
      type: 'production-resume', state: 'completed', zZeroChanged: true,
      previousZZeroId: 'old-z', currentZZeroId: 'z-1', zZeroChangeAcknowledged: true,
      manualRouterConfirmedAt: '2026-07-03T10:02:00.000Z',
      streamPath: '/jobs/generated/simple.production-resume.gc',
    });
    expect(event.checklist).toMatchObject(checklist);
    expect(job.runHistory[0].state).toBe('interrupted');
  });

  it('distinguishes all three tiers and requires a real hold gesture', () => {
    expect(previewHtml).toContain('Move Axes to Resume Point');
    expect(previewHtml).toContain('Advanced: test remaining path without tool');
    expect(previewHtml).toContain('Production Resume');
    expect(previewHtml).toContain('Hold to Resume Cutting');
    expect(previewHtml).toContain('Router state is ready and understood');
    expect(previewHtml).toContain('Tool was changed or Z zero was re-touched intentionally');
    expect(previewSource).toContain('setTimeout(() =>');
    expect(previewSource).toContain('}, 1500)');
    expect(previewSource).toContain('productionContextSignature');
    expect(previewSource).toMatch(/continueProductionResume[\s\S]*startProductionResumeStream\(generated\.commands\)/);
    expect(previewSource).toContain("fetch('/api/recovery/production/start'");
    expect(previewSource).toContain("activeTestMotion = { mode: 'production-resume', path }");
    expect(previewSource).not.toMatch(/continueProductionResume[\s\S]{0,2500}sendProductionCommands\(generated\.commands/);
    expect(previewHtml).toContain('the ESP32 owns the cutting stream');
    expect(machineBar).toContain("detail: { type: 'pause' }");
    expect(machineBar).toContain("detail: { type: 'stop' }");
    expect(machineBar).not.toContain("detail: { type: 'm5' }");
  });
});
