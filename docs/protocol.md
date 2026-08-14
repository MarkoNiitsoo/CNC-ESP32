# Protocol

## Marlin transport ownership

Firmware `0.5.0-telemetry-transport` treats UART as a single-owner transport. A manual diagnostic
request must not drain or consume a response that belongs to the job runner, a priority sequence,
or Safe Jog. `/api/cmd` therefore returns HTTP `409` while those owners are active. There is no
standalone `M5` exception during an active or resumable job.

Synchronous Marlin reads finish as soon as a complete terminal response line (`ok`, `Error:`,
`Alarm:`, or `!!`) arrives. The configured timeout is now a missing-response ceiling rather than a
fixed delay added to every command.

## Phase 1 WebSocket Application Protocol

The application-level WebSocket protocol operates full-duplex on `ws://<pendant-ip>:81/` (or relative `/ws` on dev origins).

### Architectural Transport Division

- **WebSocket**: authoritative live state, synchronization, and the migrated low-rate machine commands described below.
- **HTTP**: static UI resources, file listing and file transfer, G-code and job JSON, generated files and thumbnails, Aircut workflow, OTA, Wi-Fi and device management.

Historical Phase 1 migrated only state and synchronization; all machine commands remained on HTTP
in that phase. Current Phase 3 additionally carries Stop, Pause, Resume, feed override, Home, Work Zero, and Z Zero over the
authenticated command channel while retaining their operator-protected HTTP routes.

### Packet Envelope & Sequencing

Every application packet uses readable JSON keys and the common envelope:

```json
{
  "protocolVersion": 1,
  "type": "sync",
  "seq": 12,
  "ack": 41,
  "bootId": "esp-A1B2C3D4-E5F60708",
  "stateRevision": 106
}
```

- `protocolVersion`: integer `1`.
- `type`: string.
  - Browser to ESP: `"hello"`, `"sync"`, `"resync"`, `"log"`, `"command"`, `"commandQuery"`.
  - ESP to Browser: `"snapshot"`, `"patch"`, `"sync"`, `"event"`, `"commandAck"`, `"commandResult"`, `"protocol-error"`.
- `seq`: monotonic integer counter per connection and per direction. Assigned and committed ONLY AFTER successful transmission over the transport (`sendTXT`). Failed sends do not consume sequence numbers.
- `ack`: highest contiguous packet sequence number successfully processed from the peer. ACKs must advance monotonically (`lastAck <= ack <= highestSent`). ACKs beyond the highest sent sequence generate a protocol error and trigger resync.
- `bootId`: unique string per ESP boot. Browser discards mirrored state when `bootId` changes.
- `stateRevision`: global authoritative state version counter. Increments ONLY when authoritative state slices change. `snapshot`, `resync`, `sync`, `log`, `motion`, and retries do NOT increment `stateRevision`.
- `patch`: contains complete top-level replacement slices (`system`, `controller`, `machine`, `job`, `jog`, `control`). Complete slices replace mirrored state without shallow recursive merging of nested properties. Browser connection state (`connection`) is transport-local client state only and is not part of the 6 canonical state slices.
- `event`: ordered streaming event frame carrying `"channel"` (`"motion"` or `"log"`) and `"data"`. Motion and log events are streaming events, not state patches.
  ```json
  {
    "protocolVersion": 1,
    "type": "event",
    "seq": 15,
    "ack": 3,
    "bootId": "esp-A1B2C3D4-E5F60708",
    "stateRevision": 106,
    "channel": "motion",
    "data": { ... }
  }
  ```
- `commandAck` and `commandResult` are the intentional envelope exception: they are complete,
  immediate, unsequenced responses and do not consume telemetry sequence or state-revision numbers.

### Handshake & Clock Sync Authority

On connection, browser sends:

```json
{
  "protocolVersion": 1,
  "type": "hello",
  "seq": 1,
  "ack": 0,
  "knownBootId": null,
  "lastStateRevision": 0,
  "utcMs": 1785162634123,
  "timezoneOffsetMinutes": 180,
  "timeZone": "Europe/Tallinn"
}
```

- The first valid browser `hello` after boot initializes the ESP wall-clock offset derived from `utcMs` relative to monotonic `millis()`, and replies with a complete authoritative `snapshot`.
- After `wallClock.valid` becomes true, all later WebSocket clock proposals are ignored. Operator
  command authorization is established separately by HTTP Claim/Reconnect and is not carried in `hello`.
- Rejected or unchanged clock proposals do not change timezone, set `dirtySystem`, or increment `stateRevision`.

