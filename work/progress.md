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

## 2026-06-19

- Reviewed the phone screenshots added under `screenshots/`.
- Replaced the README screenshot TODO with a compact six-image gallery covering the dashboard,
  SD file manager, G-code preview, feed override setup, dry-run commands, and safe jog controls.
- Kept this as a documentation-only change; firmware, SD-hosted UI files, and PlatformIO settings
  were not modified.
- Updated Safe Analog Jog behavior:
  - firmware metadata is now `0.4.4-safe-jog-restore`
  - Safe Jog captures current Z with `M400`/`M114`, moves to an absolute safe Z target, and restores
    the captured Z after about 5 seconds if Z was not changed
  - default safe Z target is `70` mm
  - XY speed slider now represents 10-100 mm/s maximum feed, while joystick distance controls each
    tick's movement length
  - jog status reports captured Z and pending Z restore state
- Updated the SD-hosted dashboard jog UI labels/defaults and protocol/architecture documentation.
- Verified `node --check www/app.js` and PlatformIO `pio run` both succeed.
- Improved the SD-hosted joystick touch handling without firmware changes:
  - virtual joystick knob now follows pointer movement immediately during Safe Jog startup
  - pointer movement is no longer ignored while `/api/jog/start` is still waiting for safe Z setup
  - added touchmove/touchcancel fallback handling for mobile browsers
  - releasing the touch before jog startup completes now stops the jog instead of starting heartbeat late
- Verified `node --check www/app.js` succeeds after the touch handling fix.
- Improved the SD file manager UI so `/www` and other allowed roots can be selected without removing
  the SD card:
  - tapping the readonly Current path field opens a folder picker for `/gcode`, `/www`,
    `/firmware`, `/jobs`, and `/logs`
  - the picker lists nested directories through the existing `/api/files` endpoint
  - upload now has an enabled-by-default overwrite option for replacing existing UI files
  - mirrored the same behavior into SPIFFS fallback `data/files.html`, `data/files.js`, and
    `data/style.css`
- Verified `node --check www/files.js`, `node --check data/files.js`, and `pio run --target buildfs`
  succeed after the file manager UI changes.
- Smoothed firmware jog ticks for partial joystick movement:
  - XY feedrate is now scaled from the actual generated XY distance per tick
  - partial joystick deflection should move for roughly the full tick duration instead of making a
    quick short move followed by a pause
  - Z-only jog feedrate is also scaled from the generated Z distance per tick
- Verified PlatformIO `pio run` succeeds after the jog feedrate smoothing change.
- Fixed a dangerous Start Job behavior where `use_active_work_zero` could begin streaming without
  lifting Z first:
  - firmware metadata is now `0.4.5-safe-start-z`
  - `/api/job/start` accepts `safeStartZ`, defaulting to `15`
  - both `apply_current_position_as_work_zero` and `use_active_work_zero` now send
    `G0 Z<safeStartZ> F400` followed by `M400` before the first streamed G-code file line
  - Run Job UI exposes a Safe start Z field and sends it with the start request
  - job JSON now preserves `safeStartZ`
- Verified `node --check www/preview.js` and PlatformIO `pio run` succeed after the safe-start-Z
  fix.

## 2026-06-22

- Added planning documentation only; firmware logic, SD-hosted UI files, and `platformio.ini` were
  not changed for this documentation pass.
- Created `docs/mobile-job-flow.md` to capture the files-first, next-action mobile workflow, top
  Machine Drawer direction, Current Job view, Marlin message visibility, and bottom navigation
  direction.
- Created `docs/toolpath-model.md` to capture the future browser-side shared parser/model,
  separate bounds types, placement/origin/rotation behavior, generated run files, arc handling, and
  approximate time estimation.
- Created `docs/job-metadata.md` to describe `job.json` as job memory, including source references,
  preview, placement, feed override, zero history, run history, zero/run relationships, and future
  resume metadata.
- Created `docs/safety-testing.md` to define safety-critical test expectations for movement,
  coordinate zero, job start/resume, feed override, transforms, generated files, logs, and manual
  hardware testing.
- Added bounded Marlin message logging in firmware:
  - firmware metadata is now `0.4.6-priority-log`
  - commands and responses are recorded as `tx`/`rx`
  - priority commands are marked in the log
  - critical Marlin messages such as `Error:`, `ALARM`, `kill`, `Printer halted`, `endstops hit`,
    `Resend`, and `timeout` populate `lastCritical`
  - new `GET /api/marlin/log` returns recent log entries without unbounded growth
- Hardened manual `M5` priority handling so it is accepted during active/error job states and can
  replace a lower-priority queued feed override.
- Added `lastSentCommand` and `lastMarlinResponse` aliases to `/api/job/status`.
- Updated the SD-hosted Machine Bar to show recent Marlin messages and the latest critical message
  globally in the drawer.
- Added `docs/manual-tests.md` with priority Pause, Stop, M5, feed override, Marlin log, and safety
  invariant checks.

## 2026-06-23

- Added the first automated browser-side test package:
  - added `package.json` and `package-lock.json` with Vitest
  - added `node_modules/` to `.gitignore`
  - added pure testable modules `www/lib/gcode-core.mjs` and `www/lib/job-core.mjs`
  - added G-code fixtures under `test/fixtures`
  - added Vitest suites under `test/ui`
- Initial test coverage checks:
  - G-code comment stripping, modal units, coordinate mode, workspace commands, spindle enable,
    bounds, and feed command stats
  - Preflight pass/warning/fail classification for G54, G20, G91, G55, missing work zero, deep Z,
    and spindle enable
  - Feed override clamping and effective feed range
  - Current Job next-action ordering from file choice through Start Cut and live job states
