#include <Arduino.h>
#include <ArduinoJson.h>
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
#include <esp_system.h>
#include <mbedtls/sha256.h>
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
constexpr const char *kToolChangePrefsNamespace = "toolchange";
constexpr const char *kRecoveryPrefsNamespace = "recovery";
constexpr const char *kRecoveryPrefsActiveJobKey = "activeJob";
constexpr const char *kOperatorPrefsNamespace = "operator";
constexpr const char *kOperatorPrefsPinHashKey = "pinHash";
constexpr const char *kOperatorPrefsBrowserHashKey = "browserHash";
constexpr const char *kOperatorPrefsOwnerKey = "lastOwner";
constexpr uint32_t kOperatorLeaseMs = 45000;
constexpr uint32_t kOperatorCookieMaxAgeSeconds = 31536000;
constexpr uint32_t kOperatorOtaUnlockMs = 120000;
constexpr uint32_t kOperatorFailedPinWindowMs = 30000;
constexpr uint8_t kOperatorMaxPinAttempts = 5;
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
constexpr const char *kSdSystemLogPath = "/logs/system.log";
constexpr const char *kSdSystemLogPreviousPath = "/logs/system.previous.log";
constexpr size_t kMaxSystemLogBytes = 128 * 1024;
constexpr uint32_t kRepeatedHttpLogIntervalMs = 5000;
constexpr const char *kSdActiveJobCheckpointPath = "/logs/active-job.json";
constexpr const char *kSdActiveJobCheckpointTempPath = "/logs/active-job.tmp";
constexpr size_t kMaxJobCheckpointBytes = 8192;
constexpr uint32_t kJobCheckpointIntervalMs = 2000;
constexpr size_t kJobCheckpointByteInterval = 4096;
constexpr const char *kSdRoots[] = {"/gcode", "/www", "/firmware", "/jobs", "/logs",
                                    "/esp32-cnc"};
constexpr uint32_t kMarlinBaudrate = 250000;
constexpr uint32_t kMarlinTimeoutMs = 1500;
constexpr uint32_t kMarlinCommandAckTimeoutMs = 5000;
constexpr uint32_t kMarlinMotionDrainAckTimeoutMs = 180000;
constexpr uint32_t kMarlinHomingAckTimeoutMs = 180000;
constexpr uint32_t kMarlinToolChangeAckTimeoutMs = 180000;
constexpr uint32_t kMarlinDefaultHardAckTimeoutMs = 10000;
constexpr uint32_t kMarlinUnknownMotionHardAckTimeoutMs = 180000;
constexpr uint32_t kMarlinMaxMotionHardAckTimeoutMs = 30 * 60 * 1000;
constexpr uint32_t kMotionAckOverheadMs = 5000;
constexpr float kMotionAckDurationMultiplier = 3.0f;
constexpr float kPi = 3.14159265358979323846f;
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
  PausedIntact,
  Paused,
  Resuming,
  RecoveryRequired,
  Completed,
  Stopping,
  Stopped,
  Error,
};

struct JobRunnerStatus {
  JobRunnerState state = JobRunnerState::Idle;
  String gcodePath;
  String jobPath;
  String activeRunMode;
  String activeRunFingerprint;
  String authorizationActiveRunPath;
  String workZeroId;
  String homingSessionId;
  uint32_t homingEpoch = 0;
  String startMode = "use_active_work_zero";
  String streamMode = "job";
  bool allowedWorkspaceCommands = false;
  float safeStartZ = 15.0f;
  float travelFeedMmMin = kDefaultTravelFeed;
  size_t fileSize = 0;
  size_t currentByteOffset = 0;
  size_t lastAcknowledgedByteOffset = 0;
  uint32_t sentLineCount = 0;
  uint32_t acknowledgedLineCount = 0;
  uint32_t currentLineNumber = 0;
  uint32_t lastAcknowledgedLineNumber = 0;
  bool pauseRequested = false;
  bool pauseRealtimeHold = false;
  bool pauseInterruptedForManualMotion = false;
  bool directResumeValid = false;
  bool recoveryRequired = false;
  String pauseMode = "none";
  bool stopRequested = false;
  bool priorityCommandInProgress = false;
  int feedOverridePercent = 100;
  bool resetFeedOverrideAfterJob = true;
  bool toolChangePending = false;
  bool toolChangeReady = false;
  bool toolChangeZZeroCompleted = false;
  bool toolChangeParked = false;
  bool toolChangeToolConfirmed = false;
  bool toolChangeRouterReadyConfirmed = false;
  int selectedToolNumber = -1;
  int activeToolNumber = -1;
  int toolChangeToolNumber = -1;
  uint32_t toolChangeLine = 0;
  bool toolChangeReturnPositionCaptured = false;
  float toolChangeReturnWorkX = 0.0f;
  float toolChangeReturnWorkY = 0.0f;
  float toolChangeReturnWorkZ = 0.0f;
  String toolChangeCommand;
  String toolChangeHandling = "pause";
  String toolChangeZZeroMethod = "manual";
  String toolChangePhase = "NONE";
  String lastCommand;
  String lastResponse;
  String lastError;
  String errorCode;
  uint32_t communicationLostAtMs = 0;
  String communicationLostCommand;
  bool communicationLostWorkPositionValid = false;
  float communicationLostWorkX = 0.0f;
  float communicationLostWorkY = 0.0f;
  float communicationLostWorkZ = 0.0f;
  bool communicationLostMachinePositionValid = false;
  float communicationLostMachineX = 0.0f;
  float communicationLostMachineY = 0.0f;
  float communicationLostMachineZ = 0.0f;
  String lastPriorityCommand;
  String lastPriorityResponse;
  String lastPriorityError;
  bool stopEmergencyParserDetected = false;
  String stopWarning;
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
  char command[64] = {};
  uint16_t feedOverridePercent = 100;
};

struct LogTelemetryEvent {
  uint32_t id = 0;
  uint32_t timeMs = 0;
  char direction[8] = {};
  bool priority = false;
  char level[16] = {};
  char text[128] = {};
  char lastCriticalMessage[128] = {};
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
  bool capRealtimeReporting = false;
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

struct MotionTimingState {
  bool xValid = false;
  bool yValid = false;
  bool zValid = false;
  bool absolute = true;
  float x = 0.0f;
  float y = 0.0f;
  float z = 0.0f;
  float unitScale = 1.0f;
  float feedMmMin = kDefaultTravelFeed;
  String motionMode = "G0";
  String plane = "G17";
};

struct MotionTimingEstimate {
  bool motion = false;
  bool durationKnown = false;
  float distanceMm = 0.0f;
  float effectiveFeedMmMin = 0.0f;
  uint32_t durationMs = 0;
};

struct ToolChangeSettings {
  String handling = "pause";
  float parkMachineX = 0.0f;
  float parkMachineY = 0.0f;
  float parkMachineZ = kMachineZMaxMm;
  String zZeroMethod = "manual";
  bool touchPlateEnabled = false;
  float touchPlateThickness = 15.0f;
  float touchPlateProbeDistance = 30.0f;
  float touchPlateProbeFeed = 100.0f;
  float touchPlateRetractDistance = 3.0f;
};

WebServer server(80);
WebSocketsServer telemetrySocket(kTelemetryWebSocketPort);
Preferences wifiPrefs;
Preferences machinePrefs;
Preferences devicePrefs;
Preferences toolChangePrefs;
Preferences recoveryPrefs;
Preferences operatorPrefs;
DeviceIdentity deviceIdentity;
ToolChangeSettings toolChangeSettings;
String activeWifiMode = "ap";
String activeWifiSsid = kSetupApSsid;
bool jobRunning = false; // TODO: Replace with real Marlin job state tracking.
bool otaActive = false;
bool otaUploadSeen = false;
bool otaUploadOk = false;
uint32_t rebootAtMs = 0;
String otaError;
String operatorPinHash;
String operatorRememberedBrowserHash;
String operatorRememberedOwner;
String operatorSessionToken;
String operatorSessionOwner;
String operatorSessionBrowserHash;
uint32_t operatorSessionClaimedAtMs = 0;
uint32_t operatorSessionLastSeenMs = 0;
uint32_t operatorOtaUnlockedUntilMs = 0;
uint32_t operatorFailedPinWindowStartedAtMs = 0;
uint8_t operatorFailedPinAttempts = 0;
bool sdMounted = false;
bool systemLogMountRecorded = false;
String lastLoggedHttpRequest;
uint32_t lastLoggedHttpRequestAtMs = 0;
File uploadFile;
String uploadError;
String uploadTargetPath;
bool uploadSeen = false;
bool uploadOk = false;
bool uploadTargetOpened = false;
File jobFile;
JobRunnerStatus jobStatus;
bool jobWaitingForOk = false;
String jobResponseBuffer;
uint32_t jobCommandStartedAtMs = 0;
uint32_t jobCommandLivenessAtMs = 0;
uint32_t jobCommandAckTimeoutMs = kMarlinCommandAckTimeoutMs;
uint32_t jobCommandHardTimeoutMs = kMarlinDefaultHardAckTimeoutMs;
uint32_t jobCommandEstimatedDurationMs = 0;
uint32_t jobCommandPlannerWaitMs = 0;
JogStatus jogStatus;
constexpr uint8_t kMaxPriorityCommands = 12;
String priorityCommands[kMaxPriorityCommands];
uint8_t priorityCommandCount = 0;
uint8_t priorityCommandIndex = 0;
String priorityResponseBuffer;
uint32_t priorityCommandStartedAtMs = 0;
uint32_t priorityCommandLivenessAtMs = 0;
uint32_t priorityCommandAckTimeoutMs = kMarlinCommandAckTimeoutMs;
uint32_t priorityCommandHardTimeoutMs = kMarlinDefaultHardAckTimeoutMs;
uint32_t priorityCommandEstimatedDurationMs = 0;
uint32_t priorityCommandPlannerWaitMs = 0;
MarlinLogEntry marlinLog[kMarlinLogSize];
size_t marlinLogNext = 0;
size_t marlinLogCount = 0;
String lastCriticalMarlinMessage;
uint32_t nextMarlinLogId = 1;
uint32_t telemetryLastLogId = 0;
volatile bool telemetryLogSubscribed[WEBSOCKETS_SERVER_CLIENT_MAX] = {};
volatile bool telemetryClientConnected[WEBSOCKETS_SERVER_CLIENT_MAX] = {};
TaskHandle_t telemetryTaskHandle = nullptr;
SemaphoreHandle_t telemetryStateMutex = nullptr;
QueueHandle_t motionEventQueue = nullptr;
QueueHandle_t logEventQueue = nullptr;
static portMUX_TYPE telemetryDropMux = portMUX_INITIALIZER_UNLOCKED;
static bool volatile telemetryStartedFlag = false;

inline bool isTelemetryStarted() {
  portENTER_CRITICAL(&telemetryDropMux);
  bool ready = telemetryStartedFlag;
  portEXIT_CRITICAL(&telemetryDropMux);
  return ready;
}

inline void setTelemetryStarted(bool ready) {
  portENTER_CRITICAL(&telemetryDropMux);
  telemetryStartedFlag = ready;
  portEXIT_CRITICAL(&telemetryDropMux);
}

uint32_t telemetryLastBroadcastMs = 0;
uint32_t telemetryLastJobProgressMs = 0;
uint32_t motionTelemetryDropped = 0;
uint32_t logTelemetryDropped = 0;

inline void incrementMotionTelemetryDropped() {
  portENTER_CRITICAL(&telemetryDropMux);
  motionTelemetryDropped++;
  portEXIT_CRITICAL(&telemetryDropMux);
}

inline uint32_t fetchAndResetMotionTelemetryDropped() {
  portENTER_CRITICAL(&telemetryDropMux);
  uint32_t count = motionTelemetryDropped;
  motionTelemetryDropped = 0;
  portEXIT_CRITICAL(&telemetryDropMux);
  return count;
}

inline void incrementLogTelemetryDropped() {
  portENTER_CRITICAL(&telemetryDropMux);
  logTelemetryDropped++;
  portEXIT_CRITICAL(&telemetryDropMux);
}

inline uint32_t fetchAndResetLogTelemetryDropped() {
  portENTER_CRITICAL(&telemetryDropMux);
  uint32_t count = logTelemetryDropped;
  logTelemetryDropped = 0;
  portEXIT_CRITICAL(&telemetryDropMux);
  return count;
}

struct StagedWallClockState {
  bool valid = false;
  int64_t offsetMs = 0;
  int timezoneOffsetMinutes = 0;
  char timeZone[64] = {};
  uint32_t syncUptimeMs = 0;
  char source[16] = "browser";
};

struct StagedTelemetryState {
  uint32_t globalRevision = 1;
  bool dirtySystem = false;
  bool dirtyController = false;
  bool dirtyMachine = false;
  bool dirtyJob = false;
  bool dirtyJog = false;
  bool dirtyControl = false;

  StagedWallClockState wallClock;

  String systemBaseJson;
  String controllerJson;
  String machineJson;
  String jobJson;
  String jogJson;
  String controlJson;
};

StagedTelemetryState stagedState;

inline void resetMotionTelemetry() {
  if (motionEventQueue != nullptr) {
    xQueueReset(motionEventQueue);
  }
}
uint8_t marlinAutoreportSeconds = 0;
String marlinAsyncLine;
String streamMotionMode = "G0";
MotionTimingState motionTimingState;
uint32_t marlinPlannerWaitAllowanceMs = 0;
PositionTelemetry marlinPosition;
MachineFrameState machineFrame;
String bootSessionId;
bool jobCheckpointTracking = false;
bool jobCheckpointDirty = false;
bool recoveryCheckpointRequiresReview = false;
bool bootInterruptedJobDetected = false;
String recoveryCheckpointGcodePath;
String recoveryCheckpointJobPath;
String recoveryCheckpointActiveRunPath;
String recoveryCheckpointResetReason;
uint32_t jobCheckpointLastWriteMs = 0;
size_t jobCheckpointLastAcknowledgedOffset = 0;
JobRunnerState jobCheckpointLastState = JobRunnerState::Idle;
String jobCheckpointLastToolChangePhase = "NONE";
MachineProfile machineProfile;
MachineDiscoveryState machineDiscoveryState = MachineDiscoveryState::Idle;
String machineDiscoveryResponse;
uint32_t machineDiscoveryStartedAtMs = 0;
bool machineDiscoveryPending = true;

String extractWorkspaceCommand(const String &line);
bool handleWorkspaceCommand(const String &line);
bool runJobStartPreamble();
bool responseContainsToken(const String &response, const char *token);
bool extractGcodeIntegerWord(const String &line, char wanted, int &value);
bool extractGcodeWordValue(const String &line, char wanted, float &value);
bool gcodeHasM6(const String &line);
bool gcodeIsStandaloneToolSelect(const String &line, int &toolNumber);
bool beginToolChange(const String &line);
void setJobError(const String &message, bool resetFeedOverride = true);
void setJobCommunicationLost(const String &message);
void sendImmediateJobSafetyM5(const String &reason);
bool beginPersistentJobCheckpoint();
void processPersistentJobCheckpoint();
void clearPersistentJobCheckpoint();
void resetFeedOverrideAfterJobIfNeeded();
void updatePositionFromMarlinResponse(const String &response);
String machineFrameJson();
void drainMarlinInput();
bool sendMarlinControlCommand(const String &cmd, String &response);
void sendJsonError(int status, const String &message);
String bytesToHex(const uint8_t *bytes, size_t length);
void logSystemEvent(const String &message);
void touchJobStatus();
void touchJogStatus();
void touchPositionStatus();
void resetMotionTelemetry();

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

