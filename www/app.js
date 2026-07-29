const health = document.querySelector('#health');
const pageTitle = document.querySelector('#page-title');
const clearCurrentJobButton = document.querySelector('#clear-current-job');
const launcherList = document.querySelector('#launcher-list');
const refreshFilesButton = document.querySelector('#refresh-files');
const uploadForm = document.querySelector('#upload-form');
const uploadFile = document.querySelector('#upload-file');
const uploadPreviewEl = document.querySelector('#upload-preview');
const uploadSubmitButton = uploadForm?.querySelector('button[type="submit"]');
const sdStatusEl = document.querySelector('#sd-status');
const currentJobCard = document.querySelector('#current-job-card');
const nextActionCard = document.querySelector('#next-action-card');
const systemSummary = document.querySelector('#system-summary');
const marlinLogEl = document.querySelector('#marlin-log');
const criticalLogEl = document.querySelector('#critical-log');
const refreshLogsButton = document.querySelector('#refresh-logs');
const travelSpeedInput = document.querySelector('#travel-speed');
const travelSpeedNumberInput = document.querySelector('#travel-speed-number');
const travelSpeedStatus = document.querySelector('#travel-speed-status');
const readMarlinLimitsButton = document.querySelector('#read-marlin-limits');
const machineInfoSummary = document.querySelector('#machine-info-summary');
const refreshMachineInfoButton = document.querySelector('#refresh-machine-info');
const refreshMachineConfigButton = document.querySelector('#refresh-machine-config');
const machineConfigForms = [...document.querySelectorAll('[data-machine-group]')];
const softwareEndstopStatus = document.querySelector('#software-endstop-status');
const saveMarlinEepromButton = document.querySelector('#save-marlin-eeprom');
const machineConfigResult = document.querySelector('#machine-config-result');
const deviceInfoSummary = document.querySelector('#device-info-summary');
const deviceIdBadge = document.querySelector('#device-id-badge');
const deviceSettingsForm = document.querySelector('#device-settings-form');
const deviceFriendlyNameInput = document.querySelector('#device-friendly-name');
const deviceHostnameInput = document.querySelector('#device-hostname');
const deviceUrlPreview = document.querySelector('#device-url-preview');
const deviceSettingsResult = document.querySelector('#device-settings-result');
const saveDeviceSettingsButton = document.querySelector('#save-device-settings');
const restartDeviceButton = document.querySelector('#restart-device');
const toolChangeSettingsForm = document.querySelector('#tool-change-settings-form');
const toolChangeHandlingInput = document.querySelector('#tool-change-handling');
const toolChangeZMethodInput = document.querySelector('#tool-change-z-method');
const toolChangeParkFields = document.querySelector('#tool-change-park-fields');
const touchPlateEnabledInput = document.querySelector('#touch-plate-enabled');
const touchPlateFields = document.querySelector('#touch-plate-fields');
const toolChangeSettingsResult = document.querySelector('#tool-change-settings-result');

const currentJobKey = 'lowrider.currentJob';
const FILE_LONG_PRESS_MS = 450;
let currentJob = readCurrentJob();
let jobMeta = null;
let jobStatus = { state: 'UNKNOWN' };
let activeFilePath = '';
let pendingUploadPreview = null;
let uploadAnalysisToken = 0;
let motionSettingsModule = null;
let machineConfigModule = null;
let machineSettingsLoaded = false;
let deviceInfo = null;
let deviceRestartRequired = false;
let filesLoadedPath = '';
let jobMetaLoadedForPath = '';
let logsLoadedOnce = false;
let bootingInitialRoute = false;
const motionSettingsPromise = import('/lib/motion-settings.js').then((module) => {
  motionSettingsModule = module;
  return module;
});
const machineConfigPromise = import('/lib/machine-config.js').then((module) => {
  machineConfigModule = module;
  return module;
});
const deviceSettingsPromise = import('/lib/device-settings.js');
const uploadThumbnailPromise = import('/lib/upload-thumbnail.js');
const toolChangeSettingsPromise = import('/lib/tool-change-settings.js');
const thumbnailSettingsPromise = import('/lib/thumbnail-settings.js');
const thumbnailViewMode = document.querySelector('#thumbnail-view-mode');
const thumbnailViewStatus = document.querySelector('#thumbnail-view-status');

const toolpathModulePromise = import('/lib/toolpath-model.js').catch((err) => {
  console.warn('ToolpathModel unavailable', err);
  return null;
});

function thumbnailUrl(path) {
  return `/api/download?path=${encodeURIComponent(path)}`;
}
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

function showTravelSpeed(value, settings = motionSettingsModule?.loadMotionSettings()) {
  const maximum = motionSettingsModule?.travelSpeedUpperLimit(settings) ?? 100;
  const speed = motionSettingsModule?.normalizeTravelSpeed(value, maximum) ?? 50;
  if (travelSpeedInput) travelSpeedInput.max = maximum;
  if (travelSpeedNumberInput) travelSpeedNumberInput.max = maximum;
  if (travelSpeedInput) travelSpeedInput.value = speed;
  if (travelSpeedNumberInput) travelSpeedNumberInput.value = speed;
  if (travelSpeedStatus) {
    const detected = settings?.marlinMaxFeedrates;
    const limits = detected ? ` Marlin M203: X${detected.x}, Y${detected.y}, Z${detected.z ?? '-'}.` : '';
    travelSpeedStatus.textContent = `Automatic XY travel: ${speed} mm/s (${speed * 60} mm/min), selectable 10–${maximum} mm/s.${limits} Z safety moves remain slower.`;
  }
  return speed;
}

function saveTravelSpeed(value) {
  if (!motionSettingsModule) return;
  const settings = motionSettingsModule.saveMotionSettings({ travelSpeedMmS: value });
  showTravelSpeed(settings.travelSpeedMmS, settings);
  dispatchEvent(new CustomEvent('cnc-motion-settings-change', { detail: settings }));
}

