import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

const telemetryCode = (await readFile(new URL('../../www/telemetry.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const machineBarCode = (await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const firmware = (await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

// ── telemetry.js sandbox ────────────────────────────────────────────────────
// Loads the real telemetry IIFE against a minimal browser-like environment.
function loadTelemetry() {
  const windowListeners = new Map();
  const window = {
    CncTelemetry: null,
    CNC_TELEMETRY_TEST_MODE: true,
    addEventListener(type, listener) {
      const list = windowListeners.get(type) || [];
      list.push(listener);
      windowListeners.set(type, list);
    },
    removeEventListener() {},
    dispatchEvent() {},
  };
  const document = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
  };
  class FakeWebSocket {
    static OPEN = 1;
  }
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'window', 'document', 'WebSocket', 'location', 'localStorage',
    `${telemetryCode}; return window.CncTelemetry;`,
  );
  const api = factory(window, document, FakeWebSocket, { hostname: '127.0.0.1' }, {});
  return { api, windowListeners };
}

describe('telemetry claimRequired command gate', () => {
  it('rejects commands with UNAUTHORIZED while a claim is required (default)', async () => {
    const { api } = loadTelemetry();
    await expect(api.command('job.pause', null, 'cmd-default-1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const begin = api.beginCommand('machine.home', null, 'cmd-default-2');
    await expect(begin.accepted).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(begin.result).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(api.commandQuery('cmd-default-3')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('does not reject open-mode commands for a missing token', async () => {
    const { api } = loadTelemetry();
    api.setClaimRequired(false);
    // The socket is disconnected in this sandbox, so the command must fail for
    // transport reasons only - never for a missing control-session token.
    await expect(api.command('job.pause', null, 'cmd-open-1')).rejects.toMatchObject({ code: 'TRANSPORT_UNAVAILABLE' });
    const begin = api.beginCommand('machine.home', null, 'cmd-open-2');
    await expect(begin.accepted).rejects.toMatchObject({ code: 'TRANSPORT_UNAVAILABLE' });
    await expect(begin.result).rejects.toMatchObject({ code: 'TRANSPORT_UNAVAILABLE' });
    await expect(api.commandQuery('cmd-open-3')).rejects.toMatchObject({ code: 'TRANSPORT_UNAVAILABLE' });
  });

  it('stores only strict booleans and recovers the claimed default', () => {
    const { api } = loadTelemetry();
    expect(api.__test__.getClaimRequired()).toBe(true);
    api.setClaimRequired(false);
    expect(api.__test__.getClaimRequired()).toBe(false);
    api.setClaimRequired(false);
    expect(api.__test__.getClaimRequired()).toBe(false);
    api.setClaimRequired(true);
    expect(api.__test__.getClaimRequired()).toBe(true);
    api.setClaimRequired('nope');
    expect(api.__test__.getClaimRequired()).toBe(false); // 'nope' !== true -> false
    api.setClaimRequired(0);
    expect(api.__test__.getClaimRequired()).toBe(false);
  });
});

// ── machine-bar.js harness (same pattern as phase2-end-to-end.test.mjs) ─────
function createElement(id = '', className = '') {
  const attributes = new Map();
  const listeners = new Map();
  const node = {
    id,
    className,
    disabled: false,
    hidden: false,
    checked: false,
    value: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    style: { setProperty() {} },
    addEventListener(type, listener) {
      const list = listeners.get(type) || [];
      list.push(listener);
      listeners.set(type, list);
    },
    removeEventListener() {},
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener({ currentTarget: node, target: node, ...event });
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
        node.dataset[key] = String(value);
      }
    },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    matches(selector) {
      return selector.split(',').some((part) => {
        const item = part.trim();
        if (item.startsWith('#')) return node.id === item.slice(1);
        if (item.startsWith('.')) return node.className.split(/\s+/).includes(item.slice(1));
        if (item === '[data-requires-live-control]') return attributes.has('data-requires-live-control');
        const dataMatch = item.match(/^\[([a-z0-9-]+)\]$/i);
        return dataMatch ? attributes.has(dataMatch[1]) : false;
      });
    },
    closest(selector) { return node.matches(selector) ? node : null; },
    querySelector() { return node; },
    querySelectorAll() { return []; },
    append() {},
    prepend() {},
    getBoundingClientRect() {
      return { height: 48, width: 300, top: 0, bottom: 48, left: 0, right: 300 };
    },
  };
  node.classList = {
    add(name) {
      if (!node.className.split(/\s+/).includes(name)) node.className = `${node.className} ${name}`.trim();
    },
    remove(name) {
      node.className = node.className.split(/\s+/).filter((value) => value !== name).join(' ');
    },
    toggle(name, force) {
      const enabled = force ?? !node.className.split(/\s+/).includes(name);
      if (enabled) node.classList.add(name);
      else node.classList.remove(name);
    },
  };
  return node;
}

function createMachineBarEnv(options = {}) {
  const elements = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const telemetrySubscribers = new Map();
  const dispatched = [];
  const fetchCalls = [];
  let created = 0;

  const ensure = (id, className = '') => {
    if (!elements.has(id)) elements.set(id, createElement(id, className));
    return elements.get(id);
  };
  [
    'mb-stop', 'mb-pause', 'btn-retry-controller-conn', 'controller-comm-status', 'controller-comm-message',
    'machine-jog-dock', 'machine-jog-dock-panel', 'mb-jog-settings', 'mb-jog-settings-toggle',
    'mb-jog-dock-toggle', 'mb-job-state', 'mb-progress', 'mb-xyz', 'mb-drawer-xyz',
    'mb-feed', 'mb-marlin-last', 'mb-marlin-critical', 'mb-marlin-log',
    'mb-jog-status', 'mb-live-marlin', 'mb-operator-strip', 'mb-operator-toggle',
    'mb-operator-panel', 'mb-operator-claim', 'mb-operator-release', 'mb-operator-change',
    'mb-operator-title', 'mb-operator-hint', 'mb-operator-owner', 'mb-operator-pin',
    'mb-operator-result', 'mb-operator-claim-required', 'mb-touch-plate-z-zero', 'mb-capture-work-zero',
    'mb-capture-z-zero', 'mb-terminal-select', 'mb-terminal-cmd', 'mb-m119', 'mb-status',
  ].forEach((id) => ensure(id));

  const localStorage = {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  };

  const document = {
    readyState: 'complete',
    hidden: false,
    documentElement: { style: { setProperty() {} } },
    body: {
      prepend() {},
      appendChild() {},
      classList: { add() {}, remove() {}, toggle() {} },
    },
    createElement(tag) {
      created += 1;
      return ensure(`created-${tag}-${created}`);
    },
    getElementById: ensure,
    querySelector(selector) {
      if (selector.startsWith('#')) return ensure(selector.slice(1));
      return ensure(`query-${selector}`);
    },
    querySelectorAll() { return []; },
    addEventListener(type, listener) {
      const list = documentListeners.get(type) || [];
      list.push(listener);
      documentListeners.set(type, list);
    },
    removeEventListener() {},
  };

  const telemetrySpies = {
    setClaimRequired: vi.fn(),
    setSocketCommandToken: vi.fn(),
    revokeCommandAuthorization: vi.fn(),
  };
  const telemetry = {
    transportStatus: 'synchronized',
    command: options.telemetryCommand,
    beginCommand: options.telemetryBeginCommand,
    ...telemetrySpies,
    subscribe(topic, listener) {
      telemetrySubscribers.set(topic, listener);
      return () => {};
    },
    setDemand() {},
    start() {},
  };

  const defaultFetch = async (url) => ({
    ok: true,
    status: 200,
    url: String(url),
    async text() { return '{}'; },
  });
  const fetchImpl = async (...args) => {
    fetchCalls.push({ url: String(args[0]), init: args[1] || {} });
    return (options.fetch || defaultFetch)(...args);
  };
  fetchImpl.bind = () => fetchImpl;

  class FakeCustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  }

  const window = {
    CncTelemetry: telemetry,
    fetch: fetchImpl,
    localStorage,
    crypto: globalThis.crypto,
    location: { href: '', pathname: '/index.html' },
    addEventListener(type, listener) {
      const list = windowListeners.get(type) || [];
      list.push(listener);
      windowListeners.set(type, list);
    },
    removeEventListener() {},
    dispatchEvent(event) {
      dispatched.push(event);
      for (const listener of windowListeners.get(event.type) || []) listener(event);
    },
  };

  // eslint-disable-next-line no-new-func
  const setup = new Function(
    'window', 'document', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'localStorage',
    'CustomEvent', 'MutationObserver', 'fetch',
    `${machineBarCode}; return window.LowRiderMachineBar;`,
  );
  const api = setup(
    window,
    document,
    window.addEventListener.bind(window),
    window.removeEventListener.bind(window),
    window.dispatchEvent.bind(window),
    localStorage,
    FakeCustomEvent,
    undefined,
    fetchImpl,
  );

  return {
    api,
    window,
    document,
    documentListeners,
    elements,
    telemetry,
    telemetrySpies,
    fetchCalls,
    emitTelemetry(topic, data) {
      telemetrySubscribers.get(topic)?.(data);
    },
    async flush() { await new Promise((resolve) => setTimeout(resolve, 10)); },
  };
}

const openControlSlice = {
  configured: false,
  active: false,
  claimRequired: false,
  owner: null,
  canClaim: true,
  leaseMs: 45000,
  leaseExpiresAtUptimeMs: 0,
  controlSessionEpoch: 0,
};

function clickOnMachineActions() {
  return {
    target: { closest: (selector) => (selector.includes('machine-actions') ? { id: 'mb-pause' } : null) },
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };
}

describe('machine-bar open control mode', () => {
  it('merges claimRequired:false from the control slice into non-read-only open state', () => {
    const env = createMachineBarEnv();
    env.api.applyGlobalControlState({ ...openControlSlice });
    const state = env.api.operatorState();
    expect(state.claimRequired).toBe(false);
    expect(state.controller).toBe(false);
    expect(state.readOnly).toBe(false);
    expect(env.telemetrySpies.setClaimRequired).toHaveBeenCalledWith(false);
    expect(env.telemetrySpies.revokeCommandAuthorization).not.toHaveBeenCalled();
  });

  it('keeps claimed+locked semantics byte-for-byte when claimRequired stays true', () => {
    const env = createMachineBarEnv();
    env.api.applyGlobalControlState({ ...openControlSlice, claimRequired: true, configured: true });
    const state = env.api.operatorState();
    expect(state.readOnly).toBe(true);
    expect(env.telemetrySpies.setClaimRequired).toHaveBeenCalledWith(true);
  });

  it('does not revoke a controller when the slice reports open mode', () => {
    const env = createMachineBarEnv();
    env.api.applyLocalOperatorAuthorization({
      controller: true, controlSessionEpoch: 4, socketCommandToken: 'c'.repeat(40),
    });
    env.telemetrySpies.setClaimRequired.mockClear();
    env.api.applyGlobalControlState({ ...openControlSlice, active: true, owner: 'Alice', controlSessionEpoch: 4 });
    expect(env.telemetrySpies.revokeCommandAuthorization).not.toHaveBeenCalled();
    // Losing the session under a claimed (locked) server still revokes.
    env.api.applyGlobalControlState({
      ...openControlSlice, claimRequired: true, owner: 'Bob', controlSessionEpoch: 5,
    });
    expect(env.telemetrySpies.revokeCommandAuthorization).toHaveBeenCalled();
  });

  it('does not intercept .machine-actions clicks while control is open', () => {
    const env = createMachineBarEnv();
    // install() renders the panel hidden; the guard in open mode must never open it.
    expect(env.elements.get('mb-operator-panel').hidden).toBe(true);
    env.api.applyGlobalControlState({ ...openControlSlice });

    const event = clickOnMachineActions();
    for (const handler of env.documentListeners.get('click') || []) handler(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(env.elements.get('mb-operator-panel').hidden).toBe(true); // untouched by the guard
  });

  it('still intercepts clicks while the claim requirement holds', () => {
    const env = createMachineBarEnv();
    const event = clickOnMachineActions();
    for (const handler of env.documentListeners.get('click') || []) handler(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopImmediatePropagation).toHaveBeenCalled();
    expect(env.elements.get('mb-operator-panel').hidden).toBe(false); // claim panel opened
  });

  it('toggles the persisted setting through PUT /api/operator/settings', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          ok: true, configured: false, claimRequired: true, active: false,
          controller: false, readOnly: true, canClaim: true,
        });
      },
    }));
    const env = createMachineBarEnv({ fetch });
    env.api.applyGlobalControlState({ ...openControlSlice });

    const box = env.elements.get('mb-operator-claim-required');
    box.checked = true;
    box.dispatch('change');
    await env.flush();

    expect(fetch).toHaveBeenCalledWith('/api/operator/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimRequired: true }),
    });
    const state = env.api.operatorState();
    expect(state.claimRequired).toBe(true);
    expect(state.readOnly).toBe(true);
    expect(env.telemetrySpies.setClaimRequired).toHaveBeenLastCalledWith(true);
    expect(env.elements.get('mb-operator-claim-required').checked).toBe(true);
  });

  it('reverts the checkbox and shows the error when the server refuses (423)', async () => {
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 423,
      async text() {
        return JSON.stringify({ ok: false, error: 'Operator control is locked.' });
      },
    }));
    const env = createMachineBarEnv({ fetch });
    env.api.applyGlobalControlState({ ...openControlSlice, claimRequired: true });

    const box = env.elements.get('mb-operator-claim-required');
    box.checked = false;
    box.dispatch('change');
    await env.flush();

    expect(fetch).toHaveBeenCalledWith('/api/operator/settings', expect.anything());
    expect(box.checked).toBe(true); // reverted to the merged state (claimRequired: true)
    expect(env.elements.get('mb-operator-result').textContent).toBe('Operator control is locked.');
  });

  it('renders open-mode panel texts and reflects the persisted setting', () => {
    const env = createMachineBarEnv();
    env.emitTelemetry('control', { ...openControlSlice });
    expect(env.elements.get('mb-operator-toggle').textContent).toBe('○ open');
    expect(env.elements.get('mb-operator-title').textContent).toBe('Machine control is open');
    expect(env.elements.get('mb-operator-hint').textContent).toContain('Claiming is optional');
    expect(env.elements.get('mb-operator-claim-required').checked).toBe(false);
  });
});

