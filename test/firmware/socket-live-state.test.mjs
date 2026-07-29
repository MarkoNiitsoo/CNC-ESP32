import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockServer } from '../../dev/mock-server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const telemetryJsCode = readFileSync(path.resolve(__dirname, '../../www/telemetry.js'), 'utf8');

const instances = [];

function completeState(overrides = {}) {
  return {
    system: {},
    controller: {},
    machine: {},
    job: {},
    jog: {},
    control: {},
    log: { entries: [], oldestId: 0, latestId: 0, nextId: 1, lastCritical: null, dropped: 0 },
    machineProfile: {},
    ...overrides,
  };
}

function buildClientWsFrame(value, opcode = 0x1) {
  const payload = Buffer.from(value, 'utf8');
  const mask = randomBytes(4);
  const header = payload.length <= 125 ? Buffer.alloc(6) : Buffer.alloc(8);
  header[0] = 0x80 | opcode;
  if (payload.length <= 125) {
    header[1] = 0x80 | payload.length;
    mask.copy(header, 2);
  } else {
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
    mask.copy(header, 4);
  }
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, masked]);
}

function parseServerFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    let length = buffer[offset + 1] & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    }
    if (buffer.length - offset < headerLength + length) break;
    const raw = buffer.subarray(offset + headerLength, offset + headerLength + length).toString('utf8');
    try {
      messages.push(JSON.parse(raw));
    } catch {}
    offset += headerLength + length;
  }
  return { messages, remaining: buffer.subarray(offset) };
}

function createRawWebSocketClient(port) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    const messages = [];
    let upgraded = false;
    let receiveBuffer = Buffer.alloc(0);
    const api = {
      messages,
      sendJson(value) {
        socket.write(buildClientWsFrame(JSON.stringify(value)));
      },
      async waitFor(predicate, timeoutMs = 1000) {
        const startedAt = Date.now();
        while (true) {
          const found = messages.find(predicate);
          if (found) return found;
          if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for WebSocket packet');
          await new Promise((done) => setTimeout(done, 10));
        }
      },
      close() {
        try {
          socket.write(buildClientWsFrame('', 0x8));
          socket.end();
          socket.destroy();
        } catch {}
      },
    };
    socket.on('connect', () => {
      const key = randomBytes(16).toString('base64');
      socket.write([
        'GET /ws HTTP/1.1',
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '', '',
      ].join('\r\n'));
    });
    socket.on('data', (chunk) => {
      receiveBuffer = Buffer.concat([receiveBuffer, chunk]);
      if (!upgraded) {
        const headerEnd = receiveBuffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const headers = receiveBuffer.subarray(0, headerEnd).toString('utf8');
        if (!headers.includes('101 Switching Protocols')) {
          reject(new Error(`WebSocket upgrade failed: ${headers}`));
          socket.destroy();
          return;
        }
        upgraded = true;
        receiveBuffer = receiveBuffer.subarray(headerEnd + 4);
        resolve(api);
      }
      const parsed = parseServerFrames(receiveBuffer);
      receiveBuffer = parsed.remaining;
      messages.push(...parsed.messages);
    });
    socket.on('error', reject);
  });
}

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
  const fakeSockets = [];

  class FakeWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.eventListeners = new Map();
      fakeSockets.push(this);
    }
    addEventListener(type, fn) {
      this.eventListeners.set(type, fn);
      if (type === 'open') fn();
    }
    send(data) {
      sentPackets.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
      const closeHandler = this.eventListeners.get('close');
      if (closeHandler) closeHandler();
    }
    receiveMessage(message) {
      this.eventListeners.get('message')?.({ data: JSON.stringify(message) });
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
    getSocket: () => fakeSockets[fakeSockets.length - 1],
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(instances.splice(0).map(async ({ server, root }) => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }));
});