function updateToolChangeSettingsVisibility() {
  if (toolChangeParkFields) toolChangeParkFields.hidden = toolChangeHandlingInput?.value !== 'park';
  if (touchPlateFields) touchPlateFields.hidden = !touchPlateEnabledInput?.checked;
  if (toolChangeZMethodInput) {
    const touchOption = toolChangeZMethodInput.querySelector('option[value="touchplate"]');
    if (touchOption) touchOption.disabled = !touchPlateEnabledInput?.checked;
    if (!touchPlateEnabledInput?.checked && toolChangeZMethodInput.value === 'touchplate') {
      toolChangeZMethodInput.value = 'manual';
    }
  }
}

function renderToolChangeSettings(settings) {
  if (!toolChangeSettingsForm) return;
  for (const [name, value] of Object.entries(settings || {})) {
    const input = toolChangeSettingsForm.elements.namedItem(name);
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = value === true;
    else input.value = value;
  }
  updateToolChangeSettingsVisibility();
}

async function loadToolChangeSettings() {
  if (!toolChangeSettingsForm) return null;
  const [res, module] = await Promise.all([
    fetch('/api/tool-change/settings', { cache: 'no-store' }),
    toolChangeSettingsPromise,
  ]);
  const data = await readJson(res);
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Tool-change settings unavailable');
  const settings = module.normalizeToolChangeSettings(data.settings || data);
  renderToolChangeSettings(settings);
  if (toolChangeSettingsResult) toolChangeSettingsResult.textContent = 'Tool-change settings loaded from this CNC device.';
  return settings;
}

async function saveToolChangeSettings(event) {
  event.preventDefault();
  const module = await toolChangeSettingsPromise;
  const values = Object.fromEntries(new FormData(toolChangeSettingsForm).entries());
  values.touchPlateEnabled = touchPlateEnabledInput?.checked === true;
  const settings = module.normalizeToolChangeSettings(values);
  const res = await fetch('/api/tool-change/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  const data = await readJson(res);
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Tool-change settings were not saved');
  renderToolChangeSettings(data.settings || settings);
  if (toolChangeSettingsResult) toolChangeSettingsResult.textContent = 'Tool-change and touch-plate settings saved on the CNC device.';
}

function basename(path) {
  const index = String(path || '').lastIndexOf('/');
  return index >= 0 ? path.slice(index + 1) : path;
}

function jobPathFor(gcodePath) {
  const normalized = String(gcodePath || '').replace(/^\/+/, '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const readable = normalized.replace(/[^A-Za-z0-9._-]/g, '_').slice(-72) || 'job';
  return `/jobs/${readable}-${(hash >>> 0).toString(16).padStart(8, '0')}.job.json`;
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

function setDeviceSettingsResult(message, warning = false) {
  if (!deviceSettingsResult) return;
  deviceSettingsResult.textContent = message;
  deviceSettingsResult.classList.toggle('warning', warning);
}

async function updateDeviceUrlPreview() {
  if (!deviceUrlPreview) return;
  const module = await deviceSettingsPromise;
  const url = module.localUrlForHostname(deviceHostnameInput?.value || deviceInfo?.hostname || 'cnc');
  deviceUrlPreview.href = url;
  deviceUrlPreview.textContent = url;
}

async function updateDeviceSettingsLock() {
  const module = await deviceSettingsPromise;
  const locked = module.deviceIdentityLocked(jobStatus?.state);
  if (deviceHostnameInput) deviceHostnameInput.disabled = locked;
  if (deviceFriendlyNameInput) deviceFriendlyNameInput.disabled = locked;
  if (saveDeviceSettingsButton) saveDeviceSettingsButton.disabled = locked;
  if (restartDeviceButton) restartDeviceButton.disabled = locked;
  if (locked) {
    if (deviceSettingsResult) deviceSettingsResult.dataset.locked = 'true';
    setDeviceSettingsResult('Device address can be changed only when the machine is idle.', true);
  } else if (deviceSettingsResult?.dataset.locked === 'true') {
    delete deviceSettingsResult.dataset.locked;
    setDeviceSettingsResult(deviceRestartRequired
      ? 'Saved. Restart is required to apply the new address.'
      : 'Machine is idle. Identity can be changed safely.');
  }
}

function renderDeviceInfo(info) {
  deviceInfo = info;
  if (deviceIdBadge) deviceIdBadge.textContent = `Device ${info?.deviceId || '-'}`;
  if (deviceInfoSummary) {
    const localUrl = info?.localUrl || '-';
    deviceInfoSummary.innerHTML = `
      <dl>
        <dt>Friendly name</dt><dd>${html(info?.friendlyName || '-')}</dd>
        <dt>Local address</dt><dd><a href="${html(localUrl)}">${html(localUrl)}</a></dd>
        <dt>Device ID</dt><dd>${html(info?.deviceId || '-')}</dd>
        <dt>Current IP</dt><dd>${html(info?.ip || '-')}</dd>
        <dt>BLE name</dt><dd>${html(info?.bluetooth?.name || 'disabled')}</dd>
      </dl>`;
  }
  if (deviceFriendlyNameInput) deviceFriendlyNameInput.value = info?.friendlyName || '';
  if (deviceHostnameInput) deviceHostnameInput.value = info?.hostname || 'cnc';
  updateDeviceUrlPreview();
  updateDeviceSettingsLock();
}

async function loadDeviceSettings() {
  const res = await fetch('/api/device');
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error || 'Device identity could not be loaded');
  renderDeviceInfo(data);
  return data;
}

async function saveDeviceSettings(event) {
  event.preventDefault();
  const module = await deviceSettingsPromise;
  const hostname = module.sanitizeHostnameInput(deviceHostnameInput?.value || '');
  const friendlyName = String(deviceFriendlyNameInput?.value || '').trim();
  if (!friendlyName) {
    setDeviceSettingsResult('Friendly name is required.', true);
    return;
  }

  saveDeviceSettingsButton.disabled = true;
  try {
    const res = await fetch('/api/device', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname, friendlyName }),
    });
    const data = await readJson(res);
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Device identity save failed');
    if (deviceHostnameInput) deviceHostnameInput.value = data.device.hostname;
    if (deviceFriendlyNameInput) deviceFriendlyNameInput.value = data.device.friendlyName;
    await updateDeviceUrlPreview();
    deviceRestartRequired = data.requiresRestart === true;
    if (restartDeviceButton) restartDeviceButton.hidden = !deviceRestartRequired;
    const warning = data.warning ? ` ${data.warning}` : '';
    if (deviceSettingsResult) {
      const url = data.device.localUrl;
      deviceSettingsResult.innerHTML = deviceRestartRequired
        ? `New address will be available after restart: <a href="${html(url)}">${html(url)}</a>.${html(warning)}`
        : `Machine identity saved.${html(warning)}`;
      deviceSettingsResult.classList.toggle('warning', Boolean(data.warning));
    }
  } catch (err) {
    setDeviceSettingsResult(err.message, true);
  } finally {
    await updateDeviceSettingsLock();
  }
}

