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

## README Screenshots

The README now includes a compact screenshot gallery using selected images from `screenshots/`.
The chosen images show the dashboard, SD file manager, G-code preview, feed override setup,
dry-run command preview, and safe jog controls. This was a documentation-only update; no firmware,
SD-hosted UI, or PlatformIO behavior changed.

## Safe Jog Restore

Safe Analog Jog has been updated in firmware and SD-hosted dashboard UI. Firmware metadata is now
`0.4.4-safe-jog-restore`. Safe Jog captures current Z with `M400`/`M114`, moves to an absolute
safe Z target before X/Y jogging, and schedules a return to the captured Z about 5 seconds after
jogging stops when Z was not changed. The default safe Z target in the UI and firmware is `70` mm.

The XY slider now represents maximum XY feed from 10 to 100 mm/s, mapped to `xyFeedMax` 600 to
6000 mm/min. Joystick distance from center controls the movement length of each firmware jog tick.
Upload updated `www/index.html` and `www/app.js` to SD `/www` after flashing/WebOTA firmware
`0.4.4-safe-jog-restore`.

Follow-up UI-only joystick smoothing was added in `www/app.js`. The knob now follows pointer/touch
movement immediately while `/api/jog/start` is still waiting for firmware Safe Jog setup, and
touchmove/touchcancel fallbacks are wired for mobile browsers. No firmware change is required for
that smoothing fix; upload the updated `www/app.js` to SD `/www`.

## File Manager Folder Picker

The file manager can now upload directly to `/www` from the browser. Tapping the readonly Current
path field opens a folder picker for `/gcode`, `/www`, `/firmware`, `/jobs`, and `/logs`, including
nested directories discovered through the existing `/api/files` endpoint. Upload has an
enabled-by-default overwrite checkbox so replacing SD-hosted UI files such as `/www/app.js` is no
longer a manual API call. The same behavior is mirrored in SPIFFS fallback `data/files.*`.

No firmware API changes were needed. Upload updated `www/files.html`, `www/files.js`, and
`www/style.css` to SD `/www`; if using fallback SPIFFS, rebuild/upload the filesystem image.

Safe Jog feed smoothing follow-up: firmware now scales jog feedrate from the actual generated
distance per 150 ms tick. Partial joystick deflection should therefore move for roughly the full
tick instead of making a fast short move and waiting. This is a firmware behavior change, so it
requires flashing/WebOTA the current firmware build.

## Safe Start Z

Start Job has been hardened after real-machine testing showed `use_active_work_zero` could begin
streaming while the tool was still at cutting depth. Firmware metadata is now
`0.4.5-safe-start-z`. `/api/job/start` accepts `safeStartZ` and both start modes send
`G0 Z<safeStartZ> F400` plus `M400` before the first streamed file line. `apply_current_position_as_work_zero`
still applies `G92 X0 Y0 Z0` first; `use_active_work_zero` still does not send `G92`.

The Run Job UI now has a Safe start Z field, defaulting from job JSON `safeStartZ` or dry-run
`safeZ` and falling back to 15 mm. Upload updated `www/preview.html` and `www/preview.js` to SD
`/www` after flashing/WebOTA firmware `0.4.5-safe-start-z`.

## Mobile Workflow And Safety Planning Docs

Four planning documents have been added without changing firmware logic, SD-hosted UI files, or
`platformio.ini`:

- `docs/mobile-job-flow.md`
- `docs/toolpath-model.md`
- `docs/job-metadata.md`
- `docs/safety-testing.md`

These documents define the intended direction for future work: files-first mobile UX, a persistent
Machine Drawer, Current Job / Next Action flow, browser-owned toolpath parsing and transforms,
generated run files under `/jobs/generated`, richer `job.json` memory, zero/run history, and
movement-related testing rules.

Future implementation tasks should treat these docs as product and safety guidance before adding
more job workflow, transform, resume, or movement features.

## Priority Controls And Marlin Visibility

Firmware metadata is now `0.4.6-priority-log`. Firmware keeps a bounded in-memory Marlin log and
exposes it at `GET /api/marlin/log`. Log
entries distinguish `tx` commands, `rx` responses, priority controls, and critical messages. The
latest critical Marlin text is returned as `lastCritical`.

Manual `M5` is accepted during `RUNNING`, `PAUSING`, `PAUSED`, `RESUMING`, `STOPPING`, and `ERROR`.
If only a lower-priority feed override is queued, M5 can replace it. Pause and Stop continue to stop
normal file streaming immediately and use the priority command path.

