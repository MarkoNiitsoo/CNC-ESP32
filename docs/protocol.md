# Protocol

## Browser API

### `GET /api/health`

Returns basic firmware state.

Example response:

```json
{
  "firmware": "LowRider CNC Pendant",
  "firmwareVersion": "0.2.0-webota",
  "buildDate": "Jun 12 2026",
  "buildTime": "10:30:00",
  "uptimeMs": 12345,
  "freeHeap": 200000,
  "flashSize": 4194304,
  "sketchSize": 827593,
  "freeSketchSpace": 1310720,
  "baudrate": 250000,
  "wifiMode": "sta",
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
boot the pendant starts the `LowRider-CNC-Setup` AP if no credentials are saved.

## SD Rescue Update

At boot, before WiFi and the HTTP server start, the firmware checks the SD card for both:

```text
/firmware/update.bin
/firmware/INSTALL.NOW
```

Both files are required. A root-level `/firmware.bin` is ignored. Results are logged to
`/logs/update.log`. On success, the marker is removed and `update.bin` is renamed to
`update.done.bin` when possible. On failure, the marker is removed and `INSTALL.FAILED` is written
so the device does not enter an update loop.

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

Downloads a file from an allowed path.

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

### `POST /api/job/start`

Request body:

```json
{
  "gcodePath": "/gcode/test.gcode",
  "jobPath": "/jobs/test.gcode.job.json",
  "activeRunMode": "source",
  "startMode": "apply_current_position_as_work_zero",
  "safeStartZ": 15
}
```

The firmware rejects unsafe paths, missing files, non-`/jobs` job paths, and job JSON that is not
marked `ARMED`. Normal source jobs must use a `gcodePath` under `/gcode`. Generated transformed jobs
may use `/jobs/generated/...` only when `activeRunMode` is `"generated"` and the saved job JSON
contains the same path as a validated active run. The browser sets generated active-run intent when
the operator changes visible placement; there is no separate generated-file confirmation step in the
normal workflow. The MVP verifies `ARMED` and generated active-run
provenance with minimal string checks; robust JSON parsing is a TODO. The default `startMode` is
`apply_current_position_as_work_zero`.

Before streaming, the firmware sends this preamble:

- `apply_current_position_as_work_zero`:
  `M5`, `G21`, `G90`, `G54`, `M220 S<startPercent>`, `M400`, `M114`, `G92 X0 Y0 Z0`, `M114`,
  `G0 Z<safeStartZ> F400`, `M400`
- `use_active_work_zero`:
  `M5`, `G21`, `G90`, `G54`, `M220 S<startPercent>`, `M400`, `M114`,
  `G0 Z<safeStartZ> F400`, `M400`

`startPercent` is read from job JSON `feedOverride.startPercent` and defaults to `100`.
`safeStartZ` is a positive work-coordinate Z height before the first streamed file line and defaults
to `15` when omitted.

During streaming, `G54` is allowed and logged as informational. `G55`, `G56`, `G57`, `G58`, `G59`,
`G59.1`, `G59.2`, and `G59.3` are blocked unless the job JSON contains
`"allowedWorkspaceCommands": true`.

### `GET /api/job/status`

Returns the in-memory job runner state, progress, byte offset, line counts, priority-control state,
last command/response, and last error. Priority fields include `pauseRequested`, `stopRequested`,
`priorityCommandInProgress`, `lastPriorityCommand`, `lastPriorityResponse`, `lastPriorityError`,
`streamingPausedReason`, and `currentLineNumber`. Feed override fields include
`feedOverridePercent`, `lastFeedOverrideCommand`, `lastFeedOverrideResponse`, and
`lastFeedOverrideError`. Compatibility aliases `lastSentCommand` and `lastMarlinResponse` mirror
the latest streamed command and response.

### `POST /api/job/feed-override`

Request body:

```json
{
  "percent": 100
}
```

Sends Marlin `M220 S<percent>` as a priority control command. Valid range is `10` to `200`; invalid
values are rejected. Feed override is allowed while idle and during `RUNNING`, `PAUSING`, `PAUSED`,
and `RESUMING`, but it is lower priority than Pause, Stop, and M5. It is rejected while a higher
priority command is already in progress. Feed override changes movement speed only and does not
change router or spindle RPM.

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

Valid from `RUNNING`. Stops sending new file lines immediately, closes the active SD stream, sets
state `PAUSING`, queues priority `M5` and `M400`, and returns quickly. The queued priority commands
are processed from firmware `loop()` and the state changes to `PAUSED` after they complete.

### `POST /api/job/resume`

Valid from `PAUSED`. Reopens the G-code file, seeks to the saved byte offset, transitions through
`RESUMING`, and continues streaming from the next unsent file line.

### `POST /api/job/stop`

Valid from active job states such as `PREPARING`, `RUNNING`, `PAUSING`, `PAUSED`, and `RESUMING`.
Stops sending new file lines immediately, closes the active SD stream, sets state `STOPPING`,
queues priority `M5` and `M410`, and returns quickly. The state changes to `STOPPED` after the
priority sequence completes. This is not a physical emergency stop.

Priority controls are separate from normal file streaming. Normal streaming sends one cleaned
G-code file line at a time and waits for Marlin `ok` before sending the next file line. Pause, Stop,
and manual `M5` during active job states do not wait behind queued file lines; they mark the stream
as stopped/paused first and then use the priority command path. Manual `M5` is accepted during
`RUNNING`, `PAUSING`, `PAUSED`, `RESUMING`, `STOPPING`, and `ERROR`. If a lower-priority feed
override is queued, `M5` may replace it; Stop/Pause/M5 stay above `M220` feed override.

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
priority controls such as Pause/Stop/M5/M220 and safety/jog commands. `level` is `info`,
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
  "safeLiftZ": 70,
  "restoreZAfterJog": true,
  "restoreDelayMs": 5000,
  "xyFeedMax": 3000,
  "zFeedMax": 400
}
```

When `safeJog` is true, firmware captures the current Z with `M400` and `M114`, sends `M5`, switches
to `G90`, and moves to absolute `Z<safeLiftZ>` at `F<zFeedMax>` before allowing X/Y jog ticks.
The default safe target is `Z70`, matching the current LowRider bench setup. If
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
roughly the full tick instead of making a quick short move followed by a pause. `xyFeedMax` from jog
start controls the maximum feedrate. The SD UI maps the XY slider from 10 to 100 mm/s into
`xyFeedMax` 600 to 6000 mm/min. If no update arrives for 500 ms, firmware stops sending jog
movement, sends `M400`, and may schedule Z restore.

### `POST /api/jog/stop`

Stops jogging and sends `M410` and `M5`. This is not a physical emergency stop.

### `GET /api/jog/status`

Returns jog state, whether Z was lifted for safe jog, original captured Z, pending Z restore status,
last command, last error, heartbeat age, and configured jog limits.

## SD-Hosted UI

When `/www/index.html` exists on the SD card, `GET /` serves that file. Known UI assets such as
`/app.js`, `/style.css`, `/files.html`, and `/files.js` are also served from `/www` when present.
Missing SD UI files fall back to the built-in SPIFFS files. API routes, `/wifi`, `/update`, and the
generated `/files` route keep priority over SD static files.

HTML, JavaScript, and CSS responses include `Cache-Control: no-store` for easier development.