- Updated `docs/safety-testing.md` with the Vitest command and current automated coverage.
- Verified `npm.cmd test` passes with 2 test files and 10 tests.
- Added the shared browser-side ToolpathModel layer:
  - created `www/lib/toolpath-model.js`
  - parses G-code into reusable modal state, segments, warnings, unsupported commands, bounds,
    feed statistics, and approximate estimate data
  - separates `rawTravelBounds`, `cutBounds`, and `placementBounds`
  - generates SVG thumbnails without modifying original G-code
  - merges preview metadata into job JSON without erasing `workZero`, `toolZero`, or `arm`
  - flags transform-sensitive commands such as `G91`, `G53`, `G55+`, source `G92`, `G18/G19`,
    cutter compensation, canned cycles, and unknown commands
- Added upload-time ToolpathModel UI on the SD-hosted root Files / Job Launcher:
  - selecting a G-code file shows thumbnail, placement bounds, warning count, feed range, and
    approximate estimated time before upload
  - after upload, the browser attempts to save `/jobs/thumbs/<file>.svg` and update
    `/jobs/<file>.job.json` preview metadata through existing SD file APIs
  - file lists show thumbnail/status badges when job JSON preview metadata exists
- Added ToolpathModel fixtures and unit tests:
  - simple square, FreeCAD G54, negative X offset, far parking move, feed values, G2/G3 arcs,
    G91, and source G92 fixtures
  - tests cover parser basics, bounds, warnings, feed stats, estimated time, thumbnails, metadata
    merge, and no generated movement commands
- Updated `docs/toolpath-model.md`, `docs/job-metadata.md`, `docs/mobile-job-flow.md`, and
  `docs/safety-testing.md` for the implemented model and limitations.
- Verified `node --check` passes for `www/app.js`, `www/files.js`, and `www/lib/toolpath-model.js`.
- Verified `npm.cmd test` passes with 3 test files and 23 tests.
- Refactored the SD-hosted mobile workflow UI without firmware changes:
  - `/` is now Files-first when no current job is selected
  - selecting a G-code file stores a browser-side current job pointer and opens the Current Job view
  - Current Job shows metadata, preview link, bounds, work/Z zero, warnings, dry-run, arm, feed
    override, and one next-action button
  - bottom navigation is now Files, Job, Logs, and Settings
  - `/files` uses compact tap-to-expand file rows and can set the current job
  - the shared Machine Drawer has sticky Pause/Resume/Stop/M5 controls, feed override with +/-1 and
    +/-10 controls, separate Home X/Home Y/Home Z/Home All buttons, a terminal, and disabled/TODO
    Go To Work Zero buttons until a safe firmware API exists
  - file row More actions include Rename, Download, View Raw / Details, and Delete where supported
  - the Machine Drawer shows a disabled/TODO joystick section so no joystick internals changed in
    this UI refactor
  - updated `docs/mobile-job-flow.md` with the implemented SD UI status and explicit non-goals
- Verified `node --check` passes for `www/app.js`, `www/files.js`, and `www/machine-bar.js`; no
  firmware build or upload is required for this UI-only refactor.
- Migrated full SD-hosted preview to the shared ToolpathModel layer without firmware changes:
  - added `www/lib/preview-data-adapter.js`
  - `www/preview.js` now parses selected G-code with `parseGCodeToToolpath()`
  - the canvas draws from ToolpathModel-derived segments through the adapter
  - Summary shows raw travel bounds, cut bounds, placement bounds, feed stats, rapid/cutting
    distance, and approximate estimated time
  - Warnings are grouped into workspace, unsupported, transform-sensitive, arc, coordinate, and
    general categories
  - negative offsets show a future "Fix Origin / normalize to bounds" placeholder instead of only a
    generic out-of-bounds warning
  - preview metadata is saved back to job JSON non-blockingly while preserving work/tool zero,
    dry-run, arm, feed override, zero history, and run history fields
- Added `test/ui/preview-data-adapter.test.mjs` for preview summary conversion, metadata merge,
  warning grouping, negative offset handling, parking move bounds, estimate override, and renderer
  safety.
- Verified syntax checks pass for `www/preview.js`, `www/lib/preview-data-adapter.js`,
  `www/lib/toolpath-model.js`, `www/app.js`, and `www/files.js`.
- Verified `npm.cmd test` passes with 4 test files and 30 tests.
- Added browser-side job memory history without firmware changes:
  - created pure `www/lib/job-history.js` for zero history, active zero IDs, run history, run-state
    updates, and zero/run status labels
  - setting Work Zero now keeps existing `workZero` compatibility data and appends a
    `zeroHistory` entry of type `workZero`
  - setting Tool / Z Zero now keeps existing `toolZero` compatibility data and appends a
    `zeroHistory` entry of type `zZero`
  - starting a job records a `runHistory` entry before `/api/job/start`, links it to active work/Z
    zero IDs, and appends the run ID to each zero's `usedByRuns`
  - observed completed/stopped/error status and Stop actions update the latest run entry when the
    current APIs expose enough lifecycle information
  - Preview / Job setup now has Zero History and Run History panels with metadata-only active-zero
    selection, details, labels, and future resume placeholders
  - Current Job now shows active zero timestamps and latest run state, with stopped/interrupted
    next-action hints
- Added `test/ui/job-history.test.mjs` for zero history append, active zero selection, run history,
  merge safety, display categorization, and metadata-only selection behavior.
- Updated job metadata, mobile workflow, and safety testing docs for zero/run history.
- Verified `node --check` passes for `www/preview.js`, `www/app.js`, and `www/lib/job-history.js`.
- Verified `npm.cmd test` passes with 5 test files and 35 tests.
- Added browser-side placement transform and inspection-only generated run files without firmware
  changes:
  - created pure `www/lib/toolpath-transform.js` for arbitrary-angle rotation, origin
    normalization, cut/raw bounds selection, transform safety checks, `.run.gc` generation, and
    placement metadata merge
  - added Preview / Job Placement / Origin controls for rotation angle, -90/-10/-1/+1/+10/+90
    steps, origin anchor, placement bounds mode, normalize-to-origin, Preview Transform, Generate
    Run File, and Reset Placement
  - transformed preview overlay renders on the existing preview canvas for inspection
  - generated run files are uploaded to `/jobs/generated/<safe-original-name>.run.gc` and labelled
    inspection-only
  - job JSON stores `placement`, `generatedRunPath`, `generatedRunBounds`, `sourceFingerprint`, and
    `transformFingerprint` only after generated file upload succeeds
  - generation blocks transform-unsafe commands including `G91`, `G53`, source `G92`, `G55+`,
    `G18/G19`, cutter compensation, and canned cycles
  - original `/gcode` files remain unchanged and Start Job does not automatically use
    `generatedRunPath`
