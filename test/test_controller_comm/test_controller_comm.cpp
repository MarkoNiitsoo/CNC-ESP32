#include <unity.h>
#include <ArduinoJson.h>
#include "controller_comm.h"
#include "../../src/controller_comm.cpp"
#include "../../src/ws_command_protocol.cpp"

void setUp(void) {}
void tearDown(void) {}

void test_1_connected_reserve_ordinary_sync_transitions_to_waiting(void) {
  ControllerCommManager mgr;
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Connected, (int)mgr.telemetry.state);

  uint32_t token = 0;
  std::string err;
  bool reserved = mgr.reserveTransaction(ControllerCommandClass::OrdinarySync, "M400", true, token, err);

  TEST_ASSERT_TRUE(reserved);
  TEST_ASSERT_GREATER_THAN(0, token);
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Waiting, (int)mgr.telemetry.state);
}

void test_2_reserved_transaction_allowed_to_write(void) {
  ControllerCommManager mgr;
  uint32_t token = 0;
  std::string err;
  mgr.reserveTransaction(ControllerCommandClass::OrdinarySync, "G28", true, token, err);

  bool valid = mgr.validateWritePermission(ControllerCommandClass::OrdinarySync, token, err);
  TEST_ASSERT_TRUE(valid);
}

void test_3_unrelated_transaction_rejected_while_waiting(void) {
  ControllerCommManager mgr;
  uint32_t token = 0;
  std::string err;
  mgr.reserveTransaction(ControllerCommandClass::OrdinarySync, "G28", true, token, err);

  // 1. Unrelated write validation with token 0 or wrong token
  bool writeValid = mgr.validateWritePermission(ControllerCommandClass::OrdinarySync, 0, err);
  TEST_ASSERT_FALSE(writeValid);
  TEST_ASSERT_EQUAL_STRING("Marlin is processing a synchronous command. Second command rejected.", err.c_str());

  // 2. Second reserve attempt while Waiting
  uint32_t secondToken = 0;
  std::string reserveErr;
  bool secondReserved = mgr.reserveTransaction(ControllerCommandClass::OrdinarySync, "M114", true, secondToken, reserveErr);
  TEST_ASSERT_FALSE(secondReserved);
  TEST_ASSERT_EQUAL(0, secondToken);
  TEST_ASSERT_EQUAL_STRING("Marlin is processing a synchronous command. Second command rejected.", reserveErr.c_str());
}

void test_4_terminal_success_transitions_to_connected(void) {
  ControllerCommManager mgr;
  uint32_t token = 0;
  std::string err;
  mgr.reserveTransaction(ControllerCommandClass::OrdinarySync, "M400", true, token, err);

  mgr.onTerminalResponse(token, false, 1000);
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Connected, (int)mgr.telemetry.state);
  TEST_ASSERT_EQUAL(0, mgr.activeTransaction.token);
}

void test_5_timeout_transitions_to_unresponsive(void) {
  ControllerCommManager mgr;
  uint32_t token = 0;
  std::string err;
  mgr.reserveTransaction(ControllerCommandClass::OrdinarySync, "M400", true, token, err);

  mgr.onTimeout(token, "M400", "Marlin did not respond within timeout.", 2000);
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Unresponsive, (int)mgr.telemetry.state);
  TEST_ASSERT_EQUAL_STRING("M400", mgr.telemetry.lastFailedCommand.c_str());
  TEST_ASSERT_EQUAL(0, mgr.activeTransaction.token);
}

void test_6_failed_pre_write_restores_previous_state(void) {
  ControllerCommManager mgr;
  uint32_t token = 0;
  std::string err;
  mgr.reserveTransaction(ControllerCommandClass::OrdinarySync, "M400", true, token, err);
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Waiting, (int)mgr.telemetry.state);

  mgr.onPreWriteFailure(token);
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Connected, (int)mgr.telemetry.state);
  TEST_ASSERT_EQUAL(0, mgr.activeTransaction.token);
}

void test_7_safety_stop_never_promotes_connected(void) {
  ControllerCommManager mgr;
  mgr.telemetry.state = ControllerCommunicationState::Unresponsive;

  std::string err;
  bool valid = mgr.validateWritePermission(ControllerCommandClass::SafetyStop, 0, err);
  TEST_ASSERT_TRUE(valid);

  mgr.onTerminalResponse(0, false, 3000);
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Unresponsive, (int)mgr.telemetry.state);
}

void test_8_recovery_probe_remains_recovering(void) {
  ControllerCommManager mgr;
  mgr.onRecovering();
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Recovering, (int)mgr.telemetry.state);

  uint32_t token = 0;
  std::string err;
  bool reserved = mgr.reserveTransaction(ControllerCommandClass::RecoveryProbe, "M115", false, token, err);
  TEST_ASSERT_TRUE(reserved);
  TEST_ASSERT_TRUE(mgr.validateWritePermission(ControllerCommandClass::RecoveryProbe, token, err));

  mgr.onTerminalResponse(token, false, 4000);
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Recovering, (int)mgr.telemetry.state);
}

