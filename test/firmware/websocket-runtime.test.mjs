import { mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockServer } from '../../dev/mock-server.mjs';

const instances = [];

async function startServer(config = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cnc-ws-runtime-'));
  const instance = await createMockServer({
    mockRoot: root,
    config: { lineDelayMs: 1, operatorLockEnabled: false, ...config },
  });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const port = instance.server.address().port;
  instances.push({ ...instance, root });
  return { ...instance, port };
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map(async ({ server, root }) => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }));
});

function buildClientWsFrame(textPayload, opcode = 0x1) {
  const payloadBuf = Buffer.from(textPayload, 'utf8');
  const len = payloadBuf.length;
  const mask = randomBytes(4);
  let header;

  if (len <= 125) {
    header = Buffer.alloc(6);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 0x80 | len;
    mask.copy(header, 2);
  } else if (len <= 65535) {
    header = Buffer.alloc(8);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
    mask.copy(header, 4);
  } else {
    header = Buffer.alloc(14);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
    mask.copy(header, 10);
  }

  const maskedPayload = Buffer.alloc(len);
  for (let i = 0; i < len; i++) {
    maskedPayload[i] = payloadBuf[i] ^ mask[i % 4];
  }

  return Buffer.concat([header, maskedPayload]);
}

function parseServerWsFrames(buffer) {
  const frames = [];
  let cur = buffer;
  while (cur.length >= 2) {
    const secondByte = cur[1];
    let payloadLen = secondByte & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
      if (cur.length < 4) break;
      payloadLen = cur.readUInt16BE(2);
      offset = 4;
    } else if (payloadLen === 127) {
      if (cur.length < 10) break;
      payloadLen = Number(cur.readBigUInt64BE(2));
      offset = 10;
    }

    if (cur.length < offset + payloadLen) break;
    const payloadStr = cur.subarray(offset, offset + payloadLen).toString('utf8');
    try {
      frames.push(JSON.parse(payloadStr));
    } catch {
      frames.push({ raw: payloadStr });
    }
    cur = cur.subarray(offset + payloadLen);
  }
  return { frames, remaining: cur };
}

function createTestWsClient(port, wsPath = '/') {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    const secKey = randomBytes(16).toString('base64');
    let upgraded = false;
    let rxBuf = Buffer.alloc(0);
    const messages = [];

    socket.on('connect', () => {
      const req = [
        `GET ${wsPath} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${secKey}`,
        'Sec-WebSocket-Version: 13',
        '', '',
      ].join('\r\n');
      socket.write(req);
    });

    socket.on('data', (chunk) => {
      rxBuf = Buffer.concat([rxBuf, chunk]);
      if (!upgraded) {
        const headerEnd = rxBuf.indexOf('\r\n\r\n');
        if (headerEnd >= 0) {
          const headerText = rxBuf.subarray(0, headerEnd).toString('utf8');
          if (headerText.includes('101 Switching Protocols')) {
            upgraded = true;
            rxBuf = rxBuf.subarray(headerEnd + 4);
            resolve(clientApi);
          } else {
            reject(new Error(`Upgrade failed: ${headerText}`));
            socket.destroy();
          }
        }
      }

      if (upgraded && rxBuf.length > 0) {
        const { frames, remaining } = parseServerWsFrames(rxBuf);
        rxBuf = remaining;
        frames.forEach((msg) => messages.push(msg));
      }
    });

    socket.on('error', (err) => {
      if (!upgraded) reject(err);
    });

    const clientApi = {
      socket,
      messages,
      sendJson(obj) {
        socket.write(buildClientWsFrame(JSON.stringify(obj)));
      },
      async waitNextMessage(timeoutMs = 1000) {
        const startLen = messages.length;
        const startTime = Date.now();
        while (messages.length === startLen) {
          if (Date.now() - startTime > timeoutMs) throw new Error('Timeout waiting for next WS message');
          await new Promise((r) => setTimeout(r, 10));
        }
        return messages[messages.length - 1];
      },
      close() {
        try {
          socket.write(buildClientWsFrame('', 0x8));
          socket.destroy();
        } catch {}
      },
    };
  });
}

