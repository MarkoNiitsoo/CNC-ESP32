export const DEFAULT_SAFE_Z_CLEARANCE_MM = 0;
export const PROJECT_SAFE_Z_VERSION = 2;

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function calculateProjectSafeZ(input = {}) {
  const extraClearanceMm = finiteOrNull(input.extraClearanceMm ?? input.safeZClearanceMm) ?? 0;
  const errors = [];

  if (extraClearanceMm < 0) {
    errors.push('Extra clearance cannot be negative.');
  }

  const pZ = input.programZ || input.job?.programZ || input.preview?.programZ || input.toolpath?.programZ ||
             (input.projectSafeZ?.programSafeZ !== undefined ? { selectedSafeZ: input.projectSafeZ.programSafeZ, selectedSource: input.projectSafeZ.source, confidence: input.projectSafeZ.confidence, evidence: input.projectSafeZ.evidence } : null) ||
             (input.job?.projectSafeZ?.programSafeZ !== undefined ? { selectedSafeZ: input.job.projectSafeZ.programSafeZ, selectedSource: input.job.projectSafeZ.source, confidence: input.job.projectSafeZ.confidence, evidence: input.job.projectSafeZ.evidence } : null);
  let programSafeZ = finiteOrNull(pZ?.selectedSafeZ);
  let source = pZ?.selectedSource || (programSafeZ !== null ? 'gcode' : 'machine-max');
  let confidence = pZ?.confidence || (programSafeZ !== null ? 'high' : 'fallback');
  const evidence = {
    highestExplicitZ: finiteOrNull(pZ?.highestExplicitZ),
    highestRapidZ: finiteOrNull(pZ?.highestRapidZ),
    highestRetractZ: finiteOrNull(pZ?.highestRetractZ),
    lineNumbers: Array.isArray(pZ?.evidenceLineNumbers)
      ? [...pZ.evidenceLineNumbers]
      : (Array.isArray(pZ?.evidence?.lineNumbers) ? [...pZ.evidence.lineNumbers] : []),
  };

  const frame = input.frame || input.machineFrame || {};
  const limits = input.limits || input.machineLimits || frame.limits || {};
  const zMax = Number(limits.zMax ?? limits.machineZMax ?? frame.safeZ?.machineMax ?? 70);

  if (programSafeZ === null) {
    source = 'machine-max';
    confidence = 'fallback';
    const zeroMachineZ = Number(frame.workZeroMachine?.z);
    if (frame.trusted === true && frame.workZeroValid === true && Number.isFinite(zeroMachineZ) && Number.isFinite(zMax)) {
      programSafeZ = zMax - zeroMachineZ;
    } else {
      errors.push('Safe Z is waiting for a trusted machine position and active Work Zero. Home the machine and restore or set Work Zero.');
    }
  }

  let effectiveSafeZ = (programSafeZ !== null && errors.length === 0)
    ? programSafeZ + extraClearanceMm
    : null;

  if (effectiveSafeZ !== null && frame.trusted === true && frame.workZeroValid === true) {
    const zeroMachineZ = Number(frame.workZeroMachine?.z);
    if (Number.isFinite(zeroMachineZ) && Number.isFinite(zMax)) {
      const effectiveMachineZ = zeroMachineZ + effectiveSafeZ;
      if (effectiveMachineZ > zMax + 0.001) {
        errors.push(`Requested Safe Z Z${effectiveSafeZ.toFixed(1)} maps to machine Z${effectiveMachineZ.toFixed(1)}, but the machine maximum is Z${zMax.toFixed(1)}.`);
        effectiveSafeZ = null;
      }
    }
  }

  return {
    version: PROJECT_SAFE_Z_VERSION,
    source,
    programSafeZ,
    extraClearanceMm,
    effectiveSafeZ,
    confidence,
    evidence,
    resolved: Number.isFinite(effectiveSafeZ) && errors.length === 0,
    errors,
  };
}

export function migrateProjectSafeZ(job = {}, options = {}) {
  const existing = job.projectSafeZ && typeof job.projectSafeZ === 'object'
    ? job.projectSafeZ
    : {};

  let oldAbsoluteSafeZ = finiteOrNull(existing.effectiveSafeZ ?? existing.safeZClearanceMm ?? job.safeStartZ ?? job.dryRun?.safeZ);
  if (existing.version === 1) {
    if (existing.stockTopWorkZ !== null && existing.safeZClearanceMm !== null) {
      oldAbsoluteSafeZ = existing.stockTopWorkZ + existing.safeZClearanceMm;
    }
  }

  let extraClearanceMm = finiteOrNull(existing.extraClearanceMm);
  let legacyProgramZ = null;
  if (extraClearanceMm === null) {
    const pZ = job.programZ || job.preview?.programZ || job.toolpath?.programZ || null;
    const progZ = finiteOrNull(pZ?.selectedSafeZ);
    if (oldAbsoluteSafeZ !== null && progZ !== null) {
      extraClearanceMm = Math.max(0, oldAbsoluteSafeZ - progZ);
    } else if (oldAbsoluteSafeZ !== null) {
      extraClearanceMm = 0;
      legacyProgramZ = { selectedSafeZ: oldAbsoluteSafeZ, selectedSource: 'explicit', confidence: 'medium' };
    } else {
      extraClearanceMm = options.defaultClearanceMm ?? DEFAULT_SAFE_Z_CLEARANCE_MM;
    }
  }

  const calculated = calculateProjectSafeZ({
    ...options,
    job,
    programZ: job.programZ || job.preview?.programZ || job.toolpath?.programZ || legacyProgramZ,
    extraClearanceMm,
  });

  job.projectSafeZ = {
    ...calculated,
    migratedFromVersion1: existing.migratedFromVersion1 || existing.version === 1 || existing.workZeroReference !== undefined,
  };
  return job.projectSafeZ;
}

export function effectiveProjectSafeZ(job = {}) {
  const safeZ = migrateProjectSafeZ(job);
  return safeZ.resolved ? safeZ.effectiveSafeZ : null;
}

export function updateProjectSafeZ(job = {}, changes = {}, options = {}) {
  const previous = migrateProjectSafeZ(job, options);
  if (Object.prototype.hasOwnProperty.call(changes, 'extraClearanceMm') ||
      Object.prototype.hasOwnProperty.call(changes, 'safeZClearanceMm')) {
    const raw = changes.extraClearanceMm ?? changes.safeZClearanceMm;
    const clearance = finiteOrNull(raw);
    if (clearance === null || clearance < 0) {
      throw new RangeError('Safe Z clearance must be a finite non-negative number.');
    }
  }

  const clearance = changes.extraClearanceMm ?? changes.safeZClearanceMm ?? previous.extraClearanceMm;
  const calculated = calculateProjectSafeZ({
    ...options,
    job,
    programZ: job.programZ || job.preview?.programZ || job.toolpath?.programZ,
    extraClearanceMm: clearance,
  });

  const changed = calculated.effectiveSafeZ !== previous.effectiveSafeZ || calculated.extraClearanceMm !== previous.extraClearanceMm;
  job.projectSafeZ = {
    ...calculated,
    migratedFromVersion1: previous.migratedFromVersion1 === true,
  };

  if (changed) {
    markSafeZDependentsStale(job, options);
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
    return { ok: false, workZ, machineZ, error: `Requested Safe Z Z${workZ.toFixed(1)} maps to machine Z${machineZ.toFixed(1)}, but the machine maximum is Z${zMax.toFixed(1)}.` };
  }
  return { ok: true, workZ, machineZ };
}
