import { getActiveRun, requiresGeneratedRun } from './job-active-run.js';
import { buildJobReadiness } from './job-readiness.js';

export const DEFAULT_LAYERS = Object.freeze({
  path: true,
  bounds: true,
  zero: true,
  travel: true,
  source: true,
  generated: true,
  table: true,
});

export function layoutModeForWidth(width) {
  const value = Number(width) || 0;
  if (value <= 680) return 'edge';
  if (value <= 1100) return 'overlay';
  return 'sidebar';
}

export function createCanvasProjection(options = {}) {
  const {
    width = 0,
    height = 0,
    bounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
    scale = 1,
    panX = 0,
    panY = 0,
  } = options;
  const originX = (width - (bounds.xMax - bounds.xMin) * scale) / 2;
  const originY = (height - (bounds.yMax - bounds.yMin) * scale) / 2;
  return {
    x: (value) => originX + (value - bounds.xMin) * scale + panX,
    y: (value) => height - (originY + (value - bounds.yMin) * scale) + panY,
  };
}

export function zoomPanForGesture(options = {}) {
  const {
    panX = 0,
    panY = 0,
    startPoint = { x: 0, y: 0 },
    currentPoint = startPoint,
    viewportCenter = { x: 0, y: 0 },
    ratio = 1,
  } = options;
  return {
    panX: currentPoint.x - viewportCenter.x - ratio * (startPoint.x - viewportCenter.x - panX),
    panY: currentPoint.y - viewportCenter.y - ratio * (startPoint.y - viewportCenter.y - panY),
  };
}

export function commandedPositionAtLine(segments = [], lineNumber = 0) {
  const line = Number(lineNumber);
  if (!Number.isFinite(line) || line <= 0) return null;
  let position = null;
  for (const segment of segments) {
    const segmentLine = Number(segment?.lineNumber);
    if (!Number.isFinite(segmentLine)) continue;
    if (segmentLine > line) break;
    if (segment?.to && Number.isFinite(segment.to.x) && Number.isFinite(segment.to.y)) {
      position = { x: segment.to.x, y: segment.to.y, z: Number.isFinite(segment.to.z) ? segment.to.z : null };
    }
  }
  return position;
}

export function segmentAtCommand(segments = [], commandNumber = 0) {
  const command = Number(commandNumber);
  if (!Number.isFinite(command) || command <= 0) return null;
  return segments.find((segment) => Number(segment?.commandNumber) === command) || null;
}

export function segmentsBetweenCommands(segments = [], afterCommand = 0, throughCommand = 0) {
  const after = Number(afterCommand);
  const through = Number(throughCommand);
  if (!Number.isFinite(after) || !Number.isFinite(through) || through <= after) return [];
  return segments.filter((segment) => {
    const command = Number(segment?.commandNumber);
    return Number.isFinite(command) && command > after && command <= through;
  });
}

export function commandedPositionAtCommand(segments = [], commandNumber = 0) {
  const command = Number(commandNumber);
  if (!Number.isFinite(command) || command <= 0) return null;
  let position = null;
  for (const segment of segments) {
    const segmentCommand = Number(segment?.commandNumber);
    if (!Number.isFinite(segmentCommand)) continue;
    if (segmentCommand > command) break;
    if (segment?.to && Number.isFinite(segment.to.x) && Number.isFinite(segment.to.y)) {
      position = { x: segment.to.x, y: segment.to.y, z: Number.isFinite(segment.to.z) ? segment.to.z : null };
    }
  }
  return position;
}

export function interpolateMotionSegment(segment, progress = 0) {
  if (!segment?.from || !segment?.to) return null;
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  let x = segment.from.x + (segment.to.x - segment.from.x) * t;
  let y = segment.from.y + (segment.to.y - segment.from.y) * t;
  if (segment.type === 'arc' && segment.arc?.center && Number.isFinite(segment.arc.sweepRadians)) {
    const startAngle = Math.atan2(segment.from.y - segment.arc.center.y, segment.from.x - segment.arc.center.x);
    const radius = Math.hypot(segment.from.x - segment.arc.center.x, segment.from.y - segment.arc.center.y);
    const angle = startAngle + segment.arc.sweepRadians * t;
    x = segment.arc.center.x + Math.cos(angle) * radius;
    y = segment.arc.center.y + Math.sin(angle) * radius;
  }
  const fromZ = Number(segment.from.z);
  const toZ = Number(segment.to.z);
  return { x, y, z: Number.isFinite(fromZ) && Number.isFinite(toZ) ? fromZ + (toZ - fromZ) * t : null };
}

export function motionDurationMs(segment, options = {}) {
  const rapidFeedMmMin = Number(options.rapidFeedMmMin) || 3000;
  const override = Math.max(0.1, Number(options.feedOverridePercent || 100) / 100);
  const feed = segment?.type === 'rapid' ? rapidFeedMmMin : Number(segment?.feed) || rapidFeedMmMin;
  const distance = Number(segment?.length) || 0;
  if (distance <= 0 || feed <= 0) return 40;
  return Math.max(40, Math.min(30000, distance / (feed * override) * 60000));
}

