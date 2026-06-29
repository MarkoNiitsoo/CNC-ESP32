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