void test_9_managed_streams_require_connected_and_correct_owner(void) {
  ControllerCommManager mgr;
  std::string err;

  // 1. Connected but job/jog active == false -> rejected
  TEST_ASSERT_FALSE(mgr.validateWritePermission(ControllerCommandClass::ManagedJobStream, 0, err));
  TEST_ASSERT_FALSE(mgr.validateWritePermission(ControllerCommandClass::ManagedJogStream, 0, err));

  // 2. Connected and job active == true -> allowed
  mgr.activeJobRunning = true;
  TEST_ASSERT_TRUE(mgr.validateWritePermission(ControllerCommandClass::ManagedJobStream, 0, err));
  mgr.activeJobRunning = false;

  // 3. Connected and jog active == true -> allowed
  mgr.activeJogRunning = true;
  TEST_ASSERT_TRUE(mgr.validateWritePermission(ControllerCommandClass::ManagedJogStream, 0, err));

  // 4. Waiting or Unresponsive while job active -> rejected
  uint32_t token = 0;
  mgr.reserveTransaction(ControllerCommandClass::OrdinarySync, "M400", true, token, err);
  mgr.activeJobRunning = true;
  TEST_ASSERT_FALSE(mgr.validateWritePermission(ControllerCommandClass::ManagedJobStream, 0, err));
}

void test_10_production_resume_preamble_failure_simulation(void) {
  ControllerCommManager mgr;
  std::string err;

  mgr.telemetry.state = ControllerCommunicationState::Unresponsive;
  TEST_ASSERT_FALSE(mgr.checkPermission(ControllerCommandClass::ManagedJobStream, err));
  TEST_ASSERT_FALSE(mgr.checkPermission(ControllerCommandClass::OrdinarySync, err));
  TEST_ASSERT_EQUAL_STRING("Marlin is not responding. Machine commands are blocked until controller communication is restored.", err.c_str());
}

void test_11_terminal_error_alarm_bangbang_transitions_to_connected(void) {
  ControllerCommManager mgr;

  // 1. Terminal Error:
  uint32_t token1 = 0;
  std::string err;
  mgr.reserveTransaction(ControllerCommandClass::OrdinarySync, "G0 X100", true, token1, err);
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Waiting, (int)mgr.telemetry.state);
  mgr.onTerminalResponse(token1, true, 1000); // isErrorOrAlarm = true
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Connected, (int)mgr.telemetry.state);

  // 2. Terminal Alarm:
  uint32_t token2 = 0;
  mgr.reserveTransaction(ControllerCommandClass::OrdinarySync, "G28", true, token2, err);
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Waiting, (int)mgr.telemetry.state);
  mgr.onTerminalResponse(token2, true, 2000); // isErrorOrAlarm = true
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Connected, (int)mgr.telemetry.state);

  // 3. Terminal !! (Emergency Stop / Fatal Marlin Error)
  uint32_t token3 = 0;
  mgr.reserveTransaction(ControllerCommandClass::OrdinarySync, "M114", true, token3, err);
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Waiting, (int)mgr.telemetry.state);
  mgr.onTerminalResponse(token3, true, 3000); // isErrorOrAlarm = true
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Connected, (int)mgr.telemetry.state);
}

void test_12_tightened_recovery_probe_token_ownership(void) {
  ControllerCommManager mgr;
  mgr.onRecovering();
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Recovering, (int)mgr.telemetry.state);

  uint32_t token1 = 0;
  std::string err;
  bool reserved1 = mgr.reserveTransaction(ControllerCommandClass::RecoveryProbe, "M115", false, token1, err);
  TEST_ASSERT_TRUE(reserved1);
  TEST_ASSERT_GREATER_THAN(0, token1);

  // Reject transactionToken == 0 while reserved recovery transaction exists
  std::string writeErr;
  bool zeroValid = mgr.validateWritePermission(ControllerCommandClass::RecoveryProbe, 0, writeErr);
  TEST_ASSERT_FALSE(zeroValid);
  TEST_ASSERT_EQUAL_STRING("Recovery probe requires a valid active recovery transaction token.", writeErr.c_str());

  // Reject second recovery probe while first probe is active
  uint32_t token2 = 0;
  std::string reserveErr;
  bool reserved2 = mgr.reserveTransaction(ControllerCommandClass::RecoveryProbe, "M114", false, token2, reserveErr);
  TEST_ASSERT_FALSE(reserved2);
  TEST_ASSERT_EQUAL(0, token2);
  TEST_ASSERT_EQUAL_STRING("Recovery probe rejected while another recovery transaction is active.", reserveErr.c_str());

  // Terminal response for probe 1 clears active recovery transaction
  mgr.onTerminalResponse(token1, false, 4000);

  // Now second probe can be reserved successfully
  bool reserved3 = mgr.reserveTransaction(ControllerCommandClass::RecoveryProbe, "M114", false, token2, reserveErr);
  TEST_ASSERT_TRUE(reserved3);
  TEST_ASSERT_GREATER_THAN(0, token2);
}

