import io

path = 'src/main.cpp'
src = io.open(path, encoding='utf-8').read()
orig = src


def rep(old, new, count=1):
    global src
    assert src.count(old) == count, 'anchor: %r' % old[:70]
    src = src.replace(old, new)


# 1) Operator Stop latch: firmware-owned state machine.
rep('''bool controllerKilledByEmergencyStop = false;''',
    '''bool controllerKilledByEmergencyStop = false;

// ── Operator Stop latch (firmware-owned operator safety state) ──────────────
// Stop is a latched operator state, not just a transient command. While
// latched, no motion-producing operation is admitted by any path (WS, HTTP,
// /api/cmd, recovery). The latch survives browser reloads, WS reconnects,
// and other browsers connecting: it lives here, in firmware RAM.
//
// Stopped:          normal Stop. Released only by the explicit
//                   POST /api/stop-latch/release (Return to controls).
// EmergencyStopped: M112 was sent during Home All. No release; controller
//                   restart (operator-approved recovery) -> HomeRequired.
// HomeRequired:     controller restarted, frame UNTRUSTED. Only Home All is
//                   admitted; a successful Home All clears the latch.
enum class OperatorStopLatch : uint8_t { None, Stopped, EmergencyStopped, HomeRequired };
OperatorStopLatch operatorStopLatch = OperatorStopLatch::None;

const char *operatorStopLatchName() {
  switch (operatorStopLatch) {
    case OperatorStopLatch::Stopped: return "stopped";
    case OperatorStopLatch::EmergencyStopped: return "emergency_stopped";
    case OperatorStopLatch::HomeRequired: return "home_required";
    default: return "none";
  }
}

bool operatorStopLatchBlocksMotion() {
  return operatorStopLatch != OperatorStopLatch::None;
}''')

# 2) Expose in the machine frame JSON (the UI's frame slice already flows).
rep('''  json += ",\\"stopLatch\\":\\"";
  json += operatorStopLatchName();
  json += "\\"";
''' if False else '''  json += ",\\"absoluteFromHome\\":" + String(machineFrame.absoluteFromHome ? "true" : "false");''',
    '''  json += ",\\"absoluteFromHome\\":" + String(machineFrame.absoluteFromHome ? "true" : "false");
  json += ",\\"stopLatch\\":\\"" + String(operatorStopLatchName()) + "\\"";''')

# 3) Set the latch in performJobStop's stop-initiation points.
rep('''    const bool homeOperationInterrupted = homeOperationInFlight();
    cancelMachineOperation("ABORTED_BY_STOP", "Machine operation cancelled by Stop");''',
    '''    const bool homeOperationInterrupted = homeOperationInFlight();
    operatorStopLatch = homeOperationInterrupted ? OperatorStopLatch::EmergencyStopped
                                                : OperatorStopLatch::Stopped;
    cancelMachineOperation("ABORTED_BY_STOP", "Machine operation cancelled by Stop");''')

rep('''  if (jogIsActive()) {
    // Stop also halts an active machine jog. The M410/M5 quickstop issued by
    // stopJogInternal(true) matches the existing /api/jog/stop emergency path,
    // so the software Stop covers jog motion instead of leaving an enabled
    // button whose firmware action targets only job/operation motion.
    stopJogInternal(true);
    logJobEvent("stop cancelled an active jog with M410 quickstop");''',
    '''  if (jogIsActive()) {
    operatorStopLatch = OperatorStopLatch::Stopped;
    // Stop also halts an active machine jog. The M410/M5 quickstop issued by
    // stopJogInternal(true) matches the existing /api/jog/stop emergency path,
    // so the software Stop covers jog motion instead of leaving an enabled
    // button whose firmware action targets only job/operation motion.
    stopJogInternal(true);
    logJobEvent("stop cancelled an active jog with M410 quickstop");''')

rep('''  if (jobFile) jobFile.close();
  jobWaitingForOk = false;
  jobResponseBuffer = "";
  resetJobSubstates(JobSubstateResetScope::StopInitiated);
  jobStatus.pauseInterruptedForManualMotion = false;
  jobStatus.state = JobRunnerState::Stopping;
  jobStatus.stopEmergencyParserDetected = machineProfile.capEmergencyParser;
  jobStatus.stopWarning = communicationLostStop''',
    '''  if (jobFile) jobFile.close();
  jobWaitingForOk = false;
  jobResponseBuffer = "";
  operatorStopLatch = OperatorStopLatch::Stopped;
  resetJobSubstates(JobSubstateResetScope::StopInitiated);
  jobStatus.pauseInterruptedForManualMotion = false;
  jobStatus.state = JobRunnerState::Stopping;
  jobStatus.stopEmergencyParserDetected = machineProfile.capEmergencyParser;
  jobStatus.stopWarning = communicationLostStop''')

