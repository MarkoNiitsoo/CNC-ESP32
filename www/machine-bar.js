(function () {
  const STATE = {
    job: { state: 'UNKNOWN' },
    health: null,
    position: { x: null, y: null, z: null },
    frame: { machine: null, work: null, workZeroMachine: null, homingEpoch: 0, trusted: false },
    drawerOpen: false,
    jogDockOpen: false,
    jogSettingsOpen: false,
    lastMessage: '',
    marlinLog: { entries: [], lastCritical: null },
    jog: { state: 'IDLE', zLiftedForJog: false, heartbeatAgeMs: 0, lastCommand: '', lastError: '' },
    jogVector: { x: 0, y: 0, z: 0, speed: 0 },
    toolChangeSettings: null,
    projectSafeZ: { active: false, jobPath: '', projectSafeZ: null },
    operator: { configured: false, active: false, controller: false, readOnly: true, owner: null, canClaim: true, controlSessionEpoch: 0 },
    operatorGlobal: { configured: false, active: false, owner: null, canClaim: true, leaseMs: 45000, leaseExpiresAtUptimeMs: 0, controlSessionEpoch: 0 },
    operatorPanelOpen: false,
    controller: { connected: true, state: 'connected', communication: { state: 'connected', lastError: '', lastFailedCommand: '' } },
  };
  let jogTimer = null;
  let jogUpdatePending = false;
  let jogStartPending = false;
  let jogPointerId = null;
  let jogSessionId = 0;
  let motionSettingsModule = null;
  let travelSpeedMmS = 50;
  let operatorTimer = null;
  let operatorFetchMonitorInstalled = false;
  let operatorIntentUntil = 0;
  let operatorReconnectLastAttempt = 0;
  let operatorReconnectInFlight = null;
  let operatorHeartbeatInFlight = false;
  const socketSlices = new Map();
  const socketSliceWaiters = new Map();
  const confirmedMachineEvents = new Set();
  const OPERATOR_BROWSER_ID_KEY = 'cnc.operator.browserId';
  const OPERATOR_HEARTBEAT_INTERVAL_MS = 12000;
  const motionSettingsPromise = import('/lib/motion-settings.js').then((module) => {
    motionSettingsModule = module;
    travelSpeedMmS = module.loadMotionSettings().travelSpeedMmS;
    return module;
  }).catch(() => null);
  const toolChangeSettingsPromise = import('/lib/tool-change-settings.js').catch(() => null);
  const jobSafeZModulePromise = import('/lib/job-safe-z.js').catch(() => null);

  const ACTIVE_STATES = new Set(['PREPARING', 'RUNNING', 'PAUSING', 'PAUSED_INTACT', 'PAUSED', 'RESUMING', 'STOPPING']);
  const BUSY_STATES = new Set(['PREPARING', 'RUNNING', 'PAUSING', 'RESUMING', 'STOPPING']);
  const PAUSED_STATES = new Set(['PAUSED_INTACT', 'PAUSED']);
  const SETUP_STATES = new Set(['IDLE', 'STOPPED', 'RECOVERY_REQUIRED', 'COMPLETED', 'ERROR']);
  const MACHINE_Z_MAX_MM = 70;
  const ordinaryControlSelectors = [
    '[data-requires-live-control]',
    '#mb-pause',
    '#mb-home-x', '#mb-home-y', '#mb-home-z', '#mb-home-all', '#mb-m119',
    '#mb-set-work-zero', '#mb-set-z-zero', '#mb-capture-work-zero', '#mb-capture-z-zero',
    '#mb-touch-plate-z-zero', '[data-mb-goto-zero]',
    '#mb-terminal-send', '#mb-terminal-select', '#mb-terminal-cmd', '#mb-m114', '#mb-capture-position',
    '#mb-jog-restore-z', '#mb-jog-safe-z', '#mb-jog-xy-speed', '#mb-jog-z-speed',
    '#mb-jog-dock-toggle', '#mb-jog-settings-toggle', '#mb-jog-safe',
    '#mb-jog-z-slider', '#mb-jog-center', '[data-mb-jog-direction]',
    '[data-mb-feed]', '[data-mb-feed-delta]',
    '#home-machine-zero',
    '#readiness-home-all', '#readiness-set-work-zero', '#readiness-set-z-zero',
    '#readiness-run-bounds', '#readiness-run-aircut',
    '#set-work-zero', '#set-z-zero', '#touch-plate-z-zero',
    '#restore-saved-work-zero', '#restore-prepare-work-zero',
    '#send-dry-run', '#start-job', '#pause-job', '#resume-job',
    '#feed-live-percent', '#feed-live-set', '[data-feed-live]',
    '#move-to-resume-point', '#toolless-resume-start',
    '#production-prepare', '#production-resume-hold',
    '#tool-change-manual-z', '#tool-change-touch-plate', '#tool-change-complete',
    '.recovery-move-btn', '.tool-change-move-btn',
    '#save-device-settings', '#restart-device', '#refresh-machine-info', '#read-marlin-limits',
    '#refresh-machine-config', '#save-marlin-eeprom', '[data-machine-group] button[type="submit"]',
    '#tool-change-settings-form button[type="submit"]',
  ];
  const ordinaryLocalDisabled = new WeakMap();
  const ordinaryGuardForced = new WeakSet();
  let ordinaryGuardObserver = null;

  function controllerCommunicationState() {
    return String(
      STATE.controller?.state ||
      STATE.controller?.communication?.state ||
      (STATE.controller?.connected === false ? 'unresponsive' : 'unknown')
    ).toLowerCase();
  }

  function ordinaryMachineControlBlocked() {
    const telemetry = window.CncTelemetry;
    if (!telemetry || telemetry.transportStatus !== 'synchronized') return true;
    return controllerCommunicationState() !== 'connected';
  }

  function socketLiveStateSynchronized() {
    return window.CncTelemetry?.transportStatus === 'synchronized';
  }

  function safetyStopDisabled(jobState = visibleJobState()) {
    const state = String(jobState || 'UNKNOWN').toUpperCase();
    if (!socketLiveStateSynchronized()) return false;
    if (state === 'ERROR' && STATE.job?.errorCode === 'COMMUNICATION_LOST') return false;
    return !ACTIVE_STATES.has(state) || state === 'STOPPING';
  }

  function socketSliceToken(slice) {
    return Number(socketSlices.get(slice)?.sequence || 0);
  }

  function noteSocketSlice(slice, data) {
    const sequence = socketSliceToken(slice) + 1;
    socketSlices.set(slice, { sequence, data });
    const waiters = socketSliceWaiters.get(slice);
    if (!waiters?.size) return;
    [...waiters].forEach((waiter) => {
      if (sequence <= waiter.afterSequence) return;
      let matched = false;
      try {
        matched = waiter.predicate(data);
      } catch {
        matched = false;
      }
      if (!matched) return;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(data);
    });
  }

  function waitForSocketSlice(slice, predicate = () => true, options = {}) {
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 5000;
    const description = options.description || `${slice} state`;
    const afterSequence = Number.isFinite(Number(options.afterSequence))
      ? Number(options.afterSequence)
      : socketSliceToken(slice);
    if (!socketLiveStateSynchronized()) {
      return Promise.reject(new Error(`Live socket state is not synchronized while waiting for ${description}.`));
    }
    const current = socketSlices.get(slice);
    if (current && current.sequence > afterSequence && predicate(current.data)) {
      return Promise.resolve(current.data);
    }
    return new Promise((resolve, reject) => {
      const waiters = socketSliceWaiters.get(slice) || new Set();
      const waiter = {
        afterSequence,
        predicate,
        resolve,
        timer: setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`Command accepted, but live-state confirmation timed out while waiting for ${description}.`));
        }, timeoutMs),
      };
      waiters.add(waiter);
      socketSliceWaiters.set(slice, waiters);
    });
  }

  function markOrdinaryMachineControls() {
    ordinaryControlSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        node.setAttribute?.('data-requires-live-control', '');
      });
    });
  }

  function setMachineControlDisabled(node, locallyDisabled, options = {}) {
    if (!node) return;
    if (options.safetyException === true || !node.matches?.('[data-requires-live-control]')) {
      node.disabled = Boolean(locallyDisabled);
      return;
    }
    ordinaryLocalDisabled.set(node, Boolean(locallyDisabled));
    const blocked = ordinaryMachineControlBlocked();
    node.disabled = Boolean(locallyDisabled || blocked);
    if (blocked) ordinaryGuardForced.add(node);
    else ordinaryGuardForced.delete(node);
  }

  function applyOrdinaryControlGuard() {
    markOrdinaryMachineControls();
    const blocked = ordinaryMachineControlBlocked();
    document.querySelectorAll('[data-requires-live-control]').forEach((node) => {
      if (blocked) {
        if (!ordinaryGuardForced.has(node)) {
          ordinaryLocalDisabled.set(node, Boolean(node.disabled));
        } else if (node.disabled === false) {
          ordinaryLocalDisabled.set(node, false);
        }
        ordinaryGuardForced.add(node);
        node.disabled = true;
      } else if (ordinaryGuardForced.has(node)) {
        node.disabled = ordinaryLocalDisabled.get(node) === true;
        ordinaryGuardForced.delete(node);
      }
    });
  }

  function installOrdinaryControlGuard() {
    markOrdinaryMachineControls();
    const interceptBlockedControl = (event) => {
      const control = event.target?.closest?.('[data-requires-live-control]');
      if (!control || !ordinaryMachineControlBlocked()) return;
      event.preventDefault();
      event.stopImmediatePropagation?.();
      setMessage('Machine controls are disabled until WebSocket and controller communication are synchronized.');
      applyOrdinaryControlGuard();
    };
    document.addEventListener('pointerdown', interceptBlockedControl, true);
    document.addEventListener('click', interceptBlockedControl, true);
    document.addEventListener('keydown', interceptBlockedControl, true);
    if (typeof MutationObserver === 'function') {
      ordinaryGuardObserver = new MutationObserver(() => {
        if (ordinaryMachineControlBlocked()) applyOrdinaryControlGuard();
      });
      ordinaryGuardObserver.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['disabled'],
      });
    }
    applyOrdinaryControlGuard();
  }

  async function recoverControllerConnection() {
    const btn = el('btn-retry-controller-conn');
    const msgEl = el('controller-comm-message');
    if (btn) btn.disabled = true;
    if (msgEl) {
      msgEl.textContent = 'Recovering controller communication…';
      msgEl.hidden = false;
      msgEl.style.display = 'block';
    }
    renderControllerStatus();

    try {
      const baseline = socketSliceToken('controller');
      const res = await fetch('/api/controller/recover', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (msgEl) msgEl.textContent = data.error || data.message || 'Controller recovery failed.';
      } else {
        await waitForSocketSlice(
          'controller',
          (controller) => String(controller?.state || controller?.communication?.state || '').toLowerCase() === 'connected',
          { afterSequence: baseline, description: 'controller recovery' },
        );
        if (msgEl) msgEl.textContent = data.message || 'Controller communication restored and confirmed.';
      }
    } catch (err) {
      if (msgEl) msgEl.textContent = 'Recovery failed: ' + (err.message || String(err));
    } finally {
      if (btn && (STATE.controller?.state || STATE.controller?.communication?.state) !== 'recovering') {
        btn.disabled = false;
      }
    }
  }

  function renderControllerStatus() {
    const badge = el('controller-comm-status');
    const btn = el('btn-retry-controller-conn');
    const msgEl = el('controller-comm-message');

    const transportStatus = window.CncTelemetry?.transportStatus || 'unavailable';
    const isTransportStale = transportStatus !== 'synchronized';

    const state = controllerCommunicationState();
    const lastError = STATE.controller?.communication?.lastError || STATE.controller?.lastError || '';

    if (badge) {
      if (isTransportStale) {
        badge.textContent = `WebSocket: ${transportStatus.toUpperCase()}`;
        badge.className = 'status-badge status-unresponsive';
      } else {
        badge.textContent = `Controller: ${state.toUpperCase()}`;
        badge.className = `status-badge status-${state} ${state === 'connected' ? 'connected' : ''}`;
      }
    }

    if (btn) {
      btn.hidden = !(state === 'unresponsive' || state === 'recovering');
      btn.style.display = (state === 'unresponsive' || state === 'recovering') ? 'inline-block' : 'none';
      btn.disabled = (state === 'recovering');
    }

    if (msgEl) {
      if (isTransportStale) {
        msgEl.textContent = `WebSocket transport is ${transportStatus}. Machine state is stale. Controls disabled until synchronization is restored.`;
        msgEl.hidden = false;
        msgEl.style.display = 'block';
      } else if (state === 'unresponsive') {
        msgEl.textContent = lastError || 'Marlin is not responding. Machine commands are blocked until controller communication is restored.';
        msgEl.hidden = false;
        msgEl.style.display = 'block';
      } else if (state === 'recovering') {
        msgEl.textContent = 'Controller communication recovery in progress…';
        msgEl.hidden = false;
        msgEl.style.display = 'block';
      } else if (state === 'waiting') {
        msgEl.textContent = 'Waiting for machine response…';
        msgEl.hidden = false;
        msgEl.style.display = 'block';
      } else {
        msgEl.hidden = true;
        msgEl.style.display = 'none';
      }
    }

    applyOrdinaryControlGuard();
  }

  window.LowRiderMachineBar = {
    lastCritical: () => STATE.marlinLog?.lastCritical || '',
    controllerState: controllerCommunicationState,
    ordinaryMachineControlBlocked,
    applyOrdinaryControlGuard,
    setControlDisabled: setMachineControlDisabled,
    applyGlobalControlState,
    applyLocalOperatorAuthorization,
    operatorHeartbeat,
    claimOperatorControl,
    reconnectStoredOperator: silentlyReconnectOperator,
    operatorState: () => ({ ...STATE.operator }),
    liveState: () => ({
      job: { ...(STATE.job || {}) },
      jog: { ...(STATE.jog || {}) },
      position: { ...(STATE.position || {}) },
      frame: { ...(STATE.frame || {}) },
      controller: { ...(STATE.controller || {}) },
    }),
    machineFrame: () => ({ ...STATE.frame }),
    applyMachineSlice,
    socketSliceToken,
    waitForSocketSlice,
    safetyStopDisabled,
    stopJob,
    pauseJob,
    recoverControllerConnection,
    setFeedOverride,
    wsCommandDefinitelyNotAccepted,
    sendCmd,
    home,
    setWorkZero,
    setZZero,
    startJog,
    stopJog,
    renderControllerStatus,
    render,
  };

  function el(id) {
    return document.getElementById(id);
  }

  function fmtAxis(value) {
    return value === null || value === undefined || Number.isNaN(value) ? '-' : Number(value).toFixed(2);
  }

  function feedPercent() {
    const value = Number(STATE.job?.feedOverridePercent);
    return Number.isFinite(value) ? Math.max(10, Math.min(200, Math.round(value))) : 100;
  }

  function safeZBounds() {
    const safeZ = STATE.frame?.safeZ;
    const workMin = Number(safeZ?.workMin);
    const workMax = Number(safeZ?.workMax);
    const liftMin = Number(safeZ?.liftMin);
    if (Number.isFinite(workMin) && Number.isFinite(workMax) && workMax >= workMin) {
      return {
        min: Number.isFinite(liftMin) ? Math.max(workMin, liftMin) : workMin,
        max: workMax,
      };
    }
    return { min: 1, max: MACHINE_Z_MAX_MM };
  }

  function syncSafeZControl() {
    const input = el('mb-jog-safe-z');
    if (!input) return;
    const bounds = safeZBounds();
    input.min = String(bounds.min);
    input.max = String(bounds.max);
    const projectValue = Number(STATE.projectSafeZ?.projectSafeZ?.effectiveSafeZ);
    const value = STATE.projectSafeZ.active && Number.isFinite(projectValue)
      ? projectValue
      : Math.max(bounds.min, Math.min(bounds.max, Number(input.value || bounds.max)));
    input.value = String(value);
    input.disabled = STATE.projectSafeZ.active;
    const output = el('mb-jog-safe-z-output');
    if (output) output.textContent = STATE.projectSafeZ.active
      ? (Number.isFinite(projectValue) ? `${value} mm (project)` : 'Project Safe Z unresolved')
      : `${value} mm (manual fallback)`;
  }

  function safeWorkZToMachine(workZ) {
    const zeroMachineZ = Number(STATE.frame?.workZeroMachine?.z);
    return STATE.frame?.safeZ?.mappedToMachine === true && Number.isFinite(zeroMachineZ)
      ? zeroMachineZ + Number(workZ)
      : Number(workZ);
  }

  async function refreshProjectSafeZ() {
    const module = await jobSafeZModulePromise;
    let current = null;
    try {
      current = JSON.parse(localStorage.getItem('lowrider.currentJob') || 'null');
    } catch (err) {
      current = null;
    }
    if (!current?.jobPath || !module) {
      STATE.projectSafeZ = { active: false, jobPath: '', projectSafeZ: null };
      syncSafeZControl();
      return;
    }
    try {
      const res = await fetch(`/api/download?path=${encodeURIComponent(current.jobPath)}`);
      if (!res.ok) throw new Error('Current project metadata is not available.');
      const job = await res.json();
      STATE.projectSafeZ = {
        active: true,
        jobPath: current.jobPath,
        projectSafeZ: module.migrateProjectSafeZ(job),
      };
    } catch (err) {
      STATE.projectSafeZ = {
        active: true,
        jobPath: current.jobPath,
        projectSafeZ: { resolved: false, errors: [err.message] },
      };
    }
    syncSafeZControl();
  }

  function activeSafeWorkZ() {
    if (!STATE.projectSafeZ.active) return null;
    const safeZ = STATE.projectSafeZ.projectSafeZ;
    if (!safeZ?.resolved) throw new Error(safeZ?.errors?.[0] || 'Project Safe Z is unresolved.');
    if (STATE.frame?.trusted !== true || STATE.frame?.safeZ?.mappedToMachine !== true) {
      throw new Error('Project Safe Z requires a trusted machine frame and active Work Zero.');
    }
    const workZ = Number(safeZ.effectiveSafeZ);
    const bounds = safeZBounds();
    if (!Number.isFinite(workZ) || workZ < bounds.min || workZ > bounds.max) {
      throw new Error(`Project Safe Z ${workZ} is outside the reachable work-coordinate range ${bounds.min}..${bounds.max} mm.`);
    }
    return workZ;
  }

  function publishPosition(source) {
    const zero = STATE.frame?.workZeroMachine;
    if (source !== 'MARLIN' && zero && [STATE.position.x, STATE.position.y, STATE.position.z].every(Number.isFinite)) {
      STATE.frame.work = { ...STATE.position };
      STATE.frame.machine = {
        x: zero.x + STATE.position.x,
        y: zero.y + STATE.position.y,
        z: zero.z + STATE.position.z,
      };
    }
    window.dispatchEvent(new CustomEvent('cnc-position-update', {
      detail: { ...STATE.position, frame: STATE.frame, source, updatedAt: Date.now() },
    }));
  }

  function applyFrame(frame, source = 'FRAME') {
    if (!frame) return false;
    if (frame.positionValid === false) {
      STATE.frame = { ...STATE.frame, ...frame };
      syncSafeZControl();
      publishPosition(source);
      window.dispatchEvent(new CustomEvent('cnc-machine-frame', { detail: STATE.frame }));
      return true;
    }
    const work = frame.work || frame;
    if (![work?.x, work?.y, work?.z].every(Number.isFinite)) return false;
    const previousRevision = STATE.frame?.revision;
    STATE.frame = { ...STATE.frame, ...frame, work };
    STATE.position = { x: work.x, y: work.y, z: work.z };
    syncSafeZControl();
    publishPosition(source);
    if (source !== 'MARLIN' || frame.revision !== previousRevision) {
      window.dispatchEvent(new CustomEvent('cnc-machine-frame', { detail: STATE.frame }));
    }
    return true;
  }

  function applyMachineSlice(data) {
    if (!data || typeof data !== 'object') return false;
    STATE.machine = data;
    const frame = machineFrameFromSlice(data);
    return applyFrame(frame, 'MARLIN');
  }

  function machineFrameFromSlice(data) {
    const authoritativeFrame = data?.frame && typeof data.frame === 'object' ? data.frame : {};
    return {
      ...authoritativeFrame,
      work: data?.position?.work ?? authoritativeFrame.work ?? null,
      machine: data?.position?.machine ?? authoritativeFrame.machine ?? null,
      homedAxes: data?.homedAxes ?? authoritativeFrame.homedAxes ?? null,
      homingEpoch: data?.homingEpoch ?? authoritativeFrame.homingEpoch ?? 0,
    };
  }

  function frameRevision(frame) {
    const revision = Number(frame?.revision);
    return Number.isFinite(revision) ? revision : -1;
  }

  function dispatchConfirmedMachineEvent(type, commandResult, machineSlice, extra = {}) {
    const frame = machineFrameFromSlice(machineSlice);
    const key = [
      type,
      frame.bootSessionId || '',
      frame.homingSessionId || '',
      frameRevision(frame),
      Number(frame.homingEpoch) || 0,
      extra.axes || '',
    ].join(':');
    if (confirmedMachineEvents.has(key)) return false;
    confirmedMachineEvents.add(key);
    if (confirmedMachineEvents.size > 64) confirmedMachineEvents.delete(confirmedMachineEvents.values().next().value);
    window.dispatchEvent(new CustomEvent(type, {
      detail: { ...(commandResult || {}), ...extra, frame, machine: machineSlice, confirmedBySocket: true },
    }));
    return true;
  }

  async function readJson(res) {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch (err) {
      throw new Error(`Invalid JSON: ${err.message}`);
    }
  }

  function setMessage(message) {
    STATE.lastMessage = message || '';
    const status = el('mb-status');
    if (status) status.textContent = STATE.lastMessage;
  }

  function localArmState() {
    const arm = document.querySelector('#arm-state');
    const text = arm?.textContent?.trim().toUpperCase();
    return text === 'ARMED' ? 'ARMED' : '';
  }

  function visibleJobState() {
    const state = String(STATE.job?.state || 'UNKNOWN').toUpperCase();
    if (state === 'IDLE' || state === 'STOPPED' || state === 'COMPLETED') {
      return localArmState() || state;
    }
    return state;
  }

  function canSetup() {
    const state = visibleJobState();
    return SETUP_STATES.has(state) || state === 'ARMED' || state === 'UNKNOWN';
  }

  function canSetZ() {
    const state = visibleJobState();
    return canSetup() || PAUSED_STATES.has(state);
  }

  function isUnknown() {
    return visibleJobState() === 'UNKNOWN';
  }

  function confirmUnknown(action) {
    if (!isUnknown()) return true;
    return confirm(`Machine/job state is UNKNOWN. Confirm before ${action}.`);
  }

  async function apiPost(url, body = null) {
    const options = { method: 'POST' };
    if (body) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
    const res = await fetch(url, options);
    const data = await readJson(res);
    if (!res.ok || data.ok === false) throw new Error(data.error || `${url} failed`);
    return data;
  }

  /** Generate a collision-resistant unique command ID for WS idempotency. */
  function genCommandId(prefix = 'cmd') {
    const rnd = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    return `${prefix}-${rnd}`;
  }

  async function criticalJobPost(url) {
    let res;
    try {
      res = await fetch(url, { method: 'POST' });
    } catch (err) {
      throw new Error(`Command result uncertain due to network failure (${err.message}). Observe socket job state for updates.`);
    }
    const text = await res.text();
    try {
      const data = text ? JSON.parse(text) : {};
      if (!res.ok || data.ok === false) throw new Error(data.error || `${url} failed`);
      return data;
    } catch (err) {
      if (!res.ok) throw new Error(`HTTP ${res.status}; ${err.message}`);
      return { ok: true, warning: 'Firmware returned malformed JSON after accepting the request.' };
    }
  }

  async function terminalSend(cmd) {
    const trimmed = String(cmd || '').trim();
    if (!trimmed) return;
    const upper = trimmed.toUpperCase();
    if (upper === 'G92 X0 Y0 Z0') return setWorkZero();
    if (upper === 'G92 Z0') return setZZero();
    await sendCmd(trimmed);
  }

  function wsCommandDefinitelyNotAccepted(error) {
    return error?.definitelyNotAccepted === true;
  }

  async function recoverWsCommandOutcome(telemetry, commandId, error, label) {
    if (wsCommandDefinitelyNotAccepted(error)) {
      console.warn(`[${label}] WS command was not accepted; HTTP fallback is safe:`, error.message);
      return false;
    }
    if (error?.commandDisposition === 'completed') throw error;
    try {
      await telemetry.commandQuery(commandId, { timeoutMs: 5000 });
    } catch (queryError) {
      if (queryError?.commandDisposition === 'completed') throw queryError;
      console.warn(`[${label}] WS outcome remains ambiguous; waiting for authoritative state:`, queryError.message);
    }
    return true;
  }

  // Result phase for two-phase machine commands: a terminal failure rethrows;
  // a lost or still-pending result falls back to the authoritative machine
  // slice (never to HTTP). A result timeout is a liveness warning, not proof
  // of rejection.
  async function settleMachineCommandResult(handle, label) {
    try {
      return await handle.result;
    } catch (resultError) {
      if (resultError?.commandDisposition === 'completed') throw resultError;
      console.warn(`[${label}] machine-command result pending or lost; confirming from authoritative machine state:`,
        resultError.message);
      return { commandId: handle.commandId, accepted: true, outcome: 'result-pending' };
    }
  }

  function feedOverrideCommandCompleted(job, percent) {
    if (String(job?.lastFeedOverrideCommand || '').trim() !== `M220 S${percent}`) return false;
    const error = String(job?.lastFeedOverrideError || '').trim();
    const response = String(job?.lastFeedOverrideResponse || '');
    return error.length > 0 || /(?:^|[\r\n])\s*ok\b/i.test(response);
  }

  function feedOverrideCommandSucceeded(job, percent) {
    const response = String(job?.lastFeedOverrideResponse || '');
    return feedOverrideCommandCompleted(job, percent) &&
      Number(job?.feedOverridePercent) === percent &&
      String(job?.lastFeedOverrideError || '').trim() === '' &&
      !/error:/i.test(response);
  }

  async function waitForFeedOverrideConfirmation(percent, baseline) {
    const job = await waitForSocketSlice(
      'job',
      (slice) => feedOverrideCommandCompleted(slice, percent),
      { afterSequence: baseline, timeoutMs: 12000, description: `feed override ${percent}%` },
    );
    if (!feedOverrideCommandSucceeded(job, percent)) {
      throw new Error(String(job?.lastFeedOverrideError || job?.lastFeedOverrideResponse ||
        `M220 S${percent} did not receive a successful terminal response`).trim());
    }
    return job;
  }

  async function setFeedOverride(percent) {
    const value = Math.max(10, Math.min(200, Math.round(Number(percent) || 100)));
    if (value > 150 && !confirm('Feed override above 150% can move the CNC much faster. Continue?')) return;
    const baseline = socketSliceToken('job');
    const telemetry = window.CncTelemetry;
    if (telemetry?.command && STATE.operator?.controller) {
      const commandId = genCommandId('feed');
      let acceptedOrUnknown = false;
      try {
        await telemetry.command('job.setFeedOverride', { percent: value }, commandId, { timeoutMs: 5000 });
        acceptedOrUnknown = true;
      } catch (wsErr) {
        acceptedOrUnknown = await recoverWsCommandOutcome(telemetry, commandId, wsErr, 'feed-override');
      }
      if (acceptedOrUnknown) {
        await waitForFeedOverrideConfirmation(value, baseline);
        setMessage(`Feed override ${value}% confirmed`);
        return;
      }
    }
    await apiPost('/api/job/feed-override', { percent: value });
    await waitForFeedOverrideConfirmation(value, baseline);
    setMessage(`Feed override ${value}% confirmed`);
  }

  async function sendCmd(cmd) {
    const normalized = cmd.toUpperCase();
    const baseline = normalized === 'M114' ? socketSliceToken('machine') : 0;
    const data = await apiPost('/api/cmd', { cmd });
    if (normalized === 'M114') {
      await waitForSocketSlice(
        'machine',
        (machine) => machine?.position?.work || machine?.frame?.work,
        { afterSequence: baseline, description: 'new M114 machine position' },
      );
      setMessage(`${cmd} accepted and position confirmed`);
    } else {
      setMessage(`${cmd} sent`);
    }
    return data.response || '';
  }

  async function sendSequence(commands) {
    for (const cmd of commands) {
      await sendCmd(cmd);
    }
  }

  async function pauseJob() {
    const baseline = socketSliceToken('job');
    const telemetry = window.CncTelemetry;
    if (telemetry?.command && STATE.operator?.controller) {
      const commandId = genCommandId('pause');
      let acceptedOrUnknown = false;
      try {
        await telemetry.command('job.pause', null, commandId, { timeoutMs: 5000 });
        acceptedOrUnknown = true;
      } catch (wsErr) {
        acceptedOrUnknown = await recoverWsCommandOutcome(telemetry, commandId, wsErr, 'pause');
      }
      if (acceptedOrUnknown) {
        const confirmedJob = await waitForSocketSlice('job',
          (job) => ['PAUSING', 'PAUSED_INTACT', 'PAUSED'].includes(String(job?.state || '')),
          { afterSequence: baseline, description: 'Pause transition' });
        if (String(confirmedJob?.state || '') === 'PAUSING') {
          setMessage('Pause pending at a command boundary; current motion may continue until the boundary is reached. The cutter remains running.');
        } else {
          setMessage('Pause confirmed by live job state; motion is held intact and the cutter remains running');
        }
        return;
      }
    }
    await criticalJobPost('/api/job/pause');
    const confirmedJob = await waitForSocketSlice('job',
      (job) => ['PAUSING', 'PAUSED_INTACT', 'PAUSED'].includes(String(job?.state || '')),
      { afterSequence: baseline, description: 'Pause transition' });
    if (String(confirmedJob?.state || '') === 'PAUSING') {
      setMessage('Pause pending at a command boundary; current motion may continue until the boundary is reached. The cutter remains running.');
    } else {
      setMessage('Pause confirmed by live job state; motion is held intact and the cutter remains running');
    }
  }

  async function resumeJob() {
    const baseline = socketSliceToken('job');
    const telemetry = window.CncTelemetry;
    if (telemetry?.command && STATE.operator?.controller) {
      const commandId = genCommandId('resume');
      let acceptedOrUnknown = false;
      try {
        await telemetry.command('job.resume', null, commandId, { timeoutMs: 5000 });
        acceptedOrUnknown = true;
      } catch (wsErr) {
        acceptedOrUnknown = await recoverWsCommandOutcome(telemetry, commandId, wsErr, 'resume');
      }
      if (acceptedOrUnknown) {
        await waitForSocketSlice('job',
          (job) => ['RESUMING', 'RUNNING'].includes(String(job?.state || '')),
          { afterSequence: baseline, description: 'Resume transition' });
        setMessage('Resume confirmed by live job state');
        return;
      }
    }
    await apiPost('/api/job/resume');
    await waitForSocketSlice('job',
      (job) => ['RESUMING', 'RUNNING'].includes(String(job?.state || '')),
      { afterSequence: baseline, description: 'Resume transition' });
    setMessage('Resume confirmed by live job state');
  }

  async function pauseOrResumeJob() {
    if (visibleJobState() === 'PAUSED' && STATE.job?.toolChangePending === true) {
      setMessage('Complete the pending tool change in the job panel.');
      return;
    }
    if (visibleJobState() === 'PAUSED_INTACT') return resumeJob();
    if (visibleJobState() === 'RECOVERY_REQUIRED') {
      let currentJob = null;
      try {
        currentJob = JSON.parse(localStorage.getItem('lowrider.currentJob') || 'null');
      } catch (err) {
        currentJob = null;
      }
      location.href = `/preview.html?path=${encodeURIComponent(currentJob?.gcodePath || '')}#recovery`;
      return;
    }
    dispatchEvent(new CustomEvent('cnc-critical-control', { detail: { type: 'pause' } }));
    return pauseJob();
  }

  async function stopJob() {
    const state = visibleJobState();
    if (state === 'STOPPING') {
      setMessage('Stop Now already requested');
      return;
    }
    dispatchEvent(new CustomEvent('cnc-critical-control', { detail: { type: 'stop' } }));
    const baseline = socketSliceToken('job');
    const stopConfirmation = waitForSocketSlice('job',
      (job) => {
        const confirmedState = String(job?.state || '');
        return ['STOPPING', 'STOPPED', 'RECOVERY_REQUIRED'].includes(confirmedState) ||
          (confirmedState === 'ERROR' && job?.errorCode === 'COMMUNICATION_LOST');
      },
      { afterSequence: baseline, description: 'Stop transition' });
    // Dispatch both authenticated paths immediately. Canonical job state is the success authority.
    const telemetry = window.CncTelemetry;
    if (telemetry?.command && STATE.operator?.controller) {
      try {
        void Promise.resolve(
          telemetry.command('safety.stop', null, genCommandId('stop'), { timeoutMs: 5000 })
        ).catch((err) => console.warn('[stop] WS command response failed:', err.message));
      } catch (wsErr) {
        // Log but don't surface the WS error — the HTTP path is the safety net.
        console.warn('[stop] WS command dispatch failed:', wsErr.message);
      }
    }
    // The existing operator route remains protected by firmware authorization.
    try {
      void criticalJobPost('/api/job/stop')
        .catch((err) => console.warn('[stop] HTTP command response failed:', err.message));
    } catch (httpErr) {
      console.warn('[stop] HTTP command dispatch failed:', httpErr.message);
    }
    try {
      const confirmedJob = await stopConfirmation;
      if (confirmedJob?.errorCode === 'COMMUNICATION_LOST') {
        setMessage('Remote Stop was requested, but controller receipt cannot be confirmed. Use the physical emergency stop.');
      } else {
        setMessage('Stop Now confirmed by live job state; position requires verification');
      }
    } catch (confirmationErr) {
      setMessage(`Remote Stop could not be confirmed. Use the physical emergency stop. ${confirmationErr.message}`);
    }
  }

  async function refreshPosition() {
    await sendCmd('M114');
    setMessage('Position refreshed');
  }

  async function goToWorkZero(axes) {
    await invalidatePausedResumeBeforeManualMotion();
    if (!canSetup()) throw new Error('Work-zero movement is unavailable while the job is active.');
    if (STATE.frame?.workZeroValid !== true) {
      throw new Error('No active work zero. Set one or restore a saved zero from Prepare first.');
    }
    if (!confirmUnknown('moving to work zero')) return;
    await refreshProjectSafeZ();
    const safeMove = Boolean(el('mb-goto-safe')?.checked);
    const bounds = safeZBounds();
    const safeZ = STATE.projectSafeZ.active
      ? activeSafeWorkZ()
      : Math.max(bounds.min, Math.min(bounds.max, Number(el('mb-jog-safe-z')?.value || bounds.max)));
    const label = String(axes || '').toUpperCase();
    const message = safeMove
      ? `Move ${label} to work zero after lifting to Z${safeZ.toFixed(1)} mm? Z will remain at safe height.`
      : `DIRECT ${label} MOVE AT CURRENT Z: This can drag the tool through material. Continue?`;
    if (!confirm(message)) return;
    const baseline = socketSliceToken('machine');
    const data = await apiPost('/api/work-zero/goto', {
      axes, safeMove, safeZ, jobPath: STATE.projectSafeZ.jobPath,
      projectSafeZ: STATE.projectSafeZ.active ? safeZ : null,
      travelFeedMmMin: Math.round(travelSpeedMmS * 60),
    });
    await waitForSocketSlice(
      'machine',
      (machine) => machine?.position?.work || machine?.frame?.work,
      { afterSequence: baseline, description: `${label} work-zero movement` },
    );
    setMessage(data.message || `${label} work-zero move confirmed`);
  }

  function jogSettings(safeJog) {
    const xySpeed = Math.max(10, Math.min(100, Number(el('mb-jog-xy-speed')?.value || travelSpeedMmS)));
    const zSpeed = Math.max(1, Math.min(10, Number(el('mb-jog-z-speed')?.value || 5)));
    const safeWorkZ = !safeJog ? 0 : (STATE.projectSafeZ.active
      ? activeSafeWorkZ()
      : Math.max(safeZBounds().min, Math.min(safeZBounds().max,
        Number(el('mb-jog-safe-z')?.value || safeZBounds().max))));
    return {
      safeJog,
      safeLiftZ: safeWorkZToMachine(safeWorkZ),
      safeWorkZ,
      jobPath: STATE.projectSafeZ.jobPath,
      projectSafeZ: STATE.projectSafeZ.active ? safeWorkZ : null,
      xyFeedMax: Math.round(xySpeed * 60),
      zFeedMax: Math.round(zSpeed * 60),
    };
  }

  async function readOperatorResponse(res) {
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (err) {
      throw new Error(`Invalid operator response: ${err.message}`);
    }
    if (!res.ok) throw Object.assign(new Error(data.error || `Operator request failed (${res.status})`), { data, status: res.status });
    return data;
  }

  function storedOperatorBrowserId(create = false) {
    let browserId = localStorage.getItem(OPERATOR_BROWSER_ID_KEY) || '';
    if (/^[a-f0-9]{64}$/.test(browserId)) return browserId;
    localStorage.removeItem(OPERATOR_BROWSER_ID_KEY);
    if (!create || !globalThis.crypto?.getRandomValues) return '';
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    browserId = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(OPERATOR_BROWSER_ID_KEY, browserId);
    return browserId;
  }

  function stopOperatorHeartbeat() {
    clearInterval(operatorTimer);
    operatorTimer = null;
  }

  function syncOperatorHeartbeat() {
    stopOperatorHeartbeat();
    if (!STATE.operator?.controller || document.hidden ||
        window.CncTelemetry?.transportStatus === 'failed') return;
    operatorTimer = setInterval(() => {
      operatorHeartbeat().catch(() => {});
    }, OPERATOR_HEARTBEAT_INTERVAL_MS);
  }

  function revokeLocalOperatorControl(reason = 'Operator control ended.', overrides = {}) {
    STATE.operator = {
      ...STATE.operator,
      ...overrides,
      controller: false,
      readOnly: true,
      error: reason,
    };
    stopOperatorHeartbeat();
    window.CncTelemetry?.revokeCommandAuthorization?.(reason, 'AUTHORIZATION_REVOKED');
    return STATE.operator;
  }

  function applyLocalOperatorAuthorization(data) {
    const controlSessionEpoch = Number(data?.controlSessionEpoch) || 0;
    const controller = data?.controller === true && controlSessionEpoch > 0;
    STATE.operator = {
      ...STATE.operator,
      ...data,
      controlSessionEpoch,
      controller,
      readOnly: !controller,
    };
    // Forward the WS command token to the telemetry module.
    // The token appears ONLY in Claim/Reconnect response bodies; heartbeat/status never carry it.
    const token = typeof data?.socketCommandToken === 'string' ? data.socketCommandToken : null;
    if (controller && token) {
      window.CncTelemetry?.setSocketCommandToken(token, controlSessionEpoch);
    } else if (!controller) {
      revokeLocalOperatorControl(data?.error || 'Operator control is no longer active.', data);
    }
    syncOperatorHeartbeat();
    return STATE.operator;
  }


  function applyGlobalControlState(data) {
    if (!data || typeof data !== 'object') return STATE.operator;
    STATE.operatorGlobal = { ...STATE.operatorGlobal, ...data };
    const local = STATE.operator || {};
    const globalSessionEpoch = Number(data.controlSessionEpoch) || 0;
    const localSessionEpoch = Number(local.controlSessionEpoch) || 0;
    const controller = local.controller === true
      && data.active === true
      && globalSessionEpoch > 0
      && localSessionEpoch === globalSessionEpoch
      && (!local.owner || !data.owner || local.owner === data.owner);
    STATE.operator = {
      ...local,
      configured: data.configured ?? local.configured ?? false,
      active: data.active ?? local.active ?? false,
      owner: data.owner ?? null,
      canClaim: data.canClaim ?? local.canClaim ?? true,
      leaseMs: data.leaseMs ?? local.leaseMs,
      leaseExpiresAtUptimeMs: data.leaseExpiresAtUptimeMs ?? local.leaseExpiresAtUptimeMs,
      controlSessionEpoch: localSessionEpoch,
      controller,
      readOnly: !controller,
    };
    if (local.controller === true && !controller) {
      revokeLocalOperatorControl('Authoritative control state revoked this browser session.', STATE.operator);
    }
    syncOperatorHeartbeat();
    return STATE.operator;
  }

  async function silentlyReconnectOperator() {
    const browserId = storedOperatorBrowserId();
    const now = Date.now();
    if (!browserId || STATE.operator?.controller || document.hidden ||
        window.CncTelemetry?.transportStatus === 'failed') return false;
    if (operatorReconnectInFlight) return operatorReconnectInFlight;
    if (now - operatorReconnectLastAttempt < 1000) return false;
    operatorReconnectLastAttempt = now;
    operatorReconnectInFlight = (async () => {
      try {
        const data = await readOperatorResponse(await fetch('/api/operator/reconnect', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ browserId }),
        }));
        applyLocalOperatorAuthorization(data);
        renderOperatorLock();
        return STATE.operator.controller === true;
      } catch (err) {
        if (err?.status === 403 || err?.status === 423) {
          revokeLocalOperatorControl('Remembered controller session is no longer authorized.', err.data || {});
        }
        return false;
      } finally {
        operatorReconnectInFlight = null;
      }
    })();
    return operatorReconnectInFlight;
  }

  async function claimOperatorControl() {
    const owner = String(el('mb-operator-owner')?.value || '').trim();
    const pin = String(el('mb-operator-pin')?.value || '').trim();
    const browserId = storedOperatorBrowserId(true);
    const status = el('mb-operator-result');
    try {
      const data = await readOperatorResponse(await fetch('/api/operator/claim', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, pin, browserId }),
      }));
      localStorage.setItem('cnc.operator.owner', owner);
      if (el('mb-operator-pin')) el('mb-operator-pin').value = '';
      applyLocalOperatorAuthorization(data);
      STATE.operatorPanelOpen = false;
      if (status) status.textContent = 'This browser now controls the machine.';
      renderOperatorLock();
    } catch (err) {
      if (err.data) STATE.operator = { ...STATE.operator, ...err.data };
      if (status) status.textContent = err.message;
      renderOperatorLock();
    }
  }

  async function releaseOperatorControl() {
    try {
      applyLocalOperatorAuthorization(
        await readOperatorResponse(await fetch('/api/operator/release', { method: 'POST' }))
      );
      localStorage.removeItem(OPERATOR_BROWSER_ID_KEY);
      STATE.operatorPanelOpen = false;
      renderOperatorLock();
    } catch (err) {
      if (el('mb-operator-result')) el('mb-operator-result').textContent = err.message;
    }
  }

  async function updateOperatorPin() {
    const currentPin = String(el('mb-operator-current-pin')?.value || '').trim();
    const newPin = String(el('mb-operator-new-pin')?.value || '').trim();
    const status = el('mb-operator-result');
    try {
      const data = await readOperatorResponse(await fetch('/api/operator/pin', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPin, newPin }),
      }));
      if (el('mb-operator-current-pin')) el('mb-operator-current-pin').value = '';
      if (el('mb-operator-new-pin')) el('mb-operator-new-pin').value = '';
      if (status) status.textContent = data.message || 'PIN updated.';
    } catch (err) {
      if (status) status.textContent = err.message;
    }
  }

  async function operatorHeartbeat() {
    if (!STATE.operator?.controller || document.hidden ||
        window.CncTelemetry?.transportStatus === 'failed' || operatorHeartbeatInFlight) {
      if (!STATE.operator?.controller) stopOperatorHeartbeat();
      return STATE.operator;
    }
    operatorHeartbeatInFlight = true;
    try {
      applyLocalOperatorAuthorization(
        await readOperatorResponse(await fetch('/api/operator/heartbeat', { method: 'POST' }))
      );
    } catch (err) {
      revokeLocalOperatorControl(err.message || 'Operator heartbeat authorization failed.', err.data || {});
    } finally {
      operatorHeartbeatInFlight = false;
    }
    renderOperatorLock();
    return STATE.operator;
  }

  function requestOperatorControl(message = 'Claim control before changing machine state.') {
    STATE.operatorPanelOpen = true;
    const status = el('mb-operator-result');
    if (status) status.textContent = message;
    renderOperatorLock();
  }

  function installOperatorFetchMonitor() {
    if (operatorFetchMonitorInstalled) return;
    operatorFetchMonitorInstalled = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function monitoredOperatorFetch(input, init = {}) {
      const operatorRequestWasUserInitiated = Date.now() <= operatorIntentUntil;
      const response = await originalFetch(input, init);
      const url = typeof input === 'string' ? input : String(input?.url || '');
      const method = String(init.method || input?.method || 'GET').toUpperCase();
      if (operatorRequestWasUserInitiated && response.status === 423 && method !== 'GET' &&
          !url.includes('/api/operator/')) {
        const data = await response.clone().json().catch(() => ({}));
        const operatorLocked = data?.readOnly === true && typeof data?.configured === 'boolean';
        if (operatorLocked) {
          requestOperatorControl('This action needs machine control. Enter the device PIN to continue.');
        }
      }
      return response;
    };
  }

  function renderOperatorLock() {
    const operator = STATE.operator || {};
    const controller = operator.controller === true;
    document.body.classList.toggle('operator-read-only', !controller);
    const strip = el('mb-operator-strip');
    const button = el('mb-operator-toggle');
    const panel = el('mb-operator-panel');
    const claim = el('mb-operator-claim');
    const release = el('mb-operator-release');
    const change = el('mb-operator-change');
    const owner = operator.owner || '';
    if (strip) strip.dataset.controller = String(controller);
    if (button) {
      button.textContent = controller ? `● ${owner}` : owner ? `○ ${owner}` : '○ viewer';
      button.title = controller ? `Controller: ${owner}` : owner ? `Read only: ${owner} controls` : 'Read only: claim control';
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-expanded', String(STATE.operatorPanelOpen));
    }
    if (panel) panel.hidden = !STATE.operatorPanelOpen;
    if (el('mb-operator-title')) {
      el('mb-operator-title').textContent = controller
        ? `Controller: ${owner}`
        : operator.configured ? 'Claim machine control' : 'Set the device operator PIN';
    }
    if (el('mb-operator-hint')) {
      el('mb-operator-hint').textContent = controller
        ? 'This browser is remembered as the controller and reconnects automatically unless another device takes control.'
        : owner
          ? `${owner} currently controls the machine. This browser is read-only until that 45-second lease expires or is released.`
          : operator.configured
            ? 'Enter the device PIN. Only one browser can control the machine at a time.'
            : 'First setup: connect through the device Setup AP, then choose a unique 6-12 digit PIN. It is stored as a hash and will be required on every controller.';
    }
    if (claim) claim.hidden = controller;
    if (claim) claim.disabled = operator.active === true && !controller;
    if (release) release.hidden = !controller;
    if (change) change.hidden = !controller;
    document.querySelectorAll('[data-operator-claim-field]').forEach((item) => { item.hidden = controller; });
    document.querySelectorAll('[data-operator-pin-field]').forEach((item) => { item.hidden = !controller; });
  }

  function formatRestoreZ(value) {
    return String(Math.round(Number(value) * 100) / 100);
  }

  async function restoreJogZ() {
    const targetZ = Number(STATE.jog?.originalZ);
    if (STATE.jog?.zRestoreAvailable !== true || !Number.isFinite(targetZ)) {
      throw new Error('No saved Z position is available.');
    }
    const targetLabel = formatRestoreZ(targetZ);
    if (!confirm(`Restore Z to ${targetLabel} mm at the current X/Y position? Make sure the path below the tool is clear.`)) return;
    const baseline = socketSliceToken('jog');
    await apiPost('/api/jog/restore-z');
    await waitForSocketSlice(
      'jog',
      (jog) => jog?.zRestoreAvailable !== true,
      { afterSequence: baseline, description: `restored Z ${targetLabel} mm` },
    );
    setMessage(`Z restore to ${targetLabel} mm confirmed.`);
  }

  function jogIsUiActive() {
    return ['PREPARING_SAFE_Z', 'JOGGING', 'STOPPING'].includes(String(STATE.jog?.state || ''));
  }

  function resetJoystickVisual() {
    STATE.jogVector = { x: 0, y: 0, z: 0, speed: 0 };
    const knob = el('mb-jog-knob');
    if (knob) knob.style.transform = 'translate(-50%, -50%)';
    document.querySelectorAll('[data-mb-jog-direction]').forEach((item) => {
      item.style.transform = '';
      item.classList.remove('is-active');
    });
    const zHandle = el('mb-jog-z-handle');
    if (zHandle) zHandle.style.transform = 'translate(-50%, -50%)';
  }

  function applyCommandedJogPosition(jog) {
    if (jog?.commandedPositionCaptured !== true) return false;
    const next = {
      x: Number(jog.commandedWorkX),
      y: Number(jog.commandedWorkY),
      z: Number(jog.commandedWorkZ),
    };
    if (![next.x, next.y, next.z].every(Number.isFinite)) return false;
    STATE.jogAnimationPosition = next;
    window.dispatchEvent(new CustomEvent('cnc-commanded-jog-position', {
      detail: { ...next, source: 'JOG_CMD', updatedAt: Date.now() },
    }));
    return true;
  }

  async function sendJogUpdate() {
    if (jogUpdatePending || STATE.jog?.state !== 'JOGGING') return;
    const sessionId = jogSessionId;
    const vector = { ...STATE.jogVector };
    jogUpdatePending = true;
    try {
      await apiPost('/api/jog/update', vector);
      if (sessionId !== jogSessionId) return;
    } finally {
      jogUpdatePending = false;
      renderJogReadouts();
    }
  }

  async function startJog(safeJog) {
    if (jogStartPending || jogTimer || STATE.jog?.state === 'JOGGING') return;
    await invalidatePausedResumeBeforeManualMotion();
    const sessionId = ++jogSessionId;
    await refreshProjectSafeZ();
    const settings = jogSettings(safeJog);
    jogStartPending = true;
    try {
      const baseline = socketSliceToken('jog');
      await apiPost('/api/jog/start', settings);
      if (sessionId !== jogSessionId) {
        apiPost('/api/jog/stop').catch(() => {});
        return;
      }
      await waitForSocketSlice(
        'jog',
        (jog) => ['PREPARING_SAFE_Z', 'JOGGING'].includes(String(jog?.state || '').toUpperCase()),
        { afterSequence: baseline, description: 'Jog start' },
      );
      if (sessionId !== jogSessionId) return;
      jogTimer = setInterval(() => {
        sendJogUpdate().catch((err) => {
          setMessage(`Jog stopped: ${err.message}`);
          stopJog(false, true).catch(() => {});
        });
      }, 150);
      await sendJogUpdate();
      render();
    } finally {
      jogStartPending = false;
    }
  }

  async function stopJog(force = false, emergency = false) {
    const shouldStop = force || jogStartPending || Boolean(jogTimer) || jogIsUiActive();
    jogSessionId += 1;
    resetJoystickVisual();
    if (jogTimer) clearInterval(jogTimer);
    jogTimer = null;
    jogUpdatePending = false;
    if (!shouldStop) return;
    try {
      const baseline = socketSliceToken('jog');
      await apiPost('/api/jog/stop', { emergency });
      await waitForSocketSlice(
        'jog',
        (jog) => !['PREPARING_SAFE_Z', 'JOGGING', 'STOPPING'].includes(String(jog?.state || '').toUpperCase()),
        { afterSequence: baseline, description: 'Jog stop' },
      );
    } finally {
      render();
    }
  }

  function updateJoystickVector(event) {
    const pad = el('mb-jog-center');
    const knob = el('mb-jog-knob');
    if (!pad || !knob) return;
    const rect = pad.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.42);
    let dx = event.clientX - (rect.left + rect.width / 2);
    let dy = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy);
    if (distance > radius) {
      dx = dx / distance * radius;
      dy = dy / distance * radius;
    }
    const x = dx / radius;
    const y = -dy / radius;
    STATE.jogVector = { x, y, z: 0, speed: Math.min(1, Math.hypot(x, y)) };
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  async function invalidatePausedResumeBeforeManualMotion() {
    if (visibleJobState() !== 'PAUSED_INTACT') return;
    setMessage('Invalidating direct Resume and stopping the cutter before manual movement…');
    await apiPost('/api/job/interrupt-for-manual-motion');
    if (!window.CncTelemetry || window.CncTelemetry.transportStatus !== 'synchronized') {
      throw new Error('Live socket state is stale. Wait for synchronization before manual movement.');
    }
    await new Promise((resolve, reject) => {
      let unsubscribe = null;
      const timer = setTimeout(() => {
        unsubscribe?.();
        reject(new Error('Manual movement is waiting for authoritative RECOVERY_REQUIRED state. Retry when it is shown.'));
      }, 4000);
      unsubscribe = window.CncTelemetry.subscribe('job', (job) => {
        const state = String(job?.state || '').toUpperCase();
        if (state === 'ERROR') {
          clearTimeout(timer);
          unsubscribe?.();
          reject(new Error(job?.lastError || 'Could not establish a safe manual-movement state.'));
        } else if (state === 'RECOVERY_REQUIRED') {
          clearTimeout(timer);
          unsubscribe?.();
          resolve();
        }
      });
    });
  }

  function updateDirectionalVector(event, item) {
    const pad = el('mb-jog-pad');
    if (!pad || !item) return;
    const rect = pad.getBoundingClientRect();
    const directionX = Number(item.dataset.mbJogX) || 0;
    const directionY = Number(item.dataset.mbJogY) || 0;
    const length = Math.hypot(directionX, directionY) || 1;
    const unitX = directionX / length;
    const unitY = directionY / length;
    const pointerX = event.clientX - (rect.left + rect.width / 2);
    const pointerY = event.clientY - (rect.top + rect.height / 2);
    const projectedRadius = pointerX * unitX - pointerY * unitY;
    const restingRadius = Math.min(rect.width, rect.height) * 0.31;
    const maximumRadius = Math.min(rect.width, rect.height) * 0.46;
    const range = Math.max(1, maximumRadius - restingRadius);
    const speed = Math.max(0, Math.min(1, 0.25 + (projectedRadius - restingRadius) / range * 0.75));
    STATE.jogVector = { x: unitX * speed, y: unitY * speed, z: 0, speed };
    const pull = Math.max(-8, Math.min(range, projectedRadius - restingRadius));
    item.style.transform = `translate(-50%, -50%) translate(${unitX * pull}px, ${-unitY * pull}px)`;
  }

  function updateZSliderVector(event) {
    const slider = el('mb-jog-z-slider');
    const handle = el('mb-jog-z-handle');
    if (!slider || !handle) return;
    const rect = slider.getBoundingClientRect();
    const travel = Math.max(1, rect.height / 2 - 24);
    const rawOffset = event.clientY - (rect.top + rect.height / 2);
    const offset = Math.max(-travel, Math.min(travel, rawOffset));
    const normalized = -offset / travel;
    const deadzone = 0.08;
    const speed = Math.max(0, Math.min(1, (Math.abs(normalized) - deadzone) / (1 - deadzone)));
    STATE.jogVector = { x: 0, y: 0, z: speed > 0 ? Math.sign(normalized) : 0, speed };
    handle.style.transform = `translate(-50%, calc(-50% + ${offset}px))`;
  }

  function installJoystick() {
    const pad = el('mb-jog-center');
    let centerPointerId = null;
    pad?.addEventListener('pointerdown', (event) => {
      if (jogPointerId !== null) return;
      event.preventDefault();
      centerPointerId = event.pointerId;
      jogPointerId = event.pointerId;
      pad.setPointerCapture?.(event.pointerId);
      updateJoystickVector(event);
      startJog(Boolean(el('mb-jog-safe')?.checked)).catch((err) => {
        setMessage(`Jog unavailable: ${err.message}`);
        centerPointerId = null;
        jogPointerId = null;
        stopJog(false, true).catch(() => {});
      });
    });
    pad?.addEventListener('pointermove', (event) => {
      if (event.pointerId !== centerPointerId) return;
      event.preventDefault();
      const samples = event.getCoalescedEvents?.() || [event];
      updateJoystickVector(samples[samples.length - 1]);
    });
    const end = (event) => {
      if (event.pointerId !== centerPointerId) return;
      centerPointerId = null;
      jogPointerId = null;
      resetJoystickVisual();
      stopJog(false, event.type !== 'pointerup').catch((err) => setMessage(`Jog stop failed: ${err.message}`));
    };
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    pad?.addEventListener('lostpointercapture', end);

    document.querySelectorAll('[data-mb-jog-direction]').forEach((item) => {
      let pointerId = null;
      item.addEventListener('pointerdown', (event) => {
        if (pointerId !== null || jogPointerId !== null) return;
        event.preventDefault();
        pointerId = event.pointerId;
        jogPointerId = event.pointerId;
        item.classList.add('is-active');
        item.setPointerCapture?.(event.pointerId);
        updateDirectionalVector(event, item);
        startJog(Boolean(el('mb-jog-safe')?.checked)).catch((err) => {
          pointerId = null;
          jogPointerId = null;
          setMessage(`Directional jog unavailable: ${err.message}`);
          stopJog(false, true).catch(() => {});
        });
      });
      item.addEventListener('pointermove', (event) => {
        if (event.pointerId !== pointerId) return;
        event.preventDefault();
        const samples = event.getCoalescedEvents?.() || [event];
        updateDirectionalVector(samples[samples.length - 1], item);
      });
      const stopDirection = (event) => {
        if (event.pointerId !== pointerId) return;
        pointerId = null;
        jogPointerId = null;
        resetJoystickVisual();
        stopJog(false, event.type !== 'pointerup').catch((err) => setMessage(`Jog stop failed: ${err.message}`));
      };
      item.addEventListener('pointerup', stopDirection);
      item.addEventListener('pointercancel', stopDirection);
      item.addEventListener('lostpointercapture', stopDirection);
      item.addEventListener('contextmenu', (event) => event.preventDefault());
    });

    const zSlider = el('mb-jog-z-slider');
    let zPointerId = null;
    zSlider?.addEventListener('pointerdown', (event) => {
      if (zPointerId !== null || jogPointerId !== null) return;
      event.preventDefault();
      zPointerId = event.pointerId;
      jogPointerId = event.pointerId;
      zSlider.setPointerCapture?.(event.pointerId);
      updateZSliderVector(event);
      startJog(false).catch((err) => {
        zPointerId = null;
        jogPointerId = null;
        setMessage(`Z jog unavailable: ${err.message}`);
        stopJog(false, true).catch(() => {});
      });
    });
    zSlider?.addEventListener('pointermove', (event) => {
      if (event.pointerId !== zPointerId) return;
      event.preventDefault();
      const samples = event.getCoalescedEvents?.() || [event];
      updateZSliderVector(samples[samples.length - 1]);
    });
    const stopZSlider = (event) => {
      if (event.pointerId !== zPointerId) return;
      zPointerId = null;
      jogPointerId = null;
      resetJoystickVisual();
      stopJog(false, event.type !== 'pointerup').catch((err) => setMessage(`Jog stop failed: ${err.message}`));
    };
    zSlider?.addEventListener('pointerup', stopZSlider);
    zSlider?.addEventListener('pointercancel', stopZSlider);
    zSlider?.addEventListener('lostpointercapture', stopZSlider);
    zSlider?.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  async function setWorkZero() {
    if (!canSetup()) return;
    if (!confirmUnknown('setting work zero')) return;
    if (!confirm('This will set the current tool position as work X0/Y0/Z0.')) return;
    const baseline = socketSliceToken('machine');
    const previousRevision = frameRevision(STATE.frame);
    const telemetry = window.CncTelemetry;
    const confirmWorkZero = async (data) => {
      const machine = await waitForSocketSlice(
        'machine',
        (slice) => {
          const frame = machineFrameFromSlice(slice);
          return frame.workZeroValid === true && frameRevision(frame) > previousRevision;
        },
        { afterSequence: baseline, description: 'new Work Zero frame' },
      );
      dispatchConfirmedMachineEvent('cnc-work-zero-set', data, machine, { axes: 'xyz' });
      setMessage('Work zero set and confirmed by live machine state');
    };
    if (telemetry?.beginCommand && STATE.operator?.controller) {
      // Two-phase command: admission is bounded and decides the HTTP fallback;
      // the result phase may legitimately take minutes (the firmware engine
      // runs G28/M400 with 120 s Marlin budgets per step) and must never be
      // mistaken for a failure to accept.
      const handle = telemetry.beginCommand('machine.setWorkZero', { axes: 'xyz' },
        genCommandId('machine-setworkzero'), { admissionTimeoutMs: 5000, resultTimeoutMs: 600000 });
      let admitted = true;
      try {
        await handle.accepted;
      } catch (admissionError) {
        // Only a proven non-acceptance allows the HTTP fallback; an admission
        // timeout with the packet sent leaves the command possibly running.
        if (wsCommandDefinitelyNotAccepted(admissionError)) admitted = false;
      }
      if (admitted) {
        await confirmWorkZero(await settleMachineCommandResult(handle, 'work zero'));
        return;
      }
    }
    await confirmWorkZero(await apiPost('/api/work-zero/set', {}));
  }

  async function setZZero() {
    if (!canSetZ()) return;
    if (!confirmUnknown('setting Z zero')) return;
    if (!confirm('This will set only current Z as work Z0. X/Y will not change.')) return;
    const baseline = socketSliceToken('machine');
    const previousRevision = frameRevision(STATE.frame);
    const telemetry = window.CncTelemetry;
    const confirmZZero = async (data) => {
      const machine = await waitForSocketSlice(
        'machine',
        (slice) => frameRevision(machineFrameFromSlice(slice)) > previousRevision,
        { afterSequence: baseline, description: 'new Z Zero frame' },
      );
      dispatchConfirmedMachineEvent('cnc-z-zero-set', data, machine, { axes: 'z' });
      setMessage('Z zero set and confirmed by live machine state');
    };
    if (telemetry?.beginCommand && STATE.operator?.controller) {
      const handle = telemetry.beginCommand('machine.setZZero', null,
        genCommandId('machine-setzzero'), { admissionTimeoutMs: 5000, resultTimeoutMs: 600000 });
      let admitted = true;
      try {
        await handle.accepted;
      } catch (admissionError) {
        if (wsCommandDefinitelyNotAccepted(admissionError)) admitted = false;
      }
      if (admitted) {
        await confirmZZero(await settleMachineCommandResult(handle, 'z zero'));
        return;
      }
    }
    await confirmZZero(await apiPost('/api/work-zero/set-z', {}));
  }

  async function touchPlateZZero() {
    if (!canSetZ()) return;
    const settings = STATE.toolChangeSettings;
    if (!settings?.touchPlateEnabled) throw new Error('Touch plate is not enabled in Settings.');
    if (!confirmUnknown('probing Z zero')) return;
    if (!confirm(`Probe downward up to ${settings.touchPlateProbeDistance.toFixed(1)} mm at ${settings.touchPlateProbeFeed.toFixed(0)} mm/min?\n\nPlate thickness: ${settings.touchPlateThickness.toFixed(2)} mm. Verify the probe lead is connected.`)) return;
    const baseline = socketSliceToken('machine');
    const previousRevision = frameRevision(STATE.frame);
    const data = await apiPost('/api/work-zero/touch-plate', {});
    const machine = await waitForSocketSlice(
      'machine',
      (slice) => frameRevision(machineFrameFromSlice(slice)) > previousRevision,
      { afterSequence: baseline, description: 'touch-plate Z Zero frame' },
    );
    dispatchConfirmedMachineEvent('cnc-z-zero-set', data, machine, { axes: 'z', method: 'touchplate' });
    setMessage('Touch-plate Z zero confirmed by live machine state');
  }

  async function loadToolChangeSettings() {
    const [res, module] = await Promise.all([fetch('/api/tool-change/settings', { cache: 'no-store' }), toolChangeSettingsPromise]);
    if (!module) return;
    const data = await readJson(res);
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Tool-change settings unavailable');
    STATE.toolChangeSettings = module.normalizeToolChangeSettings(data.settings || data);
    render();
  }

  async function captureAndSetWorkZero() {
    await setWorkZero();
  }

  async function captureAndSetZZero() {
    await setZZero();
  }

  async function home(cmd, message, fullHoming = false) {
    if (!canSetup()) return;
    if (!confirmUnknown('homing')) return;
    if (!confirm(message)) return;
    const axes = cmd === 'G28' ? 'all' : cmd.replace('G28', '').trim().toLowerCase().replace(/\s+/g, '');
    const baseline = socketSliceToken('machine');
    const previousRevision = frameRevision(STATE.frame);
    const previousHomingEpoch = Number(STATE.frame?.homingEpoch) || 0;
    const telemetry = window.CncTelemetry;
    const confirmHome = async (data) => {
      const machine = await waitForSocketSlice(
        'machine',
        (slice) => {
          const frame = machineFrameFromSlice(slice);
          const newerFrame = frameRevision(frame) > previousRevision;
          const newerHoming = Number(frame.homingEpoch) > previousHomingEpoch;
          return fullHoming ? newerHoming && frame.trusted === true : newerFrame;
        },
        { afterSequence: baseline, description: fullHoming ? 'Home All trust frame' : `${axes} homing frame` },
      );
      const frame = machineFrameFromSlice(machine);
      dispatchConfirmedMachineEvent('cnc-position-trust', data, machine, {
        trusted: frame.trusted === true,
        fullHoming,
        homingEpoch: frame.homingEpoch,
        source: fullHoming ? 'home-all' : 'partial-homing',
        axes,
      });
    };
    if (telemetry?.beginCommand && STATE.operator?.controller) {
      const handle = telemetry.beginCommand('machine.home', { axes },
        genCommandId('machine-home'), { admissionTimeoutMs: 5000, resultTimeoutMs: 600000 });
      let admitted = true;
      try {
        await handle.accepted;
      } catch (admissionError) {
        if (wsCommandDefinitelyNotAccepted(admissionError)) admitted = false;
      }
      if (admitted) {
        await confirmHome(await settleMachineCommandResult(handle, 'home'));
        return;
      }
    }
    await confirmHome(await apiPost('/api/machine/home', { axes }));
  }

  function button(id, action) {
    const item = el(id);
    if (!item) return;
    item.addEventListener('click', () => {
      Promise.resolve(action()).catch((err) => {
        setMessage(err.message || String(err));
        render();
      });
    });
  }

  function setDisabled(id, disabled, options = {}) {
    const item = el(id);
    if (item) setMachineControlDisabled(item, disabled, options);
  }

  function toggleDrawer(open = !STATE.drawerOpen) {
    STATE.drawerOpen = Boolean(open);
    if (STATE.drawerOpen) {
      STATE.jogDockOpen = false;
      STATE.jogSettingsOpen = false;
    }
    document.body.classList.toggle('machine-drawer-open', STATE.drawerOpen);
    document.body.classList.toggle('machine-jog-dock-open', STATE.jogDockOpen);
    const shell = el('machine-drawer');
    const overlay = el('machine-drawer-overlay');
    if (shell) shell.hidden = !STATE.drawerOpen;
    if (overlay) overlay.hidden = !STATE.drawerOpen;
    window.CncTelemetry?.setDemand('health', 'machine-drawer', STATE.drawerOpen);
    window.CncTelemetry?.setDemand('job', 'machine-drawer', STATE.drawerOpen);
    window.CncTelemetry?.setDemand('log', 'machine-drawer', STATE.drawerOpen);
    window.CncTelemetry?.setDemand('jog', 'machine-drawer', STATE.drawerOpen);
  }

  function syncJogDock() {
    const dock = el('machine-jog-dock');
    const panel = dock?.querySelector('.machine-jog-dock-panel');
    const settings = el('mb-jog-settings');
    const toggle = el('mb-jog-settings-toggle');
    const handle = el('mb-jog-dock-toggle');
    if (dock) dock.classList.toggle('is-open', STATE.jogDockOpen);
    if (panel) panel.hidden = !STATE.jogDockOpen;
    if (settings) settings.hidden = !STATE.jogSettingsOpen || !STATE.jogDockOpen;
    if (toggle) toggle.setAttribute('aria-expanded', String(STATE.jogSettingsOpen && STATE.jogDockOpen));
    if (handle) handle.setAttribute('aria-expanded', String(STATE.jogDockOpen));
    document.body.classList.toggle('machine-jog-dock-open', STATE.jogDockOpen);
  }

  function toggleJogDock(open = !STATE.jogDockOpen) {
    STATE.jogDockOpen = Boolean(open);
    if (!STATE.jogDockOpen) STATE.jogSettingsOpen = false;
    syncJogDock();
  }

  function toggleJogSettings(open = !STATE.jogSettingsOpen) {
    STATE.jogSettingsOpen = Boolean(open);
    if (STATE.jogSettingsOpen) STATE.jogDockOpen = true;
    syncJogDock();
  }

  function renderPositionReadouts() {
    const machine = STATE.frame?.machine;
    const text = machine
      ? `M X ${fmtAxis(machine.x)} Y ${fmtAxis(machine.y)} Z ${fmtAxis(machine.z)} | W X ${fmtAxis(STATE.position.x)} Y ${fmtAxis(STATE.position.y)} Z ${fmtAxis(STATE.position.z)}`
      : `W X ${fmtAxis(STATE.position.x)} Y ${fmtAxis(STATE.position.y)} Z ${fmtAxis(STATE.position.z)}`;
    ['mb-xyz', 'mb-drawer-xyz'].forEach((id) => {
      const item = el(id);
      if (item && item.textContent !== text) item.textContent = text;
    });
  }

  function installCriticalHold(item, action) {
    if (!item) return;
    let timer = null;
    let completed = false;
    const reset = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      item.classList.remove('holding');
      item.style.setProperty('--hold-progress', '0');
    };
    const begin = (event) => {
      if (item.disabled || timer) return;
      event.preventDefault();
      completed = false;
      item.classList.add('holding');
      item.style.setProperty('--hold-progress', '1');
      timer = setTimeout(() => {
        completed = true;
        reset();
        Promise.resolve(action()).catch((err) => {
          setMessage(err.message || String(err));
          render();
        });
      }, 500);
    };
    const cancel = (event) => {
      event?.preventDefault();
      if (!completed) reset();
    };
    item.addEventListener('pointerdown', begin);
    item.addEventListener('pointerup', cancel);
    item.addEventListener('pointercancel', cancel);
    item.addEventListener('pointerleave', cancel);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') begin(event);
    });
    item.addEventListener('keyup', cancel);
    item.addEventListener('click', (event) => event.preventDefault());
  }

  function renderMarlinReadouts() {
    const entries = STATE.marlinLog?.entries || [];
    const lastEntry = entries.length ? entries[entries.length - 1] : null;
    const last = el('mb-marlin-last');
    const critical = el('mb-marlin-critical');
    const log = el('mb-marlin-log');
    const live = el('mb-live-marlin');
    if (last) {
      last.textContent = lastEntry
        ? `${lastEntry.direction === 'tx' ? '->' : '<-'} ${lastEntry.text || ''}`.trim()
        : 'No Marlin messages yet.';
    }
    if (critical) {
      critical.hidden = !STATE.marlinLog?.lastCritical;
      critical.textContent = STATE.marlinLog?.lastCritical ? `Warning: ${STATE.marlinLog.lastCritical}` : '';
    }
    if (log) {
      log.textContent = entries.length
        ? entries.map((entry) => {
          const prefix = entry.level === 'error' || entry.level === 'warning'
            ? '!'
            : entry.direction === 'tx' ? '->' : '<-';
          return `${entry.time || '-'} ${prefix}${entry.priority ? ' priority' : ''} ${entry.text || ''}`;
        }).join('\n')
        : 'No recent Marlin log entries.';
      log.scrollTop = log.scrollHeight;
    }
    if (live) {
      const liveText = STATE.marlinLog?.lastCritical || lastEntry?.text || '';
      live.hidden = !liveText || (!ACTIVE_STATES.has(visibleJobState()) && !STATE.marlinLog?.lastCritical);
      live.textContent = STATE.marlinLog?.lastCritical ? `! ${liveText}` : `<- ${liveText}`;
      live.classList.toggle('warning', Boolean(STATE.marlinLog?.lastCritical));
    }
  }

  function renderJogReadouts() {
    const jog = STATE.jog || {};
    const status = el('mb-jog-status');
    if (status) {
      const text = `${jog.state || 'IDLE'} | Safe Z ${jog.zLiftedForJog ? 'lifted' : 'not lifted'} | ${jog.lastError || jog.lastCommand || 'ready'}`;
      if (status.textContent !== text) status.textContent = text;
      status.title = text;
    }
    const restore = el('mb-jog-restore-z');
    const targetZ = Number(jog.originalZ);
    const available = jog.zRestoreAvailable === true && Number.isFinite(targetZ);
    if (restore) {
      const label = available ? `Restore Z ${formatRestoreZ(targetZ)} mm` : 'Restore Z unavailable';
      if (restore.textContent !== label) restore.textContent = label;
      restore.title = available
        ? `Move Z to ${formatRestoreZ(targetZ)} mm at the current X/Y position`
        : 'Safe Jog has no saved Z position to restore';
    }
    setDisabled('mb-jog-restore-z', !available || BUSY_STATES.has(visibleJobState()) || jogIsUiActive());
  }

  function render() {
    syncSafeZControl();
    const state = visibleJobState();
    const recoveryPending = STATE.job?.recoveryCheckpoint?.requiresReview === true;
    const stateLabel = STATE.job?.errorCode === 'COMMUNICATION_LOST' ? 'COMM LOST' : state;
    const displayedStateLabel = recoveryPending && stateLabel === state && SETUP_STATES.has(state)
      ? 'RECOVERY AVAILABLE'
      : stateLabel;
    const running = state === 'RUNNING';
    const busy = BUSY_STATES.has(state);
    const paused = PAUSED_STATES.has(state);
    const progress = Number(STATE.job?.progressPercent || 0);

    const stateEl = el('mb-job-state');
    const mockBadgeEl = el('mb-mock-badge');
    const progressEl = el('mb-progress');
    const xyzEl = el('mb-xyz');
    const drawerXyzEl = el('mb-drawer-xyz');
    const feedEl = el('mb-feed');
    const marlinLastEl = el('mb-marlin-last');
    const marlinCriticalEl = el('mb-marlin-critical');
    const marlinLogEl = el('mb-marlin-log');
    const pauseResumeEl = el('mb-pause');
    const liveMarlinEl = el('mb-live-marlin');
    const jogStatusEl = el('mb-jog-status');
    const jogSettingsToggleEl = el('mb-jog-settings-toggle');
    const restoreZEl = el('mb-jog-restore-z');
    const machine = STATE.frame?.machine;
    const xyzText = machine
      ? `M X ${fmtAxis(machine.x)} Y ${fmtAxis(machine.y)} Z ${fmtAxis(machine.z)} | W X ${fmtAxis(STATE.position.x)} Y ${fmtAxis(STATE.position.y)} Z ${fmtAxis(STATE.position.z)}`
      : `W X ${fmtAxis(STATE.position.x)} Y ${fmtAxis(STATE.position.y)} Z ${fmtAxis(STATE.position.z)}`;
    const feed = feedPercent();
    const entries = STATE.marlinLog?.entries || [];
    const lastEntry = entries.length ? entries[entries.length - 1] : null;

    if (stateEl) {
      stateEl.textContent = displayedStateLabel;
      stateEl.dataset.state = state.toLowerCase();
      stateEl.title = STATE.job?.errorCode === 'COMMUNICATION_LOST'
        ? (STATE.job?.lastError || 'Marlin communication lost')
        : recoveryPending
          ? 'Interrupted-job evidence is saved and available to review'
          : '';
    }
    if (mockBadgeEl) {
      mockBadgeEl.hidden = !STATE.health?.mockMode;
      mockBadgeEl.textContent = 'DEV MOCK';
      mockBadgeEl.title = STATE.health?.modeLabel || 'DEV MOCK - NO REAL MACHINE';
    }
    if (progressEl) progressEl.textContent = ACTIVE_STATES.has(state) ? `${progress.toFixed(1)}%` : '';
    if (xyzEl) xyzEl.textContent = xyzText;
    if (drawerXyzEl) drawerXyzEl.textContent = xyzText;
    if (feedEl) {
      feedEl.textContent = `${feed}%`;
      feedEl.classList.toggle('caution', feed > 125);
    }
    if (marlinLastEl) {
      marlinLastEl.textContent = lastEntry
        ? `${lastEntry.direction === 'tx' ? '->' : '<-'} ${lastEntry.text || ''}`.trim()
        : 'No Marlin messages yet.';
    }
    if (marlinCriticalEl) {
      marlinCriticalEl.hidden = !STATE.marlinLog?.lastCritical;
      marlinCriticalEl.textContent = STATE.marlinLog?.lastCritical
        ? `Warning: ${STATE.marlinLog.lastCritical}`
        : '';
    }
    if (marlinLogEl) {
      marlinLogEl.textContent = entries.length
        ? entries.map((entry) => {
          const prefix = entry.level === 'error' || entry.level === 'warning'
            ? '!'
            : entry.direction === 'tx'
              ? '->'
              : '<-';
          const tag = entry.priority ? ' priority' : '';
          return `${entry.time || '-'} ${prefix}${tag} ${entry.text || ''}`;
        }).join('\n')
        : 'No recent Marlin log entries.';
      marlinLogEl.scrollTop = marlinLogEl.scrollHeight;
    }

    const toolChangePending = paused && STATE.job?.toolChangePending === true;
    const recoveryRequired = state === 'RECOVERY_REQUIRED';
    const pauseLabel = recoveryRequired
      ? 'Review Recovery'
      : toolChangePending
        ? 'Tool Change'
        : state === 'PAUSED_INTACT'
          ? 'Resume'
          : 'Pause';
    [pauseResumeEl].forEach((item) => {
      if (!item) return;
      const label = item.querySelector('.machine-button-label');
      if (label && label.textContent !== pauseLabel) label.textContent = pauseLabel;
      item.setAttribute('aria-label', `${pauseLabel} job`);
      item.title = recoveryRequired
        ? 'Direct Resume is invalid; review the normal recovery workflow'
        : state === 'PAUSED_INTACT'
          ? 'Resume the intact held stream; cutter remains running'
          : 'Hold motion without lifting Z or stopping the cutter';
      const icon = (state === 'PAUSED_INTACT' || recoveryRequired) && !toolChangePending ? 'start' : 'pause';
      if (item.dataset.icon !== icon) {
        item.dataset.icon = icon;
        window.CncSkin?.applyIcons?.(item);
      }
      item.classList.toggle('machine-warn', !paused);
    });
    if (liveMarlinEl) {
      const liveText = STATE.marlinLog?.lastCritical || lastEntry?.text || '';
      liveMarlinEl.hidden = !liveText || (!ACTIVE_STATES.has(state) && !STATE.marlinLog?.lastCritical);
      liveMarlinEl.textContent = STATE.marlinLog?.lastCritical ? `! ${liveText}` : `<- ${liveText}`;
      liveMarlinEl.classList.toggle('warning', Boolean(STATE.marlinLog?.lastCritical));
    }
    if (jogStatusEl) {
      const jog = STATE.jog || {};
      const jogStatusText = `${jog.state || 'IDLE'} | Safe Z ${jog.zLiftedForJog ? 'lifted' : 'not lifted'} | ${jog.lastError || jog.lastCommand || 'ready'}`;
      jogStatusEl.textContent = jogStatusText;
      jogStatusEl.title = jogStatusText;
    }
    if (jogSettingsToggleEl) jogSettingsToggleEl.setAttribute('aria-expanded', String(STATE.jogSettingsOpen));
    const restoreTargetZ = Number(STATE.jog?.originalZ);
    const restoreAvailable = STATE.jog?.zRestoreAvailable === true && Number.isFinite(restoreTargetZ);
    if (restoreZEl) {
      restoreZEl.textContent = restoreAvailable
        ? `Restore Z ${formatRestoreZ(restoreTargetZ)} mm`
        : 'Restore Z unavailable';
      restoreZEl.title = restoreAvailable
        ? `Move Z to ${formatRestoreZ(restoreTargetZ)} mm at the current X/Y position`
        : 'Safe Jog has no saved Z position to restore';
    }
    syncJogDock();

    setDisabled('mb-pause', !(running || state === 'PAUSED_INTACT' || recoveryRequired || isUnknown()) || toolChangePending);
    setDisabled(
      'mb-stop',
      safetyStopDisabled(state),
      { safetyException: true },
    );
    const diagnosticsBusy = ACTIVE_STATES.has(state) || state === 'RECOVERY_REQUIRED' || jogIsUiActive();
    setDisabled('mb-terminal-send', diagnosticsBusy);
    setDisabled('mb-terminal-select', diagnosticsBusy);
    setDisabled('mb-terminal-cmd', diagnosticsBusy);

    const disableZero = busy;
    setDisabled('mb-set-work-zero', disableZero || !canSetup());
    setDisabled('mb-set-z-zero', !canSetZ());
    setDisabled('mb-capture-work-zero', disableZero || !canSetup());
    setDisabled('mb-capture-z-zero', !canSetZ());
    const touchPlateButton = el('mb-touch-plate-z-zero');
    if (touchPlateButton) touchPlateButton.hidden = !STATE.toolChangeSettings?.touchPlateEnabled;
    setDisabled('mb-touch-plate-z-zero', !canSetZ());

    const disableHoming = !canSetup();
    setDisabled('mb-m119', disableHoming);
    setDisabled('mb-home-x', disableHoming);
    setDisabled('mb-home-y', disableHoming);
    setDisabled('mb-home-z', disableHoming);
    setDisabled('mb-home-all', disableHoming);
    setDisabled('mb-jog-restore-z', !restoreAvailable || busy || jogIsUiActive());
    document.querySelectorAll('[data-mb-goto-zero]').forEach((item) => {
      const noActiveWorkZero = STATE.frame?.workZeroValid !== true;
      setMachineControlDisabled(item, disableHoming || jogIsUiActive() || noActiveWorkZero);
      item.title = noActiveWorkZero ? 'Set or restore an active work zero first' : '';
    });
    applyOrdinaryControlGuard();
  }

  function install() {
    installOperatorFetchMonitor();
    const root = document.createElement('div');
    root.className = 'machine-shell';
    root.innerHTML = `
      <div class="machine-bar" role="region" aria-label="Machine safety bar">
        <button id="mb-toggle" class="machine-state" type="button" aria-label="Open machine drawer">
          <strong id="mb-job-state" data-state="unknown">UNKNOWN</strong>
          <span id="mb-progress"></span>
          <span id="mb-xyz">X - Y - Z -</span>
          <small id="mb-mock-badge" class="machine-mock-badge" title="DEV MOCK - NO REAL MACHINE" hidden>DEV MOCK</small>
        </button>
        <div class="machine-actions">
          <button id="mb-pause" class="machine-warn hold-to-confirm" type="button" aria-label="Hold to Pause job" title="Hold motion; cutter remains running" data-icon="pause" data-requires-live-control><span class="machine-button-label">Pause</span></button>
          <button id="mb-stop" class="machine-danger hold-to-confirm" type="button" aria-label="Hold to Stop with M410" title="Stop motion first, then stop the cutter" data-icon="stop" data-safety-exception>Stop</button>
        </div>
        <div id="mb-operator-strip" class="machine-operator-strip" data-controller="false">
          <button id="mb-operator-toggle" type="button" data-operator-control aria-expanded="true">READ ONLY: claim control</button>
        </div>
        <p id="mb-live-marlin" class="machine-live-message" hidden></p>
      </div>
      <section id="mb-operator-panel" class="machine-operator-panel" aria-live="polite" hidden>
        <h2 id="mb-operator-title">Claim machine control</h2>
        <p id="mb-operator-hint">Enter the device PIN. Only one browser can control the machine at a time.</p>
        <label data-operator-claim-field>Controller name<input id="mb-operator-owner" type="text" maxlength="32" autocomplete="nickname" placeholder="Marko phone"></label>
        <label data-operator-claim-field>Device PIN<input id="mb-operator-pin" type="password" inputmode="numeric" minlength="6" maxlength="12" autocomplete="current-password"></label>
        <div class="machine-operator-actions">
          <button id="mb-operator-claim" type="button" data-operator-control>Claim Control</button>
          <button id="mb-operator-release" type="button" data-operator-control hidden>Release Control</button>
          <button id="mb-operator-cancel" type="button">Cancel</button>
        </div>
        <details id="mb-operator-change" data-operator-pin-field hidden>
          <summary>Change device PIN</summary>
          <label>Current PIN<input id="mb-operator-current-pin" type="password" inputmode="numeric" maxlength="12" autocomplete="current-password"></label>
          <label>New 6-12 digit PIN<input id="mb-operator-new-pin" type="password" inputmode="numeric" minlength="6" maxlength="12" autocomplete="new-password"></label>
          <button id="mb-operator-pin-save" type="button" data-operator-control>Save New PIN</button>
        </details>
        <p id="mb-operator-result" class="compact-status"></p>
      </section>
      <div id="machine-drawer-overlay" class="machine-drawer-overlay" hidden></div>
      <div id="machine-jog-dock" class="machine-jog-dock" aria-label="Joystick controls">
        <button id="mb-jog-dock-toggle" class="machine-jog-handle" type="button" aria-label="Open joystick" aria-expanded="false" data-requires-live-control>
          <span class="machine-jog-handle-icon" aria-hidden="true">
            <svg class="cnc-icon machine-jog-handle-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="12" cy="7" r="4.2" />
              <path d="M12 11.5v6" />
              <path d="M6.5 18h11a2 2 0 0 1 2 2v1h-15v-1a2 2 0 0 1 2-2z" />
            </svg>
          </span>
          <span class="machine-jog-handle-label" aria-hidden="true">Jog</span>
        </button>
        <div class="machine-jog-dock-panel" hidden>
          <button id="mb-jog-settings-toggle" class="machine-jog-settings-toggle" type="button" aria-label="Joystick settings" aria-controls="mb-jog-settings" aria-expanded="false" title="Joystick settings" data-requires-live-control>
            <svg class="cnc-icon machine-jog-settings-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" />
              <path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.4-2.5 1a8 8 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.6A8 8 0 0 0 7 6.6l-2.4-1-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a8 8 0 0 0 2.6-1.5l2.4 1 2-3.4z" />
            </svg>
          </button>
          <div id="mb-jog-settings" class="machine-jog-settings machine-jog-dock-settings" hidden>
            <p class="warning">Software controls are not a physical emergency stop.</p>
            <div class="machine-jog-setting-toggles">
              <label><input id="mb-jog-safe" type="checkbox" checked data-requires-live-control> Safe</label>
              <button id="mb-jog-restore-z" class="machine-jog-restore-button" type="button" disabled data-requires-live-control>Restore Z unavailable</button>
            </div>
            <label class="machine-jog-setting-field"><span>Safe Z <output id="mb-jog-safe-z-output">70 mm</output></span><input id="mb-jog-safe-z" type="range" min="1" max="70" step="1" value="70" data-requires-live-control></label>
            <label class="machine-jog-setting-field"><span>XY max <output id="mb-jog-xy-output">50 mm/s</output></span><input id="mb-jog-xy-speed" type="range" min="10" max="100" value="50" data-requires-live-control></label>
            <label class="machine-jog-setting-field"><span>Z max <output id="mb-jog-z-output">5 mm/s</output></span><input id="mb-jog-z-speed" type="range" min="1" max="10" value="5" data-requires-live-control></label>
          </div>
          <div class="machine-jog-dock-core">
            <button id="mb-jog-z-slider" class="machine-jog-z-slider" type="button" aria-label="Variable Z jog slider" data-requires-live-control>
              <span class="machine-jog-z-label machine-jog-z-positive" aria-hidden="true">Z+</span>
              <span id="mb-jog-z-handle" class="machine-jog-z-handle" aria-hidden="true"></span>
              <span class="machine-jog-z-label machine-jog-z-negative" aria-hidden="true">Z-</span>
            </button>
            <div id="mb-jog-pad" class="machine-jog-pad" aria-label="XY jog joystick and locked directions">
              <button class="machine-jog-direction" type="button" data-mb-jog-direction data-direction-label="Y+" data-mb-jog-x="0" data-mb-jog-y="1" style="--direction-x:0px;--direction-y:-74px;--direction-angle:-90deg" aria-label="Jog Y positive" data-requires-live-control><span aria-hidden="true">&#10148;</span></button>
              <button class="machine-jog-direction" type="button" data-mb-jog-direction data-mb-jog-x="1" data-mb-jog-y="1" style="--direction-x:52px;--direction-y:-52px;--direction-angle:-45deg" aria-label="Jog X and Y positive" data-requires-live-control><span aria-hidden="true">&#10148;</span></button>
              <button class="machine-jog-direction" type="button" data-mb-jog-direction data-direction-label="X+" data-mb-jog-x="1" data-mb-jog-y="0" style="--direction-x:74px;--direction-y:0px;--direction-angle:0deg" aria-label="Jog X positive" data-requires-live-control><span aria-hidden="true">&#10148;</span></button>
              <button class="machine-jog-direction" type="button" data-mb-jog-direction data-mb-jog-x="1" data-mb-jog-y="-1" style="--direction-x:52px;--direction-y:52px;--direction-angle:45deg" aria-label="Jog X positive and Y negative" data-requires-live-control><span aria-hidden="true">&#10148;</span></button>
              <button class="machine-jog-direction" type="button" data-mb-jog-direction data-direction-label="Y-" data-mb-jog-x="0" data-mb-jog-y="-1" style="--direction-x:0px;--direction-y:74px;--direction-angle:90deg" aria-label="Jog Y negative" data-requires-live-control><span aria-hidden="true">&#10148;</span></button>
              <button class="machine-jog-direction" type="button" data-mb-jog-direction data-mb-jog-x="-1" data-mb-jog-y="-1" style="--direction-x:-52px;--direction-y:52px;--direction-angle:135deg" aria-label="Jog X and Y negative" data-requires-live-control><span aria-hidden="true">&#10148;</span></button>
              <button class="machine-jog-direction" type="button" data-mb-jog-direction data-direction-label="X-" data-mb-jog-x="-1" data-mb-jog-y="0" style="--direction-x:-74px;--direction-y:0px;--direction-angle:180deg" aria-label="Jog X negative" data-requires-live-control><span aria-hidden="true">&#10148;</span></button>
              <button class="machine-jog-direction" type="button" data-mb-jog-direction data-mb-jog-x="-1" data-mb-jog-y="1" style="--direction-x:-52px;--direction-y:-52px;--direction-angle:225deg" aria-label="Jog X negative and Y positive" data-requires-live-control><span aria-hidden="true">&#10148;</span></button>
              <button id="mb-jog-center" class="machine-jog-center" type="button" aria-label="Free XY joystick" data-requires-live-control>
                <span id="mb-jog-knob" class="machine-jog-knob"></span>
              </button>
            </div>
            <p id="mb-jog-status" class="compact-status">IDLE | Safe Z not lifted | ready</p>
          </div>
        </div>
      </div>
      <aside id="machine-drawer" class="machine-drawer" hidden aria-label="Machine safety drawer">
        <div class="machine-drawer-head">
          <strong>Machine controls</strong>
          <button id="mb-close" type="button">Close</button>
        </div>
        <div class="machine-drawer-card">
          <h2>Job Safety</h2>
          <p class="warning">Software stop is not a physical emergency stop.</p>
          <p><strong>Pause</strong> holds motion without lifting Z and keeps the cutter running. <strong>Stop</strong> uses M410 first and sends M5 only after motion is stopped.</p>
          <p>Use the physical emergency stop for real emergencies. Standalone M5 is restricted to idle Advanced diagnostics.</p>
        </div>
        <div class="machine-drawer-card">
          <h2>Feed Override</h2>
          <p>Movement speed only. Router RPM does not change.</p>
          <div class="machine-feed-adjust">
            <button type="button" data-mb-feed-delta="-10" data-requires-live-control>-10</button>
            <button type="button" data-mb-feed-delta="-1" data-requires-live-control>-1</button>
            <strong id="mb-feed">100%</strong>
            <button type="button" data-mb-feed-delta="1" data-requires-live-control>+1</button>
            <button type="button" data-mb-feed-delta="10" data-requires-live-control>+10</button>
          </div>
          <div class="machine-feed-presets">
            <button type="button" data-mb-feed="50" data-requires-live-control>50%</button>
            <button type="button" data-mb-feed="75" data-requires-live-control>75%</button>
            <button type="button" data-mb-feed="100" data-requires-live-control>100%</button>
            <button type="button" data-mb-feed="125" data-requires-live-control>125%</button>
            <button type="button" data-mb-feed="150" class="machine-warn" data-requires-live-control>150%</button>
          </div>
        </div>
        <div class="machine-drawer-card">
          <h2>Position</h2>
          <p id="mb-drawer-xyz">Use M114 to refresh position.</p>
          <button id="mb-m114" type="button" data-requires-live-control>Refresh Position M114</button>
        </div>
        <div class="machine-drawer-card">
          <h2>Zero</h2>
          <p>Work Zero changes X/Y/Z. Z Zero changes only tool height.</p>
          <div class="machine-drawer-grid">
            <button id="mb-capture-position" type="button" data-requires-live-control>Capture Current Position</button>
            <button id="mb-set-work-zero" type="button" data-icon="workZero" data-requires-live-control>Set Work Zero XYZ</button>
            <button id="mb-set-z-zero" type="button" data-icon="zZero" data-requires-live-control>Set Z Zero Only</button>
            <button id="mb-touch-plate-z-zero" type="button" hidden data-requires-live-control>Touch Plate Z Zero</button>
            <button id="mb-capture-work-zero" type="button" data-requires-live-control>Capture + Set Work Zero</button>
            <button id="mb-capture-z-zero" type="button" data-requires-live-control>Capture + Set Z Zero</button>
          </div>
        </div>
        <div class="machine-drawer-card">
          <h2>Homing</h2>
          <p class="warning">Homing moves the machine toward endstops. Run M119 first if unsure.</p>
          <div class="machine-homing-axis-row">
            <button id="mb-home-x" type="button" data-requires-live-control>X</button>
            <button id="mb-home-y" type="button" data-requires-live-control>Y</button>
            <button id="mb-home-z" type="button" data-requires-live-control>Z</button>
          </div>
          <div class="machine-homing-action-row">
            <button id="mb-home-all" class="machine-danger" type="button" data-requires-live-control>Home All</button>
            <button id="mb-m119" type="button" data-requires-live-control>M119</button>
          </div>
        </div>
        <div class="machine-drawer-card">
          <h2>Go To Work Zero</h2>
          <div class="machine-zero-row">
            <button type="button" data-mb-goto-zero="x" data-requires-live-control>X0</button>
            <button type="button" data-mb-goto-zero="y" data-requires-live-control>Y0</button>
            <button type="button" data-mb-goto-zero="xy" data-requires-live-control>XY0</button>
            <label><input id="mb-goto-safe" type="checkbox" checked> Safe move</label>
          </div>
        </div>
        <div class="machine-drawer-card">
          <h2>Terminal</h2>
          <div class="drawer-terminal-row">
            <select id="mb-terminal-select" aria-label="Marlin command" data-requires-live-control>
              <option value="M114">M114 Position</option>
              <option value="M119">M119 Endstops</option>
              <option value="M115">M115 Firmware</option>
              <option value="M400">M400 Wait</option>
              <option value="M5">M5 Output off</option>
              <option value="G92 Z0">G92 Z0</option>
              <option value="G92 X0 Y0 Z0">G92 XYZ0</option>
              <option value="custom">Custom...</option>
            </select>
            <button id="mb-terminal-send" type="button" data-icon="terminal" data-requires-live-control>Send</button>
          </div>
          <input id="mb-terminal-cmd" type="text" inputmode="text" autocomplete="off" placeholder="Custom Marlin command" hidden data-requires-live-control>
          <p id="mb-marlin-last">No Marlin messages yet.</p>
          <p id="mb-marlin-critical" class="warning" hidden></p>
          <pre id="mb-marlin-log" class="log machine-marlin-log">No recent Marlin log entries.</pre>
          <a class="maintenance-link" href="https://marlinfw.org/docs/gcode/G000-G001.html" target="_blank" rel="noopener">Marlin G-code reference</a>
        </div>
        <p id="mb-status" class="machine-drawer-status"></p>
      </aside>
    `;
    document.body.prepend(root);
    installOrdinaryControlGuard();

    const machineBar = root.querySelector('.machine-bar');
    const syncMachineBarHeight = () => {
      const height = Math.ceil(machineBar?.getBoundingClientRect().height || 58);
      document.documentElement.style.setProperty('--machine-bar-height', `${height}px`);
    };
    syncMachineBarHeight();
    if (globalThis.ResizeObserver && machineBar) new ResizeObserver(syncMachineBarHeight).observe(machineBar);
    else globalThis.addEventListener?.('resize', syncMachineBarHeight);

    button('mb-toggle', () => toggleDrawer());
    button('mb-operator-toggle', () => {
      STATE.operatorPanelOpen = !STATE.operatorPanelOpen;
      renderOperatorLock();
    });
    button('mb-operator-claim', claimOperatorControl);
    button('mb-operator-release', releaseOperatorControl);
    button('mb-operator-cancel', () => {
      STATE.operatorPanelOpen = false;
      renderOperatorLock();
    });
    button('mb-operator-pin-save', updateOperatorPin);
    document.addEventListener('click', (event) => {
      const control = event.target?.closest?.('button, input[type="submit"], input[type="button"], [role="button"]');
      if (!control || control.closest('#mb-operator-panel') || control.id === 'mb-operator-toggle') return;
      operatorIntentUntil = Date.now() + 5000;
    }, true);
    const interceptReadOnlyMachineControl = (event) => {
      if (STATE.operator?.controller || !event.target?.closest?.('.machine-actions, .machine-jog-dock')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      requestOperatorControl('Claim control before operating the machine.');
    };
    document.addEventListener('pointerdown', interceptReadOnlyMachineControl, true);
    document.addEventListener('click', interceptReadOnlyMachineControl, true);
    button('mb-close', () => toggleDrawer(false));
    button('machine-drawer-overlay', () => toggleDrawer(false));
    button('mb-jog-dock-toggle', () => toggleJogDock());
    button('mb-jog-settings-toggle', () => {
      if (!STATE.jogDockOpen) {
        toggleJogDock(true);
      } else {
        toggleJogSettings();
      }
    });
    button('mb-jog-restore-z', restoreJogZ);
    installCriticalHold(el('mb-pause'), pauseOrResumeJob);
    installCriticalHold(el('mb-stop'), stopJob);
    document.querySelectorAll('[data-mb-goto-zero]').forEach((item) => {
      item.addEventListener('click', () => {
        goToWorkZero(item.dataset.mbGotoZero).catch((err) => {
          setMessage(err.message || String(err));
          render();
        });
      });
    });
    document.querySelectorAll('[data-mb-feed]').forEach((item) => {
      item.addEventListener('click', () => {
        setFeedOverride(item.dataset.mbFeed).catch((err) => {
          setMessage(err.message || String(err));
          render();
        });
      });
    });
    document.querySelectorAll('[data-mb-feed-delta]').forEach((item) => {
      item.addEventListener('click', () => {
        setFeedOverride(feedPercent() + Number(item.dataset.mbFeedDelta || 0)).catch((err) => {
          setMessage(err.message || String(err));
          render();
        });
      });
    });
    button('mb-m114', refreshPosition);
    button('mb-capture-position', refreshPosition);
    button('mb-set-work-zero', setWorkZero);
    button('mb-set-z-zero', setZZero);
    button('mb-touch-plate-z-zero', touchPlateZZero);
    button('mb-capture-work-zero', captureAndSetWorkZero);
    button('mb-capture-z-zero', captureAndSetZZero);
    button('mb-m119', () => sendCmd('M119'));
    button('mb-home-x', () => home('G28 X', 'This will move the CNC X axis toward its endstop. Keep your hand near the physical emergency stop.'));
    button('mb-home-y', () => home('G28 Y', 'This will move the CNC Y axis toward its endstop. Keep your hand near the physical emergency stop.'));
    button('mb-home-z', () => home('G28 Z', 'This will move the CNC toward endstops.'));
    button('mb-home-all', () => home('G28', 'HOME ALL AXES: This moves X/Y/Z. Make sure endstops are connected and machine is clear.', true));
    addEventListener('cnc-home-machine-request', () => {
      home('G28', 'HOME ALL AXES: This moves X/Y/Z. Make sure endstops are connected and machine is clear.', true)
        .catch((err) => {
          setMessage(err.message || String(err));
          render();
        });
    });
    button('mb-terminal-send', () => {
      const selected = el('mb-terminal-select')?.value;
      return terminalSend(selected === 'custom' ? el('mb-terminal-cmd')?.value : selected);
    });
    el('mb-terminal-select')?.addEventListener('change', (event) => {
      const custom = event.currentTarget.value === 'custom';
      if (el('mb-terminal-cmd')) el('mb-terminal-cmd').hidden = !custom;
      if (custom) el('mb-terminal-cmd')?.focus();
    });
    el('mb-terminal-cmd')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        terminalSend(event.currentTarget.value).catch((err) => {
          setMessage(err.message || String(err));
          render();
        });
      }
    });
    installJoystick();
    motionSettingsPromise.then(() => {
      if (el('mb-jog-xy-speed')) el('mb-jog-xy-speed').value = travelSpeedMmS;
      if (el('mb-jog-xy-output')) el('mb-jog-xy-output').textContent = `${travelSpeedMmS} mm/s`;
    });
    ['mb-jog-safe-z', 'mb-jog-xy-speed', 'mb-jog-z-speed'].forEach((id) => {
      el(id)?.addEventListener('input', (event) => {
        const outputId = id === 'mb-jog-safe-z'
          ? 'mb-jog-safe-z-output'
          : id === 'mb-jog-xy-speed' ? 'mb-jog-xy-output' : 'mb-jog-z-output';
        const output = el(outputId);
        if (output) output.textContent = `${event.currentTarget.value} ${id === 'mb-jog-safe-z' ? 'mm' : 'mm/s'}`;
        if (id === 'mb-jog-xy-speed' && motionSettingsModule) {
          const settings = motionSettingsModule.saveMotionSettings({ travelSpeedMmS: event.currentTarget.value });
          travelSpeedMmS = settings.travelSpeedMmS;
          dispatchEvent(new CustomEvent('cnc-motion-settings-change', { detail: settings }));
        }
      });
    });
    addEventListener('cnc-motion-settings-change', (event) => {
      travelSpeedMmS = motionSettingsModule?.normalizeTravelSpeed(
        event.detail?.travelSpeedMmS,
        motionSettingsModule.travelSpeedUpperLimit(event.detail),
      ) ?? travelSpeedMmS;
      if (el('mb-jog-xy-speed')) el('mb-jog-xy-speed').value = travelSpeedMmS;
      if (el('mb-jog-xy-output')) el('mb-jog-xy-output').textContent = `${travelSpeedMmS} mm/s`;
    });
    addEventListener('cnc-project-safe-z', (event) => {
      STATE.projectSafeZ = {
        active: Boolean(event.detail?.jobPath),
        jobPath: event.detail?.jobPath || '',
        projectSafeZ: event.detail?.projectSafeZ || null,
      };
      syncSafeZControl();
    });
    addEventListener('storage', (event) => {
      if (event.key === 'lowrider.currentJob') refreshProjectSafeZ().catch(() => {});
    });
    refreshProjectSafeZ().catch(() => {});

    window.CncTelemetry?.subscribe('system', (data) => {
      if (data) {
        STATE.health = data.health || data;
        render();
      }
    });
    window.CncTelemetry?.subscribe('job', (data) => {
      STATE.job = data;
      noteSocketSlice('job', data);
      render();
    });
    window.CncTelemetry?.subscribe('log', (data) => {
      STATE.marlinLog = {
        entries: Array.isArray(data.entries) ? data.entries.slice(-20) : [],
        lastCritical: data.lastCritical || null,
      };
      renderMarlinReadouts();
    });
    loadToolChangeSettings().catch((err) => setMessage(err.message));
    window.CncTelemetry?.subscribe('jog', (data) => {
      STATE.jog = data;
      applyCommandedJogPosition(data);
      noteSocketSlice('jog', data);
      renderJogReadouts();
    });
    window.CncTelemetry?.subscribe('machine', (data) => {
      if (!data) return;
      if (!applyMachineSlice(data)) return;
      noteSocketSlice('machine', data);
      renderPositionReadouts();
    });
    window.addEventListener('blur', () => stopJog(false, true).catch(() => {}));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopJog(false, true).catch(() => {});
        revokeLocalOperatorControl('Page is hidden; controller authorization will be re-established on return.');
        renderOperatorLock();
        return;
      }
      silentlyReconnectOperator().catch(() => {});
    });

    const retryBtn = el('btn-retry-controller-conn');
    if (retryBtn) {
      retryBtn.addEventListener('click', recoverControllerConnection);
    }

    window.CncTelemetry?.subscribe('control', (data) => {
      if (data) {
        applyGlobalControlState(data);
        renderOperatorLock();
      }
    });

    window.CncTelemetry?.subscribe('controller', (data) => {
      STATE.controller = data;
      noteSocketSlice('controller', data);
      renderControllerStatus();
    });

    window.addEventListener('cnc-telemetry-transport', (event) => {
      if (event.detail?.transportStatus === 'failed') stopOperatorHeartbeat();
      else syncOperatorHeartbeat();
      renderControllerStatus();
      render();
    });

    if (window.CncTelemetry) window.CncTelemetry.start();
    syncJogDock();
    if (el('mb-operator-owner')) {
      el('mb-operator-owner').value = localStorage.getItem('cnc.operator.owner') || '';
    }
    renderOperatorLock();
    renderControllerStatus();
    render();
    applyOrdinaryControlGuard();
    silentlyReconnectOperator().catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
}());
