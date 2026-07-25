import { parseGCodeToToolpath } from './toolpath-model.js';

const UNSAFE_GENERATED_RE = /\b(G28|G53|G92|G91|G5[5-9](?:\.[1-3])?|M3|M4)\b/i;

function nowIso() {
  return new Date().toISOString();
}

function safeFingerprint(text = '') {
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return `size:${bytes.length}:fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function fingerprintParts(value = '') {
  const text = String(value || '').trim();
  return {
    value: text,
    size: text.match(/(?:^|:)size:(\d+)(?=:|$)/i)?.[1] || '',
    fnv1a: text.match(/(?:^|:)fnv1a(?:32)?:([0-9a-f]+)(?=:|$)/i)?.[1]?.toLowerCase() || '',
    cyrb53: text.match(/(?:^|:)cyrb53:([0-9a-f]+)(?=:|$)/i)?.[1]?.toLowerCase() || '',
  };
}

export function fingerprintsMatch(left, right) {
  const a = fingerprintParts(left);
  const b = fingerprintParts(right);
  if (!a.value || !b.value) return false;
  if (a.value === b.value) return true;
  return Boolean(a.size && b.size && a.fnv1a && b.fnv1a && a.size === b.size && a.fnv1a === b.fnv1a);
}

function stripComments(line) {
  return String(line || '').replace(/\([^)]*\)/g, '').replace(/;.*/, '').trim();
}

function modalPreambleOk(text) {
  const commands = String(text || '')
    .split(/\r?\n/)
    .map(stripComments)
    .filter(Boolean)
    .slice(0, 8)
    .join('\n')
    .toUpperCase();
  return ['G21', 'G90', 'G17', 'G54'].every((cmd) => new RegExp(`\\b${cmd}\\b`).test(commands));
}

function boundsWithinMachine(bounds, machine = { xMin: 0, xMax: 1625, yMin: 0, yMax: 5800 }) {
  if (!bounds || !Number.isFinite(bounds.xMin)) return false;
  return bounds.xMin >= machine.xMin && bounds.xMax <= machine.xMax &&
    bounds.yMin >= machine.yMin && bounds.yMax <= machine.yMax;
}

function boundsOutsideMachine(bounds, machine = { xMin: 0, xMax: 1625, yMin: 0, yMax: 5800 }) {
  if (!bounds || !Number.isFinite(bounds.xMin)) return false;
  return bounds.xMin < machine.xMin || bounds.xMax > machine.xMax ||
    bounds.yMin < machine.yMin || bounds.yMax > machine.yMax;
}

export function defaultActiveRun(sourcePath, now = nowIso()) {
  return {
    mode: 'source',
    path: sourcePath || '',
    reason: 'identity-placement',
    updatedAt: now,
    selectedAt: now,
    selectedBy: 'default',
    sourceFingerprint: '',
    generatedFingerprint: '',
    transformFingerprint: '',
  };
}

export function ensureActiveRun(job = {}, sourcePath = job.sourceGcodePath || job.gcodePath || '') {
  if (!job.sourceGcodePath) job.sourceGcodePath = sourcePath;
  if (!job.gcodePath) job.gcodePath = sourcePath;
  if (!job.activeRun?.path) job.activeRun = defaultActiveRun(sourcePath);
  return job;
}

export function getSourceGcodePath(job = {}) {
  return job.sourceGcodePath || job.gcodePath || '';
}

export function getActiveRun(job = {}) {
  const sourcePath = getSourceGcodePath(job);
  const active = job.activeRun || {};
  return {
    ...defaultActiveRun(sourcePath),
    ...active,
    mode: active.mode === 'generated' ? 'generated' : 'source',
    path: active.path || sourcePath,
  };
}

export function isDefaultPlacement(placement = {}) {
  return Math.abs(Number(placement.rotationDeg || 0)) < 0.0001 && !placement.autoShiftToWorkZero;
}

export function desiredRunModeForPlacement(placement = {}) {
  return isDefaultPlacement(placement) ? 'source' : 'generated';
}

export function isPlacementIdentity(job = {}) {
  return isDefaultPlacement(job.placement || {});
}

export function requiresGeneratedRun(job = {}) {
  return desiredRunModeForPlacement(job.placement || {}) === 'generated';
}

export function getActiveRunFingerprint(job = {}) {
  const active = getActiveRun(job);
  return active.mode === 'generated'
    ? active.generatedFingerprint || job.generatedValidation?.generatedFingerprint || ''
    : active.sourceFingerprint || job.placement?.sourceFingerprint || '';
}

export function getExecutionPath(job = {}) {
  return getActiveRun(job).path || getSourceGcodePath(job);
}

export function isGeneratedRunUsable(job = {}) {
  const active = getActiveRun(job);
  const validation = job.generatedValidation || {};
  const expectedPath = job.placement?.generatedRunPath || job.generatedRunPath || '';
  if (active.mode !== 'generated') return { ok: true, reason: 'ok', message: 'Source run does not require generated validation.' };
  if (!active.path) return { ok: false, reason: 'active_path_missing', message: 'Generated run path is missing.' };
  if (!expectedPath) return { ok: false, reason: 'generated_missing', message: 'Generated run file is missing. Update Run File before dry run or cutting.' };
  if (active.path !== expectedPath) {
    return { ok: false, reason: 'generated_stale', message: 'Active generated path does not match the current placement. Update Run File before dry run or cutting.' };
  }
  if (job.placement?.dirty) {
    return { ok: false, reason: 'generated_stale', message: 'Placement is transformed, but generated run file is not valid. Update Run File before dry run or cutting.' };
  }
  if (validation.status !== 'valid') {
    const reason = validation.status === 'missing'
      ? 'generated_missing'
      : validation.status === 'stale' || validation.status === 'pending'
        ? 'generated_stale'
        : 'generated_invalid';
    return { ok: false, reason, message: 'Placement is transformed, but generated run file is not valid. Update Run File before dry run or cutting.' };
  }
  if (active.generatedFingerprint && validation.generatedFingerprint &&
      !fingerprintsMatch(active.generatedFingerprint, validation.generatedFingerprint)) {
    return { ok: false, reason: 'generated_stale', message: 'Generated run fingerprint changed. Review and re-arm before cutting.' };
  }
  if (active.transformFingerprint && validation.transformFingerprint && active.transformFingerprint !== validation.transformFingerprint) {
    return { ok: false, reason: 'generated_stale', message: 'Placement transform changed. Update Run File before dry run or cutting.' };
  }
  return { ok: true, reason: 'ok', message: 'Generated run file is valid.' };
}

export function assertCanUseActiveRunForExecution(job = {}, options = {}) {
  const active = getActiveRun(job);
  const reasons = [];
  if (!active.path) reasons.push({ reason: 'active_path_missing', message: 'Active run path is missing.' });

  if (requiresGeneratedRun(job) && active.mode !== 'generated') {
    reasons.push({
      reason: 'generated_missing',
      message: 'Placement is transformed, but generated run file is not valid. Update Run File before dry run or cutting.',
    });
  }

  const generated = isGeneratedRunUsable(job);
  if (!generated.ok) reasons.push(generated);

  if (options.requireArm && job.arm?.state !== 'ARMED') {
    reasons.push({ reason: 'arm_stale', message: 'Job is not armed.' });
  }
  if (options.requireArm && job.arm?.state === 'ARMED') {
    const arm = job.arm || {};
    if (arm.activeRunPath && arm.activeRunPath !== active.path) {
      reasons.push({ reason: 'arm_stale', message: 'Active run changed after arming. Review and re-arm the job.' });
    }
    if (arm.activeRunMode && arm.activeRunMode !== active.mode) {
      reasons.push({ reason: 'arm_stale', message: 'Active run mode changed after arming. Review and re-arm the job.' });
    }
    const currentFingerprint = getActiveRunFingerprint(job);
    if (arm.activeRunFingerprint && currentFingerprint && !fingerprintsMatch(arm.activeRunFingerprint, currentFingerprint)) {
      reasons.push({ reason: 'arm_stale', message: 'Active run fingerprint changed after arming. Review and re-arm the job.' });
    }
    if (active.mode === 'generated' && arm.transformFingerprint && active.transformFingerprint && arm.transformFingerprint !== active.transformFingerprint) {
      reasons.push({ reason: 'arm_stale', message: 'Placement transform changed after arming. Review and re-arm the job.' });
    }
  }

  if (options.requireDryRun && job.dryRun) {
    const dryRun = job.dryRun || {};
    const dryRunOk = dryRun.lastBoundingBoxTraceStatus === 'complete' || dryRun.lastAircutStatus === 'complete';
    const dryRunPath = dryRun.activeRunPath || dryRun.runPath || '';
    const dryRunFingerprint = dryRun.activeRunFingerprint || '';
    const currentFingerprint = getActiveRunFingerprint(job);
    if (!dryRunOk) {
      reasons.push({ reason: 'dry_run_stale', message: 'Dry run has not been completed for the active run file.' });
    } else if (dryRunPath && dryRunPath !== active.path) {
      reasons.push({ reason: 'dry_run_stale', message: 'Dry run was completed for another run file. Repeat dry run before arming.' });
    } else if (dryRunFingerprint && currentFingerprint && !fingerprintsMatch(dryRunFingerprint, currentFingerprint)) {
      reasons.push({ reason: 'dry_run_stale', message: 'Dry run fingerprint is stale. Repeat dry run before arming.' });
    }
  }

  return reasons.length
    ? { ok: false, reason: reasons[0].reason, message: reasons[0].message, reasons }
    : { ok: true, reason: 'ok', message: 'Active run is ready for execution.', activeRun: active };
}

export function markExecutionStateStaleIfPathChanged(job = {}, previousActiveRun = null) {
  const previous = previousActiveRun || {};
  const active = getActiveRun(job);
  if (!previous.path || (previous.path === active.path && previous.mode === active.mode)) return false;
  invalidateArmAndDryRun(job, 'Active run file changed. Review, dry run, and re-arm before cutting.');
  return true;
}

export function validateGeneratedRun(options = {}) {
  const {
    text,
    generatedPath = '',
    sourceFingerprint = '',
    expectedSourceFingerprint = '',
    expectedGeneratedFingerprint = '',
    transformFingerprint = '',
    expectedTransformFingerprint = '',
    placementBounds = null,
    machine,
  } = options;
  const warnings = [];
  const errors = [];
  if (!generatedPath) errors.push('Generated run path is missing.');
  if (text === null || text === undefined) {
    return {
      status: 'missing',
      validatedAt: nowIso(),
      sourceFingerprint,
      generatedFingerprint: '',
      transformFingerprint,
      warnings,
      errors: ['Generated run file is missing.'],
      bounds: null,
      feed: null,
      estimate: null,
    };
  }
  if (!modalPreambleOk(text)) errors.push('Generated file does not contain expected G21/G90/G17/G54 preamble.');
  const cleaned = String(text).split(/\r?\n/).map(stripComments).join('\n');
  const unsafe = cleaned.match(UNSAFE_GENERATED_RE);
  if (unsafe) errors.push(`Generated file contains unsafe command ${unsafe[1].toUpperCase()}.`);

  const model = parseGCodeToToolpath(text);
  const generatedFingerprint = safeFingerprint(text);
  if (expectedGeneratedFingerprint && !fingerprintsMatch(generatedFingerprint, expectedGeneratedFingerprint)) {
    errors.push('Generated file fingerprint does not match job metadata.');
  }
  if (expectedSourceFingerprint && sourceFingerprint && !fingerprintsMatch(sourceFingerprint, expectedSourceFingerprint)) {
    errors.push('Source file fingerprint changed after generation.');
  }
  if (expectedTransformFingerprint && transformFingerprint && transformFingerprint !== expectedTransformFingerprint) {
    errors.push('Placement transform changed after generation.');
  }
  const bounds = model.bounds.placementBounds || model.bounds.rawTravelBounds;
  const placementFits = boundsWithinMachine(placementBounds, machine);
  if (boundsOutsideMachine(bounds, machine) && placementFits) {
    warnings.push('Generated file includes travel or lead-in moves outside the placement bounds. Review work-zero clearance before cutting.');
  } else if (!boundsWithinMachine(bounds, machine)) {
    warnings.push('Generated bounds exceed configured machine work area.');
  }
  const stale = errors.some((error) => error.includes('changed') || error.includes('fingerprint'));
  return {
    status: errors.length ? (stale ? 'stale' : 'invalid') : 'valid',
    validatedAt: nowIso(),
    sourceFingerprint,
    generatedFingerprint,
    transformFingerprint,
    warnings,
    errors,
    bounds,
    feed: { ...model.feed },
    estimate: { ...model.estimate },
  };
}

function invalidateArmAndDryRun(job, reason) {
  if (job.arm?.state === 'ARMED') {
    job.arm = { ...job.arm, state: 'STALE', staleReason: reason };
  }
  if (job.dryRun) {
    job.dryRun = {
      ...job.dryRun,
      lastBoundingBoxTraceStatus: 'stale',
      lastAircutStatus: 'stale',
      staleReason: reason,
    };
  }
  if (job.verificationDecision?.result === 'complete') {
    job.verificationDecision = {
      ...job.verificationDecision,
      staleReason: reason,
      staleAt: nowIso(),
    };
  }
  if (job.startAuthorization) {
    job.startAuthorization = {
      state: 'pending',
      activeRunPath: '',
      activeRunFingerprint: '',
      activeRunSizeBytes: 0,
      frameMode: '',
      verificationType: '',
      checklist: {},
      authorizedAt: null,
    };
  }
}

export function selectGeneratedRun(job, validation, now = nowIso()) {
  ensureActiveRun(job);
  if (validation?.status !== 'valid') return false;
  const path = job.placement?.generatedRunPath || job.generatedRunPath;
  if (!path) return false;
  const changed = job.activeRun?.path !== path || job.activeRun?.mode !== 'generated';
  job.generatedValidation = {
    ...(job.generatedValidation || {}),
    ...validation,
  };
  job.activeRun = {
    mode: 'generated',
    path,
    reason: 'placement-transform',
    updatedAt: now,
    selectedAt: now,
    selectedBy: 'placement',
    sourceFingerprint: validation.sourceFingerprint || job.placement?.sourceFingerprint || '',
    generatedFingerprint: validation.generatedFingerprint || '',
    transformFingerprint: validation.transformFingerprint || job.placement?.transformFingerprint || '',
  };
  if (job.placement) job.placement.dirty = false;
  if (changed) invalidateArmAndDryRun(job, 'Active run file changed to generated.');
  return true;
}

export function selectSourceRun(job, sourcePath = job.sourceGcodePath || job.gcodePath || '', now = nowIso()) {
  ensureActiveRun(job, sourcePath);
  const changed = job.activeRun?.path !== sourcePath || job.activeRun?.mode !== 'source';
  job.activeRun = {
    mode: 'source',
    path: sourcePath,
    reason: 'identity-placement',
    updatedAt: now,
    selectedAt: now,
    selectedBy: 'user',
    sourceFingerprint: job.activeRun?.sourceFingerprint || '',
    generatedFingerprint: '',
    transformFingerprint: '',
  };
  if (changed) invalidateArmAndDryRun(job, 'Active run file changed to source.');
  return true;
}

export function markPlacementChanged(job, options = {}, now = nowIso()) {
  ensureActiveRun(job);
  const {
    placement = job.placement || {},
    generatedRunPath = job.placement?.generatedRunPath || job.generatedRunPath || '',
    sourceFingerprint = job.activeRun?.sourceFingerprint || '',
    transformFingerprint = placement.transformFingerprint || '',
  } = options;
  const desiredMode = desiredRunModeForPlacement(placement);
  job.placement = {
    ...(job.placement || {}),
    ...placement,
    dirty: desiredMode === 'generated',
    transformFingerprint,
  };
  if (desiredMode === 'source') return 'source';

  const changed = job.activeRun?.mode !== 'generated' || job.activeRun?.path !== generatedRunPath;
  job.activeRun = {
    mode: 'generated',
    path: generatedRunPath,
    reason: 'placement-transform',
    updatedAt: now,
    selectedAt: job.activeRun?.selectedAt || now,
    selectedBy: 'placement',
    sourceFingerprint,
    generatedFingerprint: '',
    transformFingerprint,
  };
  job.generatedRunPath = generatedRunPath || job.generatedRunPath || null;
  job.generatedValidation = {
    ...(job.generatedValidation || {}),
    status: job.generatedValidation?.status === 'invalid' ? 'invalid' : 'pending',
    validatedAt: now,
    sourceFingerprint,
    generatedFingerprint: '',
    transformFingerprint,
    warnings: job.generatedValidation?.warnings || [],
    errors: ['Placement changed. Run file must be updated before dry run or cutting.'],
    bounds: job.generatedValidation?.bounds || null,
    feed: job.generatedValidation?.feed || null,
    estimate: job.generatedValidation?.estimate || null,
  };
  if (changed || desiredMode === 'generated') invalidateArmAndDryRun(job, 'Placement changed; generated run file must be updated.');
  return 'generated';
}
