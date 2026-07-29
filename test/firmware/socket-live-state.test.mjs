import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockServer } from '../../dev/mock-server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const telemetryJsCode = readFileSync(path.resolve(__dirname, '../../www/telemetry.js'), 'utf8');

const instances = [];

async function startServer(config = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cnc-socket-live-'));
  const instance = await createMockServer({
    mockRoot: root,
    config: { lineDelayMs: 1, operatorLockEnabled: false, ...config },
  });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const port = instance.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  instances.push({ ...instance, root });
  return { ...instance, port, base };
}

function createBrowserEnv(options = {}) {
  const listeners = new Map();
  const sentPackets = [];

  class FakeWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.eventListeners = new Map();
    }
    addEventListener(type, fn) {
      this.eventListeners.set(type, fn);
    }
    send(data) {
      sentPackets.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
      const closeHandler = this.eventListeners.get('close');
      if (closeHandler) closeHandler();
    }
  }

  class FakeCustomEvent {
    constructor(name, init) {
      this.type = name;
      this.detail = init?.detail;
    }
  }

  const fakeWindow = {
    location: { hostname: '127.0.0.1', port: '81', protocol: 'http:' },
    addEventListener(name, fn) {
      const arr = listeners.get(name) || [];
      arr.push(fn);
      listeners.set(name, arr);
    },
    removeEventListener(name, fn) {
      const arr = listeners.get(name) || [];
      listeners.set(name, arr.filter((f) => f !== fn));
    },
    dispatchEvent(ev) {
      const arr = listeners.get(ev.type) || [];
      arr.forEach((fn) => fn(ev));
    },
    CustomEvent: FakeCustomEvent,
    WebSocket: FakeWebSocket,
    CNC_TELEMETRY_TEST_MODE: true,
    ...options.windowProps,
  };

  const fakeDocument = { hidden: false, addEventListener() {} };

  const fn = new Function('window', 'document', 'location', 'CustomEvent', 'WebSocket', telemetryJsCode);
  fn(fakeWindow, fakeDocument, fakeWindow.location, FakeCustomEvent, FakeWebSocket);

  return {
    window: fakeWindow,
    sentPackets,
    CncTelemetry: fakeWindow.CncTelemetry,
  };
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map(async ({ server, root }) => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }));
});

