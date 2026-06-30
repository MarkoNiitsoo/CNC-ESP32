const params = new URLSearchParams(location.search);
const filePath = params.get('path') || '';
const currentJobKey = 'lowrider.currentJob';
const pathEl = document.querySelector('#file-path');
const canvas = document.querySelector('#preview-canvas');
const statsEl = document.querySelector('#stats');
const warningsEl = document.querySelector('#warnings');
const fitButton = document.querySelector('#fit');
const reloadButton = document.querySelector('#reload');
const placementRotationInput = document.querySelector('#placement-rotation');
const rotateDeltaButtons = [...document.querySelectorAll('[data-rotate-delta]')];
const resetPlacementButton = document.querySelector('#reset-placement');
const previewTransformButton = document.querySelector('#preview-transform');
const generateRunFileButton = document.querySelector('#generate-run-file');
const useGeneratedRunButton = document.querySelector('#use-generated-run');
const useSourceRunButton = document.querySelector('#use-source-run');
const placementSummaryEl = document.querySelector('#placement-summary');
const placementResultEl = document.querySelector('#placement-result');
const readinessSummaryEl = document.querySelector('#readiness-summary');
const readinessPrimaryEl = document.querySelector('#readiness-primary');
const readinessSecondaryEl = document.querySelector('#readiness-secondary');
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
const zeroHistorySummaryEl = document.querySelector('#zero-history-summary');
const runHistorySummaryEl = document.querySelector('#run-history-summary');
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
const runSafeStartZInput = document.querySelector('#run-safe-start-z');
const runChecklistInputs = [...document.querySelectorAll('[data-run-check]')];
const previewTabButtons = [...document.querySelectorAll('[data-preview-tab-button]')];
const previewTabPanels = [...document.querySelectorAll('[data-preview-tab]')];
const workbenchConnectionEl = document.querySelector('#workbench-connection');
const workbenchActiveRunEl = document.querySelector('#workbench-active-run');
const workbenchReadinessEl = document.querySelector('#open-readiness-drawer');
const canvasJobNameEl = document.querySelector('#canvas-job-name');
const canvasActivePathEl = document.querySelector('#canvas-active-path');
const ctx = canvas.getContext('2d');

const MACHINE = { xMin: 0, xMax: 1625, yMin: 0, yMax: 5800 };
let parsed = null;
let toolpathModel = null;
let previewSummaryData = null;
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
let jobStatusHealthy = false;
let transformedPreview = null;
let placementWarnings = [];
let sourceParsed = null;
let sourceToolpathModel = null;
let sourcePreviewSummaryData = null;
let sourceGcodeText = '';
let activeRunText = '';
let activeRunPath = filePath;
let activeRunMode = 'source';
let placementUpdateTimer = null;
let suppressPlacementChange = false;
let workbenchUiModule = null;
let workbenchController = null;
let liveToolPosition = null;
let redirectingToFiles = false;

function redirectToFiles(failedPath = '') {
  if (redirectingToFiles) return;
  redirectingToFiles = true;
  if (failedPath) {
    try {
      const current = JSON.parse(localStorage.getItem(currentJobKey) || 'null');
      if (current?.gcodePath === failedPath) localStorage.removeItem(currentJobKey);
    } catch (err) {
      localStorage.removeItem(currentJobKey);
    }
  }
  window.location.replace('/#files');
}

const toolpathModulesPromise = Promise.all([
  import('/lib/toolpath-model.js'),
  import('/lib/preview-data-adapter.js'),
]).then(([toolpath, adapter]) => ({ toolpath, adapter }));
const jobHistoryPromise = import('/lib/job-history.js');
const toolpathTransformPromise = import('/lib/toolpath-transform.js');
let jobActiveRunModule = null;
const jobActiveRunPromise = import('/lib/job-active-run.js').then((module) => {
  jobActiveRunModule = module;
  return module;
});
let jobReadinessModule = null;
const jobReadinessPromise = import('/lib/job-readiness.js').then((module) => {
  jobReadinessModule = module;
  return module;
});
const workbenchUiPromise = import('/lib/workbench-ui.js').then((module) => {
  workbenchUiModule = module;
  return module;
});
const workbenchControllerPromise = import('/lib/workbench-controller.js');

function showPreviewTab(tabName) {
  const activeTab = tabName || 'preview';
  previewTabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.previewTabButton === activeTab);
  });
  previewTabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.previewTab === activeTab);
  });
}

function workbenchChipClass(level) {
  return ['ok', 'warn', 'fail', 'active'].includes(level) ? level : 'muted';
}

function activeRunIcon(label) {
  if (label === 'GENERATED') return 'generated';
  if (label === 'STALE') return 'warning';
  if (label === 'BLOCKED') return 'blocked';
  return 'source';
}

function readinessIcon(label) {
  if (label === 'READY' || label === 'ARMED' || label === 'RUNNING') return 'ok';
  if (label === 'PAUSED') return 'pause';
  return 'blocked';
}

function actionIcon(action = {}) {
  return ({
    choose_file: 'files', update_run_file: 'generated', set_work_zero: 'workZero', set_z_zero: 'zZero',
    run_dry_run: 'dryRun', arm_job: 'arm', start_cut: 'start', monitor_job: 'log', resume_job: 'start',
    review_last_run: 'log', pause_job: 'pause', stop_job: 'stop', m5: 'm5',
  })[action.id] || 'ok';
}

function renderWorkbenchStatus() {
  if (!workbenchUiModule) return;
  const status = workbenchUiModule.buildWorkbenchStatus(previewReadinessJob(), {
    currentJob: { gcodePath: filePath, jobPath: jobPathFor(filePath) },
    jobStatus: jobRunStatus || {},
  });
  if (workbenchConnectionEl) {
    workbenchConnectionEl.textContent = jobStatusHealthy ? 'ONLINE' : 'OFFLINE';
    workbenchConnectionEl.className = `workbench-chip ${jobStatusHealthy ? 'ok' : 'fail'}`;
  }
  if (workbenchActiveRunEl) {
    workbenchActiveRunEl.textContent = status.activeRun.label;
    workbenchActiveRunEl.title = status.activeRunPath || '';
    workbenchActiveRunEl.className = `workbench-chip ${workbenchChipClass(status.activeRun.level)}`;
    workbenchActiveRunEl.dataset.icon = activeRunIcon(status.activeRun.label);
    window.CncSkin?.applyIcons(workbenchActiveRunEl);
  }
  if (workbenchReadinessEl) {
    workbenchReadinessEl.textContent = status.readiness.label;
    workbenchReadinessEl.className = `workbench-chip status-trigger ${workbenchChipClass(status.readiness.level)}`;
    workbenchReadinessEl.dataset.icon = readinessIcon(status.readiness.label);
    window.CncSkin?.applyIcons(workbenchReadinessEl);
  }
  if (canvasJobNameEl) canvasJobNameEl.textContent = basename(filePath) || 'No job';
  if (canvasActivePathEl) canvasActivePathEl.textContent = status.activeRunPath || 'Choose a G-code file';
}

function routePreviewTab() {
  const hash = (window.location.hash || '#preview').slice(1);
  const valid = previewTabButtons.some((button) => button.dataset.previewTabButton === hash);
  showPreviewTab(valid ? hash : 'preview');
}

function previewReadinessJob() {
  return jobState || {
    gcodePath: filePath,
    sourceGcodePath: filePath,
    activeRun: {
      mode: activeRunMode || 'source',
      path: activeRunPath || filePath,
    },
  };
}

function badgeClass(level) {
  if (level === 'ok') return 'ok-badge';
  if (level === 'fail') return 'fail-badge';
  if (level === 'active') return 'active-badge';
  if (level === 'warn') return 'caution';
  return '';
}

function compactReadinessReason(message) {
  const text = String(message || 'Review job setup.');
  if (/generated/i.test(text) && /valid|stale|missing|update/i.test(text)) return 'Update run file.';
  if (/work zero/i.test(text)) return 'Set work zero.';
  if (/z zero/i.test(text)) return 'Set Z zero.';
  if (/dry run/i.test(text)) return 'Complete dry run.';
  if (/arm/i.test(text)) return 'Review and arm job.';
  return text.length > 86 ? `${text.slice(0, 83)}...` : text;
}

function actionTab(action) {
  const target = action?.target || 'preview';
  if (target === 'dryrun') return 'dry-run';
  return target;
}

function focusReadinessTarget(action) {
  const focusMap = {
    set_work_zero: setWorkZeroButton,
    set_z_zero: setZZeroButton,
    run_dry_run: generateTraceButton,
    arm_job: armJobButton,
    start_cut: startJobButton,
    monitor_job: refreshJobStatusButton,
    resume_job: resumeJobButton,
    review_last_run: runHistorySummaryEl,
  };
  const target = focusMap[action?.id];
  if (!target) return;
  target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  target.focus?.({ preventScroll: true });
}

async function handleReadinessAction(action) {
  if (!action) return;
  if (action.id === 'choose_file') {
    window.location.href = '/files';
    return;
  }
  if (action.id === 'update_run_file') {
    showPreviewTab('preview');
    workbenchController?.openForTab('preview');
    history.replaceState(null, '', '#preview');
    await generateRunFile({ overwrite: true });
    renderReadiness();
    return;
  }
  const tab = actionTab(action);
  if (previewTabButtons.some((button) => button.dataset.previewTabButton === tab)) {
    showPreviewTab(tab);
    workbenchController?.openForTab(tab);
    history.replaceState(null, '', `#${tab}`);
  }
  focusReadinessTarget(action);
}

