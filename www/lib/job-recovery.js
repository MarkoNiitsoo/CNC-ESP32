import {
  fingerprintsMatch,
  getActiveRun,
  getActiveRunFingerprint,
  isGeneratedRunUsable,
} from './job-active-run.js';

const RECOVERABLE_STATES = new Set(['stopped', 'interrupted', 'error']);
const ACTIVE_MACHINE_STATES = new Set(['PREPARING', 'RUNNING', 'PAUSING', 'PAUSED', 'RESUMING', 'STOPPING']);

function finitePosition(value) {
  return value && ['x', 'y', 'z'].every((axis) => Number.isFinite(Number(value[axis])));
}

function clonePosition(value, z = Number(value?.z)) {
  return { x: Number(value.x), y: Number(value.y), z };
}

function segmentCommandNumber(segment) {
  return Number(segment?.commandNumber ?? segment?.lineNumber ?? 0);
}

function latestRun(job = {}) {
  const runs = Array.isArray(job.runHistory) ? job.runHistory : [];
  return runs[runs.length - 1] || null;
}

function interruptionLine(run = {}) {
  for (const value of [run.lastAckedLineNumber, run.currentLineNumber, run.lastSentLineNumber]) {
    const line = Number(value);
    if (Number.isFinite(line) && line > 0) return line;
  }
  return null;
}

function insideLimits(position, limits) {
  if (!finitePosition(position) || !limits) return false;
  return position.x >= limits.xMin && position.x <= limits.xMax &&
    position.y >= limits.yMin && position.y <= limits.yMax &&
    position.z >= limits.zMin && position.z <= limits.zMax;
}

function addBlock(blockingReasons, id, message) {
  if (!blockingReasons.some((item) => item.id === id)) blockingReasons.push({ id, message });
}

function emptyResult(status, reason, blockingReasons = []) {
  return {
    status,
    reason,
    interruption: null,
    resumeCandidate: null,
    run: null,
    commands: [],
    visual: {
      completedSegments: [], remainingSegments: [], interruptionMarker: null,
      resumeMarker: null, recoveryTravelPath: [],
    },
    blockingReasons,
    motionOnly: true,
  };
}

