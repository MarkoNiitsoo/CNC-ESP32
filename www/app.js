const health = document.querySelector('#health');
const pageTitle = document.querySelector('#page-title');
const clearCurrentJobButton = document.querySelector('#clear-current-job');
const launcherList = document.querySelector('#launcher-list');
const refreshFilesButton = document.querySelector('#refresh-files');
const uploadForm = document.querySelector('#upload-form');
const uploadFile = document.querySelector('#upload-file');
const uploadPreviewEl = document.querySelector('#upload-preview');
const sdStatusEl = document.querySelector('#sd-status');
const currentJobCard = document.querySelector('#current-job-card');
const nextActionCard = document.querySelector('#next-action-card');
const systemSummary = document.querySelector('#system-summary');
const marlinLogEl = document.querySelector('#marlin-log');
const criticalLogEl = document.querySelector('#critical-log');
const refreshLogsButton = document.querySelector('#refresh-logs');

const currentJobKey = 'lowrider.currentJob';
let currentJob = readCurrentJob();
let jobMeta = null;
let jobStatus = { state: 'UNKNOWN' };
let activeFilePath = '';
let pendingUploadPreview = null;

const toolpathModulePromise = import('/lib/toolpath-model.js').catch((err) => {
  console.warn('ToolpathModel unavailable', err);
  return null;
});
let activeRunModule = null;
import('/lib/job-active-run.js')
  .then((module) => {
    activeRunModule = module;
    renderCurrentJob();
  })
  .catch((err) => console.warn('ActiveRun helpers unavailable', err));
let readinessModule = null;
import('/lib/job-readiness.js')
  .then((module) => {
    readinessModule = module;
    renderCurrentJob();
  })
  .catch((err) => console.warn('Job readiness helpers unavailable', err));

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function readCurrentJob() {
  try {
    return JSON.parse(localStorage.getItem(currentJobKey) || 'null');
  } catch (err) {
    return null;
  }
}

function saveCurrentJob(job) {
  currentJob = job;
  if (job) {
    localStorage.setItem(currentJobKey, JSON.stringify(job));
  } else {
    localStorage.removeItem(currentJobKey);
  }
}

function basename(path) {
  const index = String(path || '').lastIndexOf('/');
  return index >= 0 ? path.slice(index + 1) : path;
}

function jobPathFor(gcodePath) {
  return `/jobs/${basename(gcodePath)}.job.json`;
}

function formatBytes(value) {
  const number = Number(value || 0);
  if (number < 1024) return `${number} B`;
  if (number < 1024 * 1024) return `${Math.round(number / 1024)} KB`;
  return `${(number / 1024 / 1024).toFixed(1)} MB`;
}

function formatMinutes(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '-';
  if (value < 60) return `~${Math.max(1, Math.round(value))} sec`;
  return `~${Math.max(1, Math.round(value / 60))} min`;
}

function formatBounds(bounds) {
  if (!bounds || bounds.xMin === null || bounds.xMin === undefined) return '-';
  return `X ${Number(bounds.xMin).toFixed(2)}..${Number(bounds.xMax).toFixed(2)} | Y ${Number(bounds.yMin).toFixed(2)}..${Number(bounds.yMax).toFixed(2)} | Z ${Number(bounds.zMin).toFixed(2)}..${Number(bounds.zMax).toFixed(2)}`;
}

function isGcodeFile(item) {
  return item?.type === 'file' && /\.(gcode|gc|nc|tap)$/i.test(item.name || '');
}

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (err) {
    throw new Error(`Invalid JSON: ${err.message}`);
  }
}

function showView(name) {
  const viewName = name || (currentJob ? 'job' : 'files');
  document.querySelectorAll('.view-section').forEach((section) => {
    section.classList.toggle('active', section.dataset.view === viewName);
  });
  document.querySelectorAll('[data-nav-target]').forEach((link) => {
    link.classList.toggle('active', link.dataset.navTarget === viewName);
  });
  if (pageTitle) {
    pageTitle.textContent = viewName === 'job'
      ? 'Current Job'
      : viewName === 'logs'
        ? 'Logs'
        : viewName === 'settings'
          ? 'Settings'
          : 'Files';
  }
}

