# Handoff

## Current State

The repository now has the required agent instructions, documentation, work tracking files, and
a PlatformIO Arduino MVP firmware.

The HTTP server uses explicit handlers for `/` and `/index.html`, static routes for `/app.js`
and `/style.css`, and JSON handlers for `/api/health` and `/api/cmd`.

Git has been initialized in the project directory. `.gitignore` excludes PlatformIO build output
and common generated VS Code files.

The project was added to Git's global `safe.directory` list because the repository was initialized
from the sandbox user and Windows Git required an explicit trust entry for `marko`.

PlatformIO was found at `C:\Users\marko\.platformio\penv\Scripts\pio.exe`. Firmware and SPIFFS
image builds succeeded using that executable.

The ESP32-CAM is connected on `COM5`, and `platformio.ini` now sets `upload_port` and
`monitor_port` to `COM5`.

SPIFFS upload to `COM5` succeeded. The ESP32-CAM was detected as an ESP32-D0WDQ6, and the flash
write was verified.

A timed-out firmware upload left an old `.pio` build artifact locked by Windows, so PlatformIO now
uses `.pio-build` as its build directory. Both `.pio/` and `.pio-build/` are ignored by git.

Firmware builds successfully from `.pio-build`, but uploading the firmware is currently blocked
because Windows reports `COM5` is busy. SPIFFS has already been uploaded successfully.

The actual SKR Pro connection is now documented as RX1/TX1, which should be Marlin serial port `1`.

WebOTA has been added. The project now uses `board_build.partitions = min_spiffs.csv`, exposes
firmware metadata in `/api/health`, serves `/update`, and accepts multipart firmware uploads at
`POST /api/update`. OTA sends `M5` and `M400` before writing firmware and rejects normal commands
while OTA is active.

Build verification passed for both firmware and SPIFFS image generation.

The WebOTA firmware and updated SPIFFS web UI were uploaded successfully to the ESP32-CAM on `COM5`.

Saved WiFi station mode has been added. On boot the firmware reads Preferences/NVS namespace `wifi`
keys `ssid` and `pass`, tries STA mode for up to 15 seconds, and falls back to setup AP
`LowRider-CNC-Setup` with password `12345678`. The UI now links to `/wifi`, and `/api/health`
reports `wifiMode`, `ipAddress`, `ssid`, and STA `rssi`.

Build verification passed for both firmware and SPIFFS image generation after the WiFi changes.

SD-card rescue firmware update has been added. On boot, before WiFi and the HTTP server start, the
firmware initializes SD_MMC and only starts an automatic update when both `/firmware/update.bin` and
`/firmware/INSTALL.NOW` exist. It ignores root-level `/firmware.bin`, logs to `/logs/update.log`,
removes the marker on success or failure, renames successful updates to
`/firmware/update.done.bin` when possible, and writes `/firmware/INSTALL.FAILED` on failure so the
device does not reboot-loop.

Build verification passed for both firmware and SPIFFS image generation after the SD rescue update
changes.

SD card file management has been added. SD_MMC initializes in 1-bit mode and creates `/gcode`,
`/www`, `/firmware`, `/jobs`, and `/logs`. The main UI links to `/files`, which lists `/gcode` by
default and supports upload, download, delete, new folder, refresh, and parent navigation. JSON APIs
are available for SD status, listing, download, upload, delete, mkdir, and rename. Path operations
are restricted to the allowed SD roots and reject traversal, doubled slashes, and backslashes.

Build verification passed for both firmware and SPIFFS image generation after the SD file manager
changes.

SD-card hosted UI support has been added. If `/www/index.html` exists on SD, `GET /` serves it.
Known assets such as `/app.js`, `/style.css`, `/files.html`, and `/files.js` prefer `/www` when
present and fall back to SPIFFS. Other safe GET assets are also served from `/www` through the
not-found handler. API routes, `/wifi`, `/update`, and generated `/files` remain explicit and take
priority. `GET /api/ui/status` reports SD UI availability, and HTML/JS/CSS responses send
`Cache-Control: no-store`.

Build verification passed for both firmware and SPIFFS image generation after the SD-hosted UI
changes.

Browser-side G-code preview has been added as SD-hosted UI only. No firmware or SPIFFS fallback
files were changed. Upload `www/preview.html`, `www/preview.js`, `www/preview.css`, and
`www/files.js` to SD `/www` through the existing file manager, then refresh the browser. The file
manager will show Preview actions for `.gcode`, `.gc`, `.nc`, and `.tap`, and the preview page uses
the existing `/api/download?path=...` endpoint.

