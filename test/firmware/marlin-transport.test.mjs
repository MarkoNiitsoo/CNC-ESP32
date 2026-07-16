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

  it('installs a root firmware.bin once and renames it after success', () => {
    expect(source).toContain('kSdRootUpdateBinPath = "/firmware.bin"');
    expect(source).toContain('kSdRootDoneBinPath = "/firmware.done.bin"');
    expect(source).toContain('bool checkForRootFirmwareUpdate()');
    expect(source).toContain('performRootFirmwareUpdate()');
    expect(source).toMatch(/checkForSdRescueUpdate\(\)[\s\S]*else if \(checkForRootFirmwareUpdate\(\)\)/);
    expect(source).toContain('SD_MMC.rename(sourcePath, donePath)');
  });

  it('forces SD API downloads instead of rendering text G-code inline', () => {
    expect(source).toContain('server.sendHeader("Content-Disposition", "attachment; filename=\\\"" + fileName + "\\\"")');
    expect(source).toContain('server.streamFile(file, contentTypeForPath(path))');
  });

  it('keeps standalone maintenance headers in normal document flow', () => {
    expect(source).toContain('<header class=\\"panel maintenance-header\\"><h1>Firmware Update</h1>');
    expect(source).toContain('<header class=\\"panel maintenance-header\\"><h1>WiFi Settings</h1>');
  });

  it('parses and verifies exact start authorization and generated metadata', () => {
    const loaderStart = source.indexOf('bool loadJobExecutionAuthorization');
    const loaderEnd = source.indexOf('bool isHexSha256', loaderStart);
    const loader = source.slice(loaderStart, loaderEnd);
    expect(loader).toContain('deserializeJson(doc, file, DeserializationOption::Filter(filter))');
    expect(loader).toContain('filter["startAuthorization"]');
    expect(loader).toContain('filter["generatedValidation"]');
    expect(source).toContain('validateJobExecutionAuthorization(authorization, gcodePath, activeRunMode');
    expect(source).not.toContain('jobFileContainsText');
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

  it('guards preamble and stream acknowledgements without replaying uncertain motion', () => {
    expect(source).toContain('constexpr uint32_t kMarlinCommandAckTimeoutMs = 5000');
    expect(source).toContain('constexpr uint32_t kMarlinMotionDrainAckTimeoutMs = 180000');
    expect(source).toContain('constexpr uint32_t kMarlinHomingAckTimeoutMs = 180000');
    expect(source).toContain('constexpr uint32_t kMarlinToolChangeAckTimeoutMs = 180000');
    expect(source).toContain('responseContainsToken(receivedChunk, "busy:")');
    expect(source.match(/responseContainsToken\(receivedChunk, "busy:"\)/g)).toHaveLength(2);
    expect(source).toContain('Marlin acknowledgement timed out; command was not resent: ');
    expect(source).toContain('setJobCommunicationLost(');
    expect(source).toContain('jobStatus.errorCode = "COMMUNICATION_LOST"');
    expect(source).toContain('sendImmediateJobSafetyM5("communication lost; M410 not requested")');
    const runner = source.slice(source.indexOf('void processJobRunner()'), source.indexOf('String htmlPage'));
    expect(runner.match(/Serial\.print\(line\)/g)).toHaveLength(1);
  });

  it('uses command-specific soft and hard ACK deadlines', () => {
    expect(source).toContain('uint32_t marlinAckTimeoutForCommand(');
    expect(source).toContain('code == "M400"');
    expect(source).toContain('code == "G28" || code == "G29" || code.startsWith("G38.")');
    expect(source).toContain('bool marlinAckWatchdogExpired(');
    expect(source).toContain('timeoutMs * kMarlinAckHardLimitMultiplier');
    expect(source).toContain('uint32_t priorityAckTimeoutMs()');
    expect(source).toContain('priorityCommandAckTimeoutMs = marlinAckTimeoutForCommand(cmd, jobStatus.toolChangePending)');
    expect(source).toContain('jobCommandAckTimeoutMs = marlinAckTimeoutForCommand(line)');
    expect(source).toMatch(/marlinAckWatchdogExpired\(priorityCommandStartedAtMs, priorityCommandLivenessAtMs,[\s\S]*priorityAckTimeoutMs\(\)\)/);
  });

  it('reports the last confirmed stream boundary and freezes communication-loss evidence', () => {
    expect(source).toContain('lastAcknowledgedByteOffset');
    expect(source).toContain('lastAcknowledgedLineNumber');
    expect(source).toContain('\\"ackWatchdog\\"');
    expect(source).toContain('\\"communicationLoss\\"');
    expect(source).toContain('communication_lost command=');
    expect(source).toContain('jobStatus.communicationLostMachinePositionValid = true');
    expect(source).toContain('jobStatus.communicationLostWorkPositionValid = true');
    expect(source).toMatch(/progress = jobStatus\.fileSize > 0[\s\S]*jobStatus\.lastAcknowledgedByteOffset/);
  });

  it('fails unsupported Resend safely without replaying uncertain motion', () => {
    expect(source).toContain('jobStatus.errorCode = "RESEND_UNSUPPORTED"');
    expect(source).toContain('sendImmediateJobSafetyM5("Marlin requested unsupported Resend")');
    expect(source).toContain('line-numbered replay is not supported');
    expect(source).not.toContain('TODO: add line-numbered resend support');
  });

  it('keeps M5 on the priority path before the busy transport rejection', () => {
    const m5 = source.indexOf('upper == "M5")');
    const busy = source.indexOf('Marlin transport is busy with the active job');
    expect(m5).toBeGreaterThan(-1);
    expect(busy).toBeGreaterThan(m5);
  });

  it('drains buffered motion for Pause Safely but invalidates position after Stop Now', () => {
    const pause = source.slice(source.indexOf('void handleJobPause()'), source.indexOf('void handleJobResume()'));
    const stop = source.slice(source.indexOf('void handleJobStop()'), source.indexOf('void handleJogStatus()'));
    const finish = source.slice(source.indexOf('void finishPrioritySequence()'), source.indexOf('void processPriorityCommands()'));
    expect(pause).toContain('queuePriorityCommands("M5", "M400")');
    expect(pause).toContain('Buffered motion will finish');
    expect(stop).toContain('queuePriorityCommands("M5", "M410")');
    expect(stop).toContain('position will be invalidated');
    expect(finish).toMatch(/JobRunnerState::Stopping[\s\S]*machineFrame = MachineFrameState\(\)[\s\S]*marlinPosition = PositionTelemetry\(\)/);
    expect(source).toContain('\\"positionValid\\":');
    expect(source).toContain('M5 output-off requested. Motion is not stopped');
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

  it('restores saved zeros through an explicit Safe-Z-first machine-coordinate endpoint', () => {
    expect(source).toContain('server.on("/api/work-zero/restore", HTTP_POST, handleRestoreWorkZero)');
    const restore = source.slice(source.indexOf('void handleRestoreWorkZero()'), source.indexOf('void handleUpdatePage()'));
    expect(restore).toMatch(/M5[\s\S]*G53 G0 Z[\s\S]*M400[\s\S]*G53 G0 X[\s\S]*M400[\s\S]*moveToZ[\s\S]*G53 G0 Z[\s\S]*G54[\s\S]*zeroCommand[\s\S]*M114/);
    expect(restore).toContain('zeroCommand += " Z0"');
    expect(restore).not.toContain('G28');
  });

  it('owns guarded Production Resume Phase 2 in the firmware runner', () => {
    expect(source).toContain('server.on("/api/recovery/production/start", HTTP_POST, handleProductionResumeStart)');
    expect(source).toContain('validateProductionResumeFile(path, commandCount, validationError)');
    expect(source).toContain('loadProductionResumeIdentity(jobPath, eventId, identity, identityError)');
    expect(source).toContain('validateProductionResumeIdentity(identity, path, activeRunPath, activeRunMode');
    expect(source).toContain('identity.streamFingerprint != streamFingerprint');
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
    expect(source).toContain('xQueueSend(telemetryQueue, &packet, 0)');
    expect(source).toContain('xTaskCreatePinnedToCore(telemetryNetworkTask');
    expect(source).toContain('telemetryJobDirty = !enqueueTelemetry(TelemetryChannel::Job, jobStatusJson())');
    expect(source).toContain('telemetryJogDirty = !enqueueTelemetry(TelemetryChannel::Jog, jogStatusJson())');
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
    expect(source).toContain('enqueueTelemetry(TelemetryChannel::Position, machineFrameJson())');
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
    expect(source).toContain('enqueueTelemetry(TelemetryChannel::Motion, data)');
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
