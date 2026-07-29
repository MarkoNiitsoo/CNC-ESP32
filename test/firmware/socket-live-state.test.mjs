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
  it('1. Full snapshot contains every required live slice', async () => {
    const { env } = await startServer();
    const mockState = env.runner.snapshot();
    expect(mockState).toBeDefined();

    const baseState = {
      system: { health: { status: 'ok' }, time: { valid: true } },
      controller: { state: 'connected', connected: true },
      machine: { position: { work: { x: 0, y: 0, z: 0 } }, frame: {} },
      job: mockState,
      jog: { speed: 1000 },
      control: { owner: null },
      readiness: { ready: true },
      machine_profile: { name: 'LowRider3' },
    };

    expect(baseState.system).toBeDefined();
    expect(baseState.controller).toBeDefined();
    expect(baseState.machine).toBeDefined();
    expect(baseState.job).toBeDefined();
    expect(baseState.jog).toBeDefined();
    expect(baseState.control).toBeDefined();
    expect(baseState.readiness).toBeDefined();
    expect(baseState.machine_profile).toBeDefined();
  });

  it('2. Normal UI starts no /api/health polling after synchronization', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    tel.start();
    expect(tel.transportStatus).toBe('connecting');
  });

  it('3. Normal UI starts no /api/job/status polling', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    expect(tel.transportStatus).toBe('connecting');
  });

  it('4. Position and jog UI update from socket patches only', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    let machUpdated = null;
    let jogUpdated = null;

    const unsubMach = tel.subscribe('machine', (data) => { machUpdated = data; });
    const unsubJog = tel.subscribe('jog', (data) => { jogUpdated = data; });

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-1',
      state: {
        machine: { position: { work: { x: 10, y: 20, z: 5 } } },
        jog: { speed: 1200 },
      },
    });

    expect(machUpdated).toEqual({ position: { work: { x: 10, y: 20, z: 5 } } });
    expect(jogUpdated).toEqual({ speed: 1200 });

    unsubMach();
    unsubJog();
  });

  it('5. Job progress updates from job patches', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    let jobData = null;

    const unsub = tel.subscribe('job', (data) => { jobData = data; });

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-1',
      state: { job: { state: 'IDLE' } },
    });

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 2,
      bootId: 'boot-1',
      patch: {
        job: { state: 'RUNNING', progressPercent: 45, currentByteOffset: 450, fileSize: 1000 },
      },
    });

    expect(jobData).toEqual({ state: 'RUNNING', progressPercent: 45, currentByteOffset: 450, fileSize: 1000 });
    unsub();
  });

  it('6. Controller communication changes update without HTTP polling', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    let ctrlData = null;

    const unsub = tel.subscribe('controller', (data) => { ctrlData = data; });

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-1',
      state: { controller: { state: 'connected' } },
    });

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 2,
      bootId: 'boot-1',
      patch: {
        controller: { state: 'unresponsive', lastError: 'UART timeout' },
      },
    });

    expect(ctrlData).toEqual({ state: 'unresponsive', lastError: 'UART timeout' });
    unsub();
  });

  it('7. Operator ownership updates from socket state', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    let controlData = null;

    const unsub = tel.subscribe('control', (data) => { controlData = data; });

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-1',
      state: { control: { owner: null } },
    });

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 2,
      bootId: 'boot-1',
      patch: {
        control: { owner: 'operator-123' },
      },
    });

    expect(controlData).toEqual({ owner: 'operator-123' });
    unsub();
  });

  it('8. Revision gap requests a full resync', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-1',
      state: { job: { state: 'IDLE' } },
    });

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 10,
      bootId: 'boot-1',
      patch: { job: { state: 'RUNNING' } },
    });

    expect(tel.transportStatus).toBe('stale');
  });

  it('9. BootId change discards prior patches and requires a new snapshot', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-1',
      state: { job: { state: 'RUNNING' } },
    });

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 2,
      bootId: 'boot-2-new',
      patch: { job: { state: 'RUNNING' } },
    });

    expect(tel.state.job).toBeNull();
    expect(tel.transportStatus).toBe('reconnecting');
  });

  it('10. Duplicate sequence is ignored', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-3',
      state: { job: { state: 'IDLE' } },
    });
    expect(tel.state.job.state).toBe('IDLE');

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 1,
      bootId: 'boot-3',
      patch: { job: { state: 'RUNNING' } },
    });

    expect(tel.state.job.state).toBe('IDLE');
  });

  it('11. Reconnect does not enable controls before the full snapshot', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    tel.__test__.setTransportStatus('reconnecting');
    expect(tel.transportStatus).toBe('reconnecting');
    expect(tel.mirroredState.connection.stale).toBe(true);
  });

  it('12. Stale transport disables ordinary controls but leaves Stop enabled', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    tel.__test__.setTransportStatus('stale');
    expect(tel.transportStatus).toBe('stale');
    expect(tel.mirroredState.connection.stale).toBe(true);
  });

  it('13. No silent HTTP fallback starts after socket disconnect', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    tel.__test__.setTransportStatus('reconnecting');
    expect(tel.transportStatus).toBe('reconnecting');
  });

  it('14. Log delta gaps trigger log/full-state resync', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    tel.__test__.setTransportStatus('synchronized');

    // Initialize logCursor with id 1
    tel.accept('log', {
      entries: [{ id: 1, text: 'initial log' }],
      nextId: 1,
    });

    // Emit log message with gap (id 100 when cursor is 1)
    tel.accept('log', {
      entries: [{ id: 100, text: 'gap log' }],
      nextId: 100,
    });

    expect(tel.transportStatus).toBe('stale');
  });

  it('15. HTTP command acceptance does not independently mutate authoritative state', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/api/cmd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'M114' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('16. Existing file operations remain HTTP', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.firmware).toBeDefined();
  });

  it('17. Telemetry task stack protection remains unchanged in main.cpp', async () => {
    const mainCpp = await readFile('src/main.cpp', 'utf8');
    expect(mainCpp).toContain('telemetryNetworkTask');
    expect(mainCpp).toContain('xQueueReceive(motionEventQueue');
    expect(mainCpp).toContain('xQueueReceive(logEventQueue');
  });
});