Syntax verification passed for `www/preview.js` and `www/files.js` with `node --check`.

Job metadata and work-zero capture have been added as SD-hosted UI only. No firmware, SPIFFS
fallback UI, or API changes were made. Upload the updated `www/preview.html`, `www/preview.js`, and
`www/preview.css` to SD `/www`. The preview page can now load/save `/jobs/*.job.json`, capture
current position with `M400`/`M114`, and set work zero with a confirmed `G92 X0 Y0 Z0` workflow.

Syntax verification passed for the updated `www/preview.js` and `www/files.js` with `node --check`.

Dry Run bounding-box trace has been added as SD-hosted UI only. No firmware, SPIFFS fallback UI, or
API changes were made. Upload the updated `www/preview.html`, `www/preview.js`, and
`www/preview.css` to SD `/www`. The preview page can generate a safe-Z bounding box trace, validate
work zero and LowRider bounds before enabling send, send commands one at a time through `/api/cmd`,
log responses, copy commands, send spindle/laser stop `M5`, and save dry-run metadata into the job
JSON.

Syntax verification passed for the updated `www/preview.js` and `www/files.js` with `node --check`.

Aircut Toolpath dry run has been added as SD-hosted UI only. No firmware, SPIFFS fallback UI, or
API changes were made. Upload the updated `www/preview.html` and `www/preview.js` to SD `/www`.
The preview page can generate XY-only safe-Z aircut commands from the parsed toolpath, preserve
feedrate on generated `G1` moves, copy the generated command list, and send commands one at a time
through `/api/cmd` with progress logging. The Aircut sender blocks on missing work zero or
out-of-bounds preview, warns for command lists over 5000 lines, asks for browser confirmation before
movement, and asks for an extra confirmation when Preflight has failed checks. Job JSON dry-run
metadata now preserves last aircut timestamp, status, and command count.

Syntax verification passed for the updated `www/preview.js` and `www/files.js` with `node --check`.

Job Readiness / Arm Job has been added as SD-hosted UI only. No firmware, SPIFFS fallback UI, or API
changes were made. Upload the updated `www/preview.html`, `www/preview.js`, and `www/preview.css`
to SD `/www`. The preview page now computes a SHA-256 hash for the selected G-code file, requires a
six-item readiness checklist, blocks arming when preview bounds, Preflight, work zero, hash, or
saveability requirements are not met, and saves the ARMED state to `/jobs/*.job.json`. Loaded ARMED
jobs show STALE if the current G-code hash differs, Preflight has failed checks, or work zero is
missing. Arming and disarming do not send any G-code commands.

Syntax verification passed for the updated `www/preview.js` and `www/files.js` with `node --check`.

CNC Job Runner MVP has been added in firmware, so this change requires a firmware flash or WebOTA.
Firmware version is now `0.3.0-job-runner`. The runner starts only from an ARMED job JSON under
`/jobs` and a selected G-code file under `/gcode`, streams from SD in `loop()`, waits for Marlin
`ok` before sending each next cleaned line, and exposes `/api/job/start`, `/api/job/status`,
`/api/job/pause`, `/api/job/resume`, and `/api/job/stop`. Job events are logged to `/logs/job.log`
when SD is mounted. `Resend:` is treated as an MVP error with a TODO for line-numbered resend
support.

The preview page now has a Run Job panel that appears only for ARMED jobs. It starts jobs through
the firmware API after confirmation, polls status every 2 seconds while active, and provides Pause,
Resume, Stop job: `M5 + pause stream`, and Refresh Status controls. Upload the updated
`www/preview.html`, `www/preview.js`, and `www/preview.css` to SD `/www` after flashing the firmware.

Syntax verification passed for the updated `www/preview.js` and `www/files.js` with `node --check`.
Firmware build verification passed with PlatformIO.

Arm Job fingerprinting has been relaxed for local HTTP. The preview page still uses Web Crypto
SHA-256 when available, but falls back to deterministic `size+fnv1a32+cyrb53` fingerprinting when
SHA-256 is blocked or unavailable. Job JSON stores both `gcodeFingerprint` and
`gcodeFingerprintAlgorithm`; `gcodeHashSha256` is kept when SHA-256 succeeds. Local HTTP no longer
blocks arming solely because Web Crypto is unavailable.

