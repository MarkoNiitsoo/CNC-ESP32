#pragma once
#include <stdint.h>
#include <math.h>

// Derive the zero from the settled M114 counts, never the cached UI position.
inline bool zeroAxisFromCounts(int32_t count, int32_t homeCount, float steps,
                               float homePosition, float &position) {
  if (!isfinite(steps) || steps <= 0 || !isfinite(homePosition)) return false;
  const double captured = homePosition +
      (static_cast<double>(count) - static_cast<double>(homeCount)) / steps;
  if (!isfinite(captured)) return false;
  position = static_cast<float>(captured);
  return isfinite(position);
}
