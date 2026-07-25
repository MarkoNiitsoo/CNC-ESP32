import {
  assertCanUseActiveRunForExecution,
  getActiveRun,
  getActiveRunFingerprint,
  getSourceGcodePath,
  fingerprintsMatch,
  requiresGeneratedRun,
} from './job-active-run.js';

const ACTIVE_STATES = new Set(['RUNNING', 'PREPARING', 'RESUMING', 'PAUSING', 'STOPPING']);
const TERMINAL_RECOVERY_STATES = new Set(['recovery_completed', 'abandoned', 'marked_finished']);

function jobWithContext(job = {}, options = {}) {
  const sourcePath = getSourceGcodePath(job) || options.currentJob?.gcodePath || '';
  if (!sourcePath) return job || {};
  return {
    ...job,
    gcodePath: job.gcodePath || sourcePath,
    sourceGcodePath: job.sourceGcodePath || sourcePath,
  };
}

function stateOf(status = {}) {
  return String(status.state || 'UNKNOWN').toUpperCase();
}

function latestRun(job = {}) {
  return Array.isArray(job.runHistory) && job.runHistory.length ? job.runHistory[job.runHistory.length - 1] : null;
}

function hasCapture(capture) {
  return Boolean(capture?.rawM114);
}

function zeroStatus(job = {}, type) {
  if (type === 'workZero') {
    if (hasCapture(job.workZero?.beforeG92) && hasCapture(job.workZero?.afterG92)) return 'ok';
    if (hasCapture(job.workZero?.beforeG92)) return 'stale';
    return 'missing';
  }
  if (hasCapture(job.toolZero?.afterG92Z) || job.toolZero?.capturedAt) return 'ok';
  return 'missing';
}

function dryRunStatus(job = {}) {
  const dryRun = job.dryRun || {};
  const ok = dryRun.lastBoundingBoxTraceStatus === 'complete' || dryRun.lastAircutStatus === 'complete';
  if (dryRun.lastBoundingBoxTraceStatus === 'failed' || dryRun.lastAircutStatus === 'failed') return 'failed';
  if (!ok) return 'missing';
  const active = getActiveRun(job);
  const activeFingerprint = getActiveRunFingerprint(job);
  if (dryRun.activeRunPath && dryRun.activeRunPath !== active.path) return 'stale';
  if (dryRun.activeRunFingerprint && activeFingerprint && !fingerprintsMatch(dryRun.activeRunFingerprint, activeFingerprint)) return 'stale';
  if (dryRun.lastBoundingBoxTraceStatus === 'stale' || dryRun.lastAircutStatus === 'stale') return 'stale';
  return 'ok';
}

function armStatus(job = {}) {
  const arm = job.arm || {};
  if (arm.state === 'STALE') return 'stale';
  if (arm.state !== 'ARMED') return 'unarmed';
  const active = getActiveRun(job);
  const fingerprint = getActiveRunFingerprint(job);
  if (arm.activeRunPath && arm.activeRunPath !== active.path) return 'stale';
  if (arm.activeRunMode && arm.activeRunMode !== active.mode) return 'stale';
  if (arm.activeRunFingerprint && fingerprint && !fingerprintsMatch(arm.activeRunFingerprint, fingerprint)) return 'stale';
  if (active.mode === 'generated' && arm.transformFingerprint && active.transformFingerprint && arm.transformFingerprint !== active.transformFingerprint) return 'stale';
  return 'armed';
}

function generatedStatus(job = {}) {
  if (!requiresGeneratedRun(job)) return 'ok';
  const validation = job.generatedValidation || {};
  if (job.placement?.dirty) return 'stale';
  return validation.status || 'missing';
}

function terminalOutcome(state) {
  if (state === 'COMPLETED') return 'completed';
  if (state === 'STOPPED') return 'stopped';
  if (state === 'ERROR') return 'error';
  return '';
}

export function liveRunStatus(options = {}) {
  const live = stateOf(options.jobStatus || {});
  if (live === 'RUNNING' || live === 'PREPARING' || live === 'RESUMING' || live === 'PAUSING' || live === 'STOPPING') return 'running';
  if (live === 'PAUSED') return 'paused';
  // Firmware retains terminal outcomes in job status for diagnostics. They are no
  // longer live operations and must not keep the current workflow pseudo-active.
  if (terminalOutcome(live)) return 'idle';
  if (!options.jobStatus || live === 'UNKNOWN') return 'unknown';
  return 'idle';
}