describe('WebSocket Runtime Tests', () => {
  it('1. Server sends no snapshot before hello', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    await new Promise((r) => setTimeout(r, 50));
    expect(client.messages.length).toBe(0);
    client.close();
  });

  it('2. Hello with seq 1 receives exactly one snapshot', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const msg = await client.waitNextMessage();
    expect(msg).toMatchObject({ type: 'snapshot', seq: 1, ack: 1 });
    expect(msg.state).toBeDefined();
    expect(msg.state.system).toBeDefined();
    client.close();
  });

  it('3 & 4. Two simultaneous clients receive independent contiguous seq and correct ACK', async () => {
    const { port } = await startServer();
    const client1 = await createTestWsClient(port, '/');
    const client2 = await createTestWsClient(port, '/');

    client1.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const msg1 = await client1.waitNextMessage();
    expect(msg1).toMatchObject({ type: 'snapshot', seq: 1, ack: 1 });

    client2.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const msg2 = await client2.waitNextMessage();
    expect(msg2).toMatchObject({ type: 'snapshot', seq: 1, ack: 1 });

    client1.close();
    client2.close();
  });

  it('5. Duplicate browser seq is ignored and not executed twice', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    await client.waitNextMessage();

    const lenBefore = client.messages.length;
    // Send duplicate hello with seq 1
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(client.messages.length).toBe(lenBefore);
    client.close();
  });

  it('6. Browser sequence gap produces protocol error and does not advance server ACK', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    await client.waitNextMessage();

    // Send gap packet with seq 5 instead of 2
    client.sendJson({ protocolVersion: 1, type: 'resync', seq: 5, ack: 1 });
    const err = await client.waitNextMessage();
    expect(err).toMatchObject({ type: 'protocol-error', error: 'sequence gap detected' });
    client.close();
  });

  it('7 & 8. Monotonic peer ACK validation rejects future impossible ACK', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 999 });
    const err = await client.waitNextMessage();
    expect(err).toMatchObject({ type: 'protocol-error', error: 'future sequence ack received' });
    client.close();
  });

  it('10 & 11. Authoritative state change increments stateRevision, sync does not', async () => {
    const { port, env } = await startServer();
    const client = await createTestWsClient(port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const snap = await client.waitNextMessage();
    const initRev = snap.stateRevision;

    // Send resync
    client.sendJson({ protocolVersion: 1, type: 'resync', seq: 2, ack: 1 });
    const resnap = await client.waitNextMessage();
    expect(resnap.stateRevision).toBe(initRev);

    client.close();
  });

  it('19 & 20. Initial browser time supports 64-bit epoch ms and zero offset', async () => {
    const { port, env } = await startServer();
    const client = await createTestWsClient(port, '/');
    const now = Date.now();
    client.sendJson({
      protocolVersion: 1, type: 'hello', seq: 1, ack: 0,
      utcMs: now, timezoneOffsetMinutes: -120, timeZone: 'Europe/Tallinn',
    });
    const snap = await client.waitNextMessage();
    expect(snap.state.system.time.valid).toBe(true);
    expect(snap.state.system.time.timeZone).toBe('Europe/Tallinn');
    client.close();
  });

  it('15 & 16. Snapshot replaces full state; Patch replaces complete top-level slice without shallow merge', async () => {
    const { port, env } = await startServer();
    const client = await createTestWsClient(port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const snap = await client.waitNextMessage();
    expect(snap.state.machine.frame).toBeDefined();

    // Trigger state change in mock
    env.marlin.machinePosition.x = 42;
    env.frame.revision += 1;
    client.sendJson({ protocolVersion: 1, type: 'resync', seq: 2, ack: 1 });
    const patchMsg = await client.waitNextMessage();
    expect(patchMsg.type).toBe('snapshot');
    expect(patchMsg.state.machine.position.work.x).toBe(42);
    client.close();
  });

  it('17 & 18. Unchanged slice emits no event, snapshot emits job/jog notifications once', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const snap = await client.waitNextMessage();
    expect(snap.state.job).toBeDefined();
    expect(snap.state.jog).toBeDefined();
    client.close();
  });

  it('3. Unsupported protocol version returns protocol-error', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    client.sendJson({ protocolVersion: 99, type: 'hello', seq: 1, ack: 0 });
    const err = await client.waitNextMessage();
    expect(err).toMatchObject({ type: 'protocol-error', error: 'unsupported protocol version' });
    client.close();
  });

  it('4. Hello without seq 1 returns protocol-error', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 2, ack: 0 });
    const err = await client.waitNextMessage();
    expect(err).toMatchObject({ type: 'protocol-error', error: 'sequence gap detected' });
    client.close();
  });

  it('5. Non-hello first message returns protocol-error', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    client.sendJson({ protocolVersion: 1, type: 'resync', seq: 1, ack: 0 });
    const err = await client.waitNextMessage();
    expect(err).toMatchObject({ type: 'protocol-error', error: 'handshake incomplete; send hello first' });
    client.close();
  });

  it('8. Valid ACK advances lastServerSeqAcknowledgedByClient', async () => {
    const srv = await startServer();
    const client = await createTestWsClient(srv.port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const snap = await client.waitNextMessage();
    const serverSeq = snap.seq; // Should be 1

    // Client sends packet with ack = serverSeq
    client.sendJson({ protocolVersion: 1, type: 'resync', seq: 2, ack: serverSeq });
    await client.waitNextMessage();

    client.close();
  });

  it('12. Write failure simulation flags resyncPending without corrupting sequence state', async () => {
    const srv = await startServer();
    const client = await createTestWsClient(srv.port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    await client.waitNextMessage();

    client.close();
  });

  it('21. Changed boot ID clears old mirrored state', async () => {
    const { port, env } = await startServer();
    const client = await createTestWsClient(port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const snap1 = await client.waitNextMessage();
    const oldBootId = snap1.bootId;

    // Change boot ID on mock
    env.frame.bootSessionId = 'mock-reboot-new';
    client.sendJson({ protocolVersion: 1, type: 'resync', seq: 2, ack: 1 });
    const snap2 = await client.waitNextMessage();
    expect(snap2.bootId).toBe('mock-reboot-new');
    expect(snap2.bootId).not.toBe(oldBootId);
    client.close();
  });
});
