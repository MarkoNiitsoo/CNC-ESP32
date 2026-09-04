import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = (await readFile(path.join(repoRoot, 'www', 'preview.js'), 'utf8')).replace(/\r\n/g, '\n');

function extractFunctionSource(name) {
  let start = source.indexOf(`function ${name}(`);
  expect(start, `${name} should exist in preview.js`).toBeGreaterThan(0);
  // Keep the async keyword so extracted async bodies stay valid expressions.
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const paramOpen = source.indexOf('(', start);
  let depth = 0;
  let paramClose = -1;
  for (let i = paramOpen; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) { paramClose = i; break; }
    }
  }
  const bodyOpen = source.indexOf('{', paramClose);
  depth = 0;
  let end = -1;
  for (let i = bodyOpen; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  expect(end, `${name} should be complete`).toBeGreaterThan(0);
  return source.slice(start, end);
}

// Compile the real pollJobStatusHttp body against its closure dependencies so
// the guard flags and warn rate limiting behave exactly as in the page.
const compilePoller = ({ windowObj, fetchImpl, readJsonOrThrow, applyJobRunStatus, warn }) => {
  const deps = {
    window: windowObj,
    fetch: fetchImpl,
    readJsonOrThrow,
    applyJobRunStatus,
    jobStatusHttpPollInFlight: false,
    jobStatusHttpPollLastWarnMs: 0,
    JOB_STATUS_HTTP_POLL_WARN_MS: 30000,
    console: { warn: (message) => warn.push(message) },
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    ...Object.keys(deps),
    `return (${extractFunctionSource('pollJobStatusHttp')});`,
  );
  return factory(...Object.values(deps));
};

// Compile the real applyJobRunStatus body with stubbed render/history deps so a
// poll-driven call can be observed flipping jobStatusHealthy exactly like the
// WS slice path does.
const compileApplyJobRunStatusSandbox = () => {
  const deps = {
    jobStatusReceivedAtMs: 0,
    jobStatusFirmwareUptimeMs: 0,
    jobStatusHealthy: false,
    jobRunStatus: null,
    syncRunHistoryFromStatus: async () => {},
    syncProductionResumeFromStatus: async () => {},
    currentRunPath: () => '/gcode/KAR.gc',
    renderRunPanel: () => {},
    refreshRecoveryPlan: () => {},
    updateJobRunPolling: () => {},
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    ...Object.keys(deps),
    `return {
      apply: async (data) => { await (${extractFunctionSource('applyJobRunStatus')})(data); },
      state: () => ({ healthy: jobStatusHealthy, runStatus: jobRunStatus }),
    };`,
  );
  return factory(...Object.values(deps));
};

const readJsonOrThrow = new Function(`return (${extractFunctionSource('readJsonOrThrow')});`)();

