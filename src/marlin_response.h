#pragma once

#include <ctype.h>

// Marlin uses mixed-case Error:/ALARM: replies. Keep both synchronous and
// cooperative transactions on the same error rule, without allocating a copy.
inline bool marlinResponseHasError(const char *response) {
  if (!response) return false;
  const char *tokens[] = {"error:", "alarm:", "!!"};
  for (const char *cursor = response; *cursor; ++cursor) {
    for (const char *token : tokens) {
      const char *candidate = cursor;
      const char *expected = token;
      while (*candidate && *expected &&
             tolower(static_cast<unsigned char>(*candidate)) == *expected) {
        ++candidate;
        ++expected;
      }
      if (!*expected) return true;
    }
  }
  return false;
}