Machine Controls and Tool/Z Zero controls have been added as SD-hosted UI only. No firmware changes
were made for this patch. Upload `www/index.html`, `www/app.js`, `www/style.css`,
`www/preview.html`, `www/preview.js`, and `www/preview.css` to SD `/www`. The main page now has
M119, M114, Home X/Y, Home Z, and Home All buttons; all homing buttons require confirmation. The
preview page now has a Tool / Z Zero panel that captures M114, sets only `G92 Z0`, stores
`toolZero` metadata in the job JSON, and marks ARMED jobs STALE when Z zero changes. The preview JS
also tolerates missing newer Run Job elements so mixed SD UI uploads do not crash on load.

Safe Analog Jog has been added in firmware, so this change requires a firmware flash or WebOTA.
Firmware version is now `0.4.0-safe-jog`. The browser sends `/api/jog/update` heartbeat vectors,
but firmware owns jog safety, short relative movement ticks, Safe Jog Z lift, and the 500 ms deadman
timeout. New endpoints are `/api/jog/start`, `/api/jog/update`, `/api/jog/stop`, and
`/api/jog/status`. Safe Jog is on by default in the SD-hosted main page joystick UI. Explicit jog
stop sends `M410` and `M5`, but this is not a physical emergency stop.

The SD-hosted UI has been refactored into a mobile-first app layout without firmware changes. Upload
the updated `www/index.html`, `www/app.js`, `www/style.css`, `www/files.html`, `www/files.js`,
`www/preview.html`, `www/preview.js`, and `www/preview.css` to SD `/www`. The main page now opens
as a dashboard with bottom navigation, quick machine state, workflow cards, and separate Controls
and Settings sections. Controls includes position, homing, safe jog, and Tool/Z Zero actions using
the existing command bridge. The file manager has matching dark card styling and a Rename action
using the existing API. The preview/job page is organized into Preview, Setup, Preflight, Dry Run,
Arm, and Run tabs while preserving the existing parser, job setup, preflight, dry run, arm, and
runner logic.

FreeCAD-style G54 handling has been added in firmware, so this change requires a firmware flash or
WebOTA plus the updated SD-hosted preview UI. Firmware version is now `0.4.1-freecad-g54`.
`/api/job/start` now accepts `startMode`. The default start mode,
`apply_current_position_as_work_zero`, sends `M5`, `G21`, `G90`, `G54`, `M400`, `M114`,
`G92 X0 Y0 Z0`, and `M114` before streaming file lines. `use_active_work_zero` sends the same
preamble without `G92`. During streaming, `G54` is allowed and logged as informational; `G55`
through `G59.3` are blocked unless the loaded `/jobs/*.job.json` contains
`"allowedWorkspaceCommands": true`.

The SD-hosted preview/run UI now treats `G54` as the normal FreeCAD default workspace command.
Preview and Preflight no longer fail on `G54`, but still warn or fail on non-default workspace
commands unless the job JSON explicitly allows them. The Run tab now shows FreeCAD G54 explanation
text, defaults Start Mode to `Apply current position as work zero`, and requires a four-item
physical start checklist before Start Job is enabled.

A follow-up JSON bug was fixed in `/api/job/status`: the `allowedWorkspaceCommands` field had an
extra quote before `fileSize`, causing Chrome to show `Expected ',' or '}' after property value in
JSON` after Start Job or Refresh Status. The firmware now builds cleanly with the corrected JSON.

The SD-hosted Run Job UI has also been hardened so browser/status parsing errors do not block
critical controls. Upload the updated `www/preview.js` to SD `/www`. Stop Job stays enabled even
when status is unknown, critical job actions tolerate malformed JSON after the request is sent, and
Stop Job falls back to best-effort `M5` and `M400` through `/api/cmd` if `/api/job/stop` fails.

A global mobile Machine Bar / Safety Drawer has been added as SD-hosted UI only. No firmware changes
were made for this patch. Upload `www/machine-bar.js`, `www/index.html`, `www/files.html`,
`www/preview.html`, `www/style.css`, and `www/preview.css` to SD `/www`. The shared bar appears on
the dashboard, files page, and preview/job page. It polls `/api/job/status` every 2 seconds while
visible, polls `/api/health` every 5 seconds, and exposes Pause, Stop Job, M5, Position, Zero, and
Homing controls through a touch-friendly drawer. It does not auto-poll M114; position updates only
after the user presses Refresh Position M114.

