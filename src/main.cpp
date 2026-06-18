#include <Arduino.h>
#include <Preferences.h>
#include <SD_MMC.h>
#include <SPIFFS.h>
#include <Update.h>
#include <WebServer.h>
#include <WiFi.h>

namespace {
constexpr const char *kFirmwareName = "LowRider CNC Pendant";
constexpr const char *firmwareVersion = "0.4.3-feed-override";
constexpr const char *buildDate = __DATE__;
constexpr const char *buildTime = __TIME__;
constexpr const char *kSetupApSsid = "LowRider-CNC-Setup";
constexpr const char *kSetupApPassword = "12345678";
constexpr const char *kWifiPrefsNamespace = "wifi";
constexpr const char *kWifiPrefsSsidKey = "ssid";
constexpr const char *kWifiPrefsPassKey = "pass";
constexpr const char *kSdUpdateBinPath = "/firmware/update.bin";
constexpr const char *kSdInstallMarkerPath = "/firmware/INSTALL.NOW";
constexpr const char *kSdDoneBinPath = "/firmware/update.done.bin";
constexpr const char *kSdFailedMarkerPath = "/firmware/INSTALL.FAILED";
constexpr const char *kSdUpdateLogPath = "/logs/update.log";
constexpr const char *kSdJobLogPath = "/logs/job.log";
constexpr const char *kSdRoots[] = {"/gcode", "/www", "/firmware", "/jobs", "/logs"};
constexpr uint32_t kMarlinBaudrate = 250000;
constexpr uint32_t kMarlinTimeoutMs = 1500;
constexpr uint32_t kStaConnectTimeoutMs = 15000;
constexpr uint32_t kJogTickIntervalMs = 150;
constexpr uint32_t kJogDeadmanMs = 500;
constexpr float kJogMaxXyStepMm = 2.0f;
constexpr float kJogMaxZStepMm = 0.5f;
constexpr size_t kMaxGcodeLineLength = 180;
constexpr int kMarlinRxPin = 3;
constexpr int kMarlinTxPin = 1;

enum class JobRunnerState {
  Idle,
  Preparing,
  Running,
  Pausing,
  Paused,
  Resuming,
  Completed,
  Stopping,
  Stopped,
  Error,
};

struct JobRunnerStatus {
  JobRunnerState state = JobRunnerState::Idle;
  String gcodePath;
  String jobPath;
  String startMode = "apply_current_position_as_work_zero";
  bool allowedWorkspaceCommands = false;
  size_t fileSize = 0;
  size_t currentByteOffset = 0;
  uint32_t sentLineCount = 0;
  uint32_t acknowledgedLineCount = 0;
  uint32_t currentLineNumber = 0;
  bool pauseRequested = false;
  bool stopRequested = false;
  bool priorityCommandInProgress = false;
  int feedOverridePercent = 100;
  bool resetFeedOverrideAfterJob = true;
  String lastCommand;
  String lastResponse;
  String lastError;
  String lastPriorityCommand;
  String lastPriorityResponse;
  String lastPriorityError;
  String lastFeedOverrideCommand;
  String lastFeedOverrideResponse;
  String lastFeedOverrideError;
  String streamingPausedReason;
  uint32_t startedAtMs = 0;
  uint32_t updatedAtMs = 0;
  uint32_t pausedAtMs = 0;
  uint32_t completedAtMs = 0;
};

enum class JogState {
  Idle,
  PreparingSafeZ,
  Jogging,
  Stopping,
  Error,
};

struct JogStatus {
  JogState state = JogState::Idle;
  bool safeJog = true;
  bool zLiftedForJog = false;
  float safeLiftZ = 5.0f;
  float xyFeedMax = 2000.0f;
  float zFeedMax = 400.0f;
  float x = 0.0f;
  float y = 0.0f;
  float z = 0.0f;
  float speed = 0.0f;
  String lastCommand;
  String lastError;
  uint32_t startedAtMs = 0;
  uint32_t lastUpdateMs = 0;
  uint32_t lastTickMs = 0;
};

WebServer server(80);
Preferences wifiPrefs;
String activeWifiMode = "ap";
String activeWifiSsid = kSetupApSsid;
bool jobRunning = false; // TODO: Replace with real Marlin job state tracking.
bool otaActive = false;
bool otaUploadSeen = false;
bool otaUploadOk = false;
uint32_t rebootAtMs = 0;
String otaError;
bool sdMounted = false;
File uploadFile;
String uploadError;
String uploadTargetPath;
bool uploadSeen = false;
bool uploadOk = false;
File jobFile;
JobRunnerStatus jobStatus;
bool jobWaitingForOk = false;
String jobResponseBuffer;
JogStatus jogStatus;
String priorityCommands[4];
uint8_t priorityCommandCount = 0;
uint8_t priorityCommandIndex = 0;
String priorityResponseBuffer;
uint32_t priorityCommandStartedAtMs = 0;

String readJobJsonSnippet(const String &jobPath);
bool jobJsonAllowsWorkspaceCommands(const String &jobPath);
String extractWorkspaceCommand(const String &line);
bool handleWorkspaceCommand(const String &line);
bool runJobStartPreamble();
bool responseContainsToken(const String &response, const char *token);
void resetFeedOverrideAfterJobIfNeeded();

String jsonEscape(const String &value) {
  String out;
  out.reserve(value.length() + 8);

  for (size_t i = 0; i < value.length(); ++i) {
    const char c = value[i];
    switch (c) {
    case '\\':
      out += "\\\\";
      break;
    case '"':
      out += "\\\"";
      break;
    case '\n':
      out += "\\n";
      break;
    case '\r':
      out += "\\r";
      break;
    case '\t':
      out += "\\t";
      break;
    default:
      if (static_cast<uint8_t>(c) < 0x20) {
        out += ' ';
      } else {
        out += c;
      }
      break;
    }
  }

  return out;
}

String htmlEscape(const String &value) {
  String out;
  out.reserve(value.length() + 8);

  for (size_t i = 0; i < value.length(); ++i) {
    const char c = value[i];
    switch (c) {
    case '&':
      out += "&amp;";
      break;
    case '<':
      out += "&lt;";
      break;
    case '>':
      out += "&gt;";
      break;
    case '"':
      out += "&quot;";
      break;
    default:
      out += c;
      break;
    }
  }

  return out;
}

bool isAllowedRoot(const String &path) {
  for (const char *root : kSdRoots) {
    if (path == root) {
      return true;
    }

    String prefix = String(root) + "/";
    if (path.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

String normalizeSdPath(String path) {
  path.trim();
  while (path.length() > 1 && path.endsWith("/")) {
    path.remove(path.length() - 1);
  }
  return path;
}

bool isRootDirectory(const String &path) {
  for (const char *root : kSdRoots) {
    if (path == root) {
      return true;
    }
  }

  return false;
}

bool isSafeSdPath(const String &path) {
  if (!path.startsWith("/") || path.indexOf("..") >= 0 || path.indexOf("//") >= 0 ||
      path.indexOf('\\') >= 0) {
    return false;
  }

  return isAllowedRoot(path);
}

bool isPathUnderRoot(const String &path, const char *root) {
  if (!isSafeSdPath(path)) {
    return false;
  }

  const String prefix = String(root) + "/";
  return path.startsWith(prefix);
}

bool isSafeFileName(const String &name) {
  return name.length() > 0 && name.indexOf("..") < 0 && name.indexOf('/') < 0 &&
         name.indexOf('\\') < 0;
}

String extractJsonString(const String &body, const char *field) {
  String key = "\"";
  key += field;
  key += "\"";

  const int keyIndex = body.indexOf(key);
  if (keyIndex < 0) {
    return "";
  }

  const int colon = body.indexOf(':', keyIndex);
  if (colon < 0) {
    return "";
  }

  const int firstQuote = body.indexOf('"', colon + 1);
  if (firstQuote < 0) {
    return "";
  }

  String value;
  bool escaped = false;
  for (int i = firstQuote + 1; i < body.length(); ++i) {
    const char c = body[i];
    if (escaped) {
      value += c;
      escaped = false;
    } else if (c == '\\') {
      escaped = true;
    } else if (c == '"') {
      break;
    } else {
      value += c;
    }
  }

  value.trim();
  return value;
}

float extractJsonFloat(const String &body, const char *field, float fallback) {
  String key = "\"";
  key += field;
  key += "\"";

  const int keyIndex = body.indexOf(key);
  if (keyIndex < 0) {
    return fallback;
  }

  const int colon = body.indexOf(':', keyIndex);
  if (colon < 0) {
    return fallback;
  }

  int end = colon + 1;
  while (end < body.length() && (body[end] == ' ' || body[end] == '\t')) {
    ++end;
  }

  String number;
  while (end < body.length()) {
    const char c = body[end];
    if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.') {
      number += c;
      ++end;
    } else {
      break;
    }
  }

  number.trim();
  return number.length() > 0 ? number.toFloat() : fallback;
}

int extractJsonInt(const String &body, const char *field, int fallback) {
  return static_cast<int>(extractJsonFloat(body, field, static_cast<float>(fallback)));
}

bool extractJsonBool(const String &body, const char *field, bool fallback) {
  String key = "\"";
  key += field;
  key += "\"";

  const int keyIndex = body.indexOf(key);
  if (keyIndex < 0) {
    return fallback;
  }

  const int colon = body.indexOf(':', keyIndex);
  if (colon < 0) {
    return fallback;
  }

  String tail = body.substring(colon + 1);
  tail.trim();
  if (tail.startsWith("true")) {
    return true;
  }
  if (tail.startsWith("false")) {
    return false;
  }
  return fallback;
}

float clampFloat(float value, float minValue, float maxValue) {
  if (value < minValue) {
    return minValue;
  }
  if (value > maxValue) {
    return maxValue;
  }
  return value;
}

String sdCardTypeName() {
  if (!sdMounted) {
    return "none";
  }

  switch (SD_MMC.cardType()) {
  case CARD_MMC:
    return "MMC";
  case CARD_SD:
    return "SDSC";
  case CARD_SDHC:
    return "SDHC";
  default:
    return "unknown";
  }
}

String sdStatusJson() {
  const uint64_t total = sdMounted ? SD_MMC.totalBytes() : 0;
  const uint64_t used = sdMounted ? SD_MMC.usedBytes() : 0;
  String json = "{";
  json += "\"mounted\":";
  json += sdMounted ? "true" : "false";
  json += ",\"cardType\":\"";
  json += sdCardTypeName();
  json += "\",\"totalBytes\":";
  json += String(total);
  json += ",\"usedBytes\":";
  json += String(used);
  json += ",\"freeBytes\":";
  json += String(total > used ? total - used : 0);
  json += "}";
  return json;
}

const char *jobStateName(JobRunnerState state) {
  switch (state) {
  case JobRunnerState::Idle:
    return "IDLE";
  case JobRunnerState::Preparing:
    return "PREPARING";
  case JobRunnerState::Running:
    return "RUNNING";
  case JobRunnerState::Pausing:
    return "PAUSING";
  case JobRunnerState::Paused:
    return "PAUSED";
  case JobRunnerState::Resuming:
    return "RESUMING";
  case JobRunnerState::Completed:
    return "COMPLETED";
  case JobRunnerState::Stopping:
    return "STOPPING";
  case JobRunnerState::Stopped:
    return "STOPPED";
  case JobRunnerState::Error:
    return "ERROR";
  }

  return "ERROR";
}

bool jobIsActive() {
  return jobStatus.state == JobRunnerState::Preparing || jobStatus.state == JobRunnerState::Running ||
         jobStatus.state == JobRunnerState::Pausing || jobStatus.state == JobRunnerState::Paused ||
         jobStatus.state == JobRunnerState::Resuming || jobStatus.state == JobRunnerState::Stopping;
}

void touchJobStatus() {
  jobStatus.updatedAtMs = millis();
}

void logJobEvent(const String &event) {
  if (!sdMounted) {
    return;
  }

  SD_MMC.mkdir("/logs");
  File logFile = SD_MMC.open(kSdJobLogPath, FILE_APPEND);
  if (!logFile) {
    return;
  }

  logFile.print(millis());
  logFile.print(" ");
  logFile.println(event);
  logFile.close();
}

String jobStatusJson() {
  const float progress = jobStatus.fileSize > 0
                             ? (static_cast<float>(jobStatus.currentByteOffset) * 100.0f) /
                                   static_cast<float>(jobStatus.fileSize)
                             : 0.0f;
  String json = "{";
  json += "\"state\":\"";
  json += jobStateName(jobStatus.state);
  json += "\",\"gcodePath\":\"";
  json += jsonEscape(jobStatus.gcodePath);
  json += "\",\"jobPath\":\"";
  json += jsonEscape(jobStatus.jobPath);
  json += "\",\"startMode\":\"";
  json += jsonEscape(jobStatus.startMode);
  json += "\",\"allowedWorkspaceCommands\":";
  json += jobStatus.allowedWorkspaceCommands ? "true" : "false";
  json += ",\"fileSize\":";
  json += String(jobStatus.fileSize);
  json += ",\"currentByteOffset\":";
  json += String(jobStatus.currentByteOffset);
  json += ",\"progressPercent\":";
  json += String(progress, 1);
  json += ",\"sentLineCount\":";
  json += String(jobStatus.sentLineCount);
  json += ",\"acknowledgedLineCount\":";
  json += String(jobStatus.acknowledgedLineCount);
  json += ",\"currentLineNumber\":";
  json += String(jobStatus.currentLineNumber);
  json += ",\"pauseRequested\":";
  json += jobStatus.pauseRequested ? "true" : "false";
  json += ",\"stopRequested\":";
  json += jobStatus.stopRequested ? "true" : "false";
  json += ",\"priorityCommandInProgress\":";
  json += jobStatus.priorityCommandInProgress ? "true" : "false";
  json += ",\"feedOverridePercent\":";
  json += String(jobStatus.feedOverridePercent);
  json += ",\"lastCommand\":\"";
  json += jsonEscape(jobStatus.lastCommand);
  json += "\",\"lastResponse\":\"";
  json += jsonEscape(jobStatus.lastResponse);
  json += "\",\"lastError\":\"";
  json += jsonEscape(jobStatus.lastError);
  json += "\",\"lastPriorityCommand\":\"";
  json += jsonEscape(jobStatus.lastPriorityCommand);
  json += "\",\"lastPriorityResponse\":\"";
  json += jsonEscape(jobStatus.lastPriorityResponse);
  json += "\",\"lastPriorityError\":\"";
  json += jsonEscape(jobStatus.lastPriorityError);
  json += "\",\"lastFeedOverrideCommand\":\"";
  json += jsonEscape(jobStatus.lastFeedOverrideCommand);
  json += "\",\"lastFeedOverrideResponse\":\"";
  json += jsonEscape(jobStatus.lastFeedOverrideResponse);
  json += "\",\"lastFeedOverrideError\":\"";
  json += jsonEscape(jobStatus.lastFeedOverrideError);
  json += "\",\"streamingPausedReason\":\"";
  json += jsonEscape(jobStatus.streamingPausedReason);
  json += "\",\"uptimeMs\":";
  json += String(millis());
  json += "}";
  return json;
}

String jobStatusJsonWithMessage(const String &message) {
  String json = jobStatusJson();
  json.remove(json.length() - 1);
  json += ",\"ok\":true,\"message\":\"";
  json += jsonEscape(message);
  json += "\"}";
  return json;
}

const char *jogStateName(JogState state) {
  switch (state) {
  case JogState::Idle:
    return "IDLE";
  case JogState::PreparingSafeZ:
    return "PREPARING_SAFE_Z";
  case JogState::Jogging:
    return "JOGGING";
  case JogState::Stopping:
    return "STOPPING";
  case JogState::Error:
    return "ERROR";
  }
  return "ERROR";
}

bool jogIsActive() {
  return jogStatus.state == JogState::PreparingSafeZ || jogStatus.state == JogState::Jogging ||
         jogStatus.state == JogState::Stopping;
}

String jogStatusJson() {
  const uint32_t now = millis();
  String json = "{";
  json += "\"state\":\"";
  json += jogStateName(jogStatus.state);
  json += "\",\"zLiftedForJog\":";
  json += jogStatus.zLiftedForJog ? "true" : "false";
  json += ",\"safeJog\":";
  json += jogStatus.safeJog ? "true" : "false";
  json += ",\"safeLiftZ\":";
  json += String(jogStatus.safeLiftZ, 2);
  json += ",\"xyFeedMax\":";
  json += String(jogStatus.xyFeedMax, 0);
  json += ",\"zFeedMax\":";
  json += String(jogStatus.zFeedMax, 0);
  json += ",\"lastCommand\":\"";
  json += jsonEscape(jogStatus.lastCommand);
  json += "\",\"lastError\":\"";
  json += jsonEscape(jogStatus.lastError);
  json += "\",\"heartbeatAgeMs\":";
  json += String(jogStatus.lastUpdateMs > 0 ? now - jogStatus.lastUpdateMs : 0);
  json += ",\"uptimeMs\":";
  json += String(now);
  json += "}";
  return json;
}

bool initializeSdCard() {
  if (!sdMounted) {
    sdMounted = SD_MMC.begin("/sdcard", true);
  }

  if (!sdMounted) {
    return false;
  }

  for (const char *root : kSdRoots) {
    SD_MMC.mkdir(root);
  }

  return true;
}

void logSdUpdate(const String &message) {
  Serial.println(message);

  SD_MMC.mkdir("/logs");
  File logFile = SD_MMC.open(kSdUpdateLogPath, FILE_APPEND);
  if (!logFile) {
    return;
  }

  logFile.print(millis());
  logFile.print(" ");
  logFile.println(message);
  logFile.close();
}

void markSdUpdateFailed(const String &message) {
  logSdUpdate("SD rescue update failed: " + message);
  SD_MMC.remove(kSdInstallMarkerPath);

  File failed = SD_MMC.open(kSdFailedMarkerPath, FILE_WRITE);
  if (failed) {
    failed.println(message);
    failed.close();
  }
}

bool checkForSdRescueUpdate() {
  if (!initializeSdCard()) {
    Serial.println("SD rescue update: SD card not available");
    return false;
  }

  if (!SD_MMC.exists(kSdInstallMarkerPath)) {
    return false;
  }

  if (!SD_MMC.exists(kSdUpdateBinPath)) {
    markSdUpdateFailed("INSTALL.NOW exists but /firmware/update.bin is missing");
    return false;
  }

  logSdUpdate("SD rescue update marker and firmware found");
  return true;
}

bool performSdRescueUpdate() {
  File updateFile = SD_MMC.open(kSdUpdateBinPath, FILE_READ);
  if (!updateFile) {
    markSdUpdateFailed("Could not open /firmware/update.bin");
    return false;
  }

  const size_t fileSize = updateFile.size();
  const size_t maxSketchSpace = ESP.getFreeSketchSpace();

  if (fileSize == 0) {
    updateFile.close();
    markSdUpdateFailed("/firmware/update.bin is empty");
    return false;
  }

  if (fileSize > maxSketchSpace) {
    updateFile.close();
    markSdUpdateFailed("update.bin is larger than free sketch space");
    return false;
  }

  logSdUpdate("Starting SD rescue update, bytes: " + String(fileSize));
  if (!Update.begin(fileSize)) {
    const String error = Update.errorString();
    updateFile.close();
    markSdUpdateFailed("Update.begin failed: " + error);
    return false;
  }

  const size_t written = Update.writeStream(updateFile);
  updateFile.close();
  logSdUpdate("SD rescue update bytes written: " + String(written));

  if (written != fileSize) {
    const String error = Update.errorString();
    Update.abort();
    markSdUpdateFailed("Update.writeStream wrote " + String(written) + " of " + String(fileSize) + ": " + error);
    return false;
  }

  if (!Update.end()) {
    const String error = Update.errorString();
    markSdUpdateFailed("Update.end failed: " + error);
    return false;
  }

  if (!Update.isFinished()) {
    markSdUpdateFailed("Update did not finish");
    return false;
  }

  SD_MMC.remove(kSdInstallMarkerPath);
  SD_MMC.remove(kSdDoneBinPath);
  if (!SD_MMC.rename(kSdUpdateBinPath, kSdDoneBinPath)) {
    logSdUpdate("SD rescue update succeeded, but update.bin could not be renamed");
  } else {
    logSdUpdate("SD rescue update renamed update.bin to update.done.bin");
  }

  logSdUpdate("SD rescue update succeeded; rebooting");
  return true;
}

String extractCmdFromJson(const String &body) {
  const int key = body.indexOf("\"cmd\"");
  if (key < 0) {
    return "";
  }

  const int colon = body.indexOf(':', key);
  if (colon < 0) {
    return "";
  }

  const int firstQuote = body.indexOf('"', colon + 1);
  if (firstQuote < 0) {
    return "";
  }

  String cmd;
  bool escaped = false;
  for (int i = firstQuote + 1; i < body.length(); ++i) {
    const char c = body[i];
    if (escaped) {
      cmd += c;
      escaped = false;
    } else if (c == '\\') {
      escaped = true;
    } else if (c == '"') {
      break;
    } else {
      cmd += c;
    }
  }

  cmd.trim();
  return cmd;
}

String readMarlinResponse() {
  String response;
  const uint32_t start = millis();

  while (millis() - start < kMarlinTimeoutMs) {
    while (Serial.available() > 0) {
      response += static_cast<char>(Serial.read());
    }
    delay(5);
  }

  return response;
}

String readMarlinResponseFor(uint32_t timeoutMs) {
  String response;
  const uint32_t start = millis();

  while (millis() - start < timeoutMs) {
    while (Serial.available() > 0) {
      response += static_cast<char>(Serial.read());
    }
    delay(5);
  }

  return response;
}

void drainMarlinInput() {
  while (Serial.available() > 0) {
    Serial.read();
  }
}

void sendMarlinSafetyCommand(const char *cmd) {
  drainMarlinInput();
  Serial.print(cmd);
  Serial.print('\n');
  readMarlinResponseFor(250);
}

bool isFeedOverrideCommand(const String &cmd) {
  String upper = cmd;
  upper.toUpperCase();
  upper.trim();
  return upper.startsWith("M220");
}

void noteFeedOverrideResult(const String &cmd, const String &response, const String &error = "") {
  if (!isFeedOverrideCommand(cmd)) {
    return;
  }

  jobStatus.lastFeedOverrideCommand = cmd;
  jobStatus.lastFeedOverrideResponse = response;
  jobStatus.lastFeedOverrideError = error;
}

String feedOverrideCommand(int percent) {
  String cmd = "M220 S";
  cmd += String(percent);
  return cmd;
}

bool sendFeedOverrideImmediate(int percent) {
  const String cmd = feedOverrideCommand(percent);
  drainMarlinInput();
  Serial.print(cmd);
  Serial.print('\n');
  const String response = readMarlinResponseFor(250);
  jobStatus.feedOverridePercent = percent;
  noteFeedOverrideResult(cmd, response);
  logJobEvent("feed override: " + cmd);
  touchJobStatus();
  return true;
}

void clearPriorityCommands() {
  priorityCommandCount = 0;
  priorityCommandIndex = 0;
  priorityResponseBuffer = "";
  priorityCommandStartedAtMs = 0;
  jobStatus.priorityCommandInProgress = false;
}

void queuePriorityCommands(const char *first, const char *second = nullptr) {
  clearPriorityCommands();
  priorityCommands[priorityCommandCount++] = first;
  if (second != nullptr) {
    priorityCommands[priorityCommandCount++] = second;
  }
  jobStatus.lastPriorityCommand = "";
  jobStatus.lastPriorityResponse = "";
  jobStatus.lastPriorityError = "";
}

void startNextPriorityCommand() {
  if (priorityCommandIndex >= priorityCommandCount) {
    jobStatus.priorityCommandInProgress = false;
    return;
  }

  const String &cmd = priorityCommands[priorityCommandIndex];
  Serial.print(cmd);
  Serial.print('\n');
  jobStatus.lastPriorityCommand = cmd;
  if (isFeedOverrideCommand(cmd)) {
    jobStatus.lastFeedOverrideCommand = cmd;
    jobStatus.lastFeedOverrideResponse = "";
    jobStatus.lastFeedOverrideError = "";
  }
  jobStatus.priorityCommandInProgress = true;
  priorityResponseBuffer = "";
  priorityCommandStartedAtMs = millis();
  logJobEvent("priority: " + cmd);
}

void finishPrioritySequence() {
  clearPriorityCommands();
  if (jobStatus.state == JobRunnerState::Pausing) {
    if (jobFile) {
      jobFile.close();
    }
    jobWaitingForOk = false;
    jobResponseBuffer = "";
    jobStatus.state = JobRunnerState::Paused;
    jobStatus.pauseRequested = false;
    jobStatus.pausedAtMs = millis();
    jobStatus.streamingPausedReason = "Pause requested. Streaming stopped.";
    logJobEvent("paused: " + jobStatus.gcodePath);
  } else if (jobStatus.state == JobRunnerState::Stopping) {
    if (jobFile) {
      jobFile.close();
    }
    jobWaitingForOk = false;
    jobResponseBuffer = "";
    jobRunning = false;
    jobStatus.state = JobRunnerState::Stopped;
    jobStatus.pauseRequested = false;
    jobStatus.stopRequested = false;
    jobStatus.streamingPausedReason = "Stop requested. Streaming stopped.";
    resetFeedOverrideAfterJobIfNeeded();
    logJobEvent("stopped: " + jobStatus.gcodePath);
  }
  touchJobStatus();
}

void processPriorityCommands() {
  if (priorityCommandCount == 0) {
    return;
  }

  while (Serial.available() > 0) {
    priorityResponseBuffer += static_cast<char>(Serial.read());
  }

  if (!jobStatus.priorityCommandInProgress) {
    startNextPriorityCommand();
    touchJobStatus();
    return;
  }

  if (responseContainsToken(priorityResponseBuffer, "Error:")) {
    jobStatus.lastPriorityResponse = priorityResponseBuffer;
    jobStatus.lastPriorityError = "Marlin reported Error for priority command";
    noteFeedOverrideResult(jobStatus.lastPriorityCommand, priorityResponseBuffer, jobStatus.lastPriorityError);
    clearPriorityCommands();
    if (jobStatus.state == JobRunnerState::Pausing || jobStatus.state == JobRunnerState::Stopping) {
      jobStatus.state = JobRunnerState::Error;
      jobStatus.lastError = jobStatus.lastPriorityError;
      jobRunning = false;
    }
    touchJobStatus();
    logJobEvent("priority error: " + jobStatus.lastPriorityError);
    return;
  }

  if (!responseContainsToken(priorityResponseBuffer, "ok")) {
    if (millis() - priorityCommandStartedAtMs > kMarlinTimeoutMs) {
      jobStatus.lastPriorityResponse = priorityResponseBuffer;
      jobStatus.lastPriorityError = "Priority command timed out";
      noteFeedOverrideResult(jobStatus.lastPriorityCommand, priorityResponseBuffer, jobStatus.lastPriorityError);
      clearPriorityCommands();
      if (jobStatus.state == JobRunnerState::Pausing || jobStatus.state == JobRunnerState::Stopping) {
        jobStatus.state = JobRunnerState::Error;
        jobStatus.lastError = jobStatus.lastPriorityError;
        jobRunning = false;
      }
      touchJobStatus();
      logJobEvent("priority timeout");
    }
    return;
  }

  jobStatus.lastPriorityResponse = priorityResponseBuffer;
  noteFeedOverrideResult(jobStatus.lastPriorityCommand, priorityResponseBuffer);
  priorityCommandIndex += 1;
  jobStatus.priorityCommandInProgress = false;
  priorityResponseBuffer = "";
  priorityCommandStartedAtMs = 0;

  if (priorityCommandIndex >= priorityCommandCount) {
    finishPrioritySequence();
  } else {
    startNextPriorityCommand();
  }
  touchJobStatus();
}

void sendJogCommand(const String &cmd) {
  drainMarlinInput();
  Serial.print(cmd);
  Serial.print('\n');
  jogStatus.lastCommand = cmd;
  readMarlinResponseFor(80);
}

void stopJogInternal(bool sendStopCommands) {
  if (!sendStopCommands && !jogIsActive() && jogStatus.state != JogState::Error) {
    return;
  }

  jogStatus.state = JogState::Stopping;
  jogStatus.x = 0;
  jogStatus.y = 0;
  jogStatus.z = 0;
  jogStatus.speed = 0;
  if (sendStopCommands) {
    sendJogCommand("M410");
    sendJogCommand("M5");
  } else {
    sendJogCommand("M400");
  }
  jogStatus.state = JogState::Idle;
}

void setJogError(const String &message) {
  jogStatus.lastError = message;
  jogStatus.state = JogState::Error;
  jogStatus.x = 0;
  jogStatus.y = 0;
  jogStatus.z = 0;
  jogStatus.speed = 0;
}

bool prepareSafeJogLift() {
  if (!jogStatus.safeJog) {
    jogStatus.zLiftedForJog = false;
    return true;
  }

  if (jogStatus.safeLiftZ <= 0 || jogStatus.zFeedMax <= 0) {
    setJogError("invalid safe Z lift settings");
    return false;
  }

  jogStatus.state = JogState::PreparingSafeZ;
  sendJogCommand("M5");
  sendJogCommand("G91");
  sendJogCommand("G0 Z" + String(jogStatus.safeLiftZ, 3) + " F" + String(jogStatus.zFeedMax, 0));
  sendJogCommand("G90");
  jogStatus.zLiftedForJog = true;
  return true;
}

void processJogRunner() {
  if (jogStatus.state != JogState::Jogging) {
    return;
  }

  const uint32_t now = millis();
  if (jogStatus.lastUpdateMs == 0 || now - jogStatus.lastUpdateMs > kJogDeadmanMs) {
    jogStatus.lastError = "jog heartbeat timeout; stopped jogging";
    stopJogInternal(false);
    return;
  }

  if (now - jogStatus.lastTickMs < kJogTickIntervalMs) {
    return;
  }

  const float speed = clampFloat(jogStatus.speed, 0.0f, 1.0f);
  const float x = clampFloat(jogStatus.x, -1.0f, 1.0f);
  const float y = clampFloat(jogStatus.y, -1.0f, 1.0f);
  const float z = clampFloat(jogStatus.z, -1.0f, 1.0f);
  const float xyScale = kJogMaxXyStepMm * speed;
  const float zScale = kJogMaxZStepMm * speed;
  const float dx = x * xyScale;
  const float dy = y * xyScale;
  const float dz = z * zScale;
  if (fabs(dx) < 0.01f && fabs(dy) < 0.01f && fabs(dz) < 0.005f) {
    return;
  }
  if (jogStatus.safeJog && (fabs(dx) >= 0.01f || fabs(dy) >= 0.01f) && !jogStatus.zLiftedForJog) {
    setJogError("safe jog Z lift is required before X/Y jogging");
    return;
  }

  String cmd = "G91\nG0";
  if (fabs(dx) >= 0.01f) {
    cmd += " X";
    cmd += String(dx, 3);
  }
  if (fabs(dy) >= 0.01f) {
    cmd += " Y";
    cmd += String(dy, 3);
  }
  if (fabs(dz) >= 0.005f) {
    cmd += " Z";
    cmd += String(dz, 3);
  }
  const float feed = fabs(dz) >= 0.005f && fabs(dx) < 0.01f && fabs(dy) < 0.01f
                         ? jogStatus.zFeedMax * max(speed, 0.1f)
                         : jogStatus.xyFeedMax * max(speed, 0.1f);
  cmd += " F";
  cmd += String(feed, 0);
  cmd += "\nG90";

  drainMarlinInput();
  Serial.print(cmd);
  Serial.print('\n');
  jogStatus.lastCommand = cmd;
  readMarlinResponseFor(60);
  jogStatus.lastTickMs = now;
}

String stripParenComments(const String &line) {
  String out;
  bool inComment = false;

  for (size_t i = 0; i < line.length(); ++i) {
    const char c = line[i];
    if (c == '(') {
      inComment = true;
      continue;
    }
    if (c == ')' && inComment) {
      inComment = false;
      continue;
    }
    if (!inComment) {
      out += c;
    }
  }

  return out;
}

String cleanGcodeLine(String line) {
  line.replace("\r", "");
  const int semicolon = line.indexOf(';');
  if (semicolon >= 0) {
    line = line.substring(0, semicolon);
  }
  line = stripParenComments(line);
  line.trim();
  return line;
}

void setJobError(const String &message) {
  if (jobFile) {
    jobFile.close();
  }
  resetFeedOverrideAfterJobIfNeeded();
  clearPriorityCommands();
  jobWaitingForOk = false;
  jobRunning = false;
  jobStatus.pauseRequested = false;
  jobStatus.stopRequested = false;
  jobStatus.state = JobRunnerState::Error;
  jobStatus.lastError = message;
  touchJobStatus();
  logJobEvent("error: " + message);
}

bool openJobFileAtOffset() {
  if (jobFile) {
    jobFile.close();
  }

  jobFile = SD_MMC.open(jobStatus.gcodePath, FILE_READ);
  if (!jobFile || jobFile.isDirectory()) {
    setJobError("could not open G-code file");
    return false;
  }

  if (jobStatus.currentByteOffset > 0 && !jobFile.seek(jobStatus.currentByteOffset)) {
    setJobError("could not seek G-code file");
    return false;
  }

  return true;
}

bool readNextCleanJobLine(String &cleanedLine) {
  cleanedLine = "";
  String raw;

  while (jobFile && jobFile.available()) {
    const char c = static_cast<char>(jobFile.read());
    jobStatus.currentByteOffset = jobFile.position();

    if (c == '\n') {
      cleanedLine = cleanGcodeLine(raw);
      if (cleanedLine.length() == 0) {
        raw = "";
        continue;
      }
      return true;
    }

    raw += c;
    if (raw.length() > kMaxGcodeLineLength) {
      setJobError("G-code line is too long");
      return false;
    }
  }

  if (raw.length() > 0) {
    cleanedLine = cleanGcodeLine(raw);
    return cleanedLine.length() > 0;
  }

  return false;
}

bool responseContainsToken(const String &response, const char *token) {
  String lowerResponse = response;
  String lowerToken = token;
  lowerResponse.toLowerCase();
  lowerToken.toLowerCase();
  return lowerResponse.indexOf(lowerToken) >= 0;
}

void completeJob() {
  if (jobFile) {
    jobFile.close();
  }
  resetFeedOverrideAfterJobIfNeeded();
  clearPriorityCommands();
  jobWaitingForOk = false;
  jobRunning = false;
  jobStatus.pauseRequested = false;
  jobStatus.stopRequested = false;
  jobStatus.streamingPausedReason = "";
  jobStatus.state = JobRunnerState::Completed;
  jobStatus.completedAtMs = millis();
  touchJobStatus();
  logJobEvent("completed: " + jobStatus.gcodePath);
}

void processJobRunner() {
  if (priorityCommandCount > 0) {
    processPriorityCommands();
  }

  if (jobStatus.state == JobRunnerState::Pausing || jobStatus.state == JobRunnerState::Stopping) {
    return;
  }

  if (jobStatus.state == JobRunnerState::Resuming) {
    jobStatus.state = JobRunnerState::Running;
    touchJobStatus();
  }

  if (jobStatus.state != JobRunnerState::Running) {
    return;
  }

  if (jobStatus.pauseRequested || jobStatus.stopRequested) {
    return;
  }

  while (Serial.available() > 0) {
    jobResponseBuffer += static_cast<char>(Serial.read());
  }

  if (jobWaitingForOk) {
    if (responseContainsToken(jobResponseBuffer, "Error:")) {
      jobStatus.lastResponse = jobResponseBuffer;
      setJobError("Marlin reported Error");
      return;
    }
    if (responseContainsToken(jobResponseBuffer, "Resend:")) {
      jobStatus.lastResponse = jobResponseBuffer;
      setJobError("Marlin requested Resend; TODO: add line-numbered resend support");
      return;
    }
    if (!responseContainsToken(jobResponseBuffer, "ok")) {
      return;
    }

    jobStatus.acknowledgedLineCount += 1;
    jobStatus.lastResponse = jobResponseBuffer;
    jobResponseBuffer = "";
    jobWaitingForOk = false;
    touchJobStatus();
  }

  if (!jobFile) {
    if (!openJobFileAtOffset()) {
      return;
    }
  }

  String line;
  if (!readNextCleanJobLine(line)) {
    if (jobStatus.state == JobRunnerState::Running) {
      completeJob();
    }
    return;
  }

  if (line.length() > kMaxGcodeLineLength) {
    setJobError("cleaned G-code line is too long");
    return;
  }
  if (!handleWorkspaceCommand(line)) {
    return;
  }

  jobStatus.lastCommand = line;
  jobResponseBuffer = "";
  Serial.print(line);
  Serial.print('\n');
  jobStatus.sentLineCount += 1;
  jobStatus.currentLineNumber += 1;
  jobWaitingForOk = true;
  touchJobStatus();
}

String htmlPage(const String &title, const String &body) {
  String html = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">";
  html += "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">";
  html += "<title>";
  html += title;
  html += "</title><link rel=\"stylesheet\" href=\"/style.css\"></head><body><main class=\"app\">";
  html += body;
  html += "</main></body></html>";
  return html;
}

String formValue(const char *name) {
  if (!server.hasArg(name)) {
    return "";
  }

  String value = server.arg(name);
  value.trim();
  return value;
}

String currentIpAddress() {
  if (activeWifiMode == "sta" && WiFi.status() == WL_CONNECTED) {
    return WiFi.localIP().toString();
  }

  return WiFi.softAPIP().toString();
}

void handleHealth() {
  String json = "{";
  json += "\"firmware\":\"";
  json += kFirmwareName;
  json += "\",\"firmwareVersion\":\"";
  json += firmwareVersion;
  json += "\",\"buildDate\":\"";
  json += buildDate;
  json += "\",\"buildTime\":\"";
  json += buildTime;
  json += "\",\"uptimeMs\":";
  json += String(millis());
  json += ",\"freeHeap\":";
  json += String(ESP.getFreeHeap());
  json += ",\"flashSize\":";
  json += String(ESP.getFlashChipSize());
  json += ",\"sketchSize\":";
  json += String(ESP.getSketchSize());
  json += ",\"freeSketchSpace\":";
  json += String(ESP.getFreeSketchSpace());
  json += ",\"baudrate\":";
  json += String(kMarlinBaudrate);
  json += ",\"wifiMode\":\"";
  json += activeWifiMode;
  json += "\",\"ipAddress\":\"";
  json += currentIpAddress();
  json += "\",\"ssid\":\"";
  json += jsonEscape(activeWifiSsid);
  json += "\"";
  if (activeWifiMode == "sta" && WiFi.status() == WL_CONNECTED) {
    json += ",\"rssi\":";
    json += String(WiFi.RSSI());
  }
  json += ",\"sdMounted\":";
  json += sdMounted ? "true" : "false";
  json += ",\"sdCardType\":\"";
  json += sdCardTypeName();
  json += "\",\"sdTotalBytes\":";
  json += String(sdMounted ? SD_MMC.totalBytes() : 0);
  json += ",\"sdUsedBytes\":";
  json += String(sdMounted ? SD_MMC.usedBytes() : 0);
  json += ",\"sdFreeBytes\":";
  if (sdMounted) {
    const uint64_t total = SD_MMC.totalBytes();
    const uint64_t used = SD_MMC.usedBytes();
    json += String(total > used ? total - used : 0);
  } else {
    json += "0";
  }
  json += "}";

  server.send(200, "application/json", json);
}

void sendJsonError(int status, const String &message) {
  String json = "{\"ok\":false,\"error\":\"";
  json += jsonEscape(message);
  json += "\"}";
  server.send(status, "application/json", json);
}

String contentTypeForPath(const String &path) {
  String lower = path;
  lower.toLowerCase();
  if (lower.endsWith(".html")) {
    return "text/html";
  }
  if (lower.endsWith(".js")) {
    return "application/javascript";
  }
  if (lower.endsWith(".css")) {
    return "text/css";
  }
  if (lower.endsWith(".json")) {
    return "application/json";
  }
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".ico")) {
    return "image/x-icon";
  }
  if (lower.endsWith(".gcode") || lower.endsWith(".gc") || lower.endsWith(".nc") ||
      lower.endsWith(".txt")) {
    return "text/plain";
  }

  return "application/octet-stream";
}

bool shouldDisableCache(const String &path) {
  String lower = path;
  lower.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".js") || lower.endsWith(".css");
}

