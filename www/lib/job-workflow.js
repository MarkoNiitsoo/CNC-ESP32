export const JOB_SCHEMA_VERSION = 3;

export function emptyWorkflow() {
  return {
    frameDecision: {
      mode: 'pending',
      bootSessionId: '',
      homingSessionId: '',
      acknowledgedAt: null,
    },
    workZeroDecision: {
      mode: 'pending',
      token: '',
      bootSessionId: '',
      capturedAt: null,
    },
    verificationDecision: {
      type: 'pending',
      result: 'pending',
      activeRunPath: '',
      activeRunFingerprint: '',
      activeRunSizeBytes: 0,
      transformFingerprint: '',
      workZeroToken: '',
      safeZ: null,
      margin: null,
      decidedAt: null,
    },
    startAuthorization: {
      state: 'pending',
      activeRunPath: '',
      activeRunFingerprint: '',
      activeRunSizeBytes: 0,
      frameMode: '',
      verificationType: '',
      checklist: {},
      authorizedAt: null,
    },
  };
}

export function isJobV3(job) {
  return Number(job?.schemaVersion) === JOB_SCHEMA_VERSION;
}

export function workflowFor(job = {}) {
  const defaults = emptyWorkflow();
  return {
    frameDecision: { ...defaults.frameDecision, ...(job.frameDecision || {}) },
    workZeroDecision: { ...defaults.workZeroDecision, ...(job.workZeroDecision || {}) },
    verificationDecision: { ...defaults.verificationDecision, ...(job.verificationDecision || {}) },
    startAuthorization: { ...defaults.startAuthorization, ...(job.startAuthorization || {}) },
  };
}

export function activeRunIdentity(job = {}) {
  const active = job.activeRun || {};
  const fingerprint = active.mode === 'generated'
    ? active.generatedFingerprint || job.generatedValidation?.generatedFingerprint || ''
    : active.sourceFingerprint || '';
  return {
    path: active.path || job.sourceGcodePath || job.gcodePath || '',
    fingerprint,
    sizeBytes: Number(active.sizeBytes) || 0,
    transformFingerprint: active.transformFingerprint || job.placement?.transformFingerprint || '',
  };
}

export function workZeroToken(job = {}) {
  const workflow = workflowFor(job);
  return workflow.workZeroDecision.token || job.activeWorkZeroId || '';
}

export function frameStatus(job = {}, context = {}) {
  const workflow = workflowFor(job);
  const frame = context.machineFrame || {};
  if (frame.trusted === true && frame.absoluteFromHome === true) {
    return { ok: true, mode: 'homed', label: 'Machine homed' };
  }
  const manual = workflow.frameDecision;
  const bootMatches = Boolean(context.bootSessionId && manual.bootSessionId === context.bootSessionId);
  if (manual.mode === 'manual-unhomed' && manual.acknowledgedAt && bootMatches) {
    return { ok: true, mode: 'manual-unhomed', label: 'Homing deliberately skipped', warning: true };
  }
  return { ok: false, mode: 'pending', label: 'Machine position is not trusted' };
}

export function workZeroStatus(job = {}, context = {}) {
  const workflow = workflowFor(job);
  const frame = frameStatus(job, context);
  const decision = workflow.workZeroDecision;
  if (!frame.ok) return { ok: false, mode: 'pending', label: 'Resolve machine position first' };
  if (frame.mode === 'homed') {
    const valid = Boolean(decision.token && decision.mode === 'homed' && job.activeWorkZeroId);
    return { ok: valid, mode: decision.mode, label: valid ? 'Work zero ready' : 'Work zero is missing' };
  }
  const bootMatches = Boolean(context.bootSessionId && decision.bootSessionId === context.bootSessionId);
  const validMode = decision.mode === 'manual-set' || decision.mode === 'existing-marlin';
  const valid = Boolean(decision.token && decision.capturedAt && validMode && bootMatches);
  return { ok: valid, mode: decision.mode, label: valid ? 'Manual work coordinates accepted' : 'Choose the current work coordinates' };
}

export function verificationStatus(job = {}, context = {}) {
  const workflow = workflowFor(job);
  const decision = workflow.verificationDecision;
  const identity = activeRunIdentity(job);
  const zeroToken = workZeroToken(job);
  const validType = ['bounds', 'aircut', 'skipped'].includes(decision.type);
  if (decision.result !== 'complete' || !validType) {
    return { ok: false, type: 'pending', reason: 'missing', label: 'Choose a physical verification method' };
  }
  if (decision.activeRunPath !== identity.path || decision.activeRunFingerprint !== identity.fingerprint ||
      Number(decision.activeRunSizeBytes) !== identity.sizeBytes) {
    return { ok: false, type: 'pending', reason: 'run-changed', label: 'Active run changed after physical verification' };
  }
  if (decision.transformFingerprint !== identity.transformFingerprint) {
    return { ok: false, type: 'pending', reason: 'placement-changed', label: 'Placement changed after physical verification' };
  }
  if (decision.workZeroToken !== zeroToken) {
    return { ok: false, type: 'pending', reason: 'zero-changed', label: 'Work zero changed after physical verification' };
  }
  if (decision.type === 'skipped') return { ok: true, type: 'skipped', label: 'Physical check deliberately skipped', warning: true };
  return { ok: true, type: decision.type, label: decision.type === 'bounds' ? 'Bounds Check complete' : 'Full Aircut complete' };
}

export function evaluateWorkflow(job = {}, context = {}) {
  const frame = frameStatus(job, context);
  const zero = workZeroStatus(job, context);
  const verification = verificationStatus(job, context);
  const hardBlockers = Array.isArray(context.hardBlockers) ? context.hardBlockers : [];
  const blockPreparation = context.blockPreparation === true;
  let gate = 'cut';
  if (blockPreparation && hardBlockers.length) gate = 'blocked';
  else if (!frame.ok) gate = 'frame';
  else if (!zero.ok) gate = 'work-zero';
  else if (!verification.ok) gate = 'verification';
  else if (hardBlockers.length) gate = 'blocked';
  return {
    gate,
    frame,
    workZero: zero,
    verification,
    hardBlockers,
    warnings: [frame, verification].filter((item) => item.warning).map((item) => item.label),
  };
}

export function createVerificationDecision(job = {}, options = {}) {
  const identity = activeRunIdentity(job);
  return {
    type: options.type,
    result: 'complete',
    activeRunPath: identity.path,
    activeRunFingerprint: identity.fingerprint,
    activeRunSizeBytes: identity.sizeBytes,
    transformFingerprint: identity.transformFingerprint,
    workZeroToken: workZeroToken(job),
    safeZ: Number.isFinite(Number(options.safeZ)) ? Number(options.safeZ) : null,
    margin: Number.isFinite(Number(options.margin)) ? Number(options.margin) : null,
    decidedAt: options.decidedAt || new Date().toISOString(),
  };
}

export function invalidateStartAuthorization(job = {}) {
  job.startAuthorization = emptyWorkflow().startAuthorization;
  return job;
}
