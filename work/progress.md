# Progress

## 2026-06-11

- Created and read `AGENTS.md`.
- Added initial project documentation:
  - `docs/architecture.md`
  - `docs/wiring.md`
  - `docs/protocol.md`
- Added work tracking files:
  - `work/current-task.md`
  - `work/progress.md`
  - `work/handoff.md`
- Added PlatformIO Arduino project files:
  - `platformio.ini`
  - `src/main.cpp`
  - `data/index.html`
  - `data/app.js`
  - `data/style.css`
- Implemented WiFi AP mode, HTTP static file serving, `GET /api/health`, and `POST /api/cmd`.
- Implemented simple UART0 command forwarding on GPIO3/GPIO1 at 250000 baud.
- Tightened root page handling so `/` and `/index.html` are explicit routes, with API routes kept separate.
- Attempted `pio run`, but PlatformIO is not installed or not available on PATH in this environment.
- Initialized a git repository for the project.
- Added `.gitignore` for PlatformIO build output and common VS Code generated files.
- Found PlatformIO at `C:\Users\marko\.platformio\penv\Scripts\pio.exe`.
- Verified firmware build with the VS Code-managed PlatformIO install.
- Verified SPIFFS filesystem image build for `data/index.html`, `data/app.js`, and `data/style.css`.
- Added `docs/setup.md` with exact PlatformIO commands.
- Added the project to Git's global `safe.directory` list for the Windows user so `git status` works.
- Configured PlatformIO to use `COM5` for upload and serial monitor.
- Verified PlatformIO detects the ESP32-CAM USB serial adapter on `COM5`.
- Uploaded the SPIFFS filesystem image with `index.html`, `app.js`, and `style.css` to the ESP32-CAM.
- Switched PlatformIO to `.pio-build` after a timed-out upload left the old `.pio` build artifact locked by Windows.
- Verified firmware build succeeds from `.pio-build`.
- Firmware upload to `COM5` is currently blocked because Windows reports the serial port is busy.
- Updated wiring documentation from the original SKR Pro UART6 assumption to the actual RX1/TX1 connection.

## 2026-06-12

- Added WebOTA support:
  - configured `min_spiffs.csv` OTA-capable partition layout
  - added firmware version/build metadata to `/api/health`
  - added `/update` firmware upload page
  - added multipart `POST /api/update` using Arduino `Update`
  - added `M5` and `M400` safety commands before OTA starts
  - added simple command lockout while OTA is active
- Added a Firmware Update link to the main UI maintenance panel.
- Updated architecture, protocol, and current task docs for WebOTA.
- Verified `pio run` succeeds with the OTA-capable `min_spiffs.csv` partition layout.
- Verified `pio run --target buildfs` succeeds for the updated web assets.
- Uploaded the WebOTA firmware to the ESP32-CAM on `COM5`.
- Uploaded the updated SPIFFS web UI assets to the ESP32-CAM on `COM5`.

## 2026-06-14

- Added saved WiFi station mode with setup AP fallback:
  - stores credentials in Preferences/NVS namespace `wifi`
  - uses keys `ssid` and `pass`
  - tries saved STA credentials for up to 15 seconds on boot
  - falls back to `LowRider-CNC-Setup` AP with password `12345678`
- Added WiFi health fields: `wifiMode`, `ipAddress`, `ssid`, and STA `rssi`.
- Added `/wifi`, `POST /api/wifi/save`, and `POST /api/wifi/forget`.
- Added a `WiFi Settings` link to the main maintenance panel.
- Updated docs for WiFi station mode, setup AP fallback, and WiFi API routes.
- Verified `pio run` and `pio run --target buildfs` succeed after the WiFi changes.
- Added SD-card rescue firmware update:
  - checks `/firmware/update.bin` and `/firmware/INSTALL.NOW` before WiFi starts
  - rejects missing, empty, or oversized update files
  - streams the update from SD_MMC with Arduino `Update`
  - removes the install marker after success or failure
  - renames successful updates to `/firmware/update.done.bin` when possible
  - writes failures to `/firmware/INSTALL.FAILED`
  - logs update progress/results to `/logs/update.log`