- Added `test/ui/toolpath-transform.test.mjs` plus `g55-unsupported.gc` and
  `rotated-rectangle.gc` fixtures for transform math, normalization, generated G-code safety,
  unsupported-command blocking, arc-to-line generation, and metadata merge safety.
- Updated toolpath model, job metadata, mobile workflow, and safety testing docs for placement
  generation and inspection-only limitations.
- Verified `node --check` passes for `www/preview.js`, `www/app.js`, `www/files.js`,
  `www/lib/toolpath-model.js`, `www/lib/preview-data-adapter.js`, `www/lib/job-history.js`, and
  `www/lib/toolpath-transform.js`.
- Verified `npm.cmd test` passes with 6 test files and 48 tests.
- Added explicit active run file selection for generated `.run.gc` files:
  - created `www/lib/job-active-run.js` for source/generated active-run metadata, generated file
    validation, stale fingerprint detection, and arm/dry-run invalidation
  - added `Use Generated Run File` and `Use Original Source File` controls to the preview Placement
    panel
  - generated files remain unselected by default; selecting generated requires a valid generated
    validation result and user confirmation
  - full preview, Preflight, Dry Run, Arm, and Start Job now use `activeRun.path`
  - switching source/generated marks existing ARMED jobs stale and marks dry-run results stale
  - job JSON now records `sourceGcodePath`, `activeRun`, and `generatedValidation`
  - run history records active run mode/path and provenance fingerprints
- Added minimal firmware support for explicit generated run starts:
  - firmware metadata is now `0.4.7-active-run`
  - `/api/job/start` still allows normal source jobs under `/gcode`
  - `/api/job/start` allows `/jobs/generated/...` only when `activeRunMode` is `generated` and the
    ARMED job JSON contains the same path as a validated active generated run
  - firmware continues to reject other job start paths
- Updated `docs/protocol.md`, `docs/job-metadata.md`, `docs/toolpath-model.md`, and
  `docs/safety-testing.md` for active run selection and generated start validation.
- Added/updated Vitest coverage for generated active-run selection and run-history active-run
  provenance.
- Verified `node --check` passes for `www/preview.js`, `www/lib/job-active-run.js`, and
  `www/lib/job-history.js`.
- Verified `npm.cmd test` passes with 7 test files and 56 tests.
- Verified PlatformIO firmware build succeeds for `0.4.7-active-run`.
- Corrected generated placement UX so user placement changes are treated as operator intent:
  - placement changes now mark `activeRun.mode = "generated"` and make `/jobs/generated/*.run.gc`
    the required active run file
  - there is no extra normal-workflow `Use Generated File` confirmation step
  - generated run files are auto-updated with debounce where practical, and the manual button is now
    `Update Run File`
  - missing, pending, stale, or invalid generated files block Dry Run, Arm, and Start Job instead of
    falling back to the original source file
  - `Reset Placement / Use Original` is the explicit way back to source mode
  - dashboard next-action logic now shows `Update Run File` before zero/dry-run/arm/start when
    generated output is stale
  - generated run file comments no longer call the file inspection-only
- Updated `docs/job-metadata.md`, `docs/toolpath-model.md`, `docs/mobile-job-flow.md`,
  `docs/protocol.md`, and `docs/safety-testing.md` for the new visible-preview-is-intent model.
- Updated Vitest coverage for placement-generated intent, dirty placement, generated validation,
  reset-to-source behavior, and next-action `Update Run File`.
- Verified all requested JavaScript syntax checks pass.
- Verified `npm.cmd test` passes with 7 test files and 57 tests.
- Clarified generated placement bounds warnings without firmware changes:
  - Placement panel now distinguishes selected placement bounds from full generated run bounds
  - a fitted detail no longer shows the misleading `Generated bounds exceed configured LowRider work area`
    message just because full generated output contains a small negative travel/lead-in move
  - full-run travel or lead-in outside placement bounds is still shown as a clearance warning
  - generated run validation receives the visible placement bounds and stores the same clearer warning
- Added Vitest coverage for a generated file with negative lead-in outside otherwise valid placement
  bounds.
- Verified `node --check www/preview.js`, `node --check www/lib/job-active-run.js`, and
  `npm.cmd test` pass with 7 test files and 58 tests.
- Hardened activeRun/generated execution workflow without firmware changes:
  - added pure active-run helpers for source path, active run, execution path, generated requirement,
    generated usability, active fingerprint, stale marking, and execution assertions
  - old source-only job JSON now derives source-mode active run metadata while preserving existing
    work zero, tool zero, dry-run, arm, and history fields
  - Preflight, Dry Run, Arm, Start, Current Job, next-action logic, and Run History now share the
    same active-run execution invariant
  - transformed placement with missing, stale, pending, or invalid generated output blocks execution
    with `Update Run File` instead of falling back to the original source
  - Arm stores active run mode/path/fingerprint plus source/generated/transform fingerprints
  - Start Job sends the exact `activeRun.path` and includes active-run fingerprint fields in the
    request body for compatibility/audit
  - Dry Run metadata records the active run identity so stale dry-run state can be detected
  - Run History records `activeRunFingerprint` in addition to mode/path/provenance
- Updated job metadata, toolpath model, mobile flow, and safety testing docs for the activeRun
  execution truth model.