`/api/job/status` now includes `lastSentCommand` and `lastMarlinResponse` aliases in addition to the
existing `lastCommand` and `lastResponse` fields.

The SD-hosted Machine Bar drawer now polls `/api/marlin/log` and shows the latest Marlin message,
latest critical warning, and a recent bounded log. Upload updated `www/machine-bar.js` to SD
`/www` after flashing/WebOTA the firmware.

`docs/manual-tests.md` contains the current manual/simulated test checklist for Pause, Stop, M5,
feed override, Marlin log visibility, and safety invariants.

## SD Mobile Workflow Refactor

The SD-hosted `/www` UI has been refactored toward the Files -> Job -> Logs -> Settings phone flow
without firmware movement changes. Upload updated `www/index.html`, `www/app.js`, `www/files.html`,
`www/files.js`, `www/machine-bar.js`, and `www/style.css` to SD `/www`.

The root page now opens as a Files / Job Launcher when no current job is stored in browser
localStorage. Selecting a G-code file stores `lowrider.currentJob`, then the Job view shows current
file metadata, status, warnings, work/Z zero state, dry-run state, arm state, and a single primary
next action. The Logs view shows Marlin messages through `/api/marlin/log` when the current firmware
supports it.

The shared Machine Drawer now keeps Pause, Resume, Stop, and M5 in a sticky drawer header. It also
has feed override quick controls including +/-1%, separate Home X/Home Y/Home Z/Home All buttons,
manual terminal quick commands, a disabled/TODO joystick section, and disabled Go To Work Zero
buttons. Go-to-zero is intentionally disabled until firmware exposes a bounded safe API for that
behavior. Joystick internals were not changed in this pass.

This pass intentionally did not implement rotation/origin transforms, generated run files,
resume/recovery, joystick behavior changes, new firmware endpoints, or PlatformIO changes.

## First Automated Test Package

Vitest is now installed as the first browser-side unit test framework. Use:

```powershell
npm.cmd test
```

The first pure logic modules are:

- `www/lib/gcode-core.mjs`
- `www/lib/job-core.mjs`

The first tests are:

- `test/ui/gcode-core.test.mjs`
- `test/ui/job-core.test.mjs`

Fixtures live in `test/fixtures`. Current tests cover G-code parser safety basics, G54/G55
workspace handling, G20/G21, G90/G91, M3/M4 detection, bounds, feed stats, preflight classification,
feed override math, and Current Job next-action ordering.

Next testing step: move more of the live `www/preview.js` parser/preflight code and `www/app.js`
next-action logic onto these pure modules so tests exercise the same functions used by the UI.

## Shared ToolpathModel

A shared browser-side ToolpathModel now exists at `www/lib/toolpath-model.js`. It is used by the
SD-hosted root Files / Job Launcher upload flow and covered by Vitest tests. It parses source
G-code into reusable modal state, segments, warnings, unsupported commands, raw travel bounds, cut
bounds, placement bounds, feed statistics, and approximate time estimates.

Upload flow behavior:

- Selecting a G-code file in `/` parses it in the browser before upload.
- The UI shows an SVG thumbnail, placement bounds, warning count, feed range, and approximate
  estimated time.
- After upload, the browser tries to save `/jobs/thumbs/<safe-file-name>.svg`.
- It also merges preview metadata into `/jobs/<gcode-file>.job.json` through the existing upload
  API.
- Existing `workZero`, `toolZero`, `arm`, `dryRun`, and other job setup fields are preserved by the
  merge helper.

File list behavior:

- The root compact file list and `/files` page show thumbnail/status badges when job JSON preview
  metadata exists.
- If thumbnail metadata is missing, the UI keeps the existing placeholder.

Current status:

- Full `www/preview.js` now parses with `ToolpathModel`.
- `www/lib/preview-data-adapter.js` provides the compatibility shape still needed by existing
  dry-run, preflight, arm, and runner UI functions.
- The preview Summary panel shows raw travel bounds, cut bounds, placement bounds, feed stats,
  rapid/cutting distance, and approximate estimated time.
- Warning output is grouped by workspace, unsupported commands, transform-sensitive commands, arc
  approximation, coordinates, and general messages.
- Preview metadata is saved back to `/jobs/*.job.json` non-blockingly, preserving work/tool zero,
  dry-run, arm, feed override, zero history, and run history fields.

Remaining limitations:

- No rotation/origin UI was added.
- No generated transformed run files were written.
- No resume/recovery behavior was added.
- No firmware movement behavior changed.