function routeFromHash() {
  const target = (window.location.hash || '').slice(1);
  if (['files', 'job', 'logs', 'settings'].includes(target)) {
    showView(target);
    return;
  }
  showView(currentJob ? 'job' : 'files');
}

async function refreshHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await readJson(res);
    const wifi = data.wifiMode && data.ipAddress ? `${data.wifiMode} ${data.ipAddress}` : 'WiFi unknown';
    if (health) health.textContent = `${data.firmwareVersion || data.firmware || 'Pendant'} | ${wifi}`;
    if (systemSummary) {
      systemSummary.innerHTML = `
        <dl>
          <dt>Firmware</dt><dd>${html(data.firmwareVersion || '-')}</dd>
          <dt>Build</dt><dd>${html(data.buildDate || '-')} ${html(data.buildTime || '')}</dd>
          <dt>WiFi</dt><dd>${html(wifi)}</dd>
          <dt>SSID</dt><dd>${html(data.ssid || '-')}</dd>
          <dt>Heap</dt><dd>${formatBytes(data.freeHeap || 0)}</dd>
          <dt>SD</dt><dd>${data.sdMounted ? `${formatBytes(data.sdFreeBytes)} free` : 'not mounted'}</dd>
        </dl>
      `;
    }
  } catch (err) {
    if (health) health.textContent = `Offline: ${err.message}`;
  }
}

async function refreshJobStatus() {
  try {
    const res = await fetch('/api/job/status');
    jobStatus = await readJson(res);
    if (!res.ok) throw new Error(jobStatus.error || 'job status failed');
    if (!currentJob && jobStatus.gcodePath) {
      saveCurrentJob({ gcodePath: jobStatus.gcodePath, jobPath: jobStatus.jobPath || jobPathFor(jobStatus.gcodePath) });
    }
  } catch (err) {
    jobStatus = { state: 'UNKNOWN', lastError: err.message };
  }
}

async function loadJobMeta() {
  jobMeta = null;
  if (!currentJob?.jobPath) return;
  try {
    const res = await fetch(`/api/download?path=${encodeURIComponent(currentJob.jobPath)}`);
    if (!res.ok) return;
    jobMeta = await res.json();
  } catch (err) {
    jobMeta = null;
  }
}

function previewBounds(meta = jobMeta) {
  const bounds = meta?.preview?.bounds;
  return bounds?.placementBounds || bounds?.cutBounds || bounds?.rawTravelBounds || bounds || meta?.preview?.generatedRunBounds || null;
}

function warningCount(meta = jobMeta) {
  return Number(meta?.preview?.warnings?.length || meta?.arm?.warningCount || 0);
}

function hasWorkZero(meta = jobMeta) {
  return Boolean(meta?.workZero?.beforeG92 && meta?.workZero?.afterG92);
}

function hasZZero(meta = jobMeta) {
  return Boolean(meta?.toolZero?.afterG92Z?.rawM114 || meta?.toolZero?.capturedAt);
}

function dryRunDone(meta = jobMeta) {
  return meta?.dryRun?.lastBoundingBoxTraceStatus === 'complete' || meta?.dryRun?.lastAircutStatus === 'complete';
}

function armState(meta = jobMeta) {
  return meta?.arm?.state || 'NOT ARMED';
}

function activeRunNeedsUpdate(meta = jobMeta) {
  if (!meta) return false;
  if (activeRunModule?.assertCanUseActiveRunForExecution) {
    return !activeRunModule.assertCanUseActiveRunForExecution(meta).ok;
  }
  return meta?.activeRun?.mode === 'generated' &&
    (meta?.placement?.dirty || meta?.generatedValidation?.status !== 'valid');
}

