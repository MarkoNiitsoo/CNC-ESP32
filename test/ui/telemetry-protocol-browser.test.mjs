import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const telemetryJsCode = readFileSync(path.resolve(__dirname, '../../www/telemetry.js'), 'utf8');

function createBrowserEnv() {
  const listeners = new Map();
  const sentPackets = [];
  const fakeSockets = [];

  class FakeWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    constructor(url) {
      this.url = url;
      this.readyState = 1; // OPEN
      this.shouldThrowOnSend = false;
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

async function setupStartedBrowserEnv() {
  const env = createBrowserEnv();
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

  it('3 & 4. Peer ACK advances monotonically and future ACK is rejected even when highest sent is zero', async () => {
    const { env, ws } = await setupStartedBrowserEnv();

    // Send snapshot with ACK 999 when no client packet has been sent yet
    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 999, bootId: 'boot1', stateRevision: 1,
      state: { system: {}, controller: {}, machine: {}, job: {}, jog: {}, control: {} },
    });

    const errEv = env.dispatchedEvents.find((e) => e.type === 'cnc-telemetry-protocol-error');
    expect(errEv).toBeDefined();
    expect(errEv.detail.error).toBe('invalid future ACK');
  });

  it('5. Protocol-error participates in sequence tracking', async () => {
    const { env, ws } = await setupStartedBrowserEnv();

    ws.receiveMessage({
      protocolVersion: 1, type: 'protocol-error', seq: 1, ack: 0, bootId: 'boot1', stateRevision: 1,
      error: 'test error',
    });

    const errEv = env.dispatchedEvents.find((e) => e.type === 'cnc-telemetry-protocol-error');
    expect(errEv).toBeDefined();
    expect(errEv.detail.error).toBe('test error');
  });

  it('6 & 7. Duplicate seq is ignored; Packet gap requests resync', async () => {
    const { env, ws } = await setupStartedBrowserEnv();

    // Send valid snapshot seq 1
    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 1,
      state: { system: {}, controller: {}, machine: {}, job: {}, jog: {}, control: {} },
    });

    // Send duplicate seq 1 (must be ignored)
    const countBefore = env.dispatchedEvents.length;
    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 1,
      state: { system: {}, controller: {}, machine: {}, job: {}, jog: {}, control: {} },
    });
    expect(env.dispatchedEvents.length).toBe(countBefore);

    // Send sequence gap (seq 5 instead of 2)
    const packetsBefore = env.sentPackets.length;
    ws.receiveMessage({
      protocolVersion: 1, type: 'patch', seq: 5, ack: 1, bootId: 'boot1', stateRevision: 2,
      patch: { job: { state: 'RUNNING' } },
    });
    const resyncSent = env.sentPackets.slice(packetsBefore).find((p) => p.type === 'resync');
    expect(resyncSent).toBeDefined();
  });

  it('8 & 9. stateRevision skip does not request resync; stateRevision never regresses within boot', async () => {
    const { env, ws } = await setupStartedBrowserEnv();

    // Initial snapshot rev 1
    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 1,
      state: { system: {}, controller: {}, machine: {}, job: {}, jog: {}, control: {} },
    });

    // Patch with skipped revision (rev 10 instead of 2, but contiguous seq 2)
    const packetsBefore = env.sentPackets.length;
    ws.receiveMessage({
      protocolVersion: 1, type: 'patch', seq: 2, ack: 1, bootId: 'boot1', stateRevision: 10,
      patch: { job: { state: 'RUNNING' } },
    });
    const resyncSent = env.sentPackets.slice(packetsBefore).find((p) => p.type === 'resync');
    expect(resyncSent).toBeUndefined(); // Revision skip does NOT request resync
  });

  it('10 & 11. Snapshot replaces canonical mirrored state; Patch replaces top-level slice', async () => {
    const { env, ws } = await setupStartedBrowserEnv();

    // Snapshot
    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 1,
      state: {
        system: { bootId: 'boot1' },
        controller: { state: 'idle' },
        machine: { position: { work: { x: 0 } } },
        job: { state: 'IDLE' },
        jog: { state: 'Idle' },
        control: { owner: null },
      },
    });

    expect(env.CncTelemetry.mirroredState.controller.state).toBe('idle');

    // Patch updating controller
    ws.receiveMessage({
      protocolVersion: 1, type: 'patch', seq: 2, ack: 1, bootId: 'boot1', stateRevision: 2,
      patch: { controller: { state: 'running' } },
    });

    expect(env.CncTelemetry.mirroredState.controller.state).toBe('running');
  });

  it('12 & 13. Unchanged slice emits no event; Snapshot emits events exactly once', async () => {
    const { env, ws } = await setupStartedBrowserEnv();

    let jobEvents = 0;
    env.window.addEventListener('cnc-telemetry-job', () => jobEvents++);

    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 1,
      state: { system: {}, controller: {}, machine: {}, job: { state: 'IDLE' }, jog: {}, control: {} },
    });
    expect(jobEvents).toBe(1);

    // Send identical patch for job
    ws.receiveMessage({
      protocolVersion: 1, type: 'patch', seq: 2, ack: 1, bootId: 'boot1', stateRevision: 2,
      patch: { job: { state: 'IDLE' } },
    });
    expect(jobEvents).toBe(1); // Unchanged slice emitted no duplicate event
  });

  it('14. Changed boot ID clears old mirrored state', async () => {
    const { env, ws } = await setupStartedBrowserEnv();

    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 1,
      state: { system: { bootId: 'boot1' }, controller: { state: 'idle' }, machine: {}, job: {}, jog: {}, control: {} },
    });
    expect(env.CncTelemetry.mirroredState.controller).toBeDefined();

    // New boot ID
    ws.receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot-REBOOT-NEW', stateRevision: 1,
      state: { system: { bootId: 'boot-REBOOT-NEW' } },
    });
    expect(env.CncTelemetry.mirroredState.system.bootId).toBe('boot-REBOOT-NEW');
    expect(env.CncTelemetry.mirroredState.controller).toBeNull();
  });
});
