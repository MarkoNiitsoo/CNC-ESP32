#include <unity.h>
#include "jog_drain.h"

void setUp(void) {}
void tearDown(void) {}

void test_release_waits_for_every_move_then_planner_then_position() {
  JogDrain drain;
  uint8_t pending = 2;
  drain.begin(100);
  TEST_ASSERT_NULL(drain.nextCommand(pending));
  drain.acknowledge(pending);
  TEST_ASSERT_EQUAL_UINT8(1, pending);
  TEST_ASSERT_NULL(drain.nextCommand(pending));
  drain.acknowledge(pending);
  TEST_ASSERT_EQUAL_STRING("M400", drain.nextCommand(pending));
  drain.commandSent(150);
  TEST_ASSERT_NULL(drain.nextCommand(pending));
  drain.notePosition(); // autoreport before the drain completes is insufficient
  drain.acknowledge(pending);
  TEST_ASSERT_EQUAL_STRING("M114", drain.nextCommand(pending));
  drain.commandSent(200);
  TEST_ASSERT_FALSE(drain.positionSeen);
  drain.notePosition();
  TEST_ASSERT_TRUE(drain.phase == JogDrain::Phase::PositionAck);
  drain.acknowledge(pending);
  TEST_ASSERT_TRUE(drain.phase == JogDrain::Phase::Complete);
  TEST_ASSERT_FALSE(drain.timedOut(100000));
}

void test_delayed_move_ack_does_not_imply_quickstop_or_completion() {
  JogDrain drain;
  uint8_t pending = 1;
  drain.begin(100);
  TEST_ASSERT_FALSE(drain.timedOut(1500)); // reproduces the old one-second escalation
  TEST_ASSERT_NULL(drain.nextCommand(pending));
  drain.acknowledge(pending);
  TEST_ASSERT_EQUAL_STRING("M400", drain.nextCommand(pending));
}

void test_lost_move_ack_times_out_without_sending_a_barrier_as_a_move_ack() {
  JogDrain drain;
  uint8_t pending = 1;
  drain.begin(100);
  TEST_ASSERT_TRUE(drain.timedOut(10100));
  TEST_ASSERT_NULL(drain.nextCommand(pending));
  TEST_ASSERT_EQUAL_UINT8(1, pending);
}

void test_duplicate_release_does_not_extend_deadline() {
  JogDrain drain;
  drain.begin(100);
  drain.begin(9000);
  TEST_ASSERT_TRUE(drain.timedOut(10100));
}

void test_empty_jog_still_requires_motion_barrier() {
  JogDrain drain;
  drain.begin(100);
  TEST_ASSERT_EQUAL_STRING("M400", drain.nextCommand(0));
  drain.commandSent(110);
  TEST_ASSERT_FALSE(drain.timedOut(10109));
  TEST_ASSERT_TRUE(drain.timedOut(10110));
  TEST_ASSERT_TRUE(drain.phase == JogDrain::Phase::PlannerAck);
}

void test_position_ack_without_fresh_xyz_is_failure() {
  JogDrain drain;
  uint8_t pending = 0;
  drain.begin(100);
  drain.nextCommand(pending);
  drain.commandSent(101);
  drain.acknowledge(pending);
  drain.nextCommand(pending);
  drain.commandSent(102);
  drain.acknowledge(pending);
  TEST_ASSERT_TRUE(drain.phase == JogDrain::Phase::Failed);
}

void test_clock_wrap_preserves_timeout() {
  JogDrain drain;
  drain.begin(UINT32_MAX - 500);
  TEST_ASSERT_FALSE(drain.timedOut(499));
  TEST_ASSERT_TRUE(drain.timedOut(9499));
}

void test_stream_acks_are_counted_before_drain_and_never_underflow() {
  JogDrain drain;
  uint8_t pending = 2;
  drain.acknowledge(pending);
  drain.acknowledge(pending);
  drain.acknowledge(pending);
  TEST_ASSERT_EQUAL_UINT8(0, pending);
  TEST_ASSERT_TRUE(drain.phase == JogDrain::Phase::Inactive);
}

int main(int argc, char **argv) {
  UNITY_BEGIN();
  RUN_TEST(test_release_waits_for_every_move_then_planner_then_position);
  RUN_TEST(test_delayed_move_ack_does_not_imply_quickstop_or_completion);
  RUN_TEST(test_lost_move_ack_times_out_without_sending_a_barrier_as_a_move_ack);
  RUN_TEST(test_duplicate_release_does_not_extend_deadline);
  RUN_TEST(test_empty_jog_still_requires_motion_barrier);
  RUN_TEST(test_position_ack_without_fresh_xyz_is_failure);
  RUN_TEST(test_clock_wrap_preserves_timeout);
  RUN_TEST(test_stream_acks_are_counted_before_drain_and_never_underflow);
  return UNITY_END();
}