function activeRun(meta = jobMeta) {
  if (activeRunModule?.getActiveRun) return activeRunModule.getActiveRun(meta || currentJob || {});
  return {
    mode: meta?.activeRun?.mode || 'source',
    path: meta?.activeRun?.path || currentJob?.gcodePath || '',
  };
}

function jobStateName() {
  return String(jobStatus?.state || 'UNKNOWN').toUpperCase();
}

function activeZeroMeta(type, meta = jobMeta) {
  const id = type === 'zZero' ? meta?.activeZZeroId : meta?.activeWorkZeroId;
  return (meta?.zeroHistory || []).find((zero) => zero.id === id && zero.type === type) || null;
}

function latestRunMeta(meta = jobMeta) {
  return Array.isArray(meta?.runHistory) && meta.runHistory.length ? meta.runHistory[meta.runHistory.length - 1] : null;
}

function shortTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function hasNewerUnusedWorkZero(meta = jobMeta) {
  const zeros = (meta?.zeroHistory || []).filter((zero) => zero.type === 'workZero');
  if (zeros.length < 2) return false;
  return zeros.some((zero) => zero.id !== meta.activeWorkZeroId && !(zero.usedByRuns || []).length);
}

function nextAction() {
  if (readinessModule) {
    const readiness = readinessModule.buildJobReadiness(jobMeta || {}, {
      currentJob,
      jobStatus,
    });
    return readinessActionForDashboard(readiness.primaryAction);
  }
  const state = jobStateName();
  const lastRun = latestRunMeta();
  if (!currentJob?.gcodePath) return { label: 'Choose G-code File', view: 'files' };
  if (state === 'RUNNING' || state === 'PREPARING' || state === 'RESUMING') return { label: 'Monitor Job', view: 'job' };
  if (state === 'PAUSED') return { label: 'Resume Job', api: '/api/job/resume' };
  if (state === 'STOPPED' || state === 'ERROR') return { label: 'Open Log', view: 'logs' };
  if (lastRun?.state === 'stopped' || lastRun?.state === 'interrupted') return { label: 'Review Interrupted Run', href: `${previewUrl()}#setup` };
  if (!previewBounds()) return { label: 'Open Preview', href: previewUrl() };
  if (activeRunNeedsUpdate()) return { label: 'Update Run File', href: `${previewUrl()}#preview` };
  if (!hasWorkZero()) return { label: 'Set Work Zero', href: `${previewUrl()}#setup` };
  if (!hasZZero()) return { label: 'Set Z Zero', href: `${previewUrl()}#setup` };
  if (jobMeta?.preflight?.state === 'NOT_READY') return { label: 'Review Preflight', href: `${previewUrl()}#preflight` };
  if (!dryRunDone()) return { label: 'Run Bounding Box', href: `${previewUrl()}#dryrun` };
  if (armState() !== 'ARMED') return { label: 'Arm Job', href: `${previewUrl()}#arm` };
  return { label: 'Start Cut', href: `${previewUrl()}#run` };
}

function previewUrl(path = currentJob?.gcodePath) {
  return `/preview.html?path=${encodeURIComponent(path || '')}`;
}

function readinessActionForDashboard(action = {}) {
  const target = action.target === 'dryrun' ? 'dry-run' : action.target;
  if (action.id === 'choose_file') return { label: action.label, view: 'files' };
  if (action.id === 'resume_job') return { label: action.label, api: '/api/job/resume' };
  if (action.id === 'monitor_job') return { label: action.label, view: 'job' };
  if (target === 'files') return { label: action.label || 'Choose G-code File', view: 'files' };
  if (target === 'run' && action.id === 'start_cut') return { label: action.label, href: `${previewUrl()}#run` };
  if (target === 'setup' || target === 'preview' || target === 'preflight' || target === 'dry-run' || target === 'arm' || target === 'run') {
    return { label: action.label || 'Open Job', href: `${previewUrl()}#${target}` };
  }
  return { label: action.label || 'Open Job', href: previewUrl() };
}

