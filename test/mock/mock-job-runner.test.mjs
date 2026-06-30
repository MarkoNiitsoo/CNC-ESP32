import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MockJobRunner } from '../../dev/mock-job-runner.mjs';
import { MockMarlin } from '../../dev/mock-marlin.mjs';
import { MockSD } from '../../dev/mock-sd.mjs';

const roots = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture({ gcode, gcodePath = '/gcode/job.gc', mode = 'source', validation = 'valid', delay = 1 } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cnc-mock-runner-'));
  roots.push(root);
  const sd = new MockSD(root);
  await sd.ensure();
  await sd.writeText(gcodePath, gcode || 'G21\nG90\nG0 Z15\nG1 X20 Y20\n');
  const sourcePath = mode === 'source' ? gcodePath : '/gcode/source.gc';
  if (mode === 'generated') await sd.writeText(sourcePath, 'G21\nG90\n');
  const fingerprint = 'test-fingerprint';
  const job = {
    gcodePath: sourcePath,
    sourceGcodePath: sourcePath,
    placement: mode === 'generated' ? { rotationDeg: 90, generatedRunPath: gcodePath, dirty: validation !== 'valid' } : { rotationDeg: 0 },
    activeRun: { mode, path: gcodePath, generatedFingerprint: mode === 'generated' ? fingerprint : '', sourceFingerprint: mode === 'source' ? fingerprint : '', transformFingerprint: 'transform' },
    generatedValidation: mode === 'generated' ? { status: validation, generatedFingerprint: fingerprint, transformFingerprint: 'transform' } : null,
    arm: { state: 'ARMED', activeRunMode: mode, activeRunPath: gcodePath, activeRunFingerprint: fingerprint, transformFingerprint: mode === 'generated' ? 'transform' : '' },
    feedOverride: { startPercent: 100, resetTo100AfterJob: true },
  };
  const jobPath = '/jobs/job.job.json';
  await sd.writeText(jobPath, JSON.stringify(job));
  const marlin = new MockMarlin();
  const runner = new MockJobRunner({ sd, marlin, lineDelayMs: delay });
  return { sd, marlin, runner, job, jobPath, gcodePath, request: { gcodePath, jobPath, activeRunMode: mode, activeRunFingerprint: fingerprint } };
}

async function waitForState(runner, states, timeout = 1000) {
  const expected = new Set(Array.isArray(states) ? states : [states]);
  const started = Date.now();
  while (!expected.has(runner.status.state) && Date.now() - started < timeout) await wait(5);
  return runner.status.state;
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('MockJobRunner', () => {
  it('streams an armed source job to completion', async () => {
    const ctx = await fixture();
    await ctx.runner.start(ctx.request);
    expect(await waitForState(ctx.runner, 'COMPLETED')).toBe('COMPLETED');
    expect(ctx.runner.status.acknowledgedLineCount).toBeGreaterThan(0);
    expect(ctx.runner.status.gcodePath).toBe('/gcode/job.gc');
  });

  it('streams the exact generated active run and blocks stale generated state', async () => {
    const valid = await fixture({ mode: 'generated', gcodePath: '/jobs/generated/job.run.gc' });
    await valid.runner.start(valid.request);
    expect(await waitForState(valid.runner, 'COMPLETED')).toBe('COMPLETED');
    expect(valid.runner.status.gcodePath).toBe('/jobs/generated/job.run.gc');

    const stale = await fixture({ mode: 'generated', validation: 'stale', gcodePath: '/jobs/generated/stale.run.gc' });
    await expect(stale.runner.start(stale.request)).rejects.toThrow(/not valid|stale/i);
  });

  it('does not silently fall back to source after a transformed run is missing', async () => {
    const ctx = await fixture({ mode: 'generated', gcodePath: '/jobs/generated/missing.run.gc' });
    await ctx.sd.delete(ctx.gcodePath);
    await expect(ctx.runner.start(ctx.request)).rejects.toThrow();
    expect(ctx.marlin.log).toHaveLength(0);
  });

  it('enters ERROR on a dangerous Z move', async () => {
    const ctx = await fixture({ gcode: 'G21\nG90\nG1 Z-45 F200\n' });
    await ctx.runner.start(ctx.request);
    expect(await waitForState(ctx.runner, 'ERROR')).toBe('ERROR');
    expect(ctx.runner.status.lastError).toMatch(/soft limit.*Z/i);
  });

  it('pauses, resumes, and stops without continuing the stream', async () => {
    const lines = ['G21', 'G90', ...Array.from({ length: 80 }, (_, index) => `G1 X${index + 1} Y1 F600`)].join('\n');
    const ctx = await fixture({ gcode: lines, delay: 5 });
    await ctx.runner.start(ctx.request);
    await wait(20);
    ctx.runner.pause();
    const pausedAt = ctx.runner.status.sentLineCount;
    await wait(30);
    expect(ctx.runner.status.sentLineCount).toBe(pausedAt);
    ctx.runner.resume();
    await wait(20);
    ctx.runner.stop();
    const stoppedAt = ctx.runner.status.sentLineCount;
    await wait(30);
    expect(ctx.runner.status.state).toBe('STOPPED');
    expect(ctx.runner.status.sentLineCount).toBe(stoppedAt);
    expect(ctx.marlin.spindleOff).toBe(true);
  });

  it('supports priority M5 and live feed override while running', async () => {
    const lines = ['G21', 'G90', ...Array.from({ length: 40 }, (_, index) => `G1 X${index + 1}`)].join('\n');
    const ctx = await fixture({ gcode: lines, delay: 5 });
    await ctx.runner.start(ctx.request);
    ctx.marlin.execute('M3');
    expect(ctx.marlin.spindleOff).toBe(false);
    ctx.marlin.execute('M5', { priority: true });
    expect(ctx.marlin.spindleOff).toBe(true);
    ctx.runner.setFeedOverride(75);
    expect(ctx.runner.status.feedOverridePercent).toBe(75);
    ctx.runner.stop();
  });
});
