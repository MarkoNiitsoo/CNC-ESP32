const params = new URLSearchParams(location.search);
const filePath = params.get('path') || '';
const pathEl = document.querySelector('#file-path');
const canvas = document.querySelector('#preview-canvas');
const statsEl = document.querySelector('#stats');
const warningsEl = document.querySelector('#warnings');
const fitButton = document.querySelector('#fit');
const reloadButton = document.querySelector('#reload');
const jobSummaryEl = document.querySelector('#job-summary');
const jobResultEl = document.querySelector('#job-result');
const loadJobButton = document.querySelector('#load-job');
const saveJobButton = document.querySelector('#save-job');
const capturePositionButton = document.querySelector('#capture-position');
const setWorkZeroButton = document.querySelector('#set-work-zero');
const captureSetZeroButton = document.querySelector('#capture-set-zero');
const downloadJobButton = document.querySelector('#download-job');
const preflightStateEl = document.querySelector('#preflight-state');
const preflightActionEl = document.querySelector('#preflight-action');
const preflightChecksEl = document.querySelector('#preflight-checks');
const refreshPreflightButton = document.querySelector('#refresh-preflight');
const saveJobPreflightButton = document.querySelector('#save-job-preflight');
const dryRunSummaryEl = document.querySelector('#dry-run-summary');
const safeZInput = document.querySelector('#safe-z');
const traceMarginInput = document.querySelector('#trace-margin');
const generateTraceButton = document.querySelector('#generate-trace');
const sendTraceButton = document.querySelector('#send-trace');
const copyTraceButton = document.querySelector('#copy-trace');
const generateAircutButton = document.querySelector('#generate-aircut');
const sendAircutButton = document.querySelector('#send-aircut');
const copyAircutButton = document.querySelector('#copy-aircut');
const stopM5Button = document.querySelector('#stop-m5');
const traceCommandsEl = document.querySelector('#trace-commands');
const dryRunLogEl = document.querySelector('#dry-run-log');
const armStateEl = document.querySelector('#arm-state');
const armSummaryEl = document.querySelector('#arm-summary');
const armResultEl = document.querySelector('#arm-result');
const armJobButton = document.querySelector('#arm-job');
const disarmJobButton = document.querySelector('#disarm-job');
const saveArmedJobButton = document.querySelector('#save-armed-job');
const downloadArmedJobButton = document.querySelector('#download-armed-job');
const armChecklistInputs = [...document.querySelectorAll('[data-arm-check]')];
const toolZeroSummaryEl = document.querySelector('#tool-zero-summary');
const toolZeroResultEl = document.querySelector('#tool-zero-result');
const toolCapturePositionButton = document.querySelector('#tool-capture-position');
const setZZeroButton = document.querySelector('#set-z-zero');
const captureSetZZeroButton = document.querySelector('#capture-set-z-zero');
const saveToolZeroButton = document.querySelector('#save-tool-zero');
const feedOverrideSummaryEl = document.querySelector('#feed-override-summary');
const feedStartPercentInput = document.querySelector('#feed-start-percent');
const feedStartButtons = [...document.querySelectorAll('[data-feed-start]')];
const runPanel = document.querySelector('#run-panel');
const runSummaryEl = document.querySelector('#run-summary');
const runLogEl = document.querySelector('#run-log');
const feedLiveSummaryEl = document.querySelector('#feed-live-summary');
const feedLiveResultEl = document.querySelector('#feed-live-result');
const feedLivePercentInput = document.querySelector('#feed-live-percent');
const feedLiveSetButton = document.querySelector('#feed-live-set');
const feedLiveButtons = [...document.querySelectorAll('[data-feed-live]')];
const feedDeltaButtons = [...document.querySelectorAll('[data-feed-delta]')];
const startJobButton = document.querySelector('#start-job');
const pauseJobButton = document.querySelector('#pause-job');
const resumeJobButton = document.querySelector('#resume-job');
const stopJobButton = document.querySelector('#stop-job');
const refreshJobStatusButton = document.querySelector('#refresh-job-status');
const startModeSelect = document.querySelector('#start-mode');
const runChecklistInputs = [...document.querySelectorAll('[data-run-check]')];
const previewTabButtons = [...document.querySelectorAll('[data-preview-tab-button]')];
const previewTabPanels = [...document.querySelectorAll('[data-preview-tab]')];
const ctx = canvas.getContext('2d');

const MACHINE = { xMin: 0, xMax: 1625, yMin: 0, yMax: 5800 };
let parsed = null;
let jobExists = false;
let jobState = null;
let currentPreflight = null;
let traceCommands = [];
let traceSafety = { ok: false, messages: [] };
let aircutCommands = [];
let aircutSafety = { ok: false, messages: [] };
let dryRunStatus = 'idle';
let activeDryRunCommands = 'trace';
let gcodeText = '';
let gcodeHashSha256 = '';
let gcodeFingerprint = '';
let gcodeFingerprintAlgorithm = '';
let gcodeFingerprintWarning = '';
let jobRunStatus = null;
let jobRunPollTimer = null;
let jobStatusHealthy = true;

function showPreviewTab(tabName) {
  const activeTab = tabName || 'preview';
  previewTabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.previewTabButton === activeTab);
  });
  previewTabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.previewTab === activeTab);
  });
}

function routePreviewTab() {
  const hash = (window.location.hash || '#preview').slice(1);
  const valid = previewTabButtons.some((button) => button.dataset.previewTabButton === hash);
  showPreviewTab(valid ? hash : 'preview');
}

function basename(path) {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(index + 1) : path;
}

function safeJobName(path) {
  return basename(path).replace(/[^A-Za-z0-9._-]/g, '_') || 'job';
}

function jobPathFor(path) {
  return `/jobs/${safeJobName(path)}.job.json`;
}

function nowIso() {
  return new Date().toISOString();
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function computeGcodeHash(text) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto API is unavailable.');
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(digest);
}

function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function cyrb53(text, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

async function computeGcodeFingerprint(text) {
  try {
    const sha256 = await computeGcodeHash(text);
    return {
      value: sha256,
      algorithm: 'sha-256-webcrypto',
      sha256,
      warning: '',
    };
  } catch (err) {
    const size = new TextEncoder().encode(text).length;
    return {
      value: `size:${size}:fnv1a:${fnv1a32(text)}:cyrb53:${cyrb53(text)}`,
      algorithm: 'size+fnv1a32+cyrb53',
      sha256: '',
      warning: `Using fallback G-code fingerprint because SHA-256 is unavailable over this browser connection: ${err.message}`,
    };
  }
}

function emptyPosition() {
  return { x: null, y: null, z: null };
}

function emptyCounts() {
  return { x: null, y: null, z: null };
}

function emptyCapture() {
  return {
    rawM114: '',
    position: emptyPosition(),
    counts: emptyCounts(),
  };
}

function emptyToolZero() {
  return {
    method: 'G92 Z0',
    capturedAt: null,
    beforeG92Z: emptyCapture(),
    afterG92Z: emptyCapture(),
  };
}

function parseAxisTriplet(text, regex) {
  const match = text.match(regex);
  return match ? Number(match[1]) : null;
}

function parseM114(response) {
  return {
    rawM114: response,
    position: {
      x: parseAxisTriplet(response, /(?:^|\s)X:\s*(-?\d+(?:\.\d+)?)/i),
      y: parseAxisTriplet(response, /(?:^|\s)Y:\s*(-?\d+(?:\.\d+)?)/i),
      z: parseAxisTriplet(response, /(?:^|\s)Z:\s*(-?\d+(?:\.\d+)?)/i),
    },
    counts: {
      x: parseAxisTriplet(response, /Count\s+X:\s*(-?\d+(?:\.\d+)?)/i),
      y: parseAxisTriplet(response, /Count\s+.*?\bY:\s*(-?\d+(?:\.\d+)?)/i),
      z: parseAxisTriplet(response, /Count\s+.*?\bZ:\s*(-?\d+(?:\.\d+)?)/i),
    },
  };
}

function previewSummary() {
  if (!parsed) {
    return {
      bounds: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 },
      lineCount: 0,
      segmentCount: 0,
      warnings: [],
    };
  }

  return {
    bounds: {
      xMin: parsed.bounds.xMin,
      xMax: parsed.bounds.xMax,
      yMin: parsed.bounds.yMin,
      yMax: parsed.bounds.yMax,
      zMin: parsed.bounds.zMin,
      zMax: parsed.bounds.zMax,
    },
    lineCount: parsed.parsedLines,
    segmentCount: parsed.segments.length,
    warnings: [...parsed.warnings],
  };
}

function defaultFeedOverride() {
  return {
    startPercent: 100,
    lastUsedPercent: null,
    resetTo100AfterJob: true,
    updatedAt: null,
    source: 'user',
  };
}

function clampFeedPercent(value, fallback = 100) {
  const percent = Math.round(Number(value));
  if (!Number.isFinite(percent)) return fallback;
  return Math.max(10, Math.min(200, percent));
}

function currentFeedOverride() {
  const previous = jobState?.feedOverride || {};
  return {
    ...defaultFeedOverride(),
    ...previous,
    startPercent: clampFeedPercent(feedStartPercentInput?.value ?? previous.startPercent ?? 100, 100),
  };
}

function effectiveFeedRange(feedOverride = currentFeedOverride()) {
  const feeds = parsed?.analysis?.feeds;
  if (!feeds || feeds.feedCommandCount === 0) return null;
  const percent = clampFeedPercent(feedOverride.startPercent, 100);
  return {
    percent,
    min: feeds.minFeed * percent / 100,
    max: feeds.maxFeed * percent / 100,
  };
}

function newJobState() {
  const createdAt = nowIso();
  return {
    schemaVersion: 2,
    createdAt,
    updatedAt: createdAt,
    gcodePath: filePath,
    jobPath: jobPathFor(filePath),
    startMode: 'apply_current_position_as_work_zero',
    startChecklist: defaultRunChecklistState(),
    allowedWorkspaceCommands: false,
    feedOverride: defaultFeedOverride(),
    preview: previewSummary(),
    workZero: {
      method: 'G92 X0 Y0 Z0',
      capturedAt: null,
      beforeG92: emptyCapture(),
      afterG92: emptyCapture(),
    },
    toolZero: emptyToolZero(),
    notes: '',
  };
}

