#include <Arduino.h>
#ifndef ESP32CNC_ENABLE_BLE
#define ESP32CNC_ENABLE_BLE 1
#endif

#if ESP32CNC_ENABLE_BLE
#include <NimBLEDevice.h>
#endif
#include <ESPmDNS.h>
#include <Preferences.h>
#include <SD_MMC.h>
#include <SPIFFS.h>
#include <Update.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <WiFi.h>
#include <freertos/queue.h>
#include <freertos/task.h>

namespace {
constexpr const char *kFirmwareName = "G-code CNC Pendant";
constexpr const char *firmwareVersion = "0.6.11-guided-cut-workflow";
constexpr const char *buildDate = __DATE__;
constexpr const char *buildTime = __TIME__;
constexpr const char *kSetupApSsid = "G-code-CNC-Setup";
constexpr const char *kSetupApPassword = "12345678";
constexpr const char *kWifiPrefsNamespace = "wifi";
constexpr const char *kWifiPrefsSsidKey = "ssid";
constexpr const char *kWifiPrefsPassKey = "pass";
constexpr const char *kMachinePrefsNamespace = "machine";
constexpr const char *kDevicePrefsNamespace = "device";
constexpr const char *kDevicePrefsHostnameKey = "hostname";
constexpr const char *kDevicePrefsFriendlyNameKey = "friendlyName";
constexpr const char *kDevicePrefsBleEnabledKey = "bleEnabled";
constexpr const char *kDevicePrefsBleNameKey = "bleName";
constexpr const char *kDefaultDeviceHostname = "cnc";
constexpr const char *kDefaultDeviceFriendlyName = "ESP32 CNC";
constexpr const char *kPrimaryDeviceConfigPath = "/esp32-cnc/config.json";
constexpr const char *kFallbackDeviceConfigPath = "/config.json";
constexpr size_t kMaxDeviceConfigBytes = 4096;
constexpr size_t kMaxBleAdvertisementNameBytes = 26;
constexpr const char *kSdUpdateBinPath = "/firmware/update.bin";
constexpr const char *kSdInstallMarkerPath = "/firmware/INSTALL.NOW";
constexpr const char *kSdDoneBinPath = "/firmware/update.done.bin";
constexpr const char *kSdFailedMarkerPath = "/firmware/INSTALL.FAILED";
constexpr const char *kSdRootUpdateBinPath = "/firmware.bin";
constexpr const char *kSdRootDoneBinPath = "/firmware.done.bin";
constexpr const char *kSdUpdateLogPath = "/logs/update.log";
constexpr const char *kSdJobLogPath = "/logs/job.log";
constexpr const char *kSdRoots[] = {"/gcode", "/www", "/firmware", "/jobs", "/logs",
                                    "/esp32-cnc"};
constexpr uint32_t kMarlinBaudrate = 250000;
constexpr uint32_t kMarlinTimeoutMs = 1500;
constexpr uint32_t kMarlinCommandAckTimeoutMs = 5000;
constexpr uint32_t kMarlinPauseDrainAckTimeoutMs = 30000;
constexpr uint16_t kTelemetryWebSocketPort = 81;
constexpr uint32_t kTelemetryMinBroadcastMs = 100;
constexpr uint32_t kJobProgressBroadcastMs = 500;
constexpr size_t kMotionTelemetrySize = 24;
constexpr uint32_t kStaConnectTimeoutMs = 15000;
constexpr uint32_t kJogTickIntervalMs = 25;
constexpr uint32_t kJogSegmentDurationMs = 40;
constexpr uint32_t kJogHorizonRefillMs = 40;
constexpr uint32_t kJogMaxHorizonMs = 80;
constexpr uint32_t kJogDeadmanMs = 500;
constexpr uint8_t kJogPlannerLookahead = 6;
constexpr float kJogVectorRampPerTick = 0.125f;
constexpr float kJogMaxXyStepMm = 4.0f;
constexpr float kJogMaxZStepMm = 0.4f;
constexpr float kMachineXMaxMm = 1625.0f;
constexpr float kMachineYMaxMm = 5800.0f;
constexpr float kMachineZMaxMm = 70.0f;
constexpr float kJobStartZFeed = 400.0f;
constexpr float kDefaultTravelFeed = 3000.0f;
constexpr float kGotoWorkZeroZFeed = 400.0f;
constexpr size_t kMaxGcodeLineLength = 180;
constexpr size_t kMaxTestMotionFileSize = 2 * 1024 * 1024;
constexpr uint32_t kMaxTestMotionCommands = 20000;
constexpr size_t kMarlinLogSize = 40;
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
  String startMode = "use_active_work_zero";
  String streamMode = "job";
  bool allowedWorkspaceCommands = false;
  float safeStartZ = 15.0f;
  float travelFeedMmMin = kDefaultTravelFeed;
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
  bool originalZCaptured = false;
  bool safeLiftWorkZCaptured = false;
  bool zChangedDuringJog = false;
  bool zRestoreAvailable = false;
  float safeLiftZ = kMachineZMaxMm;
  float safeLiftWorkZ = 0.0f;
  float originalZ = 0.0f;
  float xyFeedMax = 3000.0f;
  float zFeedMax = 400.0f;
  float x = 0.0f;
  float y = 0.0f;
  float z = 0.0f;
  float speed = 0.0f;
  float appliedX = 0.0f;
  float appliedY = 0.0f;
  float appliedZ = 0.0f;
  float appliedSpeed = 0.0f;
  bool commandedPositionCaptured = false;
  float commandedWorkX = 0.0f;
  float commandedWorkY = 0.0f;
  float commandedWorkZ = 0.0f;
  uint8_t pendingMoveAcks = 0;
  String responseLine;
  String lastCommand;
  String lastError;
  String lastM114;
  uint32_t startedAtMs = 0;
  uint32_t lastUpdateMs = 0;
  uint32_t lastTickMs = 0;
  uint32_t lastMoveSentAtMs = 0;
  uint32_t queuedMotionHorizonMs = 0;
  uint32_t lastHorizonUpdateMs = 0;
};

struct MarlinLogEntry {
  uint32_t id = 0;
  uint32_t timeMs = 0;
  String direction;
  bool priority = false;
  String text;
  String level = "info";
};

struct PositionTelemetry {
  bool valid = false;
  float x = 0;
  float y = 0;
  float z = 0;
};

struct MachineFrameState {
  bool machineValid = false;
  bool absoluteFromHome = false;
  bool manualWorkFrameValid = false;
  bool workZeroValid = false;
  bool homedX = false;
  bool homedY = false;
  bool homedZ = false;
  float machineX = 0;
  float machineY = 0;
  float machineZ = 0;
  float workZeroMachineX = 0;
  float workZeroMachineY = 0;
  float workZeroMachineZ = 0;
  float stepsX = 0;
  float stepsY = 0;
  float stepsZ = 0;
  int32_t homeCountX = 0;
  int32_t homeCountY = 0;
  int32_t homeCountZ = 0;
  int32_t countX = 0;
  int32_t countY = 0;
  int32_t countZ = 0;
  String homingSessionId;
  uint32_t homingEpoch = 0;
  uint32_t revision = 0;
  uint32_t updatedAtMs = 0;
};

struct MotionTelemetryEvent {
  uint32_t sequence = 0;
  uint32_t sentAtMs = 0;
  String command;
};

enum class TelemetryChannel : uint8_t { Job, Jog, Position, Motion, Log };

struct TelemetryPacket {
  TelemetryChannel channel;
  String data;
};

enum class MachineDiscoveryState { Idle, WaitingM115 };

struct MachineProfile {
  bool available = false;
  bool refreshing = false;
  String firmwareName;
  String machineType;
  String sourceCodeUrl;
  float fullXMin = 0.0f;
  float fullXMax = kMachineXMaxMm;
  float fullYMin = 0.0f;
  float fullYMax = kMachineYMaxMm;
  float fullZMin = 0.0f;
  float fullZMax = kMachineZMaxMm;
  float workXMin = 0.0f;
  float workXMax = kMachineXMaxMm;
  float workYMin = 0.0f;
  float workYMax = kMachineYMaxMm;
  float workZMin = 0.0f;
  float workZMax = kMachineZMaxMm;
  bool capEmergencyParser = false;
  bool capArcs = false;
  bool capAutoreportPos = false;
  bool capEeprom = false;
  bool capSdCard = false;
  bool capMotionModes = false;
  uint32_t refreshedAtMs = 0;
  String lastError;
};

struct DeviceIdentity {
  String deviceId;
  String hostname = kDefaultDeviceHostname;
  String friendlyName = kDefaultDeviceFriendlyName;
  String source = "defaults";
  bool mdnsEnabled = false;
  bool bluetoothEnabled = true;
  bool bluetoothAdvertiseName = true;
  bool bluetoothStarted = false;
  String bluetoothName;
};

WebServer server(80);
WebSocketsServer telemetrySocket(kTelemetryWebSocketPort);
Preferences wifiPrefs;
Preferences machinePrefs;
Preferences devicePrefs;
DeviceIdentity deviceIdentity;
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
uint32_t jobCommandStartedAtMs = 0;
uint32_t jobCommandLivenessAtMs = 0;
JogStatus jogStatus;
constexpr uint8_t kMaxPriorityCommands = 12;
String priorityCommands[kMaxPriorityCommands];
uint8_t priorityCommandCount = 0;
uint8_t priorityCommandIndex = 0;
String priorityResponseBuffer;
uint32_t priorityCommandStartedAtMs = 0;
uint32_t priorityCommandLivenessAtMs = 0;
MarlinLogEntry marlinLog[kMarlinLogSize];
size_t marlinLogNext = 0;
size_t marlinLogCount = 0;
String lastCriticalMarlinMessage;
uint32_t nextMarlinLogId = 1;
uint32_t telemetryLastLogId = 0;
volatile bool telemetryLogSubscribed[WEBSOCKETS_SERVER_CLIENT_MAX] = {};
volatile bool telemetryClientConnected[WEBSOCKETS_SERVER_CLIENT_MAX] = {};
bool telemetryJobDirty = true;
bool telemetryJogDirty = true;
bool telemetryPositionDirty = false;
uint32_t telemetryRevision = 0;
QueueHandle_t telemetryQueue = nullptr;
TaskHandle_t telemetryTaskHandle = nullptr;
String telemetryCachedJob = "null";
String telemetryCachedJog = "null";
String telemetryCachedPosition = "null";
uint32_t telemetryLastBroadcastMs = 0;
uint32_t telemetryLastJobProgressMs = 0;
MotionTelemetryEvent motionTelemetry[kMotionTelemetrySize];
size_t motionTelemetryCount = 0;
uint32_t motionTelemetryDropped = 0;
uint8_t marlinAutoreportSeconds = 0;
String marlinAsyncLine;
String streamMotionMode = "G0";
PositionTelemetry marlinPosition;
MachineFrameState machineFrame;
String bootSessionId;
MachineProfile machineProfile;
MachineDiscoveryState machineDiscoveryState = MachineDiscoveryState::Idle;
String machineDiscoveryResponse;
uint32_t machineDiscoveryStartedAtMs = 0;
bool machineDiscoveryPending = true;

String readJobJsonSnippet(const String &jobPath);
bool jobFileContainsText(const String &jobPath, const String &needle);
bool jobJsonAllowsWorkspaceCommands(const String &jobPath);
String extractWorkspaceCommand(const String &line);
bool handleWorkspaceCommand(const String &line);
bool runJobStartPreamble();
bool responseContainsToken(const String &response, const char *token);
void resetFeedOverrideAfterJobIfNeeded();
void updatePositionFromMarlinResponse(const String &response);
String machineFrameJson();
void drainMarlinInput();
bool sendMarlinControlCommand(const String &cmd, String &response);
void sendJsonError(int status, const String &message);
bool enqueueTelemetry(TelemetryChannel channel, const String &data);

String marlinMessageLevel(String text) {
  text.toLowerCase();
  if (text.indexOf("error:") >= 0 || text.indexOf("alarm") >= 0 || text.indexOf("kill") >= 0 ||
      text.indexOf("printer halted") >= 0 || text.indexOf("endstops hit") >= 0 ||
      text.indexOf("resend") >= 0 || text.indexOf("timeout") >= 0) {
    return "error";
  }
  if (text.indexOf("busy:") >= 0) {
    return "info";
  }
  return "info";
}

void addMarlinLog(const String &direction, bool priority, const String &text, const String &level = "") {
  if (text.length() == 0) {
    return;
  }

  MarlinLogEntry &entry = marlinLog[marlinLogNext];
  entry.id = nextMarlinLogId++;
  entry.timeMs = millis();
  entry.direction = direction;
  entry.priority = priority;
  entry.text = text;
  entry.level = level.length() > 0 ? level : marlinMessageLevel(text);

  if (entry.level == "error" || entry.level == "warning") {
    lastCriticalMarlinMessage = entry.text;
  }

  marlinLogNext = (marlinLogNext + 1) % kMarlinLogSize;
  if (marlinLogCount < kMarlinLogSize) {
    marlinLogCount += 1;
  }
}

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

void skipJsonWhitespace(const String &json, size_t &index) {
  while (index < json.length()) {
    const char c = json[index];
    if (c != ' ' && c != '\t' && c != '\r' && c != '\n') break;
    ++index;
  }
}

bool consumeJsonCharacter(const String &json, size_t &index, char expected) {
  skipJsonWhitespace(json, index);
  if (index >= json.length() || json[index] != expected) return false;
  ++index;
  return true;
}

bool parseJsonStringValue(const String &json, size_t &index, String &value) {
  skipJsonWhitespace(json, index);
  if (index >= json.length() || json[index] != '"') return false;
  ++index;
  value = "";

  bool escaped = false;
  while (index < json.length()) {
    const char c = json[index++];
    if (escaped) {
      switch (c) {
      case 'n': value += '\n'; break;
      case 'r': value += '\r'; break;
      case 't': value += '\t'; break;
      case '"':
      case '\\':
      case '/': value += c; break;
      default: return false;
      }
      escaped = false;
    } else if (c == '\\') {
      escaped = true;
    } else if (c == '"') {
      return true;
    } else if (static_cast<uint8_t>(c) < 0x20) {
      return false;
    } else {
      value += c;
    }
  }

  return false;
}

bool parseJsonBoolValue(const String &json, size_t &index, bool &value) {
  skipJsonWhitespace(json, index);
  if (json.startsWith("true", index)) {
    index += 4;
    value = true;
    return true;
  }
  if (json.startsWith("false", index)) {
    index += 5;
    value = false;
    return true;
  }
  return false;
}

bool parseDeviceConfigObject(const String &json, size_t &index, String &hostname,
                             String &friendlyName) {
  if (!consumeJsonCharacter(json, index, '{')) return false;
  bool hostnameFound = false;
  bool friendlyNameFound = false;
  while (true) {
    skipJsonWhitespace(json, index);
    if (index < json.length() && json[index] == '}') {
      ++index;
      break;
    }

    String key;
    String value;
    if (!parseJsonStringValue(json, index, key) || !consumeJsonCharacter(json, index, ':') ||
        !parseJsonStringValue(json, index, value)) {
      return false;
    }
    if (key == "hostname") {
      hostname = value;
      hostnameFound = true;
    } else if (key == "friendlyName") {
      friendlyName = value;
      friendlyNameFound = true;
    } else {
      return false;
    }

    skipJsonWhitespace(json, index);
    if (index < json.length() && json[index] == ',') {
      ++index;
      continue;
    }
    if (index < json.length() && json[index] == '}') {
      ++index;
      return hostnameFound && friendlyNameFound;
    }
    return false;
  }
  return hostnameFound && friendlyNameFound;
}

bool parseBluetoothConfigObject(const String &json, size_t &index, bool &enabled,
                                bool &advertiseName) {
  if (!consumeJsonCharacter(json, index, '{')) return false;
  bool enabledFound = false;
  bool advertiseNameFound = false;
  while (true) {
    skipJsonWhitespace(json, index);
    if (index < json.length() && json[index] == '}') {
      ++index;
      return enabledFound && advertiseNameFound;
    }

    String key;
    bool value = false;
    if (!parseJsonStringValue(json, index, key) || !consumeJsonCharacter(json, index, ':') ||
        !parseJsonBoolValue(json, index, value)) {
      return false;
    }
    if (key == "enabled") {
      enabled = value;
      enabledFound = true;
    } else if (key == "advertiseName") {
      advertiseName = value;
      advertiseNameFound = true;
    } else {
      return false;
    }

    skipJsonWhitespace(json, index);
    if (index < json.length() && json[index] == ',') {
      ++index;
      continue;
    }
    if (index < json.length() && json[index] == '}') {
      ++index;
      return enabledFound && advertiseNameFound;
    }
    return false;
  }
}

bool parseDeviceConfigJson(const String &json, String &hostname, String &friendlyName,
                           bool &bluetoothEnabled, bool &bluetoothAdvertiseName) {
  size_t index = 0;
  if (!consumeJsonCharacter(json, index, '{')) return false;

  bool deviceFound = false;
  bool bluetoothFound = false;
  while (true) {
    skipJsonWhitespace(json, index);
    if (index < json.length() && json[index] == '}') {
      ++index;
      break;
    }

    String key;
    if (!parseJsonStringValue(json, index, key) || !consumeJsonCharacter(json, index, ':')) {
      return false;
    }
    if (key == "device" && !deviceFound) {
      if (!parseDeviceConfigObject(json, index, hostname, friendlyName)) return false;
      deviceFound = true;
    } else if (key == "bluetooth" && !bluetoothFound) {
      if (!parseBluetoothConfigObject(json, index, bluetoothEnabled, bluetoothAdvertiseName)) {
        return false;
      }
      bluetoothFound = true;
    } else {
      return false;
    }

    skipJsonWhitespace(json, index);
    if (index < json.length() && json[index] == ',') {
      ++index;
      continue;
    }
    if (index < json.length() && json[index] == '}') {
      ++index;
      break;
    }
    return false;
  }

  skipJsonWhitespace(json, index);
  hostname.trim();
  friendlyName.trim();
  return index == json.length() && deviceFound && hostname.length() > 0 &&
         friendlyName.length() > 0;
}

String deviceIdFromMac() {
  char suffix[7];
  const uint64_t mac = ESP.getEfuseMac();
  snprintf(suffix, sizeof(suffix), "%06llX", mac & 0xFFFFFFULL);
  return String(suffix);
}

String safeDeviceHostnameFallback(const String &deviceId) {
  String fallback = "esp32-cnc-" + deviceId;
  fallback.toLowerCase();
  return fallback;
}

