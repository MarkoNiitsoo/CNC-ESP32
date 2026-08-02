#include "ws_command_protocol.h"

#include <ArduinoJson.h>
#include <cstring>

namespace {

bool validIdentifier(const char *value, size_t maximum, bool action) {
  if (value == nullptr) return false;
  const size_t length = std::strlen(value);
  if (length == 0 || length > maximum) return false;
  for (size_t i = 0; i < length; ++i) {
    const char ch = value[i];
    const bool alphaNumeric = (ch >= 'a' && ch <= 'z') ||
                              (ch >= 'A' && ch <= 'Z') ||
                              (ch >= '0' && ch <= '9');
    const bool punctuation = ch == '-' || ch == '_' || ch == '.' || (!action && ch == ':');
    if (!alphaNumeric && !punctuation) return false;
  }
  return true;
}

std::string serializeResponse(JsonDocument &doc) {
  std::string output;
  serializeJson(doc, output);
  return output;
}

} // namespace

bool validWsCommandId(const char *value) {
  return validIdentifier(value, kWsCommandIdMaxLength, false);
}

bool validWsCommandAction(const char *value) {
  return validIdentifier(value, kWsCommandActionMaxLength, true);
}

std::string buildWsCommandAckJson(const char *commandId,
                                  bool accepted,
                                  bool inProgress,
                                  const char *code,
                                  const char *message) {
  JsonDocument doc;
  doc["protocolVersion"] = 1;
  doc["type"] = "commandAck";
  doc["commandId"] = commandId != nullptr ? commandId : "";
  doc["accepted"] = accepted;
  doc["inProgress"] = inProgress;
  doc["ok"] = false;
  doc["code"] = code != nullptr ? code : "";
  doc["message"] = message != nullptr ? message : "";
  return serializeResponse(doc);
}

std::string buildWsCommandResultJson(const char *commandId,
                                     bool ok,
                                     const char *code,
                                     const char *message) {
  JsonDocument doc;
  doc["protocolVersion"] = 1;
  doc["type"] = "commandResult";
  doc["commandId"] = commandId != nullptr ? commandId : "";
  doc["accepted"] = true;
  doc["inProgress"] = false;
  doc["ok"] = ok;
  doc["code"] = code != nullptr ? code : (ok ? "OK" : "ERROR");
  doc["message"] = message != nullptr ? message : "";
  return serializeResponse(doc);
}
