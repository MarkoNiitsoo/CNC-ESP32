#pragma once

#include <stddef.h>
#include <string>

constexpr size_t kWsCommandIdMaxLength = 96;
constexpr size_t kWsCommandActionMaxLength = 64;
constexpr size_t kWsCommandPayloadMaxBytes = 4096;
constexpr size_t kWsCommandMessageMaxBytes = 6144;

bool validWsCommandId(const char *value);
bool validWsCommandAction(const char *value);

std::string buildWsCommandAckJson(const char *commandId,
                                  bool accepted,
                                  bool inProgress,
                                  const char *code,
                                  const char *message);

std::string buildWsCommandResultJson(const char *commandId,
                                     bool ok,
                                     const char *code,
                                     const char *message);