## Zero And Run History

Browser-side job memory history has been added without firmware changes. Upload updated
`www/preview.html`, `www/preview.js`, `www/preview.css`, `www/app.js`, and `www/lib/job-history.js`
to SD `/www`.

Behavior:

- Confirmed Work Zero (`G92 X0 Y0 Z0`) still updates the existing `workZero` compatibility field
  and now appends a `zeroHistory` entry with before/after `M114` data.
- Confirmed Tool / Z Zero (`G92 Z0`) still updates the existing `toolZero` compatibility field and
  now appends a `zeroHistory` entry.
- `activeWorkZeroId` and `activeZZeroId` point at the currently selected history entries.
- Selecting a previous zero in the Zero History panel is metadata-only. It does not move the CNC
  and does not send `G92`.
- Starting a job creates a `runHistory` entry before `/api/job/start`, links active zero IDs, and
  appends the run ID to each zero's `usedByRuns`.
- Stop actions and observed terminal `/api/job/status` states update the latest run entry as far as
  current firmware status data allows.

UI:

- Preview / Job setup now has Zero History and Run History panels.
- Current Job shows active zero timestamps and the latest run state.
- Stopped/interrupted runs show review/future-recovery hints only.

Verification passed:

- `node --check www/preview.js`
- `node --check www/app.js`
- `node --check www/lib/job-history.js`
- `npm.cmd test` with 5 test files and 35 tests.

TODO for future recovery:

- Firmware/browser must record richer trusted position and line/byte recovery data.
- Safe resume must be a separate explicit feature with tested safe-Z motion.
- Selecting an old zero must remain metadata-only until a separately confirmed restore flow exists.

## Placement Transform And Generated Run Files

Browser-side placement transform support has been added without firmware changes. Upload updated
`www/preview.html`, `www/preview.js`, `www/preview.css`, and `www/lib/toolpath-transform.js` to SD
`/www`.

Behavior:

- Preview / Job now includes a Placement / Origin section on the Preview tab.
- The operator can inspect rotation angle, origin anchor, placement bounds mode, and
  normalize-to-origin behavior.
- Cut bounds are the default placement mode when available so parking/travel moves do not distort
  rotation/origin.
- Preview Transform draws an overlay on the existing preview canvas.
- Generate Run File writes `/jobs/generated/<safe-original-name>.run.gc` through existing SD file
  APIs and then stores placement metadata in job JSON.
- Generated files include a deterministic comment block, `G21`, `G90`, `G17`, `G54`, transformed
  `G0/G1` moves, `M5`, and `M400`.
- Generated files are explicitly inspection-only. Start Job does not automatically use
  `generatedRunPath` yet.
- Original files under `/gcode` remain unchanged.

Generation blocks transform-unsafe source commands including `G91`, `G53`, source `G92`, `G55+`,
`G18/G19`, cutter compensation, and canned cycles. Current `G2/G3` arc segments are emitted as
`G1` line segments with a warning.

Verification passed:

- `node --check www/preview.js`
- `node --check www/app.js`
- `node --check www/files.js`
- `node --check www/lib/toolpath-model.js`
- `node --check www/lib/preview-data-adapter.js`
- `node --check www/lib/job-history.js`
- `node --check www/lib/toolpath-transform.js`
- `npm.cmd test` with 6 test files and 48 tests.

TODO before real cutting from generated files:

- Add hardware/manual tests with router off and tool above material.
- Decide whether generated files need stronger line numbering or provenance logs.

Parser limitations:

- `G2/G3` arcs are marked as approximated for preview/statistics.
- `cutBounds` use an MVP rule: XY `G1`/arc movement below `Z0` is treated as engaged.
- `G91`, `G53`, `G55+`, source `G92`, `G18/G19`, cutter compensation, canned cycles, and unknown
  commands are warnings/unsupported for future transform safety.

Verification passed:

- `node --check www/app.js`
- `node --check www/files.js`
- `node --check www/preview.js`
- `node --check www/lib/preview-data-adapter.js`
- `node --check www/lib/toolpath-model.js`
- `npm.cmd test` with 4 test files and 30 tests

## Active Generated Run Selection

Generated `.run.gc` files are now selected by placement intent rather than by a separate
confirmation step. Upload updated `www/preview.html`, `www/preview.js`, `www/app.js`,
`www/lib/job-active-run.js`, `www/lib/job-core.mjs`, `www/lib/job-history.js`, and
`www/lib/toolpath-transform.js` to SD `/www`.