describe('Phase 2 Socket-Only Authoritative Live State Tests', () => {
  it('1. Real mock WebSocket hello returns all 8 canonical slices', async () => {
    const { port } = await startServer();
    const client = await createRawWebSocketClient(port);
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const snapshotMsg = await client.waitFor((message) => message.type === 'snapshot');
    client.close();
    expect(snapshotMsg.type).toBe('snapshot');
    const state = snapshotMsg.state;
    expect(state.system).toBeDefined();
    expect(state.controller).toBeDefined();
    expect(state.machine).toBeDefined();
    expect(state.job).toBeDefined();
    expect(state.jog).toBeDefined();
    expect(state.control).toBeDefined();
    expect(state.control).toMatchObject({
      configured: false,
      active: false,
      owner: null,
      leaseMs: 45000,
      leaseExpiresAtUptimeMs: 0,
      canClaim: true,
    });
    expect(state.log).toBeDefined();
    expect(state.machineProfile).toBeDefined();
  });

  it('2. Production patch builder includes machineProfile in main.cpp', async () => {
    const mainCpp = await readFile('src/main.cpp', 'utf8');
    expect(mainCpp).toContain('stagedState.dirtyMachineProfile');
    expect(mainCpp).toContain('\\"machineProfile\\":');
    expect(mainCpp).toContain('stagedState.machineProfileJson');
  });

  it('3. Machine profile change reaches connected mock client as a patch', async () => {
    const instance = await startServer();
    const client = await createRawWebSocketClient(instance.port);
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    await client.waitFor((message) => message.type === 'snapshot');
    instance.triggerStateSliceChange('machineProfile', { name: 'LowRider3-Updated', firmwareName: 'MockMarlin' });
    const patchMsg = await client.waitFor((message) => message.type === 'patch' && message.patch?.machineProfile);
    client.close();
    expect(patchMsg.type).toBe('patch');
    expect(patchMsg.patch.machineProfile.name).toBe('LowRider3-Updated');
  });

  it('3a. Mock incremental log event uses production latestId and nextId semantics', async () => {
    const instance = await startServer();
    const client = await createRawWebSocketClient(instance.port);
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    await client.waitFor((message) => message.type === 'snapshot');
    client.sendJson({ protocolVersion: 1, type: 'log', seq: 2, ack: 1, subscribe: { log: true } });
    await new Promise((done) => setTimeout(done, 20));
    const published = instance.appendMockLog({ text: 'mock incremental' });
    const event = await client.waitFor((message) => message.type === 'event' && message.channel === 'log');
    client.close();

    expect(event.data.entries[0].id).toBe(1);
    expect(event.data.latestId).toBe(1);
    expect(event.data.nextId).toBe(2);
    expect(published.nextId).toBe(published.latestId + 1);
  });

  it('4. addMarlinLog does not call boundedLogRing.buildJson in producer hot path', async () => {
    const mainCpp = await readFile('src/main.cpp', 'utf8');
    const addLogIdx = mainCpp.indexOf('void addMarlinLog(const String &direction, bool priority, const String &text, const String &level) {');
    expect(addLogIdx).toBeGreaterThan(-1);
    const addLogBlock = mainCpp.slice(addLogIdx, mainCpp.indexOf('String jsonEscape(', addLogIdx));
    expect(addLogBlock).not.toContain('boundedLogRing.buildJson()');
    expect(addLogBlock).not.toContain('stagedState.logJson =');
    expect(addLogBlock).toContain('xSemaphoreTake(logRingMutex, portMAX_DELAY)');
    expect(addLogBlock).not.toContain('xSemaphoreTake(telemetryStateMutex');
  });

  it('4a. Full-ring JSON is built from bounded global scratch after releasing the ring mutex', async () => {
    const mainCpp = await readFile('src/main.cpp', 'utf8');
    const builderStart = mainCpp.indexOf('String buildBoundedLogSnapshotJson()');
    const builder = mainCpp.slice(builderStart, mainCpp.indexOf('struct StagedTelemetryState', builderStart));
    expect(builder).toContain('boundedLogSnapshotScratch = boundedLogRing');
    expect(builder.indexOf('xSemaphoreGive(logRingMutex)')).toBeLessThan(builder.indexOf('boundedLogSnapshotScratch.buildJson'));
    expect(mainCpp).not.toContain('dirtyLog');
    expect(mainCpp).not.toContain('String logJson;');
  });

  it('5. Full snapshot contains bounded log ring with dropped field', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-1',
      state: completeState({
        log: {
          entries: [{ id: 1, text: 'test line' }],
          oldestId: 1,
          latestId: 1,
          nextId: 2,
          lastCritical: null,
          dropped: 3,
        },
      }),
    });

    expect(tel.state.log).toBeDefined();
    expect(tel.state.log.dropped).toBe(3);
    expect(tel.state.log.entries[0].text).toBe('test line');
  });

  it('6. Stale state ignores both event and patch packets', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-1',
      state: completeState({ job: { state: 'IDLE' } }),
    });
    expect(tel.state.job.state).toBe('IDLE');

    // Induce sequence gap to transition into stale / resyncPending
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 10,
      bootId: 'boot-1',
      patch: { job: { state: 'RUNNING' } },
    });
    expect(tel.transportStatus).toBe('stale');

    // Attempt patch packet while stale -> ignored!
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 11,
      bootId: 'boot-1',
      patch: { job: { state: 'PAUSED' } },
    });
    expect(tel.state.job.state).toBe('IDLE');

    // Attempt event packet while stale -> ignored!
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'event',
      seq: 12,
      bootId: 'boot-1',
      channel: 'job',
      data: { state: 'STOPPING' },
    });
    expect(tel.state.job.state).toBe('IDLE');
  });

  it('7. One event calls one subscriber exactly once', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    let callCount = 0;

    // Initial snapshot to set synchronized state
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-1',
      state: completeState({ job: { state: 'IDLE' } }),
    });

    tel.subscribe('job', () => {
      callCount++;
    });
    callCount = 0; // Reset after initial subscription callback

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'event',
      seq: 2,
      bootId: 'boot-1',
      channel: 'job',
      data: { state: 'RUNNING' },
    });

    expect(callCount).toBe(1);
    expect(tel.state.job.state).toBe('RUNNING');
  });

  it('8. Resync request is sent only once while pending', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    tel.start();

    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-1',
      state: completeState({ job: { state: 'IDLE' } }),
    });

    // Trigger first gap
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 10,
      bootId: 'boot-1',
      patch: { job: { state: 'RUNNING' } },
    });

    const resyncPacketsBefore = env.sentPackets.filter((p) => p.type === 'resync').length;
    expect(resyncPacketsBefore).toBe(1);

    // Trigger second gap while resync is already pending
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 20,
      bootId: 'boot-1',
      patch: { job: { state: 'PAUSED' } },
    });

    const resyncPacketsAfter = env.sentPackets.filter((p) => p.type === 'resync').length;
    expect(resyncPacketsAfter).toBe(1); // Sent exactly once!
  });

  it('9. Log cursor detects first missing event correctly and resync snapshot replaces lower cursor', () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;

    // Snapshot with latestId 10
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-1',
      state: completeState({ log: { entries: [{ id: 10, text: 'line 10' }], oldestId: 10, latestId: 10, nextId: 11, lastCritical: null, dropped: 0 } }),
    });
    expect(tel.__test__.getLastLogId()).toBe(10);

    // Event 11 succeeds
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 2,
      bootId: 'boot-1',
      patch: { log: { entries: [{ id: 11, text: 'line 11' }], latestId: 11, nextId: 12 } },
    });
    expect(tel.__test__.getLastLogId()).toBe(11);

    // Event 13 skips missing 12 -> detects gap & requests resync!
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 3,
      bootId: 'boot-1',
      patch: { log: { entries: [{ id: 13, text: 'line 13' }], latestId: 13, nextId: 14 } },
    });
    expect(tel.transportStatus).toBe('stale');

    // Resync snapshot with a lower cursor (e.g. latestId 5 after log clear) replaces old cursor
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 4,
      bootId: 'boot-1',
      state: completeState({ log: { entries: [{ id: 5, text: 'line 5' }], oldestId: 5, latestId: 5, nextId: 6, lastCritical: null, dropped: 0 } }),
    });
    expect(tel.transportStatus).toBe('synchronized');
    expect(tel.__test__.getLastLogId()).toBe(5);
  });

  it('9a. Snapshot latestId 10 accepts event 11 and ignores duplicate IDs in a mixed batch', () => {
    const tel = createBrowserEnv().CncTelemetry;
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-log',
      state: completeState({ log: { entries: [{ id: 10, text: 'ten' }], oldestId: 10, latestId: 10, nextId: 11, lastCritical: null, dropped: 0 } }),
    });
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'event',
      seq: 2,
      bootId: 'boot-log',
      channel: 'log',
      data: {
        entries: [{ id: 10, text: 'duplicate' }, { id: 11, text: 'eleven' }],
        latestId: 11,
        nextId: 12,
        dropped: 0,
      },
    });
    expect(tel.__test__.getLastLogId()).toBe(11);
    expect(tel.state.log.entries.map((entry) => entry.id)).toEqual([10, 11]);
  });

  it('9b. Snapshot latestId 10 followed by event 12 resyncs before applying it', () => {
    const tel = createBrowserEnv().CncTelemetry;
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-gap',
      state: completeState({ log: { entries: [{ id: 10, text: 'ten' }], oldestId: 10, latestId: 10, nextId: 11, lastCritical: null, dropped: 0 } }),
    });
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'event',
      seq: 2,
      bootId: 'boot-gap',
      channel: 'log',
      data: { entries: [{ id: 12, text: 'twelve' }], latestId: 12, nextId: 13, dropped: 0 },
    });
    expect(tel.transportStatus).toBe('stale');
    expect(tel.__test__.getLastLogId()).toBe(10);
    expect(tel.state.log.entries.map((entry) => entry.id)).toEqual([10]);
  });

  it('9c. Dropped incremental log metadata requires resync without applying entries', () => {
    const tel = createBrowserEnv().CncTelemetry;
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'boot-drop',
      state: completeState({ log: { entries: [{ id: 10, text: 'ten' }], oldestId: 10, latestId: 10, nextId: 11, lastCritical: null, dropped: 0 } }),
    });
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'event',
      seq: 2,
      bootId: 'boot-drop',
      channel: 'log',
      data: { entries: [{ id: 11, text: 'eleven' }], latestId: 11, nextId: 12, dropped: 1 },
    });
    expect(tel.transportStatus).toBe('stale');
    expect(tel.__test__.getLastLogId()).toBe(10);
  });

  it('9d. New-boot snapshot may replace a higher sequence and log cursor', () => {
    const tel = createBrowserEnv().CncTelemetry;
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 20,
      bootId: 'old-boot',
      stateRevision: 20,
      state: completeState({ log: { entries: [{ id: 50, text: 'old' }], oldestId: 50, latestId: 50, nextId: 51, lastCritical: null, dropped: 0 } }),
    });
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'new-boot',
      stateRevision: 1,
      state: completeState({ log: { entries: [{ id: 2, text: 'new' }], oldestId: 2, latestId: 2, nextId: 3, lastCritical: null, dropped: 0 } }),
    });
    expect(tel.transportStatus).toBe('synchronized');
    expect(tel.__test__.getKnownBootId()).toBe('new-boot');
    expect(tel.__test__.getLastServerSeq()).toBe(1);
    expect(tel.__test__.getLastLogId()).toBe(2);
  });

  it('10. Atomic snapshot state is visible consistently inside callbacks', () => {
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
      state: completeState({
        system: { health: { status: 'ok' } },
        controller: { state: 'connected' },
        machine: { position: { work: { x: 1, y: 2, z: 3 } } },
        job: { state: 'RUNNING' },
        machineProfile: { name: 'LowRider3' },
      }),
    });

    expect(observerStateAtCallbackTime).not.toBeNull();
    expect(observerStateAtCallbackTime.system).toEqual({ health: { status: 'ok' } });
    expect(observerStateAtCallbackTime.controller).toEqual({ state: 'connected' });
    expect(observerStateAtCallbackTime.machine).toEqual({ position: { work: { x: 1, y: 2, z: 3 } } });
    expect(observerStateAtCallbackTime.job).toEqual({ state: 'RUNNING' });
    expect(observerStateAtCallbackTime.machineProfile).toEqual({ name: 'LowRider3' });
  });

  it('10a. Legacy snapshot data form uses the same atomic replacement path', () => {
    const tel = createBrowserEnv().CncTelemetry;
    let callbackState = null;
    tel.subscribe('job', () => {
      callbackState = { ...tel.state };
    });
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'legacy-boot',
      data: completeState({ job: { state: 'PAUSED' }, machineProfile: { name: 'Legacy normalized' } }),
    });
    expect(callbackState.job.state).toBe('PAUSED');
    expect(callbackState.machineProfile.name).toBe('Legacy normalized');
    expect(tel.transportStatus).toBe('synchronized');
  });

  it('10b. Malformed protocol data does not refresh the server liveness clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T12:00:00Z'));
    const tel = createBrowserEnv().CncTelemetry;
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'valid-boot',
      state: completeState(),
    });
    const validAt = tel.__test__.getLastServerMessageMs();
    vi.advanceTimersByTime(1000);
    tel.__test__.applySocketMessage({ type: 'patch', patch: { job: { state: 'RUNNING' } } });
    expect(tel.__test__.getLastServerMessageMs()).toBe(validAt);
  });

  it('11. Settings navigation makes no /api/health live-state request', async () => {
    const appJs = await readFile('www/app.js', 'utf8');
    const settingsBlockIdx = appJs.indexOf("if (viewName === 'settings')");
    expect(settingsBlockIdx).toBeGreaterThan(-1);
    const settingsBlock = appJs.slice(settingsBlockIdx, settingsBlockIdx + 300);
    expect(settingsBlock).not.toContain('refreshHealth()');
  });

  it('12. Z-zero and tool-change workflows make no /api/job/status request', async () => {
    const previewJs = await readFile('www/preview.js', 'utf8');
    const machineBarJs = await readFile('www/machine-bar.js', 'utf8');

    const canChangeZIdx = previewJs.indexOf('function canChangeZZero(');
    expect(canChangeZIdx).toBeGreaterThan(-1);
    const canChangeZBlock = previewJs.slice(canChangeZIdx, canChangeZIdx + 300);
    expect(canChangeZBlock).not.toContain('refreshJobStatus()');

    const probeTouchIdx = previewJs.indexOf('async function probeTouchPlateZZero(');
    expect(probeTouchIdx).toBeGreaterThan(-1);
    const probeTouchBlock = previewJs.slice(probeTouchIdx, probeTouchIdx + 600);
    expect(probeTouchBlock).not.toContain('refreshJobStatus()');
    expect(machineBarJs).not.toContain("fetch('/api/job/status");
    expect(machineBarJs).not.toContain("request('job')");
  });

  it('13. Command network failure starts no HTTP status fallback', async () => {
    const previewJs = await readFile('www/preview.js', 'utf8');
    const postActionIdx = previewJs.indexOf('async function postCriticalJobAction(');
    expect(postActionIdx).toBeGreaterThan(-1);
    const postActionBlock = previewJs.slice(postActionIdx, postActionIdx + 500);
    expect(postActionBlock).not.toContain('/api/job/status');
    expect(postActionBlock).toContain('Command result uncertain');
  });

  it('14. Actual liveness timeout closes the socket and requires a replacement snapshot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T12:00:00Z'));
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    tel.start();
    const socket = env.getSocket();
    socket.receiveMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      ack: 1,
      bootId: 'boot-live',
      stateRevision: 1,
      state: completeState(),
    });
    expect(tel.transportStatus).toBe('synchronized');

    vi.advanceTimersByTime(8000);

    expect(socket.readyState).toBe(3);
    expect(tel.__test__.isResyncPending()).toBe(true);
  });

  it('15. Repeated real close/reconnect cycles reach failed and a full snapshot resets failures', () => {
    vi.useFakeTimers();
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    tel.start();

    for (let attempt = 0; attempt < 5; attempt++) {
      env.getSocket().close();
      vi.advanceTimersByTime(1000);
    }
    env.getSocket().close();
    expect(tel.transportStatus).toBe('failed');
    expect(tel.__test__.getReconnectAttempts()).toBeGreaterThan(5);

    vi.advanceTimersByTime(1000);
    const recoveredSocket = env.getSocket();
    recoveredSocket.receiveMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      ack: 1,
      bootId: 'boot-recovered',
      stateRevision: 1,
      state: completeState(),
    });
    expect(tel.transportStatus).toBe('synchronized');
    expect(tel.__test__.getReconnectAttempts()).toBe(0);
  });

  it('15a. Lost resync with continuing sync packets closes and reconnects the socket', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T12:00:00Z'));
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    tel.start();
    const firstSocket = env.getSocket();
    firstSocket.receiveMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'watchdog-boot',
      stateRevision: 1,
      state: completeState(),
    });
    firstSocket.receiveMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 10,
      bootId: 'watchdog-boot',
      stateRevision: 2,
      patch: { job: { state: 'RUNNING' } },
    });
    expect(tel.__test__.isResyncPending()).toBe(true);

    for (let seq = 2; seq <= 4; seq += 1) {
      vi.advanceTimersByTime(2000);
      firstSocket.receiveMessage({
        protocolVersion: 1,
        type: 'sync',
        seq,
        bootId: 'watchdog-boot',
        stateRevision: 1,
      });
    }
    vi.advanceTimersByTime(2001);
    expect(firstSocket.readyState).toBe(3);
    vi.advanceTimersByTime(1000);
    expect(env.getSocket()).not.toBe(firstSocket);
  });

  it('15b. Malformed replacement snapshot cannot satisfy the resync watchdog', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T12:00:00Z'));
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    tel.start();
    const socket = env.getSocket();
    socket.receiveMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'malformed-watchdog',
      stateRevision: 1,
      state: completeState(),
    });
    socket.receiveMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 9,
      bootId: 'malformed-watchdog',
      stateRevision: 2,
      patch: { job: { state: 'RUNNING' } },
    });
    socket.receiveMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 2,
      bootId: 'malformed-watchdog',
      stateRevision: 2,
      state: completeState({
        log: {
          entries: [{ id: 10 }, { id: 12 }],
          oldestId: 10,
          latestId: 12,
          nextId: 13,
          lastCritical: null,
          dropped: 0,
        },
      }),
    });
    expect(tel.__test__.isResyncPending()).toBe(true);
    vi.advanceTimersByTime(8001);
    expect(socket.readyState).toBe(3);
  });

  it('15c. Valid replacement snapshot clears the resync watchdog and synchronizes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T12:00:00Z'));
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    tel.start();
    const socket = env.getSocket();
    socket.receiveMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'valid-watchdog',
      stateRevision: 1,
      state: completeState({ job: { state: 'IDLE' } }),
    });
    socket.receiveMessage({
      protocolVersion: 1,
      type: 'patch',
      seq: 8,
      bootId: 'valid-watchdog',
      stateRevision: 2,
      patch: { job: { state: 'RUNNING' } },
    });
    socket.receiveMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 2,
      bootId: 'valid-watchdog',
      stateRevision: 2,
      state: completeState({ job: { state: 'PAUSED' } }),
    });
    expect(tel.transportStatus).toBe('synchronized');
    expect(tel.__test__.isResyncPending()).toBe(false);
    expect(tel.__test__.getResyncStartedAtMs()).toBe(0);
    vi.advanceTimersByTime(6001);
    expect(socket.readyState).toBe(1);
  });

  it('15d. Non-contiguous bounded log snapshot is rejected before state replacement', () => {
    const tel = createBrowserEnv().CncTelemetry;
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 1,
      bootId: 'contiguous-log',
      stateRevision: 1,
      state: completeState({
        log: {
          entries: [{ id: 10 }, { id: 11 }],
          oldestId: 10,
          latestId: 11,
          nextId: 12,
          lastCritical: null,
          dropped: 0,
        },
      }),
    });
    tel.__test__.applySocketMessage({
      protocolVersion: 1,
      type: 'snapshot',
      seq: 2,
      bootId: 'contiguous-log',
      stateRevision: 2,
      state: completeState({
        log: {
          entries: [{ id: 10 }, { id: 12 }],
          oldestId: 10,
          latestId: 12,
          nextId: 13,
          lastCritical: null,
          dropped: 0,
        },
      }),
    });
    expect(tel.transportStatus).toBe('stale');
    expect(tel.state.log.entries.map((entry) => entry.id)).toEqual([10, 11]);
  });

  it('16. File list/upload/download/delete endpoints remain HTTP', async () => {
    const { base } = await startServer();
    const form = new FormData();
    form.append('path', '/gcode');
    form.append('file', new Blob(['G0 X1\n'], { type: 'text/plain' }), 'socket-http-test.gcode');
    const upload = await fetch(`${base}/api/upload`, { method: 'POST', body: form });
    expect(upload.status).toBe(200);

    const list = await fetch(`${base}/api/files?path=/gcode`);
    expect(list.status).toBe(200);
    expect((await list.json()).items.some((item) => item.name === 'socket-http-test.gcode')).toBe(true);

    const download = await fetch(`${base}/api/download?path=${encodeURIComponent('/gcode/socket-http-test.gcode')}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe('G0 X1\n');

    const remove = await fetch(`${base}/api/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/gcode/socket-http-test.gcode' }),
    });
    expect(remove.status).toBe(200);
  });

  it('17. Telemetry task stack protection remains intact in main.cpp', async () => {
    const mainCpp = await readFile('src/main.cpp', 'utf8');
    expect(mainCpp).toContain('telemetryNetworkTask');
    expect(mainCpp).toContain('xQueueReceive(motionEventQueue');
    expect(mainCpp).toContain('xQueueReceive(logEventQueue');
  });
});