- Verified all requested `node --check` commands pass.
- Verified `npm.cmd test` passes with 7 test files and 62 tests.
- Started Job Readiness / Next Action workflow without firmware changes:
  - added shared `www/lib/job-readiness.js` model for active run, placement, zero, dry-run, arm,
    run state, blockers, badges, and primary/secondary actions
  - normalized current job context so source-only or partially loaded job JSON still resolves the
    selected `/gcode/...` file instead of reporting a false missing-file state
  - added focused Vitest coverage for source jobs, generated jobs, stale dry-run/arm state, running
    and paused live states, interrupted runs, badges, blockers, and safety invariants
  - verified `node --check www/lib/job-readiness.js`, `node --check test/ui/job-readiness.test.mjs`,
    and `npm.cmd test -- test/ui/job-readiness.test.mjs`
  - added a compact Job Readiness card to `www/preview.html` and `www/preview.js` showing source
    file, active run file, placement summary, zero state, dry-run state, arm state, blockers, and
    one primary next action
  - readiness primary actions navigate to the exact relevant panel or update the generated run file;
    no new movement commands or firmware behavior were added
  - wired dashboard `Current Job` / `Next Action` rendering to the same readiness helper so source
    vs generated active run, blockers, and primary next action match the preview page
  - documented the readiness model, primary action priority, generated stale blocking rules,
    active-run execution truth, and no-resume/no-new-movement boundaries in `docs/mobile-job-flow.md`,
    `docs/job-metadata.md`, and `docs/safety-testing.md`
  - verified all requested JavaScript syntax checks pass, including `www/preview.js`, `www/app.js`,
    `www/files.js`, `www/lib/job-active-run.js`, `www/lib/job-core.mjs`,
    `www/lib/job-history.js`, `www/lib/toolpath-model.js`, `www/lib/toolpath-transform.js`,
    `www/lib/preview-data-adapter.js`, and `www/lib/job-readiness.js`
  - verified `npm.cmd test` passes with 8 test files and 74 tests

## 2026-06-29

- Removed the remaining legacy Preview-page bottom navigation entries for Dashboard and Controls.
  Preview now uses the same Files, Job, Logs, and Settings navigation as the main SD-hosted UI.
- Simplified placement to an operator-first workflow:
  - zero-degree placement always uses the original source G-code
  - rotating a job automatically uses complete raw travel bounds, lower-left normalization, and a
    generated run file
  - removed the bounds, anchor, and normalization choices that could produce a preview/run mismatch
  - kept the toolpath canvas visible while Setup, Preflight, Dry Run, Arm, and Run panels are open
  - returning rotation to zero, including loading older zero-degree generated metadata, now switches
    execution back to the original source file automatically
- Added real G17 XY arc handling to the shared ToolpathModel:
  - G2/G3 with I/J or R are interpolated into accurate preview points and bounds
  - canvas and SVG thumbnails follow the arc instead of drawing a straight chord
  - transformed generated run files preserve G2/G3 and emit rotated I/J offsets
  - malformed arc geometry is reported explicitly and falls back to a visible endpoint line
- Updated job metadata, toolpath model, mobile flow, and safety-testing documentation to match the
  simplified placement policy and ToolpathModel v2 arc behavior.
- Added automated coverage for both I/J-offset and R-radius G2/G3 arc geometry.
- Corrected the R-arc fixture expectation to verify the clockwise arc appears on the positive-Y
  side for its selected start/end points.
- Removed dead placement-selector DOM references and the obsolete manual Normalize button after
  normalization became automatic for rotated jobs.
- Final verification passed:
  - all changed JavaScript files pass `node --check`
  - `npm.cmd test` passes with 8 test files and 75 tests
  - no legacy Dashboard/Controls HTML navigation or removed placement selector IDs remain
  - `git diff --check` reports no patch whitespace errors
- Started the skinnable UI/icon system on the mobile canvas workbench branch:
  - added pure `www/lib/ui-skins.js` manifest validation, known-skin registry, semantic icon role
    resolution, default fallback, accessible SVG/use markup, persistence, and browser initialization
  - added `test/ui/ui-skins.test.mjs` for bundled manifest validation, missing-role fallback,
    accessible markup, localStorage persistence, load failure fallback, and movement-command absence
- Added bundled Default, FreeCAD-like, and High Contrast skins under `www/skins/`, each with a
  manifest, theme variables, and self-contained icon sprite.
- Created the original CNC-ESP32 icon set for CAD/CAM placement, origin, zeros, fit/pan/zoom,
  source/generated paths, bounds, dry run, arm/start, safety controls, files, settings, terminal,
  and logs. No FreeCAD artwork or third-party SVG paths are included.
- Verified `node --check www/lib/ui-skins.js` and the focused skin suite (1 file, 6 tests).
- Added shared `www/skin-init.js` runtime initialization, dynamic icon observation, Appearance skin
  selector, localStorage switching, warning events/status, and theme stylesheet activation.
- Added semantic `data-icon` roles to canvas controls, placement/zero/dry-run/arm/start controls,
  bottom navigation/settings links, and critical Machine Bar Pause/Stop/M5 controls while keeping
  text and ARIA labels.
- Verified skin runtime, UI scripts, Machine Bar syntax, and focused skin tests after integration.
- Applied skin CSS variables to base panels/buttons, Machine Bar, workbench topbar, translucent
  overlays/drawers, status badges, edge handles, and canvas toolbar.
- Canvas source/generated/travel/cut paths, table, raw/cut/placement/dry-run bounds, work zero, and
  current position now resolve colors from active skin variables and redraw on skin change.
- Dynamic active-run/readiness chips and next-action buttons now update semantic icon roles through
  the shared skin helper.
- Added theme stylesheet load verification and automatic Default fallback if a selected theme fails.
- Expanded tests to audit every manifest icon against its sprite, critical text/ARIA labels, and
  workbench/canvas theme variable usage.