export function planMotionOnlyRecovery(options = {}) {
  const job = options.job || {};
  const model = options.toolpathModel;
  const safeZ = Number(options.safeZ ?? 15);
  const limits = options.limits || null;
  const positionTrusted = options.positionTrusted === true;
  const machineState = String(options.machineState || '').toUpperCase();
  const activeRun = getActiveRun(job);
  const activeFingerprint = options.activeRunFingerprint || getActiveRunFingerprint(job);
  const run = latestRun(job);

  if (!activeRun.path) return emptyResult('blocked', 'Active run is missing.', [{ id: 'activeRun', message: 'Active run is missing.' }]);
  if (!model?.segments?.length) return emptyResult('blocked', 'ToolpathModel is missing.', [{ id: 'toolpath', message: 'ToolpathModel is missing.' }]);
  if (!run) return emptyResult('not_available', 'No interrupted run is available.');
  const runState = String(run.state || '').toLowerCase();
  if (runState === 'completed') return emptyResult('not_available', 'Latest run completed normally.');
  if (!RECOVERABLE_STATES.has(runState)) {
    return emptyResult('not_available', 'Latest run is not stopped, interrupted, or in error.');
  }

  const blockingReasons = [];
  const warnings = [];
  if (!run.activeRunPath) {
    addBlock(blockingReasons, 'runActivePathMissing', 'Interrupted run did not record its active run file.');
  } else if (run.activeRunPath !== activeRun.path) {
    addBlock(blockingReasons, 'activeRunPath', 'Interrupted run used a different active run file.');
  }
  if (run.activeRunMode && run.activeRunMode !== activeRun.mode) {
    addBlock(blockingReasons, 'activeRunMode', 'Interrupted run used a different active run mode.');
  }
  if (activeRun.mode === 'generated') {
    const generated = isGeneratedRunUsable(job);
    if (!generated.ok) addBlock(blockingReasons, 'generatedValidation', generated.message);
  }
  if (!run.activeRunFingerprint || !activeFingerprint) {
    addBlock(blockingReasons, 'fingerprintMissing', 'Active run fingerprint is missing.');
  } else if (!fingerprintsMatch(run.activeRunFingerprint, activeFingerprint)) {
    addBlock(blockingReasons, 'fingerprintMismatch', 'Active run fingerprint does not match the interrupted run.');
  }
  if (run.zeroId && run.zeroId !== job.activeWorkZeroId) {
    addBlock(blockingReasons, 'workZeroMismatch', 'Work zero changed after the interrupted run. Resume is blocked because XY/material origin may no longer match the material.');
  }
  if (run.zZeroId && run.zZeroId !== job.activeZZeroId) {
    warnings.push({
      id: 'zZeroChanged',
      message: 'Z zero changed after the interrupted run. This is allowed for safe/test motion; cutting resume requires acknowledgement.',
    });
  }
  if (!positionTrusted) addBlock(blockingReasons, 'positionUntrusted', 'Machine position is not trusted. Home and explicitly confirm position trust.');
  if (ACTIVE_MACHINE_STATES.has(machineState)) addBlock(blockingReasons, 'machineBusy', `Recovery motion is blocked while job state is ${machineState}.`);
  if (!limits || !['xMin', 'xMax', 'yMin', 'yMax', 'zMin', 'zMax'].every((key) => Number.isFinite(Number(limits[key])))) {
    addBlock(blockingReasons, 'limitsMissing', 'Machine limits are missing.');
  }
  if (!Number.isFinite(safeZ) || safeZ <= 0) addBlock(blockingReasons, 'safeZ', 'Safe Z must be a positive number.');
  if (limits && Number.isFinite(safeZ) && (safeZ < Number(limits.zMin) || safeZ > Number(limits.zMax))) {
    addBlock(blockingReasons, 'safeZLimits', `Safe Z ${safeZ} is outside configured Z limits ${limits.zMin}..${limits.zMax}.`);
  }

  const lineNumber = interruptionLine(run);
  if (!lineNumber) addBlock(blockingReasons, 'interruptionLine', 'Interrupted run has no acknowledged line information.');
  const completedSegments = lineNumber
    ? model.segments.filter((segment) => segmentCommandNumber(segment) <= lineNumber)
    : [];
  const remainingSegments = lineNumber
    ? model.segments.filter((segment) => segmentCommandNumber(segment) > lineNumber)
    : [...model.segments];
  const interruptionSegment = completedSegments[completedSegments.length - 1] || null;
  const interruptionPosition = finitePosition(run.lastKnownPosition)
    ? clonePosition(run.lastKnownPosition)
    : interruptionSegment ? clonePosition(interruptionSegment.to) : null;

  let candidate = null;
  for (let index = completedSegments.length - 1; index >= 0; index -= 1) {
    const segment = completedSegments[index];
    if (finitePosition(segment.to) && Number(segment.to.z) > 0) {
      candidate = {
        lineNumber: segmentCommandNumber(segment),
        sourceLineNumber: Number(segment.lineNumber || 0) || null,
        sourcePosition: clonePosition(segment.to),
        position: clonePosition(segment.to, safeZ),
        safeZ,
        type: 'previous-safe-z',
        confidence: run.lastAckedLineNumber ? 'high' : 'medium',
      };
      break;
    }
    if (finitePosition(segment.from) && Number(segment.from.z) > 0) {
      candidate = {
        lineNumber: Math.max(0, segmentCommandNumber(segment) - 1),
        sourceLineNumber: Number(segment.lineNumber || 0) || null,
        sourcePosition: clonePosition(segment.from),
        position: clonePosition(segment.from, safeZ),
        safeZ,
        type: 'segment-start',
        confidence: 'medium',
      };
      break;
    }
  }
  if (!candidate) addBlock(blockingReasons, 'safePoint', 'No previous safe-Z resume point was found before the interruption.');
  if (candidate && limits && !insideLimits(candidate.position, limits)) {
    addBlock(blockingReasons, 'limits', 'Proposed resume point is outside configured machine limits.');
  }

  const travelStart = finitePosition(run.lastKnownPosition)
    ? clonePosition(run.lastKnownPosition, safeZ)
    : interruptionPosition ? clonePosition(interruptionPosition, safeZ) : null;
  const recoveryTravelPath = candidate && travelStart ? [travelStart, clonePosition(candidate.position, safeZ)] : [];

  return {
    status: blockingReasons.length ? 'blocked' : 'available',
    reason: blockingReasons[0]?.message || 'Motion-only recovery candidate is available.',
    run: {
      id: run.id || '',
      state: runState,
      activeRunPath: run.activeRunPath || '',
      activeRunMode: run.activeRunMode || activeRun.mode,
      lastAckedLineNumber: Number(run.lastAckedLineNumber) || null,
      lastSentLineNumber: Number(run.lastSentLineNumber) || null,
      zeroId: run.zeroId || null,
      zZeroId: run.zZeroId || null,
    },
    interruption: {
      lineNumber,
      position: interruptionPosition,
      runId: run.id || '',
    },
    resumeCandidate: candidate,
    visual: {
      completedSegments,
      remainingSegments,
      interruptionMarker: interruptionPosition,
      resumeMarker: candidate?.position || null,
      recoveryTravelPath,
    },
    blockingReasons,
    warnings,
    zZeroChanged: Boolean(run.zZeroId && run.zZeroId !== job.activeZZeroId),
    previousZZeroId: run.zZeroId || null,
    currentZZeroId: job.activeZZeroId || null,
    commands: [],
    activeRunPath: activeRun.path,
    activeRunFingerprint: activeFingerprint,
    motionOnly: true,
  };
}