String sanitizeDeviceHostname(String hostname, const String &deviceId) {
  hostname.trim();
  hostname.toLowerCase();
  if (hostname.endsWith(".local")) {
    hostname.remove(hostname.length() - 6);
    hostname.trim();
  }

  String sanitized;
  sanitized.reserve(min(static_cast<size_t>(63), hostname.length()));
  bool previousWasHyphen = false;
  for (size_t i = 0; i < hostname.length() && sanitized.length() < 63; ++i) {
    const char c = hostname[i];
    const bool alphaNumeric = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
    if (alphaNumeric) {
      sanitized += c;
      previousWasHyphen = false;
    } else if (!previousWasHyphen && sanitized.length() > 0) {
      sanitized += '-';
      previousWasHyphen = true;
    }
  }

  while (sanitized.endsWith("-")) sanitized.remove(sanitized.length() - 1);
  return sanitized.length() > 0 ? sanitized : safeDeviceHostnameFallback(deviceId);
}

bool readDeviceConfigFile(const String &path, String &hostname, String &friendlyName,
                          bool &bluetoothEnabled, bool &bluetoothAdvertiseName) {
  File file = SD_MMC.open(path, FILE_READ);
  if (!file || file.isDirectory() || file.size() == 0 || file.size() > kMaxDeviceConfigBytes) {
    if (file) file.close();
    return false;
  }

  String json;
  json.reserve(file.size());
  while (file.available()) json += static_cast<char>(file.read());
  file.close();
  return parseDeviceConfigJson(json, hostname, friendlyName, bluetoothEnabled,
                               bluetoothAdvertiseName);
}

void saveDeviceIdentityToNvs() {
  devicePrefs.begin(kDevicePrefsNamespace, false);
  devicePrefs.putString(kDevicePrefsHostnameKey, deviceIdentity.hostname);
  devicePrefs.putString(kDevicePrefsFriendlyNameKey, deviceIdentity.friendlyName);
  devicePrefs.putBool(kDevicePrefsBleEnabledKey, deviceIdentity.bluetoothEnabled);
  devicePrefs.putBool(kDevicePrefsBleNameKey, deviceIdentity.bluetoothAdvertiseName);
  devicePrefs.end();
}

void saveDeviceIdentityToNvs(const String &hostname, const String &friendlyName) {
  devicePrefs.begin(kDevicePrefsNamespace, false);
  devicePrefs.putString(kDevicePrefsHostnameKey, hostname);
  devicePrefs.putString(kDevicePrefsFriendlyNameKey, friendlyName);
  devicePrefs.putBool(kDevicePrefsBleEnabledKey, deviceIdentity.bluetoothEnabled);
  devicePrefs.putBool(kDevicePrefsBleNameKey, deviceIdentity.bluetoothAdvertiseName);
  devicePrefs.end();
}

bool writeDeviceConfigToSd(const String &hostname, const String &friendlyName, String &error) {
  if (!sdMounted) {
    error = "SD card is not mounted; identity was saved to NVS only.";
    return false;
  }

  SD_MMC.mkdir("/esp32-cnc");
  const String tempPath = "/esp32-cnc/config.tmp";
  SD_MMC.remove(tempPath);

  String json = "{\n  \"device\": {\n    \"hostname\": \"" + jsonEscape(hostname);
  json += "\",\n    \"friendlyName\": \"" + jsonEscape(friendlyName);
  json += "\"\n  },\n  \"bluetooth\": {\n    \"enabled\": ";
  json += deviceIdentity.bluetoothEnabled ? "true" : "false";
  json += ",\n    \"advertiseName\": ";
  json += deviceIdentity.bluetoothAdvertiseName ? "true" : "false";
  json += "\n  }\n}\n";

  File file = SD_MMC.open(tempPath, FILE_WRITE);
  if (!file) {
    error = "SD config is not writable; identity was saved to NVS only.";
    return false;
  }
  const size_t written = file.print(json);
  file.flush();
  file.close();
  if (written != json.length()) {
    SD_MMC.remove(tempPath);
    error = "SD config write was incomplete; identity was saved to NVS only.";
    return false;
  }

  const String backupPath = "/esp32-cnc/config.bak";
  SD_MMC.remove(backupPath);
  const bool hadExistingConfig = SD_MMC.exists(kPrimaryDeviceConfigPath);
  if (hadExistingConfig && !SD_MMC.rename(kPrimaryDeviceConfigPath, backupPath)) {
    SD_MMC.remove(tempPath);
    error = "Existing SD config could not be preserved; identity was saved to NVS only.";
    return false;
  }
  if (!SD_MMC.rename(tempPath, kPrimaryDeviceConfigPath)) {
    SD_MMC.remove(tempPath);
    if (hadExistingConfig) SD_MMC.rename(backupPath, kPrimaryDeviceConfigPath);
    error = "SD config could not be installed; identity was saved to NVS only.";
    return false;
  }
  SD_MMC.remove(backupPath);
  return true;
}

void loadDeviceIdentity() {
  deviceIdentity = DeviceIdentity{};
  deviceIdentity.deviceId = deviceIdFromMac();

  String configPath;
  if (sdMounted && SD_MMC.exists(kPrimaryDeviceConfigPath)) {
    configPath = kPrimaryDeviceConfigPath;
  } else if (sdMounted && SD_MMC.exists(kFallbackDeviceConfigPath)) {
    configPath = kFallbackDeviceConfigPath;
  }

  String hostname;
  String friendlyName;
  bool bluetoothEnabled = true;
  bool bluetoothAdvertiseName = true;
  if (configPath.length() > 0 &&
      readDeviceConfigFile(configPath, hostname, friendlyName, bluetoothEnabled,
                           bluetoothAdvertiseName)) {
    deviceIdentity.hostname = sanitizeDeviceHostname(hostname, deviceIdentity.deviceId);
    deviceIdentity.friendlyName = friendlyName;
    deviceIdentity.bluetoothEnabled = bluetoothEnabled;
    deviceIdentity.bluetoothAdvertiseName = bluetoothAdvertiseName;
    deviceIdentity.source = "sd";
    saveDeviceIdentityToNvs();
    return;
  }

  devicePrefs.begin(kDevicePrefsNamespace, true);
  hostname = devicePrefs.getString(kDevicePrefsHostnameKey, "");
  friendlyName = devicePrefs.getString(kDevicePrefsFriendlyNameKey, "");
  bluetoothEnabled = devicePrefs.getBool(kDevicePrefsBleEnabledKey, true);
  bluetoothAdvertiseName = devicePrefs.getBool(kDevicePrefsBleNameKey, true);
  devicePrefs.end();
  hostname.trim();
  friendlyName.trim();
  if (hostname.length() > 0 && friendlyName.length() > 0) {
    deviceIdentity.hostname = sanitizeDeviceHostname(hostname, deviceIdentity.deviceId);
    deviceIdentity.friendlyName = friendlyName;
    deviceIdentity.bluetoothEnabled = bluetoothEnabled;
    deviceIdentity.bluetoothAdvertiseName = bluetoothAdvertiseName;
    deviceIdentity.source = "nvs";
  }
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
  telemetryJobDirty = true;
}

void touchJobProgress() {
  const uint32_t now = millis();
  jobStatus.updatedAtMs = now;
  if (now - telemetryLastJobProgressMs >= kJobProgressBroadcastMs) {
    telemetryJobDirty = true;
    telemetryLastJobProgressMs = now;
  }
}

bool streamLineIsMotion(const String &line) {
  bool hasAxis = false;
  int start = 0;
  while (start < line.length()) {
    while (start < line.length() && line[start] == ' ') ++start;
    int end = line.indexOf(' ', start);
    if (end < 0) end = line.length();
    String token = line.substring(start, end);
    token.toUpperCase();
    if (token == "G0" || token == "G00") streamMotionMode = "G0";
    else if (token == "G1" || token == "G01") streamMotionMode = "G1";
    else if (token == "G2" || token == "G02") streamMotionMode = "G2";
    else if (token == "G3" || token == "G03") streamMotionMode = "G3";
    if (token.length() > 1 && (token[0] == 'X' || token[0] == 'Y' || token[0] == 'Z')) hasAxis = true;
    start = end + 1;
  }
  return hasAxis && (streamMotionMode == "G0" || streamMotionMode == "G1" ||
                     streamMotionMode == "G2" || streamMotionMode == "G3");
}

