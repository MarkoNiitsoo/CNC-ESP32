import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const firmware = readFileSync(new URL('../../src/main.cpp', import.meta.url), 'utf8');

function blockBetween(startMarker, endMarker) {
  const start = firmware.indexOf(startMarker);
  expect(start, `missing ${startMarker}`).toBeGreaterThan(-1);
  const end = firmware.indexOf(endMarker, start);
  expect(end, `missing ${endMarker}`).toBeGreaterThan(-1);
  return firmware.slice(start, end);
}

describe('cooperative machine-operation engine (Phase 3C)', () => {
  it('advances the operation from loop() instead of blocking the WS command queue', () => {
    const loop = blockBetween('void loop() {', '}').slice(0, 400);
    expect(loop).toContain('processWsCommandQueue();');
    expect(loop.indexOf('processMachineOperation();')).toBeGreaterThan(loop.indexOf('processWsCommandQueue();'));
    expect(loop.indexOf('processMachineOperation();')).toBeLessThan(loop.indexOf('processJobRunner();'));

    const dispatch = blockBetween('void processWsCommandQueue()', 'bool telemetryHasLogSubscriber()');
    for (const action of ['machine.home', 'machine.setWorkZero', 'machine.setZZero']) {
      expect(dispatch).toContain(`strcmp(entry.action, "${action}") == 0`);
      expect(dispatch).toContain('admitMachineOperation(');
    }
    // Accepted machine operations defer their terminal result: the common
    // finishWsCommand tail must be skipped when admission succeeded.
    expect(dispatch).toContain('bool completionDeferred = false;');
    expect(dispatch).toContain('if (completionDeferred) return;');
  });

  it('builds the exact Marlin sequences the synchronous handlers used', () => {
    const admit = blockBetween('MachineOperationResult admitMachineOperation(', 'MachineOperationResult runMachineOperationToCompletion(');
    // Home: axis-specific G28, drain, baseline frame for Home All, evidence capture.
    expect(admit).toContain('command += " X Y";');
    expect(admit).toContain('appendMachineOpStep("M400", 120000, "Marlin homing failed: ")');
    expect(admit).toContain('appendMachineOpStep("G54", 3000');
    expect(admit).toContain('appendMachineOpStep("G92 X0 Y0 Z0", 3000');
    expect(admit).toContain('appendMachineOpStep("M114", 3000, "Homing completed but the baseline work frame failed: "');
    expect(admit).toContain('appendMachineOpStep("M503", 10000');
    // Work Zero / Z Zero: drain before capture, exact G92, M114 after.
    expect(admit).toContain('appendMachineOpStep("M400", 120000, "Marlin work-zero capture failed: ")');
    expect(admit).toContain('appendMachineOpStep(zeroCommand.c_str(), 3000');
    expect(admit).toContain('appendMachineOpStep("G92 Z0", 3000');
  });

  it('preserves Home All frame semantics in the finalize step', () => {
    const finalize = blockBetween('MachineOperationResult finalizeMachineOperation()', '// One cooperative tick:');
    expect(finalize).toContain('parseM114Counts(machineOp.countsResponse');
    expect(finalize).toContain('parseM92Steps(machineOp.stepsResponse');
    expect(finalize).toContain('machineFrame.absoluteFromHome = true;');
    expect(finalize).toContain('machineFrame.manualWorkFrameValid = false;');
    expect(finalize).toContain('++machineFrame.homingEpoch;');
    expect(finalize).toContain('snprintf(session, sizeof(session), "%08lX-%lu"');
    // Partial Home keeps its trust-invalidating behavior.
    expect(finalize).toContain('machineFrame.workZeroValid = false;');
    expect(finalize).toContain('machineFrame.homingSessionId = "";');
    // Baseline/evidence failures invalidate the frame like the synchronous path.
    expect(finalize).toContain('machineFrame.machineValid = false;');
  });

  it('preserves Work Zero / Z Zero finalize semantics', () => {
    const finalize = blockBetween('MachineOperationResult finalizeMachineOperation()', '// One cooperative tick:');
    expect(finalize).toContain('machineOp.homedFrame');
    expect(finalize).toContain('machineOp.targetMachineX');
    expect(finalize).toContain('machineFrame.workZeroValid = true;');
    expect(finalize).toContain('marlinPosition.z = 0;');
    expect(finalize).toContain('jobStatus.toolChangeZZeroCompleted = true;');
    expect(finalize).toContain('persistToolChangeTransition()');
    expect(finalize).toContain('PERSISTENCE_ERROR');
  });

  it('classifies one step per tick with per-step timeouts and terminal detection', () => {
    const pump = blockBetween('// One cooperative tick:', 'MachineOperationResult admitMachineOperation(');
    expect(pump).toContain('while (Serial.available() > 0)');
    expect(pump).toContain('marlinResponseIsTerminal(machineOp.responseBuffer)');
    expect(pump).toContain('millis() - machineOp.stepStartedAtMs >= step.timeoutMs');
    expect(pump).toContain('MachineOpCompletion::ControllerError');
    expect(pump).toContain('MachineOpCompletion::Timeout');
    // A failed baseline step invalidates the frame conservatively.
    expect(pump).toContain('MachineOpInvalidation::BaselineFrame');
  });

  it('binds the operation to its WS command and publishes exactly one terminal result', () => {
    const complete = blockBetween(
      'bool publishResult) {',
      'void cancelMachineOperation(const char *code');
    expect(complete).toContain('if (!machineOp.active) return;');
    expect(complete).toContain('finishWsCommand(machineOp.commandId, machineOp.epoch');
    expect(complete).toContain('queueWsCommandResult(machineOp.clientId, machineOp.connectionGeneration');
    const admit = blockBetween('MachineOperationResult admitMachineOperation(', 'MachineOperationResult runMachineOperationToCompletion(');
    expect(admit).toContain('machineOp.fromWebSocket = true;');
    expect(admit).toContain('strncpy(machineOp.commandId, entry->commandId');
    // Single active operation.
    expect(admit).toContain('if (machineOp.active)');
    expect(admit).toContain('"another machine operation is already in progress"');
  });

  it('keeps the legacy HTTP routes synchronous over the same engine', () => {
    const home = blockBetween('MachineOperationResult performMachineHome(', 'void handleSetWorkZero()');
    expect(home).toContain('runMachineOperationToCompletion(MachineOpKind::Home, axes)');
    const wz = blockBetween('MachineOperationResult performSetWorkZero(', 'void handleSetZZero()');
    expect(wz).toContain('runMachineOperationToCompletion(MachineOpKind::SetWorkZero, axesParam)');
    expect(wz).toContain('machineOpLastAxes');
    const zz = blockBetween('MachineOperationResult performSetZZero(', 'void handleTouchPlateZZero()');
    expect(zz).toContain('runMachineOperationToCompletion(MachineOpKind::SetZZero, "")');
  });

  it('gates concurrent machine activity on the active operation', () => {
    const busy = blockBetween('bool machineFrameControlBusy()', 'bool runFrameCommand(');
    expect(busy).toContain('machineOperationActive()');
    // Job Start admission moved into the shared core (Phase 3D); the gate
    // against active machine operations moved with it.
    const jobStart = blockBetween(
      'MachineOperationResult admitJobStart(const String &body, const WsCommandEntry *entry) {',
      'void handleJobStart() {');
    expect(jobStart).toContain('machineOperationActive()');
    const toolChange = blockBetween('void handleToolChangeComplete()', 'bool beginPausedManualInterruption()');
    expect(toolChange).toContain('machineOperationActive()');
  });

  it('preempts an active machine operation with the Stop quickstop sequence from any job state', () => {
    const stop = blockBetween('MachineOperationResult performJobStop() {', 'void handleJobStop() {');
    const preempt = stop.slice(0, stop.indexOf('if (jobStatus.state == JobRunnerState::Stopping)'));
    expect(preempt.indexOf('if (machineOperationActive())')).toBeGreaterThan(-1);
    expect(preempt.indexOf('cancelMachineOperation("ABORTED_BY_STOP"'))
      .toBeGreaterThan(preempt.indexOf('if (machineOperationActive())'));
    // The quickstop is sent for an idle-machine operation too — cancelling the
    // engine alone would leave Marlin executing the already-sent G28.
    expect(preempt.indexOf('startImmediateStopPrioritySequence();'))
      .toBeGreaterThan(preempt.indexOf('cancelMachineOperation('));
    expect(preempt).toContain('invalidateMachineFrameAfterQuickstop();');
    expect(preempt).toContain('jobStatus.state = JobRunnerState::Stopping;');
  });

  it('refreshes the operator lease on authenticated WS activity only', () => {
    const matcher = blockBetween('bool wsCommandAuthorizationMatchesLocked(', 'int findWsCommandLedgerEntryLocked(');
    expect(matcher).toContain('epoch == operatorControlSessionEpoch');
    expect(matcher).toContain('millis() - operatorSessionLastSeenMs <= kOperatorLeaseMs');
    // The refresh happens only after the epoch+token+lease all validated.
    expect(matcher.indexOf('if (matches) operatorSessionLastSeenMs = millis();'))
      .toBeGreaterThan(matcher.indexOf('const bool matches ='));
  });

  it('blocks OTA unlock while a machine operation owns the transport', () => {
    const ota = blockBetween('void handleOperatorOtaUnlock()', 'void operatorRoute(');
    expect(ota).toContain('machineOperationActive()');
  });

  it('publishes exactly one terminal result even when the first-step write fails at admission', () => {
    // The admission-time UART write failure completes the engine WITHOUT
    // publishing (publishResult=false); the WS dispatch tail then publishes
    // the single failure result through the normal path.
    const start = blockBetween('void startMachineOperationStep()', 'void completeMachineOperation(const MachineOperationResult');
    expect(start).toContain('completeMachineOperation(machineOpResult, MachineOpCompletion::PreWriteFailure, false)');
    const complete = blockBetween(
      'bool publishResult) {',
      'void cancelMachineOperation(const char *code');
    expect(complete).toContain('if (publishResult && machineOp.fromWebSocket)');
    const admit = blockBetween('MachineOperationResult admitMachineOperation(', 'MachineOperationResult runMachineOperationToCompletion(');
    expect(admit).toContain('return machineOpResult;');
  });

  it('holds controller-communication ownership for the whole transaction', () => {
    const admit = blockBetween('MachineOperationResult admitMachineOperation(', 'MachineOperationResult runMachineOperationToCompletion(');
    expect(admit).toContain('reserveTransaction(ControllerCommandClass::OrdinarySync');
    const complete = blockBetween(
      'bool publishResult) {',
      'void cancelMachineOperation(const char *code');
    expect(complete).toContain('controllerCommManager.onTerminalResponse');
    expect(complete).toContain('controllerCommManager.onTimeout');
    expect(complete).toContain('controllerCommManager.onPreWriteFailure');
  });

  it('excludes the machine operation from the idle autoreport reader so its terminal "ok" cannot be stolen', () => {
    const read = blockBetween('void processIdleMarlinAutoreport()', 'bool captureJogOriginalZ()');
    expect(read).toContain('machineOperationActive()) return;');
    // The write twin must also yield to the operation (never send an M154 autoreport
    // write while the operation owns the transaction).
    const write = blockBetween('void processMarlinAutoreportControl()', 'void processIdleMarlinAutoreport()');
    expect(write).toContain('machineOperationActive()) return;');
  });

  it('drains the UART FIFO before writing each step so stale bytes cannot desync step responses', () => {
    const start = blockBetween('void startMachineOperationStep()', 'void completeMachineOperation(const MachineOperationResult');
    expect(start.indexOf('drainMarlinInput();')).toBeGreaterThan(-1);
    expect(start.indexOf('drainMarlinInput();')).toBeLessThan(start.indexOf('writeControllerLine(step.command'));
  });

  it('emits bounded machine-operation diagnostics for each phase transition', () => {
    const start = blockBetween('void startMachineOperationStep()', 'void completeMachineOperation(const MachineOperationResult');
    expect(start).toContain('machineOpStepLogPrefix() + " tx=\\"');
    const pump = blockBetween('// One cooperative tick:', 'MachineOperationResult admitMachineOperation(');
    expect(pump).toContain('rx-terminal=\\"');
    expect(pump).toContain('error=\\"');
    expect(pump).toContain('timeout"');
    const complete = blockBetween(
      'bool publishResult) {',
      'void cancelMachineOperation(const char *code');
    expect(complete).toContain('"cancel" : "complete"');
    expect(complete).toContain('machineOpKindName(machineOp.kind)');
    expect(firmware).toContain('String boundedMachineOpResponse(const String &response)');
    expect(firmware).toContain('String machineOperationStateJson()');
  });

  it('publishes canonical machine-operation state including active, kind, and progress', () => {
    const state = blockBetween('String machineOperationStateJson()', 'String machineOpStepLogPrefix()');
    expect(state).toContain('\\"active\\":false');
    expect(state).toContain('\\"active\\":true');
    expect(state).toContain('\\"kind\\":');
    expect(state).toContain('\\"phase\\":');
    expect(state).toContain('\\"stepIndex\\":');
    expect(state).toContain('\\"stepCount\\":');
    // The machine slice must carry it.
    const machine = blockBetween('String buildMachineSliceJson()', 'String buildControlSliceJson()');
    expect(machine).toContain('machineOperationStateJson()');
  });

  it('latches WebSocket connect/disconnect edges for the main loop to log off the network task', () => {
    expect(firmware).toContain('volatile bool wsConnectLogPending');
    expect(firmware).toContain('volatile bool wsDisconnectLogPending');
    expect(firmware).toContain('volatile bool wsHandshakeLogPending');
    expect(firmware).toContain('void flushWsConnectionLog()');
    expect(firmware).toContain('"ws client connected"');
    expect(firmware).toContain('"ws handshake synchronized"');
    // Disconnects carry client ip + connection lifetime + free heap so a
    // bouncing telemetry transport is diagnosable from the SD log.
    expect(firmware).toContain('"ws client disconnected ip=%s lifetimeMs=%lu heap=%lu"');
    const loop = blockBetween('void loop() {', '}').slice(0, 500);
    expect(loop).toContain('flushWsConnectionLog();');
    // The SD write stays in loop(); the network task only latches the flag.
    expect(blockBetween('void handleTelemetrySocket(', 'void processNetworkTelemetry()')).toContain('wsConnectLogPending = true;');
  });

  it('self-heals an unresponsive controller with scheduled recovery probes', () => {
    // The M410 deadman in boot 48CCDF85 left the session blocked until reboot;
    // the scheduler re-probes Marlin so recovery no longer needs a Retry press.
    const scheduler = blockBetween('void processControllerAutoRecovery()', 'void startHttpServer()');
    expect(scheduler).toContain('controllerCommStatus.state != ControllerCommunicationState::Unresponsive');
    expect(scheduler).toContain('attemptControllerRecoverySequence();');
    // Safety-relevant flows (stop, job, jog, machine operation) delay probing.
    expect(scheduler).toContain('jobIsActive() || jogIsActive() || machineOperationActive()');
    expect(scheduler).toContain('priorityCommandCount > 0');
    const loop = blockBetween('void loop() {', '}').slice(0, 500);
    expect(loop).toContain('processControllerAutoRecovery();');
    // The manual route and the scheduler share one probe sequence.
    const handler = blockBetween('void handleControllerRecover()', 'constexpr uint32_t kControllerAutoRecoveryFirstProbeDelayMs');
    expect(handler).toContain('attemptControllerRecoverySequence()');
    expect(firmware).toContain('bool attemptControllerRecoverySequence() {');
  });

  it('records how stale the jog heartbeat was at the deadman stop', () => {
    const deadman = blockBetween('jog stop: heartbeat timeout', 'stopJogInternal(true);');
    expect(deadman).toContain('lastUpdateAgeMs=');
    expect(deadman).toContain('sinceStartMs=');
    expect(deadman).toContain('"never"');
  });
});
