const ACTIVE_JOB_STATES = new Set(['PREPARING', 'RUNNING', 'PAUSING', 'PAUSED', 'RESUMING', 'STOPPING']);

export function sanitizeHostnameInput(value, fallback = 'cnc') {
  let hostname = String(value || '').trim().toLowerCase();
  if (hostname.endsWith('.local')) hostname = hostname.slice(0, -6).trim();
  hostname = hostname
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  return hostname || fallback;
}

export function localUrlForHostname(value) {
  return `http://${sanitizeHostnameInput(value)}.local`;
}

export function deviceIdentityLocked(jobState) {
  return ACTIVE_JOB_STATES.has(String(jobState || '').toUpperCase());
}