void sendCacheHeadersFor(const String &path) {
  if (shouldDisableCache(path)) {
    server.sendHeader("Cache-Control", "no-store");
  }
}

bool isSafeWwwUri(const String &uri) {
  if (!uri.startsWith("/") || uri.indexOf("..") >= 0 || uri.indexOf("//") >= 0 ||
      uri.indexOf('\\') >= 0) {
    return false;
  }

  return !uri.startsWith("/api/") && uri != "/wifi" && uri != "/update" && uri != "/files";
}

bool serveSdWwwFile(const String &uri) {
  if (!sdMounted || !isSafeWwwUri(uri)) {
    return false;
  }

  const String sdPath = "/www" + uri;
  File file = SD_MMC.open(sdPath, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) {
      file.close();
    }
    return false;
  }

  sendCacheHeadersFor(sdPath);
  server.streamFile(file, contentTypeForPath(sdPath));
  file.close();
  return true;
}

bool serveSpiiffsFile(const String &path) {
  File file = SPIFFS.open(path, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) {
      file.close();
    }
    return false;
  }

  sendCacheHeadersFor(path);
  server.streamFile(file, contentTypeForPath(path));
  file.close();
  return true;
}

bool sdUiAvailable() {
  return sdMounted && SD_MMC.exists("/www/index.html");
}