export function buildMotionOnlyRecoveryCommands(plan, options = {}) {
  const blockingReasons = [...(plan?.blockingReasons || [])];
  const limits = options.limits || null;
  const target = plan?.resumeCandidate?.position;
  const safeZ = Number(plan?.resumeCandidate?.safeZ);
  const travelFeed = Number(options.travelFeedMmMin ?? 3000);
  const zFeed = Number(options.zFeedMmMin ?? 400);
  if (options.positionTrusted !== true) addBlock(blockingReasons, 'positionUntrusted', 'Machine position is not trusted.');
  if (plan?.status !== 'available') addBlock(blockingReasons, 'plan', plan?.reason || 'Recovery plan is not available.');
  if (!insideLimits(target, limits)) addBlock(blockingReasons, 'limits', 'Resume target is outside configured machine limits.');
  if (!Number.isFinite(safeZ) || safeZ <= 0 || Number(target?.z) !== safeZ) {
    addBlock(blockingReasons, 'safeZ', 'Recovery target must remain at Safe Z.');
  }
  if (!Number.isFinite(travelFeed) || travelFeed <= 0 || !Number.isFinite(zFeed) || zFeed <= 0) {
    addBlock(blockingReasons, 'feed', 'Recovery travel feed settings are invalid.');
  }
  if (blockingReasons.length) return { ok: false, commands: [], blockingReasons };

  const number = (value) => Number(value).toFixed(3).replace(/\.000$/, '');
  const commands = [
    'M5',
    'G21',
    'G90',
    'G54',
    `G0 Z${number(safeZ)} F${number(zFeed)}`,
    `G0 X${number(target.x)} Y${number(target.y)} F${number(travelFeed)}`,
    'M400',
  ];
  return { ok: true, commands, blockingReasons: [], motionOnly: true };
}

function toolpathPointInsideLimits(point, limits) {
  return finitePosition(point) && point.x >= limits.xMin && point.x <= limits.xMax &&
    point.y >= limits.yMin && point.y <= limits.yMax &&
    point.z >= limits.zMin && point.z <= limits.zMax;
}