void queueMotionTelemetry(const String &command, uint32_t sequence) {
  if (!streamLineIsMotion(command)) return;
  size_t index = motionTelemetryCount;
  if (motionTelemetryCount >= kMotionTelemetrySize) {
    index = kMotionTelemetrySize - 1;
    ++motionTelemetryDropped;
  } else {
    ++motionTelemetryCount;
  }
  motionTelemetry[index].sequence = sequence;
  motionTelemetry[index].sentAtMs = millis();
  motionTelemetry[index].command = command;
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
  json += "\",\"streamMode\":\"";
  json += jsonEscape(jobStatus.streamMode);
  json += "\",\"safeStartZ\":";
  json += String(jobStatus.safeStartZ, 3);
  json += ",\"travelFeedMmMin\":";
  json += String(jobStatus.travelFeedMmMin, 0);
  json += ",\"allowedWorkspaceCommands\":";
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
  json += "\",\"lastSentCommand\":\"";
  json += jsonEscape(jobStatus.lastCommand);
  json += "\",\"lastResponse\":\"";
  json += jsonEscape(jobStatus.lastResponse);
  json += "\",\"lastMarlinResponse\":\"";
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
  json += "\",\"position\":";
  if (marlinPosition.valid) {
    json += "{\"x\":" + String(marlinPosition.x, 3) + ",\"y\":" + String(marlinPosition.y, 3) +
            ",\"z\":" + String(marlinPosition.z, 3) + "}";
  } else {
    json += "null";
  }
  json += ",\"machinePosition\":";
  if (machineFrame.machineValid) {
    json += "{\"x\":" + String(machineFrame.machineX, 3) + ",\"y\":" + String(machineFrame.machineY, 3) +
            ",\"z\":" + String(machineFrame.machineZ, 3) + "}";
  } else {
    json += "null";
  }
  json += ",\"uptimeMs\":";
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
  json += ",\"originalZCaptured\":";
  json += jogStatus.originalZCaptured ? "true" : "false";
  json += ",\"originalZ\":";
  json += jogStatus.originalZCaptured ? String(jogStatus.originalZ, 3) : "null";
  json += ",\"safeLiftWorkZ\":";
  json += jogStatus.safeLiftWorkZCaptured ? String(jogStatus.safeLiftWorkZ, 3) : "null";
  json += ",\"zChangedDuringJog\":";
  json += jogStatus.zChangedDuringJog ? "true" : "false";
  json += ",\"zRestoreAvailable\":";
  json += jogStatus.zRestoreAvailable ? "true" : "false";
  json += ",\"commandedPositionCaptured\":";
  json += jogStatus.commandedPositionCaptured ? "true" : "false";
  json += ",\"commandedWorkX\":";
  json += jogStatus.commandedPositionCaptured ? String(jogStatus.commandedWorkX, 3) : "null";
  json += ",\"commandedWorkY\":";
  json += jogStatus.commandedPositionCaptured ? String(jogStatus.commandedWorkY, 3) : "null";
  json += ",\"commandedWorkZ\":";
  json += jogStatus.commandedPositionCaptured ? String(jogStatus.commandedWorkZ, 3) : "null";
  json += ",\"xyFeedMax\":";
  json += String(jogStatus.xyFeedMax, 0);
  json += ",\"zFeedMax\":";
  json += String(jogStatus.zFeedMax, 0);
  json += ",\"tickIntervalMs\":";
  json += String(kJogTickIntervalMs);
  json += ",\"pendingMoveAcks\":";
  json += String(jogStatus.pendingMoveAcks);
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

String telemetryMessage(const char *type, const char *channel, const String &data) {
  String json = "{\"type\":\"";
  json += type;
  json += "\",\"revision\":";
  json += String(++telemetryRevision);
  if (channel != nullptr) {
    json += ",\"channel\":\"";
    json += channel;
    json += "\"";
  }
  json += ",\"data\":";
  json += data;
  json += "}";
  return json;
}

String telemetrySnapshotData() {
  String data = "{\"job\":";
  data += telemetryCachedJob;
  data += ",\"jog\":";
  data += telemetryCachedJog;
  data += ",\"position\":";
  data += telemetryCachedPosition;
  data += "}";
  return data;
}

void handleTelemetrySocket(uint8_t client, WStype_t type, uint8_t *payload, size_t length) {
  if (type == WStype_CONNECTED) {
    telemetryClientConnected[client] = true;
    telemetryLogSubscribed[client] = false;
    String snapshot = telemetryMessage("snapshot", nullptr, telemetrySnapshotData());
    telemetrySocket.sendTXT(client, snapshot);
  } else if (type == WStype_DISCONNECTED) {
    telemetryClientConnected[client] = false;
    telemetryLogSubscribed[client] = false;
  } else if (type == WStype_TEXT) {
    String message;
    message.reserve(length);
    for (size_t i = 0; i < length; ++i) message += static_cast<char>(payload[i]);
    telemetryLogSubscribed[client] = message.indexOf("\"log\":true") >= 0;
  }
}

bool telemetryHasLogSubscriber() {
  for (uint8_t client = 0; client < WEBSOCKETS_SERVER_CLIENT_MAX; ++client) {
    if (telemetryLogSubscribed[client]) return true;
  }
  return false;
}

String marlinLogEntryJson(const MarlinLogEntry &entry) {
  String json = "{\"id\":";
  json += String(entry.id);
  json += ",\"time\":\"";
  json += String(entry.timeMs);
  json += "\",\"direction\":\"";
  json += jsonEscape(entry.direction);
  json += "\",\"priority\":";
  json += entry.priority ? "true" : "false";
  json += ",\"text\":\"";
  json += jsonEscape(entry.text);
  json += "\",\"level\":\"";
  json += jsonEscape(entry.level);
  json += "\"}";
  return json;
}

void broadcastPendingLogEntries() {
  if (!telemetryHasLogSubscriber()) return;
  for (size_t i = 0; i < marlinLogCount; ++i) {
    const size_t index = (marlinLogNext + kMarlinLogSize - marlinLogCount + i) % kMarlinLogSize;
    const MarlinLogEntry &entry = marlinLog[index];
    if (entry.id <= telemetryLastLogId) continue;
    String data = "{\"entries\":[";
    data += marlinLogEntryJson(entry);
    data += "],\"nextId\":";
    data += String(entry.id);
    data += ",\"lastCritical\":";
    data += lastCriticalMarlinMessage.length() > 0 ? "\"" + jsonEscape(lastCriticalMarlinMessage) + "\"" : "null";
    data += "}";
    if (!enqueueTelemetry(TelemetryChannel::Log, data)) return;
    telemetryLastLogId = entry.id;
  }
}

void broadcastPendingMotionEvents() {
  if (motionTelemetryCount == 0) return;
  String data = "{\"events\":[";
  for (size_t i = 0; i < motionTelemetryCount; ++i) {
    if (i > 0) data += ',';
    const MotionTelemetryEvent &event = motionTelemetry[i];
    data += "{\"sequence\":" + String(event.sequence);
    data += ",\"sentAtMs\":" + String(event.sentAtMs);
    data += ",\"command\":\"" + jsonEscape(event.command) + "\"}";
  }
  data += "],\"dropped\":" + String(motionTelemetryDropped);
  data += ",\"feedOverridePercent\":" + String(jobStatus.feedOverridePercent) + "}";
  enqueueTelemetry(TelemetryChannel::Motion, data);
  motionTelemetryCount = 0;
  motionTelemetryDropped = 0;
}

const char *telemetryChannelName(TelemetryChannel channel) {
  switch (channel) {
  case TelemetryChannel::Job: return "job";
  case TelemetryChannel::Jog: return "jog";
  case TelemetryChannel::Position: return "position";
  case TelemetryChannel::Motion: return "motion";
  case TelemetryChannel::Log: return "log";
  }
  return "unknown";
}

bool enqueueTelemetry(TelemetryChannel channel, const String &data) {
  if (telemetryQueue == nullptr) return false;
  TelemetryPacket *packet = new TelemetryPacket{channel, data};
  if (packet == nullptr) return false;
  if (xQueueSend(telemetryQueue, &packet, 0) != pdTRUE) {
    delete packet;
    return false;
  }
  return true;
}

void processTelemetryPacket(TelemetryPacket *packet) {
  if (packet == nullptr) return;
  if (packet->channel == TelemetryChannel::Job) telemetryCachedJob = packet->data;
  if (packet->channel == TelemetryChannel::Jog) telemetryCachedJog = packet->data;
  if (packet->channel == TelemetryChannel::Position) telemetryCachedPosition = packet->data;

  String message = telemetryMessage("delta", telemetryChannelName(packet->channel), packet->data);
  if (packet->channel == TelemetryChannel::Log) {
    for (uint8_t client = 0; client < WEBSOCKETS_SERVER_CLIENT_MAX; ++client) {
      if (telemetryLogSubscribed[client]) telemetrySocket.sendTXT(client, message);
    }
  } else {
    telemetrySocket.broadcastTXT(message);
  }
  delete packet;
}

void telemetryNetworkTask(void *) {
  for (;;) {
    telemetrySocket.loop();
    TelemetryPacket *packet = nullptr;
    if (xQueueReceive(telemetryQueue, &packet, pdMS_TO_TICKS(5)) == pdTRUE) {
      processTelemetryPacket(packet);
    } else {
      vTaskDelay(pdMS_TO_TICKS(1));
    }
  }
}

void processTelemetrySocket() {
  const uint32_t now = millis();
  if (now - telemetryLastBroadcastMs < kTelemetryMinBroadcastMs) {
    return;
  }

  if (telemetryJobDirty) {
    telemetryJobDirty = !enqueueTelemetry(TelemetryChannel::Job, jobStatusJson());
  }
  if (telemetryJogDirty) {
    telemetryJogDirty = !enqueueTelemetry(TelemetryChannel::Jog, jogStatusJson());
  }
  if (telemetryPositionDirty && marlinPosition.valid) {
    telemetryPositionDirty = !enqueueTelemetry(TelemetryChannel::Position, machineFrameJson());
  }
  broadcastPendingMotionEvents();
  broadcastPendingLogEntries();
  telemetryLastBroadcastMs = now;
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
  // UART0 is reserved exclusively for Marlin commands and responses.
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

void markSdUpdateFailed(const String &message, bool removeInstallMarker = true) {
  logSdUpdate("SD rescue update failed: " + message);
  if (removeInstallMarker) SD_MMC.remove(kSdInstallMarkerPath);

  File failed = SD_MMC.open(kSdFailedMarkerPath, FILE_WRITE);
  if (failed) {
    failed.println(message);
    failed.close();
  }
}

bool checkForSdRescueUpdate() {
  if (!initializeSdCard()) {
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

bool checkForRootFirmwareUpdate() {
  if (!initializeSdCard() || !SD_MMC.exists(kSdRootUpdateBinPath)) return false;
  logSdUpdate("Root firmware update found at /firmware.bin");
  return true;
}

bool performSdFirmwareUpdate(const char *sourcePath, const char *donePath,
                             bool removeInstallMarker, const String &label) {
  File updateFile = SD_MMC.open(sourcePath, FILE_READ);
  if (!updateFile) {
    markSdUpdateFailed("Could not open " + String(sourcePath), removeInstallMarker);
    return false;
  }

  const size_t fileSize = updateFile.size();
  const size_t maxSketchSpace = ESP.getFreeSketchSpace();

  if (fileSize == 0) {
    updateFile.close();
    markSdUpdateFailed(String(sourcePath) + " is empty", removeInstallMarker);
    return false;
  }

  if (fileSize > maxSketchSpace) {
    updateFile.close();
    markSdUpdateFailed(String(sourcePath) + " is larger than free sketch space", removeInstallMarker);
    return false;
  }

  logSdUpdate("Starting " + label + " update, bytes: " + String(fileSize));
  if (!Update.begin(fileSize)) {
    const String error = Update.errorString();
    updateFile.close();
    markSdUpdateFailed("Update.begin failed: " + error, removeInstallMarker);
    return false;
  }

  const size_t written = Update.writeStream(updateFile);
  updateFile.close();
  logSdUpdate(label + " update bytes written: " + String(written));

  if (written != fileSize) {
    const String error = Update.errorString();
    Update.abort();
    markSdUpdateFailed("Update.writeStream wrote " + String(written) + " of " + String(fileSize) + ": " + error,
                       removeInstallMarker);
    return false;
  }

  if (!Update.end()) {
    const String error = Update.errorString();
    markSdUpdateFailed("Update.end failed: " + error, removeInstallMarker);
    return false;
  }

  if (!Update.isFinished()) {
    markSdUpdateFailed("Update did not finish", removeInstallMarker);
    return false;
  }

  if (removeInstallMarker) SD_MMC.remove(kSdInstallMarkerPath);
  SD_MMC.remove(donePath);
  if (!SD_MMC.rename(sourcePath, donePath)) {
    logSdUpdate(label + " update succeeded, but firmware could not be renamed to " + String(donePath));
  } else {
    logSdUpdate(label + " update renamed " + String(sourcePath) + " to " + String(donePath));
  }

  logSdUpdate(label + " update succeeded; rebooting");
  return true;
}

bool performSdRescueUpdate() {
  return performSdFirmwareUpdate(kSdUpdateBinPath, kSdDoneBinPath, true, "SD rescue");
}

bool performRootFirmwareUpdate() {
  return performSdFirmwareUpdate(kSdRootUpdateBinPath, kSdRootDoneBinPath, false, "Root firmware");
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

bool marlinResponseIsTerminal(const String &response) {
  int lineStart = 0;
  while (lineStart < response.length()) {
    int lineEnd = response.indexOf('\n', lineStart);
    if (lineEnd < 0) {
      lineEnd = response.length();
    }

    String line = response.substring(lineStart, lineEnd);
    line.trim();
    line.toUpperCase();
    if (line == "OK" || line.startsWith("OK ") || line.startsWith("ERROR:") ||
        line.startsWith("ALARM:") || line == "!!") {
      return true;
    }
    lineStart = lineEnd + 1;
  }
  return false;
}

String readMarlinResponseFor(uint32_t timeoutMs, bool priority = false) {
  String response;
  const uint32_t start = millis();

  while (millis() - start < timeoutMs) {
    bool received = false;
    while (Serial.available() > 0) {
      response += static_cast<char>(Serial.read());
      received = true;
    }
    if (received && marlinResponseIsTerminal(response)) {
      break;
    }
    delay(1);
  }

  addMarlinLog("rx", priority, response);
  updatePositionFromMarlinResponse(response);
  return response;
}

String readMarlinResponse(bool priority = false) {
  return readMarlinResponseFor(kMarlinTimeoutMs, priority);
}

bool telemetryHasClient() {
  for (uint8_t client = 0; client < WEBSOCKETS_SERVER_CLIENT_MAX; ++client) {
    if (telemetryClientConnected[client]) return true;
  }
  return false;
}

String responseField(const String &response, const char *field, const char *nextField = nullptr) {
  const String key = String(field) + ":";
  const int start = response.indexOf(key);
  if (start < 0) return "";
  int end = nextField ? response.indexOf(String(" ") + nextField + ":", start + key.length()) : -1;
  if (end < 0) end = response.indexOf('\n', start + key.length());
  if (end < 0) end = response.length();
  String value = response.substring(start + key.length(), end);
  value.trim();
  return value;
}

bool responseCapability(const String &response, const char *name) {
  return response.indexOf(String("Cap:") + name + ":1") >= 0;
}

void saveMachineProfile() {
  machinePrefs.begin(kMachinePrefsNamespace, false);
  machinePrefs.putBool("available", machineProfile.available);
  machinePrefs.putString("fw", machineProfile.firmwareName);
  machinePrefs.putString("type", machineProfile.machineType);
  machinePrefs.putString("url", machineProfile.sourceCodeUrl);
  machinePrefs.putFloat("fx0", machineProfile.fullXMin);
  machinePrefs.putFloat("fx1", machineProfile.fullXMax);
  machinePrefs.putFloat("fy0", machineProfile.fullYMin);
  machinePrefs.putFloat("fy1", machineProfile.fullYMax);
  machinePrefs.putFloat("fz0", machineProfile.fullZMin);
  machinePrefs.putFloat("fz1", machineProfile.fullZMax);
  machinePrefs.putFloat("wx0", machineProfile.workXMin);
  machinePrefs.putFloat("wx1", machineProfile.workXMax);
  machinePrefs.putFloat("wy0", machineProfile.workYMin);
  machinePrefs.putFloat("wy1", machineProfile.workYMax);
  machinePrefs.putFloat("wz0", machineProfile.workZMin);
  machinePrefs.putFloat("wz1", machineProfile.workZMax);
  machinePrefs.putUChar("caps", (machineProfile.capEmergencyParser ? 1 : 0) |
                                    (machineProfile.capArcs ? 2 : 0) |
                                    (machineProfile.capAutoreportPos ? 4 : 0) |
                                    (machineProfile.capEeprom ? 8 : 0) |
                                    (machineProfile.capSdCard ? 16 : 0) |
                                    (machineProfile.capMotionModes ? 32 : 0));
  machinePrefs.end();
}

void loadMachineProfile() {
  machinePrefs.begin(kMachinePrefsNamespace, true);
  machineProfile.available = machinePrefs.getBool("available", false);
  machineProfile.firmwareName = machinePrefs.getString("fw", "");
  machineProfile.machineType = machinePrefs.getString("type", "");
  machineProfile.sourceCodeUrl = machinePrefs.getString("url", "");
  machineProfile.fullXMin = machinePrefs.getFloat("fx0", 0.0f);
  machineProfile.fullXMax = machinePrefs.getFloat("fx1", kMachineXMaxMm);
  machineProfile.fullYMin = machinePrefs.getFloat("fy0", 0.0f);
  machineProfile.fullYMax = machinePrefs.getFloat("fy1", kMachineYMaxMm);
  machineProfile.fullZMin = machinePrefs.getFloat("fz0", 0.0f);
  machineProfile.fullZMax = machinePrefs.getFloat("fz1", kMachineZMaxMm);
  machineProfile.workXMin = machinePrefs.getFloat("wx0", machineProfile.fullXMin);
  machineProfile.workXMax = machinePrefs.getFloat("wx1", machineProfile.fullXMax);
  machineProfile.workYMin = machinePrefs.getFloat("wy0", machineProfile.fullYMin);
  machineProfile.workYMax = machinePrefs.getFloat("wy1", machineProfile.fullYMax);
  machineProfile.workZMin = machinePrefs.getFloat("wz0", machineProfile.fullZMin);
  machineProfile.workZMax = machinePrefs.getFloat("wz1", machineProfile.fullZMax);
  const uint8_t caps = machinePrefs.getUChar("caps", 0);
  machinePrefs.end();
  machineProfile.capEmergencyParser = caps & 1;
  machineProfile.capArcs = caps & 2;
  machineProfile.capAutoreportPos = caps & 4;
  machineProfile.capEeprom = caps & 8;
  machineProfile.capSdCard = caps & 16;
  machineProfile.capMotionModes = caps & 32;
}

bool parseMachineProfile(const String &response) {
  machineProfile.firmwareName = responseField(response, "FIRMWARE_NAME", "SOURCE_CODE_URL");
  machineProfile.sourceCodeUrl = responseField(response, "SOURCE_CODE_URL", "PROTOCOL_VERSION");
  machineProfile.machineType = responseField(response, "MACHINE_TYPE", "EXTRUDER_COUNT");
  machineProfile.capEmergencyParser = responseCapability(response, "EMERGENCY_PARSER");
  machineProfile.capArcs = responseCapability(response, "ARCS");
  machineProfile.capAutoreportPos = responseCapability(response, "AUTOREPORT_POS");
  machineProfile.capEeprom = responseCapability(response, "EEPROM");
  machineProfile.capSdCard = responseCapability(response, "SDCARD");
  machineProfile.capMotionModes = responseCapability(response, "MOTION_MODES");

  const int areaStart = response.indexOf("area:{full:");
  int parsed = 0;
  if (areaStart >= 0) {
    parsed = sscanf(response.c_str() + areaStart,
                    "area:{full:{min:{x:%f,y:%f,z:%f},max:{x:%f,y:%f,z:%f}},work:{min:{x:%f,y:%f,z:%f},max:{x:%f,y:%f,z:%f}}}",
                    &machineProfile.fullXMin, &machineProfile.fullYMin, &machineProfile.fullZMin,
                    &machineProfile.fullXMax, &machineProfile.fullYMax, &machineProfile.fullZMax,
                    &machineProfile.workXMin, &machineProfile.workYMin, &machineProfile.workZMin,
                    &machineProfile.workXMax, &machineProfile.workYMax, &machineProfile.workZMax);
  }
  const bool saneArea = parsed == 12 && machineProfile.fullXMax > machineProfile.fullXMin &&
                        machineProfile.fullYMax > machineProfile.fullYMin &&
                        machineProfile.fullZMax > machineProfile.fullZMin &&
                        machineProfile.fullXMax <= 10000.0f && machineProfile.fullYMax <= 10000.0f &&
                        machineProfile.fullZMax <= 1000.0f;
  machineProfile.available = machineProfile.firmwareName.length() > 0 && saneArea;
  machineProfile.refreshedAtMs = millis();
  machineProfile.lastError = machineProfile.available ? "" : "M115 did not contain a usable area.full profile";
  if (machineProfile.available) saveMachineProfile();
  return machineProfile.available;
}

String machineProfileJson() {
  String json = "{\"available\":";
  json += machineProfile.available ? "true" : "false";
  json += ",\"refreshing\":";
  json += (machineDiscoveryState != MachineDiscoveryState::Idle || machineDiscoveryPending) ? "true" : "false";
  json += ",\"firmwareName\":\"" + jsonEscape(machineProfile.firmwareName) + "\"";
  json += ",\"machineType\":\"" + jsonEscape(machineProfile.machineType) + "\"";
  json += ",\"sourceCodeUrl\":\"" + jsonEscape(machineProfile.sourceCodeUrl) + "\"";
  json += ",\"full\":{\"xMin\":" + String(machineProfile.fullXMin, 3) + ",\"xMax\":" + String(machineProfile.fullXMax, 3);
  json += ",\"yMin\":" + String(machineProfile.fullYMin, 3) + ",\"yMax\":" + String(machineProfile.fullYMax, 3);
  json += ",\"zMin\":" + String(machineProfile.fullZMin, 3) + ",\"zMax\":" + String(machineProfile.fullZMax, 3) + "}";
  json += ",\"work\":{\"xMin\":" + String(machineProfile.workXMin, 3) + ",\"xMax\":" + String(machineProfile.workXMax, 3);
  json += ",\"yMin\":" + String(machineProfile.workYMin, 3) + ",\"yMax\":" + String(machineProfile.workYMax, 3);
  json += ",\"zMin\":" + String(machineProfile.workZMin, 3) + ",\"zMax\":" + String(machineProfile.workZMax, 3) + "}";
  json += ",\"capabilities\":{\"emergencyParser\":" + String(machineProfile.capEmergencyParser ? "true" : "false");
  json += ",\"arcs\":" + String(machineProfile.capArcs ? "true" : "false");
  json += ",\"autoreportPosition\":" + String(machineProfile.capAutoreportPos ? "true" : "false");
  json += ",\"eeprom\":" + String(machineProfile.capEeprom ? "true" : "false");
  json += ",\"sdCard\":" + String(machineProfile.capSdCard ? "true" : "false");
  json += ",\"motionModes\":" + String(machineProfile.capMotionModes ? "true" : "false") + "}";
  json += ",\"refreshedAtMs\":" + String(machineProfile.refreshedAtMs);
  json += ",\"lastError\":\"" + jsonEscape(machineProfile.lastError) + "\"}";
  return json;
}

bool machineDiscoveryTransportBusy() {
  return otaActive || jobIsActive() || jobWaitingForOk || priorityCommandCount > 0 || jogIsActive();
}

float machineXMin() { return machineProfile.available ? machineProfile.fullXMin : 0.0f; }
float machineXMax() { return machineProfile.available ? machineProfile.fullXMax : kMachineXMaxMm; }
float machineYMin() { return machineProfile.available ? machineProfile.fullYMin : 0.0f; }
float machineYMax() { return machineProfile.available ? machineProfile.fullYMax : kMachineYMaxMm; }
float machineZMin() { return machineProfile.available ? machineProfile.fullZMin : -30.0f; }
float machineZMax() { return machineProfile.available ? machineProfile.fullZMax : kMachineZMaxMm; }

void processMachineDiscovery() {
  if (machineDiscoveryState == MachineDiscoveryState::Idle) {
    if (!machineDiscoveryPending || millis() < 5000 || machineDiscoveryTransportBusy()) return;
    machineDiscoveryPending = false;
    machineDiscoveryResponse = "";
    machineDiscoveryStartedAtMs = millis();
    machineProfile.refreshing = true;
    machineProfile.lastError = "";
    drainMarlinInput();
    addMarlinLog("tx", false, "M115");
    Serial.print("M115\n");
    machineDiscoveryState = MachineDiscoveryState::WaitingM115;
    return;
  }

  while (Serial.available() > 0) machineDiscoveryResponse += static_cast<char>(Serial.read());
  if (marlinResponseIsTerminal(machineDiscoveryResponse)) {
    addMarlinLog("rx", false, machineDiscoveryResponse);
    parseMachineProfile(machineDiscoveryResponse);
    machineProfile.refreshing = false;
    machineDiscoveryState = MachineDiscoveryState::Idle;
  } else if (millis() - machineDiscoveryStartedAtMs > 12000) {
    machineProfile.lastError = "M115 discovery timed out";
    machineProfile.refreshing = false;
    machineDiscoveryState = MachineDiscoveryState::Idle;
  }
}

void drainMarlinInput() {
  while (Serial.available() > 0) {
    Serial.read();
  }
}

void sendMarlinSafetyCommand(const char *cmd) {
  drainMarlinInput();
  addMarlinLog("tx", true, cmd);
  Serial.print(cmd);
  Serial.print('\n');
  readMarlinResponseFor(250, true);
}

bool sendMarlinControlCommand(const String &cmd, String &response) {
  drainMarlinInput();
  addMarlinLog("tx", true, cmd);
  Serial.print(cmd);
  Serial.print('\n');
  response = readMarlinResponseFor(500, true);
  String upper = response;
  upper.toUpperCase();
  return upper.indexOf("OK") >= 0 && upper.indexOf("ERROR") < 0 && upper.indexOf("ALARM") < 0;
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
  addMarlinLog("tx", true, cmd);
  Serial.print(cmd);
  Serial.print('\n');
  const String response = readMarlinResponseFor(250, true);
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
  priorityCommandLivenessAtMs = 0;
  jobStatus.priorityCommandInProgress = false;
}

bool appendPriorityCommand(const String &command) {
  if (priorityCommandCount >= kMaxPriorityCommands) {
    return false;
  }
  priorityCommands[priorityCommandCount++] = command;
  return true;
}

void queuePriorityCommands(const char *first, const char *second = nullptr) {
  clearPriorityCommands();
  appendPriorityCommand(first);
  if (second != nullptr) {
    appendPriorityCommand(second);
  }
  jobStatus.lastPriorityCommand = "";
  jobStatus.lastPriorityResponse = "";
  jobStatus.lastPriorityError = "";
}

bool prioritySequenceIsFeedOverrideOnly() {
  return priorityCommandCount == 1 && isFeedOverrideCommand(priorityCommands[0]);
}

void queueManualM5Priority() {
  if (priorityCommandCount == 0 || prioritySequenceIsFeedOverrideOnly()) {
    queuePriorityCommands("M5");
  }
}

void startNextPriorityCommand() {
  if (priorityCommandIndex >= priorityCommandCount) {
    jobStatus.priorityCommandInProgress = false;
    return;
  }

  const String &cmd = priorityCommands[priorityCommandIndex];
  addMarlinLog("tx", true, cmd);
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
  priorityCommandLivenessAtMs = priorityCommandStartedAtMs;
  logJobEvent("priority: " + cmd);
}

uint32_t priorityAckTimeoutMs() {
  if (jobStatus.state == JobRunnerState::Pausing && jobStatus.lastPriorityCommand == "M400") {
    return kMarlinPauseDrainAckTimeoutMs;
  }
  return kMarlinCommandAckTimeoutMs;
}

void finishPrioritySequence() {
  clearPriorityCommands();
  if (jobStatus.state == JobRunnerState::Preparing) {
    if (machineProfile.capAutoreportPos) marlinAutoreportSeconds = 1;
    jobRunning = true;
    jobStatus.state = JobRunnerState::Running;
    logJobEvent("start preamble complete: " + jobStatus.gcodePath);
  } else if (jobStatus.state == JobRunnerState::Pausing) {
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

  String receivedChunk;
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    priorityResponseBuffer += c;
    receivedChunk += c;
  }
  if (responseContainsToken(receivedChunk, "busy:")) {
    priorityCommandLivenessAtMs = millis();
  }

  if (!jobStatus.priorityCommandInProgress) {
    startNextPriorityCommand();
    touchJobStatus();
    return;
  }

  if (responseContainsToken(priorityResponseBuffer, "Error:")) {
    addMarlinLog("rx", true, priorityResponseBuffer);
    jobStatus.lastPriorityResponse = priorityResponseBuffer;
    jobStatus.lastPriorityError = "Marlin reported Error for priority command";
    noteFeedOverrideResult(jobStatus.lastPriorityCommand, priorityResponseBuffer, jobStatus.lastPriorityError);
    clearPriorityCommands();
    if (jobStatus.state == JobRunnerState::Preparing || jobStatus.state == JobRunnerState::Pausing ||
        jobStatus.state == JobRunnerState::Stopping) {
      jobStatus.state = JobRunnerState::Error;
      jobStatus.lastError = jobStatus.lastPriorityError;
      jobRunning = false;
      if (jobFile) jobFile.close();
    }
    touchJobStatus();
    logJobEvent("priority error: " + jobStatus.lastPriorityError);
    return;
  }

  if (!responseContainsToken(priorityResponseBuffer, "ok")) {
    if (millis() - priorityCommandLivenessAtMs > priorityAckTimeoutMs()) {
      jobStatus.lastPriorityResponse = priorityResponseBuffer;
      jobStatus.lastPriorityError = "Priority command timed out";
      addMarlinLog("rx", true, priorityResponseBuffer.length() > 0 ? priorityResponseBuffer : "timeout", "error");
      noteFeedOverrideResult(jobStatus.lastPriorityCommand, priorityResponseBuffer, jobStatus.lastPriorityError);
      clearPriorityCommands();
      if (jobStatus.state == JobRunnerState::Preparing || jobStatus.state == JobRunnerState::Pausing ||
          jobStatus.state == JobRunnerState::Stopping) {
        jobStatus.state = JobRunnerState::Error;
        jobStatus.lastError = jobStatus.lastPriorityError;
        jobRunning = false;
        if (jobFile) jobFile.close();
      }
      touchJobStatus();
      logJobEvent("priority timeout");
    }
    return;
  }

  jobStatus.lastPriorityResponse = priorityResponseBuffer;
  addMarlinLog("rx", true, priorityResponseBuffer);
  noteFeedOverrideResult(jobStatus.lastPriorityCommand, priorityResponseBuffer);
  priorityCommandIndex += 1;
  jobStatus.priorityCommandInProgress = false;
  priorityResponseBuffer = "";
  priorityCommandStartedAtMs = 0;
  priorityCommandLivenessAtMs = 0;

  if (priorityCommandIndex >= priorityCommandCount) {
    finishPrioritySequence();
  } else {
    startNextPriorityCommand();
  }
  touchJobStatus();
}

void sendJogCommand(const String &cmd) {
  drainMarlinInput();
  addMarlinLog("tx", true, cmd);
  Serial.print(cmd);
  Serial.print('\n');
  jogStatus.lastCommand = cmd;
  readMarlinResponseFor(80, true);
  telemetryJogDirty = true;
}

String sendJogCommandForResponse(const String &cmd, uint32_t timeoutMs) {
  drainMarlinInput();
  addMarlinLog("tx", true, cmd);
  Serial.print(cmd);
  Serial.print('\n');
  jogStatus.lastCommand = cmd;
  const String response = readMarlinResponseFor(timeoutMs, true);
  telemetryJogDirty = true;
  return response;
}

bool parseAxisFromM114(const String &response, char axis, float &value) {
  String key;
  key += axis;
  key += ":";
  const int index = response.indexOf(key);
  if (index < 0) {
    return false;
  }

  int start = index + key.length();
  while (start < response.length() && response[start] == ' ') {
    ++start;
  }

  String number;
  while (start < response.length()) {
    const char c = response[start];
    if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.') {
      number += c;
      ++start;
    } else {
      break;
    }
  }

  if (number.length() == 0) {
    return false;
  }

  value = number.toFloat();
  return true;
}

bool parseAxisAfter(const String &response, int offset, char axis, float &value) {
  String key;
  key += axis;
  key += ":";
  const int index = response.indexOf(key, offset);
  if (index < 0) return false;
  int start = index + key.length();
  while (start < response.length() && response[start] == ' ') ++start;
  String number;
  while (start < response.length()) {
    const char c = response[start];
    if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.') {
      number += c;
      ++start;
    } else {
      break;
    }
  }
  if (number.length() == 0) return false;
  value = number.toFloat();
  return true;
}

bool parseM114Counts(const String &response, int32_t &x, int32_t &y, int32_t &z) {
  const int countOffset = response.lastIndexOf("Count X:");
  if (countOffset < 0) return false;
  float parsedX = 0;
  float parsedY = 0;
  float parsedZ = 0;
  if (!parseAxisAfter(response, countOffset + 6, 'X', parsedX) ||
      !parseAxisAfter(response, countOffset + 6, 'Y', parsedY) ||
      !parseAxisAfter(response, countOffset + 6, 'Z', parsedZ)) return false;
  x = static_cast<int32_t>(lroundf(parsedX));
  y = static_cast<int32_t>(lroundf(parsedY));
  z = static_cast<int32_t>(lroundf(parsedZ));
  return true;
}

bool parseWordAfter(const String &response, int offset, char letter, float &value) {
  int index = offset;
  while (index < response.length()) {
    index = response.indexOf(letter, index);
    if (index < 0) return false;
    if (index == 0 || response[index - 1] == ' ' || response[index - 1] == '\t') break;
    ++index;
  }
  int start = index + 1;
  String number;
  while (start < response.length()) {
    const char c = response[start];
    if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.') {
      number += c;
      ++start;
    } else {
      break;
    }
  }
  if (number.length() == 0) return false;
  value = number.toFloat();
  return true;
}

bool parseM92Steps(const String &response, float &x, float &y, float &z) {
  const int m92Offset = response.indexOf("M92");
  if (m92Offset < 0) return false;
  return parseWordAfter(response, m92Offset, 'X', x) &&
         parseWordAfter(response, m92Offset, 'Y', y) &&
         parseWordAfter(response, m92Offset, 'Z', z) && x > 0 && y > 0 && z > 0;
}

void updatePositionFromMarlinResponse(const String &response) {
  float x = 0;
  float y = 0;
  float z = 0;
  if (!parseAxisFromM114(response, 'X', x) || !parseAxisFromM114(response, 'Y', y) ||
      !parseAxisFromM114(response, 'Z', z)) {
    return;
  }
  const bool workChanged = !marlinPosition.valid || fabs(marlinPosition.x - x) > 0.0005f ||
      fabs(marlinPosition.y - y) > 0.0005f || fabs(marlinPosition.z - z) > 0.0005f;
  int32_t countX = 0;
  int32_t countY = 0;
  int32_t countZ = 0;
  const bool countsAvailable = machineFrame.absoluteFromHome &&
      parseM114Counts(response, countX, countY, countZ);
  const bool countsChanged = countsAvailable && (!machineFrame.machineValid || countX != machineFrame.countX ||
      countY != machineFrame.countY || countZ != machineFrame.countZ);
  if (workChanged || countsChanged) {
    marlinPosition.valid = true;
    marlinPosition.x = x;
    marlinPosition.y = y;
    marlinPosition.z = z;
    if (countsAvailable) {
      machineFrame.countX = countX;
      machineFrame.countY = countY;
      machineFrame.countZ = countZ;
      machineFrame.machineValid = true;
      machineFrame.machineX = machineProfile.fullXMin +
          static_cast<float>(countX - machineFrame.homeCountX) / machineFrame.stepsX;
      machineFrame.machineY = machineProfile.fullYMin +
          static_cast<float>(countY - machineFrame.homeCountY) / machineFrame.stepsY;
      machineFrame.machineZ = machineProfile.fullZMax +
          static_cast<float>(countZ - machineFrame.homeCountZ) / machineFrame.stepsZ;
    } else if (machineFrame.workZeroValid && !machineFrame.manualWorkFrameValid) {
      machineFrame.machineValid = true;
      machineFrame.machineX = machineFrame.workZeroMachineX + x;
      machineFrame.machineY = machineFrame.workZeroMachineY + y;
      machineFrame.machineZ = machineFrame.workZeroMachineZ + z;
    }
    machineFrame.updatedAtMs = millis();
    ++machineFrame.revision;
    telemetryPositionDirty = true;
  }
}

String machineFrameJson() {
  String json = "{\"x\":" + String(marlinPosition.x, 3) +
                ",\"y\":" + String(marlinPosition.y, 3) +
                ",\"z\":" + String(marlinPosition.z, 3);
  json += ",\"work\":{\"x\":" + String(marlinPosition.x, 3) +
          ",\"y\":" + String(marlinPosition.y, 3) +
          ",\"z\":" + String(marlinPosition.z, 3) + "}";
  if (machineFrame.machineValid) {
    json += ",\"machine\":{\"x\":" + String(machineFrame.machineX, 3) +
            ",\"y\":" + String(machineFrame.machineY, 3) +
            ",\"z\":" + String(machineFrame.machineZ, 3) + "}";
  } else {
    json += ",\"machine\":null";
  }
  if (machineFrame.workZeroValid && machineFrame.absoluteFromHome) {
    json += ",\"workZeroMachine\":{\"x\":" + String(machineFrame.workZeroMachineX, 3) +
            ",\"y\":" + String(machineFrame.workZeroMachineY, 3) +
            ",\"z\":" + String(machineFrame.workZeroMachineZ, 3) + "}";
  } else {
    json += ",\"workZeroMachine\":null";
  }
  json += ",\"homedAxes\":{\"x\":" + String(machineFrame.homedX ? "true" : "false") +
          ",\"y\":" + String(machineFrame.homedY ? "true" : "false") +
          ",\"z\":" + String(machineFrame.homedZ ? "true" : "false") + "}";
  json += ",\"homingEpoch\":" + String(machineFrame.homingEpoch);
  json += ",\"homingSessionId\":\"" + jsonEscape(machineFrame.homingSessionId) + "\"";
  json += ",\"bootSessionId\":\"" + jsonEscape(bootSessionId) + "\"";
  json += ",\"absoluteFromHome\":" + String(machineFrame.absoluteFromHome ? "true" : "false");
  json += ",\"manualWorkFrameValid\":" + String(machineFrame.manualWorkFrameValid ? "true" : "false");
  json += ",\"frameMode\":\"";
  if (machineFrame.absoluteFromHome && machineFrame.homedX && machineFrame.homedY && machineFrame.homedZ) {
    json += "homed";
  } else if (machineFrame.manualWorkFrameValid) {
    json += "manual-unhomed";
  } else {
    json += "untrusted";
  }
  json += "\"";
  if (machineFrame.absoluteFromHome) {
    json += ",\"homeReference\":{\"counts\":{\"x\":" + String(machineFrame.homeCountX) +
            ",\"y\":" + String(machineFrame.homeCountY) + ",\"z\":" + String(machineFrame.homeCountZ) + "}";
    json += ",\"stepsPerMm\":{\"x\":" + String(machineFrame.stepsX, 6) +
            ",\"y\":" + String(machineFrame.stepsY, 6) + ",\"z\":" + String(machineFrame.stepsZ, 6) + "}}";
  } else {
    json += ",\"homeReference\":null";
  }
  json += ",\"revision\":" + String(machineFrame.revision);
  json += ",\"updatedAtMs\":" + String(machineFrame.updatedAtMs);
  json += ",\"trusted\":" + String(machineFrame.machineValid && machineFrame.absoluteFromHome &&
      machineFrame.homedX && machineFrame.homedY && machineFrame.homedZ ? "true" : "false");
  json += "}";
  return json;
}

bool applyMarlinAutoreportInterval(uint8_t seconds) {
  if (!machineProfile.capAutoreportPos) return false;
  String response;
  if (!sendMarlinControlCommand("M154 S" + String(seconds), response)) return false;
  marlinAutoreportSeconds = seconds;
  return true;
}

uint8_t desiredMarlinAutoreportInterval() {
  if (!machineProfile.capAutoreportPos || !telemetryHasClient()) return 0;
  return (jobIsActive() || jogIsActive()) ? 1 : 2;
}

void processMarlinAutoreportControl() {
  const uint8_t desired = desiredMarlinAutoreportInterval();
  if (desired == marlinAutoreportSeconds) return;
  if (jobIsActive() || jobWaitingForOk || priorityCommandCount > 0 || jogIsActive() ||
      machineDiscoveryState != MachineDiscoveryState::Idle || otaActive) return;
  applyMarlinAutoreportInterval(desired);
}

void processIdleMarlinAutoreport() {
  if (jobIsActive() || jobWaitingForOk || priorityCommandCount > 0 || jogIsActive() ||
      machineDiscoveryState != MachineDiscoveryState::Idle) return;
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\n') {
      updatePositionFromMarlinResponse(marlinAsyncLine);
      marlinAsyncLine = "";
    } else if (c != '\r' && marlinAsyncLine.length() < 256) {
      marlinAsyncLine += c;
    }
  }
}