Behavior:

- Identity/default placement uses the original source file under `/gcode`.
- When the operator changes rotation, origin, bounds mode, or normalize behavior, the visible
  placement is treated as intent and `activeRun.mode` becomes `generated`.
- Generated run files are updated automatically with debounce where practical. The manual button is
  `Update Run File`.
- Missing, pending, stale, or invalid generated files block Dry Run, Arm, and Start Job. The system
  must not silently fall back to source while showing transformed placement.
- `Reset Placement / Use Original` is the explicit way back to the original source file.
- Switching active source/generated or changing placement marks existing arm state and dry-run
  results stale.
- Full Preview, Preflight, Dry Run, Arm, Start Job, and Run History use the selected `activeRun.path`.
- Run history now records `sourceGcodePath`, `activeRunMode`, `activeRunPath`, and source/generated
  provenance fingerprints.

Firmware metadata is now `0.4.7-active-run`, so this change also requires flashing/WebOTA. Normal
source jobs still start only from `/gcode`. Generated jobs may start from `/jobs/generated/...` only
when the request includes `activeRunMode: "generated"` and the ARMED job JSON contains that same
validated active generated path. Other start paths remain rejected.

Verification passed:

- `node --check www/preview.js`
- `node --check www/app.js`
- `node --check www/files.js`
- `node --check www/lib/toolpath-model.js`
- `node --check www/lib/preview-data-adapter.js`
- `node --check www/lib/job-active-run.js`
- `node --check www/lib/job-history.js`
- `node --check www/lib/toolpath-transform.js`
- `node --check www/lib/job-core.mjs`
- `npm.cmd test` with 7 test files and 57 tests
- PlatformIO `pio run` firmware build

## Generated Bounds Warning Clarification

The SD-hosted preview UI now distinguishes the visible selected placement bounds from the full
generated run bounds. This is important for files that fit on the table but include small negative
lead-in or travel moves around the selected cut bounds.

Upload updated `www/preview.js` and `www/lib/job-active-run.js` to SD `/www`. No firmware upload is
required for this clarification.

Behavior:

- If the selected placement bounds exceed the configured LowRider work area, the UI still reports a
  work-area problem.
- If the selected placement fits but the full generated file includes travel or lead-in moves
  outside that placement, the UI now shows a clearance warning instead of saying the generated
  bounds exceed the LowRider work area.
- Generated run validation receives the visible placement bounds so saved job JSON warnings use the
  same clearer wording.
- `G2/G3` arcs are still emitted as `G1` line segments in generated output and remain visible as a
  separate warning.

Verification passed:

- `node --check www/preview.js`
- `node --check www/lib/job-active-run.js`
- `npm.cmd test` with 7 test files and 58 tests

## ActiveRun Execution Hardening

The active run workflow has been hardened without firmware changes. Upload updated
`www/preview.js`, `www/app.js`, `www/lib/job-active-run.js`, `www/lib/job-core.mjs`, and
`www/lib/job-history.js` to SD `/www`. Firmware `0.4.7-active-run` remains compatible; no new
movement behavior was added.

Behavior:

- `activeRun.path` is the execution truth for Preflight, Dry Run, Arm, Start Job, and Run History.
- `sourceGcodePath` remains the original uploaded `/gcode/...` file.
- Identity/default placement uses source mode.
- Transformed placement requires generated mode under `/jobs/generated/...`.
- Missing, pending, stale, or invalid generated output blocks execution and makes `Update Run File`
  the required next action.
- The UI must not silently fall back to the original source file while showing transformed
  placement.
- Older job JSON files with only `gcodePath` derive source-mode `activeRun` metadata without
  deleting setup or history fields.
- Arming stores active run mode, path, active fingerprint, source fingerprint, generated
  fingerprint, and transform fingerprint. If these change, the arm state is stale and the job must
  be reviewed and re-armed.
- Dry-run metadata records the active run identity so dry runs can become stale when the run file
  changes.
- Run history records `activeRunFingerprint` in addition to active mode/path and generated
  provenance.

Verification passed:

- `node --check www/preview.js`
- `node --check www/app.js`
- `node --check www/files.js`
- `node --check www/lib/job-active-run.js`
- `node --check www/lib/job-core.mjs`
- `node --check www/lib/job-history.js`
- `node --check www/lib/toolpath-model.js`
- `node --check www/lib/toolpath-transform.js`
- `node --check www/lib/preview-data-adapter.js`
- `npm.cmd test` with 7 test files and 62 tests

