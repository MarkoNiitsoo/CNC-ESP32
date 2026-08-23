import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

const machineBarCode = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
const previewCode = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');

const guardedIds = [
  'mb-home-x', 'mb-home-y', 'mb-home-z', 'mb-home-all',
  'mb-set-work-zero', 'mb-set-z-zero', 'mb-jog-restore-z', 'mb-jog-safe-z',
  'mb-jog-z-slider', 'jog-direction', 'mb-terminal-send',
  'readiness-run-bounds', 'readiness-run-aircut', 'send-dry-run',
  'start-job', 'pause-job', 'resume-job', 'feed-live-percent', 'feed-live-set',
];

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
    ...guardedIds,
    'mb-stop', 'btn-retry-controller-conn', 'controller-comm-status', 'controller-comm-message',
    'machine-jog-dock', 'machine-jog-dock-panel', 'mb-jog-settings', 'mb-jog-settings-toggle',
    'mb-jog-dock-toggle', 'mb-job-state', 'mb-progress', 'mb-xyz', 'mb-drawer-xyz',
    'mb-feed', 'mb-marlin-last', 'mb-marlin-critical', 'mb-marlin-log', 'mb-pause',
    'mb-jog-status', 'mb-live-marlin', 'mb-operator-strip', 'mb-operator-toggle',
    'mb-operator-panel', 'mb-operator-claim', 'mb-operator-release', 'mb-operator-change',
    'mb-operator-title', 'mb-operator-hint', 'mb-operator-owner', 'mb-operator-pin',
    'mb-operator-result', 'mb-touch-plate-z-zero', 'mb-capture-work-zero',
    'mb-capture-z-zero', 'mb-terminal-select', 'mb-terminal-cmd', 'mb-m119',
  ].forEach((id) => ensure(id));
  ensure('jog-direction').setAttribute('data-mb-jog-direction', '');

  const storage = new Map(Object.entries(options.storage || {}));
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };

  const document = {
    readyState: 'complete',
    hidden: Boolean(options.hidden),
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
    querySelectorAll(selector) {
      return [...elements.values()].filter((node) => node.matches(selector));
    },
    addEventListener(type, listener) {
      const list = documentListeners.get(type) || [];
      list.push(listener);
      documentListeners.set(type, list);
    },
    removeEventListener() {},
  };

  const telemetry = options.telemetry === false ? null : {
    transportStatus: options.transportStatus || 'synchronized',
    command: options.telemetryCommand,
    beginCommand: options.telemetryBeginCommand,
    setSocketCommandToken() {},
    revokeCommandAuthorization() {},
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
    async text() {
      if (String(url).includes('/api/operator/claim') ||
          String(url).includes('/api/operator/heartbeat') ||
          String(url).includes('/api/operator/reconnect')) {
        return JSON.stringify({
          ok: true, configured: true, active: true, controller: true, readOnly: false,
          owner: 'Alice', canClaim: false, leaseMs: 45000,
          controlSessionEpoch: 1,
        });
      }
      return '{}';
    },
    clone() { return this; },
    async json() { return {}; },
  });
  const fetchImpl = async (...args) => {
    fetchCalls.push(String(args[0]));
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
    location: { href: '', pathname: '/preview.html' },
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

  const setup = new Function(
    'window', 'document', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'localStorage',
    'CustomEvent', 'MutationObserver', 'fetch',
    `${machineBarCode}; return window.LowRiderMachineBar;`
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
    elements,
    telemetry,
    telemetrySubscribers,
    dispatched,
    fetchCalls,
    emitTelemetry(topic, data) {
      telemetrySubscribers.get(topic)?.(data);
    },
    emitTransport(status) {
      if (telemetry) telemetry.transportStatus = status;
      const event = new FakeCustomEvent('cnc-telemetry-transport', { detail: { transportStatus: status } });
      for (const listener of windowListeners.get(event.type) || []) listener(event);
    },
    setHidden(hidden) {
      document.hidden = hidden;
      for (const listener of documentListeners.get('visibilitychange') || []) listener();
    },
  };
}