- Added `docs/firmware-update.md` with WebOTA and SD rescue update steps.
- Verified `pio run` and `pio run --target buildfs` succeed after the SD rescue update changes.
- Added SD card file management:
  - initializes SD_MMC in 1-bit mode and creates `/gcode`, `/www`, `/firmware`, `/jobs`, and `/logs`
  - adds SD status fields to `/api/health`
  - adds `/api/sd/status`, `/api/files`, `/api/download`, `/api/upload`, `/api/delete`,
    `/api/mkdir`, and `/api/rename`
  - rejects path traversal, doubled slashes, backslashes, and paths outside allowed SD roots
  - adds static `/files` UI with listing, upload, mkdir, download, delete, refresh, and parent navigation
  - adds an `SD Files` link to the main page
- Updated architecture, protocol, and current task docs for SD file management.
- Verified `pio run` and `pio run --target buildfs` succeed after the SD file manager changes.
- Added SD-card hosted web UI support:
  - serves `/` from `/www/index.html` when present
  - serves `/app.js`, `/style.css`, `/files.html`, `/files.js`, and other safe static assets from `/www` when present
  - keeps API routes, `/wifi`, `/update`, and generated `/files` behavior ahead of SD static fallback
  - falls back to built-in SPIFFS UI files when SD UI files are missing
  - adds `Cache-Control: no-store` for HTML, JavaScript, and CSS
  - adds `GET /api/ui/status`
- Updated architecture, protocol, and current task docs for SD-hosted UI support.
- Verified `pio run` and `pio run --target buildfs` succeed after the SD-hosted UI changes.
- Added SD-hosted browser-side G-code preview UI without firmware changes:
  - added `www/preview.html`
  - added `www/preview.js`
  - added `www/preview.css`
  - added `www/files.js` with Preview actions for `.gcode`, `.gc`, `.nc`, and `.tap`
- Preview downloads files through existing `/api/download?path=...`, parses G-code in the browser,
  renders XY toolpaths to canvas, shows bounds/statistics, and reports safety warnings.
- Parser MVP supports comments, `G0/G1`, `G2/G3` arcs with I/J approximation, `G20/G21`,
  `G90/G91`, `X/Y/Z/F`, and `M3/M4/M5` detection.
- Verified SD UI JavaScript syntax with `node --check`; no firmware build or upload is required for this UI-only change.
- Added SD-hosted job metadata and work-zero capture UI without firmware changes:
  - added a Job Setup panel to `www/preview.html`
  - derives `/jobs/<gcode-basename>.job.json` from the selected G-code path
  - loads and saves job JSON through existing `/api/download` and `/api/upload?overwrite=true`
  - captures current position with `M400` and `M114`
  - sets work zero with confirmed `G92 X0 Y0 Z0` plus before/after `M114` captures
  - downloads the in-memory job JSON from the browser
- Verified updated SD UI JavaScript syntax with `node --check`; no firmware build or upload is required for this UI-only change.
- Added SD-hosted Aircut Toolpath dry run without firmware changes:
  - extends the preview Dry Run panel with Generate/Send/Copy Aircut controls
  - generates XY-only safe-Z movement commands from parsed preview segments
  - preserves feedrate on generated `G1` aircut moves when available
  - excludes spindle start, original Z cutting depths, job streaming commands, `G92`, and homing
  - validates safe Z, work zero, LowRider X/Y bounds, large command counts, and Preflight failures before sending
  - sends aircut commands one at a time through existing `/api/cmd` with progress logging
  - stores last aircut status, timestamp, and command count in job JSON dry-run metadata
- Verified updated SD UI JavaScript syntax with `node --check`; no firmware build or upload is required for this UI-only change.
- Added SD-hosted Job Readiness / Arm Job panel without firmware changes:
  - adds NOT_READY, READY, ARMED, and STALE states to the preview page
  - computes the selected G-code SHA-256 hash in the browser with Web Crypto
  - requires preview bounds, no failed Preflight checks, complete work-zero capture, computed hash, and checked readiness checklist before arming
  - warns but does not block when bounding-box trace or aircut has not been completed
  - stores arm state, hash, preflight state, warning count, work-zero timestamp, dry-run status, and checklist in job JSON
  - detects stale armed jobs when the G-code hash changes, Preflight fails, or work zero is missing
  - supports Disarm Job, Save Armed Job, and Download Job JSON without sending any new G-code commands
