function errorMessage(value, fallback) {
  return typeof value?.error === 'string' && value.error.trim() ? value.error.trim() : fallback;
}

async function responseJson(res) {
  const text = await res.text();
  if (!text) return {};
  return JSON.parse(text);
}

export async function loadPreviewJobMetadata({
  fetchImpl = fetch,
  jobPath,
  sourcePath,
  isValidJob,
}) {
  let res;
  try {
    res = await fetchImpl(`/api/download?path=${encodeURIComponent(jobPath)}`);
  } catch (error) {
    return { status: 'error', httpStatus: null, error };
  }

  if (res.status === 404) return { status: 'missing' };

  if (!res.ok) {
    let data = {};
    try {
      data = await responseJson(res);
    } catch {
      // HTTP status remains the authoritative failure when its body is malformed.
    }
    return {
      status: 'error',
      httpStatus: res.status,
      error: new Error(errorMessage(data, `HTTP ${res.status}`)),
    };
  }

  let job;
  try {
    job = await responseJson(res);
  } catch (error) {
    return { status: 'invalid', error };
  }

  if (job?.ok === false) {
    return { status: 'invalid', error: new Error(errorMessage(job, 'API returned an error object')) };
  }
  if (!isValidJob(job)) {
    return { status: 'invalid', error: new Error('Job metadata schema is not supported') };
  }
  if (job.sourceGcodePath !== sourcePath) {
    return { status: 'invalid', error: new Error('Job metadata belongs to a different source file') };
  }

  return { status: 'loaded', job };
}

export function previewMetadataWarning(result) {
  if (result?.status === 'invalid') {
    return 'Job metadata is invalid and was not changed. Safety setup must be reviewed.';
  }
  if (result?.status === 'error') {
    const status = result.httpStatus ? ` (HTTP ${result.httpStatus})` : '';
    return `Job metadata could not be loaded${status} and was not changed. Safety setup must be reviewed.`;
  }
  return '';
}