void handleSdStatus() {
  server.send(200, "application/json", sdStatusJson());
}

void handleUiStatus() {
  String json = "{\"sdUiAvailable\":";
  json += sdUiAvailable() ? "true" : "false";
  json += ",\"indexFromSd\":";
  json += sdUiAvailable() ? "true" : "false";
  json += ",\"wwwPath\":\"/www\"}";
  server.send(200, "application/json", json);
}

void handleFilesList() {
  if (!sdMounted) {
    sendJsonError(503, "SD card is not mounted");
    return;
  }

  String path = normalizeSdPath(server.hasArg("path") ? server.arg("path") : "/gcode");
  if (!isSafeSdPath(path)) {
    sendJsonError(400, "unsafe path");
    return;
  }

  File dir = SD_MMC.open(path, FILE_READ);
  if (!dir || !dir.isDirectory()) {
    if (dir) {
      dir.close();
    }
    sendJsonError(404, "directory not found");
    return;
  }

  String json = "{\"path\":\"";
  json += jsonEscape(path);
  json += "\",\"items\":[";

  bool first = true;
  File item = dir.openNextFile();
  while (item) {
    String name = String(item.name());
    const int slash = name.lastIndexOf('/');
    if (slash >= 0) {
      name = name.substring(slash + 1);
    }
    const String itemPath = path == "/" ? "/" + name : path + "/" + name;
    if (!first) {
      json += ",";
    }
    first = false;
    json += "{\"name\":\"";
    json += jsonEscape(name);
    json += "\",\"path\":\"";
    json += jsonEscape(itemPath);
    json += "\",\"type\":\"";
    json += item.isDirectory() ? "dir" : "file";
    json += "\",\"size\":";
    json += String(item.isDirectory() ? 0 : item.size());
    json += "}";
    item.close();
    item = dir.openNextFile();
  }

  dir.close();
  json += "]}";
  server.send(200, "application/json", json);
}

