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

export function formatEstimateDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 60) return '< 1 min';
  return `${Math.max(1, Math.round(value / 60))} min`;
}

function formatAxisSpan(span) {
  return span < 10 ? span.toFixed(1) : String(Math.round(span));
}

export function formatWorkpieceDimensions(preview = {}) {
  const b = preview?.bounds?.cutBounds || preview?.bounds?.placementBounds || preview?.bounds?.rawTravelBounds || preview?.bounds;
  if (!b) return '';
  const dx = Number(b.xMax) - Number(b.xMin);
  const dy = Number(b.yMax) - Number(b.yMin);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx <= 0 && dy <= 0)) return '';
  return `${formatAxisSpan(Math.max(0, dx))}×${formatAxisSpan(Math.max(0, dy))} mm`;
}

export function fileCardBadges(meta = null) {
  if (!meta) return [];
  const badges = [];
  const warnings = (meta?.preview?.warnings || []).filter(
    (warning) => !/G54 default workspace|default-workspace/i.test(String(warning?.message || warning)),
  );
  if (warnings.length) badges.push(`${warnings.length} need attention`);
  const dimensions = formatWorkpieceDimensions(meta?.preview);
  if (dimensions) badges.push(dimensions);
  const estimate = formatEstimateDuration(
    meta?.preview?.estimate?.effectiveSecondsWithOverride ||
    meta?.preview?.estimate?.nominalSeconds ||
    meta?.preview?.estimatedTimeSeconds,
  );
  if (estimate) badges.push(estimate);
  return badges;
}

export async function regenerateFileThumbnailAndMetadata(gcodePath, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const doc = options.document || globalThis.document;
  const [toolpath, thumbnailSettings] = await Promise.all([
    import('./toolpath-model.js'),
    import('./thumbnail-settings.js'),
  ]);
  const res = await fetchImpl(`/api/download?path=${encodeURIComponent(gcodePath)}`);
  if (!res.ok) throw new Error(`Could not download ${gcodePath}`);
  const text = await res.text();
  const model = toolpath.parseGCodeToToolpath(text);

  const canvas = doc.createElement('canvas');
  canvas.width = THUMBNAIL_SIZE;
  canvas.height = THUMBNAIL_SIZE;
  toolpath.renderToolpathToCanvas(model, canvas, {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    viewMode: thumbnailSettings.loadThumbnailViewMode(),
  });
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Browser could not encode PNG.'))), 'image/png');
  });

  const mkdirRes = await fetchImpl('/api/mkdir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/jobs/thumbs' }),
  });
  if (!mkdirRes.ok && mkdirRes.status !== 409) {
    throw new Error('Could not create /jobs/thumbs');
  }

  const thumbPath = thumbnailPathFor(gcodePath);
  const thumbName = thumbPath.split('/').pop();
  const thumbForm = new FormData();
  thumbForm.append('path', '/jobs/thumbs');
  thumbForm.append('file', new File([blob], thumbName, { type: 'image/png' }));
  const thumbUpload = await fetchImpl('/api/upload?overwrite=true', { method: 'POST', body: thumbForm });
  if (!thumbUpload.ok) throw new Error(`Thumbnail upload failed for ${thumbName}`);

  const jobPath = jobPathForUpload(gcodePath);
  let previous = null;
  try {
    const prevRes = await fetchImpl(`/api/download?path=${encodeURIComponent(jobPath)}`);
    if (prevRes.ok) previous = await prevRes.json().catch(() => null);
  } catch (err) {
    previous = null;
  }
  const nextJob = mergeUploadedFileMetadata(previous, {
    gcodePath,
    jobPath,
    thumbnailPath: thumbPath,
    preview: toolpath.buildPreviewMetadata(model),
  });
  const jobName = jobPath.split('/').pop();
  const jobForm = new FormData();
  jobForm.append('path', '/jobs');
  jobForm.append('file', new File([JSON.stringify(nextJob, null, 2)], jobName, { type: 'application/json' }));
  const jobUpload = await fetchImpl('/api/upload?overwrite=true', { method: 'POST', body: jobForm });
  if (!jobUpload.ok) throw new Error(`Job metadata upload failed for ${jobName}`);
  return nextJob;
}