const makeResponse = (body, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  url: '/api/job/status',
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const jobStatusPayload = () => ({ state: 'IDLE', progressPercent: 0, uptimeMs: 4321 });

describe('job status HTTP fallback poller', () => {
  it('polls /api/job/status and marks the workbench healthy when the WS transport is failed', async () => {
    const fetchCalls = [];
    const fetchImpl = async (url) => {
      fetchCalls.push(String(url));
      return makeResponse(jobStatusPayload());
    };
    const sandbox = compileApplyJobRunStatusSandbox();
    const warn = [];
    const poll = compilePoller({
      windowObj: { CncTelemetry: { transportStatus: 'failed' } },
      fetchImpl,
      readJsonOrThrow,
      applyJobRunStatus: sandbox.apply,
      warn,
    });

    await poll();

    expect(fetchCalls).toEqual(['/api/job/status']);
    expect(sandbox.state().healthy).toBe(true); // ONLINE chip / Start gating unblocks
    expect(sandbox.state().runStatus).toMatchObject({ state: 'IDLE' });
    expect(warn).toEqual([]);
  });

  it('polls when the telemetry module is absent entirely', async () => {
    const fetchCalls = [];
    const fetchImpl = async (url) => {
      fetchCalls.push(String(url));
      return makeResponse(jobStatusPayload());
    };
    const sandbox = compileApplyJobRunStatusSandbox();
    const poll = compilePoller({
      windowObj: {},
      fetchImpl,
      readJsonOrThrow,
      applyJobRunStatus: sandbox.apply,
      warn: [],
    });

    await poll();

    expect(fetchCalls).toEqual(['/api/job/status']);
    expect(sandbox.state().healthy).toBe(true);
  });

  it('never polls while the WS transport is synchronized', async () => {
    const fetchCalls = [];
    const fetchImpl = async (url) => {
      fetchCalls.push(String(url));
      return makeResponse(jobStatusPayload());
    };
    const sandbox = compileApplyJobRunStatusSandbox();
    const poll = compilePoller({
      windowObj: { CncTelemetry: { transportStatus: 'synchronized' } },
      fetchImpl,
      readJsonOrThrow,
      applyJobRunStatus: sandbox.apply,
      warn: [],
    });

    await poll();
    await poll();

    expect(fetchCalls).toEqual([]);
    expect(sandbox.state().healthy).toBe(false);
  });

  it('skips a tick while the previous poll is still in flight', async () => {
    const fetchCalls = [];
    let resolveFetch;
    const fetchImpl = (url) => {
      fetchCalls.push(String(url));
      return new Promise((resolve) => { resolveFetch = () => resolve(makeResponse(jobStatusPayload())); });
    };
    const sandbox = compileApplyJobRunStatusSandbox();
    const poll = compilePoller({
      windowObj: { CncTelemetry: { transportStatus: 'reconnecting' } },
      fetchImpl,
      readJsonOrThrow,
      applyJobRunStatus: sandbox.apply,
      warn: [],
    });

    const first = poll();
    await poll(); // overlapping tick must be a no-op, not a second fetch
    expect(fetchCalls).toHaveLength(1);

    resolveFetch();
    await first;
    expect(fetchCalls).toHaveLength(1);
    expect(sandbox.state().healthy).toBe(true);
  });

  it('fails silent with a rate-limited warn and never rejects', async () => {
    const fetchCalls = [];
    const fetchImpl = async (url) => {
      fetchCalls.push(String(url));
      throw new Error('network down');
    };
    const sandbox = compileApplyJobRunStatusSandbox();
    const warn = [];
    const poll = compilePoller({
      windowObj: { CncTelemetry: { transportStatus: 'failed' } },
      fetchImpl,
      readJsonOrThrow,
      applyJobRunStatus: sandbox.apply,
      warn,
    });

    await expect(poll()).resolves.toBeUndefined();
    await expect(poll()).resolves.toBeUndefined();

    expect(fetchCalls).toHaveLength(2); // keeps retrying
    expect(warn).toHaveLength(1); // rate limited, not one per tick
    expect(warn[0]).toContain('network down');
    expect(sandbox.state().healthy).toBe(false); // error payloads never fake health
  });

  it('treats HTTP error responses as failures without feeding applyJobRunStatus', async () => {
    const fetchCalls = [];
    const fetchImpl = async (url) => {
      fetchCalls.push(String(url));
      return makeResponse({ error: 'boom' }, false);
    };
    const sandbox = compileApplyJobRunStatusSandbox();
    const warn = [];
    const poll = compilePoller({
      windowObj: { CncTelemetry: { transportStatus: 'stale' } },
      fetchImpl,
      readJsonOrThrow,
      applyJobRunStatus: sandbox.apply,
      warn,
    });

    await poll();

    expect(sandbox.state().healthy).toBe(false);
    expect(sandbox.state().runStatus).toBe(null);
    expect(warn).toHaveLength(1);
  });
});

describe('HTTP fallback wiring', () => {
  it('registers one 2s interval that self-skips while synchronized', () => {
    expect(source).toContain('const JOB_STATUS_HTTP_POLL_MS = 2000;');
    expect(source).toContain('jobStatusHttpPollTimer = setInterval(() => {');
    expect(source).toContain('void pollJobStatusHttp();');
    expect(source).toContain('}, JOB_STATUS_HTTP_POLL_MS);');
    const poller = extractFunctionSource('pollJobStatusHttp');
    expect(poller).toContain("window.CncTelemetry?.transportStatus === 'synchronized'");
    expect(poller).toContain('jobStatusHttpPollInFlight');
  });

  it('keeps a single transport-change subscription driving chip and gating re-render', () => {
    expect(source.split("addEventListener('cnc-telemetry-transport'").length - 1).toBe(1);
    expect(source).toMatch(
      /addEventListener\('cnc-telemetry-transport', \(\) => \{\s*renderWorkbenchStatus\(\);\s*renderRunPanel\(\);\s*\}\);/,
    );
  });

  it('feeds the WS job slice through the same applyJobRunStatus path', () => {
    expect(source).toContain("window.CncTelemetry?.subscribe('job', (data) => {");
    expect(source).toContain(
      'applyJobRunStatus(data).catch((err) => appendRunLog(`Status update failed: ${err.message}`));',
    );
  });

  it('leaves applyJobRunStatus semantics untouched', () => {
    const apply = extractFunctionSource('applyJobRunStatus');
    expect(apply).toContain('jobStatusReceivedAtMs = performance.now();');
    expect(apply).toContain('jobStatusHealthy = true;');
    expect(apply).toContain('renderRunPanel();');
    expect(apply).toContain('refreshRecoveryPlan();');
    expect(apply).toContain('updateJobRunPolling();');
  });
});