# 4) Admission gate in admitMotionStream.
rep('''MotionAdmissionResult admitMotionStream(MotionStreamKind kind) {
  // Deliberate domain exception: a jog start during an intact pause is not
  // admitted as motion - the caller converts the pause into a RecoveryRequired
  // interruption.
  if (kind == MotionStreamKind::Jog && jobStatus.state == JobRunnerState::PausedIntact &&
      jobStatus.directResumeValid) {
    return {true, 200, "OK", String()};
  }''',
    '''MotionAdmissionResult admitMotionStream(MotionStreamKind kind) {
  if (operatorStopLatchBlocksMotion()) {
    return {false, 409, "STOP_LATCHED",
            operatorStopLatch == OperatorStopLatch::EmergencyStopped
                ? "EMERGENCY STOPPED. Restart the controller and Home All."
                : "Stop is latched. Return to controls to continue."};
  }
  // Deliberate domain exception: a jog start during an intact pause is not
  // admitted as motion - the caller converts the pause into a RecoveryRequired
  // interruption.
  if (kind == MotionStreamKind::Jog && jobStatus.state == JobRunnerState::PausedIntact &&
      jobStatus.directResumeValid) {
    return {true, 200, "OK", String()};
  }''')

# 5) Admission gate in admitMachineOperation (Home allowed while HomeRequired).
rep('''MachineOperationResult admitMachineOperation(MachineOpKind kind, const String &axesParam,
                                             const WsCommandEntry *entry) {
  String commError;
  if (!ensureControllerCommunicationActive(commError)) {
    return {false, false, true, 503, "COMM_ERROR", commError};
  }''',
    '''MachineOperationResult admitMachineOperation(MachineOpKind kind, const String &axesParam,
                                             const WsCommandEntry *entry) {
  if (operatorStopLatch == OperatorStopLatch::EmergencyStopped ||
      operatorStopLatch == OperatorStopLatch::Stopped) {
    return {false, false, true, 409, "STOP_LATCHED",
            operatorStopLatch == OperatorStopLatch::EmergencyStopped
                ? "EMERGENCY STOPPED. Restart the controller and Home All."
                : "Stop is latched. Return to controls to continue."};
  }
  if (operatorStopLatch == OperatorStopLatch::HomeRequired && kind != MachineOpKind::Home) {
    return {false, false, true, 409, "HOME_REQUIRED",
            "Home All is required before other operations after an emergency stop"};
  }
  String commError;
  if (!ensureControllerCommunicationActive(commError)) {
    return {false, false, true, 503, "COMM_ERROR", commError};
  }''')

# 6) Recovery-move gate.
rep('''RecoveryMotionAdmission admitRecoveryMotion(const String &cmd) {
  if (jobStatus.state != JobRunnerState::RecoveryRequired) {''',
    '''RecoveryMotionAdmission admitRecoveryMotion(const String &cmd) {
  if (operatorStopLatchBlocksMotion()) {
    return {false, 409, "STOP_LATCHED",
            operatorStopLatch == OperatorStopLatch::EmergencyStopped
                ? "EMERGENCY STOPPED. Restart the controller and Home All."
                : "Stop is latched. Return to controls to continue."};
  }
  if (jobStatus.state != JobRunnerState::RecoveryRequired) {''')

