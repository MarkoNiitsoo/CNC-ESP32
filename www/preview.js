import {
  JOB_SCHEMA_VERSION,
  createVerificationDecision,
  emptyWorkflow,
  evaluateWorkflow,
  isJobV3,
  workflowFor,
} from './lib/job-workflow.js';

const params = new URLSearchParams(location.search);
const filePath = params.get('path') || '';
const currentJobKey = 'lowrider.currentJob';
const pathEl = document.querySelector('#file-path');
const previewFileWarningEl = document.querySelector('#preview-file-warning');
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
const readinessHomeAllButton = document.querySelector('#readiness-home-all');
const readinessPrimaryEl = document.querySelector('#readiness-primary');
const readinessSecondaryEl = document.querySelector('#readiness-secondary');
const jobSummaryEl = document.querySelector('#job-summary');
const jobResultEl = document.querySelector('#job-result');
const loadJobButton = document.querySelector('#load-job');
const saveJobButton = document.querySelector('#save-job');
const capturePositionButton = document.querySelector('#capture-position');
const setWorkZeroButton = document.querySelector('#set-work-zero');
const setZeroXButton = document.querySelector('#set-zero-x');
const setZeroYButton = document.querySelector('#set-zero-y');
const captureSetZeroButton = document.querySelector('#capture-set-zero');
const downloadJobButton = document.querySelector('#download-job');
const zeroOriginSummaryEl = document.querySelector('#zero-origin-summary');
const homeMachineZeroButton = document.querySelector('#home-machine-zero');
const prepareWorkZeroHistorySelect = document.querySelector('#prepare-work-zero-history');
const restorePrepareWorkZeroButton = document.querySelector('#restore-prepare-work-zero');
const prepareWorkZeroHintEl = document.querySelector('#prepare-work-zero-hint');
const zeroHistoryDialog = document.querySelector('#zero-history-dialog');
const openZeroHistoryButton = document.querySelector('#open-zero-history');
const closeZeroHistoryButton = document.querySelector('#close-zero-history');
const preflightStateEl = document.querySelector('#preflight-state');
const preflightActionEl = document.querySelector('#preflight-action');
const preflightChecksEl = document.querySelector('#preflight-checks');
const refreshPreflightButton = document.querySelector('#refresh-preflight');
const saveJobPreflightButton = document.querySelector('#save-job-preflight');
const recoveryTrustEl = document.querySelector('#recovery-trust');
const recoverySafeZInput = document.querySelector('#recovery-safe-z');
const recoveryTrustButton = document.querySelector('#recovery-trust-position');
const recoveryUntrustButton = document.querySelector('#recovery-untrust-position');
const recoveryOverlayInput = document.querySelector('#show-recovery-overlay');
const recoverySummaryEl = document.querySelector('#recovery-summary');
const workZeroRestoreSummaryEl = document.querySelector('#work-zero-restore-summary');
const restoreSavedWorkZeroButton = document.querySelector('#restore-saved-work-zero');
const fitResumePointButton = document.querySelector('#fit-resume-point');
const moveToResumePointButton = document.querySelector('#move-to-resume-point');
const cancelRecoveryButton = document.querySelector('#cancel-recovery');
const recoveryLogEl = document.querySelector('#recovery-log');
const toollessNoCutterInput = document.querySelector('#toolless-no-cutter');
const toollessResumeSummaryEl = document.querySelector('#toolless-resume-summary');
const toollessResumeStartButton = document.querySelector('#toolless-resume-start');
const productionResumeSummaryEl = document.querySelector('#production-resume-summary');
const productionChecklistInputs = [...document.querySelectorAll('[data-production-check]')];
const productionZChangeChecks = document.querySelector('#production-z-change-checks');
const productionPrepareButton = document.querySelector('#production-prepare');
const productionRouterConfirmedInput = document.querySelector('#production-router-confirmed');
const productionResumeHoldButton = document.querySelector('#production-resume-hold');
const dryRunSummaryEl = document.querySelector('#dry-run-summary');
const safeZInput = document.querySelector('#safe-z');
const traceMarginInput = document.querySelector('#trace-margin');
const dryRunAircutToggle = document.querySelector('#dry-run-aircut');
const sendDryRunButton = document.querySelector('#send-dry-run');
const stopM5Button = document.querySelector('#stop-m5');
const dryRunStatusEl = document.querySelector('#dry-run-status');
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
const runOperatorSummaryEl = document.querySelector('#run-operator-summary');
const runFinalChecklistEl = document.querySelector('#run-final-checklist');
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

let MACHINE = { xMin: 0, xMax: 1625, yMin: 0, yMax: 5800 };
let RECOVERY_LIMITS = { ...MACHINE, zMin: 0, zMax: 70 };
let TOOLLESS_LIMITS = { ...MACHINE, zMin: -30, zMax: 70 };
const SAFETY_Z_FEED_MM_MIN = 400;
const PREVIEW_SOFT_WARNING_BYTES = 4 * 1024 * 1024;
const TRANSFORM_SOFT_WARNING_BYTES = 2 * 1024 * 1024;
const positionTrustKey = 'lowrider.positionTrust';
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
let activeTestMotion = null;
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
let sourceGcodeSizeBytes = 0;
let activeRunText = '';
let activeRunPath = filePath;
let activeRunMode = 'source';
let placementUpdateTimer = null;
let suppressPlacementChange = false;
let workbenchUiModule = null;
let workbenchController = null;
let liveToolPosition = null;
let currentMachineFrame = null;
let animatedToolPosition = null;
let motionAnimationFrame = null;
let activeMotionAnimation = null;
let lastMotionSequence = 0;
const motionAnimationQueue = [];
let recoveryMotionSegments = null;
const MAX_MOTION_ANIMATION_AGE_MS = 1000;
const MAX_MOTION_ANIMATION_SEGMENTS = 128;
let motionResyncPending = false;
let jobStatusReceivedAtMs = 0;
let jobStatusFirmwareUptimeMs = 0;
let redirectingToFiles = false;
let recoveryPlan = null;
let recoveryOverlayVisible = true;
let positionTrust = { trusted: false, fullHoming: false, source: '', confirmedAt: null, bootUptimeMs: null, firmwareVersion: '' };
let toollessResumePlan = null;
let toollessResumeRunning = false;
let toollessResumeCancelRequested = false;
let productionResumePlan = null;
let productionResumeRunning = false;
let productionResumeCancelRequested = false;
let productionPhase1Complete = false;
let productionContextSignature = '';
let productionHistoryEvent = null;
let productionCommandsSent = 0;
let productionResumeFinished = false;
let productionHoldTimer = null;
let productionHoldProgressTimer = null;
let motionSettingsModule = null;
let motionSettings = { travelSpeedMmS: 50 };

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
const thumbnailModulePromise = import('/lib/upload-thumbnail.js');
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
let jobRecoveryModule = null;
const jobRecoveryPromise = import('/lib/job-recovery.js').then((module) => {
  jobRecoveryModule = module;
  return module;
});
const motionSettingsPromise = import('/lib/motion-settings.js').then((module) => {
  motionSettingsModule = module;
  motionSettings = module.loadMotionSettings();
  return module;
});

function showPreviewTab(tabName) {
  const activeTab = tabName || 'preview';
  previewTabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.previewTabButton === activeTab);
  });
  previewTabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.previewTab === activeTab);
  });
  document.querySelector('#tools-drawer-content')?.scrollTo?.({ top: 0, behavior: 'auto' });
  document.querySelector('#readiness-drawer-content')?.scrollTo?.({ top: 0, behavior: 'auto' });
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
    home_machine: 'home', run_dry_run: 'dryRun', arm_job: 'start', start_cut: 'start', monitor_job: 'log', resume_job: 'start',
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
  if (target === 'setup') return 'preflight';
  return target;
}