### Low-Rate Stable System Diagnostics

Candidate system base JSON is updated on a low-rate 10-second scheduler outside the telemetry mutex with quantized diagnostic fields (`uptimeMs`, `freeHeap`, `rssi`, SD capacity metrics). Non-diagnostic business state changes (position, job state, jog state) do not perform heap, SD, or WiFi health queries, preventing continuous `stateRevision` churn.

### Controller-Independent Authoritative State Schema

```json
{
  "system": {
    "bootId": "esp-...",
    "protocolVersion": 1,
    "health": { ... },
    "time": { "utcMs": 1785162634123, "timezoneOffsetMinutes": 180, "timeZone": "Europe/Tallinn", "valid": true }
  },
  "controller": {
    "type": "marlin",
    "identity": "Marlin 2.1.1",
    "connected": true,
    "state": "idle",
    "lastError": null,
    "capabilities": {
      "homing": true, "absoluteMachineMove": true, "positionReports": true,
      "pause": true, "resume": true, "stop": true, "feedOverride": true,
      "arcs": true, "toolChange": true
    }
  },
  "machine": {
    "position": { "work": { "x": 0, "y": 0, "z": 0 }, "machine": { "x": 0, "y": 0, "z": 0 } },
    "frame": { ... },
    "homedAxes": { "x": false, "y": false, "z": false },
    "homingEpoch": 0
  },
  "job": { ... },
  "jog": { ... },
  "control": { "owner": null }
}
```

### Idle Sync & Resync

- When active traffic occurs, no redundant heartbeats are sent.
- After 3000 ms of idle time, firmware broadcasts a minimal `sync` packet.
- On sequence gaps, browser sends `resync`, and ESP replies with a fresh `snapshot`.

### Phase 3 authenticated command channel

A browser holding operator control receives an ephemeral `socketCommandToken` only in a successful
HTTP Claim or Reconnect response. A command supplies that token with the active
`controlSessionEpoch`; Release, a new Claim, or a new inactive-session Reconnect revokes the old
epoch/token and clears incompatible queued and ledger state.

```json
{
  "protocolVersion": 1,
  "type": "command",
  "commandId": "feed-550e8400-e29b-41d4-a716-446655440000",
  "action": "job.setFeedOverride",
  "authorization": { "controlSessionEpoch": 12, "socketCommandToken": "..." },
  "payload": { "percent": 125 }
}
```

- `commandId`, `action`, serialized payload, and control-session epoch form the idempotency
  identity. Payload identity uses insertion-order JSON serialization exactly as sent by the browser
  and firmware; reordered object keys are a conflict rather than an equivalent retry.
- The firmware uses an 8-entry execution queue and a 32-entry session ledger. Exact retries return
  the in-progress acknowledgement or cached result without executing again; incompatible reuse
  returns `IDEMPOTENCY_CONFLICT`.
- `commandQuery` uses the same authorization and `commandId`. It recovers an in-progress or completed
  result after socket reconnect within the same control session, including across different sockets.
- Accepted execution remains on the Arduino loop. `commandAck`/`commandResult` report disposition;
  the subsequent normal sequenced `job` patch is the authoritative machine state.
- Migrated actions are `safety.stop`/`job.stop`, `job.pause`, `job.resume`, `job.setFeedOverride`, `machine.home`, `machine.setWorkZero`, and
  `machine.setZZero`. Their existing operator-protected HTTP routes remain available. Job Start, Bounding Box, Jog, and other actions remain HTTP/unmigrated. Jog must
  use a separate coalesced realtime design rather than the generic command queue.
- Stop deliberately dispatches authenticated WebSocket and protected HTTP requests immediately and
  redundantly. Neither response proves physical success; a newer canonical job slice is the success
  authority. Software Stop is not a physical emergency stop, and controller receipt during
  communication loss cannot be confirmed.
- `feedOverridePercent` is applied state, not queued intent. It changes only after the exact
  `M220 S...` receives a successful terminal Marlin response. Error or timeout retains the prior
  applied percentage and publishes `lastFeedOverrideCommand`, `lastFeedOverrideResponse`, and
  `lastFeedOverrideError` diagnostics.

## Browser API

### `GET /api/device`

Returns the public device identity selected from SD, NVS, or firmware defaults. No WiFi password
or sensitive configuration is included.

