#include "controller_comm.h"

ControllerCommManager::ControllerCommManager() {
  reset(ControllerCommunicationState::Connected);
}

void ControllerCommManager::reset(ControllerCommunicationState initialState) {
  telemetry.state = initialState;
  telemetry.lastSuccessfulResponseMs = 0;
  telemetry.lastTimeoutMs = 0;
  telemetry.lastFailedCommand = "";
  telemetry.lastError = "";
  activeTransaction = SyncTransaction();
  nextToken = 0;
  activeJobRunning = false;
  activeJogRunning = false;
}

const char* ControllerCommManager::stateToCStr(ControllerCommunicationState st) {
  switch (st) {
    case ControllerCommunicationState::Connected: return "connected";
    case ControllerCommunicationState::Waiting: return "waiting";
    case ControllerCommunicationState::Unresponsive: return "unresponsive";
    case ControllerCommunicationState::Recovering: return "recovering";
    default: return "unknown";
  }
}

bool ControllerCommManager::checkPermission(ControllerCommandClass cmdClass, std::string &error) const {
  if (cmdClass == ControllerCommandClass::SafetyStop) {
    return true;
  }
  if (cmdClass == ControllerCommandClass::RecoveryProbe) {
    if (telemetry.state != ControllerCommunicationState::Recovering) {
      error = "Recovery probe is allowed only during active controller recovery.";
      return false;
    }
    return true;
  }
  if (telemetry.state == ControllerCommunicationState::Unresponsive) {
    error = "Marlin is not responding. Machine commands are blocked until controller communication is restored.";
    return false;
  }
  if (telemetry.state == ControllerCommunicationState::Recovering) {
    error = "Controller communication recovery is in progress. Machine commands are blocked.";
    return false;
  }
  if (telemetry.state == ControllerCommunicationState::Waiting) {
    if (cmdClass == ControllerCommandClass::OrdinarySync) {
      error = "Marlin is processing a synchronous command. Second command rejected.";
    } else {
      error = "Stream is blocked while Marlin is processing a synchronous command.";
    }
    return false;
  }
  if (telemetry.state == ControllerCommunicationState::Unknown) {
    error = "Controller communication state is unknown.";
    return false;
  }
  if (cmdClass == ControllerCommandClass::ManagedJogStream) {
    if (telemetry.state != ControllerCommunicationState::Connected || !activeJogRunning || activeTransaction.token != 0) {
      error = "Jog stream is blocked while controller communication is unavailable or UART is busy.";
      return false;
    }
  }
  if (cmdClass == ControllerCommandClass::ManagedJobStream) {
    if (telemetry.state != ControllerCommunicationState::Connected || !activeJobRunning || activeTransaction.token != 0) {
      error = "Job stream is blocked while controller communication is unavailable or UART is busy.";
      return false;
    }
  }
  return true;
}

bool ControllerCommManager::reserveTransaction(ControllerCommandClass cmdClass, const std::string &cmd, bool promoteConnectedOnTerminal, uint32_t &tokenOut, std::string &errorOut) {
  tokenOut = 0;
  if (!checkPermission(cmdClass, errorOut)) {
    return false;
  }
  if (cmdClass == ControllerCommandClass::OrdinarySync) {
    uint32_t tok = ++nextToken;
    if (tok == 0) tok = ++nextToken;
    activeTransaction.token = tok;
    activeTransaction.command = cmd;
    activeTransaction.commandClass = cmdClass;
    activeTransaction.previousState = telemetry.state;
    activeTransaction.promoteConnectedOnTerminal = promoteConnectedOnTerminal;
    telemetry.state = ControllerCommunicationState::Waiting;
    telemetry.lastFailedCommand = cmd;
    tokenOut = tok;
    return true;
  }
  if (cmdClass == ControllerCommandClass::RecoveryProbe) {
    uint32_t tok = ++nextToken;
    if (tok == 0) tok = ++nextToken;
    activeTransaction.token = tok;
    activeTransaction.command = cmd;
    activeTransaction.commandClass = cmdClass;
    activeTransaction.previousState = ControllerCommunicationState::Recovering;
    activeTransaction.promoteConnectedOnTerminal = false;
    tokenOut = tok;
    return true;
  }
  tokenOut = 0;
  return true;
}