function dashboardReadiness() {
  if (!readinessModule || !currentJob) return null;
  return readinessModule.buildJobReadiness(jobMeta || {}, {
    currentJob,
    jobStatus,
  });
}

async function postJob(url, message) {
  const res = await fetch(url, { method: 'POST' });
  const data = await readJson(res);
  if (!res.ok || data.ok === false) throw new Error(data.error || message || 'Job action failed');
  await refreshJobStatus();
  renderCurrentJob();
}

function renderCurrentJob() {
  if (clearCurrentJobButton) clearCurrentJobButton.hidden = !currentJob;
  if (!currentJobCard || !nextActionCard) return;

  if (!currentJob) {
    currentJobCard.innerHTML = `
      <h2>No Current Job</h2>
      <p>Select a G-code file to start the job story.</p>
    `;
    nextActionCard.innerHTML = `
      <h2>Next Action</h2>
      <button class="primary-action" type="button" data-action-view="files">Choose G-code File</button>
    `;
    return;
  }

  const bounds = previewBounds();
  const feed = jobMeta?.feedOverride?.startPercent ?? jobStatus?.feedOverridePercent ?? 100;
  const state = jobStateName();
  const critical = window.LowRiderMachineBar?.lastCritical?.() || '';
  const activeWorkZero = activeZeroMeta('workZero');
  const activeZZero = activeZeroMeta('zZero');
  const run = activeRun();
  const readiness = dashboardReadiness();
  const lastRun = latestRunMeta();
  const lastRunBadge = lastRun?.state === 'stopped' || lastRun?.state === 'interrupted'
    ? '<span class="status-badge caution">Last run interrupted/stopped</span>'
    : '';
  currentJobCard.innerHTML = `
    <h2>${html(basename(currentJob.gcodePath))}</h2>
    <p>${html(currentJob.gcodePath)}</p>
    <div class="mini-preview">
      <span>Preview</span>
      <a class="maintenance-link" href="${previewUrl()}">Open Full Preview</a>
    </div>
    <dl>
      <dt>Job state</dt><dd>${html(state)}</dd>
      <dt>Bounds</dt><dd>${bounds ? formatBounds(bounds) : 'Preview needed'}</dd>
      <dt>Warnings</dt><dd>${warningCount()}</dd>
      <dt>Feed override</dt><dd>${html(feed)}%</dd>
      <dt>Estimated time</dt><dd>${formatMinutes(jobMeta?.preview?.estimate?.effectiveSecondsWithOverride || jobMeta?.preview?.estimate?.nominalSeconds || jobMeta?.preview?.estimatedTimeSeconds)}</dd>
      <dt>Source file</dt><dd>${html(jobMeta?.sourceGcodePath || currentJob.gcodePath)}</dd>
      <dt>Run file</dt><dd>${html(run.path || currentJob.gcodePath)}</dd>
      <dt>Run mode</dt><dd><span class="status-badge ${run.mode === 'generated' ? 'active-badge' : ''}">${html(run.mode === 'generated' ? 'USING GENERATED' : 'USING ORIGINAL')}</span></dd>
      <dt>Generated</dt><dd>${html(activeRunNeedsUpdate() ? 'Update required' : (jobMeta?.generatedValidation?.status || '-'))}</dd>
      <dt>Work zero</dt><dd>${activeWorkZero ? html(shortTime(activeWorkZero.capturedAt)) : (hasWorkZero() ? 'OK' : 'Missing')}</dd>
      <dt>Z zero</dt><dd>${activeZZero ? html(shortTime(activeZZero.capturedAt)) : (hasZZero() ? 'OK' : 'Missing')}</dd>
      <dt>Last run</dt><dd>${lastRun ? `${html(lastRun.state || 'started')} ${lastRunBadge}` : '-'}</dd>
      <dt>Dry run</dt><dd>${dryRunDone() ? 'Done' : 'Not done'}</dd>
      <dt>Arm</dt><dd>${html(armState())}</dd>
      <dt>Readiness</dt><dd>${readiness ? readiness.badges.map((badge) => `<span class="status-badge ${badge.level === 'active' ? 'active-badge' : badge.level === 'ok' ? 'ok-badge' : badge.level === 'fail' ? 'fail-badge' : badge.level === 'warn' ? 'caution' : ''}">${html(badge.label)}</span>`).join(' ') : '-'}</dd>
      <dt>Blocking</dt><dd>${readiness?.blockingReasons?.length ? readiness.blockingReasons.map((reason) => html(reason.message)).join('<br>') : 'No blockers before next action'}</dd>
      <dt>Marlin critical</dt><dd>${html(critical || '-')}</dd>
    </dl>
  `;

  const primary = nextAction();
  const buttonAttrs = primary.href
    ? `href="${primary.href}" class="maintenance-link primary-action"`
    : `href="#" class="maintenance-link primary-action" ${primary.api ? `data-primary-api="${primary.api}"` : `data-action-view="${primary.view || ''}"`}`;
  nextActionCard.innerHTML = `
    <h2>Next Action</h2>
    <a ${buttonAttrs}>${html(primary.label)}</a>
    <div class="secondary-actions">
      <a class="maintenance-link" href="${previewUrl()}">Full Preview</a>
      <a class="maintenance-link" href="${previewUrl()}#setup">Set Work / Z Zero</a>
      ${hasNewerUnusedWorkZero() ? `<a class="maintenance-link" href="${previewUrl()}#setup">Choose previous zero</a>` : ''}
      ${lastRun?.state === 'stopped' || lastRun?.state === 'interrupted' ? `<a class="maintenance-link" href="${previewUrl()}#setup">Review interrupted run</a>` : ''}
      <a class="maintenance-link" href="${previewUrl()}#dryrun">Run Bounding Box</a>
      <a class="maintenance-link" href="${previewUrl()}#arm">Arm Job</a>
      <a class="maintenance-link" href="${previewUrl()}#run">Run Panel</a>
      <a class="maintenance-link" href="#logs" data-nav-target="logs">Open Log</a>
    </div>
  `;
}