- Verified updated SD UI JavaScript syntax with `node --check`; no firmware build or upload is required for this UI-only change.
- Added SD-hosted Dry Run panel without firmware changes:
  - generates safe-Z bounding-box trace commands from preview bounds
  - validates work zero, safe Z, and LowRider X/Y limits before enabling send
  - sends generated commands one at a time through existing `/api/cmd`
  - logs commands and responses in the browser
  - adds Copy Commands and Stop spindle/laser `M5`
  - stores dry-run settings and last trace status in job JSON on save
- Verified updated SD UI JavaScript syntax with `node --check`; no firmware build or upload is required for this UI-only change.
- Added CNC Job Runner MVP in firmware:
  - adds IDLE/PREPARING/RUNNING/PAUSED/COMPLETED/STOPPING/STOPPED/ERROR runner states
  - streams ARMED `/jobs/*.job.json` plus `/gcode` files from ESP32 SD card to Marlin in `loop()`
  - waits for Marlin `ok` before sending the next cleaned G-code line
  - adds `/api/job/start`, `/api/job/status`, `/api/job/pause`, `/api/job/resume`, and `/api/job/stop`
  - logs job start, pause, resume, stop, completion, and errors to `/logs/job.log` when SD is mounted
  - rejects non-ARMED job JSON with a minimal string check and TODO for robust JSON parsing
  - rejects most manual `/api/cmd` commands while a job is RUNNING, with status/safety command exceptions
- Added SD-hosted Run Job panel to the preview page:
  - visible only when the current job is ARMED
  - starts jobs by calling `/api/job/start` after browser confirmation
  - polls `/api/job/status` while running, preparing, stopping, or paused
  - shows state, progress, byte offset, line counts, last command, last response, and last error
  - provides Pause, Resume, Stop job: `M5 + pause stream`, and Refresh Status controls
- Updated firmware metadata to `0.3.0-job-runner`.
- Verified updated SD UI JavaScript syntax with `node --check`.
- Verified firmware builds successfully with PlatformIO after the job runner changes.
- Updated SD-hosted Arm Job fingerprinting without firmware changes:
  - uses Web Crypto SHA-256 when available
  - falls back to deterministic `size+fnv1a32+cyrb53` fingerprinting when SHA-256 is unavailable over local HTTP
  - stores `gcodeFingerprint` and `gcodeFingerprintAlgorithm` in job JSON
  - no longer blocks arming only because HTTPS/Web Crypto is unavailable
- Verified updated SD UI JavaScript syntax with `node --check`.
- Added SD-hosted Machine Controls and Tool/Z Zero controls without firmware changes:
  - created SD-hosted `www/index.html`, `www/app.js`, and `www/style.css` with Machine Controls
  - added M119, M114, Home X/Y, Home Z, and Home All controls using existing `/api/cmd`
  - requires confirmation before all G28 homing commands, with stronger confirmation for Home All
  - added Tool / Z Zero panel to `www/preview.html`
  - captures current position with `M400` and `M114`
  - sets only Z work zero with `M400`, `M114`, `G92 Z0`, `M114`
  - stores `toolZero` metadata in job JSON
  - marks an ARMED job STALE when Z zero changes
  - guards Z-zero setting while the job runner reports RUNNING/PREPARING/STOPPING
  - made newer Run Job button listeners tolerant of older uploaded preview HTML to avoid null `addEventListener` crashes
- Verified updated SD UI JavaScript syntax with `node --check`.
- Added firmware-backed Safe Analog Jog:
  - adds IDLE/PREPARING_SAFE_Z/JOGGING/STOPPING/ERROR jog states
  - adds `/api/jog/start`, `/api/jog/update`, `/api/jog/stop`, and `/api/jog/status`
  - Safe Jog defaults to lifting Z with `M5`, `G91`, `G0 Z<safeLiftZ> F<zFeedMax>`, and `G90`
  - emits only small relative movement ticks with `G91`/`G0`/`G90`
  - stops sending jog ticks if browser heartbeat is older than 500 ms
  - explicit jog stop sends `M410` and `M5`
  - rejects jog start while a CNC job is RUNNING
  - rejects most manual `/api/cmd` commands while jog is active, with basic status/safety exceptions
  - adds TODO for a future physical jog enable/arm button
- Added SD-hosted Virtual Joystick UI on the main page:
  - XY circular pointer joystick
  - separate Z+ and Z- hold buttons
  - Safe Jog toggle on by default
  - Safe Lift Z, XY speed, and Z speed controls
  - jog status display and `Stop Jog: M410 + M5` button
  - stops jog on pointer release, pointer cancel, page visibility loss, or window blur