function dryRunSummary() {
  const previous = jobState?.dryRun || {};
  return {
    safeZ: Number(safeZInput.value) || 15,
    margin: Number(traceMarginInput.value) || 0,
    lastBoundingBoxTraceAt: previous.lastBoundingBoxTraceAt || null,
    lastBoundingBoxTraceStatus: previous.lastBoundingBoxTraceStatus || 'idle',
    lastAircutAt: previous.lastAircutAt || null,
    lastAircutStatus: previous.lastAircutStatus || 'idle',
    lastAircutCommandCount: previous.lastAircutCommandCount || 0,
  };
}

function checklistState() {
  const state = {};
  armChecklistInputs.forEach((input) => {
    state[input.dataset.armCheck] = input.checked;
  });
  return state;
}

function applyChecklistState(state = {}) {
  armChecklistInputs.forEach((input) => {
    input.checked = Boolean(state[input.dataset.armCheck]);
  });
}

function checklistComplete() {
  return armChecklistInputs.every((input) => input.checked);
}

function defaultRunChecklistState() {
  return {
    toolAtWorkZero: false,
    zZeroCorrect: false,
    materialFixed: false,
    spindleOff: false,
  };
}

function runChecklistState() {
  const state = {};
  runChecklistInputs.forEach((input) => {
    state[input.dataset.runCheck] = input.checked;
  });
  return state;
}

function applyRunChecklistState(state = {}) {
  const next = { ...defaultRunChecklistState(), ...state };
  runChecklistInputs.forEach((input) => {
    input.checked = Boolean(next[input.dataset.runCheck]);
  });
}

function runChecklistComplete() {
  return runChecklistInputs.every((input) => input.checked);
}

function hasRawCapture(capture) {
  return Boolean(capture && capture.rawM114);
}

function addCheck(checks, id, level, message) {
  checks.push({ id, level, message });
}

function computePreflight() {
  const checks = [];
  if (!parsed) {
    addCheck(checks, 'preview', 'warning', 'Preview has not loaded yet');
    return { state: 'UNKNOWN', updatedAt: nowIso(), checks };
  }

  const b = parsed.bounds;
  if (b.xMin >= MACHINE.xMin && b.xMax <= MACHINE.xMax && b.yMin >= MACHINE.yMin && b.yMax <= MACHINE.yMax) {
    addCheck(checks, 'machineBounds', 'pass', 'Fits default LowRider work area');
  } else {
    addCheck(checks, 'machineBounds', 'fail', 'Toolpath exceeds default LowRider work area');
  }

  if (parsed.analysis.hasZ) {
    if (b.zMin >= -30) addCheck(checks, 'zRange', 'pass', 'Z minimum is within expected range');
    else addCheck(checks, 'zRange', 'warning', `Z minimum ${b.zMin.toFixed(2)} mm is below -30 mm`);
  } else {
    addCheck(checks, 'zRange', 'warning', 'File has no Z movement');
  }

  if (parsed.analysis.hasG20) addCheck(checks, 'units', 'fail', 'File contains G20 inch mode; machine is expected to use millimeters');
  else if (parsed.analysis.hasG21) addCheck(checks, 'units', 'pass', 'File contains G21 millimeter mode');
  else addCheck(checks, 'units', 'warning', 'File does not contain G21 millimeter mode');

  if (parsed.analysis.hasG91) addCheck(checks, 'coordinateMode', 'fail', 'File contains G91 relative moves');
  else if (parsed.analysis.hasG90) addCheck(checks, 'coordinateMode', 'pass', 'File contains G90 absolute mode');
  else addCheck(checks, 'coordinateMode', 'warning', 'File does not contain G90 absolute mode');

  if (parsed.analysis.nonDefaultWorkspaceCommands.length > 0) {
    if (jobState?.allowedWorkspaceCommands) {
      addCheck(checks, 'workspaceCommands', 'warning', 'Non-default workspace command found. This may conflict with captured work zero.');
    } else {
      addCheck(checks, 'workspaceCommands', 'fail', 'Non-default workspace command found. This may conflict with captured work zero.');
    }
  } else if (parsed.analysis.hasG54) {
    addCheck(checks, 'workspaceCommands', 'pass', 'G54 default workspace command found.');
  } else {
    addCheck(checks, 'workspaceCommands', 'pass', 'No explicit workspace command found. G54 default workspace will be applied at start.');
  }

  if (parsed.analysis.hasSpindleOn) addCheck(checks, 'spindle', 'warning', 'File contains M3/M4 spindle or laser enable command');
  else addCheck(checks, 'spindle', 'pass', 'No spindle/laser enable command detected');

  const workZero = jobState?.workZero;
  if (hasRawCapture(workZero?.beforeG92) && hasRawCapture(workZero?.afterG92)) {
    addCheck(checks, 'workZero', 'pass', 'Work zero has before/after G92 captures');
  } else if (hasRawCapture(workZero?.beforeG92)) {
    addCheck(checks, 'workZero', 'warning', 'Current position was captured, but G92 work zero has not been set');
  } else {
    addCheck(checks, 'workZero', 'fail', 'Work zero is missing');
  }

  if (jobExists) addCheck(checks, 'jobJson', 'pass', 'Job JSON exists or was saved in this session');
  else addCheck(checks, 'jobJson', 'warning', 'Job JSON has not been saved yet');

  if (parsed.analysis.fatalErrors > 0) addCheck(checks, 'parser', 'fail', 'Preview parser reported fatal errors');
  else addCheck(checks, 'parser', 'pass', 'Preview parser completed');

  if (parsed.analysis.unsupportedTotal > 20) {
    addCheck(checks, 'unsupportedCommands', 'warning', 'Unsupported commands are frequent; preview may be incomplete');
  }
  if (parsed.analysis.arcSkipped > 0) addCheck(checks, 'arcsSkipped', 'warning', `${parsed.analysis.arcSkipped} arc move(s) were skipped`);
  if (parsed.analysis.arcApproximated > 0) addCheck(checks, 'arcsApproximated', 'warning', `${parsed.analysis.arcApproximated} arc move(s) were approximated`);

  let state = 'READY';
  if (checks.some((check) => check.level === 'fail')) state = 'NOT_READY';
  else if (checks.some((check) => check.level === 'warning')) state = 'WARNINGS';

  return { state, updatedAt: nowIso(), checks };
}

function renderPreflight() {
  currentPreflight = computePreflight();
  preflightStateEl.textContent = currentPreflight.state.replace('_', ' ');
  preflightStateEl.className = `preflight-state preflight-${currentPreflight.state.toLowerCase().replace('_', '-')}`;

  if (currentPreflight.state === 'NOT_READY') preflightActionEl.textContent = 'Fix failed checks before running this job.';
  else if (currentPreflight.state === 'WARNINGS') preflightActionEl.textContent = 'Warnings should be reviewed before running.';
  else if (currentPreflight.state === 'READY') preflightActionEl.textContent = 'This job appears ready for a future run command.';
  else preflightActionEl.textContent = 'Load a preview to check job readiness.';

  preflightChecksEl.textContent = '';
  currentPreflight.checks.forEach((check) => {
    const row = document.createElement('div');
    row.className = `preflight-check preflight-check-${check.level}`;
    const icon = check.level === 'pass' ? 'PASS' : check.level === 'fail' ? 'FAIL' : 'WARN';
    row.textContent = `${icon} ${check.message}`;
    preflightChecksEl.append(row);
  });
  renderArmPanel();
}

function armWarnings() {
  const warnings = [];
  if (currentPreflight?.checks) {
    currentPreflight.checks.forEach((check) => {
      if (check.level === 'warning') warnings.push(check.message);
    });
  }
  if (parsed?.warnings) warnings.push(...parsed.warnings);
  const dryRun = jobState?.dryRun || {};
  if (dryRun.lastBoundingBoxTraceStatus !== 'complete' && dryRun.lastAircutStatus !== 'complete') {
    warnings.push('Bounding box trace or aircut has not been completed for this job.');
  }
  if (gcodeFingerprintWarning) warnings.push(gcodeFingerprintWarning);
  return warnings;
}

function armBlockers() {
  const blockers = [];
  if (!parsed || !Number.isFinite(parsed.bounds.xMin)) blockers.push('Preview bounds are not available.');
  if (currentPreflight?.checks?.some((check) => check.level === 'fail')) blockers.push('Preflight has failed checks.');
  if (!hasWorkZero()) blockers.push('Work zero is missing.');
  if (!gcodeFingerprint) blockers.push('G-code fingerprint has not been computed.');
  if (!checklistComplete()) blockers.push('All readiness checklist items must be checked.');
  return blockers;
}

function visibleArmState() {
  const arm = jobState?.arm;
  if (arm?.state === 'STALE') return 'STALE';
  if (arm?.state === 'ARMED') {
    const savedFingerprint = arm.gcodeFingerprint || arm.gcodeHashSha256;
    const savedAlgorithm = arm.gcodeFingerprintAlgorithm || (arm.gcodeHashSha256 ? 'sha-256-webcrypto' : '');
    if (savedFingerprint !== gcodeFingerprint || savedAlgorithm !== gcodeFingerprintAlgorithm) return 'STALE';
    if (currentPreflight?.checks?.some((check) => check.level === 'fail')) return 'STALE';
    if (!hasWorkZero()) return 'STALE';
    return 'ARMED';
  }
  return armBlockers().length ? 'NOT_READY' : 'READY';
}

