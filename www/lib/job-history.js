import {
  getActiveRun,
  getActiveRunFingerprint,
  getSourceGcodePath,
} from './job-active-run.js';
import { migrateProjectSafeZ } from './job-safe-z.js';

const TERMINAL_RUN_STATES = new Set(['completed', 'stopped', 'interrupted', 'error']);
let idSequence = 0;

function isoNow() {
  return new Date().toISOString();
}

function makeId(prefix, now = isoNow()) {
  const safeTime = now.replace(/[^0-9A-Za-z]/g, '').slice(0, 17);
  const rand = Math.random().toString(36).slice(2, 8);
  idSequence = (idSequence + 1) % 10000;
  return `${prefix}-${safeTime}-${idSequence.toString(36)}-${rand}`;
}

function cloneCapture(capture = {}) {
  return {
    rawM114: capture.rawM114 || '',
    position: {
      x: capture.position?.x ?? null,
      y: capture.position?.y ?? null,
      z: capture.position?.z ?? null,
    },
    counts: {
      x: capture.counts?.x ?? null,
      y: capture.counts?.y ?? null,
      z: capture.counts?.z ?? null,
    },
  };
}

function normalizeRunState(state) {
  const value = String(state || '').toUpperCase();
  if (value === 'COMPLETED') return 'completed';
  if (value === 'STOPPED') return 'stopped';
  if (value === 'RECOVERY_REQUIRED') return 'interrupted';
  if (value === 'ERROR') return 'error';
  if (value === 'PAUSED' || value === 'PAUSED_INTACT' ||
      value === 'RUNNING' || value === 'PREPARING' || value === 'PAUSING' ||
      value === 'RESUMING' || value === 'STOPPING') {
    return 'running';
  }
  return String(state || 'started').toLowerCase();
}

export function ensureHistory(job = {}) {
  if (!Array.isArray(job.zeroHistory)) job.zeroHistory = [];
  if (!Array.isArray(job.runHistory)) job.runHistory = [];
  if (!Array.isArray(job.recoveryHistory)) job.recoveryHistory = [];
  if (!Object.prototype.hasOwnProperty.call(job, 'activeWorkZeroId')) job.activeWorkZeroId = null;
  if (!Object.prototype.hasOwnProperty.call(job, 'activeZZeroId')) job.activeZZeroId = null;
  return job;
}

export function appendMotionOnlyRecoveryEvent(job, options = {}) {
  ensureHistory(job);
  const executedAt = options.executedAt || isoNow();
  const event = {
    id: options.id || makeId('recovery', executedAt),
    type: 'motion-only-recovery-move',
    motionOnly: true,
    runId: options.runId || '',
    activeRunPath: options.activeRunPath || '',
    activeRunMode: options.activeRunMode || '',
    activeRunFingerprint: options.activeRunFingerprint || '',
    resumeLineNumber: Number(options.resumeLineNumber) || null,
    resumePoint: cloneCapture({ position: options.resumePoint }).position,
    safeZ: Number(options.safeZ),
    executedAt,
    result: options.result === 'complete' ? 'completed' : (options.result || 'unknown'),
    commandsSent: Array.isArray(options.commandsSent) ? [...options.commandsSent] : [],
    reason: options.reason || options.error || '',
  };
  job.recoveryHistory.push(event);
  return event;
}

export function appendToollessResumeEvent(job, options = {}) {
  ensureHistory(job);
  const startedAt = options.startedAt || isoNow();
  const event = {
    id: options.id || makeId('toolless', startedAt),
    type: 'toolless-resume-test',
    productionResume: false,
    runId: options.runId || '',
    activeRunPath: options.activeRunPath || '',
    activeRunMode: options.activeRunMode || '',
    activeRunFingerprint: options.activeRunFingerprint || '',
    startLineNumber: Number(options.startLineNumber) || null,
    resumePoint: cloneCapture({ position: options.resumePoint }).position,
    safeZ: Number(options.safeZ),
    minZ: Number(options.minZ),
    startedAt,
    endedAt: null,
    state: options.state || 'started',
    commandsCount: Number(options.commandsCount) || 0,
    commandsSent: Number(options.commandsSent) || 0,
    reason: options.reason || '',
  };
  job.recoveryHistory.push(event);
  return event;
}

