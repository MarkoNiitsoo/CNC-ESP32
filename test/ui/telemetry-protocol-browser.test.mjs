import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

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

  it('15. Command responses resolve without consuming telemetry sequence or mutating canonical state', async () => {
    const { env, ws } = await setupStartedBrowserEnv({ windowProps: { CNC_TELEMETRY_TEST_MODE: true } });
    ws.receiveMessage({ protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 1,
      state: completeState({ job: { state: 'RUNNING', feedOverridePercent: 100 } }) });
    env.CncTelemetry.setSocketCommandToken('a'.repeat(40), 7);

    const resultPromise = env.CncTelemetry.command('job.setFeedOverride', { percent: 110 }, 'cmd-roundtrip');
    ws.receiveMessage({ protocolVersion: 1, type: 'commandAck', commandId: 'cmd-roundtrip', accepted: true,
      inProgress: false, ok: false, code: 'ACCEPTED', message: 'queued' });
    ws.receiveMessage({ protocolVersion: 1, type: 'commandResult', commandId: 'cmd-roundtrip', accepted: true,
      inProgress: false, ok: true, code: 'OK', message: 'done' });

    await expect(resultPromise).resolves.toMatchObject({ commandId: 'cmd-roundtrip', ok: true, code: 'OK' });
    expect(env.CncTelemetry.__test__.getLastServerSeq()).toBe(1);
    expect(env.CncTelemetry.mirroredState.job).toEqual({ state: 'RUNNING', feedOverridePercent: 100 });
    ws.receiveMessage({ protocolVersion: 1, type: 'patch', seq: 2, ack: 1, bootId: 'boot1', stateRevision: 2,
      patch: { job: { state: 'RUNNING', feedOverridePercent: 110 } } });
    expect(env.CncTelemetry.mirroredState.job.feedOverridePercent).toBe(110);
  });

  it('16. Rejected command exposes a stable pre-acceptance disposition', async () => {
    const { env, ws } = await setupStartedBrowserEnv();
    env.CncTelemetry.setSocketCommandToken('b'.repeat(40), 2);
    const promise = env.CncTelemetry.command('job.pause', null, 'cmd-rejected');
    ws.receiveMessage({ protocolVersion: 1, type: 'commandAck', commandId: 'cmd-rejected', accepted: false,
      inProgress: false, ok: false, code: 'QUEUE_FULL', message: 'queue full' });
    await expect(promise).rejects.toMatchObject({ code: 'QUEUE_FULL', commandDisposition: 'rejected', definitelyNotAccepted: true });
  });

  it('17. commandQuery sends an authenticated packet even with existing pending listeners', async () => {
    const { env, ws } = await setupStartedBrowserEnv();
    env.CncTelemetry.setSocketCommandToken('c'.repeat(40), 3);
    const commandPromise = env.CncTelemetry.command('job.pause', null, 'cmd-query-pending');
    const queryPromise = env.CncTelemetry.commandQuery('cmd-query-pending');
    const query = env.sentPackets.filter((packet) => packet.type === 'commandQuery').at(-1);
    expect(query).toMatchObject({ commandId: 'cmd-query-pending', authorization: { controlSessionEpoch: 3, socketCommandToken: 'c'.repeat(40) } });
    ws.receiveMessage({ protocolVersion: 1, type: 'commandResult', commandId: 'cmd-query-pending', accepted: true,
      inProgress: false, ok: true, code: 'OK', message: 'paused' });
    await expect(Promise.all([commandPromise, queryPromise])).resolves.toHaveLength(2);
  });

  it('18. Reconnect snapshot queries an unresolved accepted command and recovers its result', async () => {
    vi.useFakeTimers();
    try {
      const env = createBrowserEnv({ windowProps: { CNC_TELEMETRY_TEST_MODE: true } });
      env.CncTelemetry.start();
      const firstWs = env.getWsInstance();
      firstWs.receiveMessage({ protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 1,
        state: completeState() });
      env.CncTelemetry.setSocketCommandToken('d'.repeat(40), 4);
      const promise = env.CncTelemetry.command('job.resume', null, 'cmd-reconnect');
      firstWs.receiveMessage({ protocolVersion: 1, type: 'commandAck', commandId: 'cmd-reconnect', accepted: true,
        inProgress: true, ok: false, code: 'IN_PROGRESS', message: 'running' });
      firstWs.close();
      await vi.advanceTimersByTimeAsync(1000);
      const secondWs = env.getWsInstance();
      expect(secondWs).not.toBe(firstWs);
      secondWs.receiveMessage({ protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot1', stateRevision: 2,
        state: completeState() });
      expect(env.sentPackets.filter((packet) => packet.type === 'commandQuery').at(-1)?.commandId).toBe('cmd-reconnect');
      secondWs.receiveMessage({ protocolVersion: 1, type: 'commandResult', commandId: 'cmd-reconnect', accepted: true,
        inProgress: false, ok: true, code: 'OK', message: 'resumed' });
      await expect(promise).resolves.toMatchObject({ code: 'OK' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('19. Authorization revocation immediately rejects pending work and clears bounded state', async () => {
    const { env } = await setupStartedBrowserEnv({ windowProps: { CNC_TELEMETRY_TEST_MODE: true } });
    env.CncTelemetry.setSocketCommandToken('e'.repeat(40), 5);
    const promise = env.CncTelemetry.command('job.pause', null, 'cmd-revoke');
    env.CncTelemetry.revokeCommandAuthorization('lease lost', 'AUTHORIZATION_REVOKED');
    await expect(promise).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED', commandDisposition: 'outcome-unknown' });
    expect(env.CncTelemetry.__test__.getPendingCommands().size).toBe(0);
    expect(env.CncTelemetry.__test__.getSocketCommandToken()).toBeNull();
  });
});