bool ControllerCommManager::validateWritePermission(ControllerCommandClass cmdClass, uint32_t transactionToken, std::string &errorOut) const {
  if (cmdClass == ControllerCommandClass::OrdinarySync) {
    if (transactionToken > 0 && transactionToken == activeTransaction.token && telemetry.state == ControllerCommunicationState::Waiting) {
      return true;
    }
    errorOut = "Marlin is processing a synchronous command. Second command rejected.";
    return false;
  }
  if (cmdClass == ControllerCommandClass::RecoveryProbe) {
    if (telemetry.state == ControllerCommunicationState::Recovering) {
      if (transactionToken == 0 || transactionToken == activeTransaction.token) {
        return true;
      }
    }
    errorOut = "Recovery probe is allowed only during active controller recovery.";
    return false;
  }
  if (cmdClass == ControllerCommandClass::SafetyStop) {
    return true;
  }
  if (cmdClass == ControllerCommandClass::ManagedJobStream) {
    if (telemetry.state == ControllerCommunicationState::Connected && activeJobRunning && activeTransaction.token == 0) {
      return true;
    }
    errorOut = "Job stream is blocked while controller communication is unavailable or UART is busy.";
    return false;
  }
  if (cmdClass == ControllerCommandClass::ManagedJogStream) {
    if (telemetry.state == ControllerCommunicationState::Connected && activeJogRunning && activeTransaction.token == 0) {
      return true;
    }
    errorOut = "Jog stream is blocked while controller communication is unavailable or UART is busy.";
    return false;
  }
  errorOut = "Command permission denied.";
  return false;
}

void ControllerCommManager::onPreWriteFailure(uint32_t transactionToken) {
  if (transactionToken > 0 && transactionToken == activeTransaction.token) {
    ControllerCommunicationState restoredState = activeTransaction.previousState;
    activeTransaction = SyncTransaction();
    telemetry.state = restoredState;
  }
}

void ControllerCommManager::onTerminalResponse(uint32_t transactionToken, bool isErrorOrAlarm, uint32_t nowMs) {
  telemetry.lastSuccessfulResponseMs = nowMs;
  if (transactionToken > 0 && transactionToken == activeTransaction.token) {
    bool promote = activeTransaction.promoteConnectedOnTerminal;
    ControllerCommandClass cClass = activeTransaction.commandClass;
    activeTransaction = SyncTransaction();
    if (cClass == ControllerCommandClass::OrdinarySync) {
      if (promote && !isErrorOrAlarm) {
        telemetry.state = ControllerCommunicationState::Connected;
      } else if (!isErrorOrAlarm && telemetry.state == ControllerCommunicationState::Waiting) {
        telemetry.state = ControllerCommunicationState::Connected;
      }
    }
  }
}

void ControllerCommManager::onTimeout(uint32_t transactionToken, const std::string &cmd, const std::string &errorMsg, uint32_t nowMs) {
  if (transactionToken > 0 && transactionToken == activeTransaction.token) {
    activeTransaction = SyncTransaction();
  }
  telemetry.state = ControllerCommunicationState::Unresponsive;
  telemetry.lastTimeoutMs = nowMs;
  telemetry.lastFailedCommand = cmd;
  telemetry.lastError = errorMsg;
}

void ControllerCommManager::onRecovering() {
  activeTransaction = SyncTransaction();
  telemetry.state = ControllerCommunicationState::Recovering;
}

void ControllerCommManager::onRecoveryComplete(uint32_t nowMs) {
  activeTransaction = SyncTransaction();
  telemetry.state = ControllerCommunicationState::Connected;
  telemetry.lastSuccessfulResponseMs = nowMs;
}