export function finishToollessResumeEvent(event, options = {}) {
  if (!event || event.type !== 'toolless-resume-test') return null;
  event.state = options.state || event.state || 'error';
  event.endedAt = options.endedAt || isoNow();
  event.commandsSent = Number(options.commandsSent ?? event.commandsSent) || 0;
  event.reason = options.reason || event.reason || '';
  return event;
}

export function appendProductionResumeEvent(job, options = {}) {
  ensureHistory(job);
  const startedAt = options.startedAt || isoNow();
  const event = {
    id: options.id || makeId('production-resume', startedAt),
    type: 'production-resume',
    runId: options.runId || '',
    activeRunPath: options.activeRunPath || '',
    activeRunMode: options.activeRunMode || '',
    activeRunFingerprint: options.activeRunFingerprint || '',
    startLineNumber: Number(options.startLineNumber) || null,
    resumePoint: cloneCapture({ position: options.resumePoint }).position,
    safeZ: Number(options.safeZ),
    minZ: Number(options.minZ),
    startedAt,
    endedAt: null,
    state: options.state || 'started',
    commandsCount: Number(options.commandsCount) || 0,
    commandsSent: Number(options.commandsSent) || 0,
    checklist: { ...(options.checklist || {}) },
    zZeroChanged: options.zZeroChanged === true,
    previousZZeroId: options.previousZZeroId || null,
    currentZZeroId: options.currentZZeroId || null,
    zZeroChangeAcknowledged: options.zZeroChangeAcknowledged === true,
    phase1CompletedAt: null,
    manualRouterConfirmedAt: null,
    streamPath: '',
    reason: options.reason || '',
  };
  job.recoveryHistory.push(event);
  return event;
}

export function markProductionResumePrepared(event, preparedAt = isoNow()) {
  if (!event || event.type !== 'production-resume') return null;
  event.phase1CompletedAt = preparedAt;
  return event;
}

export function markProductionResumeRouterConfirmed(event, options = {}) {
  if (!event || event.type !== 'production-resume') return null;
  event.manualRouterConfirmedAt = options.confirmedAt || isoNow();
  event.streamPath = options.streamPath || event.streamPath || '';
  return event;
}

export function finishProductionResumeEvent(event, options = {}) {
  if (!event || event.type !== 'production-resume') return null;
  event.state = options.state || event.state || 'error';
  event.endedAt = options.endedAt || isoNow();
  event.commandsSent = Number(options.commandsSent ?? event.commandsSent) || 0;
  event.reason = options.reason || event.reason || '';
  return event;
}

export function createZeroHistoryEntry(options = {}) {
  const capturedAt = options.capturedAt || isoNow();
  const before = cloneCapture(options.before);
  const after = cloneCapture(options.after);
  return {
    id: options.id || makeId('zero', capturedAt),
    type: options.type,
    method: options.method,
    axes: options.axes || (options.type === 'zZero' ? 'z' : 'xyz'),
    capturedAt,
    workspace: options.workspace || 'G54',
    label: options.label || '',
    gcodePath: options.gcodePath || '',
    jobPath: options.jobPath || '',
    rawM114Before: before.rawM114,
    rawM114After: after.rawM114,
    positionBefore: before.position,
    positionAfter: after.position,
    countsBefore: before.counts,
    countsAfter: after.counts,
    machineReference: options.machineReference ? structuredClone(options.machineReference) : null,
    frame: options.frame ? structuredClone(options.frame) : null,
    restores: Array.isArray(options.restores) ? structuredClone(options.restores) : [],
    usedByRuns: Array.isArray(options.usedByRuns) ? [...options.usedByRuns] : [],
  };
}

export function recordZeroRestore(job, zeroId, details = {}) {
  ensureHistory(job);
  const entry = job.zeroHistory.find((zero) => zero.id === zeroId);
  if (!entry) return null;
  if (!Array.isArray(entry.restores)) entry.restores = [];
  entry.restores.push({
    restoredAt: details.restoredAt || isoNow(),
    machinePosition: details.machinePosition ? { ...details.machinePosition } : null,
    stepsPerMm: details.stepsPerMm ? { ...details.stepsPerMm } : null,
    safeMachineZ: Number(details.safeMachineZ),
    result: details.result || 'completed',
  });
  if (entry.type === 'zZero') job.activeZZeroId = entry.id;
  else job.activeWorkZeroId = entry.id;
  return entry;
}