function segmentTargetCommands(segment, travelFeed) {
  const number = (value) => Number(value).toFixed(3).replace(/\.000$/, '');
  if (segment.type === 'arc' && segment.arc?.center && Number.isFinite(segment.arc.sweepRadians)) {
    const axes = [`X${number(segment.to.x)}`, `Y${number(segment.to.y)}`];
    if (Number(segment.to.z) !== Number(segment.from.z)) axes.push(`Z${number(segment.to.z)}`);
    axes.push(
      `I${number(segment.arc.center.x - segment.from.x)}`,
      `J${number(segment.arc.center.y - segment.from.y)}`,
    );
    const feed = Number(segment.feed);
    if (!Number.isFinite(feed) || feed <= 0) return null;
    const code = segment.arc.sweepRadians < 0 ? 'G2' : 'G3';
    return [`${code} ${axes.join(' ')} F${number(feed)}`];
  }

  const points = [segment.to];
  const motion = segment.type === 'rapid' ? 'G0' : 'G1';
  const feed = segment.type === 'rapid' ? travelFeed : Number(segment.feed);
  if (!Number.isFinite(feed) || feed <= 0) return null;
  let previous = segment.from;
  return points.map((point) => {
    const axes = [];
    for (const axis of ['x', 'y', 'z']) {
      if (Number(point[axis]) !== Number(previous[axis])) axes.push(`${axis.toUpperCase()}${number(point[axis])}`);
    }
    previous = point;
    return axes.length ? `${motion} ${axes.join(' ')} F${number(feed)}` : null;
  }).filter(Boolean);
}

export function buildToollessResumeCommands(plan, options = {}) {
  const blockingReasons = [...(plan?.blockingReasons || [])];
  const travelFeed = Number(options.travelFeedMmMin ?? plan?.travelFeedMmMin ?? 3000);
  const zFeed = Number(options.zFeedMmMin ?? plan?.zFeedMmMin ?? 400);
  const candidate = plan?.resumeCandidate;
  if (plan?.status !== 'available') addBlock(blockingReasons, 'plan', plan?.reason || 'Toolless resume plan is not available.');
  if (!candidate?.position || !candidate?.sourcePosition) addBlock(blockingReasons, 'resumeCandidate', 'Safe resume candidate is missing.');
  if (!Number.isFinite(travelFeed) || travelFeed <= 0 || !Number.isFinite(zFeed) || zFeed <= 0) {
    addBlock(blockingReasons, 'feed', 'Toolless resume feed settings are invalid.');
  }
  if (blockingReasons.length) return { ok: false, commands: [], blockingReasons };

  const number = (value) => Number(value).toFixed(3).replace(/\.000$/, '');
  const commands = [
    'M5', 'G21', 'G90', 'G54',
    `G0 Z${number(candidate.safeZ)} F${number(zFeed)}`,
    `G0 X${number(candidate.position.x)} Y${number(candidate.position.y)} F${number(travelFeed)}`,
  ];
  if (Number(candidate.sourcePosition.z) !== Number(candidate.safeZ)) {
    commands.push(`G0 Z${number(candidate.sourcePosition.z)} F${number(zFeed)}`);
  }
  for (const segment of plan.remainingSegments || []) {
    const segmentCommands = segmentTargetCommands(segment, travelFeed);
    if (!segmentCommands) {
      return {
        ok: false,
        commands: [],
        blockingReasons: [{ id: 'feedMissing', message: `Movement command ${segmentCommandNumber(segment)} has no usable feedrate.` }],
      };
    }
    commands.push(...segmentCommands);
  }
  commands.push('M5', 'M400');
  if (commands.length > 20000) {
    return { ok: false, commands: [], blockingReasons: [{ id: 'commandLimit', message: 'Toolless Resume exceeds the 20,000 command safety limit.' }] };
  }
  const forbidden = commands.find((command) => /\b(G28|G53|G92|M3|M4)\b/i.test(command));
  if (forbidden) {
    return { ok: false, commands: [], blockingReasons: [{ id: 'forbiddenCommand', message: `Forbidden command generated: ${forbidden}` }] };
  }
  return { ok: true, commands, blockingReasons: [], mode: 'toolless-resume-test' };
}