## Job Readiness / Next Action In Progress

Work started on a shared `www/lib/job-readiness.js` helper. It derives the active run, blocker list,
badges, and primary next action from job JSON plus live job status. It is SD UI / JavaScript only;
firmware has not been changed.

Initial helper tests are in `test/ui/job-readiness.test.mjs` and cover source/generate/stale/live
state behavior plus the no-movement-command invariant.

`www/preview.html`, `www/preview.js`, and `www/preview.css` now include a compact Job Readiness
card. It shows source path, active run path, badges, placement, zero/dry-run/arm/run state, blockers,
and primary/secondary next actions. Actions navigate to existing panels or update the generated run
file only; no new movement behavior was added.

Dashboard `www/app.js` now uses the same helper for Current Job / Next Action so the first screen and
preview page agree about active run path, blockers, and the primary next action.

Docs updated:

- `docs/mobile-job-flow.md` describes primary action priority and the visible readiness card.
- `docs/job-metadata.md` documents the readiness model and generated stale blocking rules.
- `docs/safety-testing.md` lists the new readiness-helper test coverage and invariants.

Verification passed:

- `node --check www/preview.js`
- `node --check www/app.js`
- `node --check www/files.js`
- `node --check www/lib/job-active-run.js`
- `node --check www/lib/job-core.mjs`
- `node --check www/lib/job-history.js`
- `node --check www/lib/toolpath-model.js`
- `node --check www/lib/toolpath-transform.js`
- `node --check www/lib/preview-data-adapter.js`
- `node --check www/lib/job-readiness.js`
- `npm.cmd test` with 8 test files and 74 tests

Upload updated SD UI files to `/www`: `app.js`, `style.css`, `preview.html`, `preview.js`,
`preview.css`, and `lib/job-readiness.js`. Firmware upload is not required.

## Preview Workflow Polish In Progress

- `www/preview.html` now uses the current Files, Job, Logs, and Settings bottom navigation. The
  legacy Dashboard and Controls links were removed.
- Placement now has one predictable policy: rotation `0` uses the untouched source file; a non-zero
  rotation fits and normalizes the complete raw travel path into a generated run file. The bounds,
  anchor, and normalize selectors were removed from the operator UI.
- Returning rotation to `0` automatically selects the original source G-code, including when an
  older job JSON still points at a zero-degree generated run.
- The preview canvas is always present and sticky across the Job workflow tabs so placement changes
  remain visible while setup and readiness panels are reviewed.
- ToolpathModel v2 now resolves G17 G2/G3 geometry from I/J or R, uses interpolated points for
  preview/bounds/thumbnails, and preserves G2/G3 with transformed I/J offsets in generated run files.
- `docs/job-metadata.md`, `docs/toolpath-model.md`, `docs/mobile-job-flow.md`, and
  `docs/safety-testing.md` describe the new behavior.
- Arc tests cover both common I/J output and R-radius commands.
- The R-form test explicitly checks clockwise sweep direction as well as radius and interpolation.
- No legacy placement selectors or non-functional Normalize action remain in the Preview UI.

Verification passed with all requested JavaScript syntax checks and `npm.cmd test` (8 files,
75 tests). No firmware source was changed for this task.

Upload these updated SD UI files to `/www`:

- `preview.html`
- `preview.js`
- `preview.css`
- `lib/toolpath-model.js`
- `lib/toolpath-transform.js`
- `lib/preview-data-adapter.js`
- `lib/job-active-run.js`
- `lib/job-readiness.js`

No firmware upload is required.

## Skinnable UI Complete

- Added `www/lib/ui-skins.js` and `test/ui/ui-skins.test.mjs`.
- Skin/icon code is UI-only and contains no G28, G92, M3, M4, homing, or movement behavior.
- Bundled skins now exist at `www/skins/default`, `www/skins/freecad-like`, and
  `www/skins/high-contrast`, each with `skin.json`, `icons.svg`, and `theme.css`.
- Icon artwork is original to this project; FreeCAD artwork was not copied.
- Focused skin tests pass: 1 file, 8 tests.
- `www/skin-init.js` initializes skins on index, preview, and files pages, observes dynamic controls,
  persists Appearance selection, and applies semantic icons without removing critical text labels.
- Runtime integration syntax checks and focused skin tests pass.
- Workbench components and canvas layers now consume `--cnc-*` theme variables. Dynamic badges and
  readiness actions update semantic icons through `window.CncSkin`.
- Theme CSS failure falls back to Default; tests audit sprite completeness, critical labels, and
  canvas/workbench theme-variable integration.