async function restartDevice() {
  restartDeviceButton.disabled = true;
  try {
    const res = await fetch('/api/system/restart', { method: 'POST' });
    const data = await readJson(res);
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Restart failed');
    setDeviceSettingsResult('Restarting. Reopen the pendant at the new local address.');
  } catch (err) {
    setDeviceSettingsResult(err.message, true);
    await updateDeviceSettingsLock();
  }
}

function showView(name) {
  const requested = name || (currentJob ? 'job' : 'files');
  const viewName = requested === 'job' && !currentJob ? 'files' : requested;
  syncAppTelemetryDemand(viewName);
  window.CncTelemetry?.setDemand('log', 'app-log-view', viewName === 'logs');
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
  if (viewName === 'settings' && !machineSettingsLoaded) {
    machineSettingsLoaded = true;
    loadMachineSettings().catch((err) => setMachineConfigResult(err.message, true));
  }
  if (!bootingInitialRoute && viewName === 'files') {
    ensureFilesViewData().catch((err) => {
      if (launcherList) launcherList.textContent = err.message || 'Could not list files.';
    });
  }
  if (!bootingInitialRoute && viewName === 'job') {
    ensureJobViewData().catch((err) => {
      jobMeta = null;
      renderCurrentJob();
      if (nextActionCard) {
        nextActionCard.innerHTML = `<p class="warning">${html(err.message || 'Job data could not be loaded.')}</p>`;
      }
    });
  }
  if (viewName === 'logs' && !logsLoadedOnce) {
    logsLoadedOnce = true;
    refreshLogs().catch((err) => applyLogs({ marlinLog: [], lastError: err.message }));
  }
}

function syncAppTelemetryDemand(viewName) {
  window.CncTelemetry?.setDemand('health', 'app-view', viewName === 'settings');
  window.CncTelemetry?.setDemand('job', 'app-view', viewName === 'job');
}

function setMachineConfigResult(message, error = false) {
  if (!machineConfigResult) return;
  machineConfigResult.textContent = message;
  machineConfigResult.classList.toggle('warning', error);
}

function areaText(area) {
  return area ? `X ${area.xMin}..${area.xMax}, Y ${area.yMin}..${area.yMax}, Z ${area.zMin}..${area.zMax} mm` : '-';
}

function renderMachineInfo(info) {
  if (!machineInfoSummary) return;
  const caps = info?.capabilities || {};
  if (saveMarlinEepromButton) {
    saveMarlinEepromButton.disabled = info?.available && caps.eeprom !== true;
    saveMarlinEepromButton.title = caps.eeprom === false ? 'Marlin M115 reports no EEPROM capability.' : '';
  }
  machineInfoSummary.innerHTML = `
    <dl>
      <dt>Status</dt><dd>${info?.refreshing ? 'Reading M115...' : info?.available ? 'Cached and available' : 'Not discovered'}</dd>
      <dt>Marlin</dt><dd>${html(info?.firmwareName || '-')}</dd>
      <dt>Machine</dt><dd>${html(info?.machineType || '-')}</dd>
      <dt>Physical area</dt><dd>${html(areaText(info?.full))}</dd>
      <dt>Workspace area</dt><dd>${html(areaText(info?.work))}</dd>
      <dt>Capabilities</dt><dd>${[
        caps.emergencyParser && 'Emergency parser', caps.arcs && 'Arcs', caps.autoreportPosition && 'Position autoreport',
        caps.eeprom && 'EEPROM', caps.sdCard && 'SD card', caps.motionModes && 'Motion modes',
      ].filter(Boolean).join(', ') || '-'}</dd>
      <dt>Discovery</dt><dd>${info?.lastError ? html(info.lastError) : info?.refreshedAtMs ? `uptime ${Math.round(info.refreshedAtMs / 1000)} sec` : 'cached from NVS or waiting'}</dd>
    </dl>`;
}

async function loadMachineInfo({ refresh = false } = {}) {
  if (refresh) {
    const queued = await fetch('/api/machine/refresh', { method: 'POST' });
    const queuedData = await readJson(queued);
    if (!queued.ok) throw new Error(queuedData.error || 'M115 refresh failed');
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const res = await fetch('/api/machine/info');
    const info = await readJson(res);
    if (!res.ok) throw new Error(info.error || 'Machine info failed');
    renderMachineInfo(info);
    if (!info.refreshing && (!refresh || info.available || info.lastError)) return info;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('M115 discovery is still running');
}

async function sendDiagnostic(cmd) {
  const res = await fetch('/api/cmd', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd }),
  });
  const data = await readJson(res);
  if (!res.ok || data.ok === false) throw new Error(data.error || `${cmd} failed`);
  return data.response || '';
}

