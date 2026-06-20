const cmdInput = document.querySelector('#cmd');
const sendButton = document.querySelector('#send');
const log = document.querySelector('#log');
const health = document.querySelector('#health');
const connectionDot = document.querySelector('#connection-dot');
const connectionState = document.querySelector('#connection-state');
const connectionDetail = document.querySelector('#connection-detail');
const positionSummary = document.querySelector('#position-summary');
const positionCard = document.querySelector('#position-card');
const systemSummary = document.querySelector('#system-summary');
const safeJogInput = document.querySelector('#safe-jog');
const safeLiftZInput = document.querySelector('#safe-lift-z');
const xySpeedInput = document.querySelector('#xy-speed');
const xySpeedLabel = document.querySelector('#xy-speed-label');
const zSpeedInput = document.querySelector('#z-speed');
const xyJoystick = document.querySelector('#xy-joystick');
const xyStick = document.querySelector('#xy-stick');
const zPlusButton = document.querySelector('#z-plus');
const zMinusButton = document.querySelector('#z-minus');
const jogStopButton = document.querySelector('#jog-stop');
const jogStatusEl = document.querySelector('#jog-status');
const controlZSummary = document.querySelector('#control-z-zero-summary');
const controlCapturePositionButton = document.querySelector('#control-capture-position');
const controlSetZZeroButton = document.querySelector('#control-set-z-zero');
const controlCaptureSetZZeroButton = document.querySelector('#control-capture-set-z-zero');

let jogActive = false;
let jogPointerId = null;
let jogPointerDown = false;
let jogStartPending = false;
let jogTimer = null;
let jogVector = { x: 0, y: 0, z: 0, speed: 0 };
let lastPosition = { x: null, y: null, z: null };
let controlZZero = { before: '', after: '', capturedAt: '' };

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function appendLog(text) {
  if (!log) return;
  const time = new Date().toLocaleTimeString();
  log.textContent += `[${time}] ${text}\n`;
  log.scrollTop = log.scrollHeight;
}

function showView(name) {
  const viewName = name || 'dashboard';
  document.querySelectorAll('.view-section').forEach((section) => {
    section.classList.toggle('active', section.dataset.view === viewName);
  });
  document.querySelectorAll('[data-nav-target]').forEach((link) => {
    link.classList.toggle('active', link.dataset.navTarget === viewName);
  });
  const title = document.querySelector('.status-header h1');
  if (title) title.textContent = viewName === 'controls' ? 'Controls' : viewName === 'settings' ? 'Settings' : 'Dashboard';
}

function routeFromHash() {
  const target = (window.location.hash || '#dashboard').slice(1);
  showView(['dashboard', 'controls', 'settings'].includes(target) ? target : 'dashboard');
}

function formatBytes(value) {
  const number = Number(value || 0);
  if (number < 1024) return `${number} B`;
  if (number < 1024 * 1024) return `${Math.round(number / 1024)} KB`;
  return `${(number / 1024 / 1024).toFixed(1)} MB`;
}

function renderPosition() {
  const rows = `
    <dt>X</dt><dd>${lastPosition.x === null ? '-' : lastPosition.x.toFixed(3)}</dd>
    <dt>Y</dt><dd>${lastPosition.y === null ? '-' : lastPosition.y.toFixed(3)}</dd>
    <dt>Z</dt><dd>${lastPosition.z === null ? '-' : lastPosition.z.toFixed(3)}</dd>
  `;
  if (positionSummary) positionSummary.innerHTML = rows;
  if (positionCard) positionCard.innerHTML = `<dl>${rows}</dl>`;
}

function parsePosition(text) {
  const match = String(text).match(/X:\s*(-?\d+(?:\.\d+)?).*?Y:\s*(-?\d+(?:\.\d+)?).*?Z:\s*(-?\d+(?:\.\d+)?)/s);
  if (!match) return;
  lastPosition = {
    x: Number(match[1]),
    y: Number(match[2]),
    z: Number(match[3]),
  };
  renderPosition();
}

