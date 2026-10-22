#include <unity.h>
#include "zero_capture.h"

void setUp(void) {}
void tearDown(void) {}

void test_settled_counts_replace_stale_position() {
  float x = 0, y = 0, z = 70; // cached Home coordinates before joystick movement
  TEST_ASSERT_TRUE(zeroAxisFromCounts(28446, 9, 100.2f, 0, x));
  TEST_ASSERT_TRUE(zeroAxisFromCounts(43201, 0, 100.13f, 0, y));
  TEST_ASSERT_TRUE(zeroAxisFromCounts(15312, 28000, 400, 70, z));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 283.8024f, x);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 431.4491f, y);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 38.28f, z);
}

void test_invalid_calibration_does_not_replace_position() {
  float position = 123;
  TEST_ASSERT_FALSE(zeroAxisFromCounts(1, 0, 0, 0, position));
  TEST_ASSERT_FALSE(zeroAxisFromCounts(1, 0, -1, 0, position));
  TEST_ASSERT_FALSE(zeroAxisFromCounts(1, 0, NAN, 0, position));
  TEST_ASSERT_FALSE(zeroAxisFromCounts(1, 0, INFINITY, 0, position));
  TEST_ASSERT_FALSE(zeroAxisFromCounts(1, 0, 1, NAN, position));
  TEST_ASSERT_EQUAL_FLOAT(123, position);
}

void test_count_subtraction_does_not_overflow_int32() {
  float position = 0;
  TEST_ASSERT_TRUE(zeroAxisFromCounts(INT32_MAX, INT32_MIN, 1000, 0, position));
  TEST_ASSERT_FLOAT_WITHIN(1, 4294967.295f, position);
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_settled_counts_replace_stale_position);
  RUN_TEST(test_invalid_calibration_does_not_replace_position);
  RUN_TEST(test_count_subtraction_does_not_overflow_int32);
  return UNITY_END();
}