export function recordWorkZeroRestore(job, zeroId, details = {}) {
  const entry = job.zeroHistory?.find((zero) => zero.id === zeroId && zero.type === 'workZero');
  return entry ? recordZeroRestore(job, zeroId, details) : null;
}

export function appendWorkZeroHistory(job, options = {}) {
  ensureHistory(job);
  const entry = createZeroHistoryEntry({
    type: 'workZero',
    method: 'G92 X0 Y0 Z0',
    gcodePath: job.gcodePath,
    jobPath: job.jobPath,
    ...options,
  });
  job.zeroHistory.push(entry);
  job.activeWorkZeroId = entry.id;
  return entry;
}

export function appendZZeroHistory(job, options = {}) {
  ensureHistory(job);
  const entry = createZeroHistoryEntry({
    type: 'zZero',
    method: 'G92 Z0',
    gcodePath: job.gcodePath,
    jobPath: job.jobPath,
    ...options,
  });
  job.zeroHistory.push(entry);
  job.activeZZeroId = entry.id;
  return entry;
}

export function markActiveZero(job, zeroId) {
  ensureHistory(job);
  const entry = job.zeroHistory.find((zero) => zero.id === zeroId);
  if (!entry || entry.type !== 'workZero') return false;
  job.activeWorkZeroId = entry.id;
  return true;
}

export function markActiveZZero(job, zeroId) {
  ensureHistory(job);
  const entry = job.zeroHistory.find((zero) => zero.id === zeroId);
  if (!entry || entry.type !== 'zZero') return false;
  job.activeZZeroId = entry.id;
  return true;
}

function addRunUse(job, zeroId, runId) {
  const zero = job.zeroHistory.find((entry) => entry.id === zeroId);
  if (!zero) return;
  if (!Array.isArray(zero.usedByRuns)) zero.usedByRuns = [];
  if (!zero.usedByRuns.includes(runId)) zero.usedByRuns.push(runId);
}

export function startRunHistory(job, status = {}, now = isoNow()) {
  ensureHistory(job);
  const feed = job.feedOverride || {};
  const activeRun = getActiveRun(job);
  const projectSafeZ = migrateProjectSafeZ(job);
  const activeRunPath = activeRun.path || status.gcodePath || '';
  const activeRunFingerprint = getActiveRunFingerprint(job);
  const run = {
    id: makeId('run', now),
    startedAt: now,
    endedAt: null,
    state: 'started',
    gcodePath: job.gcodePath || status.gcodePath || '',
    sourceGcodePath: getSourceGcodePath(job),
    activeRunMode: activeRun.mode,
    activeRunPath,
    activeRunFingerprint,
    generatedRunPath: job.generatedRunPath || job.placement?.generatedRunPath || null,
    sourceFingerprint: activeRun.sourceFingerprint || job.placement?.sourceFingerprint || '',
    generatedFingerprint: activeRun.generatedFingerprint || job.generatedValidation?.generatedFingerprint || '',
    transformFingerprint: activeRun.transformFingerprint || job.placement?.transformFingerprint || '',
    jobPath: job.jobPath || status.jobPath || '',
    zeroId: job.activeWorkZeroId || null,
    zZeroId: job.activeZZeroId || null,
    safeZSnapshot: projectSafeZ.resolved ? {
      programSafeZ: projectSafeZ.programSafeZ,
      extraClearanceMm: projectSafeZ.extraClearanceMm,
      effectiveSafeZ: projectSafeZ.effectiveSafeZ,
    } : null,
    feedOverrideStart: Number(feed.startPercent ?? status.feedOverridePercent ?? 100),
    feedOverrideLast: Number(status.feedOverridePercent ?? feed.lastUsedPercent ?? feed.startPercent ?? 100),
    currentLineNumber: status.currentLineNumber ?? null,
    lastSentLineNumber: status.sentLineCount ?? null,
    lastAckedLineNumber: status.acknowledgedLineCount ?? null,
    lastKnownPosition: status.lastKnownPosition ?? null,
    lastSentCommand: status.lastSentCommand || status.lastCommand || '',
    lastMarlinResponse: status.lastMarlinResponse || status.lastResponse || '',
    reason: status.lastError || status.streamingPausedReason || '',
    actualDurationSeconds: null,
  };
  job.runHistory.push(run);
  addRunUse(job, run.zeroId, run.id);
  addRunUse(job, run.zZeroId, run.id);
  return run;
}