- Created `docs/ui-skins.md` and updated mobile flow/safety testing docs with skin architecture,
  role mapping, theme variables, FreeCAD-like inspiration/licensing boundary, fallback behavior,
  custom skin steps, static registry limitation, accessibility, and safety boundaries.
- Started the mobile canvas-first workbench on `codex/mobile-canvas-workbench`:
  - added pure `www/lib/workbench-ui.js` responsive layout, drawer, layer, active-run badge,
    readiness badge, and action-policy helpers
  - added Vitest coverage for phone/desktop layout modes, drawer isolation from `activeRun`, visual
    layer state, generated/source badges, stale generated next action, forbidden source fallback,
    hold-to-start, direct Pause/Stop/M5, and no G28/G92 metadata
  - verified `node --check www/lib/workbench-ui.js` and the focused 8-test workbench suite pass
- Added the canvas-first Preview workbench structure and responsive styling:
  - fixed status strip above a full-screen canvas
  - translucent left Tools and right Readiness edge drawers
  - compact bottom fit/zoom/mode/layer toolbar
  - mobile edge handles, scrim, compact typography, and tablet/desktop width adaptations
  - existing workflow panels retain their IDs and will be reparented into drawers by the UI layer
- Added `www/lib/workbench-controller.js`:
  - reparents existing Preview panels into left Tools and right Readiness drawers
  - supports one-pointer/mouse pan, two-pointer pinch zoom, mouse-wheel zoom, double-tap/double-click
    fit, edge swipe open, scrim/close dismissal, fit modes, interaction mode, and layer toggles
  - remains a UI-only controller with no job mutation or machine command behavior
- Integrated the workbench controller with `www/preview.js`:
  - top chips now derive connection, active-run, and readiness state from existing job status and
    shared readiness helpers
  - readiness actions open the correct drawer/tab while retaining `activeRun.path` as execution truth
  - canvas rendering now supports Fit Job/Table/Active/Zero, pan/zoom transforms, source/active/
    transformed paths, travel visibility, raw/cut/generated bounds, table, and work-zero layers
- Replaced Start Job's repeated confirmation dialogs with a one-second hold-to-confirm interaction
  for touch, mouse, and keyboard. Existing readiness, arm, checklist, and active-run checks still run
  before the API request. Pause, Stop, and M5 remain direct actions.
- Added swipe-to-dismiss behavior for both edge drawers and a focused test that placement drawer
  state contains no movement commands.
- Browser phone-width inspection found and fixed a top-offset issue: the two-row Machine Bar height
  is now measured into `--machine-bar-height`, so the workbench status strip no longer sits behind it.
- Browser inspection confirmed a 390x844 viewport has no body scroll, the canvas remains full width,
  and the 82%-width Tools drawer overlays rather than resizes it.
- Fixed drawer defaults so Tools opens Placement and Readiness opens Checks; connection begins
  OFFLINE until `/api/job/status` succeeds.
- Kept the simplified placement safety policy visible as compact read-only chips instead of
  reintroducing the removed bounds/anchor/normalize choices.
- Reduced Readiness drawer text to active execution path, mode, placement, rotation, latest run,
  compact blocker reasons, status chips, and existing primary/secondary actions.
- Selecting Open Job from either file launcher now stores the current job and opens the canvas
  workbench directly.
- Added optional current-position marker and completed dry-run bounds to the canvas when existing
  job status/metadata provides them.
- Documented the mobile canvas-first layout, top action area, edge/bottom drawers, Pointer Event
  gestures, layers, compact text policy, responsive modes, hold/direct confirmation policy, manual
  checks, and remaining TODOs in `docs/mobile-job-flow.md` and `docs/safety-testing.md`.
- Full automated suite passes with 9 test files and 84 tests.
- Final verification:
  - all requested `node --check` commands pass, including both new workbench modules
  - `npm.cmd test` passes with 9 files and 84 tests
  - phone 390x844 and desktop 1280x800 browser checks confirm fixed canvas, overlay drawers, no
    body scroll, responsive drawer widths, and correct default tabs/status
  - `git diff --check` passes
  - `git diff -- src` is empty; firmware was not changed

## 2026-06-29 - Skinnable UI And Semantic Icons

- Added a UI-only skin system with Default, FreeCAD-like, and High Contrast themes.
- Added original CNC/CAD semantic icon sprites and role-based icon fallback; no FreeCAD artwork or
  third-party icon paths were copied.
- Added the Appearance selector with localStorage persistence and safe fallback to Default when a
  selected manifest, theme, or icon role is unavailable.
- Applied theme variables to shared controls, Machine Bar, mobile workbench, and canvas layers while
  preserving text and ARIA labels on Start, Pause, Stop, and M5.
- Documented the manifest contract, icon roles, CSS variables, accessibility, custom-skin workflow,
  fallback behavior, and machine-safety boundary in `docs/ui-skins.md`.
- Added 8 skin tests covering manifests, sprite completeness, fallback, persistence, critical
  labels, forbidden motion commands, and workbench/canvas variable use.
- Final verification:
  - 15 JavaScript/module files pass `node --check`
  - `npm.cmd test` passes with 10 files and 92 tests
  - `git diff --check` passes
  - `git diff -- src` is empty; firmware was not changed
  - automated in-app browser inspection was unavailable because local HTTP browser access is
    blocked by the current browser security policy; phone visual verification remains manual

## 2026-06-29 - Local Mock Development Server

- Started the desktop-only mock environment without firmware changes.
- Added `dev/mock-sd.mjs` with safe ESP-style path mapping, persistent folders, file operations,
  traversal protection, reset support, and seeded safe/unsafe G-code samples.
- Added pure `MockMarlin` state simulation for position/G92, units, coordinate mode, G0/G1,
  G54+, M5, M220, M114, M115, M119, M400, M410, and configurable soft limits.
