import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseGCodeToToolpath } from '../../www/lib/toolpath-model.js';
import {
  buildToollessResumeCommands,
  buildToollessResumePlan,
  planMotionOnlyRecovery,
} from '../../www/lib/job-recovery.js';
import { appendToollessResumeEvent, finishToollessResumeEvent } from '../../www/lib/job-history.js';

const source = await readFile(new URL('../fixtures/simple-square.gc', import.meta.url), 'utf8');
const arcSource = await readFile(new URL('../fixtures/arc-g2-g3.gc', import.meta.url), 'utf8');
const previewSource = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const previewHtml = await readFile(new URL('../../www/preview.html', import.meta.url), 'utf8');
const machineBar = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
const model = parseGCodeToToolpath(source);
const limits = { xMin: 0, xMax: 1625, yMin: 0, yMax: 5800, zMin: 0, zMax: 70 };
const workZeroMachine = { x: 0, y: 0, z: 35 };

function jobFor(overrides = {}) {
  return {
    gcodePath: '/gcode/simple-square.gc',
    sourceGcodePath: '/gcode/simple-square.gc',
    activeRun: { mode: 'source', path: '/gcode/simple-square.gc', sourceFingerprint: 'fp-a' },
    activeWorkZeroId: 'work-1', activeZZeroId: 'z-1',
    runHistory: [{
      id: 'run-1', state: 'interrupted', activeRunMode: 'source', activeRunPath: '/gcode/simple-square.gc',
      activeRunFingerprint: 'fp-a', zeroId: 'work-1', zZeroId: 'z-1', lastAckedLineNumber: 9,
      lastSentLineNumber: 10, lastKnownPosition: { x: 10, y: 10, z: -2 }, ...overrides,
    }],
  };
}

function plans(job = jobFor(), toolpathModel = model, optionOverrides = {}) {
  const recovery = planMotionOnlyRecovery({
    job, toolpathModel, safeZ: 15, limits, workZeroMachine, positionTrusted: true, workZeroFrameMatches: true,
    ...optionOverrides,
  });
  const toolless = buildToollessResumePlan(recovery, toolpathModel, {
    limits, workZeroMachine, travelFeedMmMin: 3000, zFeedMmMin: 400,
  });
  return { recovery, toolless };
}