describe('firmware claimRequired contract', () => {
  it('persists the setting, defaults it to false, and gates both command paths', () => {
    expect(firmware).toContain('constexpr const char *kOperatorPrefsClaimRequiredKey = "claimReq";');
    expect(firmware).toContain('bool operatorClaimRequiredSetting = false;');
    expect(firmware).toContain('operatorClaimRequiredSetting = operatorPrefs.getBool(kOperatorPrefsClaimRequiredKey, false);');
    const wsGate = firmware.slice(
      firmware.indexOf('bool wsCommandAuthorizationMatchesLocked('),
      firmware.indexOf('const bool matches = token != nullptr'),
    );
    expect(wsGate).toContain('if (!operatorClaimRequiredSetting) return true;');
    expect(firmware).toContain('if (!operatorClaimRequiredSetting || requireOperatorControl()) handler();');
    expect(firmware).toContain('operatorRoute("/api/operator/settings", HTTP_PUT, handleOperatorSettingsUpdate);');
    expect(firmware).toContain('void handleOperatorSettingsUpdate()');
    expect(firmware).toContain('saveOperatorClaimRequired(doc["claimRequired"].as<bool>());');
    // Strict settings parse: only a real top-level JSON boolean is accepted.
    const settingsHandler = firmware.slice(
      firmware.indexOf('void handleOperatorSettingsUpdate()'),
      firmware.indexOf('void handleOperatorClaim()'),
    );
    expect(settingsHandler).toContain('deserializeJson(doc, body)');
    expect(settingsHandler).toContain('!doc["claimRequired"].is<bool>()');
    // Token-less WS packets are admitted at the parse layer only in open mode;
    // the single gate stays wsCommandAuthorizationMatchesLocked().
    expect(firmware).toContain('if (strlen(token) != 40 && operatorClaimRequiredSetting) {');
    expect(firmware).toContain('if (strlen(queryToken) != 40 && operatorClaimRequiredSetting) {');
    // OTA unlock keeps its own claim gate.
    const otaHandler = firmware.slice(firmware.indexOf('void handleOperatorOtaUnlock()'), firmware.indexOf('void operatorRoute('));
    expect(otaHandler).toContain('if (!requireOperatorControl()) return;');
  });

  it('exposes claimRequired in the operator status and control slices', () => {
    const statusFn = firmware.slice(firmware.indexOf('String operatorStatusJson('), firmware.indexOf('void sendOperatorLocked()'));
    expect(statusFn).toContain('claimRequired');
    expect(statusFn).toContain('!controller && operatorClaimRequiredSetting');
    const controlFn = firmware.slice(firmware.indexOf('String buildControlSliceJson()'), firmware.indexOf('String buildMachineProfileSliceJson()'));
    expect(controlFn).toContain('claimRequired');
  });
});
