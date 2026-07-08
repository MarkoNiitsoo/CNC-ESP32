export const THUMBNAIL_SIZE = 128;

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
  const safe = String(name).split(/[\\/]/).pop();
  return `/jobs/${safe}.job.json`;
}

export function mergeUploadedFileMetadata(existingJob, details = {}) {
  const now = details.updatedAt || new Date().toISOString();
  const base = existingJob && typeof existingJob === 'object' ? existingJob : {};
  return {
    ...base,
    schemaVersion: Number(base.schemaVersion) || 2,
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
  };
}