- Updated firmware metadata to `0.4.0-safe-jog`.
- Verified updated SD UI JavaScript syntax with `node --check`.
- Verified firmware builds successfully with PlatformIO after Safe Analog Jog changes.
- Refactored the SD-hosted UI into a mobile-first CNC pendant layout without firmware changes:
  - replaced the long main page with a dashboard-first layout and bottom navigation
  - grouped machine position, homing, safe jog, quick commands, WiFi, firmware update, and SD links
  - added Tool/Z Zero controls to the Controls view using existing `M400`, `M114`, and `G92 Z0`
    command flow
  - added SD-hosted `www/files.html` so `/files` can use the same dark card layout from SD
  - added file rename UI using the existing `/api/rename` endpoint
  - reorganized the preview/job page into workflow tabs: Preview, Setup, Preflight, Dry Run, Arm,
    and Run
  - kept dangerous homing, jog stop, run, and delete actions visually separated
  - preserved existing `/`, `/files`, `/preview.html?path=...`, `/wifi`, `/update`, `/api/health`,
    and `/api/cmd` behavior
- Verified updated SD UI JavaScript syntax with `node --check`; no firmware build or upload is
  required for this UI-only change.

## 2026-06-16

- Added FreeCAD-friendly G54 handling for job start and streaming:
  - `/api/job/start` now accepts `startMode`
  - default `apply_current_position_as_work_zero` sends `M5`, `G21`, `G90`, `G54`, `M400`, `M114`,
    `G92 X0 Y0 Z0`, and `M114` before file lines
  - `use_active_work_zero` sends the same preamble without `G92`
  - job streaming allows `G54` and logs it as informational
  - job streaming blocks `G55`, `G56`, `G57`, `G58`, `G59`, `G59.1`, `G59.2`, and `G59.3` unless
    the job JSON contains `allowedWorkspaceCommands: true`
- Updated the SD-hosted preview/run UI for FreeCAD workspace behavior:
  - preview parser recognizes `G54` as the normal default workspace command
  - preview/preflight no longer fail on `G54`
  - preview/preflight continue to warn or fail on non-default workspace commands unless the loaded
    job JSON explicitly allows them
  - Run Job now includes a default start mode selector, FreeCAD G54 explanation text, and a
    required four-item start checklist
  - job JSON now saves `startMode`, `startChecklist`, and `allowedWorkspaceCommands`
- Updated protocol documentation for the new `/api/job/start` preamble and workspace handling.
- Verified `node --check` passes for `www/preview.js`, `www/app.js`, and `www/files.js`.
- Verified firmware builds successfully with PlatformIO after the FreeCAD G54 changes.
- Fixed a malformed `/api/job/status` JSON response introduced with the `allowedWorkspaceCommands`
  field:
  - removed an extra quote before `fileSize`
  - this fixes browser errors such as `Expected ',' or '}' after property value in JSON` after
    starting or refreshing a job
- Verified `node --check www/preview.js` passes and firmware builds successfully after the JSON fix.
- Hardened the SD-hosted Run Job UI so JavaScript/status parse errors do not block critical job
  controls:
  - Stop Job, Pause Job, Resume Job, and Start Job now use tolerant response parsing
  - Stop Job remains enabled when job status is unknown or unparsable
  - Stop Job falls back to best-effort `M5` and `M400` through `/api/cmd` if `/api/job/stop` fails
  - Run panel rendering is wrapped so render errors are logged instead of disabling controls
  - global browser error and promise rejection handlers log to the Run tab and keep Stop enabled
- Verified `node --check www/preview.js` passes after the Run Job hardening.
- Added a global SD-hosted mobile Machine Bar / Safety Drawer without firmware changes:
  - added shared `www/machine-bar.js`
  - included it on `/`, `/files`, and `/preview.html`
  - collapsed bar shows job state, running progress, compact X/Y/Z, Pause, Stop, M5, and drawer
    toggle
  - drawer groups Job Safety, Position, Zero, and Homing controls
  - uses existing `/api/job/status`, `/api/job/pause`, `/api/job/resume`, `/api/job/stop`,
    `/api/health`, and `/api/cmd`
  - disables homing and zero-setting while RUNNING, allows Z zero while PAUSED, and adds extra
    confirmation when state is UNKNOWN
  - Stop falls back to best-effort `M5` and `M400` if `/api/job/stop` fails
  - added dark mobile styling and sticky offsets for narrow phone layouts