- Mock mode rejects unexpected G28/G53 by default and emits explicit soft-limit errors.
- Added focused MockSD and MockMarlin tests. No serial port or hardware API is opened.
- Added `MockJobRunner` with firmware-shaped status, start preamble, exact activeRun streaming,
  ARMED/fingerprint/generated validation, line acknowledgements, deterministic delay, pause/resume,
  stop, priority M5, feed override, workspace blocking, soft-limit errors, and completion reset.
- Added runner tests for source/generated execution, stale/missing generated blocking, dangerous Z,
  pause/resume/stop, M5, feed override, and no silent source fallback.
- Added `dev/mock-server.mjs` with the production UI static files and compatible health, SD/files,
  upload/download/delete/mkdir/rename, command/log, job status/start/pause/resume/stop, and feed
  override APIs. Unsupported mock APIs return explicit HTTP 501 TODO responses.
- Added `npm run dev:mock` and `npm run dev:mock:reset`; mock SD contents persist under
  `dev/mock-sd` until reset.
- Added a global Machine Bar badge driven by `/api/health.mockMode` so local pages always show
  `DEV MOCK - NO REAL MACHINE`; production health responses leave it hidden.
- Added API compatibility tests for static UI, commands, file operations, job start/status,
  traversal rejection, and explicit unsupported endpoints.
- Added `docs/mock-dev-server.md` plus README, mobile-flow, and safety-testing guidance covering
  startup/reset, visible mock identity, persistent paths, samples, APIs, Marlin commands, safety
  detection, job-runner rules, limitations, and the boundary between simulation and machine tests.
- Ignored `dev/mock-sd/` runtime state so local uploads/jobs do not enter source control.
- Matched the existing file manager's complete allowed-root set by including mock `/firmware` in
  addition to `/gcode`, `/www`, `/jobs`, and `/logs`.
- Final verification:
  - all 15 requested/new JavaScript modules pass `node --check`
  - `npm.cmd test` passes with 14 files and 107 tests
  - `npm run dev:mock:reset` restores seeded mock SD state
  - mock server startup smoke test prints the expected URL/mode and shuts down cleanly
  - `git diff --check` reports no patch whitespace errors
  - `git diff -- src` is empty; production firmware was not changed
  - mock server startup was smoke-tested; the Codex command sandbox does not preserve background
    child processes, so operator testing starts it from the project terminal
  - automated browser inspection remains unavailable under the current local-browser security
    policy; API/static compatibility is covered by Node integration tests
- Changed the mock server's default port from 8080 to 8097 to avoid the operator's llama.cpp
  service. No API, UI workflow, or firmware behavior changed.
- Enabled mock-server binding on `0.0.0.0` for phone/Oculus testing on the same LAN. Startup now
  prints all non-loopback IPv4 URLs and warns that mock APIs have no authentication.
- Documented private-network-only use, dynamic DHCP addresses, and the Windows Firewall Private
  network prompt. Production ESP32 network behavior remains unchanged.
- Fixed canvas touch/mouse pan Y direction: screen-space pan is now applied after the G-code-to-screen
  Y-axis inversion, so dragging the image up moves it up and dragging down moves it down.
- Added a pure canvas projection helper and regression test covering grab-style X/Y movement.
- Verified `node --check` for the changed UI modules and the full suite: 14 files, 108 tests pass.
- Automated LAN-browser gesture verification was blocked by browser URL policy; manual verification
  requires only refreshing the already open Preview page and dragging the canvas vertically.
- Compacted the global Machine Drawer UI without changing machine command semantics:
  - combined Pause/Resume state button beside Stop and M5
  - feed override current value and +/- controls on one row, presets on a second row
  - X/Y/Z homing on one row with Home All and M119 below
  - dropdown-based terminal with the Marlin log directly underneath
  - global live Marlin message strip while a job is active or a critical message exists
- Re-enabled the virtual XY joystick and Z hold buttons against the existing firmware deadman API.
  Pointer move updates the live vector, updates are sent every 150 ms, and pointer release/cancel,
  blur, visibility loss, or Stop Jog calls `/api/jog/stop`.
- Added firmware-backed `POST /api/work-zero/goto` for only X0, Y0, or XY0. It rejects active
  jobs, jog, and OTA; safe mode sends M5/G21/G90/G54, lifts to the selected positive Safe Z, moves
  only requested XY axes, waits with M400, and deliberately leaves Z at safe height.
- Direct-at-current-Z mode requires a stronger browser confirmation. Mock server implements the
  same endpoint for local workflow testing.
- Preserved the first captured pre-jog Z across repeated XY pointer gestures while the 5-second
  restore is pending, preventing a new gesture from replacing the real work Z with Safe Z.
- Extended the desktop mock with `/api/jog/start`, update, stop, and status simulation, small
  relative ticks, 500 ms heartbeat expiry, soft-limit handling, and M410+M5 stop behavior.
- Added focused UI/firmware safety tests for compact controls, combined Pause/Resume, terminal/log,
  joystick release paths, idle blur guard, bounded work-zero axes, active-state rejection, safe-Z
  ordering, and forbidden G92/G28/M3/M4 absence.
- Expanded mock HTTP tests for safe X0 and a complete start/update/stop jog cycle.
- Documented compact drawer behavior, live Marlin visibility, repeated-jog Z retention, mock support,
  and the bounded Go To Work Zero API in protocol, mobile-flow, safety-testing, mock-server, and
  README API docs.
- PlatformIO firmware build succeeds for `0.4.8-machine-controls` (15.0% RAM, 49.8% flash).
- Final control audit removed duplicate feed help text and changed work-zero success semantics from
  physical completion to command acceptance. Planner order still guarantees Safe Z is queued before
  XY, without imposing an invalid short M400 timeout on long table travel.
- Final verification passes:
  - 15 Vitest files and 114 tests
  - JavaScript syntax checks for changed UI and mock modules
  - PlatformIO ESP32-CAM build for `0.4.8-machine-controls`
  - 49,224 bytes RAM (15.0%) and 979,149 bytes flash (49.8%)
  - `git diff --check` reports no patch whitespace errors