function fillMachineConfig(config) {
  machineConfigForms.forEach((form) => {
    const values = config?.[form.dataset.machineGroup];
    if (!values) return;
    Object.entries(values).forEach(([name, value]) => {
      const input = form.elements.namedItem(name);
      if (input) input.value = value;
    });
  });
}

async function refreshMachineConfiguration() {
  await machineConfigPromise;
  if (refreshMachineConfigButton) refreshMachineConfigButton.disabled = true;
  try {
    const m503 = await sendDiagnostic('M503');
    const config = machineConfigModule.parseM503Configuration(m503);
    fillMachineConfig(config);
    if (config.M203 && motionSettingsModule) {
      const settings = motionSettingsModule.saveMotionSettings({ marlinMaxFeedrates: config.M203 });
      showTravelSpeed(settings.travelSpeedMmS, settings);
    }
    const m211 = await sendDiagnostic('M211');
    const endstops = machineConfigModule.parseM211State(m211);
    if (softwareEndstopStatus) {
      softwareEndstopStatus.textContent = endstops.enabled === null
        ? 'Software endstop state was not recognized.'
        : `Software endstops: ${endstops.enabled ? 'ON' : 'OFF'}`;
      softwareEndstopStatus.classList.toggle('warning', endstops.enabled !== true);
    }
    setMachineConfigResult('Configuration loaded from Marlin. Apply buttons change RAM only until M500 is used.');
  } finally {
    if (refreshMachineConfigButton) refreshMachineConfigButton.disabled = false;
  }
}

async function loadMachineSettings() {
  await Promise.all([motionSettingsPromise, machineConfigPromise]);
  await loadDeviceSettings();
  const info = await loadMachineInfo();
  if (info.refreshing) await loadMachineInfo();
  await refreshMachineConfiguration();
}

async function applyMachineGroup(form) {
  const group = form.dataset.machineGroup;
  const body = { group };
  [...form.elements].filter((item) => item.name).forEach((input) => { body[input.name] = Number(input.value); });
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    const res = await fetch('/api/machine/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await readJson(res);
    if (!res.ok || data.ok === false) throw new Error(data.error || `${group} apply failed`);
    setMachineConfigResult(`${data.command} applied to Marlin RAM. Use M500 below to keep it after restart.`);
  } finally {
    if (button) button.disabled = false;
  }
}

function routeFromHash() {
  const target = (window.location.hash || '').slice(1);
  if (target === 'job' && !currentJob) {
    history.replaceState(null, '', '#files');
    showView('files');
    return;
  }
  if (['files', 'job', 'logs', 'settings'].includes(target)) {
    showView(target);
    return;
  }
  showView(currentJob ? 'job' : 'files');
}

function requestedViewFromLocation() {
  const target = (window.location.hash || '').slice(1);
  if (['files', 'job', 'logs', 'settings'].includes(target)) return target;
  return currentJob ? 'job' : 'files';
}

async function resolveInitialView() {
  const requested = requestedViewFromLocation();
  if (requested === 'job') {
    const valid = await validateCurrentJobFile();
    if (!valid) {
      history.replaceState(null, '', '#files');
      return 'files';
    }
  }
  return requested;
}

function applyHealth(data) {
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
}

async function refreshHealth() {
  try {
    if (window.CncTelemetry) return await window.CncTelemetry.request('health');
    const res = await fetch('/api/health');
    applyHealth(await readJson(res));
  } catch (err) {
    if (health) health.textContent = `Offline: ${err.message}`;
  }
}

function applyJobStatus(data) {
  jobStatus = data;
  updateDeviceSettingsLock();
  if (!currentJob && jobStatus.gcodePath) {
    saveCurrentJob({ gcodePath: jobStatus.gcodePath, jobPath: jobStatus.jobPath || jobPathFor(jobStatus.gcodePath) });
  }
}

async function refreshJobStatus() {
  try {
    if (window.CncTelemetry) return await window.CncTelemetry.request('job');
    const res = await fetch('/api/job/status');
    const data = await readJson(res);
    if (!res.ok) throw new Error(data.error || 'job status failed');
    applyJobStatus(data);
  } catch (err) {
    jobStatus = { state: 'UNKNOWN', lastError: err.message };
  }
}

async function loadJobMeta() {
  jobMeta = null;
  jobMetaLoadedForPath = '';
  if (!currentJob?.jobPath) return;
  try {
    const res = await fetch(`/api/download?path=${encodeURIComponent(currentJob.jobPath)}`);
    if (!res.ok) return;
    const loaded = await res.json();
    jobMeta = Number(loaded?.schemaVersion) === 3 && loaded.sourceGcodePath === currentJob.gcodePath ? loaded : null;
    if (!jobMeta) return;
    jobMetaLoadedForPath = currentJob.jobPath;
  } catch (err) {
    jobMeta = null;
    jobMetaLoadedForPath = '';
  }
}

async function validateCurrentJobFile() {
  if (!currentJob?.gcodePath) return false;
  const path = String(currentJob.gcodePath);
  const index = path.lastIndexOf('/');
  const parent = index > 0 ? path.slice(0, index) : '/gcode';
  try {
    const res = await fetch(`/api/files?path=${encodeURIComponent(parent)}`);
    const data = await readJson(res);
    const exists = res.ok && Array.isArray(data.items) &&
      data.items.some((item) => item.type === 'file' && item.path === path);
    if (exists) return true;
  } catch (err) {
    // Fall through: an unopenable current job must not leave an empty Job destination.
  }
  saveCurrentJob(null);
  jobMeta = null;
  return false;
}