function renderControlZZero() {
  if (!controlZSummary) return;
  controlZSummary.innerHTML = `
    <dl>
      <dt>Captured</dt><dd>${html(controlZZero.capturedAt || '-')}</dd>
      <dt>Before G92 Z0</dt><dd>${html(controlZZero.before || '-')}</dd>
      <dt>After G92 Z0</dt><dd>${html(controlZZero.after || '-')}</dd>
    </dl>
  `;
}

async function captureControlPosition() {
  await sendCommand('M400');
  const raw = await sendCommand('M114');
  controlZZero = {
    ...controlZZero,
    before: raw,
    capturedAt: new Date().toISOString(),
  };
  renderControlZZero();
}

async function setControlZZero() {
  if (!confirm('This will set only the current Z position as work Z0. X/Y work zero will not be changed.')) return;
  await sendCommand('M400');
  const before = await sendCommand('M114');
  await sendCommand('G92 Z0');
  const after = await sendCommand('M114');
  controlZZero = {
    before,
    after,
    capturedAt: new Date().toISOString(),
  };
  renderControlZZero();
}

async function refreshHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    const uptimeMs = data.uptimeMs ?? data.uptime_ms ?? 0;
    const freeHeap = data.freeHeap ?? data.heap ?? 0;
    const version = data.firmwareVersion ? ` | ${data.firmwareVersion}` : '';
    const build = data.buildDate && data.buildTime ? ` | ${data.buildDate} ${data.buildTime}` : '';
    const wifi = data.wifiMode && data.ipAddress ? `WiFi ${data.wifiMode} ${data.ipAddress}` : 'WiFi unknown';
    const seconds = Math.floor(uptimeMs / 1000);
    health.textContent = `${data.firmware || 'Pendant'}${version}${build}`;
    connectionDot?.classList.remove('warning-dot');
    connectionDot?.classList.add('ready-dot');
    if (connectionState) connectionState.textContent = 'Online';
    if (connectionDetail) connectionDetail.textContent = `${wifi} | ${data.baudrate} baud`;
    if (systemSummary) {
      systemSummary.innerHTML = `
        <dl>
          <dt>Firmware</dt><dd>${html(data.firmwareVersion || '-')}</dd>
          <dt>Build</dt><dd>${html(data.buildDate || '-')} ${html(data.buildTime || '')}</dd>
          <dt>WiFi</dt><dd>${html(wifi)}</dd>
          <dt>SSID</dt><dd>${html(data.ssid || '-')}</dd>
          <dt>Heap</dt><dd>${formatBytes(freeHeap)}</dd>
          <dt>SD</dt><dd>${data.sdMounted ? `${formatBytes(data.sdFreeBytes)} free` : 'not mounted'}</dd>
          <dt>Uptime</dt><dd>${seconds}s</dd>
        </dl>
      `;
    }
  } catch (err) {
    health.textContent = 'Offline';
    connectionDot?.classList.remove('ready-dot');
    connectionDot?.classList.add('warning-dot');
    if (connectionState) connectionState.textContent = 'Offline';
    if (connectionDetail) connectionDetail.textContent = err.message;
  }
}

async function refreshJobStatus() {
  try {
    const res = await fetch('/api/job/status');
    if (!res.ok) return;
    const data = await res.json();
    if (connectionDetail) {
      const base = connectionDetail.textContent.split(' | Job ')[0];
      connectionDetail.textContent = `${base} | Job ${data.state || 'IDLE'}`;
    }
  } catch (err) {
    // Older firmware may not have job status; the dashboard can still work.
  }
}

async function sendCommand(cmd) {
  const value = cmd.trim();
  if (!value) return;

  appendLog(`> ${value}`);
  if (sendButton) sendButton.disabled = true;

  try {
    const res = await fetch('/api/cmd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: value }),
    });
    const data = await res.json();
    const output = data.ok ? data.response || '(no response)' : `Error: ${data.error || 'command failed'}`;
    appendLog(output);
    if (value.toUpperCase().startsWith('M114')) parsePosition(output);
    return output;
  } catch (err) {
    appendLog(`Error: ${err.message}`);
    throw err;
  } finally {
    if (sendButton) sendButton.disabled = false;
    cmdInput?.focus();
  }
}

