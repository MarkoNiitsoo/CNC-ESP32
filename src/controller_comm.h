#ifndef CONTROLLER_COMM_H
#define CONTROLLER_COMM_H

#include <string>
#include <cstdint>
#include <stdbool.h>

enum class ControllerCommunicationState {
  Unknown,
  Connected,
  Waiting,
  Unresponsive,
  Recovering
};

enum class ControllerCommandClass {
  OrdinarySync,
  ManagedJobStream,
  ManagedJogStream,
  SafetyStop,
  RecoveryProbe
};

struct SyncTransaction {
  uint32_t token = 0;
  std::string command = "";
  ControllerCommandClass commandClass = ControllerCommandClass::OrdinarySync;
  ControllerCommunicationState previousState = ControllerCommunicationState::Connected;
  bool promoteConnectedOnTerminal = true;
};

struct ControllerCommunicationTelemetry {
  ControllerCommunicationState state = ControllerCommunicationState::Connected;
  uint32_t lastSuccessfulResponseMs = 0;
  uint32_t lastTimeoutMs = 0;
  std::string lastFailedCommand = "";
  std::string lastError = "";
};

class ControllerCommManager {
public:
  ControllerCommunicationTelemetry telemetry;
  SyncTransaction activeTransaction;
  uint32_t nextToken = 0;
  bool activeJobRunning = false;
  bool activeJogRunning = false;

  ControllerCommManager();

  static const char* stateToCStr(ControllerCommunicationState st);

  bool checkPermission(ControllerCommandClass cmdClass, std::string &error) const;
  bool reserveTransaction(ControllerCommandClass cmdClass, const std::string &cmd, bool promoteConnectedOnTerminal, uint32_t &tokenOut, std::string &errorOut);
  bool validateWritePermission(ControllerCommandClass cmdClass, uint32_t transactionToken, std::string &errorOut) const;
  void onPreWriteFailure(uint32_t transactionToken);
  void onTerminalResponse(uint32_t transactionToken, bool isErrorOrAlarm, uint32_t nowMs);
  void onTimeout(uint32_t transactionToken, const std::string &cmd, const std::string &errorMsg, uint32_t nowMs);
  void onRecovering();
  void onRecoveryComplete(uint32_t nowMs);
  void reset(ControllerCommunicationState initialState = ControllerCommunicationState::Connected);

  // Optional observer fired only when telemetry.state actually CHANGES (not
  // for routine Waiting round-trips of a single sync command). The firmware
  // wires it to the SD system log so controller outages and recoveries leave
  // a persistent trace; native tests use it to assert transition reporting.
  void (*onStateChange)(ControllerCommunicationState from, ControllerCommunicationState to,
                        const std::string &reason) = nullptr;

private:
  void transition(ControllerCommunicationState to, const std::string &reason);
};

#endif // CONTROLLER_COMM_H
