(function () {
  const STATE = {
    job: { state: 'UNKNOWN' },
    health: null,
    position: { x: null, y: null, z: null },
    drawerOpen: false,
    lastMessage: '',
  };

  const ACTIVE_STATES = new Set(['PREPARING', 'RUNNING', 'PAUSING', 'PAUSED', 'RESUMING', 'STOPPING']);
  const BUSY_STATES = new Set(['PREPARING', 'RUNNING', 'PAUSING', 'RESUMING', 'STOPPING']);
  const PAUSED_STATES = new Set(['PAUSED']);
  const SETUP_STATES = new Set(['IDLE', 'STOPPED', 'COMPLETED', 'ERROR']);

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

  function parseM114(text) {
    const match = String(text).match(/X:\s*(-?\d+(?:\.\d+)?).*?Y:\s*(-?\d+(?:\.\d+)?).*?Z:\s*(-?\d+(?:\.\d+)?)/s);
    if (!match) return false;
    STATE.position = {
      x: Number(match[1]),
      y: Number(match[2]),
      z: Number(match[3]),
    };
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

  async function criticalJobPost(url) {
    const res = await fetch(url, { method: 'POST' });
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

  async function setFeedOverride(percent) {
    const value = Math.max(10, Math.min(200, Math.round(Number(percent) || 100)));
    if (value > 150 && !confirm('Feed override above 150% can move the CNC much faster. Continue?')) return;
    await apiPost('/api/job/feed-override', { percent: value });
    STATE.job = { ...(STATE.job || {}), feedOverridePercent: value };
    setMessage(`Feed override ${value}% requested`);
    render();
  }

  async function sendCmd(cmd) {
    const data = await apiPost('/api/cmd', { cmd });
    if (cmd.toUpperCase() === 'M114') parseM114(data.response || '');
    setMessage(`${cmd} sent`);
    render();
    return data.response || '';
  }

  async function sendSequence(commands) {
    for (const cmd of commands) {
      await sendCmd(cmd);
    }
  }

  async function refreshHealth() {
    try {
      const res = await fetch('/api/health');
      STATE.health = await readJson(res);
    } catch (err) {
      STATE.health = null;
    }
    render();
  }

  async function refreshJobStatus() {
    try {
      const res = await fetch('/api/job/status');
      STATE.job = await readJson(res);
      if (!res.ok) throw new Error(STATE.job.error || 'job status failed');
    } catch (err) {
      STATE.job = { state: 'UNKNOWN', lastError: err.message };
    }
    render();
  }

  async function pauseJob() {
    await criticalJobPost('/api/job/pause');
    setMessage('Pause requested');
    STATE.job = { ...(STATE.job || {}), state: 'PAUSING' };
    render();
    await refreshJobStatus();
  }

  async function resumeJob() {
    if (!confirmUnknown('resuming the job')) return;
    await apiPost('/api/job/resume');
    setMessage('Resume requested');
    STATE.job = { ...(STATE.job || {}), state: 'RESUMING' };
    render();
    await refreshJobStatus();
  }

  async function stopJob() {
    const state = visibleJobState();
    if (state === 'STOPPING') {
      setMessage('Stop already requested');
      return;
    }
    try {
      await criticalJobPost('/api/job/stop');
      setMessage('Stop Job requested');
      STATE.job = { ...(STATE.job || {}), state: 'STOPPING' };
      render();
    } catch (err) {
      setMessage(`Stop endpoint failed; sending M5/M400 fallback. ${err.message}`);
      await sendCmd('M5').catch(() => {});
      await sendCmd('M400').catch(() => {});
    }
    await refreshJobStatus();
  }

  async function refreshPosition() {
    await sendCmd('M114');
    setMessage('Position refreshed');
  }

  async function setWorkZero() {
    if (!canSetup()) return;
    if (!confirmUnknown('setting work zero')) return;
    if (!confirm('This will set the current tool position as work X0/Y0/Z0.')) return;
    await sendSequence(['M400', 'M114', 'G92 X0 Y0 Z0', 'M114']);
    setMessage('Work zero set');
  }

  async function setZZero() {
    if (!canSetZ()) return;
    if (!confirmUnknown('setting Z zero')) return;
    if (!confirm('This will set only current Z as work Z0. X/Y will not change.')) return;
    await sendSequence(['M400', 'M114', 'G92 Z0', 'M114']);
    setMessage('Z zero set');
  }

  async function captureAndSetWorkZero() {
    await setWorkZero();
  }

  async function captureAndSetZZero() {
    await setZZero();
  }

  async function home(cmd, message) {
    if (!canSetup()) return;
    if (!confirmUnknown('homing')) return;
    if (!confirm(message)) return;
    await sendCmd(cmd);
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

  function setDisabled(id, disabled) {
    const item = el(id);
    if (item) item.disabled = Boolean(disabled);
  }

  function toggleDrawer(open = !STATE.drawerOpen) {
    STATE.drawerOpen = Boolean(open);
    document.body.classList.toggle('machine-drawer-open', STATE.drawerOpen);
    const shell = el('machine-drawer');
    const overlay = el('machine-drawer-overlay');
    if (shell) shell.hidden = !STATE.drawerOpen;
    if (overlay) overlay.hidden = !STATE.drawerOpen;
  }

  function render() {
    const state = visibleJobState();
    const running = state === 'RUNNING';
    const busy = BUSY_STATES.has(state);
    const paused = PAUSED_STATES.has(state);
    const progress = Number(STATE.job?.progressPercent || 0);

    const stateEl = el('mb-job-state');
    const progressEl = el('mb-progress');
    const xyzEl = el('mb-xyz');
    const drawerXyzEl = el('mb-drawer-xyz');
    const feedEl = el('mb-feed');
    const warningEl = el('mb-warning');
    const xyzText = `X ${fmtAxis(STATE.position.x)} Y ${fmtAxis(STATE.position.y)} Z ${fmtAxis(STATE.position.z)}`;
    const feed = feedPercent();

    if (stateEl) {
      stateEl.textContent = state;
      stateEl.dataset.state = state.toLowerCase();
    }
    if (progressEl) progressEl.textContent = ACTIVE_STATES.has(state) ? `${progress.toFixed(1)}%` : '';
    if (xyzEl) xyzEl.textContent = xyzText;
    if (drawerXyzEl) drawerXyzEl.textContent = xyzText;
    if (feedEl) {
      feedEl.textContent = `${feed}%`;
      feedEl.classList.toggle('caution', feed > 125);
    }
    if (warningEl) warningEl.hidden = state !== 'UNKNOWN';

    setDisabled('mb-pause', !(running || isUnknown()));
    setDisabled('mb-resume', !(paused || isUnknown()));
    setDisabled('mb-stop', state === 'STOPPING');
    setDisabled('mb-drawer-pause', !(running || isUnknown()));
    setDisabled('mb-drawer-resume', !(paused || isUnknown()));
    setDisabled('mb-drawer-stop', state === 'STOPPING');

    const disableZero = busy;
    setDisabled('mb-set-work-zero', disableZero || !canSetup());
    setDisabled('mb-set-z-zero', !canSetZ());
    setDisabled('mb-capture-work-zero', disableZero || !canSetup());
    setDisabled('mb-capture-z-zero', !canSetZ());

    const disableHoming = !canSetup();
    setDisabled('mb-m119', disableHoming);
    setDisabled('mb-home-xy', disableHoming);
    setDisabled('mb-home-z', disableHoming);
    setDisabled('mb-home-all', disableHoming);
  }

  function install() {
    const root = document.createElement('div');
    root.className = 'machine-shell';
    root.innerHTML = `
      <div class="machine-bar" role="region" aria-label="Machine safety bar">
        <button id="mb-toggle" class="machine-state" type="button" aria-label="Open machine drawer">
          <strong id="mb-job-state" data-state="unknown">UNKNOWN</strong>
          <span id="mb-progress"></span>
          <span id="mb-xyz">X - Y - Z -</span>
        </button>
        <div class="machine-actions">
          <button id="mb-pause" class="machine-warn" type="button">Pause</button>
          <button id="mb-stop" class="machine-danger" type="button">Stop</button>
          <button id="mb-m5" class="machine-danger-dark" type="button">M5</button>
        </div>
      </div>
      <div id="machine-drawer-overlay" class="machine-drawer-overlay" hidden></div>
      <aside id="machine-drawer" class="machine-drawer" hidden aria-label="Machine safety drawer">
        <div class="machine-drawer-head">
          <div>
            <strong>Machine</strong>
            <p id="mb-warning" class="warning" hidden>Machine/job state is unknown.</p>
          </div>
          <button id="mb-close" type="button">Close</button>
        </div>
        <div class="machine-drawer-card">
          <h2>Job Safety</h2>
          <p class="warning">Software stop is not a physical emergency stop.</p>
          <div class="machine-drawer-grid">
            <button id="mb-drawer-pause" class="machine-warn" type="button">Pause Job</button>
            <button id="mb-drawer-resume" type="button">Resume Job</button>
            <button id="mb-drawer-stop" class="machine-danger" type="button">Stop Job</button>
            <button id="mb-drawer-m5" class="machine-danger-dark" type="button">M5 Off</button>
          </div>
        </div>
        <div class="machine-drawer-card">
          <h2>Feed Override</h2>
          <p>Movement speed only. Router RPM does not change.</p>
          <p>Current: <strong id="mb-feed">100%</strong></p>
          <div class="machine-drawer-grid">
            <button type="button" data-mb-feed="50">50%</button>
            <button type="button" data-mb-feed="75">75%</button>
            <button type="button" data-mb-feed="100">100%</button>
            <button type="button" data-mb-feed="125">125%</button>
            <button type="button" data-mb-feed="150" class="machine-warn">150%</button>
            <button type="button" data-mb-feed-delta="-10">-10%</button>
            <button type="button" data-mb-feed-delta="10">+10%</button>
          </div>
        </div>
        <div class="machine-drawer-card">
          <h2>Position</h2>
          <p id="mb-drawer-xyz">Use M114 to refresh position.</p>
          <button id="mb-m114" type="button">Refresh Position M114</button>
        </div>
        <div class="machine-drawer-card">
          <h2>Zero</h2>
          <p>Work Zero changes X/Y/Z. Z Zero changes only tool height.</p>
          <div class="machine-drawer-grid">
            <button id="mb-capture-position" type="button">Capture Current Position</button>
            <button id="mb-set-work-zero" type="button">Set Work Zero XYZ</button>
            <button id="mb-set-z-zero" type="button">Set Z Zero Only</button>
            <button id="mb-capture-work-zero" type="button">Capture + Set Work Zero</button>
            <button id="mb-capture-z-zero" type="button">Capture + Set Z Zero</button>
          </div>
        </div>
        <div class="machine-drawer-card">
          <h2>Homing</h2>
          <p class="warning">Homing moves the machine toward endstops. Run M119 first if unsure.</p>
          <div class="machine-drawer-grid">
            <button id="mb-m119" type="button">M119 Endstops</button>
            <button id="mb-home-xy" type="button">Home X/Y</button>
            <button id="mb-home-z" type="button">Home Z</button>
            <button id="mb-home-all" class="machine-danger" type="button">Home All</button>
          </div>
        </div>
        <p id="mb-status" class="machine-drawer-status"></p>
      </aside>
    `;
    document.body.prepend(root);

    button('mb-toggle', () => toggleDrawer());
    button('mb-close', () => toggleDrawer(false));
    button('machine-drawer-overlay', () => toggleDrawer(false));
    button('mb-pause', pauseJob);
    button('mb-drawer-pause', pauseJob);
    button('mb-resume', resumeJob);
    button('mb-drawer-resume', resumeJob);
    button('mb-stop', stopJob);
    button('mb-drawer-stop', stopJob);
    button('mb-m5', () => sendCmd('M5'));
    button('mb-drawer-m5', () => sendCmd('M5'));
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
    button('mb-capture-work-zero', captureAndSetWorkZero);
    button('mb-capture-z-zero', captureAndSetZZero);
    button('mb-m119', () => sendCmd('M119'));
    button('mb-home-xy', () => home('G28 X Y', 'This will move the CNC toward endstops.'));
    button('mb-home-z', () => home('G28 Z', 'This will move the CNC toward endstops.'));
    button('mb-home-all', () => home('G28', 'HOME ALL AXES: This moves X/Y/Z. Make sure endstops are connected and machine is clear.'));

    setInterval(() => {
      if (!document.hidden) refreshJobStatus();
    }, 2000);
    setInterval(() => {
      if (!document.hidden) refreshHealth();
    }, 5000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        refreshJobStatus();
        refreshHealth();
      }
    });

    refreshJobStatus();
    refreshHealth();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
}());