Priority-control hardening has been added in firmware, so this change requires a firmware flash or
WebOTA. Firmware version is now `0.4.2-priority-controls`. Firmware now has a quick job-status JSON helper for
Pause/Stop responses so those endpoints can acknowledge browser safety actions without blocking on
normal streamed G-code acknowledgements.

The job pause/stop endpoints now stop the file stream immediately and return quickly. Pause marks
`PAUSING` and queues priority `M5`/`M400`; Stop marks `STOPPING` and queues priority `M5`/`M410`.
The queued priority commands are processed from `loop()` instead of blocking the browser request.
Priority flags are cleared when jobs reach `PAUSED`, `STOPPED`, `COMPLETED`, or `ERROR` so status
polling does not show stale safety requests.

The SD-hosted Run panel and global Machine Bar have been updated for priority states. They now show
`PAUSING`, `RESUMING`, and `STOPPING`, keep M5 available, and update the visible state immediately
after Pause/Resume/Stop taps while firmware finishes the priority sequence.

`docs/protocol.md` now documents the priority control path separately from normal job streaming:
file lines still wait for Marlin `ok`, but Pause, Stop, and active-job `M5` stop/pause the stream
first and are not queued behind future file lines.

Follow-up safety UI fix: Machine Bar Pause and Stop no longer use browser confirmation, even when
job state is `UNKNOWN`. The Run tab also suppresses raw malformed-JSON text after critical job
actions and moves optimistically to `RUNNING`, `PAUSING`, `RESUMING`, or `STOPPING` so safety
controls stay usable while older firmware/status JSON is being updated. Machine Bar Pause and Stop
also tolerate malformed successful JSON responses from firmware.

Feed override support has been added. Firmware metadata is now `0.4.3-feed-override`, and job
status has fields for the current feed override percent plus last M220 command/response/error.
Firmware now parses `feedOverride.startPercent` and `resetTo100AfterJob` from job JSON, sends
`M220 S<startPercent>` during the job start preamble, exposes `POST /api/job/feed-override`, and
resets to `M220 S100` after completed/stopped/error jobs when configured. Live M220 requests are
queued only when the higher-priority Pause/Stop/M5 lane is free.
The SD-hosted preview UI now saves `feedOverride` in job JSON, shows G-code F min/max/count and the
effective feed range, and adds live feed override controls in the Run panel. The Machine Bar drawer
also has 50/75/100/125/150 and -10/+10 controls. Feed override changes movement speed only; it does
not change router RPM.

Verification passed for feed override: `node --check` on `www/preview.js` and `www/machine-bar.js`,
plus PlatformIO firmware build. Flash/WebOTA `0.4.3-feed-override` and upload updated
`www/preview.html`, `www/preview.js`, `www/machine-bar.js`, and `www/style.css` to SD `/www`.

## Next Step

Flash or WebOTA `0.4.3-feed-override`, upload the updated SD UI files, then test M220:
set 75% while idle, start a job with a saved `feedOverride.startPercent`, change to 50% while
running, restore 100%, and confirm Pause/Stop/M5 still take priority over feed override.

## Implemented Files

- `platformio.ini`
- `src/main.cpp`
- `data/index.html`
- `data/app.js`
- `data/files.html`
- `data/files.js`
- `data/style.css`
- `www/files.js`
- `www/machine-bar.js`
- `www/preview.html`
- `www/preview.js`
- `www/preview.css`
- `www/style.css`
- `docs/protocol.md`
- `docs/firmware-update.md`

## Constraints To Preserve

- Do not initialize or use the camera.
- Keep UART0 on GPIO3/GPIO1 at 250000 baud.
- Use setup AP SSID `LowRider-CNC-Setup` when no saved WiFi can connect.
- Keep the MVP offline and simple.

## Repository History

The working tree already had a local `.git/` directory, but no commits had been created yet.
Existing ignore rules already exclude local PlatformIO-generated `.vscode/c_cpp_properties.json`
and `.vscode/launch.json`, so the first project history can start from portable source, docs, and
SD UI artifacts rather than machine-specific editor state.

## License

The repository now has a root-level MIT `LICENSE` file using `Copyright (c) 2026 Marko Niitsoo`.
The README License section links to `LICENSE` and keeps CNC safety warnings separate from the MIT
warranty disclaimer.