export function latestRunOutcome(job = {}, options = {}) {
  const reported = terminalOutcome(stateOf(options.jobStatus || {}));
  if (reported) return reported;
  const run = latestRun(job);
  if (run?.state === 'stopped' || run?.state === 'interrupted') return 'stopped';
  if (run?.state === 'error') return 'error';
  if (run?.state === 'completed') return 'completed';
  return null;
}

function activeRecoveryCount(job = {}) {
  return Array.isArray(job.recoveries)
    ? job.recoveries.filter((item) => item && !TERMINAL_RECOVERY_STATES.has(item.status)).length
    : 0;
}

function addReason(reasons, id, message) {
  reasons.push({ id, message });
}

export function getBlockingReasons(job = {}, options = {}) {
  const current = jobWithContext(job, options);
  const reasons = [];
  const activeCheck = assertCanUseActiveRunForExecution(current);
  if (!activeCheck.ok) {
    activeCheck.reasons.forEach((item) => addReason(reasons, item.reason, item.message));
  }
  if (zeroStatus(current, 'workZero') !== 'ok') addReason(reasons, 'work_zero_missing', 'Work zero is missing.');
  if (zeroStatus(current, 'zZero') !== 'ok') addReason(reasons, 'z_zero_missing', 'Z zero is missing.');
  const dry = dryRunStatus(current);
  if (dry === 'missing') addReason(reasons, 'dry_run_missing', 'Dry run has not been completed for the active run file.');
  if (dry === 'stale') addReason(reasons, 'dry_run_stale', 'Dry run was made for another file and is stale.');
  if (dry === 'failed') addReason(reasons, 'dry_run_failed', 'Dry run failed and must be repeated.');
  const arm = armStatus(current);
  if (arm === 'unarmed') addReason(reasons, 'arm_missing', 'Job is not armed.');
  if (arm === 'stale') addReason(reasons, 'arm_stale', 'Job was armed for another active file and must be re-armed.');
  return reasons;
}

function action(id, label, target, extra = {}) {
  return { id, label, target, ...extra };
}

export function getPrimaryNextAction(job = {}, options = {}) {
  const current = jobWithContext(job, options);
  const sourcePath = getSourceGcodePath(current) || options.currentJob?.gcodePath || '';
  const run = liveRunStatus(options);
  if (run === 'running') return action('monitor_job', 'Monitor Job', 'run');
  if (run === 'paused') return action('resume_job', 'Resume Job', 'run', { api: '/api/job/resume' });
  if (!sourcePath) return action('choose_file', 'Choose G-code File', 'files');

  const activeCheck = assertCanUseActiveRunForExecution(current);
  if (!activeCheck.ok) {
    const generatedProblem = activeCheck.reasons.some((item) => item.reason.startsWith('generated_'));
    return generatedProblem
      ? action('update_run_file', 'Update Run File', 'preview')
      : action('fix_active_run', 'Fix Active Run', 'preview');
  }
  if (zeroStatus(current, 'workZero') !== 'ok') return action('set_work_zero', 'Set Work Zero', 'setup');
  if (zeroStatus(current, 'zZero') !== 'ok') return action('set_z_zero', 'Set Z Zero', 'setup');
  const dry = dryRunStatus(current);
  if (dry !== 'ok') return action('run_dry_run', 'Run Bounding Box / Dry Run', 'dry-run');
  if (armStatus(current) !== 'armed') return action('arm_job', 'Review & Start Cut', 'run');
  return action('start_cut', 'Start Cut', 'run');
}