function renderArmPanel() {
  if (!armStateEl) return;
  const state = visibleArmState();
  const warnings = armWarnings();
  const blockers = armBlockers();
  const dryRun = jobState?.dryRun || {};
  const workZero = jobState?.workZero;

  armStateEl.textContent = state;
  armStateEl.className = `arm-state arm-${state.toLowerCase().replace('_', '-')}`;
  armJobButton.disabled = state === 'ARMED' || blockers.length > 0;
  disarmJobButton.disabled = !jobState?.arm || jobState.arm.state !== 'ARMED';

  armSummaryEl.innerHTML = `
    <dl>
      <dt>G-code fingerprint</dt><dd>${gcodeFingerprint || '-'}</dd>
      <dt>Fingerprint algorithm</dt><dd>${gcodeFingerprintAlgorithm || '-'}</dd>
      <dt>Preflight</dt><dd>${currentPreflight?.state || 'UNKNOWN'}</dd>
      <dt>Warnings</dt><dd>${warnings.length}</dd>
      <dt>Work zero</dt><dd>${hasWorkZero() ? 'Captured before and after G92' : 'Missing'}</dd>
      <dt>Work zero captured</dt><dd>${workZero?.capturedAt || '-'}</dd>
      <dt>Bounding box trace</dt><dd>${dryRun.lastBoundingBoxTraceStatus || 'idle'}</dd>
      <dt>Aircut</dt><dd>${dryRun.lastAircutStatus || 'idle'}</dd>
      <dt>Saved arm state</dt><dd>${jobState?.arm?.state || 'NOT_ARMED'}</dd>
    </dl>
  `;

  if (blockers.length) {
    armSummaryEl.innerHTML += `<div class="dry-run-errors">${blockers.map((message) => `<div>${message}</div>`).join('')}</div>`;
  }
  if (warnings.length) {
    armSummaryEl.innerHTML += `<div class="arm-warnings">${warnings.map((message) => `<div>${message}</div>`).join('')}</div>`;
  }
  renderRunPanel();
}

function appendRunLog(text) {
  if (!runLogEl) return;
  runLogEl.textContent += `${text}\n`;
  runLogEl.scrollTop = runLogEl.scrollHeight;
}

function runLogError(prefix, err) {
  appendRunLog(`${prefix}: ${err.message || err}`);
}

function runStatusValue(key) {
  return jobRunStatus && jobRunStatus[key] !== undefined && jobRunStatus[key] !== null ? jobRunStatus[key] : '-';
}

function feedStatusPercent() {
  return clampFeedPercent(jobRunStatus?.feedOverridePercent ?? jobState?.feedOverride?.lastUsedPercent ?? jobState?.feedOverride?.startPercent ?? 100, 100);
}

function renderLiveFeedOverride() {
  if (!feedLiveSummaryEl) return;
  const percent = feedStatusPercent();
  if (feedLivePercentInput) feedLivePercentInput.value = percent;
  const caution = percent > 125 ? ' caution' : '';
  feedLiveSummaryEl.innerHTML = `
    <dl>
      <dt>Current override</dt><dd class="${caution.trim()}">${percent}%</dd>
      <dt>Last command</dt><dd>${runStatusValue('lastFeedOverrideCommand')}</dd>
      <dt>Last response</dt><dd>${runStatusValue('lastFeedOverrideResponse')}</dd>
      <dt>Last error</dt><dd>${runStatusValue('lastFeedOverrideError')}</dd>
    </dl>
  `;
  if (percent > 125) {
    feedLiveSummaryEl.innerHTML += '<p class="warning">Caution: feed override is above 125%.</p>';
  }
}

function renderRunPanel() {
  try {
    if (!runPanel || !runSummaryEl || !startJobButton || !pauseJobButton || !resumeJobButton || !stopJobButton) return;
    const armState = visibleArmState();
    const preflightHasFail = currentPreflight?.checks?.some((check) => check.level === 'fail');
    const canShow = armState === 'ARMED';
    runPanel.hidden = !canShow;

    const state = jobRunStatus?.state || 'IDLE';
    const running = state === 'RUNNING';
    const preparing = state === 'PREPARING';
    const pausing = state === 'PAUSING';
    const paused = state === 'PAUSED';
    const resuming = state === 'RESUMING';
    const stopping = state === 'STOPPING';
    const active = running || preparing || pausing || paused || resuming || stopping;
    const statusUnknown = !jobStatusHealthy || state === 'UNKNOWN';
    const startAllowed = canShow && !preflightHasFail && !active;
    const startChecklistReady = runChecklistComplete();

    startJobButton.hidden = !startAllowed;
    startJobButton.disabled = !startAllowed || !startChecklistReady;
    pauseJobButton.disabled = !(running || statusUnknown);
    resumeJobButton.disabled = !paused;
    stopJobButton.disabled = stopping;

    runSummaryEl.innerHTML = `
      <dl>
        <dt>State</dt><dd>${state}</dd>
        <dt>Start mode</dt><dd>${(startModeSelect?.value || jobState?.startMode || 'apply_current_position_as_work_zero').replace(/_/g, ' ')}</dd>
        <dt>Workspace commands</dt><dd>${jobState?.allowedWorkspaceCommands ? 'G55+ allowed by job JSON' : 'Only G54 allowed by default'}</dd>
        <dt>Progress</dt><dd>${jobRunStatus ? Number(jobRunStatus.progressPercent || 0).toFixed(1) : '0.0'}%</dd>
        <dt>Byte offset</dt><dd>${runStatusValue('currentByteOffset')} / ${runStatusValue('fileSize')}</dd>
        <dt>Sent lines</dt><dd>${runStatusValue('sentLineCount')}</dd>
        <dt>Acknowledged lines</dt><dd>${runStatusValue('acknowledgedLineCount')}</dd>
        <dt>Priority</dt><dd>${runStatusValue('lastPriorityCommand')} ${runStatusValue('priorityCommandInProgress') === true ? '(in progress)' : ''}</dd>
        <dt>Pause/stop</dt><dd>${runStatusValue('streamingPausedReason')}</dd>
        <dt>Last command</dt><dd>${runStatusValue('lastCommand')}</dd>
        <dt>Last response</dt><dd>${runStatusValue('lastResponse')}</dd>
        <dt>Last error</dt><dd>${runStatusValue('lastError')}</dd>
      </dl>
    `;
    if (startAllowed && !startChecklistReady) {
      runSummaryEl.innerHTML += '<div class="dry-run-errors"><div>Complete all Ready To Start checks before starting the job.</div></div>';
    }
    if (statusUnknown) {
      runSummaryEl.innerHTML += '<div class="dry-run-errors"><div>Status could not be parsed. Stop remains available.</div></div>';
    }
    if (pausing) {
      runSummaryEl.innerHTML += '<div class="dry-run-errors"><div>Pausing: file streaming is stopped while firmware sends priority M5/M400.</div></div>';
    }
    if (stopping) {
      runSummaryEl.innerHTML += '<div class="dry-run-errors"><div>Stopping: file streaming is stopped while firmware sends priority M5/M410.</div></div>';
    }
    renderLiveFeedOverride();
  } catch (err) {
    appendRunLog(`Run panel render failed: ${err.message}`);
    if (stopJobButton) stopJobButton.disabled = false;
  }
}

async function setLiveFeedOverride(percent) {
  const value = clampFeedPercent(percent, feedStatusPercent());
  if (value > 150 && !confirm('Feed override above 150% can move the CNC much faster. Continue?')) return;
  if (feedLiveResultEl) {
    feedLiveResultEl.textContent = `Requesting ${value}%...`;
    feedLiveResultEl.classList.remove('error');
  }

  try {
    const data = await postCriticalJobAction('/api/job/feed-override', { percent: value });
    jobRunStatus = { ...(jobRunStatus || {}), ...data, feedOverridePercent: value };
    if (jobState) {
      jobState.feedOverride = {
        ...currentFeedOverride(),
        lastUsedPercent: value,
        updatedAt: nowIso(),
        source: 'user',
      };
    }
    if (feedLiveResultEl) feedLiveResultEl.textContent = `Feed override requested: ${value}%`;
    renderLiveFeedOverride();
    renderFeedOverridePanel();
  } catch (err) {
    if (feedLiveResultEl) {
      feedLiveResultEl.textContent = err.message;
      feedLiveResultEl.classList.add('error');
    }
    appendRunLog(`Feed override failed: ${err.message}`);
  }
}

function updateJobRunPolling() {
  const state = jobRunStatus?.state;
  const shouldPoll = state === 'RUNNING' || state === 'PAUSED' || state === 'PREPARING' ||
    state === 'PAUSING' || state === 'RESUMING' || state === 'STOPPING';
  if (shouldPoll && !jobRunPollTimer) {
    jobRunPollTimer = setInterval(() => refreshJobStatus().catch((err) => appendRunLog(`Status failed: ${err.message}`)), 2000);
  } else if (!shouldPoll && jobRunPollTimer) {
    clearInterval(jobRunPollTimer);
    jobRunPollTimer = null;
  }
}

async function refreshJobStatus() {
  const res = await fetch('/api/job/status');
  const data = await readJsonOrThrow(res);
  if (!res.ok) throw new Error(data.error || 'status failed');
  jobRunStatus = data;
  jobStatusHealthy = true;
  renderRunPanel();
  updateJobRunPolling();
  return data;
}

async function readJsonOrThrow(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (err) {
    const preview = text.slice(0, 180).replace(/\s+/g, ' ');
    throw new Error(`Invalid JSON from ${res.url || 'ESP32'}: ${err.message}. Response starts: ${preview}`);
  }
}

async function postJobAction(url, body = null) {
  const options = { method: 'POST' };
  if (body) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const data = await readJsonOrThrow(res);
  if (!res.ok) throw new Error(data.error || `${url} failed`);
  jobRunStatus = data;
  jobStatusHealthy = true;
  renderRunPanel();
  updateJobRunPolling();
  return data;
}

function optimisticCriticalStatus(url) {
  if (url.includes('/api/job/start')) {
    return {
      ...(jobRunStatus || {}),
      state: 'RUNNING',
      gcodePath: filePath,
      jobPath: jobPathFor(filePath),
      lastError: 'Firmware returned malformed JSON after Start Job. Safety controls remain available.',
    };
  }
  if (url.includes('/api/job/pause')) {
    return {
      ...(jobRunStatus || {}),
      state: 'PAUSING',
      streamingPausedReason: 'Pause requested. Streaming stopped.',
      lastError: 'Firmware returned malformed JSON after Pause.',
    };
  }
  if (url.includes('/api/job/resume')) {
    return {
      ...(jobRunStatus || {}),
      state: 'RESUMING',
      lastError: 'Firmware returned malformed JSON after Resume.',
    };
  }
  if (url.includes('/api/job/stop')) {
    return {
      ...(jobRunStatus || {}),
      state: 'STOPPING',
      streamingPausedReason: 'Stop requested. Streaming stopped.',
      lastError: 'Firmware returned malformed JSON after Stop.',
    };
  }
  if (url.includes('/api/job/feed-override')) {
    return {
      ...(jobRunStatus || {}),
      lastFeedOverrideError: 'Firmware returned malformed JSON after Feed Override.',
    };
  }
  return { ...(jobRunStatus || {}), state: 'UNKNOWN', lastError: `Malformed JSON after ${url}` };
}