export function workZeroTablePosition(job = {}) {
  const activeId = job.activeWorkZeroId;
  const activeZero = Array.isArray(job.zeroHistory)
    ? job.zeroHistory.find((entry) => entry?.id === activeId && entry?.type === 'workZero')
    : null;
  const position = activeZero?.machineReference?.position || job.workZero?.machineReference?.position ||
    activeZero?.positionBefore || job.workZero?.beforeG92?.position;
  if (!Number.isFinite(Number(position?.x)) || !Number.isFinite(Number(position?.y))) return null;
  return {
    x: Number(position.x),
    y: Number(position.y),
    z: Number.isFinite(Number(position.z)) ? Number(position.z) : null,
  };
}

export function translatePosition(position, offset) {
  if (!Number.isFinite(Number(position?.x)) || !Number.isFinite(Number(position?.y))) return null;
  return {
    ...position,
    x: Number(position.x) + (Number(offset?.x) || 0),
    y: Number(position.y) + (Number(offset?.y) || 0),
  };
}

export function translateBounds(bounds, offset) {
  if (!bounds || !Number.isFinite(bounds.xMin) || !Number.isFinite(bounds.xMax) ||
      !Number.isFinite(bounds.yMin) || !Number.isFinite(bounds.yMax)) return null;
  const x = Number(offset?.x) || 0;
  const y = Number(offset?.y) || 0;
  return { ...bounds, xMin: bounds.xMin + x, xMax: bounds.xMax + x, yMin: bounds.yMin + y, yMax: bounds.yMax + y };
}

export function adaptiveGridStep(scale, targetPixels = 80) {
  const pixelsPerMm = Number(scale);
  if (!Number.isFinite(pixelsPerMm) || pixelsPerMm <= 0) return 100;
  const rawStep = Math.max(0.001, Number(targetPixels) / pixelsPerMm);
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / power;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * power;
}

export function workCoordinateAtMachine(machineValue, workZeroValue = 0) {
  const machine = Number(machineValue);
  const zero = Number(workZeroValue);
  if (!Number.isFinite(machine)) return null;
  return machine - (Number.isFinite(zero) ? zero : 0);
}

export function createWorkbenchState(width = 0) {
  return {
    layoutMode: layoutModeForWidth(width),
    leftDrawer: 'closed',
    rightDrawer: 'closed',
    bottomDrawer: 'compact',
    interactionMode: 'pan',
    layers: { ...DEFAULT_LAYERS },
  };
}

export function reduceWorkbenchState(state, action = {}) {
  const next = {
    ...state,
    layers: { ...(state.layers || DEFAULT_LAYERS) },
  };
  switch (action.type) {
    case 'resize':
      next.layoutMode = layoutModeForWidth(action.width);
      break;
    case 'open-left':
      next.leftDrawer = 'open';
      if (next.layoutMode === 'edge') next.rightDrawer = 'closed';
      break;
    case 'open-right':
      next.rightDrawer = 'open';
      if (next.layoutMode === 'edge') next.leftDrawer = 'closed';
      break;
    case 'close-left':
      next.leftDrawer = 'closed';
      break;
    case 'close-right':
      next.rightDrawer = 'closed';
      break;
    case 'close-drawers':
      next.leftDrawer = 'closed';
      next.rightDrawer = 'closed';
      break;
    case 'toggle-bottom':
      next.bottomDrawer = next.bottomDrawer === 'expanded' ? 'compact' : 'expanded';
      break;
    case 'set-interaction':
      next.interactionMode = action.mode === 'select' ? 'select' : 'pan';
      break;
    case 'toggle-layer':
      if (Object.prototype.hasOwnProperty.call(next.layers, action.layer)) {
        next.layers[action.layer] = !next.layers[action.layer];
      }
      break;
    default:
      break;
  }
  return next;
}

export function activeRunBadge(job = {}) {
  const active = getActiveRun(job);
  if (!requiresGeneratedRun(job)) return { label: 'ORIGINAL', level: 'ok', path: active.path };

  const validation = job.generatedValidation || {};
  if (active.mode !== 'generated' || validation.status === 'invalid') {
    return { label: 'BLOCKED', level: 'fail', path: active.path };
  }
  if (job.placement?.dirty || ['missing', 'pending', 'stale', 'unknown'].includes(validation.status || 'unknown')) {
    return { label: 'STALE', level: 'warn', path: active.path };
  }
  return { label: 'GENERATED', level: 'active', path: active.path };
}

export function readinessBadge(job = {}, options = {}) {
  const live = String(options.jobStatus?.state || '').toUpperCase();
  if (live === 'RUNNING') return { label: 'RUNNING', level: 'active' };
  if (live === 'PAUSED' || live === 'PAUSING') return { label: 'PAUSED', level: 'warn' };
  if (job.arm?.state === 'ARMED') return { label: 'ARMED', level: 'active' };

  const readiness = buildJobReadiness(job, options);
  if (readiness.blockingReasons.length) return { label: 'BLOCKED', level: 'fail' };
  return { label: 'READY', level: 'ok' };
}

export function buildWorkbenchStatus(job = {}, options = {}) {
  const readiness = buildJobReadiness(job, options);
  return {
    activeRun: activeRunBadge(job),
    readiness: readinessBadge(job, options),
    activeRunPath: readiness.activeRun.path,
    blockingReasons: readiness.blockingReasons,
    primaryAction: readiness.primaryAction,
    secondaryActions: readiness.secondaryActions,
  };
}

export function actionPolicy(actionId) {
  if (actionId === 'start_cut') return { mode: 'hold', holdMs: 1000 };
  if (['pause', 'stop', 'm5'].includes(actionId)) return { mode: 'direct', holdMs: 0 };
  return { mode: 'tap', holdMs: 0 };
}
