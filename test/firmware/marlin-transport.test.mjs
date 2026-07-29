import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');
const commHeader = await readFile(new URL('../../src/controller_comm.h', import.meta.url), 'utf8');
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
    expect(source).toMatch(/received && marlinResponseIsTerminal\((?:result\.)?response\)/);
    expect(source).toContain('executeSynchronousCommand');
  });

  it('centralizes all production UART writes into writeControllerLine and removes legacy overloads', () => {
    const printMatches = source.match(/Serial\.print\s*\(/g) || [];
    expect(printMatches).toHaveLength(2); // Serial.print(command) and Serial.print('\n') inside writeControllerLine
    expect(source).not.toContain('readMarlinResponseFor(uint32_t timeoutMs, bool priority)');
    expect(source + commHeader).toContain('enum class ControllerCommandClass');
    expect(source).toContain('OrdinarySync');
    expect(source).toContain('ManagedJobStream');
    expect(source).toContain('ManagedJogStream');
    expect(source).toContain('SafetyStop');
    expect(source).toContain('RecoveryProbe');
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
    expect(runner.match(/writeControllerLine\(line, ControllerCommandClass::ManagedJobStream/g)).toHaveLength(1);
  });

  it('uses command-specific soft and hard ACK deadlines', () => {
    expect(source).toContain('uint32_t marlinAckTimeoutForCommand(');
    expect(source).toContain('code == "M400"');
    expect(source).toContain('code == "G28" || code == "G29" || code.startsWith("G38.")');
    expect(source).toContain('bool marlinAckWatchdogExpired(');
    expect(source).toContain('livenessAtMs > 0 && now - livenessAtMs > inactivityTimeoutMs');
    expect(source).toContain('now - startedAtMs > hardTimeoutMs');
    expect(source).toContain('uint32_t priorityAckTimeoutMs()');
    expect(source).toContain('priorityCommandAckTimeoutMs = marlinAckTimeoutForCommand(cmd, jobStatus.toolChangePending)');
    expect(source).toContain('jobCommandAckTimeoutMs = marlinAckTimeoutForCommand(line)');
    expect(source).toMatch(/marlinAckWatchdogExpired\(priorityCommandStartedAtMs, priorityCommandLivenessAtMs,[\s\S]*priorityAckTimeoutMs\(\), priorityCommandHardTimeoutMs\)/);
  });

  it('derives motion ACK deadlines from commanded path duration', () => {
    expect(source).toContain('struct MotionTimingState');
    expect(source).toContain('MotionTimingEstimate estimateAndApplyMotionTiming');
    expect(source).toContain('estimatedArcDistance(');
    expect(source).toContain('motionTimingState.feedMmMin * overrideScale');
    expect(source).toContain('estimate.distanceMm) * 60000.0');
    expect(source).toContain('kMotionAckDurationMultiplier = 3.0f');
    expect(source).toContain('kMotionAckOverheadMs = 5000');
    expect(source).toContain('kMarlinUnknownMotionHardAckTimeoutMs = 180000');
    expect(source).toContain('kMarlinMaxMotionHardAckTimeoutMs = 30 * 60 * 1000');
    expect(source).toMatch(/marlinHardAckTimeoutForCommand\([\s\S]*line, timing, false, jobCommandPlannerWaitMs\)/);
    expect(source).toMatch(/marlinHardAckTimeoutForCommand\([\s\S]*cmd, timing, jobStatus\.toolChangePending, priorityCommandPlannerWaitMs\)/);
    expect(source).toContain('estimatedCommandDurationMs');

    const start = { x: 257.913, y: 201.233 };
    const end = { x: 248.087, y: 304.767 };
    const center = { x: start.x - 4.913, y: start.y + 51.767 };
    const radius = Math.hypot(start.x - center.x, start.y - center.y);
    const arcDurationMs = (Math.PI * radius * 60000) / 1500;
    const hardTimeoutMs = Math.max(10000, arcDurationMs * 3 + 5000);
    expect(arcDurationMs).toBeGreaterThan(6000);
    expect(hardTimeoutMs).toBeGreaterThan(24000);
  });

  it('carries planner wait from the acknowledged motion into the next ACK deadline', () => {
    expect(source).toContain('marlinPlannerWaitAllowanceMs');
    expect(source).toContain('noteAcknowledgedPlannerTiming');
    expect(source).toMatch(/plannerWaitAllowanceMs[\s\S]*estimate\.durationMs[\s\S]*kMotionAckOverheadMs/);
    expect(source).toContain('plannerWaitAllowanceMs');
    expect(source).toContain('plannerWaitMs=');
    expect(source).toMatch(/commandHasToken\(upper, "M400"\)[\s\S]*marlinPlannerWaitAllowanceMs = 0/);
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

  it('rejects standalone M5 through the normal active-job transport gate', () => {
    const command = source.slice(source.indexOf('void handleCommand()'), source.indexOf('void handleJobStart()'));
    expect(command).not.toContain('queuePriorityCommands("M5")');
    expect(command).toMatch(/upper == "M5" && jobStatus\.state == JobRunnerState::RecoveryRequired/);
    expect(command).toContain('Marlin transport is busy with the active job');
  });

  it('holds an intact pause without M5, quickstop, or repositioning', () => {
    const pause = source.slice(source.indexOf('void handleJobPause()'), source.indexOf('void handleJobResume()'));
    const resume = source.slice(source.indexOf('void handleJobResume()'), source.indexOf('void handleToolChangeComplete()'));
    const stop = source.slice(source.indexOf('void handleJobStop()'), source.indexOf('void handleJogStatus()'));
    const finish = source.slice(source.indexOf('void finishPrioritySequence()'), source.indexOf('void processPriorityCommands()'));
    expect(pause).toContain('machineProfile.capRealtimeReporting');
    expect(pause).toContain('writeControllerLine("P000", ControllerCommandClass::ManagedJobStream');
    expect(pause).toContain('JobRunnerState::PausedIntact');
    expect(pause).not.toMatch(/\bM5\b|\bM410\b|G0 |G1 /);
    expect(resume).toContain('JobRunnerState::PausedIntact');
    expect(resume).not.toMatch(/\bM5\b|\bM410\b|G0 |G1 /);
    expect(resume).toContain('const bool realtimeHold = jobStatus.pauseRealtimeHold');
    expect(resume).toMatch(/if \(!realtimeHold && !openJobFileAtOffset\(\)\)/);
    expect(resume).toMatch(/if \(realtimeHold\)[\s\S]*writeControllerLine\("R000", ControllerCommandClass::ManagedJobStream[\s\S]*else[\s\S]*jobWaitingForOk = false/);
    expect(source).toMatch(/JobRunnerState::Resuming[\s\S]*writeControllerLine\("R000", ControllerCommandClass::ManagedJobStream/);
    expect(source).toMatch(/capRealtimeReporting\s*=\s*[\s\S]*capEmergencyParser[\s\S]*REALTIME_REPORTING/);
    expect(stop).toContain('startImmediateStopPrioritySequence()');
    expect(stop).toContain('invalidateMachineFrameAfterQuickstop()');
    expect(source).toMatch(/void startImmediateStopPrioritySequence\(\)[\s\S]*queuePriorityCommands\("M410", "M5"\);[\s\S]*drainMarlinInput\(\);[\s\S]*startNextPriorityCommand\(\);/);
    expect(source).toMatch(/void invalidateMachineFrameAfterQuickstop\(\)[\s\S]*machineFrame = MachineFrameState\(\)[\s\S]*marlinPosition = PositionTelemetry\(\)/);
    expect(finish).toMatch(/JobRunnerState::Stopping[\s\S]*JobRunnerState::RecoveryRequired[\s\S]*JobRunnerState::Stopped/);
    expect(source).toContain('\\"positionValid\\":');
  });

  it('persists intact-pause evidence before manual movement loses frame trust', () => {
    const invalidate = source.slice(
      source.indexOf('bool beginPausedManualInterruption()'),
      source.indexOf('void handlePausedManualInterruption()'),
    );
    expect(invalidate).toContain('jobStatus.directResumeValid = false');
    expect(invalidate).toContain('jobStatus.state = JobRunnerState::Stopping');
    expect(invalidate.indexOf('startImmediateStopPrioritySequence()')).toBeLessThan(
      invalidate.indexOf('writePersistentJobCheckpoint(false, true'),
    );
    expect(invalidate.indexOf('writePersistentJobCheckpoint(false, true')).toBeLessThan(
      invalidate.indexOf('invalidateMachineFrameAfterQuickstop()'),
    );
    expect(invalidate).toMatch(/writePersistentJobCheckpoint\(false, true[\s\S]*jobCheckpointTracking = false/);
    expect(source).toContain('"stopping_pending_m5"');
    const finish = source.slice(source.indexOf('void finishPrioritySequence()'), source.indexOf('void processPriorityCommands()'));
    expect(finish).toMatch(/pauseInterruptedForManualMotion[\s\S]*setPersistentActiveJobMarker\(false\)/);
  });

  it('lets Stop preempt streamed ACK waits and queued M220 without rewriting motion', () => {
    const stop = source.slice(source.indexOf('void handleJobStop()'), source.indexOf('void handleJogStatus()'));
    const immediate = source.slice(source.indexOf('void startImmediateStopPrioritySequence()'), source.indexOf('uint32_t priorityAckTimeoutMs()'));
    expect(stop.indexOf('jobWaitingForOk = false')).toBeLessThan(stop.indexOf('startImmediateStopPrioritySequence()'));
    expect(stop.indexOf('jobFile.close()')).toBeLessThan(stop.indexOf('startImmediateStopPrioritySequence()'));
    expect(immediate).toContain('queuePriorityCommands("M410", "M5")');
    expect(immediate).toContain('startNextPriorityCommand()');
    expect(source).toContain('clearPriorityCommands();');
    expect(source).not.toContain('segmentLongMovement');
    expect(source).not.toContain('rewriteSourceGcode');
  });

  it('returns Stop acceptance after immediate M410 transmission and publishes capability warnings', () => {
    const stop = source.slice(source.indexOf('void handleJobStop()'), source.indexOf('void handleJogStatus()'));
    expect(stop.indexOf('startImmediateStopPrioritySequence()')).toBeLessThan(stop.lastIndexOf('server.send(200'));
    expect(stop).toContain('stopEmergencyParserDetected = machineProfile.capEmergencyParser');
    expect(stop).toContain('immediate interruption cannot be guaranteed');
    expect(source).toContain('\\"stopEmergencyParserDetected\\":');
    expect(source).toContain('\\"stopWarning\\":');
    expect(source).toContain('Marlin EMERGENCY_PARSER detected=');
  });

  it('owns validated Aircut and Toolless streams in firmware', () => {
    expect(source).toContain('operatorRoute("/api/test-motion/start", HTTP_POST, handleTestMotionStart)');
    expect(source).toContain('validateTestMotionFile(path, mode, safeZ');
    expect(source).toContain('firstCommand != "M5"');
    expect(source).toContain('lastCommand != "M400"');
    expect(source).toContain('test motion contains forbidden or unsupported command');
    expect(source).toContain('aircut Z command differs from configured Safe Z');
    expect(source).toMatch(/jobStatus\.streamMode != "job"[\s\S]*validateTestMotionCommand/);
  });

  it('restores saved zeros through an explicit Safe-Z-first machine-coordinate endpoint', () => {
    expect(source).toContain('operatorRoute("/api/work-zero/restore", HTTP_POST, handleRestoreWorkZero)');
    const restore = source.slice(source.indexOf('void handleRestoreWorkZero()'), source.indexOf('void handleUpdatePage()'));
    expect(restore).toMatch(/M5[\s\S]*G53 G0 Z[\s\S]*M400[\s\S]*G53 G0 X[\s\S]*M400[\s\S]*moveToZ[\s\S]*G53 G0 Z[\s\S]*G54[\s\S]*zeroCommand[\s\S]*M114/);
    expect(restore).toContain('zeroCommand += " Z0"');
    expect(restore).not.toContain('G28');
  });

  it('owns guarded Production Resume Phase 2 in the firmware runner', () => {
    expect(source).toContain('operatorRoute("/api/recovery/production/start", HTTP_POST, handleProductionResumeStart)');
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
    expect(source).toContain('xTaskCreatePinnedToCore(telemetryNetworkTask');
    expect(source).toContain('xSemaphoreTake(telemetryStateMutex');
    expect(source).toContain('xQueueSend(motionEventQueue');
    expect(source).toContain('xQueueSend(logEventQueue');
    expect(source).toContain('constexpr uint32_t kTelemetryMinBroadcastMs = 100');
    expect(source).not.toContain('enqueueTelemetry');
  });

  it('marks job changes for a later non-blocking broadcast', () => {
    expect(source).toContain('void stageTelemetryUpdates()');
    expect(source).toMatch(/void loop\(\)[\s\S]*server\.handleClient\(\);[\s\S]*stageTelemetryUpdates\(\);/);
  });

  it('broadcasts position only when an M114 response changes XYZ', () => {
    expect(source).toContain('void updatePositionFromMarlinResponse(const String &response)');
    expect(source).toMatch(/addMarlinLog\("rx", [^)]+\);[\s\S]*updatePositionFromMarlinResponse\(/);
    expect(source).toContain('fabs(marlinPosition.x - x) > 0.0005f');
    expect(source).toContain('touchPositionStatus()');
  });

  it('streams only new log entries to clients that requested logs', () => {
    expect(source).toContain('uint32_t nextMarlinLogId = 1');
    expect(source).toContain('telemetryLogSubscribed[WEBSOCKETS_SERVER_CLIENT_MAX]');
    expect(source).toContain('xQueueSend(logEventQueue, &ev, 0)');
    expect(source).toContain('server.arg("after").toInt()');
    expect(source).toContain('\\\"nextId\\\"');
  });

  it('batches compact motion events and throttles full job progress telemetry', () => {
    expect(source).toContain('constexpr uint32_t kJobProgressBroadcastMs = 500');
    expect(source).toContain('void queueMotionTelemetry(const String &command, uint32_t sequence)');
    expect(source).toContain('xQueueSend(motionEventQueue, &ev, 0)');
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