export function buildToollessResumePlan(recoveryPlan, toolpathModel, options = {}) {
  const limits = options.limits || null;
  const blockingReasons = [...(recoveryPlan?.blockingReasons || [])];
  const candidate = recoveryPlan?.resumeCandidate || null;
  const travelFeed = Number(options.travelFeedMmMin ?? 3000);
  const zFeed = Number(options.zFeedMmMin ?? 400);
  if (recoveryPlan?.status !== 'available') addBlock(blockingReasons, 'recoveryPlan', recoveryPlan?.reason || 'Recovery plan is unavailable.');
  if (!candidate) addBlock(blockingReasons, 'resumeCandidate', 'No safe resume candidate is available.');
  if (!limits || !['xMin', 'xMax', 'yMin', 'yMax', 'zMin', 'zMax'].every((key) => Number.isFinite(Number(limits[key])))) {
    addBlock(blockingReasons, 'limitsMissing', 'X/Y/Z limits are required for Toolless Resume Test.');
  }

  const unsupportedSource = (toolpathModel?.unsupportedCommands || [])[0];
  if (unsupportedSource) {
    addBlock(blockingReasons, 'unsafeSource', `Active run contains unsupported ${unsupportedSource.command}; Toolless Resume Test is blocked.`);
  }

  const startLineNumber = Number(candidate?.lineNumber) || null;
  const remainingSegments = startLineNumber && Array.isArray(toolpathModel?.segments)
    ? toolpathModel.segments.filter((segment) => segmentCommandNumber(segment) > startLineNumber)
    : [];
  if (!remainingSegments.length) addBlock(blockingReasons, 'remainingPath', 'No remaining motion exists after the safe resume point.');

  const pathPoints = remainingSegments.flatMap((segment) => [segment.from, segment.to, ...(segment.arc?.points || [])]);
  if (candidate?.sourcePosition) pathPoints.push(candidate.sourcePosition);
  if (limits) {
    const outside = pathPoints.find((point) => !toolpathPointInsideLimits(point, limits));
    if (outside) {
      addBlock(blockingReasons, 'pathLimits', `Remaining path exceeds limits at X${outside.x} Y${outside.y} Z${outside.z}.`);
    }
    if (candidate?.position && !toolpathPointInsideLimits(candidate.position, limits)) {
      addBlock(blockingReasons, 'resumeLimits', 'Safe resume position is outside configured limits.');
    }
  }

  const missingFeed = remainingSegments.find((segment) => segment.type !== 'rapid' && (!Number.isFinite(Number(segment.feed)) || Number(segment.feed) <= 0));
  if (missingFeed) addBlock(blockingReasons, 'feedMissing', `Movement command ${segmentCommandNumber(missingFeed)} has no usable feedrate.`);

  const distance = remainingSegments.reduce((sum, segment) => sum + (Number(segment.length) || 0), 0);
  const estimatedSeconds = remainingSegments.reduce((sum, segment) => {
    const feed = segment.type === 'rapid' ? travelFeed : Number(segment.feed);
    return Number.isFinite(feed) && feed > 0 ? sum + ((Number(segment.length) || 0) / feed) * 60 : sum;
  }, 0);
  const zs = pathPoints.map((point) => Number(point?.z)).filter(Number.isFinite);
  const firstZDescent = remainingSegments.find((segment) => Number(segment.to?.z) < Number(segment.from?.z));
  const warnings = (recoveryPlan?.warnings || []).map((item) => item.message || String(item));
  if (recoveryPlan?.zZeroChanged) {
    warnings.push('Z zero changed; real cutting resume would require confirmation.');
  }
  if (remainingSegments.some((segment) => segment.type === 'arc')) warnings.push('G2/G3 arcs are preserved as native Marlin arc commands.');
  if ((toolpathModel?.warnings || []).some((warning) => warning.code === 'spindle-on')) {
    warnings.push('Source contains M3/M4, but Toolless Resume Test omits all spindle/laser start commands.');
  }

  const result = {
    status: blockingReasons.length ? 'blocked' : 'available',
    mode: 'toolless-resume-test',
    reason: blockingReasons[0]?.message || 'Toolless Resume Test is available.',
    startLineNumber,
    resumeCandidate: candidate,
    resumePoint: candidate?.position || null,
    safeZ: Number(candidate?.safeZ),
    minZ: zs.length ? Math.min(...zs) : null,
    firstZDescent: firstZDescent ? { lineNumber: segmentCommandNumber(firstZDescent), fromZ: firstZDescent.from.z, toZ: firstZDescent.to.z } : null,
    bounds: zs.length ? {
      xMin: Math.min(...pathPoints.map((point) => point.x)), xMax: Math.max(...pathPoints.map((point) => point.x)),
      yMin: Math.min(...pathPoints.map((point) => point.y)), yMax: Math.max(...pathPoints.map((point) => point.y)),
      zMin: Math.min(...zs), zMax: Math.max(...zs),
    } : null,
    estimatedSeconds,
    distanceMm: distance,
    warnings,
    blockingReasons,
    remainingSegments,
    travelFeedMmMin: travelFeed,
    zFeedMmMin: zFeed,
    commands: [],
  };
  if (result.status === 'available') {
    const generated = buildToollessResumeCommands(result, options);
    if (!generated.ok) {
      result.status = 'blocked';
      result.blockingReasons.push(...generated.blockingReasons);
      result.reason = result.blockingReasons[0]?.message || 'Toolless resume command generation failed.';
    } else {
      result.commands = generated.commands;
    }
  }
  return result;
}