describe('Phase 2 end-to-end UI correctness', () => {
  it('fails closed without CncTelemetry', () => {
    const env = createMachineBarEnv({ telemetry: false });
    env.api.renderControllerStatus();
    env.api.render();
    guardedIds.forEach((id) => expect(env.elements.get(id).disabled, id).toBe(true));
  });

  it.each(['IDLE', 'UNKNOWN', 'RUNNING'])(
    'keeps Stop enabled and ordinary controls disabled for stale %s state',
    (jobState) => {
      const env = createMachineBarEnv();
      env.emitTelemetry('job', { state: jobState, progressPercent: 10 });
      env.emitTelemetry('controller', { state: 'connected' });
      env.emitTransport('stale');

      env.api.renderControllerStatus();
      env.api.render();
      guardedIds.forEach((id) => expect(env.elements.get(id).disabled, id).toBe(true));
      expect(env.elements.get('mb-stop').disabled).toBe(false);
      expect(env.api.safetyStopDisabled(jobState)).toBe(false);
      expect(env.elements.get('btn-retry-controller-conn').disabled).toBe(false);
      expect(previewCode).toContain('window.LowRiderMachineBar?.safetyStopDisabled?.(state)');
    },
  );

  it('allows synchronized IDLE to disable Stop', () => {
    const env = createMachineBarEnv();
    env.emitTelemetry('job', { state: 'IDLE' });
    env.emitTelemetry('controller', { state: 'connected' });
    env.api.render();
    expect(env.api.safetyStopDisabled('IDLE')).toBe(true);
    expect(env.elements.get('mb-stop').disabled).toBe(true);
  });

  it('dispatches HTTP Stop without waiting for an authorized WS command and completes from canonical state', async () => {
    const never = new Promise(() => {});
    const telemetryCommand = vi.fn(() => never);
    const fetch = vi.fn(() => never);
    const env = createMachineBarEnv({ telemetryCommand, fetch });
    env.api.applyLocalOperatorAuthorization({
      controller: true,
      controlSessionEpoch: 7,
      socketCommandToken: 'a'.repeat(40),
    });
    env.emitTelemetry('job', { state: 'RUNNING' });

    const stopping = env.api.stopJob();
    expect(telemetryCommand).toHaveBeenCalledWith(
      'safety.stop', null, expect.stringMatching(/^stop-/), { timeoutMs: 5000 },
    );
    expect(fetch).toHaveBeenCalledWith('/api/job/stop', { method: 'POST' });

    env.emitTelemetry('job', { state: 'STOPPING' });
    await stopping;
    expect(env.elements.get('mb-status').textContent).toContain('confirmed by live job state');
  });

  it('uses communication-loss canonical state without falsely claiming M5 was not sent', async () => {
    const env = createMachineBarEnv({
      telemetryCommand: () => Promise.reject(new Error('WS response lost')),
      fetch: async () => { throw new Error('HTTP response lost'); },
    });
    env.api.applyLocalOperatorAuthorization({
      controller: true,
      controlSessionEpoch: 8,
      socketCommandToken: 'b'.repeat(40),
    });
    env.emitTelemetry('job', { state: 'RUNNING' });

    const stopping = env.api.stopJob();
    env.emitTelemetry('job', { state: 'ERROR', errorCode: 'COMMUNICATION_LOST' });
    await stopping;
    const message = env.elements.get('mb-status').textContent;
    expect(message).toContain('controller receipt cannot be confirmed');
    expect(message).toContain('physical emergency stop');
    expect(message).not.toContain('M5 was not sent');
  });

  it('enables synchronized ERROR Stop only for COMMUNICATION_LOST', () => {
    const env = createMachineBarEnv();
    env.emitTelemetry('job', { state: 'ERROR', errorCode: 'COMMUNICATION_LOST' });
    env.api.render();
    expect(env.api.safetyStopDisabled('ERROR')).toBe(false);
    expect(env.elements.get('mb-stop').disabled).toBe(false);

    env.emitTelemetry('job', { state: 'ERROR', errorCode: 'MARLIN_COMMAND_REJECTED' });
    env.api.render();
    expect(env.api.safetyStopDisabled('ERROR')).toBe(true);
    expect(env.elements.get('mb-stop').disabled).toBe(true);
  });

  it.each([
    ['PAUSING', 'current motion may continue', false],
    ['PAUSED_INTACT', 'motion is held intact', true],
    ['PAUSED', 'motion is held intact', true],
  ])('reports canonical pause state %s accurately', async (state, expected, held) => {
    const env = createMachineBarEnv();
    env.emitTelemetry('job', { state: 'RUNNING' });
    const pausing = env.api.pauseJob();
    await vi.waitFor(() => expect(env.fetchCalls).toContain('/api/job/pause'));
    env.emitTelemetry('job', { state });
    await pausing;
    const message = env.elements.get('mb-status').textContent;
    expect(message).toContain(expected);
    expect(message.includes('motion is held intact')).toBe(held);
  });

  it('preserves the complete canonical machine frame and publishes it to Preview listeners', () => {
    const env = createMachineBarEnv();
    let previewFrame = null;
    env.window.addEventListener('cnc-machine-frame', (event) => { previewFrame = event.detail; });
    const frame = {
      positionValid: true,
      workZeroMachine: { x: 10, y: 20, z: 30 },
      trusted: true,
      absoluteFromHome: true,
      manualWorkFrameValid: false,
      frameMode: 'homed',
      homingSessionId: 'home-7',
      bootSessionId: 'boot-9',
      safeZ: { workMin: -30, workMax: 40, mappedToMachine: true },
      revision: 12,
      updatedAtMs: 5000,
    };
    env.emitTelemetry('machine', {
      position: {
        work: { x: 1, y: 2, z: 3 },
        machine: { x: 11, y: 22, z: 33 },
      },
      frame,
      homedAxes: { x: true, y: true, z: true },
      homingEpoch: 7,
    });

    expect(env.api.machineFrame()).toMatchObject({
      ...frame,
      work: { x: 1, y: 2, z: 3 },
      machine: { x: 11, y: 22, z: 33 },
      homedAxes: { x: true, y: true, z: true },
      homingEpoch: 7,
    });
    expect(previewFrame).toMatchObject({
      trusted: true,
      workZeroMachine: { x: 10, y: 20, z: 30 },
      safeZ: { workMin: -30, workMax: 40, mappedToMachine: true },
      homingEpoch: 7,
    });
  });

  it('preserves a successful local Claim across its matching global patch and never promotes viewers', async () => {
    const env = createMachineBarEnv();
    env.elements.get('mb-operator-owner').value = 'Alice';
    env.elements.get('mb-operator-pin').value = '123456';
    await env.api.claimOperatorControl();
    expect(env.api.operatorState().controller).toBe(true);
    env.api.applyGlobalControlState({
      configured: true, active: true, owner: 'Alice', canClaim: false, leaseMs: 45000,
      leaseExpiresAtUptimeMs: 60000, controlSessionEpoch: 1,
    });
    expect(env.api.operatorState().controller).toBe(true);

    env.api.applyGlobalControlState({
      active: true, owner: 'Alice', canClaim: false, controlSessionEpoch: 2,
    });
    expect(env.api.operatorState()).toMatchObject({ controller: false, readOnly: true, owner: 'Alice' });

    env.api.applyLocalOperatorAuthorization({
      configured: true, active: true, controller: true, readOnly: false, owner: 'Alice',
      controlSessionEpoch: 1,
    });
    env.api.applyGlobalControlState({
      active: false, owner: null, canClaim: true, leaseExpiresAtUptimeMs: 0, controlSessionEpoch: 0,
    });
    expect(env.api.operatorState()).toMatchObject({ controller: false, readOnly: true, active: false, owner: null });

    env.api.applyLocalOperatorAuthorization({
      configured: true, active: true, controller: true, readOnly: false, owner: 'Alice',
      controlSessionEpoch: 1,
    });
    env.api.applyGlobalControlState({ active: true, owner: 'Bob', canClaim: false, controlSessionEpoch: 2 });
    expect(env.api.operatorState()).toMatchObject({ controller: false, readOnly: true, owner: 'Bob' });

    const viewer = createMachineBarEnv();
    viewer.api.applyGlobalControlState({
      active: true, owner: 'Bob', canClaim: false, controlSessionEpoch: 2,
    });
    expect(viewer.api.operatorState()).toMatchObject({ controller: false, readOnly: true });
    viewer.api.applyGlobalControlState({
      active: true, owner: 'Alice', canClaim: false, controlSessionEpoch: 1,
    });
    expect(viewer.api.operatorState()).toMatchObject({ controller: false, readOnly: true, owner: 'Alice' });
    viewer.api.applyGlobalControlState({ active: false, owner: null, canClaim: true, controlSessionEpoch: 0 });
    expect(viewer.api.operatorState()).toMatchObject({ controller: false, active: false, owner: null });
  });

  it('renews a claimed lease during a simulated long job without operator status polling', async () => {
    vi.useFakeTimers();
    try {
      const env = createMachineBarEnv();
      env.api.applyLocalOperatorAuthorization({
        configured: true, active: true, controller: true, readOnly: false, owner: 'Alice',
        controlSessionEpoch: 1,
      });
      for (let interval = 0; interval < 4; interval += 1) {
        await vi.advanceTimersByTimeAsync(12000);
      }
      expect(env.fetchCalls.filter((url) => url.includes('/api/operator/heartbeat')).length).toBeGreaterThanOrEqual(4);
      expect(env.fetchCalls.some((url) => url.includes('/api/operator/status'))).toBe(false);
      expect(env.api.operatorState().controller).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps command responses out of live state until matching socket slices arrive', async () => {
    const env = createMachineBarEnv({
      fetch: async (url) => ({
        ok: true,
        status: 200,
        url: String(url),
        async text() {
          if (String(url).includes('/api/cmd')) {
            return JSON.stringify({ ok: true, response: 'X:99.000 Y:98.000 Z:97.000' });
          }
          return JSON.stringify({ ok: true, feedOverridePercent: 199 });
        },
        clone() { return this; },
        async json() { return {}; },
      }),
    });
    env.emitTelemetry('controller', { state: 'connected' });
    env.emitTelemetry('job', { state: 'IDLE', feedOverridePercent: 100 });
    env.emitTelemetry('machine', {
      frame: { revision: 1, positionValid: true },
      position: { work: { x: 1, y: 2, z: 3 }, machine: { x: 11, y: 12, z: 13 } },
    });

    const feedPromise = env.api.setFeedOverride(125);
    let feedSettled = false;
    void feedPromise.then(() => { feedSettled = true; });
    await Promise.resolve();
    expect(env.api.liveState().job.feedOverridePercent).toBe(100);
    env.emitTelemetry('job', { state: 'IDLE', feedOverridePercent: 125 });
    await Promise.resolve();
    expect(feedSettled).toBe(false);
    env.emitTelemetry('job', {
      state: 'IDLE', feedOverridePercent: 125,
      lastFeedOverrideCommand: 'M220 S125', lastFeedOverrideResponse: 'ok\n', lastFeedOverrideError: '',
    });
    await feedPromise;

    const positionPromise = env.api.sendCmd('M114');
    await Promise.resolve();
    expect(env.api.liveState().position).toEqual({ x: 1, y: 2, z: 3 });
    env.emitTelemetry('machine', {
      frame: { revision: 1, positionValid: true },
      position: { work: { x: 4, y: 5, z: 6 }, machine: { x: 14, y: 15, z: 16 } },
    });
    await positionPromise;
    expect(env.api.liveState().position).toEqual({ x: 4, y: 5, z: 6 });
  });

  it('dispatches zero history only from the confirmed socket frame and de-duplicates the revision', async () => {
    vi.stubGlobal('confirm', () => true);
    try {
      const env = createMachineBarEnv({
        fetch: async (url) => ({
          ok: true,
          status: 200,
          url: String(url),
          async text() {
            return JSON.stringify({
              ok: true,
              frame: { revision: 999, workZeroMachine: { x: 999, y: 999, z: 999 } },
              before: 'X:2 Y:3 Z:4',
              after: 'X:0 Y:0 Z:0',
            });
          },
          clone() { return this; },
          async json() { return {}; },
        }),
      });
      env.emitTelemetry('controller', { state: 'connected' });
      env.emitTelemetry('job', { state: 'IDLE' });
      env.emitTelemetry('machine', {
        frame: { revision: 1, positionValid: true, workZeroValid: false },
        position: { work: { x: 2, y: 3, z: 4 }, machine: { x: 2, y: 3, z: 4 } },
      });
      const command = env.api.setWorkZero();
      await Promise.resolve();
      const confirmed = {
        frame: {
          revision: 2, positionValid: true, workZeroValid: true,
          workZeroMachine: { x: 2, y: 3, z: 4 },
        },
        position: { work: { x: 0, y: 0, z: 0 }, machine: { x: 2, y: 3, z: 4 } },
      };
      env.emitTelemetry('machine', confirmed);
      env.emitTelemetry('machine', confirmed);
      await command;
      const events = env.dispatched.filter((event) => event.type === 'cnc-work-zero-set');
      expect(events).toHaveLength(1);
      expect(events[0].detail).toMatchObject({
        confirmedBySocket: true,
        frame: { revision: 2, workZeroMachine: { x: 2, y: 3, z: 4 } },
      });
      expect(events[0].detail.frame.revision).not.toBe(999);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports accepted commands whose socket confirmation times out without fabricating live state', async () => {
    vi.useFakeTimers();
    try {
      const env = createMachineBarEnv();
      env.emitTelemetry('controller', { state: 'connected' });
      env.emitTelemetry('job', { state: 'IDLE', feedOverridePercent: 100 });
      const command = env.api.setFeedOverride(125);
      const rejection = expect(command).rejects.toThrow(
        'Command accepted, but live-state confirmation timed out while waiting for feed override 125%.',
      );
      await vi.advanceTimersByTimeAsync(12001);
      await rejection;
      expect(env.api.liveState().job.feedOverridePercent).toBe(100);
    } finally {
      vi.useRealTimers();
    }
  });

  it('requires matching successful M220 diagnostics even when the requested percent is unchanged', async () => {
    const env = createMachineBarEnv();
    env.emitTelemetry('controller', { state: 'connected' });
    env.emitTelemetry('job', {
      state: 'RUNNING', feedOverridePercent: 125,
      lastFeedOverrideCommand: 'M220 S110', lastFeedOverrideResponse: 'ok\n', lastFeedOverrideError: '',
    });
    const command = env.api.setFeedOverride(125);
    let settled = false;
    void command.then(() => { settled = true; });
    await Promise.resolve();
    env.emitTelemetry('job', {
      state: 'RUNNING', feedOverridePercent: 125,
      lastFeedOverrideCommand: 'M220 S125', lastFeedOverrideResponse: '', lastFeedOverrideError: '',
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    env.emitTelemetry('job', {
      state: 'RUNNING', feedOverridePercent: 125,
      lastFeedOverrideCommand: 'M220 S125', lastFeedOverrideResponse: 'ok\n', lastFeedOverrideError: '',
    });
    await command;
    expect(env.elements.get('mb-status').textContent).toContain('125% confirmed');
  });

  it('rejects matching M220 Error diagnostics without confirming a new applied percent', async () => {
    const env = createMachineBarEnv();
    env.emitTelemetry('controller', { state: 'connected' });
    env.emitTelemetry('job', { state: 'RUNNING', feedOverridePercent: 100 });
    const command = env.api.setFeedOverride(150);
    await Promise.resolve();
    env.emitTelemetry('job', {
      state: 'RUNNING', feedOverridePercent: 100,
      lastFeedOverrideCommand: 'M220 S150', lastFeedOverrideResponse: 'Error: rejected',
      lastFeedOverrideError: 'Marlin reported Error for priority command',
    });
    await expect(command).rejects.toThrow(/Marlin reported Error/);
    expect(env.api.liveState().job.feedOverridePercent).toBe(100);
  });

  it('attempts one stored-browser reconnect on startup and once after visibility restoration', async () => {
    vi.useFakeTimers();
    try {
      const browserId = 'a'.repeat(64);
      const env = createMachineBarEnv({ storage: { 'cnc.operator.browserId': browserId } });
      await vi.advanceTimersByTimeAsync(0);
      expect(env.fetchCalls.filter((url) => url.includes('/api/operator/reconnect'))).toHaveLength(1);

      env.api.applyGlobalControlState({ active: false, owner: null, canClaim: true });
      env.setHidden(true);
      await vi.advanceTimersByTimeAsync(1100);
      env.setHidden(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(env.fetchCalls.filter((url) => url.includes('/api/operator/reconnect'))).toHaveLength(2);
      expect(env.fetchCalls.some((url) => url.includes('/api/operator/status'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Phase 3C machine command fallback policy', () => {
  const confirmedMachineSlice = () => ({
    frame: {
      revision: 2, positionValid: true, workZeroValid: true, trusted: true, homingEpoch: 1,
      workZeroMachine: { x: 2, y: 3, z: 4 },
    },
    position: { work: { x: 0, y: 0, z: 0 }, machine: { x: 2, y: 3, z: 4 } },
  });

  function machineFallbackEnv({ telemetryBeginCommand } = {}) {
    const machineFetchCalls = [];
    const env = createMachineBarEnv({
      telemetryBeginCommand,
      fetch: async (url) => {
        machineFetchCalls.push(String(url));
        return {
          ok: true, status: 200, url: String(url),
          async text() {
            return JSON.stringify({
              ok: true,
              axes: 'xyz',
              before: 'X:2 Y:3 Z:4',
              after: 'X:0 Y:0 Z:0',
              frame: { revision: 2, workZeroValid: true },
            });
          },
          clone() { return this; },
          async json() { return { ok: true }; },
        };
      },
    });
    env.api.applyLocalOperatorAuthorization({
      controller: true, owner: 'Alice', controlSessionEpoch: 1, socketCommandToken: 't'.repeat(40),
    });
    env.emitTelemetry('controller', { state: 'connected' });
    env.emitTelemetry('job', { state: 'IDLE' });
    env.emitTelemetry('machine', {
      frame: { revision: 1, positionValid: true, workZeroValid: false },
      position: { work: { x: 2, y: 3, z: 4 }, machine: { x: 2, y: 3, z: 4 } },
    });
    return { env, machineFetchCalls };
  }

  const machineHttpCalls = (calls) => calls.filter(
    (url) => url.includes('/api/work-zero/set') || url.includes('/api/machine/home'));

  const twoPhaseHandle = ({ accepted = async () => ({}), result = async () => ({ ok: true, code: 'OK' }) } = {}) =>
    ({ commandId: 'cmd-two-phase', accepted: accepted(), result: result() });

  it('never falls back to HTTP when admission and result both succeed', async () => {
    vi.stubGlobal('confirm', () => true);
    try {
      const telemetryBeginCommand = vi.fn(() => twoPhaseHandle());
      const { env, machineFetchCalls } = machineFallbackEnv({ telemetryBeginCommand });
      const pending = env.api.setWorkZero();
      await Promise.resolve();
      env.emitTelemetry('machine', confirmedMachineSlice());
      await pending;
      expect(telemetryBeginCommand).toHaveBeenCalledTimes(1);
      expect(machineHttpCalls(machineFetchCalls)).toHaveLength(0);
      const events = env.dispatched.filter((event) => event.type === 'cnc-work-zero-set');
      expect(events).toHaveLength(1);
      expect(events[0].detail).toMatchObject({ confirmedBySocket: true, ok: true, axes: 'xyz' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('never falls back to HTTP when the result is slow or lost (accepted command)', async () => {
    vi.stubGlobal('confirm', () => true);
    try {
      const telemetryBeginCommand = vi.fn(() => twoPhaseHandle({
        result: () => Promise.reject(Object.assign(new Error('Command result timed out after 600000ms'), {
          code: 'TIMEOUT', commandDisposition: 'outcome-unknown', definitelyNotAccepted: false,
        })),
      }));
      const { env, machineFetchCalls } = machineFallbackEnv({ telemetryBeginCommand });
      const pending = env.api.setWorkZero();
      await Promise.resolve();
      env.emitTelemetry('machine', confirmedMachineSlice());
      await pending;
      expect(machineHttpCalls(machineFetchCalls)).toHaveLength(0);
      const events = env.dispatched.filter((event) => event.type === 'cnc-work-zero-set');
      expect(events).toHaveLength(1);
      expect(events[0].detail).toMatchObject({ accepted: true, outcome: 'result-pending' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('never falls back to HTTP after an ambiguous admission timeout (packet possibly sent)', async () => {
    vi.stubGlobal('confirm', () => true);
    try {
      const telemetryBeginCommand = vi.fn(() => twoPhaseHandle({
        accepted: () => Promise.reject(Object.assign(new Error('Command admission timed out'), {
          code: 'TIMEOUT', commandDisposition: 'outcome-unknown', definitelyNotAccepted: false,
        })),
        result: () => Promise.reject(Object.assign(new Error('Command result timed out'), {
          code: 'TIMEOUT', commandDisposition: 'outcome-unknown', definitelyNotAccepted: false,
        })),
      }));
      const { env, machineFetchCalls } = machineFallbackEnv({ telemetryBeginCommand });
      const pending = env.api.setWorkZero();
      await Promise.resolve();
      env.emitTelemetry('machine', confirmedMachineSlice());
      await pending;
      expect(machineHttpCalls(machineFetchCalls)).toHaveLength(0);
      expect(env.dispatched.filter((event) => event.type === 'cnc-work-zero-set')).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to HTTP exactly once after a definite admission rejection', async () => {
    vi.stubGlobal('confirm', () => true);
    try {
      const telemetryBeginCommand = vi.fn(() => twoPhaseHandle({
        accepted: () => Promise.reject(Object.assign(new Error('Command authorization invalid or expired'), {
          code: 'UNAUTHORIZED', definitelyNotAccepted: true,
        })),
      }));
      const { env, machineFetchCalls } = machineFallbackEnv({ telemetryBeginCommand });
      const pending = env.api.setWorkZero();
      await Promise.resolve();
      env.emitTelemetry('machine', confirmedMachineSlice());
      await pending;
      expect(telemetryBeginCommand).toHaveBeenCalledTimes(1);
      expect(machineHttpCalls(machineFetchCalls)).toHaveLength(1);
      expect(machineHttpCalls(machineFetchCalls)[0]).toContain('/api/work-zero/set');
      expect(env.dispatched.filter((event) => event.type === 'cnc-work-zero-set')).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('propagates terminal result failures without any HTTP execution', async () => {
    vi.stubGlobal('confirm', () => true);
    try {
      const telemetryBeginCommand = vi.fn(() => twoPhaseHandle({
        result: () => Promise.reject(Object.assign(new Error('Marlin work-zero transaction failed'), {
          code: 'EXECUTION_FAILED', commandDisposition: 'completed', definitelyNotAccepted: false,
        })),
      }));
      const { env, machineFetchCalls } = machineFallbackEnv({ telemetryBeginCommand });
      await expect(env.api.setWorkZero()).rejects.toThrow('Marlin work-zero transaction failed');
      expect(machineHttpCalls(machineFetchCalls)).toHaveLength(0);
      expect(env.dispatched.filter((event) => event.type === 'cnc-work-zero-set')).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('treats authorization revocation after acceptance as outcome-pending, never HTTP', async () => {
    vi.stubGlobal('confirm', () => true);
    try {
      const telemetryBeginCommand = vi.fn(() => twoPhaseHandle({
        result: () => Promise.reject(Object.assign(new Error('Operator control session changed.'), {
          code: 'CONTROL_SESSION_CHANGED', commandDisposition: 'accepted', definitelyNotAccepted: false,
        })),
      }));
      const { env, machineFetchCalls } = machineFallbackEnv({ telemetryBeginCommand });
      const pending = env.api.setWorkZero();
      await Promise.resolve();
      env.emitTelemetry('machine', confirmedMachineSlice());
      await pending;
      expect(machineHttpCalls(machineFetchCalls)).toHaveLength(0);
      expect(env.dispatched.filter((event) => event.type === 'cnc-work-zero-set')).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('homes exactly once per invocation across admission outcome classes', async () => {
    vi.stubGlobal('confirm', () => true);
    try {
      const outcomes = [
        ['admitted-and-completed', () => twoPhaseHandle(), 0],
        ['result-lost', () => twoPhaseHandle({
          result: () => Promise.reject(Object.assign(new Error('result timeout'), {
            code: 'TIMEOUT', commandDisposition: 'outcome-unknown', definitelyNotAccepted: false,
          })),
        }), 0],
        ['admission-rejected', () => twoPhaseHandle({
          accepted: () => Promise.reject(Object.assign(new Error('rejected'), {
            code: 'INVALID_COMMAND', definitelyNotAccepted: true,
          })),
        }), 1],
      ];
      for (const [label, beginImpl, expectedHttp] of outcomes) {
        const telemetryBeginCommand = vi.fn(beginImpl);
        const { env, machineFetchCalls } = machineFallbackEnv({ telemetryBeginCommand });
        const pending = env.api.home('G28', 'Home all now?');
        await Promise.resolve();
        env.emitTelemetry('machine', confirmedMachineSlice());
        await pending;
        const homingHttpCalls = machineFetchCalls.filter((url) => url.includes('/api/machine/home'));
        // Exactly one G28-equivalent operation per invocation: one WS command
        // plus an HTTP call only in the definite-rejection case, never both.
        expect(telemetryBeginCommand, label).toHaveBeenCalledTimes(1);
        expect(homingHttpCalls, label).toHaveLength(expectedHttp);
        expect(env.dispatched.filter((event) => event.type === 'cnc-position-trust'), label).toHaveLength(1);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('machine-operation Stop availability', () => {
  const machineSliceWith = (operation) => ({
    frame: { revision: 1, positionValid: true, trusted: true },
    position: { work: { x: 0, y: 0, z: 0 }, machine: { x: 0, y: 0, z: 0 } },
    homedAxes: { x: true, y: true, z: true },
    homingEpoch: 1,
    operation,
  });

  it('disables Stop for a synchronized idle machine with no operation', () => {
    const env = createMachineBarEnv();
    env.emitTelemetry('job', { state: 'IDLE' });
    env.emitTelemetry('controller', { state: 'connected' });
    env.emitTelemetry('machine', machineSliceWith(null));
    env.api.render();
    expect(env.api.safetyStopDisabled('IDLE')).toBe(true);
    expect(env.elements.get('mb-stop').disabled).toBe(true);
  });

  it('enables Stop for IDLE job state while a Home operation is active', () => {
    const env = createMachineBarEnv();
    env.emitTelemetry('job', { state: 'IDLE' });
    env.emitTelemetry('controller', { state: 'connected' });
    env.emitTelemetry('machine', machineSliceWith({
      active: true, kind: 'home', axes: 'all', phase: 'await-response', stepIndex: 0, stepCount: 6,
    }));
    env.api.render();
    expect(env.api.safetyStopDisabled('IDLE')).toBe(false);
    expect(env.elements.get('mb-stop').disabled).toBe(false);
    expect(env.api.machineOperationActive()).toBe(true);
  });

  it.each([
    ['setWorkZero', 'xyz'],
    ['setZZero', ''],
  ])('enables Stop for an active %s operation', (kind, axes) => {
    const env = createMachineBarEnv();
    env.emitTelemetry('job', { state: 'IDLE' });
    env.emitTelemetry('controller', { state: 'connected' });
    env.emitTelemetry('machine', machineSliceWith({
      active: true, kind, axes, phase: 'await-response', stepIndex: 0, stepCount: 4,
    }));
    env.api.render();
    expect(env.api.safetyStopDisabled('IDLE')).toBe(false);
    expect(env.elements.get('mb-stop').disabled).toBe(false);
  });

  it('enables Stop for an active Jog', () => {
    const env = createMachineBarEnv();
    env.emitTelemetry('job', { state: 'IDLE' });
    env.emitTelemetry('controller', { state: 'connected' });
    env.emitTelemetry('jog', { state: 'JOGGING' });
    env.api.render();
    expect(env.api.safetyStopDisabled('IDLE')).toBe(false);
    expect(env.elements.get('mb-stop').disabled).toBe(false);
  });

  it('preserves the existing active-Job Stop behavior', () => {
    const env = createMachineBarEnv();
    env.emitTelemetry('job', { state: 'RUNNING' });
    env.emitTelemetry('controller', { state: 'connected' });
    env.api.render();
    expect(env.api.safetyStopDisabled('RUNNING')).toBe(false);
    expect(env.elements.get('mb-stop').disabled).toBe(false);
  });

  it('keeps Stop enabled after the ordinary-control guard runs during a Home operation', () => {
    const env = createMachineBarEnv();
    env.emitTelemetry('job', { state: 'IDLE' });
    env.emitTelemetry('controller', { state: 'connected' });
    env.emitTelemetry('machine', machineSliceWith({
      active: true, kind: 'home', axes: 'all', phase: 'await-response', stepIndex: 0, stepCount: 6,
    }));
    env.api.render();
    env.api.applyOrdinaryControlGuard();
    expect(env.elements.get('mb-stop').disabled).toBe(false);
  });

  it('clicking Stop during an active Home dispatches safety.stop', async () => {
    const never = new Promise(() => {});
    const telemetryCommand = vi.fn(() => never);
    const fetch = vi.fn(() => never);
    const env = createMachineBarEnv({ telemetryCommand, fetch });
    env.api.applyLocalOperatorAuthorization({
      controller: true, controlSessionEpoch: 11, socketCommandToken: 'd'.repeat(40),
    });
    env.emitTelemetry('job', { state: 'IDLE' });
    env.emitTelemetry('machine', machineSliceWith({
      active: true, kind: 'home', axes: 'all', phase: 'await-response', stepIndex: 0, stepCount: 6,
    }));

    const stopping = env.api.stopJob();
    expect(telemetryCommand).toHaveBeenCalledWith(
      'safety.stop', null, expect.stringMatching(/^stop-/), { timeoutMs: 5000 },
    );
    expect(fetch).toHaveBeenCalledWith('/api/job/stop', { method: 'POST' });
    expect(env.api.safetyStopDisabled('IDLE')).toBe(false);

    env.emitTelemetry('job', { state: 'STOPPING' });
    await stopping;
  });
});