async function postCriticalJobAction(url, body = null) {
  const options = { method: 'POST' };
  if (body) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    if (!res.ok) throw new Error(`HTTP ${res.status}; invalid JSON response: ${err.message}`);
    jobStatusHealthy = false;
    jobRunStatus = optimisticCriticalStatus(url);
    renderRunPanel();
    appendRunLog(jobRunStatus.streamingPausedReason || jobRunStatus.lastError || 'Command was sent.');
    return jobRunStatus;
  }
  if (!res.ok) throw new Error(data.error || `${url} failed`);
  jobRunStatus = data;
  jobStatusHealthy = true;
  renderRunPanel();
  updateJobRunPolling();
  return data;
}

async function sendCmdBestEffort(cmd) {
  try {
    const res = await fetch('/api/cmd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd }),
    });
    const text = await res.text();
    try {
      const data = text ? JSON.parse(text) : {};
      if (!res.ok || data.ok === false) throw new Error(data.error || `${cmd} failed`);
      appendRunLog(`${cmd} sent`);
    } catch (err) {
      if (!res.ok) throw err;
      appendRunLog(`${cmd} was sent, but response JSON was invalid.`);
    }
  } catch (err) {
    appendRunLog(`${cmd} fallback failed: ${err.message}`);
  }
}

async function startJobRun() {
  if (visibleArmState() !== 'ARMED') {
    appendRunLog('Start blocked: job is not ARMED.');
    return;
  }
  if (currentPreflight?.checks?.some((check) => check.level === 'fail')) {
    appendRunLog('Start blocked: Preflight has failed checks.');
    return;
  }
  if (!runChecklistComplete()) {
    appendRunLog('Start blocked: complete all Ready To Start checks first.');
    return;
  }

  const text = 'This will start streaming the G-code file from ESP32 SD to Marlin. Keep your hand near the physical emergency stop.';
  if (!confirm(text)) return;
  const warnings = armWarnings();
  if (warnings.length && !confirm(`${warnings.length} warning(s) exist. Confirm that you have reviewed them before starting this job.`)) return;

  const job = ensureJobState();
  const data = await postCriticalJobAction('/api/job/start', {
    gcodePath: filePath,
    jobPath: jobPathFor(filePath),
    startMode: job.startMode,
  });
  appendRunLog(`Started ${data.gcodePath || filePath} with ${job.startMode}.`);
}

async function pauseJobRun() {
  try {
    const data = await postCriticalJobAction('/api/job/pause');
    appendRunLog(data.message || `Pause requested${data.currentByteOffset !== undefined ? ` at byte ${data.currentByteOffset}` : ''}`);
  } catch (err) {
    runLogError('Pause failed', err);
  }
}

async function resumeJobRun() {
  try {
    const data = await postCriticalJobAction('/api/job/resume');
    appendRunLog(data.message || `Resume requested${data.currentByteOffset !== undefined ? ` at byte ${data.currentByteOffset}` : ''}`);
  } catch (err) {
    runLogError('Resume failed', err);
  }
}

async function stopJobRun() {
  appendRunLog('Stop requested. This is not a physical emergency stop.');
  try {
    const data = await postCriticalJobAction('/api/job/stop');
    appendRunLog(data.message || 'Stop command accepted by firmware.');
  } catch (err) {
    runLogError('Stop endpoint failed', err);
    appendRunLog('Trying best-effort M5 and M400 fallback through /api/cmd.');
    await sendCmdBestEffort('M5');
    await sendCmdBestEffort('M400');
  }
}

function ensureJobState() {
  if (!jobState) jobState = newJobState();
  jobState.gcodePath = filePath;
  jobState.jobPath = jobPathFor(filePath);
  if (!jobState.startMode) jobState.startMode = 'apply_current_position_as_work_zero';
  if (!jobState.startChecklist) jobState.startChecklist = defaultRunChecklistState();
  if (jobState.allowedWorkspaceCommands !== true) jobState.allowedWorkspaceCommands = false;
  if (startModeSelect) jobState.startMode = startModeSelect.value || jobState.startMode;
  jobState.feedOverride = {
    ...currentFeedOverride(),
    updatedAt: jobState.feedOverride?.updatedAt || null,
    source: jobState.feedOverride?.source || 'user',
  };
  jobState.startChecklist = runChecklistState();
  jobState.preview = previewSummary();
  jobState.dryRun = dryRunSummary();
  jobState.updatedAt = nowIso();
  return jobState;
}

function fmtValue(value) {
  return value === null || value === undefined || Number.isNaN(value) ? '-' : Number(value).toFixed(3);
}

function formatCapture(capture) {
  if (!capture || !capture.rawM114) return 'No capture yet';
  return `X ${fmtValue(capture.position?.x)} Y ${fmtValue(capture.position?.y)} Z ${fmtValue(capture.position?.z)} | Count X ${fmtValue(capture.counts?.x)} Y ${fmtValue(capture.counts?.y)} Z ${fmtValue(capture.counts?.z)}`;
}

function setJobResult(message, isError = false) {
  jobResultEl.textContent = message;
  jobResultEl.className = isError ? 'job-result warning-item' : 'job-result';
}

function setToolZeroResult(message, isError = false) {
  if (!toolZeroResultEl) return;
  toolZeroResultEl.textContent = message;
  toolZeroResultEl.className = isError ? 'job-result warning-item' : 'job-result';
}

function setArmResult(message, isError = false) {
  if (!armResultEl) return;
  armResultEl.textContent = message;
  armResultEl.className = isError ? 'job-result warning-item' : 'job-result';
}

function fmtMm(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/, '');
}

function hasWorkZero() {
  const workZero = jobState?.workZero;
  return hasRawCapture(workZero?.beforeG92) && hasRawCapture(workZero?.afterG92);
}

function ensureToolZeroState() {
  const job = ensureJobState();
  if (!job.toolZero) job.toolZero = emptyToolZero();
  if (!job.toolZero.beforeG92Z) job.toolZero.beforeG92Z = emptyCapture();
  if (!job.toolZero.afterG92Z) job.toolZero.afterG92Z = emptyCapture();
  return job.toolZero;
}

function markArmStaleForZZero() {
  if (jobState?.arm?.state === 'ARMED') {
    jobState.arm.state = 'STALE';
    setArmResult('Z zero changed. Review and re-arm the job before running.', true);
  }
}

function renderToolZeroPanel() {
  if (!toolZeroSummaryEl) return;
  const path = jobPathFor(filePath);
  const toolZero = jobState?.toolZero || emptyToolZero();
  toolZeroSummaryEl.innerHTML = `
    <dl>
      <dt>G-code</dt><dd>${filePath || '-'}</dd>
      <dt>Job JSON</dt><dd>${path}</dd>
      <dt>Method</dt><dd>${toolZero.method || 'G92 Z0'}</dd>
      <dt>Captured</dt><dd>${toolZero.capturedAt || '-'}</dd>
      <dt>Before G92 Z0</dt><dd>${formatCapture(toolZero.beforeG92Z)}</dd>
      <dt>After G92 Z0</dt><dd>${formatCapture(toolZero.afterG92Z)}</dd>
      <dt>Raw before</dt><dd>${toolZero.beforeG92Z?.rawM114 || '-'}</dd>
      <dt>Raw after</dt><dd>${toolZero.afterG92Z?.rawM114 || '-'}</dd>
    </dl>
  `;
}

async function canChangeZZero() {
  try {
    const status = await refreshJobStatus();
    if (status.state === 'RUNNING' || status.state === 'PREPARING' || status.state === 'STOPPING') {
      setToolZeroResult('Cannot set Z zero while a job is running or changing state.', true);
      return false;
    }
    return true;
  } catch (err) {
    return confirm(`Job status is unavailable: ${err.message}\n\nContinue only if the CNC is not running.`);
  }
}

function appendDryRunLog(text) {
  dryRunLogEl.textContent += `${text}\n`;
  dryRunLogEl.scrollTop = dryRunLogEl.scrollHeight;
}

function setDryRunRunning(isRunning) {
  sendTraceButton.disabled = isRunning || !traceSafety.ok || traceCommands.length === 0;
  sendAircutButton.disabled = isRunning || !aircutSafety.ok || aircutCommands.length === 0;
}

function showCommandPreview(label, commands) {
  activeDryRunCommands = label;
  const shown = commands.slice(0, 100);
  const suffix = commands.length > 100 ? `\n... showing first 100 of ${commands.length} commands` : '';
  traceCommandsEl.textContent = `${label} commands: ${commands.length}\n${shown.join('\n')}${suffix}`;
}

function generatedBounds() {
  if (!parsed) return null;
  const margin = Number(traceMarginInput.value);
  const m = Number.isFinite(margin) ? margin : 0;
  return {
    xMin: parsed.bounds.xMin - m,
    xMax: parsed.bounds.xMax + m,
    yMin: parsed.bounds.yMin - m,
    yMax: parsed.bounds.yMax + m,
  };
}

function validateDryRun(bounds, safeZ) {
  const messages = [];
  if (!parsed) messages.push('Preview bounds are not available.');
  if (!Number.isFinite(safeZ) || safeZ <= 0) messages.push('Safe Z must be a positive number.');
  if (!bounds) messages.push('Bounding box has not been generated.');
  if (bounds && (bounds.xMin < MACHINE.xMin || bounds.xMax > MACHINE.xMax ||
      bounds.yMin < MACHINE.yMin || bounds.yMax > MACHINE.yMax)) {
    messages.push('Generated X/Y bounds exceed LowRider limits X 0..1625, Y 0..5800.');
  }
  if (!hasWorkZero()) messages.push('Work zero is missing. Capture + Set Work Zero before sending a trace.');
  return { ok: messages.length === 0, messages };
}