function fileBadges(item, meta = null) {
  const badges = [item.name.split('.').pop()?.toLowerCase() || 'file'];
  if (meta) badges.push('has job');
  if (meta?.preview) badges.push('preview');
  const warnings = Number(meta?.preview?.warnings?.length || 0);
  if (warnings) badges.push(`${warnings} warnings`);
  const estimate = formatMinutes(meta?.preview?.estimate?.effectiveSecondsWithOverride || meta?.preview?.estimate?.nominalSeconds);
  if (estimate !== '-') badges.push(estimate);
  return badges.map((badge) => `<span class="status-badge">${html(badge)}</span>`).join('');
}

async function fileMetadataFor(item) {
  if (!isGcodeFile(item)) return null;
  try {
    const res = await fetch(`/api/download?path=${encodeURIComponent(jobPathFor(item.path))}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

async function renderFiles(items) {
  launcherList.textContent = '';
  const gcodeItems = items.filter((item) => item.type === 'dir' || isGcodeFile(item));
  if (!gcodeItems.length) {
    launcherList.textContent = 'No G-code files found in /gcode.';
    return;
  }

  for (const item of gcodeItems) {
    const meta = await fileMetadataFor(item);
    const row = document.createElement('article');
    row.className = 'file-row compact-row';
    row.dataset.path = item.path;
    const thumb = item.type === 'dir'
      ? '<span class="thumb-placeholder">DIR</span>'
      : meta?.thumbnailPath
        ? `<img class="thumb-image" src="${html(meta.thumbnailPath)}" alt="">`
        : '<span class="thumb-placeholder">GC</span>';
    row.innerHTML = `
      <button class="file-name file-main" type="button">
        ${thumb}
        <span>
          <strong>${html(item.type === 'dir' ? `${item.name}/` : item.name)}</strong>
          <small>${item.type === 'file' ? `${formatBytes(item.size)} | ${html(item.name.split('.').pop() || 'file')}` : 'folder'}</small>
          <span class="badge-row">${fileBadges(item, meta)}</span>
        </span>
      </button>
      <button class="select-file" type="button">${item.type === 'file' ? 'Select' : 'Open'}</button>
      <div class="file-actions" hidden></div>
    `;
    const main = row.querySelector('.file-main');
    const select = row.querySelector('.select-file');
    const actions = row.querySelector('.file-actions');
    const expand = () => {
      document.querySelectorAll('.compact-row.expanded').forEach((openRow) => {
        if (openRow !== row) {
          openRow.classList.remove('expanded');
          const openActions = openRow.querySelector('.file-actions');
          if (openActions) openActions.hidden = true;
        }
      });
      row.classList.toggle('expanded');
      actions.hidden = !row.classList.contains('expanded');
    };
    main.addEventListener('click', () => {
      if (item.type === 'dir') loadFiles(item.path);
      else expand();
    });
    select.addEventListener('click', () => {
      if (item.type === 'dir') loadFiles(item.path);
      else openJob(item.path);
    });
    actions.innerHTML = item.type === 'file' ? `
      <button type="button" data-open-job>Open Job</button>
      <a class="maintenance-link" href="${previewUrl(item.path)}">Full Preview</a>
      <details class="more-actions">
        <summary>More</summary>
        <button type="button" data-rename>Rename</button>
        <a class="maintenance-link" href="/api/download?path=${encodeURIComponent(item.path)}">Download</a>
        <button type="button" data-view-raw>View Raw / Details</button>
        <button type="button" data-delete class="danger-button">Delete</button>
      </details>
    ` : '';
    actions.querySelector('[data-open-job]')?.addEventListener('click', () => openJob(item.path));
    actions.querySelector('[data-rename]')?.addEventListener('click', () => renameFile(item.path));
    actions.querySelector('[data-view-raw]')?.addEventListener('click', () => {
      const preview = meta?.preview;
      alert(`${item.path}\n${formatBytes(item.size)}\nWarnings: ${preview?.warnings?.length || 0}\nEstimate: ${formatMinutes(preview?.estimate?.effectiveSecondsWithOverride || preview?.estimate?.nominalSeconds)}\nBounds: ${formatBounds(preview?.bounds?.placementBounds || preview?.bounds)}`);
    });
    actions.querySelector('[data-delete]')?.addEventListener('click', () => deleteFile(item.path));
    launcherList.append(row);
  }
}

async function loadFiles(path = '/gcode') {
  const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
  const data = await readJson(res);
  if (!res.ok) {
    launcherList.textContent = data.error || 'Could not list files.';
    return;
  }
  const status = await fetch('/api/sd/status').then(readJson).catch(() => null);
  if (sdStatusEl && status?.mounted) {
    sdStatusEl.textContent = `${status.cardType} | ${formatBytes(status.freeBytes)} free`;
  }
  await renderFiles(data.items || []);
}

async function openJob(gcodePath) {
  saveCurrentJob({ gcodePath, jobPath: jobPathFor(gcodePath) });
  window.location.href = previewUrl(gcodePath);
}

async function deleteFile(path) {
  if (!confirm(`Delete ${basename(path)}?`)) return;
  const res = await fetch('/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const data = await readJson(res).catch(() => ({}));
  if (!res.ok) alert(data.error || 'Delete failed');
  await loadFiles();
}

async function renameFile(path) {
  const oldName = basename(path);
  const nextName = prompt('Rename to:', oldName);
  if (!nextName || nextName === oldName) return;
  if (nextName.includes('/') || nextName.includes('\\') || nextName.includes('..')) {
    alert('Unsafe file name');
    return;
  }
  const parent = path.slice(0, path.lastIndexOf('/')) || '/gcode';
  const res = await fetch('/api/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: path, to: `${parent}/${nextName}` }),
  });
  const data = await readJson(res).catch(() => ({}));
  if (!res.ok) alert(data.error || 'Rename failed');
  await loadFiles(parent);
}

function safeThumbName(name) {
  return String(name || 'thumb').replace(/[^A-Za-z0-9._-]/g, '_') + '.svg';
}

async function uploadTextFile(path, text, contentType = 'application/json') {
  const parent = path.slice(0, path.lastIndexOf('/')) || '/jobs';
  const name = basename(path);
  const form = new FormData();
  form.append('path', parent);
  form.append('file', new File([text], name, { type: contentType }));
  const res = await fetch('/api/upload?overwrite=true', { method: 'POST', body: form });
  const data = await readJson(res).catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upload failed for ${path}`);
  return data;
}

async function loadExistingJob(path) {
  try {
    const res = await fetch(`/api/download?path=${encodeURIComponent(path)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

async function saveUploadPreviewMetadata(gcodePath, fileName) {
  if (!pendingUploadPreview?.metadata) return;
  const mod = await toolpathModulePromise;
  if (!mod) return;

  const jobPath = jobPathFor(gcodePath);
  const existing = await loadExistingJob(jobPath);
  let thumbnailPath = null;
  try {
    await fetch('/api/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/jobs/thumbs' }),
    });
    thumbnailPath = `/jobs/thumbs/${safeThumbName(fileName)}`;
    await uploadTextFile(thumbnailPath, pendingUploadPreview.svg, 'image/svg+xml');
  } catch (err) {
    thumbnailPath = null;
  }

  const baseJob = existing || {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    gcodePath,
    jobPath,
  };
  const nextJob = mod.mergePreviewMetadata({
    ...baseJob,
    updatedAt: new Date().toISOString(),
    gcodePath,
    jobPath,
  }, pendingUploadPreview.metadata, thumbnailPath);
  await uploadTextFile(jobPath, JSON.stringify(nextJob, null, 2));
}

async function analyzeSelectedUploadFile() {
  pendingUploadPreview = null;
  if (!uploadPreviewEl) return;
  uploadPreviewEl.hidden = true;
  uploadPreviewEl.textContent = '';
  const file = uploadFile?.files?.[0];
  if (!file) return;

  const mod = await toolpathModulePromise;
  if (!mod) {
    uploadPreviewEl.hidden = false;
    uploadPreviewEl.textContent = 'ToolpathModel is unavailable; upload will still work without preview metadata.';
    return;
  }

  try {
    const source = await file.text();
    const model = mod.parseGCodeToToolpath(source);
    const metadata = mod.buildPreviewMetadata(model);
    const svg = mod.renderToolpathThumbnailSvg(model, { width: 260, height: 150 });
    pendingUploadPreview = { model, metadata, svg };
    uploadPreviewEl.hidden = false;
    uploadPreviewEl.innerHTML = `
      <div class="upload-thumb">${svg}</div>
      <dl>
        <dt>Placement bounds</dt><dd>${html(formatBounds(metadata.bounds.placementBounds))}</dd>
        <dt>Warnings</dt><dd>${metadata.warnings.length}</dd>
        <dt>Feed</dt><dd>${metadata.feed.commandCount ? `F${metadata.feed.min}..F${metadata.feed.max}` : '-'}</dd>
        <dt>Estimated time</dt><dd>${formatMinutes(metadata.estimate.nominalSeconds)}</dd>
      </dl>
      <p class="warning">Estimate is approximate. Review warnings before running.</p>
    `;
  } catch (err) {
    uploadPreviewEl.hidden = false;
    uploadPreviewEl.textContent = `Could not analyze file: ${err.message}`;
  }
}

async function uploadGcode(event) {
  event.preventDefault();
  if (!uploadFile?.files?.length) return;
  const file = uploadFile.files[0];
  const form = new FormData();
  form.append('path', '/gcode');
  form.append('file', file);
  const res = await fetch('/api/upload?overwrite=true', { method: 'POST', body: form });
  const data = await readJson(res).catch(() => ({}));
  if (!res.ok) alert(data.error || 'Upload failed');
  else {
    try {
      await saveUploadPreviewMetadata(`/gcode/${file.name}`, file.name);
    } catch (err) {
      alert(`G-code uploaded, but preview metadata was not saved: ${err.message}`);
    }
  }
  uploadForm.reset();
  if (uploadPreviewEl) uploadPreviewEl.hidden = true;
  pendingUploadPreview = null;
  await loadFiles();
}

async function refreshLogs() {
  try {
    const res = await fetch('/api/marlin/log');
    const data = await readJson(res);
    const entries = Array.isArray(data.entries) ? data.entries.slice(-80) : [];
    if (criticalLogEl) {
      criticalLogEl.hidden = !data.lastCritical;
      criticalLogEl.textContent = data.lastCritical ? `Critical: ${data.lastCritical}` : '';
    }
    if (marlinLogEl) {
      marlinLogEl.textContent = entries.length
        ? entries.map((entry) => {
          const prefix = entry.level === 'error' || entry.level === 'warning'
            ? '!'
            : entry.direction === 'tx' ? '->' : '<-';
          return `${entry.time || '-'} ${prefix}${entry.priority ? ' priority' : ''} ${entry.text || ''}`;
        }).join('\n')
        : 'No recent Marlin log entries.';
    }
  } catch (err) {
    if (marlinLogEl) marlinLogEl.textContent = `Marlin log unavailable: ${err.message}`;
  }
}

clearCurrentJobButton?.addEventListener('click', () => {
  saveCurrentJob(null);
  jobMeta = null;
  renderCurrentJob();
  showView('files');
});
refreshFilesButton?.addEventListener('click', () => loadFiles());
uploadForm?.addEventListener('submit', uploadGcode);
uploadFile?.addEventListener('change', () => {
  analyzeSelectedUploadFile().catch((err) => {
    if (uploadPreviewEl) {
      uploadPreviewEl.hidden = false;
      uploadPreviewEl.textContent = `Could not analyze file: ${err.message}`;
    }
  });
});
refreshLogsButton?.addEventListener('click', refreshLogs);
document.addEventListener('click', (event) => {
  const apiTarget = event.target.closest('[data-primary-api]');
  if (apiTarget) {
    event.preventDefault();
    postJob(apiTarget.dataset.primaryApi, apiTarget.textContent.trim()).catch((err) => {
      if (nextActionCard) {
        const error = document.createElement('p');
        error.className = 'warning';
        error.textContent = err.message || String(err);
        nextActionCard.append(error);
      }
    });
    return;
  }
  const target = event.target.closest('[data-nav-target], [data-action-view]');
  if (!target) return;
  const view = target.dataset.navTarget || target.dataset.actionView;
  if (view) showView(view);
});
window.addEventListener('hashchange', routeFromHash);

async function init() {
  await refreshHealth();
  await refreshJobStatus();
  await loadJobMeta();
  renderCurrentJob();
  await loadFiles();
  await refreshLogs();
  routeFromHash();
  setInterval(refreshHealth, 5000);
  setInterval(async () => {
    await refreshJobStatus();
    renderCurrentJob();
  }, 2500);
  setInterval(refreshLogs, 3000);
}

init().catch((err) => {
  if (health) health.textContent = `UI startup failed: ${err.message}`;
  console.error(err);
});