```json
{
  "deviceId": "F7C76A",
  "hostname": "cnc",
  "friendlyName": "ESP32 CNC",
  "localUrl": "http://cnc.local",
  "ip": "192.168.1.42",
  "mode": "ap+sta",
  "mdnsEnabled": true,
  "bluetooth": {
    "enabled": true,
    "advertiseName": true,
    "started": true,
    "name": "CNC cnc.local"
  },
  "configSource": "defaults"
}
```

`mode` is `ap`, `sta`, or `ap+sta` depending on the active radio path.

Bluetooth is a discovery label only. `started:false` does not indicate a WiFi or web-server fault.

### `PATCH /api/device`

Updates the bare hostname and friendly display name. The firmware rejects the request while a job
is preparing, running, pausing, paused, resuming, or stopping. NVS is always written first; an SD
write failure is returned as a warning and does not undo the NVS save.

```json
{
  "hostname": "g-code-cnc",
  "friendlyName": "G-code CNC 3"
}
```

```json
{
  "ok": true,
  "requiresRestart": true,
  "sdConfigWritten": true,
  "device": {
    "hostname": "g-code-cnc",
    "friendlyName": "G-code CNC 3",
    "localUrl": "http://g-code-cnc.local",
    "bleName": "CNC g-code-cnc.local"
  }
}
```

### `POST /api/system/restart`

Schedules restart after approximately one second. Returns HTTP 409 while a job, jog, OTA, pending
Marlin response, or priority control is active.

### `GET /api/health`

Returns basic firmware state.

Example response:

```json
{
  "firmware": "G-code CNC Pendant",
  "firmwareVersion": "0.2.0-webota",
  "buildDate": "Jun 12 2026",
  "buildTime": "10:30:00",
  "uptimeMs": 12345,
  "freeHeap": 200000,
  "flashSize": 4194304,
  "sketchSize": 827593,
  "freeSketchSpace": 1310720,
  "baudrate": 250000,
  "wifiMode": "ap+sta",
  "ipAddress": "192.168.1.42",
  "ssid": "WorkshopWiFi",
  "rssi": -58,
  "sdMounted": true,
  "sdCardType": "SDHC",
  "sdTotalBytes": 15931539456,
  "sdUsedBytes": 1048576,
  "sdFreeBytes": 15930490880
}
```

### `POST /api/cmd`

Request body:

```json
{
  "cmd": "M115"
}
```

The firmware sends the command to Marlin with a newline, waits up to 1500 ms, collects all
available serial response text, and returns it to the browser.

Example response:

```json
{
  "ok": true,
  "response": "FIRMWARE_NAME:Marlin ...\nok\n"
}
```

## Marlin Serial Behavior

- UART0 is a protocol transport, not a debug console. Arduino core logging is disabled and
  application diagnostics must use bounded memory/SD logs instead of `Serial.print*`.
- One command is sent per request.
- Commands are trimmed before sending.
- Empty commands are rejected by the HTTP API.
- The MVP does not maintain a queue or stream long-running jobs.

### `GET /update`

Returns a simple firmware update form.

### `POST /api/update`

Accepts a multipart firmware `.bin` upload, writes it to the OTA partition, and reboots after a
successful update. Before writing firmware, the pendant sends `M5` and `M400` to Marlin and then
stops sending Marlin commands during the OTA operation.

### `GET /wifi`

Returns a WiFi settings form. Passwords are never shown.

### `POST /api/wifi/save`

Stores form fields `ssid` and `pass` in Preferences/NVS namespace `wifi`, keys `ssid` and `pass`,
then reboots after about 1 second.

### `POST /api/wifi/forget`

Removes saved WiFi credentials from Preferences/NVS, then reboots after about 1 second. On the next
boot the pendant starts the `G-code-CNC-Setup` AP if no credentials are saved.

## SD Rescue Update

At boot, before WiFi and the HTTP server start, the firmware first supports the explicit rescue pair:

```text
/firmware/update.bin
/firmware/INSTALL.NOW
```

Both files are required for that flow. If the explicit pair is not present, a root-level
`/firmware.bin` is installed automatically without a marker and renamed to `/firmware.done.bin`
after success. Results are logged to `/logs/update.log`. The explicit rescue flow removes its
marker and renames `update.bin` to `update.done.bin` when possible. On failure it removes the marker
and writes `INSTALL.FAILED` so the device does not enter an update loop.

## SD File API

All paths are rejected unless they are under one of these roots:

```text
/gcode
/www
/firmware
/jobs
/logs
```

Paths containing `..`, `//`, or backslash are rejected.

### `GET /files`

Returns the mobile-friendly SD file manager page. The default path is `/gcode`.

### `GET /api/sd/status`