export function getSecondaryActions(job = {}, options = {}) {
  const current = jobWithContext(job, options);
  const run = liveRunStatus(options);
  if (run === 'running') {
    return [
      action('pause_job', 'Pause', 'run', { api: '/api/job/pause' }),
      action('stop_job', 'Stop', 'run', { api: '/api/job/stop' }),
      action('m5', 'M5', 'run', { command: 'M5' }),
    ];
  }
  if (run === 'paused') {
    return [
      action('stop_job', 'Stop', 'run', { api: '/api/job/stop' }),
      action('m5', 'M5', 'run', { command: 'M5' }),
    ];
  }
  const actions = [
    action('open_preview', 'Preview', 'preview'),
    action('open_setup', 'Setup', 'setup'),
    action('open_dry_run', 'Dry Run', 'dry-run'),
    action('open_arm', 'Arm', 'arm'),
  ];
  if (activeRecoveryCount(current)) actions.push(action('open_recoveries', 'Saved Recoveries', 'recovery'));
  if (latestRun(current)) actions.push(action('review_history', 'Run History', 'history'));
  return actions;
}

export function getReadinessBadges(job = {}, options = {}) {
  const current = jobWithContext(job, options);
  const active = getActiveRun(current);
  const badges = [
    { id: 'activeRun', label: active.mode === 'generated' ? 'USING GENERATED' : 'USING ORIGINAL', level: active.mode === 'generated' ? 'active' : 'info' },
    { id: 'workZero', label: `Work zero: ${zeroStatus(current, 'workZero')}`, level: zeroStatus(current, 'workZero') === 'ok' ? 'ok' : 'warn' },
    { id: 'zZero', label: `Z zero: ${zeroStatus(current, 'zZero')}`, level: zeroStatus(current, 'zZero') === 'ok' ? 'ok' : 'warn' },
    { id: 'dryRun', label: `Dry run: ${dryRunStatus(current)}`, level: dryRunStatus(current) === 'ok' ? 'ok' : 'warn' },
    { id: 'arm', label: `Arm: ${armStatus(current)}`, level: armStatus(current) === 'armed' ? 'ok' : 'warn' },
  ];
  if (active.mode === 'generated') {
    const status = generatedStatus(current);
    badges.splice(1, 0, { id: 'generated', label: `Generated: ${status}`, level: status === 'valid' ? 'ok' : 'warn' });
  }
  const live = liveRunStatus(options);
  badges.push({ id: 'run', label: `Run: ${live}`, level: live === 'running' ? 'active' : live === 'error' ? 'fail' : 'info' });
  const recoveries = activeRecoveryCount(current);
  if (recoveries) badges.push({ id: 'recoveries', label: `Saved recoveries: ${recoveries}`, level: 'warn' });
  return badges;
}

export function buildJobReadiness(job = {}, options = {}) {
  const current = jobWithContext(job, options);
  const active = getActiveRun(current);
  const placement = current.placement || {};
  const activeCheck = assertCanUseActiveRunForExecution(current);
  const blockingReasons = getBlockingReasons(current, options);
  return {
    activeRun: {
      mode: active.mode,
      path: active.path,
      status: activeCheck.ok ? 'ok' : activeCheck.reason,
      fingerprint: getActiveRunFingerprint(current),
    },
    sourcePath: getSourceGcodePath(current) || options.currentJob?.gcodePath || '',
    placement: {
      identity: !requiresGeneratedRun(current),
      dirty: Boolean(placement.dirty),
      requiresGenerated: requiresGeneratedRun(current),
      rotationDeg: Number(placement.rotationDeg || 0),
      originAnchor: placement.originAnchor || 'rawBoundsLowerLeft',
      placementBoundsMode: placement.placementBoundsMode || 'rawTravelBounds',
      normalizeToOrigin: placement.normalizeToOrigin !== false,
    },
    zero: {
      workZero: zeroStatus(current, 'workZero'),
      zZero: zeroStatus(current, 'zZero'),
    },
    dryRun: {
      status: dryRunStatus(current),
      staleReason: current.dryRun?.staleReason || '',
    },
    arm: {
      status: armStatus(current),
      staleReason: current.arm?.staleReason || '',
    },
    run: {
      liveStatus: liveRunStatus(options),
      // Keep status as a compatibility alias for existing UI consumers.
      status: liveRunStatus(options),
      lastOutcome: latestRunOutcome(current, options),
      latest: latestRun(current),
    },
    blockingReasons,
    primaryAction: getPrimaryNextAction(current, options),
    secondaryActions: getSecondaryActions(current, options),
    badges: getReadinessBadges(current, options),
  };
}