function previewBounds(meta = jobMeta) {
  const bounds = meta?.preview?.bounds;
  return bounds?.placementBounds || bounds?.cutBounds || bounds?.rawTravelBounds || bounds || meta?.preview?.generatedRunBounds || null;
}

function warningCount(meta = jobMeta) {
  return (meta?.preview?.warnings || []).filter((warning) => !/G54 default workspace|default-workspace/i.test(String(warning?.message || warning))).length;
}

function hasWorkZero(meta = jobMeta) {
  return Boolean(meta?.workZero?.beforeG92 && meta?.workZero?.afterG92);
}

function hasZZero(meta = jobMeta) {
  return Boolean(meta?.toolZero?.afterG92Z?.rawM114 || meta?.toolZero?.capturedAt);
}

function dryRunDone(meta = jobMeta) {
  return meta?.verificationDecision?.result === 'complete';
}

function verificationLabel(meta = jobMeta) {
  const decision = meta?.verificationDecision;
  if (decision?.result !== 'complete') return 'Not chosen';
  if (decision.type === 'bounds') return 'Bounds complete';
  if (decision.type === 'aircut') return 'Full Aircut complete';
  if (decision.type === 'skipped') return 'Skipped deliberately';
  return 'Not chosen';
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
  const state = String(jobStatus?.state || 'UNKNOWN').toUpperCase();
  return ['STOPPED', 'COMPLETED', 'ERROR'].includes(state) ? 'IDLE' : state;
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
  if (readinessModule && Number(jobMeta?.schemaVersion) !== 3) {
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
  if (state === 'PAUSED_INTACT') return { label: 'Resume Job', api: '/api/job/resume' };
  if (state === 'RECOVERY_REQUIRED') return { label: 'Review Recovery', href: `${previewUrl()}#recovery` };
  if (!previewBounds()) return { label: 'Open Preview', href: previewUrl() };
  if (activeRunNeedsUpdate()) return { label: 'Update Run File', href: `${previewUrl()}#preview` };
  if (Number(jobMeta?.schemaVersion) === 3) return { label: 'Prepare & Cut', href: `${previewUrl()}#preflight` };
  if (!hasWorkZero()) return { label: 'Set Work Zero', href: `${previewUrl()}#preflight` };
  if (!hasZZero()) return { label: 'Set Z Zero', href: `${previewUrl()}#preflight` };
  if (jobMeta?.preflight?.state === 'NOT_READY') return { label: 'Review Preflight', href: `${previewUrl()}#preflight` };
  if (!dryRunDone()) return { label: 'Run Bounding Box', href: `${previewUrl()}#dryrun` };
  if (armState() !== 'ARMED') return { label: 'Review & Start Cut', href: `${previewUrl()}#run` };
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
  if (target === 'run' && (action.id === 'start_cut' || action.id === 'arm_job')) return { label: action.label, href: `${previewUrl()}#run` };
  if (target === 'setup' || target === 'preview' || target === 'preflight' || target === 'dry-run' || target === 'arm' || target === 'run') {
    return { label: action.label || 'Open Job', href: `${previewUrl()}#${target}` };
  }
  return { label: action.label || 'Open Job', href: previewUrl() };
}

function dashboardReadiness() {
  if (!readinessModule || !currentJob || Number(jobMeta?.schemaVersion) === 3) return null;
  return readinessModule.buildJobReadiness(jobMeta || {}, {
    currentJob,
    jobStatus,
  });
}

async function postJob(url, message) {
  const res = await fetch(url, { method: 'POST' });
  const data = await readJson(res);
  if (!res.ok || data.ok === false) throw new Error(data.error || message || 'Job action failed');
  renderCurrentJob();
}

function renderCurrentJob() {
  if (clearCurrentJobButton) clearCurrentJobButton.hidden = !currentJob;
  if (!currentJobCard || !nextActionCard) return;

  if (!currentJob) {
    currentJobCard.textContent = '';
    nextActionCard.textContent = '';
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
  const savedRecoveries = Array.isArray(jobMeta?.recoveries)
    ? jobMeta.recoveries.filter((item) => !['abandoned', 'marked_finished', 'recovery_completed'].includes(item?.status)).length
    : 0;
  const lastRunBadge = lastRun?.state === 'stopped' || lastRun?.state === 'interrupted'
    ? '<span class="status-badge caution">Last run interrupted/stopped</span>'
    : '';
  currentJobCard.innerHTML = `
    <h2>${html(basename(currentJob.gcodePath))}</h2>
    <div class="mini-preview">
      <span>Preview</span>
      <a class="maintenance-link" href="${previewUrl()}">Open Full Preview</a>
    </div>
    <dl>
      <dt>Job state</dt><dd>${html(state)}</dd>
      <dt>Bounds</dt><dd>${bounds ? formatBounds(bounds) : 'Preview needed'}</dd>
      <dt>Feed override</dt><dd>${html(feed)}%</dd>
      <dt>Estimated time</dt><dd>${formatMinutes(jobMeta?.preview?.estimate?.effectiveSecondsWithOverride || jobMeta?.preview?.estimate?.nominalSeconds || jobMeta?.preview?.estimatedTimeSeconds)}</dd>
      <dt>Saved work zero</dt><dd>${activeWorkZero ? `${html(shortTime(activeWorkZero.capturedAt))} — activate in Prepare` : (hasWorkZero() ? 'Saved — activate in Prepare' : 'Missing')}</dd>
      <dt>Physical check</dt><dd>${html(verificationLabel())}</dd>
    </dl>
    <details class="diagnostics-panel">
      <summary>Advanced / Diagnostics</summary>
      <dl>
        <dt>Source file</dt><dd>${html(jobMeta?.sourceGcodePath || currentJob.gcodePath)}</dd>
        <dt>Run file</dt><dd>${html(run.path || currentJob.gcodePath)}</dd>
        <dt>Run mode</dt><dd>${html(run.mode || 'source')}</dd>
        <dt>Generated</dt><dd>${html(activeRunNeedsUpdate() ? 'Update required' : (jobMeta?.generatedValidation?.status || '-'))}</dd>
        <dt>Warnings</dt><dd>${warningCount()}</dd>
       <dt>Last run</dt><dd>${lastRun ? `${html(lastRun.state || 'started')} ${lastRunBadge}` : '-'}</dd>
        <dt>Saved recoveries</dt><dd>${savedRecoveries}</dd>
        <dt>Preparation</dt><dd>${readiness?.blockingReasons?.length ? readiness.blockingReasons.map((reason) => html(reason.message)).join('<br>') : 'Open Prepare & Cut for live checks'}</dd>
        <dt>Marlin critical</dt><dd>${html(critical || '-')}</dd>
      </dl>
    </details>
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
      <a class="maintenance-link" href="${previewUrl()}#preview">Place & Rotate</a>
      ${hasNewerUnusedWorkZero() ? `<a class="maintenance-link" href="${previewUrl()}#preflight">Choose previous zero</a>` : ''}
      ${savedRecoveries ? `<a class="maintenance-link" href="${previewUrl()}#recovery">Saved recoveries (${savedRecoveries})</a>` : ''}
      <a class="maintenance-link" href="${previewUrl()}#preflight">Prepare & Cut</a>
      <a class="maintenance-link" href="#logs" data-nav-target="logs">Open Log</a>
    </div>
  `;
}

function fileBadges(item, meta = null) {
  const badges = [];
  const warnings = (meta?.preview?.warnings || []).filter((warning) => !/G54 default workspace|default-workspace/i.test(String(warning?.message || warning)));
  if (warnings.length) badges.push(`${warnings.length} need attention`);
  const estimate = formatMinutes(meta?.preview?.estimate?.effectiveSecondsWithOverride || meta?.preview?.estimate?.nominalSeconds);
  if (estimate !== '-') badges.push(estimate);
  return badges.map((badge) => `<span class="status-badge">${html(badge)}</span>`).join('');
}

function bindLauncherCard(row, actions, item) {
  let longPressTimer = null;
  let suppressClick = false;
  const setActionsOpen = (open) => {
    document.querySelectorAll('#launcher-list .file-card.expanded').forEach((other) => {
      if (other === row) return;
      other.classList.remove('expanded');
      const otherActions = other.querySelector('.file-actions');
      if (otherActions) otherActions.hidden = true;
    });
    row.classList.toggle('expanded', open);
    actions.hidden = !open;
  };
  const clearLongPress = () => {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
  };
  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    setActionsOpen(true);
  });
  row.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.file-actions')) return;
    suppressClick = false;
    clearLongPress();
    longPressTimer = setTimeout(() => {
      suppressClick = true;
      setActionsOpen(true);
    }, FILE_LONG_PRESS_MS);
  });
  ['pointerup', 'pointercancel', 'pointerleave', 'dragstart'].forEach((name) => row.addEventListener(name, clearLongPress));
  row.addEventListener('click', (event) => {
    if (event.target.closest('.file-actions')) return;
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      setActionsOpen(true);
      return;
    }
    if (item.type === 'dir') loadFiles(item.path);
    else openJob(item.path);
  });
  row.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key) || event.target.closest('.file-actions')) return;
    event.preventDefault();
    if (item.type === 'dir') loadFiles(item.path);
    else openJob(item.path);
  });
}

