import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const telemetryJsCode = readFileSync(path.resolve(__dirname, '../../www/telemetry.js'), 'utf8');

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

function createBrowserEnv(options = {}) {
  const listeners = new Map();
  const sentPackets = [];
  const fakeSockets = [];

  class FakeWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    constructor(url) {
      this.url = url;
      this.readyState = 1; // OPEN
      this.shouldThrowOnSend = options.throwOnInitSend || false;
      this.eventListeners = new Map();
      fakeSockets.push(this);
    }
    addEventListener(type, fn) {
      this.eventListeners.set(type, fn);
      if (type === 'open') {
        fn();
      }
    }
    send(data) {
      if (this.shouldThrowOnSend) {
        throw new Error('Fake socket send error');
      }
      sentPackets.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3; // CLOSED
      const closeHandler = this.eventListeners.get('close');
      if (closeHandler) closeHandler();
    }
    receiveMessage(msgObj) {
      const msgHandler = this.eventListeners.get('message');
      if (msgHandler) msgHandler({ data: JSON.stringify(msgObj) });
    }
  }

  const fakeDocument = {
    hidden: false,
    addEventListener() {},
  };

  const dispatchedEvents = [];

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
      dispatchedEvents.push(ev);
      const arr = listeners.get(ev.type) || [];
      arr.forEach((fn) => fn(ev));
    },
    CustomEvent: FakeCustomEvent,
    WebSocket: FakeWebSocket,
    CNC_WS_URL: 'ws://127.0.0.1:81/',
    ...options.windowProps,
  };

  const fn = new Function('window', 'document', 'location', 'CustomEvent', 'WebSocket', telemetryJsCode);
  fn(fakeWindow, fakeDocument, fakeWindow.location, FakeCustomEvent, FakeWebSocket);

  return {
    window: fakeWindow,
    dispatchedEvents,
    sentPackets,
    getWsInstance: () => fakeSockets[fakeSockets.length - 1],
    CncTelemetry: fakeWindow.CncTelemetry,
  };
}

async function setupStartedBrowserEnv(options = {}) {
  const env = createBrowserEnv(options);
  env.CncTelemetry.setDemand('job', 'test', true);
  env.CncTelemetry.start();
  await new Promise((r) => setTimeout(r, 20));
  const ws = env.getWsInstance();
  return { env, ws };
}