- Corrected zoom anchoring math to use the canvas center as projection origin: wheel zoom now keeps
  the world point exactly under the cursor, and pinch zoom keeps it under the moving midpoint of
  both pointers. Zoom limits use the actual applied ratio.
- Fixed semantic icon alignment by adding the missing outer SVG 24x24 viewBox, centered aspect-ratio
  handling, and zero-line-height flex centering for icon slots.
- Final UI verification passes with 15 test files and 116 tests; changed modules pass `node --check`.
- Moved the full-width DEV MOCK banner into the machine state/XYZ row as a compact `DEV MOCK` badge.
  The full `DEV MOCK - NO REAL MACHINE` warning remains available as the badge title, while the
  workbench no longer loses vertical space to a separate mock row.
- Added a regression assertion that the mock badge remains inside the state/XYZ button row.
- Full suite passes after the compact badge change: 15 files, 117 tests.
- Diagnosed a real generated-run workflow blocker from mock job metadata: browser fallback stored
  `size+fnv1a+cyrb53`, while generated validation stored `size+fnv1a`; strict whole-string equality
  incorrectly declared the same file changed.
- Added shared fingerprint parsing/compatibility. Exact values still match, and fallback variants
  match only when both byte size and FNV-1a agree. Generated validation, dry-run, arm, readiness, and
  preview stale checks now use the shared rule; unrelated or genuinely changed files remain blocked.
- Added regression coverage using the exact short/full fallback fingerprint formats observed in
  `safe-rectangle.gc.job.json`, plus changed-size and changed-FNV rejection cases.
- Verified the actual persisted `safe-rectangle.gc.job.json` now resolves generated usability as
  `ok: true`. Full suite passes with 15 files and 118 tests.
- Replaced the static canvas `WORK ZERO 0,0` text with live state: `WORK ZERO NOT SET` until capture,
  then `WORK ZERO X0 Y0`. Work zero remains coordinate zero by definition and follows pan/zoom.
- Added a visible tool-position label and marker. Idle/setup position comes from guarded 5-second
  M114 polling shared by Machine Bar events; active-job fallback uses the endpoint of the latest
  acknowledged ToolpathModel line and labels it `CMD` rather than implying encoder feedback.
