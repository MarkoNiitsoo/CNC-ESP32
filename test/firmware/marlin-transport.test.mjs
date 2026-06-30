import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');

describe('Marlin transport safety', () => {
  it('ends synchronous reads on complete terminal response lines', () => {
    expect(source).toContain('bool marlinResponseIsTerminal(const String &response)');
    expect(source).toContain('line == "OK"');
    expect(source).toContain('line.startsWith("ERROR:")');
    expect(source).toMatch(/received && marlinResponseIsTerminal\(response\)/);
    expect(source).toContain('return readMarlinResponseFor(kMarlinTimeoutMs, priority);');
  });

  it('does not let diagnostics steal active job or jog UART responses', () => {
    expect(source).toMatch(/jobIsActive\(\) \|\| jobWaitingForOk \|\| priorityCommandCount > 0/);
    expect(source).toContain('Marlin transport is busy with the active job');
    expect(source).toContain('Marlin transport is busy with safe jog');
  });

  it('keeps M5 on the priority path before the busy transport rejection', () => {
    const m5 = source.indexOf('upper == "M5")');
    const busy = source.indexOf('Marlin transport is busy with the active job');
    expect(m5).toBeGreaterThan(-1);
    expect(busy).toBeGreaterThan(m5);
  });
});

describe('delta telemetry transport', () => {
  it('keeps WebSocket telemetry separate from HTTP controls', () => {
    expect(source).toContain('WebSocketsServer telemetrySocket(kTelemetryWebSocketPort)');
    expect(source).toContain('telemetrySocket.onEvent(handleTelemetrySocket)');
    expect(source).toMatch(/telemetryMessage\("delta", "job", jobStatusJson\(\)\)[\s\S]*telemetrySocket\.broadcastTXT\(payload\)/);
    expect(source).toMatch(/telemetryMessage\("delta", "jog", jogStatusJson\(\)\)[\s\S]*telemetrySocket\.broadcastTXT\(payload\)/);
    expect(source).toContain('constexpr uint32_t kTelemetryMinBroadcastMs = 100');
  });

  it('marks job changes for a later non-blocking broadcast', () => {
    expect(source).toMatch(/void touchJobStatus\(\)[\s\S]*telemetryJobDirty = true/);
    expect(source).toMatch(/void loop\(\)[\s\S]*server\.handleClient\(\);[\s\S]*processTelemetrySocket\(\);/);
  });

  it('broadcasts position only when an M114 response changes XYZ', () => {
    expect(source).toContain('void updatePositionFromMarlinResponse(const String &response)');
    expect(source).toMatch(/addMarlinLog\("rx", priority, response\);[\s\S]*updatePositionFromMarlinResponse\(response\)/);
    expect(source).toContain('fabs(marlinPosition.x - x) > 0.0005f');
    expect(source).toContain('telemetryPositionDirty = true');
    expect(source).toContain('telemetryMessage("delta", "position"');
  });

  it('streams only new log entries to clients that requested logs', () => {
    expect(source).toContain('uint32_t nextMarlinLogId = 1');
    expect(source).toContain('telemetryLogSubscribed[WEBSOCKETS_SERVER_CLIENT_MAX]');
    expect(source).toContain('message.indexOf("\\\"log\\\":true")');
    expect(source).toMatch(/entry\.id <= telemetryLastLogId/);
    expect(source).toContain('server.arg("after").toInt()');
    expect(source).toContain('\\\"nextId\\\"');
  });
});