function renderReadiness() {
  if (!readinessSummaryEl || !readinessPrimaryEl || !readinessSecondaryEl) return;
  if (!jobReadinessModule) {
    readinessSummaryEl.textContent = 'Loading job readiness...';
    return;
  }
  const readiness = jobReadinessModule.buildJobReadiness(previewReadinessJob(), {
    currentJob: { gcodePath: filePath, jobPath: jobPathFor(filePath) },
    jobStatus: jobRunStatus || {},
  });
  const placement = readiness.placement || {};
  const blockers = readiness.blockingReasons || [];
  const badgeHtml = (readiness.badges || [])
    .map((badge) => `<span class="status-badge ${badgeClass(badge.level)}">${html(badge.label)}</span>`)
    .join('');
  const blockerHtml = blockers.length
    ? `<ul class="readiness-blockers">${blockers.map((reason) => `<li>${html(compactReadinessReason(reason.message))}</li>`).join('')}</ul>`
    : '<p class="ok-text">No readiness blockers before the next action.</p>';

  readinessSummaryEl.innerHTML = `
    <div class="readiness-badges">${badgeHtml}</div>
    <dl>
      <dt>Active run file</dt><dd>${html(readiness.activeRun?.path || '-')}</dd>
      <dt>Active mode</dt><dd>${html(readiness.activeRun?.mode || '-')}</dd>
      <dt>Placement</dt><dd>${placement.identity ? 'Original placement' : 'Transformed placement'}${placement.dirty ? ' (update needed)' : ''}</dd>
      <dt>Rotation</dt><dd>${Number(placement.rotationDeg || 0).toFixed(2)} deg</dd>
      <dt>Latest run</dt><dd>${html(readiness.run?.status || '-')}</dd>
    </dl>
    <h3>Blocking reasons</h3>
    ${blockerHtml}
  `;

  readinessPrimaryEl.textContent = '';
  const primary = readiness.primaryAction;
  const primaryButton = document.createElement('button');
  primaryButton.type = 'button';
  primaryButton.className = 'primary-action';
  primaryButton.textContent = primary?.label || 'Review Job';
  primaryButton.dataset.icon = actionIcon(primary);
  primaryButton.addEventListener('click', () => {
    handleReadinessAction(primary).catch((err) => {
      if (jobResultEl) {
        jobResultEl.textContent = `Readiness action failed: ${err.message}`;
        jobResultEl.classList.add('error');
      }
    });
  });
  readinessPrimaryEl.append(primaryButton);

  readinessSecondaryEl.textContent = '';
  (readiness.secondaryActions || []).forEach((secondary) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = secondary.label;
    button.dataset.icon = actionIcon(secondary);
    button.addEventListener('click', () => {
      handleReadinessAction(secondary).catch((err) => appendRunLog(`Readiness action failed: ${err.message}`));
    });
    readinessSecondaryEl.append(button);
  });
  renderWorkbenchStatus();
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
  const capture = {
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
  if (Number.isFinite(capture.position.x) && Number.isFinite(capture.position.y)) {
    window.dispatchEvent(new CustomEvent('cnc-position-update', {
      detail: { ...capture.position, source: 'M114', updatedAt: Date.now() },
    }));
  }
  return capture;
}

function canvasToolPosition() {
  const state = String(jobRunStatus?.state || '').toUpperCase();
  const active = ['RUNNING', 'PAUSING', 'PAUSED', 'RESUMING', 'STOPPING'].includes(state);
  const statusPosition = jobRunStatus?.position || jobRunStatus?.lastKnownPosition;
  if (active && Number.isFinite(statusPosition?.x) && Number.isFinite(statusPosition?.y)) {
    return { ...statusPosition, source: 'STATUS' };
  }
  if (active) {
    const commanded = workbenchUiModule?.commandedPositionAtLine(parsed?.segments || [], jobRunStatus?.currentLineNumber);
    if (commanded) return { ...commanded, source: 'CMD' };
  }
  if (liveToolPosition) return liveToolPosition;
  if (Number.isFinite(statusPosition?.x) && Number.isFinite(statusPosition?.y)) {
    return { ...statusPosition, source: 'STATUS' };
  }
  return null;
}

function canvasWorkZeroPosition() {
  return workbenchUiModule?.workZeroTablePosition(jobState) || null;
}

function canvasTablePosition(position) {
  return workbenchUiModule?.translatePosition(position, canvasWorkZeroPosition()) || position;
}