# 7) /api/cmd: motion lock while stop-latched.
rep('''  if (jobStatus.state == JobRunnerState::RecoveryRequired) {
    // F-2: during recovery review the generic terminal may not move or
    // re-program the machine. Only read-only diagnostics pass; M5 stays reserved
    // for the recovery flow and physical motion must use /api/recovery/move.
    static const char *const kRecoveryDiagnostics[] = {"M114", "M115", "M503", "M119", "M105"};
    bool diagnostic = false;
    for (const char *allowed : kRecoveryDiagnostics) {
      if (upper == allowed) {
        diagnostic = true;
        break;
      }
    }
    if (!diagnostic) {
      sendJsonError(409, upper == "M5"
                             ? "standalone M5 is unavailable while interrupted-job Recovery is required"
                             : "Marlin transport is locked to recovery review; motion commands require /api/recovery/move");
      return;
    }
  }''',
    '''  if (jobStatus.state == JobRunnerState::RecoveryRequired || operatorStopLatchBlocksMotion()) {
    // F-2/F-4-phase stop latch: during recovery review or a latched stop, the
    // generic terminal may not move or re-program the machine. Only read-only
    // diagnostics pass; M5 stays reserved for the safety flow.
    static const char *const kStopLockDiagnostics[] = {"M114", "M115", "M503", "M119", "M105"};
    bool diagnostic = false;
    for (const char *allowed : kStopLockDiagnostics) {
      if (upper == allowed) {
        diagnostic = true;
        break;
      }
    }
    if (!diagnostic) {
      sendJsonError(409, upper == "M5"
                             ? "standalone M5 is unavailable while interrupted-job Recovery is required"
                             : "Marlin transport is locked; motion commands are not available while stopped");
      return;
    }
  }''')

# 8) Synchronous zero/motion handlers: latch gate.
for handler in ['handleSetWorkZero', 'handleSetZZero', 'handleTouchPlateZZero', 'handleGoToWorkZero', 'handleRestoreWorkZero']:
    rep(f'''void {handler}() {{
  String commError;''',
        f'''void {handler}() {{
  if (operatorStopLatchBlocksMotion()) {{
    sendJsonError(409, operatorStopLatch == OperatorStopLatch::EmergencyStopped
                           ? "EMERGENCY STOPPED. Restart the controller and Home All."
                           : "Stop is latched. Return to controls to continue.");
    return;
  }}
  String commError;''')

# 9) Release endpoint + route registration.
rep('''void handleCommand() {''',
    '''void handleStopLatchRelease() {
  if (operatorStopLatch == OperatorStopLatch::EmergencyStopped) {
    sendJsonError(409,
                  "EMERGENCY STOPPED. Restart the controller and Home All before returning to controls.");
    return;
  }
  if (operatorStopLatch == OperatorStopLatch::HomeRequired) {
    sendJsonError(409, "Home All is required before returning to controls.");
    return;
  }
  if (operatorStopLatch != OperatorStopLatch::Stopped) {
    sendJsonError(409, "Stop is not latched");
    return;
  }
  operatorStopLatch = OperatorStopLatch::None;
  logJobEvent("Stop latch released by operator");
  server.send(200, "application/json", "{\\"ok\\":true}");
}

void handleCommand() {''')

rep('''  operatorRoute("/api/stop-latch/release", HTTP_POST, handleStopLatchRelease);
''' if False else '''  operatorRoute("/api/controller/recover", HTTP_POST, handleControllerRecover);''',
    '''  operatorRoute("/api/stop-latch/release", HTTP_POST, handleStopLatchRelease);
  operatorRoute("/api/controller/recover", HTTP_POST, handleControllerRecover);''')

# 10) Suppress auto-recovery during EmergencyStopped (the operator must
#     explicitly press Restart Controller; no automatic M999).
rep('''  if (jobIsActive() || jogIsActive()) {
    return false;
  }

  invalidateControllerSessionSafetyCapabilities();
  markControllerRecovering();''',
    '''  if (jobIsActive() || jogIsActive()) {
    return false;
  }

  // Auto-recovery is suppressed while the operator has latched an emergency
  // stop: only the explicit Restart Controller action may attempt recovery.
  if (operatorStopLatch == OperatorStopLatch::EmergencyStopped &&
      !operatorStopLatchRestartRequested) {
    return false;
  }''')

# 11) Restart-requested flag for the manual recovery action.
rep('''bool controllerKilledByEmergencyStop = false;''',
    '''bool controllerKilledByEmergencyStop = false;
bool operatorStopLatchRestartRequested = false;''')

# 12) Clear the latch + restart flag on successful Home All finalize.
rep('''      machineFrame.stepsX = stepsX;
      machineFrame.stepsY = stepsY;
      machineFrame.stepsZ = stepsZ;''',
    '''      machineFrame.stepsX = stepsX;
      machineFrame.stepsY = stepsY;
      machineFrame.stepsZ = stepsZ;
      if (operatorStopLatch == OperatorStopLatch::HomeRequired) {
        operatorStopLatch = OperatorStopLatch::None;
        operatorStopLatchRestartRequested = false;
        logJobEvent("Home All complete; stop latch cleared. Normal controls restored.");
      }''')

io.open(path, 'w', encoding='utf-8', newline='\n').write(src)
print('stop latch implemented; changed:', src != orig)