- Skin architecture, original-artwork rule, custom skin workflow, fallback, accessibility, and
  safety boundaries are documented in `docs/ui-skins.md`, mobile flow, and safety testing docs.
- Full Vitest suite passes: 10 files, 92 tests. Fifteen UI modules pass `node --check`,
  `git diff --check` passes, and firmware `src/` has no diff.
- Automated local browser inspection was blocked by the current browser security policy. Perform a
  final phone check after copying the UI bundle to SD: change Appearance through all three skins,
  reload to verify persistence, and confirm Start/Pause/Stop/M5 retain visible text and icons.

Upload these skin UI files to `/www` while preserving directories:

- `index.html`
- `files.html`
- `preview.html`
- `style.css`
- `preview.css`
- `preview.js`
- `machine-bar.js`
- `skin-init.js`
- `lib/ui-skins.js`
- `skins/default/skin.json`, `icons.svg`, `theme.css`
- `skins/freecad-like/skin.json`, `icons.svg`, `theme.css`
- `skins/high-contrast/skin.json`, `icons.svg`, `theme.css`

No firmware upload is required for the skin system.

## Local Mock Development Server In Progress

- Added `dev/mock-config.json`, `dev/mock-sd.mjs`, and `dev/mock-marlin.mjs` as desktop-only code.
- Mock SD state will live under `dev/mock-sd`; source UI files remain in repo `www/`.
- Seed samples include safe square/rectangle plus negative-X, out-of-bounds, and dangerous-Z jobs.
- G28 and G53 are rejected by default in MockMarlin; no real serial connection is created.
- Added focused unit tests under `test/mock/`.
- Next: add mock job runner, HTTP API/static server, visible mock badge, scripts, docs, and full tests.
- Added `dev/mock-job-runner.mjs`; it imports the production UI active-run invariant instead of
  reimplementing source/generated fallback decisions.
- Runner streams only the armed `activeRun.path`, blocks stale/missing generated output, and models
  firmware-shaped pause/resume/stop/feed/status behavior without physical timing or serial I/O.
- Next: add HTTP API/static server, visible mock badge, scripts, docs, and full tests.
- Added the Node HTTP server and package scripts. Run `npm run dev:mock`, then open
  `http://localhost:8097`; reset persistent sample state with `npm run dev:mock:reset`.
- Health includes `mockMode: true`, and the global Machine Bar displays a high-contrast
  `DEV MOCK - NO REAL MACHINE` badge. Production firmware behavior is unchanged.
- HTTP tests cover core UI/API compatibility. Safe jog remains an explicit mock TODO and returns
  HTTP 501; no joystick behavior was added or changed.
- Next: finish documentation, full syntax/test audit, and manual local smoke test where permitted.
- Added complete operating notes in `docs/mock-dev-server.md` and a short README development entry.
- Added safety/mobile documentation for the global mock badge and simulation limitations.
- Runtime `dev/mock-sd/` is git-ignored; use `npm run dev:mock:reset` to restore seeded samples.
- MockSD supports all existing file-manager roots, including `/firmware`; firmware upload/update
  execution itself is intentionally not simulated.
- Local mock development feature is complete. Final audit: 15 syntax checks pass, 14 Vitest files
  and 107 tests pass, diff whitespace is clean, and firmware `src/` has no diff.
- Start the mock server from the project terminal with `npm run dev:mock`, then open
  `http://localhost:8097`. Reset state with `npm run dev:mock:reset`.
- Browser-level visual automation was blocked by the current local-browser security policy. The
  remaining manual check is to open the URL, verify the yellow mock badge, and walk through sample
  Preview -> placement/generated -> Preflight -> Dry Run -> Arm -> Start/Pause/Stop.
- Mock server now defaults to `http://localhost:8097`; port 8080 remains available for llama.cpp.
- Mock server now binds to `0.0.0.0` and prints `LAN:` URLs for mobile/Oculus testing. Current Wi-Fi
  address observed during implementation: `http://192.168.8.142:8097`.
- LAN mock APIs are unauthenticated. Use only on a trusted private network and do not create a router
  port-forward. This change affects desktop mock development only, not ESP32 firmware.
- Canvas panning now follows direct-manipulation semantics on mouse and touch. `panY` is applied in
  screen coordinates after the machine Y-axis inversion, with a focused regression test.
- Full suite passes with 108 tests. Refresh the mock Preview page before testing because the local
  server serves source files directly but the browser may retain the previously loaded script.