void handleDownload() {
  if (!sdMounted) {
    server.send(503, "text/plain", "SD card is not mounted");
    return;
  }

  const String path = normalizeSdPath(server.hasArg("path") ? server.arg("path") : "");
  if (!isSafeSdPath(path) || isRootDirectory(path)) {
    server.send(400, "text/plain", "unsafe path");
    return;
  }

  File file = SD_MMC.open(path, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) {
      file.close();
    }
    server.send(404, "text/plain", "file not found");
    return;
  }

  server.streamFile(file, contentTypeForPath(path));
  file.close();
}

void resetUploadState() {
  if (uploadFile) {
    uploadFile.close();
  }
  uploadError = "";
  uploadTargetPath = "";
  uploadSeen = false;
  uploadOk = false;
}

void handleUploadComplete() {
  if (!uploadSeen) {
    sendJsonError(400, "no file provided");
    return;
  }

  if (!uploadOk) {
    sendJsonError(400, uploadError.length() > 0 ? uploadError : "upload failed");
    return;
  }

  String json = "{\"ok\":true,\"path\":\"";
  json += jsonEscape(uploadTargetPath);
  json += "\"}";
  server.send(200, "application/json", json);
}

void handleUploadData() {
  HTTPUpload &upload = server.upload();

  if (upload.status == UPLOAD_FILE_START) {
    resetUploadState();
    uploadSeen = true;

    if (!sdMounted) {
      uploadError = "SD card is not mounted";
      return;
    }

    String dir = normalizeSdPath(server.hasArg("path") ? server.arg("path") : "/gcode");
    if (!isSafeSdPath(dir) || !SD_MMC.exists(dir)) {
      uploadError = "unsafe or missing target directory";
      return;
    }

    File targetDir = SD_MMC.open(dir, FILE_READ);
    if (!targetDir || !targetDir.isDirectory()) {
      if (targetDir) {
        targetDir.close();
      }
      uploadError = "target path is not a directory";
      return;
    }
    targetDir.close();

    if (!isSafeFileName(upload.filename)) {
      uploadError = "unsafe file name";
      return;
    }

    uploadTargetPath = dir + "/" + upload.filename;
    if (SD_MMC.exists(uploadTargetPath) && server.arg("overwrite") != "true") {
      uploadError = "file exists";
      return;
    }

    uploadFile = SD_MMC.open(uploadTargetPath, FILE_WRITE);
    if (!uploadFile) {
      uploadError = "could not create file";
    }
  } else if (upload.status == UPLOAD_FILE_WRITE) {
    if (uploadError.length() > 0 || !uploadFile) {
      return;
    }

    if (uploadFile.write(upload.buf, upload.currentSize) != upload.currentSize) {
      uploadError = "write failed";
    }
  } else if (upload.status == UPLOAD_FILE_END) {
    if (uploadFile) {
      uploadFile.close();
    }

    if (upload.totalSize == 0 && uploadError.length() == 0) {
      SD_MMC.remove(uploadTargetPath);
      uploadError = "empty upload";
      return;
    }

    uploadOk = uploadError.length() == 0;
  } else if (upload.status == UPLOAD_FILE_ABORTED) {
    if (uploadFile) {
      uploadFile.close();
    }
    if (uploadTargetPath.length() > 0) {
      SD_MMC.remove(uploadTargetPath);
    }
    uploadError = "upload aborted";
  }
}