void test_13_second_command_rejected_during_active_m115_without_disturbing_transaction(void) {
  ControllerCommManager mgr;
  mgr.onRecovering();

  uint32_t m115Token = 0;
  std::string err;
  bool m115Reserved = mgr.reserveTransaction(ControllerCommandClass::RecoveryProbe, "M115", false, m115Token, err);
  TEST_ASSERT_TRUE(m115Reserved);

  // Attempting an ordinary or second probe command fails permission check before UART actions
  uint32_t secondToken = 0;
  std::string secondErr;
  bool secondReserved = mgr.reserveTransaction(ControllerCommandClass::OrdinarySync, "G28", true, secondToken, secondErr);
  TEST_ASSERT_FALSE(secondReserved);
  TEST_ASSERT_EQUAL(0, secondToken);

  // Active M115 transaction and state remain intact
  TEST_ASSERT_EQUAL(m115Token, mgr.activeTransaction.token);
  TEST_ASSERT_EQUAL_STRING("M115", mgr.activeTransaction.command.c_str());
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Recovering, (int)mgr.telemetry.state);
}

void test_14_ws_command_id_validation_is_bounded_and_safe(void) {
  TEST_ASSERT_TRUE(validWsCommandId("cmd-123._:retry"));
  TEST_ASSERT_FALSE(validWsCommandId(""));
  TEST_ASSERT_FALSE(validWsCommandId("bad id"));
  TEST_ASSERT_FALSE(validWsCommandId("bad\"id"));
  std::string oversized(97, 'a');
  TEST_ASSERT_FALSE(validWsCommandId(oversized.c_str()));
}

void test_15_ws_action_validation_rejects_invalid_forms(void) {
  TEST_ASSERT_TRUE(validWsCommandAction("job.setFeedOverride"));
  TEST_ASSERT_FALSE(validWsCommandAction("job:pause"));
  TEST_ASSERT_FALSE(validWsCommandAction("job pause"));
  std::string oversized(65, 'a');
  TEST_ASSERT_FALSE(validWsCommandAction(oversized.c_str()));
}