bool captureJogOriginalZ() {
  const String waitResponse = sendJogCommandForResponse("M400", 120000);
  if (!responseContainsToken(waitResponse, "ok") || responseContainsToken(waitResponse, "Error:")) {
    jogStatus.originalZCaptured = false;
    jogStatus.lastError = "Marlin did not finish motion before capturing jog Z";
    return false;
  }
  const String response = sendJogCommandForResponse("M114", 300);
  jogStatus.lastM114 = response;
  float z = 0.0f;
  if (!parseAxisFromM114(response, 'Z', z)) {
    jogStatus.originalZCaptured = false;
    jogStatus.lastError = "could not read current Z from M114 before safe jog";
    return false;
  }

  jogStatus.originalZ = z;
  jogStatus.originalZCaptured = true;
  return true;
}

bool captureJogSafeLiftWorkZ() {
  const String waitResponse = sendJogCommandForResponse("M400", 120000);
  if (!responseContainsToken(waitResponse, "ok") || responseContainsToken(waitResponse, "Error:")) {
    jogStatus.safeLiftWorkZCaptured = false;
    jogStatus.commandedPositionCaptured = false;
    jogStatus.lastError = "Marlin did not finish the Safe Z lift";
    return false;
  }
  const String response = sendJogCommandForResponse("M114", 300);
  jogStatus.lastM114 = response;
  float x = 0.0f;
  float y = 0.0f;
  float z = 0.0f;
  if (!parseAxisFromM114(response, 'X', x) || !parseAxisFromM114(response, 'Y', y) ||
      !parseAxisFromM114(response, 'Z', z)) {
    jogStatus.safeLiftWorkZCaptured = false;
    jogStatus.commandedPositionCaptured = false;
    jogStatus.lastError = "could not verify Safe Z work position with M114";
    return false;
  }

  jogStatus.safeLiftWorkZ = z;
  jogStatus.safeLiftWorkZCaptured = true;
  jogStatus.commandedWorkX = x;
  jogStatus.commandedWorkY = y;
  jogStatus.commandedWorkZ = z;
  jogStatus.commandedPositionCaptured = true;
  return true;
}

bool captureJogCommandedWorkPosition() {
  const String waitResponse = sendJogCommandForResponse("M400", 120000);
  if (!responseContainsToken(waitResponse, "ok") || responseContainsToken(waitResponse, "Error:")) {
    jogStatus.commandedPositionCaptured = false;
    jogStatus.lastError = "Marlin did not finish motion before starting absolute jog";
    return false;
  }
  const String response = sendJogCommandForResponse("M114", 300);
  jogStatus.lastM114 = response;
  float x = 0.0f;
  float y = 0.0f;
  float z = 0.0f;
  if (!parseAxisFromM114(response, 'X', x) || !parseAxisFromM114(response, 'Y', y) ||
      !parseAxisFromM114(response, 'Z', z)) {
    jogStatus.commandedPositionCaptured = false;
    jogStatus.lastError = "could not capture absolute jog position with M114";
    return false;
  }

  jogStatus.commandedWorkX = x;
  jogStatus.commandedWorkY = y;
  jogStatus.commandedWorkZ = z;
  jogStatus.commandedPositionCaptured = true;
  return true;
}

void offerJogZRestore() {
  if (!jogStatus.safeJog || !jogStatus.zLiftedForJog ||
      !jogStatus.originalZCaptured || !jogStatus.safeLiftWorkZCaptured || jogStatus.zChangedDuringJog) {
    return;
  }

  jogStatus.zRestoreAvailable = true;
  telemetryJogDirty = true;
}

void updateJogMotionHorizon(uint32_t now) {
  if (jogStatus.lastHorizonUpdateMs == 0) {
    jogStatus.lastHorizonUpdateMs = now;
    return;
  }
  const uint32_t elapsed = now - jogStatus.lastHorizonUpdateMs;
  jogStatus.lastHorizonUpdateMs = now;
  jogStatus.queuedMotionHorizonMs = elapsed >= jogStatus.queuedMotionHorizonMs
                                          ? 0
                                          : jogStatus.queuedMotionHorizonMs - elapsed;
}

void finishGracefulJogStop() {
  jogStatus.pendingMoveAcks = 0;
  jogStatus.responseLine = "";
  jogStatus.queuedMotionHorizonMs = 0;
  jogStatus.lastHorizonUpdateMs = 0;
  jogStatus.state = JogState::Idle;
  offerJogZRestore();
  telemetryJogDirty = true;
}

void stopJogInternal(bool emergencyStop) {
  if (!emergencyStop && !jogIsActive() && jogStatus.state != JogState::Error) {
    return;
  }

  jogStatus.state = JogState::Stopping;
  jogStatus.x = 0;
  jogStatus.y = 0;
  jogStatus.z = 0;
  jogStatus.speed = 0;
  jogStatus.appliedX = 0;
  jogStatus.appliedY = 0;
  jogStatus.appliedZ = 0;
  jogStatus.appliedSpeed = 0;
  if (emergencyStop) {
    sendJogCommand("M410");
    sendJogCommand("M5");
    sendJogCommand("G90");
    jogStatus.commandedPositionCaptured = false;
    jogStatus.pendingMoveAcks = 0;
    jogStatus.responseLine = "";
    jogStatus.queuedMotionHorizonMs = 0;
    jogStatus.lastHorizonUpdateMs = 0;
    jogStatus.zRestoreAvailable = false;
    jogStatus.state = JogState::Idle;
    telemetryJogDirty = true;
    return;
  }

  // Normal pointer release: stop adding absolute targets and let the short
  // planner horizon drain naturally without inserting a hard stop.
  telemetryJogDirty = true;
}

void setJogError(const String &message) {
  jogStatus.lastError = message;
  jogStatus.state = JogState::Error;
  jogStatus.commandedPositionCaptured = false;
  jogStatus.x = 0;
  jogStatus.y = 0;
  jogStatus.z = 0;
  jogStatus.speed = 0;
  logJobEvent("jog error: " + message);
  telemetryJogDirty = true;
}

bool prepareSafeJogLift() {
  if (!jogStatus.safeJog) {
    jogStatus.zLiftedForJog = false;
    return true;
  }

  if (jogStatus.safeLiftZ <= 0 || jogStatus.zFeedMax <= 0) {
    setJogError("invalid safe jog settings");
    return false;
  }

  if (!jogStatus.originalZCaptured && !captureJogOriginalZ()) {
    setJogError(jogStatus.lastError);
    return false;
  }

  jogStatus.state = JogState::PreparingSafeZ;
  sendJogCommand("M5");
  sendJogCommand("G90");
  const String liftResponse = sendJogCommandForResponse(
      "G53 G0 Z" + String(jogStatus.safeLiftZ, 3) + " F" + String(jogStatus.zFeedMax, 0), 300);
  if (responseContainsToken(liftResponse, "Error:") || responseContainsToken(liftResponse, "Unknown command")) {
    setJogError("Marlin rejected machine-coordinate safe Z move");
    return false;
  }
  sendJogCommand("G90");
  if (!captureJogSafeLiftWorkZ()) {
    setJogError(jogStatus.lastError);
    return false;
  }
  jogStatus.zLiftedForJog = true;
  telemetryJogDirty = true;
  return true;
}

