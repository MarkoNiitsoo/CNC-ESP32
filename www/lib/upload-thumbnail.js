export const THUMBNAIL_SIZE = 128;
export const JOB_SCHEMA_VERSION = 3;

export function isGcodeFileName(name = '') {
  return /\.(gcode|gc|nc|tap)$/i.test(String(name));
}

export function thumbnailFileName(name = '') {
  const safe = String(name).split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]/g, '_');
  return `${safe || 'toolpath'}.png`;
}

export function thumbnailPathFor(name = '') {
  return `/jobs/thumbs/${thumbnailFileName(name)}`;
}

export function jobPathForUpload(name = '') {
  const normalized = String(name).replace(/^\/+/, '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const safe = normalized.replace(/[^A-Za-z0-9._-]/g, '_').slice(-72) || 'job';
  return `/jobs/${safe}-${(hash >>> 0).toString(16).padStart(8, '0')}.job.json`;
}

export function mergeUploadedFileMetadata(existingJob, details = {}) {
  const now = details.updatedAt || new Date().toISOString();
  const base = existingJob && Number(existingJob.schemaVersion) === JOB_SCHEMA_VERSION ? existingJob : {};
  return {
    ...base,
    schemaVersion: JOB_SCHEMA_VERSION,
    createdAt: base.createdAt || now,
    updatedAt: now,
    gcodePath: details.gcodePath,
    sourceGcodePath: base.sourceGcodePath || details.gcodePath,
    jobPath: details.jobPath,
    thumbnailPath: details.thumbnailPath,
    preview: {
      ...(base.preview || {}),
      ...(details.preview || {}),
    },
    frameDecision: base.frameDecision || { mode: 'pending', bootSessionId: '', homingSessionId: '', acknowledgedAt: null },
    workZeroDecision: base.workZeroDecision || { mode: 'pending', token: '', bootSessionId: '', capturedAt: null },
    verificationDecision: base.verificationDecision || { type: 'pending', result: 'pending' },
    startAuthorization: base.startAuthorization || { state: 'pending' },
  };
}
