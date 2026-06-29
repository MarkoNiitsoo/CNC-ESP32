import { MACHINE_LIMITS } from './gcode-core.mjs';
import {
  assertCanUseActiveRunForExecution,
  getActiveRun,
} from './job-active-run.js';

export function clampFeedPercent(value, fallback = 100) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(10, Math.min(200, number));
}

export function effectiveFeedRange(feeds, startPercent = 100) {
  if (!feeds || !feeds.feedCommandCount) return null;
  const percent = clampFeedPercent(startPercent, 100);
  return {
    percent,
    min: feeds.minFeed * percent / 100,
    max: feeds.maxFeed * percent / 100,
  };
}

function hasRawCapture(capture) {
  return Boolean(capture && capture.rawM114);
}

function addCheck(checks, id, level, message) {
  checks.push({ id, level, message });
}

export function computePreflight({ parsed, job = {}, jobExists = false, now = () => new Date().toISOString() }) {
  const checks = [];
  if (!parsed) {
    addCheck(checks, 'preview', 'warning', 'Preview has not loaded yet');
    return { state: 'UNKNOWN', updatedAt: now(), checks };
  }

  const b = parsed.bounds;
  if (b.xMin >= MACHINE_LIMITS.xMin && b.xMax <= MACHINE_LIMITS.xMax &&
      b.yMin >= MACHINE_LIMITS.yMin && b.yMax <= MACHINE_LIMITS.yMax) {
    addCheck(checks, 'machineBounds', 'pass', 'Fits default LowRider work area');
  } else {
    addCheck(checks, 'machineBounds', 'fail', 'Toolpath exceeds default LowRider work area');
  }

  if (parsed.analysis.hasZ) {
    if (b.zMin >= -30) addCheck(checks, 'zRange', 'pass', 'Z minimum is within expected range');
    else addCheck(checks, 'zRange', 'warning', `Z minimum ${b.zMin.toFixed(2)} mm is below -30 mm`);
  } else {
    addCheck(checks, 'zRange', 'warning', 'File has no Z movement');
  }

  if (parsed.analysis.hasG20) addCheck(checks, 'units', 'fail', 'File contains G20 inch mode; machine is expected to use millimeters');
  else if (parsed.analysis.hasG21) addCheck(checks, 'units', 'pass', 'File contains G21 millimeter mode');
  else addCheck(checks, 'units', 'warning', 'File does not contain G21 millimeter mode');

  if (parsed.analysis.hasG91) addCheck(checks, 'coordinateMode', 'fail', 'File contains G91 relative moves');
  else if (parsed.analysis.hasG90) addCheck(checks, 'coordinateMode', 'pass', 'File contains G90 absolute mode');
  else addCheck(checks, 'coordinateMode', 'warning', 'File does not contain G90 absolute mode');

  if (parsed.analysis.nonDefaultWorkspaceCommands.length > 0) {
    addCheck(
      checks,
      'workspaceCommands',
      job.allowedWorkspaceCommands ? 'warning' : 'fail',
      'Non-default workspace command found. This may conflict with captured work zero.',
    );
  } else if (parsed.analysis.hasG54) {
    addCheck(checks, 'workspaceCommands', 'pass', 'G54 default workspace command found.');
  } else {
    addCheck(checks, 'workspaceCommands', 'pass', 'No explicit workspace command found. G54 default workspace will be applied at start.');
  }

  if (parsed.analysis.hasSpindleOn) addCheck(checks, 'spindle', 'warning', 'File contains M3/M4 spindle or laser enable command');
  else addCheck(checks, 'spindle', 'pass', 'No spindle/laser enable command detected');

  const workZero = job.workZero;
  if (hasRawCapture(workZero?.beforeG92) && hasRawCapture(workZero?.afterG92)) {
    addCheck(checks, 'workZero', 'pass', 'Work zero has before/after G92 captures');
  } else if (hasRawCapture(workZero?.beforeG92)) {
    addCheck(checks, 'workZero', 'warning', 'Current position was captured, but G92 work zero has not been set');
  } else {
    addCheck(checks, 'workZero', 'fail', 'Work zero is missing');
  }

  if (jobExists) addCheck(checks, 'jobJson', 'pass', 'Job JSON exists or was saved in this session');
  else addCheck(checks, 'jobJson', 'warning', 'Job JSON has not been saved yet');

  if (parsed.analysis.fatalErrors > 0) addCheck(checks, 'parser', 'fail', 'Preview parser reported fatal errors');
  else addCheck(checks, 'parser', 'pass', 'Preview parser completed');

  if (parsed.analysis.unsupportedTotal > 20) {
    addCheck(checks, 'unsupportedCommands', 'warning', 'Unsupported commands are frequent; preview may be incomplete');
  }
  if (parsed.analysis.arcSkipped > 0) addCheck(checks, 'arcsSkipped', 'warning', `${parsed.analysis.arcSkipped} arc move(s) were skipped`);
  if (parsed.analysis.arcApproximated > 0) addCheck(checks, 'arcsApproximated', 'warning', `${parsed.analysis.arcApproximated} arc move(s) were approximated`);

  if (job.gcodePath || job.sourceGcodePath || job.activeRun || job.placement) {
    const activeRun = getActiveRun(job);
    const activeCheck = assertCanUseActiveRunForExecution(job);
    if (!activeCheck.ok) {
      addCheck(checks, 'activeRun', 'fail', activeCheck.message);
    } else if (activeRun.mode === 'generated') {
      addCheck(checks, 'activeRun', 'pass', `Active generated run: ${activeRun.path}`);
    } else {
      addCheck(checks, 'activeRun', 'pass', `Active source run: ${activeRun.path}`);
    }
  }

  let state = 'READY';
  if (checks.some((check) => check.level === 'fail')) state = 'NOT_READY';
  else if (checks.some((check) => check.level === 'warning')) state = 'WARNINGS';

  return { state, updatedAt: now(), checks };
}