float approachJogValue(float current, float target) {
  const float delta = target - current;
  if (fabs(delta) <= kJogVectorRampPerTick) return target;
  return current + (delta > 0 ? kJogVectorRampPerTick : -kJogVectorRampPerTick);
}

void processJogResponses() {
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\n') {
      String line = jogStatus.responseLine;
      jogStatus.responseLine = "";
      line.trim();
      if (line.length() == 0) continue;
      updatePositionFromMarlinResponse(line);
      String upper = line;
      upper.toUpperCase();
      if (upper == "OK" || upper.startsWith("OK ")) {
        if (jogStatus.pendingMoveAcks > 0) --jogStatus.pendingMoveAcks;
      } else if (upper.startsWith("ERROR:") || upper.startsWith("ALARM:") || upper == "!!") {
        addMarlinLog("rx", true, line, "error");
        setJogError("Marlin rejected jog movement: " + line);
        sendJogCommand("G90");
        jogStatus.commandedPositionCaptured = false;
        jogStatus.pendingMoveAcks = 0;
        return;
      }
    } else if (c != '\r' && jogStatus.responseLine.length() < 256) {
      jogStatus.responseLine += c;
    }
  }
}

void processJogRunner() {
  if (jogStatus.state != JogState::Jogging && jogStatus.state != JogState::Stopping) {
    return;
  }

  const uint32_t now = millis();
  processJogResponses();
  updateJogMotionHorizon(now);
  if (jogStatus.state == JogState::Stopping) {
    if (jogStatus.pendingMoveAcks > 0 && now - jogStatus.lastMoveSentAtMs > 1000) {
      sendJogCommand("M410");
      sendJogCommand("M5");
      sendJogCommand("G90");
      jogStatus.commandedPositionCaptured = false;
      jogStatus.pendingMoveAcks = 0;
      setJogError("Marlin graceful jog stop acknowledgement timed out");
      return;
    }
    if (jogStatus.pendingMoveAcks == 0 && jogStatus.queuedMotionHorizonMs == 0) {
      finishGracefulJogStop();
    }
    return;
  }
  if (jogStatus.state != JogState::Jogging) return;
  if (jogStatus.pendingMoveAcks > 0 && now - jogStatus.lastMoveSentAtMs > 1000) {
    sendJogCommand("M410");
    sendJogCommand("M5");
    sendJogCommand("G90");
    jogStatus.commandedPositionCaptured = false;
    jogStatus.pendingMoveAcks = 0;
    setJogError("Marlin jog acknowledgement timed out");
    return;
  }
  if (jogStatus.lastUpdateMs == 0 || now - jogStatus.lastUpdateMs > kJogDeadmanMs) {
    jogStatus.lastError = "jog heartbeat timeout; stopped jogging";
    logJobEvent("jog stop: heartbeat timeout");
    stopJogInternal(true);
    return;
  }

  if (now - jogStatus.lastTickMs < kJogTickIntervalMs) {
    return;
  }

  if (jogStatus.pendingMoveAcks >= kJogPlannerLookahead) return;
  if (jogStatus.queuedMotionHorizonMs > kJogHorizonRefillMs) return;

  jogStatus.appliedX = approachJogValue(jogStatus.appliedX, clampFloat(jogStatus.x, -1.0f, 1.0f));
  jogStatus.appliedY = approachJogValue(jogStatus.appliedY, clampFloat(jogStatus.y, -1.0f, 1.0f));
  jogStatus.appliedZ = approachJogValue(jogStatus.appliedZ, clampFloat(jogStatus.z, -1.0f, 1.0f));
  jogStatus.appliedSpeed = approachJogValue(jogStatus.appliedSpeed, clampFloat(jogStatus.speed, 0.0f, 1.0f));
  const float x = jogStatus.appliedX;
  const float y = jogStatus.appliedY;
  const float z = jogStatus.appliedZ;
  const float speed = jogStatus.appliedSpeed;
  // Cover slightly more motion than one send interval so Marlin receives the next
  // adjacent G1 before the current segment should finish.
  const float segmentSeconds = kJogSegmentDurationMs / 1000.0f;
  const float xyMaxStep = min(kJogMaxXyStepMm, (jogStatus.xyFeedMax / 60.0f) * segmentSeconds);
  const float xyScale = xyMaxStep;
  const float zMaxStep = min(kJogMaxZStepMm, (jogStatus.zFeedMax / 60.0f) * segmentSeconds);
  const float zScale = zMaxStep * speed;
  const float dx = x * xyScale;
  const float dy = y * xyScale;
  const float dz = z * zScale;
  const float xyDistance = sqrt(dx * dx + dy * dy);
  const float zDistance = fabs(dz);
  jogStatus.lastTickMs = now;
  if (fabs(dx) < 0.01f && fabs(dy) < 0.01f && fabs(dz) < 0.005f) {
    return;
  }
  if (jogStatus.safeJog && (fabs(dx) >= 0.01f || fabs(dy) >= 0.01f) && !jogStatus.zLiftedForJog) {
    setJogError("safe jog Z lift is required before X/Y jogging");
    return;
  }
  if (!jogStatus.commandedPositionCaptured) {
    setJogError("absolute jog position is unavailable");
    return;
  }

  // G1 keeps adjacent jog vectors in Marlin's coordinated-motion planner instead of
  // treating every small joystick tick as a separate rapid positioning move. Each
  // target is absolute, so dropped UI updates cannot accumulate coordinate drift.
  String cmd = "G1";
  if (fabs(dx) >= 0.01f) {
    jogStatus.commandedWorkX += dx;
    cmd += " X";
    cmd += String(jogStatus.commandedWorkX, 3);
  }
  if (fabs(dy) >= 0.01f) {
    jogStatus.commandedWorkY += dy;
    cmd += " Y";
    cmd += String(jogStatus.commandedWorkY, 3);
  }
  if (fabs(dz) >= 0.005f) {
    jogStatus.commandedWorkZ += dz;
    cmd += " Z";
    cmd += String(jogStatus.commandedWorkZ, 3);
    jogStatus.zChangedDuringJog = true;
    jogStatus.zRestoreAvailable = false;
  }
  const float feed = zDistance >= 0.005f && xyDistance < 0.01f
                         ? clampFloat((zDistance / segmentSeconds) * 60.0f, 1.0f, jogStatus.zFeedMax)
                         : clampFloat((xyDistance / segmentSeconds) * 60.0f, 1.0f, jogStatus.xyFeedMax);
  cmd += " F";
  cmd += String(feed, 0);
  addMarlinLog("tx", true, cmd);
  Serial.print(cmd);
  Serial.print('\n');
  jogStatus.lastCommand = cmd;
  ++jogStatus.pendingMoveAcks;
  jogStatus.lastMoveSentAtMs = now;
  jogStatus.queuedMotionHorizonMs = min(kJogMaxHorizonMs,
                                        jogStatus.queuedMotionHorizonMs + kJogSegmentDurationMs);
  telemetryJogDirty = true;
}

bool restoreJogZNow(String &error) {
  if (jogStatus.state != JogState::Idle || !jogStatus.zRestoreAvailable ||
      !jogStatus.originalZCaptured || jogStatus.zChangedDuringJog) {
    error = "saved jog Z is not available";
    return false;
  }

  const String waitResponse = sendJogCommandForResponse("M400", 120000);
  if (!responseContainsToken(waitResponse, "ok") || responseContainsToken(waitResponse, "Error:")) {
    error = "Marlin did not finish motion before checking restored jog Z";
    jogStatus.lastError = error;
    return false;
  }
  const String response = sendJogCommandForResponse("M114", 300);
  jogStatus.lastM114 = response;
  float currentZ = 0.0f;
  if (!parseAxisFromM114(response, 'Z', currentZ)) {
    error = "could not read current Z before restoring jog Z";
    jogStatus.lastError = error;
    return false;
  }

  if (!jogStatus.safeLiftWorkZCaptured || fabs(currentZ - jogStatus.safeLiftWorkZ) > 0.5f) {
    jogStatus.zRestoreAvailable = false;
    error = "Z changed after jog; saved restore was cancelled";
    jogStatus.lastError = error;
    telemetryJogDirty = true;
    return false;
  }

  jogStatus.zRestoreAvailable = false;
  sendJogCommand("G90");
  sendJogCommand("G0 Z" + String(jogStatus.originalZ, 3) + " F" + String(jogStatus.zFeedMax, 0));
  const String finishResponse = sendJogCommandForResponse("M400", 120000);
  sendJogCommand("G90");
  if (!responseContainsToken(finishResponse, "ok") || responseContainsToken(finishResponse, "Error:")) {
    error = "Marlin did not confirm restored Z movement";
    jogStatus.lastError = error;
    telemetryJogDirty = true;
    return false;
  }
  jogStatus.zLiftedForJog = false;
  jogStatus.commandedWorkZ = jogStatus.originalZ;
  jogStatus.commandedPositionCaptured = true;
  jogStatus.originalZCaptured = false;
  jogStatus.safeLiftWorkZCaptured = false;
  jogStatus.lastError = "";
  telemetryJogDirty = true;
  return true;
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

bool testMotionWordAllowed(const String &word, const String &motionCode) {
  if (word.length() < 2) {
    return false;
  }
  const char letter = word[0];
  if (letter == 'G') {
    return word == motionCode;
  }
  bool digitSeen = false;
  bool decimalSeen = false;
  for (int i = 1; i < word.length(); ++i) {
    const char c = word[i];
    if (c >= '0' && c <= '9') {
      digitSeen = true;
      continue;
    }
    if ((c == '+' || c == '-') && i == 1) {
      continue;
    }
    if (c == '.' && !decimalSeen) {
      decimalSeen = true;
      continue;
    }
    return false;
  }
  if (!digitSeen) {
    return false;
  }
  if (letter == 'X' || letter == 'Y' || letter == 'Z' || letter == 'F') {
    return true;
  }
  return (motionCode == "G2" || motionCode == "G3") &&
         (letter == 'I' || letter == 'J' || letter == 'R');
}

bool extractGcodeWordValue(const String &line, char wanted, float &value) {
  String upper = line;
  upper.toUpperCase();
  for (int i = 0; i < upper.length(); ++i) {
    if (upper[i] != wanted) {
      continue;
    }
    int end = i + 1;
    while (end < upper.length() && upper[end] != ' ') {
      ++end;
    }
    const String number = upper.substring(i + 1, end);
    if (number.length() == 0) {
      return false;
    }
    value = number.toFloat();
    return true;
  }
  return false;
}

bool validateTestMotionCommand(const String &line, const String &mode, float safeZ, String &error) {
  String upper = line;
  upper.toUpperCase();
  upper.trim();
  if (upper == "M5" || upper == "M400" || upper == "G21" || upper == "G90" || upper == "G54") {
    return true;
  }

  const int separator = upper.indexOf(' ');
  const String code = separator >= 0 ? upper.substring(0, separator) : upper;
  if (code != "G0" && code != "G1" && code != "G2" && code != "G3") {
    error = "test motion contains forbidden or unsupported command: " + code;
    return false;
  }

  int start = 0;
  while (start < upper.length()) {
    while (start < upper.length() && upper[start] == ' ') {
      ++start;
    }
    if (start >= upper.length()) {
      break;
    }
    int end = upper.indexOf(' ', start);
    if (end < 0) {
      end = upper.length();
    }
    if (!testMotionWordAllowed(upper.substring(start, end), code)) {
      error = "test motion contains unsupported word";
      return false;
    }
    start = end + 1;
  }

  if (mode == "aircut") {
    float z = 0.0f;
    if (extractGcodeWordValue(upper, 'Z', z) && fabsf(z - safeZ) > 0.01f) {
      error = "aircut Z command differs from configured Safe Z";
      return false;
    }
  }
  return true;
}

bool validateTestMotionFile(const String &path, const String &mode, float safeZ,
                            uint32_t &commandCount, String &error) {
  File file = SD_MMC.open(path, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) file.close();
    error = "could not open test motion file";
    return false;
  }
  if (file.size() == 0 || file.size() > kMaxTestMotionFileSize) {
    file.close();
    error = "test motion file size is invalid";
    return false;
  }

  commandCount = 0;
  String raw;
  String firstCommand;
  String lastCommand;
  bool hasMotion = false;
  while (file.available()) {
    const char c = static_cast<char>(file.read());
    if (c != '\n') {
      raw += c;
      if (raw.length() > kMaxGcodeLineLength) {
        file.close();
        error = "test motion line is too long";
        return false;
      }
      continue;
    }

    const String line = cleanGcodeLine(raw);
    raw = "";
    if (line.length() == 0) continue;
    if (!validateTestMotionCommand(line, mode, safeZ, error)) {
      file.close();
      return false;
    }
    if (firstCommand.length() == 0) firstCommand = line;
    lastCommand = line;
    hasMotion = hasMotion || line.startsWith("G0 ") || line.startsWith("G1 ") ||
                line.startsWith("G2 ") || line.startsWith("G3 ");
    commandCount += 1;
    if (commandCount > kMaxTestMotionCommands) {
      file.close();
      error = "test motion command limit exceeded";
      return false;
    }
  }
  if (raw.length() > 0) {
    const String line = cleanGcodeLine(raw);
    if (line.length() > 0) {
      if (!validateTestMotionCommand(line, mode, safeZ, error)) {
        file.close();
        return false;
      }
      if (firstCommand.length() == 0) firstCommand = line;
      lastCommand = line;
      hasMotion = hasMotion || line.startsWith("G0 ") || line.startsWith("G1 ") ||
                  line.startsWith("G2 ") || line.startsWith("G3 ");
      commandCount += 1;
    }
  }
  file.close();

  if (commandCount == 0 || commandCount > kMaxTestMotionCommands || firstCommand != "M5" ||
      lastCommand != "M400" || !hasMotion) {
    error = "test motion file must start with M5, contain motion, and end with M400";
    return false;
  }
  return true;
}

bool validateProductionResumeCommand(const String &line, String &error) {
  if (!validateTestMotionCommand(line, "production-resume", 0.0f, error)) {
    error.replace("test motion", "Production Resume");
    return false;
  }

  float value = 0.0f;
  if (extractGcodeWordValue(line, 'X', value) && (value < machineXMin() || value > machineXMax())) {
    error = "Production Resume X is outside configured limits";
    return false;
  }
  if (extractGcodeWordValue(line, 'Y', value) && (value < machineYMin() || value > machineYMax())) {
    error = "Production Resume Y is outside configured limits";
    return false;
  }
  if (extractGcodeWordValue(line, 'Z', value) && (value < machineZMin() || value > machineZMax())) {
    error = "Production Resume Z is outside configured limits";
    return false;
  }
  return true;
}

bool validateProductionResumeFile(const String &path, uint32_t &commandCount, String &error) {
  File file = SD_MMC.open(path, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) file.close();
    error = "could not open Production Resume file";
    return false;
  }
  if (file.size() == 0 || file.size() > kMaxTestMotionFileSize) {
    file.close();
    error = "Production Resume file size is invalid";
    return false;
  }

  commandCount = 0;
  String raw;
  String first[3];
  String lastCommand;
  bool hasCuttingMove = false;
  auto validateLine = [&](const String &line) {
    if (line.length() == 0) return true;
    if (!validateProductionResumeCommand(line, error)) return false;
    if (commandCount < 3) first[commandCount] = line;
    lastCommand = line;
    hasCuttingMove = hasCuttingMove || line.startsWith("G1 ") || line.startsWith("G2 ") || line.startsWith("G3 ");
    commandCount += 1;
    if (commandCount > kMaxTestMotionCommands) {
      error = "Production Resume command limit exceeded";
      return false;
    }
    return true;
  };

  while (file.available()) {
    const char c = static_cast<char>(file.read());
    if (c != '\n') {
      raw += c;
      if (raw.length() > kMaxGcodeLineLength) {
        file.close();
        error = "Production Resume line is too long";
        return false;
      }
      continue;
    }
    const String line = cleanGcodeLine(raw);
    raw = "";
    if (!validateLine(line)) {
      file.close();
      return false;
    }
  }
  if (!validateLine(cleanGcodeLine(raw))) {
    file.close();
    return false;
  }
  file.close();

  if (commandCount < 5 || first[0] != "G21" || first[1] != "G90" || first[2] != "G54" ||
      lastCommand != "M400" || !hasCuttingMove) {
    error = "Production Resume must start G21/G90/G54, contain cutting motion, and end M400";
    return false;
  }
  return true;
}

