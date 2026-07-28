import { mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
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
    const firstByte = cur[0];
    const opcode = firstByte & 0x0f;
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
    const frameObj = { opcode, raw: payloadStr };
    try {
      frameObj.json = JSON.parse(payloadStr);
      Object.assign(frameObj, frameObj.json);
    } catch {}
    frames.push(frameObj);
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

describe('Executable Raw TCP WebSocket Runtime Tests', () => {
  it('1. /ws upgrade on a non-standard HTTP port', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/ws');
    expect(client.socket.destroyed).toBe(false);
    client.close();
  });

  it('2. No snapshot before hello', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    await new Promise((r) => setTimeout(r, 50));
    expect(client.messages.length).toBe(0);
    client.close();
  });

  it('3. Exactly one snapshot after hello', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const msg = await client.waitNextMessage();
    expect(msg.type).toBe('snapshot');
    expect(msg.seq).toBe(1);
    expect(msg.ack).toBe(1);
    expect(msg.state).toBeDefined();
    expect(client.messages.length).toBe(1);
    client.close();
  });

  it('4. Independent contiguous sequences for two clients', async () => {
    const { port } = await startServer();
    const client1 = await createTestWsClient(port, '/');
    const client2 = await createTestWsClient(port, '/');

    client1.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const msg1 = await client1.waitNextMessage();
    expect(msg1.seq).toBe(1);

    client2.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const msg2 = await client2.waitNextMessage();
    expect(msg2.seq).toBe(1);

    client1.sendJson({ protocolVersion: 1, type: 'resync', seq: 2, ack: 1 });
    const msg1Next = await client1.waitNextMessage();
    expect(msg1Next.seq).toBe(2);
    expect(client2.messages.length).toBe(1); // Client 2 sequence remains unaffected

    client1.close();
    client2.close();
  });

  it('5. Duplicate browser seq ignored', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    await client.waitNextMessage();

    const lenBefore = client.messages.length;
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(client.messages.length).toBe(lenBefore);
    client.close();
  });

  it('6. Sequence gap preserves contiguous ACK', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    await client.waitNextMessage();

    client.sendJson({ protocolVersion: 1, type: 'resync', seq: 5, ack: 1 });
    const err = await client.waitNextMessage();
    expect(err.type).toBe('protocol-error');
    expect(err.error).toBe('sequence gap detected');
    expect(err.ack).toBe(1); // Preserves contiguous ACK 1
    client.close();
  });

  it('7. Valid ACK advances stored peer ACK', async () => {
    const srv = await startServer();
    const client = await createTestWsClient(srv.port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const snap = await client.waitNextMessage();

    client.sendJson({ protocolVersion: 1, type: 'resync', seq: 2, ack: snap.seq });
    await client.waitNextMessage();

    const states = srv.listClientProtocolStates();
    expect(states[0].lastServerSeqAcknowledgedByClient).toBe(snap.seq);
    client.close();
  });

  it('8. Older ACK cannot move stored ACK backwards', async () => {
    const srv = await startServer();
    const client = await createTestWsClient(srv.port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const snap = await client.waitNextMessage();

    client.sendJson({ protocolVersion: 1, type: 'resync', seq: 2, ack: snap.seq });
    await client.waitNextMessage();

    client.sendJson({ protocolVersion: 1, type: 'resync', seq: 3, ack: 0 });
    await client.waitNextMessage();

    const states = srv.listClientProtocolStates();
    expect(states[0].lastServerSeqAcknowledgedByClient).toBe(snap.seq);
    client.close();
  });

  it('9. Future ACK rejected', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 999 });
    const err = await client.waitNextMessage();
    expect(err.type).toBe('protocol-error');
    expect(err.error).toBe('future sequence ack received');
    client.close();
  });

  it('10. Simulated failed outbound write does not consume server seq', async () => {
    const srv = await startServer();
    const client = await createTestWsClient(srv.port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const snap1 = await client.waitNextMessage();
    expect(snap1.seq).toBe(1);

    srv.simulateNextOutboundWriteFailure(0);
    srv.triggerStateSliceChange('controller', { state: 'running' });

    srv.triggerStateSliceChange('controller', { state: 'idle' });
    const patchMsg = await client.waitNextMessage();
    expect(patchMsg.seq).toBe(2); // Sequence was NOT skipped or consumed by failed write
    client.close();
  });

  it('11. Actual authoritative state change increments revision once', async () => {
    const srv = await startServer();
    const client = await createTestWsClient(srv.port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const snap = await client.waitNextMessage();
    const initRev = snap.stateRevision;

    srv.triggerStateSliceChange('controller', { state: 'running' });
    const patch = await client.waitNextMessage();
    expect(patch.stateRevision).toBe(initRev + 1);
    client.close();
  });

  it('12. Coalesced changes produce one latest complete patch', async () => {
    const srv = await startServer();
    const client = await createTestWsClient(srv.port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const snap = await client.waitNextMessage();
    const initRev = snap.stateRevision;

    const countBefore = client.messages.length;
    srv.coalesceStateChanges((add) => {
      add('controller', { state: 'running' });
      add('job', { state: 'RUNNING' });
    });

    const patch = await client.waitNextMessage();
    expect(client.messages.length).toBe(countBefore + 1); // Exactly ONE patch packet
    expect(patch.patch.controller).toBeDefined();
    expect(patch.patch.job).toBeDefined();
    expect(patch.stateRevision).toBe(initRev + 1);
    client.close();
  });

  it('13. Resync does not increment revision', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const snap = await client.waitNextMessage();
    const initRev = snap.stateRevision;

    client.sendJson({ protocolVersion: 1, type: 'resync', seq: 2, ack: 1 });
    const resnap = await client.waitNextMessage();
    expect(resnap.stateRevision).toBe(initRev);
    client.close();
  });

  it('14. Idle sync does not increment revision', async () => {
    const srv = await startServer();
    const client = await createTestWsClient(srv.port, '/');
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 });
    const snap = await client.waitNextMessage();
    const initRev = snap.stateRevision;

    srv.triggerIdleSync();
    const syncMsg = await client.waitNextMessage();
    expect(syncMsg.type).toBe('sync');
    expect(syncMsg.stateRevision).toBe(initRev);
    client.close();
  });

  it('15. Masked payload longer than 125 bytes', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    const largePayload = 'A'.repeat(200);
    client.sendJson({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0, custom: largePayload });
    const snap = await client.waitNextMessage();
    expect(snap.type).toBe('snapshot');
    client.close();
  });

  it('16. Two frames in one TCP chunk', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    const frame1 = buildClientWsFrame(JSON.stringify({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 }));
    const frame2 = buildClientWsFrame(JSON.stringify({ protocolVersion: 1, type: 'resync', seq: 2, ack: 1 }));
    client.socket.write(Buffer.concat([frame1, frame2]));

    await new Promise((r) => setTimeout(r, 60));
    expect(client.messages.length).toBe(2);
    expect(client.messages[0].type).toBe('snapshot');
    expect(client.messages[1].type).toBe('snapshot');
    client.close();
  });

  it('17. One frame split across chunks', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    const fullFrame = buildClientWsFrame(JSON.stringify({ protocolVersion: 1, type: 'hello', seq: 1, ack: 0 }));
    const mid = Math.floor(fullFrame.length / 2);
    client.socket.write(fullFrame.subarray(0, mid));
    await new Promise((r) => setTimeout(r, 20));
    client.socket.write(fullFrame.subarray(mid));

    const snap = await client.waitNextMessage();
    expect(snap.type).toBe('snapshot');
    client.close();
  });

  it('18. Ping receives pong with identical payload', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    const pingFrame = buildClientWsFrame('ping-test-123', 0x9);
    client.socket.write(pingFrame);

    const msg = await client.waitNextMessage();
    expect(msg.opcode).toBe(0xa); // PONG
    expect(msg.raw).toBe('ping-test-123');
    client.close();
  });

  it('19. Clean close handshake', async () => {
    const { port } = await startServer();
    const client = await createTestWsClient(port, '/');
    const closeFrame = buildClientWsFrame('', 0x8);
    client.socket.write(closeFrame);

    const msg = await client.waitNextMessage();
    expect(msg.opcode).toBe(0x8); // CLOSE
    client.close();
  });

  it('20. Second client does not invalidate synchronized clock', async () => {
    const { port } = await startServer();
    const client1 = await createTestWsClient(port, '/');
    client1.sendJson({
      protocolVersion: 1, type: 'hello', seq: 1, ack: 0,
      utcMs: 1785162634123, timezoneOffsetMinutes: -180, timeZone: 'Europe/Tallinn',
    });
    const snap1 = await client1.waitNextMessage();
    expect(snap1.state.system.time.valid).toBe(true);
    expect(snap1.state.system.time.timeZone).toBe('Europe/Tallinn');

    // Second read-only client connects with a different clock attempt
    const client2 = await createTestWsClient(port, '/');
    client2.sendJson({
      protocolVersion: 1, type: 'hello', seq: 1, ack: 0,
      utcMs: 1000000000000, timezoneOffsetMinutes: 0, timeZone: 'America/New_York',
    });
    const snap2 = await client2.waitNextMessage();
    expect(snap2.state.system.time.valid).toBe(true);
    expect(snap2.state.system.time.timeZone).toBe('Europe/Tallinn'); // Clock was retained!

    client1.close();
    client2.close();
  });
});