export function nextJobAction({ currentJob = null, jobStatus = {}, job = {} }) {
  const state = String(jobStatus.state || 'UNKNOWN').toUpperCase();
  if (!currentJob?.gcodePath) return { label: 'Choose G-code File', view: 'files' };
  const jobWithPath = {
    ...job,
    gcodePath: job.gcodePath || currentJob.gcodePath,
    sourceGcodePath: job.sourceGcodePath || currentJob.gcodePath,
  };
  if (['RUNNING', 'PREPARING', 'RESUMING'].includes(state)) return { label: 'Monitor Job', view: 'job' };
  if (state === 'PAUSED') return { label: 'Resume Job', api: '/api/job/resume' };
  if (state === 'STOPPED' || state === 'ERROR') return { label: 'Open Log', view: 'logs' };
  if (!jobWithPath.preview?.bounds && !jobWithPath.preview?.generatedRunBounds) return { label: 'Open Preview', target: 'preview' };
  if (!assertCanUseActiveRunForExecution(jobWithPath).ok) {
    return { label: 'Update Run File', target: 'preview' };
  }
  if (!jobWithPath.workZero?.beforeG92 || !jobWithPath.workZero?.afterG92) return { label: 'Set Work Zero', target: 'setup' };
  if (!jobWithPath.toolZero?.afterG92Z?.rawM114 && !jobWithPath.toolZero?.capturedAt) return { label: 'Set Z Zero', target: 'setup' };
  if (jobWithPath.preflight?.state === 'NOT_READY') return { label: 'Review Preflight', target: 'preflight' };
  if (jobWithPath.dryRun?.lastBoundingBoxTraceStatus !== 'complete' && jobWithPath.dryRun?.lastAircutStatus !== 'complete') return { label: 'Run Bounding Box', target: 'dryrun' };
  if (jobWithPath.arm?.state !== 'ARMED') return { label: 'Arm Job', target: 'arm' };
  return { label: 'Start Cut', target: 'run' };
}