Returns SD mount and capacity status.

### `GET /api/ui/status`

Returns whether SD-hosted UI files are available:

```json
{
  "sdUiAvailable": true,
  "indexFromSd": true,
  "wwwPath": "/www"
}
```

### `GET /api/files?path=/gcode`

Lists files and directories for the requested path.

### `GET /api/download?path=/gcode/test.gcode`

Downloads a file from an allowed path. The response uses `Content-Disposition: attachment` so
text G-code is saved with its original filename instead of being rendered inline.

### `POST /api/upload`

Accepts multipart form fields `path` and `file`. The default target directory is `/gcode`.
Existing files are rejected unless `overwrite=true` is supplied.

### `POST /api/delete`

Accepts JSON `{ "path": "/gcode/test.gcode" }`. Root directories cannot be deleted.

### `POST /api/mkdir`

Accepts JSON `{ "path": "/gcode/new-folder" }`.

### `POST /api/rename`

Accepts JSON with `from` and `to` paths. Existing targets are rejected.

## CNC Job Runner API

The browser does not stream G-code lines. It requests a job start and the ESP32 streams the selected
SD file to Marlin from firmware `loop()`.

Normal job execution has no browser preview-size dependency. Firmware opens the SD file, keeps only
one bounded G-code line in RAM, waits for Marlin `ok`, and advances the byte offset. Preview or
transform warnings must not change `gcodePath`, substitute another file, or reject an otherwise
valid normal SD job.

### `POST /api/job/start`

Request body:

```json
{
  "gcodePath": "/gcode/test.gcode",
  "jobPath": "/jobs/test.gcode.job.json",
  "activeRunMode": "source",
  "startMode": "use_active_work_zero",
  "bootSessionId": "A1B2C3D4-E5F60708",
  "workZeroId": "zero-...",
  "homingEpoch": 3,
  "workZeroMachineX": 100,
  "workZeroMachineY": 500,
  "workZeroMachineZ": 42,
  "safeStartZ": 15
}
```

The firmware rejects unsafe paths, missing files, non-`/jobs` job paths, and Job JSON v3 without
the one-use `startAuthorizationToken: "AUTHORIZED"` written by the final hold action. Normal source jobs must use a `gcodePath` under `/gcode`. Generated transformed jobs
may use `/jobs/generated/...` only when `activeRunMode` is `"generated"` and the saved job JSON
contains the same path as a validated active run. The browser sets generated active-run intent when
the operator changes visible placement; there is no separate generated-file confirmation step in the
normal workflow. Firmware verifies start authorization and generated active-run provenance with
bounded whole-file string checks; robust JSON parsing remains a TODO. Homed starts use
`use_active_work_zero`; an explicitly acknowledged unhomed frame uses `use_manual_work_frame`.

Start authorization, workspace permission, and generated active-run validation tokens are scanned across the
complete SD file with a bounded rolling buffer. Their location is not limited to the first 8/16 KB
of job history.

For a homed start, firmware verifies the requested work-zero ID, homing epoch/session, and
machine-space origin against its active frame. For a manual start, it instead requires the current
per-boot ID and an active manual work frame; no absolute machine coordinates are invented. It then sends:

`M5`, `G21`, `G90`, `G54`, `M220 S<startPercent>`, `M400`, `M114`,
`G0 Z<safeStartZ> F400`, `M400`, `G0 F<travelFeedMmMin>`

Normal Start Job never sends `G92`. A mismatch returns HTTP 409 and requires Set Work Zero or an
explicit saved-zero restore before authorizing start again.

An accepted request returns status with `state: "PREPARING"`. Firmware executes the preamble
asynchronously and publishes the later `RUNNING` or `ERROR` transition through normal job-status
telemetry. An accepted HTTP response does not mean file streaming has already begun.

`startPercent` is read from job JSON `feedOverride.startPercent` and defaults to `100`.

Preview and Machine Bar both use firmware-owned `POST /api/work-zero/set`. The response contains
before/after M114 text and the active machine frame; Preview saves its machine-space origin and
homing epoch immediately.

### Coordinate frame API

- `GET /api/machine/frame` returns `machine`, `work`, `workZeroMachine`, homed axes,
  `homingEpoch`, `homingSessionId`, `bootSessionId`, `frameMode`, revision, and trust state.
- `POST /api/machine/home` accepts `{ "axes": "x|y|z|xy|all" }`. Home All establishes a new
  trusted epoch and deterministic temporary baseline at physical home.