- Machine Drawer compaction, joystick restoration, mock jog support, and bounded Go To Work Zero
  are implemented.
- Go To Work Zero is now backed by firmware endpoint `/api/work-zero/goto`; X0/Y0/XY0 never send
  G92 or Z0. Safe mode lifts first and does not automatically lower Z. This firmware change requires
  a wired/WebOTA/SD-rescue firmware update before the controls work on the ESP32.
- Repeated safe XY jog gestures retain the original captured Z until restore. Mock mode now supports
  the jog API, so joystick UI can be exercised from desktop/mobile/Oculus without CNC hardware.
- Focused tests cover the compact drawer and new movement safety invariants. Automatic blur/hidden
  stop is guarded so an idle page cannot emit M410/M5 merely because focus changed.
- PlatformIO build passes for firmware `0.4.8-machine-controls`: 15.0% RAM and 49.8% flash.
- Work-zero endpoint returns after Marlin accepts the ordered lift/XY commands; it does not claim
  long physical travel is already complete or wait on M400 through a short HTTP timeout.
- Final verification: 114 tests and the PlatformIO build pass. Refresh the mock UI to load the new
  Machine Bar. Real ESP32 Go To Work Zero requires flashing `0.4.8-machine-controls`; the compact
  UI and existing jog controls are SD `/www` updates.
- Wheel and pinch zoom now preserve their screen-space anchor under cursor/midpoint. Semantic icons
  render inside an explicit 24x24 SVG viewport instead of being clipped or offset by CSS sizing.
- Final suite after zoom/icon fixes: 15 files, 116 tests pass. Refresh the mock page to load the
  updated UI modules; no additional firmware flash is needed for these two visual fixes.
- Mock identity is now a small badge in the state/XYZ row rather than a full-width banner. This is a
  UI-only change and appears after refreshing the mock page.
- Final suite after the badge change: 15 files, 117 tests pass.
- Fixed false `Generated run fingerprint changed` blocking for fallback fingerprints where one
  component stores `size+fnv1a` and another stores `size+fnv1a+cyrb53`. Compatibility requires the
  same size and FNV-1a; this is UI/shared metadata logic only and needs no firmware flash.
- Actual mock `safe-rectangle.gc.job.json` validation returns `Generated run file is valid`; final
  suite passes with 118 tests. Refresh Preview, then continue Dry Run -> Arm -> Start.
- Canvas now distinguishes work zero from tool position. M114 positions are shown as actual reported
  work coordinates; during a real running job without a status position field, the marker is labelled
  `CMD` and represents the latest acknowledged G-code endpoint, not measured physical position.
- Next: run the complete syntax/test/diff audit and report any remaining mock limitations.

## Mobile Canvas Workbench In Progress

- Feature branch: `codex/mobile-canvas-workbench`.
- Added pure `www/lib/workbench-ui.js` state helpers and `test/ui/workbench-ui.test.mjs`.
- The helper layer contains no machine commands and does not mutate job or `activeRun` metadata.
- Focused workbench tests pass: 1 file, 8 tests.
- `www/preview.html` and `www/preview.css` now define the full-screen canvas, top status strip,
  translucent left/right edge drawers, and bottom canvas toolbar. Existing panel IDs are preserved.
- Added `www/lib/workbench-controller.js` for panel reparenting, drawers, gestures, fit/zoom, and
  visual layer state. It does not send machine commands.
- `www/preview.js` now renders and labels the canvas from controller fit/pan/zoom/layer state and
  uses shared readiness/active-run helpers for the top workbench badges.
- Start Cut is now hold-to-confirm instead of repeated modal confirmation. Pause/Stop/M5 remain
  direct. Drawer swipes only change UI state and do not create movement commands.
- Workbench top offset follows the measured Machine Bar height on narrow two-row phone layouts.
- Phone browser inspection confirms full-width canvas, no page scroll, and translucent overlay
  drawers. Tools defaults to Placement; Readiness defaults to Checks; connection defaults OFFLINE.
- Placement shows the fixed lower-left/full-travel/normalize-on policy as read-only chips.
- File selection now returns directly to `/preview.html?path=...`; Readiness uses compact text.
- Existing current-position and completed dry-run metadata render as optional canvas layers.
- Canvas workbench architecture, responsive behavior, gestures, layer controls, safety confirmation
  policy, tests, manual checks, and TODOs are documented in `docs/mobile-job-flow.md` and
  `docs/safety-testing.md`.