void handleDelete() {
  if (!sdMounted) {
    sendJsonError(503, "SD card is not mounted");
    return;
  }

  const String path = normalizeSdPath(extractJsonString(server.arg("plain"), "path"));
  if (!isSafeSdPath(path) || isRootDirectory(path)) {
    sendJsonError(400, "unsafe path");
    return;
  }

  File target = SD_MMC.open(path, FILE_READ);
  if (!target) {
    sendJsonError(404, "path not found");
    return;
  }

  const bool isDir = target.isDirectory();
  target.close();
  const bool ok = isDir ? SD_MMC.rmdir(path) : SD_MMC.remove(path);
  if (!ok) {
    sendJsonError(400, "delete failed; directory may not be empty");
    return;
  }

  server.send(200, "application/json", "{\"ok\":true}");
}

void handleMkdir() {
  if (!sdMounted) {
    sendJsonError(503, "SD card is not mounted");
    return;
  }

  const String path = normalizeSdPath(extractJsonString(server.arg("plain"), "path"));
  if (!isSafeSdPath(path) || isRootDirectory(path)) {
    sendJsonError(400, "unsafe path");
    return;
  }

  if (SD_MMC.exists(path)) {
    sendJsonError(409, "path already exists");
    return;
  }

  if (!SD_MMC.mkdir(path)) {
    sendJsonError(400, "mkdir failed");
    return;
  }

  server.send(200, "application/json", "{\"ok\":true}");
}