- Verified `node --check` passes for `www/machine-bar.js`, `www/app.js`, `www/files.js`, and
  `www/preview.js`; no firmware build or upload is required.
- Started firmware priority-control hardening for job pause/stop/M5:
  - added a helper for quick job-status JSON responses with explicit success messages
  - this is part of making Pause, Stop Job, and M5 return immediately instead of waiting behind
    normal streamed G-code handling
- Reworked `/api/job/pause`, `/api/job/resume`, and `/api/job/stop` for nonblocking priority
  behavior:
  - Pause now closes the stream immediately, marks state `PAUSING`, queues priority `M5` and `M400`,
    and returns JSON immediately
  - Stop now closes the stream immediately, marks state `STOPPING`, queues priority `M5` and `M410`,
    and returns JSON immediately
  - Resume now transitions through `RESUMING` and only works from `PAUSED`
- Cleaned up job priority flags on completed, stopped, paused, and error transitions so `/api/job/status`
  does not report stale pause/stop requests after the state changes.
- Updated SD-hosted job UI priority states:
  - Run panel now polls and displays `PAUSING`, `RESUMING`, and `STOPPING`
  - Run panel shows priority command/status fields from `/api/job/status`
  - Mobile Machine Bar updates immediately to `PAUSING`, `RESUMING`, or `STOPPING` after priority
    button taps and disables only the unsafe duplicate controls
- Updated `docs/protocol.md` to document normal streamed G-code handling separately from the
  priority Pause, Stop, and M5 control path.
- Verified `node --check` passes for `www/preview.js` and `www/machine-bar.js`.
- Verified firmware builds successfully with PlatformIO after the priority Pause/Stop/M5 changes.
- Removed browser confirmations from Machine Bar Pause and Stop so priority controls fire immediately.
- Changed Run Job critical-action parsing so malformed JSON from older firmware no longer fills the
  log with raw parse errors after Start/Pause/Stop requests have already been sent; the UI now moves
  optimistically to `RUNNING`, `PAUSING`, `RESUMING`, or `STOPPING` and keeps safety controls usable.
- Made Machine Bar Pause and Stop tolerant of malformed successful JSON responses so the bar still
  moves immediately to `PAUSING` or `STOPPING` after firmware accepts the request.
- Verified `node --check` passes for `www/preview.js` and `www/machine-bar.js` after the no-confirm
  safety UI fix.

## 2026-06-17

- Started firmware-backed feedrate override support:
  - updated firmware metadata to `0.4.3-feed-override`
  - added job status fields for feed override percent and last M220 command/response/error
- Added firmware M220 support:
  - parses `feedOverride.startPercent` and `resetTo100AfterJob` from job JSON
  - sends `M220 S<startPercent>` in the job start preamble
  - adds `POST /api/job/feed-override` with 10-200 percent validation
  - queues live M220 as a priority control when no higher-priority command is active
  - resets feed override to 100 on completed, stopped, or error jobs when configured
- Added SD-hosted feed override UI:
  - Preview / Job Setup now has a Feed Override card saved into job JSON
  - preview parser reports G-code feed min/max/count and effective feed range
  - Run Job panel has live M220 quick buttons, -10/+10, and numeric input
  - Machine Bar drawer has quick feed override controls and shows current percent
  - values above 125% show caution styling; values above 150% require confirmation
- Updated `docs/protocol.md` for `POST /api/job/feed-override`, feed override status fields, and
  the `feedOverride` job JSON block.
- Verified `node --check` passes for `www/preview.js` and `www/machine-bar.js`.
- Verified firmware builds successfully with PlatformIO after feed override changes.

## 2026-06-18

- Confirmed the local `.git/` directory existed but the repository still had no commits.
- Kept local PlatformIO-generated VS Code files out of version history by relying on existing
  `.gitignore` rules for `.vscode/c_cpp_properties.json` and `.vscode/launch.json`.
- Prepared the project tree for an initial logical commit history instead of a single snapshot.
- Added a root-level MIT `LICENSE` file for `Copyright (c) 2026 Marko Niitsoo`.
- Updated the README License section to link to `LICENSE` while preserving the separate CNC safety
  disclaimer.