function focusReadinessTarget(action) {
  const focusMap = {
    home_machine: readinessHomeAllButton || homeMachineZeroButton,
    set_work_zero: setWorkZeroButton,
    set_z_zero: setZZeroButton,
    run_dry_run: sendDryRunButton,
    arm_job: startJobButton,
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
  if (action.id === 'home_machine') {
    showPreviewTab('preflight');
    workbenchController?.openForTab('preflight');
    history.replaceState(null, '', '#preflight');
    window.dispatchEvent(new CustomEvent('cnc-home-machine-request'));
    focusReadinessTarget(action);
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

function workflowHardBlockers() {
  const blockers = [...activeRunBlockers()];
  (currentPreflight?.checks || [])
    .filter((check) => check.level === 'fail' && check.id !== 'workZero')
    .forEach((check) => blockers.push(check.message));
  return [...new Set(blockers)];
}

function guidedWorkflowStatus() {
  return evaluateWorkflow(ensureJobState(), {
    machineFrame: currentMachineFrame || {},
    bootSessionId: currentMachineFrame?.bootSessionId || '',
    hardBlockers: workflowHardBlockers(),
  });
}

async function postManualFrame(mode) {
  const res = await fetch('/api/machine/manual-frame', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  const data = await readJsonOrThrow(res);
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Manual work frame failed');
  currentMachineFrame = data.frame || currentMachineFrame;
  return data;
}

async function continueWithoutHoming() {
  if (!confirm('Continue without homing? The controller cannot verify absolute machine position or prevent travel beyond the real table limits.')) return;
  if (!confirm('This is an emergency/intentional override. Confirm again that you accept responsibility for the current machine position.')) return;
  const data = await postManualFrame('confirm');
  const job = ensureJobState();
  job.frameDecision = {
    mode: 'manual-unhomed',
    bootSessionId: data.frame?.bootSessionId || '',
    homingSessionId: '',
    acknowledgedAt: nowIso(),
  };
  job.workZeroDecision = emptyWorkflow().workZeroDecision;
  job.verificationDecision = emptyWorkflow().verificationDecision;
  await saveJobQuietly();
  renderAllWorkflowPanels();
}

async function acceptManualWorkZero(mode) {
  const data = await postManualFrame(mode);
  const job = ensureJobState();
  const capturedAt = nowIso();
  const token = `manual:${data.frame?.bootSessionId || ''}:${capturedAt}`;
  job.workZero.beforeG92 = parseM114(data.before || '');
  job.workZero.afterG92 = parseM114(data.after || '');
  job.workZero.capturedAt = capturedAt;
  job.workZero.machineReference = null;
  job.workZero.frame = {
    bootSessionId: data.frame?.bootSessionId || '',
    revision: Number(data.frame?.revision),
  };
  job.workZeroDecision = {
    mode: mode === 'set-zero' ? 'manual-set' : 'existing-marlin',
    token,
    bootSessionId: data.frame?.bootSessionId || '',
    capturedAt,
  };
  job.startMode = 'use_manual_work_frame';
  job.verificationDecision = emptyWorkflow().verificationDecision;
  await saveJobQuietly();
  setJobResult(mode === 'set-zero' ? 'Current position set as work zero' : 'Existing G54 work coordinates accepted');
  renderAllWorkflowPanels();
}

async function skipPhysicalVerification() {
  if (!confirm('Skip Bounds Check and Full Aircut? Confirm only if you have independently verified that the part, clamps, and toolpath fit safely.')) return;
  await recordPhysicalVerification('skipped');
  renderAllWorkflowPanels();
  draw();
}

async function recordPhysicalVerification(type, options = {}) {
  const job = ensureJobState();
  const mode = currentRunMode();
  job.activeRun.path = currentRunPath();
  job.activeRun.mode = mode;
  if (mode === 'generated') job.activeRun.generatedFingerprint = gcodeFingerprint || job.activeRun.generatedFingerprint || '';
  else job.activeRun.sourceFingerprint = gcodeFingerprint || job.activeRun.sourceFingerprint || '';
  job.verificationDecision = createVerificationDecision(job, {
    type,
    safeZ: options.safeZ,
    margin: options.margin,
  });
  await saveJobQuietly();
  return job.verificationDecision;
}

function renderAllWorkflowPanels() {
  renderZeroOriginPanel();
  renderPreflight();
  renderRunPanel();
  draw();
}

function workflowButton(label, action, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener('click', () => Promise.resolve(action()).catch((err) => {
    setJobResult(err.message, true);
    appendRunLog(`Preparation failed: ${err.message}`);
  }));
  return button;
}

function renderReadiness() {
  if (!readinessSummaryEl || !readinessPrimaryEl || !readinessSecondaryEl) return;
  const status = guidedWorkflowStatus();
  const machineState = String(jobRunStatus?.state || '').toUpperCase();
  const homeBusy = ['PREPARING', 'RUNNING', 'PAUSING', 'PAUSED', 'RESUMING', 'STOPPING'].includes(machineState);
  if (readinessHomeAllButton) {
    readinessHomeAllButton.disabled = homeBusy;
    readinessHomeAllButton.title = homeBusy ? 'Home All is available when the machine is idle.' : 'Re-home every axis';
  }
  const completedSteps = [status.frame.ok, status.workZero.ok, status.verification.ok].filter(Boolean).length;
  const copy = {
    blocked: ['Job needs attention', status.hardBlockers[0] || 'Resolve the job file problem before moving the machine.'],
    frame: ['Establish machine position', 'Home All is recommended. You may deliberately continue without homing when recovering material or a job.'],
    'work-zero': ['Set the work zero', status.frame.mode === 'manual-unhomed' ? 'Set the current position as zero, or explicitly keep the existing Marlin G54 work coordinates.' : 'Move to the job origin and set the current XYZ as work zero.'],
    verification: ['Verify the physical fit', 'Run a quick Bounds Check, run a Full Aircut, or deliberately skip this check.'],
    cut: ['Ready for final review', 'Preparation is complete. Review the three final checks, then hold to start.'],
  }[status.gate];

  readinessSummaryEl.innerHTML = `
    <div class="operator-readiness-progress"><strong>${completedSteps} / 3</strong><span>preparation decisions ready</span></div>
    <h3>${html(copy[0])}</h3>
    <p>${html(copy[1])}</p>
    ${status.warnings.length ? `<p class="warning">${html(status.warnings.join(' · '))}</p>` : ''}
    <details class="operator-diagnostics">
      <summary>Preparation details</summary>
      <dl>
        <dt>Machine frame</dt><dd>${html(status.frame.label)}</dd>
        <dt>Work zero</dt><dd>${html(status.workZero.label)}</dd>
        <dt>Physical verification</dt><dd>${html(status.verification.label)}</dd>
        <dt>Active run</dt><dd>${html(currentRunPath() || '-')}</dd>
      </dl>
      ${status.hardBlockers.length ? `<ul class="readiness-blockers">${status.hardBlockers.map((reason) => `<li>${html(reason)}</li>`).join('')}</ul>` : ''}
    </details>
  `;

  readinessPrimaryEl.textContent = '';
  readinessSecondaryEl.textContent = '';
  if (status.gate === 'frame') {
    readinessSecondaryEl.append(workflowButton('Continue Without Homing', continueWithoutHoming, 'machine-danger'));
  } else if (status.gate === 'work-zero') {
    if (status.frame.mode === 'homed') {
      readinessPrimaryEl.append(workflowButton('Set Work Zero Here', () => setWorkZeroWithCapture(null, 'xyz'), 'primary-action'));
    } else {
      readinessPrimaryEl.append(workflowButton('Set Current Position as Zero', () => acceptManualWorkZero('set-zero'), 'primary-action'));
      readinessSecondaryEl.append(workflowButton('Use Existing G54 Coordinates', () => acceptManualWorkZero('preserve')));
    }
  } else if (status.gate === 'verification') {
    readinessPrimaryEl.append(workflowButton('Run Bounds Check', sendBoundingBoxTrace, 'primary-action'));
    readinessSecondaryEl.append(workflowButton('Run Full Aircut', sendAircutToolpath));
    readinessSecondaryEl.append(workflowButton('Continue Without Check', skipPhysicalVerification, 'caution'));
  } else if (status.gate === 'cut') {
    readinessPrimaryEl.append(workflowButton('Review & Start Cut', () => {
      showPreviewTab('run');
      workbenchController?.openForTab('run');
    }, 'primary-action'));
  }
  renderWorkbenchStatus();
}

function basename(path) {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(index + 1) : path;
}

function safeJobName(path) {
  const normalized = String(path || '').replace(/^\/+/, '');
  const readable = normalized.replace(/[^A-Za-z0-9._-]/g, '_').slice(-72) || 'job';
  return `${readable}-${fnv1a32(normalized)}`;
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

function normalizedCapture(capture = {}) {
  return {
    ...emptyCapture(),
    ...capture,
    position: { ...emptyPosition(), ...(capture?.position || {}) },
    counts: { ...emptyCounts(), ...(capture?.counts || {}) },
  };
}

function emptyWorkZero() {
  return {
    method: 'G92 X0 Y0 Z0',
    capturedAt: null,
    beforeG92: emptyCapture(),
    afterG92: emptyCapture(),
    machineReference: null,
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
  if (active && animatedToolPosition) return animatedToolPosition;
  if (active && Number.isFinite(statusPosition?.x) && Number.isFinite(statusPosition?.y)) {
    return { ...statusPosition, source: 'STATUS' };
  }
  if (active) {
    const commanded = workbenchUiModule?.commandedPositionAtCommand(parsed?.segments || [], jobRunStatus?.currentLineNumber);
    if (commanded) return { ...commanded, source: 'CMD' };
  }
  if (currentMachineFrame?.machine && Number.isFinite(currentMachineFrame.machine.x)) {
    return { ...currentMachineFrame.machine, source: 'MACHINE', isMachine: true };
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
  if (position?.isMachine) return position;
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
    schemaVersion: JOB_SCHEMA_VERSION,
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
    startMode: 'use_active_work_zero',
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
    ...emptyWorkflow(),
    notes: '',
  };
}

function defaultPlacementState() {
  return {
    rotationDeg: 0,
    originAnchor: 'cutBoundsLowerLeft',
    placementBoundsMode: 'cutBounds',
    normalizeToOrigin: true,
    autoShiftToWorkZero: false,
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
    materialAndPathClear: false,
    toolAndZZeroVerified: false,
    spindleStateReady: false,
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

function activeWorkZeroReference() {
  const active = (jobState?.zeroHistory || []).find((entry) => (
    entry?.type === 'workZero' && entry.id === jobState?.activeWorkZeroId
  ));
  return {
    id: active?.id || jobState?.activeWorkZeroId || null,
    position: active?.machineReference?.position || jobState?.workZero?.machineReference?.position || null,
    homingEpoch: Number(active?.frame?.homingEpoch ?? jobState?.workZero?.frame?.homingEpoch),
    homingSessionId: active?.frame?.homingSessionId || jobState?.workZero?.frame?.homingSessionId || '',
  };
}

function workZeroMatchesMachineFrame() {
  const saved = activeWorkZeroReference();
  const live = currentMachineFrame;
  if (!saved.id || !saved.position || !Number.isFinite(saved.homingEpoch) || !saved.homingSessionId ||
      !live?.workZeroMachine || live.absoluteFromHome !== true) return false;
  return saved.homingEpoch === Number(live.homingEpoch) &&
    saved.homingSessionId === String(live.homingSessionId || '') && ['x', 'y', 'z'].every((axis) => (
    Math.abs(Number(saved.position[axis]) - Number(live.workZeroMachine[axis])) <= 0.05
  ));
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
    addCheck(checks, 'machineBounds', 'pass', 'Fits default G-code CNC work area');
  } else {
    addCheck(checks, 'machineBounds', 'fail', 'Toolpath exceeds discovered machine work area');
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
  if (hasRawCapture(workZero?.beforeG92) && hasRawCapture(workZero?.afterG92) && workZeroMatchesMachineFrame()) {
    addCheck(checks, 'workZero', 'pass', 'Saved work zero matches the active homed machine frame');
  } else if (hasRawCapture(workZero?.beforeG92) && hasRawCapture(workZero?.afterG92)) {
    addCheck(checks, 'workZero', 'fail', 'Saved work zero is not active in the current homing session');
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

  if (currentPreflight.state === 'NOT_READY') preflightActionEl.textContent = 'Complete the next required action below.';
  else if (currentPreflight.state === 'WARNINGS') preflightActionEl.textContent = 'Review the warnings that affect this cut.';
  else if (currentPreflight.state === 'READY') preflightActionEl.textContent = 'Automatic job checks pass.';
  else preflightActionEl.textContent = 'Load a preview to check job readiness.';

  const important = currentPreflight.checks.filter((check) => check.level !== 'pass');
  const passCount = currentPreflight.checks.filter((check) => check.level === 'pass').length;
  const renderCheck = (check) => `<div class="preflight-check preflight-check-${check.level}">${check.level === 'pass' ? 'PASS' : check.level === 'fail' ? 'FAIL' : 'WARN'} ${html(check.message)}</div>`;
  preflightChecksEl.innerHTML = `
    ${important.length ? important.map(renderCheck).join('') : '<p class="ok-text">No issues need operator attention.</p>'}
    <details class="operator-diagnostics">
      <summary>All automatic checks (${passCount} passed)</summary>
      ${currentPreflight.checks.map(renderCheck).join('')}
    </details>
  `;
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
  blockers.push(...activeRunBlockers());
  return blockers;
}

function machineNeedsHome() {
  return currentMachineFrame?.trusted !== true || currentMachineFrame?.absoluteFromHome !== true;
}

function startPreparationBlockers() {
  const status = guidedWorkflowStatus();
  if (status.gate === 'cut') return [];
  if (status.gate === 'blocked') return status.hardBlockers;
  if (status.gate === 'frame') return ['Home All or deliberately continue without homing.'];
  if (status.gate === 'work-zero') return ['Set or confirm the active work zero.'];
  return ['Run Bounds Check, run Full Aircut, or deliberately continue without the check.'];
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
    const preparationBlockers = startPreparationBlockers();
    runPanel.hidden = false;

    const state = jobRunStatus?.state || 'IDLE';
    const running = state === 'RUNNING';
    const preparing = state === 'PREPARING';
    const pausing = state === 'PAUSING';
    const paused = state === 'PAUSED';
    const resuming = state === 'RESUMING';
    const stopping = state === 'STOPPING';
    const active = running || preparing || pausing || paused || resuming || stopping;
    const statusUnknown = !jobStatusHealthy || state === 'UNKNOWN';
    const startAllowed = preparationBlockers.length === 0 && !active && !toollessResumeRunning && !productionResumeRunning;
    const startChecklistReady = runChecklistComplete();

    startJobButton.hidden = active;
    startJobButton.disabled = !startAllowed || !startChecklistReady;
    startJobButton.textContent = startAllowed ? 'Hold to Start Cut' : 'Complete Preparation First';
    if (runFinalChecklistEl) runFinalChecklistEl.hidden = !startAllowed;
    pauseJobButton.hidden = !(running || pausing || statusUnknown);
    resumeJobButton.hidden = !paused;
    stopJobButton.hidden = !(active || statusUnknown);
    pauseJobButton.disabled = !(running || statusUnknown);
    resumeJobButton.disabled = !paused;
    stopJobButton.disabled = stopping;

    if (runOperatorSummaryEl) {
      const bounds = generatedBounds() || parsed?.bounds;
      const width = bounds ? Number(bounds.xMax) - Number(bounds.xMin) : null;
      const height = bounds ? Number(bounds.yMax) - Number(bounds.yMin) : null;
      if (active || state === 'COMPLETED' || state === 'ERROR' || state === 'STOPPED') {
        runOperatorSummaryEl.innerHTML = `
          <div class="operator-run-state"><strong>${html(state)}</strong><span>${Number(jobRunStatus?.progressPercent || 0).toFixed(1)}%</span></div>
          <p>${html(basename(currentRunPath()) || 'Active job')} · Feed ${feedStatusPercent()}%</p>
        `;
      } else if (preparationBlockers.length) {
        runOperatorSummaryEl.innerHTML = `
          <p class="eyebrow">NEXT STEP</p>
          <strong>${html(preparationBlockers[0])}</strong>
          <p>Open Checks to complete the required action.</p>
        `;
      } else {
        runOperatorSummaryEl.innerHTML = `
          <p class="eyebrow">READY FOR FINAL REVIEW</p>
          <strong>${html(basename(currentRunPath()) || 'Job')}</strong>
          <p>${Number.isFinite(width) && Number.isFinite(height) ? `${width.toFixed(1)} × ${height.toFixed(1)} mm · ` : ''}Safe Z ${Number(jobState?.safeStartZ ?? runSafeStartZInput?.value ?? 15).toFixed(1)} mm · Feed ${feedStatusPercent()}%</p>
        `;
      }
    }

    runSummaryEl.innerHTML = `
      <dl>
        <dt>State</dt><dd>${state}</dd>
        <dt>Starting</dt><dd>${html(currentRunMode() === 'generated' ? `generated file: ${currentRunPath()}` : `source file: ${currentRunPath()}`)}</dd>
        <dt>Run file</dt><dd>${html(currentRunPath())}</dd>
        <dt>Run mode</dt><dd>${html(currentRunLabel())}</dd>
        <dt>Start mode</dt><dd>use saved active work zero</dd>
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
    if (preparationBlockers.length) {
      runSummaryEl.innerHTML += `<div class="dry-run-errors">${preparationBlockers.map((message) => `<div>${html(message)}</div>`).join('')}</div>`;
    } else if (startAllowed && !startChecklistReady) {
      runSummaryEl.innerHTML += '<div class="dry-run-errors"><div>Complete the three final checks before starting the job.</div></div>';
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
  jobStatusReceivedAtMs = performance.now();
  jobStatusFirmwareUptimeMs = Number(data?.uptimeMs) || 0;
  jobStatusHealthy = true;
  if (!data?.streamMode || data.streamMode === 'job') await syncRunHistoryFromStatus(data);
  if (data?.streamMode === 'production-resume') await syncProductionResumeFromStatus(data);
  const terminalStates = new Set(['IDLE', 'COMPLETED', 'STOPPED', 'ERROR']);
  const belongsToAnotherFile = data?.gcodePath
    && data.gcodePath !== currentRunPath()
    && terminalStates.has(String(data.state || '').toUpperCase());
  jobRunStatus = belongsToAnotherFile
    ? { state: 'IDLE', progressPercent: 0, previousJobPath: data.gcodePath }
    : data;
  renderRunPanel();
  refreshRecoveryPlan();
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
  window.CncTelemetry?.accept?.('job', data);
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
  let res;
  try {
    res = await fetch(url, options);
  } catch (networkError) {
    if (url.includes('/api/job/')) {
      try {
        const statusRes = await fetch('/api/job/status', { cache: 'no-store' });
        const status = await readJsonOrThrow(statusRes);
        const expectedPath = url.includes('/api/job/start') ? currentRunPath() : null;
        const acceptedStates = new Set(['PREPARING', 'RUNNING', 'PAUSING', 'PAUSED', 'RESUMING', 'STOPPING', 'STOPPED']);
        if (statusRes.ok && acceptedStates.has(status.state) && (!expectedPath || status.gcodePath === expectedPath)) {
          appendRunLog(`Network reply was lost; reconciled ${url} from firmware status ${status.state}.`);
          return applyJobRunStatus(status);
        }
      } catch (_) {
        // Preserve the original network error; controls remain available through the safety bar.
      }
    }
    throw new Error(`ESP32 did not return a response for ${url}: ${networkError.message}`);
  }
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
  window.CncTelemetry?.accept?.('job', data);
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

async function reviewAndStartJobRun() {
  const blockers = startPreparationBlockers();
  if (blockers.length) {
    appendRunLog(`Start blocked: ${blockers.join(' ')}`);
    renderRunPanel();
    return;
  }
  if (!runChecklistComplete()) {
    appendRunLog('Start blocked: complete the three final checks first.');
    return;
  }
  await startJobRun();
}

async function startJobRun() {
  const runPath = currentRunPath();
  const runMode = currentRunMode();
  const runCheck = jobActiveRunModule?.assertCanUseActiveRunForExecution
    ? jobActiveRunModule.assertCanUseActiveRunForExecution(ensureJobState(), { requireArm: false })
    : null;
  const runBlockers = runCheck ? (runCheck.ok ? [] : runCheck.reasons.map((item) => item.message)) : activeRunBlockers();
  if (runBlockers.length) {
    appendRunLog(`Start blocked: ${runBlockers.join(' ')}`);
    return;
  }
  if (!runChecklistComplete()) {
    appendRunLog('Start blocked: complete the three final checks first.');
    return;
  }

  const warnings = armWarnings();
  if (warnings.length) appendRunLog(`Starting after deliberate hold with ${warnings.length} reviewed warning(s).`);

  const job = ensureJobState();
  const workflow = guidedWorkflowStatus();
  if (workflow.gate !== 'cut') {
    appendRunLog('Start blocked: preparation decisions are no longer current.');
    return;
  }
  const zeroReference = activeWorkZeroReference();
  job.startMode = workflow.frame.mode === 'manual-unhomed' ? 'use_manual_work_frame' : 'use_active_work_zero';
  job.startAuthorization = {
    state: 'authorized',
    activeRunPath: runPath,
    activeRunFingerprint: gcodeFingerprint,
    frameMode: workflow.frame.mode,
    verificationType: workflow.verification.type,
    checklist: runChecklistState(),
    authorizedAt: nowIso(),
  };
  job.startAuthorizationToken = 'AUTHORIZED';
  const history = await jobHistoryPromise;
  const run = history.startRunHistory(job, jobRunStatus || {});
  try {
    await saveJobQuietly();
    renderHistoryPanels();
    const data = await postCriticalJobAction('/api/job/start', {
      gcodePath: runPath,
      jobPath: jobPathFor(filePath),
      startMode: job.startMode,
      bootSessionId: currentMachineFrame?.bootSessionId || '',
      workZeroId: zeroReference.id,
      homingEpoch: zeroReference.homingEpoch,
      homingSessionId: zeroReference.homingSessionId,
      workZeroMachineX: Number(zeroReference.position?.x),
      workZeroMachineY: Number(zeroReference.position?.y),
      workZeroMachineZ: Number(zeroReference.position?.z),
      safeStartZ: job.safeStartZ,
      travelFeedMmMin: automaticTravelFeed(),
      activeRunMode: runMode,
      activeRunFingerprint: gcodeFingerprint,
      sourceFingerprint: job.activeRun?.sourceFingerprint || '',
      generatedFingerprint: job.activeRun?.generatedFingerprint || '',
      transformFingerprint: job.activeRun?.transformFingerprint || '',
    });
    history.updateRunHistoryFromStatus(job, { ...data, state: data.state || 'RUNNING' });
    job.startAuthorization = emptyWorkflow().startAuthorization;
    job.startAuthorizationToken = '';
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
  refreshRecoveryPlan();
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
  refreshRecoveryPlan();
}

function ensureJobState() {
  if (!jobState) jobState = newJobState();
  jobState.schemaVersion = JOB_SCHEMA_VERSION;
  Object.assign(jobState, workflowFor(jobState));
  ensureZeroState(jobState);
  jobState.gcodePath = filePath;
  jobState.sourceGcodePath = jobState.sourceGcodePath || filePath;
  jobState.jobPath = jobPathFor(filePath);
  ensureActiveRunShape(jobState);
  if (!jobState.startMode) jobState.startMode = 'use_active_work_zero';
  if (jobState.safeStartZ === undefined || jobState.safeStartZ === null) jobState.safeStartZ = Number(safeZInput?.value) || 15;
  if (!jobState.startChecklist) jobState.startChecklist = defaultRunChecklistState();
  if (jobState.allowedWorkspaceCommands !== true) jobState.allowedWorkspaceCommands = false;
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
    originAnchor: 'cutBoundsLowerLeft',
    placementBoundsMode: 'cutBounds',
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
  if (!Array.isArray(job.recoveryHistory)) job.recoveryHistory = [];
  if (!Object.prototype.hasOwnProperty.call(job, 'activeWorkZeroId')) job.activeWorkZeroId = null;
  if (!Object.prototype.hasOwnProperty.call(job, 'activeZZeroId')) job.activeZZeroId = null;
  return job;
}

function resolvedPlacement(transform, model) {
  return transform.resolveAutoPlacement(model, currentPlacementState(), MACHINE);
}

function stopMotionAnimation() {
  if (motionAnimationFrame) cancelAnimationFrame(motionAnimationFrame);
  motionAnimationFrame = null;
  activeMotionAnimation = null;
  motionAnimationQueue.length = 0;
  animatedToolPosition = null;
  draw();
}

function playNextMotionAnimation() {
  if (activeMotionAnimation || !workbenchUiModule || !motionAnimationQueue.length) return;
  activeMotionAnimation = motionAnimationQueue.shift();
  const { segment, feedOverridePercent } = activeMotionAnimation;
  const duration = workbenchUiModule.motionDurationMs(segment, {
    feedOverridePercent,
    rapidFeedMmMin: automaticTravelFeed(),
  });
  const startedAt = performance.now();
  const frame = (now) => {
    if (!activeMotionAnimation) return;
    const progress = Math.min(1, (now - startedAt) / duration);
    animatedToolPosition = {
      ...workbenchUiModule.interpolateMotionSegment(segment, progress),
      source: 'PREDICTED',
    };
    draw();
    if (progress < 1) {
      motionAnimationFrame = requestAnimationFrame(frame);
      return;
    }
    activeMotionAnimation = null;
    motionAnimationFrame = null;
    playNextMotionAnimation();
  };
  motionAnimationFrame = requestAnimationFrame(frame);
}

function trimMotionAnimationBacklog() {
  if (motionAnimationQueue.length <= MAX_MOTION_ANIMATION_SEGMENTS) return;
  const latest = motionAnimationQueue[motionAnimationQueue.length - 1];
  motionAnimationQueue.length = 0;
  motionAnimationQueue.push(latest);
  if (activeMotionAnimation) {
    cancelAnimationFrame(motionAnimationFrame);
    motionAnimationFrame = null;
    activeMotionAnimation = null;
    animatedToolPosition = null;
  }
}

function estimatedFirmwareUptimeMs() {
  return jobStatusFirmwareUptimeMs + Math.max(0, performance.now() - jobStatusReceivedAtMs);
}

function handleMotionTelemetry(data = {}) {
  if (!workbenchUiModule || !parsed) return;
  const streamSegments = jobRunStatus?.streamMode === 'production-resume' && recoveryMotionSegments
    ? recoveryMotionSegments
    : parsed.segments || [];
  for (const event of data.events || []) {
    const sequence = Number(event.sequence);
    if (!Number.isFinite(sequence) || sequence <= lastMotionSequence) continue;
    if (motionResyncPending || (Number.isFinite(Number(event.sentAtMs)) &&
        estimatedFirmwareUptimeMs() - Number(event.sentAtMs) > MAX_MOTION_ANIMATION_AGE_MS)) {
      lastMotionSequence = sequence;
      stopMotionAnimation();
      continue;
    }
    const previousSequence = lastMotionSequence;
    lastMotionSequence = sequence;
    const segments = workbenchUiModule.segmentsBetweenCommands(
      streamSegments, previousSequence, sequence,
    );
    for (const segment of segments) {
      motionAnimationQueue.push({ segment, feedOverridePercent: Number(data.feedOverridePercent) || 100 });
    }
  }
  trimMotionAnimationBacklog();
  playNextMotionAnimation();
}

async function loadMachineLimits() {
  try {
    const res = await fetch('/api/machine/info');
    if (!res.ok) return;
    const info = await res.json();
    const full = info?.full;
    if (!info?.available || !full || !['xMin', 'xMax', 'yMin', 'yMax', 'zMin', 'zMax'].every((key) => Number.isFinite(Number(full[key])))) return;
    MACHINE = { xMin: Number(full.xMin), xMax: Number(full.xMax), yMin: Number(full.yMin), yMax: Number(full.yMax) };
    RECOVERY_LIMITS = { ...MACHINE, zMin: Math.max(0, Number(full.zMin)), zMax: Number(full.zMax) };
    TOOLLESS_LIMITS = { ...MACHINE, zMin: Number(full.zMin), zMax: Number(full.zMax) };
  } catch (err) {
    // Cached firmware defaults remain valid when machine discovery is unavailable.
  }
}

function formatFileSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function renderPreviewFileWarning() {
  if (!previewFileWarningEl) return;
  const messages = [];
  if (sourceGcodeSizeBytes > PREVIEW_SOFT_WARNING_BYTES) {
    messages.push(`Large preview file (${formatFileSize(sourceGcodeSizeBytes)}): browser parsing may be slow or memory intensive.`);
  }
  if (sourceGcodeSizeBytes > TRANSFORM_SOFT_WARNING_BYTES) {
    messages.push('Rotation/transform may require additional browser memory.');
  }
  if (messages.length) {
    messages.push('Firmware job execution remains SD-streamed and is not limited by preview size.');
    previewFileWarningEl.textContent = messages.join(' ');
    previewFileWarningEl.hidden = false;
  } else {
    previewFileWarningEl.textContent = '';
    previewFileWarningEl.hidden = true;
  }
}

function restorePositionTrust() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(positionTrustKey) || 'null');
    if (saved?.trusted === true) positionTrust = { ...positionTrust, ...saved };
  } catch (err) {
    sessionStorage.removeItem(positionTrustKey);
  }
}

function storePositionTrust() {
  sessionStorage.setItem(positionTrustKey, JSON.stringify(positionTrust));
}

function setPositionTrust(trusted, source = '', fullHoming = false) {
  const health = window.CncTelemetry?.state?.health || {};
  positionTrust = trusted ? {
    trusted: true,
    fullHoming: Boolean(fullHoming),
    source,
    confirmedAt: nowIso(),
    bootUptimeMs: Number.isFinite(Number(health.uptimeMs)) ? Number(health.uptimeMs) : null,
    firmwareVersion: health.firmwareVersion || health.firmware || '',
  } : { trusted: false, fullHoming: false, source, confirmedAt: null, bootUptimeMs: null, firmwareVersion: '' };
  storePositionTrust();
  refreshRecoveryPlan();
  renderZeroOriginPanel();
  renderPreflight();
  renderRunPanel();
}

function handleRecoveryHealth(health = {}) {
  if (!positionTrust.trusted) return;
  const uptime = Number(health.uptimeMs);
  const firmware = health.firmwareVersion || health.firmware || '';
  if (positionTrust.firmwareVersion && firmware && firmware !== positionTrust.firmwareVersion) {
    setPositionTrust(false, 'firmware-changed');
    return;
  }
  if (Number.isFinite(positionTrust.bootUptimeMs) && Number.isFinite(uptime) && uptime < positionTrust.bootUptimeMs) {
    setPositionTrust(false, 'firmware-reboot');
    return;
  }
  if (!Number.isFinite(positionTrust.bootUptimeMs) && Number.isFinite(uptime)) {
    positionTrust.bootUptimeMs = uptime;
    positionTrust.firmwareVersion = firmware;
    storePositionTrust();
  }
}

function recoverySafeZ() {
  return Math.max(0.1, Math.min(RECOVERY_LIMITS.zMax, Number(recoverySafeZInput?.value || safeZInput?.value || 15)));
}

function automaticTravelFeed() {
  return motionSettingsModule?.travelFeedMmMin(motionSettings) ?? 3000;
}

function productionChecklistState() {
  return Object.fromEntries(productionChecklistInputs.map((input) => [input.dataset.productionCheck, input.checked]));
}

function productionSignature(plan = recoveryPlan) {
  return [
    plan?.interruption?.runId || '', plan?.activeRunPath || '', plan?.activeRunFingerprint || '',
    jobState?.activeWorkZeroId || '', jobState?.activeZZeroId || '', plan?.resumeCandidate?.lineNumber || '',
  ].join('|');
}

function recoveryWorkZeroMachine() {
  const runs = Array.isArray(jobState?.runHistory) ? jobState.runHistory : [];
  const zeroId = runs[runs.length - 1]?.zeroId || jobState?.activeWorkZeroId;
  const zero = (jobState?.zeroHistory || []).find((entry) => entry?.type === 'workZero' && entry.id === zeroId);
  return zero?.machineReference?.position || null;
}

function resetProductionWorkflow() {
  if (productionHistoryEvent?.state === 'started') {
    productionHistoryEvent.state = 'stopped';
    productionHistoryEvent.endedAt = nowIso();
    productionHistoryEvent.reason = 'Production Resume context changed before completion.';
    saveJobQuietly().catch(() => {});
  }
  clearTimeout(productionHoldTimer);
  clearInterval(productionHoldProgressTimer);
  productionHoldTimer = null;
  productionHoldProgressTimer = null;
  if (productionResumeHoldButton) productionResumeHoldButton.style.setProperty('--hold-progress', '0%');
  productionChecklistInputs.forEach((input) => { input.checked = false; });
  if (productionRouterConfirmedInput) {
    productionRouterConfirmedInput.checked = false;
    productionRouterConfirmedInput.disabled = true;
  }
  productionPhase1Complete = false;
  productionHistoryEvent = null;
  productionCommandsSent = 0;
  productionResumeCancelRequested = false;
  productionResumeFinished = false;
}

function appendRecoveryLog(message) {
  if (!recoveryLogEl) return;
  recoveryLogEl.textContent += `${message}\n`;
  recoveryLogEl.scrollTop = recoveryLogEl.scrollHeight;
}

function refreshRecoveryPlan() {
  if (!jobRecoveryModule || !jobState || !toolpathModel) {
    recoveryPlan = null;
    toollessResumePlan = null;
    renderRecoveryPanel();
    draw();
    return null;
  }
  recoveryPlan = jobRecoveryModule.planMotionOnlyRecovery({
    job: ensureJobState(),
    toolpathModel,
    activeRunFingerprint: gcodeFingerprint,
    safeZ: recoverySafeZ(),
    limits: RECOVERY_LIMITS,
    workZeroMachine: recoveryWorkZeroMachine(),
    positionTrusted: positionTrust.trusted,
    workZeroFrameMatches: workZeroMatchesMachineFrame(),
    machineState: jobRunStatus?.state,
  });
  toollessResumePlan = jobRecoveryModule.buildToollessResumePlan(recoveryPlan, toolpathModel, {
    limits: TOOLLESS_LIMITS,
    workZeroMachine: recoveryWorkZeroMachine(),
    travelFeedMmMin: automaticTravelFeed(),
    zFeedMmMin: SAFETY_Z_FEED_MM_MIN,
  });
  const nextProductionSignature = productionSignature(recoveryPlan);
  if (productionContextSignature && productionContextSignature !== nextProductionSignature && !productionResumeRunning) {
    resetProductionWorkflow();
  }
  productionContextSignature = nextProductionSignature;
  productionResumePlan = jobRecoveryModule.buildProductionResumePlan(recoveryPlan, toolpathModel, {
    limits: TOOLLESS_LIMITS,
    workZeroMachine: recoveryWorkZeroMachine(),
    travelFeedMmMin: automaticTravelFeed(),
    zFeedMmMin: SAFETY_Z_FEED_MM_MIN,
    checklist: productionChecklistState(),
    phase1Complete: productionPhase1Complete,
    manualRouterConfirmed: Boolean(productionRouterConfirmedInput?.checked),
  });
  renderRecoveryPanel();
  draw();
  return recoveryPlan;
}

function interruptedWorkZeroEntry() {
  const zeroId = recoveryPlan?.run?.zeroId;
  return zeroId ? jobState?.zeroHistory?.find((zero) => zero.id === zeroId && zero.type === 'workZero') || null : null;
}

function renderWorkZeroRestore() {
  if (!workZeroRestoreSummaryEl || !restoreSavedWorkZeroButton) return;
  const zero = interruptedWorkZeroEntry();
  const counts = zero?.machineReference?.counts || zero?.countsBefore || zero?.countsAfter;
  const position = zero?.machineReference?.position;
  const trusted = positionTrust.trusted && positionTrust.fullHoming;
  const idle = !['PREPARING', 'RUNNING', 'PAUSING', 'PAUSED', 'RESUMING', 'STOPPING'].includes(jobRunStatus?.state);
  workZeroRestoreSummaryEl.innerHTML = zero ? `
    <dl>
      <dt>Interrupted work zero</dt><dd>${html(zero.label || zero.id)}</dd>
      <dt>Captured</dt><dd>${html(zero.capturedAt || '-')}</dd>
      <dt>Machine XYZ</dt><dd>${position ? `X ${fmtValue(position.x)} Y ${fmtValue(position.y)} Z ${fmtValue(position.z)}` : 'Derived from saved counts when restoring'}</dd>
      <dt>Position trust</dt><dd>${trusted ? 'HOMED / TRUSTED' : 'HOME ALL REQUIRED'}</dd>
      <dt>Restore</dt><dd>Safe Z first, then saved XYZ and G92 X0 Y0 Z0</dd>
    </dl>
  ` : '<p>No saved work zero is linked to the interrupted run.</p>';
  restoreSavedWorkZeroButton.disabled = !zero || (!position && !counts) || !trusted || !idle;
}

async function resolveWorkZeroMachineReference(zero) {
  const motion = await motionSettingsPromise;
  const m503 = await sendCmd('M503');
  const currentSteps = motion.parseMarlinStepsPerMm(m503);
  if (!currentSteps) throw new Error('Marlin M92 steps/mm could not be read from M503.');
  const savedSteps = zero.machineReference?.stepsPerMm;
  if (savedSteps && ['x', 'y', 'z'].some((axis) => Math.abs(Number(savedSteps[axis]) - Number(currentSteps[axis])) > 0.001)) {
    throw new Error('Marlin M92 steps/mm changed after this work zero was captured. Restore is blocked.');
  }
  const counts = zero.machineReference?.counts || zero.countsBefore || zero.countsAfter;
  const savedPosition = zero.machineReference?.position;
  const position = savedPosition && ['x', 'y', 'z'].every((axis) => Number.isFinite(Number(savedPosition[axis])))
    ? { x: Number(savedPosition.x), y: Number(savedPosition.y), z: Number(savedPosition.z) }
    : motion.machinePositionFromCounts(counts, currentSteps);
  if (!position) throw new Error('Saved home-relative machine position is incomplete.');
  if (position.x < MACHINE.xMin || position.x > MACHINE.xMax || position.y < MACHINE.yMin || position.y > MACHINE.yMax) {
    throw new Error('Saved machine XY is outside configured G-code CNC limits.');
  }
  if (position.z < RECOVERY_LIMITS.zMin || position.z > RECOVERY_LIMITS.zMax) {
    throw new Error('Saved machine Z is outside configured G-code CNC limits.');
  }
  return { counts, stepsPerMm: currentSteps, position };
}

async function restoreInterruptedWorkZero() {
  if (!positionTrust.trusted || !positionTrust.fullHoming) throw new Error('Home All first so every machine axis is trusted.');
  const zero = interruptedWorkZeroEntry();
  if (!zero) throw new Error('Interrupted run has no saved work zero.');
  const reference = await resolveWorkZeroMachineReference(zero);
  const safeMachineZ = RECOVERY_LIMITS.zMax;
  if (!confirm(`Restore saved work zero and go there?\n\nThe machine will lift to machine Z${safeMachineZ.toFixed(1)}, move to machine X${reference.position.x.toFixed(3)} Y${reference.position.y.toFixed(3)}, descend to saved Z${reference.position.z.toFixed(3)}, then set G92 X0 Y0 Z0.\n\nKeep your hand near the physical emergency stop.`)) return;

  restoreSavedWorkZeroButton.disabled = true;
  appendRecoveryLog(`Restoring saved work zero at machine X${reference.position.x.toFixed(3)} Y${reference.position.y.toFixed(3)}...`);
  const res = await fetch('/api/work-zero/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      machineX: reference.position.x,
      machineY: reference.position.y,
      machineZ: reference.position.z,
      safeMachineZ,
      travelFeedMmMin: automaticTravelFeed(),
      axes: 'xyz',
      moveToZ: true,
    }),
  });
  const data = await readJsonOrThrow(res);
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Saved work zero restore failed.');

  const history = await jobHistoryPromise;
  history.recordWorkZeroRestore(ensureJobState(), zero.id, {
    machinePosition: reference.position, stepsPerMm: reference.stepsPerMm, safeMachineZ, result: 'completed',
  });
  zero.machineReference = {
    source: 'Home-relative M114 counts + M503 M92', capturedAt: zero.capturedAt,
    counts: { ...reference.counts }, stepsPerMm: { ...reference.stepsPerMm }, position: { ...reference.position },
  };
  currentMachineFrame = data.frame || currentMachineFrame;
  zero.frame = {
    homingEpoch: Number(data.frame?.homingEpoch),
    homingSessionId: data.frame?.homingSessionId || '',
    revision: Number(data.frame?.revision),
  };
  if (jobState?.activeWorkZeroId === zero.id) {
    jobState.workZero.machineReference = structuredClone(zero.machineReference);
    jobState.workZero.frame = { ...zero.frame };
  }
  if (data.response) liveToolPosition = parseM114(data.response).position;
  await saveJobQuietly();
  appendRecoveryLog('Saved home-relative XYZ work zero restored. Review recovery checks before cutting.');
  renderHistoryPanels();
  refreshRecoveryPlan();
  draw();
}

function renderRecoveryPanel() {
  renderWorkZeroRestore();
  if (recoveryTrustEl) {
    recoveryTrustEl.textContent = positionTrust.trusted ? 'POSITION TRUSTED' : 'POSITION UNTRUSTED';
    recoveryTrustEl.className = `arm-state ${positionTrust.trusted ? 'arm-ready' : 'arm-not-ready'}`;
  }
  if (!recoverySummaryEl) return;
  if (!recoveryPlan) {
    recoverySummaryEl.innerHTML = '<p>Load an active job and run history to build a recovery plan.</p>';
    if (moveToResumePointButton) moveToResumePointButton.disabled = true;
    renderToollessResumePanel();
    renderProductionResumePanel();
    return;
  }
  const candidate = recoveryPlan.resumeCandidate;
  const interruption = recoveryPlan.interruption;
  const blockers = recoveryPlan.blockingReasons || [];
  const recoveryWarnings = recoveryPlan.warnings || [];
  const available = recoveryPlan.status === 'available';
  recoverySummaryEl.innerHTML = `
    <p class="eyebrow">${available ? 'READY TO REVIEW' : 'ACTION REQUIRED'}</p>
    <strong>${candidate ? `Continue from command ${candidate.lineNumber}` : 'No safe resume point is available'}</strong>
    ${candidate ? `<p>Resume at X${fmtValue(candidate.position.x)} Y${fmtValue(candidate.position.y)} after moving at Safe Z ${fmtValue(candidate.safeZ)} mm.</p>` : ''}
    ${blockers.length ? `<ul class="readiness-blockers">${blockers.map((item) => `<li>${html(item.message)}</li>`).join('')}</ul>` : '<p class="ok-text">Interrupted file, machine position and work zero match.</p>'}
    ${recoveryWarnings.length ? `<ul class="dry-run-errors">${recoveryWarnings.map((item) => `<li>${html(item.message)}</li>`).join('')}</ul>` : ''}
    <details class="operator-diagnostics"><summary>Recovery details</summary>
      <dl>
        <dt>Interrupted run</dt><dd>${html(interruption?.runId || '-')}</dd>
        <dt>Run file</dt><dd>${html(recoveryPlan.run?.activeRunPath || '-')}</dd>
        <dt>Last acknowledged / sent</dt><dd>${recoveryPlan.run?.lastAckedLineNumber ?? '-'} / ${recoveryPlan.run?.lastSentLineNumber ?? '-'}</dd>
        <dt>Interrupted / resume command</dt><dd>${interruption?.lineNumber ?? '-'} / ${candidate?.lineNumber ?? '-'}</dd>
        <dt>Confidence</dt><dd>${html(candidate?.confidence || '-')}</dd>
      </dl>
    </details>
  `;
  if (moveToResumePointButton) moveToResumePointButton.disabled = recoveryPlan.status !== 'available' || toollessResumeRunning || productionResumeRunning;
  renderToollessResumePanel();
  renderProductionResumePanel();
}

function renderToollessResumePanel() {
  if (!toollessResumeSummaryEl) return;
  const plan = toollessResumePlan;
  if (!plan) {
    toollessResumeSummaryEl.innerHTML = '<p>Recovery plan is required before Toolless Resume Test.</p>';
    if (toollessResumeStartButton) toollessResumeStartButton.disabled = true;
    return;
  }
  const blockers = plan.blockingReasons || [];
  const warnings = plan.warnings || [];
  toollessResumeSummaryEl.innerHTML = `
    <dl>
      <dt>Status</dt><dd>${html(plan.status.toUpperCase())}</dd>
      <dt>Active run</dt><dd>${html(recoveryPlan?.activeRunPath || '-')}</dd>
      <dt>Resume command</dt><dd>${plan.startLineNumber ?? '-'}</dd>
      <dt>Safe reposition</dt><dd>${plan.resumePoint ? `X${fmtValue(plan.resumePoint.x)} Y${fmtValue(plan.resumePoint.y)} Z${fmtValue(plan.safeZ)}` : '-'}</dd>
      <dt>First Z descent</dt><dd>${plan.firstZDescent ? `command ${plan.firstZDescent.lineNumber}: Z${fmtValue(plan.firstZDescent.fromZ)} → Z${fmtValue(plan.firstZDescent.toZ)}` : '-'}</dd>
      <dt>Remaining min Z</dt><dd>${Number.isFinite(plan.minZ) ? `${fmtValue(plan.minZ)} mm` : '-'}</dd>
      <dt>Remaining path</dt><dd>${Math.round(plan.distanceMm || 0)} mm / ~${Math.max(1, Math.round(plan.estimatedSeconds || 0))} sec</dd>
      <dt>Commands</dt><dd>${plan.commands?.length || 0}</dd>
    </dl>
    ${blockers.length ? `<ul class="readiness-blockers">${blockers.map((item) => `<li>${html(item.message)}</li>`).join('')}</ul>` : ''}
    ${warnings.length ? `<ul class="dry-run-errors">${warnings.map((message) => `<li>${html(message)}</li>`).join('')}</ul>` : ''}
  `;
  if (toollessResumeStartButton) {
    toollessResumeStartButton.disabled = toollessResumeRunning || productionResumeRunning || plan.status !== 'available' || !toollessNoCutterInput?.checked;
    toollessResumeStartButton.textContent = toollessResumeRunning ? 'Resume Motion Test Running…' : 'Toolless Resume From Point';
  }
}

function renderProductionResumePanel() {
  if (!productionResumeSummaryEl) return;
  const plan = productionResumePlan;
  if (!plan) {
    productionResumeSummaryEl.innerHTML = '<p>Recovery plan is required before Production Resume.</p>';
    if (productionPrepareButton) productionPrepareButton.disabled = true;
    if (productionResumeHoldButton) productionResumeHoldButton.disabled = true;
    return;
  }
  const workZeroBlocked = plan.blockingReasons?.some((item) => item.id === 'workZeroMismatch');
  const nonChecklistBlockers = (plan.blockingReasons || []).filter((item) => item.id !== 'checklist');
  if (productionZChangeChecks) productionZChangeChecks.hidden = !plan.zZeroChanged;
  productionChecklistInputs.forEach((input) => {
    input.disabled = productionPhase1Complete || productionResumeRunning || productionResumeFinished;
  });
  productionResumeSummaryEl.innerHTML = `
    <dl>
      <dt>State</dt><dd>${plan.status.toUpperCase()}</dd>
      <dt>Active run</dt><dd>${html(recoveryPlan?.activeRunPath || '-')}</dd>
      <dt>Resume command</dt><dd>${plan.startLineNumber ?? '-'}</dd>
      <dt>Safe Z</dt><dd>${fmtValue(plan.safeZ)} mm</dd>
      <dt>First descent</dt><dd>${plan.firstZDescent ? `Z${fmtValue(plan.firstZDescent.fromZ)} → Z${fmtValue(plan.firstZDescent.toZ)}` : '-'}</dd>
      <dt>Remaining min Z</dt><dd>${Number.isFinite(plan.minZ) ? `${fmtValue(plan.minZ)} mm` : '-'}</dd>
      <dt>Remaining path</dt><dd>${Math.round(plan.distanceMm || 0)} mm / ~${Math.max(1, Math.round(plan.estimatedSeconds || 0))} sec</dd>
      <dt>Work zero</dt><dd><span class="${workZeroBlocked ? 'fail-text' : 'ok-text'}">${workZeroBlocked ? 'BLOCKED — changed' : 'MATCH'}</span></dd>
      <dt>Tool/Z zero</dt><dd><span class="${plan.zZeroChanged ? 'warning' : 'ok-text'}">${plan.zZeroChanged ? 'NEEDS ACKNOWLEDGEMENT — changed' : 'UNCHANGED'}</span></dd>
      <dt>Phase 1</dt><dd>${productionPhase1Complete ? 'AT RESUME POINT' : 'NOT PREPARED'}</dd>
      <dt>Manual router checkpoint</dt><dd>${productionRouterConfirmedInput?.checked ? 'CONFIRMED' : 'WAITING'}</dd>
    </dl>
    ${workZeroBlocked ? '<p class="warning">Work zero changed after the interrupted run. Resume is blocked because XY/material origin may no longer match the material.</p>' : ''}
    ${plan.zZeroChanged ? '<p class="warning">Z zero changed after the interrupted run. This is OK if you changed or re-touched the tool intentionally.</p>' : '<p class="ok-text">Z zero unchanged.</p>'}
    ${nonChecklistBlockers.length ? `<ul class="readiness-blockers">${nonChecklistBlockers.map((item) => `<li>${html(item.message)}</li>`).join('')}</ul>` : ''}
  `;
  if (productionPrepareButton) {
    productionPrepareButton.disabled = productionResumeRunning || productionResumeFinished || productionPhase1Complete || plan.status !== 'available';
    productionPrepareButton.textContent = productionPhase1Complete ? 'Phase 1 Complete: At Resume Point' : 'Phase 1: Reposition at Safe Z';
  }
  if (productionRouterConfirmedInput) productionRouterConfirmedInput.disabled = !productionPhase1Complete || productionResumeRunning;
  if (productionResumeHoldButton) {
    productionResumeHoldButton.disabled = productionResumeRunning || productionResumeFinished || !plan.phase2Ready || plan.status !== 'available';
    productionResumeHoldButton.textContent = productionResumeRunning ? 'Resume Cutting…' : 'Hold to Resume Cutting';
  }
}

function cancelProductionHold() {
  clearTimeout(productionHoldTimer);
  clearInterval(productionHoldProgressTimer);
  productionHoldTimer = null;
  productionHoldProgressTimer = null;
  if (productionResumeHoldButton && !productionResumeRunning) {
    productionResumeHoldButton.style.setProperty('--hold-progress', '0%');
    productionResumeHoldButton.textContent = 'Hold to Resume Cutting';
  }
}

function startProductionHold(event) {
  if (productionResumeHoldButton?.disabled || productionHoldTimer || productionResumeRunning) return;
  event.preventDefault();
  const started = Date.now();
  if (Number.isFinite(event.pointerId)) productionResumeHoldButton.setPointerCapture?.(event.pointerId);
  productionResumeHoldButton.textContent = 'Keep holding…';
  productionHoldProgressTimer = setInterval(() => {
    const progress = Math.min(100, ((Date.now() - started) / 1500) * 100);
    productionResumeHoldButton.style.setProperty('--hold-progress', `${progress}%`);
  }, 50);
  productionHoldTimer = setTimeout(() => {
    cancelProductionHold();
    continueProductionResume().catch((err) => appendRecoveryLog(`Production Resume failed: ${err.message}`));
  }, 1500);
}

async function recordRecoveryMove(result, commandsSent, error = '') {
  if (!jobState || !recoveryPlan) return;
  const history = await jobHistoryPromise;
  const candidate = recoveryPlan.resumeCandidate;
  history.appendMotionOnlyRecoveryEvent(ensureJobState(), {
    runId: recoveryPlan.interruption?.runId,
    activeRunPath: recoveryPlan.activeRunPath,
    activeRunMode: recoveryPlan.run?.activeRunMode || currentRunMode(),
    activeRunFingerprint: recoveryPlan.activeRunFingerprint,
    resumeLineNumber: candidate?.lineNumber,
    resumePoint: candidate?.position,
    safeZ: candidate?.safeZ ?? recoverySafeZ(),
    result,
    commandsSent,
    reason: error,
  });
  await saveJobQuietly();
  renderHistoryPanels();
}

async function runMotionOnlyRecoveryMove() {
  const plan = refreshRecoveryPlan();
  const generated = jobRecoveryModule?.buildMotionOnlyRecoveryCommands(plan, {
    positionTrusted: positionTrust.trusted,
    limits: RECOVERY_LIMITS,
    workZeroMachine: recoveryWorkZeroMachine(),
    travelFeedMmMin: automaticTravelFeed(),
    zFeedMmMin: SAFETY_Z_FEED_MM_MIN,
  });
  if (!generated?.ok) {
    const reason = (generated?.blockingReasons || []).map((item) => item.message).join(' ');
    appendRecoveryLog(`Blocked: ${reason}`);
    await recordRecoveryMove('blocked', [], reason).catch(() => {});
    return;
  }
  if (!confirm('MOTION TEST ONLY: This will send M5, lift to Safe Z, and move XY to the proposed resume point. It will not descend or resume cutting. Keep your hand near the physical emergency stop.')) return;

  moveToResumePointButton.disabled = true;
  const sent = [];
  try {
    for (const command of generated.commands) {
      appendRecoveryLog(`> ${command}`);
      const response = await sendCmd(command);
      sent.push(command);
      if (response) appendRecoveryLog(response.trim());
    }
    appendRecoveryLog('Motion-only recovery move complete. Machine remains at Safe Z.');
    await recordRecoveryMove('completed', sent);
  } catch (err) {
    appendRecoveryLog(`Motion-only recovery stopped: ${err.message}`);
    await recordRecoveryMove('error', sent, err.message).catch(() => {});
  } finally {
    refreshRecoveryPlan();
  }
}

async function startToollessResumeTest() {
  if (productionResumeRunning || productionPhase1Complete) {
    appendRecoveryLog('Toolless Resume blocked while a Production Resume workflow is prepared or running.');
    return;
  }
  if (dryRunStatus === 'running') {
    appendRecoveryLog('Toolless Resume blocked while another dry-run command stream is active.');
    return;
  }
  refreshRecoveryPlan();
  const plan = toollessResumePlan;
  if (!plan || plan.status !== 'available' || !plan.commands?.length) {
    appendRecoveryLog(`Toolless Resume blocked: ${plan?.reason || 'plan unavailable'}`);
    return;
  }
  if (!toollessNoCutterInput?.checked) {
    appendRecoveryLog('Toolless Resume blocked: confirm that no cutter/router is installed.');
    return;
  }
  if (!confirm('TOOLLESS RESUME TEST: The machine will follow the remaining real X/Y/Z path. No cutter/router may be installed. Spindle stays off. Keep your hand near the physical emergency stop.')) return;

  const history = await jobHistoryPromise;
  const event = history.appendToollessResumeEvent(ensureJobState(), {
    runId: recoveryPlan?.interruption?.runId,
    activeRunPath: recoveryPlan?.activeRunPath,
    activeRunMode: recoveryPlan?.run?.activeRunMode || currentRunMode(),
    activeRunFingerprint: recoveryPlan?.activeRunFingerprint,
    startLineNumber: plan.startLineNumber,
    resumePoint: plan.resumePoint,
    safeZ: plan.safeZ,
    minZ: plan.minZ,
    commandsCount: plan.commands.length,
  });
  await saveJobQuietly();
  renderHistoryPanels();

  toollessResumeRunning = true;
  toollessResumeCancelRequested = false;
  setDryRunRunning(true);
  renderRunPanel();
  renderRecoveryPanel();
  let sent = 0;
  try {
    const finalStatus = await startTestMotionStream('toolless', plan.commands, plan.safeZ, (status) => {
      sent = Number(status.acknowledgedLineCount || 0);
      appendRecoveryLog(`Toolless stream ${sent}/${plan.commands.length} (${Number(status.progressPercent || 0).toFixed(1)}%)`);
    });
    sent = Number(finalStatus.acknowledgedLineCount || sent);
    history.finishToollessResumeEvent(event, { state: 'completed', commandsSent: sent });
    appendRecoveryLog('Toolless Resume Test complete. Spindle remained off. This was not a cutting resume.');
  } catch (err) {
    const stopped = err.name === 'TestMotionStopped' || toollessResumeCancelRequested;
    history.finishToollessResumeEvent(event, {
      state: stopped ? 'stopped' : 'error', commandsSent: sent, reason: err.message,
    });
    await sendCmdBestEffort('M5');
    appendRecoveryLog(`${stopped ? 'Toolless Resume stopped' : 'Toolless Resume error'} after ${sent} commands: ${err.message}`);
  } finally {
    toollessResumeRunning = false;
    toollessResumeCancelRequested = false;
    setDryRunRunning(false);
    renderRunPanel();
    await saveJobQuietly().catch(() => {});
    renderHistoryPanels();
    refreshRecoveryPlan();
  }
}

function cancelToollessResumeFromControl(type) {
  if (!toollessResumeRunning && !productionResumeRunning && !activeTestMotion) return;
  if (toollessResumeRunning) toollessResumeCancelRequested = true;
  if (productionResumeRunning) productionResumeCancelRequested = true;
  appendRecoveryLog(`Operator ${type.toUpperCase()} requested. No further recovery path commands will be sent.`);
  if (activeTestMotion && (type === 'stop' || type === 'pause' || type === 'm5')) {
    fetch('/api/job/stop', { method: 'POST' }).catch(() => {});
  }
  if (type === 'stop' || type === 'pause') {
    fetch('/api/jog/stop', { method: 'POST' }).catch(() => {});
    setPositionTrust(false, `recovery-${type}`);
  }
}

async function sendProductionCommands(commands, label) {
  for (const command of commands) {
    if (productionResumeCancelRequested) {
      const stopped = new Error('Production Resume stopped by operator control.');
      stopped.name = 'ProductionResumeStopped';
      throw stopped;
    }
    appendRecoveryLog(`> ${label} [${productionCommandsSent + 1}] ${command}`);
    const response = await sendCmd(command);
    productionCommandsSent += 1;
    if (response) appendRecoveryLog(response.trim());
  }
}

async function syncProductionResumeFromStatus(status) {
  const history = await jobHistoryPromise;
  const job = ensureJobState();
  const event = [...(job.recoveryHistory || [])].reverse().find((item) =>
    item.type === 'production-resume' && item.state === 'started' &&
    (!item.streamPath || item.streamPath === status.gcodePath));
  if (!event) return;
  productionHistoryEvent = event;
  productionPhase1Complete = Boolean(event.phase1CompletedAt);
  productionCommandsSent = Number(status.acknowledgedLineCount || 0);
  if (status.state === 'COMPLETED') {
    history.finishProductionResumeEvent(event, { state: 'completed', commandsSent: productionCommandsSent });
    productionResumeFinished = true;
  } else if (status.state === 'STOPPED' || status.state === 'ERROR') {
    history.finishProductionResumeEvent(event, {
      state: status.state === 'STOPPED' ? 'stopped' : 'error',
      commandsSent: productionCommandsSent,
      reason: status.lastError || status.streamingPausedReason || `Firmware stream ${status.state.toLowerCase()}`,
    });
    productionResumeFinished = true;
  } else {
    productionResumeRunning = ['PREPARING', 'RUNNING', 'PAUSING', 'PAUSED', 'RESUMING', 'STOPPING'].includes(status.state);
  }
  if (productionResumeFinished) {
    if (job.productionResumeAuthorization?.eventId === event.id) {
      job.productionResumeAuthorization.authorized = false;
      job.productionResumeAuthorization.finishedAt = nowIso();
    }
    await saveJobQuietly().catch(() => {});
  }
}

async function startProductionResumeStream(commands) {
  const path = testMotionPath('production-resume');
  const history = await jobHistoryPromise;
  const { toolpath } = await toolpathModulesPromise;
  recoveryMotionSegments = toolpath.parseGCodeToToolpath(`${commands.join('\n')}\n`, {
    initialPosition: productionResumePlan?.resumePoint,
  }).segments;
  lastMotionSequence = 0;
  stopMotionAnimation();
  history.markProductionResumeRouterConfirmed(productionHistoryEvent, { streamPath: path });
  ensureJobState().productionResumeAuthorization = {
    authorized: true,
    eventId: productionHistoryEvent.id,
    interruptedRunId: productionHistoryEvent.runId,
    activeRunPath: productionHistoryEvent.activeRunPath,
    activeRunMode: productionHistoryEvent.activeRunMode,
    activeRunFingerprint: productionHistoryEvent.activeRunFingerprint,
    streamPath: path,
    authorizedAt: nowIso(),
  };
  await saveJobQuietly();
  await uploadGeneratedRun(path, `${commands.join('\n')}\n`);

  const res = await fetch('/api/recovery/production/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path,
      jobPath: jobPathFor(filePath),
      activeRunPath: productionHistoryEvent.activeRunPath,
      activeRunMode: productionHistoryEvent.activeRunMode,
      activeRunFingerprint: productionHistoryEvent.activeRunFingerprint,
      eventId: productionHistoryEvent.id,
      interruptedRunId: productionHistoryEvent.runId,
    }),
  });
  const started = await readJsonOrThrow(res);
  if (!res.ok) throw new Error(started.error || 'Firmware Production Resume start failed');
  activeTestMotion = { mode: 'production-resume', path };
  await applyJobRunStatus(started);

  return new Promise((resolve, reject) => {
    let unsubscribe = null;
    let fallbackTimer = null;
    const finish = (callback, value) => {
      unsubscribe?.();
      if (fallbackTimer) clearInterval(fallbackTimer);
      activeTestMotion = null;
      callback(value);
    };
    const observe = (status) => {
      if (status?.streamMode !== 'production-resume' || status?.gcodePath !== path) return;
      productionCommandsSent = Number(status.acknowledgedLineCount || 0);
      appendRecoveryLog(`Firmware Phase 2: ${productionCommandsSent}/${status.sentLineCount || commands.length} acknowledged`);
      if (status.state === 'COMPLETED') finish(resolve, status);
      else if (status.state === 'STOPPED') finish(reject, Object.assign(new Error('Production Resume stopped by operator control.'), { name: 'ProductionResumeStopped' }));
      else if (status.state === 'ERROR') finish(reject, new Error(status.lastError || 'Firmware Production Resume stream failed.'));
    };
    if (window.CncTelemetry) {
      unsubscribe = window.CncTelemetry.subscribe('job', observe);
      window.CncTelemetry.request('job').catch(() => {});
    } else {
      fallbackTimer = setInterval(async () => {
        try {
          const statusRes = await fetch('/api/job/status');
          observe(await readJsonOrThrow(statusRes));
        } catch (err) {
          // Firmware owns the stream; a browser/network outage must not stop cutting.
        }
      }, 1000);
    }
  });
}

async function prepareProductionResume() {
  refreshRecoveryPlan();
  const generated = jobRecoveryModule?.buildProductionResumeCommands(productionResumePlan, 'phase1');
  if (!generated?.ok) {
    appendRecoveryLog(`Production Resume blocked: ${(generated?.blockingReasons || []).map((item) => item.message).join(' ')}`);
    return;
  }
  if (!confirm('PRODUCTION RESUME PHASE 1: M5 will be sent, Z will lift, and axes will move to the safe resume point. No cutting path starts yet. Continue?')) return;

  const history = await jobHistoryPromise;
  productionHistoryEvent = history.appendProductionResumeEvent(ensureJobState(), {
    runId: recoveryPlan?.interruption?.runId,
    activeRunPath: recoveryPlan?.activeRunPath,
    activeRunMode: recoveryPlan?.run?.activeRunMode || currentRunMode(),
    activeRunFingerprint: recoveryPlan?.activeRunFingerprint,
    startLineNumber: productionResumePlan.startLineNumber,
    resumePoint: productionResumePlan.resumePoint,
    safeZ: productionResumePlan.safeZ,
    minZ: productionResumePlan.minZ,
    commandsCount: productionResumePlan.phase1Commands.length + productionResumePlan.phase2Commands.length,
    checklist: productionResumePlan.checklist,
    zZeroChanged: productionResumePlan.zZeroChanged,
    previousZZeroId: productionResumePlan.previousZZeroId,
    currentZZeroId: productionResumePlan.currentZZeroId,
    zZeroChangeAcknowledged: productionResumePlan.zZeroChangeAcknowledged,
  });
  productionCommandsSent = 0;
  productionResumeCancelRequested = false;
  productionResumeRunning = true;
  setDryRunRunning(true);
  renderRunPanel();
  renderRecoveryPanel();
  try {
    await sendProductionCommands(generated.commands, 'Production Phase 1');
    history.markProductionResumePrepared(productionHistoryEvent);
    productionPhase1Complete = true;
    appendRecoveryLog('At resume point. Start/verify router manually, confirm the checkpoint, then hold Resume Cutting.');
  } catch (err) {
    const stopped = err.name === 'ProductionResumeStopped' || productionResumeCancelRequested;
    history.finishProductionResumeEvent(productionHistoryEvent, {
      state: stopped ? 'stopped' : 'error', commandsSent: productionCommandsSent, reason: err.message,
    });
    productionResumeFinished = true;
    await sendCmdBestEffort('M5');
    appendRecoveryLog(`Production Phase 1 ${stopped ? 'stopped' : 'failed'}: ${err.message}`);
  } finally {
    productionResumeRunning = false;
    productionResumeCancelRequested = false;
    setDryRunRunning(false);
    await saveJobQuietly().catch(() => {});
    renderHistoryPanels();
    renderRunPanel();
    refreshRecoveryPlan();
  }
}

async function continueProductionResume() {
  refreshRecoveryPlan();
  const generated = jobRecoveryModule?.buildProductionResumeCommands(productionResumePlan, 'phase2');
  if (!generated?.ok || !productionHistoryEvent) {
    appendRecoveryLog(`Production Phase 2 blocked: ${(generated?.blockingReasons || []).map((item) => item.message).join(' ') || 'Phase 1 history is missing.'}`);
    return;
  }
  productionResumeCancelRequested = false;
  productionResumeRunning = true;
  setDryRunRunning(true);
  renderRunPanel();
  renderRecoveryPanel();
  const history = await jobHistoryPromise;
  try {
    appendRecoveryLog('Production Phase 2 handed to the ESP32. The browser now monitors firmware progress only.');
    const finalStatus = await startProductionResumeStream(generated.commands);
    productionCommandsSent = Number(finalStatus?.acknowledgedLineCount || generated.commands.length);
    history.finishProductionResumeEvent(productionHistoryEvent, {
      state: 'completed', commandsSent: productionCommandsSent,
    });
    productionResumeFinished = true;
    appendRecoveryLog('Firmware Production Resume stream complete. Verify router is stopped and inspect the job before any further action.');
  } catch (err) {
    const stopped = err.name === 'ProductionResumeStopped' || productionResumeCancelRequested;
    history.finishProductionResumeEvent(productionHistoryEvent, {
      state: stopped ? 'stopped' : 'error', commandsSent: productionCommandsSent, reason: err.message,
    });
    productionResumeFinished = true;
    await sendCmdBestEffort('M5');
    appendRecoveryLog(`Production Resume ${stopped ? 'stopped' : 'failed'}: ${err.message}`);
  } finally {
    productionResumeRunning = false;
    productionResumeCancelRequested = false;
    setDryRunRunning(false);
    await saveJobQuietly().catch(() => {});
    renderHistoryPanels();
    renderRunPanel();
    refreshRecoveryPlan();
  }
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
  const type = zero.type === 'zZero' ? 'Z Zero' : zero.axes === 'x' ? 'X Zero' : zero.axes === 'y' ? 'Y Zero' : 'Work Zero';
  return `${type}${zero.label ? ` - ${zero.label}` : ''}`;
}

function localTimestamp(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString([], {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function lastRunForZero(zero) {
  const ids = new Set(Array.isArray(zero?.usedByRuns) ? zero.usedByRuns : []);
  return [...(jobState?.runHistory || [])]
    .filter((run) => ids.has(run.id))
    .sort((a, b) => new Date(b.endedAt || b.startedAt || 0) - new Date(a.endedAt || a.startedAt || 0))[0] || null;
}

function restorableWorkZeros() {
  return [...(jobState?.zeroHistory || [])]
    .filter((zero) => zero?.type === 'workZero' && ['x', 'y', 'z'].every((axis) => (
      Number.isFinite(Number(zero.machineReference?.position?.[axis]))
    )))
    .reverse();
}

function selectedPrepareWorkZero() {
  const id = prepareWorkZeroHistorySelect?.value || '';
  return restorableWorkZeros().find((zero) => zero.id === id) || null;
}

function renderPrepareWorkZeroHistory() {
  if (!prepareWorkZeroHistorySelect || !restorePrepareWorkZeroButton || !prepareWorkZeroHintEl) return;
  const entries = restorableWorkZeros();
  const previousId = prepareWorkZeroHistorySelect.value;
  prepareWorkZeroHistorySelect.textContent = '';
  if (!entries.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No saved work zeros';
    prepareWorkZeroHistorySelect.append(option);
    prepareWorkZeroHistorySelect.disabled = true;
    restorePrepareWorkZeroButton.disabled = true;
    prepareWorkZeroHintEl.textContent = 'Set Work Zero once to add the first history entry.';
    return;
  }
  entries.forEach((zero) => {
    const position = zero.machineReference.position;
    const option = document.createElement('option');
    option.value = zero.id;
    option.textContent = `${zero.label || localTimestamp(zero.capturedAt)} — X ${fmtValue(position.x)} Y ${fmtValue(position.y)} Z ${fmtValue(position.z)}`;
    prepareWorkZeroHistorySelect.append(option);
  });
  const preferredId = entries.some((zero) => zero.id === previousId)
    ? previousId
    : entries.some((zero) => zero.id === jobState?.activeWorkZeroId)
      ? jobState.activeWorkZeroId
      : entries[0].id;
  prepareWorkZeroHistorySelect.value = preferredId;
  prepareWorkZeroHistorySelect.disabled = false;
  const homed = positionTrust.trusted && positionTrust.fullHoming && currentMachineFrame?.absoluteFromHome === true;
  const busy = ['PREPARING', 'RUNNING', 'PAUSING', 'PAUSED', 'RESUMING', 'STOPPING']
    .includes(String(jobRunStatus?.state || '').toUpperCase());
  restorePrepareWorkZeroButton.disabled = !homed || busy;
  prepareWorkZeroHintEl.textContent = homed
    ? 'Restore moves via Safe Z and activates this zero in the current homing session.'
    : 'Home All first, then restore the selected zero into the current machine session.';
}

function renderZeroOriginPanel() {
  if (!zeroOriginSummaryEl) return;
  const zero = activeZero('workZero');
  const position = zero?.machineReference?.position || jobState?.workZero?.machineReference?.position;
  const zeroSession = zero?.frame?.homingSessionId || jobState?.workZero?.frame?.homingSessionId || '';
  const frameTrusted = currentMachineFrame?.trusted === true && currentMachineFrame?.absoluteFromHome === true;
  const sameSession = Boolean(zeroSession && zeroSession === currentMachineFrame?.homingSessionId);
  const savedPosition = ['x', 'y', 'z'].every((axis) => Number.isFinite(Number(position?.[axis])));
  const trustworthy = currentMachineFrame?.workZeroValid === true && frameTrusted && sameSession && savedPosition;
  if (homeMachineZeroButton) homeMachineZeroButton.hidden = frameTrusted;
  zeroOriginSummaryEl.innerHTML = trustworthy ? `
    <p class="zero-origin-label">Active work zero</p>
    <div class="zero-origin-coordinates">
      <span><small>X</small>${fmtValue(position.x)}</span>
      <span><small>Y</small>${fmtValue(position.y)}</span>
      <span><small>Z</small>${fmtValue(position.z)}</span>
    </div>
    <p class="form-hint">${jobExists ? `Saved to this job${zero?.capturedAt ? ` · Last saved: ${localTimestamp(zero.capturedAt)}` : ''}` : 'Not saved yet'}</p>
  ` : `
    <p class="zero-origin-label">Work zero from home</p>
    <p class="zero-origin-unknown">Unknown — Home machine first</p>
    <p class="form-hint">${jobExists ? 'Saved metadata cannot be trusted in the current homing session.' : 'Not saved yet'}</p>
  `;
  if (!trustworthy && savedPosition) {
    zeroOriginSummaryEl.innerHTML = `
      <p class="zero-origin-label">Saved work zero — not active</p>
      <div class="zero-origin-coordinates">
        <span><small>X</small>${fmtValue(position.x)}</span>
        <span><small>Y</small>${fmtValue(position.y)}</span>
        <span><small>Z</small>${fmtValue(position.z)}</span>
      </div>
      <p class="warning">This saved zero is not active in the current machine session. Home All, then use Restore &amp; Activate below.</p>
    `;
  }
  renderPrepareWorkZeroHistory();
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
  renderZeroOriginPanel();
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
  refreshRecoveryPlan();
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
  if (!toolZeroResultEl) {
    setJobResult(message, isError);
    return;
  }
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

function dryRunModeIsAircut() {
  return Boolean(dryRunAircutToggle?.checked);
}

function selectedDryRunCommands() {
  return dryRunModeIsAircut() ? aircutCommands : traceCommands;
}

function selectedDryRunSafety() {
  return dryRunModeIsAircut() ? aircutSafety : traceSafety;
}

function dryRunPrimaryLabel() {
  return dryRunModeIsAircut() ? 'Send Aircut Toolpath' : 'Send Box Trace';
}

function isDryRunWarningMessage(message) {
  return /^Large aircut\./i.test(message || '');
}

function dryRunStatusMessage() {
  const safety = selectedDryRunSafety();
  const commands = selectedDryRunCommands();
  const blocking = safety.messages.find((message) => !isDryRunWarningMessage(message));
  if (blocking) return { text: blocking, error: true };
  if (!commands.length) {
    return {
      text: dryRunModeIsAircut() ? 'Aircut toolpath could not be generated.' : 'Box trace could not be generated.',
      error: true,
    };
  }
  const warning = safety.messages.find((message) => isDryRunWarningMessage(message));
  if (warning) return { text: warning, error: false };
  return { text: dryRunModeIsAircut() ? 'Ready to send the Safe Z aircut toolpath.' : 'Ready to send the Safe Z box trace.', error: false };
}

function setDryRunRunning(isRunning) {
  const safety = selectedDryRunSafety();
  const commands = selectedDryRunCommands();
  if (sendDryRunButton) {
    sendDryRunButton.textContent = dryRunPrimaryLabel();
    sendDryRunButton.disabled = isRunning || !safety.ok || commands.length === 0;
  }
}

function showCommandPreview(label, commands) {
  if (!traceCommandsEl) return;
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
    messages.push(`Generated X/Y bounds exceed machine limits X ${MACHINE.xMin}..${MACHINE.xMax}, Y ${MACHINE.yMin}..${MACHINE.yMax}.`);
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
    messages.push(`Generated X/Y bounds exceed machine limits X ${MACHINE.xMin}..${MACHINE.xMax}, Y ${MACHINE.yMin}..${MACHINE.yMax}.`);
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
      `G0 Z${fmtMm(safeZ)} F${SAFETY_Z_FEED_MM_MIN}`,
      `G0 X${fmtMm(bounds.xMin)} Y${fmtMm(bounds.yMin)} F${automaticTravelFeed()}`,
      `G0 X${fmtMm(bounds.xMax)} Y${fmtMm(bounds.yMin)} F${automaticTravelFeed()}`,
      `G0 X${fmtMm(bounds.xMax)} Y${fmtMm(bounds.yMax)} F${automaticTravelFeed()}`,
      `G0 X${fmtMm(bounds.xMin)} Y${fmtMm(bounds.yMax)} F${automaticTravelFeed()}`,
      `G0 X${fmtMm(bounds.xMin)} Y${fmtMm(bounds.yMin)} F${automaticTravelFeed()}`,
      `G0 Z${fmtMm(safeZ)} F${SAFETY_Z_FEED_MM_MIN}`,
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
  const isArc = segment.type === 'arc' && segment.arc?.center && Number.isFinite(segment.arc.sweepRadians);
  if (!isArc && segment.from.x === segment.to.x && segment.from.y === segment.to.y) return null;
  if (!isArc && previousPoint && previousPoint.x === x && previousPoint.y === y) return null;
  const rapid = segment.rapid ?? segment.type === 'rapid';
  const move = isArc ? (segment.arc.sweepRadians < 0 ? 'G2' : 'G3') : rapid ? 'G0' : 'G1';
  const feedValue = segment.feedrate ?? segment.feed;
  const feed = rapid
    ? ` F${automaticTravelFeed()}`
    : Number.isFinite(feedValue) ? ` F${fmtMm(feedValue)}` : '';
  const arcWords = isArc
    ? ` I${fmtMm(segment.arc.center.x - segment.from.x)} J${fmtMm(segment.arc.center.y - segment.from.y)}`
    : '';
  return {
    command: `${move} X${fmtMm(x)} Y${fmtMm(y)}${arcWords}${feed}`,
    point: { x, y },
  };
}

function ensureZeroState(job) {
  if (!job) return job;
  const workZero = job.workZero || {};
  job.workZero = {
    ...emptyWorkZero(),
    ...workZero,
    beforeG92: normalizedCapture(workZero.beforeG92),
    afterG92: normalizedCapture(workZero.afterG92),
  };
  const toolZero = job.toolZero || {};
  job.toolZero = {
    ...emptyToolZero(),
    ...toolZero,
    beforeG92Z: normalizedCapture(toolZero.beforeG92Z),
    afterG92Z: normalizedCapture(toolZero.afterG92Z),
  };
  return job;
}

function generateAircutCommands() {
  const safeZ = Number(safeZInput.value);
  aircutCommands = [];
  let previousPoint = null;
  let truncated = false;
  const maxMovementCommands = 20000;

  if (parsed && Number.isFinite(safeZ)) {
    aircutCommands = ['M5', 'G21', 'G90', 'G54', `G0 Z${fmtMm(safeZ)} F${SAFETY_Z_FEED_MM_MIN}`];
    for (const segment of toolpathModel?.segments || parsed.segments) {
      const item = commandForSegment(segment, previousPoint);
      if (!item) continue;
      aircutCommands.push(item.command);
      previousPoint = item.point;
      if (aircutCommands.length >= maxMovementCommands) {
        truncated = true;
        break;
      }
    }
    aircutCommands.push(`G0 Z${fmtMm(safeZ)} F${SAFETY_Z_FEED_MM_MIN}`, 'M400');
  }

  aircutSafety = validateAircut(safeZ, aircutCommands.length);
  if (truncated) aircutSafety.messages.push('Aircut command list was limited to keep the browser responsive.');
  showCommandPreview('Aircut', aircutCommands);
  setDryRunRunning(dryRunStatus === 'running');
  renderDryRunPanel();
}

function traceCommandsWithReturnPosition(commands, capture) {
  const position = capture?.position || {};
  if (!['x', 'y', 'z'].every((axis) => Number.isFinite(Number(position[axis])))) {
    throw new Error('Current X/Y/Z could not be read; bounding box trace was not started.');
  }
  const result = [...commands];
  const finalWait = result.lastIndexOf('M400');
  const insertAt = finalWait >= 0 ? finalWait : result.length;
  result.splice(insertAt, 0,
    `G0 X${fmtMm(position.x)} Y${fmtMm(position.y)} F${automaticTravelFeed()}`,
    `G0 Z${fmtMm(position.z)} F${SAFETY_Z_FEED_MM_MIN}`,
  );
  return result;
}

function testMotionPath(mode) {
  const sourceName = basename(currentRunPath() || filePath || 'motion.gc').replace(/[^A-Za-z0-9._-]/g, '_');
  return `/jobs/generated/${sourceName}.${mode}.gc`;
}

async function startTestMotionStream(mode, commands, safeZ, onProgress = () => {}) {
  if (activeTestMotion) throw new Error('Another test-motion stream is already active.');
  const path = testMotionPath(mode);
  await uploadGeneratedRun(path, `${commands.join('\n')}\n`);

  const res = await fetch('/api/test-motion/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, mode, safeZ }),
  });
  const started = await readJsonOrThrow(res);
  if (!res.ok) throw new Error(started.error || 'Test motion start failed');
  activeTestMotion = { mode, path };
  await applyJobRunStatus(started);

  return new Promise((resolve, reject) => {
    let unsubscribe = null;
    let fallbackTimer = null;
    const finish = (callback, value) => {
      unsubscribe?.();
      if (fallbackTimer) clearInterval(fallbackTimer);
      activeTestMotion = null;
      callback(value);
    };
    const observe = (status) => {
      if (status?.streamMode !== mode || status?.gcodePath !== path) return;
      onProgress(status);
      if (status.state === 'COMPLETED') finish(resolve, status);
      else if (status.state === 'STOPPED') {
        const error = new Error('Test motion stopped by operator control.');
        error.name = 'TestMotionStopped';
        finish(reject, error);
      } else if (status.state === 'ERROR') {
        finish(reject, new Error(status.lastError || 'Test motion firmware stream failed.'));
      }
    };

    if (window.CncTelemetry) {
      unsubscribe = window.CncTelemetry.subscribe('job', observe);
      window.CncTelemetry.request('job').catch(() => {});
    } else {
      fallbackTimer = setInterval(async () => {
        try {
          const statusRes = await fetch('/api/job/status');
          observe(await readJsonOrThrow(statusRes));
        } catch (err) {
          // The firmware stream continues; retry status on the next interval.
        }
      }, 1000);
    }
  });
}

function renderDryRunPanel() {
  const bounds = generatedBounds();
  const safeZ = Number(safeZInput.value);
  const margin = Number(traceMarginInput.value);
  const width = bounds ? bounds.xMax - bounds.xMin : Number.NaN;
  const height = bounds ? bounds.yMax - bounds.yMin : Number.NaN;
  dryRunSummaryEl.innerHTML = `
    <dl>
      <dt>Box</dt><dd>${Number.isFinite(width) && Number.isFinite(height) ? `${width.toFixed(2)} × ${height.toFixed(2)} mm` : '-'}</dd>
      <dt>Safe Z</dt><dd>${Number.isFinite(safeZ) ? `${safeZ} mm` : '-'}</dd>
      <dt>Margin</dt><dd>${Number.isFinite(margin) ? `${margin} mm` : '-'}</dd>
      <dt>Aircut toolpath</dt><dd>${dryRunModeIsAircut() ? 'ON' : 'OFF'}</dd>
      <dt>Status</dt><dd>${dryRunStatus}</dd>
    </dl>
  `;

  if (dryRunStatusEl) {
    const statusMessage = dryRunStatusMessage();
    dryRunStatusEl.textContent = statusMessage.text;
    dryRunStatusEl.classList.toggle('warning', statusMessage.error);
  }

  setDryRunRunning(/running/i.test(dryRunStatus));
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
      <dt>Start mode</dt><dd>use saved active work zero</dd>
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
    zeroHistorySummaryEl.textContent = 'No saved zeros for this job yet.';
    return;
  }

  entries.forEach((zero) => {
    const article = document.createElement('article');
    article.className = 'history-entry';
    const active = (zero.type === 'workZero' && zero.id === jobState.activeWorkZeroId) ||
      (zero.type === 'zZero' && zero.id === jobState.activeZZeroId);
    const position = zero.machineReference?.position;
    const run = lastRunForZero(zero);
    const runState = String(run?.state || '').toLowerCase();
    const suspicious = runState === 'completed' && /timeout|error|alarm/i.test(run?.reason || '');
    const runClass = runState === 'error' ? 'history-error' : runState === 'completed' ? 'history-success' : 'history-warning';
    article.innerHTML = `
      <div class="history-head">
        <strong>${html(zeroTitle(zero))}</strong>
        ${active ? '<span class="status-badge active-badge">Active</span>' : ''}
      </div>
      <p class="history-position">${position
        ? `X ${fmtValue(position.x)} · Y ${fmtValue(position.y)} · Z ${fmtValue(position.z)}`
        : 'Legacy zero — machine position not recorded'}</p>
      <p class="history-meta">Created: ${html(localTimestamp(zero.capturedAt))} · Used: ${(zero.usedByRuns || []).length}× · Restored: ${(zero.restores || []).length}×</p>
      <p class="history-last-run ${run ? runClass : ''}">${run
        ? `Last run: ${html(runState || 'unknown')}${suspicious ? ' ⚠' : ''} · ${html(localTimestamp(run.endedAt || run.startedAt))}`
        : 'Last run: not used yet'}</p>
      <div class="history-actions">
        <button type="button" class="restore-history-zero" ${position ? '' : 'disabled'}>Restore &amp; Go</button>
      </div>
      <details class="history-details">
        <summary>Details</summary>
        <dl>
          <dt>Zero ID</dt><dd>${html(zero.id || '-')}</dd>
          <dt>Method</dt><dd>${html(zero.method || '-')}</dd>
          <dt>Raw before</dt><dd>${html(zero.rawM114Before || '-')}</dd>
          <dt>Raw after</dt><dd>${html(zero.rawM114After || '-')}</dd>
          <dt>Used by run IDs</dt><dd>${html((zero.usedByRuns || []).join(', ') || '-')}</dd>
        </dl>
        <pre>${html(JSON.stringify(zero, null, 2))}</pre>
      </details>
    `;
    article.querySelector('.restore-history-zero')?.addEventListener('click', () => {
      restoreHistoryZero(zero).catch((err) => setJobResult(err.message, true));
    });
    zeroHistorySummaryEl.append(article);
  });
}

async function restoreHistoryZero(zero) {
  if (!positionTrust.trusted || !positionTrust.fullHoming) {
    throw new Error('Home All first so the saved point can be resolved from machine home.');
  }
  const activeStates = ['PREPARING', 'RUNNING', 'PAUSING', 'PAUSED', 'RESUMING', 'STOPPING'];
  if (activeStates.includes(String(jobRunStatus?.state || '').toUpperCase())) {
    throw new Error('Stop the active job before restoring a zero.');
  }
  const reference = await resolveWorkZeroMachineReference(zero);
  const safeMachineZ = RECOVERY_LIMITS.zMax;
  const axes = zero.type === 'zZero' ? 'z' : 'xyz';
  const zeroLabel = zero.type === 'zZero' ? 'Z zero' : 'work zero';
  if (!confirm(`Restore this ${zeroLabel} and go there?\n\nThe machine will lift to Z${safeMachineZ.toFixed(1)}, move to machine X${reference.position.x.toFixed(3)} Y${reference.position.y.toFixed(3)}, then descend to saved Z${reference.position.z.toFixed(3)}.\n\nKeep your hand near the physical emergency stop.`)) return;

  const res = await fetch('/api/work-zero/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      machineX: reference.position.x,
      machineY: reference.position.y,
      machineZ: reference.position.z,
      safeMachineZ,
      travelFeedMmMin: automaticTravelFeed(),
      axes,
      moveToZ: true,
    }),
  });
  const data = await readJsonOrThrow(res);
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Zero restore failed.');

  const history = await jobHistoryPromise;
  const job = ensureJobState();
  history.recordZeroRestore(job, zero.id, {
    machinePosition: reference.position,
    stepsPerMm: reference.stepsPerMm,
    safeMachineZ,
    result: 'completed',
  });
  currentMachineFrame = data.frame || currentMachineFrame;
  zero.machineReference = {
    ...zero.machineReference,
    position: { ...reference.position },
    counts: reference.counts ? { ...reference.counts } : null,
    stepsPerMm: { ...reference.stepsPerMm },
  };
  zero.frame = {
    homingEpoch: Number(data.frame?.homingEpoch),
    homingSessionId: data.frame?.homingSessionId || '',
    revision: Number(data.frame?.revision),
  };
  if (zero.type === 'workZero') {
    job.workZero.machineReference = structuredClone(zero.machineReference);
    job.workZero.frame = { ...zero.frame };
  } else if (job.workZero?.machineReference?.position && data.frame?.workZeroMachine) {
    job.workZero.machineReference.position = { ...data.frame.workZeroMachine };
    job.workZero.frame = { ...zero.frame };
  }
  if (job.arm?.state === 'ARMED') job.arm.state = 'STALE';
  if (data.response) liveToolPosition = parseM114(data.response).position;
  await saveJobQuietly();
  zeroHistoryDialog?.close?.();
  setJobResult(`${zeroLabel === 'Z zero' ? 'Z zero' : 'Work zero'} restored and active.`);
  renderHistoryPanels();
  renderReadiness();
  renderJobPanel();
  renderToolZeroPanel();
  renderPreflight();
  renderArmPanel();
  refreshRecoveryPlan();
  draw();
}

function operatorZeroError(error) {
  const message = String(error?.message || error || '');
  if (/home all|required before setting|homing/i.test(message)) return 'Home machine first';
  if (/verify|confirm|m114|capture|acknowledge/i.test(message)) return 'Could not verify zero';
  return 'Could not set zero';
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

  const loaded = await res.json();
  if (!isJobV3(loaded)) {
    jobExists = false;
    jobState = newJobState();
    setJobResult('Old job setup is not supported. Create a new setup for this file.', true);
    renderJobPanel();
    renderFeedOverridePanel();
    renderPreflight();
    return;
  }
  jobState = loaded;
  Object.assign(jobState, workflowFor(jobState));
  ensureZeroState(jobState);
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
  if (!jobState.startMode) jobState.startMode = 'use_active_work_zero';
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
  const json = JSON.stringify(job);
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
    const loaded = await res.json();
    return isJobV3(loaded) && loaded.sourceGcodePath === filePath ? loaded : null;
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
  const placement = resolvedPlacement(transform, sourceToolpathModel || toolpathModel);
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
  refreshRecoveryPlan();
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
  const json = JSON.stringify(job);
  const file = new File([json], basename(job.jobPath), { type: 'application/json' });
  const form = new FormData();
  form.append('path', '/jobs');
  form.append('file', file);
  const res = await fetch('/api/upload?overwrite=true', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Preview metadata save failed');
}

function previewCanvasPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Browser could not encode the preview thumbnail PNG'));
    }, 'image/png');
  });
}

async function ensurePreviewThumbnailDirectory() {
  const res = await fetch('/api/mkdir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/jobs/thumbs' }),
  });
  if (!res.ok && res.status !== 409) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not create thumbnail folder');
  }
}

async function storedThumbnailExists(path) {
  if (!path) return false;
  const res = await fetch(`/api/download?path=${encodeURIComponent(path)}`).catch(() => null);
  return Boolean(res?.ok);
}

async function createMissingPreviewThumbnail(existingPath = '') {
  if (await storedThumbnailExists(existingPath)) return existingPath;
  const [{ toolpath }, thumbnail] = await Promise.all([toolpathModulesPromise, thumbnailModulePromise]);
  const model = sourceToolpathModel || toolpathModel;
  if (!model) return existingPath || '';
  const canvas = document.createElement('canvas');
  canvas.width = thumbnail.THUMBNAIL_SIZE;
  canvas.height = thumbnail.THUMBNAIL_SIZE;
  if (!toolpath.renderToolpathToCanvas(model, canvas, {
    width: thumbnail.THUMBNAIL_SIZE,
    height: thumbnail.THUMBNAIL_SIZE,
  })) return existingPath || '';

  const blob = await previewCanvasPngBlob(canvas);
  const thumbnailPath = thumbnail.thumbnailPathFor(basename(filePath));
  await ensurePreviewThumbnailDirectory();
  const form = new FormData();
  form.append('path', '/jobs/thumbs');
  form.append('file', new File([blob], basename(thumbnailPath), { type: 'image/png' }));
  const res = await fetch('/api/upload?overwrite=true', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Thumbnail upload failed');
  return thumbnailPath;
}

async function syncPreviewMetadata() {
  if (!toolpathModel || !previewSummaryData) return;
  try {
    const { adapter } = await toolpathModulesPromise;
    const existing = await loadExistingJobJson();
    const base = existing || ensureJobState();
    let thumbnailPath = base.thumbnailPath || '';
    try {
      thumbnailPath = await createMissingPreviewThumbnail(thumbnailPath);
    } catch (err) {
      appendRunLog(`Thumbnail was not saved: ${err.message}`);
    }
    const merged = adapter.mergePreviewIntoJob({
      ...base,
      updatedAt: nowIso(),
      gcodePath: filePath,
      jobPath: jobPathFor(filePath),
    }, toolpathModel, thumbnailPath || null);
    await uploadJobJson(merged);
    jobState = merged;
    Object.assign(jobState, workflowFor(jobState));
    jobExists = true;
    // Routine preview persistence stays silent; this status area is reserved for operator actions.
  } catch (err) {
    appendRunLog(`Preview metadata was not saved: ${err.message}`);
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

async function armJob(options = {}) {
  const automatic = options.automatic === true;
  const blockers = armBlockers();
  if (blockers.length) {
    setArmResult(`Cannot arm: ${blockers.join(' ')}`, true);
    renderArmPanel();
    return false;
  }

  const warnings = armWarnings();
  if (warnings.length && !automatic) {
    const text = `${warnings.length} warning(s) exist.\n\nWarnings exist. Confirm that you have reviewed them before arming this job.`;
    if (!confirm(text)) return false;
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
    checklist: automatic ? runChecklistState() : checklistState(),
    source: automatic ? 'review-and-start' : 'manual-arm',
  };

  try {
    await saveJob();
    setArmResult(`Job armed and saved at ${job.arm.armedAt}`);
    renderArmPanel();
    return true;
  } catch (err) {
    job.startAuthorization = emptyWorkflow().startAuthorization;
    job.startAuthorizationToken = '';
    job.arm = previousArm;
    setArmResult(`Arm failed because the job JSON could not be saved: ${err.message}`, true);
    renderArmPanel();
    return false;
  }
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

  let confirmText = 'This will move the CNC around the job bounding box at safe Z, return to the starting X/Y, and then restore the starting Z. Keep your hand near the physical emergency stop.';
  const hasPreflightFail = currentPreflight?.checks?.some((check) => check.level === 'fail');
  if (hasPreflightFail) {
    confirmText += '\n\nPreflight has failed checks. Review them before continuing.';
  }
  if (!confirm(confirmText)) return;
  if (hasPreflightFail && !confirm('Preflight has failed checks. Continue with bounding box trace anyway?')) return;

  const returnCapture = await captureM114();
  const executionCommands = traceCommandsWithReturnPosition(traceCommands, returnCapture);

  dryRunStatus = 'running';
  setDryRunRunning(true);
  dryRunLogEl.textContent = '';
  renderDryRunPanel();
  appendDryRunLog(`Return position: X${fmtMm(returnCapture.position.x)} Y${fmtMm(returnCapture.position.y)} Z${fmtMm(returnCapture.position.z)}`);

  try {
    for (let i = 0; i < executionCommands.length; i += 1) {
      const cmd = executionCommands[i];
      appendDryRunLog(`> [${i + 1}/${executionCommands.length}] ${cmd}`);
      const response = await sendCmd(cmd);
      appendDryRunLog(response || '(ok)');
    }
    dryRunStatus = 'complete';
    if (jobState) {
      jobState.dryRun = dryRunSummary();
      jobState.dryRun.lastBoundingBoxTraceAt = nowIso();
      jobState.dryRun.lastBoundingBoxTraceStatus = 'complete';
      await recordPhysicalVerification('bounds', {
        safeZ: Number(safeZInput.value), margin: Number(traceMarginInput.value),
      });
    }
    appendDryRunLog('Bounding box trace complete; starting X/Y/Z restored');
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

  let confirmText = 'This will move the CNC through the full XY toolpath at safe Z without cutting. Spindle/laser start commands are suppressed. Keep your hand near the physical emergency stop.';
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
    const finalStatus = await startTestMotionStream('aircut', aircutCommands, Number(safeZInput.value), (status) => {
      appendDryRunLog(`Aircut stream ${Number(status.acknowledgedLineCount || 0)}/${aircutCommands.length} (${Number(status.progressPercent || 0).toFixed(1)}%)`);
    });
    dryRunStatus = 'aircut complete';
    if (jobState) {
      jobState.dryRun = dryRunSummary();
      jobState.dryRun.lastAircutAt = nowIso();
      jobState.dryRun.lastAircutStatus = 'complete';
      jobState.dryRun.lastAircutCommandCount = Number(finalStatus.acknowledgedLineCount || aircutCommands.length);
      await recordPhysicalVerification('aircut', {
        safeZ: Number(safeZInput.value), margin: Number(traceMarginInput.value),
      });
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

async function setZZeroWithCapture(transaction = null, options = {}) {
  if (!(await canChangeZZero())) return;
  if (!transaction && options.confirm === true && !confirm('This will set only the current Z position as work Z0. X/Y work zero will not be changed.')) return;

  const toolZero = ensureToolZeroState();
  let data = transaction;
  if (!data) {
    const res = await fetch('/api/work-zero/set-z', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    data = await readJsonOrThrow(res);
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Set Z Zero failed');
  }
  const before = parseM114(data.before || '');
  const after = parseM114(data.after || '');
  currentMachineFrame = data.frame || currentMachineFrame;
  toolZero.method = 'G92 Z0';
  toolZero.capturedAt = nowIso();
  toolZero.beforeG92Z = before;
  toolZero.afterG92Z = after;
  const machineZ = Number(data.frame?.workZeroMachine?.z);
  if (Number.isFinite(machineZ) && jobState?.workZero?.machineReference?.position) {
    jobState.workZero.machineReference.position.z = machineZ;
    jobState.workZero.frame = {
      homingEpoch: Number(data.frame.homingEpoch),
      homingSessionId: data.frame.homingSessionId || '',
      revision: Number(data.frame.revision),
    };
    const activeZero = (jobState.zeroHistory || []).find((entry) => entry.id === jobState.activeWorkZeroId);
    if (activeZero?.machineReference?.position) {
      activeZero.machineReference.position.z = machineZ;
      activeZero.frame = { ...jobState.workZero.frame };
    }
  }
  const history = await jobHistoryPromise;
  const zMachinePosition = data.frame?.workZeroMachine;
  history.appendZZeroHistory(ensureJobState(), {
    before,
    after,
    capturedAt: toolZero.capturedAt,
    machineReference: zMachinePosition ? {
      source: 'firmware absolute Home All frame', capturedAt: toolZero.capturedAt,
      position: { ...zMachinePosition }, counts: { ...before.counts },
      stepsPerMm: { ...(data.frame?.homeReference?.stepsPerMm || {}) },
    } : null,
    frame: {
      homingEpoch: Number(data.frame?.homingEpoch),
      homingSessionId: data.frame?.homingSessionId || '',
      revision: Number(data.frame?.revision),
    },
  });
  markArmStaleForZZero();
  setJobResult('Z zero saved');
  renderToolZeroPanel();
  renderHistoryPanels();
  renderArmPanel();
  refreshRecoveryPlan();
  await saveJobQuietly();
  renderZeroOriginPanel();
}

async function saveToolZeroToJob() {
  ensureToolZeroState();
  await saveJob();
  setToolZeroResult(`Saved Tool/Z Zero to ${jobPathFor(filePath)}`);
}

async function setWorkZeroWithCapture(transaction = null, axes = 'xyz') {
  const selectedAxes = ['x', 'y'].includes(axes) ? axes : 'xyz';
  const job = ensureJobState();
  let data = transaction;
  if (!data) {
    const res = await fetch('/api/work-zero/set', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ axes: selectedAxes }),
    });
    data = await readJsonOrThrow(res);
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Set Work Zero failed');
  }
  const before = parseM114(data.before || '');
  const after = parseM114(data.after || '');
  currentMachineFrame = data.frame || currentMachineFrame;
  const axesToVerify = selectedAxes === 'xyz' ? ['x', 'y', 'z'] : [selectedAxes];
  const zeroConfirmed = axesToVerify.every((axis) => (
    Number.isFinite(Number(after.position?.[axis])) && Math.abs(Number(after.position[axis])) <= 0.02
  ));
  if (!zeroConfirmed) {
    throw new Error('Could not verify zero');
  }

  const machinePosition = data.frame?.workZeroMachine;
  const machineReference = machinePosition ? {
    source: 'firmware absolute Home All frame', capturedAt: nowIso(), position: { ...machinePosition },
    counts: { ...before.counts },
    stepsPerMm: { ...(data.frame?.homeReference?.stepsPerMm || {}) },
  } : null;
  job.workZero.capturedAt = nowIso();
  job.workZero.beforeG92 = before;
  job.workZero.afterG92 = after;
  job.workZero.machineReference = machineReference;
  job.workZero.frame = {
    homingEpoch: Number(data.frame?.homingEpoch),
    homingSessionId: data.frame?.homingSessionId || '',
    revision: Number(data.frame?.revision),
  };
  job.startMode = 'use_active_work_zero';
  if (startModeSelect) startModeSelect.value = job.startMode;
  const history = await jobHistoryPromise;
  history.appendWorkZeroHistory(job, {
    before,
    after,
    capturedAt: job.workZero.capturedAt,
    machineReference,
    frame: job.workZero.frame,
    axes: selectedAxes,
    method: selectedAxes === 'xyz' ? 'G92 X0 Y0 Z0' : `G92 ${selectedAxes.toUpperCase()}0`,
  });
  if (selectedAxes === 'xyz') {
    job.frameDecision = {
      mode: 'homed',
      bootSessionId: data.frame?.bootSessionId || '',
      homingSessionId: data.frame?.homingSessionId || '',
      acknowledgedAt: nowIso(),
    };
    job.workZeroDecision = {
      mode: 'homed',
      token: job.activeWorkZeroId || `homed:${data.frame?.homingSessionId || ''}:${job.workZero.capturedAt}`,
      bootSessionId: data.frame?.bootSessionId || '',
      capturedAt: job.workZero.capturedAt,
    };
    job.verificationDecision = emptyWorkflow().verificationDecision;
  }
  if (job.arm?.state === 'ARMED') job.arm.state = 'STALE';
  await saveJobQuietly();
  setJobResult(selectedAxes === 'x' ? 'X zero saved' : selectedAxes === 'y' ? 'Y zero saved' : 'Work zero saved');
  renderJobPanel();
  renderToolZeroPanel();
  renderHistoryPanels();
  renderPreflight();
  renderArmPanel();
  generateTraceCommands();
  refreshRecoveryPlan();
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
    warnings.push(`Toolpath exceeds machine work area X ${MACHINE.xMin}..${MACHINE.xMax}, Y ${MACHINE.yMin}..${MACHINE.yMax}.`);
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

function recoveryOverlayBounds() {
  if (!recoveryPlan?.visual) return null;
  const points = [
    recoveryPlan.visual.interruptionMarker,
    recoveryPlan.visual.resumeMarker,
    ...(recoveryPlan.visual.recoveryTravelPath || []),
  ].filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  if (!points.length) return null;
  return {
    xMin: Math.min(...points.map((point) => point.x)),
    xMax: Math.max(...points.map((point) => point.x)),
    yMin: Math.min(...points.map((point) => point.y)),
    yMax: Math.max(...points.map((point) => point.y)),
  };
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
  if (mode === 'recovery') {
    const bounds = canvasTableBounds(recoveryOverlayBounds());
    if (hasBounds(bounds)) {
      const span = Math.max(40, bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin);
      return {
        xMin: bounds.xMin - span * 0.25,
        xMax: bounds.xMax + span * 0.25,
        yMin: bounds.yMin - span * 0.25,
        yMax: bounds.yMax + span * 0.25,
      };
    }
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
    const verification = jobState?.verificationDecision || {};
    if (verification.result === 'complete' && ['bounds', 'aircut'].includes(verification.type)) {
      const margin = Number(verification.margin || 0);
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
  if (recoveryOverlayVisible && recoveryPlan?.visual) {
    const visual = recoveryPlan.visual;
    drawSegments(visual.completedSegments, jobPx, jobPy, {
      showTravel: true, cutColor: '#9aa4ac', travelColor: '#77828a', alpha: 0.38, cutWidth: 1.2,
    });
    drawSegments(visual.remainingSegments, jobPx, jobPy, {
      showTravel: true, cutColor: colors.cut, travelColor: colors.travel, alpha: 0.9, cutWidth: 2,
    });
    const travel = visual.recoveryTravelPath || [];
    if (travel.length > 1) {
      ctx.save();
      ctx.strokeStyle = colors.position;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(jobPx(travel[0].x), jobPy(travel[0].y));
      for (let index = 1; index < travel.length; index += 1) ctx.lineTo(jobPx(travel[index].x), jobPy(travel[index].y));
      ctx.stroke();
      ctx.restore();
    }
    const drawRecoveryMarker = (point, color, label) => {
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
      const x = jobPx(point.x);
      const y = jobPy(point.y);
      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = '#081015';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillText(label, x + 10, y - 8);
      ctx.restore();
    };
    drawRecoveryMarker(visual.interruptionMarker, '#ff5f69', 'INTERRUPTED');
    drawRecoveryMarker(visual.resumeMarker, '#62b0ff', 'RESUME AT SAFE Z');
    ctx.save();
    ctx.fillStyle = 'rgba(8, 16, 21, 0.78)';
    ctx.fillRect(12, 12, 188, 24);
    ctx.fillStyle = '#dce8ee';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillText('Motion-only recovery preview', 20, 28);
    ctx.restore();
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
  const workflow = jobState ? guidedWorkflowStatus() : null;
  const canvasWarnings = [];
  if (workflow?.frame.mode === 'manual-unhomed') canvasWarnings.push('UNHOMED POSITION');
  if (workflow?.verification.type === 'skipped') canvasWarnings.push('PHYSICAL CHECK SKIPPED');
  if (canvasWarnings.length) {
    ctx.save();
    ctx.font = '700 11px system-ui, sans-serif';
    const label = canvasWarnings.join(' · ');
    const width = Math.min(w - 24, ctx.measureText(label).width + 20);
    ctx.fillStyle = 'rgba(140, 68, 12, 0.9)';
    ctx.fillRect(12, h - 38, width, 26);
    ctx.fillStyle = '#fff4df';
    ctx.fillText(label, 22, h - 21);
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
  const placement = resolvedPlacement(transform, placementModel);
  applyPlacementToInputs(placement);
  transformedPreview = Math.abs(placement.rotationDeg) < 0.0001 && !placement.autoShiftToWorkZero
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
  const placement = resolvedPlacement(transform, placementModel);
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
      <dt>Auto fit</dt><dd>${placement.autoShiftToWorkZero ? 'Cut lower-left moved to work zero' : 'Not needed'}</dd>
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
    messages.push('Placement bounds exceed configured G-code CNC work area.');
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
  const placement = resolvedPlacement(transform, sourceToolpathModel);
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
  const placement = resolvedPlacement(transform, sourceToolpathModel);
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
  const placement = resolvedPlacement(transform, placementModel);
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
  await motionSettingsPromise;
  await loadMachineLimits();
  try {
    const frameRes = await fetch('/api/machine/frame');
    if (frameRes.ok) currentMachineFrame = await frameRes.json();
  } catch (err) {
    currentMachineFrame = null;
  }
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

  sourceGcodeSizeBytes = Number(res.headers.get('content-length')) || 0;
  renderPreviewFileWarning();
  sourceGcodeText = await res.text();
  if (!sourceGcodeSizeBytes) {
    sourceGcodeSizeBytes = new Blob([sourceGcodeText]).size;
    renderPreviewFileWarning();
  }
  gcodeText = sourceGcodeText;
  const existingJob = await loadExistingJobJson();
  if (existingJob) {
    jobState = existingJob;
    ensureZeroState(jobState);
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
    if (!jobState.startMode) jobState.startMode = 'use_active_work_zero';
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
  await jobRecoveryPromise;
  refreshRecoveryPlan();
  draw();
  await syncPreviewMetadata();
  if (!jobExists) await checkJobExists();
}

function refreshDryRunCommands() {
  generateTraceCommands();
  if (dryRunModeIsAircut()) generateAircutCommands();
  else renderDryRunPanel();
}

async function sendSelectedDryRun() {
  if (dryRunModeIsAircut()) await sendAircutToolpath();
  else await sendBoundingBoxTrace();
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
loadJobButton?.addEventListener('click', () => loadJob().catch((err) => setJobResult(err.message, true)));
saveJobButton?.addEventListener('click', () => saveJob().catch((err) => setJobResult(err.message, true)));
saveJobPreflightButton?.addEventListener('click', () => saveJobWithPreflight().catch((err) => setJobResult(err.message, true)));
capturePositionButton?.addEventListener('click', () => captureCurrentPosition().catch((err) => setJobResult(err.message, true)));
setWorkZeroButton?.addEventListener('click', () => setWorkZeroWithCapture(null, 'xyz').catch((err) => setJobResult(operatorZeroError(err), true)));
readinessHomeAllButton?.addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('cnc-home-machine-request'));
});
homeMachineZeroButton?.addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('cnc-home-machine-request'));
});
restorePrepareWorkZeroButton?.addEventListener('click', () => {
  const zero = selectedPrepareWorkZero();
  if (!zero) {
    setJobResult('Select a saved work zero first.', true);
    return;
  }
  restoreHistoryZero(zero).catch((err) => setJobResult(err.message, true));
});
setZeroXButton?.addEventListener('click', () => setWorkZeroWithCapture(null, 'x').catch((err) => setJobResult(operatorZeroError(err), true)));
setZeroYButton?.addEventListener('click', () => setWorkZeroWithCapture(null, 'y').catch((err) => setJobResult(operatorZeroError(err), true)));
captureSetZeroButton?.addEventListener('click', () => setWorkZeroWithCapture().catch((err) => setJobResult(err.message, true)));
downloadJobButton?.addEventListener('click', downloadJobJson);
openZeroHistoryButton?.addEventListener('click', () => {
  renderHistoryPanels();
  if (zeroHistoryDialog?.showModal) zeroHistoryDialog.showModal();
  else zeroHistoryDialog?.setAttribute('open', '');
});
closeZeroHistoryButton?.addEventListener('click', () => zeroHistoryDialog?.close?.());
feedStartButtons.forEach((button) => {
  button.addEventListener('click', () => setFeedStartPercent(button.dataset.feedStart));
});
feedStartPercentInput?.addEventListener('change', () => setFeedStartPercent(feedStartPercentInput.value));
refreshPreflightButton?.addEventListener('click', renderPreflight);
sendDryRunButton?.addEventListener('click', () => sendSelectedDryRun().catch((err) => appendDryRunLog(`Dry run failed: ${err.message}`)));
stopM5Button?.addEventListener('click', stopSpindleM5);
armJobButton?.addEventListener('click', () => armJob().catch((err) => setArmResult(err.message, true)));
disarmJobButton?.addEventListener('click', disarmJob);
saveArmedJobButton?.addEventListener('click', () => saveArmedJob().catch((err) => setArmResult(err.message, true)));
downloadArmedJobButton?.addEventListener('click', downloadJobJson);
armChecklistInputs.forEach((input) => input.addEventListener('change', renderArmPanel));
toolCapturePositionButton?.addEventListener('click', () => captureToolPosition().catch((err) => setToolZeroResult(err.message, true)));
setZZeroButton?.addEventListener('click', () => setZZeroWithCapture(null, { confirm: false }).catch((err) => setJobResult(operatorZeroError(err), true)));
captureSetZZeroButton?.addEventListener('click', () => setZZeroWithCapture().catch((err) => setToolZeroResult(err.message, true)));
saveToolZeroButton?.addEventListener('click', () => saveToolZeroToJob().catch((err) => setToolZeroResult(err.message, true)));
workbenchUiPromise.then((ui) => {
  installHoldAction(startJobButton, reviewAndStartJobRun, ui.actionPolicy('start_cut'));
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
dryRunAircutToggle?.addEventListener('change', refreshDryRunCommands);
recoverySafeZInput?.addEventListener('input', refreshRecoveryPlan);
recoveryOverlayInput?.addEventListener('change', () => {
  recoveryOverlayVisible = Boolean(recoveryOverlayInput.checked);
  draw();
});
recoveryTrustButton?.addEventListener('click', () => {
  if (!confirm('Confirm that the machine has been homed in this powered session and has not been moved manually. Position trust is required for recovery motion.')) return;
  setPositionTrust(true, 'operator-confirmed-home-all', true);
});
recoveryUntrustButton?.addEventListener('click', () => setPositionTrust(false, 'operator-marked-untrusted'));
restoreSavedWorkZeroButton?.addEventListener('click', () => {
  restoreInterruptedWorkZero().catch((err) => {
    appendRecoveryLog(`Work zero restore blocked: ${err.message}`);
    renderWorkZeroRestore();
  });
});
fitResumePointButton?.addEventListener('click', () => {
  if (!recoveryPlan?.resumeCandidate) return;
  recoveryOverlayVisible = true;
  if (recoveryOverlayInput) recoveryOverlayInput.checked = true;
  workbenchController?.fit('recovery');
  draw();
});
moveToResumePointButton?.addEventListener('click', () => runMotionOnlyRecoveryMove());
toollessNoCutterInput?.addEventListener('change', renderToollessResumePanel);
toollessResumeStartButton?.addEventListener('click', () => {
  startToollessResumeTest().catch((err) => appendRecoveryLog(`Toolless Resume failed: ${err.message}`));
});
productionChecklistInputs.forEach((input) => input.addEventListener('change', refreshRecoveryPlan));
productionRouterConfirmedInput?.addEventListener('change', refreshRecoveryPlan);
productionPrepareButton?.addEventListener('click', () => {
  prepareProductionResume().catch((err) => appendRecoveryLog(`Production Phase 1 failed: ${err.message}`));
});
productionResumeHoldButton?.addEventListener('pointerdown', startProductionHold);
['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave'].forEach((type) => {
  productionResumeHoldButton?.addEventListener(type, cancelProductionHold);
});
productionResumeHoldButton?.addEventListener('keydown', (event) => {
  if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) startProductionHold(event);
});
productionResumeHoldButton?.addEventListener('keyup', cancelProductionHold);
productionResumeHoldButton?.addEventListener('contextmenu', (event) => event.preventDefault());
cancelRecoveryButton?.addEventListener('click', () => {
  if (toollessResumeRunning || productionResumeRunning) return;
  resetProductionWorkflow();
  setPositionTrust(false, 'recovery-cancelled');
  recoveryOverlayVisible = false;
  if (recoveryOverlayInput) recoveryOverlayInput.checked = false;
  if (recoveryLogEl) recoveryLogEl.textContent = '';
  draw();
});
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
  if (position.frame) currentMachineFrame = position.frame;
  liveToolPosition = { ...position };
  draw();
});
addEventListener('cnc-machine-frame', (event) => {
  currentMachineFrame = event.detail || currentMachineFrame;
  renderZeroOriginPanel();
  renderPreflight();
  renderArmPanel();
  draw();
});
addEventListener('cnc-work-zero-set', (event) => {
  if (!event.detail?.frame || !jobState) return;
  currentMachineFrame = event.detail.frame;
  setWorkZeroWithCapture(event.detail).catch((err) => setJobResult(err.message, true));
});
addEventListener('cnc-z-zero-set', (event) => {
  if (!event.detail?.frame || !jobState) return;
  currentMachineFrame = event.detail.frame;
  setZZeroWithCapture(event.detail).catch((err) => setToolZeroResult(err.message, true));
});
addEventListener('cnc-position-trust', (event) => {
  if (event.detail?.trusted) setPositionTrust(true, event.detail.source || 'homing', event.detail.fullHoming === true);
  else setPositionTrust(false, event.detail?.source || 'external');
});
addEventListener('cnc-critical-control', (event) => {
  cancelToollessResumeFromControl(event.detail?.type || 'stop');
});
document.addEventListener('visibilitychange', () => {
  // Firmware owns active streams. Hiding or sleeping the browser must never issue motion control.
  if (document.hidden) {
    motionResyncPending = true;
    lastMotionSequence = Number(jobRunStatus?.currentLineNumber) || lastMotionSequence;
    stopMotionAnimation();
  }
});
addEventListener('cnc-motion-settings-change', (event) => {
  motionSettings = motionSettingsModule?.saveMotionSettings(event.detail || {}) || motionSettings;
  generateTraceCommands();
  generateAircutCommands();
  refreshRecoveryPlan();
});
addEventListener('error', (event) => {
  appendRunLog(`Browser error: ${event.message}`);
  if (stopJobButton) stopJobButton.disabled = false;
});
addEventListener('unhandledrejection', (event) => {
  appendRunLog(`Browser promise error: ${event.reason?.message || event.reason}`);
  if (stopJobButton) stopJobButton.disabled = false;
});
restorePositionTrust();
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
renderRecoveryPanel();
jobRecoveryPromise.then(refreshRecoveryPlan).catch((err) => appendRecoveryLog(`Recovery planner unavailable: ${err.message}`));
jobReadinessPromise.then(renderReadiness).catch((err) => {
  if (readinessSummaryEl) readinessSummaryEl.textContent = `Readiness unavailable: ${err.message}`;
});
loadPreview().catch(() => redirectToFiles(filePath));
window.CncTelemetry?.subscribe('job', (data) => {
  applyJobRunStatus(data).catch((err) => appendRunLog(`Status update failed: ${err.message}`));
  if (String(data?.state || '').toUpperCase() === 'RUNNING' && data?.lastCommand) {
    if (motionResyncPending) {
      lastMotionSequence = Number(data.currentLineNumber) || lastMotionSequence;
      motionResyncPending = false;
      stopMotionAnimation();
      return;
    }
    handleMotionTelemetry({
      events: [{ sequence: data.currentLineNumber, command: data.lastCommand }],
      feedOverridePercent: data.feedOverridePercent,
    });
  }
  if (String(data?.state || '').toUpperCase() === 'PREPARING') {
    lastMotionSequence = 0;
    stopMotionAnimation();
  }
  if (['PAUSED', 'STOPPED', 'COMPLETED', 'ERROR'].includes(String(data?.state || '').toUpperCase())) {
    stopMotionAnimation();
  }
});
window.CncTelemetry?.subscribe('motion', handleMotionTelemetry);
window.CncTelemetry?.subscribe('health', handleRecoveryHealth);
window.CncTelemetry?.setDemand('job', 'preview-page', true);
window.CncTelemetry?.setDemand('health', 'preview-page', true);
window.CncTelemetry?.start();
if (runPanel) refreshJobStatus().catch(() => {
  jobStatusHealthy = false;
  renderRunPanel();
  renderWorkbenchStatus();
});