void handleRename() {
  if (!sdMounted) {
    sendJsonError(503, "SD card is not mounted");
    return;
  }

  const String body = server.arg("plain");
  const String from = normalizeSdPath(extractJsonString(body, "from"));
  const String to = normalizeSdPath(extractJsonString(body, "to"));
  if (!isSafeSdPath(from) || !isSafeSdPath(to) || isRootDirectory(from) || isRootDirectory(to)) {
    sendJsonError(400, "unsafe path");
    return;
  }

  if (!SD_MMC.exists(from)) {
    sendJsonError(404, "source not found");
    return;
  }

  if (SD_MMC.exists(to)) {
    sendJsonError(409, "target exists");
    return;
  }

  if (!SD_MMC.rename(from, to)) {
    sendJsonError(400, "rename failed");
    return;
  }

  server.send(200, "application/json", "{\"ok\":true}");
}

void handleCommand() {
  if (otaActive) {
    server.send(409, "application/json", "{\"ok\":false,\"error\":\"OTA update in progress\"}");
    return;
  }

  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"ok\":false,\"error\":\"missing JSON body\"}");
    return;
  }

  const String cmd = extractCmdFromJson(server.arg("plain"));
  if (cmd.length() == 0) {
    server.send(400, "application/json", "{\"ok\":false,\"error\":\"missing cmd\"}");
    return;
  }

  if (jobStatus.state == JobRunnerState::Running) {
    String upper = cmd;
    upper.toUpperCase();
    upper.trim();
    if (upper == "M5") {
      if (priorityCommandCount == 0) {
        queuePriorityCommands("M5");
      }
      logJobEvent("priority manual: M5");
      server.send(200, "application/json",
                  "{\"ok\":true,\"response\":\"M5 priority requested. This is not a physical emergency stop.\"}");
      return;
    }
    const bool allowedDuringJob = upper == "M114" || upper == "M115" || upper == "M119" ||
                                  upper == "M400" || upper == "M5";
    if (!allowedDuringJob) {
      sendJsonError(409, "job is running; manual command rejected");
      return;
    }
  }

  if (jobStatus.state == JobRunnerState::Pausing || jobStatus.state == JobRunnerState::Paused ||
      jobStatus.state == JobRunnerState::Stopping) {
    String upper = cmd;
    upper.toUpperCase();
    upper.trim();
    if (upper == "M5") {
      if (priorityCommandCount == 0) {
        queuePriorityCommands("M5");
      }
      logJobEvent("priority manual: M5");
      server.send(200, "application/json",
                  "{\"ok\":true,\"response\":\"M5 priority requested. This is not a physical emergency stop.\"}");
      return;
    }
  }

  if (jogIsActive()) {
    String upper = cmd;
    upper.toUpperCase();
    upper.trim();
    const bool allowedDuringJog = upper == "M114" || upper == "M119" || upper == "M400" || upper == "M5";
    if (!allowedDuringJog) {
      sendJsonError(409, "safe jog is active; manual command rejected");
      return;
    }
  }

  drainMarlinInput();

  Serial.print(cmd);
  Serial.print('\n');

  const String response = readMarlinResponse();
  String json = "{\"ok\":true,\"response\":\"";
  json += jsonEscape(response);
  json += "\"}";
  server.send(200, "application/json", json);
}

bool jobJsonIsArmed(const String &jobPath) {
  File file = SD_MMC.open(jobPath, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) {
      file.close();
    }
    return false;
  }

  String body;
  while (file.available()) {
    body += static_cast<char>(file.read());
    if (body.length() > 8192) {
      break;
    }
  }
  file.close();

  // TODO: Replace this minimal check with robust JSON parsing if job metadata grows.
  return body.indexOf("\"state\":\"ARMED\"") >= 0 || body.indexOf("\"state\": \"ARMED\"") >= 0;
}

String readJobJsonSnippet(const String &jobPath) {
  File file = SD_MMC.open(jobPath, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) {
      file.close();
    }
    return "";
  }

  String body;
  while (file.available()) {
    body += static_cast<char>(file.read());
    if (body.length() > 16384) {
      break;
    }
  }
  file.close();
  return body;
}

bool jobJsonAllowsWorkspaceCommands(const String &jobPath) {
  const String body = readJobJsonSnippet(jobPath);
  return body.indexOf("\"allowedWorkspaceCommands\":true") >= 0 ||
         body.indexOf("\"allowedWorkspaceCommands\": true") >= 0;
}

int jobJsonFeedStartPercent(const String &jobPath) {
  const String body = readJobJsonSnippet(jobPath);
  const int percent = extractJsonInt(body, "startPercent", 100);
  return (percent >= 10 && percent <= 200) ? percent : 100;
}

bool jobJsonResetFeedAfterJob(const String &jobPath) {
  const String body = readJobJsonSnippet(jobPath);
  return extractJsonBool(body, "resetTo100AfterJob", true);
}

void resetFeedOverrideAfterJobIfNeeded() {
  if (!jobStatus.resetFeedOverrideAfterJob || jobStatus.feedOverridePercent == 100) {
    return;
  }

  sendFeedOverrideImmediate(100);
  logJobEvent("feed override reset to 100 after job");
}

String extractWorkspaceCommand(const String &line) {
  String upper = line;
  upper.toUpperCase();

  for (int i = 0; i < upper.length(); ++i) {
    if (upper[i] != 'G') {
      continue;
    }

    String token = "G";
    int j = i + 1;
    while (j < upper.length()) {
      const char c = upper[j];
      if ((c >= '0' && c <= '9') || c == '.') {
        token += c;
        ++j;
      } else {
        break;
      }
    }

    if (token == "G54" || token == "G55" || token == "G56" || token == "G57" ||
        token == "G58" || token == "G59" || token == "G59.1" || token == "G59.2" ||
        token == "G59.3") {
      return token;
    }
  }

  return "";
}

bool handleWorkspaceCommand(const String &line) {
  const String workspace = extractWorkspaceCommand(line);
  if (workspace.length() == 0) {
    return true;
  }

  if (workspace == "G54") {
    logJobEvent("info: G54 default workspace command found.");
    return true;
  }

  const String warning = "Non-default workspace command found. This may conflict with captured work zero.";
  if (!jobStatus.allowedWorkspaceCommands) {
    setJobError(warning);
    return false;
  }

  logJobEvent("warning: " + warning + " (" + workspace + ")");
  return true;
}

bool runJobStartPreamble() {
  sendMarlinSafetyCommand("M5");
  sendMarlinSafetyCommand("G21");
  sendMarlinSafetyCommand("G90");
  sendMarlinSafetyCommand("G54");
  sendFeedOverrideImmediate(jobStatus.feedOverridePercent);
  sendMarlinSafetyCommand("M400");
  sendMarlinSafetyCommand("M114");

  if (jobStatus.startMode == "apply_current_position_as_work_zero") {
    sendMarlinSafetyCommand("G92 X0 Y0 Z0");
    sendMarlinSafetyCommand("M114");
  }

  return true;
}

void handleJobStatus() {
  server.send(200, "application/json", jobStatusJson());
}

void handleJobFeedOverride() {
  if (!server.hasArg("plain")) {
    sendJsonError(400, "missing JSON body");
    return;
  }

  const int percent = extractJsonInt(server.arg("plain"), "percent", -1);
  if (percent < 10 || percent > 200) {
    sendJsonError(400, "feed override percent must be between 10 and 200");
    return;
  }

  if (jobStatus.state == JobRunnerState::Preparing || jobStatus.state == JobRunnerState::Stopping) {
    sendJsonError(409, "feed override rejected while job is preparing or stopping");
    return;
  }

  if (priorityCommandCount > 0 || jobStatus.priorityCommandInProgress) {
    sendJsonError(409, "higher priority command is in progress");
    return;
  }

  const String cmd = feedOverrideCommand(percent);
  jobStatus.feedOverridePercent = percent;
  jobStatus.lastFeedOverrideCommand = cmd;
  jobStatus.lastFeedOverrideResponse = "";
  jobStatus.lastFeedOverrideError = "";
  queuePriorityCommands(cmd.c_str());
  touchJobStatus();
  logJobEvent("feed override requested: " + cmd);
  server.send(200, "application/json", jobStatusJsonWithMessage("Feed override requested."));
}

