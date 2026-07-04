import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');
const platformio = await readFile(new URL('../../platformio.ini', import.meta.url), 'utf8');

describe('Marlin transport safety', () => {
  it('keeps framework and application diagnostics off the Marlin UART', () => {
    expect(platformio).toMatch(/-DCORE_DEBUG_LEVEL=0/);
    expect(source).not.toMatch(/Serial\.println\s*\(/);
    expect(source).not.toContain('Serial.printf(');
    expect(source).not.toContain('Serial.print("SD rescue update');
  });

  it('forces SD API downloads instead of rendering text G-code inline', () => {
    expect(source).toContain('server.sendHeader("Content-Disposition", "attachment; filename=\\\"" + fileName + "\\\"")');
    expect(source).toContain('server.streamFile(file, contentTypeForPath(path))');
  });

  it('keeps standalone maintenance headers in normal document flow', () => {
    expect(source).toContain('<header class=\\"panel maintenance-header\\"><h1>Firmware Update</h1>');
    expect(source).toContain('<header class=\\"panel maintenance-header\\"><h1>WiFi Settings</h1>');
  });

  it('checks arm and generated metadata across the complete streamed job JSON', () => {
    const armedStart = source.indexOf('bool jobJsonIsArmed');
    const armedEnd = source.indexOf('String readJobJsonSnippet', armedStart);
    const armed = source.slice(armedStart, armedEnd);
    expect(armed).toContain('jobFileContainsText(jobPath, "\\\"arm\\\":{\\\"state\\\":\\\"ARMED\\\"")');
    expect(armed).not.toContain('8192');
    const generatedStart = source.indexOf('bool jobJsonAllowsActiveGeneratedRun');
    const generatedEnd = source.indexOf('bool jobJsonAllowsProductionResume', generatedStart);
    const generated = source.slice(generatedStart, generatedEnd);
    expect(generated).toContain('jobFileContainsText(jobPath, activeRunNeedle)');
    expect(generated).toContain('jobFileContainsText(jobPath, "\\\"generatedValidation\\\":{\\\"status\\\":\\\"valid\\\"")');
    expect(generated).not.toContain('readJobJsonSnippet');
  });

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

  it('owns validated Aircut and Toolless streams in firmware', () => {
    expect(source).toContain('server.on("/api/test-motion/start", HTTP_POST, handleTestMotionStart)');
    expect(source).toContain('validateTestMotionFile(path, mode, safeZ');
    expect(source).toContain('firstCommand != "M5"');
    expect(source).toContain('lastCommand != "M400"');
    expect(source).toContain('test motion contains forbidden or unsupported command');
    expect(source).toContain('aircut Z command differs from configured Safe Z');
    expect(source).toMatch(/jobStatus\.streamMode != "job"[\s\S]*validateTestMotionCommand/);
  });

  it('restores saved XY only through an explicit Safe-Z machine-coordinate endpoint', () => {
    expect(source).toContain('server.on("/api/work-zero/restore", HTTP_POST, handleRestoreWorkZero)');
    const restore = source.slice(source.indexOf('void handleRestoreWorkZero()'), source.indexOf('void handleUpdatePage()'));
    expect(restore).toMatch(/M5[\s\S]*G53 G0 Z[\s\S]*M400[\s\S]*G53 G0 X[\s\S]*M400[\s\S]*G54[\s\S]*G92 X0 Y0[\s\S]*M114/);
    expect(restore).not.toContain('G92 Z0');
    expect(restore).not.toContain('G28');
  });

  it('owns guarded Production Resume Phase 2 in the firmware runner', () => {
    expect(source).toContain('server.on("/api/recovery/production/start", HTTP_POST, handleProductionResumeStart)');
    expect(source).toContain('validateProductionResumeFile(path, commandCount, validationError)');
    expect(source).toContain('jobJsonAllowsProductionResume(jobPath, activeRunPath, activeRunMode, eventId');
    expect(source).toContain('jobFileContainsText(jobPath, "\\\"productionResumeAuthorization\\\":{")');
    expect(source).toContain('jobFileContainsText(jobPath, "\\\"authorized\\\":true")');
    expect(source).toContain('first[0] != "G21"');
    expect(source).toContain('first[1] != "G90"');
    expect(source).toContain('first[2] != "G54"');
    expect(source).toContain('lastCommand != "M400"');
    expect(source).toMatch(/jobStatus\.streamMode == "production-resume"[\s\S]*validateProductionResumeCommand/);
    const validator = source.slice(source.indexOf('bool validateProductionResumeCommand'), source.indexOf('bool validateProductionResumeFile'));
    expect(validator).toContain('machineXMin()');
    expect(validator).toContain('machineXMax()');
    expect(validator).toContain('machineYMin()');
    expect(validator).toContain('machineYMax()');
    expect(validator).toContain('machineZMin()');
    expect(validator).toContain('machineZMax()');
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

  it('batches compact motion events and throttles full job progress telemetry', () => {
    expect(source).toContain('constexpr uint32_t kJobProgressBroadcastMs = 500');
    expect(source).toContain('void queueMotionTelemetry(const String &command, uint32_t sequence)');
    expect(source).toContain('telemetryMessage("delta", "motion", data)');
    expect(source).toContain('queueMotionTelemetry(line, jobStatus.currentLineNumber)');
    expect(source).toMatch(/void touchJobProgress\(\)[\s\S]*kJobProgressBroadcastMs/);
  });

  it('uses demand-driven Marlin position autoreport and filters unchanged reports', () => {
    expect(source).toContain('M154 S" + String(seconds)');
    expect(source).toContain('!machineProfile.capAutoreportPos || !telemetryHasClient()');
    expect(source).toContain('(jobIsActive() || jogIsActive()) ? 1 : 2');
    expect(source).toContain('processIdleMarlinAutoreport()');
    expect(source).toContain('fabs(marlinPosition.x - x) > 0.0005f');
  });
});