describe('Toolless Resume Test planner and commands', () => {
  it('repositions safely and then follows remaining real Z path', () => {
    const { toolless } = plans();
    expect(toolless.status).toBe('available');
    expect(toolless.mode).toBe('toolless-resume-test');
    expect(toolless.startLineNumber).toBe(6);
    expect(toolless.minZ).toBe(-2);
    expect(toolless.firstZDescent).toMatchObject({ lineNumber: 7, fromZ: 5, toZ: -2 });
    expect(toolless.commands.slice(0, 7)).toEqual([
      'M5', 'G21', 'G90', 'G54', 'G0 Z15 F400', 'G0 X0 Y0 F3000', 'G0 Z5 F400',
    ]);
    expect(toolless.commands).toContain('G1 Z-2 F300');
    expect(toolless.commands.slice(-2)).toEqual(['M5', 'M400']);
  });

  it('starts after the safe candidate and does not include pre-resume segments', () => {
    const { toolless } = plans();
    expect(toolless.remainingSegments.every((segment) => segment.commandNumber > toolless.startLineNumber)).toBe(true);
    expect(toolless.commands.filter((command) => command === 'G0 Z5 F400')).toHaveLength(1);
  });

  it('blocks missing candidate, trust/identity mismatch, and stale generated runs through Recovery V0', () => {
    expect(buildToollessResumePlan({ status: 'blocked', blockingReasons: [], resumeCandidate: null }, model, { limits }).status).toBe('blocked');
    expect(plans(jobFor({ activeRunPath: '/gcode/other.gc' })).toolless.status).toBe('blocked');
    expect(plans(jobFor(), model, { positionTrusted: false }).toolless.status).toBe('blocked');

    const generatedJob = jobFor({ activeRunMode: 'generated', activeRunPath: '/jobs/generated/test.run.gc' });
    generatedJob.generatedRunPath = '/jobs/generated/test.run.gc';
    generatedJob.placement = { generatedRunPath: generatedJob.generatedRunPath };
    generatedJob.activeRun = { mode: 'generated', path: generatedJob.generatedRunPath, generatedFingerprint: 'fp-a' };
    generatedJob.generatedValidation = { status: 'stale', generatedFingerprint: 'fp-a' };
    expect(plans(generatedJob).toolless.blockingReasons.map((item) => item.id)).toContain('generatedValidation');
  });

  it('blocks changed work zero, warns for changed Z zero, and enforces Z limits', () => {
    expect(plans(jobFor({ zeroId: 'old-work' })).toolless.status).toBe('blocked');
    const zChanged = plans(jobFor({ zZeroId: 'old-z' })).toolless;
    expect(zChanged.status).toBe('available');
    expect(zChanged.warnings.join(' ')).toMatch(/real cutting resume would require confirmation/);
    const recovery = plans().recovery;
    expect(buildToollessResumePlan(recovery, model, { limits: null }).status).toBe('blocked');
    expect(buildToollessResumePlan(recovery, model, { limits: { ...limits, zMin: -1 } }).blockingReasons.map((item) => item.id)).toContain('pathLimits');
  });

  it('preserves arcs as native G2/G3 commands and feed', () => {
    const arcModel = parseGCodeToToolpath(arcSource);
    const arcJob = jobFor({ lastAckedLineNumber: 6, lastSentLineNumber: 7 });
    const { toolless } = plans(arcJob, arcModel);
    expect(toolless.warnings.join(' ')).toMatch(/native Marlin arc commands/);
    expect(toolless.commands.some((command) => command.startsWith('G2 '))).toBe(true);
    expect(toolless.commands.some((command) => command.startsWith('G3 '))).toBe(true);
    expect(toolless.commands.filter((command) => /^G[23] /.test(command))).toHaveLength(2);
    expect(toolless.commands.some((command) => / F600$/.test(command))).toBe(true);
  });

  it('never generates homing, machine-coordinate, zero, or spindle-start commands', () => {
    const { toolless } = plans();
    const generated = buildToollessResumeCommands(toolless, { travelFeedMmMin: 3000, zFeedMmMin: 400 });
    expect(generated.ok).toBe(true);
    expect(generated.commands.join('\n')).not.toMatch(/\b(G28|G53|G92|M3|M4)\b/);
    expect(previewSource).not.toMatch(/startToollessResumeTest[\s\S]{0,5000}\/api\/job\/start/);
    const unsupported = parseGCodeToToolpath('G21\nG90\nG0 Z5\nG53 X0\nG1 X10 F300\n');
    expect(buildToollessResumePlan(plans().recovery, unsupported, { limits }).blockingReasons.map((item) => item.id)).toContain('unsafeSource');
  });
});

describe('Toolless Resume Test history and UI', () => {
  it('records lifecycle without changing the interrupted run', () => {
    const job = jobFor();
    const event = appendToollessResumeEvent(job, {
      runId: 'run-1', activeRunPath: '/gcode/simple-square.gc', activeRunMode: 'source',
      startLineNumber: 6, resumePoint: { x: 0, y: 0, z: 15 }, safeZ: 15, minZ: -2, commandsCount: 12,
    });
    finishToollessResumeEvent(event, { state: 'completed', commandsSent: 12 });
    expect(event).toMatchObject({ type: 'toolless-resume-test', productionResume: false, state: 'completed', minZ: -2, startLineNumber: 6 });
    expect(job.runHistory[0].state).toBe('interrupted');
  });

  it('uses explicit no-cutter wording and only explicit critical controls cancel recovery', () => {
    expect(previewHtml).toContain('Toolless Resume Test');
    expect(previewHtml).toContain('No cutter/router installed. Spindle stays off. This follows the real Z path.');
    expect(previewHtml).toMatch(/id="toolless-resume-start"[^>]*>Toolless Resume From Point<\/button>/);
    expect(previewHtml).toContain('class="production-resume-panel"');
    expect(machineBar).toContain("detail: { type: 'pause' }");
    expect(machineBar).toContain("detail: { type: 'stop' }");
    expect(machineBar).toContain("detail: { type: 'm5' }");
    expect(previewSource).toContain("addEventListener('cnc-critical-control'");
    expect(previewSource).toContain("fetch('/api/jog/stop', { method: 'POST' })");
    expect(previewSource).toContain("fetch('/api/test-motion/start'");
    expect(previewSource).not.toMatch(/startToollessResumeTest[\s\S]{0,5000}for \(const command of plan\.commands\)/);
    const visibilityHandler = previewSource.slice(
      previewSource.indexOf("document.addEventListener('visibilitychange'"),
      previewSource.indexOf("addEventListener('cnc-motion-settings-change'"),
    );
    expect(visibilityHandler).not.toContain('cancelToollessResumeFromControl');
    expect(visibilityHandler).not.toContain('/api/job/stop');
  });
});