void handleJobStart() {
  if (!sdMounted) {
    sendJsonError(503, "SD card is not mounted");
    return;
  }
  if (jobIsActive()) {
    sendJsonError(409, "another job is already active");
    return;
  }
  if (!server.hasArg("plain")) {
    sendJsonError(400, "missing JSON body");
    return;
  }

  const String body = server.arg("plain");
  const String gcodePath = normalizeSdPath(extractJsonString(body, "gcodePath"));
  const String jobPath = normalizeSdPath(extractJsonString(body, "jobPath"));
  String startMode = extractJsonString(body, "startMode");
  if (startMode.length() == 0) {
    startMode = "apply_current_position_as_work_zero";
  }
  if (startMode != "apply_current_position_as_work_zero" && startMode != "use_active_work_zero") {
    sendJsonError(400, "invalid startMode");
    return;
  }
  if (!isPathUnderRoot(gcodePath, "/gcode")) {
    sendJsonError(400, "gcodePath must be under /gcode");
    return;
  }
  if (!isPathUnderRoot(jobPath, "/jobs")) {
    sendJsonError(400, "jobPath must be under /jobs");
    return;
  }
  if (!SD_MMC.exists(gcodePath)) {
    sendJsonError(404, "G-code file not found");
    return;
  }
  if (!SD_MMC.exists(jobPath)) {
    sendJsonError(404, "job JSON not found");
    return;
  }
  if (!jobJsonIsArmed(jobPath)) {
    sendJsonError(409, "job JSON is not ARMED");
    return;
  }

  jobStatus = JobRunnerStatus();
  clearPriorityCommands();
  jobStatus.state = JobRunnerState::Preparing;
  jobStatus.gcodePath = gcodePath;
  jobStatus.jobPath = jobPath;
  jobStatus.startMode = startMode;
  jobStatus.allowedWorkspaceCommands = jobJsonAllowsWorkspaceCommands(jobPath);
  jobStatus.feedOverridePercent = jobJsonFeedStartPercent(jobPath);
  jobStatus.resetFeedOverrideAfterJob = jobJsonResetFeedAfterJob(jobPath);
  jobStatus.startedAtMs = millis();
  touchJobStatus();

  File sizeFile = SD_MMC.open(gcodePath, FILE_READ);
  if (!sizeFile || sizeFile.isDirectory()) {
    if (sizeFile) {
      sizeFile.close();
    }
    setJobError("could not open G-code file");
    sendJsonError(500, jobStatus.lastError);
    return;
  }
  jobStatus.fileSize = sizeFile.size();
  sizeFile.close();

  if (!openJobFileAtOffset()) {
    sendJsonError(500, jobStatus.lastError);
    return;
  }

  logJobEvent("start: " + gcodePath);
  runJobStartPreamble();

  jobRunning = true;
  jobStatus.state = JobRunnerState::Running;
  touchJobStatus();
  server.send(200, "application/json", jobStatusJson());
}

void handleJobPause() {
  if (jobStatus.state != JobRunnerState::Running) {
    sendJsonError(409, "job is not running");
    return;
  }

  if (jobFile) {
    jobFile.close();
  }
  jobWaitingForOk = false;
  jobResponseBuffer = "";
  jobStatus.pauseRequested = true;
  jobStatus.stopRequested = false;
  jobStatus.state = JobRunnerState::Pausing;
  jobStatus.streamingPausedReason = "Pause requested. Streaming stopped.";
  queuePriorityCommands("M5", "M400");
  touchJobStatus();
  logJobEvent("pause requested: " + jobStatus.gcodePath);
  server.send(200, "application/json", jobStatusJsonWithMessage("Pause requested. Streaming stopped."));
}

void handleJobResume() {
  if (jobStatus.state != JobRunnerState::Paused) {
    sendJsonError(409, "job is not paused");
    return;
  }
  if (jobStatus.stopRequested) {
    sendJsonError(409, "job stop has been requested");
    return;
  }
  if (!openJobFileAtOffset()) {
    sendJsonError(500, jobStatus.lastError);
    return;
  }

  jobResponseBuffer = "";
  jobWaitingForOk = false;
  jobStatus.pauseRequested = false;
  jobStatus.streamingPausedReason = "";
  jobStatus.state = JobRunnerState::Resuming;
  touchJobStatus();
  logJobEvent("resume: " + jobStatus.gcodePath);
  server.send(200, "application/json", jobStatusJsonWithMessage("Resume requested."));
}

void handleJobStop() {
  if (jobStatus.state == JobRunnerState::Stopping) {
    server.send(200, "application/json", jobStatusJsonWithMessage("Stop already requested. Streaming stopped."));
    return;
  }
  if (jobStatus.state != JobRunnerState::Preparing && jobStatus.state != JobRunnerState::Running &&
      jobStatus.state != JobRunnerState::Pausing && jobStatus.state != JobRunnerState::Paused &&
      jobStatus.state != JobRunnerState::Resuming) {
    sendJsonError(409, "job is not active");
    return;
  }

  if (jobFile) {
    jobFile.close();
  }
  jobWaitingForOk = false;
  jobResponseBuffer = "";
  jobRunning = false;
  jobStatus.pauseRequested = false;
  jobStatus.stopRequested = true;
  jobStatus.state = JobRunnerState::Stopping;
  jobStatus.streamingPausedReason = "Stop requested. Streaming stopped.";
  queuePriorityCommands("M5", "M410");
  touchJobStatus();
  logJobEvent("stop requested: " + jobStatus.gcodePath);
  server.send(200, "application/json", jobStatusJsonWithMessage("Stop requested. Streaming stopped."));
}

void handleJogStatus() {
  server.send(200, "application/json", jogStatusJson());
}

void handleJogStart() {
  if (jobStatus.state == JobRunnerState::Running) {
    sendJsonError(409, "jog rejected while job is RUNNING");
    return;
  }
  if (!server.hasArg("plain")) {
    sendJsonError(400, "missing JSON body");
    return;
  }

  const String body = server.arg("plain");
  jogStatus = JogStatus();
  jogStatus.safeJog = extractJsonBool(body, "safeJog", true);
  jogStatus.safeLiftZ = clampFloat(extractJsonFloat(body, "safeLiftZ", 5.0f), 0.0f, 25.0f);
  jogStatus.xyFeedMax = clampFloat(extractJsonFloat(body, "xyFeedMax", 2000.0f), 50.0f, 3000.0f);
  jogStatus.zFeedMax = clampFloat(extractJsonFloat(body, "zFeedMax", 400.0f), 20.0f, 800.0f);
  jogStatus.startedAtMs = millis();
  jogStatus.lastUpdateMs = millis();
  jogStatus.lastTickMs = 0;

  // TODO: Add a future physical enable/arm button input before allowing jog movement.
  if (!prepareSafeJogLift()) {
    sendJsonError(400, jogStatus.lastError);
    return;
  }

  jogStatus.state = JogState::Jogging;
  server.send(200, "application/json", jogStatusJson());
}

void handleJogUpdate() {
  if (jogStatus.state != JogState::Jogging) {
    sendJsonError(409, "jog is not active");
    return;
  }
  if (!server.hasArg("plain")) {
    sendJsonError(400, "missing JSON body");
    return;
  }

  const String body = server.arg("plain");
  const float x = clampFloat(extractJsonFloat(body, "x", 0.0f), -1.0f, 1.0f);
  const float y = clampFloat(extractJsonFloat(body, "y", 0.0f), -1.0f, 1.0f);
  const float z = clampFloat(extractJsonFloat(body, "z", 0.0f), -1.0f, 1.0f);
  const float speed = clampFloat(extractJsonFloat(body, "speed", 0.0f), 0.0f, 1.0f);
  if (jogStatus.safeJog && (fabs(x) > 0.01f || fabs(y) > 0.01f) && !jogStatus.zLiftedForJog) {
    sendJsonError(409, "safe Z lift has not completed");
    return;
  }

  jogStatus.x = x;
  jogStatus.y = y;
  jogStatus.z = z;
  jogStatus.speed = speed;
  jogStatus.lastUpdateMs = millis();
  server.send(200, "application/json", jogStatusJson());
}

void handleJogStop() {
  stopJogInternal(true);
  server.send(200, "application/json", jogStatusJson());
}

void handleUpdatePage() {
  String body;
  body += "<header class=\"topbar\"><h1>Firmware Update</h1>";
  body += "<p>Current firmware: ";
  body += firmwareVersion;
  body += " (";
  body += buildDate;
  body += " ";
  body += buildTime;
  body += ")</p></header>";
  body += "<section class=\"panel maintenance-panel\">";
  body += "<p class=\"warning\">Do not update while the CNC is moving or cutting.</p>";
  body += "<form method=\"post\" action=\"/api/update\" enctype=\"multipart/form-data\">";
  body += "<input type=\"file\" name=\"firmware\" accept=\".bin\" required>";
  body += "<button type=\"submit\">Upload Firmware</button>";
  body += "</form>";
  body += "<a class=\"maintenance-link\" href=\"/\">Back to pendant</a>";
  body += "</section>";

  server.send(200, "text/html", htmlPage("Firmware Update", body));
}

void handleWifiPage() {
  String body;
  body += "<header class=\"topbar\"><h1>WiFi Settings</h1>";
  body += "<p>Mode: ";
  body += activeWifiMode;
  body += " | IP: ";
  body += currentIpAddress();
  body += " | SSID: ";
  body += htmlEscape(activeWifiSsid);
  body += "</p></header>";
  body += "<section class=\"panel maintenance-panel\">";
  body += "<form method=\"post\" action=\"/api/wifi/save\">";
  body += "<label for=\"ssid\">SSID</label>";
  body += "<input id=\"ssid\" name=\"ssid\" type=\"text\" autocomplete=\"off\" required>";
  body += "<label for=\"pass\">Password</label>";
  body += "<input id=\"pass\" name=\"pass\" type=\"password\" autocomplete=\"current-password\">";
  body += "<button type=\"submit\">Save WiFi</button>";
  body += "</form>";
  body += "<form method=\"post\" action=\"/api/wifi/forget\">";
  body += "<button type=\"submit\" class=\"secondary-button\">Forget Saved WiFi</button>";
  body += "</form>";
  body += "<a class=\"maintenance-link\" href=\"/\">Back to pendant</a>";
  body += "</section>";

  server.send(200, "text/html", htmlPage("WiFi Settings", body));
}