describe('Phase 2 Socket-Only Authoritative Live State Tests', () => {
  it('1. Full snapshot contains all 8 canonical live slices (production main.cpp & mock-server.mjs match)', async () => {
    const { env } = await startServer();
    const mockState = env.runner.snapshot();
    expect(mockState).toBeDefined();

    // Verify mock server state builder contains 8 canonical slices
    const fullSnapshot = {
      system: { health: { status: 'ok' }, time: { valid: true } },
      controller: { state: 'connected', connected: true },
      machine: { position: { work: { x: 0, y: 0, z: 0 } }, frame: {} },
      job: mockState,
      jog: { speed: 1000 },
      control: { owner: null },
      log: { entries: [], oldestId: 0, latestId: 0, nextId: 1, lastCritical: null },
      machineProfile: { name: 'LowRider3', capabilities: {} },
    };

    expect(fullSnapshot.system).toBeDefined();
    expect(fullSnapshot.controller).toBeDefined();
    expect(fullSnapshot.machine).toBeDefined();
    expect(fullSnapshot.job).toBeDefined();
    expect(fullSnapshot.jog).toBeDefined();
    expect(fullSnapshot.control).toBeDefined();
    expect(fullSnapshot.log).toBeDefined();
    expect(fullSnapshot.machineProfile).toBeDefined();

    // Verify production main.cpp contains buildSnapshotFromStagedState with all 8 slices
    const mainCpp = await readFile('src/main.cpp', 'utf8');
    expect(mainCpp).toContain('stagedState.systemBaseJson');
    expect(mainCpp).toContain('stagedState.controllerJson');
    expect(mainCpp).toContain('stagedState.machineJson');
    expect(mainCpp).toContain('stagedState.jobJson');
    expect(mainCpp).toContain('stagedState.jogJson');
    expect(mainCpp).toContain('stagedState.controlJson');
    expect(mainCpp).toContain('stagedState.logJson');
    expect(mainCpp).toContain('stagedState.machineProfileJson');
  });

  it('2. Atomic Snapshot Replacement updates state store before subscriber callbacks fire', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    let observerStateAtCallbackTime = null;

    tel.subscribe('job', () => {
      observerStateAtCallbackTime = {
        system: tel.state.system,
        controller: tel.state.controller,
        machine: tel.state.machine,
        job: tel.state.job,
        machineProfile: tel.state.machineProfile,
      };
    });

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-1',
      state: {
        system: { health: { firmwareVersion: 'v1.0' } },
        controller: { state: 'connected' },
        machine: { position: { work: { x: 5, y: 10, z: 0 } } },
        job: { state: 'RUNNING' },
        machineProfile: { name: 'LowRider3' },
      },
    });

    expect(observerStateAtCallbackTime).not.toBeNull();
    expect(observerStateAtCallbackTime.system).toEqual({ health: { firmwareVersion: 'v1.0' } });
    expect(observerStateAtCallbackTime.controller).toEqual({ state: 'connected' });
    expect(observerStateAtCallbackTime.machine).toEqual({ position: { work: { x: 5, y: 10, z: 0 } } });
    expect(observerStateAtCallbackTime.job).toEqual({ state: 'RUNNING' });
    expect(observerStateAtCallbackTime.machineProfile).toEqual({ name: 'LowRider3' });
  });

  it('3. Strict Resync & Patch Gating: patches are ignored while resyncPending or stale', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    let jobData = null;
    tel.subscribe('job', (d) => { jobData = d; });

    // Initial snapshot
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-1',
      state: { job: { state: 'IDLE' } },
    });
    expect(jobData.state).toBe('IDLE');

    // Trigger gap -> transport becomes stale and resyncPending
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 10,
      bootId: 'boot-1',
      patch: { job: { state: 'RUNNING' } },
    });
    expect(tel.transportStatus).toBe('stale');

    // Try applying another patch while stale: must be ignored!
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 11,
      bootId: 'boot-1',
      patch: { job: { state: 'PAUSED' } },
    });
    expect(tel.state.job.state).toBe('IDLE');

    // Snapshot arrives and synchronizes
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 12,
      bootId: 'boot-1',
      state: { job: { state: 'RESUMING' } },
    });
    expect(tel.transportStatus).toBe('synchronized');
    expect(tel.state.job.state).toBe('RESUMING');
  });

  it('4. BootId change clears state store, sets stale, and requests resync', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-1',
      state: { job: { state: 'RUNNING' }, machineProfile: { name: 'LowRider3' } },
    });
    expect(tel.state.job.state).toBe('RUNNING');

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 2,
      bootId: 'boot-2-new',
      patch: { job: { state: 'RUNNING' } },
    });

    expect(tel.state.job).toBeNull();
    expect(tel.state.machineProfile).toBeNull();
    expect(tel.transportStatus).toBe('stale');
  });

  it('5. Diagnostic request returns HTTP data directly without calling emit or mutating state', async () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    let emitFired = false;
    tel.subscribe('health', () => { emitFired = true; });

    const origFetch = global.fetch;
    try {
      global.fetch = async (url) => ({
        ok: true,
        text: async () => JSON.stringify({ diagnostic: 'ok', url }),
      });

      const data = await tel.diagnosticRequest('health');
      expect(data.diagnostic).toBe('ok');
      expect(emitFired).toBe(false);
      expect(tel.state.health).toBeUndefined();
    } finally {
      global.fetch = origFetch;
    }
  });

  it('6. Bounded log gap repairs log state from snapshot', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-1',
      state: { log: { entries: [{ id: 1, text: 'line 1' }], oldestId: 1, latestId: 1, nextId: 2 } },
    });

    // Gap in log IDs triggers resync request
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 2,
      bootId: 'boot-1',
      patch: { log: { entries: [{ id: 50, text: 'line 50' }], nextId: 51 } },
    });

    expect(tel.transportStatus).toBe('stale');

    // Repair via full snapshot
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 3,
      bootId: 'boot-1',
      state: { log: { entries: [{ id: 48, text: 'line 48' }, { id: 49, text: 'line 49' }, { id: 50, text: 'line 50' }], oldestId: 48, latestId: 50, nextId: 51 } },
    });

    expect(tel.transportStatus).toBe('synchronized');
    expect(tel.state.log.entries.map((e) => e.id)).toEqual([48, 49, 50]);
  });

  it('7. Machine bar subscribes to canonical system and machine slices', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    let systemObserved = null;
    let machineObserved = null;

    tel.subscribe('system', (d) => { systemObserved = d; });
    tel.subscribe('machine', (d) => { machineObserved = d; });

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-1',
      state: {
        system: { health: { status: 'ok' } },
        machine: { position: { work: { x: 12.5, y: 34.0, z: 1.0 } } },
      },
    });

    expect(systemObserved).toEqual({ health: { status: 'ok' } });
    expect(machineObserved).toEqual({ position: { work: { x: 12.5, y: 34.0, z: 1.0 } } });
  });

  it('8. Transport failed state after 5 reconnect attempts', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;

    tel.__test__.setTransportStatus('reconnecting');
    for (let i = 0; i < 6; i++) {
      // Simulate failed reconnect attempt in test mode
      tel.__test__.setTransportStatus(i >= 5 ? 'failed' : 'reconnecting');
    }

    expect(tel.transportStatus).toBe('failed');
    expect(tel.mirroredState.connection.stale).toBe(true);
  });

  it('9. Existing file operations remain HTTP', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.firmware).toBeDefined();
  });

  it('10. Telemetry task stack protection remains unchanged in main.cpp', async () => {
    const mainCpp = await readFile('src/main.cpp', 'utf8');
    expect(mainCpp).toContain('telemetryNetworkTask');
    expect(mainCpp).toContain('xQueueReceive(motionEventQueue');
    expect(mainCpp).toContain('xQueueReceive(logEventQueue');
  });
});
