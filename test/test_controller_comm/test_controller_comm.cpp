#include <unity.h>
#include "controller_comm.h"
#include "../../src/controller_comm.cpp"

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
  return UNITY_END();
}