function validateAircut(safeZ, commandCount) {
  const messages = [];
  const b = parsed?.bounds;
  if (!parsed || !b) messages.push('Preview bounds are not available.');
  if (!Number.isFinite(safeZ) || safeZ <= 0) messages.push('Safe Z must be a positive number.');
  if (b && (b.xMin < MACHINE.xMin || b.xMax > MACHINE.xMax ||
      b.yMin < MACHINE.yMin || b.yMax > MACHINE.yMax)) {
    messages.push('Generated X/Y bounds exceed LowRider limits X 0..1625, Y 0..5800.');
  }
  if (!hasWorkZero()) messages.push('Work zero is missing. Capture + Set Work Zero before sending an aircut.');
  if (commandCount > 5000) messages.push('Large aircut. This may take a long time.');
  return { ok: messages.length === 0 || messages.every((message) => message.startsWith('Large aircut')), messages };
}

function generateTraceCommands() {
  const bounds = generatedBounds();
  const safeZ = Number(safeZInput.value);
  traceSafety = validateDryRun(bounds, safeZ);
  if (!bounds || !Number.isFinite(safeZ)) {
    traceCommands = [];
  } else {
    traceCommands = [
      'M5',
      'G21',
      'G90',
      `G0 Z${fmtMm(safeZ)}`,
      `G0 X${fmtMm(bounds.xMin)} Y${fmtMm(bounds.yMin)}`,
      `G0 X${fmtMm(bounds.xMax)} Y${fmtMm(bounds.yMin)}`,
      `G0 X${fmtMm(bounds.xMax)} Y${fmtMm(bounds.yMax)}`,
      `G0 X${fmtMm(bounds.xMin)} Y${fmtMm(bounds.yMax)}`,
      `G0 X${fmtMm(bounds.xMin)} Y${fmtMm(bounds.yMin)}`,
      `G0 Z${fmtMm(safeZ)}`,
      'M400',
    ];
  }

  showCommandPreview('Bounding box', traceCommands);
  setDryRunRunning(dryRunStatus === 'running');
  renderDryRunPanel();
}

function commandForSegment(segment, previousPoint) {
  const x = segment.to.x;
  const y = segment.to.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (segment.from.x === segment.to.x && segment.from.y === segment.to.y) return null;
  if (previousPoint && previousPoint.x === x && previousPoint.y === y) return null;
  const move = segment.rapid ? 'G0' : 'G1';
  const feed = !segment.rapid && Number.isFinite(segment.feedrate) ? ` F${fmtMm(segment.feedrate)}` : '';
  return {
    command: `${move} X${fmtMm(x)} Y${fmtMm(y)}${feed}`,
    point: { x, y },
  };
}

function generateAircutCommands() {
  const safeZ = Number(safeZInput.value);
  aircutCommands = [];
  let previousPoint = null;
  let truncated = false;
  const maxMovementCommands = 20000;

  if (parsed && Number.isFinite(safeZ)) {
    aircutCommands = ['M5', 'G21', 'G90', `G0 Z${fmtMm(safeZ)}`];
    for (const segment of parsed.segments) {
      const item = commandForSegment(segment, previousPoint);
      if (!item) continue;
      aircutCommands.push(item.command);
      previousPoint = item.point;
      if (aircutCommands.length >= maxMovementCommands) {
        truncated = true;
        break;
      }
    }
    aircutCommands.push(`G0 Z${fmtMm(safeZ)}`, 'M400');
  }

  aircutSafety = validateAircut(safeZ, aircutCommands.length);
  if (truncated) aircutSafety.messages.push('Aircut command list was limited to keep the browser responsive.');
  showCommandPreview('Aircut', aircutCommands);
  setDryRunRunning(dryRunStatus === 'running');
  renderDryRunPanel();
}

function renderDryRunPanel() {
  const bounds = generatedBounds();
  const safeZ = Number(safeZInput.value);
  const b = parsed?.bounds;
  dryRunSummaryEl.innerHTML = `
    <dl>
      <dt>G-code</dt><dd>${filePath || '-'}</dd>
      <dt>Preview bounds</dt><dd>${b ? `X ${b.xMin.toFixed(2)} .. ${b.xMax.toFixed(2)}, Y ${b.yMin.toFixed(2)} .. ${b.yMax.toFixed(2)}, Z ${b.zMin.toFixed(2)} .. ${b.zMax.toFixed(2)}` : '-'}</dd>
      <dt>Trace bounds</dt><dd>${bounds ? `X ${bounds.xMin.toFixed(2)} .. ${bounds.xMax.toFixed(2)}, Y ${bounds.yMin.toFixed(2)} .. ${bounds.yMax.toFixed(2)}` : '-'}</dd>
      <dt>Safe Z</dt><dd>${Number.isFinite(safeZ) ? `${safeZ} mm` : '-'}</dd>
      <dt>Bounding box commands</dt><dd>${traceCommands.length}</dd>
      <dt>Aircut commands</dt><dd>${aircutCommands.length}</dd>
      <dt>Shown commands</dt><dd>${activeDryRunCommands}</dd>
      <dt>Status</dt><dd>${dryRunStatus}</dd>
    </dl>
  `;

  const messages = [...traceSafety.messages, ...aircutSafety.messages];
  if (messages.length) {
    dryRunSummaryEl.innerHTML += `<div class="dry-run-errors">${messages.map((message) => `<div>${message}</div>`).join('')}</div>`;
  }
}

function renderJobPanel() {
  const path = jobPathFor(filePath);
  const preview = previewSummary();
  const workZero = jobState?.workZero;
  const b = preview.bounds;
  jobSummaryEl.innerHTML = `
    <dl>
      <dt>G-code</dt><dd>${filePath || '-'}</dd>
      <dt>Job JSON</dt><dd>${path}</dd>
      <dt>Job file</dt><dd>${jobExists ? 'Exists' : 'No job file yet'}</dd>
      <dt>Start mode</dt><dd>${jobState?.startMode || 'apply_current_position_as_work_zero'}</dd>
      <dt>Workspace override</dt><dd>${jobState?.allowedWorkspaceCommands ? 'Non-default workspaces allowed' : 'Only G54 allowed by default'}</dd>
      <dt>Bounds</dt><dd>X ${b.xMin.toFixed(2)} .. ${b.xMax.toFixed(2)}, Y ${b.yMin.toFixed(2)} .. ${b.yMax.toFixed(2)}, Z ${b.zMin.toFixed(2)} .. ${b.zMax.toFixed(2)}</dd>
      <dt>Warnings</dt><dd>${preview.warnings.length}</dd>
      <dt>Before G92</dt><dd>${formatCapture(workZero?.beforeG92)}</dd>
      <dt>After G92</dt><dd>${formatCapture(workZero?.afterG92)}</dd>
    </dl>
  `;
  renderFeedOverridePanel();
}

function renderFeedOverridePanel() {
  if (!feedOverrideSummaryEl) return;
  const feed = currentFeedOverride();
  if (feedStartPercentInput) feedStartPercentInput.value = feed.startPercent;
  const feeds = parsed?.analysis?.feeds || { minFeed: null, maxFeed: null, feedCommandCount: 0 };
  const effective = effectiveFeedRange(feed);
  feedOverrideSummaryEl.innerHTML = `
    <dl>
      <dt>Start override</dt><dd>${feed.startPercent}%</dd>
      <dt>Reset after job</dt><dd>${feed.resetTo100AfterJob ? 'Yes' : 'No'}</dd>
      <dt>G-code F commands</dt><dd>${feeds.feedCommandCount || 0}</dd>
      <dt>G-code feed range</dt><dd>${feeds.feedCommandCount ? `F${fmtMm(feeds.minFeed)} .. F${fmtMm(feeds.maxFeed)}` : '-'}</dd>
      <dt>Effective range</dt><dd>${effective ? `F${fmtMm(effective.min)} .. F${fmtMm(effective.max)} at ${effective.percent}%` : '-'}</dd>
      <dt>Last used</dt><dd>${feed.lastUsedPercent ?? '-'}</dd>
    </dl>
  `;
  if (effective) {
    feedOverrideSummaryEl.innerHTML += `<p class="warning">G-code max F${fmtMm(feeds.maxFeed)}, start override ${effective.percent}%, effective max F${fmtMm(effective.max)}.</p>`;
  }
}

function setFeedStartPercent(percent) {
  const value = clampFeedPercent(percent, 100);
  if (feedStartPercentInput) feedStartPercentInput.value = value;
  const job = ensureJobState();
  job.feedOverride = {
    ...currentFeedOverride(),
    startPercent: value,
    updatedAt: nowIso(),
    source: 'user',
  };
  renderFeedOverridePanel();
  renderRunPanel();
}

async function sendCmd(cmd) {
  const res = await fetch('/api/cmd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `${cmd} failed`);
  }
  return data.response || '';
}

async function captureM114() {
  await sendCmd('M400');
  const raw = await sendCmd('M114');
  return parseM114(raw);
}

async function checkJobExists() {
  if (!filePath) return;
  const res = await fetch(`/api/download?path=${encodeURIComponent(jobPathFor(filePath))}`);
  jobExists = res.ok;
  renderJobPanel();
  renderPreflight();
  renderArmPanel();
}