- Full Vitest suite passes: 9 files, 84 tests.
- Final browser checks passed at 390x844 and 1280x800. All requested syntax checks and
  `git diff --check` pass. Firmware `src/` has no diff.

Upload these SD UI files to `/www`:

- `app.js`
- `files.js`
- `preview.html`
- `preview.css`
- `preview.js`
- `lib/workbench-ui.js`
- `lib/workbench-controller.js`

No firmware upload is required.
- 2026-06-29 tool-position UI: the canvas overlay now says `WORK ZERO NOT SET` until a captured work zero exists, then `WORK ZERO X0 Y0`. `TOOL ... M114` is an idle/setup position, `TOOL ... STATUS` is supplied by job status (including the mock runner), and `TOOL ... CMD` is the commanded endpoint inferred from the latest acknowledged file line while real firmware is streaming. Background M114 polling is disabled for active job states and active jog.
- 2026-06-29 position mapping detail: `currentLineNumber` is a cleaned non-empty command counter in firmware, so legacy preview segments now carry `lineNumber: parsedLines`; all approximated segments from one G2/G3 command share that command number. The mock runner mirrors this counter. `CMD` is the latest streamed command endpoint, not encoder feedback.
- 2026-06-30 canvas coordinates: the top-right Work Zero/TOOL text overlay is gone. Preview resolves the selected active work-zero history entry's `positionBefore` first, then legacy `workZero.beforeG92.position`, as the G54 table-space offset from homing `(0,0)`. Paths/bounds and work-coordinate tool feedback are translated by this offset. Work zero is a yellow cross labelled just below-right; the tool is a blue ring/dot; numeric XYZ remains in the shared Machine Bar. No firmware change.
- 2026-06-30 marker edge behavior: Work Zero text uses a screen-space offset and flips above the cross near the canvas bottom so the toolbar cannot cover it. The blue tool ring is drawn outside the Zero-layer condition and remains visible when zero markers are hidden.
- 2026-06-30 table grid: `drawMachineGrid()` renders behind all paths when the Table layer is enabled. `adaptiveGridStep(scale, 74)` keeps lines roughly screen-spaced using 1/2/5 decade values, visible-world clipping prevents excessive work at high zoom, and axis labels remain in screen space above the bottom toolbar.
- 2026-06-30 glass pass: the workbench top bar, drawers, canvas toolbar, canvas label, layer toggles, and drawer panels now use lighter transparent backgrounds so the machine table stays visible beneath the UI chrome. A small regression test keeps the shared glass CSS variables present.
- 2026-06-30 blur removal: the translucent workbench surfaces keep their alpha backgrounds, but the blur effect was removed from the top bar, drawers, canvas label, and canvas toolbar so the grid and toolpath remain crisp underneath.
- 2026-06-30 jog dock move: the Safe Jog joystick is no longer inside the main drawer. It now lives in a compact floating glass dock at the lower-right edge, with a settings gear that expands the jog options only when needed.
- 2026-06-30 jog dock trim: the dock was tightened further so it reads as a small control chip. Stop Jog is now an icon button in the dock header and the safety warning is tucked into the hidden settings area.
- 2026-06-30 dock collapse: the joystick now defaults to a narrow right-edge handle with only the edge strip visible. The dock body opens from that handle, stays transparent, and auto-hides when the main machine drawer opens so the canvas never gets crowded by overlapping panels.
- 2026-06-30 jog stop cleanup: the jog dock no longer carries a Stop button. The always-available Stop stays in the top machine drawer, while the dock focuses on the handle, settings gear, and safe jog controls.
- 2026-06-30 dock refit: the joystick now opens from a narrow right-edge handle. Only the handle stays visible when closed, the panel extends left when opened, and the settings sheet floats above the ring so Z buttons/settings do not shove the joystick position around.
- 2026-06-30 joystick polish: the handle icon is now a more symmetrical joystick glyph, the settings control uses a clearer chevron-up icon, and the dock geometry was nudged so the closed-state edge tab reads less skewed.
- 2026-06-30 handle fix: the dock had been translated too far off-screen, so the closed state now keeps the handle visibly clickable again instead of hiding it beyond the viewport edge.
- 2026-06-30 mobile jog-settings fix: a global `.cnc-icon` sizing rule made the settings arrow expand to roughly the whole dock. The arrow now has explicit 36 px bounds, the handle opens only the XY ring, and the arrow separately opens a compact settings sheet containing Safe/Restore, speed controls, and Z+/Z-. The ring remains fixed while settings open upward. SD UI files only; no firmware upload.