export function latestRun(job) {
  ensureHistory(job);
  return job.runHistory[job.runHistory.length - 1] || null;
}

export function updateRunHistoryEntryFromStatus(job, run, status = {}, now = isoNow()) {
  ensureHistory(job);
  if (!run) return null;

  const nextState = normalizeRunState(status.state);
  run.state = nextState || run.state;
  run.feedOverrideLast = Number(status.feedOverridePercent ?? run.feedOverrideLast ?? run.feedOverrideStart ?? 100);
  run.currentLineNumber = status.currentLineNumber ?? run.currentLineNumber ?? null;
  run.lastSentLineNumber = status.sentLineCount ?? run.lastSentLineNumber ?? null;
  run.lastAckedLineNumber = status.acknowledgedLineCount ?? run.lastAckedLineNumber ?? null;
  run.lastKnownPosition = status.lastKnownPosition ?? run.lastKnownPosition ?? null;
  run.lastSentCommand = status.lastSentCommand || status.lastCommand || run.lastSentCommand || '';
  run.lastMarlinResponse = status.lastMarlinResponse || status.lastResponse || run.lastMarlinResponse || '';
  run.reason = status.lastError || status.streamingPausedReason || run.reason || '';
  if (TERMINAL_RUN_STATES.has(run.state) && !run.endedAt) {
    run.endedAt = now;
    const started = Date.parse(run.startedAt);
    const ended = Date.parse(run.endedAt);
    run.actualDurationSeconds = Number.isFinite(started) && Number.isFinite(ended)
      ? Math.max(0, Math.round((ended - started) / 1000))
      : null;
  }
  return run;
}

export function updateRunHistoryFromStatus(job, status = {}, now = isoNow()) {
  ensureHistory(job);
  return updateRunHistoryEntryFromStatus(job, latestRun(job), status, now);
}

export function finishLatestRun(job, state, reason = '', now = isoNow()) {
  ensureHistory(job);
  const run = latestRun(job);
  if (!run) return null;
  run.state = state;
  run.reason = reason || run.reason || '';
  if (TERMINAL_RUN_STATES.has(state) && !run.endedAt) run.endedAt = now;
  return run;
}

export function zeroRunUsage(job, zero) {
  ensureHistory(job);
  if (!zero) return 'unused';
  const runIds = Array.isArray(zero.usedByRuns) ? zero.usedByRuns : [];
  if (!runIds.length) return 'unused';
  const states = runIds
    .map((id) => job.runHistory.find((run) => run.id === id)?.state)
    .filter(Boolean);
  if (states.includes('error')) return 'error';
  if (states.includes('stopped') || states.includes('interrupted')) return 'interrupted';
  if (states.includes('completed')) return 'completed';
  return 'used';
}

export function zeroStatus(job, zero) {
  if (!zero) return 'Unused';
  if (zero.type === 'workZero' && zero.id === job.activeWorkZeroId) return 'Current active zero';
  if (zero.type === 'zZero' && zero.id === job.activeZZeroId) return 'Current active zero';
  const usage = zeroRunUsage(job, zero);
  if (usage === 'completed') return 'Used by completed run';
  if (usage === 'interrupted') return 'Used by stopped/interrupted run';
  if (usage === 'error') return 'Used by error run';
  if (usage === 'used') return 'Used by run';
  return 'Unused';
}

export function runStateLabel(state) {
  const labels = {
    started: 'Started',
    running: 'Running',
    completed: 'Completed',
    stopped: 'Stopped',
    interrupted: 'Interrupted',
    error: 'Error',
  };
  return labels[state] || String(state || 'Unknown');
}