async function fileMetadataFor(item) {
  if (!isGcodeFile(item)) return null;
  try {
    const res = await fetch(`/api/download?path=${encodeURIComponent(jobPathFor(item.path))}`);
    if (res.ok) {
      const loaded = await res.json();
      if (loaded?.sourceGcodePath === item.path) return loaded;
    }
  } catch (err) {
    // A thumbnail may still exist even when this file has no current Job JSON.
  }
  const thumbnail = await uploadThumbnailPromise;
  const thumbnailPath = thumbnail.thumbnailPathFor(item.name || basename(item.path));
  const thumbnailRes = await fetch(thumbnailUrl(thumbnailPath)).catch(() => null);
  return thumbnailRes?.ok ? { sourceGcodePath: item.path, thumbnailPath } : null;
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
    row.className = 'file-row file-card compact-row';
    row.dataset.path = item.path;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    const thumb = item.type === 'dir'
      ? '<span class="thumb-placeholder" aria-hidden="true">Folder</span>'
      : meta?.thumbnailPath
        ? `<img class="thumb-image" src="${html(thumbnailUrl(meta.thumbnailPath))}" alt="">`
        : '<span class="thumb-placeholder" aria-hidden="true">No preview</span>';
    row.innerHTML = `
      <div class="file-name file-main">
        ${thumb}
        <span>
          <strong>${html(item.type === 'dir' ? `${item.name}/` : item.name)}</strong>
          <small>${item.type === 'file' ? formatBytes(item.size) : 'folder'}</small>
          <span class="badge-row">${fileBadges(item, meta)}</span>
        </span>
      </div>
      <div class="file-actions" hidden></div>
    `;
    const actions = row.querySelector('.file-actions');
    actions.innerHTML = item.type === 'file' ? `
      <button type="button" data-rename>Rename</button>
      <a class="maintenance-link" href="/api/download?path=${encodeURIComponent(item.path)}">Download</a>
      <button type="button" data-view-raw>Details</button>
      <button type="button" data-delete class="danger-button">Delete</button>
    ` : '';
    bindLauncherCard(row, actions, item);
    actions.querySelector('[data-rename]')?.addEventListener('click', () => renameFile(item.path));
    actions.querySelector('[data-view-raw]')?.addEventListener('click', () => {
      const preview = meta?.preview;
      alert(`${item.path}\n${formatBytes(item.size)}\nWarnings: ${preview?.warnings?.length || 0}\nEstimate: ${formatMinutes(preview?.estimate?.effectiveSecondsWithOverride || preview?.estimate?.nominalSeconds)}\nBounds: ${formatBounds(preview?.bounds?.placementBounds || preview?.bounds)}`);
    });
    actions.querySelector('[data-delete]')?.addEventListener('click', () => deleteFile(item.path));
    actions.querySelectorAll('a, button').forEach((control) => control.addEventListener('click', (event) => event.stopPropagation()));
    launcherList.append(row);
  }
}