- Mock job status now exposes MockMarlin work position directly for local visualization.
- 2026-06-29: Made the canvas work-zero label state-aware and added a visible tool-position readout/marker. Idle setup positions come from guarded M114 polling; active-job fallback positions are labelled CMD and follow the last acknowledged G-code line. Mock job status now exposes its simulated position. No firmware behavior changed in this step.
- 2026-06-29: Corrected live commanded-position mapping by attaching the firmware-compatible cleaned command-line number to every preview motion segment, including approximated arc segments. Mock streaming now uses the same cleaned-line counter and unindexed segments are ignored rather than mistaken for the final position.
- 2026-06-30: Removed the canvas text overlay for Work Zero and TOOL coordinates. The selected work-zero `positionBefore`/legacy `beforeG92.position` now anchors work-zero cross, job geometry, bounds, and graphical tool position in homing-table coordinates; the tool remains a blue ring/dot while numeric XYZ stays in the Machine Bar. Added coordinate-translation tests. UI-only change; no firmware upload required.
- 2026-06-30: Hardened canvas markers after browser inspection: Work Zero label stays below-right normally but flips above-right near the lower toolbar, and the graphical tool ring remains visible independently of the Zero layer toggle.
- 2026-06-30: Added an adaptive millimeter grid to the canvas Table layer. Grid spacing uses readable 1/2/5 decade steps based on zoom, renders only the visible machine-table range, and shows indicative X/Y tick values plus `mm`; added pure grid-step tests.
- 2026-06-30: Softened the canvas overlay surfaces. The workbench top bar, drawers, toolbar, layer toggles, canvas label, and drawer panels now use lighter glass-style alpha backgrounds so the table remains faintly visible underneath. Added a regression check for the shared glass CSS variables.
- 2026-06-30: Removed blur from the translucent workbench overlays. The same surfaces stay semi-transparent, but `backdrop-filter` is no longer applied so the grid and toolpath remain readable underneath.
- 2026-06-30: Moved the Safe Jog joystick into its own floating glass dock at the lower-right edge of the machine UI. The dock now carries a settings gear that expands the jog options on demand, keeping the main drawer free for the graph and other machine controls.
- 2026-06-30: Tightened the floating joystick dock further. The jog stop action is now a compact icon button in the dock header, and the safety warning lives inside the hidden settings section so the dock stays small and unobtrusive.
- 2026-06-30: Collapsed the joystick into a right-edge handle by default. Only the narrow handle remains visible until the user opens it; the dock body is transparent, the jog pad uses a ring-on-ring glass style, and opening the main machine drawer automatically pushes the joystick away to avoid overlap.
- 2026-06-30: Removed the jog-dock stop button again so the only always-available Stop remains in the top machine drawer. The dock now stays focused on opening, hiding, safe XY/Z jogging, and settings.
- 2026-06-30: Reworked the jog dock into a true right-edge handle. The closed state now shows only the narrow joystick handle, the open panel expands left from it, the settings sheet floats above the ring instead of pushing it down, and the handle/settings icons were simplified to be more readable.
- 2026-06-30: Polished the joystick affordances again. The edge handle now uses a dedicated joystick glyph, the settings control uses an upward arrow, and the settings sheet remains anchored above the ring so Z controls do not shift the ring position.
- 2026-06-30: Tightened the joystick visuals again after browser review. The handle is more symmetrical, the settings toggle now uses a clearer chevron-up glyph, and the dock width/offset were nudged so the ring reads as a stable circular control instead of a skewed tab.
- 2026-06-30: Fixed the missing joystick handle regression. The dock was translated too far off-screen, so the closed state now keeps the right-edge handle visibly clickable again while still hiding the panel.
- 2026-06-30: Fixed the oversized joystick settings regression on mobile. The settings icon is now locked to 36 px instead of inheriting the global full-size SVG rule, opening the edge handle reveals only the stable XY ring, and the separate up-arrow reveals compact settings plus Z+/Z- controls above it. Verified at 390x844; no firmware change is required.
- 2026-06-30: Hardened joystick pointer handling and live position feedback. The knob now resets before any async stop work, global pointerup/pointercancel plus lost-capture handlers prevent stuck touches, stale start/update responses cannot revive a stopped jog, and the dock sits above the workbench at z-index 120. Confirmed browser jog ticks now mirror the firmware's 150 ms step math into the status bar and canvas immediately, while M114 remains the periodic truth correction and is requested once after initial job-state load. UI-only change; no firmware upload required.
- 2026-06-30: Prevented Android long-press copy/share menus on the Z+/Z- hold controls using touch-callout, selection, context-menu, and drag guards. Restyled the joystick edge handle to match the existing Tools/Status tabs: 28 px accent tab, matching corner radius/transparency, joystick glyph, and vertical Jog label. UI-only change.
- 2026-06-30: Corrected Safe Jog Z semantics after G92. Firmware now clamps requested Safe Z silently to the configured physical ceiling (`70 mm`) and uses `G53 G0 Z70` so the move is in native machine coordinates rather than offset work coordinates. It captures the lifted work Z with M114 for safe delayed-restore validation. UI and mock enforce the same ceiling; firmware version is `0.4.9-safe-z-clamp`.
- 2026-06-30: Safe Z clamp verification: all 15 Vitest files / 126 tests pass, including an explicit G92-offset mock case and guarded internal G53 behavior. JS syntax and `git diff --check` pass. PlatformIO build was attempted through the installed VS Code environment but could not acquire `C:\Users\marko\.platformio\platforms.lock`; the required elevated retry was unavailable due the execution-tool usage limit, so a fresh firmware build remains to be run before flashing.
- 2026-06-30: Separated physical table grid placement from work-coordinate ruler labels. Grid lines remain anchored to homed machine coordinates, while labels subtract the captured Work Zero machine offset; Work Zero at X100/Y500 therefore shows the table edges as X-100/Y-500 and keeps job geometry physically translated to X100/Y500. UI-only canvas change.
- 2026-06-30: Coordinate-layer verification passes: 15 test files / 127 tests, `node --check www/preview.js`, and `git diff --check` are clean.
- 2026-06-30: Removed the empty No Job destination. Preview now replaces the route with `/#files` when its path is missing, download fails, or preview initialization throws; matching stale browser current-job state is cleared. The main app validates the selected G-code through `/api/files` and refuses to show `/#job` without an openable current file.
- 2026-06-30: Files-first fallback verification passes: 16 Vitest files / 129 tests, JS syntax checks, and `git diff --check` are clean. Browser checks confirmed both `/preview.html` without a path and an unavailable `/gcode/does-not-exist.gc` land on `/#files`.
- 2026-06-30: Began the communication-efficiency integration with firmware `0.5.0-telemetry-transport`. Synchronous UART reads now stop on complete `ok`/`Error`/`Alarm` terminal lines instead of always waiting 1500 ms. Manual diagnostics return `409` rather than draining responses owned by an active job, priority sequence, or Safe Jog; M5 retains its earlier priority path. Added focused firmware source-contract tests.
- 2026-06-30: Consolidated browser polling into `/www/telemetry.js`. All pages share one in-flight-deduplicated health/job request owner; idle job polling is 10 s, active job polling 1 s, and health 30 s. Logs and jog status are requested only while their view/drawer is open. Removed automatic periodic M114 and Preview's separate job interval. Added telemetry regression tests.
- 2026-06-30: Added read-only delta telemetry over WebSocket port 81 using `links2004/WebSockets`. Firmware sends an initial job/jog snapshot and revisioned dirty-state deltas at no more than 10 Hz. HTTP remains the independent command/safety path. The UI reconnects with backoff and restores sparse HTTP job/jog polling on disconnect; nonstandard-port mock development intentionally stays on HTTP fallback.
- 2026-06-30: First WebSocket build reached the new library but exposed its mutable `String&` payload API. Snapshot/job/jog payloads now use named String variables before `sendTXT`/`broadcastTXT`; rebuild pending.
- 2026-06-30: Added demand-driven cursor log transport. Marlin log entries now carry monotonic IDs, `/api/marlin/log?after=<id>` returns only newer rows plus `nextId`, and WebSocket clients receive live log deltas only after subscribing from an open log/drawer UI. The browser merges and deduplicates entries by ID.
- 2026-06-30: Added changed-only position telemetry. Firmware parses XYZ from M114-shaped responses, caches the values, and emits a WebSocket `position` delta only when coordinates change. The browser publishes this as authoritative `MARLIN` position; predicted jog/job movement remains immediate. Homing now performs one explicit M114 after G28, with no background M114 loop.
- 2026-06-30: Communication-efficiency integration verification complete. All 18 test files / 140 tests pass; changed JavaScript files pass syntax checks; `git diff --check` is clean. PlatformIO builds firmware `0.5.0-telemetry-transport` successfully with WebSockets 2.7.3 at 50,884 bytes RAM (15.5%) and 997,825 bytes flash (50.8%). Local mock browser verification confirmed the shared Machine Bar/dashboard state and demand-loaded Logs view on HTTP fallback.
- 2026-06-30: Fixed the post-pinch canvas jump. When one pointer remains after a two-pointer zoom, its drag origin is now rebased to the current pan instead of retaining the pre-pinch single-pointer origin. Pinch gestures no longer enter double-tap Fit logic. UI-only change.
- 2026-06-30: Post-pinch fix verification passes: all 18 test files / 141 tests, `node --check www/lib/workbench-controller.js`, and `git diff --check` are clean.