void handleWifiSave() {
  const String ssid = formValue("ssid");
  const String pass = server.hasArg("pass") ? server.arg("pass") : "";

  if (ssid.length() == 0) {
    server.send(400, "text/html",
                htmlPage("WiFi Save Failed", "<section class=\"panel\"><h1>WiFi Save Failed</h1><p>SSID is required.</p><a class=\"maintenance-link\" href=\"/wifi\">Try again</a></section>"));
    return;
  }

  wifiPrefs.begin(kWifiPrefsNamespace, false);
  wifiPrefs.putString(kWifiPrefsSsidKey, ssid);
  wifiPrefs.putString(kWifiPrefsPassKey, pass);
  wifiPrefs.end();

  rebootAtMs = millis() + 1000;
  server.send(200, "text/html",
              htmlPage("WiFi Saved", "<section class=\"panel\"><h1>WiFi Saved</h1><p>Credentials saved. Rebooting...</p></section>"));
}

void handleWifiForget() {
  wifiPrefs.begin(kWifiPrefsNamespace, false);
  wifiPrefs.remove(kWifiPrefsSsidKey);
  wifiPrefs.remove(kWifiPrefsPassKey);
  wifiPrefs.end();

  rebootAtMs = millis() + 1000;
  server.send(200, "text/html",
              htmlPage("WiFi Forgotten", "<section class=\"panel\"><h1>WiFi Forgotten</h1><p>Saved credentials removed. Rebooting into setup AP...</p></section>"));
}

void resetOtaState() {
  otaActive = false;
  otaUploadSeen = false;
  otaUploadOk = false;
  otaError = "";
}

bool prepareForOta() {
  if (jobIsActive()) {
    otaError = "CNC job is marked as running";
    return false;
  }

  otaActive = true;
  sendMarlinSafetyCommand("M5");
  sendMarlinSafetyCommand("M400");
  return true;
}

void handleUpdateComplete() {
  if (!otaUploadSeen) {
    resetOtaState();
    server.send(400, "text/html",
                htmlPage("Update Failed", "<section class=\"panel\"><h1>Update Failed</h1><p>No firmware file was provided.</p><a class=\"maintenance-link\" href=\"/update\">Try again</a></section>"));
    return;
  }

  if (!otaUploadOk) {
    const String message = otaError.length() > 0 ? otaError : Update.errorString();
    resetOtaState();
    String body = "<section class=\"panel\"><h1>Update Failed</h1><p>";
    body += jsonEscape(message);
    body += "</p><a class=\"maintenance-link\" href=\"/update\">Try again</a></section>";
    server.send(500, "text/html", htmlPage("Update Failed", body));
    return;
  }

  otaActive = false;
  rebootAtMs = millis() + 1000;
  server.send(200, "text/html",
              htmlPage("Update Complete", "<section class=\"panel\"><h1>Update Complete</h1><p>Firmware uploaded successfully. Rebooting...</p></section>"));
}

void handleUpdateUpload() {
  HTTPUpload &upload = server.upload();

  if (upload.status == UPLOAD_FILE_START) {
    resetOtaState();
    otaUploadSeen = true;

    // TODO: Protect OTA before exposing this device outside the local/private network.
    if (upload.filename.length() == 0) {
      otaError = "No firmware file was provided.";
      return;
    }

    if (!prepareForOta()) {
      return;
    }

    if (!Update.begin(UPDATE_SIZE_UNKNOWN, U_FLASH)) {
      otaError = Update.errorString();
      otaActive = false;
      return;
    }
  } else if (upload.status == UPLOAD_FILE_WRITE) {
    if (otaError.length() > 0) {
      return;
    }

    if (Update.write(upload.buf, upload.currentSize) != upload.currentSize) {
      otaError = Update.errorString();
      Update.abort();
      otaActive = false;
    }
  } else if (upload.status == UPLOAD_FILE_END) {
    if (otaError.length() > 0) {
      return;
    }

    if (Update.end(true)) {
      otaUploadOk = true;
    } else {
      otaError = Update.errorString();
      otaActive = false;
    }
  } else if (upload.status == UPLOAD_FILE_ABORTED) {
    otaError = "Firmware upload was aborted.";
    Update.abort();
    otaActive = false;
  }
}

void handleNotFound() {
  if (server.method() == HTTP_GET && serveSdWwwFile(server.uri())) {
    return;
  }

  server.send(404, "application/json", "{\"ok\":false,\"error\":\"not found\"}");
}

void handleIndex() {
  if (serveSdWwwFile("/index.html")) {
    return;
  }

  if (!serveSpiiffsFile("/index.html")) {
    server.send(500, "text/plain", "index.html not found");
  }
}

void handleFilesPage() {
  if (serveSdWwwFile("/files.html")) {
    return;
  }

  if (!serveSpiiffsFile("/files.html")) {
    server.send(500, "text/plain", "files.html not found");
  }
}

void handleAppJs() {
  if (!serveSdWwwFile("/app.js") && !serveSpiiffsFile("/app.js")) {
    server.send(404, "text/plain", "app.js not found");
  }
}

void handleFilesJs() {
  if (!serveSdWwwFile("/files.js") && !serveSpiiffsFile("/files.js")) {
    server.send(404, "text/plain", "files.js not found");
  }
}

void handleStyleCss() {
  if (!serveSdWwwFile("/style.css") && !serveSpiiffsFile("/style.css")) {
    server.send(404, "text/plain", "style.css not found");
  }
}

void startWifiAp() {
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1),
                    IPAddress(255, 255, 255, 0));
  WiFi.softAP(kSetupApSsid, kSetupApPassword);
  activeWifiMode = "ap";
  activeWifiSsid = kSetupApSsid;
}

bool tryWifiSta(const String &ssid, const String &pass) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());

  const uint32_t start = millis();
  while (millis() - start < kStaConnectTimeoutMs) {
    if (WiFi.status() == WL_CONNECTED) {
      activeWifiMode = "sta";
      activeWifiSsid = ssid;
      return true;
    }
    delay(250);
  }

  WiFi.disconnect(true);
  return false;
}

void startWifi() {
  wifiPrefs.begin(kWifiPrefsNamespace, true);
  const String ssid = wifiPrefs.getString(kWifiPrefsSsidKey, "");
  const String pass = wifiPrefs.getString(kWifiPrefsPassKey, "");
  wifiPrefs.end();

  if (ssid.length() > 0 && tryWifiSta(ssid, pass)) {
    return;
  }

  startWifiAp();
}

void startHttpServer() {
  server.on("/", HTTP_GET, handleIndex);
  server.on("/index.html", HTTP_GET, handleIndex);
  server.on("/files", HTTP_GET, handleFilesPage);
  server.on("/app.js", HTTP_GET, handleAppJs);
  server.on("/files.js", HTTP_GET, handleFilesJs);
  server.on("/style.css", HTTP_GET, handleStyleCss);
  server.on("/api/health", HTTP_GET, handleHealth);
  server.on("/api/cmd", HTTP_POST, handleCommand);
  server.on("/api/ui/status", HTTP_GET, handleUiStatus);
  server.on("/api/sd/status", HTTP_GET, handleSdStatus);
  server.on("/api/files", HTTP_GET, handleFilesList);
  server.on("/api/download", HTTP_GET, handleDownload);
  server.on("/api/upload", HTTP_POST, handleUploadComplete, handleUploadData);
  server.on("/api/delete", HTTP_POST, handleDelete);
  server.on("/api/mkdir", HTTP_POST, handleMkdir);
  server.on("/api/rename", HTTP_POST, handleRename);
  server.on("/api/job/start", HTTP_POST, handleJobStart);
  server.on("/api/job/status", HTTP_GET, handleJobStatus);
  server.on("/api/job/pause", HTTP_POST, handleJobPause);
  server.on("/api/job/resume", HTTP_POST, handleJobResume);
  server.on("/api/job/stop", HTTP_POST, handleJobStop);
  server.on("/api/job/feed-override", HTTP_POST, handleJobFeedOverride);
  server.on("/api/jog/start", HTTP_POST, handleJogStart);
  server.on("/api/jog/update", HTTP_POST, handleJogUpdate);
  server.on("/api/jog/stop", HTTP_POST, handleJogStop);
  server.on("/api/jog/status", HTTP_GET, handleJogStatus);
  server.on("/update", HTTP_GET, handleUpdatePage);
  server.on("/api/update", HTTP_POST, handleUpdateComplete, handleUpdateUpload);
  server.on("/wifi", HTTP_GET, handleWifiPage);
  server.on("/api/wifi/save", HTTP_POST, handleWifiSave);
  server.on("/api/wifi/forget", HTTP_POST, handleWifiForget);
  server.onNotFound(handleNotFound);
  server.begin();
}
} // namespace

void setup() {
  Serial.begin(kMarlinBaudrate, SERIAL_8N1, kMarlinRxPin, kMarlinTxPin);

  if (checkForSdRescueUpdate() && performSdRescueUpdate()) {
    delay(1000);
    ESP.restart();
  }

  SPIFFS.begin(true);
  startWifi();
  startHttpServer();
}

void loop() {
  server.handleClient();
  processJobRunner();
  processJogRunner();

  if (rebootAtMs > 0 && millis() >= rebootAtMs) {
    ESP.restart();
  }
}
