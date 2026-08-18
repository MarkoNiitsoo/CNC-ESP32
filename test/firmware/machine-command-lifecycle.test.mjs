import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const telemetryJsCode = readFileSync(path.resolve(__dirname, '../../www/telemetry.js'), 'utf8');

afterEach(() => {
  vi.useRealTimers();
});

function createBrowserEnv() {
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
      this.eventListeners.get('close')?.();
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
    removeEventListener() {},
    dispatchEvent() {},
    CustomEvent: FakeCustomEvent,
    WebSocket: FakeWebSocket,
    CNC_TELEMETRY_TEST_MODE: true,
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

function synchronizedTelemetry() {
  const env = createBrowserEnv();
  const tel = env.CncTelemetry;
  tel.start();
  const socket = env.getSocket();
  socket.receiveMessage({
    protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1,
    bootId: 'boot-cmd', stateRevision: 1,
    state: { system: {}, controller: {}, machine: {}, job: {}, jog: {}, control: {}, machineProfile: {} },
  });
  tel.setSocketCommandToken('t'.repeat(40), 7);
  return { env, tel, socket };
}

describe('two-phase machine command lifecycle (admission vs result)', () => {
  it('resolves admission on the ACK and the result only on the terminal commandResult', async () => {
    const { tel, socket } = synchronizedTelemetry();
    const handle = tel.beginCommand('machine.home', { axes: 'all' }, 'cmd-life-1',
      { admissionTimeoutMs: 5000, resultTimeoutMs: 30000 });

    socket.receiveMessage({ protocolVersion: 1, type: 'commandAck', commandId: 'cmd-life-1', accepted: true, inProgress: true, ok: false, code: 'ACCEPTED', message: 'Command accepted' });
    const admission = await handle.accepted;
    expect(admission).toMatchObject({ commandId: 'cmd-life-1', accepted: true, inProgress: true });

    // Result is still pending after admission resolved.
    let resultSettled = false;
    handle.result.then(() => { resultSettled = true; }, () => { resultSettled = true; });
    await Promise.resolve();
    expect(resultSettled).toBe(false);

    socket.receiveMessage({ protocolVersion: 1, type: 'commandResult', commandId: 'cmd-life-1', accepted: true, inProgress: false, ok: true, code: 'OK', message: 'Machine homing completed successfully' });
    const result = await handle.result;
    expect(result).toMatchObject({ commandId: 'cmd-life-1', ok: true, code: 'OK' });
  });

  it('rejects admission on a rejected ACK as definitely-not-accepted (fallback allowed)', async () => {
    const { tel, socket } = synchronizedTelemetry();
    const handle = tel.beginCommand('machine.home', { axes: 'all' }, 'cmd-life-2',
      { admissionTimeoutMs: 5000, resultTimeoutMs: 30000 });

    socket.receiveMessage({ protocolVersion: 1, type: 'commandAck', commandId: 'cmd-life-2', accepted: false, inProgress: false, ok: false, code: 'UNAUTHORIZED', message: 'Command authorization invalid or expired' });
    await expect(handle.accepted).rejects.toMatchObject({
      code: 'UNAUTHORIZED', commandDisposition: 'rejected', definitelyNotAccepted: true,
    });
    await expect(handle.result).rejects.toMatchObject({ commandDisposition: 'rejected' });
  });

  it('keeps an accepted command valid while its result is slow (timeout is not rejection)', async () => {
    vi.useFakeTimers();
    const { tel, socket } = synchronizedTelemetry();
    const handle = tel.beginCommand('machine.home', { axes: 'all' }, 'cmd-life-3',
      { admissionTimeoutMs: 5000, resultTimeoutMs: 5000 });

    socket.receiveMessage({ protocolVersion: 1, type: 'commandAck', commandId: 'cmd-life-3', accepted: true, inProgress: true, ok: false, code: 'ACCEPTED', message: 'Command accepted' });
    await handle.accepted;

    vi.advanceTimersByTime(6000);
    const resultError = await handle.result.then(() => null, (error) => error);
    expect(resultError).toMatchObject({
      code: 'TIMEOUT', commandDisposition: 'accepted', definitelyNotAccepted: false,
    });

    // The late commandResult still lands in the ledger and commandQuery
    // recovers it — a slow result never becomes a duplicate execution.
    socket.receiveMessage({ protocolVersion: 1, type: 'commandResult', commandId: 'cmd-life-3', accepted: true, inProgress: false, ok: true, code: 'OK', message: 'late completion' });
    const recovered = await tel.commandQuery('cmd-life-3', { timeoutMs: 5000 });
    expect(recovered).toMatchObject({ commandId: 'cmd-life-3', ok: true, code: 'OK' });
  });

  it('recovers a lost result by commandQuery after the result timeout', async () => {
    vi.useFakeTimers();
    const { tel, socket, env } = synchronizedTelemetry();
    const handle = tel.beginCommand('machine.setWorkZero', { axes: 'xyz' }, 'cmd-life-4',
      { admissionTimeoutMs: 5000, resultTimeoutMs: 5000 });

    socket.receiveMessage({ protocolVersion: 1, type: 'commandAck', commandId: 'cmd-life-4', accepted: true, inProgress: true, ok: false, code: 'ACCEPTED', message: 'Command accepted' });
    await handle.accepted;
    vi.advanceTimersByTime(6000);
    await expect(handle.result).rejects.toMatchObject({ code: 'TIMEOUT', definitelyNotAccepted: false });

    const query = tel.commandQuery('cmd-life-4', { timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(0);
    const queryPacket = env.sentPackets.find((p) => p.type === 'commandQuery' && p.commandId === 'cmd-life-4');
    expect(queryPacket).toBeDefined();
    socket.receiveMessage({ protocolVersion: 1, type: 'commandResult', commandId: 'cmd-life-4', accepted: true, inProgress: false, ok: true, code: 'OK', message: 'recovered' });
    await expect(query).resolves.toMatchObject({ commandId: 'cmd-life-4', ok: true });
  });

  it('settles outstanding handles conservatively on authorization revocation', async () => {
    const { tel, socket } = synchronizedTelemetry();
    const handle = tel.beginCommand('machine.home', { axes: 'all' }, 'cmd-life-5',
      { admissionTimeoutMs: 5000, resultTimeoutMs: 30000 });

    socket.receiveMessage({ protocolVersion: 1, type: 'commandAck', commandId: 'cmd-life-5', accepted: true, inProgress: true, ok: false, code: 'ACCEPTED', message: 'Command accepted' });
    await handle.accepted;

    tel.revokeCommandAuthorization('Operator control session changed.', 'CONTROL_SESSION_CHANGED');
    const error = await handle.result.then(() => null, (e) => e);
    expect(error).toMatchObject({
      code: 'CONTROL_SESSION_CHANGED',
      commandDisposition: 'accepted',
      definitelyNotAccepted: false,
    });
  });

  it('rejects both phases before sending when no control session is active', async () => {
    const env = createBrowserEnv();
    const tel = env.CncTelemetry;
    tel.start();
    env.getSocket().receiveMessage({
      protocolVersion: 1, type: 'snapshot', seq: 1, ack: 1, bootId: 'boot-nosession', stateRevision: 1,
      state: { system: {}, controller: {}, machine: {}, job: {}, jog: {}, control: {}, machineProfile: {} },
    });
    const handle = tel.beginCommand('machine.home', { axes: 'all' }, 'cmd-life-6');
    await expect(handle.accepted).rejects.toMatchObject({ code: 'UNAUTHORIZED', definitelyNotAccepted: true });
    await expect(handle.result).rejects.toMatchObject({ code: 'UNAUTHORIZED', definitelyNotAccepted: true });
    expect(env.sentPackets.some((p) => p.type === 'command' && p.commandId === 'cmd-life-6')).toBe(false);
  });

  it('reuses the completed ledger entry for an exact beginCommand retry', async () => {
    const { tel, socket, env } = synchronizedTelemetry();
    const first = tel.beginCommand('machine.setZZero', null, 'cmd-life-7',
      { admissionTimeoutMs: 5000, resultTimeoutMs: 30000 });
    socket.receiveMessage({ protocolVersion: 1, type: 'commandAck', commandId: 'cmd-life-7', accepted: true, inProgress: true, ok: false, code: 'ACCEPTED', message: 'Command accepted' });
    socket.receiveMessage({ protocolVersion: 1, type: 'commandResult', commandId: 'cmd-life-7', accepted: true, inProgress: false, ok: true, code: 'OK', message: 'done' });
    await first.result;

    const retry = tel.beginCommand('machine.setZZero', null, 'cmd-life-7',
      { admissionTimeoutMs: 5000, resultTimeoutMs: 30000 });
    await expect(retry.accepted).resolves.toMatchObject({ accepted: true });
    await expect(retry.result).resolves.toMatchObject({ commandId: 'cmd-life-7', ok: true });
    // No second command packet was sent for the idempotent retry.
    const commandPackets = env.sentPackets.filter((p) => p.type === 'command' && p.commandId === 'cmd-life-7');
    expect(commandPackets).toHaveLength(1);
  });
});