async function loadFiles(path = '/gcode') {
  const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
  const data = await readJson(res);
  if (!res.ok) {
    launcherList.textContent = data.error || 'Could not list files.';
    filesLoadedPath = '';
    return;
  }
  const status = await fetch('/api/sd/status').then(readJson).catch(() => null);
  if (sdStatusEl && status?.mounted) {
    sdStatusEl.textContent = `${status.cardType} | ${formatBytes(status.freeBytes)} free`;
  }
  await renderFiles(data.items || []);
  filesLoadedPath = path;
}

async function ensureFilesViewData(path = activeFilePath || '/gcode') {
  const targetPath = path || '/gcode';
  if (filesLoadedPath === targetPath && launcherList?.childElementCount) return;
  await loadFiles(targetPath);
}

async function ensureJobViewData() {
  if (!currentJob) {
    jobMeta = null;
    jobMetaLoadedForPath = '';
    renderCurrentJob();
    return;
  }
  const valid = await validateCurrentJobFile();
  if (!valid) {
    renderCurrentJob();
    routeFromHash();
    return;
  }
  if (jobMetaLoadedForPath !== currentJob.jobPath) await loadJobMeta();
  renderCurrentJob();
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
  if (!pendingUploadPreview?.metadata || !pendingUploadPreview?.pngBlob) return;
  const [mod, thumbnail] = await Promise.all([toolpathModulePromise, uploadThumbnailPromise]);
  if (!mod || !thumbnail) return;

  const jobPath = jobPathFor(gcodePath);
  const existing = await loadExistingJob(jobPath);
  let thumbnailPath = null;
  try {
    await fetch('/api/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/jobs/thumbs' }),
    });
    thumbnailPath = thumbnail.thumbnailPathFor(fileName);
    await uploadTextFile(thumbnailPath, pendingUploadPreview.pngBlob, 'image/png');
  } catch (err) {
    thumbnailPath = null;
  }

  const nextJob = thumbnail.mergeUploadedFileMetadata(existing, {
    gcodePath,
    jobPath,
    thumbnailPath,
    preview: pendingUploadPreview.metadata,
  });
  await uploadTextFile(jobPath, JSON.stringify(nextJob, null, 2));
}

function canvasPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Browser could not encode PNG.')), 'image/png');
  });
}