- `POST /api/machine/manual-frame` accepts `{ "mode": "confirm|preserve|set-zero" }`. `confirm`
  acknowledges the current unhomed position without selecting a zero; `preserve` accepts current
  G54 work coordinates; `set-zero` applies G92 XYZ0. All manual state expires on ESP restart.
- `POST /api/work-zero/set` requires trusted Home All or the current confirmed manual frame and
  accepts optional `{ "axes": "x|y|xyz" }`. It performs the complete
  M400/M114/G92/M114 transaction for only those axes and returns the synchronized frame.
- `POST /api/work-zero/set-z` performs the corresponding Z-only transaction and updates the same
machine-space frame without changing X/Y origin.

The operator UI automatically stores every verified zero transaction in the active job JSON. Raw
M114 responses and IDs remain diagnostic metadata and are not part of the normal Zero / Origin UI.

Bounding Box Trace captures the current X/Y/Z before motion. After tracing at Safe Z, it returns
to the captured X/Y while still high, restores the captured Z, and finishes with `M400`. A failed
or stopped trace does not descend automatically because XY may no longer be at the return point.
`safeStartZ` is the Job JSON `projectSafeZ.effectiveSafeZ` work-coordinate height before the first
streamed file line. It has no independent default. Firmware recomputes
`stockTopWorkZ + safeZClearanceMm` from the referenced `jobPath` and rejects a mismatch or
unresolved project. The target is converted through the active Work Zero and must be physically
reachable.
`travelFeedMmMin` comes from the browser's automatic XY travel setting and is clamped to
600–6000 mm/min. The feed-only G0 occurs after the Safe-Z wait, so the first file G0 does not
inherit F400. A file line with its own F value still overrides the modal value.

During streaming, `G54` is allowed and logged as informational. `G55`, `G56`, `G57`, `G58`, `G59`,
`G59.1`, `G59.2`, and `G59.3` are blocked unless the job JSON contains
`"allowedWorkspaceCommands": true`.

### `POST /api/test-motion/start`

Starts a firmware-owned Aircut or Toolless stream from an uploaded temporary file:

```json
{
  "path": "/jobs/generated/test.gc.aircut.gc",
  "mode": "aircut",
  "safeZ": 15,
  "jobPath": "/jobs/example.job.json"
}
```

### Machine profile and configuration

`GET /api/machine/info` returns cached M115 identity, `area.full`, `area.work`, capabilities,
refresh state, and last discovery error. The cache is loaded from Preferences namespace `machine`.
Firmware schedules one M115 discovery after boot only when job, jog, priority control, and OTA are
idle. A manual M115 response updates the same cache.

`POST /api/machine/refresh` queues another idle-only M115 discovery and returns `202`.

`POST /api/machine/apply` accepts only these validated groups:

```json
{ "group": "M92", "x": 100, "y": 100, "z": 400 }
{ "group": "M203", "x": 100, "y": 100, "z": 5 }
{ "group": "M201", "x": 1000, "y": 1000, "z": 100 }
{ "group": "M204", "p": 500, "r": 500, "t": 800 }
```

Apply changes Marlin RAM immediately but does not persist them. Requests are rejected while any
motion or discovery owns UART.

`POST /api/machine/save` sends exactly `M500` while idle. It is the only Settings action that
persists applied configuration to Marlin EEPROM. It is never invoked automatically.

`path` must be under `/jobs/generated`; `mode` is `aircut` or `toolless`. Firmware validates the
complete file before moving and revalidates every line while streaming. The first command must be
`M5`, the last must be `M400`, file size is limited to 2 MiB, and command count to 20,000.

Allowed commands are `M5`, `M400`, `G21`, `G90`, `G54`, and `G0/G1/G2/G3` motion words using only
X/Y/Z/F and arc I/J/R as appropriate. `G28`, `G53`, `G92`, `M3`, `M4`, and all other commands are
rejected before streaming. Firmware requires `safeZ` to equal the referenced job's effective
Project Safe Z. In `aircut` mode every supplied Z value must equal `safeZ`; Toolless mode
may follow the already browser-validated remaining Z path.

The endpoint does not run the normal job-start preamble and never applies G92. It uses the existing
SD/UART `ok`-paced runner, so `/api/job/pause`, `/api/job/resume`, `/api/job/stop`, and telemetry
remain available. Job status reports `streamMode` as `aircut`, `toolless`, or `job`.

### `POST /api/recovery/production/start`

Starts a prepared Production Resume Phase 2 stream owned by firmware:

```json
{
  "path": "/jobs/generated/example.gc.production-resume.gc",
  "jobPath": "/jobs/example.gc.job.json",
  "activeRunPath": "/gcode/example.gc",
  "activeRunMode": "source",
  "activeRunFingerprint": "size:...",
  "eventId": "production-resume-...",
  "interruptedRunId": "run-...",
  "safeZ": 29
}
```

The generated path must be under `/jobs/generated` and end in `.production-resume.gc`. Firmware
checks that job metadata contains the same prepared Production Resume event, interrupted run,
activeRun identity/fingerprint, non-null Phase-1 completion, and manual-router confirmation. A
generated activeRun must still be valid. A one-shot `productionResumeAuthorization.authorized=true`
record carries the exact event/run/activeRun/stream identity; firmware searches the whole job file
so long history metadata does not hide the authorization beyond a fixed-size read window.
Firmware also recomputes the current Project Safe Z from `jobPath` and rejects a missing,
unresolved, stale, or mismatched `safeZ` before accepting Phase 2.

The complete file is validated before movement and each line is revalidated during streaming. It
must begin `G21`, `G90`, `G54`, contain bounded `G0/G1/G2/G3` motion, and end `M400`. Only numeric
X/Y/Z/F and applicable I/J/R words are accepted. `G28`, `G53`, `G92`, `M3`, `M4`, and arbitrary
M-codes are rejected. Firmware then owns Marlin `ok` pacing independently of browser connectivity.

### `GET /api/job/status`

Returns the in-memory job runner state, progress, byte offset, line counts, priority-control state,
last command/response, and last error. Priority fields include `pauseRequested`, `stopRequested`,
`priorityCommandInProgress`, `lastPriorityCommand`, `lastPriorityResponse`, `lastPriorityError`,
`streamingPausedReason`, and `currentLineNumber`. Feed override fields include
`feedOverridePercent`, `lastFeedOverrideCommand`, `lastFeedOverrideResponse`, and
`lastFeedOverrideError`. Compatibility aliases `lastSentCommand` and `lastMarlinResponse` mirror
the latest streamed command and response. `travelFeedMmMin` reports the XY automatic travel feed
selected for the current job start.
`streamMode` distinguishes normal cutting jobs from validated Aircut, Toolless, and
`production-resume` motion streams.

### `POST /api/job/feed-override`

Request body:

```json
{
  "percent": 100
}
```

Sends Marlin `M220 S<percent>` as a priority control command. Valid range is `10` to `200`; invalid
values are rejected. Feed override is allowed while idle and during `RUNNING`, `PAUSING`,
`PAUSED_INTACT`, tool-change `PAUSED`, and `RESUMING`, but it is lower priority than Pause/Resume
state changes and Stop. It is rejected while a higher-priority command is already in progress.
The accepted HTTP or WebSocket response records queued intent only. `feedOverridePercent` changes
after the exact M220 receives terminal `ok`; Error or timeout retains the previous value and updates
the command/response/error diagnostics.
Feed override changes movement speed only and does not change router or spindle RPM.

Job JSON may include:

```json
{
  "feedOverride": {
    "startPercent": 100,
    "lastUsedPercent": null,
    "resetTo100AfterJob": true,
    "updatedAt": null,
    "source": "user"
  }
}
```

When `resetTo100AfterJob` is true, firmware sends `M220 S100` after completed, stopped, or error
jobs.

### `POST /api/job/pause`

Valid from `RUNNING`. The UI requires a continuous 500 ms hold and shows no modal. Firmware stops
submitting new file commands and never sends `M5`, `M410`, a Z lift, or a park move.

When `M115` explicitly reports both `EMERGENCY_PARSER` and realtime reporting commands, firmware
sends `P000` and enters `PAUSED_INTACT`. The cutter remains running and the current stream, modal
state, file offset, and in-flight acknowledgement remain intact. Firmware never assumes this
capability from Marlin identity alone or restores it from NVS. Both safety flags are current
controller-session evidence and are invalidated on communication loss or recovery until M115 is
successfully reprobed.

Without that explicit capability, state remains `PAUSING` while the current command finishes.
Firmware then sends `M400` at the acknowledged file-command boundary and enters `PAUSED_INTACT`.
The UI identifies this as a pending boundary pause; source commands are never segmented or
rewritten.

### `POST /api/job/resume`

Valid only from `PAUSED_INTACT` while `directResumeValid` is true. The UI requires a continuous
500 ms hold and shows no modal. Realtime holds send `R000` and preserve the original in-flight
acknowledgement. Boundary holds reopen at the confirmed next-unsent byte offset. Resume does not
send modal setup, reposition, lift Z, or change cutter state.