  if (isTelemetryStarted() && logEventQueue != nullptr) {
    LogTelemetryEvent ev;
    ev.id = entry.id;
    ev.timeMs = entry.timeMs;
    snprintf(ev.direction, sizeof(ev.direction), "%s", entry.direction.c_str());
    ev.priority = entry.priority;
    snprintf(ev.level, sizeof(ev.level), "%s", entry.level.c_str());
    snprintf(ev.text, sizeof(ev.text), "%s", entry.text.c_str());
    snprintf(ev.lastCriticalMessage, sizeof(ev.lastCriticalMessage), "%s", lastCriticalMarlinMessage.c_str());

    if (xQueueSend(logEventQueue, &ev, 0) != pdTRUE) {
      incrementLogTelemetryDropped();
    }
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
  case JobRunnerState::PausedIntact:
    return "PAUSED_INTACT";
  case JobRunnerState::Paused:
    return "PAUSED";
  case JobRunnerState::Resuming:
    return "RESUMING";
  case JobRunnerState::RecoveryRequired:
    return "RECOVERY_REQUIRED";
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
         jobStatus.state == JobRunnerState::Pausing || jobStatus.state == JobRunnerState::PausedIntact ||
         jobStatus.state == JobRunnerState::Paused ||
         jobStatus.state == JobRunnerState::Resuming || jobStatus.state == JobRunnerState::Stopping;
}

void touchJobStatus() {
  jobStatus.updatedAtMs = millis();
  if (jobCheckpointTracking) jobCheckpointDirty = true;
}

void touchJobProgress() {
  const uint32_t now = millis();
  jobStatus.updatedAtMs = now;
  if (jobCheckpointTracking) jobCheckpointDirty = true;
  if (now - telemetryLastJobProgressMs >= kJobProgressBroadcastMs) {
    touchJobStatus();
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
  MotionTelemetryEvent ev;
  ev.sequence = sequence;
  ev.sentAtMs = millis();
  snprintf(ev.command, sizeof(ev.command), "%s", command.c_str());
  ev.feedOverridePercent = jobStatus.feedOverridePercent;

  if (isTelemetryStarted() && motionEventQueue != nullptr) {
    if (xQueueSend(motionEventQueue, &ev, 0) != pdTRUE) {
      incrementMotionTelemetryDropped();
    }
  }
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

const char *resetReasonName(esp_reset_reason_t reason) {
  switch (reason) {
  case ESP_RST_POWERON: return "POWER_ON";
  case ESP_RST_EXT: return "EXTERNAL";
  case ESP_RST_SW: return "SOFTWARE";
  case ESP_RST_PANIC: return "PANIC";
  case ESP_RST_INT_WDT: return "INTERRUPT_WATCHDOG";
  case ESP_RST_TASK_WDT: return "TASK_WATCHDOG";
  case ESP_RST_WDT: return "OTHER_WATCHDOG";
  case ESP_RST_DEEPSLEEP: return "DEEP_SLEEP";
  case ESP_RST_BROWNOUT: return "BROWNOUT";
  case ESP_RST_SDIO: return "SDIO";
  default: return "UNKNOWN";
  }
}

void setPersistentActiveJobMarker(bool active) {
  recoveryPrefs.begin(kRecoveryPrefsNamespace, false);
  recoveryPrefs.putBool(kRecoveryPrefsActiveJobKey, active);
  recoveryPrefs.end();
}

bool persistentActiveJobMarker() {
  recoveryPrefs.begin(kRecoveryPrefsNamespace, true);
  const bool active = recoveryPrefs.getBool(kRecoveryPrefsActiveJobKey, false);
  recoveryPrefs.end();
  return active;
}

bool readPersistentJobCheckpoint(String &body) {
  body = "";
  if (!sdMounted || !SD_MMC.exists(kSdActiveJobCheckpointPath)) return false;
  File file = SD_MMC.open(kSdActiveJobCheckpointPath, FILE_READ);
  if (!file || file.isDirectory() || file.size() == 0 || file.size() > kMaxJobCheckpointBytes) {
    if (file) file.close();
    return false;
  }
  body.reserve(file.size() + 1);
  while (file.available()) body += static_cast<char>(file.read());
  file.close();
  return body.length() > 0;
}

void updateRecoveryCheckpointMetadata(const String &body) {
  recoveryCheckpointGcodePath = normalizeSdPath(extractJsonString(body, "gcodePath"));
  recoveryCheckpointJobPath = normalizeSdPath(extractJsonString(body, "jobPath"));
  recoveryCheckpointActiveRunPath = normalizeSdPath(extractJsonString(body, "authorizationActiveRunPath"));
}

bool writePersistentJobCheckpoint(bool activeJob, bool interrupted, const String &reason) {
  if (!sdMounted) return false;
  SD_MMC.mkdir("/logs");
  SD_MMC.remove(kSdActiveJobCheckpointTempPath);
  File file = SD_MMC.open(kSdActiveJobCheckpointTempPath, FILE_WRITE);
  if (!file) return false;

  file.print("{\"schemaVersion\":3,\"activeJob\":");
  file.print(activeJob ? "true" : "false");
  file.print(",\"interrupted\":");
  file.print(interrupted ? "true" : "false");
  file.print(",\"state\":\""); file.print(jobStateName(jobStatus.state)); file.print("\"");
  file.print(",\"reason\":\""); file.print(jsonEscape(reason)); file.print("\"");
  file.print(",\"bootSessionId\":\""); file.print(jsonEscape(bootSessionId)); file.print("\"");
  file.print(",\"updatedAtMs\":"); file.print(millis());
  file.print(",\"gcodePath\":\""); file.print(jsonEscape(jobStatus.gcodePath)); file.print("\"");
  file.print(",\"jobPath\":\""); file.print(jsonEscape(jobStatus.jobPath)); file.print("\"");
  file.print(",\"activeRunMode\":\""); file.print(jsonEscape(jobStatus.activeRunMode)); file.print("\"");
  file.print(",\"activeRunFingerprint\":\""); file.print(jsonEscape(jobStatus.activeRunFingerprint)); file.print("\"");
  file.print(",\"authorizationActiveRunPath\":\""); file.print(jsonEscape(jobStatus.authorizationActiveRunPath)); file.print("\"");
  file.print(",\"streamMode\":\""); file.print(jsonEscape(jobStatus.streamMode)); file.print("\"");
  file.print(",\"startMode\":\""); file.print(jsonEscape(jobStatus.startMode)); file.print("\"");
  file.print(",\"fileSize\":"); file.print(jobStatus.fileSize);
  file.print(",\"currentByteOffset\":"); file.print(jobStatus.currentByteOffset);
  file.print(",\"lastAcknowledgedByteOffset\":"); file.print(jobStatus.lastAcknowledgedByteOffset);
  file.print(",\"currentLineNumber\":"); file.print(jobStatus.currentLineNumber);
  file.print(",\"lastAcknowledgedLineNumber\":"); file.print(jobStatus.lastAcknowledgedLineNumber);
  file.print(",\"sentLineCount\":"); file.print(jobStatus.sentLineCount);
  file.print(",\"acknowledgedLineCount\":"); file.print(jobStatus.acknowledgedLineCount);
  file.print(",\"lastCommand\":\""); file.print(jsonEscape(jobStatus.lastCommand)); file.print("\"");
  file.print(",\"lastResponse\":\""); file.print(jsonEscape(jobStatus.lastResponse)); file.print("\"");
  file.print(",\"lastError\":\""); file.print(jsonEscape(jobStatus.lastError)); file.print("\"");
  file.print(",\"errorCode\":\""); file.print(jsonEscape(jobStatus.errorCode)); file.print("\"");
  file.print(",\"feedOverridePercent\":"); file.print(jobStatus.feedOverridePercent);
  file.print(",\"workZeroId\":\""); file.print(jsonEscape(jobStatus.workZeroId)); file.print("\"");
  file.print(",\"homingEpoch\":"); file.print(jobStatus.homingEpoch);
  file.print(",\"homingSessionId\":\""); file.print(jsonEscape(jobStatus.homingSessionId)); file.print("\"");
  file.print(",\"pause\":{\"mode\":\""); file.print(jsonEscape(jobStatus.pauseMode)); file.print("\"");
  file.print(",\"directResumeValid\":"); file.print(jobStatus.directResumeValid ? "true" : "false");
  file.print(",\"cutterState\":\"");
  file.print(jobStatus.state == JobRunnerState::PausedIntact || jobStatus.state == JobRunnerState::Pausing
                 ? "running_assumed"
                 : jobStatus.state == JobRunnerState::Stopping &&
                           jobStatus.pauseInterruptedForManualMotion
                       ? "stopping_pending_m5"
                       : "stopped");
  file.print("\"}");
  file.print(",\"projectSafeZSnapshot\":{\"effectiveSafeZ\":"); file.print(jobStatus.safeStartZ, 3);
  file.print("}");
  file.print(",\"workZeroMachine\":");
  if (machineFrame.workZeroValid) {
    file.print("{\"x\":"); file.print(machineFrame.workZeroMachineX, 3);
    file.print(",\"y\":"); file.print(machineFrame.workZeroMachineY, 3);
    file.print(",\"z\":"); file.print(machineFrame.workZeroMachineZ, 3); file.print("}");
  } else {
    file.print("null");
  }
  file.print(",\"selectedToolNumber\":"); file.print(jobStatus.selectedToolNumber);
  file.print(",\"activeToolNumber\":"); file.print(jobStatus.activeToolNumber);
  file.print(",\"toolChange\":{\"pending\":"); file.print(jobStatus.toolChangePending ? "true" : "false");
  file.print(",\"phase\":\""); file.print(jsonEscape(jobStatus.toolChangePhase)); file.print("\"");
  file.print(",\"ready\":"); file.print(jobStatus.toolChangeReady ? "true" : "false");
  file.print(",\"zZeroCompleted\":"); file.print(jobStatus.toolChangeZZeroCompleted ? "true" : "false");
  file.print(",\"parked\":"); file.print(jobStatus.toolChangeParked ? "true" : "false");
  file.print(",\"toolConfirmed\":"); file.print(jobStatus.toolChangeToolConfirmed ? "true" : "false");
  file.print(",\"routerReadyConfirmed\":"); file.print(jobStatus.toolChangeRouterReadyConfirmed ? "true" : "false");
  file.print(",\"toolNumber\":"); file.print(jobStatus.toolChangeToolNumber);
  file.print(",\"line\":"); file.print(jobStatus.toolChangeLine);
  file.print(",\"nextLineNumber\":"); file.print(jobStatus.toolChangeLine + 1);
  file.print(",\"nextByteOffset\":"); file.print(jobStatus.currentByteOffset);
  file.print(",\"command\":\""); file.print(jsonEscape(jobStatus.toolChangeCommand)); file.print("\"");
  file.print(",\"handling\":\""); file.print(jsonEscape(jobStatus.toolChangeHandling)); file.print("\"");
  file.print(",\"zZeroMethod\":\""); file.print(jsonEscape(jobStatus.toolChangeZZeroMethod)); file.print("\"");
  file.print(",\"returnPosition\":");
  if (jobStatus.toolChangeReturnPositionCaptured) {
    file.print("{\"x\":"); file.print(jobStatus.toolChangeReturnWorkX, 3);
    file.print(",\"y\":"); file.print(jobStatus.toolChangeReturnWorkY, 3);
    file.print(",\"z\":"); file.print(jobStatus.toolChangeReturnWorkZ, 3); file.print("}");
  } else {
    file.print("null");
  }
  file.print("}");
  file.print(",\"workPosition\":");
  if (marlinPosition.valid) {
    file.print("{\"x\":"); file.print(marlinPosition.x, 3);
    file.print(",\"y\":"); file.print(marlinPosition.y, 3);
    file.print(",\"z\":"); file.print(marlinPosition.z, 3); file.print("}");
  } else {
    file.print("null");
  }
  file.print(",\"machinePosition\":");
  if (machineFrame.machineValid) {
    file.print("{\"x\":"); file.print(machineFrame.machineX, 3);
    file.print(",\"y\":"); file.print(machineFrame.machineY, 3);
    file.print(",\"z\":"); file.print(machineFrame.machineZ, 3); file.print("}");
  } else {
    file.print("null");
  }
  file.print("}");
  file.close();

  SD_MMC.remove(kSdActiveJobCheckpointPath);
  if (!SD_MMC.rename(kSdActiveJobCheckpointTempPath, kSdActiveJobCheckpointPath)) return false;
  jobCheckpointLastWriteMs = millis();
  jobCheckpointLastAcknowledgedOffset = jobStatus.lastAcknowledgedByteOffset;
  jobCheckpointLastState = jobStatus.state;
  jobCheckpointLastToolChangePhase = jobStatus.toolChangePhase;
  jobCheckpointDirty = false;
  recoveryCheckpointGcodePath = jobStatus.gcodePath;
  recoveryCheckpointJobPath = jobStatus.jobPath;
  if (interrupted) recoveryCheckpointRequiresReview = true;
  return true;
}

bool beginPersistentJobCheckpoint() {
  setPersistentActiveJobMarker(true);
  jobCheckpointTracking = true;
  jobCheckpointDirty = true;
  if (writePersistentJobCheckpoint(true, false, "")) return true;
  jobCheckpointTracking = false;
  setPersistentActiveJobMarker(false);
  return false;
}

bool persistToolChangeTransition() {
  touchJobStatus();
  if (!jobCheckpointTracking) return true;
  return writePersistentJobCheckpoint(true, false, "");
}

void clearPersistentJobCheckpoint() {
  setPersistentActiveJobMarker(false);
  if (sdMounted) {
    SD_MMC.remove(kSdActiveJobCheckpointTempPath);
    SD_MMC.remove(kSdActiveJobCheckpointPath);
  }
  jobCheckpointTracking = false;
  jobCheckpointDirty = false;
  recoveryCheckpointRequiresReview = false;
  bootInterruptedJobDetected = false;
  recoveryCheckpointGcodePath = "";
  recoveryCheckpointJobPath = "";
  recoveryCheckpointActiveRunPath = "";
  recoveryCheckpointResetReason = "";
}

void processPersistentJobCheckpoint() {
  if (!jobCheckpointTracking) return;
  if (jobStatus.state == JobRunnerState::Completed) {
    clearPersistentJobCheckpoint();
    return;
  }
  if (jobStatus.state == JobRunnerState::Stopped ||
      jobStatus.state == JobRunnerState::RecoveryRequired ||
      jobStatus.state == JobRunnerState::Error) {
    const String reason = jobStatus.lastError.length() > 0 ? jobStatus.lastError : jobStatus.streamingPausedReason;
    if (writePersistentJobCheckpoint(false, true, reason)) {
      setPersistentActiveJobMarker(false);
      jobCheckpointTracking = false;
    }
    return;
  }
  if (!jobIsActive() || !jobCheckpointDirty) return;
  const bool stateChanged = jobStatus.state != jobCheckpointLastState;
  const bool toolChangePhaseChanged = jobStatus.toolChangePhase != jobCheckpointLastToolChangePhase;
  const bool intervalElapsed = millis() - jobCheckpointLastWriteMs >= kJobCheckpointIntervalMs;
  const bool bytesAdvanced = jobStatus.lastAcknowledgedByteOffset >= jobCheckpointLastAcknowledgedOffset +
                                                                  kJobCheckpointByteInterval;
  if (stateChanged || toolChangePhaseChanged || intervalElapsed || bytesAdvanced) {
    writePersistentJobCheckpoint(true, false, "");
  }
}

void loadPersistentJobCheckpointAtBoot() {
  String body;
  const bool checkpointAvailable = readPersistentJobCheckpoint(body);
  const bool activeMarker = persistentActiveJobMarker();
  const bool legacyTestMotion = checkpointAvailable &&
                                extractJsonString(body, "startMode") == "validated_test_motion";
  if (legacyTestMotion) {
    const String testPath = normalizeSdPath(extractJsonString(body, "gcodePath"));
    clearPersistentJobCheckpoint();
    logJobEvent("discarded legacy non-recoverable test-motion checkpoint: " + testPath);
    return;
  }
  const bool checkpointActive = checkpointAvailable && extractJsonBool(body, "activeJob", false);
  const bool checkpointInterrupted = checkpointAvailable && extractJsonBool(body, "interrupted", false);
  if (checkpointAvailable) updateRecoveryCheckpointMetadata(body);
  recoveryCheckpointRequiresReview = checkpointInterrupted || activeMarker || checkpointActive;
  if (!activeMarker && !checkpointActive) return;

  bootInterruptedJobDetected = true;
  recoveryCheckpointResetReason = resetReasonName(esp_reset_reason());
  machineFrame = MachineFrameState();
  marlinPosition.valid = false;
  touchPositionStatus();
  sendImmediateJobSafetyM5("active job marker found during boot; position invalidated");
  logJobEvent("boot interrupted job: reset=" + recoveryCheckpointResetReason +
              " gcode=" + recoveryCheckpointGcodePath +
              " acknowledgedOffset=" + String(extractJsonInt(body, "lastAcknowledgedByteOffset", 0)));
}

String jobStatusJson() {
  const float progress = jobStatus.fileSize > 0
                             ? (static_cast<float>(jobStatus.lastAcknowledgedByteOffset) * 100.0f) /
                                   static_cast<float>(jobStatus.fileSize)
                             : 0.0f;
  String json = "{";
  json += "\"state\":\"";
  json += jobStateName(jobStatus.state);
  json += "\",\"gcodePath\":\"";
  json += jsonEscape(jobStatus.gcodePath);
  json += "\",\"jobPath\":\"";
  json += jsonEscape(jobStatus.jobPath);
  json += "\",\"activeRunMode\":\"";
  json += jsonEscape(jobStatus.activeRunMode);
  json += "\",\"activeRunFingerprint\":\"";
  json += jsonEscape(jobStatus.activeRunFingerprint);
  json += "\",\"workZeroId\":\"";
  json += jsonEscape(jobStatus.workZeroId);
  json += "\",\"homingSessionId\":\"";
  json += jsonEscape(jobStatus.homingSessionId);
  json += "\",\"homingEpoch\":" + String(jobStatus.homingEpoch);
  json += ",\"startMode\":\"";
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
  json += ",\"lastAcknowledgedByteOffset\":";
  json += String(jobStatus.lastAcknowledgedByteOffset);
  json += ",\"progressPercent\":";
  json += String(progress, 1);
  json += ",\"sentLineCount\":";
  json += String(jobStatus.sentLineCount);
  json += ",\"acknowledgedLineCount\":";
  json += String(jobStatus.acknowledgedLineCount);
  json += ",\"currentLineNumber\":";
  json += String(jobStatus.currentLineNumber);
  json += ",\"lastAcknowledgedLineNumber\":";
  json += String(jobStatus.lastAcknowledgedLineNumber);
  json += ",\"pauseRequested\":";
  json += jobStatus.pauseRequested ? "true" : "false";
  json += ",\"pauseMode\":\"" + jsonEscape(jobStatus.pauseMode) + "\"";
  json += ",\"realtimeHoldSupported\":";
  json += machineProfile.capRealtimeReporting ? "true" : "false";
  json += ",\"realtimeHoldActive\":";
  json += jobStatus.pauseRealtimeHold ? "true" : "false";
  json += ",\"directResumeValid\":";
  json += jobStatus.directResumeValid ? "true" : "false";
  json += ",\"recoveryRequired\":";
  json += jobStatus.recoveryRequired ? "true" : "false";
  json += ",\"cutterState\":\"";
  json += (jobStatus.state == JobRunnerState::PausedIntact || jobStatus.state == JobRunnerState::Pausing)
              ? "running_assumed"
              : "unknown";
  json += "\"";
  json += ",\"stopRequested\":";
  json += jobStatus.stopRequested ? "true" : "false";
  json += ",\"priorityCommandInProgress\":";
  json += jobStatus.priorityCommandInProgress ? "true" : "false";
  json += ",\"feedOverridePercent\":";
  json += String(jobStatus.feedOverridePercent);
  json += ",\"toolChangePending\":";
  json += jobStatus.toolChangePending ? "true" : "false";
  json += ",\"toolChangeReady\":";
  json += jobStatus.toolChangeReady ? "true" : "false";
  json += ",\"toolChangeZZeroCompleted\":";
  json += jobStatus.toolChangeZZeroCompleted ? "true" : "false";
  json += ",\"toolChangeParked\":";
  json += jobStatus.toolChangeParked ? "true" : "false";
  json += ",\"toolChangeToolConfirmed\":";
  json += jobStatus.toolChangeToolConfirmed ? "true" : "false";
  json += ",\"toolChangeRouterReadyConfirmed\":";
  json += jobStatus.toolChangeRouterReadyConfirmed ? "true" : "false";
  json += ",\"toolChangePhase\":\"" + jsonEscape(jobStatus.toolChangePhase) + "\"";
  json += ",\"selectedToolNumber\":" + String(jobStatus.selectedToolNumber);
  json += ",\"activeToolNumber\":" + String(jobStatus.activeToolNumber);
  json += ",\"toolChangeToolNumber\":" + String(jobStatus.toolChangeToolNumber);
  json += ",\"toolChangeLine\":" + String(jobStatus.toolChangeLine);
  json += ",\"toolChangeReturnPositionCaptured\":";
  json += jobStatus.toolChangeReturnPositionCaptured ? "true" : "false";
  json += ",\"toolChangeReturnPosition\":";
  if (jobStatus.toolChangeReturnPositionCaptured) {
    json += "{\"x\":" + String(jobStatus.toolChangeReturnWorkX, 3) +
            ",\"y\":" + String(jobStatus.toolChangeReturnWorkY, 3) +
            ",\"z\":" + String(jobStatus.toolChangeReturnWorkZ, 3) + "}";
  } else {
    json += "null";
  }
  json += ",\"toolChangeCommand\":\"" + jsonEscape(jobStatus.toolChangeCommand) + "\"";
  json += ",\"toolChangeHandling\":\"" + jsonEscape(jobStatus.toolChangeHandling) + "\"";
  json += ",\"toolChangeZZeroMethod\":\"" + jsonEscape(jobStatus.toolChangeZZeroMethod) + "\"";
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
  json += "\",\"errorCode\":\"";
  json += jsonEscape(jobStatus.errorCode);
  const bool waitingForMarlinAck = jobWaitingForOk || jobStatus.priorityCommandInProgress;
  const uint32_t activeAckStartedAtMs = jobStatus.priorityCommandInProgress
                                            ? priorityCommandStartedAtMs
                                            : (jobWaitingForOk ? jobCommandStartedAtMs : 0);
  const uint32_t activeAckTimeoutMs = jobStatus.priorityCommandInProgress
                                         ? priorityCommandAckTimeoutMs
                                         : (jobWaitingForOk ? jobCommandAckTimeoutMs : 0);
  const uint32_t activeAckHardTimeoutMs = jobStatus.priorityCommandInProgress
                                             ? priorityCommandHardTimeoutMs
                                             : (jobWaitingForOk ? jobCommandHardTimeoutMs : 0);
  const uint32_t activeEstimatedDurationMs = jobStatus.priorityCommandInProgress
                                                 ? priorityCommandEstimatedDurationMs
                                                 : (jobWaitingForOk ? jobCommandEstimatedDurationMs : 0);
  const uint32_t activePlannerWaitMs = jobStatus.priorityCommandInProgress
                                           ? priorityCommandPlannerWaitMs
                                           : (jobWaitingForOk ? jobCommandPlannerWaitMs : 0);
  json += "\",\"ackWatchdog\":{\"waiting\":";
  json += waitingForMarlinAck ? "true" : "false";
  json += ",\"timeoutMs\":" + String(activeAckTimeoutMs);
  json += ",\"inactivityTimeoutMs\":" + String(activeAckTimeoutMs);
  json += ",\"hardTimeoutMs\":" + String(activeAckHardTimeoutMs);
  json += ",\"estimatedCommandDurationMs\":" + String(activeEstimatedDurationMs);
  json += ",\"plannerWaitAllowanceMs\":" + String(activePlannerWaitMs);
  json += ",\"elapsedMs\":" + String(activeAckStartedAtMs > 0 ? millis() - activeAckStartedAtMs : 0);
  json += "}";
  json += ",\"communicationLoss\":";
  if (jobStatus.communicationLostAtMs > 0) {
    json += "{\"atMs\":" + String(jobStatus.communicationLostAtMs);
    json += ",\"command\":\"" + jsonEscape(jobStatus.communicationLostCommand) + "\"";
    json += ",\"sentByteOffset\":" + String(jobStatus.currentByteOffset);
    json += ",\"acknowledgedByteOffset\":" + String(jobStatus.lastAcknowledgedByteOffset);
    json += ",\"workPosition\":";
    if (jobStatus.communicationLostWorkPositionValid) {
      json += "{\"x\":" + String(jobStatus.communicationLostWorkX, 3) +
              ",\"y\":" + String(jobStatus.communicationLostWorkY, 3) +
              ",\"z\":" + String(jobStatus.communicationLostWorkZ, 3) + "}";
    } else {
      json += "null";
    }
    json += ",\"machinePosition\":";
    if (jobStatus.communicationLostMachinePositionValid) {
      json += "{\"x\":" + String(jobStatus.communicationLostMachineX, 3) +
              ",\"y\":" + String(jobStatus.communicationLostMachineY, 3) +
              ",\"z\":" + String(jobStatus.communicationLostMachineZ, 3) + "}";
    } else {
      json += "null";
    }
    json += "}";
  } else {
    json += "null";
  }
  json += ",\"recoveryCheckpoint\":{\"requiresReview\":";
  json += recoveryCheckpointRequiresReview ? "true" : "false";
  json += ",\"bootInterrupted\":";
  json += bootInterruptedJobDetected ? "true" : "false";
  json += ",\"gcodePath\":\"" + jsonEscape(recoveryCheckpointGcodePath) + "\"";
  json += ",\"jobPath\":\"" + jsonEscape(recoveryCheckpointJobPath) + "\"";
  json += ",\"resetReason\":\"" + jsonEscape(recoveryCheckpointResetReason) + "\"}";
  json += ",\"lastPriorityCommand\":\"";
  json += jsonEscape(jobStatus.lastPriorityCommand);
  json += "\",\"lastPriorityResponse\":\"";
  json += jsonEscape(jobStatus.lastPriorityResponse);
  json += "\",\"lastPriorityError\":\"";
  json += jsonEscape(jobStatus.lastPriorityError);
  json += "\",\"stopEmergencyParserDetected\":";
  json += jobStatus.stopEmergencyParserDetected ? "true" : "false";
  json += ",\"stopWarning\":\"";
  json += jsonEscape(jobStatus.stopWarning);
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
String currentIpAddress();
bool wifiStaConnected();
const char *jobStateName(JobRunnerState state);
String marlinLogEntryJson(const MarlinLogEntry &entry);

String healthStatusJson() {
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
  return json;
}

struct ControllerCapabilities {
  bool homing = true;
  bool absoluteMachineMove = true;
  bool positionReports = true;
  bool pause = true;
  bool resume = true;
  bool stop = true;
  bool feedOverride = true;
  bool arcs = true;
  bool toolChange = true;
};

struct ControllerAdapter {
  const char *type = "marlin";
  const char *identity = "Marlin 2.1.1";
  ControllerCapabilities capabilities;
};
ControllerAdapter controllerAdapter;

struct TelemetryClientState {
  bool connected = false;
  bool handshakeComplete = false;
  bool snapshotPending = false;
  bool resyncPending = false;
  uint32_t nextServerSeq = 1;
  uint32_t lastContiguousClientSeq = 0;
  uint32_t lastServerSeqAcknowledgedByClient = 0;
  uint32_t lastOutboundAtMs = 0;
};

struct TelemetryProtocolState {
  uint32_t protocolVersion = 1;
  TelemetryClientState clients[WEBSOCKETS_SERVER_CLIENT_MAX];
};
TelemetryProtocolState protocolState;

struct CachedAuthoritativeSlices {
  float positionX = -9999.0f;
  float positionY = -9999.0f;
  float positionZ = -9999.0f;
  float machineX = -9999.0f;
  float machineY = -9999.0f;
  float machineZ = -9999.0f;
  bool homedX = false;
  bool homedY = false;
  bool homedZ = false;
  uint32_t homingEpoch = 0;

  String jobState;
  uint32_t jobLine = 0;
  uint16_t feedOverride = 100;
  String jobError;

  String jogState;
  String jogError;

  String controlOwner;
  String controllerState;
  String controllerError;
};
CachedAuthoritativeSlices cachedSlices;
inline void touchJogStatus() { cachedSlices.jogState = ""; }
inline void touchPositionStatus() { cachedSlices.positionX = -999999.0f; }

bool dirtySystem = false;
bool dirtyController = false;
bool dirtyMachine = false;
bool dirtyJob = false;
bool dirtyJog = false;
bool dirtyControl = false;

String controllerStateNormalized() {
  switch (jobStatus.state) {
  case JobRunnerState::Idle: return "idle";
  case JobRunnerState::Preparing: return "preparing";
  case JobRunnerState::Running: return "running";
  case JobRunnerState::Pausing: return "pausing";
  case JobRunnerState::PausedIntact:
  case JobRunnerState::Paused: return "paused";
  case JobRunnerState::Resuming: return "resuming";
  case JobRunnerState::Stopping: return "stopping";
  case JobRunnerState::Stopped: return "stopped";
  case JobRunnerState::Completed: return "completed";
  case JobRunnerState::RecoveryRequired: return "recovery_required";
  case JobRunnerState::Error: return "error";
  }
  return "idle";
}

String makeProtocolEnvelope(const char *type, uint32_t seq, uint32_t ack, uint32_t revision, const String &bodyFieldKey, const String &bodyJson) {
  String json = "{\"protocolVersion\":1,\"type\":\"";
  json += type;
  json += "\",\"seq\":";
  json += String(seq);
  json += ",\"ack\":";
  json += String(ack);
  json += ",\"bootId\":\"esp-";
  json += bootSessionId;
  json += "\",\"stateRevision\":";
  json += String(revision);
  if (bodyFieldKey.length() > 0 && bodyJson.length() > 0) {
    json += ",\"";
    json += bodyFieldKey;
    json += "\":";
    json += bodyJson;
  }
  json += "}";
  return json;
}

static uint32_t netLastObservedRevision = 1;

uint32_t getStagedStateRevision() {
  if (telemetryStateMutex != nullptr && xSemaphoreTake(telemetryStateMutex, pdMS_TO_TICKS(5)) == pdTRUE) {
    if (stagedState.globalRevision > netLastObservedRevision) {
      netLastObservedRevision = stagedState.globalRevision;
    }
    xSemaphoreGive(telemetryStateMutex);
  }
  return netLastObservedRevision;
}

String makeClientEnvelope(uint8_t client, const char *type, const String &bodyFieldKey, const String &bodyJson) {
  if (client >= WEBSOCKETS_SERVER_CLIENT_MAX) return "";
  TelemetryClientState &cs = protocolState.clients[client];
  uint32_t seq = cs.nextServerSeq++;
  uint32_t ack = cs.lastContiguousClientSeq;
  uint32_t revision = getStagedStateRevision();
  cs.lastOutboundAtMs = millis();
  return makeProtocolEnvelope(type, seq, ack, revision, bodyFieldKey, bodyJson);
}

String buildSystemBaseJson() {
  String patchJson = "{\"bootId\":\"esp-";
  patchJson += bootSessionId;
  patchJson += "\",\"protocolVersion\":1,\"health\":";
  patchJson += healthStatusJson();
  patchJson += "}";
  return patchJson;
}

String buildSystemSliceJsonFromBaseAndClock(const String &baseJson, const StagedWallClockState &clock) {
  if (baseJson.length() < 2 || baseJson.charAt(baseJson.length() - 1) != '}') {
    return "{}";
  }
  String json = baseJson.substring(0, baseJson.length() - 1);
  json += ",\"time\":{\"utcMs\":";
  if (clock.valid) {
    uint64_t nowUtc = static_cast<uint64_t>(static_cast<int64_t>(millis()) + clock.offsetMs);
    json += String(nowUtc);
  } else {
    json += "null";
  }
  json += ",\"timezoneOffsetMinutes\":";
  json += String(clock.timezoneOffsetMinutes);
  json += ",\"timeZone\":\"";
  json += jsonEscape(clock.timeZone);
  json += "\",\"valid\":";
  json += clock.valid ? "true" : "false";
  json += "}}";
  return json;
}

String buildControllerSliceJson() {
  String patchJson = "{\"type\":\"";
  patchJson += controllerAdapter.type;
  patchJson += "\",\"identity\":\"";
  patchJson += jsonEscape(machineProfile.firmwareName.length() > 0 ? machineProfile.firmwareName : controllerAdapter.identity);
  patchJson += "\",\"connected\":true,\"state\":\"";
  patchJson += controllerStateNormalized();
  patchJson += "\",\"lastError\":";
  patchJson += jobStatus.lastError.length() > 0 ? "\"" + jsonEscape(jobStatus.lastError) + "\"" : "null";
  patchJson += ",\"capabilities\":{\"homing\":true,\"absoluteMachineMove\":true,\"positionReports\":true,\"pause\":true,\"resume\":true,\"stop\":true,\"feedOverride\":true,\"arcs\":true,\"toolChange\":true}}";
  return patchJson;
}

String buildMachineSliceJson() {
  String patchJson = "{\"position\":{\"work\":{\"x\":";
  patchJson += String(marlinPosition.x, 3);
  patchJson += ",\"y\":";
  patchJson += String(marlinPosition.y, 3);
  patchJson += ",\"z\":";
  patchJson += String(marlinPosition.z, 3);
  patchJson += "},\"machine\":{\"x\":";
  patchJson += String(machineFrame.machineX, 3);
  patchJson += ",\"y\":";
  patchJson += String(machineFrame.machineY, 3);
  patchJson += ",\"z\":";
  patchJson += String(machineFrame.machineZ, 3);
  patchJson += "}},\"frame\":";
  patchJson += machineFrameJson();
  patchJson += ",\"homedAxes\":{\"x\":";
  patchJson += machineFrame.homedX ? "true" : "false";
  patchJson += ",\"y\":";
  patchJson += machineFrame.homedY ? "true" : "false";
  patchJson += ",\"z\":";
  patchJson += machineFrame.homedZ ? "true" : "false";
  patchJson += "},\"homingEpoch\":";
  patchJson += String(machineFrame.homingEpoch);
  patchJson += "}";
  return patchJson;
}

String buildControlSliceJson() {
  String patchJson = "{\"owner\":";
  patchJson += operatorSessionOwner.length() > 0 ? "\"" + jsonEscape(operatorSessionOwner) + "\"" : "null";
  patchJson += "}";
  return patchJson;
}

void initializeStagedState() {
  stagedState.wallClock = StagedWallClockState{};
  stagedState.systemBaseJson = buildSystemBaseJson();
  stagedState.controllerJson = buildControllerSliceJson();
  stagedState.machineJson = buildMachineSliceJson();
  stagedState.jobJson = jobStatusJson();
  stagedState.jogJson = jogStatusJson();
  stagedState.controlJson = buildControlSliceJson();
  stagedState.globalRevision = 1;
  stagedState.dirtySystem = false;
  stagedState.dirtyController = false;
  stagedState.dirtyMachine = false;
  stagedState.dirtyJob = false;
  stagedState.dirtyJog = false;
  stagedState.dirtyControl = false;

  cachedSlices.positionX = marlinPosition.x;
  cachedSlices.positionY = marlinPosition.y;
  cachedSlices.positionZ = marlinPosition.z;
  cachedSlices.machineX = machineFrame.machineX;
  cachedSlices.machineY = machineFrame.machineY;
  cachedSlices.machineZ = machineFrame.machineZ;
  cachedSlices.homedX = machineFrame.homedX;
  cachedSlices.homedY = machineFrame.homedY;
  cachedSlices.homedZ = machineFrame.homedZ;
  cachedSlices.homingEpoch = machineFrame.homingEpoch;
  cachedSlices.controllerState = controllerStateNormalized();
  cachedSlices.controllerError = jobStatus.lastError;
  cachedSlices.jobState = jobStateName(jobStatus.state);
  cachedSlices.jobLine = jobStatus.currentLineNumber;
  cachedSlices.feedOverride = jobStatus.feedOverridePercent;
  cachedSlices.jobError = jobStatus.lastError;
  cachedSlices.jogState = jogStateName(jogStatus.state);
  cachedSlices.jogError = jogStatus.lastError;
  cachedSlices.controlOwner = operatorSessionOwner;
}

String buildSnapshotFromStagedState(uint32_t &outRevision) {
  outRevision = 0;
  if (telemetryStateMutex == nullptr) return "";

  String sysBase, ctrl, mach, job, jog, cntrl;
  StagedWallClockState wallClock;
  if (xSemaphoreTake(telemetryStateMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
    sysBase = stagedState.systemBaseJson;
    wallClock = stagedState.wallClock;
    ctrl = stagedState.controllerJson;
    mach = stagedState.machineJson;
    job = stagedState.jobJson;
    jog = stagedState.jogJson;
    cntrl = stagedState.controlJson;
    outRevision = stagedState.globalRevision;
    if (outRevision > netLastObservedRevision) {
      netLastObservedRevision = outRevision;
    }
    xSemaphoreGive(telemetryStateMutex);
  } else {
    return "";
  }

  String sysJson = buildSystemSliceJsonFromBaseAndClock(sysBase, wallClock);
  String json = "{\"system\":" + sysJson + ",\"controller\":" + ctrl + ",\"machine\":" + mach + ",\"job\":" + job + ",\"jog\":" + jog + ",\"control\":" + cntrl + "}";
  return json;
}

String makeClientEnvelopeWithRevision(uint8_t client, const char *type, const String &bodyFieldKey, const String &bodyJson, uint32_t revision) {
  if (client >= WEBSOCKETS_SERVER_CLIENT_MAX) return "";
  TelemetryClientState &cs = protocolState.clients[client];
  uint32_t seq = cs.nextServerSeq++;
  uint32_t ack = cs.lastContiguousClientSeq;
  cs.lastOutboundAtMs = millis();
  return makeProtocolEnvelope(type, seq, ack, revision, bodyFieldKey, bodyJson);
}

// INVARIANT (Commit-After-Stage):
// Cached business slice states are updated ONLY AFTER staged state is successfully
// acquired and written under telemetryStateMutex. If mutex acquisition fails with 0 wait time,
// cachedSlices remains untouched, allowing the next main-loop iteration to retry staging.

void stageTelemetryUpdates() {
  if (!isTelemetryStarted() || telemetryStateMutex == nullptr) return;

  bool diffMachine = false;
  bool diffController = false;
  bool diffJob = false;
  bool diffJog = false;
  bool diffControl = false;

  if (fabs(marlinPosition.x - cachedSlices.positionX) > 0.0005f ||
      fabs(marlinPosition.y - cachedSlices.positionY) > 0.0005f ||
      fabs(marlinPosition.z - cachedSlices.positionZ) > 0.0005f ||
      fabs(machineFrame.machineX - cachedSlices.machineX) > 0.0005f ||
      fabs(machineFrame.machineY - cachedSlices.machineY) > 0.0005f ||
      fabs(machineFrame.machineZ - cachedSlices.machineZ) > 0.0005f ||
      machineFrame.homedX != cachedSlices.homedX ||
      machineFrame.homedY != cachedSlices.homedY ||
      machineFrame.homedZ != cachedSlices.homedZ ||
      machineFrame.homingEpoch != cachedSlices.homingEpoch) {
    diffMachine = true;
  }

  String currCtrlState = controllerStateNormalized();
  if (currCtrlState != cachedSlices.controllerState || jobStatus.lastError != cachedSlices.controllerError) {
    diffController = true;
  }

  String currJobState = jobStateName(jobStatus.state);
  if (currJobState != cachedSlices.jobState ||
      jobStatus.currentLineNumber != cachedSlices.jobLine ||
      jobStatus.feedOverridePercent != cachedSlices.feedOverride ||
      jobStatus.lastError != cachedSlices.jobError) {
    diffJob = true;
  }

  String currJogState = jogStateName(jogStatus.state);
  if (currJogState != cachedSlices.jogState || jogStatus.lastError != cachedSlices.jogError) {
    diffJog = true;
  }

  if (operatorSessionOwner != cachedSlices.controlOwner) {
    diffControl = true;
  }

  if (!diffMachine && !diffController && !diffJob && !diffJog && !diffControl) {
    return;
  }

  String sysBaseStr = buildSystemBaseJson();
  String machineStr = diffMachine ? buildMachineSliceJson() : "";
  String controllerStr = diffController ? buildControllerSliceJson() : "";
  String jobStr = diffJob ? jobStatusJson() : "";
  String jogStr = diffJog ? jogStatusJson() : "";
  String controlStr = diffControl ? buildControlSliceJson() : "";

  if (xSemaphoreTake(telemetryStateMutex, 0) != pdTRUE) {
    return; // Lock busy! Retries on next loop iteration without losing state.
  }

  stagedState.systemBaseJson = sysBaseStr;

  if (diffMachine) {
    stagedState.machineJson = machineStr;
    stagedState.dirtyMachine = true;
  }
  if (diffController) {
    stagedState.controllerJson = controllerStr;
    stagedState.dirtyController = true;
  }
  if (diffJob) {
    stagedState.jobJson = jobStr;
    stagedState.dirtyJob = true;
  }
  if (diffJog) {
    stagedState.jogJson = jogStr;
    stagedState.dirtyJog = true;
  }
  if (diffControl) {
    stagedState.controlJson = controlStr;
    stagedState.dirtyControl = true;
  }

  stagedState.globalRevision++;

  xSemaphoreGive(telemetryStateMutex);

  // Commit to cachedSlices ONLY AFTER successfully updating stagedState under mutex:
  if (diffMachine) {
    cachedSlices.positionX = marlinPosition.x;
    cachedSlices.positionY = marlinPosition.y;
    cachedSlices.positionZ = marlinPosition.z;
    cachedSlices.machineX = machineFrame.machineX;
    cachedSlices.machineY = machineFrame.machineY;
    cachedSlices.machineZ = machineFrame.machineZ;
    cachedSlices.homedX = machineFrame.homedX;
    cachedSlices.homedY = machineFrame.homedY;
    cachedSlices.homedZ = machineFrame.homedZ;
    cachedSlices.homingEpoch = machineFrame.homingEpoch;
  }
  if (diffController) {
    cachedSlices.controllerState = currCtrlState;
    cachedSlices.controllerError = jobStatus.lastError;
  }
  if (diffJob) {
    cachedSlices.jobState = currJobState;
    cachedSlices.jobLine = jobStatus.currentLineNumber;
    cachedSlices.feedOverride = jobStatus.feedOverridePercent;
    cachedSlices.jobError = jobStatus.lastError;
  }
  if (diffJog) {
    cachedSlices.jogState = currJogState;
    cachedSlices.jogError = jogStatus.lastError;
  }
  if (diffControl) {
    cachedSlices.controlOwner = operatorSessionOwner;
  }
}
void handleTelemetrySocket(uint8_t client, WStype_t type, uint8_t *payload, size_t length) {
  if (client >= WEBSOCKETS_SERVER_CLIENT_MAX) return;
  TelemetryClientState &cs = protocolState.clients[client];

  if (type == WStype_CONNECTED) {
    cs.connected = true;
    cs.handshakeComplete = false;
    cs.snapshotPending = false;
    cs.resyncPending = false;
    cs.nextServerSeq = 1;
    cs.lastContiguousClientSeq = 0;
    cs.lastServerSeqAcknowledgedByClient = 0;
    cs.lastOutboundAtMs = millis();
    telemetryLogSubscribed[client] = false;
    telemetryClientConnected[client] = true;
  } else if (type == WStype_DISCONNECTED) {
    cs.connected = false;
    cs.handshakeComplete = false;
    cs.snapshotPending = false;
    cs.resyncPending = false;
    telemetryLogSubscribed[client] = false;
    telemetryClientConnected[client] = false;
  } else if (type == WStype_TEXT) {
    String message;
    message.reserve(length);
    for (size_t i = 0; i < length; ++i) message += static_cast<char>(payload[i]);

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, message);
    if (err) return;

    int versionVal = doc["protocolVersion"] | 1;
    String msgType = doc["type"] | "";
    uint32_t seqVal = doc["seq"] | 0;
    uint32_t ackVal = doc["ack"] | 0;

    if (ackVal > 0 && ackVal <= cs.nextServerSeq) {
      cs.lastServerSeqAcknowledgedByClient = ackVal;
    }

    if (versionVal != 1) {
      String errPacket = makeClientEnvelope(client, "protocol-error", "error", "\"unsupported protocol version\"");
      telemetrySocket.sendTXT(client, errPacket);
      return;
    }

    if (seqVal > 0) {
      if (seqVal == cs.lastContiguousClientSeq + 1) {
        cs.lastContiguousClientSeq = seqVal;
      } else if (seqVal <= cs.lastContiguousClientSeq) {
        return;
      } else {
        String errPacket = makeClientEnvelope(client, "protocol-error", "error", "\"sequence gap detected\"");
        telemetrySocket.sendTXT(client, errPacket);
        return;
      }
    }

    if (msgType == "hello") {
      if (seqVal != 1) {
        String errPacket = makeClientEnvelope(client, "protocol-error", "error", "\"hello must have seq 1\"");
        telemetrySocket.sendTXT(client, errPacket);
        return;
      }

      uint64_t utcMs = doc["utcMs"] | 0ULL;
      int tzOffset = doc["timezoneOffsetMinutes"] | 0;
      String timeZoneStr = doc["timeZone"] | "";

      if (utcMs > 1000000000000ULL && telemetryStateMutex != nullptr) {
        int64_t newOffset = static_cast<int64_t>(utcMs) - static_cast<int64_t>(millis());
        if (xSemaphoreTake(telemetryStateMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
          if (!stagedState.wallClock.valid || llabs(newOffset - stagedState.wallClock.offsetMs) < 60000LL) {
            stagedState.wallClock.valid = true;
            stagedState.wallClock.offsetMs = newOffset;
            stagedState.wallClock.timezoneOffsetMinutes = tzOffset;
            snprintf(stagedState.wallClock.timeZone, sizeof(stagedState.wallClock.timeZone), "%s", timeZoneStr.c_str());
            stagedState.wallClock.syncUptimeMs = millis();
            snprintf(stagedState.wallClock.source, sizeof(stagedState.wallClock.source), "browser");

            stagedState.dirtySystem = true;
            stagedState.globalRevision++;
          }
          xSemaphoreGive(telemetryStateMutex);
        }
      }

      uint32_t snapshotRev = 0;
      String snapshotData = buildSnapshotFromStagedState(snapshotRev);
      if (snapshotData.length() > 0) {
        String snapshot = makeClientEnvelopeWithRevision(client, "snapshot", "state", snapshotData, snapshotRev);
        bool sentOK = telemetrySocket.sendTXT(client, snapshot);
        if (sentOK) {
          cs.handshakeComplete = true;
          cs.snapshotPending = false;
        } else {
          cs.handshakeComplete = false;
          cs.snapshotPending = true;
        }
      } else {
        cs.handshakeComplete = false;
        cs.snapshotPending = true;
      }
    } else if (!cs.handshakeComplete) {
      String errPacket = makeClientEnvelope(client, "protocol-error", "error", "\"handshake incomplete; send hello first\"");
      telemetrySocket.sendTXT(client, errPacket);
    } else if (msgType == "resync") {
      uint32_t snapshotRev = 0;
      String snapshotData = buildSnapshotFromStagedState(snapshotRev);
      if (snapshotData.length() > 0) {
        String snapshot = makeClientEnvelopeWithRevision(client, "snapshot", "state", snapshotData, snapshotRev);
        bool sentOK = telemetrySocket.sendTXT(client, snapshot);
        if (sentOK) {
          cs.resyncPending = false;
        } else {
          cs.resyncPending = true;
        }
      } else {
        cs.resyncPending = true;
      }
    } else if (msgType == "log") {
      telemetryLogSubscribed[client] = doc["log"] == true || doc["subscribe"]["log"] == true;
    }
  }
}

bool telemetryHasLogSubscriber() {
  if (!isTelemetryStarted()) return false;
  for (uint8_t client = 0; client < WEBSOCKETS_SERVER_CLIENT_MAX; ++client) {
    if (telemetryLogSubscribed[client]) return true;
  }
  return false;
}

void checkClientIdleSync(uint32_t now) {
  for (uint8_t i = 0; i < WEBSOCKETS_SERVER_CLIENT_MAX; ++i) {
    TelemetryClientState &cs = protocolState.clients[i];
    if (cs.connected && cs.handshakeComplete) {
      if (now - cs.lastOutboundAtMs >= 3000) {
        String syncPacket = makeClientEnvelope(i, "sync", "", "");
        telemetrySocket.sendTXT(i, syncPacket);
      }
    }
  }
}

void processNetworkTelemetry() {
  const uint32_t now = millis();
  if (now - telemetryLastBroadcastMs < kTelemetryMinBroadcastMs) {
    return;
  }
  telemetryLastBroadcastMs = now;

  for (uint8_t i = 0; i < WEBSOCKETS_SERVER_CLIENT_MAX; ++i) {
    TelemetryClientState &cs = protocolState.clients[i];
    if (cs.connected && (cs.snapshotPending || cs.resyncPending)) {
      uint32_t snapshotRev = 0;
      String snapshotData = buildSnapshotFromStagedState(snapshotRev);
      if (snapshotData.length() > 0) {
        String snapshot = makeClientEnvelopeWithRevision(i, "snapshot", "state", snapshotData, snapshotRev);
        bool sentOK = telemetrySocket.sendTXT(i, snapshot);
        if (sentOK) {
          if (cs.snapshotPending) {
            cs.handshakeComplete = true;
            cs.snapshotPending = false;
          }
          cs.resyncPending = false;
        }
      }
    }
  }

  StagedTelemetryState snapshotCopy;
  bool hasPatch = false;

  if (telemetryStateMutex != nullptr && xSemaphoreTake(telemetryStateMutex, pdMS_TO_TICKS(5)) == pdTRUE) {
    if (stagedState.dirtySystem || stagedState.dirtyController || stagedState.dirtyMachine ||
        stagedState.dirtyJob || stagedState.dirtyJog || stagedState.dirtyControl) {
      snapshotCopy = stagedState;
      stagedState.dirtySystem = false;
      stagedState.dirtyController = false;
      stagedState.dirtyMachine = false;
      stagedState.dirtyJob = false;
      stagedState.dirtyJog = false;
      stagedState.dirtyControl = false;
      hasPatch = true;
    }
    xSemaphoreGive(telemetryStateMutex);
  }

  if (hasPatch) {
    String patchJson = "{";
    bool first = true;
    if (snapshotCopy.dirtySystem) {
      String sysJson = buildSystemSliceJsonFromBaseAndClock(snapshotCopy.systemBaseJson, snapshotCopy.wallClock);
      patchJson += "\"system\":" + sysJson;
      first = false;
    }
    if (snapshotCopy.dirtyController) {
      if (!first) patchJson += ",";
      patchJson += "\"controller\":" + snapshotCopy.controllerJson;
      first = false;
    }
    if (snapshotCopy.dirtyMachine) {
      if (!first) patchJson += ",";
      patchJson += "\"machine\":" + snapshotCopy.machineJson;
      first = false;
    }
    if (snapshotCopy.dirtyJob) {
      if (!first) patchJson += ",";
      patchJson += "\"job\":" + snapshotCopy.jobJson;
      first = false;
    }
    if (snapshotCopy.dirtyJog) {
      if (!first) patchJson += ",";
      patchJson += "\"jog\":" + snapshotCopy.jogJson;
      first = false;
    }
    if (snapshotCopy.dirtyControl) {
      if (!first) patchJson += ",";
      patchJson += "\"control\":" + snapshotCopy.controlJson;
      first = false;
    }
    patchJson += "}";

    for (uint8_t i = 0; i < WEBSOCKETS_SERVER_CLIENT_MAX; ++i) {
      TelemetryClientState &cs = protocolState.clients[i];
      if (cs.connected && cs.handshakeComplete) {
        String patchPacket = makeClientEnvelopeWithRevision(i, "patch", "patch", patchJson, snapshotCopy.globalRevision);
        telemetrySocket.sendTXT(i, patchPacket);
      }
    }
  }

  if (motionEventQueue != nullptr && uxQueueMessagesWaiting(motionEventQueue) > 0) {
    MotionTelemetryEvent events[16];
    size_t count = 0;
    MotionTelemetryEvent ev;
    while (count < 16 && xQueueReceive(motionEventQueue, &ev, 0) == pdTRUE) {
      events[count++] = ev;
    }
    if (count > 0) {
      uint32_t dropped = fetchAndResetMotionTelemetryDropped();
      String data = "{\"events\":[";
      for (size_t i = 0; i < count; ++i) {
        if (i > 0) data += ',';
        data += "{\"sequence\":" + String(events[i].sequence);
        data += ",\"sentAtMs\":" + String(events[i].sentAtMs);
        data += ",\"command\":\"" + jsonEscape(events[i].command) + "\"}";
      }
      data += "],\"dropped\":" + String(dropped);
      data += ",\"feedOverridePercent\":" + String(events[count - 1].feedOverridePercent) + "}";

      uint32_t activeRev = snapshotCopy.globalRevision > 0 ? snapshotCopy.globalRevision : getStagedStateRevision();
      for (uint8_t c = 0; c < WEBSOCKETS_SERVER_CLIENT_MAX; ++c) {
        TelemetryClientState &cs = protocolState.clients[c];
        if (cs.connected && cs.handshakeComplete) {
          String motionPacket = makeClientEnvelopeWithRevision(c, "patch", "patch", "{\"motion\":" + data + "}", activeRev);
          telemetrySocket.sendTXT(c, motionPacket);
        }
      }
    }
  }

  if (logEventQueue != nullptr && uxQueueMessagesWaiting(logEventQueue) > 0 && telemetryHasLogSubscriber()) {
    LogTelemetryEvent events[32];
    size_t count = 0;
    LogTelemetryEvent lev;
    while (count < 32 && xQueueReceive(logEventQueue, &lev, 0) == pdTRUE) {
      events[count++] = lev;
    }
    if (count > 0) {
      uint32_t droppedLogs = fetchAndResetLogTelemetryDropped();
      for (size_t k = 0; k < count; ++k) {
        const LogTelemetryEvent &logEv = events[k];
        String data = "{\"entries\":[{\"id\":";
        data += String(logEv.id);
        data += ",\"time\":\"";
        data += String(logEv.timeMs);
        data += "\",\"direction\":\"";
        data += jsonEscape(logEv.direction);
        data += "\",\"priority\":";
        data += logEv.priority ? "true" : "false";
        data += ",\"text\":\"";
        data += jsonEscape(logEv.text);
        data += "\",\"level\":\"";
        data += jsonEscape(logEv.level);
        data += "\"}],\"nextId\":";
        data += String(logEv.id);
        data += ",\"lastCritical\":";
        data += logEv.lastCriticalMessage[0] != '\0' ? "\"" + jsonEscape(logEv.lastCriticalMessage) + "\"" : "null";
        data += ",\"dropped\":" + String(droppedLogs);
        data += "}";

        uint32_t activeRev = snapshotCopy.globalRevision > 0 ? snapshotCopy.globalRevision : getStagedStateRevision();
        for (uint8_t c = 0; c < WEBSOCKETS_SERVER_CLIENT_MAX; ++c) {
          TelemetryClientState &cs = protocolState.clients[c];
          if (telemetryLogSubscribed[c] && cs.connected && cs.handshakeComplete) {
            String logPacket = makeClientEnvelopeWithRevision(c, "patch", "patch", "{\"log\":" + data + "}", activeRev);
            telemetrySocket.sendTXT(c, logPacket);
          }
        }
      }
    }
  }

  checkClientIdleSync(now);
}

void telemetryNetworkTask(void *arg) {
  (void)arg;
  telemetrySocket.begin();
  telemetrySocket.onEvent(handleTelemetrySocket);
  setTelemetryStarted(true);

  for (;;) {
    telemetrySocket.loop();
    processNetworkTelemetry();
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void rotateSystemLogIfNeeded() {
  if (!sdMounted || !SD_MMC.exists(kSdSystemLogPath)) return;
  File current = SD_MMC.open(kSdSystemLogPath, FILE_READ);
  if (!current) return;
  const size_t size = current.size();
  current.close();
  if (size < kMaxSystemLogBytes) return;

  SD_MMC.remove(kSdSystemLogPreviousPath);
  SD_MMC.rename(kSdSystemLogPath, kSdSystemLogPreviousPath);
}

void logSystemEvent(const String &message) {
  // UART0 is reserved for Marlin, so boot/network diagnostics are persisted to SD instead.
  if (!sdMounted) return;
  rotateSystemLogIfNeeded();
  File logFile = SD_MMC.open(kSdSystemLogPath, FILE_APPEND);
  if (!logFile) return;
  logFile.print(millis());
  logFile.print(" ");
  logFile.print(bootSessionId);
  logFile.print(" ");
  logFile.println(message);
  logFile.close();
}

const char *httpMethodName(HTTPMethod method) {
  switch (method) {
  case HTTP_GET: return "GET";
  case HTTP_HEAD: return "HEAD";
  case HTTP_POST: return "POST";
  case HTTP_PUT: return "PUT";
  case HTTP_PATCH: return "PATCH";
  case HTTP_DELETE: return "DELETE";
  case HTTP_OPTIONS: return "OPTIONS";
  default: return "OTHER";
  }
}

void logHttpRequest() {
  const String signature = String(httpMethodName(server.method())) + " " + server.uri();
  const uint32_t now = millis();
  if (signature == lastLoggedHttpRequest && now - lastLoggedHttpRequestAtMs < kRepeatedHttpLogIntervalMs) {
    return;
  }
  lastLoggedHttpRequest = signature;
  lastLoggedHttpRequestAtMs = now;
  logSystemEvent("HTTP " + signature + " from=" + server.client().remoteIP().toString());
}

void httpRoute(const char *uri, HTTPMethod method, WebServer::THandlerFunction handler) {
  server.on(uri, method, [handler]() {
    logHttpRequest();
    handler();
  });
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

  if (!systemLogMountRecorded) {
    systemLogMountRecorded = true;
    logSystemEvent("SD mounted type=" + sdCardTypeName() + " totalBytes=" + String(SD_MMC.totalBytes()) +
                   " usedBytes=" + String(SD_MMC.usedBytes()));
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
                                    (machineProfile.capMotionModes ? 32 : 0) |
                                    (machineProfile.capRealtimeReporting ? 64 : 0));
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
  machineProfile.capRealtimeReporting = caps & 64;
}

String toolChangeSettingsJson() {
  String json = "{\"handling\":\"" + jsonEscape(toolChangeSettings.handling) + "\"";
  json += ",\"parkMachineX\":" + String(toolChangeSettings.parkMachineX, 3);
  json += ",\"parkMachineY\":" + String(toolChangeSettings.parkMachineY, 3);
  json += ",\"parkMachineZ\":" + String(toolChangeSettings.parkMachineZ, 3);
  json += ",\"zZeroMethod\":\"" + jsonEscape(toolChangeSettings.zZeroMethod) + "\"";
  json += ",\"touchPlateEnabled\":";
  json += toolChangeSettings.touchPlateEnabled ? "true" : "false";
  json += ",\"touchPlateThickness\":" + String(toolChangeSettings.touchPlateThickness, 3);
  json += ",\"touchPlateProbeDistance\":" + String(toolChangeSettings.touchPlateProbeDistance, 3);
  json += ",\"touchPlateProbeFeed\":" + String(toolChangeSettings.touchPlateProbeFeed, 1);
  json += ",\"touchPlateRetractDistance\":" + String(toolChangeSettings.touchPlateRetractDistance, 3);
  json += "}";
  return json;
}

void saveToolChangeSettings() {
  toolChangePrefs.begin(kToolChangePrefsNamespace, false);
  toolChangePrefs.putString("handling", toolChangeSettings.handling);
  toolChangePrefs.putFloat("parkX", toolChangeSettings.parkMachineX);
  toolChangePrefs.putFloat("parkY", toolChangeSettings.parkMachineY);
  toolChangePrefs.putFloat("parkZ", toolChangeSettings.parkMachineZ);
  toolChangePrefs.putString("zMethod", toolChangeSettings.zZeroMethod);
  toolChangePrefs.putBool("tpEnabled", toolChangeSettings.touchPlateEnabled);
  toolChangePrefs.putFloat("tpThick", toolChangeSettings.touchPlateThickness);
  toolChangePrefs.putFloat("tpDist", toolChangeSettings.touchPlateProbeDistance);
  toolChangePrefs.putFloat("tpFeed", toolChangeSettings.touchPlateProbeFeed);
  toolChangePrefs.putFloat("tpRetract", toolChangeSettings.touchPlateRetractDistance);
  toolChangePrefs.end();
}

void loadToolChangeSettings() {
  toolChangePrefs.begin(kToolChangePrefsNamespace, true);
  toolChangeSettings.handling = toolChangePrefs.getString("handling", "pause");
  toolChangeSettings.parkMachineX = toolChangePrefs.getFloat("parkX", 0.0f);
  toolChangeSettings.parkMachineY = toolChangePrefs.getFloat("parkY", 0.0f);
  toolChangeSettings.parkMachineZ = toolChangePrefs.getFloat("parkZ", kMachineZMaxMm);
  toolChangeSettings.zZeroMethod = toolChangePrefs.getString("zMethod", "manual");
  toolChangeSettings.touchPlateEnabled = toolChangePrefs.getBool("tpEnabled", false);
  toolChangeSettings.touchPlateThickness = toolChangePrefs.getFloat("tpThick", 15.0f);
  toolChangeSettings.touchPlateProbeDistance = toolChangePrefs.getFloat("tpDist", 30.0f);
  toolChangeSettings.touchPlateProbeFeed = toolChangePrefs.getFloat("tpFeed", 100.0f);
  toolChangeSettings.touchPlateRetractDistance = toolChangePrefs.getFloat("tpRetract", 3.0f);
  toolChangePrefs.end();
  if (toolChangeSettings.handling != "park") toolChangeSettings.handling = "pause";
  if (toolChangeSettings.zZeroMethod != "touchplate" || !toolChangeSettings.touchPlateEnabled) {
    toolChangeSettings.zZeroMethod = "manual";
  }
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
  machineProfile.capRealtimeReporting =
      machineProfile.capEmergencyParser &&
      (responseCapability(response, "REALTIME_REPORTING") ||
       responseCapability(response, "REALTIME_REPORTING_COMMANDS") ||
       response.indexOf("REALTIME_REPORTING_COMMANDS:1") >= 0);

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
  logSystemEvent("Marlin EMERGENCY_PARSER detected=" +
                 String(machineProfile.capEmergencyParser ? "true" : "false"));
  logSystemEvent("Marlin realtime hold detected=" +
                 String(machineProfile.capRealtimeReporting ? "true" : "false"));
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
  json += ",\"motionModes\":" + String(machineProfile.capMotionModes ? "true" : "false");
  json += ",\"realtimeHold\":" + String(machineProfile.capRealtimeReporting ? "true" : "false") + "}";
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

void safeWorkZRange(float &minimum, float &maximum, bool &mappedToMachine) {
  mappedToMachine = machineFrame.absoluteFromHome && machineFrame.workZeroValid;
  if (mappedToMachine) {
    minimum = machineZMin() - machineFrame.workZeroMachineZ;
    maximum = machineZMax() - machineFrame.workZeroMachineZ;
    return;
  }
  minimum = machineProfile.available ? machineProfile.workZMin : machineZMin();
  maximum = machineProfile.available ? machineProfile.workZMax : machineZMax();
}

bool validateSafeWorkZ(float safeWorkZ, bool requireLift, String &error) {
  float minimum = 0.0f;
  float maximum = 0.0f;
  bool mappedToMachine = false;
  safeWorkZRange(minimum, maximum, mappedToMachine);
  if (!isfinite(safeWorkZ) || safeWorkZ < minimum - 0.001f || safeWorkZ > maximum + 0.001f) {
    error = "Safe Z " + String(safeWorkZ, 3) + " is outside the active work-frame range " +
            String(minimum, 3) + ".." + String(maximum, 3) + " mm";
    return false;
  }
  if (requireLift && marlinPosition.valid && safeWorkZ < marlinPosition.z - 0.01f) {
    error = "Safe Z would move downward from current work Z " + String(marlinPosition.z, 3) + " mm";
    return false;
  }
  if (mappedToMachine) {
    const float targetMachineZ = machineFrame.workZeroMachineZ + safeWorkZ;
    if (targetMachineZ < machineZMin() - 0.001f || targetMachineZ > machineZMax() + 0.001f) {
      error = "Safe Z maps outside the machine Z limits";
      return false;
    }
  }
  return true;
}

bool toolChangeParkIsWithinMachine(String &error) {
  if (!isfinite(toolChangeSettings.parkMachineX) || !isfinite(toolChangeSettings.parkMachineY) ||
      !isfinite(toolChangeSettings.parkMachineZ) ||
      toolChangeSettings.parkMachineX < machineXMin() || toolChangeSettings.parkMachineX > machineXMax() ||
      toolChangeSettings.parkMachineY < machineYMin() || toolChangeSettings.parkMachineY > machineYMax() ||
      toolChangeSettings.parkMachineZ < machineZMin() || toolChangeSettings.parkMachineZ > machineZMax()) {
    error = "configured tool-change park position is outside the current machine limits";
    return false;
  }
  return true;
}

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

uint32_t marlinAckTimeoutForCommand(const String &command, bool toolChangeSequence = false) {
  String upper = command;
  upper.toUpperCase();
  upper.trim();
  const int separator = upper.indexOf(' ');
  const String code = separator >= 0 ? upper.substring(0, separator) : upper;
  if (code == "M400") {
    return toolChangeSequence ? kMarlinToolChangeAckTimeoutMs : kMarlinMotionDrainAckTimeoutMs;
  }
  if (code == "G28" || code == "G29" || code.startsWith("G38.")) {
    return kMarlinHomingAckTimeoutMs;
  }
  return kMarlinCommandAckTimeoutMs;
}

void resetMotionTimingState() {
  motionTimingState = MotionTimingState();
  marlinPlannerWaitAllowanceMs = 0;
  if (marlinPosition.valid) {
    motionTimingState.xValid = true;
    motionTimingState.yValid = true;
    motionTimingState.zValid = true;
    motionTimingState.x = marlinPosition.x;
    motionTimingState.y = marlinPosition.y;
    motionTimingState.z = marlinPosition.z;
  }
}

void syncMotionTimingPosition(float x, float y, float z) {
  motionTimingState.xValid = true;
  motionTimingState.yValid = true;
  motionTimingState.zValid = true;
  motionTimingState.x = x;
  motionTimingState.y = y;
  motionTimingState.z = z;
}

bool commandHasToken(const String &upper, const String &wanted) {
  int start = 0;
  while (start < upper.length()) {
    while (start < upper.length() && upper[start] == ' ') ++start;
    int end = upper.indexOf(' ', start);
    if (end < 0) end = upper.length();
    if (upper.substring(start, end) == wanted) return true;
    start = end + 1;
  }
  return false;
}

float normalizedArcSweep(float startAngle, float endAngle, bool clockwise, bool fullCircle) {
  if (fullCircle) return 2.0f * kPi;
  float sweep = clockwise ? startAngle - endAngle : endAngle - startAngle;
  while (sweep < 0.0f) sweep += 2.0f * kPi;
  while (sweep >= 2.0f * kPi) sweep -= 2.0f * kPi;
  return sweep;
}

float estimatedArcDistance(float startA, float startB, float endA, float endB,
                           float centerOffsetA, float centerOffsetB, bool hasCenterA,
                           bool hasCenterB, float radiusWord, bool hasRadius,
                           bool clockwise, float linearDelta) {
  const float chord = hypotf(endA - startA, endB - startB);
  float planarDistance = 0.0f;
  if (hasRadius && fabsf(radiusWord) > 0.0001f) {
    const float radius = fabsf(radiusWord);
    const float ratio = min(1.0f, chord / (2.0f * radius));
    float sweep = 2.0f * asinf(ratio);
    if (radiusWord < 0.0f) sweep = 2.0f * kPi - sweep;
    planarDistance = radius * sweep;
  } else if (hasCenterA || hasCenterB) {
    const float centerA = startA + (hasCenterA ? centerOffsetA : 0.0f);
    const float centerB = startB + (hasCenterB ? centerOffsetB : 0.0f);
    const float radius = hypotf(startA - centerA, startB - centerB);
    const bool fullCircle = chord < 0.0001f;
    const float sweep = normalizedArcSweep(atan2f(startB - centerB, startA - centerA),
                                           atan2f(endB - centerB, endA - centerA),
                                           clockwise, fullCircle);
    planarDistance = radius * sweep;
  } else {
    planarDistance = chord;
  }
  return hypotf(planarDistance, linearDelta);
}

MotionTimingEstimate estimateAndApplyMotionTiming(const String &command) {
  MotionTimingEstimate estimate;
  String upper = command;
  upper.toUpperCase();
  upper.trim();

  if (commandHasToken(upper, "G20")) motionTimingState.unitScale = 25.4f;
  if (commandHasToken(upper, "G21")) motionTimingState.unitScale = 1.0f;
  if (commandHasToken(upper, "G90")) motionTimingState.absolute = true;
  if (commandHasToken(upper, "G91")) motionTimingState.absolute = false;
  if (commandHasToken(upper, "G17")) motionTimingState.plane = "G17";
  if (commandHasToken(upper, "G18")) motionTimingState.plane = "G18";
  if (commandHasToken(upper, "G19")) motionTimingState.plane = "G19";
  if (commandHasToken(upper, "G0") || commandHasToken(upper, "G00")) motionTimingState.motionMode = "G0";
  if (commandHasToken(upper, "G1") || commandHasToken(upper, "G01")) motionTimingState.motionMode = "G1";
  if (commandHasToken(upper, "G2") || commandHasToken(upper, "G02")) motionTimingState.motionMode = "G2";
  if (commandHasToken(upper, "G3") || commandHasToken(upper, "G03")) motionTimingState.motionMode = "G3";

  float feedWord = 0.0f;
  if (extractGcodeWordValue(upper, 'F', feedWord) && feedWord > 0.0f) {
    motionTimingState.feedMmMin = feedWord * motionTimingState.unitScale;
  }

  if (commandHasToken(upper, "G28")) {
    motionTimingState.xValid = false;
    motionTimingState.yValid = false;
    motionTimingState.zValid = false;
    return estimate;
  }

  float xWord = 0.0f;
  float yWord = 0.0f;
  float zWord = 0.0f;
  float i = 0.0f, j = 0.0f, k = 0.0f, r = 0.0f;
  const bool hasX = extractGcodeWordValue(upper, 'X', xWord);
  const bool hasY = extractGcodeWordValue(upper, 'Y', yWord);
  const bool hasZ = extractGcodeWordValue(upper, 'Z', zWord);
  const bool hasI = extractGcodeWordValue(upper, 'I', i);
  const bool hasJ = extractGcodeWordValue(upper, 'J', j);
  const bool hasK = extractGcodeWordValue(upper, 'K', k);
  const bool hasR = extractGcodeWordValue(upper, 'R', r);
  const bool arcMode = motionTimingState.motionMode == "G2" || motionTimingState.motionMode == "G3";
  if (!hasX && !hasY && !hasZ && !(arcMode && (hasI || hasJ || hasK || hasR))) return estimate;
  estimate.motion = motionTimingState.motionMode == "G0" || motionTimingState.motionMode == "G1" ||
                    motionTimingState.motionMode == "G2" || motionTimingState.motionMode == "G3";
  if (!estimate.motion) return estimate;

  const float scale = motionTimingState.unitScale;
  const float startX = motionTimingState.x;
  const float startY = motionTimingState.y;
  const float startZ = motionTimingState.z;
  const bool startXValid = motionTimingState.xValid;
  const bool startYValid = motionTimingState.yValid;
  const bool startZValid = motionTimingState.zValid;
  auto target = [&](float start, bool valid, float word, bool present, bool &targetValid) {
    if (!present) {
      targetValid = valid;
      return start;
    }
    if (motionTimingState.absolute) {
      targetValid = true;
      return word * scale;
    }
    targetValid = valid;
    return valid ? start + word * scale : 0.0f;
  };
  bool targetXValid = false;
  bool targetYValid = false;
  bool targetZValid = false;
  const float endX = target(startX, startXValid, xWord, hasX, targetXValid);
  const float endY = target(startY, startYValid, yWord, hasY, targetYValid);
  const float endZ = target(startZ, startZValid, zWord, hasZ, targetZValid);

  bool neededStartsValid = (!hasX || startXValid) && (!hasY || startYValid) && (!hasZ || startZValid);
  if (arcMode && motionTimingState.plane == "G18") neededStartsValid = neededStartsValid && startXValid && startZValid;
  if (arcMode && motionTimingState.plane == "G19") neededStartsValid = neededStartsValid && startYValid && startZValid;
  if (arcMode && motionTimingState.plane == "G17") neededStartsValid = neededStartsValid && startXValid && startYValid;
  const bool machineCoordinateMove = commandHasToken(upper, "G53");
  if (neededStartsValid && !machineCoordinateMove) {
    const float dx = hasX ? endX - startX : 0.0f;
    const float dy = hasY ? endY - startY : 0.0f;
    const float dz = hasZ ? endZ - startZ : 0.0f;
    if (motionTimingState.motionMode == "G2" || motionTimingState.motionMode == "G3") {
      i *= scale; j *= scale; k *= scale; r *= scale;
      const bool clockwise = motionTimingState.motionMode == "G2";
      if (motionTimingState.plane == "G18") {
        estimate.distanceMm = estimatedArcDistance(startX, startZ, endX, endZ, i, k, hasI, hasK,
                                                   r, hasR, clockwise, dy);
      } else if (motionTimingState.plane == "G19") {
        estimate.distanceMm = estimatedArcDistance(startY, startZ, endY, endZ, j, k, hasJ, hasK,
                                                   r, hasR, clockwise, dx);
      } else {
        estimate.distanceMm = estimatedArcDistance(startX, startY, endX, endY, i, j, hasI, hasJ,
                                                   r, hasR, clockwise, dz);
      }
    } else {
      estimate.distanceMm = sqrtf(dx * dx + dy * dy + dz * dz);
    }
    const float overrideScale = max(0.1f, static_cast<float>(jobStatus.feedOverridePercent) / 100.0f);
    estimate.effectiveFeedMmMin = motionTimingState.feedMmMin * overrideScale;
    if (estimate.effectiveFeedMmMin > 0.0f && isfinite(estimate.distanceMm)) {
      const double duration = static_cast<double>(estimate.distanceMm) * 60000.0 /
                              static_cast<double>(estimate.effectiveFeedMmMin);
      estimate.durationMs = static_cast<uint32_t>(min(duration, static_cast<double>(UINT32_MAX)));
      estimate.durationKnown = true;
    }
  }

  if (hasX) { motionTimingState.x = endX; motionTimingState.xValid = targetXValid; }
  if (hasY) { motionTimingState.y = endY; motionTimingState.yValid = targetYValid; }
  if (hasZ) { motionTimingState.z = endZ; motionTimingState.zValid = targetZValid; }
  if (machineCoordinateMove) {
    motionTimingState.xValid = false;
    motionTimingState.yValid = false;
    motionTimingState.zValid = false;
  }
  return estimate;
}

uint32_t marlinHardAckTimeoutForCommand(const String &command, const MotionTimingEstimate &estimate,
                                        bool toolChangeSequence = false,
                                        uint32_t plannerWaitAllowanceMs = 0) {
  const uint32_t specialTimeout = marlinAckTimeoutForCommand(command, toolChangeSequence);
  if (specialTimeout != kMarlinCommandAckTimeoutMs) {
    return min(kMarlinMaxMotionHardAckTimeoutMs, specialTimeout * 2U);
  }
  if (!estimate.motion) return kMarlinDefaultHardAckTimeoutMs;
  if (!estimate.durationKnown) return kMarlinUnknownMotionHardAckTimeoutMs;
  const double calculated = static_cast<double>(plannerWaitAllowanceMs) +
                            static_cast<double>(estimate.durationMs) * kMotionAckDurationMultiplier +
                            static_cast<double>(kMotionAckOverheadMs);
  return static_cast<uint32_t>(max(static_cast<double>(kMarlinDefaultHardAckTimeoutMs),
                                   min(calculated, static_cast<double>(kMarlinMaxMotionHardAckTimeoutMs))));
}

void noteAcknowledgedPlannerTiming(const String &command, uint32_t estimatedDurationMs) {
  String upper = command;
  upper.toUpperCase();
  upper.trim();
  if (commandHasToken(upper, "M400")) {
    marlinPlannerWaitAllowanceMs = 0;
    return;
  }
  if (estimatedDurationMs > 0) {
    marlinPlannerWaitAllowanceMs = min(estimatedDurationMs, kMarlinMaxMotionHardAckTimeoutMs);
  }
}

bool marlinAckWatchdogExpired(uint32_t startedAtMs, uint32_t livenessAtMs,
                              uint32_t inactivityTimeoutMs, uint32_t hardTimeoutMs) {
  const uint32_t now = millis();
  const bool knownLivenessExpired = livenessAtMs > 0 && now - livenessAtMs > inactivityTimeoutMs;
  return knownLivenessExpired || now - startedAtMs > hardTimeoutMs;
}

void clearPriorityCommands() {
  priorityCommandCount = 0;
  priorityCommandIndex = 0;
  priorityResponseBuffer = "";
  priorityCommandStartedAtMs = 0;
  priorityCommandLivenessAtMs = 0;
  priorityCommandAckTimeoutMs = kMarlinCommandAckTimeoutMs;
  priorityCommandHardTimeoutMs = kMarlinDefaultHardAckTimeoutMs;
  priorityCommandEstimatedDurationMs = 0;
  priorityCommandPlannerWaitMs = 0;
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

void startNextPriorityCommand() {
  if (priorityCommandIndex >= priorityCommandCount) {
    jobStatus.priorityCommandInProgress = false;
    return;
  }

  const String &cmd = priorityCommands[priorityCommandIndex];
  const MotionTimingEstimate timing = estimateAndApplyMotionTiming(cmd);
  if (jobStatus.toolChangePending && jobStatus.toolChangeHandling == "park" &&
      cmd.startsWith("G53 G0") && jobStatus.toolChangePhase != "PARKING_FOR_TOOL_CHANGE") {
    jobStatus.toolChangePhase = "PARKING_FOR_TOOL_CHANGE";
    if (!persistToolChangeTransition()) {
      setJobError("could not persist tool-change parking state");
      return;
    }
  }
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
  priorityCommandLivenessAtMs = 0;
  priorityCommandAckTimeoutMs = marlinAckTimeoutForCommand(cmd, jobStatus.toolChangePending);
  priorityCommandPlannerWaitMs = marlinPlannerWaitAllowanceMs;
  priorityCommandHardTimeoutMs = marlinHardAckTimeoutForCommand(
      cmd, timing, jobStatus.toolChangePending, priorityCommandPlannerWaitMs);
  priorityCommandEstimatedDurationMs = timing.durationKnown ? timing.durationMs : 0;
  logJobEvent("priority: " + cmd + " estimatedMs=" + String(priorityCommandEstimatedDurationMs) +
              " plannerWaitMs=" + String(priorityCommandPlannerWaitMs) +
              " hardTimeoutMs=" + String(priorityCommandHardTimeoutMs));
}

void invalidateMachineFrameAfterQuickstop() {
  const uint32_t invalidatedRevision = machineFrame.revision + 1;
  machineFrame = MachineFrameState();
  machineFrame.revision = invalidatedRevision;
  machineFrame.updatedAtMs = millis();
  marlinPosition = PositionTelemetry();
  touchPositionStatus();
}

void startImmediateStopPrioritySequence() {
  // Stop owns the UART immediately: discard any buffered response and replace lower-priority
  // controls (including M220 or a boundary-pause M400) before writing M410 here.
  queuePriorityCommands("M410", "M5");
  drainMarlinInput();
  startNextPriorityCommand();
}

uint32_t priorityAckTimeoutMs() {
  return priorityCommandAckTimeoutMs;
}

void finishPrioritySequence() {
  clearPriorityCommands();
  if (jobStatus.state == JobRunnerState::Preparing) {
    if (machineProfile.capAutoreportPos) marlinAutoreportSeconds = 1;
    jobRunning = true;
    jobStatus.state = JobRunnerState::Running;
    logJobEvent("start preamble complete: " + jobStatus.gcodePath);
  } else if (jobStatus.state == JobRunnerState::Pausing) {
    if (jobStatus.toolChangePending && jobStatus.toolChangeHandling == "park" &&
        !jobStatus.toolChangeReturnPositionCaptured) {
      setJobError("Tool-change position was not captured before parking; automatic resume is blocked");
      return;
    }
    if (jobFile) {
      jobFile.close();
    }
    jobWaitingForOk = false;
    jobResponseBuffer = "";
    jobStatus.pauseRequested = false;
    jobStatus.pausedAtMs = millis();
    if (jobStatus.toolChangePending) {
      jobStatus.state = JobRunnerState::Paused;
      jobStatus.toolChangeReady = true;
      jobStatus.toolChangeParked = jobStatus.toolChangeHandling == "park";
      jobStatus.toolChangePhase = "WAITING_FOR_TOOL";
      const String toolLabel = jobStatus.toolChangeToolNumber >= 0
                                   ? "T" + String(jobStatus.toolChangeToolNumber)
                                   : "the requested tool";
      jobStatus.streamingPausedReason = "M6 tool change: install " + toolLabel +
                                        ", set Z zero, then confirm the change.";
      logJobEvent("tool change ready: " + toolLabel + " line=" + String(jobStatus.toolChangeLine));
      if (!persistToolChangeTransition()) {
        setJobError("could not persist ready tool-change state");
        return;
      }
    } else {
      jobStatus.state = JobRunnerState::PausedIntact;
      jobStatus.directResumeValid = true;
      jobStatus.streamingPausedReason =
          "Motion held — cutter remains running. Direct Resume is valid until any manual movement.";
      logJobEvent("paused: " + jobStatus.gcodePath);
    }
  } else if (jobStatus.state == JobRunnerState::Stopping) {
    if (jobFile) {
      jobFile.close();
    }
    jobWaitingForOk = false;
    jobResponseBuffer = "";
    jobRunning = false;
    jobStatus.state = jobStatus.pauseInterruptedForManualMotion
                          ? JobRunnerState::RecoveryRequired
                          : JobRunnerState::Stopped;
    jobStatus.pauseRequested = false;
    jobStatus.stopRequested = false;
    jobStatus.directResumeValid = false;
    jobStatus.recoveryRequired = true;
    jobStatus.pauseRealtimeHold = false;
    jobStatus.pauseMode = "none";
    jobStatus.streamingPausedReason =
        jobStatus.pauseInterruptedForManualMotion
            ? "Manual movement invalidated direct Resume. Review Recovery before continuing."
            : "Stopped now with M410 quickstop. Home All and verify recovery before further motion.";
    if (jobStatus.pauseInterruptedForManualMotion) {
      setPersistentActiveJobMarker(false);
    }
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
    if (marlinAckWatchdogExpired(priorityCommandStartedAtMs, priorityCommandLivenessAtMs,
                                 priorityAckTimeoutMs(), priorityCommandHardTimeoutMs)) {
      jobStatus.lastPriorityResponse = priorityResponseBuffer;
      jobStatus.lastPriorityError = "Priority command acknowledgement timed out";
      addMarlinLog("rx", true, priorityResponseBuffer.length() > 0 ? priorityResponseBuffer : "timeout", "error");
      noteFeedOverrideResult(jobStatus.lastPriorityCommand, priorityResponseBuffer, jobStatus.lastPriorityError);
      setJobCommunicationLost("Marlin acknowledgement timed out for priority command: " +
                              jobStatus.lastPriorityCommand);
    }
    return;
  }

  jobStatus.lastPriorityResponse = priorityResponseBuffer;
  addMarlinLog("rx", true, priorityResponseBuffer);
  updatePositionFromMarlinResponse(priorityResponseBuffer);
  if (jobStatus.toolChangePending && jobStatus.toolChangeHandling == "park" &&
      jobStatus.lastPriorityCommand == "M114" && marlinPosition.valid &&
      !jobStatus.toolChangeReturnPositionCaptured) {
    jobStatus.toolChangeReturnPositionCaptured = true;
    jobStatus.toolChangeReturnWorkX = marlinPosition.x;
    jobStatus.toolChangeReturnWorkY = marlinPosition.y;
    jobStatus.toolChangeReturnWorkZ = marlinPosition.z;
  }
  noteFeedOverrideResult(jobStatus.lastPriorityCommand, priorityResponseBuffer);
  noteAcknowledgedPlannerTiming(jobStatus.lastPriorityCommand, priorityCommandEstimatedDurationMs);
  priorityCommandIndex += 1;
  jobStatus.priorityCommandInProgress = false;
  priorityResponseBuffer = "";
  priorityCommandStartedAtMs = 0;
  priorityCommandLivenessAtMs = 0;
  priorityCommandHardTimeoutMs = kMarlinDefaultHardAckTimeoutMs;
  priorityCommandEstimatedDurationMs = 0;
  priorityCommandPlannerWaitMs = 0;

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
  touchJogStatus();
}

String sendJogCommandForResponse(const String &cmd, uint32_t timeoutMs) {
  drainMarlinInput();
  addMarlinLog("tx", true, cmd);
  Serial.print(cmd);
  Serial.print('\n');
  jogStatus.lastCommand = cmd;
  const String response = readMarlinResponseFor(timeoutMs, true);
  touchJogStatus();
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
  syncMotionTimingPosition(x, y, z);
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
    touchPositionStatus();
  }
}

String machineFrameJson() {
  String json = "{\"x\":" + String(marlinPosition.x, 3) +
                ",\"y\":" + String(marlinPosition.y, 3) +
                ",\"z\":" + String(marlinPosition.z, 3);
  json += ",\"positionValid\":" + String(marlinPosition.valid ? "true" : "false");
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
  float safeZMinimum = 0.0f;
  float safeZMaximum = 0.0f;
  bool safeZMappedToMachine = false;
  safeWorkZRange(safeZMinimum, safeZMaximum, safeZMappedToMachine);
  const float safeZLiftMinimum = marlinPosition.valid && marlinPosition.z > safeZMinimum
                                    ? marlinPosition.z
                                    : safeZMinimum;
  json += ",\"safeZ\":{\"workMin\":" + String(safeZMinimum, 3) +
          ",\"workMax\":" + String(safeZMaximum, 3) +
          ",\"liftMin\":" + String(safeZLiftMinimum, 3) +
          ",\"machineMin\":" + String(machineZMin(), 3) +
          ",\"machineMax\":" + String(machineZMax(), 3) +
          ",\"mappedToMachine\":" + String(safeZMappedToMachine ? "true" : "false") +
          ",\"toolLengthReference\":\"active-work-zero\"";
  json += ",\"toolChangeParkMachineZ\":" + String(toolChangeSettings.parkMachineZ, 3) + "}";
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
  touchJogStatus();
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
  touchJogStatus();
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
    touchJogStatus();
    return;
  }

  // Normal pointer release: stop adding absolute targets and let the short
  // planner horizon drain naturally without inserting a hard stop.
  touchJogStatus();
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
  touchJogStatus();
}

bool prepareSafeJogLift() {
  if (!jogStatus.safeJog) {
    jogStatus.zLiftedForJog = false;
    return true;
  }

  if (!isfinite(jogStatus.safeLiftZ) || jogStatus.safeLiftZ < machineZMin() ||
      jogStatus.safeLiftZ > machineZMax() || jogStatus.zFeedMax <= 0) {
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
  touchJogStatus();
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
  touchJogStatus();
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
    touchJogStatus();
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
    touchJogStatus();
    return false;
  }
  jogStatus.zLiftedForJog = false;
  jogStatus.commandedWorkZ = jogStatus.originalZ;
  jogStatus.commandedPositionCaptured = true;
  jogStatus.originalZCaptured = false;
  jogStatus.safeLiftWorkZCaptured = false;
  jogStatus.lastError = "";
  touchJogStatus();
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

void setJobError(const String &message, bool resetFeedOverride) {
  if (jobFile) {
    jobFile.close();
  }
  if (resetFeedOverride) {
    resetFeedOverrideAfterJobIfNeeded();
  }
  clearPriorityCommands();
  jobWaitingForOk = false;
  jobCommandStartedAtMs = 0;
  jobCommandLivenessAtMs = 0;
  jobCommandAckTimeoutMs = kMarlinCommandAckTimeoutMs;
  jobCommandHardTimeoutMs = kMarlinDefaultHardAckTimeoutMs;
  jobCommandEstimatedDurationMs = 0;
  jobCommandPlannerWaitMs = 0;
  jobRunning = false;
  jobStatus.pauseRequested = false;
  jobStatus.stopRequested = false;
  jobStatus.state = JobRunnerState::Error;
  jobStatus.lastError = message;
  touchJobStatus();
  logJobEvent("error: " + message);
}

void sendImmediateJobSafetyM5(const String &reason) {
  // This intentionally bypasses the normal queue: the pending command may never
  // acknowledge, but spindle shutdown must still be attempted immediately.
  addMarlinLog("tx", true, "M5");
  Serial.print("M5\n");
  logJobEvent("immediate M5: " + reason);
}

void setJobCommunicationLost(const String &message) {
  const String failedCommand = jobStatus.priorityCommandInProgress
                                   ? jobStatus.lastPriorityCommand
                                   : jobStatus.lastCommand;
  jobStatus.errorCode = "COMMUNICATION_LOST";
  jobStatus.communicationLostAtMs = millis();
  jobStatus.communicationLostCommand = failedCommand;
  if (marlinPosition.valid) {
    jobStatus.communicationLostWorkPositionValid = true;
    jobStatus.communicationLostWorkX = marlinPosition.x;
    jobStatus.communicationLostWorkY = marlinPosition.y;
    jobStatus.communicationLostWorkZ = marlinPosition.z;
  }
  if (machineFrame.machineValid) {
    jobStatus.communicationLostMachinePositionValid = true;
    jobStatus.communicationLostMachineX = machineFrame.machineX;
    jobStatus.communicationLostMachineY = machineFrame.machineY;
    jobStatus.communicationLostMachineZ = machineFrame.machineZ;
  }

  String checkpoint = "communication_lost command=" + failedCommand;
  checkpoint += " sentOffset=" + String(jobStatus.currentByteOffset);
  checkpoint += " acknowledgedOffset=" + String(jobStatus.lastAcknowledgedByteOffset);
  checkpoint += " line=" + String(jobStatus.currentLineNumber);
  checkpoint += " acknowledgedLine=" + String(jobStatus.lastAcknowledgedLineNumber);
  checkpoint += " estimatedMs=" + String(jobStatus.priorityCommandInProgress
                                               ? priorityCommandEstimatedDurationMs
                                               : jobCommandEstimatedDurationMs);
  checkpoint += " inactivityTimeoutMs=" + String(jobStatus.priorityCommandInProgress
                                                       ? priorityCommandAckTimeoutMs
                                                       : jobCommandAckTimeoutMs);
  checkpoint += " hardTimeoutMs=" + String(jobStatus.priorityCommandInProgress
                                                 ? priorityCommandHardTimeoutMs
                                                 : jobCommandHardTimeoutMs);
  checkpoint += " plannerWaitMs=" + String(jobStatus.priorityCommandInProgress
                                                 ? priorityCommandPlannerWaitMs
                                                 : jobCommandPlannerWaitMs);
  if (jobStatus.communicationLostMachinePositionValid) {
    checkpoint += " machine=" + String(jobStatus.communicationLostMachineX, 3) + "," +
                  String(jobStatus.communicationLostMachineY, 3) + "," +
                  String(jobStatus.communicationLostMachineZ, 3);
  }
  if (jobStatus.communicationLostWorkPositionValid) {
    checkpoint += " work=" + String(jobStatus.communicationLostWorkX, 3) + "," +
                  String(jobStatus.communicationLostWorkY, 3) + "," +
                  String(jobStatus.communicationLostWorkZ, 3);
  }
  logJobEvent(checkpoint);

  // Do not wait for another acknowledgement on a transport that just timed out.
  // M410 is deliberately not automatic: an abrupt planner stop requires an explicit
  // operator policy because it can lose position and stress the machine.
  sendImmediateJobSafetyM5("communication lost; M410 not requested");
  setJobError(message, false);
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
  jobCommandAckTimeoutMs = kMarlinCommandAckTimeoutMs;
  jobCommandHardTimeoutMs = kMarlinDefaultHardAckTimeoutMs;
  jobCommandEstimatedDurationMs = 0;
  jobCommandPlannerWaitMs = 0;
  jobStatus.lastAcknowledgedByteOffset = jobStatus.currentByteOffset;
  jobStatus.lastAcknowledgedLineNumber = jobStatus.currentLineNumber;
  jobRunning = false;
  jobStatus.pauseRequested = false;
  jobStatus.stopRequested = false;
  jobStatus.toolChangePending = false;
  jobStatus.toolChangeReady = false;
  jobStatus.toolChangeZZeroCompleted = false;
  jobStatus.toolChangeParked = false;
  jobStatus.toolChangeToolConfirmed = false;
  jobStatus.toolChangeRouterReadyConfirmed = false;
  jobStatus.toolChangePhase = "NONE";
  jobStatus.streamingPausedReason = "";
  jobStatus.state = JobRunnerState::Completed;
  jobStatus.completedAtMs = millis();
  clearPersistentJobCheckpoint();
  touchJobStatus();
  logJobEvent("completed: " + jobStatus.gcodePath);
}

void processJobRunner() {
  if (priorityCommandCount > 0) {
    processPriorityCommands();
    if (priorityCommandCount > 0) return;
  }

  if (jobStatus.state == JobRunnerState::Stopping) {
    return;
  }

  if (jobStatus.state == JobRunnerState::Resuming) {
    jobStatus.state = JobRunnerState::Running;
    jobStatus.toolChangePhase = "NONE";
    jobStatus.toolChangeParked = false;
    jobStatus.toolChangeToolConfirmed = false;
    jobStatus.toolChangeRouterReadyConfirmed = false;
    jobStatus.toolChangeZZeroCompleted = false;
    touchJobStatus();
  }

  if (jobStatus.state != JobRunnerState::Running &&
      jobStatus.state != JobRunnerState::Pausing) {
    return;
  }

  if (jobStatus.state == JobRunnerState::Running &&
      (jobStatus.pauseRequested || jobStatus.stopRequested)) {
    return;
  }

  if (jobStatus.state == JobRunnerState::Pausing && !jobWaitingForOk) {
    queuePriorityCommands("M400");
    jobStatus.streamingPausedReason =
        "Pause pending at the next command boundary; waiting for Marlin motion to finish.";
    touchJobStatus();
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
      jobStatus.errorCode = "MARLIN_COMMAND_REJECTED";
      sendImmediateJobSafetyM5("Marlin rejected streamed command");
      setJobError("Marlin reported Error", false);
      return;
    }
    if (responseContainsToken(jobResponseBuffer, "Resend:")) {
      jobStatus.lastResponse = jobResponseBuffer;
      addMarlinLog("rx", false, jobResponseBuffer);
      jobStatus.errorCode = "RESEND_UNSUPPORTED";
      sendImmediateJobSafetyM5("Marlin requested unsupported Resend");
      setJobError("Marlin requested Resend; line-numbered replay is not supported", false);
      return;
    }
    if (!responseContainsToken(jobResponseBuffer, "ok")) {
      if (marlinAckWatchdogExpired(jobCommandStartedAtMs, jobCommandLivenessAtMs,
                                   jobCommandAckTimeoutMs, jobCommandHardTimeoutMs)) {
        jobStatus.lastResponse = jobResponseBuffer;
        addMarlinLog("rx", false, jobResponseBuffer.length() > 0 ? jobResponseBuffer : "timeout", "error");
        setJobCommunicationLost("Marlin acknowledgement timed out; command was not resent: " +
                                jobStatus.lastCommand);
      }
      return;
    }

    jobStatus.acknowledgedLineCount += 1;
    jobStatus.lastResponse = jobResponseBuffer;
    addMarlinLog("rx", false, jobResponseBuffer);
    updatePositionFromMarlinResponse(jobResponseBuffer);
    noteAcknowledgedPlannerTiming(jobStatus.lastCommand, jobCommandEstimatedDurationMs);
    jobResponseBuffer = "";
    jobWaitingForOk = false;
    jobCommandStartedAtMs = 0;
    jobCommandLivenessAtMs = 0;
    jobCommandAckTimeoutMs = kMarlinCommandAckTimeoutMs;
    jobCommandHardTimeoutMs = kMarlinDefaultHardAckTimeoutMs;
    jobCommandEstimatedDurationMs = 0;
    jobCommandPlannerWaitMs = 0;
    jobStatus.lastAcknowledgedByteOffset = jobStatus.currentByteOffset;
    jobStatus.lastAcknowledgedLineNumber = jobStatus.currentLineNumber;
    touchJobProgress();
    if (jobStatus.state == JobRunnerState::Pausing) {
      queuePriorityCommands("M400");
      jobStatus.streamingPausedReason =
          "Pause pending at the next command boundary; waiting for Marlin motion to finish.";
      touchJobStatus();
      return;
    }
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

  if (jobStatus.streamMode == "job") {
    int toolNumber = -1;
    if (gcodeHasM6(line)) {
      jobStatus.currentLineNumber += 1;
      jobStatus.lastCommand = line;
      touchJobProgress();
      beginToolChange(line);
      return;
    }
    if (gcodeIsStandaloneToolSelect(line, toolNumber)) {
      jobStatus.selectedToolNumber = toolNumber;
      jobStatus.currentLineNumber += 1;
      jobStatus.lastAcknowledgedByteOffset = jobStatus.currentByteOffset;
      jobStatus.lastAcknowledgedLineNumber = jobStatus.currentLineNumber;
      jobStatus.lastCommand = line;
      logJobEvent("tool selected by G-code: T" + String(toolNumber));
      touchJobProgress();
      return;
    }
  }

  jobStatus.lastCommand = line;
  const MotionTimingEstimate timing = estimateAndApplyMotionTiming(line);
  jobResponseBuffer = "";
  addMarlinLog("tx", false, line);
  Serial.print(line);
  Serial.print('\n');
  jobStatus.sentLineCount += 1;
  jobStatus.currentLineNumber += 1;
  queueMotionTelemetry(line, jobStatus.currentLineNumber);
  jobWaitingForOk = true;
  jobCommandStartedAtMs = millis();
  jobCommandLivenessAtMs = 0;
  jobCommandAckTimeoutMs = marlinAckTimeoutForCommand(line);
  jobCommandPlannerWaitMs = marlinPlannerWaitAllowanceMs;
  jobCommandHardTimeoutMs = marlinHardAckTimeoutForCommand(
      line, timing, false, jobCommandPlannerWaitMs);
  jobCommandEstimatedDurationMs = timing.durationKnown ? timing.durationMs : 0;
  if (timing.motion && jobCommandHardTimeoutMs > kMarlinDefaultHardAckTimeoutMs) {
    logJobEvent("motion ACK timing command=" + line + " distanceMm=" + String(timing.distanceMm, 3) +
                " effectiveFeed=" + String(timing.effectiveFeedMmMin, 1) +
                " estimatedMs=" + String(jobCommandEstimatedDurationMs) +
                " plannerWaitMs=" + String(jobCommandPlannerWaitMs) +
                " hardTimeoutMs=" + String(jobCommandHardTimeoutMs));
  }
  touchJobProgress();
}

String htmlPage(const String &title, const String &body) {
  String html = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">";
  html += "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">";
  html += "<title>";
  html += title;
  html += "</title><link rel=\"stylesheet\" href=\"/style.css\"></head><body><main class=\"app\">";
  html += body;
  html += "</main><script src=\"/telemetry.js\"></script>";
  html += "<script src=\"/machine-bar.js\"></script></body></html>";
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

bool extractGcodeIntegerWord(const String &line, char wanted, int &value) {
  String upper = line;
  upper.toUpperCase();
  for (int i = 0; i < upper.length(); ++i) {
    if (upper[i] != wanted) continue;
    if (i > 0 && upper[i - 1] >= 'A' && upper[i - 1] <= 'Z') continue;
    int cursor = i + 1;
    while (cursor < upper.length() && upper[cursor] == ' ') ++cursor;
    const int numberStart = cursor;
    while (cursor < upper.length() && upper[cursor] >= '0' && upper[cursor] <= '9') ++cursor;
    if (cursor == numberStart) continue;
    if (cursor < upper.length() && (upper[cursor] == '.' || upper[cursor] == '+' || upper[cursor] == '-')) continue;
    value = upper.substring(numberStart, cursor).toInt();
    return true;
  }
  return false;
}

bool gcodeHasM6(const String &line) {
  String upper = line;
  upper.toUpperCase();
  for (int i = 0; i < upper.length(); ++i) {
    if (upper[i] != 'M') continue;
    int cursor = i + 1;
    while (cursor < upper.length() && upper[cursor] == ' ') ++cursor;
    const int numberStart = cursor;
    while (cursor < upper.length() && upper[cursor] >= '0' && upper[cursor] <= '9') ++cursor;
    if (cursor == numberStart) continue;
    if (cursor < upper.length() && upper[cursor] == '.') continue;
    if (upper.substring(numberStart, cursor).toInt() == 6) return true;
  }
  return false;
}

bool gcodeIsStandaloneToolSelect(const String &line, int &toolNumber) {
  String upper = line;
  upper.trim();
  upper.toUpperCase();
  if (!upper.startsWith("T") || !extractGcodeIntegerWord(upper, 'T', toolNumber)) return false;
  int cursor = 1;
  while (cursor < upper.length() && upper[cursor] == ' ') ++cursor;
  while (cursor < upper.length() && upper[cursor] >= '0' && upper[cursor] <= '9') ++cursor;
  while (cursor < upper.length() && upper[cursor] == ' ') ++cursor;
  return cursor == upper.length();
}

bool beginToolChange(const String &line) {
  int requestedTool = jobStatus.selectedToolNumber;
  extractGcodeIntegerWord(line, 'T', requestedTool);
  jobStatus.selectedToolNumber = requestedTool;
  jobStatus.toolChangeToolNumber = requestedTool;
  jobStatus.toolChangePending = true;
  jobStatus.toolChangeReady = false;
  jobStatus.toolChangeZZeroCompleted = false;
  jobStatus.toolChangeParked = false;
  jobStatus.toolChangeToolConfirmed = false;
  jobStatus.toolChangeRouterReadyConfirmed = false;
  jobStatus.toolChangePhase = "TOOL_CHANGE_REQUESTED";
  jobStatus.toolChangeReturnPositionCaptured = false;
  jobStatus.toolChangeLine = jobStatus.currentLineNumber;
  jobStatus.toolChangeCommand = line;
  jobStatus.toolChangeHandling = toolChangeSettings.handling;
  jobStatus.toolChangeZZeroMethod = toolChangeSettings.zZeroMethod;
  jobStatus.pauseRequested = true;
  jobStatus.stopRequested = false;
  jobStatus.state = JobRunnerState::Pausing;
  jobStatus.streamingPausedReason = "M6 received. Finishing queued motion before tool change.";
  if (jobFile) jobFile.close();
  jobWaitingForOk = false;
  jobResponseBuffer = "";

  clearPriorityCommands();
  if (!appendPriorityCommand("M400") || !appendPriorityCommand("M5")) {
    setJobError("Tool-change stop sequence is too large for priority queue");
    return false;
  }

  if (toolChangeSettings.handling == "park") {
    String parkError;
    if (!machineFrame.absoluteFromHome || !machineFrame.machineValid) {
      jobStatus.toolChangeHandling = "pause";
      logJobEvent("tool change park skipped: absolute machine frame is unavailable");
    } else if (!toolChangeParkIsWithinMachine(parkError)) {
      jobStatus.toolChangeHandling = "pause";
      logJobEvent("tool change park skipped: " + parkError);
    } else {
      const String parkCommands[] = {
          "M114", "G21", "G90",
          "G53 G0 Z" + String(toolChangeSettings.parkMachineZ, 3) + " F" + String(kJobStartZFeed, 0),
          "M400",
          "G53 G0 X" + String(toolChangeSettings.parkMachineX, 3) +
              " Y" + String(toolChangeSettings.parkMachineY, 3) +
              " F" + String(jobStatus.travelFeedMmMin, 0),
          "M400", "G54",
      };
      for (const String &command : parkCommands) {
        if (!appendPriorityCommand(command)) {
          setJobError("Tool-change park sequence is too large for priority queue");
          return false;
        }
      }
    }
  }
  jobStatus.lastPriorityCommand = "";
  jobStatus.lastPriorityResponse = "";
  jobStatus.lastPriorityError = "";
  if (!persistToolChangeTransition()) {
    setJobError("could not persist requested tool-change state");
    return false;
  }
  logJobEvent("tool change requested: " + line + " line=" + String(jobStatus.toolChangeLine));
  touchJobStatus();
  return true;
}

void handleToolChangeSettingsGet() {
  server.send(200, "application/json", "{\"ok\":true,\"settings\":" + toolChangeSettingsJson() + "}");
}

void handleToolChangeSettingsPut() {
  if (jobIsActive() || jobWaitingForOk || jogIsActive() || priorityCommandCount > 0) {
    sendJsonError(409, "Tool-change settings can be changed only when the machine is idle.");
    return;
  }
  if (!server.hasArg("plain")) {
    sendJsonError(400, "missing JSON body");
    return;
  }
  const String body = server.arg("plain");
  String handling = extractJsonString(body, "handling");
  String zZeroMethod = extractJsonString(body, "zZeroMethod");
  handling.toLowerCase();
  zZeroMethod.toLowerCase();
  const bool touchPlateEnabled = extractJsonBool(body, "touchPlateEnabled", false);
  const float parkX = extractJsonFloat(body, "parkMachineX", NAN);
  const float parkY = extractJsonFloat(body, "parkMachineY", NAN);
  const float parkZ = extractJsonFloat(body, "parkMachineZ", NAN);
  const float plateThickness = extractJsonFloat(body, "touchPlateThickness", NAN);
  const float probeDistance = extractJsonFloat(body, "touchPlateProbeDistance", NAN);
  const float probeFeed = extractJsonFloat(body, "touchPlateProbeFeed", NAN);
  const float retractDistance = extractJsonFloat(body, "touchPlateRetractDistance", NAN);
  if (handling != "pause" && handling != "park") {
    sendJsonError(400, "handling must be pause or park");
    return;
  }
  if (zZeroMethod != "manual" && zZeroMethod != "touchplate") {
    sendJsonError(400, "zZeroMethod must be manual or touchplate");
    return;
  }
  if (zZeroMethod == "touchplate" && !touchPlateEnabled) {
    sendJsonError(400, "touchplate Z zero requires an enabled touch plate");
    return;
  }
  if (!isfinite(parkX) || !isfinite(parkY) || !isfinite(parkZ) ||
      parkX < machineXMin() || parkX > machineXMax() ||
      parkY < machineYMin() || parkY > machineYMax() ||
      parkZ < machineZMin() || parkZ > machineZMax()) {
    sendJsonError(400, "tool-change position is outside configured machine limits");
    return;
  }
  if (!isfinite(plateThickness) || plateThickness < 0.01f || plateThickness > 100.0f ||
      !isfinite(probeDistance) || probeDistance < 0.1f || probeDistance > 200.0f ||
      !isfinite(probeFeed) || probeFeed < 1.0f || probeFeed > 1000.0f ||
      !isfinite(retractDistance) || retractDistance < 0.1f || retractDistance > 20.0f) {
    sendJsonError(400, "touch-plate values are outside allowed limits");
    return;
  }
  toolChangeSettings.handling = handling;
  toolChangeSettings.parkMachineX = parkX;
  toolChangeSettings.parkMachineY = parkY;
  toolChangeSettings.parkMachineZ = parkZ;
  toolChangeSettings.zZeroMethod = zZeroMethod;
  toolChangeSettings.touchPlateEnabled = touchPlateEnabled;
  toolChangeSettings.touchPlateThickness = plateThickness;
  toolChangeSettings.touchPlateProbeDistance = probeDistance;
  toolChangeSettings.touchPlateProbeFeed = probeFeed;
  toolChangeSettings.touchPlateRetractDistance = retractDistance;
  saveToolChangeSettings();
  server.send(200, "application/json", "{\"ok\":true,\"settings\":" + toolChangeSettingsJson() + "}");
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

String operatorPinDigest(const String &pin) {
  const String material = deviceIdentity.deviceId + ":" + pin;
  uint8_t digest[32];
  mbedtls_sha256_ret(reinterpret_cast<const unsigned char *>(material.c_str()),
                     material.length(), digest, 0);
  return bytesToHex(digest, sizeof(digest));
}

String operatorBrowserDigest(const String &browserId) {
  const String material = deviceIdentity.deviceId + ":browser:" + browserId;
  uint8_t digest[32];
  mbedtls_sha256_ret(reinterpret_cast<const unsigned char *>(material.c_str()),
                     material.length(), digest, 0);
  return bytesToHex(digest, sizeof(digest));
}

bool validOperatorBrowserId(const String &browserId) {
  if (browserId.length() != 64) return false;
  for (size_t i = 0; i < browserId.length(); ++i) {
    const char value = browserId[i];
    if (!((value >= '0' && value <= '9') || (value >= 'a' && value <= 'f'))) return false;
  }
  return true;
}

bool validOperatorPin(const String &pin) {
  if (pin.length() < 6 || pin.length() > 12) return false;
  for (size_t i = 0; i < pin.length(); ++i) {
    if (pin[i] < '0' || pin[i] > '9') return false;
  }
  return true;
}

bool operatorSessionActive() {
  if (operatorSessionToken.length() == 0) return false;
  if (millis() - operatorSessionLastSeenMs <= kOperatorLeaseMs) return true;
  operatorOtaUnlockedUntilMs = 0;
  return false;
}

String operatorRequestToken() {
  String cookie = server.header("Cookie");
  const String marker = "cnc_operator=";
  int start = cookie.indexOf(marker);
  if (start < 0) return "";
  start += marker.length();
  int end = cookie.indexOf(';', start);
  if (end < 0) end = cookie.length();
  String token = cookie.substring(start, end);
  token.trim();
  return token;
}

bool operatorRequestAuthorized(bool refreshLease = true) {
  const String token = operatorRequestToken();
  if (token.length() == 0 || operatorSessionToken.length() == 0 || token != operatorSessionToken) return false;
  operatorSessionActive();
  if (refreshLease) operatorSessionLastSeenMs = millis();
  return true;
}

bool operatorOtaUnlocked() {
  return operatorRequestAuthorized() && operatorOtaUnlockedUntilMs != 0 &&
         static_cast<int32_t>(operatorOtaUnlockedUntilMs - millis()) > 0;
}

String operatorStatusJson(bool assumeController = false) {
  const bool active = operatorSessionActive();
  const String requestToken = operatorRequestToken();
  const bool controller = operatorSessionToken.length() > 0 &&
                          (assumeController || requestToken == operatorSessionToken);
  const uint32_t remaining = active ? kOperatorLeaseMs - (millis() - operatorSessionLastSeenMs) : 0;
  String json = "{\"ok\":true,\"configured\":";
  json += operatorPinHash.length() > 0 ? "true" : "false";
  json += ",\"active\":" + String(active ? "true" : "false");
  json += ",\"controller\":" + String(controller ? "true" : "false");
  json += ",\"readOnly\":" + String(controller ? "false" : "true");
  json += ",\"canClaim\":" + String(active ? "false" : "true");
  json += ",\"owner\":";
  json += active || controller ? "\"" + jsonEscape(operatorSessionOwner) + "\"" : "null";
  json += ",\"leaseRemainingMs\":" + String(remaining);
  json += ",\"leaseMs\":" + String(kOperatorLeaseMs);
  const bool otaUnlocked = controller && operatorOtaUnlockedUntilMs != 0 &&
                           static_cast<int32_t>(operatorOtaUnlockedUntilMs - millis()) > 0;
  json += ",\"otaUnlocked\":" + String(otaUnlocked ? "true" : "false");
  json += "}";
  return json;
}

void sendOperatorLocked() {
  String json = operatorStatusJson();
  json.remove(json.length() - 1);
  json.replace("{\"ok\":true", "{\"ok\":false");
  json += ",\"error\":\"Operator control is locked. Claim the controller session with the device PIN.\"}";
  server.send(423, "application/json", json);
}

bool requireOperatorControl() {
  if (operatorRequestAuthorized()) return true;
  sendOperatorLocked();
  return false;
}

bool operatorPinAttemptsAllowed() {
  const uint32_t now = millis();
  if (now - operatorFailedPinWindowStartedAtMs > kOperatorFailedPinWindowMs) {
    operatorFailedPinWindowStartedAtMs = now;
    operatorFailedPinAttempts = 0;
  }
  return operatorFailedPinAttempts < kOperatorMaxPinAttempts;
}

void noteOperatorPinFailure() {
  if (operatorFailedPinAttempts == 0) operatorFailedPinWindowStartedAtMs = millis();
  if (operatorFailedPinAttempts < 255) ++operatorFailedPinAttempts;
}

bool verifyOperatorPin(const String &pin) {
  if (!operatorPinAttemptsAllowed()) return false;
  if (operatorPinHash.length() > 0 && operatorPinDigest(pin) == operatorPinHash) {
    operatorFailedPinAttempts = 0;
    return true;
  }
  noteOperatorPinFailure();
  return false;
}

String newOperatorToken() {
  char token[41];
  snprintf(token, sizeof(token), "%08lX%08lX%08lX%08lX%08lX",
           static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()),
           static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()),
           static_cast<unsigned long>(esp_random()));
  return String(token);
}

void saveOperatorPin(const String &pin) {
  operatorPinHash = operatorPinDigest(pin);
  operatorPrefs.begin(kOperatorPrefsNamespace, false);
  operatorPrefs.putString(kOperatorPrefsPinHashKey, operatorPinHash);
  operatorPrefs.end();
}

void rememberOperatorBrowser(const String &browserId, const String &owner) {
  operatorRememberedBrowserHash = operatorBrowserDigest(browserId);
  operatorRememberedOwner = owner;
  operatorPrefs.begin(kOperatorPrefsNamespace, false);
  operatorPrefs.putString(kOperatorPrefsBrowserHashKey, operatorRememberedBrowserHash);
  operatorPrefs.putString(kOperatorPrefsOwnerKey, operatorRememberedOwner);
  operatorPrefs.end();
}

void forgetOperatorBrowser() {
  operatorRememberedBrowserHash = "";
  operatorRememberedOwner = "";
  operatorPrefs.begin(kOperatorPrefsNamespace, false);
  operatorPrefs.remove(kOperatorPrefsBrowserHashKey);
  operatorPrefs.remove(kOperatorPrefsOwnerKey);
  operatorPrefs.end();
}

void loadOperatorSettings() {
  operatorPrefs.begin(kOperatorPrefsNamespace, true);
  operatorPinHash = operatorPrefs.getString(kOperatorPrefsPinHashKey, "");
  operatorRememberedBrowserHash = operatorPrefs.getString(kOperatorPrefsBrowserHashKey, "");
  operatorRememberedOwner = operatorPrefs.getString(kOperatorPrefsOwnerKey, "");
  operatorPrefs.end();
}

void handleOperatorStatus() {
  server.send(200, "application/json", operatorStatusJson());
}

void handleOperatorClaim() {
  const String body = server.hasArg("plain") ? server.arg("plain") : "";
  String owner = extractJsonString(body, "owner");
  String pin = extractJsonString(body, "pin");
  String browserId = extractJsonString(body, "browserId");
  owner.trim();
  pin.trim();
  browserId.trim();
  if (owner.length() == 0 || owner.length() > 32 || !validOperatorPin(pin) ||
      !validOperatorBrowserId(browserId)) {
    sendJsonError(400, "owner, browser identity, and a 6-12 digit PIN are required");
    return;
  }
  if (operatorSessionActive() && !operatorRequestAuthorized(false)) {
    sendOperatorLocked();
    return;
  }
  if (operatorPinHash.length() == 0) {
    if (server.client().localIP() != WiFi.softAPIP()) {
      sendJsonError(403, "initial operator PIN must be set through the device Setup AP at 192.168.4.1");
      return;
    }
    saveOperatorPin(pin);
  } else if (!verifyOperatorPin(pin)) {
    sendJsonError(operatorPinAttemptsAllowed() ? 403 : 429,
                  operatorPinAttemptsAllowed() ? "incorrect operator PIN"
                                               : "too many PIN attempts; wait 30 seconds");
    return;
  }
  operatorSessionToken = newOperatorToken();
  operatorSessionOwner = owner;
  operatorSessionBrowserHash = operatorBrowserDigest(browserId);
  rememberOperatorBrowser(browserId, owner);
  operatorSessionClaimedAtMs = millis();
  operatorSessionLastSeenMs = operatorSessionClaimedAtMs;
  operatorOtaUnlockedUntilMs = 0;
  server.sendHeader("Set-Cookie", "cnc_operator=" + operatorSessionToken +
                                  "; Path=/; SameSite=Strict; HttpOnly; Max-Age=" +
                                  String(kOperatorCookieMaxAgeSeconds));
  server.send(200, "application/json", operatorStatusJson(true));
}

void handleOperatorReconnect() {
  String browserId = extractJsonString(server.hasArg("plain") ? server.arg("plain") : "", "browserId");
  browserId.trim();
  if (!validOperatorBrowserId(browserId)) {
    sendJsonError(400, "valid browser identity is required");
    return;
  }
  const String browserHash = operatorBrowserDigest(browserId);
  if (operatorRememberedBrowserHash.length() == 0 || browserHash != operatorRememberedBrowserHash) {
    sendJsonError(403, "this browser is not the remembered controller");
    return;
  }
  if (operatorSessionActive() && operatorSessionBrowserHash.length() > 0 &&
      browserHash != operatorSessionBrowserHash) {
    sendOperatorLocked();
    return;
  }
  operatorSessionToken = newOperatorToken();
  operatorSessionOwner = operatorRememberedOwner.length() > 0
                           ? operatorRememberedOwner : "Remembered controller";
  operatorSessionBrowserHash = browserHash;
  operatorSessionClaimedAtMs = millis();
  operatorSessionLastSeenMs = operatorSessionClaimedAtMs;
  operatorOtaUnlockedUntilMs = 0;
  server.sendHeader("Set-Cookie", "cnc_operator=" + operatorSessionToken +
                                  "; Path=/; SameSite=Strict; HttpOnly; Max-Age=" +
                                  String(kOperatorCookieMaxAgeSeconds));
  server.send(200, "application/json", operatorStatusJson(true));
}

void handleOperatorHeartbeat() {
  if (!requireOperatorControl()) return;
  server.send(200, "application/json", operatorStatusJson());
}

void handleOperatorRelease() {
  if (!requireOperatorControl()) return;
  operatorSessionToken = "";
  operatorSessionOwner = "";
  operatorSessionBrowserHash = "";
  operatorOtaUnlockedUntilMs = 0;
  forgetOperatorBrowser();
  server.sendHeader("Set-Cookie", "cnc_operator=; Path=/; SameSite=Strict; HttpOnly; Max-Age=0");
  server.send(200, "application/json", operatorStatusJson());
}

void handleOperatorPinUpdate() {
  if (!requireOperatorControl()) return;
  const String body = server.hasArg("plain") ? server.arg("plain") : "";
  const String currentPin = extractJsonString(body, "currentPin");
  const String newPin = extractJsonString(body, "newPin");
  if (!verifyOperatorPin(currentPin)) {
    sendJsonError(403, "current operator PIN is incorrect");
    return;
  }
  if (!validOperatorPin(newPin)) {
    sendJsonError(400, "new PIN must contain 6-12 digits");
    return;
  }
  saveOperatorPin(newPin);
  operatorOtaUnlockedUntilMs = 0;
  server.send(200, "application/json", "{\"ok\":true,\"message\":\"Operator PIN updated.\"}");
}

void handleOperatorOtaUnlock() {
  if (!requireOperatorControl()) return;
  if (jobIsActive() || jobWaitingForOk || jogIsActive() || priorityCommandCount > 0) {
    sendJsonError(409, "OTA unlock is allowed only while the machine is idle");
    return;
  }
  const String pin = extractJsonString(server.hasArg("plain") ? server.arg("plain") : "", "pin");
  if (!verifyOperatorPin(pin)) {
    sendJsonError(403, "operator PIN is incorrect");
    return;
  }
  operatorOtaUnlockedUntilMs = millis() + kOperatorOtaUnlockMs;
  server.send(200, "application/json",
              "{\"ok\":true,\"message\":\"OTA unlocked for 2 minutes.\"}");
}

void operatorRoute(const char *uri, HTTPMethod method, void (*handler)()) {
  httpRoute(uri, method, [handler]() {
    if (requireOperatorControl()) handler();
  });
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

bool recoveryJobMetadataImportAllowed(const String &path) {
  if (jobIsActive() || jobCheckpointTracking || !recoveryCheckpointRequiresReview) return false;
  const String normalized = normalizeSdPath(path);
  // Recovery import must durably add the interrupted run to its job metadata before
  // acknowledging the firmware checkpoint. This exception is used only by upload;
  // delete and rename remain locked with every motion file.
  const String recoveryJob = normalizeSdPath(recoveryCheckpointJobPath);
  return recoveryJob.endsWith(".job.json") && normalized == recoveryJob;
}

bool mutationPathTouchesLockedFile(const String &path) {
  if (!(jobIsActive() || jobCheckpointTracking || recoveryCheckpointRequiresReview)) return false;
  const String normalized = normalizeSdPath(path);
  const String lockedPaths[] = {
      jobStatus.gcodePath, jobStatus.jobPath, jobStatus.authorizationActiveRunPath,
      recoveryCheckpointGcodePath, recoveryCheckpointJobPath, recoveryCheckpointActiveRunPath,
  };
  for (const String &lockedRaw : lockedPaths) {
    const String locked = normalizeSdPath(lockedRaw);
    if (locked.length() == 0 || locked == "/") continue;
    if (normalized == locked || locked.startsWith(normalized + "/")) return true;
  }
  return false;
}

void rejectLockedFileMutation(const String &path) {
  sendJsonError(423, "file is locked by the active or interrupted job: " + path);
}

void resetUploadState() {
  if (uploadFile) {
    uploadFile.close();
  }
  uploadError = "";
  uploadTargetPath = "";
  uploadSeen = false;
  uploadOk = false;
  uploadTargetOpened = false;
}

void handleUploadComplete() {
  if (!uploadSeen) {
    sendJsonError(400, "no file provided");
    return;
  }

  if (!uploadOk) {
    const int status = uploadError.indexOf("locked") >= 0 ? 423 : 400;
    sendJsonError(status, uploadError.length() > 0 ? uploadError : "upload failed");
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
    if (mutationPathTouchesLockedFile(uploadTargetPath) &&
        !recoveryJobMetadataImportAllowed(uploadTargetPath)) {
      uploadError = "file is locked by the active or interrupted job";
      return;
    }
    if (SD_MMC.exists(uploadTargetPath) && server.arg("overwrite") != "true") {
      uploadError = "file exists";
      return;
    }

    uploadFile = SD_MMC.open(uploadTargetPath, FILE_WRITE);
    if (!uploadFile) {
      uploadError = "could not create file";
    } else {
      uploadTargetOpened = true;
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
      if (uploadTargetOpened) SD_MMC.remove(uploadTargetPath);
      uploadError = "empty upload";
      return;
    }

    uploadOk = uploadError.length() == 0;
  } else if (upload.status == UPLOAD_FILE_ABORTED) {
    if (uploadFile) {
      uploadFile.close();
    }
    if (uploadTargetOpened && uploadTargetPath.length() > 0) {
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
  if (mutationPathTouchesLockedFile(path)) {
    rejectLockedFileMutation(path);
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
  if (mutationPathTouchesLockedFile(from) || mutationPathTouchesLockedFile(to)) {
    rejectLockedFileMutation(mutationPathTouchesLockedFile(from) ? from : to);
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
  if (upper == "M5" && jobStatus.state == JobRunnerState::RecoveryRequired) {
    sendJsonError(409, "standalone M5 is unavailable while interrupted-job Recovery is required");
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

struct JobExecutionAuthorization {
  int schemaVersion = 0;
  String startAuthorizationToken;
  String startAuthorizationState;
  String activeRunMode;
  String activeRunPath;
  String activeRunFingerprint;
  size_t activeRunSizeBytes = 0;
  String authorizationRunMode;
  String authorizationRunPath;
  String authorizationRunFingerprint;
  size_t authorizationRunSizeBytes = 0;
  String authorizationWorkZeroId;
  uint32_t authorizationHomingEpoch = 0;
  String authorizationHomingSessionId;
  String activeWorkZeroId;
  String verificationResult;
  String verificationType;
  String verificationRunPath;
  String verificationRunFingerprint;
  size_t verificationRunSizeBytes = 0;
  String generatedValidationStatus;
  bool allowedWorkspaceCommands = false;
  int feedStartPercent = 100;
  bool resetFeedAfterJob = true;
};

String jsonVariantString(JsonVariantConst value) {
  const char *text = value | "";
  return String(text);
}

bool loadProjectSafeZ(const String &jobPath, float &effectiveSafeZ, String &error) {
  File file = SD_MMC.open(jobPath, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) file.close();
    error = "job JSON not found for Project Safe Z";
    return false;
  }
  JsonDocument filter;
  for (const char *key : {"workpieceHeightMm", "workZeroReference", "stockTopWorkZ",
                          "safeZClearanceMm", "effectiveSafeZ", "resolved"}) {
    filter["projectSafeZ"][key] = true;
  }
  JsonDocument doc;
  const DeserializationError parseError =
      deserializeJson(doc, file, DeserializationOption::Filter(filter));
  file.close();
  if (parseError) {
    error = "invalid Project Safe Z metadata";
    return false;
  }
  JsonObjectConst safeZ = doc["projectSafeZ"];
  const String reference = jsonVariantString(safeZ["workZeroReference"]);
  const float clearance = safeZ["safeZClearanceMm"] | NAN;
  float stockTop = NAN;
  if (reference == "top") {
    stockTop = 0.0f;
  } else if (reference == "bottom") {
    stockTop = safeZ["workpieceHeightMm"] | NAN;
    if (!isfinite(stockTop) || stockTop < 0.0f) {
      error = "Project Safe Z requires workpiece height for bottom Work Zero";
      return false;
    }
  } else if (reference == "custom") {
    stockTop = safeZ["stockTopWorkZ"] | NAN;
  } else {
    error = "Project Safe Z Work Zero reference is unresolved";
    return false;
  }
  if (!isfinite(stockTop) || !isfinite(clearance) || clearance < 0.0f) {
    error = "Project Safe Z stock top and non-negative clearance are required";
    return false;
  }
  effectiveSafeZ = stockTop + clearance;
  const float storedEffective = safeZ["effectiveSafeZ"] | NAN;
  if (!(safeZ["resolved"] | false) || !isfinite(storedEffective) ||
      fabsf(storedEffective - effectiveSafeZ) > 0.001f) {
    error = "Project Safe Z derived value is missing or stale";
    return false;
  }
  return true;
}

bool loadJobExecutionAuthorization(const String &jobPath, JobExecutionAuthorization &authorization,
                                   String &error) {
  File file = SD_MMC.open(jobPath, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) file.close();
    error = "job JSON not found";
    return false;
  }

  JsonDocument filter;
  filter["schemaVersion"] = true;
  filter["startAuthorizationToken"] = true;
  filter["activeWorkZeroId"] = true;
  filter["allowedWorkspaceCommands"] = true;
  for (const char *key : {"mode", "path", "sizeBytes", "sourceFingerprint", "generatedFingerprint"}) {
    filter["activeRun"][key] = true;
  }
  for (const char *key : {"state", "activeRunMode", "activeRunPath", "activeRunFingerprint",
                          "activeRunSizeBytes", "workZeroId", "homingEpoch", "homingSessionId"}) {
    filter["startAuthorization"][key] = true;
  }
  for (const char *key : {"result", "type", "activeRunPath", "activeRunFingerprint",
                          "activeRunSizeBytes"}) {
    filter["verificationDecision"][key] = true;
  }
  filter["generatedValidation"]["status"] = true;
  filter["feedOverride"]["startPercent"] = true;
  filter["feedOverride"]["resetTo100AfterJob"] = true;

  JsonDocument doc;
  const DeserializationError parseError =
      deserializeJson(doc, file, DeserializationOption::Filter(filter));
  file.close();
  if (parseError) {
    error = "invalid job JSON: " + String(parseError.c_str());
    return false;
  }

  authorization.schemaVersion = doc["schemaVersion"] | 0;
  authorization.startAuthorizationToken = jsonVariantString(doc["startAuthorizationToken"]);
  authorization.activeWorkZeroId = jsonVariantString(doc["activeWorkZeroId"]);
  authorization.allowedWorkspaceCommands = doc["allowedWorkspaceCommands"] | false;

  JsonObjectConst activeRun = doc["activeRun"];
  authorization.activeRunMode = jsonVariantString(activeRun["mode"]);
  authorization.activeRunPath = normalizeSdPath(jsonVariantString(activeRun["path"]));
  authorization.activeRunSizeBytes = activeRun["sizeBytes"] | 0;
  authorization.activeRunFingerprint = authorization.activeRunMode == "generated"
                                           ? jsonVariantString(activeRun["generatedFingerprint"])
                                           : jsonVariantString(activeRun["sourceFingerprint"]);

  JsonObjectConst start = doc["startAuthorization"];
  authorization.startAuthorizationState = jsonVariantString(start["state"]);
  authorization.authorizationRunMode = jsonVariantString(start["activeRunMode"]);
  authorization.authorizationRunPath = normalizeSdPath(jsonVariantString(start["activeRunPath"]));
  authorization.authorizationRunFingerprint = jsonVariantString(start["activeRunFingerprint"]);
  authorization.authorizationRunSizeBytes = start["activeRunSizeBytes"] | 0;
  authorization.authorizationWorkZeroId = jsonVariantString(start["workZeroId"]);
  authorization.authorizationHomingEpoch = start["homingEpoch"] | 0;
  authorization.authorizationHomingSessionId = jsonVariantString(start["homingSessionId"]);

  JsonObjectConst verification = doc["verificationDecision"];
  authorization.verificationResult = jsonVariantString(verification["result"]);
  authorization.verificationType = jsonVariantString(verification["type"]);
  authorization.verificationRunPath = normalizeSdPath(jsonVariantString(verification["activeRunPath"]));
  authorization.verificationRunFingerprint = jsonVariantString(verification["activeRunFingerprint"]);
  authorization.verificationRunSizeBytes = verification["activeRunSizeBytes"] | 0;
  authorization.generatedValidationStatus = jsonVariantString(doc["generatedValidation"]["status"]);
  authorization.feedStartPercent = doc["feedOverride"]["startPercent"] | 100;
  authorization.resetFeedAfterJob = doc["feedOverride"]["resetTo100AfterJob"] | true;
  return true;
}

bool isHexSha256(const String &value) {
  if (value.length() != 64) return false;
  for (size_t i = 0; i < value.length(); ++i) {
    const char c = value[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false;
  }
  return true;
}

String bytesToHex(const uint8_t *bytes, size_t length) {
  static const char hex[] = "0123456789abcdef";
  String result;
  result.reserve(length * 2);
  for (size_t i = 0; i < length; ++i) {
    result += hex[(bytes[i] >> 4) & 0x0f];
    result += hex[bytes[i] & 0x0f];
  }
  return result;
}

String fingerprintPart(const String &fingerprint, const String &name) {
  const String marker = name + ":";
  const int start = fingerprint.indexOf(marker);
  if (start < 0) return "";
  const int valueStart = start + marker.length();
  const int end = fingerprint.indexOf(':', valueStart);
  return end < 0 ? fingerprint.substring(valueStart) : fingerprint.substring(valueStart, end);
}

bool activeRunFileMatches(const String &path, size_t expectedSize, const String &expectedFingerprint,
                          String &error) {
  if (expectedSize == 0 || expectedFingerprint.length() == 0) {
    error = "active run size and fingerprint are required";
    return false;
  }
  File file = SD_MMC.open(path, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) file.close();
    error = "active run file not found";
    return false;
  }
  if (file.size() != expectedSize) {
    file.close();
    error = "active run file size changed after authorization";
    return false;
  }

  uint8_t buffer[512];
  if (isHexSha256(expectedFingerprint)) {
    mbedtls_sha256_context context;
    uint8_t digest[32];
    mbedtls_sha256_init(&context);
    mbedtls_sha256_starts_ret(&context, 0);
    while (file.available()) {
      const size_t count = file.read(buffer, sizeof(buffer));
      if (count > 0) mbedtls_sha256_update_ret(&context, buffer, count);
    }
    mbedtls_sha256_finish_ret(&context, digest);
    mbedtls_sha256_free(&context);
    file.close();
    String expected = expectedFingerprint;
    expected.toLowerCase();
    if (bytesToHex(digest, sizeof(digest)) != expected) {
      error = "active run SHA-256 changed after authorization";
      return false;
    }
    return true;
  }

  const String expectedSizePart = fingerprintPart(expectedFingerprint, "size");
  const String expectedFnv = fingerprintPart(expectedFingerprint, "fnv1a");
  if (expectedSizePart.length() == 0 || expectedFnv.length() == 0 ||
      static_cast<size_t>(strtoull(expectedSizePart.c_str(), nullptr, 10)) != expectedSize) {
    file.close();
    error = "unsupported active run fingerprint";
    return false;
  }
  uint32_t hash = 0x811c9dc5u;
  while (file.available()) {
    const size_t count = file.read(buffer, sizeof(buffer));
    for (size_t i = 0; i < count; ++i) {
      hash ^= buffer[i];
      hash *= 0x01000193u;
    }
  }
  file.close();
  char actualFnv[9];
  snprintf(actualFnv, sizeof(actualFnv), "%08lx", static_cast<unsigned long>(hash));
  String expectedFnvLower = expectedFnv;
  expectedFnvLower.toLowerCase();
  if (String(actualFnv) != expectedFnvLower) {
    error = "active run fingerprint changed after authorization";
    return false;
  }
  return true;
}

bool validateJobExecutionAuthorization(const JobExecutionAuthorization &authorization,
                                       const String &gcodePath, const String &activeRunMode,
                                       const String &activeRunFingerprint, size_t activeRunSizeBytes,
                                       const String &workZeroId, uint32_t homingEpoch,
                                       const String &homingSessionId, String &error) {
  if (authorization.schemaVersion != 3 || authorization.startAuthorizationToken != "AUTHORIZED" ||
      authorization.startAuthorizationState != "authorized") {
    error = "job JSON has no valid v3 start authorization";
    return false;
  }
  if (activeRunMode != "source" && activeRunMode != "generated") {
    error = "activeRunMode must be source or generated";
    return false;
  }
  if (authorization.activeRunMode != activeRunMode || authorization.activeRunPath != gcodePath ||
      authorization.activeRunFingerprint != activeRunFingerprint ||
      authorization.activeRunSizeBytes != activeRunSizeBytes) {
    error = "requested file does not match job activeRun identity";
    return false;
  }
  if (authorization.authorizationRunMode != activeRunMode ||
      authorization.authorizationRunPath != gcodePath ||
      authorization.authorizationRunFingerprint != activeRunFingerprint ||
      authorization.authorizationRunSizeBytes != activeRunSizeBytes) {
    error = "start authorization does not match the active run";
    return false;
  }
  const bool verificationTypeValid = authorization.verificationType == "bounds" ||
                                     authorization.verificationType == "aircut" ||
                                     authorization.verificationType == "skipped";
  if (authorization.verificationResult != "complete" || !verificationTypeValid ||
      authorization.verificationRunPath != gcodePath ||
      authorization.verificationRunFingerprint != activeRunFingerprint ||
      authorization.verificationRunSizeBytes != activeRunSizeBytes) {
    error = "physical verification identity is stale or incomplete";
    return false;
  }
  if (authorization.activeWorkZeroId != workZeroId ||
      authorization.authorizationWorkZeroId != workZeroId ||
      authorization.authorizationHomingEpoch != homingEpoch ||
      authorization.authorizationHomingSessionId != homingSessionId) {
    error = "authorized work-zero or homing identity changed";
    return false;
  }
  if (activeRunMode == "generated" && authorization.generatedValidationStatus != "valid") {
    error = "generated active run is not validated";
    return false;
  }
  return activeRunFileMatches(gcodePath, activeRunSizeBytes, activeRunFingerprint, error);
}

struct ProductionResumeIdentity {
  bool authorized = false;
  String eventId;
  String interruptedRunId;
  String activeRunPath;
  String activeRunMode;
  String activeRunFingerprint;
  String streamPath;
  String streamFingerprint;
  size_t streamSizeBytes = 0;
  bool eventMatches = false;
  int feedStartPercent = 100;
  bool resetFeedAfterJob = true;
};

bool loadProductionResumeIdentity(const String &jobPath, const String &wantedEventId,
                                  ProductionResumeIdentity &identity, String &error) {
  File file = SD_MMC.open(jobPath, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) file.close();
    error = "job JSON not found";
    return false;
  }
  JsonDocument filter;
  for (const char *key : {"authorized", "eventId", "interruptedRunId", "activeRunPath",
                          "activeRunMode", "activeRunFingerprint", "streamPath",
                          "streamFingerprint", "streamSizeBytes"}) {
    filter["productionResumeAuthorization"][key] = true;
  }
  for (const char *key : {"id", "type", "state", "runId", "activeRunPath", "activeRunMode",
                          "activeRunFingerprint", "phase1CompletedAt", "manualRouterConfirmedAt",
                          "streamPath"}) {
    filter["recoveryHistory"][0][key] = true;
  }
  filter["feedOverride"]["startPercent"] = true;
  filter["feedOverride"]["resetTo100AfterJob"] = true;

  JsonDocument doc;
  const DeserializationError parseError =
      deserializeJson(doc, file, DeserializationOption::Filter(filter));
  file.close();
  if (parseError) {
    error = "invalid job JSON: " + String(parseError.c_str());
    return false;
  }

  JsonObjectConst auth = doc["productionResumeAuthorization"];
  identity.authorized = auth["authorized"] | false;
  identity.eventId = jsonVariantString(auth["eventId"]);
  identity.interruptedRunId = jsonVariantString(auth["interruptedRunId"]);
  identity.activeRunPath = normalizeSdPath(jsonVariantString(auth["activeRunPath"]));
  identity.activeRunMode = jsonVariantString(auth["activeRunMode"]);
  identity.activeRunFingerprint = jsonVariantString(auth["activeRunFingerprint"]);
  identity.streamPath = normalizeSdPath(jsonVariantString(auth["streamPath"]));
  identity.streamFingerprint = jsonVariantString(auth["streamFingerprint"]);
  identity.streamSizeBytes = auth["streamSizeBytes"] | 0;
  identity.feedStartPercent = doc["feedOverride"]["startPercent"] | 100;
  identity.resetFeedAfterJob = doc["feedOverride"]["resetTo100AfterJob"] | true;

  for (JsonObjectConst event : doc["recoveryHistory"].as<JsonArrayConst>()) {
    if (jsonVariantString(event["id"]) != wantedEventId) continue;
    identity.eventMatches = jsonVariantString(event["type"]) == "production-resume" &&
                            jsonVariantString(event["state"]) == "started" &&
                            jsonVariantString(event["runId"]) == identity.interruptedRunId &&
                            normalizeSdPath(jsonVariantString(event["activeRunPath"])) == identity.activeRunPath &&
                            jsonVariantString(event["activeRunMode"]) == identity.activeRunMode &&
                            jsonVariantString(event["activeRunFingerprint"]) == identity.activeRunFingerprint &&
                            jsonVariantString(event["phase1CompletedAt"]).length() > 0 &&
                            jsonVariantString(event["manualRouterConfirmedAt"]).length() > 0 &&
                            normalizeSdPath(jsonVariantString(event["streamPath"])) == identity.streamPath;
    break;
  }
  return true;
}

bool validateProductionResumeIdentity(const ProductionResumeIdentity &identity,
                                      const String &path, const String &activeRunPath,
                                      const String &activeRunMode, const String &activeRunFingerprint,
                                      const String &eventId, const String &interruptedRunId,
                                      const String &streamFingerprint, size_t streamSizeBytes,
                                      String &error) {
  if (!identity.authorized || !identity.eventMatches || identity.eventId != eventId ||
      identity.interruptedRunId != interruptedRunId || identity.activeRunPath != activeRunPath ||
      identity.activeRunMode != activeRunMode || identity.activeRunFingerprint != activeRunFingerprint ||
      identity.streamPath != path || identity.streamFingerprint != streamFingerprint ||
      identity.streamSizeBytes != streamSizeBytes) {
    error = "Production Resume metadata or stream identity is stale";
    return false;
  }
  return activeRunFileMatches(path, streamSizeBytes, streamFingerprint, error);
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

void handleRecoveryCheckpointGet() {
  String body;
  const bool available = readPersistentJobCheckpoint(body);
  String json = "{\"available\":";
  json += available ? "true" : "false";
  json += ",\"requiresReview\":";
  json += recoveryCheckpointRequiresReview ? "true" : "false";
  json += ",\"bootInterrupted\":";
  json += bootInterruptedJobDetected ? "true" : "false";
  json += ",\"requiresHoming\":";
  json += bootInterruptedJobDetected ? "true" : "false";
  json += ",\"resetReason\":\"" + jsonEscape(recoveryCheckpointResetReason) + "\"";
  json += ",\"checkpoint\":";
  json += available ? body : "null";
  json += "}";
  server.send(200, "application/json", json);
}

void handleRecoveryCheckpointAcknowledge() {
  if (jobIsActive() || jobCheckpointTracking) {
    sendJsonError(409, "cannot clear recovery evidence while a job or motion stream is active");
    return;
  }
  if (!server.hasArg("plain") || !extractJsonBool(server.arg("plain"), "confirmed", false)) {
    sendJsonError(400, "confirmed true is required after importing or deliberately dismissing recovery evidence");
    return;
  }
  clearPersistentJobCheckpoint();
  logJobEvent("recovery checkpoint acknowledged by operator");
  server.send(200, "application/json", "{\"ok\":true,\"message\":\"Recovery checkpoint cleared. Machine position remains untrusted until Home All.\"}");
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
  const String jobPath = normalizeSdPath(extractJsonString(body, "jobPath"));
  const String mode = extractJsonString(body, "mode");
  const float safeZ = extractJsonFloat(body, "safeZ", NAN);
  if (!isPathUnderRoot(path, "/jobs/generated")) {
    sendJsonError(400, "test motion path must be under /jobs/generated");
    return;
  }
  if (mode != "aircut" && mode != "toolless") {
    sendJsonError(400, "test motion mode must be aircut or toolless");
    return;
  }
  float projectSafeZ = NAN;
  String projectSafeZError;
  if (!isPathUnderRoot(jobPath, "/jobs") ||
      !loadProjectSafeZ(jobPath, projectSafeZ, projectSafeZError) ||
      fabsf(projectSafeZ - safeZ) > 0.001f) {
    sendJsonError(409, projectSafeZError.length() > 0
                           ? projectSafeZError
                           : "test motion Safe Z does not match project metadata");
    return;
  }
  String safeZError;
  if (!validateSafeWorkZ(safeZ, true, safeZError)) {
    sendJsonError(400, safeZError);
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
  resetMotionTimingState();
  resetMotionTelemetry();
  motionTelemetryDropped = 0;
  clearPriorityCommands();
  jobStatus.state = JobRunnerState::Preparing;
  jobStatus.gcodePath = path;
  jobStatus.activeRunMode = "generated";
  jobStatus.authorizationActiveRunPath = path;
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
  const String streamFingerprint = extractJsonString(body, "streamFingerprint");
  const int requestedStreamSize = extractJsonInt(body, "streamSizeBytes", -1);
  const String eventId = extractJsonString(body, "eventId");
  const String interruptedRunId = extractJsonString(body, "interruptedRunId");
  const float requestedSafeZ = extractJsonFloat(body, "safeZ", NAN);

  if (!isPathUnderRoot(path, "/jobs/generated") || !path.endsWith(".production-resume.gc")) {
    sendJsonError(400, "Production Resume path must be a generated .production-resume.gc file");
    return;
  }
  if (!isPathUnderRoot(jobPath, "/jobs") || !SD_MMC.exists(jobPath)) {
    sendJsonError(404, "job JSON not found");
    return;
  }
  ProductionResumeIdentity identity;
  String identityError;
  if (!loadProductionResumeIdentity(jobPath, eventId, identity, identityError)) {
    sendJsonError(400, identityError);
    return;
  }
  float projectSafeZ = NAN;
  String projectSafeZError;
  if (!loadProjectSafeZ(jobPath, projectSafeZ, projectSafeZError) ||
      !isfinite(requestedSafeZ) || fabsf(projectSafeZ - requestedSafeZ) > 0.001f ||
      !validateSafeWorkZ(projectSafeZ, true, projectSafeZError)) {
    sendJsonError(409, projectSafeZError.length() > 0
                           ? projectSafeZError
                           : "Production Resume Safe Z does not match project metadata");
    return;
  }
  if (requestedStreamSize <= 0 ||
      !validateProductionResumeIdentity(identity, path, activeRunPath, activeRunMode,
                                        activeRunFingerprint, eventId, interruptedRunId,
                                        streamFingerprint, static_cast<size_t>(requestedStreamSize),
                                        identityError)) {
    sendJsonError(409, identityError.length() > 0 ? identityError
                                                  : "Production Resume identity is invalid");
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
  resetMotionTimingState();
  resetMotionTelemetry();
  motionTelemetryDropped = 0;
  clearPriorityCommands();
  jobStatus.state = JobRunnerState::Preparing;
  jobStatus.gcodePath = path;
  jobStatus.jobPath = jobPath;
  jobStatus.activeRunMode = activeRunMode;
  jobStatus.activeRunFingerprint = activeRunFingerprint;
  jobStatus.authorizationActiveRunPath = activeRunPath;
  jobStatus.startMode = "prepared_production_resume";
  jobStatus.streamMode = "production-resume";
  jobStatus.allowedWorkspaceCommands = false;
  jobStatus.feedOverridePercent = identity.feedStartPercent >= 10 && identity.feedStartPercent <= 200
                                      ? identity.feedStartPercent
                                      : 100;
  jobStatus.resetFeedOverrideAfterJob = identity.resetFeedAfterJob;
  jobStatus.startedAtMs = millis();
  touchJobStatus();

  File sizeFile = SD_MMC.open(path, FILE_READ);
  jobStatus.fileSize = sizeFile ? sizeFile.size() : 0;
  if (sizeFile) sizeFile.close();
  if (!openJobFileAtOffset()) {
    sendJsonError(500, jobStatus.lastError);
    return;
  }
  if (!beginPersistentJobCheckpoint()) {
    setJobError("could not persist the active-job checkpoint");
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
  const String activeRunFingerprint = extractJsonString(body, "activeRunFingerprint");
  const int requestedActiveRunSize = extractJsonInt(body, "activeRunSizeBytes", -1);
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
  const float safeStartZ = extractJsonFloat(body, "safeStartZ", NAN);
  String safeZError;
  if (!validateSafeWorkZ(safeStartZ, true, safeZError)) {
    sendJsonError(400, safeZError);
    return;
  }
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
  JobExecutionAuthorization authorization;
  String authorizationError;
  if (!loadJobExecutionAuthorization(jobPath, authorization, authorizationError)) {
    sendJsonError(400, authorizationError);
    return;
  }
  float projectSafeZ = NAN;
  if (!loadProjectSafeZ(jobPath, projectSafeZ, authorizationError) ||
      fabsf(projectSafeZ - safeStartZ) > 0.001f) {
    sendJsonError(409, authorizationError.length() > 0
                           ? authorizationError
                           : "job start Safe Z does not match project metadata");
    return;
  }
  const uint32_t normalizedHomingEpoch = requestedHomingEpoch >= 0
                                             ? static_cast<uint32_t>(requestedHomingEpoch)
                                             : 0;
  if (requestedActiveRunSize <= 0 ||
      !validateJobExecutionAuthorization(authorization, gcodePath, activeRunMode,
                                         activeRunFingerprint,
                                         static_cast<size_t>(requestedActiveRunSize),
                                         requestedWorkZeroId, normalizedHomingEpoch,
                                         requestedHomingSessionId, authorizationError)) {
    sendJsonError(409, authorizationError.length() > 0 ? authorizationError
                                                       : "active run authorization is invalid");
    return;
  }

  jobStatus = JobRunnerStatus();
  marlinAsyncLine = "";
  streamMotionMode = "G0";
  resetMotionTimingState();
  resetMotionTelemetry();
  motionTelemetryDropped = 0;
  clearPriorityCommands();
  jobStatus.state = JobRunnerState::Preparing;
  jobStatus.gcodePath = gcodePath;
  jobStatus.jobPath = jobPath;
  jobStatus.activeRunMode = activeRunMode;
  jobStatus.activeRunFingerprint = activeRunFingerprint;
  jobStatus.authorizationActiveRunPath = gcodePath;
  jobStatus.workZeroId = requestedWorkZeroId;
  jobStatus.homingEpoch = normalizedHomingEpoch;
  jobStatus.homingSessionId = requestedHomingSessionId;
  jobStatus.startMode = startMode;
  jobStatus.safeStartZ = safeStartZ;
  jobStatus.travelFeedMmMin = travelFeedMmMin;
  jobStatus.allowedWorkspaceCommands = authorization.allowedWorkspaceCommands;
  jobStatus.feedOverridePercent = authorization.feedStartPercent >= 10 && authorization.feedStartPercent <= 200
                                      ? authorization.feedStartPercent
                                      : 100;
  jobStatus.resetFeedOverrideAfterJob = authorization.resetFeedAfterJob;
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
  if (!beginPersistentJobCheckpoint()) {
    setJobError("could not persist the active-job checkpoint");
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

  jobStatus.pauseRequested = true;
  jobStatus.stopRequested = false;
  jobStatus.directResumeValid = true;
  jobStatus.recoveryRequired = false;
  jobStatus.pauseInterruptedForManualMotion = false;
  jobStatus.state = JobRunnerState::Pausing;
  if (machineProfile.capRealtimeReporting) {
    addMarlinLog("tx", true, "P000");
    Serial.print("P000\n");
    jobStatus.pauseRealtimeHold = true;
    jobStatus.pauseMode = "realtime";
    jobStatus.state = JobRunnerState::PausedIntact;
    jobStatus.pauseRequested = false;
    jobStatus.pausedAtMs = millis();
    jobStatus.streamingPausedReason =
        "Motion held — cutter remains running. Direct Resume is valid until any manual movement.";
  } else {
    jobStatus.pauseRealtimeHold = false;
    jobStatus.pauseMode = "boundary";
    jobStatus.streamingPausedReason =
        "Pause pending at the next safely resumable command boundary; cutter remains running.";
  }
  touchJobStatus();
  logJobEvent("pause requested: " + jobStatus.gcodePath +
              " mode=" + jobStatus.pauseMode);
  server.send(200, "application/json",
              jobStatusJsonWithMessage(
                  machineProfile.capRealtimeReporting
                      ? "Realtime hold requested with P000. Motion held — cutter remains running."
                      : "Pause pending. The current command will finish before PAUSED_INTACT."));
}

void handleJobResume() {
  if (jobStatus.state == JobRunnerState::Paused && jobStatus.toolChangePending) {
    sendJsonError(409, "complete the pending tool change before resuming");
    return;
  }
  if (jobStatus.state != JobRunnerState::PausedIntact || !jobStatus.directResumeValid) {
    sendJsonError(409, "direct Resume is unavailable; review Recovery");
    return;
  }
  if (jobStatus.stopRequested) {
    sendJsonError(409, "job stop has been requested");
    return;
  }
  const bool realtimeHold = jobStatus.pauseRealtimeHold;
  if (!realtimeHold && !openJobFileAtOffset()) {
    sendJsonError(500, jobStatus.lastError);
    return;
  }

  jobStatus.pauseRequested = false;
  jobStatus.streamingPausedReason = "";
  jobStatus.state = JobRunnerState::Resuming;
  if (realtimeHold) {
    addMarlinLog("tx", true, "R000");
    Serial.print("R000\n");
  } else {
    jobResponseBuffer = "";
    jobWaitingForOk = false;
  }
  jobStatus.pauseRealtimeHold = false;
  jobStatus.directResumeValid = false;
  jobStatus.pauseMode = "none";
  touchJobStatus();
  logJobEvent("resume: " + jobStatus.gcodePath);
  server.send(200, "application/json", jobStatusJsonWithMessage("Resume requested."));
}

void handleToolChangeComplete() {
  if (jobStatus.state != JobRunnerState::Paused || !jobStatus.toolChangePending ||
      !jobStatus.toolChangeReady) {
    sendJsonError(409, "no completed M6 stop is waiting for confirmation");
    return;
  }
  if (!server.hasArg("plain") || !extractJsonBool(server.arg("plain"), "confirmed", false)) {
    sendJsonError(400, "confirmed true is required after the tool has been installed");
    return;
  }
  if (!extractJsonBool(server.arg("plain"), "routerReady", false)) {
    sendJsonError(400, "routerReady true is required after verifying the router or spindle state");
    return;
  }
  if (jogIsActive() || priorityCommandCount > 0 || jobStatus.priorityCommandInProgress) {
    sendJsonError(409, "stop jog motion before completing the tool change");
    return;
  }
  if (!jobStatus.toolChangeZZeroCompleted) {
    sendJsonError(409, "set Z zero manually or with the configured touch plate before continuing");
    return;
  }
  if (!openJobFileAtOffset()) {
    sendJsonError(500, jobStatus.lastError);
    return;
  }
  if (jobStatus.toolChangeHandling == "park") {
    if (!jobStatus.toolChangeReturnPositionCaptured || !machineFrame.absoluteFromHome) {
      sendJsonError(409, "the pre-park return position is unavailable; stop and recover the job manually");
      return;
    }
    String parkError;
    if (!toolChangeParkIsWithinMachine(parkError)) {
      sendJsonError(409, parkError + "; update tool-change settings before continuing");
      return;
    }
    clearPriorityCommands();
    const String returnCommands[] = {
        "G21", "G90",
        "G53 G0 Z" + String(toolChangeSettings.parkMachineZ, 3) + " F" + String(kJobStartZFeed, 0),
        "M400", "G54",
        "G0 X" + String(jobStatus.toolChangeReturnWorkX, 3) +
            " Y" + String(jobStatus.toolChangeReturnWorkY, 3) +
            " F" + String(jobStatus.travelFeedMmMin, 0),
        "M400",
        "G0 Z" + String(jobStatus.toolChangeReturnWorkZ, 3) + " F" + String(kJobStartZFeed, 0),
        "M400", "M114",
    };
    for (const String &command : returnCommands) {
      if (!appendPriorityCommand(command)) {
        setJobError("Tool-change return sequence is too large for priority queue");
        sendJsonError(500, jobStatus.lastError);
        return;
      }
    }
    jobStatus.lastPriorityCommand = "";
    jobStatus.lastPriorityResponse = "";
    jobStatus.lastPriorityError = "";
  }

  jobStatus.activeToolNumber = jobStatus.toolChangeToolNumber;
  jobStatus.toolChangeToolConfirmed = true;
  jobStatus.toolChangeRouterReadyConfirmed = true;
  jobStatus.toolChangePhase = "RESUMING";
  jobStatus.toolChangePending = false;
  jobStatus.toolChangeReady = false;
  jobStatus.pauseRequested = false;
  jobStatus.streamingPausedReason = "";
  jobStatus.state = JobRunnerState::Resuming;
  jobResponseBuffer = "";
  jobWaitingForOk = false;
  jobStatus.lastAcknowledgedByteOffset = jobStatus.currentByteOffset;
  jobStatus.lastAcknowledgedLineNumber = jobStatus.currentLineNumber;
  if (!persistToolChangeTransition()) {
    setJobError("could not persist confirmed tool-change state");
    sendJsonError(500, jobStatus.lastError);
    return;
  }
  logJobEvent("tool change confirmed: T" + String(jobStatus.activeToolNumber));
  server.send(200, "application/json", jobStatusJsonWithMessage("Tool change confirmed. Resume requested."));
}

bool beginPausedManualInterruption() {
  if (jobStatus.state != JobRunnerState::PausedIntact || !jobStatus.directResumeValid) return false;
  if (jobFile) jobFile.close();
  jobWaitingForOk = false;
  jobResponseBuffer = "";
  jobRunning = false;
  jobStatus.pauseRequested = false;
  jobStatus.stopRequested = true;
  jobStatus.directResumeValid = false;
  jobStatus.recoveryRequired = true;
  jobStatus.pauseInterruptedForManualMotion = true;
  jobStatus.state = JobRunnerState::Stopping;
  jobStatus.stopEmergencyParserDetected = machineProfile.capEmergencyParser;
  jobStatus.stopWarning = machineProfile.capEmergencyParser
                              ? ""
                              : "Marlin EMERGENCY_PARSER was not detected. Held motion cancellation may not be immediate.";
  jobStatus.streamingPausedReason =
      "Manual movement requested. Cancelling direct Resume with M410; M5 follows only after motion stops.";
  startImmediateStopPrioritySequence();
  if (writePersistentJobCheckpoint(false, true, "manual movement invalidated intact pause")) {
    jobCheckpointTracking = false;
  } else {
    logJobEvent("warning: could not persist paused manual-movement evidence");
  }
  invalidateMachineFrameAfterQuickstop();
  touchJobStatus();
  logJobEvent("paused direct Resume invalidated for manual movement");
  return true;
}

void handlePausedManualInterruption() {
  if (jobStatus.state == JobRunnerState::RecoveryRequired) {
    server.send(200, "application/json",
                jobStatusJsonWithMessage("Direct Resume is invalid. Manual movement may proceed through Recovery."));
    return;
  }
  if (!beginPausedManualInterruption()) {
    sendJsonError(409, "job is not in PAUSED_INTACT");
    return;
  }
  server.send(202, "application/json",
              jobStatusJsonWithMessage(
                  "Direct Resume invalidated. Wait for RECOVERY_REQUIRED before manual movement."));
}

void handleJobStop() {
  if (jobStatus.state == JobRunnerState::Stopping) {
    server.send(200, "application/json",
                jobStatusJsonWithMessage("Stop now already requested. M410 quickstop is in progress."));
    return;
  }
  if (jobStatus.state != JobRunnerState::Preparing && jobStatus.state != JobRunnerState::Running &&
      jobStatus.state != JobRunnerState::Pausing &&
      jobStatus.state != JobRunnerState::PausedIntact &&
      jobStatus.state != JobRunnerState::Paused &&
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
  jobStatus.directResumeValid = false;
  jobStatus.recoveryRequired = true;
  jobStatus.pauseInterruptedForManualMotion = false;
  jobStatus.toolChangePending = false;
  jobStatus.toolChangeReady = false;
  jobStatus.toolChangeZZeroCompleted = false;
  jobStatus.toolChangeParked = false;
  jobStatus.toolChangeToolConfirmed = false;
  jobStatus.toolChangeRouterReadyConfirmed = false;
  jobStatus.toolChangePhase = "NONE";
  jobStatus.state = JobRunnerState::Stopping;
  jobStatus.stopEmergencyParserDetected = machineProfile.capEmergencyParser;
  jobStatus.stopWarning = machineProfile.capEmergencyParser
                              ? ""
                              : "Marlin EMERGENCY_PARSER was not detected. M410 was sent first, but immediate interruption cannot be guaranteed.";
  jobStatus.streamingPausedReason = machineProfile.capEmergencyParser
                                        ? "Stop now requested. M410 quickstop was sent; M5 output shutdown will follow. Position is untrusted until Home All."
                                        : jobStatus.stopWarning + " Position is untrusted until Home All.";
  startImmediateStopPrioritySequence();
  invalidateMachineFrameAfterQuickstop();
  touchJobStatus();
  logJobEvent("stop requested: " + jobStatus.gcodePath +
              " emergencyParser=" + String(machineProfile.capEmergencyParser ? "detected" : "not-detected"));
  server.send(200, "application/json",
              jobStatusJsonWithMessage(
                  machineProfile.capEmergencyParser
                      ? "Stop now requested. Position and recovery must be verified after M410 quickstop."
                      : "Stop now requested, but Marlin EMERGENCY_PARSER was not detected; immediate interruption cannot be guaranteed. Home All before further motion."));
}

void handleJogStatus() {
  server.send(200, "application/json", jogStatusJson());
}

void handleJogStart() {
  if (jobStatus.state == JobRunnerState::PausedIntact) {
    beginPausedManualInterruption();
    sendJsonError(409, "direct Resume was invalidated; wait for RECOVERY_REQUIRED before jogging");
    return;
  }
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
  const String projectJobPath = normalizeSdPath(extractJsonString(body, "jobPath"));
  const float requestedSafeWorkZ = extractJsonFloat(body, "safeWorkZ", NAN);
  jogStatus = JogStatus();
  jogStatus.safeJog = extractJsonBool(body, "safeJog", true);
  jogStatus.safeLiftZ = extractJsonFloat(body, "safeLiftZ", machineZMax());
  if (jogStatus.safeJog && projectJobPath.length() > 0) {
    float projectSafeZ = NAN;
    String projectSafeZError;
    if (!isPathUnderRoot(projectJobPath, "/jobs") ||
        !machineFrame.absoluteFromHome || !machineFrame.workZeroValid ||
        !loadProjectSafeZ(projectJobPath, projectSafeZ, projectSafeZError) ||
        !isfinite(requestedSafeWorkZ) || fabsf(projectSafeZ - requestedSafeWorkZ) > 0.001f ||
        fabsf((machineFrame.workZeroMachineZ + projectSafeZ) - jogStatus.safeLiftZ) > 0.001f) {
      sendJsonError(409, projectSafeZError.length() > 0
                             ? projectSafeZError
                             : "safe jog does not match the trusted project Safe Z");
      return;
    }
  }
  if (jogStatus.safeJog && (!isfinite(jogStatus.safeLiftZ) || jogStatus.safeLiftZ < machineZMin() ||
                            jogStatus.safeLiftZ > machineZMax())) {
    sendJsonError(400, "safe jog machine Z is outside the current machine limits");
    return;
  }
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
  touchJogStatus();
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

bool toolChangeZZeroWindowOpen() {
  return jobStatus.state == JobRunnerState::Paused && jobStatus.toolChangePending &&
         jobStatus.toolChangeReady && !jogIsActive() && priorityCommandCount == 0 &&
         !jobStatus.priorityCommandInProgress && machineDiscoveryState == MachineDiscoveryState::Idle &&
         !otaActive;
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
  touchPositionStatus();
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
  touchPositionStatus();
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
  touchPositionStatus();
  String json = "{\"ok\":true,\"axes\":\"" + axes + "\",\"before\":\"" +
                jsonEscape(before) + "\",\"after\":\"" + jsonEscape(after) +
                "\",\"frame\":" + machineFrameJson() + "}";
  server.send(200, "application/json", json);
}

void handleSetZZero() {
  const bool toolChangeZZero = toolChangeZZeroWindowOpen();
  if (machineFrameControlBusy() && !toolChangeZZero) {
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
  if (toolChangeZZero) {
    jobStatus.toolChangeZZeroCompleted = true;
    jobStatus.toolChangeZZeroMethod = "manual";
    jobStatus.toolChangePhase = "READY_TO_CONTINUE";
    if (!persistToolChangeTransition()) {
      setJobError("could not persist manual tool-change Z-zero state");
      sendJsonError(500, jobStatus.lastError);
      return;
    }
    logJobEvent("tool change Z zero completed manually");
  }
  touchPositionStatus();
  String json = "{\"ok\":true,\"before\":\"" + jsonEscape(before) + "\",\"after\":\"" +
                jsonEscape(after) + "\",\"frame\":" + machineFrameJson() + "}";
  server.send(200, "application/json", json);
}

void handleTouchPlateZZero() {
  const bool toolChangeZZero = toolChangeZZeroWindowOpen();
  if (machineFrameControlBusy() && !toolChangeZZero) {
    sendJsonError(409, "touch-plate Z zero requires idle Marlin transport or a ready M6 stop");
    return;
  }
  if (!toolChangeSettings.touchPlateEnabled) {
    sendJsonError(409, "touch plate is not enabled in Tool Change settings");
    return;
  }
  if ((!machineFrame.machineValid && !machineFrame.manualWorkFrameValid) || !machineFrame.workZeroValid) {
    sendJsonError(409, "an active homed or manually confirmed work frame is required before probing Z zero");
    return;
  }

  String before;
  String response;
  String contact;
  String after;
  auto failProbe = [&](const String &message) {
    String restoreResponse;
    runFrameCommand("G90", restoreResponse);
    sendJsonError(502, message + ": " + response);
  };
  if (!runFrameCommand("M5", response) || !runFrameCommand("M400", response, 120000) ||
      !runFrameCommand("G21", response) || !runFrameCommand("G90", response) ||
      !runFrameCommand("G54", response) || !runFrameCommand("M114", before)) {
    failProbe("Marlin did not prepare touch-plate probing");
    return;
  }
  if (!runFrameCommand("G91", response)) {
    failProbe("Marlin did not enter relative mode for touch-plate probing");
    return;
  }
  const String probeCommand = "G38.2 Z-" + String(toolChangeSettings.touchPlateProbeDistance, 3) +
                              " F" + String(toolChangeSettings.touchPlateProbeFeed, 1);
  if (!runFrameCommand(probeCommand, response, 120000) || !runFrameCommand("G90", response) ||
      !runFrameCommand("M400", response, 120000) || !runFrameCommand("M114", contact)) {
    failProbe("Touch plate was not reached within the configured probe distance");
    return;
  }
  const float contactMachineZ = machineFrame.machineZ;
  const String zeroCommand = "G92 Z" + String(toolChangeSettings.touchPlateThickness, 3);
  const float retractTarget = toolChangeSettings.touchPlateThickness + toolChangeSettings.touchPlateRetractDistance;
  const String retractCommand = "G0 Z" + String(retractTarget, 3) + " F" +
                                String(toolChangeSettings.touchPlateProbeFeed, 1);
  if (!runFrameCommand(zeroCommand, response) || !runFrameCommand(retractCommand, response, 120000) ||
      !runFrameCommand("M400", response, 120000) || !runFrameCommand("M114", after)) {
    failProbe("Touch-plate Z zero or retract failed");
    return;
  }

  if (machineFrame.absoluteFromHome) {
    machineFrame.workZeroMachineZ = contactMachineZ - toolChangeSettings.touchPlateThickness;
  }
  machineFrame.workZeroValid = true;
  machineFrame.updatedAtMs = millis();
  ++machineFrame.revision;
  if (toolChangeZZero) {
    jobStatus.toolChangeZZeroCompleted = true;
    jobStatus.toolChangeZZeroMethod = "touchplate";
    jobStatus.toolChangePhase = "READY_TO_CONTINUE";
    if (!persistToolChangeTransition()) {
      setJobError("could not persist touch-plate tool-change Z-zero state");
      sendJsonError(500, jobStatus.lastError);
      return;
    }
    logJobEvent("tool change Z zero completed with touch plate");
  }
  touchPositionStatus();
  String json = "{\"ok\":true,\"method\":\"touchplate\",\"probeCommand\":\"" +
                jsonEscape(probeCommand) + "\",\"before\":\"" + jsonEscape(before) +
                "\",\"contact\":\"" + jsonEscape(contact) + "\",\"after\":\"" +
                jsonEscape(after) + "\",\"frame\":" + machineFrameJson() + "}";
  server.send(200, "application/json", json);
}

void handleGoToWorkZero() {
  if (jobStatus.state == JobRunnerState::PausedIntact) {
    beginPausedManualInterruption();
    sendJsonError(409, "direct Resume was invalidated; wait for RECOVERY_REQUIRED before moving");
    return;
  }
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
  const String projectJobPath = normalizeSdPath(extractJsonString(body, "jobPath"));
  const float travelFeedMmMin = clampFloat(
      extractJsonFloat(body, "travelFeedMmMin", kDefaultTravelFeed), 600.0f, 6000.0f);
  if (safeMove) {
    String safeZError;
    if (projectJobPath.length() > 0) {
      float projectSafeZ = NAN;
      if (!isPathUnderRoot(projectJobPath, "/jobs") ||
          !loadProjectSafeZ(projectJobPath, projectSafeZ, safeZError) ||
          fabsf(projectSafeZ - safeZ) > 0.001f) {
        sendJsonError(409, safeZError.length() > 0
                               ? safeZError
                               : "work-zero move Safe Z does not match project metadata");
        return;
      }
    }
    if (!validateSafeWorkZ(safeZ, true, safeZError)) {
      sendJsonError(400, safeZError);
      return;
    }
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
  touchPositionStatus();

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
  body += "<label for=\"ota-pin\">Operator PIN</label>";
  body += "<input id=\"ota-pin\" type=\"password\" inputmode=\"numeric\" autocomplete=\"current-password\">";
  body += "<button id=\"ota-unlock\" type=\"button\">Unlock OTA for 2 minutes</button>";
  body += "<p id=\"ota-unlock-status\" class=\"form-hint\">OTA upload stays locked until the active operator confirms the PIN.</p>";
  body += "<form method=\"post\" action=\"/api/update\" enctype=\"multipart/form-data\">";
  body += "<input type=\"file\" name=\"firmware\" accept=\".bin\" required>";
  body += "<button type=\"submit\">Upload Firmware</button>";
  body += "</form>";
  body += "<a class=\"maintenance-link\" href=\"/\">Back to pendant</a>";
  body += "<script>document.querySelector('#ota-unlock').addEventListener('click',async()=>{";
  body += "const status=document.querySelector('#ota-unlock-status');";
  body += "const pin=document.querySelector('#ota-pin').value;";
  body += "try{const response=await fetch('/api/operator/ota-unlock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})});";
  body += "const data=await response.json();if(!response.ok)throw new Error(data.error||'Unlock failed');status.textContent=data.message;}";
  body += "catch(error){status.textContent=error.message;}}</script>";
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

    if (!operatorOtaUnlocked()) {
      otaError = "OTA is locked. Confirm the operator PIN on the update page.";
      return;
    }
    operatorOtaUnlockedUntilMs = 0;
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
  logHttpRequest();
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
  const bool started = WiFi.softAP(kSetupApSsid, kSetupApPassword);
  activeWifiMode = mode == WIFI_AP_STA ? "ap+sta" : "ap";
  activeWifiSsid = kSetupApSsid;
  logSystemEvent("WiFi AP started=" + String(started ? "true" : "false") + " mode=" + activeWifiMode +
                 " ssid=" + activeWifiSsid + " ip=" + WiFi.softAPIP().toString() +
                 " stations=" + String(WiFi.softAPgetStationNum()));
}

bool tryWifiSta(const String &ssid, const String &pass) {
  startWifiAp(WIFI_AP_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());

  const uint32_t start = millis();
  while (millis() - start < kStaConnectTimeoutMs) {
    if (WiFi.status() == WL_CONNECTED) {
      activeWifiMode = "ap+sta";
      activeWifiSsid = ssid;
      logSystemEvent("WiFi STA connected ssid=" + ssid + " ip=" + WiFi.localIP().toString());
      return true;
    }
    delay(250);
  }

  WiFi.disconnect(true);
  activeWifiMode = "ap";
  activeWifiSsid = kSetupApSsid;
  logSystemEvent("WiFi STA timeout ssid=" + ssid + "; continuing with AP");
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
  if (!deviceIdentity.mdnsEnabled) {
    logSystemEvent("mDNS start failed hostname=" + deviceIdentity.hostname);
    return;
  }

  MDNS.addService("http", "tcp", 80);
  MDNS.addService("esp32cnc", "tcp", 80);
  MDNS.addServiceTxt("http", "tcp", "name", deviceIdentity.friendlyName);
  MDNS.addServiceTxt("esp32cnc", "tcp", "id", deviceIdentity.deviceId);
  MDNS.addServiceTxt("esp32cnc", "tcp", "name", deviceIdentity.friendlyName);
  logSystemEvent("mDNS started hostname=" + deviceIdentity.hostname + ".local");
}

void startHttpServer() {
  logSystemEvent("HTTP setup starting port=80");
  const char *collectedHeaders[] = {"Cookie"};
  server.collectHeaders(collectedHeaders, 1);
  httpRoute("/", HTTP_GET, handleIndex);
  httpRoute("/index.html", HTTP_GET, handleIndex);
  httpRoute("/files", HTTP_GET, handleFilesPage);
  httpRoute("/app.js", HTTP_GET, handleAppJs);
  httpRoute("/files.js", HTTP_GET, handleFilesJs);
  httpRoute("/style.css", HTTP_GET, handleStyleCss);
  httpRoute("/api/operator/status", HTTP_GET, handleOperatorStatus);
  httpRoute("/api/operator/claim", HTTP_POST, handleOperatorClaim);
  httpRoute("/api/operator/reconnect", HTTP_POST, handleOperatorReconnect);
  httpRoute("/api/operator/heartbeat", HTTP_POST, handleOperatorHeartbeat);
  httpRoute("/api/operator/release", HTTP_POST, handleOperatorRelease);
  httpRoute("/api/operator/pin", HTTP_PUT, handleOperatorPinUpdate);
  httpRoute("/api/operator/ota-unlock", HTTP_POST, handleOperatorOtaUnlock);
  httpRoute("/api/health", HTTP_GET, handleHealth);
  httpRoute("/api/tool-change/settings", HTTP_GET, handleToolChangeSettingsGet);
  operatorRoute("/api/tool-change/settings", HTTP_PUT, handleToolChangeSettingsPut);
  httpRoute("/api/device", HTTP_GET, handleDeviceInfo);
  operatorRoute("/api/device", HTTP_PATCH, handleDeviceUpdate);
  operatorRoute("/api/system/restart", HTTP_POST, handleSystemRestart);
  httpRoute("/api/machine/info", HTTP_GET, handleMachineInfo);
  operatorRoute("/api/machine/refresh", HTTP_POST, handleMachineRefresh);
  operatorRoute("/api/machine/apply", HTTP_POST, handleMachineApply);
  operatorRoute("/api/machine/save", HTTP_POST, handleMachineSave);
  httpRoute("/api/machine/frame", HTTP_GET, handleMachineFrame);
  operatorRoute("/api/machine/home", HTTP_POST, handleMachineHome);
  operatorRoute("/api/machine/manual-frame", HTTP_POST, handleManualMachineFrame);
  httpRoute("/api/marlin/log", HTTP_GET, handleMarlinLog);
  operatorRoute("/api/cmd", HTTP_POST, handleCommand);
  httpRoute("/api/ui/status", HTTP_GET, handleUiStatus);
  httpRoute("/api/sd/status", HTTP_GET, handleSdStatus);
  httpRoute("/api/files", HTTP_GET, handleFilesList);
  httpRoute("/api/download", HTTP_GET, handleDownload);
  server.on("/api/upload", HTTP_POST,
            []() { logHttpRequest(); if (requireOperatorControl()) handleUploadComplete(); },
            []() { if (operatorRequestAuthorized()) handleUploadData(); });
  operatorRoute("/api/delete", HTTP_POST, handleDelete);
  operatorRoute("/api/mkdir", HTTP_POST, handleMkdir);
  operatorRoute("/api/rename", HTTP_POST, handleRename);
  operatorRoute("/api/job/start", HTTP_POST, handleJobStart);
  httpRoute("/api/job/status", HTTP_GET, handleJobStatus);
  operatorRoute("/api/test-motion/start", HTTP_POST, handleTestMotionStart);
  operatorRoute("/api/recovery/production/start", HTTP_POST, handleProductionResumeStart);
  httpRoute("/api/recovery/checkpoint", HTTP_GET, handleRecoveryCheckpointGet);
  operatorRoute("/api/recovery/checkpoint/acknowledge", HTTP_POST, handleRecoveryCheckpointAcknowledge);
  operatorRoute("/api/job/pause", HTTP_POST, handleJobPause);
  operatorRoute("/api/job/resume", HTTP_POST, handleJobResume);
  operatorRoute("/api/job/interrupt-for-manual-motion", HTTP_POST, handlePausedManualInterruption);
  operatorRoute("/api/job/tool-change/complete", HTTP_POST, handleToolChangeComplete);
  operatorRoute("/api/job/stop", HTTP_POST, handleJobStop);
  operatorRoute("/api/job/feed-override", HTTP_POST, handleJobFeedOverride);
  operatorRoute("/api/jog/start", HTTP_POST, handleJogStart);
  operatorRoute("/api/jog/update", HTTP_POST, handleJogUpdate);
  operatorRoute("/api/jog/stop", HTTP_POST, handleJogStop);
  operatorRoute("/api/jog/restore-z", HTTP_POST, handleJogRestoreZ);
  httpRoute("/api/jog/status", HTTP_GET, handleJogStatus);
  operatorRoute("/api/work-zero/goto", HTTP_POST, handleGoToWorkZero);
  operatorRoute("/api/work-zero/set", HTTP_POST, handleSetWorkZero);
  operatorRoute("/api/work-zero/set-z", HTTP_POST, handleSetZZero);
  operatorRoute("/api/work-zero/touch-plate", HTTP_POST, handleTouchPlateZZero);
  operatorRoute("/api/work-zero/restore", HTTP_POST, handleRestoreWorkZero);
  httpRoute("/update", HTTP_GET, handleUpdatePage);
  server.on("/api/update", HTTP_POST,
            []() { logHttpRequest(); if (requireOperatorControl()) handleUpdateComplete(); },
            []() { if (operatorRequestAuthorized()) handleUpdateUpload(); });
  httpRoute("/wifi", HTTP_GET, handleWifiPage);
  operatorRoute("/api/wifi/save", HTTP_POST, handleWifiSave);
  operatorRoute("/api/wifi/forget", HTTP_POST, handleWifiForget);
  server.onNotFound(handleNotFound);
  server.begin();
  logSystemEvent("HTTP server started port=80 apIp=" + WiFi.softAPIP().toString() +
                 " staIp=" + WiFi.localIP().toString());
  telemetryStateMutex = xSemaphoreCreateMutex();
  motionEventQueue = xQueueCreate(16, sizeof(MotionTelemetryEvent));
  logEventQueue = xQueueCreate(32, sizeof(LogTelemetryEvent));

  if (telemetryStateMutex == nullptr || motionEventQueue == nullptr || logEventQueue == nullptr) {
    logSystemEvent("Telemetry initialization failed: allocation error");
    if (telemetryStateMutex) { vSemaphoreDelete(telemetryStateMutex); telemetryStateMutex = nullptr; }
    if (motionEventQueue) { vQueueDelete(motionEventQueue); motionEventQueue = nullptr; }
    if (logEventQueue) { vQueueDelete(logEventQueue); logEventQueue = nullptr; }
    setTelemetryStarted(false);
    return;
  }

  initializeStagedState();

  BaseType_t taskRes = xTaskCreatePinnedToCore(telemetryNetworkTask, "ws-telemetry", 8192, nullptr, 1, &telemetryTaskHandle, 0);
  if (taskRes != pdPASS) {
    logSystemEvent("Telemetry initialization failed: task creation error");
    telemetryTaskHandle = nullptr;
    vSemaphoreDelete(telemetryStateMutex); telemetryStateMutex = nullptr;
    vQueueDelete(motionEventQueue); motionEventQueue = nullptr;
    vQueueDelete(logEventQueue); logEventQueue = nullptr;
    setTelemetryStarted(false);
    return;
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
  loadToolChangeSettings();

  bool sdFirmwareUpdated = false;
  if (checkForSdRescueUpdate()) {
    sdFirmwareUpdated = performSdRescueUpdate();
  } else if (checkForRootFirmwareUpdate()) {
    sdFirmwareUpdated = performRootFirmwareUpdate();
  }
  if (sdFirmwareUpdated) {
    logSystemEvent("Firmware update completed; rebooting");
    delay(1000);
    ESP.restart();
  }

  logSystemEvent("BOOT firmware=" + String(firmwareVersion) + " build=" + String(buildDate) + " " +
                 String(buildTime) + " reset=" + resetReasonName(esp_reset_reason()));
  logSystemEvent("Persistent job checkpoint load starting");
  loadPersistentJobCheckpointAtBoot();
  logSystemEvent("Persistent job checkpoint load complete review=" +
                 String(recoveryCheckpointRequiresReview ? "true" : "false"));

  logSystemEvent("SPIFFS mount starting");
  const bool spiffsMounted = SPIFFS.begin(true);
  logSystemEvent("SPIFFS mount complete mounted=" + String(spiffsMounted ? "true" : "false"));
  logSystemEvent("Device identity load starting");
  loadDeviceIdentity();
  logSystemEvent("Device identity load complete hostname=" + deviceIdentity.hostname +
                 " source=" + deviceIdentity.source);
  loadOperatorSettings();
  logSystemEvent("Operator settings loaded configured=" +
                 String(operatorPinHash.length() > 0 ? "true" : "false"));
  logSystemEvent("WiFi setup starting");
  startWifi();
  logSystemEvent("WiFi setup complete mode=" + activeWifiMode + " ssid=" + activeWifiSsid +
                 " apIp=" + WiFi.softAPIP().toString() + " staIp=" + WiFi.localIP().toString());
  logSystemEvent("mDNS setup starting");
  startMdns();
  logSystemEvent("HTTP setup dispatching");
  startHttpServer();
  logSystemEvent("Bluetooth setup starting");
  startBluetoothAdvertisement();
  logSystemEvent("BOOT complete bluetooth=" + String(deviceIdentity.bluetoothStarted ? "started" : "stopped"));
}

void loop() {
  server.handleClient();
  stageTelemetryUpdates();
  processMachineDiscovery();
  processJobRunner();
  processPersistentJobCheckpoint();
  processJogRunner();
  processMarlinAutoreportControl();
  processIdleMarlinAutoreport();

  if (rebootAtMs > 0 && millis() >= rebootAtMs) {
    logSystemEvent("Scheduled reboot executing");
    ESP.restart();
  }
}