describe('Browser Telemetry Client (www/telemetry.js)', () => {
  it('1. Outbound send failure does not consume client seq', async () => {
    const { env, ws } = await setupStartedBrowserEnv();

    expect(env.sentPackets.length).toBe(2); // hello & demand
    expect(env.sentPackets[0].seq).toBe(1);

    // Force send failure
    ws.shouldThrowOnSend = true;
    env.CncTelemetry.setDemand('jog', 'test', true);

    ws.shouldThrowOnSend = false;
    // Next successful packet should still use seq 3 (not skipped to 4)
    env.CncTelemetry.setDemand('log', 'test', true);
    const lastSent = env.sentPackets[env.sentPackets.length - 1];
    expect(lastSent.seq).toBe(3);
  });

  it('2. Timezone offset uses protocol sign (positive for East of UTC)', async () => {
    const { env } = await setupStartedBrowserEnv();

    const hello = env.sentPackets.find((p) => p.type === 'hello');
    expect(hello).toBeDefined();
    expect(hello.timezoneOffsetMinutes).toBe(-new Date().getTimezoneOffset());
  });

  it('3. Monotonic ACK advance', async () => {
    const { env, ws } = await setupStartedBrowserEnv({ windowProps: { CNC_TELEMETRY_TEST_MODE: true } });

    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 2, bootId: 'boot1', stateRevision: 1,
      state: completeState(),
    });

    expect(env.CncTelemetry.__test__.getHighestClientSeqAcknowledgedByESP()).toBe(2);
  });

  it('4. Old ACK does not regress stored ACK', async () => {
    const { env, ws } = await setupStartedBrowserEnv({ windowProps: { CNC_TELEMETRY_TEST_MODE: true } });

    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 2, bootId: 'boot1', stateRevision: 1,
      state: completeState(),
    });
    expect(env.CncTelemetry.__test__.getHighestClientSeqAcknowledgedByESP()).toBe(2);

    ws.receiveMessage({
      protocolVersion: 1, type: 'patch', seq: 2, ack: 1, bootId: 'boot1', stateRevision: 2,
      patch: { job: { state: 'IDLE' } },
    });
    expect(env.CncTelemetry.__test__.getHighestClientSeqAcknowledgedByESP()).toBe(2); // Retains 2!
  });

  it('5. Future ACK when highest successfully sent is zero triggers protocol error and resync', async () => {
    const env = createBrowserEnv({ throwOnInitSend: true, windowProps: { CNC_TELEMETRY_TEST_MODE: true } });
    env.CncTelemetry.setDemand('job', 'test', true);
    env.CncTelemetry.start();
    await new Promise((r) => setTimeout(r, 20));
    const ws = env.getWsInstance();

    expect(env.CncTelemetry.__test__.getHighestClientSeqSuccessfullySent()).toBe(0);

    ws.shouldThrowOnSend = false;
    const packetsBefore = env.sentPackets.length;
    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 1,
      state: completeState(),
    });

    const errEv = env.dispatchedEvents.find((e) => e.type === 'cnc-telemetry-protocol-error');
    expect(errEv).toBeDefined();
    expect(errEv.detail.error).toBe('invalid future ACK');

    const resyncSent = env.sentPackets.slice(packetsBefore).find((p) => p.type === 'resync');
    expect(resyncSent).toBeDefined();

    expect(env.CncTelemetry.__test__.getHighestClientSeqAcknowledgedByESP()).toBe(0);
  });

  it('6. Protocol-error sequence is committed and next contiguous packet works', async () => {
    const { env, ws } = await setupStartedBrowserEnv();

    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 1,
      state: completeState(),
    });

    ws.receiveMessage({
      protocolVersion: 1, type: 'protocol-error', seq: 2, ack: 1, bootId: 'boot1', stateRevision: 1,
      error: 'test error',
    });

    const errEv = env.dispatchedEvents.find((e) => e.type === 'cnc-telemetry-protocol-error');
    expect(errEv).toBeDefined();
    expect(errEv.detail.error).toBe('test error');

    // Snapshot recovers transport state
    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 3, ack: 1, bootId: 'boot1', stateRevision: 2,
      state: completeState({ controller: { state: 'idle' } }),
    });
    expect(env.CncTelemetry.mirroredState.controller.state).toBe('idle');
  });

  it('7. Duplicate seq is ignored and sequence gap requests resync', async () => {
    const { env, ws } = await setupStartedBrowserEnv();

    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 1,
      state: completeState(),
    });

    const countBefore = env.dispatchedEvents.length;
    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 1,
      state: completeState(),
    });
    expect(env.dispatchedEvents.length).toBe(countBefore);

    const packetsBefore = env.sentPackets.length;
    ws.receiveMessage({
      protocolVersion: 1, type: 'patch', seq: 5, ack: 1, bootId: 'boot1', stateRevision: 2,
      patch: { job: { state: 'RUNNING' } },
    });
    const resyncSent = env.sentPackets.slice(packetsBefore).find((p) => p.type === 'resync');
    expect(resyncSent).toBeDefined();
  });

  it('8. stateRevision skip does not request resync', async () => {
    const { env, ws } = await setupStartedBrowserEnv();

    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 1,
      state: completeState(),
    });

    const packetsBefore = env.sentPackets.length;
    ws.receiveMessage({
      protocolVersion: 1, type: 'patch', seq: 2, ack: 1, bootId: 'boot1', stateRevision: 10,
      patch: { job: { state: 'RUNNING' } },
    });
    const resyncSent = env.sentPackets.slice(packetsBefore).find((p) => p.type === 'resync');
    expect(resyncSent).toBeUndefined();
  });

  it('9. stateRevision regression within same boot session triggers error and resync without regressing state', async () => {
    const { env, ws } = await setupStartedBrowserEnv();

    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 10,
      state: completeState({ system: { bootId: 'boot1' }, controller: { state: 'idle' }, job: { state: 'RUNNING' } }),
    });

    const packetsBefore = env.sentPackets.length;
    ws.receiveMessage({
      protocolVersion: 1, type: 'patch', seq: 2, ack: 1, bootId: 'boot1', stateRevision: 5,
      patch: { job: { state: 'IDLE' } },
    });

    const errEv = env.dispatchedEvents.find((e) => e.type === 'cnc-telemetry-protocol-error');
    expect(errEv).toBeDefined();
    expect(errEv.detail.error).toBe('stateRevision regression detected');

    const resyncSent = env.sentPackets.slice(packetsBefore).find((p) => p.type === 'resync');
    expect(resyncSent).toBeDefined();
    expect(env.CncTelemetry.mirroredState.job.state).toBe('RUNNING');
  });

  it('10. Same-boot partial snapshot is rejected without clearing canonical slices', async () => {
    const { env, ws } = await setupStartedBrowserEnv();

    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 1,
      state: completeState({ system: { bootId: 'boot1' }, controller: { state: 'idle' }, job: { state: 'RUNNING' } }),
    });
    expect(env.CncTelemetry.mirroredState.job.state).toBe('RUNNING');

    // Second snapshot in same boot missing job slice
    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 2, ack: 1, bootId: 'boot1', stateRevision: 2,
      state: { system: { bootId: 'boot1' }, controller: { state: 'idle' }, machine: {}, jog: {}, control: {} },
    });
    expect(env.CncTelemetry.mirroredState.job.state).toBe('RUNNING');
    expect(env.CncTelemetry.transportStatus).toBe('stale');
  });

  it('11. Job and jog each emit exactly once on snapshot', async () => {
    const { env, ws } = await setupStartedBrowserEnv();

    let jobEvents = 0;
    let jogEvents = 0;
    env.window.addEventListener('cnc-telemetry-job', () => jobEvents++);
    env.window.addEventListener('cnc-telemetry-jog', () => jogEvents++);

    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 1,
      state: completeState({ job: { state: 'IDLE' }, jog: { state: 'Idle' } }),
    });

    expect(jobEvents).toBe(1);
    expect(jogEvents).toBe(1);
  });

  it('12. Motion event dispatches cnc-telemetry-motion', async () => {
    const { env, ws } = await setupStartedBrowserEnv();

    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 1,
      state: completeState(),
    });

    ws.receiveMessage({
      protocolVersion: 1, type: 'event', channel: 'motion', seq: 2, ack: 1, bootId: 'boot1', stateRevision: 2,
      data: { events: [{ sequence: 10, command: 'G1 X10' }], feedOverridePercent: 100 },
    });

    const motionEv = env.dispatchedEvents.find((e) => e.type === 'cnc-telemetry-motion');
    expect(motionEv).toBeDefined();
    expect(motionEv.detail.events[0].sequence).toBe(10);
    expect(env.CncTelemetry.state.motion).toBeUndefined();
  });

  it('13. Log event dispatches cnc-telemetry-log', async () => {
    const { env, ws } = await setupStartedBrowserEnv();

    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 1,
      state: completeState(),
    });

    ws.receiveMessage({
      protocolVersion: 1, type: 'event', channel: 'log', seq: 2, ack: 1, bootId: 'boot1', stateRevision: 2,
      data: { entries: [{ id: 1, text: 'ok' }], latestId: 1, nextId: 2, dropped: 0 },
    });

    const logEvs = env.dispatchedEvents.filter((e) => e.type === 'cnc-telemetry-log');
    const logEv = logEvs[logEvs.length - 1];
    expect(logEv).toBeDefined();
    expect(logEv.detail.entries[0].text).toBe('ok');
  });

  it('14. Test mode interface gating: absent by default, present when window.CNC_TELEMETRY_TEST_MODE === true', async () => {
    const normalEnv = createBrowserEnv();
    expect(normalEnv.CncTelemetry.__test__).toBeUndefined();

    const testEnv = createBrowserEnv({ windowProps: { CNC_TELEMETRY_TEST_MODE: true } });
    expect(testEnv.CncTelemetry.__test__).toBeDefined();
    expect(typeof testEnv.CncTelemetry.__test__.getClientSeq).toBe('function');
  });
});