### `POST /api/job/interrupt-for-manual-motion`

Valid from `PAUSED_INTACT`. This must complete before jog or another manual move can begin. It
invalidates direct Resume, stops file execution with `M410`, sends `M5` only after the quickstop
response, persists interrupted-run evidence and the last confirmed offsets/positions/frame/work
zero/Project Safe Z/cutter state, clears position trust, and finishes in `RECOVERY_REQUIRED`.
The ordinary Recovery workflow owns all continuation after this transition.

### `POST /api/job/stop`

Valid from active job states such as `PREPARING`, `RUNNING`, `PAUSING`, `PAUSED_INTACT`, tool-change
`PAUSED`, and `RESUMING`. The UI requires a continuous 500 ms hold and shows no modal. Firmware
stops sending new file lines immediately, closes the active SD stream, sets state `STOPPING`,
replaces lower-priority controls, and transmits priority `M410` immediately from the request
handler. Priority `M5` is transmitted only after the `M410` response, and the endpoint returns
without waiting for the sequence to complete. The state changes to `STOPPED` after the priority
sequence completes. If `EMERGENCY_PARSER` was not detected from `M115`, telemetry and the response
warn that immediate interruption cannot be guaranteed, but Stop is still sent. Position trust is
invalidated as soon as the quickstop is issued; Home All restores trust. This is not a physical
emergency stop.

Priority controls are separate from normal file streaming. Normal streaming sends one cleaned
G-code file line at a time and waits for Marlin `ok` before sending the next file line. Pause and
Stop do not wait behind queued source lines. Standalone `M5` is not a primary job control and is
rejected while a job is active, intact-paused, resumable, stopping, or in recovery. It remains an
Advanced Manual command only while no job/automatic motion owns UART and all axes are stationary.
If a lower-priority feed override is queued, Stop replaces it; Stop remains above `M220`.
Stop additionally preempts an active lower-priority sequence so `M410` is never held behind its
acknowledgement or timeout.

### `GET /api/marlin/log`

Returns a bounded in-memory Marlin command/response log. The log is intentionally limited so it
cannot grow without bound.

Example response:

```json
{
  "ok": true,
  "entries": [
    {
      "time": "123456",
      "direction": "tx",
      "priority": true,
      "text": "M5",
      "level": "info"
    },
    {
      "time": "123470",
      "direction": "rx",
      "priority": true,
      "text": "ok\n",
      "level": "info"
    }
  ],
  "lastCritical": null
}
```

`direction` is `tx` for commands sent to Marlin and `rx` for Marlin responses. `priority` marks
controls such as realtime Pause/Resume, Stop, M220, and safety/jog commands. `level` is `info`,
`warning`, or `error`; critical strings such as `Error:`, `ALARM`, `kill`, `Printer halted`,
`endstops hit`, `Resend`, and `timeout` are surfaced through `lastCritical`.

## Safe Jog API

The browser does not stream G-code jog moves. It sends joystick vectors and heartbeat updates; the
ESP32 emits short relative movement ticks and stops automatically when updates stop.

### `POST /api/jog/start`

Request body:

```json
{
  "safeJog": true,
  "safeLiftZ": 59,
  "safeWorkZ": 29,
  "jobPath": "/jobs/example.job.json",
  "projectSafeZ": 29,
  "restoreZAfterJog": true,
  "restoreDelayMs": 5000,
  "xyFeedMax": 3000,
  "zFeedMax": 400
}
```

When `safeJog` is true, firmware captures the current work Z with `M400` and `M114`, sends `M5`,
and moves to native machine coordinate `G53 G0 Z<safeLiftZ>` at `F<zFeedMax>` before allowing X/Y
jog ticks.
When a current project exists, `safeWorkZ` must equal its effective Project Safe Z and
`safeLiftZ = workZeroMachineZ + safeWorkZ`. Firmware requires a trusted frame and rejects targets
outside physical Z limits. Without a current project, the existing machine-level manual-jog
fallback remains available and is not persisted into Job JSON.
Firmware reads M114 again after the lift and stores the resulting work-coordinate Z for restore
validation. If
`restoreZAfterJog` is true, firmware schedules an automatic return to the captured Z after
`restoreDelayMs` when jogging stops, unless Z was jogged or the current Z no longer matches the
safe target. Jog start is rejected while a job is `RUNNING`.

### `POST /api/jog/update`

Request body:

```json
{
  "x": 0.0,
  "y": 0.0,
  "z": 0.0,
  "speed": 0.5
}
```

