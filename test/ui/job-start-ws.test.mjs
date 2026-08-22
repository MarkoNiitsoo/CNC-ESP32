import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

// Normalize to LF so the audits behave identically under LF and CRLF checkouts.
const preview = (await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8'))
  .replace(/\r\n/g, '\n');

describe('WS-first Job Start dispatch (Phase 3D)', () => {
  it('dispatches job.start through the two-phase beginCommand API', () => {
    expect(preview).toContain("telemetry.beginCommand('job.start', payload, `job-start-${random}`");
    expect(preview).toContain('admissionTimeoutMs: 5000');
    expect(preview).toContain('resultTimeoutMs: 600000');
  });

  it('gates the HTTP fallback on definite admission rejection only', () => {
    const dispatch = preview.slice(
      preview.indexOf('async function dispatchJobStart'),
      preview.indexOf('async function startJobRun'));
    expect(dispatch).toContain("if (admissionError?.definitelyNotAccepted === true) admitted = false;");
    expect(dispatch).toContain("return postCriticalJobAction('/api/job/start', payload);");
    // Exactly one HTTP fallback reference inside the dispatcher.
    expect(dispatch.split("postCriticalJobAction('/api/job/start'").length - 1).toBe(1);
  });

  it('treats terminal result failures as Start failures and pending results as slice-authoritative', () => {
    const dispatch = preview.slice(
      preview.indexOf('async function dispatchJobStart'),
      preview.indexOf('async function startJobRun'));
    expect(dispatch).toContain("if (resultError?.commandDisposition === 'completed')");
    expect(dispatch).toContain('Job start failed during preparation.');
    expect(dispatch).toContain("outcome: 'result-pending'");
    expect(dispatch).toContain('confirming from authoritative socket job state');
  });

  it('keeps the canonical job-slice confirmation and history ordering intact', () => {
    const run = preview.slice(
      preview.indexOf('async function startJobRun'),
      preview.indexOf('async function pauseJobRun'));
    const historyStart = run.indexOf('history.startRunHistory(');
    const baseline = run.indexOf("socketSliceToken('job')");
    const dispatch = run.indexOf('await dispatchJobStart(');
    const sliceWait = run.indexOf("waitForSocketSlice(\n      'job'");
    // One logical Start = one history entry, created before dispatch; the slice
    // waiter token is captured before dispatch so confirmation cannot race.
    expect(historyStart).toBeGreaterThan(-1);
    expect(historyStart).toBeLessThan(dispatch);
    expect(baseline).toBeLessThan(dispatch);
    expect(sliceWait).toBeGreaterThan(dispatch);
    expect(run).toContain("['PREPARING', 'RUNNING'].includes(state)");
    // The command result never mutates live job state: confirmation and the
    // history update come from the canonical slice only.
    expect(run).toContain('history.updateRunHistoryFromStatus(job, confirmed)');
  });

  it('requires controller ownership before using the WS path', () => {
    expect(preview).toContain(
      "window.LowRiderMachineBar?.operatorState?.()?.controller === true");
    expect(preview).toContain('telemetry?.beginCommand');
  });
});