void setJobError(const String &message) {
  if (jobFile) {
    jobFile.close();
  }
  resetFeedOverrideAfterJobIfNeeded();
  clearPriorityCommands();
  jobWaitingForOk = false;
  jobCommandStartedAtMs = 0;
  jobCommandLivenessAtMs = 0;
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
  jobCommandStartedAtMs = 0;
  jobCommandLivenessAtMs = 0;
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

  String receivedChunk;
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    jobResponseBuffer += c;
    receivedChunk += c;
    if (c == '\n') {
      updatePositionFromMarlinResponse(marlinAsyncLine);
      marlinAsyncLine = "";
    } else if (c != '\r' && marlinAsyncLine.length() < 256) {
      marlinAsyncLine += c;
    }
  }
  if (responseContainsToken(receivedChunk, "busy:")) {
    jobCommandLivenessAtMs = millis();
  }

  if (jobWaitingForOk) {
    if (responseContainsToken(jobResponseBuffer, "Error:")) {
      jobStatus.lastResponse = jobResponseBuffer;
      addMarlinLog("rx", false, jobResponseBuffer);
      setJobError("Marlin reported Error");
      return;
    }
    if (responseContainsToken(jobResponseBuffer, "Resend:")) {
      jobStatus.lastResponse = jobResponseBuffer;
      addMarlinLog("rx", false, jobResponseBuffer);
      setJobError("Marlin requested Resend; TODO: add line-numbered resend support");
      return;
    }
    if (!responseContainsToken(jobResponseBuffer, "ok")) {
      if (millis() - jobCommandLivenessAtMs > kMarlinCommandAckTimeoutMs) {
        jobStatus.lastResponse = jobResponseBuffer;
        addMarlinLog("rx", false, jobResponseBuffer.length() > 0 ? jobResponseBuffer : "timeout", "error");
        setJobError("Marlin acknowledgement timed out; command was not resent: " + jobStatus.lastCommand);
      }
      return;
    }

    jobStatus.acknowledgedLineCount += 1;
    jobStatus.lastResponse = jobResponseBuffer;
    addMarlinLog("rx", false, jobResponseBuffer);
    updatePositionFromMarlinResponse(jobResponseBuffer);
    jobResponseBuffer = "";
    jobWaitingForOk = false;
    jobCommandStartedAtMs = 0;
    jobCommandLivenessAtMs = 0;
    touchJobProgress();
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
  if (jobStatus.streamMode != "job") {
    String validationError;
    const bool valid = jobStatus.streamMode == "production-resume"
                           ? validateProductionResumeCommand(line, validationError)
                           : validateTestMotionCommand(line, jobStatus.streamMode, jobStatus.safeStartZ, validationError);
    if (!valid) {
      setJobError(validationError);
      return;
    }
  }

  jobStatus.lastCommand = line;
  jobResponseBuffer = "";
  addMarlinLog("tx", false, line);
  Serial.print(line);
  Serial.print('\n');
  jobStatus.sentLineCount += 1;
  jobStatus.currentLineNumber += 1;
  queueMotionTelemetry(line, jobStatus.currentLineNumber);
  jobWaitingForOk = true;
  jobCommandStartedAtMs = millis();
  jobCommandLivenessAtMs = jobCommandStartedAtMs;
  touchJobProgress();
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

bool wifiStaConnected() {
  return (activeWifiMode == "sta" || activeWifiMode == "ap+sta") && WiFi.status() == WL_CONNECTED;
}

String currentIpAddress() {
  if (wifiStaConnected()) {
    return WiFi.localIP().toString();
  }

  return WiFi.softAPIP().toString();
}

String setupApIpAddress() {
  return WiFi.softAPIP().toString();
}

String selectedBluetoothName() {
  if (activeWifiMode == "ap") {
    const String apName = "CNC " + currentIpAddress();
    if (apName.length() <= kMaxBleAdvertisementNameBytes) return apName;
  }

  const String localName = "CNC " + deviceIdentity.hostname + ".local";
  if (localName.length() <= kMaxBleAdvertisementNameBytes) return localName;

  const String shortHostname = "CNC " + deviceIdentity.hostname;
  if (shortHostname.length() <= kMaxBleAdvertisementNameBytes) return shortHostname;

  return "CNC-" + deviceIdentity.deviceId;
}

String pendingBluetoothName(const String &hostname) {
  const String localName = "CNC " + hostname + ".local";
  if (localName.length() <= kMaxBleAdvertisementNameBytes) return localName;
  const String shortHostname = "CNC " + hostname;
  return shortHostname.length() <= kMaxBleAdvertisementNameBytes
             ? shortHostname
             : "CNC-" + deviceIdentity.deviceId;
}

void startBluetoothAdvertisement() {
  deviceIdentity.bluetoothName = selectedBluetoothName();
#if ESP32CNC_ENABLE_BLE
  if (!deviceIdentity.bluetoothEnabled || !deviceIdentity.bluetoothAdvertiseName) return;

  // WiFi and the CNC control path take priority over this optional discovery label.
  if (ESP.getFreeHeap() < 70000) return;

  if (!NimBLEDevice::init(std::string(deviceIdentity.bluetoothName.c_str()))) return;
  NimBLEAdvertising *advertising = NimBLEDevice::getAdvertising();
  if (advertising == nullptr ||
      !advertising->setName(std::string(deviceIdentity.bluetoothName.c_str())) ||
      !advertising->setConnectableMode(BLE_GAP_CONN_MODE_NON) ||
      !advertising->setDiscoverableMode(BLE_GAP_DISC_MODE_GEN)) {
    NimBLEDevice::deinit(true);
    return;
  }

  advertising->enableScanResponse(false);
  advertising->setMinInterval(0x640);
  advertising->setMaxInterval(0x800);
  deviceIdentity.bluetoothStarted = advertising->start();
  if (!deviceIdentity.bluetoothStarted) NimBLEDevice::deinit(true);
#else
  deviceIdentity.bluetoothEnabled = false;
  deviceIdentity.bluetoothAdvertiseName = false;
#endif
}

String deviceInfoJson() {
  String json = "{\"deviceId\":\"" + jsonEscape(deviceIdentity.deviceId);
  json += "\",\"hostname\":\"" + jsonEscape(deviceIdentity.hostname);
  json += "\",\"friendlyName\":\"" + jsonEscape(deviceIdentity.friendlyName);
  json += "\",\"localUrl\":\"http://" + jsonEscape(deviceIdentity.hostname) + ".local";
  json += "\",\"ip\":\"" + jsonEscape(currentIpAddress());
  json += "\",\"mode\":\"" + jsonEscape(activeWifiMode);
  json += "\",\"mdnsEnabled\":";
  json += deviceIdentity.mdnsEnabled ? "true" : "false";
  json += ",\"bluetooth\":{\"enabled\":";
  json += deviceIdentity.bluetoothEnabled ? "true" : "false";
  json += ",\"advertiseName\":";
  json += deviceIdentity.bluetoothAdvertiseName ? "true" : "false";
  json += ",\"started\":";
  json += deviceIdentity.bluetoothStarted ? "true" : "false";
  json += ",\"name\":\"" + jsonEscape(deviceIdentity.bluetoothName) + "\"}";
  json += ",\"configSource\":\"" + jsonEscape(deviceIdentity.source) + "\"}";
  return json;
}

void handleDeviceInfo() {
  server.send(200, "application/json", deviceInfoJson());
}

void handleDeviceUpdate() {
  if (jobIsActive()) {
    sendJsonError(409, "Device address can be changed only when the machine is idle.");
    return;
  }

  const String body = server.arg("plain");
  String hostname = extractJsonString(body, "hostname");
  String friendlyName = extractJsonString(body, "friendlyName");
  hostname.trim();
  friendlyName.trim();
  if (hostname.length() == 0 || friendlyName.length() == 0 || friendlyName.length() > 64) {
    sendJsonError(400, "hostname and friendlyName are required; friendlyName is limited to 64 characters");
    return;
  }

  hostname = sanitizeDeviceHostname(hostname, deviceIdentity.deviceId);
  const bool requiresRestart = hostname != deviceIdentity.hostname ||
                               friendlyName != deviceIdentity.friendlyName;
  saveDeviceIdentityToNvs(hostname, friendlyName);

  String sdWarning;
  const bool sdConfigWritten = writeDeviceConfigToSd(hostname, friendlyName, sdWarning);
  String json = "{\"ok\":true,\"requiresRestart\":";
  json += requiresRestart ? "true" : "false";
  json += ",\"sdConfigWritten\":";
  json += sdConfigWritten ? "true" : "false";
  if (sdWarning.length() > 0) json += ",\"warning\":\"" + jsonEscape(sdWarning) + "\"";
  json += ",\"device\":{\"hostname\":\"" + jsonEscape(hostname);
  json += "\",\"friendlyName\":\"" + jsonEscape(friendlyName);
  json += "\",\"localUrl\":\"http://" + jsonEscape(hostname) + ".local";
  json += "\",\"bleName\":\"" + jsonEscape(pendingBluetoothName(hostname)) + "\"}}";
  server.send(200, "application/json", json);
}

void handleSystemRestart() {
  if (jobIsActive() || jobWaitingForOk || jogIsActive() || otaActive || priorityCommandCount > 0) {
    sendJsonError(409, "Restart is allowed only when the machine is idle.");
    return;
  }
  rebootAtMs = millis() + 1000;
  server.send(202, "application/json", "{\"ok\":true,\"restarting\":true}");
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
  if (wifiStaConnected()) {
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

void handleMachineInfo() {
  server.send(200, "application/json", machineProfileJson());
}

void handleMachineRefresh() {
  if (machineDiscoveryState != MachineDiscoveryState::Idle) {
    server.send(202, "application/json", machineProfileJson());
    return;
  }
  if (machineDiscoveryTransportBusy()) {
    sendJsonError(409, "machine discovery requires idle Marlin transport");
    return;
  }
  machineDiscoveryPending = true;
  machineProfile.refreshing = true;
  server.send(202, "application/json", "{\"ok\":true,\"message\":\"M115 discovery queued\"}");
}

bool machineConfigurationBusy() {
  return machineDiscoveryState != MachineDiscoveryState::Idle || machineDiscoveryTransportBusy();
}

bool validatedMachineValue(float value, float minimum, float maximum) {
  return isfinite(value) && value >= minimum && value <= maximum;
}

void handleMachineApply() {
  if (machineConfigurationBusy()) {
    sendJsonError(409, "machine configuration requires idle Marlin transport");
    return;
  }
  if (!server.hasArg("plain")) {
    sendJsonError(400, "missing JSON body");
    return;
  }
  const String body = server.arg("plain");
  String group = extractJsonString(body, "group");
  group.toUpperCase();
  String command;
  if (group == "M92" || group == "M203" || group == "M201") {
    const float x = extractJsonFloat(body, "x", NAN);
    const float y = extractJsonFloat(body, "y", NAN);
    const float z = extractJsonFloat(body, "z", NAN);
    const float minimum = group == "M201" ? 1.0f : 0.01f;
    const float maximum = group == "M92" ? 100000.0f : (group == "M203" ? 2000.0f : 100000.0f);
    if (!validatedMachineValue(x, minimum, maximum) || !validatedMachineValue(y, minimum, maximum) ||
        !validatedMachineValue(z, minimum, maximum)) {
      sendJsonError(400, group + " X/Y/Z values are missing or outside allowed range");
      return;
    }
    command = group + " X" + String(x, 4) + " Y" + String(y, 4) + " Z" + String(z, 4);
  } else if (group == "M204") {
    const float p = extractJsonFloat(body, "p", NAN);
    const float r = extractJsonFloat(body, "r", NAN);
    const float t = extractJsonFloat(body, "t", NAN);
    if (!validatedMachineValue(p, 1.0f, 100000.0f) || !validatedMachineValue(r, 1.0f, 100000.0f) ||
        !validatedMachineValue(t, 1.0f, 100000.0f)) {
      sendJsonError(400, "M204 P/R/T values are missing or outside allowed range");
      return;
    }
    command = "M204 P" + String(p, 2) + " R" + String(r, 2) + " T" + String(t, 2);
  } else {
    sendJsonError(400, "editable group must be M92, M203, M201, or M204");
    return;
  }

  drainMarlinInput();
  addMarlinLog("tx", false, command);
  Serial.print(command);
  Serial.print('\n');
  const String response = readMarlinResponseFor(3000);
  String upper = response;
  upper.toUpperCase();
  if (upper.indexOf("OK") < 0 || upper.indexOf("ERROR") >= 0 || upper.indexOf("ALARM") >= 0) {
    sendJsonError(502, "Marlin rejected " + command + ": " + response);
    return;
  }
  String json = "{\"ok\":true,\"command\":\"" + jsonEscape(command) + "\",\"response\":\"" + jsonEscape(response) + "\"}";
  server.send(200, "application/json", json);
}

void handleMachineSave() {
  if (machineConfigurationBusy()) {
    sendJsonError(409, "M500 requires idle Marlin transport");
    return;
  }
  drainMarlinInput();
  addMarlinLog("tx", false, "M500");
  Serial.print("M500\n");
  const String response = readMarlinResponseFor(5000);
  String upper = response;
  upper.toUpperCase();
  if (upper.indexOf("OK") < 0 || upper.indexOf("ERROR") >= 0 || upper.indexOf("ALARM") >= 0) {
    sendJsonError(502, "M500 failed: " + response);
    return;
  }
  server.send(200, "application/json", "{\"ok\":true,\"command\":\"M500\",\"message\":\"Changes saved to Marlin EEPROM\"}");
}

void handleMarlinLog() {
  const uint32_t afterId = server.hasArg("after") ? static_cast<uint32_t>(server.arg("after").toInt()) : 0;
  String json = "{\"ok\":true,\"entries\":[";
  bool first = true;
  for (size_t i = 0; i < marlinLogCount; ++i) {
    const size_t index = (marlinLogNext + kMarlinLogSize - marlinLogCount + i) % kMarlinLogSize;
    const MarlinLogEntry &entry = marlinLog[index];
    if (entry.id <= afterId) continue;
    if (!first) json += ",";
    json += marlinLogEntryJson(entry);
    first = false;
  }
  json += "],\"nextId\":";
  json += String(nextMarlinLogId > 0 ? nextMarlinLogId - 1 : 0);
  json += ",\"lastCritical\":";
  if (lastCriticalMarlinMessage.length() > 0) {
    json += "\"";
    json += jsonEscape(lastCriticalMarlinMessage);
    json += "\"";
  } else {
    json += "null";
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
  String fileName = path.substring(path.lastIndexOf('/') + 1);
  fileName.replace("\"", "_");
  fileName.replace("\r", "_");
  fileName.replace("\n", "_");
  server.sendHeader("Content-Disposition", "attachment; filename=\"" + fileName + "\"");
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

  String upper = cmd;
  upper.toUpperCase();
  upper.trim();
  if (machineDiscoveryState != MachineDiscoveryState::Idle && upper == "M5") {
    addMarlinLog("tx", true, "M5");
    Serial.print("M5\n");
    server.send(200, "application/json", "{\"ok\":true,\"response\":\"M5 sent during machine discovery.\"}");
    return;
  }
  if ((jobStatus.state == JobRunnerState::Running || jobStatus.state == JobRunnerState::Pausing ||
       jobStatus.state == JobRunnerState::Paused || jobStatus.state == JobRunnerState::Resuming ||
       jobStatus.state == JobRunnerState::Stopping || jobStatus.state == JobRunnerState::Error) &&
      upper == "M5") {
    queueManualM5Priority();
    logJobEvent("priority manual: M5");
    server.send(200, "application/json",
                "{\"ok\":true,\"response\":\"M5 priority requested. This is not a physical emergency stop.\"}");
    return;
  }

  if (jobIsActive() || jobWaitingForOk || priorityCommandCount > 0) {
    sendJsonError(409, "Marlin transport is busy with the active job; retry diagnostics when idle");
    return;
  }

  if (jogIsActive()) {
    sendJsonError(409, "Marlin transport is busy with safe jog; retry diagnostics after releasing jog");
    return;
  }

  if (machineDiscoveryState != MachineDiscoveryState::Idle) {
    sendJsonError(409, "Marlin transport is busy discovering machine information");
    return;
  }

  drainMarlinInput();

  addMarlinLog("tx", false, cmd);
  Serial.print(cmd);
  Serial.print('\n');

  const String response = readMarlinResponseFor(upper == "M115" ? 12000 : (upper == "M503" ? 5000 : kMarlinTimeoutMs));
  if (upper == "M115") parseMachineProfile(response);
  String json = "{\"ok\":true,\"response\":\"";
  json += jsonEscape(response);
  json += "\"}";
  server.send(200, "application/json", json);
}

bool jobJsonIsArmed(const String &jobPath) {
  return jobFileContainsText(jobPath, "\"startAuthorizationToken\":\"AUTHORIZED\"");
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

bool jobFileContainsText(const String &jobPath, const String &needle) {
  if (needle.length() == 0) return false;
  File file = SD_MMC.open(jobPath, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) file.close();
    return false;
  }
  String window;
  window.reserve(needle.length() + 256);
  while (file.available()) {
    for (int i = 0; i < 256 && file.available(); ++i) {
      const char c = static_cast<char>(file.read());
      if (c != ' ' && c != '\n' && c != '\r' && c != '\t') window += c;
    }
    if (window.indexOf(needle) >= 0) {
      file.close();
      return true;
    }
    const size_t keep = min(static_cast<size_t>(window.length()), static_cast<size_t>(needle.length()));
    window = window.substring(window.length() - keep);
  }
  file.close();
  return window.indexOf(needle) >= 0;
}

bool jobJsonAllowsWorkspaceCommands(const String &jobPath) {
  return jobFileContainsText(jobPath, "\"allowedWorkspaceCommands\":true");
}

String compactJsonForStringChecks(String body) {
  body.replace(" ", "");
  body.replace("\n", "");
  body.replace("\r", "");
  body.replace("\t", "");
  return body;
}

bool jobJsonAllowsActiveGeneratedRun(const String &jobPath, const String &gcodePath) {
  const String activeRunNeedle = String("\"activeRun\":{\"mode\":\"generated\",\"path\":\"") +
                                 gcodePath + "\"";

  // TODO: Replace this minimal provenance check with robust JSON parsing.
  return jobFileContainsText(jobPath, activeRunNeedle) &&
         jobFileContainsText(jobPath, "\"generatedValidation\":{\"status\":\"valid\"");
}

bool jobJsonAllowsProductionResume(const String &jobPath, const String &activeRunPath,
                                   const String &activeRunMode, const String &eventId,
                                   const String &interruptedRunId, const String &activeRunFingerprint) {
  if (eventId.length() == 0 || interruptedRunId.length() == 0 ||
      activeRunPath.length() == 0 || (activeRunMode != "source" && activeRunMode != "generated")) {
    return false;
  }

  // TODO: Replace these whole-file token checks with a streaming JSON parser.
  const String pathNeedle = String("\"activeRunPath\":\"") + activeRunPath + "\"";
  const String modeNeedle = String("\"activeRunMode\":\"") + activeRunMode + "\"";
  const String eventNeedle = String("\"eventId\":\"") + eventId + "\"";
  const String runNeedle = String("\"interruptedRunId\":\"") + interruptedRunId + "\"";
  const String fingerprintNeedle = String("\"activeRunFingerprint\":\"") + activeRunFingerprint + "\"";
  return jobFileContainsText(jobPath, "\"productionResumeAuthorization\":{") &&
         jobFileContainsText(jobPath, "\"authorized\":true") &&
         jobFileContainsText(jobPath, eventNeedle) && jobFileContainsText(jobPath, runNeedle) &&
         jobFileContainsText(jobPath, pathNeedle) && jobFileContainsText(jobPath, modeNeedle) &&
         (activeRunFingerprint.length() == 0 || jobFileContainsText(jobPath, fingerprintNeedle));
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
  clearPriorityCommands();
  const String commands[] = {
      "M5", "G21", "G90", "G54", feedOverrideCommand(jobStatus.feedOverridePercent), "M400", "M114",
      "G0 Z" + String(jobStatus.safeStartZ, 3) + " F" + String(kJobStartZFeed, 0), "M400",
      "G0 F" + String(jobStatus.travelFeedMmMin, 0),
  };
  for (const String &command : commands) {
    if (!appendPriorityCommand(command)) {
      clearPriorityCommands();
      setJobError("Start preamble is too large for priority queue");
      return false;
    }
  }
  if (machineProfile.capAutoreportPos && !appendPriorityCommand("M154 S1")) {
    clearPriorityCommands();
    setJobError("Start preamble is too large for priority queue");
    return false;
  }
  jobStatus.lastPriorityCommand = "";
  jobStatus.lastPriorityResponse = "";
  jobStatus.lastPriorityError = "";
  return true;
}

void handleJobStatus() {
  server.send(200, "application/json", jobStatusJson());
}

void handleTestMotionStart() {
  if (!sdMounted) {
    sendJsonError(503, "SD card is not mounted");
    return;
  }
  if (jobIsActive()) {
    sendJsonError(409, "another job or motion stream is already active");
    return;
  }
  if (!server.hasArg("plain")) {
    sendJsonError(400, "missing JSON body");
    return;
  }

  const String body = server.arg("plain");
  const String path = normalizeSdPath(extractJsonString(body, "path"));
  const String mode = extractJsonString(body, "mode");
  const float safeZ = extractJsonFloat(body, "safeZ", 15.0f);
  if (!isPathUnderRoot(path, "/jobs/generated")) {
    sendJsonError(400, "test motion path must be under /jobs/generated");
    return;
  }
  if (mode != "aircut" && mode != "toolless") {
    sendJsonError(400, "test motion mode must be aircut or toolless");
    return;
  }
  if (!isfinite(safeZ) || safeZ <= 0.0f || safeZ > kMachineZMaxMm) {
    sendJsonError(400, "Safe Z is outside configured machine limits");
    return;
  }

  uint32_t commandCount = 0;
  String validationError;
  if (!validateTestMotionFile(path, mode, safeZ, commandCount, validationError)) {
    sendJsonError(400, validationError);
    return;
  }

  jobStatus = JobRunnerStatus();
  marlinAsyncLine = "";
  streamMotionMode = "G0";
  motionTelemetryCount = 0;
  motionTelemetryDropped = 0;
  clearPriorityCommands();
  jobStatus.state = JobRunnerState::Preparing;
  jobStatus.gcodePath = path;
  jobStatus.startMode = "validated_test_motion";
  jobStatus.streamMode = mode;
  jobStatus.safeStartZ = safeZ;
  jobStatus.resetFeedOverrideAfterJob = false;
  jobStatus.startedAtMs = millis();
  touchJobStatus();

  File sizeFile = SD_MMC.open(path, FILE_READ);
  jobStatus.fileSize = sizeFile ? sizeFile.size() : 0;
  if (sizeFile) sizeFile.close();
  if (!openJobFileAtOffset()) {
    sendJsonError(500, jobStatus.lastError);
    return;
  }

  logJobEvent("test motion start: " + mode + " " + path + " commands=" + String(commandCount));
  jobRunning = true;
  jobStatus.state = JobRunnerState::Running;
  touchJobStatus();
  server.send(200, "application/json", jobStatusJson());
}

void handleProductionResumeStart() {
  if (!sdMounted) {
    sendJsonError(503, "SD card is not mounted");
    return;
  }
  if (jobIsActive()) {
    sendJsonError(409, "another job or motion stream is already active");
    return;
  }
  if (!server.hasArg("plain")) {
    sendJsonError(400, "missing JSON body");
    return;
  }

  const String body = server.arg("plain");
  const String path = normalizeSdPath(extractJsonString(body, "path"));
  const String jobPath = normalizeSdPath(extractJsonString(body, "jobPath"));
  const String activeRunPath = normalizeSdPath(extractJsonString(body, "activeRunPath"));
  const String activeRunMode = extractJsonString(body, "activeRunMode");
  const String activeRunFingerprint = extractJsonString(body, "activeRunFingerprint");
  const String eventId = extractJsonString(body, "eventId");
  const String interruptedRunId = extractJsonString(body, "interruptedRunId");

  if (!isPathUnderRoot(path, "/jobs/generated") || !path.endsWith(".production-resume.gc")) {
    sendJsonError(400, "Production Resume path must be a generated .production-resume.gc file");
    return;
  }
  if (!isPathUnderRoot(jobPath, "/jobs") || !SD_MMC.exists(jobPath)) {
    sendJsonError(404, "job JSON not found");
    return;
  }
  if (!jobJsonAllowsProductionResume(jobPath, activeRunPath, activeRunMode, eventId,
                                     interruptedRunId, activeRunFingerprint)) {
    sendJsonError(409, "Production Resume metadata no longer matches the prepared recovery");
    return;
  }
  if (activeRunMode == "generated" && !jobJsonAllowsActiveGeneratedRun(jobPath, activeRunPath)) {
    sendJsonError(409, "generated active run is no longer valid");
    return;
  }

  uint32_t commandCount = 0;
  String validationError;
  if (!validateProductionResumeFile(path, commandCount, validationError)) {
    sendJsonError(400, validationError);
    return;
  }

  jobStatus = JobRunnerStatus();
  streamMotionMode = "G0";
  motionTelemetryCount = 0;
  motionTelemetryDropped = 0;
  clearPriorityCommands();
  jobStatus.state = JobRunnerState::Preparing;
  jobStatus.gcodePath = path;
  jobStatus.jobPath = jobPath;
  jobStatus.startMode = "prepared_production_resume";
  jobStatus.streamMode = "production-resume";
  jobStatus.allowedWorkspaceCommands = false;
  jobStatus.feedOverridePercent = jobJsonFeedStartPercent(jobPath);
  jobStatus.resetFeedOverrideAfterJob = jobJsonResetFeedAfterJob(jobPath);
  jobStatus.startedAtMs = millis();
  touchJobStatus();

  File sizeFile = SD_MMC.open(path, FILE_READ);
  jobStatus.fileSize = sizeFile ? sizeFile.size() : 0;
  if (sizeFile) sizeFile.close();
  if (!openJobFileAtOffset()) {
    sendJsonError(500, jobStatus.lastError);
    return;
  }

  sendFeedOverrideImmediate(jobStatus.feedOverridePercent);
  logJobEvent("Production Resume stream start: " + path + " commands=" + String(commandCount));
  jobRunning = true;
  jobStatus.state = JobRunnerState::Running;
  touchJobStatus();
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
  const String activeRunMode = extractJsonString(body, "activeRunMode");
  String startMode = extractJsonString(body, "startMode");
  if (startMode.length() == 0) startMode = "use_active_work_zero";
  if (startMode != "use_active_work_zero" && startMode != "use_manual_work_frame") {
    sendJsonError(400, "startMode must use an active homed or manually confirmed work frame");
    return;
  }
  const String requestedBootSessionId = extractJsonString(body, "bootSessionId");
  const int requestedHomingEpoch = extractJsonInt(body, "homingEpoch", -1);
  const String requestedHomingSessionId = extractJsonString(body, "homingSessionId");
  const String requestedWorkZeroId = extractJsonString(body, "workZeroId");
  const float requestedZeroX = extractJsonFloat(body, "workZeroMachineX", NAN);
  const float requestedZeroY = extractJsonFloat(body, "workZeroMachineY", NAN);
  const float requestedZeroZ = extractJsonFloat(body, "workZeroMachineZ", NAN);
  if (startMode == "use_manual_work_frame") {
    if (!machineFrame.manualWorkFrameValid || !machineFrame.workZeroValid ||
        requestedBootSessionId.length() == 0 || requestedBootSessionId != bootSessionId) {
      sendJsonError(409, "manual work frame expired; confirm Continue without homing and work zero again");
      return;
    }
  } else {
    if (!machineFrame.machineValid || !machineFrame.absoluteFromHome || !machineFrame.workZeroValid ||
        requestedWorkZeroId.length() == 0 || requestedHomingEpoch < 0 || requestedHomingSessionId.length() == 0 ||
        static_cast<uint32_t>(requestedHomingEpoch) != machineFrame.homingEpoch ||
        requestedHomingSessionId != machineFrame.homingSessionId ||
        !isfinite(requestedZeroX) || !isfinite(requestedZeroY) || !isfinite(requestedZeroZ) ||
        fabs(requestedZeroX - machineFrame.workZeroMachineX) > 0.05f ||
        fabs(requestedZeroY - machineFrame.workZeroMachineY) > 0.05f ||
        fabs(requestedZeroZ - machineFrame.workZeroMachineZ) > 0.05f) {
      sendJsonError(409, "active work zero does not match this absolute Home All session; restore or set work zero again");
      return;
    }
  }
  const float safeStartZ = clampFloat(extractJsonFloat(body, "safeStartZ", 15.0f), 0.0f, 200.0f);
  const float travelFeedMmMin = clampFloat(
      extractJsonFloat(body, "travelFeedMmMin", kDefaultTravelFeed), 600.0f, 6000.0f);
  const bool sourceRunPath = isPathUnderRoot(gcodePath, "/gcode");
  const bool generatedRunPath = isPathUnderRoot(gcodePath, "/jobs/generated");
  if (!sourceRunPath && !generatedRunPath) {
    sendJsonError(400, "gcodePath must be under /gcode or explicit /jobs/generated");
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
    sendJsonError(409, "job JSON has no valid start authorization");
    return;
  }
  if (generatedRunPath) {
    if (activeRunMode != "generated") {
      sendJsonError(400, "generated run requires activeRunMode generated");
      return;
    }
    if (!jobJsonAllowsActiveGeneratedRun(jobPath, gcodePath)) {
      sendJsonError(409, "generated run is not the validated active run in job JSON");
      return;
    }
  }

  jobStatus = JobRunnerStatus();
  marlinAsyncLine = "";
  streamMotionMode = "G0";
  motionTelemetryCount = 0;
  motionTelemetryDropped = 0;
  clearPriorityCommands();
  jobStatus.state = JobRunnerState::Preparing;
  jobStatus.gcodePath = gcodePath;
  jobStatus.jobPath = jobPath;
  jobStatus.startMode = startMode;
  jobStatus.safeStartZ = safeStartZ;
  jobStatus.travelFeedMmMin = travelFeedMmMin;
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
  if (!runJobStartPreamble()) {
    sendJsonError(500, jobStatus.lastError);
    return;
  }
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
  const bool continuePendingRestore = jogStatus.zRestoreAvailable && jogStatus.originalZCaptured &&
                                      !jogStatus.zChangedDuringJog;
  const float pendingOriginalZ = jogStatus.originalZ;
  jogStatus = JogStatus();
  jogStatus.safeJog = extractJsonBool(body, "safeJog", true);
  jogStatus.safeLiftZ = clampFloat(extractJsonFloat(body, "safeLiftZ", kMachineZMaxMm), 0.0f, kMachineZMaxMm);
  jogStatus.xyFeedMax = clampFloat(extractJsonFloat(body, "xyFeedMax", 3000.0f), 600.0f, 6000.0f);
  jogStatus.zFeedMax = clampFloat(extractJsonFloat(body, "zFeedMax", 400.0f), 20.0f, 800.0f);
  jogStatus.startedAtMs = millis();
  jogStatus.lastUpdateMs = millis();
  jogStatus.lastTickMs = 0;
  if (continuePendingRestore && jogStatus.safeJog) {
    jogStatus.originalZ = pendingOriginalZ;
    jogStatus.originalZCaptured = true;
  }

  // TODO: Add a future physical enable/arm button input before allowing jog movement.
  if (!prepareSafeJogLift()) {
    sendJsonError(400, jogStatus.lastError);
    return;
  }
  if (!jogStatus.commandedPositionCaptured && !captureJogCommandedWorkPosition()) {
    setJogError(jogStatus.lastError);
    sendJsonError(502, jogStatus.lastError);
    return;
  }

  const String absoluteResponse = sendJogCommandForResponse("G90", 300);
  if (!responseContainsToken(absoluteResponse, "ok") || responseContainsToken(absoluteResponse, "Error:") ||
      responseContainsToken(absoluteResponse, "Unknown command")) {
    setJogError("Marlin did not enter absolute mode for jog");
    sendJsonError(502, jogStatus.lastError);
    return;
  }

  jogStatus.state = JogState::Jogging;
  telemetryJogDirty = true;
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
  const bool emergencyStop = !server.hasArg("plain") || extractJsonBool(server.arg("plain"), "emergency", true);
  if (emergencyStop && jogIsActive()) logJobEvent("jog emergency stop requested");
  stopJogInternal(emergencyStop);
  server.send(200, "application/json", jogStatusJson());
}

void handleJogRestoreZ() {
  if (otaActive || jobIsActive() || jogStatus.state != JogState::Idle) {
    sendJsonError(409, "restoring jog Z requires an idle machine");
    return;
  }
  String error;
  if (!restoreJogZNow(error)) {
    sendJsonError(409, error);
    return;
  }
  server.send(200, "application/json", jogStatusJson());
}

bool machineFrameControlBusy() {
  return otaActive || jobIsActive() || jogIsActive() || priorityCommandCount > 0 ||
         machineDiscoveryState != MachineDiscoveryState::Idle;
}

bool runFrameCommand(const String &command, String &response, uint32_t timeoutMs = 3000) {
  drainMarlinInput();
  addMarlinLog("tx", true, command);
  Serial.print(command);
  Serial.print('\n');
  response = readMarlinResponseFor(timeoutMs, true);
  String upper = response;
  upper.toUpperCase();
  return upper.indexOf("OK") >= 0 && upper.indexOf("ERROR") < 0 && upper.indexOf("ALARM") < 0;
}

void handleMachineFrame() {
  server.send(200, "application/json", machineFrameJson());
}

void handleManualMachineFrame() {
  if (machineFrameControlBusy()) {
    sendJsonError(409, "confirming a manual work frame requires idle Marlin transport");
    return;
  }
  if (!server.hasArg("plain")) {
    sendJsonError(400, "missing JSON body");
    return;
  }
  String mode = extractJsonString(server.arg("plain"), "mode");
  mode.toLowerCase();
  if (mode != "confirm" && mode != "preserve" && mode != "set-zero") {
    sendJsonError(400, "mode must be confirm, preserve, or set-zero");
    return;
  }

  String before;
  String after;
  if (!runFrameCommand("M400", before, 120000) || !runFrameCommand("M114", before)) {
    sendJsonError(502, "Marlin did not accept the manual work frame: " + before);
    return;
  }
  if (mode != "confirm" && !runFrameCommand("G54", after)) {
    sendJsonError(502, "Marlin did not select G54: " + after);
    return;
  }
  if (mode == "set-zero" && !runFrameCommand("G92 X0 Y0 Z0", after)) {
    sendJsonError(502, "Marlin did not set the current position as work zero: " + after);
    return;
  }
  if (!runFrameCommand("M114", after)) {
    sendJsonError(502, "Marlin position could not be captured: " + after);
    return;
  }

  machineFrame.machineValid = false;
  machineFrame.absoluteFromHome = false;
  machineFrame.manualWorkFrameValid = true;
  machineFrame.workZeroValid = mode != "confirm";
  machineFrame.homedX = false;
  machineFrame.homedY = false;
  machineFrame.homedZ = false;
  machineFrame.homingSessionId = "";
  machineFrame.updatedAtMs = millis();
  ++machineFrame.revision;
  telemetryPositionDirty = true;
  String json = "{\"ok\":true,\"mode\":\"" + mode + "\",\"before\":\"" +
                jsonEscape(before) + "\",\"after\":\"" + jsonEscape(after) +
                "\",\"frame\":" + machineFrameJson() + "}";
  server.send(200, "application/json", json);
}

void handleMachineHome() {
  if (machineFrameControlBusy()) {
    sendJsonError(409, "homing requires idle Marlin transport");
    return;
  }
  if (!server.hasArg("plain")) {
    sendJsonError(400, "missing JSON body");
    return;
  }
  String axes = extractJsonString(server.arg("plain"), "axes");
  axes.toLowerCase();
  if (axes.length() == 0) axes = "all";
  if (axes != "x" && axes != "y" && axes != "z" && axes != "xy" && axes != "all") {
    sendJsonError(400, "axes must be x, y, z, xy, or all");
    return;
  }

  String command = "G28";
  if (axes == "x") command += " X";
  else if (axes == "y") command += " Y";
  else if (axes == "z") command += " Z";
  else if (axes == "xy") command += " X Y";
  String response;
  if (!runFrameCommand(command, response, 120000) || !runFrameCommand("M400", response, 120000)) {
    sendJsonError(502, "Marlin homing failed: " + response);
    return;
  }

  if (axes == "x" || axes == "xy" || axes == "all") {
    machineFrame.homedX = true;
    machineFrame.machineX = machineProfile.fullXMin;
  }
  if (axes == "y" || axes == "xy" || axes == "all") {
    machineFrame.homedY = true;
    machineFrame.machineY = machineProfile.fullYMin;
  }
  if (axes == "z" || axes == "all") {
    machineFrame.homedZ = true;
    machineFrame.machineZ = machineProfile.fullZMax;
  }
  machineFrame.machineValid = machineFrame.homedX && machineFrame.homedY && machineFrame.homedZ;

  if (axes == "all") {
    // Establish an explicit, deterministic temporary work frame at the physical home position.
    if (!runFrameCommand("G54", response) || !runFrameCommand("G92 X0 Y0 Z0", response) ||
        !runFrameCommand("M114", response)) {
      machineFrame.machineValid = false;
      machineFrame.workZeroValid = false;
      sendJsonError(502, "Homing completed but the baseline work frame failed: " + response);
      return;
    }
    int32_t homeCountX = 0;
    int32_t homeCountY = 0;
    int32_t homeCountZ = 0;
    const bool countsValid = parseM114Counts(response, homeCountX, homeCountY, homeCountZ);
    String configResponse;
    float stepsX = 0;
    float stepsY = 0;
    float stepsZ = 0;
    const bool stepsValid = runFrameCommand("M503", configResponse, 10000) &&
                            parseM92Steps(configResponse, stepsX, stepsY, stepsZ);
    if (!countsValid || !stepsValid) {
      machineFrame.machineValid = false;
      machineFrame.workZeroValid = false;
      machineFrame.absoluteFromHome = false;
      sendJsonError(502, "Homing completed but absolute machine coordinates could not be established from M114 Count and M503 M92");
      return;
    }
    machineFrame.stepsX = stepsX;
    machineFrame.stepsY = stepsY;
    machineFrame.stepsZ = stepsZ;
    machineFrame.homeCountX = homeCountX;
    machineFrame.homeCountY = homeCountY;
    machineFrame.homeCountZ = homeCountZ;
    machineFrame.countX = homeCountX;
    machineFrame.countY = homeCountY;
    machineFrame.countZ = homeCountZ;
    machineFrame.absoluteFromHome = true;
    machineFrame.manualWorkFrameValid = false;
    machineFrame.workZeroValid = true;
    machineFrame.workZeroMachineX = machineFrame.machineX;
    machineFrame.workZeroMachineY = machineFrame.machineY;
    machineFrame.workZeroMachineZ = machineFrame.machineZ;
    ++machineFrame.homingEpoch;
    char session[24];
    snprintf(session, sizeof(session), "%08lX-%lu", static_cast<unsigned long>(esp_random()),
             static_cast<unsigned long>(machineFrame.homingEpoch));
    machineFrame.homingSessionId = session;
  } else {
    machineFrame.workZeroValid = false;
    machineFrame.absoluteFromHome = false;
    machineFrame.manualWorkFrameValid = false;
    machineFrame.homingSessionId = "";
    runFrameCommand("M114", response);
  }
  machineFrame.updatedAtMs = millis();
  ++machineFrame.revision;
  telemetryPositionDirty = true;
  server.send(200, "application/json", machineFrameJson());
}

void handleSetWorkZero() {
  if (machineFrameControlBusy()) {
    sendJsonError(409, "setting work zero requires idle Marlin transport");
    return;
  }
  const bool homedFrame = machineFrame.machineValid && machineFrame.absoluteFromHome &&
      machineFrame.homedX && machineFrame.homedY && machineFrame.homedZ;
  if (!homedFrame && !machineFrame.manualWorkFrameValid) {
    sendJsonError(409, "Home All or a confirmed manual work frame is required before setting work zero");
    return;
  }
  String axes = server.hasArg("plain") ? extractJsonString(server.arg("plain"), "axes") : "";
  axes.toLowerCase();
  if (axes.length() == 0) axes = "xyz";
  if (axes != "x" && axes != "y" && axes != "xyz") {
    sendJsonError(400, "axes must be x, y, or xyz");
    return;
  }
  String before;
  String after;
  if (!runFrameCommand("M400", before, 120000) || !runFrameCommand("M114", before)) {
    sendJsonError(502, "Marlin work-zero capture failed: " + before);
    return;
  }
  const float targetMachineX = machineFrame.machineX;
  const float targetMachineY = machineFrame.machineY;
  const float targetMachineZ = machineFrame.machineZ;
  String zeroCommand = "G92";
  if (axes == "x" || axes == "xyz") zeroCommand += " X0";
  if (axes == "y" || axes == "xyz") zeroCommand += " Y0";
  if (axes == "xyz") zeroCommand += " Z0";
  if (!runFrameCommand(zeroCommand, after) || !runFrameCommand("M114", after)) {
    sendJsonError(502, "Marlin work-zero transaction failed: " + after);
    return;
  }
  if (homedFrame) {
    machineFrame.machineX = targetMachineX;
    machineFrame.machineY = targetMachineY;
    machineFrame.machineZ = targetMachineZ;
    if (axes == "x" || axes == "xyz") machineFrame.workZeroMachineX = targetMachineX;
    if (axes == "y" || axes == "xyz") machineFrame.workZeroMachineY = targetMachineY;
    if (axes == "xyz") machineFrame.workZeroMachineZ = targetMachineZ;
  }
  machineFrame.workZeroValid = true;
  marlinPosition.valid = true;
  if (axes == "x" || axes == "xyz") marlinPosition.x = 0;
  if (axes == "y" || axes == "xyz") marlinPosition.y = 0;
  if (axes == "xyz") marlinPosition.z = 0;
  machineFrame.updatedAtMs = millis();
  ++machineFrame.revision;
  telemetryPositionDirty = true;
  String json = "{\"ok\":true,\"axes\":\"" + axes + "\",\"before\":\"" +
                jsonEscape(before) + "\",\"after\":\"" + jsonEscape(after) +
                "\",\"frame\":" + machineFrameJson() + "}";
  server.send(200, "application/json", json);
}

void handleSetZZero() {
  if (machineFrameControlBusy()) {
    sendJsonError(409, "setting Z zero requires idle Marlin transport");
    return;
  }
  if ((!machineFrame.machineValid && !machineFrame.manualWorkFrameValid) || !machineFrame.workZeroValid) {
    sendJsonError(409, "an active homed or manually confirmed work frame is required before setting Z zero");
    return;
  }
  String before;
  String after;
  if (!runFrameCommand("M400", before, 120000) || !runFrameCommand("M114", before)) {
    sendJsonError(502, "Marlin Z-zero capture failed: " + before);
    return;
  }
  const float targetMachineZ = machineFrame.machineZ;
  if (!runFrameCommand("G92 Z0", after) || !runFrameCommand("M114", after)) {
    sendJsonError(502, "Marlin Z-zero transaction failed: " + after);
    return;
  }
  if (machineFrame.absoluteFromHome) {
    machineFrame.machineZ = targetMachineZ;
    machineFrame.workZeroMachineZ = targetMachineZ;
  }
  marlinPosition.z = 0;
  machineFrame.updatedAtMs = millis();
  ++machineFrame.revision;
  telemetryPositionDirty = true;
  String json = "{\"ok\":true,\"before\":\"" + jsonEscape(before) + "\",\"after\":\"" +
                jsonEscape(after) + "\",\"frame\":" + machineFrameJson() + "}";
  server.send(200, "application/json", json);
}

void handleGoToWorkZero() {
  if (otaActive) {
    sendJsonError(409, "OTA update in progress");
    return;
  }
  if (jobIsActive()) {
    sendJsonError(409, "go to work zero rejected while job is active");
    return;
  }
  if (jogIsActive()) {
    sendJsonError(409, "go to work zero rejected while jog is active");
    return;
  }
  if (!machineFrame.workZeroValid) {
    sendJsonError(409, "go to work zero requires an active work zero; set it or restore one from history first");
    return;
  }
  if (!server.hasArg("plain")) {
    sendJsonError(400, "missing JSON body");
    return;
  }

  const String body = server.arg("plain");
  String axes = extractJsonString(body, "axes");
  axes.toLowerCase();
  if (axes != "x" && axes != "y" && axes != "xy") {
    sendJsonError(400, "axes must be x, y, or xy");
    return;
  }
  const bool safeMove = extractJsonBool(body, "safeMove", true);
  const float safeZ = extractJsonFloat(body, "safeZ", 70.0f);
  const float travelFeedMmMin = clampFloat(
      extractJsonFloat(body, "travelFeedMmMin", kDefaultTravelFeed), 600.0f, 6000.0f);
  if (safeMove && (safeZ <= 0.0f || safeZ > 200.0f)) {
    sendJsonError(400, "safeZ must be greater than 0 and no more than 200 mm");
    return;
  }

  String response;
  auto sendChecked = [&](const String &cmd) {
    if (sendMarlinControlCommand(cmd, response)) {
      return true;
    }
    sendJsonError(502, "Marlin rejected or did not acknowledge: " + cmd);
    return false;
  };

  if (!sendChecked("M5") || !sendChecked("G21") || !sendChecked("G90") || !sendChecked("G54")) {
    return;
  }
  if (safeMove) {
    if (!sendChecked("G0 Z" + String(safeZ, 3) + " F" + String(kGotoWorkZeroZFeed, 0))) {
      return;
    }
  }

  String move = "G0";
  if (axes == "x" || axes == "xy") move += " X0";
  if (axes == "y" || axes == "xy") move += " Y0";
  move += " F";
  move += String(travelFeedMmMin, 0);
  if (!sendChecked(move) || !sendChecked("G90")) {
    return;
  }

  logJobEvent("go to work zero: " + axes + (safeMove ? " safe" : " direct"));
  String json = "{\"ok\":true,\"axes\":\"";
  json += axes;
  json += "\",\"safeMove\":";
  json += safeMove ? "true" : "false";
  json += ",\"safeZ\":";
  json += String(safeZ, 3);
  json += ",\"message\":\"Work-zero move accepted. Z will remain at safe height after XY movement.\"}";
  server.send(200, "application/json", json);
}

void handleRestoreWorkZero() {
  if (otaActive) {
    sendJsonError(409, "OTA update in progress");
    return;
  }
  if (jobIsActive() || jogIsActive()) {
    sendJsonError(409, "work-zero restore rejected while motion is active");
    return;
  }
  if (!machineFrame.machineValid || !machineFrame.absoluteFromHome || !machineFrame.homedX ||
      !machineFrame.homedY || !machineFrame.homedZ) {
    sendJsonError(409, "Home All is required before restoring a saved zero");
    return;
  }
  if (!server.hasArg("plain")) {
    sendJsonError(400, "missing JSON body");
    return;
  }

  const String body = server.arg("plain");
  const float machineX = extractJsonFloat(body, "machineX", NAN);
  const float machineY = extractJsonFloat(body, "machineY", NAN);
  const float machineZ = extractJsonFloat(body, "machineZ", NAN);
  const float safeMachineZ = extractJsonFloat(body, "safeMachineZ", kMachineZMaxMm);
  const bool moveToZ = extractJsonBool(body, "moveToZ", false);
  String axes = extractJsonString(body, "axes");
  axes.toLowerCase();
  if (axes.length() == 0) axes = "xy";
  if (axes != "x" && axes != "y" && axes != "z" && axes != "xy" && axes != "xyz") {
    sendJsonError(400, "axes must be x, y, z, xy, or xyz");
    return;
  }
  const float travelFeedMmMin = clampFloat(
      extractJsonFloat(body, "travelFeedMmMin", kDefaultTravelFeed), 600.0f, 6000.0f);
  if (!isfinite(machineX) || !isfinite(machineY) || machineX < machineXMin() || machineX > machineXMax() ||
      machineY < machineYMin() || machineY > machineYMax()) {
    sendJsonError(400, "saved work-zero XY is outside configured machine limits");
    return;
  }
  if (!isfinite(safeMachineZ) || safeMachineZ <= machineZMin() || safeMachineZ > machineZMax()) {
    sendJsonError(400, "Safe machine Z is outside configured limits");
    return;
  }
  if (moveToZ && (!isfinite(machineZ) || machineZ < machineZMin() || machineZ > machineZMax())) {
    sendJsonError(400, "saved zero Z is outside configured machine limits");
    return;
  }
  if (moveToZ && machineZ > safeMachineZ) {
    sendJsonError(400, "saved zero Z cannot be above Safe machine Z");
    return;
  }

  String response;
  auto sendChecked = [&](const String &cmd) {
    if (sendMarlinControlCommand(cmd, response)) return true;
    sendJsonError(502, "Marlin rejected or did not acknowledge: " + cmd);
    return false;
  };

  if (!sendChecked("M5") || !sendChecked("G21") || !sendChecked("G90") ||
      !sendChecked("M400") ||
      !sendChecked("G53 G0 Z" + String(safeMachineZ, 3) + " F" + String(kGotoWorkZeroZFeed, 0)) ||
      !sendChecked("M400") ||
      !sendChecked("G53 G0 X" + String(machineX, 3) + " Y" + String(machineY, 3) +
                   " F" + String(travelFeedMmMin, 0)) ||
      !sendChecked("M400")) {
    return;
  }

  if (moveToZ && (!sendChecked("G53 G0 Z" + String(machineZ, 3) + " F" +
                               String(kGotoWorkZeroZFeed, 0)) || !sendChecked("M400"))) return;

  String zeroCommand = "G92";
  if (axes == "x" || axes == "xy" || axes == "xyz") zeroCommand += " X0";
  if (axes == "y" || axes == "xy" || axes == "xyz") zeroCommand += " Y0";
  if (axes == "z" || axes == "xyz") zeroCommand += " Z0";
  if (!sendChecked("G54") || !sendChecked(zeroCommand) || !sendChecked("M114")) return;

  if (axes == "x" || axes == "xy" || axes == "xyz") machineFrame.workZeroMachineX = machineX;
  if (axes == "y" || axes == "xy" || axes == "xyz") machineFrame.workZeroMachineY = machineY;
  if (axes == "z" || axes == "xyz") machineFrame.workZeroMachineZ = machineZ;
  machineFrame.workZeroValid = true;
  machineFrame.updatedAtMs = millis();
  ++machineFrame.revision;
  telemetryPositionDirty = true;

  logJobEvent("restored saved " + axes + " zero at machine X" + String(machineX, 3) +
              " Y" + String(machineY, 3) + (moveToZ ? " Z" + String(machineZ, 3) : ""));
  String json = "{\"ok\":true,\"machineX\":";
  json += String(machineX, 3);
  json += ",\"machineY\":";
  json += String(machineY, 3);
  json += ",\"machineZ\":";
  json += isfinite(machineZ) ? String(machineZ, 3) : "null";
  json += ",\"axes\":\"" + axes + "\"";
  json += ",\"moveToZ\":";
  json += moveToZ ? "true" : "false";
  json += ",\"safeMachineZ\":";
  json += String(safeMachineZ, 3);
  json += ",\"response\":\"";
  json += jsonEscape(response);
  json += "\",\"frame\":" + machineFrameJson();
  json += ",\"message\":\"Saved zero restored and activated.\"}";
  server.send(200, "application/json", json);
}

void handleUpdatePage() {
  String body;
  body += "<header class=\"panel maintenance-header\"><h1>Firmware Update</h1>";
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
  body += "<header class=\"panel maintenance-header\"><h1>WiFi Settings</h1>";
  body += "<p>Mode: ";
  body += activeWifiMode;
  body += " | IP: ";
  body += currentIpAddress();
  body += " | SSID: ";
  body += htmlEscape(activeWifiSsid);
  if (activeWifiMode == "ap+sta") {
    body += " | Setup AP: ";
    body += htmlEscape(kSetupApSsid);
    body += " @ ";
    body += setupApIpAddress();
  }
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

void startWifiAp(wifi_mode_t mode = WIFI_AP) {
  WiFi.mode(mode);
  WiFi.softAPsetHostname(deviceIdentity.hostname.c_str());
  WiFi.softAPConfig(IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1),
                    IPAddress(255, 255, 255, 0));
  WiFi.softAP(kSetupApSsid, kSetupApPassword);
  activeWifiMode = mode == WIFI_AP_STA ? "ap+sta" : "ap";
  activeWifiSsid = kSetupApSsid;
}

bool tryWifiSta(const String &ssid, const String &pass) {
  startWifiAp(WIFI_AP_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());

  const uint32_t start = millis();
  while (millis() - start < kStaConnectTimeoutMs) {
    if (WiFi.status() == WL_CONNECTED) {
      activeWifiMode = "ap+sta";
      activeWifiSsid = ssid;
      return true;
    }
    delay(250);
  }

  WiFi.disconnect(true);
  activeWifiMode = "ap";
  activeWifiSsid = kSetupApSsid;
  return false;
}

void startWifi() {
  WiFi.setHostname(deviceIdentity.hostname.c_str());
  wifiPrefs.begin(kWifiPrefsNamespace, true);
  const String ssid = wifiPrefs.getString(kWifiPrefsSsidKey, "");
  const String pass = wifiPrefs.getString(kWifiPrefsPassKey, "");
  wifiPrefs.end();

  if (ssid.length() > 0 && tryWifiSta(ssid, pass)) {
    return;
  }

  startWifiAp();
}

void startMdns() {
  deviceIdentity.mdnsEnabled = MDNS.begin(deviceIdentity.hostname.c_str());
  if (!deviceIdentity.mdnsEnabled) return;

  MDNS.addService("http", "tcp", 80);
  MDNS.addService("esp32cnc", "tcp", 80);
  MDNS.addServiceTxt("http", "tcp", "name", deviceIdentity.friendlyName);
  MDNS.addServiceTxt("esp32cnc", "tcp", "id", deviceIdentity.deviceId);
  MDNS.addServiceTxt("esp32cnc", "tcp", "name", deviceIdentity.friendlyName);
}

void startHttpServer() {
  server.on("/", HTTP_GET, handleIndex);
  server.on("/index.html", HTTP_GET, handleIndex);
  server.on("/files", HTTP_GET, handleFilesPage);
  server.on("/app.js", HTTP_GET, handleAppJs);
  server.on("/files.js", HTTP_GET, handleFilesJs);
  server.on("/style.css", HTTP_GET, handleStyleCss);
  server.on("/api/health", HTTP_GET, handleHealth);
  server.on("/api/device", HTTP_GET, handleDeviceInfo);
  server.on("/api/device", HTTP_PATCH, handleDeviceUpdate);
  server.on("/api/system/restart", HTTP_POST, handleSystemRestart);
  server.on("/api/machine/info", HTTP_GET, handleMachineInfo);
  server.on("/api/machine/refresh", HTTP_POST, handleMachineRefresh);
  server.on("/api/machine/apply", HTTP_POST, handleMachineApply);
  server.on("/api/machine/save", HTTP_POST, handleMachineSave);
  server.on("/api/machine/frame", HTTP_GET, handleMachineFrame);
  server.on("/api/machine/home", HTTP_POST, handleMachineHome);
  server.on("/api/machine/manual-frame", HTTP_POST, handleManualMachineFrame);
  server.on("/api/marlin/log", HTTP_GET, handleMarlinLog);
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
  server.on("/api/test-motion/start", HTTP_POST, handleTestMotionStart);
  server.on("/api/recovery/production/start", HTTP_POST, handleProductionResumeStart);
  server.on("/api/job/pause", HTTP_POST, handleJobPause);
  server.on("/api/job/resume", HTTP_POST, handleJobResume);
  server.on("/api/job/stop", HTTP_POST, handleJobStop);
  server.on("/api/job/feed-override", HTTP_POST, handleJobFeedOverride);
  server.on("/api/jog/start", HTTP_POST, handleJogStart);
  server.on("/api/jog/update", HTTP_POST, handleJogUpdate);
  server.on("/api/jog/stop", HTTP_POST, handleJogStop);
  server.on("/api/jog/restore-z", HTTP_POST, handleJogRestoreZ);
  server.on("/api/jog/status", HTTP_GET, handleJogStatus);
  server.on("/api/work-zero/goto", HTTP_POST, handleGoToWorkZero);
  server.on("/api/work-zero/set", HTTP_POST, handleSetWorkZero);
  server.on("/api/work-zero/set-z", HTTP_POST, handleSetZZero);
  server.on("/api/work-zero/restore", HTTP_POST, handleRestoreWorkZero);
  server.on("/update", HTTP_GET, handleUpdatePage);
  server.on("/api/update", HTTP_POST, handleUpdateComplete, handleUpdateUpload);
  server.on("/wifi", HTTP_GET, handleWifiPage);
  server.on("/api/wifi/save", HTTP_POST, handleWifiSave);
  server.on("/api/wifi/forget", HTTP_POST, handleWifiForget);
  server.onNotFound(handleNotFound);
  server.begin();
  telemetryQueue = xQueueCreate(12, sizeof(TelemetryPacket *));
  telemetrySocket.begin();
  telemetrySocket.onEvent(handleTelemetrySocket);
  if (telemetryQueue != nullptr) {
    enqueueTelemetry(TelemetryChannel::Job, jobStatusJson());
    enqueueTelemetry(TelemetryChannel::Jog, jogStatusJson());
    enqueueTelemetry(TelemetryChannel::Position, marlinPosition.valid ? machineFrameJson() : "null");
    xTaskCreatePinnedToCore(telemetryNetworkTask, "ws-telemetry", 8192, nullptr, 1,
                            &telemetryTaskHandle, 0);
  }
}
} // namespace

void setup() {
  Serial.begin(kMarlinBaudrate, SERIAL_8N1, kMarlinRxPin, kMarlinTxPin);
  char bootSession[24];
  snprintf(bootSession, sizeof(bootSession), "%08lX-%08lX",
           static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
  bootSessionId = bootSession;
  loadMachineProfile();

  bool sdFirmwareUpdated = false;
  if (checkForSdRescueUpdate()) {
    sdFirmwareUpdated = performSdRescueUpdate();
  } else if (checkForRootFirmwareUpdate()) {
    sdFirmwareUpdated = performRootFirmwareUpdate();
  }
  if (sdFirmwareUpdated) {
    delay(1000);
    ESP.restart();
  }

  SPIFFS.begin(true);
  loadDeviceIdentity();
  startWifi();
  startMdns();
  startHttpServer();
  startBluetoothAdvertisement();
}

void loop() {
  server.handleClient();
  processTelemetrySocket();
  processMachineDiscovery();
  processJobRunner();
  processJogRunner();
  processMarlinAutoreportControl();
  processIdleMarlinAutoreport();

  if (rebootAtMs > 0 && millis() >= rebootAtMs) {
    ESP.restart();
  }
}