async function loadJob() {
  const res = await fetch(`/api/download?path=${encodeURIComponent(jobPathFor(filePath))}`);
  if (!res.ok) {
    jobExists = false;
    jobState = newJobState();
    setJobResult('No job file yet');
    renderJobPanel();
    renderFeedOverridePanel();
    renderPreflight();
    return;
  }

  jobState = await res.json();
  if (jobState.dryRun) {
    if (jobState.dryRun.safeZ !== undefined) safeZInput.value = jobState.dryRun.safeZ;
    if (jobState.dryRun.margin !== undefined) traceMarginInput.value = jobState.dryRun.margin;
  }
  if (!jobState.startMode) jobState.startMode = 'apply_current_position_as_work_zero';
  if (!jobState.startChecklist) jobState.startChecklist = defaultRunChecklistState();
  if (jobState.allowedWorkspaceCommands !== true) jobState.allowedWorkspaceCommands = false;
  jobState.feedOverride = { ...defaultFeedOverride(), ...(jobState.feedOverride || {}) };
  if (feedStartPercentInput) feedStartPercentInput.value = clampFeedPercent(jobState.feedOverride.startPercent, 100);
  if (startModeSelect) startModeSelect.value = jobState.startMode;
  applyRunChecklistState(jobState.startChecklist);
  applyChecklistState(jobState.arm?.checklist);
  jobExists = true;
  setJobResult('Job JSON loaded');
  renderJobPanel();
  renderToolZeroPanel();
  renderFeedOverridePanel();
  renderPreflight();
  renderArmPanel();
  generateTraceCommands();
}

async function saveJob() {
  const job = ensureJobState();
  const json = JSON.stringify(job, null, 2);
  const file = new File([json], basename(job.jobPath), { type: 'application/json' });
  const form = new FormData();
  form.append('path', '/jobs');
  form.append('file', file);

  const res = await fetch('/api/upload?overwrite=true', { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Save failed');
  }

  jobExists = true;
  setJobResult(`Saved ${job.jobPath}`);
  renderJobPanel();
  renderToolZeroPanel();
  renderFeedOverridePanel();
  renderPreflight();
  renderArmPanel();
}

async function saveJobWithPreflight() {
  const job = ensureJobState();
  currentPreflight = computePreflight();
  job.preflight = currentPreflight;
  if (job.arm?.state === 'ARMED' && visibleArmState() === 'STALE') job.arm.state = 'STALE';
  await saveJob();
  setJobResult(`Saved ${job.jobPath} with preflight ${job.preflight.state}`);
}

async function saveArmedJob() {
  const job = ensureJobState();
  if (job.arm?.state === 'ARMED' && visibleArmState() === 'STALE') {
    job.arm.state = 'STALE';
  }
  await saveJob();
  setArmResult(`Saved ${job.jobPath}`);
}

async function armJob() {
  const blockers = armBlockers();
  if (blockers.length) {
    setArmResult(`Cannot arm: ${blockers.join(' ')}`, true);
    renderArmPanel();
    return;
  }

  const warnings = armWarnings();
  if (warnings.length) {
    const text = `${warnings.length} warning(s) exist.\n\nWarnings exist. Confirm that you have reviewed them before arming this job.`;
    if (!confirm(text)) return;
  }

  const job = ensureJobState();
  const dryRun = job.dryRun || {};
  const previousArm = job.arm || {};
  job.arm = {
    state: 'ARMED',
    armedAt: nowIso(),
    disarmedAt: null,
    gcodeHashSha256,
    gcodeFingerprint,
    gcodeFingerprintAlgorithm,
    preflightState: currentPreflight?.state || 'UNKNOWN',
    warningCount: warnings.length,
    workZeroCapturedAt: job.workZero?.capturedAt || null,
    dryRun: {
      boundingBoxStatus: dryRun.lastBoundingBoxTraceStatus || 'idle',
      aircutStatus: dryRun.lastAircutStatus || 'idle',
    },
    checklist: checklistState(),
  };

  try {
    await saveJob();
    setArmResult(`Job armed and saved at ${job.arm.armedAt}`);
  } catch (err) {
    job.arm = previousArm;
    setArmResult(`Arm failed because the job JSON could not be saved: ${err.message}`, true);
  }
  renderArmPanel();
}

function disarmJob() {
  const job = ensureJobState();
  job.arm = {
    ...(job.arm || {}),
    state: 'NOT_ARMED',
    disarmedAt: nowIso(),
  };
  setArmResult('Job disarmed. Save the job JSON to persist this state.');
  renderArmPanel();
}

async function sendBoundingBoxTrace() {
  generateTraceCommands();
  if (!traceSafety.ok) {
    appendDryRunLog(`Blocked: ${traceSafety.messages.join(' ')}`);
    return;
  }

  let confirmText = 'This will move the CNC around the job bounding box at safe Z. Keep your hand near the physical emergency stop.';
  const hasPreflightFail = currentPreflight?.checks?.some((check) => check.level === 'fail');
  if (hasPreflightFail) {
    confirmText += '\n\nPreflight has failed checks. Review them before continuing.';
  }
  if (!confirm(confirmText)) return;
  if (hasPreflightFail && !confirm('Preflight has failed checks. Continue with bounding box trace anyway?')) return;

  dryRunStatus = 'running';
  setDryRunRunning(true);
  dryRunLogEl.textContent = '';
  renderDryRunPanel();

  try {
    for (let i = 0; i < traceCommands.length; i += 1) {
      const cmd = traceCommands[i];
      appendDryRunLog(`> [${i + 1}/${traceCommands.length}] ${cmd}`);
      const response = await sendCmd(cmd);
      appendDryRunLog(response || '(ok)');
    }
    dryRunStatus = 'complete';
    if (jobState) {
      jobState.dryRun = dryRunSummary();
      jobState.dryRun.lastBoundingBoxTraceAt = nowIso();
      jobState.dryRun.lastBoundingBoxTraceStatus = 'complete';
    }
    appendDryRunLog('Bounding box trace complete');
  } catch (err) {
    dryRunStatus = 'failed';
    if (jobState) {
      jobState.dryRun = dryRunSummary();
      jobState.dryRun.lastBoundingBoxTraceStatus = 'failed';
    }
    appendDryRunLog(`Stopped: ${err.message}`);
  } finally {
    setDryRunRunning(false);
    renderDryRunPanel();
    renderArmPanel();
  }
}

async function sendAircutToolpath() {
  generateAircutCommands();
  if (!aircutSafety.ok) {
    appendDryRunLog(`Blocked: ${aircutSafety.messages.join(' ')}`);
    return;
  }

  let confirmText = 'This will move the CNC through the full XY toolpath at safe Z without cutting. Keep your hand near the physical emergency stop.';
  const hasPreflightFail = currentPreflight?.checks?.some((check) => check.level === 'fail');
  if (hasPreflightFail) {
    confirmText += '\n\nPreflight has failed checks. Review them before continuing.';
  }
  if (aircutCommands.length > 5000) {
    confirmText += '\n\nLarge aircut. This may take a long time.';
  }
  if (!confirm(confirmText)) return;
  if (hasPreflightFail && !confirm('Preflight has failed checks. Continue with aircut anyway?')) return;

  dryRunStatus = 'aircut running';
  setDryRunRunning(true);
  dryRunLogEl.textContent = '';
  renderDryRunPanel();

  try {
    for (let i = 0; i < aircutCommands.length; i += 1) {
      const cmd = aircutCommands[i];
      appendDryRunLog(`> [${i + 1}/${aircutCommands.length}] ${cmd}`);
      const response = await sendCmd(cmd);
      appendDryRunLog(response || '(ok)');
    }
    dryRunStatus = 'aircut complete';
    if (jobState) {
      jobState.dryRun = dryRunSummary();
      jobState.dryRun.lastAircutAt = nowIso();
      jobState.dryRun.lastAircutStatus = 'complete';
      jobState.dryRun.lastAircutCommandCount = aircutCommands.length;
    }
    appendDryRunLog('Aircut complete');
  } catch (err) {
    dryRunStatus = 'aircut failed';
    if (jobState) {
      jobState.dryRun = dryRunSummary();
      jobState.dryRun.lastAircutStatus = 'failed';
      jobState.dryRun.lastAircutCommandCount = aircutCommands.length;
    }
    appendDryRunLog(`Stopped: ${err.message}`);
  } finally {
    setDryRunRunning(false);
    renderDryRunPanel();
    renderArmPanel();
  }
}

async function copyTraceCommands() {
  if (!traceCommands.length) generateTraceCommands();
  const text = traceCommands.join('\n');
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    appendDryRunLog('Copied commands to clipboard');
  } else {
    appendDryRunLog('Clipboard API unavailable; copy from the command block.');
  }
}

async function copyAircutCommands() {
  if (!aircutCommands.length) generateAircutCommands();
  const text = aircutCommands.join('\n');
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    appendDryRunLog('Copied aircut commands to clipboard');
  } else {
    appendDryRunLog('Clipboard API unavailable; copy from the command block.');
  }
}

async function stopSpindleM5() {
  appendDryRunLog('> M5');
  try {
    const response = await sendCmd('M5');
    appendDryRunLog(response || '(ok)');
  } catch (err) {
    appendDryRunLog(`M5 failed: ${err.message}`);
  }
}

async function captureCurrentPosition() {
  const job = ensureJobState();
  const capture = await captureM114();
  job.workZero.capturedAt = nowIso();
  job.workZero.beforeG92 = capture;
  job.workZero.afterG92 = emptyCapture();
  setJobResult(`Captured current position: ${formatCapture(capture)}`);
  renderJobPanel();
  renderToolZeroPanel();
  renderPreflight();
  renderArmPanel();
  generateTraceCommands();
}

async function captureToolPosition() {
  const toolZero = ensureToolZeroState();
  const capture = await captureM114();
  toolZero.method = 'G92 Z0';
  toolZero.capturedAt = nowIso();
  toolZero.beforeG92Z = capture;
  toolZero.afterG92Z = emptyCapture();
  setToolZeroResult(`Captured current position for Z zero: ${formatCapture(capture)}`);
  renderToolZeroPanel();
}

async function setZZeroWithCapture() {
  if (!(await canChangeZZero())) return;
  if (!confirm('This will set only the current Z position as work Z0. X/Y work zero will not be changed.')) return;

  const toolZero = ensureToolZeroState();
  await sendCmd('M400');
  const before = await sendCmd('M114').then(parseM114);
  await sendCmd('G92 Z0');
  const after = await sendCmd('M114').then(parseM114);
  toolZero.method = 'G92 Z0';
  toolZero.capturedAt = nowIso();
  toolZero.beforeG92Z = before;
  toolZero.afterG92Z = after;
  markArmStaleForZZero();
  setToolZeroResult(`Z zero set. After G92 Z0: ${formatCapture(after)}`);
  renderToolZeroPanel();
  renderArmPanel();
}