const PRODUCTION_CHECKLIST = [
  'routerStateSafe',
  'toolSecured',
  'materialUnmoved',
  'workZeroCorrect',
  'fixturesClear',
  'cuttingZUnderstood',
];
const Z_CHANGE_CHECKLIST = ['toolChangeIntentional', 'newZZeroCorrect'];

export function buildProductionResumeCommands(plan, phase = 'phase1') {
  if (!plan || plan.status !== 'available') {
    return { ok: false, commands: [], blockingReasons: plan?.blockingReasons || [{ id: 'plan', message: 'Production Resume plan is unavailable.' }] };
  }
  const commands = phase === 'phase2' ? plan.phase2Commands : plan.phase1Commands;
  if (phase === 'phase2' && !plan.phase2Ready) {
    return { ok: false, commands: [], blockingReasons: [{ id: 'manualCheckpoint', message: 'Manual router checkpoint is not complete.' }] };
  }
  if (!Array.isArray(commands) || !commands.length) {
    return { ok: false, commands: [], blockingReasons: [{ id: 'commands', message: 'Production Resume commands are missing.' }] };
  }
  if (commands.some((command) => /\b(G28|G53|G92|M3|M4)\b/i.test(command))) {
    return { ok: false, commands: [], blockingReasons: [{ id: 'forbiddenCommand', message: 'Production Resume generated a forbidden command.' }] };
  }
  return { ok: true, commands: [...commands], blockingReasons: [], phase };
}

export function buildProductionResumePlan(recoveryPlan, toolpathModel, options = {}) {
  const checklist = options.checklist || {};
  const toolless = buildToollessResumePlan(recoveryPlan, toolpathModel, options);
  const blockingReasons = [...(toolless.blockingReasons || [])];
  const requiredChecklist = [...PRODUCTION_CHECKLIST];
  if (recoveryPlan?.zZeroChanged) requiredChecklist.push(...Z_CHANGE_CHECKLIST);
  const missingChecklist = requiredChecklist.filter((key) => checklist[key] !== true);
  if (missingChecklist.length) {
    addBlock(blockingReasons, 'checklist', `Production Resume checklist is incomplete: ${missingChecklist.join(', ')}.`);
  }

  const full = toolless.commands || [];
  const phase1Commands = full.length >= 6 ? [...full.slice(0, 6), 'M400'] : [];
  const phase2Commands = full.length >= 8 ? ['G21', 'G90', 'G54', ...full.slice(6)] : [];
  const phase1Complete = options.phase1Complete === true;
  const manualRouterConfirmed = options.manualRouterConfirmed === true;
  const result = {
    ...toolless,
    status: blockingReasons.length ? 'blocked' : 'available',
    mode: 'production-resume',
    reason: blockingReasons[0]?.message || 'Guarded Production Resume is available.',
    blockingReasons,
    checklist: Object.fromEntries(requiredChecklist.map((key) => [key, checklist[key] === true])),
    requiredChecklist,
    missingChecklist,
    zZeroChanged: Boolean(recoveryPlan?.zZeroChanged),
    previousZZeroId: recoveryPlan?.previousZZeroId || null,
    currentZZeroId: recoveryPlan?.currentZZeroId || null,
    zZeroChangeAcknowledged: !recoveryPlan?.zZeroChanged || Z_CHANGE_CHECKLIST.every((key) => checklist[key] === true),
    phase1Commands,
    phase2Commands,
    phase1Complete,
    manualRouterConfirmed,
    phase2Ready: phase1Complete && manualRouterConfirmed,
    commands: [],
  };
  return result;
}