void test_16_ws_command_ack_has_complete_unsequenced_shape(void) {
  JsonDocument doc;
  const std::string json = buildWsCommandAckJson("cmd-ack", true, true, "IN_PROGRESS", "queued");
  TEST_ASSERT_FALSE(deserializeJson(doc, json));
  TEST_ASSERT_EQUAL(1, doc["protocolVersion"].as<int>());
  TEST_ASSERT_EQUAL_STRING("commandAck", doc["type"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("cmd-ack", doc["commandId"].as<const char *>());
  TEST_ASSERT_TRUE(doc["accepted"].as<bool>());
  TEST_ASSERT_TRUE(doc["inProgress"].as<bool>());
  TEST_ASSERT_FALSE(doc["ok"].as<bool>());
  TEST_ASSERT_EQUAL_STRING("IN_PROGRESS", doc["code"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("queued", doc["message"].as<const char *>());
  TEST_ASSERT_TRUE(doc["seq"].isNull());
  TEST_ASSERT_TRUE(doc["stateRevision"].isNull());
}

void test_17_ws_command_result_escapes_dynamic_json_values(void) {
  JsonDocument doc;
  const std::string json = buildWsCommandResultJson("cmd-safe", false, "COMM_ERROR", "P000 said \"hold\"\nretry\\later");
  TEST_ASSERT_FALSE(deserializeJson(doc, json));
  TEST_ASSERT_EQUAL_STRING("cmd-safe", doc["commandId"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("P000 said \"hold\"\nretry\\later", doc["message"].as<const char *>());
}

void test_18_ws_command_result_has_complete_protocol_fields(void) {
  JsonDocument doc;
  const std::string json = buildWsCommandResultJson("cmd-result", true, "OK", "done");
  TEST_ASSERT_FALSE(deserializeJson(doc, json));
  TEST_ASSERT_EQUAL(1, doc["protocolVersion"].as<int>());
  TEST_ASSERT_EQUAL_STRING("commandResult", doc["type"].as<const char *>());
  TEST_ASSERT_TRUE(doc["accepted"].as<bool>());
  TEST_ASSERT_FALSE(doc["inProgress"].as<bool>());
  TEST_ASSERT_TRUE(doc["ok"].as<bool>());
  TEST_ASSERT_EQUAL_STRING("OK", doc["code"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("done", doc["message"].as<const char *>());
  TEST_ASSERT_TRUE(doc["seq"].isNull());
  TEST_ASSERT_TRUE(doc["stateRevision"].isNull());
}

// ── State-change observer (SD system-log wiring) ────────────────────────────

static int g_stateChangeCalls = 0;
static ControllerCommunicationState g_stateChangeFrom;
static ControllerCommunicationState g_stateChangeTo;
static std::string g_stateChangeReason;

static void recordStateChange(ControllerCommunicationState from, ControllerCommunicationState to,
                              const std::string &reason) {
  ++g_stateChangeCalls;
  g_stateChangeFrom = from;
  g_stateChangeTo = to;
  g_stateChangeReason = reason;
}

void test_19_timeout_reports_state_change_once(void) {
  ControllerCommManager mgr;
  g_stateChangeCalls = 0;
  mgr.onStateChange = recordStateChange;

  mgr.onTimeout(0, "G28", "Marlin did not answer", 1000);
  TEST_ASSERT_EQUAL_INT(1, g_stateChangeCalls);
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Connected, (int)g_stateChangeFrom);
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Unresponsive, (int)g_stateChangeTo);
  TEST_ASSERT_TRUE(g_stateChangeReason.find("timeout: G28") != std::string::npos);

  // A repeated timeout while already Unresponsive must not log again.
  mgr.onTimeout(0, "M114", "Marlin did not answer", 2000);
  TEST_ASSERT_EQUAL_INT(1, g_stateChangeCalls);
}

void test_20_recovery_arc_reports_each_transition(void) {
  ControllerCommManager mgr;
  g_stateChangeCalls = 0;
  mgr.onStateChange = recordStateChange;

  mgr.onRecovering();
  TEST_ASSERT_EQUAL_INT(1, g_stateChangeCalls);
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Connected, (int)g_stateChangeFrom);
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Recovering, (int)g_stateChangeTo);

  mgr.onRecoveryComplete(5000);
  TEST_ASSERT_EQUAL_INT(2, g_stateChangeCalls);
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Recovering, (int)g_stateChangeFrom);
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Connected, (int)g_stateChangeTo);
  TEST_ASSERT_TRUE(g_stateChangeReason.find("restored") != std::string::npos);
}

void test_21_healthy_sync_round_trip_logs_nothing(void) {
  ControllerCommManager mgr;
  g_stateChangeCalls = 0;
  mgr.onStateChange = recordStateChange;

  uint32_t token = 0;
  std::string err;
  mgr.reserveTransaction(ControllerCommandClass::OrdinarySync, "M114", true, token, err);
  mgr.onTerminalResponse(token, false, 1000);
  TEST_ASSERT_EQUAL_INT((int)ControllerCommunicationState::Connected, (int)mgr.telemetry.state);
  // Routine Waiting round-trips are healthy chatter and stay silent.
  TEST_ASSERT_EQUAL_INT(0, g_stateChangeCalls);
}

int main(int argc, char **argv) {
  UNITY_BEGIN();
  RUN_TEST(test_1_connected_reserve_ordinary_sync_transitions_to_waiting);
  RUN_TEST(test_2_reserved_transaction_allowed_to_write);
  RUN_TEST(test_3_unrelated_transaction_rejected_while_waiting);
  RUN_TEST(test_4_terminal_success_transitions_to_connected);
  RUN_TEST(test_5_timeout_transitions_to_unresponsive);
  RUN_TEST(test_6_failed_pre_write_restores_previous_state);
  RUN_TEST(test_7_safety_stop_never_promotes_connected);
  RUN_TEST(test_8_recovery_probe_remains_recovering);
  RUN_TEST(test_9_managed_streams_require_connected_and_correct_owner);
  RUN_TEST(test_10_production_resume_preamble_failure_simulation);
  RUN_TEST(test_11_terminal_error_alarm_bangbang_transitions_to_connected);
  RUN_TEST(test_12_tightened_recovery_probe_token_ownership);
  RUN_TEST(test_13_second_command_rejected_during_active_m115_without_disturbing_transaction);
  RUN_TEST(test_14_ws_command_id_validation_is_bounded_and_safe);
  RUN_TEST(test_15_ws_action_validation_rejects_invalid_forms);
  RUN_TEST(test_16_ws_command_ack_has_complete_unsequenced_shape);
  RUN_TEST(test_17_ws_command_result_escapes_dynamic_json_values);
  RUN_TEST(test_18_ws_command_result_has_complete_protocol_fields);
  RUN_TEST(test_19_timeout_reports_state_change_once);
  RUN_TEST(test_20_recovery_arc_reports_each_transition);
  RUN_TEST(test_21_healthy_sync_round_trip_logs_nothing);
  return UNITY_END();
}