async function saveToolZeroToJob() {
  ensureToolZeroState();
  await saveJob();
  setToolZeroResult(`Saved Tool/Z Zero to ${jobPathFor(filePath)}`);
}

async function setWorkZeroWithCapture() {
  if (!confirm('This will make the current tool position the work zero for this job. Continue?')) return;
  const job = ensureJobState();
  const before = await captureM114();
  await sendCmd('G92 X0 Y0 Z0');
  const after = await captureM114();
  job.workZero.capturedAt = nowIso();
  job.workZero.beforeG92 = before;
  job.workZero.afterG92 = after;
  setJobResult(`Work zero set. After G92: ${formatCapture(after)}`);
  renderJobPanel();
  renderToolZeroPanel();
  renderPreflight();
  renderArmPanel();
  generateTraceCommands();
}

function downloadJobJson() {
  const job = ensureJobState();
  const blob = new Blob([JSON.stringify(job, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = basename(job.jobPath);
  link.click();
  URL.revokeObjectURL(url);
}

function stripComments(line) {
  return line.replace(/\([^)]*\)/g, '').replace(/;.*/, '').trim();
}

function parseWords(line) {
  const words = {};
  const matches = line.matchAll(/([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/gi);
  for (const match of matches) {
    const letter = match[1].toUpperCase();
    const value = Number(match[2]);
    if (!Number.isNaN(value)) words[letter] = value;
  }
  return words;
}

function parseCodes(line) {
  const codes = [];
  const matches = line.matchAll(/([GM])\s*([-+]?(?:\d+\.?\d*|\.\d+))/gi);
  for (const match of matches) {
    codes.push({ letter: match[1].toUpperCase(), value: Number(match[2]) });
  }
  return codes;
}

function updateBounds(bounds, pos) {
  bounds.xMin = Math.min(bounds.xMin, pos.x);
  bounds.xMax = Math.max(bounds.xMax, pos.x);
  bounds.yMin = Math.min(bounds.yMin, pos.y);
  bounds.yMax = Math.max(bounds.yMax, pos.y);
  bounds.zMin = Math.min(bounds.zMin, pos.z);
  bounds.zMax = Math.max(bounds.zMax, pos.z);
}

function targetPosition(pos, words, scale, absolute) {
  const next = { ...pos };
  ['X', 'Y', 'Z'].forEach((axis) => {
    if (words[axis] === undefined) return;
    const key = axis.toLowerCase();
    const value = words[axis] * scale;
    next[key] = absolute ? value : next[key] + value;
  });
  return next;
}

function addLinear(segments, bounds, from, to, rapid, feedrate = null) {
  updateBounds(bounds, from);
  updateBounds(bounds, to);
  if (from.x !== to.x || from.y !== to.y) {
    segments.push({ from: { ...from }, to: { ...to }, rapid, feedrate });
  }
}

function addArc(segments, bounds, from, to, words, scale, clockwise, warnings, feedrate) {
  if (words.I === undefined && words.J === undefined) {
    warnings.push('Arc without I/J center offset was skipped.');
    return false;
  }

  const cx = from.x + (words.I || 0) * scale;
  const cy = from.y + (words.J || 0) * scale;
  const radius = Math.hypot(from.x - cx, from.y - cy);
  if (!Number.isFinite(radius) || radius <= 0) {
    warnings.push('Invalid arc radius was skipped.');
    return false;
  }

  const startAngle = Math.atan2(from.y - cy, from.x - cx);
  let endAngle = Math.atan2(to.y - cy, to.x - cx);
  let sweep = endAngle - startAngle;

  if (clockwise && sweep >= 0) sweep -= Math.PI * 2;
  if (!clockwise && sweep <= 0) sweep += Math.PI * 2;

  const steps = Math.max(8, Math.ceil(Math.abs(sweep) * radius / 4));
  let prev = { ...from };
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const angle = startAngle + sweep * t;
    const next = {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      z: from.z + (to.z - from.z) * t,
    };
    addLinear(segments, bounds, prev, next, false, feedrate);
    prev = next;
  }
  return true;
}

function parseGcode(text) {
  const warnings = [];
  const unsupported = new Map();
  const segments = [];
  const bounds = {
    xMin: Infinity,
    xMax: -Infinity,
    yMin: Infinity,
    yMax: -Infinity,
    zMin: Infinity,
    zMax: -Infinity,
  };

  let pos = { x: 0, y: 0, z: 0 };
  let unitsScale = 1;
  let absolute = true;
  let motion = null;
  let feedrate = null;
  let parsedLines = 0;
  let hasG20 = false;
  let hasG21 = false;
  let hasG90 = false;
  let hasG91 = false;
  let hasG54 = false;
  let hasZ = false;
  let hasSpindleOn = false;
  let hasSpindleOff = false;
  const nonDefaultWorkspaceCommands = new Map();
  let arcSkipped = 0;
  let arcApproximated = 0;
  let fatalErrors = 0;
  let minFeed = Infinity;
  let maxFeed = -Infinity;
  let feedCommandCount = 0;

  updateBounds(bounds, pos);

  text.split(/\r?\n/).forEach((raw) => {
    const line = stripComments(raw).toUpperCase();
    if (!line) return;
    parsedLines += 1;

    const words = parseWords(line);
    parseCodes(line).forEach((code) => {
      if (code.letter === 'G') {
        const gValue = code.value;
        const g = Math.trunc(gValue);
        if (g === 0 || g === 1 || g === 2 || g === 3) motion = g;
        else if (g === 20) {
          unitsScale = 25.4;
          hasG20 = true;
        } else if (g === 21) {
          unitsScale = 1;
          hasG21 = true;
        } else if (g === 90) {
          absolute = true;
          hasG90 = true;
        } else if (g === 91) {
          absolute = false;
          hasG91 = true;
        } else if (gValue === 54) {
          hasG54 = true;
        } else if (gValue === 55 || gValue === 56 || gValue === 57 || gValue === 58 || gValue === 59 ||
                   gValue === 59.1 || gValue === 59.2 || gValue === 59.3) {
          const key = `G${String(gValue)}`;
          nonDefaultWorkspaceCommands.set(key, (nonDefaultWorkspaceCommands.get(key) || 0) + 1);
        } else {
          unsupported.set(`G${g}`, (unsupported.get(`G${g}`) || 0) + 1);
        }
      } else if (code.letter === 'M') {
        const m = Math.trunc(code.value);
        if (m === 3 || m === 4) hasSpindleOn = true;
        else if (m === 5) hasSpindleOff = true;
      }
    });

    if (words.Z !== undefined) hasZ = true;
    if (words.F !== undefined) {
      feedrate = words.F * unitsScale;
      minFeed = Math.min(minFeed, feedrate);
      maxFeed = Math.max(maxFeed, feedrate);
      feedCommandCount += 1;
    }

    const hasMoveWord = words.X !== undefined || words.Y !== undefined || words.Z !== undefined;
    if (!hasMoveWord || motion === null) return;

    const next = targetPosition(pos, words, unitsScale, absolute);
    if (motion === 0 || motion === 1) {
      addLinear(segments, bounds, pos, next, motion === 0, motion === 1 ? feedrate : null);
    } else if (motion === 2 || motion === 3) {
      if (addArc(segments, bounds, pos, next, words, unitsScale, motion === 2, warnings, feedrate)) {
        arcApproximated += 1;
      } else {
        arcSkipped += 1;
      }
    }
    pos = next;
  });

  if (!hasG21) warnings.push('File does not contain G21 millimeter mode.');
  if (!hasG90) warnings.push('File does not contain G90 absolute mode.');
  if (hasG20) warnings.push('File contains G20 inch mode; preview converts moves to millimeters.');
  if (hasG91) warnings.push('File contains G91 relative mode.');
  if (hasG54) warnings.push('G54 default workspace command found.');
  if (hasSpindleOn) warnings.push('File contains M3/M4 spindle or laser enable command.');
  if (!hasSpindleOff) warnings.push('No M5 spindle stop command detected.');
  if (!hasZ) warnings.push('File has no Z movement.');
  if (bounds.zMin < -30) warnings.push(`Z minimum ${bounds.zMin.toFixed(2)} mm is below -30 mm.`);
  if (bounds.xMin < MACHINE.xMin || bounds.xMax > MACHINE.xMax ||
      bounds.yMin < MACHINE.yMin || bounds.yMax > MACHINE.yMax) {
    warnings.push('Toolpath exceeds default LowRider work area X 0..1625, Y 0..5800.');
  }

  let unsupportedTotal = 0;
  unsupported.forEach((count) => { unsupportedTotal += count; });
  if (unsupportedTotal > 0) {
    const list = [...unsupported.entries()].slice(0, 8).map(([code, count]) => `${code} x${count}`).join(', ');
    warnings.push(`Unsupported commands encountered: ${list}${unsupported.size > 8 ? ', ...' : ''}.`);
  }
  if (unsupportedTotal > 20) warnings.push('Unsupported commands are frequent; preview may be incomplete.');
  if (nonDefaultWorkspaceCommands.size > 0) {
    const list = [...nonDefaultWorkspaceCommands.entries()].map(([code, count]) => `${code} x${count}`).join(', ');
    warnings.push(`Non-default workspace command found. This may conflict with captured work zero. ${list}`);
  }

  if (!Number.isFinite(bounds.xMin)) updateBounds(bounds, pos);
  return {
    bounds,
    parsedLines,
    segments,
    warnings,
    analysis: {
      hasG20,
      hasG21,
      hasG90,
      hasG91,
      hasG54,
      hasZ,
      hasSpindleOn,
      hasSpindleOff,
      nonDefaultWorkspaceCommands: [...nonDefaultWorkspaceCommands.keys()],
      unsupportedTotal,
      arcSkipped,
      arcApproximated,
      fatalErrors,
      feeds: {
        minFeed: Number.isFinite(minFeed) ? minFeed : null,
        maxFeed: Number.isFinite(maxFeed) ? maxFeed : null,
        feedCommandCount,
      },
    },
  };
}

function fitBounds(bounds) {
  const width = Math.max(1, bounds.xMax - bounds.xMin);
  const height = Math.max(1, bounds.yMax - bounds.yMin);
  const pad = Math.max(width, height) * 0.06 || 10;
  return {
    xMin: bounds.xMin - pad,
    xMax: bounds.xMax + pad,
    yMin: bounds.yMin - pad,
    yMax: bounds.yMax + pad,
  };
}

function draw() {
  if (!parsed) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * ratio));
  canvas.height = Math.max(280, Math.floor(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#080b0d';
  ctx.fillRect(0, 0, w, h);

  const view = fitBounds(parsed.bounds);
  const sx = w / (view.xMax - view.xMin);
  const sy = h / (view.yMax - view.yMin);
  const scale = Math.min(sx, sy);
  const ox = (w - (view.xMax - view.xMin) * scale) / 2;
  const oy = (h - (view.yMax - view.yMin) * scale) / 2;
  const px = (x) => ox + (x - view.xMin) * scale;
  const py = (y) => h - (oy + (y - view.yMin) * scale);

  ctx.strokeStyle = '#263640';
  ctx.lineWidth = 1;
  ctx.strokeRect(px(MACHINE.xMin), py(MACHINE.yMax), (MACHINE.xMax - MACHINE.xMin) * scale, (MACHINE.yMax - MACHINE.yMin) * scale);

  parsed.segments.forEach((segment) => {
    ctx.beginPath();
    ctx.moveTo(px(segment.from.x), py(segment.from.y));
    ctx.lineTo(px(segment.to.x), py(segment.to.y));
    ctx.strokeStyle = segment.rapid ? '#697985' : '#65d28e';
    ctx.lineWidth = segment.rapid ? 1 : 1.6;
    ctx.stroke();
  });
}

function renderStats() {
  const b = parsed.bounds;
  const feeds = parsed.analysis.feeds;
  const effective = effectiveFeedRange();
  statsEl.innerHTML = `
    <dl>
      <dt>X</dt><dd>${b.xMin.toFixed(2)} .. ${b.xMax.toFixed(2)} mm</dd>
      <dt>Y</dt><dd>${b.yMin.toFixed(2)} .. ${b.yMax.toFixed(2)} mm</dd>
      <dt>Z</dt><dd>${b.zMin.toFixed(2)} .. ${b.zMax.toFixed(2)} mm</dd>
      <dt>Feed commands</dt><dd>${feeds.feedCommandCount}</dd>
      <dt>G-code feed</dt><dd>${feeds.feedCommandCount ? `F${fmtMm(feeds.minFeed)} .. F${fmtMm(feeds.maxFeed)}` : '-'}</dd>
      <dt>Effective feed</dt><dd>${effective ? `F${fmtMm(effective.min)} .. F${fmtMm(effective.max)} at ${effective.percent}%` : '-'}</dd>
      <dt>Parsed lines</dt><dd>${parsed.parsedLines}</dd>
      <dt>Segments</dt><dd>${parsed.segments.length}</dd>
    </dl>
  `;

  warningsEl.textContent = '';
  if (!parsed.warnings.length) {
    const ok = document.createElement('p');
    ok.className = 'warning-ok';
    ok.textContent = 'No preview warnings.';
    warningsEl.append(ok);
    return;
  }

  parsed.warnings.forEach((warning) => {
    const item = document.createElement('div');
    item.className = 'warning-item';
    item.textContent = warning;
    warningsEl.append(item);
  });
}

async function loadPreview() {
  if (!filePath) {
    pathEl.textContent = 'Missing path query parameter.';
    return;
  }

  pathEl.textContent = filePath;
  const res = await fetch(`/api/download?path=${encodeURIComponent(filePath)}`);
  if (!res.ok) {
    pathEl.textContent = `Could not download ${filePath}`;
    return;
  }

  const text = await res.text();
  gcodeText = text;
  gcodeHashSha256 = '';
  gcodeFingerprint = '';
  gcodeFingerprintAlgorithm = '';
  gcodeFingerprintWarning = '';
  const fingerprint = await computeGcodeFingerprint(gcodeText);
  gcodeHashSha256 = fingerprint.sha256;
  gcodeFingerprint = fingerprint.value;
  gcodeFingerprintAlgorithm = fingerprint.algorithm;
  gcodeFingerprintWarning = fingerprint.warning;
  parsed = parseGcode(text);
  if (jobState) jobState.preview = previewSummary();
  renderStats();
  renderJobPanel();
  renderToolZeroPanel();
  renderFeedOverridePanel();
  renderPreflight();
  aircutCommands = [];
  aircutSafety = { ok: false, messages: [] };
  generateTraceCommands();
  renderArmPanel();
  draw();
  await checkJobExists();
}

function refreshDryRunCommands() {
  const showAircut = activeDryRunCommands === 'Aircut' && aircutCommands.length;
  generateTraceCommands();
  if (showAircut) generateAircutCommands();
}

function guardedRunClick(label, action) {
  return () => {
    Promise.resolve()
      .then(action)
      .catch((err) => appendRunLog(`${label} failed: ${err.message}`));
  };
}

fitButton.addEventListener('click', draw);
reloadButton.addEventListener('click', loadPreview);
loadJobButton.addEventListener('click', () => loadJob().catch((err) => setJobResult(err.message, true)));
saveJobButton.addEventListener('click', () => saveJob().catch((err) => setJobResult(err.message, true)));
saveJobPreflightButton.addEventListener('click', () => saveJobWithPreflight().catch((err) => setJobResult(err.message, true)));
capturePositionButton.addEventListener('click', () => captureCurrentPosition().catch((err) => setJobResult(err.message, true)));
setWorkZeroButton.addEventListener('click', () => setWorkZeroWithCapture().catch((err) => setJobResult(err.message, true)));
captureSetZeroButton.addEventListener('click', () => setWorkZeroWithCapture().catch((err) => setJobResult(err.message, true)));
downloadJobButton.addEventListener('click', downloadJobJson);
feedStartButtons.forEach((button) => {
  button.addEventListener('click', () => setFeedStartPercent(button.dataset.feedStart));
});
feedStartPercentInput?.addEventListener('change', () => setFeedStartPercent(feedStartPercentInput.value));
refreshPreflightButton.addEventListener('click', renderPreflight);
generateTraceButton.addEventListener('click', generateTraceCommands);
sendTraceButton.addEventListener('click', () => sendBoundingBoxTrace().catch((err) => appendDryRunLog(`Trace failed: ${err.message}`)));
copyTraceButton.addEventListener('click', () => copyTraceCommands().catch((err) => appendDryRunLog(`Copy failed: ${err.message}`)));
generateAircutButton.addEventListener('click', generateAircutCommands);
sendAircutButton.addEventListener('click', () => sendAircutToolpath().catch((err) => appendDryRunLog(`Aircut failed: ${err.message}`)));
copyAircutButton.addEventListener('click', () => copyAircutCommands().catch((err) => appendDryRunLog(`Copy aircut failed: ${err.message}`)));
stopM5Button.addEventListener('click', stopSpindleM5);
armJobButton?.addEventListener('click', () => armJob().catch((err) => setArmResult(err.message, true)));
disarmJobButton?.addEventListener('click', disarmJob);
saveArmedJobButton?.addEventListener('click', () => saveArmedJob().catch((err) => setArmResult(err.message, true)));
downloadArmedJobButton?.addEventListener('click', downloadJobJson);
armChecklistInputs.forEach((input) => input.addEventListener('change', renderArmPanel));
toolCapturePositionButton?.addEventListener('click', () => captureToolPosition().catch((err) => setToolZeroResult(err.message, true)));
setZZeroButton?.addEventListener('click', () => setZZeroWithCapture().catch((err) => setToolZeroResult(err.message, true)));
captureSetZZeroButton?.addEventListener('click', () => setZZeroWithCapture().catch((err) => setToolZeroResult(err.message, true)));
saveToolZeroButton?.addEventListener('click', () => saveToolZeroToJob().catch((err) => setToolZeroResult(err.message, true)));
startJobButton?.addEventListener('click', guardedRunClick('Start', startJobRun));
pauseJobButton?.addEventListener('click', guardedRunClick('Pause', pauseJobRun));
resumeJobButton?.addEventListener('click', guardedRunClick('Resume', resumeJobRun));
stopJobButton?.addEventListener('click', guardedRunClick('Stop', stopJobRun));
refreshJobStatusButton?.addEventListener('click', guardedRunClick('Status', refreshJobStatus));
feedLiveButtons.forEach((button) => {
  button.addEventListener('click', () => setLiveFeedOverride(button.dataset.feedLive));
});
feedDeltaButtons.forEach((button) => {
  button.addEventListener('click', () => setLiveFeedOverride(feedStatusPercent() + Number(button.dataset.feedDelta || 0)));
});
feedLiveSetButton?.addEventListener('click', () => setLiveFeedOverride(feedLivePercentInput?.value));
safeZInput.addEventListener('input', refreshDryRunCommands);
traceMarginInput.addEventListener('input', refreshDryRunCommands);
startModeSelect?.addEventListener('change', () => {
  ensureJobState();
  renderJobPanel();
  renderRunPanel();
});
runChecklistInputs.forEach((input) => input.addEventListener('change', () => {
  ensureJobState();
  renderRunPanel();
}));
previewTabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const tab = button.dataset.previewTabButton;
    history.replaceState(null, '', `#${tab}`);
    showPreviewTab(tab);
    if (tab === 'preview') draw();
  });
});
addEventListener('hashchange', routePreviewTab);
addEventListener('resize', draw);
addEventListener('error', (event) => {
  appendRunLog(`Browser error: ${event.message}`);
  if (stopJobButton) stopJobButton.disabled = false;
});
addEventListener('unhandledrejection', (event) => {
  appendRunLog(`Browser promise error: ${event.reason?.message || event.reason}`);
  if (stopJobButton) stopJobButton.disabled = false;
});
jobState = newJobState();
routePreviewTab();
renderJobPanel();
renderToolZeroPanel();
renderFeedOverridePanel();
renderPreflight();
renderDryRunPanel();
renderArmPanel();
loadPreview();
if (runPanel) refreshJobStatus().catch(() => {});