async function analyzeSelectedUploadFile() {
  const token = ++uploadAnalysisToken;
  pendingUploadPreview = null;
  if (!uploadPreviewEl) return;
  uploadPreviewEl.hidden = true;
  uploadPreviewEl.textContent = '';
  const file = uploadFile?.files?.[0];
  if (!file) {
    if (uploadSubmitButton) uploadSubmitButton.disabled = false;
    return;
  }
  if (uploadSubmitButton) uploadSubmitButton.disabled = true;

  const [mod, thumbnail] = await Promise.all([toolpathModulePromise, uploadThumbnailPromise]);
  if (!mod || !thumbnail) {
    uploadPreviewEl.hidden = false;
    uploadPreviewEl.textContent = 'ToolpathModel is unavailable; upload will still work without preview metadata.';
    if (uploadSubmitButton) uploadSubmitButton.disabled = false;
    return;
  }

  try {
    const source = await file.text();
    if (token !== uploadAnalysisToken) return;
    const model = mod.parseGCodeToToolpath(source);
    const metadata = mod.buildPreviewMetadata(model);
    uploadPreviewEl.hidden = false;
    uploadPreviewEl.innerHTML = `
      <div class="upload-thumb"><canvas width="128" height="128" aria-label="Selected G-code thumbnail preview"></canvas></div>
      <dl>
        <dt>Placement bounds</dt><dd>${html(formatBounds(metadata.bounds.placementBounds))}</dd>
        <dt>Warnings</dt><dd>${metadata.warnings.length}</dd>
        <dt>Feed</dt><dd>${metadata.feed.commandCount ? `F${metadata.feed.min}..F${metadata.feed.max}` : '-'}</dd>
        <dt>Estimated time</dt><dd>${formatMinutes(metadata.estimate.nominalSeconds)}</dd>
      </dl>
      <p class="warning">Estimate is approximate. Review warnings before running.</p>
    `;
    const canvas = uploadPreviewEl.querySelector('canvas');
    mod.renderToolpathToCanvas(model, canvas, {
      width: thumbnail.THUMBNAIL_SIZE,
      height: thumbnail.THUMBNAIL_SIZE,
      viewMode: (await thumbnailSettingsPromise).loadThumbnailViewMode(),
    });
    const pngBlob = await canvasPngBlob(canvas);
    if (token !== uploadAnalysisToken) return;
    pendingUploadPreview = { model, metadata, pngBlob };
  } catch (err) {
    uploadPreviewEl.hidden = false;
    uploadPreviewEl.textContent = `Could not analyze file: ${err.message}`;
  } finally {
    if (token === uploadAnalysisToken && uploadSubmitButton) uploadSubmitButton.disabled = false;
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
  uploadAnalysisToken += 1;
  if (uploadPreviewEl) uploadPreviewEl.hidden = true;
  pendingUploadPreview = null;
  await loadFiles();
}

function applyLogs(data) {
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
}

async function refreshLogs() {
  try {
    if (window.CncTelemetry) return await window.CncTelemetry.request('log');
    const res = await fetch('/api/marlin/log');
    applyLogs(await readJson(res));
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
travelSpeedInput?.addEventListener('input', (event) => saveTravelSpeed(event.currentTarget.value));
travelSpeedNumberInput?.addEventListener('change', (event) => saveTravelSpeed(event.currentTarget.value));
readMarlinLimitsButton?.addEventListener('click', async () => {
  if (!motionSettingsModule) return;
  readMarlinLimitsButton.disabled = true;
  try {
    const res = await fetch('/api/cmd', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'M503' }),
    });
    const data = await readJson(res);
    if (!res.ok || data.ok === false) throw new Error(data.error || 'M503 failed');
    const limits = motionSettingsModule.parseMarlinMaxFeedrates(data.response || '');
    if (!limits) throw new Error('M503 response did not contain usable M203 X/Y limits');
    const settings = motionSettingsModule.saveMotionSettings({ marlinMaxFeedrates: limits });
    showTravelSpeed(settings.travelSpeedMmS, settings);
    dispatchEvent(new CustomEvent('cnc-motion-settings-change', { detail: settings }));
  } catch (err) {
    if (travelSpeedStatus) travelSpeedStatus.textContent = `Could not read Marlin M203 limits: ${err.message}`;
  } finally {
    readMarlinLimitsButton.disabled = false;
  }
});
refreshMachineInfoButton?.addEventListener('click', async () => {
  refreshMachineInfoButton.disabled = true;
  try {
    await loadMachineInfo({ refresh: true });
  } catch (err) {
    setMachineConfigResult(err.message, true);
  } finally {
    refreshMachineInfoButton.disabled = false;
  }
});
refreshMachineConfigButton?.addEventListener('click', () => {
  refreshMachineConfiguration().catch((err) => setMachineConfigResult(err.message, true));
});
machineConfigForms.forEach((form) => form.addEventListener('submit', (event) => {
  event.preventDefault();
  applyMachineGroup(form).catch((err) => setMachineConfigResult(err.message, true));
}));
saveMarlinEepromButton?.addEventListener('click', async () => {
  saveMarlinEepromButton.disabled = true;
  try {
    const res = await fetch('/api/machine/save', { method: 'POST' });
    const data = await readJson(res);
    if (!res.ok || data.ok === false) throw new Error(data.error || 'M500 failed');
    setMachineConfigResult('M500 succeeded. Applied Marlin settings are now stored in EEPROM.');
  } catch (err) {
    setMachineConfigResult(err.message, true);
  } finally {
    saveMarlinEepromButton.disabled = false;
  }
});
toolChangeHandlingInput?.addEventListener('change', updateToolChangeSettingsVisibility);
touchPlateEnabledInput?.addEventListener('change', updateToolChangeSettingsVisibility);
toolChangeSettingsForm?.addEventListener('submit', (event) => {
  saveToolChangeSettings(event).catch((err) => {
    if (toolChangeSettingsResult) toolChangeSettingsResult.textContent = err.message;
  });
});
thumbnailViewMode?.addEventListener('change', async () => {
  const settings = await thumbnailSettingsPromise;
  const mode = settings.saveThumbnailViewMode(thumbnailViewMode.value);
  thumbnailViewMode.value = mode;
  if (thumbnailViewStatus) {
    thumbnailViewStatus.textContent = `${mode.toUpperCase()} will be used for newly generated thumbnails. Existing stored PNGs are unchanged.`;
  }
});
deviceHostnameInput?.addEventListener('input', updateDeviceUrlPreview);
deviceSettingsForm?.addEventListener('submit', saveDeviceSettings);
restartDeviceButton?.addEventListener('click', restartDevice);
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
  bootingInitialRoute = true;
  const initialView = await resolveInitialView();
  showView(initialView);
  const motion = await motionSettingsPromise;
  const savedMotion = motion.loadMotionSettings();
  if (thumbnailViewMode) thumbnailViewMode.value = (await thumbnailSettingsPromise).loadThumbnailViewMode();
  showTravelSpeed(savedMotion.travelSpeedMmS, savedMotion);
  window.CncTelemetry?.subscribe('system', (data) => {
    if (data) applyHealth(data.health || data);
  });
  window.CncTelemetry?.subscribe('job', (data) => {
    applyJobStatus(data);
    renderCurrentJob();
  });
  window.CncTelemetry?.subscribe('log', applyLogs);
  window.CncTelemetry?.start();
  renderCurrentJob();
  await ensureViewData(initialView);
  bootingInitialRoute = false;
  routeFromHash();
  window.CncTelemetry?.setDemand('log', 'app-log-view', initialView === 'logs');
}

async function ensureViewData(viewName) {
  if (!bootingInitialRoute && viewName === 'files') {
    await ensureFilesViewData();
    return;
  }
  if (!bootingInitialRoute && viewName === 'job') {
    window.CncTelemetry?.setDemand('job', 'app-view', true);
    await ensureJobViewData();
    return;
  }
  if (viewName === 'settings') {
    window.CncTelemetry?.setDemand('health', 'app-view', true);
    await refreshHealth();
    await loadToolChangeSettings().catch((err) => {
      if (toolChangeSettingsResult) toolChangeSettingsResult.textContent = err.message;
    });
    return;
  }
  if (viewName === 'logs' && !logsLoadedOnce) {
    logsLoadedOnce = true;
  }
}

init().catch((err) => {
  if (health) health.textContent = `UI startup failed: ${err.message}`;
  console.error(err);
});
