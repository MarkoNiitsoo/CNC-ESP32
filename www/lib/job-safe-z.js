export const DEFAULT_SAFE_Z_CLEARANCE_MM = 5;
export const PROJECT_SAFE_Z_VERSION = 1;

const REFERENCES = new Set(['top', 'bottom', 'custom', 'unknown']);

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function legacyAbsoluteSafeZ(job = {}) {
  for (const value of [job.safeStartZ, job.dryRun?.safeZ]) {
    const number = finiteOrNull(value);
    if (number !== null) return number;
  }
  return null;
}

export function calculateProjectSafeZ(input = {}) {
  const workZeroReference = REFERENCES.has(input.workZeroReference)
    ? input.workZeroReference
    : 'unknown';
  const workpieceHeightMm = finiteOrNull(input.workpieceHeightMm);
  const safeZClearanceMm = finiteOrNull(input.safeZClearanceMm);
  let stockTopWorkZ = finiteOrNull(input.stockTopWorkZ);
  const errors = [];

  if (safeZClearanceMm === null) errors.push('Safe Z clearance is required.');
  else if (safeZClearanceMm < 0) errors.push('Safe Z clearance cannot be negative.');

  if (workZeroReference === 'top') {
    stockTopWorkZ = 0;
  } else if (workZeroReference === 'bottom') {
    if (workpieceHeightMm === null || workpieceHeightMm < 0) {
      errors.push('Workpiece height is required when Work Zero is at the stock bottom.');
      stockTopWorkZ = null;
    } else {
      stockTopWorkZ = workpieceHeightMm;
    }
  } else if (workZeroReference === 'custom') {
    if (stockTopWorkZ === null) errors.push('Stock-top work Z is required for a custom Work Zero reference.');
  } else {
    errors.push('Select where Work Zero is located relative to the stock.');
    stockTopWorkZ = null;
  }

  const effectiveSafeZ = errors.length === 0
    ? stockTopWorkZ + safeZClearanceMm
    : null;
  return {
    version: PROJECT_SAFE_Z_VERSION,
    workpieceHeightMm,
    workZeroReference,
    stockTopWorkZ,
    safeZClearanceMm,
    effectiveSafeZ,
    resolved: Number.isFinite(effectiveSafeZ),
    errors,
  };
}

export function migrateProjectSafeZ(job = {}, options = {}) {
  const existing = job.projectSafeZ && typeof job.projectSafeZ === 'object'
    ? job.projectSafeZ
    : {};
  const input = {
    workpieceHeightMm: existing.workpieceHeightMm ?? job.workpieceHeightMm ?? null,
    workZeroReference: existing.workZeroReference ?? job.workZeroReference ?? 'unknown',
    stockTopWorkZ: existing.stockTopWorkZ ?? job.stockTopWorkZ ?? null,
    safeZClearanceMm: existing.safeZClearanceMm ?? job.safeZClearanceMm ?? null,
  };
  const stock = calculateProjectSafeZ({ ...input, safeZClearanceMm: 0 });
  const legacySafeZ = legacyAbsoluteSafeZ(job);
  if (input.safeZClearanceMm === null || input.safeZClearanceMm === undefined) {
    if (stock.stockTopWorkZ !== null && legacySafeZ !== null) {
      input.safeZClearanceMm = legacySafeZ - stock.stockTopWorkZ;
    } else {
      input.safeZClearanceMm = options.defaultClearanceMm ?? DEFAULT_SAFE_Z_CLEARANCE_MM;
    }
  }
  const calculated = calculateProjectSafeZ(input);
  job.projectSafeZ = {
    ...calculated,
    migratedFromAbsoluteSafeZ: existing.migratedFromAbsoluteSafeZ === true ||
      (legacySafeZ !== null && stock.stockTopWorkZ !== null),
  };
  return job.projectSafeZ;
}

export function effectiveProjectSafeZ(job = {}) {
  const safeZ = migrateProjectSafeZ(job);
  return safeZ.resolved ? safeZ.effectiveSafeZ : null;
}