function canvasTableBounds(bounds) {
  return workbenchUiModule?.translateBounds(bounds, canvasWorkZeroPosition()) || bounds;
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

  if (previewSummaryData?.metadata) {
    return {
      ...previewSummaryData.metadata,
      legacyBounds: parsed.bounds,
      // Keep the old flat bounds alias for older job JSON readers.
      bounds: previewSummaryData.metadata.bounds,
      lineCount: parsed.parsedLines,
      segmentCount: parsed.segments.length,
      warnings: [...parsed.warnings],
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

function refreshToolpathEstimateForFeed() {
  if (!toolpathModel || !previewSummaryData) return;
  toolpathModel.estimate.effectiveSecondsWithOverride = toolpathModel.estimate.nominalSeconds
    ? toolpathModel.estimate.nominalSeconds * 100 / currentFeedOverride().startPercent
    : null;
  previewSummaryData.effectiveEstimateSeconds = toolpathModel.estimate.effectiveSecondsWithOverride;
  previewSummaryData.estimate = { ...toolpathModel.estimate };
  if (previewSummaryData.metadata?.estimate) {
    previewSummaryData.metadata.estimate = { ...toolpathModel.estimate };
  }
}

function newJobState() {
  const createdAt = nowIso();
  return {
    schemaVersion: 2,
    createdAt,
    updatedAt: createdAt,
    gcodePath: filePath,
    sourceGcodePath: filePath,
    jobPath: jobPathFor(filePath),
    activeRun: {
      mode: 'source',
      path: filePath,
      selectedAt: createdAt,
      selectedBy: 'default',
      sourceFingerprint: '',
      generatedFingerprint: '',
      transformFingerprint: '',
    },
    generatedValidation: {
      status: 'unknown',
      validatedAt: null,
      sourceFingerprint: '',
      generatedFingerprint: '',
      transformFingerprint: '',
      warnings: [],
      errors: [],
      bounds: null,
      feed: null,
      estimate: null,
    },
    startMode: 'apply_current_position_as_work_zero',
    safeStartZ: Number(safeZInput?.value) || 15,
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
    zeroHistory: [],
    runHistory: [],
    activeWorkZeroId: null,
    activeZZeroId: null,
    placement: defaultPlacementState(),
    notes: '',
  };
}

function defaultPlacementState() {
  return {
    rotationDeg: 0,
    originAnchor: 'rawBoundsLowerLeft',
    placementBoundsMode: 'rawTravelBounds',
    normalizeToOrigin: true,
    generatedAt: null,
    generatedRunPath: null,
    generatedRunBounds: null,
    sourceFingerprint: '',
    transformFingerprint: '',
  };
}

function dryRunSummary() {
  const previous = jobState?.dryRun || {};
  return {
    safeZ: Number(safeZInput.value) || 15,
    margin: Number(traceMarginInput.value) || 0,
    activeRunMode: currentRunMode(),
    activeRunPath: currentRunPath(),
    activeRunFingerprint: gcodeFingerprint || '',
    sourceFingerprint: jobState?.activeRun?.sourceFingerprint || '',
    generatedFingerprint: jobState?.activeRun?.generatedFingerprint || '',
    transformFingerprint: jobState?.activeRun?.transformFingerprint || '',
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

  const runBlockers = activeRunBlockers();
  if (runBlockers.length) {
    addCheck(checks, 'activeRun', 'fail', runBlockers.join(' '));
  } else if (currentRunMode() === 'generated') {
    addCheck(checks, 'activeRun', 'pass', 'Generated run file matches the visible placement');
  } else {
    addCheck(checks, 'activeRun', 'pass', 'Original source file is active');
  }

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
  if (currentRunMode() === 'generated') {
    (jobState?.generatedValidation?.warnings || []).forEach((warning) => warnings.push(warning));
  }
  return warnings;
}

function armBlockers() {
  const blockers = [];
  if (!parsed || !Number.isFinite(parsed.bounds.xMin)) blockers.push('Preview bounds are not available.');
  if (currentPreflight?.checks?.some((check) => check.level === 'fail')) blockers.push('Preflight has failed checks.');
  if (!hasWorkZero()) blockers.push('Work zero is missing.');
  if (!gcodeFingerprint) blockers.push('G-code fingerprint has not been computed.');
  if (!checklistComplete()) blockers.push('All readiness checklist items must be checked.');
  blockers.push(...activeRunBlockers());
  return blockers;
}

function visibleArmState() {
  const arm = jobState?.arm;
  if (arm?.state === 'STALE') return 'STALE';
  if (arm?.state === 'ARMED') {
    const savedFingerprint = arm.gcodeFingerprint || arm.gcodeHashSha256;
    const sameFingerprint = jobActiveRunModule?.fingerprintsMatch
      ? jobActiveRunModule.fingerprintsMatch(savedFingerprint, gcodeFingerprint)
      : savedFingerprint === gcodeFingerprint;
    if (!sameFingerprint) return 'STALE';
    if (arm.activeRunPath && arm.activeRunPath !== currentRunPath()) return 'STALE';
    if (arm.activeRunMode && arm.activeRunMode !== currentRunMode()) return 'STALE';
    if (arm.activeRunFingerprint && !(jobActiveRunModule?.fingerprintsMatch
      ? jobActiveRunModule.fingerprintsMatch(arm.activeRunFingerprint, gcodeFingerprint)
      : arm.activeRunFingerprint === gcodeFingerprint)) return 'STALE';
    if (currentRunMode() === 'generated' && arm.transformFingerprint && arm.transformFingerprint !== jobState?.activeRun?.transformFingerprint) return 'STALE';
    if (arm.activeRun?.path && arm.activeRun.path !== currentRunPath()) return 'STALE';
    if (arm.activeRun?.mode && arm.activeRun.mode !== currentRunMode()) return 'STALE';
    if (currentRunMode() === 'generated' && jobState?.generatedValidation?.status !== 'valid') return 'STALE';
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
      <dt>Active run</dt><dd>${html(currentRunPath())}</dd>
      <dt>Active mode</dt><dd>${html(currentRunLabel())}</dd>
      <dt>G-code fingerprint</dt><dd>${gcodeFingerprint || '-'}</dd>
      <dt>Fingerprint algorithm</dt><dd>${gcodeFingerprintAlgorithm || '-'}</dd>
      <dt>Generated status</dt><dd>${html(jobState?.generatedValidation?.status || 'unknown')}</dd>
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
        <dt>Starting</dt><dd>${html(currentRunMode() === 'generated' ? `generated file: ${currentRunPath()}` : `source file: ${currentRunPath()}`)}</dd>
        <dt>Run file</dt><dd>${html(currentRunPath())}</dd>
        <dt>Run mode</dt><dd>${html(currentRunLabel())}</dd>
        <dt>Start mode</dt><dd>${(startModeSelect?.value || jobState?.startMode || 'apply_current_position_as_work_zero').replace(/_/g, ' ')}</dd>
        <dt>Safe start Z</dt><dd>${Number(jobState?.safeStartZ ?? runSafeStartZInput?.value ?? 15).toFixed(1)} mm</dd>
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
    renderReadiness();
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
  if (jobRunPollTimer) {
    clearInterval(jobRunPollTimer);
    jobRunPollTimer = null;
  }
}

async function applyJobRunStatus(data) {
  jobRunStatus = data;
  jobStatusHealthy = true;
  await syncRunHistoryFromStatus(data);
  renderRunPanel();
  updateJobRunPolling();
  return data;
}

async function refreshJobStatus() {
  if (window.CncTelemetry) return window.CncTelemetry.request('job');
  const res = await fetch('/api/job/status');
  const data = await readJsonOrThrow(res);
  if (!res.ok) throw new Error(data.error || 'status failed');
  return applyJobRunStatus(data);
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
      gcodePath: currentRunPath(),
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
  const runPath = currentRunPath();
  const runMode = currentRunMode();
  const runCheck = jobActiveRunModule?.assertCanUseActiveRunForExecution
    ? jobActiveRunModule.assertCanUseActiveRunForExecution(ensureJobState(), { requireArm: true })
    : null;
  const runBlockers = runCheck ? (runCheck.ok ? [] : runCheck.reasons.map((item) => item.message)) : activeRunBlockers();
  if (runBlockers.length) {
    appendRunLog(`Start blocked: ${runBlockers.join(' ')}`);
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

  const warnings = armWarnings();
  if (warnings.length) appendRunLog(`Starting after deliberate hold with ${warnings.length} reviewed warning(s).`);

  const job = ensureJobState();
  const history = await jobHistoryPromise;
  const run = history.startRunHistory(job, jobRunStatus || {});
  try {
    await saveJobQuietly();
    renderHistoryPanels();
    const data = await postCriticalJobAction('/api/job/start', {
      gcodePath: runPath,
      jobPath: jobPathFor(filePath),
      startMode: job.startMode,
      safeStartZ: job.safeStartZ,
      activeRunMode: runMode,
      activeRunFingerprint: gcodeFingerprint,
      sourceFingerprint: job.activeRun?.sourceFingerprint || '',
      generatedFingerprint: job.activeRun?.generatedFingerprint || '',
      transformFingerprint: job.activeRun?.transformFingerprint || '',
    });
    history.updateRunHistoryFromStatus(job, { ...data, state: data.state || 'RUNNING' });
    await saveJobQuietly();
    renderHistoryPanels();
    appendRunLog(`Started ${data.gcodePath || runPath} with ${job.startMode}.`);
  } catch (err) {
    history.finishLatestRun(job, 'error', err.message);
    await saveJobQuietly().catch(() => {});
    renderHistoryPanels();
    appendRunLog(`Run ${run.id} recorded as error.`);
    throw err;
  }
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
    await markLatestRunStopped(data, data.message || 'Operator stop requested');
  } catch (err) {
    runLogError('Stop endpoint failed', err);
    appendRunLog('Trying best-effort M5 and M400 fallback through /api/cmd.');
    await sendCmdBestEffort('M5');
    await sendCmdBestEffort('M400');
    await markLatestRunStopped(null, `Stop fallback used after error: ${err.message}`);
  }
}

async function markLatestRunStopped(status = null, reason = '') {
  if (!jobState) return;
  const history = await jobHistoryPromise;
  if (status) history.updateRunHistoryFromStatus(jobState, { ...status, state: 'STOPPED' });
  else history.finishLatestRun(jobState, 'stopped', reason);
  const run = history.latestRun(jobState);
  if (run && !run.reason) run.reason = reason;
  await saveJobQuietly().catch((err) => appendRunLog(`Run history save failed: ${err.message}`));
  renderHistoryPanels();
}

async function syncRunHistoryFromStatus(status) {
  if (!jobState || !status?.state) return;
  const terminal = status.state === 'COMPLETED' || status.state === 'STOPPED' || status.state === 'ERROR';
  if (!terminal) return;
  const history = await jobHistoryPromise;
  const run = history.latestRun(jobState);
  if (!run || run.endedAt) return;
  history.updateRunHistoryFromStatus(jobState, status);
  await saveJobQuietly().catch((err) => appendRunLog(`Run history save failed: ${err.message}`));
  renderHistoryPanels();
}

function ensureJobState() {
  if (!jobState) jobState = newJobState();
  jobState.gcodePath = filePath;
  jobState.sourceGcodePath = jobState.sourceGcodePath || filePath;
  jobState.jobPath = jobPathFor(filePath);
  ensureActiveRunShape(jobState);
  if (!jobState.startMode) jobState.startMode = 'apply_current_position_as_work_zero';
  if (jobState.safeStartZ === undefined || jobState.safeStartZ === null) jobState.safeStartZ = Number(safeZInput?.value) || 15;
  if (!jobState.startChecklist) jobState.startChecklist = defaultRunChecklistState();
  if (jobState.allowedWorkspaceCommands !== true) jobState.allowedWorkspaceCommands = false;
  if (startModeSelect) jobState.startMode = startModeSelect.value || jobState.startMode;
  if (runSafeStartZInput) jobState.safeStartZ = Math.max(0, Math.min(200, Number(runSafeStartZInput.value || jobState.safeStartZ || 15)));
  jobState.feedOverride = {
    ...currentFeedOverride(),
    updatedAt: jobState.feedOverride?.updatedAt || null,
    source: jobState.feedOverride?.source || 'user',
  };
  jobState.startChecklist = runChecklistState();
  jobState.preview = previewSummary();
  jobState.dryRun = dryRunSummary();
  jobState.placement = currentPlacementState();
  ensureHistoryShape(jobState);
  jobState.updatedAt = nowIso();
  return jobState;
}

function ensureActiveRunShape(job) {
  if (!job) return;
  const now = nowIso();
  job.sourceGcodePath = job.sourceGcodePath || filePath;
  if (!job.activeRun?.path) {
    job.activeRun = {
      mode: 'source',
      path: job.sourceGcodePath,
      reason: 'identity-placement',
      updatedAt: now,
      selectedAt: now,
      selectedBy: 'default',
      sourceFingerprint: '',
      generatedFingerprint: '',
      transformFingerprint: '',
    };
  }
  if (!job.generatedValidation) {
    job.generatedValidation = {
      status: 'unknown',
      validatedAt: null,
      sourceFingerprint: '',
      generatedFingerprint: '',
      transformFingerprint: '',
      warnings: [],
      errors: [],
      bounds: null,
      feed: null,
      estimate: null,
    };
  }
}

function currentRunPath() {
  return jobActiveRunModule?.getExecutionPath
    ? jobActiveRunModule.getExecutionPath(jobState || { gcodePath: filePath, sourceGcodePath: filePath, activeRun: { path: activeRunPath, mode: activeRunMode } })
    : (jobState?.activeRun?.path || activeRunPath || filePath);
}

function currentRunMode() {
  return jobActiveRunModule?.getActiveRun
    ? jobActiveRunModule.getActiveRun(jobState || { gcodePath: filePath, sourceGcodePath: filePath, activeRun: { path: activeRunPath, mode: activeRunMode } }).mode
    : (jobState?.activeRun?.mode || activeRunMode || 'source');
}

function currentRunLabel() {
  return currentRunMode() === 'generated' ? 'Generated transformed run file' : 'Original source G-code';
}

async function placementRequiresGenerated(placement = currentPlacementState()) {
  const active = await jobActiveRunPromise;
  return active.desiredRunModeForPlacement(placement) === 'generated';
}

function activeRunBlockers() {
  if (!jobState) return ['Job metadata is not loaded.'];
  const result = jobActiveRunModule?.assertCanUseActiveRunForExecution
    ? jobActiveRunModule.assertCanUseActiveRunForExecution(jobState)
    : null;
  if (result) return result.ok ? [] : result.reasons.map((item) => item.message);

  const blockers = [];
  const validation = jobState?.generatedValidation || {};
  const active = jobState?.activeRun || {};
  if (active.mode === 'generated') {
    if (!active.path) blockers.push('Generated run path is missing.');
    if (validation.status !== 'valid' || jobState?.placement?.dirty) {
      blockers.push('Placement is transformed, but generated run file is not valid. Update Run File before dry run or cutting.');
    }
  }
  return blockers;
}

function currentPlacementState() {
  const previous = jobState?.placement || {};
  return {
    ...defaultPlacementState(),
    ...previous,
    rotationDeg: Number(placementRotationInput?.value ?? previous.rotationDeg ?? 0) || 0,
    originAnchor: 'rawBoundsLowerLeft',
    placementBoundsMode: 'rawTravelBounds',
    normalizeToOrigin: true,
  };
}

function applyPlacementToInputs(placement = {}) {
  const next = { ...defaultPlacementState(), ...placement };
  if (placementRotationInput) placementRotationInput.value = Number(next.rotationDeg || 0);
}

function ensureHistoryShape(job) {
  if (!job) return null;
  if (!Array.isArray(job.zeroHistory)) job.zeroHistory = [];
  if (!Array.isArray(job.runHistory)) job.runHistory = [];
  if (!Object.prototype.hasOwnProperty.call(job, 'activeWorkZeroId')) job.activeWorkZeroId = null;
  if (!Object.prototype.hasOwnProperty.call(job, 'activeZZeroId')) job.activeZZeroId = null;
  return job;
}

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function zeroTitle(zero) {
  if (!zero) return '-';
  const type = zero.type === 'zZero' ? 'Z Zero' : 'Work Zero';
  return `${type}${zero.label ? ` - ${zero.label}` : ''}`;
}

function activeZero(type) {
  ensureHistoryShape(jobState);
  const id = type === 'zZero' ? jobState?.activeZZeroId : jobState?.activeWorkZeroId;
  return jobState?.zeroHistory?.find((zero) => zero.id === id && zero.type === type) || null;
}

function latestRunEntry() {
  ensureHistoryShape(jobState);
  return jobState?.runHistory?.[jobState.runHistory.length - 1] || null;
}

async function saveJobQuietly() {
  const job = ensureJobState();
  await uploadJobJson(job);
  jobExists = true;
}

function renderHistoryPanels() {
  renderZeroHistoryPanel();
  renderRunHistoryPanel();
}

async function selectHistoryZero(id, type) {
  const history = await jobHistoryPromise;
  const job = ensureJobState();
  const changed = type === 'zZero' ? history.markActiveZZero(job, id) : history.markActiveZero(job, id);
  if (!changed) {
    setJobResult('Could not select that zero history entry.', true);
    return;
  }
  await saveJobQuietly();
  setJobResult('Selected previous zero in job metadata only. No movement or G92 was sent.');
  renderJobPanel();
  renderToolZeroPanel();
  renderHistoryPanels();
  renderArmPanel();
  draw();
}

async function labelHistoryZero(id) {
  const job = ensureJobState();
  const zero = job.zeroHistory.find((entry) => entry.id === id);
  if (!zero) return;
  const label = prompt('Zero label', zero.label || '');
  if (label === null) return;
  zero.label = label.trim();
  await saveJobQuietly();
  renderHistoryPanels();
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
  messages.push(...activeRunBlockers());
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
  messages.push(...activeRunBlockers());
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
      <dt>Run file</dt><dd>${html(currentRunPath() || '-')}</dd>
      <dt>Run mode</dt><dd>${html(currentRunLabel())}</dd>
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
  const workZeroEntry = activeZero('workZero');
  const zZeroEntry = activeZero('zZero');
  const run = latestRunEntry();
  const b = preview.legacyBounds || preview.bounds?.placementBounds || preview.bounds?.cutBounds || preview.bounds?.rawTravelBounds || preview.bounds;
  jobSummaryEl.innerHTML = `
    <dl>
      <dt>Source G-code</dt><dd>${html(filePath || '-')}</dd>
      <dt>Active run file</dt><dd>${html(currentRunPath() || '-')}</dd>
      <dt>Active mode</dt><dd>${html(currentRunLabel())}</dd>
      <dt>Generated status</dt><dd>${html(jobState?.generatedValidation?.status || 'unknown')}</dd>
      <dt>Job JSON</dt><dd>${path}</dd>
      <dt>Job file</dt><dd>${jobExists ? 'Exists' : 'No job file yet'}</dd>
      <dt>Start mode</dt><dd>${jobState?.startMode || 'apply_current_position_as_work_zero'}</dd>
      <dt>Workspace override</dt><dd>${jobState?.allowedWorkspaceCommands ? 'Non-default workspaces allowed' : 'Only G54 allowed by default'}</dd>
      <dt>Bounds</dt><dd>${hasBounds(b) ? `X ${b.xMin.toFixed(2)} .. ${b.xMax.toFixed(2)}, Y ${b.yMin.toFixed(2)} .. ${b.yMax.toFixed(2)}, Z ${b.zMin.toFixed(2)} .. ${b.zMax.toFixed(2)}` : '-'}</dd>
      <dt>Warnings</dt><dd>${preview.warnings.length}</dd>
      <dt>Active work zero</dt><dd>${workZeroEntry ? `${workZeroEntry.capturedAt || '-'} (${workZeroEntry.id})` : '-'}</dd>
      <dt>Active Z zero</dt><dd>${zZeroEntry ? `${zZeroEntry.capturedAt || '-'} (${zZeroEntry.id})` : '-'}</dd>
      <dt>Last run</dt><dd>${run ? `${run.state || '-'} at ${run.startedAt || '-'}` : '-'}</dd>
      <dt>Before G92</dt><dd>${formatCapture(workZero?.beforeG92)}</dd>
      <dt>After G92</dt><dd>${formatCapture(workZero?.afterG92)}</dd>
    </dl>
  `;
  renderHistoryPanels();
  renderFeedOverridePanel();
  renderReadiness();
}

function zeroUsageStatus(zero) {
  if (!zero || !jobState) return 'Unused';
  if ((zero.type === 'workZero' && zero.id === jobState.activeWorkZeroId) ||
      (zero.type === 'zZero' && zero.id === jobState.activeZZeroId)) {
    return 'Current active zero';
  }
  const ids = Array.isArray(zero.usedByRuns) ? zero.usedByRuns : [];
  const states = ids.map((id) => jobState.runHistory?.find((run) => run.id === id)?.state).filter(Boolean);
  if (states.includes('error')) return 'Used by error run';
  if (states.includes('stopped') || states.includes('interrupted')) return 'Used by stopped/interrupted run';
  if (states.includes('completed')) return 'Used by completed run';
  if (states.length) return 'Used by run';
  return 'Unused';
}

function renderZeroHistoryPanel() {
  if (!zeroHistorySummaryEl) return;
  ensureHistoryShape(jobState);
  zeroHistorySummaryEl.textContent = '';
  const entries = [...(jobState?.zeroHistory || [])].reverse();
  if (!entries.length) {
    zeroHistorySummaryEl.textContent = 'No zero history yet. Setting Work Zero or Z Zero will create an audit entry.';
    return;
  }

  entries.forEach((zero) => {
    const article = document.createElement('article');
    article.className = 'history-entry';
    const active = (zero.type === 'workZero' && zero.id === jobState.activeWorkZeroId) ||
      (zero.type === 'zZero' && zero.id === jobState.activeZZeroId);
    article.innerHTML = `
      <div class="history-head">
        <strong>${html(zeroTitle(zero))}</strong>
        <span class="status-badge ${active ? 'active-badge' : ''}">${html(zeroUsageStatus(zero))}</span>
      </div>
      <dl>
        <dt>Captured</dt><dd>${html(zero.capturedAt || '-')}</dd>
        <dt>Method</dt><dd>${html(zero.method || '-')}</dd>
        <dt>File</dt><dd>${html(zero.gcodePath || '-')}</dd>
        <dt>After G92</dt><dd>X ${fmtValue(zero.positionAfter?.x)} Y ${fmtValue(zero.positionAfter?.y)} Z ${fmtValue(zero.positionAfter?.z)}</dd>
        <dt>Used by runs</dt><dd>${Array.isArray(zero.usedByRuns) ? zero.usedByRuns.length : 0}</dd>
      </dl>
      <pre class="history-details" hidden>${html(JSON.stringify(zero, null, 2))}</pre>
    `;
    const actions = document.createElement('div');
    actions.className = 'job-actions compact-actions';
    const details = document.createElement('button');
    details.type = 'button';
    details.textContent = 'View details';
    details.addEventListener('click', () => {
      const pre = article.querySelector('.history-details');
      pre.hidden = !pre.hidden;
    });
    actions.append(details);

    const select = document.createElement('button');
    select.type = 'button';
    select.textContent = zero.type === 'zZero' ? 'Mark active Z zero' : 'Mark active work zero';
    select.disabled = active;
    select.addEventListener('click', () => selectHistoryZero(zero.id, zero.type).catch((err) => setJobResult(err.message, true)));
    actions.append(select);

    const label = document.createElement('button');
    label.type = 'button';
    label.textContent = 'Rename';
    label.addEventListener('click', () => labelHistoryZero(zero.id).catch((err) => setJobResult(err.message, true)));
    actions.append(label);
    article.append(actions);
    zeroHistorySummaryEl.append(article);
  });
}

function renderRunHistoryPanel() {
  if (!runHistorySummaryEl) return;
  ensureHistoryShape(jobState);
  runHistorySummaryEl.textContent = '';
  const runs = [...(jobState?.runHistory || [])].reverse();
  if (!runs.length) {
    runHistorySummaryEl.textContent = 'No run history yet. Starting a job will create a run audit entry.';
    return;
  }

  runs.forEach((run) => {
    const article = document.createElement('article');
    article.className = 'history-entry';
    const duration = run.actualDurationSeconds === null || run.actualDurationSeconds === undefined ? '-' : `${run.actualDurationSeconds}s`;
    const future = run.state === 'stopped' || run.state === 'interrupted'
      ? '<p class="warning">Future: resume from safe point. Resume execution is not implemented yet.</p>'
      : '';
    article.innerHTML = `
      <div class="history-head">
        <strong>${html(run.state || 'started')}</strong>
        <span class="status-badge">${html(run.id || '-')}</span>
      </div>
      <dl>
        <dt>Started</dt><dd>${html(run.startedAt || '-')}</dd>
        <dt>Ended</dt><dd>${html(run.endedAt || '-')}</dd>
        <dt>Duration</dt><dd>${html(duration)}</dd>
        <dt>Work zero</dt><dd>${html(run.zeroId || '-')}</dd>
        <dt>Z zero</dt><dd>${html(run.zZeroId || '-')}</dd>
        <dt>Feed</dt><dd>${html(run.feedOverrideStart ?? '-')}% -> ${html(run.feedOverrideLast ?? '-')}%</dd>
        <dt>Line</dt><dd>${html(run.currentLineNumber ?? run.lastSentLineNumber ?? '-')}</dd>
        <dt>Last command</dt><dd>${html(run.lastSentCommand || '-')}</dd>
        <dt>Reason</dt><dd>${html(run.reason || '-')}</dd>
      </dl>
      ${future}
    `;
    runHistorySummaryEl.append(article);
  });
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
  refreshToolpathEstimateForFeed();
  if (parsed) renderStats();
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
  ensureActiveRunShape(jobState);
  ensureHistoryShape(jobState);
  applyPlacementToInputs(jobState.placement);
  if (jobState.dryRun) {
    if (jobState.dryRun.safeZ !== undefined) safeZInput.value = jobState.dryRun.safeZ;
    if (jobState.dryRun.margin !== undefined) traceMarginInput.value = jobState.dryRun.margin;
  }
  if (runSafeStartZInput) {
    runSafeStartZInput.value = jobState.safeStartZ ?? jobState.dryRun?.safeZ ?? safeZInput?.value ?? 15;
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
  await loadActiveRunPreview();
  refreshToolpathEstimateForFeed();
  if (parsed) renderStats();
  await updatePlacementPreview();
  renderJobPanel();
  renderToolZeroPanel();
  renderHistoryPanels();
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
  renderHistoryPanels();
  renderFeedOverridePanel();
  renderPreflight();
  renderArmPanel();
}

async function loadExistingJobJson() {
  try {
    const res = await fetch(`/api/download?path=${encodeURIComponent(jobPathFor(filePath))}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

async function parseRunText(text, path, mode) {
  const fingerprint = await computeGcodeFingerprint(text);
  const { toolpath, adapter } = await toolpathModulesPromise;
  const model = toolpath.parseGCodeToToolpath(text, {
    feedOverridePercent: currentFeedOverride().startPercent,
  });
  return {
    path,
    mode,
    text,
    fingerprint,
    model,
    parsed: adapter.adaptToolpathForPreview(model),
    summary: adapter.buildPreviewSummaryData(model, currentFeedOverride()),
  };
}

function applyActiveRunParse(run, options = {}) {
  const updateActive = options.updateActive !== false;
  activeRunPath = run.path;
  activeRunMode = run.mode;
  activeRunText = run.text;
  toolpathModel = run.model;
  parsed = run.parsed;
  previewSummaryData = run.summary;
  gcodeHashSha256 = run.fingerprint.sha256;
  gcodeFingerprint = run.fingerprint.value;
  gcodeFingerprintAlgorithm = run.fingerprint.algorithm;
  gcodeFingerprintWarning = run.fingerprint.warning;
  if (updateActive && jobState?.activeRun) {
    jobState.activeRun.path = run.path;
    jobState.activeRun.mode = run.mode;
    if (run.mode === 'source') jobState.activeRun.sourceFingerprint = run.fingerprint.value;
    else jobState.activeRun.generatedFingerprint = run.fingerprint.value;
  }
  pathEl.textContent = `${filePath} | Active: ${run.path}`;
  renderWorkbenchStatus();
}

async function validateGeneratedRunFromPath(path = jobState?.placement?.generatedRunPath || jobState?.generatedRunPath) {
  if (!path) return null;
  const active = await jobActiveRunPromise;
  const transform = await toolpathTransformPromise;
  let text = null;
  const res = await fetch(`/api/download?path=${encodeURIComponent(path)}`).catch(() => null);
  if (res?.ok) text = await res.text();
  const sourceFingerprint = sourceGcodeText ? (await computeGcodeFingerprint(sourceGcodeText)).value : '';
  const placement = transform.normalizePlacement(sourceToolpathModel || toolpathModel, currentPlacementState());
  const currentTransformFingerprint = transform.transformFingerprint(placement, sourceFingerprint);
  const currentPreview = transform.transformToolpath(sourceToolpathModel || toolpathModel, placement);
  const validation = active.validateGeneratedRun({
    text,
    generatedPath: path,
    sourceFingerprint,
    expectedSourceFingerprint: jobState?.placement?.sourceFingerprint || '',
    transformFingerprint: currentTransformFingerprint,
    expectedTransformFingerprint: jobState?.placement?.transformFingerprint || '',
    expectedGeneratedFingerprint: jobState?.generatedValidation?.generatedFingerprint || '',
    placementBounds: currentPreview.selectedTransformedBounds,
  });
  if (jobState) jobState.generatedValidation = validation;
  return validation;
}

async function loadActiveRunPreview() {
  const job = ensureJobState();
  const requestedPath = job.activeRun?.path || filePath;
  const requestedMode = job.activeRun?.mode || 'source';
  if (requestedMode === 'generated') {
    const validation = await validateGeneratedRunFromPath(requestedPath);
    if (validation?.status !== 'valid') {
      appendPlacementResult(`Generated run is ${validation?.status || 'unknown'}; showing source preview.`);
      const sourceRun = await parseRunText(sourceGcodeText, filePath, 'source');
      applyActiveRunParse({
        ...sourceRun,
        path: requestedPath,
        mode: 'generated',
      }, { updateActive: false });
      return;
    }
    const res = await fetch(`/api/download?path=${encodeURIComponent(requestedPath)}`);
    if (res.ok) {
      const generatedRun = await parseRunText(await res.text(), requestedPath, 'generated');
      applyActiveRunParse(generatedRun);
      return;
    }
  }
  const sourceRun = await parseRunText(sourceGcodeText, filePath, 'source');
  applyActiveRunParse(sourceRun);
}

async function refreshActiveRunUi() {
  await loadActiveRunPreview();
  if (jobState) jobState.preview = previewSummary();
  renderStats();
  refreshToolpathEstimateForFeed();
  await updatePlacementPreview();
  renderJobPanel();
  renderToolZeroPanel();
  renderFeedOverridePanel();
  renderPreflight();
  aircutCommands = [];
  aircutSafety = { ok: false, messages: [] };
  generateTraceCommands();
  renderArmPanel();
  draw();
}

async function selectGeneratedRunInUi() {
  const job = ensureJobState();
  const generatedPath = job.placement?.generatedRunPath || job.generatedRunPath;
  if (!generatedPath) {
    appendPlacementResult('No generated run file exists yet.');
    return;
  }
  const validation = await validateGeneratedRunFromPath(generatedPath);
  if (validation?.status !== 'valid') {
    appendPlacementResult(`Generated run cannot be selected: ${validation?.status || 'unknown'}`);
    (validation?.errors || []).forEach((message) => appendPlacementResult(message));
    renderPlacementPanel();
    return;
  }
  const active = await jobActiveRunPromise;
  if (!active.selectGeneratedRun(job, validation)) {
    appendPlacementResult('Generated run selection failed.');
    return;
  }
  await saveJobQuietly();
  appendPlacementResult(`Active run file is now ${generatedPath}. Review and re-arm before cutting.`);
  await refreshActiveRunUi();
}

async function selectSourceRunInUi() {
  const job = ensureJobState();
  if (job.placement?.dirty && !confirm('Reset placement changes and use the original source file?')) return;
  suppressPlacementChange = true;
  applyPlacementToInputs(defaultPlacementState());
  suppressPlacementChange = false;
  const active = await jobActiveRunPromise;
  job.placement = {
    ...defaultPlacementState(),
    dirty: false,
    generatedRunPath: job.placement?.generatedRunPath || job.generatedRunPath || null,
    generatedRunBounds: job.placement?.generatedRunBounds || null,
    sourceFingerprint: job.placement?.sourceFingerprint || '',
    transformFingerprint: '',
  };
  active.selectSourceRun(job, filePath);
  await saveJobQuietly();
  appendPlacementResult('Active run file is now the original source G-code. Review and re-arm before cutting.');
  await refreshActiveRunUi();
}

async function uploadJobJson(job) {
  const json = JSON.stringify(job, null, 2);
  const file = new File([json], basename(job.jobPath), { type: 'application/json' });
  const form = new FormData();
  form.append('path', '/jobs');
  form.append('file', file);
  const res = await fetch('/api/upload?overwrite=true', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Preview metadata save failed');
}

async function syncPreviewMetadata() {
  if (!toolpathModel || !previewSummaryData) return;
  try {
    const { adapter } = await toolpathModulesPromise;
    const existing = await loadExistingJobJson();
    const base = existing || {
      schemaVersion: 2,
      createdAt: nowIso(),
      gcodePath: filePath,
      jobPath: jobPathFor(filePath),
    };
    const merged = adapter.mergePreviewIntoJob({
      ...base,
      updatedAt: nowIso(),
      gcodePath: filePath,
      jobPath: jobPathFor(filePath),
    }, toolpathModel, base.thumbnailPath || null);
    await uploadJobJson(merged);
    jobExists = true;
    if (jobResultEl && !jobResultEl.textContent) setJobResult('Preview metadata saved to job JSON');
  } catch (err) {
    if (jobResultEl) setJobResult(`Preview metadata was not saved: ${err.message}`, true);
  }
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
    activeRunMode: currentRunMode(),
    activeRunPath: currentRunPath(),
    activeRunFingerprint: gcodeFingerprint,
    sourceFingerprint: job.activeRun?.sourceFingerprint || job.placement?.sourceFingerprint || '',
    generatedFingerprint: job.activeRun?.generatedFingerprint || job.generatedValidation?.generatedFingerprint || '',
    transformFingerprint: job.activeRun?.transformFingerprint || job.placement?.transformFingerprint || '',
    activeRun: { ...(job.activeRun || {}) },
    generatedValidation: job.generatedValidation ? { ...job.generatedValidation } : null,
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
  const history = await jobHistoryPromise;
  history.appendZZeroHistory(ensureJobState(), {
    before,
    after,
    capturedAt: toolZero.capturedAt,
  });
  markArmStaleForZZero();
  setToolZeroResult(`Z zero set. After G92 Z0: ${formatCapture(after)}`);
  renderToolZeroPanel();
  renderHistoryPanels();
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
  const history = await jobHistoryPromise;
  history.appendWorkZeroHistory(job, {
    before,
    after,
    capturedAt: job.workZero.capturedAt,
  });
  setJobResult(`Work zero set. After G92: ${formatCapture(after)}`);
  renderJobPanel();
  renderToolZeroPanel();
  renderHistoryPanels();
  renderPreflight();
  renderArmPanel();
  generateTraceCommands();
  draw();
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

function addLinear(segments, bounds, from, to, rapid, feedrate = null, lineNumber = null) {
  updateBounds(bounds, from);
  updateBounds(bounds, to);
  if (from.x !== to.x || from.y !== to.y) {
    segments.push({ from: { ...from }, to: { ...to }, rapid, feedrate, lineNumber });
  }
}

function addArc(segments, bounds, from, to, words, scale, clockwise, warnings, feedrate, lineNumber) {
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
    addLinear(segments, bounds, prev, next, false, feedrate, lineNumber);
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
      addLinear(segments, bounds, pos, next, motion === 0, motion === 1 ? feedrate : null, parsedLines);
    } else if (motion === 2 || motion === 3) {
      if (addArc(segments, bounds, pos, next, words, unitsScale, motion === 2, warnings, feedrate, parsedLines)) {
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

function unionBounds(...items) {
  const valid = items.filter(hasBounds);
  if (!valid.length) return null;
  return valid.reduce((out, item) => ({
    xMin: Math.min(out.xMin, item.xMin),
    xMax: Math.max(out.xMax, item.xMax),
    yMin: Math.min(out.yMin, item.yMin),
    yMax: Math.max(out.yMax, item.yMax),
  }), { ...valid[0] });
}

function workbenchViewBounds(mode) {
  if (mode === 'table') return MACHINE;
  if (mode === 'job') return canvasTableBounds(sourceParsed?.bounds || parsed?.bounds);
  if (mode === 'zero') {
    const active = canvasTableBounds(parsed?.bounds);
    const zero = canvasWorkZeroPosition() || { x: 0, y: 0 };
    const span = active && hasBounds(active)
      ? Math.max(40, Math.min(400, Math.max(active.xMax - active.xMin, active.yMax - active.yMin) * 0.35))
      : 100;
    return { xMin: zero.x - span / 2, xMax: zero.x + span / 2, yMin: zero.y - span / 2, yMax: zero.y + span / 2 };
  }
  return unionBounds(canvasTableBounds(parsed?.bounds), canvasTableBounds(transformedPreview?.generatedRunBounds)) ||
    canvasTableBounds(parsed?.bounds);
}

function strokeBounds(ctx2d, bounds, px, py, color, dash = []) {
  if (!hasBounds(bounds)) return;
  ctx2d.save();
  ctx2d.strokeStyle = color;
  ctx2d.lineWidth = 1;
  ctx2d.setLineDash(dash);
  ctx2d.strokeRect(px(bounds.xMin), py(bounds.yMax), px(bounds.xMax) - px(bounds.xMin), py(bounds.yMin) - py(bounds.yMax));
  ctx2d.restore();
}

function drawSegments(segments, px, py, options = {}) {
  (segments || []).forEach((segment) => {
    const rapid = segment.rapid || segment.type === 'rapid' || segment.type === 'retract';
    if (rapid && options.showTravel === false) return;
    ctx.beginPath();
    ctx.moveTo(px(segment.from.x), py(segment.from.y));
    const points = segment.points?.length ? segment.points : [segment.to];
    points.forEach((point) => ctx.lineTo(px(point.x), py(point.y)));
    ctx.strokeStyle = rapid ? (options.travelColor || '#59707d') : (options.cutColor || '#65d28e');
    ctx.globalAlpha = options.alpha ?? 1;
    ctx.lineWidth = rapid ? (options.travelWidth || 0.9) : (options.cutWidth || 1.7);
    ctx.setLineDash(rapid ? [4, 4] : []);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

function themeColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function drawMachineGrid(ctx2d, options) {
  const { px, py, scale, view, panX, panY, width, height, color, textColor, workZero } = options;
  const step = workbenchUiModule?.adaptiveGridStep(scale, 74) || 100;
  const originX = (width - (view.xMax - view.xMin) * scale) / 2;
  const originY = (height - (view.yMax - view.yMin) * scale) / 2;
  const worldX = (screenX) => (screenX - originX - panX) / scale + view.xMin;
  const worldY = (screenY) => (height + panY - screenY - originY) / scale + view.yMin;
  const visible = {
    xMin: Math.max(MACHINE.xMin, worldX(0)),
    xMax: Math.min(MACHINE.xMax, worldX(width)),
    yMin: Math.max(MACHINE.yMin, worldY(height)),
    yMax: Math.min(MACHINE.yMax, worldY(0)),
  };
  if (visible.xMin > visible.xMax || visible.yMin > visible.yMax) return;

  const left = Math.min(px(MACHINE.xMin), px(MACHINE.xMax));
  const right = Math.max(px(MACHINE.xMin), px(MACHINE.xMax));
  const top = Math.min(py(MACHINE.yMin), py(MACHINE.yMax));
  const bottom = Math.max(py(MACHINE.yMin), py(MACHINE.yMax));
  const xStart = Math.ceil(visible.xMin / step) * step;
  const yStart = Math.ceil(visible.yMin / step) * step;

  ctx2d.save();
  ctx2d.beginPath();
  ctx2d.rect(left, top, right - left, bottom - top);
  ctx2d.clip();
  ctx2d.strokeStyle = color;
  ctx2d.lineWidth = 1;
  ctx2d.setLineDash([]);
  ctx2d.beginPath();
  for (let x = xStart; x <= visible.xMax + step * 0.001; x += step) {
    ctx2d.moveTo(px(x), top);
    ctx2d.lineTo(px(x), bottom);
  }
  for (let y = yStart; y <= visible.yMax + step * 0.001; y += step) {
    ctx2d.moveTo(left, py(y));
    ctx2d.lineTo(right, py(y));
  }
  ctx2d.stroke();
  ctx2d.restore();

  ctx2d.save();
  ctx2d.fillStyle = textColor;
  ctx2d.font = '600 10px system-ui, sans-serif';
  ctx2d.textBaseline = 'top';
  const xLabelY = Math.min(height - 84, Math.max(4, bottom - 15));
  const yLabelX = Math.min(width - 48, Math.max(4, left + 5));
  ctx2d.textAlign = 'center';
  for (let x = xStart; x <= visible.xMax + step * 0.001; x += step) {
    const screenX = px(x);
    const label = workbenchUiModule?.workCoordinateAtMachine(x, workZero?.x) ?? x;
    if (screenX >= 18 && screenX <= width - 18) ctx2d.fillText(`${Math.round(label)}`, screenX, xLabelY);
  }
  ctx2d.textAlign = 'left';
  ctx2d.textBaseline = 'middle';
  for (let y = yStart; y <= visible.yMax + step * 0.001; y += step) {
    const screenY = py(y);
    const label = workbenchUiModule?.workCoordinateAtMachine(y, workZero?.y) ?? y;
    if (screenY >= 12 && screenY <= height - 82) ctx2d.fillText(`${Math.round(label)}`, yLabelX, screenY);
  }
  if (top >= 0 && top < height - 80) {
    ctx2d.textBaseline = 'top';
    ctx2d.fillText('mm', yLabelX, Math.max(4, top + 5));
  }
  ctx2d.restore();
}

function hasBounds(bounds) {
  return bounds && Number.isFinite(bounds.xMin) && Number.isFinite(bounds.xMax) &&
    Number.isFinite(bounds.yMin) && Number.isFinite(bounds.yMax);
}

function boundsText(bounds) {
  if (!hasBounds(bounds)) return '-';
  return `X ${bounds.xMin.toFixed(2)} .. ${bounds.xMax.toFixed(2)}, Y ${bounds.yMin.toFixed(2)} .. ${bounds.yMax.toFixed(2)}, Z ${bounds.zMin.toFixed(2)} .. ${bounds.zMax.toFixed(2)} mm`;
}

function estimateText(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '-';
  if (value < 60) return `~${Math.max(1, Math.round(value))} sec`;
  return `~${Math.max(1, Math.round(value / 60))} min`;
}

function draw() {
  const visibleToolPosition = canvasTablePosition(canvasToolPosition());
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

  const workbenchView = workbenchController?.getView() || { zoom: 1, panX: 0, panY: 0, fitMode: 'active' };
  const layers = workbenchController?.getLayers() || {
    path: true, bounds: true, zero: true, travel: true, source: true, generated: true, table: true,
  };
  const viewBounds = workbenchViewBounds(workbenchView.fitMode) || parsed.bounds;
  const view = fitBounds(viewBounds);
  const sx = w / (view.xMax - view.xMin);
  const sy = h / (view.yMax - view.yMin);
  const scale = Math.min(sx, sy) * workbenchView.zoom;
  const projection = workbenchUiModule?.createCanvasProjection({
    width: w,
    height: h,
    bounds: view,
    scale,
    panX: workbenchView.panX,
    panY: workbenchView.panY,
  }) || {
    x: (x) => (w - (view.xMax - view.xMin) * scale) / 2 + (x - view.xMin) * scale + workbenchView.panX,
    y: (y) => h - ((h - (view.yMax - view.yMin) * scale) / 2 + (y - view.yMin) * scale) + workbenchView.panY,
  };
  const px = projection.x;
  const py = projection.y;
  const workZero = canvasWorkZeroPosition();
  const jobPx = (x) => px(x + (workZero?.x || 0));
  const jobPy = (y) => py(y + (workZero?.y || 0));

  const colors = {
    accent: themeColor('--cnc-accent', '#2d80c7'),
    source: themeColor('--cnc-path-source', '#4c8f69'),
    generated: themeColor('--cnc-path-generated', '#ffd166'),
    travel: themeColor('--cnc-path-travel', '#2f86d1'),
    cut: themeColor('--cnc-path-cut', '#65d28e'),
    rawBounds: themeColor('--cnc-bounds-raw', '#9fb1bf'),
    cutBounds: themeColor('--cnc-bounds-cut', '#3fc475'),
    placementBounds: themeColor('--cnc-bounds-placement', '#ffd166'),
    zero: themeColor('--cnc-zero', '#ffd166'),
    position: themeColor('--cnc-current-position', '#62b0ff'),
    grid: themeColor('--cnc-table-grid', 'rgba(98, 176, 255, 0.13)'),
    gridText: themeColor('--cnc-table-grid-text', 'rgba(185, 207, 220, 0.72)'),
  };
  if (layers.table) {
    drawMachineGrid(ctx, {
      px, py, scale, view,
      panX: workbenchView.panX,
      panY: workbenchView.panY,
      width: w,
      height: h,
      color: colors.grid,
      textColor: colors.gridText,
      workZero,
    });
    strokeBounds(ctx, MACHINE, px, py, colors.accent);
  }
  if (layers.bounds) {
    strokeBounds(ctx, sourceToolpathModel?.bounds?.rawTravelBounds, jobPx, jobPy, colors.rawBounds, [7, 5]);
    strokeBounds(ctx, sourceToolpathModel?.bounds?.cutBounds, jobPx, jobPy, colors.cutBounds, [3, 3]);
    strokeBounds(ctx, transformedPreview?.generatedRunBounds, jobPx, jobPy, colors.placementBounds, [8, 4]);
    const dryRunComplete = jobState?.dryRun?.lastBoundingBoxTraceStatus === 'complete' ||
      jobState?.dryRun?.lastAircutStatus === 'complete';
    if (dryRunComplete) {
      const margin = Number(jobState?.dryRun?.margin || 0);
      const active = parsed?.bounds;
      if (hasBounds(active)) {
        strokeBounds(ctx, {
          xMin: active.xMin - margin,
          xMax: active.xMax + margin,
          yMin: active.yMin - margin,
          yMax: active.yMax + margin,
        }, jobPx, jobPy, colors.placementBounds, [10, 4]);
      }
    }
  }
  if (layers.source && sourceParsed?.segments?.length) {
    drawSegments(sourceParsed.segments, jobPx, jobPy, {
      showTravel: layers.travel,
      cutColor: colors.source,
      travelColor: colors.rawBounds,
      alpha: currentRunMode() === 'source' ? 0.62 : 0.34,
      cutWidth: 1.2,
    });
  }
  if (layers.path) {
    drawSegments(parsed.segments, jobPx, jobPy, {
      showTravel: layers.travel,
      cutColor: currentRunMode() === 'generated' ? colors.generated : colors.cut,
      travelColor: colors.travel,
    });
  }
  if (layers.generated && transformedPreview?.segments?.length) {
    drawSegments(transformedPreview.segments, jobPx, jobPy, {
      showTravel: layers.travel,
      cutColor: colors.generated,
      travelColor: colors.travel,
      alpha: 0.92,
      cutWidth: 2,
    });
  }
  if (layers.zero) {
    ctx.save();
    if (layers.table) {
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px(0) - 6, py(0));
      ctx.lineTo(px(0) + 6, py(0));
      ctx.moveTo(px(0), py(0) - 6);
      ctx.lineTo(px(0), py(0) + 6);
      ctx.stroke();
    }
    if (workZero) {
      const zeroX = px(workZero.x);
      const zeroY = py(workZero.y);
      ctx.strokeStyle = colors.zero;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(zeroX - 9, zeroY);
      ctx.lineTo(zeroX + 9, zeroY);
      ctx.moveTo(zeroX, zeroY - 9);
      ctx.lineTo(zeroX, zeroY + 9);
      ctx.stroke();
      ctx.fillStyle = colors.zero;
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const labelY = zeroY > h - 90 ? zeroY - 24 : zeroY + 9;
      ctx.fillText('WORK ZERO', Math.min(zeroX + 8, w - 76), labelY);
    }
    ctx.restore();
  }
  if (Number.isFinite(visibleToolPosition?.x) && Number.isFinite(visibleToolPosition?.y)) {
    const toolX = px(visibleToolPosition.x);
    const toolY = py(visibleToolPosition.y);
    ctx.save();
    ctx.fillStyle = colors.position;
    ctx.beginPath();
    ctx.arc(toolX, toolY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colors.position;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(toolX, toolY, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function renderStats() {
  const summary = previewSummaryData;
  const b = parsed.bounds;
  const feeds = parsed.analysis.feeds;
  const effective = effectiveFeedRange();
  const feed = summary?.feed || {
    min: feeds.minFeed,
    max: feeds.maxFeed,
    commandCount: feeds.feedCommandCount,
    rapidDistance: null,
    cuttingDistance: null,
  };
  const estimate = summary?.estimate || {};
  const effectiveEstimate = summary?.effectiveEstimateSeconds || estimate.effectiveSecondsWithOverride;
  statsEl.innerHTML = `
    <dl>
      <dt>Raw travel bounds</dt><dd>${boundsText(summary?.rawTravelBounds || b)}</dd>
      <dt>Cut bounds</dt><dd>${boundsText(summary?.cutBounds)}</dd>
      <dt>Placement bounds</dt><dd>${boundsText(summary?.placementBounds)}</dd>
      <dt>Feed commands</dt><dd>${feed.commandCount ?? feeds.feedCommandCount}</dd>
      <dt>G-code feed</dt><dd>${feed.commandCount ? `F${fmtMm(feed.min)} .. F${fmtMm(feed.max)}` : '-'}</dd>
      <dt>Effective feed</dt><dd>${effective ? `F${fmtMm(effective.min)} .. F${fmtMm(effective.max)} at ${effective.percent}%` : '-'}</dd>
      <dt>Rapid distance</dt><dd>${Number.isFinite(feed.rapidDistance) ? `${fmtMm(feed.rapidDistance)} mm` : '-'}</dd>
      <dt>Cutting distance</dt><dd>${Number.isFinite(feed.cuttingDistance) ? `${fmtMm(feed.cuttingDistance)} mm` : '-'}</dd>
      <dt>Estimated time</dt><dd>${estimateText(effectiveEstimate || estimate.nominalSeconds)}</dd>
      <dt>Estimate confidence</dt><dd>${estimate.confidence || '-'}</dd>
      <dt>Parsed lines</dt><dd>${parsed.parsedLines}</dd>
      <dt>Segments</dt><dd>${parsed.segments.length}</dd>
    </dl>
    <p class="form-hint">Estimate is approximate. Feed override changes movement speed only. It does not change router RPM.</p>
  `;
  (summary?.infos || []).forEach((message) => {
    const info = document.createElement('p');
    info.className = 'warning';
    info.textContent = message;
    statsEl.append(info);
  });

  warningsEl.textContent = '';
  const groups = summary?.warningGroups || {};
  const hasGroupedWarnings = Object.values(groups).some((items) => items.length);
  if (!parsed.warnings.length && !hasGroupedWarnings) {
    const ok = document.createElement('p');
    ok.className = 'warning-ok';
    ok.textContent = 'No preview warnings.';
    warningsEl.append(ok);
    return;
  }

  const labels = {
    workspace: 'Workspace',
    unsupported: 'Unsupported commands',
    transformSensitive: 'Transform-sensitive',
    arcs: 'Arc approximation',
    coordinates: 'Coordinates',
    general: 'General',
  };
  Object.entries(groups).forEach(([key, items]) => {
    if (!items.length) return;
    const group = document.createElement('div');
    group.className = 'warning-group';
    group.innerHTML = `<h3>${labels[key] || key}</h3>`;
    items.forEach((warning) => {
      const item = document.createElement('div');
      item.className = key === 'workspace' ? 'warning-info' : 'warning-item';
      item.textContent = warning;
      group.append(item);
    });
    warningsEl.append(group);
  });
}

function placementBoundsText(bounds) {
  if (!hasBounds(bounds)) return '-';
  return `X ${bounds.xMin.toFixed(2)} .. ${bounds.xMax.toFixed(2)}, Y ${bounds.yMin.toFixed(2)} .. ${bounds.yMax.toFixed(2)}, Z ${bounds.zMin.toFixed(2)} .. ${bounds.zMax.toFixed(2)} mm`;
}

async function updatePlacementPreview(options = {}) {
  const placementModel = sourceToolpathModel || toolpathModel;
  if (!placementModel) return null;
  const transform = await toolpathTransformPromise;
  const placement = transform.normalizePlacement(placementModel, currentPlacementState());
  applyPlacementToInputs(placement);
  transformedPreview = Math.abs(placement.rotationDeg) < 0.0001
    ? null
    : transform.transformToolpath(placementModel, placement);
  const preview = transformedPreview || transform.transformToolpath(placementModel, placement);
  placementWarnings = [
    ...preview.warnings,
    ...transform.transformSafety(placementModel).blockers,
  ];
  renderPlacementPanel();
  draw();
  if (options.userChange) {
    await markPlacementChangedAndScheduleUpdate();
  }
  return preview;
}

async function renderPlacementPanel() {
  if (!placementSummaryEl) return;
  const placementModel = sourceToolpathModel || toolpathModel;
  if (!placementModel) {
    placementSummaryEl.textContent = 'Load a preview to configure placement.';
    return;
  }
  const transform = await toolpathTransformPromise;
  const placement = transform.normalizePlacement(placementModel, currentPlacementState());
  const safety = transform.transformSafety(placementModel);
  const preview = transformedPreview || transform.transformToolpath(placementModel, placement);
  const generated = jobState?.placement?.generatedRunPath || placement.generatedRunPath || '-';
  const validation = jobState?.generatedValidation || {};
  const placementDirty = Boolean(jobState?.placement?.dirty);
  const generatedReady = currentRunMode() === 'generated' && validation.status === 'valid' && !placementDirty;
  const generatedStatus = placementDirty
    ? 'stale'
    : validation.status === 'pending'
      ? 'updating'
      : validation.status || 'unknown';
  if (useGeneratedRunButton) {
    useGeneratedRunButton.textContent = generatedReady ? 'Run File Up To Date' : 'Update Run File';
    useGeneratedRunButton.disabled = generatedReady;
  }
  if (useSourceRunButton) useSourceRunButton.disabled = currentRunMode() === 'source';
  const negative = hasBounds(preview.selectedTransformedBounds) &&
    (preview.selectedTransformedBounds.xMin < 0 || preview.selectedTransformedBounds.yMin < 0);
  const placementOutOfBounds = hasBounds(preview.selectedTransformedBounds) &&
    (preview.selectedTransformedBounds.xMin < MACHINE.xMin || preview.selectedTransformedBounds.xMax > MACHINE.xMax ||
     preview.selectedTransformedBounds.yMin < MACHINE.yMin || preview.selectedTransformedBounds.yMax > MACHINE.yMax);
  const fullRunOutOfBounds = hasBounds(preview.generatedRunBounds) &&
    (preview.generatedRunBounds.xMin < MACHINE.xMin || preview.generatedRunBounds.xMax > MACHINE.xMax ||
     preview.generatedRunBounds.yMin < MACHINE.yMin || preview.generatedRunBounds.yMax > MACHINE.yMax);
  placementSummaryEl.innerHTML = `
    <dl>
      <dt>Rotation</dt><dd>${placement.rotationDeg} deg</dd>
      <dt>Origin</dt><dd>${placement.originAnchor}</dd>
      <dt>Bounds mode</dt><dd>${placement.placementBoundsMode}</dd>
      <dt>Normalize</dt><dd>${placement.normalizeToOrigin ? 'Yes' : 'No'}</dd>
      <dt>Generated bounds</dt><dd>${placementBoundsText(preview.generatedRunBounds)}</dd>
      <dt>Placement bounds</dt><dd>${placementBoundsText(preview.selectedTransformedBounds)}</dd>
      <dt>Generated path</dt><dd>${html(generated)}</dd>
      <dt>Active run file</dt><dd>${html(currentRunPath())}</dd>
      <dt>Active mode</dt><dd><span class="status-badge ${currentRunMode() === 'generated' ? 'active-badge' : ''}">${currentRunMode() === 'generated' ? 'USING GENERATED' : 'USING ORIGINAL'}</span></dd>
      <dt>Generated status</dt><dd><span class="status-badge ${generatedStatus === 'valid' ? 'active-badge' : generatedStatus === 'stale' || generatedStatus === 'invalid' || generatedStatus === 'missing' ? 'caution' : ''}">GENERATED ${html(String(generatedStatus).toUpperCase())}</span></dd>
      <dt>Status</dt><dd>${safety.ok ? 'Placement ready' : 'Blocked'}</dd>
    </dl>
  `;
  const messages = [];
  if (negative) messages.push('Generated placement still has negative X/Y. Use Normalize origin.');
  if (placementOutOfBounds) {
    messages.push('Placement bounds exceed configured LowRider work area.');
  } else if (fullRunOutOfBounds) {
    messages.push('Full generated file includes travel or lead-in moves outside the placement bounds. This can be OK only if your work zero leaves clearance; review before cutting.');
  }
  if (!safety.ok) messages.push(...safety.blockers);
  if (validation.errors?.length) messages.push(...validation.errors);
  if (validation.warnings?.length) messages.push(...validation.warnings);
  if (placementDirty) messages.push('Placement changed. Run file must be updated before dry run or cutting.');
  messages.push(...safety.warnings);
  if (messages.length) {
    placementSummaryEl.innerHTML += `<div class="dry-run-errors">${messages.map((message) => `<div>${html(message)}</div>`).join('')}</div>`;
  }
  if (jobState?.placement?.generatedRunPath) {
    placementSummaryEl.innerHTML += '<p class="warning">Visible placement is the intended job. When placement differs from the original, the generated run file is used after it is updated and validated.</p>';
  }
}

function appendPlacementResult(text) {
  if (!placementResultEl) return;
  placementResultEl.textContent += `${text}\n`;
  placementResultEl.scrollTop = placementResultEl.scrollHeight;
}

async function ensureGeneratedFolder() {
  try {
    await fetch('/api/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/jobs/generated' }),
    });
  } catch (err) {
    appendPlacementResult(`Could not ensure /jobs/generated: ${err.message}`);
  }
}

async function uploadGeneratedRun(path, text) {
  const file = new File([text], basename(path), { type: 'text/plain' });
  const form = new FormData();
  form.append('path', '/jobs/generated');
  form.append('file', file);
  const res = await fetch('/api/upload?overwrite=true', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Generated run upload failed');
}

async function currentSourceFingerprintValue() {
  return sourceGcodeText ? (await computeGcodeFingerprint(sourceGcodeText)).value : '';
}

async function markPlacementChangedAndScheduleUpdate() {
  if (suppressPlacementChange || !sourceToolpathModel) return;
  const active = await jobActiveRunPromise;
  const transform = await toolpathTransformPromise;
  const placement = transform.normalizePlacement(sourceToolpathModel, currentPlacementState());
  const sourceFingerprint = await currentSourceFingerprintValue();
  placement.transformFingerprint = transform.transformFingerprint(placement, sourceFingerprint);
  const desiredMode = active.markPlacementChanged(ensureJobState(), {
    placement,
    generatedRunPath: transform.generatedRunPathFor(filePath),
    sourceFingerprint,
    transformFingerprint: placement.transformFingerprint,
  });
  if (desiredMode !== 'generated') {
    jobState.placement.dirty = false;
    active.selectSourceRun(jobState, filePath);
    await saveJobQuietly().catch((err) => appendPlacementResult(`Placement save failed: ${err.message}`));
    await loadActiveRunPreview();
    appendPlacementResult('Rotation is 0 degrees; using the original source G-code.');
    renderPlacementPanel();
    renderJobPanel();
    renderPreflight();
    renderArmPanel();
    return;
  }

  await saveJobQuietly().catch((err) => appendPlacementResult(`Placement save failed: ${err.message}`));
  if (placementUpdateTimer) clearTimeout(placementUpdateTimer);
  placementUpdateTimer = setTimeout(() => {
    generateRunFile({ auto: true, overwrite: true })
      .catch((err) => {
        if (jobState?.generatedValidation) {
          jobState.generatedValidation.status = 'invalid';
          jobState.generatedValidation.errors = [err.message];
        }
        appendPlacementResult(`Update Run File failed: ${err.message}`);
        renderPlacementPanel();
        renderPreflight();
        renderArmPanel();
      });
  }, 800);
  renderPlacementPanel();
  renderJobPanel();
  renderPreflight();
  renderArmPanel();
}

async function reconcilePlacementIntentOnLoad() {
  if (!jobState || !sourceToolpathModel) return;
  const active = await jobActiveRunPromise;
  const transform = await toolpathTransformPromise;
  const placement = transform.normalizePlacement(sourceToolpathModel, currentPlacementState());
  const desiredMode = active.desiredRunModeForPlacement(placement);
  if (desiredMode !== 'generated') {
    if (jobState.activeRun?.mode === 'generated') {
      jobState.placement = { ...(jobState.placement || {}), ...placement, dirty: false };
      active.selectSourceRun(jobState, filePath);
      await saveJobQuietly();
    }
    return;
  }

  if (jobState.generatedValidation?.status === 'valid' && (jobState.placement?.generatedRunPath || jobState.generatedRunPath)) {
    active.selectGeneratedRun(jobState, jobState.generatedValidation);
    return;
  }
  await markPlacementChangedAndScheduleUpdate();
}

async function generateRunFile(options = {}) {
  const placementModel = sourceToolpathModel || toolpathModel;
  if (!placementModel) return;
  const transform = await toolpathTransformPromise;
  const placement = transform.normalizePlacement(placementModel, currentPlacementState());
  const generatedRunPath = transform.generatedRunPathFor(filePath);
  const existing = await fetch(`/api/download?path=${encodeURIComponent(generatedRunPath)}`).catch(() => null);
  if (existing?.ok && options.overwrite === false) return;
  if (existing?.ok && options.confirmOverwrite && !confirm(`${generatedRunPath} already exists. Overwrite run file?`)) return;

  const generated = transform.generateRunGcode(placementModel, placement, {
    sourcePath: filePath,
    sourceFingerprint: await currentSourceFingerprintValue(),
    generatedRunPath,
  });
  if (!generated.ok) {
    appendPlacementResult(generated.error);
    renderPlacementPanel();
    return;
  }

  await ensureGeneratedFolder();
  await uploadGeneratedRun(generatedRunPath, generated.gcode);
  const job = ensureJobState();
  job.placement = generated.placement;
  job.placement.dirty = false;
  job.generatedRunPath = generatedRunPath;
  const active = await jobActiveRunPromise;
  job.generatedValidation = active.validateGeneratedRun({
    text: generated.gcode,
    generatedPath: generatedRunPath,
    sourceFingerprint: generated.placement.sourceFingerprint,
    expectedSourceFingerprint: generated.placement.sourceFingerprint,
    transformFingerprint: generated.placement.transformFingerprint,
    expectedTransformFingerprint: generated.placement.transformFingerprint,
    placementBounds: generated.transformed.selectedTransformedBounds,
  });
  active.selectGeneratedRun(job, job.generatedValidation);
  await saveJobQuietly();
  transformedPreview = generated.transformed;
  appendPlacementResult(`${options.auto ? 'Auto-updated' : 'Updated'} ${generatedRunPath}`);
  await refreshActiveRunUi();
}

async function loadPreview() {
  if (!filePath) {
    redirectToFiles();
    return;
  }

  pathEl.textContent = filePath;
  const res = await fetch(`/api/download?path=${encodeURIComponent(filePath)}`);
  if (!res.ok) {
    redirectToFiles(filePath);
    return;
  }

  sourceGcodeText = await res.text();
  gcodeText = sourceGcodeText;
  const existingJob = await loadExistingJobJson();
  if (existingJob) {
    jobState = existingJob;
    ensureActiveRunShape(jobState);
    ensureHistoryShape(jobState);
    applyPlacementToInputs(jobState.placement);
    if (jobState.dryRun) {
      if (jobState.dryRun.safeZ !== undefined) safeZInput.value = jobState.dryRun.safeZ;
      if (jobState.dryRun.margin !== undefined) traceMarginInput.value = jobState.dryRun.margin;
    }
    if (runSafeStartZInput) {
      runSafeStartZInput.value = jobState.safeStartZ ?? jobState.dryRun?.safeZ ?? safeZInput?.value ?? 15;
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
  }
  const sourceRun = await parseRunText(sourceGcodeText, filePath, 'source');
  sourceToolpathModel = sourceRun.model;
  sourceParsed = sourceRun.parsed;
  sourcePreviewSummaryData = sourceRun.summary;
  await reconcilePlacementIntentOnLoad();
  await loadActiveRunPreview();
  if (jobState) jobState.preview = previewSummary();
  renderStats();
  await updatePlacementPreview();
  renderJobPanel();
  renderToolZeroPanel();
  renderFeedOverridePanel();
  renderPreflight();
  aircutCommands = [];
  aircutSafety = { ok: false, messages: [] };
  generateTraceCommands();
  renderArmPanel();
  draw();
  syncPreviewMetadata();
  if (!jobExists) await checkJobExists();
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

function installHoldAction(button, action, policy = {}) {
  if (!button) return;
  const holdMs = Math.max(600, Number(policy.holdMs || 1000));
  let timer = null;
  let frame = null;
  let startedAt = 0;
  let completed = false;

  const reset = () => {
    if (timer) clearTimeout(timer);
    if (frame) cancelAnimationFrame(frame);
    timer = null;
    frame = null;
    startedAt = 0;
    button.style.setProperty('--hold-progress', '0');
    button.classList.remove('holding');
  };

  const update = () => {
    if (!startedAt) return;
    const progress = Math.min(1, (performance.now() - startedAt) / holdMs);
    button.style.setProperty('--hold-progress', String(progress));
    if (progress < 1) frame = requestAnimationFrame(update);
  };

  const begin = (event) => {
    if (button.disabled || timer) return;
    event.preventDefault();
    completed = false;
    startedAt = performance.now();
    button.classList.add('holding');
    frame = requestAnimationFrame(update);
    timer = setTimeout(() => {
      completed = true;
      reset();
      Promise.resolve(action()).catch((err) => appendRunLog(`Start failed: ${err.message}`));
    }, holdMs);
  };

  const cancel = (event) => {
    if (event) event.preventDefault();
    if (!completed) reset();
  };

  button.addEventListener('pointerdown', begin);
  button.addEventListener('pointerup', cancel);
  button.addEventListener('pointercancel', cancel);
  button.addEventListener('pointerleave', cancel);
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') begin(event);
  });
  button.addEventListener('keyup', (event) => {
    if (event.key === 'Enter' || event.key === ' ') cancel(event);
  });
  button.addEventListener('click', (event) => event.preventDefault());
}

fitButton.addEventListener('click', draw);
reloadButton.addEventListener('click', loadPreview);
rotateDeltaButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const next = (Number(placementRotationInput?.value || 0) || 0) + Number(button.dataset.rotateDelta || 0);
    if (placementRotationInput) placementRotationInput.value = next;
    updatePlacementPreview({ userChange: true }).catch((err) => appendPlacementResult(`Preview transform failed: ${err.message}`));
  });
});
placementRotationInput?.addEventListener('change', () => updatePlacementPreview({ userChange: true }).catch((err) => appendPlacementResult(`Preview transform failed: ${err.message}`)));
resetPlacementButton?.addEventListener('click', () => selectSourceRunInUi().catch((err) => appendPlacementResult(`Reset placement failed: ${err.message}`)));
previewTransformButton?.addEventListener('click', () => updatePlacementPreview().catch((err) => appendPlacementResult(`Preview transform failed: ${err.message}`)));
generateRunFileButton?.addEventListener('click', () => generateRunFile({ overwrite: true }).catch((err) => appendPlacementResult(`Update run file failed: ${err.message}`)));
useGeneratedRunButton?.addEventListener('click', () => generateRunFile({ overwrite: true }).catch((err) => appendPlacementResult(`Update run file failed: ${err.message}`)));
useSourceRunButton?.addEventListener('click', () => selectSourceRunInUi().catch((err) => appendPlacementResult(`Use original failed: ${err.message}`)));
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
workbenchUiPromise.then((ui) => {
  installHoldAction(startJobButton, startJobRun, ui.actionPolicy('start_cut'));
});
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
runSafeStartZInput?.addEventListener('input', () => {
  ensureJobState();
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
    workbenchController?.openForTab(tab);
    if (tab === 'preview') draw();
  });
});
addEventListener('hashchange', routePreviewTab);
addEventListener('resize', draw);
addEventListener('cnc-skin-change', draw);
addEventListener('cnc-position-update', (event) => {
  const position = event.detail || {};
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
  liveToolPosition = { ...position };
  draw();
});
addEventListener('error', (event) => {
  appendRunLog(`Browser error: ${event.message}`);
  if (stopJobButton) stopJobButton.disabled = false;
});
addEventListener('unhandledrejection', (event) => {
  appendRunLog(`Browser promise error: ${event.reason?.message || event.reason}`);
  if (stopJobButton) stopJobButton.disabled = false;
});
jobState = newJobState();
Promise.all([workbenchUiPromise, workbenchControllerPromise])
  .then(([, controllerModule]) => {
    workbenchController = controllerModule.installWorkbench({
      canvas,
      onViewChange: draw,
      onTabRequested: (tab) => {
        history.replaceState(null, '', `#${tab}`);
        showPreviewTab(tab);
      },
    });
    renderWorkbenchStatus();
    draw();
  })
  .catch((err) => appendRunLog(`Workbench unavailable: ${err.message}`));
routePreviewTab();
renderJobPanel();
renderToolZeroPanel();
renderHistoryPanels();
renderFeedOverridePanel();
renderPlacementPanel();
renderPreflight();
renderDryRunPanel();
renderArmPanel();
jobReadinessPromise.then(renderReadiness).catch((err) => {
  if (readinessSummaryEl) readinessSummaryEl.textContent = `Readiness unavailable: ${err.message}`;
});
loadPreview().catch(() => redirectToFiles(filePath));
window.CncTelemetry?.subscribe('job', (data) => {
  applyJobRunStatus(data).catch((err) => appendRunLog(`Status update failed: ${err.message}`));
});
window.CncTelemetry?.start();
if (runPanel) refreshJobStatus().catch(() => {
  jobStatusHealthy = false;
  renderRunPanel();
  renderWorkbenchStatus();
});
