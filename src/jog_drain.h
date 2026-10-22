#pragma once
#include <stdint.h>

// Cooperative completion of an absolute jog stream. A move's `ok` only
// acknowledges admission; M400 must complete before position capture/Idle.
struct JogDrain {
  enum class Phase : uint8_t { Inactive, Moves, PlannerReady, PlannerAck,
                               PositionReady, PositionAck, Complete, Failed };
  Phase phase = Phase::Inactive;
  uint32_t phaseStartedAtMs = 0;
  bool positionSeen = false;
  static constexpr uint32_t timeoutMs = 10000;

  void begin(uint32_t now) {
    if (phase != Phase::Inactive) return; // duplicate release cannot extend the deadline
    phase = Phase::Moves;
    phaseStartedAtMs = now;
  }

  const char *nextCommand(uint8_t pendingMoves) {
    if (phase == Phase::Moves && pendingMoves == 0) phase = Phase::PlannerReady;
    if (phase == Phase::PlannerReady) return "M400";
    if (phase == Phase::PositionReady) return "M114";
    return nullptr;
  }

  void commandSent(uint32_t now) {
    if (phase == Phase::PlannerReady) phase = Phase::PlannerAck;
    else if (phase == Phase::PositionReady) {
      phase = Phase::PositionAck;
      positionSeen = false;
    } else return;
    phaseStartedAtMs = now;
  }

  void acknowledge(uint8_t &pendingMoves) {
    if (pendingMoves > 0) { --pendingMoves; return; }
    if (phase == Phase::PlannerAck) phase = Phase::PositionReady;
    else if (phase == Phase::PositionAck)
      phase = positionSeen ? Phase::Complete : Phase::Failed;
  }

  void notePosition() {
    if (phase == Phase::PositionAck) positionSeen = true;
  }

  bool timedOut(uint32_t now) const {
    return phase != Phase::Inactive && phase != Phase::Complete && phase != Phase::Failed &&
           static_cast<uint32_t>(now - phaseStartedAtMs) >= timeoutMs;
  }
};