export function updateProjectSafeZ(job = {}, changes = {}, options = {}) {
  const previous = migrateProjectSafeZ(job, options);
  if (Object.prototype.hasOwnProperty.call(changes, 'safeZClearanceMm')) {
    const raw = changes.safeZClearanceMm;
    const clearance = finiteOrNull(raw);
    if (clearance === null || clearance < 0) {
      throw new RangeError('Safe Z clearance must be a finite non-negative number.');
    }
  }
  const calculated = calculateProjectSafeZ({ ...previous, ...changes });
  const changed = ['workpieceHeightMm', 'workZeroReference', 'stockTopWorkZ', 'safeZClearanceMm']
    .some((key) => calculated[key] !== previous[key]);
  job.projectSafeZ = {
    ...calculated,
    migratedFromAbsoluteSafeZ: previous.migratedFromAbsoluteSafeZ === true,
  };
  if (changed) {
    markSafeZDependentsStale(job, options);
    if (calculated.workZeroReference !== previous.workZeroReference) job.activeWorkZeroId = null;
  }
  return job.projectSafeZ;
}

export function markSafeZDependentsStale(job = {}, options = {}) {
  const staleAt = options.now || new Date().toISOString();
  const reason = options.reason || 'Project Safe Z changed.';
  if (job.verificationDecision?.result === 'complete') {
    job.verificationDecision = { ...job.verificationDecision, staleAt, staleReason: reason };
  }
  if (job.dryRun) {
    for (const key of ['lastBoundingBoxTraceStatus', 'lastAircutStatus']) {
      if (job.dryRun[key] === 'complete') job.dryRun[key] = 'stale';
    }
    job.dryRun.safeZStaleAt = staleAt;
  }
  if (job.generatedValidation?.status === 'valid') {
    job.generatedValidation = { ...job.generatedValidation, status: 'stale', staleAt, staleReason: reason };
  }
  for (const recovery of Array.isArray(job.recoveries) ? job.recoveries : []) {
    if (!['abandoned', 'marked_finished', 'recovery_completed'].includes(recovery.status)) {
      recovery.safeZValidationStaleAt = staleAt;
    }
  }
  if (job.arm?.state === 'ARMED') job.arm = { ...job.arm, state: 'STALE', staleAt, staleReason: reason };
  if (job.startAuthorization) job.startAuthorization = { state: 'not_authorized' };
  job.startAuthorizationToken = '';
  return job;
}

export function validateProjectSafeZForFrame(projectSafeZ, frame = {}, limits = {}) {
  if (!projectSafeZ?.resolved || !Number.isFinite(Number(projectSafeZ.effectiveSafeZ))) {
    return { ok: false, error: projectSafeZ?.errors?.[0] || 'Project Safe Z is unresolved.' };
  }
  const workZ = Number(projectSafeZ.effectiveSafeZ);
  const zeroMachineZ = Number(frame?.workZeroMachine?.z);
  if (frame?.trusted !== true || frame?.workZeroValid !== true || !Number.isFinite(zeroMachineZ)) {
    return { ok: false, error: 'Project Safe Z requires a trusted machine frame and active Work Zero.' };
  }
  const machineZ = zeroMachineZ + workZ;
  const zMin = Number(limits.zMin ?? frame?.limits?.zMin ?? frame?.safeZ?.machineMin);
  const zMax = Number(limits.zMax ?? frame?.limits?.zMax ?? frame?.safeZ?.machineMax);
  if (Number.isFinite(zMin) && machineZ < zMin - 0.001) {
    return { ok: false, workZ, machineZ, error: `Project Safe Z maps to machine Z ${machineZ.toFixed(3)}, below limit ${zMin.toFixed(3)} mm.` };
  }
  if (Number.isFinite(zMax) && machineZ > zMax + 0.001) {
    return { ok: false, workZ, machineZ, error: `Project Safe Z requires machine Z ${machineZ.toFixed(3)}, but only ${zMax.toFixed(3)} mm is available.` };
  }
  return { ok: true, workZ, machineZ };
}
