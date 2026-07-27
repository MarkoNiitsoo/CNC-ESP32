import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { JOB_SCHEMA_VERSION } from '../../www/lib/job-workflow.js';
import {
  loadPreviewJobMetadata,
  previewMetadataWarning,
} from '../../www/lib/preview-job-metadata.js';
import { jobPathForUpload } from '../../www/lib/upload-thumbnail.js';

const previewSource = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const sourcePath = '/gcode/KAR.gc';
const jobPath = '/jobs/gcode_KAR.gc-7390e1b6.job.json';

function response(status, body = '') {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function validJob(overrides = {}) {
  return {
    schemaVersion: JOB_SCHEMA_VERSION,
    gcodePath: sourcePath,
    sourceGcodePath: sourcePath,
    jobPath,
    activeRun: { mode: 'generated', path: '/jobs/generated/KAR.run.gc' },
    placement: { rotationDeg: 90, originAnchor: 'center' },
    generatedValidation: { status: 'valid', generatedFingerprint: 'generated-fp' },
    workZero: { capturedAt: 'keep-work-zero' },
    toolZero: { capturedAt: 'keep-tool-zero' },
    activeWorkZeroId: 'zero-1',
    activeZZeroId: 'z-zero-1',
    zeroHistory: [{ id: 'zero-1' }],
    runHistory: [{ id: 'run-1' }],
    recoveries: [{ id: 'recovery-1' }],
    recoveryHistory: [{ id: 'recovery-event-1' }],
    dryRun: { lastBoundingBoxTraceStatus: 'complete' },
    arm: { state: 'ARMED' },
    feedOverride: { startPercent: 75 },
    startChecklist: { routerReady: true },
    userSettings: { keep: true },
    ...overrides,
  };
}

async function load(fetchImpl) {
  return loadPreviewJobMetadata({
    fetchImpl,
    jobPath,
    sourcePath,
    isValidJob: (job) => Number(job?.schemaVersion) === JOB_SCHEMA_VERSION,
  });
}

describe('Preview optional Job JSON loading', () => {
  it('keeps the confirmed KAR canonical hash path', () => {
    expect(jobPathForUpload(sourcePath)).toBe(jobPath);
    expect(previewSource).toContain("import { jobPathForUpload as jobPathFor }");
  });

  it('returns loaded metadata without resetting persisted setup state', async () => {
    const job = validJob();
    const result = await load(vi.fn().mockResolvedValue(response(200, job)));

    expect(result).toEqual({ status: 'loaded', job });
    expect(result.job).toMatchObject({
      activeRun: job.activeRun,
      placement: job.placement,
      generatedValidation: job.generatedValidation,
      workZero: job.workZero,
      toolZero: job.toolZero,
      zeroHistory: job.zeroHistory,
      runHistory: job.runHistory,
      recoveries: job.recoveries,
      recoveryHistory: job.recoveryHistory,
      dryRun: job.dryRun,
      arm: job.arm,
      feedOverride: job.feedOverride,
      startChecklist: job.startChecklist,
      userSettings: job.userSettings,
    });
  });

  it('treats only HTTP 404 as an ordinary missing sidecar', async () => {
    const result = await load(vi.fn().mockResolvedValue(response(404, {
      ok: false,
      error: 'ENOENT: mock filesystem path',
    })));

    expect(result).toEqual({ status: 'missing' });
    expect(previewMetadataWarning(result)).toBe('');
  });

  it.each([403, 409, 500])('keeps HTTP %s distinct from missing metadata', async (status) => {
    const result = await load(vi.fn().mockResolvedValue(response(status, {
      ok: false,
      error: `HTTP ${status} test failure`,
    })));

    expect(result).toMatchObject({ status: 'error', httpStatus: status });
    expect(previewMetadataWarning(result)).toContain(`HTTP ${status}`);
  });

  it('rejects invalid JSON, API error objects, wrong-source jobs, and old schemas', async () => {
    await expect(load(vi.fn().mockResolvedValue(response(200, '{broken'))))
      .resolves.toMatchObject({ status: 'invalid' });
    await expect(load(vi.fn().mockResolvedValue(response(200, { ok: false, error: 'API error' }))))
      .resolves.toMatchObject({ status: 'invalid' });
    await expect(load(vi.fn().mockResolvedValue(response(200, validJob({
      sourceGcodePath: '/gcode/other.gc',
    }))))).resolves.toMatchObject({ status: 'invalid' });
    await expect(load(vi.fn().mockResolvedValue(response(200, validJob({
      schemaVersion: JOB_SCHEMA_VERSION - 1,
    }))))).resolves.toMatchObject({ status: 'invalid' });
  });

  it('keeps network failures non-fatal and distinct from 404', async () => {
    const result = await load(vi.fn().mockRejectedValue(new Error('offline')));

    expect(result).toMatchObject({ status: 'error', httpStatus: null });
    expect(previewMetadataWarning(result)).toContain('could not be loaded');
  });

  it('loads source before optional metadata and parses before coordinated persistence', () => {
    const start = previewSource.indexOf('async function loadPreview()');
    const end = previewSource.indexOf('function refreshDryRunCommands()', start);
    const bootstrap = previewSource.slice(start, end);

    expect(bootstrap.indexOf('fetch(`/api/download?path=${encodeURIComponent(filePath)}`)'))
      .toBeLessThan(bootstrap.indexOf('await loadExistingJobResult()'));
    expect(bootstrap.indexOf('await loadExistingJobResult()'))
      .toBeLessThan(bootstrap.indexOf("parseRunText(sourceGcodeText, filePath, 'source')"));
    expect(bootstrap.indexOf("parseRunText(sourceGcodeText, filePath, 'source')"))
      .toBeLessThan(bootstrap.indexOf('await syncPreviewMetadata(metadataResult)'));
    expect(bootstrap).toContain("metadataResult = { status: 'invalid', error }");
    expect(bootstrap).not.toContain('checkJobExists()');
  });

  it('redirects a missing source before loading or saving Job JSON', () => {
    const start = previewSource.indexOf('async function loadPreview()');
    const end = previewSource.indexOf('const metadataResult = await loadExistingJobResult()', start);
    const requiredSource = previewSource.slice(start, end);

    expect(requiredSource).toMatch(/if \(!res\.ok\) \{\s*redirectToFiles\(filePath\);\s*return;\s*\}/);
    expect(requiredSource).not.toContain('uploadJobJson(');
  });

  it('uses a non-overwriting first save and reloads a concurrent sidecar on conflict', () => {
    const start = previewSource.indexOf('async function syncPreviewMetadata(');
    const end = previewSource.indexOf('async function saveJobWithPreflight()', start);
    const sync = previewSource.slice(start, end);

    expect(sync).toContain("metadataResult.status === 'invalid' || metadataResult.status === 'error'");
    expect(sync).toContain("overwrite: latest.status === 'loaded'");
    expect(sync).toContain("latest.status !== 'missing' || error.httpStatus !== 409");
    expect(sync).toContain('latest = await loadExistingJobResult()');
    expect(sync).toContain('base = latest.job');
  });

  it('does not replace a persisted generated active run with source mode during refresh', () => {
    const start = previewSource.indexOf('async function reconcilePlacementIntentOnLoad(');
    const end = previewSource.indexOf('async function generateRunFile(', start);
    const reconcile = previewSource.slice(start, end);

    expect(reconcile).toContain("options.preserveGeneratedActiveRun && jobState.activeRun?.mode === 'generated'");
    expect(previewSource).toContain("preserveGeneratedActiveRun: metadataResult.status === 'loaded'");
  });

  it('defines the startup motion guard and a full source-mode default arm state', () => {
    expect(previewSource).toContain('function jobIsLive()');
    expect(previewSource).toMatch(/function newJobState\(\)[\s\S]*activeRun:\s*\{[\s\S]*mode: 'source'[\s\S]*arm:\s*\{[\s\S]*state: 'NOT_ARMED'/);
  });
});