Values are clamped to safe ranges. Firmware converts them into small relative `G91`/`G0`/`G90`
movement ticks about every 150 ms. For X/Y, the joystick distance from center controls the movement
step length and the firmware scales feedrate to that distance so partial joystick movement lasts
firmware independently emits 50 ms movement ticks, ramps toward the newest vector, and keeps no
more than three acknowledged/planned ticks of lookahead. Each tick is one `G0` command in a jog
session that enters `G91` once and restores `G90` on stop. This avoids making browser/HTTP timing
part of the movement cadence. `xyFeedMax` from jog
start controls the maximum feedrate. The SD UI maps the XY slider from 10 to 100 mm/s into
`xyFeedMax` 600 to 6000 mm/min. If no update arrives for 500 ms, firmware stops sending jog
movement, sends `M400`, and may schedule Z restore.

### `POST /api/jog/stop`

Stops jogging and sends `M410`, `M5`, and `G90`. This is not a physical emergency stop.

### `GET /api/jog/status`

Returns jog state, whether Z was lifted for safe jog, original captured Z, lifted work-coordinate Z,
pending Z restore status, last command, last error, heartbeat age, and configured jog limits.

Repeated safe XY jog gestures made before the pending Z restore keep the first captured work Z.
Starting a new pointer gesture must not replace that original value with the already lifted Safe Z.

## Go To Work Zero API

### `POST /api/work-zero/goto`

Moves only the selected work-coordinate X/Y axes to zero. It never sends G92, G28, M3, M4, or Z0.

Request body:

```json
{
  "axes": "xy",
  "safeMove": true,
  "safeZ": 29,
  "jobPath": "/jobs/example.job.json",
  "projectSafeZ": 29,
  "travelFeedMmMin": 3000
}
```

`axes` must be `x`, `y`, or `xy`. The endpoint rejects requests during OTA, any active job state,
or active jog.

Safe mode sends and acknowledges this bounded sequence before returning success:

```text
M5
G21
G90
G54
G0 Z<safeZ> F400
G0 X0 Y0 F<travelFeedMmMin>   ; selected axes only
G90
```

With a current project, firmware recomputes Project Safe Z from `jobPath` and requires the supplied
`safeZ` to match it exactly; unreachable work- or machine-coordinate targets are rejected without
clamping. With no current project, the Machine Bar's machine-level Safe Z remains an explicit
manual fallback. Travel feed is clamped to 600–6000 mm/min.
Z deliberately remains at Safe Z after the
XY move; firmware does not automatically plunge back toward material. With `safeMove: false`, the
selected XY move happens at current Z and the UI requires a stronger warning confirmation.

Marlin's planner preserves the accepted Z-lift then XY command order. The endpoint reports that the
move was accepted; it does not block the HTTP request until a long physical return has completed.
This is controlled positioning, not a physical emergency stop. A Marlin error, alarm, or missing
`ok` while accepting commands aborts the remaining sequence and returns HTTP 502.

### `POST /api/work-zero/restore`

Restores a saved home-relative zero after Home All. Request fields are `machineX`, `machineY`,
optional `machineZ`, `safeMachineZ`, `travelFeedMmMin`, `axes` (`x`, `y`, `z`, `xy`, or `xyz`),
and `moveToZ`. Saved absolute machine-frame coordinates are authoritative; M114 counts plus
M503/M92 steps-per-mm remain a compatibility fallback for older job JSON.

The idle-only sequence is M5, G21/G90, M400, `G53 G0 Z<safeMachineZ>`, M400,
`G53 G0 X<machineX> Y<machineY>`, M400, optional `G53 G0 Z<machineZ>`, M400, G54, the selected
G92 axes, and M114. The browser uses full XYZ restore for an interrupted work zero and Z-only G92
for a historical tool-Z zero. Home All is required and is never run automatically. Firmware validates
all requested machine coordinates before motion. G53 remains forbidden in uploaded/generated/recovery
streams; this endpoint is the narrow, fully owned Safe-Z-first exception.

## SD-Hosted UI

When `/www/index.html` exists on the SD card, `GET /` serves that file. Known UI assets such as
`/app.js`, `/style.css`, `/files.html`, and `/files.js` are also served from `/www` when present.
Missing SD UI files fall back to the built-in SPIFFS files. API routes, `/wifi`, `/update`, and the
generated `/files` route keep priority over SD static files.

HTML, JavaScript, and CSS responses include `Cache-Control: no-store` for easier development.