function confirmIfNeeded(button) {
  const text = button.dataset.confirm;
  return !text || confirm(text);
}

function speedValue(input) {
  return Math.max(0, Math.min(1, Number(input.value || 0) / 100));
}

function xyMaxSpeedMmSec() {
  return Math.max(10, Math.min(100, Number(xySpeedInput?.value || 50)));
}

function updateJogSpeedLabels() {
  if (xySpeedLabel) xySpeedLabel.textContent = `${xyMaxSpeedMmSec().toFixed(0)} mm/s`;
}

function jogStartBody() {
  const xyMaxMmSec = xyMaxSpeedMmSec();
  return {
    safeJog: safeJogInput?.checked !== false,
    safeLiftZ: Number(safeLiftZInput?.value || 70),
    restoreZAfterJog: true,
    restoreDelayMs: 5000,
    xyFeedMax: xyMaxMmSec * 60,
    zFeedMax: 400,
  };
}

async function postJson(url, body = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${url} failed`);
  return data;
}

function renderJogStatus(data) {
  if (!jogStatusEl || !data) return;
  jogStatusEl.innerHTML = `
    <dl>
      <dt>State</dt><dd>${html(data.state || '-')}</dd>
      <dt>Z lifted</dt><dd>${data.zLiftedForJog ? 'yes' : 'no'}</dd>
      <dt>Original Z</dt><dd>${data.originalZCaptured ? Number(data.originalZ).toFixed(3) : '-'}</dd>
      <dt>Z restore</dt><dd>${data.zRestoreScheduled ? `in ${data.zRestoreDueMs} ms` : '-'}</dd>
      <dt>Last command</dt><dd>${html(data.lastCommand || '-')}</dd>
      <dt>Heartbeat age</dt><dd>${data.heartbeatAgeMs ?? '-'} ms</dd>
      <dt>Error</dt><dd>${html(data.lastError || '-')}</dd>
    </dl>
  `;
}

async function refreshJogStatus() {
  if (!jogStatusEl) return;
  try {
    const res = await fetch('/api/jog/status');
    renderJogStatus(await res.json());
  } catch (err) {
    jogStatusEl.textContent = `Jog status unavailable: ${err.message}`;
  }
}

async function ensureJogStarted() {
  if (jogActive) return;
  jogStartPending = true;
  const data = await postJson('/api/jog/start', jogStartBody());
  jogStartPending = false;
  jogActive = true;
  renderJogStatus(data);
}

async function sendJogUpdate() {
  if (!jogActive) return;
  try {
    const data = await postJson('/api/jog/update', jogVector);
    renderJogStatus(data);
  } catch (err) {
    appendLog(`Jog error: ${err.message}`);
    await stopJog(false);
  }
}

function startJogHeartbeat() {
  clearInterval(jogTimer);
  jogTimer = setInterval(sendJogUpdate, 150);
  sendJogUpdate();
}

async function stopJog(callApi = true) {
  clearInterval(jogTimer);
  jogTimer = null;
  jogPointerId = null;
  jogPointerDown = false;
  jogStartPending = false;
  jogVector = { x: 0, y: 0, z: 0, speed: 0 };
  if (xyStick) {
    xyStick.style.transform = 'translate(-50%, -50%)';
  }
  if (callApi) {
    try {
      renderJogStatus(await postJson('/api/jog/stop'));
    } catch (err) {
      appendLog(`Jog stop failed: ${err.message}`);
    }
  }
  jogActive = false;
}

function updateJoystickVector(event) {
  if (!xyJoystick || !xyStick) return;
  const rect = xyJoystick.getBoundingClientRect();
  const radius = rect.width / 2;
  const cx = rect.left + radius;
  const cy = rect.top + radius;
  const dx = Math.max(-radius, Math.min(radius, event.clientX - cx));
  const dy = Math.max(-radius, Math.min(radius, event.clientY - cy));
  const len = Math.hypot(dx, dy);
  const scale = len > radius ? radius / len : 1;
  const x = (dx * scale) / radius;
  const y = -(dy * scale) / radius;
  xyStick.style.transform = `translate(calc(-50% + ${x * radius}px), calc(-50% + ${-y * radius}px))`;
  jogVector = { x, y, z: 0, speed: 1 };
}

function updateJoystickVectorFromTouch(event) {
  const touch = event.touches?.[0] || event.changedTouches?.[0];
  if (!touch) return;
  updateJoystickVector({
    clientX: touch.clientX,
    clientY: touch.clientY,
  });
}

cmdInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') sendCommand(cmdInput.value);
});

sendButton?.addEventListener('click', () => sendCommand(cmdInput.value));

document.querySelectorAll('[data-cmd]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!confirmIfNeeded(button)) return;
    if (cmdInput) cmdInput.value = button.dataset.cmd;
    sendCommand(button.dataset.cmd);
  });
});

document.querySelectorAll('[data-nav-target]').forEach((link) => {
  link.addEventListener('click', () => {
    const target = link.dataset.navTarget;
    if (target) showView(target);
  });
});

if (xyJoystick) {
  xyJoystick.addEventListener('pointerdown', async (event) => {
    event.preventDefault();
    jogPointerId = event.pointerId;
    jogPointerDown = true;
    xyJoystick.setPointerCapture(jogPointerId);
    updateJoystickVector(event);
    try {
      await ensureJogStarted();
      if (!jogPointerDown) {
        await stopJog();
        return;
      }
      startJogHeartbeat();
    } catch (err) {
      appendLog(`Jog start failed: ${err.message}`);
      stopJog(false);
    }
  });

  xyJoystick.addEventListener('pointermove', (event) => {
    if (event.pointerId !== jogPointerId || !jogPointerDown) return;
    event.preventDefault();
    updateJoystickVector(event);
  });

  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((eventName) => {
    xyJoystick.addEventListener(eventName, (event) => {
      if (event.pointerId === jogPointerId) stopJog();
    });
  });

  xyJoystick.addEventListener('touchstart', (event) => {
    if (!jogPointerDown) return;
    event.preventDefault();
    updateJoystickVectorFromTouch(event);
  }, { passive: false });

  xyJoystick.addEventListener('touchmove', (event) => {
    if (!jogPointerDown) return;
    event.preventDefault();
    updateJoystickVectorFromTouch(event);
  }, { passive: false });

  ['touchend', 'touchcancel'].forEach((eventName) => {
    xyJoystick.addEventListener(eventName, () => {
      if (jogPointerDown || jogStartPending || jogActive) stopJog();
    });
  });
}

async function startZJog(direction) {
  jogVector = { x: 0, y: 0, z: direction, speed: speedValue(zSpeedInput) };
  try {
    await ensureJogStarted();
    startJogHeartbeat();
  } catch (err) {
    appendLog(`Z jog start failed: ${err.message}`);
    stopJog(false);
  }
}

function wireZButton(button, direction) {
  if (!button) return;
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    startZJog(direction);
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((eventName) => {
    button.addEventListener(eventName, () => stopJog());
  });
}

wireZButton(zPlusButton, 1);
wireZButton(zMinusButton, -1);

jogStopButton?.addEventListener('click', () => stopJog());
xySpeedInput?.addEventListener('input', updateJogSpeedLabels);
controlCapturePositionButton?.addEventListener('click', () => captureControlPosition().catch((err) => appendLog(`Capture failed: ${err.message}`)));
controlSetZZeroButton?.addEventListener('click', () => setControlZZero().catch((err) => appendLog(`Set Z zero failed: ${err.message}`)));
controlCaptureSetZZeroButton?.addEventListener('click', () => setControlZZero().catch((err) => appendLog(`Set Z zero failed: ${err.message}`)));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopJog();
});

window.addEventListener('blur', () => stopJog());
window.addEventListener('hashchange', routeFromHash);

renderPosition();
renderControlZZero();
routeFromHash();
refreshHealth();
refreshJobStatus();
refreshJogStatus();
updateJogSpeedLabels();
setInterval(refreshHealth, 5000);
setInterval(refreshJobStatus, 5000);
setInterval(refreshJogStatus, 2000);
