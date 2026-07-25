# Handoff

## 2026-07-19 - Recovery workflow repair handoff

- Keep recovery evidence durable in this order: read checkpoint, update matching job history,
  save that job JSON, then acknowledge the firmware checkpoint. The narrow recovery-review lock
  exception exists solely to make that safe ordering possible; never unlock the motion files.
- Do not convert imported checkpoints to `PAUSED`. Preserve firmware `STOPPED`/`ERROR` so
  `planMotionOnlyRecovery()` can identify a recoverable terminal run.
- Recovery blocker repairs belong in `.recovery-fix-card`: Home All, then restore the interrupted
  work zero. Their results and failures must stay visible next to the blocker, not only in logs or
  separate preparation tabs.
- Production Resume is a top-level guarded recovery section. It must not be nested in the
  motion-only `<details>` element.
- Full automated verification passes 42 files / 350 tests. The ESP32-CAM build uses 19.6% RAM
  (64,348 bytes) and 72.0% flash (1,414,885 bytes).
- Firmware and all three changed recovery web assets are installed on SD drive `E:` with matching
  SHA-256 hashes. Final firmware hash is `E36A7F5718344453600470FDEF2E6BFBEB6C35E45AAF8E6D73CE681377646A93`;
  the pending production checkpoint was deliberately preserved for repaired import.

## 2026-07-18 - Aircut animation model handoff

- Aircut is physically generated from `aircutCommands`, including collapsed repeated step-down
  paths. Its UI animation must therefore use the segments parsed from those same commands, never
  command indices into the original production `parsed.segments`.
- `activeAnimationSegments()` now selects Production Resume recovery segments first, active
  Aircut/tool-less test-motion segments second, and production segments otherwise. Keep telemetry
  sequence numbers and the selected command model from the same stream.
- The live position fallback uses the same selector, preventing a stale production-depth marker
  when no interpolated telemetry frame is active.
- Full automated verification passes 42 files / 348 tests.
- The updated `preview.js` is installed on SD drive `E:` and its SHA-256 matches the repository
  source (`28D9CB4858A9C02BF90A76097317EEDDAE55449CA41D332CAB007343EBAD01E5`).

## 2026-07-18 - Actionable Cut blockers and planner wait handoff

- The observed Aircut failure was `COMMUNICATION_LOST` on `G2 X503 Y0 I-3 J0 F1500`. Its own
  estimate was only 188 ms, but it followed a 13,876 ms G1. The next ACK deadline now includes the
  previous acknowledged motion as planner wait; `M400` resets that carry.
- The observed production rejection was `requested file does not match job activeRun identity`.
  `/jobs/gcode_ex2.gc-15b19927.job.json` had no `activeRun.sizeBytes`, while the request and
  authorization correctly used 9529. `startJobRun()` now persists the measured size before upload
  and safely backfills the matching completed verification decision.
- Firmware no longer requires the legacy hidden `arm` object. Do not reintroduce it unless the UI
  also exposes it as a deliberate workflow step; the present visible flow ends with checklist and
  hold-to-start after Home, Zero, and Bounds/Aircut.
- Do not reduce the UI back to a status chip plus technical log. An ERROR or rejected Cut must show
  the exact reason, what the safety system did, and a visible route to the required corrective step.
- Full verification passes 42 files / 347 tests. Firmware uses 19.6% RAM (64,348 bytes) and 72.0%
  flash (1,414,613 bytes).

## 2026-07-18 - Recovery UX and test-motion checkpoint handoff

- `handleTestMotionStart()` no longer calls `beginPersistentJobCheckpoint()`. Production jobs and
  Production Resume still do; recovery safety and durability for real cutting are unchanged.
- Boot removes legacy checkpoints whose `startMode` is `validated_test_motion`. This is intentional:
  test motion is not resumed, while every reboot already invalidates the live machine frame.
- `workflowHardBlockers()` now includes pending firmware recovery. The readiness card offers review
  or deliberate discard and only then returns to Home → Zero → Bounds/Aircut → Cut.
- The readiness Home button is hidden while recovery is pending so the exception decision cannot be
  mistaken for a later workflow step; setup controls reappear after recovery is resolved.
- Keep recovery decisions explicit for production cuts; do not silently discard a production
  checkpoint or allow a test stream to create one.
- Full verification passes 42 files / 345 tests. The ESP32-CAM build uses 19.6% RAM (64,332 bytes)
  and 72.0% flash (1,414,921 bytes); mobile recovery rendering was checked at 412 x 915.

## 2026-07-18 - HTTP 423 lock classification handoff

- `installOperatorFetchMonitor()` now clones a 423 response and checks for the operator status
  fields before opening the PIN panel. A generic 423 is not sufficient because firmware also uses
  that status for active/interrupted job file locks.
- The observed false prompt came from a pending firmware recovery checkpoint whose generated
  aircut path was protected from overwrite. That safety lock is unchanged; the operator must import
  or deliberately dismiss the recovery record before starting new motion.
- Keep future 423 consumers aware of both meanings: operator ownership and protected SD mutation.
- `.machine-operator-strip` is now an absolute upper-left overlay. Its compact owner badge opens the
  same control panel without participating in the machine-bar grid or pushing other status content.
- Full automated verification passes 42 files / 343 tests, and the 412 x 915 browser check confirms
  the owner badge is a 17 px overlay at the top-left while the controller panel remains accessible.

## 2026-07-18 - Duration-aware ACK handoff

- `estimateAndApplyMotionTiming()` owns the lightweight firmware-side modal timing state. It is
  separate from execution/preview geometry and stores only the state needed to estimate the next
  command's length and effective feed.
- For a known motion, `hard timeout = clamp(estimated duration * 3 + 5 s, 10 s, 30 min)`. Unknown
  geometry and G53 use 180 seconds. M400, homing, probing, and tool-change special limits remain.
- The five-second timeout now means stale known liveness: it applies after at least one `busy:` was
  seen. A silent long motion waits until its calculated hard deadline, since silence alone does not
  prove Marlin failed while executing a blocking command.
- `/api/job/status.ackWatchdog` keeps the legacy `timeoutMs` alias and adds
  `inactivityTimeoutMs`, `hardTimeoutMs`, and `estimatedCommandDurationMs`. Long-motion timing and
  any communication-loss boundary are also written to `/logs/job.log`.
- Safety behavior is unchanged: no uncertain G-code replay, immediate M5 on communication loss,
  and no automatic M410.
- Full automated verification passes 42 files / 345 tests. The ESP32-CAM build uses 19.6% RAM
  (64,332 bytes) and 72.0% flash (1,414,921 bytes).

## 2026-07-18 - SD system diagnostics handoff

- The new diagnostic source is `/logs/system.log`; the previous 128 KiB generation is retained as
  `/logs/system.previous.log`. Each line starts with `millis bootSessionId` so separate starts can be
  distinguished without a real-time clock.
- A normal boot should progress through `SD mounted`, `BOOT firmware`, checkpoint load, SPIFFS,
  identity/operator settings, WiFi, mDNS, `HTTP server started`, telemetry, Bluetooth, and
  `BOOT complete`. The last line identifies the setup boundary where a failed boot stopped.
- Every HTTP route logs method, URI, and client IP. A missing `GET /api/health` after HTTP startup
  means the phone request did not reach the ESP. No Cookie, PIN, password, or request body is logged.
- SD logging cannot record an SD mount failure because the destination is unavailable. If no new
  boot-session line appears at all, check card seating, power, FAT32 integrity, and the SD hardware.
- Install the new firmware, reproduce once, then inspect the log using the steps in
  `docs/manual-tests.md`.
- Full automated verification passes 42 files / 342 tests. The ESP32-CAM build uses 19.6% RAM
  (64,252 bytes) and 71.6% flash (1,406,837 bytes).

## 2026-07-18 - Remembered controller handoff

- `cnc_operator` remains an HttpOnly, SameSite=Strict bearer cookie and now has a one-year Max-Age.
  The PIN and cookie token are still never exposed to JavaScript.
- Lease expiry now makes the controller idle and available for takeover without deleting its token.
  A matching remembered browser is reported as controller and its next guarded request renews the
  45-second lease. A different browser can claim during the idle window and replaces the token.
- Ordinary viewers no longer see the claim panel on load or heartbeat failure. The Machine Bar
  intercepts read-only machine controls, and a shared HTTP 423 monitor covers other mutating UI
  actions; either path opens the claim panel only after control is attempted.
- Deploy firmware with `www/machine-bar.js` and `www/style.css`. The development mock mirrors the
  new cookie and lease semantics; follow the remembered-controller checks in `docs/manual-tests.md`.
- Full automated verification passes 41 files / 339 tests; the ESP32-CAM firmware build uses 19.6%
  RAM (64,236 bytes) and 71.3% flash (1,401,721 bytes).

## 2026-07-16 - Configurable thumbnail projection handoff

- Settings -> Appearance owns `#thumbnail-view-mode`. The preference is browser-local under
  `lowrider.thumbnail.view-mode.v1`; missing or invalid values normalize to `2d`.
- `renderToolpathToCanvas()` accepts `options.viewMode`. Omitting it retains the previous 2D
  behavior; `3d` applies the same 35-degree yaw / 30-degree pitch orthographic projection used by
  the full workbench.
- `app.js`, `files.js`, and the missing-thumbnail path in `preview.js` load the preference at
  generation time. Stored `/jobs/thumbs/*.png` files are not bulk-regenerated on a setting change.
- This is web-only and does not alter G-code, preview size warnings, firmware RAM use, or the
  SD-streaming execution path.
- Full automated verification passes 41 files / 337 tests.

## 2026-07-16 - Active and interrupted job file locks

- `mutationPathTouchesLockedFile()` is the single firmware guard used by upload, delete, and rename.
  It checks active runner paths plus checkpoint paths and treats a parent directory mutation as
  touching every locked descendant.
- Locked paths are `jobStatus.gcodePath`, `jobStatus.jobPath`, and
  `jobStatus.authorizationActiveRunPath`; interrupted equivalents are loaded from
  `/logs/active-job.json` at boot. Production Resume therefore locks both its Phase 2 stream and the
  original active run used as provenance.
- Locks apply while the runner/checkpoint is active and while recovery review is pending. Clearing
  the checkpoint through the explicit acknowledgement endpoint releases interrupted locks.
- Mutation endpoints return HTTP 423 with a clear JSON error. Unrelated files intentionally remain
  editable; this is not a global SD read-only mode.
- `uploadTargetOpened` distinguishes a target actually created/opened by this upload from a rejected
  existing target. Keep this guard around empty/aborted cleanup to avoid deleting user files.
- There is no separate tool-plan file today; T/M6/tool comments are inside the locked and hashed
  G-code. If an external tool-plan artifact is added, include its path in both checkpoint identity and
  `mutationPathTouchesLockedFile()`.
- Validation passed: 38 test files / 325 tests, `git diff --check`, and the ESP32-CAM firmware build
  (RAM 19.6%, flash 70.6%).

## 2026-07-16 - Firmware-owned exact active-run identity

- `platformio.ini` now pins ArduinoJson 7.x. `loadJobExecutionAuthorization()` uses filtered
  deserialization from the SD `File`; do not replace it with whole-file `String` loading or token
  searches.
- Normal start requires matching `mode/path/size/fingerprint` across `activeRun`, `arm`,
  `verificationDecision`, `startAuthorization`, and the request. It also binds `activeWorkZeroId`,
  authorization work-zero ID, homing epoch, and homing session.
- `activeRunFileMatches()` reads the file in 512-byte chunks. It verifies SHA-256 via mbedTLS or the
  byte-based size/FNV-1a offline fallback, preserving streaming execution and bounded memory use.
- Browser `activeRun.sizeBytes`, arm, verification, and start authorization are now part of schema-v3
  data in practice. Older saved jobs naturally become stale and must be reopened, reverified, and
  re-armed; there is no permissive legacy fallback.
- Production Resume authorization now includes `streamPath`, `streamSizeBytes`, and
  `streamFingerprint`. The generated file is uploaded before the authorization-bearing job JSON is
  saved, and firmware parses the matching recovery event before hashing the actual stream.
- The strict file fingerprint covers tool commands/tool comments as part of the exact file. A future
  separately editable tool-plan artifact must receive its own locked path and fingerprint.
- Next step is active-file mutation locking in upload/delete/rename handlers; identity checking
  already prevents changed content from starting but does not yet reject all mutation attempts while
  a stream is active.
- Validation passed: 37 test files / 321 tests, JS syntax checks, `git diff --check`, and the
  ESP32-CAM firmware build (RAM 19.6%, flash 70.5%).

## 2026-07-16 - Persistent interrupted-job checkpoint and browser-independent recovery

- Firmware writes `/logs/active-job.json` through `/logs/active-job.tmp` and separately stores the
  `recovery/activeJob` NVS marker. `beginPersistentJobCheckpoint()` is called before any of the three
  streaming start paths can issue movement.
- `processPersistentJobCheckpoint()` persists acknowledged progress every 2 s / 4096 bytes and on
  state changes. `COMPLETED` clears evidence; `STOPPED` and `ERROR` finalize it as interrupted.
- On boot, an active NVS marker or active checkpoint triggers immediate raw `M5`, clears the machine
  frame and position validity, and sets the review gate. There is intentionally no automatic file
  open, seek, homing, or resume.
- `GET /api/recovery/checkpoint` exposes the full evidence. `POST
  /api/recovery/checkpoint/acknowledge` requires `{ "confirmed": true }`, an idle runner, and is the
  only path that clears interrupted evidence.
- All new stream starts reject while `recoveryCheckpointRequiresReview` is true. Homing and setup
  controls remain usable so the operator can re-establish a trustworthy frame.
- Preview matches checkpoint ownership by non-empty `jobPath`, maps firmware state to an interrupted
  run-history entry, persists the job JSON, and only then acknowledges firmware. Its explicit dismiss
  path is destructive and keeps position untrusted. Empty-job test-motion records cannot auto-import.
- The next planned hardening step is exact active-run identity binding (path plus fingerprint and
  stream mode) throughout start/recovery validation; do not turn the current checkpoint into an
  automatic resume mechanism.
- Validation passed: 36 test files / 317 tests, JS syntax checks, `git diff --check`, and the
  ESP32-CAM firmware build (RAM 19.6%, flash 69.3%).

## 2026-07-16 - Job runner ACK watchdog and communication-loss fail-safe

- `marlinAckTimeoutForCommand()` assigns the normal 5-second ACK window or the longer 180-second
  `M400`, homing/probe, and tool-change window. `marlinAckWatchdogExpired()` also enforces a hard
  deadline at twice that value even while Marlin keeps sending `busy:`.
- Both streamed commands and priority sequences route timeout failures through
  `setJobCommunicationLost()`. It snapshots the failed command, last acknowledged byte/line and last
  trusted positions, sends raw `M5` without waiting for the failed transport, then enters `ERROR` with
  `COMMUNICATION_LOST`.
- Do not automatically add `M410` to this path without an explicit setting and operator decision: it
  changes the failure from graceful spindle shutdown to an abrupt planner stop and invalidates position.
- `currentByteOffset` remains the reader/sent boundary; `lastAcknowledgedByteOffset` is the safe
  confirmed boundary and now drives progress. M6 advances it only after guarded tool confirmation.
- `Resend:` remains intentionally unsupported until numbered/checksummed streaming plus a bounded
  replay buffer is implemented; it now fails with `RESEND_UNSUPPORTED` and immediate `M5`.
- Validation passed: 34 test files / 309 tests, JS syntax checks, `git diff --check`, and the
  ESP32-CAM firmware build (RAM 19.5%, flash 68.8%).

## 2026-07-14 - Firmware-owned manual M6 tool changes

- `src/main.cpp` now owns the `Tn`/`M6` stream boundary. The minimum behavior is always a firmware
  pause with an operator-visible pending tool change; `M6` is not sent to Marlin.
- The M6 stop order is deliberately `M400` then `M5`. Configured parking is allowed only with a
  trusted absolute machine frame and uses `G53`; otherwise firmware falls back to pausing in place.
- Park mode captures the pre-park work XYZ and uses a guarded return sequence after the new Z zero
  and explicit `POST /api/job/tool-change/complete { confirmed: true }`.
- `POST /api/work-zero/set-z` supports the controlled pending-M6 window. The new shared
  `POST /api/work-zero/touch-plate` runs `G38.2`, applies plate thickness with `G92`, retracts, and
  updates the firmware frame only after success.
- Preview maps pending firmware status to `ToolpathModel.toolChanges` so it can show T number,
  comment/name, diameter, and requested RPM when those values exist in the G-code.
- `applyActiveRunParse()` rerenders the run panel after parsing; keep this call because M6 status can
  arrive before the source model and would otherwise leave the tool detail card on its fallback text.
- Machine Bar deliberately disables its pause/resume button and labels it `Tool Change` while
  `toolChangePending` is true; only the dedicated confirmed endpoint may resume that state.
- `test/ui/machine-controls.test.mjs` asserts this guarded label and disabled state; do not reduce it
  back to the old unconditional Pause/Resume string check.
- Touch-plate controls remain hidden unless enabled in device settings. When enabled they appear in
  the M6 panel, Preview Zero / Origin actions, and Machine Bar Zero actions.
- Full validation passed: 34 test files / 306 tests, JS syntax checks, `git diff --check`, and an
  ESP32-CAM PlatformIO build. Browser QA also completed a parked T2 change with touch-plate probing,
  guarded confirmation, captured-position return, and resumed streaming; the browser console was
  clean and the mock Marlin log contained `G38.2` but no forwarded `T2` or `M6`.

## 2026-07-14 - Tool-change and touch-plate device settings

- Settings now contains a `Tool Change` panel backed by device NVS through
  `/api/tool-change/settings`.
- Defaults remain `pause` + `manual`; optional machine-coordinate parking and touch-plate probing
  must be explicitly configured by the operator.
- Touch-plate settings are intentionally shared device configuration so the same probe operation can
  later be offered both during `M6` and beside the normal Set Z Zero controls.
- This step establishes only the persisted configuration contract. Firmware stream interception,
  tool metadata, the operator change dialog, probing, and confirmed continuation are the next step.
- Focused validation passed: `npm.cmd test -- --run test/ui/tool-change-settings.test.mjs test/mock/mock-server.test.mjs`.

## 2026-07-10 - Files card view and hold actions

- The Files page no longer shows the redundant `Select`, `Open Job`, and `Full Preview` controls.
  Previewable G-code cards now open Preview directly on normal tap/click.
- Maintenance actions were moved behind card hold/right-click. File cards expose Download, Rename,
  and Delete; folder cards expose Rename and Delete.
- The folder contents surface is now a thumbnail-first card grid so saved PNG previews are larger
  and easier to scan on touch devices.
- Focused regression coverage lives in `test/ui/files-view.test.mjs`.
- Validation passed: `npm test -- test/ui/files-view.test.mjs`.

## 2026-07-10 - Setup AP retained during station mode

- Firmware WiFi startup no longer drops the setup AP after a saved STA join succeeds.
- The ESP32 now keeps `G-code-CNC-Setup` active in `ap+sta` mode, so a phone can still connect
  directly even when the controller is also on the saved infrastructure network.
- If the saved STA join times out, the firmware stays in plain setup AP mode as before.
- `/wifi` now shows the setup AP SSID/IP alongside the STA status when both are active.
- Validation passed: `C:\Users\marko\.platformio\penv\Scripts\platformio.exe run --environment esp32cam`.

## 2026-07-10 - Pause/resume drain timeout fix

- Live SD `E:\logs\job.log` showed the failing pattern for resume-after-pause: `pause requested`
  without a later `paused:` marker, plus at least one `priority timeout` during pause handling.
- Firmware now gives the pause-drain priority `M400` up to 30 s while the runner is in `PAUSING`.
  This keeps long in-flight moves from tripping the generic 5 s priority timeout before the stream
  can enter `PAUSED`.
- The normal 5 s Marlin acknowledgement timeout still applies to regular streamed commands and other
  priority operations.
- Focused regression coverage was added in `test/firmware/marlin-transport.test.mjs`.
- Validation passed: `npm test -- test/firmware/marlin-transport.test.mjs` and
  `C:\Users\marko\.platformio\penv\Scripts\pio.exe run`.

## 2026-07-10 - Preview preflight listener null-guard

- `www/preview.js` no longer hard-crashes on startup if the Preflight action buttons are missing.
- The `save-job-preflight` and `refresh-preflight` listener hookups now use optional chaining,
  matching the rest of the preview page's tolerant event binding pattern.
- Focused validation passed: `npm test -- test/ui/machine-controls.test.mjs`.

## 2026-07-08 - Preview file-open regression fixed

- Preview file opening from the Files dashboard regressed because `www/preview.js` still assumed the
  Dry Run `stop-m5` button existed during startup.
- Current `www/preview.html` again includes the secondary `Stop spindle/laser M5` button in the Dry
  Run operator panel.
- Current `www/preview.js` uses `stopM5Button?.addEventListener(...)` so the page does not hard-crash
  if markup and script drift again.
- Reproduced and verified in the live mock browser: opening `ex1.gc` now lands on the preview page
  and renders job content normally.
- Focused regression coverage remains in `test/ui/machine-controls.test.mjs`, and that file passed.

## 2026-07-08 - Route-first app startup and lazy Files loading

- Main dashboard startup in `www/app.js` is now route-first. It resolves the initial hash route before
  loading route data.
- Startup no longer unconditionally calls current-job metadata load or `/gcode` file-list load.
- Files data is now fetched only through `ensureFilesViewData()`, which is activated by the Files
  route and explicit file operations.
- Job metadata is now fetched only through `ensureJobViewData()`, which is activated by the Job route.
- Logs are fetched lazily on first Logs activation instead of at startup.
- Settings still lazy-loads only its own machine/device settings path and no longer causes a brief
  Files-first render or file-list traffic on direct entry.
- Follow-up completion: `www/telemetry.js` no longer auto-requests `job` and `health` at startup.
  Those channels are now demand-driven.
- `www/app.js` requests `health` only on Settings and `job` only on the Job route.
- `www/machine-bar.js` requests `health` / `job` only while the machine drawer is open, so the
  compact shell no longer forces those requests on every route.
- `www/preview.js` explicitly opts in to `health` / `job` telemetry because Preview really does need
  live run and recovery state.
- Broader entrypoint audit verified that `www/files.js` is intentionally route-specific and does not
  add unrelated telemetry demand, while `www/skin-init.js` performs no ESP32 fetches.
- `www/telemetry.js` now opens the telemetry WebSocket only when a socket-capable channel is actually
  demanded. Pages with no `job` / `jog` / `log` demand no longer open an idle socket.
- Added navigation tests that assert startup now uses `resolveInitialView()`, then mounts that route,
  then loads only that route's data.
- Added telemetry tests that assert `health` / `job` are demand-driven and not auto-requested on
  telemetry start, and that socket startup is also demand-gated.
- Verification passed: `npm test -- test/ui/navigation.test.mjs test/ui/telemetry.test.mjs test/ui/device-settings.test.mjs`
  plus targeted telemetry/navigation reruns, and full `npm test`.

## 2026-07-08 - Minimal Dry Run operator control

- Dry Run on the Preview page is now reduced to the operator essentials: box size, Safe Z, margin,
  Aircut toggle, one primary send button, and secondary `M5`.
- Visible Generate/Copy buttons, raw G-code preview, command counts, run-file/run-mode text, and
  detailed bounds were removed from the normal Dry Run surface.
- The primary button is now mode-driven: `Send Box Trace` when Aircut is off, `Send Aircut Toolpath`
  when Aircut is on.
- Bounding-box commands still regenerate automatically on active-run/placement/Safe-Z/margin
  changes. Aircut commands regenerate automatically when Aircut mode is selected.
- The UI now shows a short reason when the selected dry-run mode cannot be generated or sent.
- Aircut help text and confirmation now state that spindle/laser start commands are suppressed.
- Focused validation passed: `npm test -- test/ui/machine-controls.test.mjs`.

## 2026-07-05 - Coordinate frame refactor in progress

- Firmware is now the intended owner of homing and work-zero frame transitions.
- New frame schema separates `machine`, `work`, and `workZeroMachine`; `homingEpoch` identifies the current trusted Home All session.
- Normal `/api/job/start` accepts only `use_active_work_zero` and never reapplies `G92`.
- Do not flash this intermediate state yet: Machine Bar, Preview, DEV MOCK, tests, and docs still need the matching contract.
- Machine Bar and Preview are now wired to the new contract, but DEV MOCK/test updates and firmware compilation are still pending.

## 2026-07-05 - Coordinate frame refactor ready for no-cutter device test

- Firmware: `.pio-build/esp32cam/firmware.bin` (`0.5.6-coordinate-frame`).
- SD UI upload: `/www/preview.html`, `/www/preview.js`, `/www/machine-bar.js`, and
  `/www/lib/workbench-ui.js`.
- Also upload matching documentation only to the repository; docs are not device UI assets.
- First device test: router off/no cutter, Home All, jog near machine X100/Y500 with Z clearance,
  Set Work Zero, reload Preview, run Bounding Box, Arm, then Start.
- Confirm M and W coordinates differ correctly, geometry/WORK ZERO appear at machine X100/Y500,
  and Marlin log contains no G92 after Start is requested.
- Old job JSON without machine-space zero + homing epoch will intentionally fail Preflight/Start;
  Home All and Set Work Zero once to migrate it safely.

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
`G-code-CNC-Setup` with password `12345678`. The UI now links to `/wifi`, and `/api/health`
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
work zero and G-code CNC bounds before enabling send, send commands one at a time through `/api/cmd`,
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
- Use setup AP SSID `G-code-CNC-Setup` when no saved WiFi can connect.
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

- If the selected placement bounds exceed the configured G-code CNC work area, the UI still reports a
  work-area problem.
- If the selected placement fits but the full generated file includes travel or lead-in moves
  outside that placement, the UI now shows a clearance warning instead of saying the generated
  bounds exceed the G-code CNC work area.
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
- 2026-06-30 jog pointer/live-position fix: `stopJog()` now centers the knob synchronously before checking whether an HTTP stop is needed. Window-level pointerup/pointercancel and pad lostpointercapture handlers cover releases outside the ring; a jog session id prevents late start/update responses from reviving stopped UI state. Each accepted 150 ms update mirrors firmware XY/Z step math into `STATE.position` and publishes `cnc-position-update` with source `JOG_CMD`, so both Machine Bar and canvas move immediately. Periodic M114 remains authoritative for external/Marlin-side movement, with an initial M114 requested after job state loads. No firmware change.
- 2026-06-30 Z-hold/handle polish: Z+/Z- suppress Android long-press selection, copy/share context menus, and drag behavior while retaining pointer hold jogging. The right-edge joystick handle now uses the same 28 px translucent accent-tab geometry as the Tools/Status handles, with a joystick glyph and vertical Jog label. Upload `www/machine-bar.js` and `www/style.css`; no firmware flash.
- 2026-06-30 Safe Z ceiling fix: this step does require firmware `0.4.9-safe-z-clamp`. Safe Jog no longer interprets `Z70` through the active G54/G92 work offset. Requests are silently clamped to the configured machine maximum and firmware sends internal `G53 G0 Z70`, then captures the resulting work-coordinate Z for the delayed restore guard. Generated/user G-code `G53` remains blocked; only the firmware-owned Safe Jog pre-lift is allowed. Update `www/machine-bar.js` too so its input and commanded-position feedback use the same 70 mm ceiling.
- Safe Z verification status: 126 automated tests pass, including machine-coordinate movement after G92. PlatformIO compilation still needs one local run before flashing because this session could not write PlatformIO's user-level lock/cache and the elevated retry was unavailable due tool usage limits.
- 2026-06-30 table/work-coordinate visualization: `www/preview.js` still draws physical grid lines at machine/homing coordinates and translates job geometry by the captured pre-G92 Work Zero position. Grid/ruler labels now display work coordinates by subtracting that offset, so a physical table edge at machine zero appears as X-100/Y-500 for Work Zero X100/Y500. Update `www/preview.js` and `www/lib/workbench-ui.js`; this canvas step needs no firmware change.
- Coordinate-layer tests pass with the full 127-test suite; preview syntax and diff checks also pass.
- 2026-06-30 files-first fallback: `www/preview.js` redirects missing/unopenable jobs to `/#files` and clears only a matching stale current-job pointer. `www/app.js` validates the current G-code listing during startup, routes `/#job` to Files when no valid job exists, and no longer renders a "No Current Job" card. UI-only; update both JS files on SD.
- Files-first fallback was also exercised in the local browser: missing preview path and a nonexistent G-code path both resolve to `http://localhost:8097/#files`. The full suite passes with 129 tests.
- Communication integration step 1 is in progress. Firmware `0.5.0-telemetry-transport` ends synchronous Marlin reads immediately on terminal response lines and prevents `/api/cmd` diagnostics from stealing active job/jog UART responses. M5 remains priority. Run the automated suite and PlatformIO build before flashing; WebSocket/delta telemetry is not implemented yet.
- Browser polling consolidation is implemented in `www/telemetry.js`; upload it before the updated HTML/JS files. Machine Bar, dashboard, and Preview now share job/health telemetry, logs/jog are demand-driven, and there is no automatic M114. WebSocket delta telemetry remains the next integration step.
- WebSocket job/jog delta telemetry is now implemented on port 81 with revision ordering and 10 Hz throttling. Commands remain HTTP. Browser reconnect/fallback is in `www/telemetry.js`. PlatformIO now depends on `links2004/WebSockets@^2.6.1`; rebuild firmware before hardware testing. Cursor-based log deltas are still pending.
- The initial WebSockets compile required named mutable String payloads for the library API; that compile fix is applied. A clean successful rebuild is still required before flashing.
- Cursor log delivery is implemented: HTTP supports `after`, socket log delivery is opt-in, and the UI keeps an 80-entry deduplicated local tail. Rebuild and tests are required after this log step.
- Position is now a changed-only WebSocket channel sourced from actual M114 responses. Browser periodic M114 remains removed; homing deliberately refreshes once after G28. Final tests/build and hardware latency checks remain.
- Communication integration is build/test complete: 140 tests pass and firmware uses 15.5% RAM / 50.8% flash. Upload firmware `0.5.0-telemetry-transport`, then upload `/www/telemetry.js`, updated HTML files, `app.js`, `machine-bar.js`, and `preview.js`. Before cutting, perform router-off checks for terminal latency, joystick deadman/release, homing plus one M114 refresh, Pause/Stop/M5 priority, socket reconnect, and log-view subscription.
- Pinch-release jump fix is UI-only in `www/lib/workbench-controller.js`: the remaining finger starts a fresh pan baseline at the current transformed view, and a completed pinch cannot trigger double-tap Fit. Upload this module to SD `/www/lib`.
- Pinch fix verification: 141 tests pass and the controller syntax/diff checks are clean. No firmware flash is required.
- Motion-only recovery step 1 is implemented in `www/lib/job-recovery.js`. It is pure UI logic and does not resume streaming or cutting. Toolpath segments now expose `commandNumber` matching firmware run counters. Recovery commands always start M5, lift to Safe Z before XY, stop at the candidate, and forbid G28/G53/G92/M3/M4. UI/history integration remains pending.
- The initial limits test used `xMax: 5` while the selected safe candidate was X0 and therefore still legal. The test now uses `xMin: 1` to exercise the intended rejection.
- `www/lib/job-history.js` now owns additive `recoveryHistory` events. `motion-only-recovery-move` records the test but deliberately leaves the related run interrupted/stopped/error; it never marks cutting resumed or completed.
- Preview now has a right-drawer Recovery tab and graphical overlay. Motion stays disabled until session position trust, idle machine state, activeRun/fingerprint/zero identity, Safe Z, and XYZ limits pass. The only sequence is M5/G21/G90/G54/lift Z/move XY/M400. `src/main.cpp` is unchanged for this feature.
- Local DEV MOCK browser verification passed with an interrupted `safe-square.gc` fixture. Recovery correctly selected the previous X10/Y10/Z15 clearance point, required explicit position trust, sent the seven-command motion-only sequence one command at a time, saved a `completed` recovery event, and produced no console errors. Real-machine validation must still be router-off, tool-clear, and start with a physical emergency stop in reach.
- 2026-07-01 contract audit: recovery now refuses an older interruption when a newer run exists and blocks generated active runs unless `generatedValidation` is valid. The candidate may originate from a positive-Z retract point, but all movement first lifts to configured Safe Z and stays there. History result is now `completed` (legacy `complete` input is normalized), with `activeRunMode` and `reason`. No firmware change.
- Final verification: 19 Vitest files / 160 tests pass, all requested JavaScript syntax checks pass, patch whitespace is clean, and firmware remains unchanged. Upload the changed Preview UI/modules to SD `/www`; do not flash firmware for Recovery V0.
- Merge-readiness cleanup blocks recovery when interrupted activeRun path is absent or mode differs, records explicit user-triggered `blocked` attempts in `recoveryHistory`, and labels the non-destructive close action `Hide Recovery`. Re-run the full suite before merge; original interrupted run state remains untouched.
- Merge-readiness suite is green: 19 files / 160 tests plus all requested syntax checks and patch whitespace validation. Firmware is unchanged, so no PlatformIO build or firmware flash is required for this branch.
- 2026-07-02 travel-speed step 1: `www/lib/motion-settings.js` stores a shared 50 mm/s default used by Settings and joystick XY max. Settings can send M503 while idle, parse M203, display X/Y/Z limits, and narrow the UI maximum to the smaller X/Y value without exceeding 100 mm/s. Automatic command generation and firmware use are the next steps.
- Travel-speed step 2: Preview-generated bounding box, aircut rapid, and recovery XY moves now carry the shared travel feed; all their Safe-Z moves explicitly return to F400. Aircut G1 keeps the G-code feed. Machine Bar includes `travelFeedMmMin` in work-zero requests. Firmware must now validate/use that field and reset modal G0 feed after job-start Z lift.
- Travel-speed step 3 requires firmware/WebOTA `0.5.1-travel-speed`. `/api/job/start` and `/api/work-zero/goto` clamp `travelFeedMmMin` to 600–6000 mm/min. The start preamble sends Safe Z at F400, M400, then `G0 F<travelFeed>` before streaming. Build/tests remain pending.
- Focused travel tests pass. DEV MOCK M503 reports M203 X100/Y100/Z5 by default and accepts custom maxima in tests. Full suite and PlatformIO build remain before upload.
- Final travel-speed verification is green: 20 Vitest files / 166 tests, syntax/diff checks, and PlatformIO build. Firmware `0.5.1-travel-speed` uses 15.5% RAM and 50.8% flash. Flash/WebOTA firmware, then upload the changed SD UI including new `/www/lib/motion-settings.js`.
- Toolless Resume planner step: `buildToollessResumePlan()` and `buildToollessResumeCommands()` generate only M5/G21/G90/G54 plus controlled G0/G1/M400. They include original remaining Z values, block missing feeds/limits and unsafe G28/G53/G92 source state, omit M3/M4, and never touch activeRun files. History helpers append/update a separate non-production event; UI/execution/tests remain pending.
- Toolless UI/execution is implemented entirely in SD UI. It requires explicit no-cutter confirmation, streams the controlled list one command at a time, and records started/completed/stopped/error. All unsupported ToolpathModel commands and command lists over 20,000 are blocked. Machine Bar critical controls cancel the loop; Pause/Stop invoke existing jog-stop M410+M5 and invalidate trust. Tests/docs/final verification remain.
- Dedicated Toolless Resume tests cover real Z, limits, identity/trust/generated blockers, arcs, forbidden commands, history invariants, UI wording, and critical-control cancellation. Focused suite passes; full suite and final syntax/diff checks remain.
- Toolless Resume verification is complete: 21 Vitest files / 174 tests, required syntax checks, diff check, and DEV MOCK UI inspection all pass. Browser showed correct Z descent/min-Z/command summary and no console errors; the start button gates on explicit no-cutter confirmation. This feature adds no firmware changes beyond the already-built travel-speed firmware in the same working tree.
- Production Resume planner/history foundation is added. It reuses controlled ToolpathModel commands, splits reposition and cutting motion into two phases, and treats intentional Z-zero replacement as acknowledgement-gated rather than a hard block. Work-zero/activeRun/generated/trust/limits remain hard blockers. UI/execution/tests are pending; no new firmware behavior was added.
- Guarded Production Resume UI/execution is now wired as a separate third recovery tier. Phase 1 performs only M5/modal setup/Safe-Z/XY reposition; Phase 2 requires the manual-router checkpoint and a 1.5-second hold. Motion-only and Toolless tests now scope their wording assertions to their own controls.
- The Motion-only button now uses the required `Move Axes to Resume Point` wording. It remains Safe-Z reposition only and cannot descend into the remaining cutting path.
- Recovery, safety-testing, mobile-flow, and job-metadata docs now describe guarded Production Resume. Work-zero mismatch blocks; intentional Z-zero replacement is allowed only after two explicit acknowledgements. No M3/M4/G28/G53/G92, auto-home, auto-zero, or source fallback is introduced.
- Guarded Production Resume verification is complete: 22 Vitest files / 182 tests, all requested syntax checks, `git diff --check`, and DEV MOCK UI inspection pass. Three tiers and checklist/hold gates render correctly with no console errors. No Production Resume movement was executed and this feature adds no firmware changes.
- README/current-task terminology now reflects the implemented guarded foundation while retaining durable firmware-owned and power-loss resume as future work.
- Floating joystick status is now a fixed one-line row with ellipsis and full-text tooltip. This prevents changing jog status content from moving the joystick vertically. UI-only; upload `www/style.css` and `www/machine-bar.js`.
- Aircut/Toolless stutter root cause is confirmed: browser stop-and-wait `/api/cmd` per flattened arc chord. Implementation direction is a firmware-owned, allowlist-validated temporary motion-file stream under `/jobs/generated`, retaining existing job priority controls and native G2/G3 commands.
- Firmware `0.5.2-motion-stream` now has the validated `/api/test-motion/start` stream entry point. It reuses the existing SD/UART job runner and priority controls, but skips normal job start/G92 preamble. Files are allowlist-checked before and during streaming; Aircut Z must remain exactly at Safe Z.
- Toolless/Aircut generators now emit native G2/G3 I/J arcs through the shared ToolpathModel. This substantially reduces command counts and preserves Marlin's continuous arc planner behavior.
- Preview UI now uses one upload + one start request for Aircut/Toolless, then observes existing job telemetry. Temporary files are `/jobs/generated/<active-name>.aircut.gc` or `.toolless.gc`. Per-command browser HTTP loops are removed.
- DEV MOCK implements the same `/api/test-motion/start` contract and rejects forbidden commands or Aircut Z values that differ from Safe Z.
- Tests now cover native G2/G3 preservation and both firmware/mock rejection paths for forbidden commands and Aircut Z descent.
- Firmware `0.5.2-motion-stream` builds successfully at 15.5% RAM and 51.1% flash. This change requires one WebOTA/wired firmware update before the new SD UI can start test-motion streams.
- Test-motion validation rejects malformed numeric words as well as forbidden command letters. UI requests one immediate status snapshot after start, then uses normal delta/fallback telemetry.
- README, architecture, protocol, and safety-testing docs now cover the new firmware-owned test-motion transport. Flash firmware `0.5.2-motion-stream`, then upload the matching SD UI before testing.
- The two full-suite failures were stale source-text assertions from the previous travel-speed implementation; expectations now cover the native-arc path and current firmware version.
- Mock HTTP integration now exercises the same upload/start/status sequence used by the browser and confirms native G2 reaches the mock Marlin runner.
- Final test-motion verification: 22 files / 186 tests pass, syntax and diff checks pass, and `0.5.2-motion-stream` builds at 15.5% RAM / 51.1% flash. Hardware testing remains: flash firmware, upload matching UI, test Aircut with router off, then Toolless with no cutter.
- Saved work-zero restoration foundation now derives machine coordinates from M114 counts and M503/M92 steps-per-mm, stores the reference in zero history, and records restore attempts without replacing the interrupted run's zero ID.
- Firmware `0.5.3-zero-restore` adds idle-only `/api/work-zero/restore`: Safe machine-Z first, machine-coordinate XY, then G92 X0 Y0. Z zero is intentionally untouched. This explicit endpoint is the only restore path allowed to use G53; recovery/generated streams still forbid it.
- Recovery UI now has a visible Saved Work Zero block; users do not need to search Zero History to find the restore action.
- Restore UI supports old jobs with saved counts and new jobs with machineReference. It uses one confirmation after deriving the exact target, then automatically marks the interrupted run's zero active and refreshes Recovery. M92 mismatch or untrusted/unhomed position blocks before motion.
- Saved XY restore requires `fullHoming`, not merely a single-axis home. Home All emits this trust automatically; the existing explicit operator trust button now means all axes were homed in this powered session.
- DEV MOCK now provides M92/count-based machine references and the guarded restore endpoint, so the complete workflow can be tested without hardware.
- Restore regression tests cover calculation, identity/audit, command ordering, forbidden auto-home/Z-zero behavior, and mock physical position outcome.
- Zero History exposes saved machine XY and restore count for user-visible auditability.
- Protocol/recovery/metadata/safety docs now describe saved XY restoration and why G53 is permitted only inside the bounded firmware endpoint.
## 2026-07-03 - Saved work-zero restore verification

- Two stale tests were aligned with the new restore contract: full-machine homing is required for automatic XY restoration, and Go To Work Zero assertions inspect only that endpoint.
- Next: run the complete UI/mock test suite, syntax checks, diff checks, and a PlatformIO firmware build.
## 2026-07-03 - Saved work-zero restore ready for device testing

- Firmware `0.5.3-zero-restore` builds successfully and exposes guarded `POST /api/work-zero/restore`.
- The Recovery panel restores the interrupted run's exact saved XY zero after full homing, using recorded M114 counts and current M503/M92 calibration.
- Restore moves at machine safe Z, does not restore Z automatically, and reuses the same zero-history identity with an audit entry.
- Verification: 22 test files / 190 tests pass; PlatformIO build uses 15.5% RAM and 51.3% flash.
- Device test: remove cutter or keep spindle/router off, Home All, restore saved XY, verify physical position, then set/review Z separately.
## 2026-07-03 - Production Resume firmware stream foundation

- New endpoint: `POST /api/recovery/production/start`.
- It starts only a validated `/jobs/generated/*.production-resume.gc` file whose provenance matches the prepared Production Resume event in the job JSON.
- Phase 2 will continue in firmware if the browser disconnects; UI wiring, tests, documentation, and device build remain to be completed.
## 2026-07-03 - Production Resume Phase 2 UI ownership transfer

- Holding `Resume Cutting` now saves the manual-router checkpoint, uploads `/jobs/generated/*.production-resume.gc`, and calls `/api/recovery/production/start` once.
- The ESP32 owns all subsequent command pacing; browser loss no longer stops Phase 2.
- UI and DEV MOCK are wired. Focused tests, full regression tests, documentation, and firmware build remain.
## 2026-07-03 - Production Resume documentation complete

- README, protocol, recovery, job metadata, mobile flow, safety test procedure, and current task now describe firmware-owned Phase 2 accurately.
- Remaining hardening is power-loss recovery, durable on-device recovery history, modal reconstruction, and lead-in strategy.
## 2026-07-03 - Production Resume test cleanup

- The only full-suite failure was an expected firmware version string from the previous zero-restore release; it is now aligned with `0.5.4-production-resume-stream`.
- Full suite and PlatformIO build still need their final rerun.
## 2026-07-03 - Production Resume authorization hardening

- Firmware start now requires a one-shot whole-file authorization proof matching event ID, interrupted run ID, activeRun path/mode/fingerprint, and generated stream path.
- This keeps long-lived job JSON files usable after their history grows beyond 16 KiB.
## 2026-07-03 - Production Resume Phase 2 ready for no-cutter device test

- Firmware binary: `.pio-build/esp32cam/firmware.bin` (`0.5.4-production-resume-stream`).
- Verification: 22 files / 192 tests; PlatformIO 15.5% RAM, 51.7% flash.
- First hardware trial must use no cutter/router output: prepare Phase 1, confirm router checkpoint without starting a tool, hold Phase 2, then deliberately disconnect WiFi and confirm firmware continues while reconnect restores status.
- Real cutting remains operator-supervised; power-loss recovery and durable firmware-side history are still future work.
## 2026-07-04 - Streaming/preview separation rule added

- Normal job execution remains firmware-owned and line-streamed from SD.
- Preview warns at 4 MiB and transform warns at 2 MiB; both are soft browser warnings and do not block original-file execution.
- Next: add audit tests/documentation and run the full suite.
## 2026-07-04 - Streaming/preview audit ready for verification

- Firmware normal job execution complies: SD `File`, one line up to 180 characters, one Marlin command in flight.
- Preview/transform warnings are browser-only soft thresholds and preserve `activeRun.path` and normal execution eligibility.
- Added focused source-contract tests; full test suite and syntax checks remain to run.
## 2026-07-04 - Streaming/preview policy verification complete

- Verification: 23 files / 195 tests.
- Normal execution: compliant, one bounded 180-character line in ESP32 RAM and one Marlin command in flight.
- Preview/transform: browser still loads the file for visualization by design; 2 MiB transform and 4 MiB preview warnings are explicit and non-blocking.
- SD UI upload for this step: `/www/preview.html` and `/www/preview.js`. No firmware upload is required solely for these rules.
## 2026-07-04 - Workbench visual cleanup

- Preview topbar no longer duplicates the left Tools handle.
- Normal blue actions now share one translucent treatment across global, preview-tab, readiness-tab, and primary-action styles.
- UI-only change; no firmware upload is required.
## 2026-07-04 - Workbench visual regression guard

- The test suite now prevents the removed topbar Tools duplicate and opaque blue button styling from returning unnoticed.
- Full regression suite remains to run.
## 2026-07-04 - Workbench visual cleanup ready for SD upload

- Upload `/www/preview.html`, `/www/preview.css`, and `/www/style.css`.
- Expected result: only the left edge Tools handle remains, and ordinary blue buttons consistently reveal the work-area graphics beneath them.
- Verification: 23 files / 196 tests. No firmware upload required.
## 2026-07-04 - Machine profile firmware foundation

- Firmware now discovers M115 once after boot without blocking the HTTP loop, preserves cached info across boots, and exposes machine profile APIs.
- Editable machine groups are restricted to M92/M203/M201/M204; persistence is a separate explicit M500 endpoint.
- UI, mock support, tests, docs, and build remain.
## 2026-07-04 - Machine Configuration UI wired

- Settings now separates cached hardware discovery, live editable RAM values, and explicit EEPROM persistence.
- New SD UI dependency: `/www/lib/machine-config.js`.
- DEV MOCK, tests, documentation, and firmware build remain.
## 2026-07-04 - Machine profile compile cleanup

- Early PlatformIO build found declaration-order issues and misplaced M5 discovery handling; both are corrected.
- Rebuild is required after mock/test integration.
## 2026-07-04 - Machine Configuration mock ready

- Hardware Info, editable RAM settings, software endstops, and M500 can now be tested at the local DEV MOCK address without hardware.
- Tests and docs remain.
## 2026-07-04 - Machine area is now active configuration

- A valid cached M115 `area.full` drives Preview and guarded firmware restore/resume bounds.
- If discovery is missing or invalid, defaults remain X 0..1625, Y 0..5800, with the existing Z fallback.
## 2026-07-04 - Machine Configuration tests added

- New test file: `test/ui/machine-config.test.mjs`.
- Mock tests now exercise the complete Settings API flow. Focused/full test runs and documentation remain.
## 2026-07-04 - Machine Configuration documentation complete

- README, architecture, protocol, and safety-testing now distinguish discovery, temporary RAM changes, and EEPROM persistence.
- Focused tests pass; full regression and final PlatformIO build remain.
## 2026-07-04 - Machine profile regression cleanup

- Production Resume tests now require cached/fallback machine profile bounds instead of duplicated hardcoded constants.
- Final full test/build rerun remains.
## 2026-07-04 - Machine Configuration ready for device test

- Firmware binary: `.pio-build/esp32cam/firmware.bin` (`0.5.5-machine-profile`).
- SD UI: `/www/index.html`, `/www/app.js`, `/www/style.css`, `/www/preview.js`, `/www/lib/machine-config.js`.
- First test: flash firmware, upload UI, wait for idle M115 discovery, open Settings, verify 1625×5800×70 and capabilities, read M503/M211, then test a reversible harmless setting before using M500.
- Verification: 24 files / 201 tests; PlatformIO 15.6% RAM, 52.9% flash.
## 2026-07-04 - Cutting jerk root cause and required firmware update

- Root cause: framework WebServer error logging contaminated UART0, which is also the Marlin link.
- Evidence exists in the stopped KAK job history as `Unknown command` lines containing
  `[E][WebServer.cpp:638]`; a G2/G3 line was merged into one of those messages.
- Fix: firmware builds with `CORE_DEBUG_LEVEL=0`; SD rescue diagnostics no longer use Serial.
- A new firmware build/flash is required. No SD `/www` upload is needed for this fix.
- Verified artifact: `.pio-build/esp32cam/firmware.bin`; 24 test files / 202 tests pass.
- First real-machine verification must use router/spindle off and exercise missing HTTP routes
  during harmless motion; Marlin must receive no `[E][WebServer.cpp...]` text.
## 2026-07-04 - Forced SD file downloads

- `/api/download?path=/gcode/KAK.gc` now forces an attachment named `KAK.gc`.
- This is a firmware endpoint change; rebuild and upload firmware. No `/www` file changed.
- Verified binary: `.pio-build/esp32cam/firmware.bin`; 24 test files / 203 tests pass.
## 2026-07-04 - Maintenance header layout

- Upload new firmware and `/www/style.css` to fix the `/update` header overlap.
- `/wifi` receives the same preventive layout correction.
- Verified binary: `.pio-build/esp32cam/firmware.bin`; 24 test files / 204 tests pass.
## 2026-07-04 - Mobile button press behavior

- Upload `/www/style.css`; long-pressing Run or other buttons no longer opens text selection.
- Joystick and hold controls retain their more specific `touch-action: none` behavior.
- UI-only change: no firmware build or flash is required.
## 2026-07-04 - Work-zero capture correction

- Upload `/www/preview.js`; no firmware flash is required.
- Real-machine retest: home, jog away, use Capture + Set Work Zero, and confirm the status bar and
  After G92 capture both report X/Y/Z approximately zero before dry run or arming.
- Then jog or dry-run away from zero and start: the Run panel must show `use active work zero` and
  must not apply another G92 at the moved position.
- UI-only fix; no firmware flash is required.
## 2026-07-04 - Bounding Box return position

- Upload `/www/preview.js`; no firmware flash is required.
- First test must use the router off: start above material, run trace, and verify final M114 matches
  the captured starting X/Y/Z within normal motion tolerance.
- UI-only change; firmware remains unchanged.
## 2026-07-04 - Zero-state runtime crash fixed

- Upload `/www/preview.js`; no firmware flash is required.
- Regression addressed: `Cannot set properties of undefined (setting 'capturedAt')` on partial jobs.
- Firmware remains unchanged.
## 2026-07-04 - Large job metadata arming fix

- The supplied ex1 job is correctly ARMED, but its arm object occurs after byte 8192.
- Firmware update is required; UI files do not need another upload for this specific fix.
- Verified binary: `.pio-build/esp32cam/firmware.bin`.
## 2026-07-04 - Motion telemetry implementation

- Firmware and SD UI both changed. Required UI files: `/www/telemetry.js`, `/www/preview.js`, and
  `/www/lib/workbench-ui.js`.
- Device test must verify M154 output for both streamed motion and the machine's physical joystick.
- Prediction-error correction is explicitly not implemented.
- Do not flash this iteration until `pio run` is rerun successfully; the prior attempt was blocked
  before compilation by the tool execution quota, not by a compiler error.
# Handoff - Automatic cut-bounds placement (2026-07-04)

- UI-only behavior: no firmware change was required for this placement feature.
- Placement now uses `cutBounds`; `rawTravelBounds` no longer controls the origin.
- `autoShiftToWorkZero` becomes true only for an unrotated cut that is outside the discovered work area and still fits by width/height.
- Auto-shifted placement requires a generated `/jobs/generated/*.run.gc`; an in-bounds 0-degree source continues using the original G-code.
- Rotated jobs continue to normalize their cut lower-left to work zero and use a generated run.
- Full generated travel bounds are still checked and may warn/block independently of the cut anchor.
- Upload to SD `/www`: `preview.js`, `lib/toolpath-transform.js`, and `lib/job-active-run.js`.

## 2026-07-05 - Authoritative machine/work coordinate frames

- Firmware `0.5.6-coordinate-frame` now owns the machine frame, homing epoch, and saved work-zero machine reference.
- Normal Start Job accepts only `use_active_work_zero`; it verifies the armed zero identity and never sends `G92`.
- Home All establishes the machine frame. Setting work zero uses the dedicated firmware endpoint and saves its machine-space reference into the job JSON.
- Old job JSON without a matching machine reference and homing epoch is intentionally blocked. Home All, set work zero, save, and arm again.
- Firmware artifact: `.pio-build/esp32cam/firmware.bin`.
- Upload to SD `/www`: `preview.html`, `preview.js`, `machine-bar.js`, `lib/workbench-ui.js`, and `lib/job-history.js`.
- First hardware test must use router/spindle off and no cutter: Home All, jog to a visible X/Y offset, set work zero, run Bounding Box, arm, and start. The job must remain at that work zero and Start must not issue another `G92`.
- Verification: 24 test files / 217 tests; PlatformIO build succeeded at 15.8% RAM and 51.9% flash.

## 2026-07-05 - Async Start transport

- Live diagnosis found valid job/arm/zero metadata but `Failed to fetch` during normal Start;
  device WiFi was weak (`-82 dBm`) and the HTTP handler synchronously waited through the complete
  Marlin preamble.
- Firmware `0.5.7-async-start` returns `PREPARING` immediately, then transitions to `RUNNING` only
  after every queued preamble command is acknowledged.
- Upload firmware and `/www/preview.js`. Existing job and generated G-code files do not need
  regeneration for this fix.
- Verified artifact: `.pio-build/esp32cam/firmware.bin`; 24 test files / 218 tests passed;
  PlatformIO used 15.8% RAM and 52.0% flash.
- First device retest must use router/spindle off: clear the prior failed test-motion state with
  Stop if needed, start the armed job, and verify the UI transitions `PREPARING` to `RUNNING`
  without `Failed to fetch`.

## 2026-07-05 - Live cutting position

- Firmware artifact: `.pio-build/esp32cam/firmware.bin` (`0.5.8-live-position`).
- Upload SD UI files: `/www/preview.js` and `/www/lib/preview-data-adapter.js`.
- `telemetry.js` and `machine-bar.js` on the live device already matched the repository and do not
  need another upload for this fix.
- First test should use router/spindle off: start a short arc job and verify the canvas marker moves
  continuously at the parsed segment feed while the top bar receives approximately one
  authoritative Marlin position update per second. Repeat once with WebSocket unavailable to verify
  HTTP status fallback also animates instead of jumping.
- Verification: 24 test files / 220 tests; PlatformIO 15.8% RAM and 52.0% flash.

## 2026-07-05 - False OFFLINE regression

- Firmware `0.5.8-live-position` emitted malformed `/api/job/status` JSON due to one extra quote
  between `machinePosition` and `uptimeMs`; UI consequently stayed OFFLINE.
- Flash `.pio-build/esp32cam/firmware.bin` (`0.5.9-json-status`). No additional UI file changed for
  this JSON-only correction; the preceding live-animation UI uploads are still required.
- Verification: 24 test files / 221 tests; PlatformIO 15.8% RAM and 52.0% flash.

## 2026-07-05 - WebSocket execution isolation

- Flash `.pio-build/esp32cam/firmware.bin` (`0.6.0-stream-isolation`).
- Upload `/www/telemetry.js`, `/www/preview.js`, `/www/lib/preview-data-adapter.js`, and
  `/www/lib/workbench-controller.js`.
- WebSocket remains the primary UI transport, but all network delivery now runs in a separate
  FreeRTOS task behind a bounded zero-wait queue. Browser sleep/WiFi loss may drop UI frames but must
  not delay Marlin streaming.
- Layers now persist in browser localStorage.
- First hardware test: router off, short job, then lock the phone or disable phone WiFi for at least
  30 seconds. The machine must continue without 15-20 second gaps; reopening the UI must restore a
  current snapshot.
- Verification: 24 test files / 223 tests; PlatformIO 15.8% RAM and 52.0% flash.

## 2026-07-05 - Documentation refresh handoff

- `README.md` now describes the current workbench, generated active-run validation, machine/work
  coordinate ownership, guarded workflow, SD streaming, and isolated WebSocket telemetry.
- The README gallery uses the July 5 screenshots in `screenshots/`; all June 19 screenshots were
  removed because they represented an obsolete UI.
- No firmware or SD `/www` upload is required for this documentation-only change.

## 2026-07-06 - Device identity loading handoff

- Firmware now has the SD -> NVS -> defaults identity selection layer. The SD parser is bounded to
  4096 bytes and accepts the documented minimal `device.hostname` / `device.friendlyName` object.
- mDNS startup, `/api/device`, tests, and final documentation remain to be completed in this task.

## 2026-07-06 - Local discovery handoff

- mDNS and `/api/device` are now implemented. Default discovery URL is `http://cnc.local`; a
  sanitized configured hostname produces the equivalent `http://<hostname>.local` URL.
- HTTP and `_esp32cnc._tcp` services advertise on port 80. Verification and protocol/config docs
  remain before hardware upload.

## 2026-07-06 - Device discovery verification handoff

- Device configuration and API behavior are documented in `docs/device-config.md` and
  `docs/protocol.md`; README now leads users to `http://cnc.local` first.
- Focused regression coverage is present in `test/firmware/device-discovery.test.mjs`.
- Unit tests and PlatformIO build are the remaining acceptance checks.

## 2026-07-06 - Device discovery ready for hardware test

- Verification passed: 25 test files / 228 tests; PlatformIO uses 16.4% RAM and 53.7% flash.
- Flash `.pio-build/esp32cam/firmware.bin`, then verify `http://cnc.local/api/device` with no SD
  config. Next test a preferred SD config, malformed JSON fallback, and SD removal after NVS cache.
- This feature requires firmware upload; no `/www` files changed.

## 2026-07-06 - BLE discovery implementation handoff

- BLE is an optional, non-connectable human-readable advertisement only; it is never a control
  transport. Startup occurs last and is skipped when disabled, name advertising is disabled, or
  free heap is below 70 KB.
- `/api/device` now includes configured BLE state, selected name, and whether advertising started.
- Documentation, regression assertions, full tests, and a new PlatformIO memory check remain.

## 2026-07-06 - BLE discovery verification handoff

- Documentation and focused regression assertions now cover the BLE configuration, name priority,
  API state, compile-time disable path, and WiFi-first startup contract.
- Full tests and PlatformIO build remain; watch RAM/flash growth because classic ESP32 BLE is
  intentionally enabled only when memory permits.

- The initial Bluedroid build reached 92.3% flash and was not accepted. Implementation now uses
  NimBLE-Arduino; rerun tests and build to confirm the reduced final footprint.

## 2026-07-06 - BLE discovery ready for hardware test

- Verification passed: 25 test files / 230 tests; NimBLE build uses 19.4% RAM and 66.6% flash.
- Flash `.pio-build/esp32cam/firmware.bin`, then check a phone BLE scanner for `CNC cnc.local` in
  STA mode and `CNC 192.168.4.1` in setup AP mode. Confirm `/api/device` reports `started:true`.
- Repeat once with `bluetooth.enabled:false`; WiFi, mDNS, and HTTP must remain unchanged.

## 2026-07-06 - Device Settings API handoff

- Firmware persistence and restart endpoints are implemented. PATCH saves NVS first, reports SD
  write status separately, and never changes the live hostname before restart.
- Both identity changes and restart are firmware-blocked during active/paused cutting. The SD UI,
  API tests, documentation, and full verification remain.

## 2026-07-06 - Machine Identity UI handoff

- Settings now exposes the full device identity workflow and clearly distinguishes current address
  from the address available after restart. Active/paused states disable editing and restart in UI,
  with firmware checks remaining authoritative.
- Upload requirements will include firmware plus `/www/index.html`, `/www/app.js`,
  `/www/style.css`, and `/www/lib/device-settings.js` after verification.

## 2026-07-06 - Device Settings verification handoff

- Firmware, SD UI, mock server, tests, and docs now cover the complete identity workflow.
- Verification is complete: JavaScript syntax checks, 26 test files / 237 tests, and PlatformIO
  build all pass. Final footprint is 19.4% RAM and 66.8% flash.
- Hardware acceptance remains: flash `0.6.3-device-settings`, change the identity while idle,
  restart, then confirm mDNS, BLE name, NVS fallback, and `/esp32-cnc/config.json` on the device.

## 2026-07-06 - Stream ACK guard handoff

- Safe-Z/M400 preparation no longer shares the too-short 1500 ms request timeout.
- Streaming never retries an unacknowledged motion automatically. Marlin `busy:` extends the ACK
  deadline; silence becomes an explicit ERROR naming the uncertain command instead of an endless
  stationary RUNNING state.

## 2026-07-06 - Animation gap recovery handoff

- Missing sequence numbers inside compact motion telemetry are expanded from the already parsed
  active-run preview. This specifically addresses straight-line jumping without increasing device
  communication load; arc interpolation remains unchanged.

## 2026-07-06 - Stream/animation hardware handoff

- Flash `.pio-build/esp32cam/firmware.bin` (`0.6.4-stream-ack-guard`) and upload the changed SD UI
  files before testing.
- First test with router/cutter off: start from Z below Safe Z, verify preparation survives the lift,
  then run a straight-heavy file and confirm continuous browser animation.
- If streaming enters ERROR, capture `/api/job/status` and `/api/marlin/log` before rebooting; the
  new error names the unacknowledged command and deliberately does not replay it.

## 2026-07-06 - Home-frame recovery handoff

- Old zero history remains for audit, but entries without `homingSessionId` are legacy. After the
  firmware update: Home All, explicitly restore the interrupted XY zero or set a new work zero,
  then set/review Z zero and re-arm.
- Recovery remains blocked between Home All and explicit zero restore, even when the interrupted
  run and selected zero ID match. This prevents work-coordinate moves from using home as work zero.
- Recovery bounds now operate in physical machine space. For example work Z -32 with a machine-Z
  work origin at 35.7 is checked as machine Z 3.7, not rejected merely for being negative.
- Hardware validation must confirm Count/M92-based machine coordinates after Home All, jog, G92,
  another jog, and saved-zero restore before any cutter-on recovery test.
- Verification passes: 26 test files / 241 tests; PlatformIO uses 19.4% RAM and 67.1% flash.

## 2026-07-07 - PNG thumbnail foundation handoff

- Upload thumbnail target is fixed at 128x128 PNG under `/jobs/thumbs`; existing job JSON fields
  are preserved when upload-time preview metadata is refreshed.
- Firmware remains unchanged; browser upload wiring and verification continue next.

## 2026-07-07 - PNG thumbnail upload handoff

- Upload-time sidecars use `/jobs/thumbs/<original-name>.png` and `/jobs/<original-name>.job.json`.
- A sidecar failure is reported after the original file upload; the CNC file remains available and
  can be selected/uploaded again to regenerate metadata.
- Regression coverage rejects reintroduction of SVG thumbnail generation in either upload surface.
- Verification passes at 27 test files / 244 tests; deploy SD UI files only, with no firmware flash.

## 2026-07-07 - PNG thumbnail display fix handoff

- Job metadata continues to store the SD path `/jobs/thumbs/*.png`; UI rendering converts it to
  `/api/download?path=...` because only `/www` is served as static SD content.
- Deploy updated `/www/app.js` and `/www/files.js`; firmware remains unchanged.
- Verification passes at 27 test files / 245 tests.

## 2026-07-07 - Recovery sleep/animation fix handoff

- Hiding or locking the browser no longer issues a job control request. ESP32-owned recovery and
  normal streams continue while WebSocket telemetry is disconnected; reconnect only resumes UI.
- Production Resume animation has its own command-number model seeded from the resume position.
- Firmware remains unchanged; deploy `/www/preview.js` and `/www/lib/toolpath-model.js`.
- Verification passes at 27 test files / 248 tests.

## 2026-07-08 - Smooth jog handoff

- Firmware `0.6.6-smooth-jog` owns a 50 ms velocity-jog loop with three-tick bounded lookahead;
  browser `/api/jog/update` timing no longer directly schedules Marlin movement.
- Every jog session verifies `G91`, sends one movement command per tick, tracks ACKs, and restores
  `G90` for normal stop, deadman stop, or ACK failure. Firmware flash is required.
- Verification passes at 27 test files / 250 tests; PlatformIO build uses 19.4% RAM and 67.2% flash.

## 2026-07-08 - Zero / Origin UI handoff

- Setup now presents only trusted Home-relative zero coordinates plus Set Work Zero, X, Y, Z, and
  History. Job metadata loads and saves automatically.
- History is operator-oriented and modal; diagnostics retain all legacy/raw metadata without
  dominating setup.
- Firmware `0.6.7-zero-origin` adds optional `{axes:"x|y|xyz"}` to `/api/work-zero/set`, so a
  firmware flash and updated Preview SD UI are both required.
- Verification passes at 28 test files / 255 tests and mobile 390x844 mock rendering. PlatformIO
  build uses 19.4% RAM and 67.2% flash.

## 2026-07-08 - Animation/recovery correction handoff

- Reopening a sleeping browser skips stale motion deltas and catches up to the current streamed
  command; animation backlog is capped at about one second.
- Recovery zero restore uses saved absolute Home-relative XYZ, with counts/M92 only as a legacy
  fallback. The guarded firmware sequence is M5, Safe machine Z, machine XY, optional saved machine
  Z, selected G92 axes, then M114; Home All and idle state are mandatory.
- Zero History entries expose `Restore & Go`; work-zero entries activate XYZ and Z-zero entries
  activate only Z after moving through Safe Z. Feed Override belongs to Run, not Zero/Setup.
- Firmware version is `0.6.8-zero-restore` and must be flashed for the expanded restore contract.
- Verification passes at 28 test files / 257 tests. PlatformIO build passes at 19.4% RAM and
  67.3% flash. Upload `www/preview.html`, `www/preview.js`, `www/preview.css`,
  `www/lib/job-history.js`, and `www/lib/workbench-controller.js` to SD `/www`; then install the
  new firmware once by WebOTA or wire.

## 2026-07-10 - Smooth motion handoff

- Firmware `0.6.9-smooth-motion` emits 25 ms G1 jog vectors with six-command bounded lookahead;
  deadman stop, ACK timeout, M410/M5, and G90 restoration are unchanged.
- Preview animation no longer treats valid planned duration above one second as stale. It still
  drops telemetry whose firmware timestamp is already stale and resynchronizes after browser sleep.
- Hardware acceptance should compare joystick motion at low/default/high XY speed with the cutter
  off, then run a file containing a single multi-second straight and confirm continuous animation.
- Deployments require the new firmware plus `www/preview.js`; verification is pending.
- Focused tests pass 56/56. The first full regression had only two stale firmware-version
  assertions (262/264 passed); those assertions are updated and final rerun/build are pending.
- Final regression passes 28 files / 264 tests. PlatformIO builds successfully at 19.4% RAM and
  67.3% flash; the verified image is `.pio-build/esp32cam/firmware.bin`.

## 2026-07-10 - Root SD update handoff

- The simple operator path is now: copy a PlatformIO image to SD root as `/firmware.bin`, insert
  the card, and reboot. No marker file is required.
- After a successful install the device renames it to `/firmware.done.bin`; update diagnostics
  remain in `/logs/update.log`.
- The older marker-based `/firmware/update.bin` rescue path remains backward compatible and has
  priority if both forms are present. Firmware/build verification is pending.
- Documentation now presents root `/firmware.bin` as the primary SD update method and retains the
  marker-based flow as a backward-compatible recovery option.
- Verification passes 28 files / 265 tests. PlatformIO builds at 19.4% RAM and 67.3% flash; the
  verified bootstrap image is `.pio-build/esp32cam/firmware.bin`.
- Existing devices must install `0.6.10-root-sd-update` once through WebOTA or the older
  `/firmware/update.bin` plus `/firmware/INSTALL.NOW` flow. Marker-free root updates work after that.

## 2026-07-10 - Simplified cutting UI handoff

- The readiness drawer now exposes Checks, Recovery, and Start Cutting; Arm remains internal only.
- Start Cutting has one concise three-item final check and keeps Hold-to-Start as the deliberate
  motion boundary. Feed and transport details are collapsed under advanced sections.
- Zero / Origin now has a Home Machine action. Automatic arm and homing wiring/tests remain.
- Readiness is progressive: it shows one contextual next action, including Home Machine before zero
  setup, while full check metadata stays collapsed.
- Holding Start now persists the internal arm snapshot from the final three checks immediately
  before calling the existing firmware-guarded start endpoint. Wiring is complete; tests remain.
- Dashboard and shared next-action logic now say Review & Start Cut instead of exposing Arm Job.
- Dedicated tests cover the three-check final review, removal of the physical-X0 prerequisite,
  automatic arm persistence, and guarded Home Machine routing. Verification remains.
- Final verification passes 28 test files / 267 tests plus JavaScript syntax and diff checks.
- Browser-based localhost rendering was blocked by the in-app browser policy, so the final mobile
  visual acceptance should be done on-device after deploying the updated SD UI files.

## 2026-07-10 - Workflow v3 foundation handoff

- `www/lib/job-workflow.js` defines the new schema-3 four-gate workflow; no legacy migration path
  is planned.
- Physical verification is now modeled as exactly one current Bounds/Aircut/Skipped decision whose
  identity includes run path/fingerprint, transform, and work-zero token.
- Manual-frame decisions expire when the firmware boot-session changes. Firmware exposure of that
  boot session and preview integration are next.
- Preview/dashboard loading now rejects non-v3 setup metadata, and upload metadata creation emits
  schema 3 directly. Existing SD Job JSON files must be recreated after deployment.
- Firmware `0.6.11-guided-cut-workflow` adds `/api/machine/manual-frame` with `preserve` and
  `set-zero` modes without inventing homed or absolute machine coordinates.
- Manual starts require `use_manual_work_frame` and the current `bootSessionId`; homed starts retain
  homing-session and absolute work-zero checks. Preview must write
  `startAuthorizationToken: "AUTHORIZED"` immediately before start and clear it afterward.
- Preview integration is complete: `renderReadiness()` is now driven by the central v3 evaluator,
  offers the corrective action at each gate, and uses one-time start authorization rather than Arm.
- The geometry drawer is intentionally separate on the left. All operational preparation and cut
  actions are grouped in the right `Prepare & Cut` drawer, while warning state remains visible on
  the graphical work area.
- Verification passes all 29 test files / 275 tests plus JavaScript syntax and diff checks.
  PlatformIO build and on-device visual acceptance remain because this session could not obtain
  `.platformio` write permission and the in-app browser policy blocks the configured localhost.

## 2026-07-11 file-view handoff

- The deployed `preview.html` must include `<script type="module" src="/preview.js">`; the missing
  module type was the reason every selected G-code returned immediately to Files.
- Copy the updated `preview.html`, `preview.js`, `app.js`, `files.js`, `style.css`,
  `lib/gcode-core.mjs`, and `lib/toolpath-model.js` to `/www` while preserving the `/www/lib`
  directory structure.
- File actions now overlay cards and are available through Shift-click, right-click, or hold.
  Ordinary click/tap opens the file and missing Job JSON v3 is generated during that first open.
- Final verification: 30 test files / 279 tests pass; JavaScript syntax and diff checks pass.
- Bounds verification now goes through `recordPhysicalVerification()`, which canonicalizes the live
  run identity before evidence creation and immediate persistence. Deploy updated `preview.js` and
  `lib/job-workflow.js` together.
- Missing thumbnails are now generated during preview open using `sourceToolpathModel` and the same
  `renderToolpathToCanvas()` engine used by upload previews. Deploy updated `preview.js`; it reuses
  `/www/lib/upload-thumbnail.js` and writes the PNG to `/jobs/thumbs` before saving Job JSON.
- Final regression after thumbnail-on-open integration: 30 files / 280 tests.

## 2026-07-12 recovery and new-file handoff

- Deploy `preview.html`, `preview.js`, `app.js`, `files.js`, and `lib/upload-thumbnail.js` together:
  job sidecar naming changed to full-path-derived hashed names. Old basename-only sidecars are
  intentionally unsupported and will be recreated when a file is opened.
- Opening another file starts with that file's own preparation/history state. Machine-level facts
  such as homing and the live work frame remain intact because they describe the physical machine.
- Recovery remains available only for the exact interrupted run identity. Advanced and diagnostic
  controls are present but collapsed by default; production resume uses the compact checklist from
  `lib/job-recovery.js`.
- Verification: 30 test files / 282 tests. On-device visual and real interrupted-cut acceptance are
  still required before relying on production recovery.
- `app.js` and `files.js` also restore existing PNG cards directly when the new hashed Job JSON has
  not been created yet; this does not restore old preparation or run state.
- Deploy `machine-bar.js` and `style.css` together for the drawer offset and simplified header. The
  offset follows the live machine-bar height, including a temporarily visible Marlin status row.

## 2026-07-13 joystick handoff

- Deploy `machine-bar.js` and `style.css` together. The jog dock now has a free XY center stick,
  eight direction-locked draggable arrows, visible Z+/Z- controls, and a gear-opened slider panel.
- Direction arrows reuse the existing firmware-backed jog start/update/stop heartbeat. Their exact
  axis or diagonal is fixed; only vector magnitude changes as the handle is pulled radially.
- Safe Z remains capped by the existing 70 mm machine limit. No firmware endpoint changed.
- The final mobile layout uses a vertical Z rail and labels the cardinal direction handles X+/X-/Y+/Y-.
- The settings gear has an explicit foreground z-index; keep it above the pad when adjusting dock layout.
- Verification: `npm.cmd test` passed 30 files / 284 tests. Local mock browser hit-testing confirmed
  that the gear itself receives the click and exposes Safe Z, XY max, and Z max sliders.

## 2026-07-13 continuous jog follow-up

- Firmware jog G1 segments now represent 40 ms while being submitted every 25 ms, keeping a
  bounded 15 ms overlap in Marlin's planner without changing the configured feed limit.
- Z is now one centered vertical proportional slider. Pull up/down for Z+/Z-; pull distance controls
  vector magnitude, and pointer release/cancel/loss uses the existing jog stop path.
- The Z handle is visually centered at rest and moves only inside its labelled vertical track.
- Verification: 30 files / 284 tests pass and the ESP32-CAM firmware build succeeds (19.4% RAM,
  67.5% flash). Mock-browser Z+ drag/release returned to IDLE and recentered the handle.

## 2026-07-13 natural jog-stop follow-up

- Firmware now keeps an estimated 40-80 ms motion horizon instead of submitting 40 ms moves every
  25 ms indefinitely. This bounds input lag while keeping the next G1 available to Marlin.
- `/api/jog/stop` accepts `{ "emergency": false }` for natural planner drain without M400/M410;
  missing body or `emergency: true` remains the hard safety-stop path.
- `machine-bar.js` sends natural stop only for pointerup. All ambiguous control-loss events send
  `emergency: true`, preserving the safety boundary.
- Verification: 30 files / 284 tests pass and ESP32-CAM firmware builds at 19.4% RAM / 67.6% flash.

## 2026-07-13 manual Restore Z handoff

- Firmware never restores jog Z on a timer. Safe XY release only sets `zRestoreAvailable` and keeps
  the captured `originalZ` for explicit `POST /api/jog/restore-z`.
- Restore validates idle state and unchanged Safe Z before moving. Emergency stop or Z-axis jog
  invalidates the saved target.
- Deploy `machine-bar.js` and `style.css` with the firmware. The settings panel now exposes a button
  labelled with the pending target (for example `Restore Z 34 mm`); it is disabled when no target is
  safely available and asks for explicit clearance confirmation before the request.
- The mock endpoint mirrors this manual-only flow. Firmware coordinate capture waits for `M400 ok`
  before `M114`, including before the restore safety check.
- Verification: 30 files / 285 tests pass; ESP32-CAM firmware builds at 19.4% RAM / 67.6% flash.
  The inactive Restore Z button was also checked in the local gear-panel layout.

## 2026-07-13 stable jog UI handoff

- Deploy `lib/ui-skins.js` with the jog UI update. Icon application is now idempotent and no longer
  rewrites unchanged button icon markup.
- `machine-bar.js` has separate fast readout renderers; jog acknowledgements no longer invoke the
  full machine-bar render.
- Jog/log/position telemetry uses those fast paths. Stable frame revisions no longer emit repeated
  `cnc-machine-frame` events, and Pause/Resume preserves its existing icon DOM.
- Predicted jog motion updates only the machine-bar and drawer coordinate text, preserving responsive
  feedback without rebuilding controls.
- Verification: 30 files / 285 tests pass, including focused machine-control, telemetry, and skin
  coverage. No firmware rebuild is needed for this UI-only follow-up.

## 2026-07-13 absolute jog target handoff

- Firmware jog status exposes `commandedWorkX/Y/Z` only after an absolute starting position has been
  captured; clients must ignore these fields when `commandedPositionCaptured` is false.
- Both Safe and non-Safe starts obtain the absolute baseline only after Marlin confirms queued motion
  complete and returns a full XYZ `M114` position.
- Jog motion now remains in `G90` and queues absolute `G1` targets. Any hard stop/error invalidates
  the commanded target so a subsequent session must recapture actual Marlin position.
- `/logs/job.log` now records jog heartbeat timeouts, requested emergency stops, and jog errors.
- `machine-bar.js` removed browser-side incremental jog prediction. It renders the firmware's complete
  absolute commanded position when valid, while ordinary position telemetry remains authoritative for
  measured physical position.
- The mock server mirrors the absolute `G1` target/status contract; keep it aligned when jog status is
  extended further.
- During JOGGING/STOPPING with a valid command target, the UI ignores lagging position autoreports to
  avoid visual oscillation. Physical telemetry becomes authoritative again after stop/error.
- Deploy firmware, `machine-bar.js`, and the matching mock/test changes together. Verification passes
  30 files / 285 tests; ESP32-CAM build uses 19.4% RAM / 67.7% flash.

## 2026-07-13 work-zero history safety handoff

- The development mock now enforces the same active-work-zero guard as firmware; its integration test covers both the rejected cold-session path and the accepted active-frame path.
- The accepted mock path uses an explicit machine-coordinate fixture and establishes XYZ zero after homing, so the test does not depend on startup offsets.

- Firmware Go To Work Zero now requires `machineFrame.workZeroValid`. After restart the operator must
  set a new zero or explicitly restore a saved history entry before X0/Y0 movement is accepted.
- `preview.html` places Zero / Origin in Prepare and exposes saved work-zero selection inline; the old
  History dialog remains available for detailed work- and Z-zero history.
- `preview.js` distinguishes saved metadata from the live active frame. Restore remains guarded by
  Home All, Safe-Z machine-coordinate travel, and idle job state, then refreshes history/readiness.
- `machine-bar.js` disables and rejects Go To Work Zero when live `workZeroValid` is false; firmware
  independently enforces the same boundary.
- Dashboard/readiness links no longer target `#setup`. Saved metadata is explicitly labelled saved,
  while activation/restoration happens in Prepare after Home All.
- Verification passed 30 files / 285 tests; ESP32-CAM firmware build uses 19.4% RAM / 67.7% flash.
- Deploy the firmware plus `preview.html`, `preview.js`, `preview.css`, `machine-bar.js`, and `app.js`
  together so the active-frame safety rule and its operator workflow stay aligned.

## 2026-07-14 persistent Home All handoff

- Job Readiness now owns a static Home All button. It remains in the same place after successful
  homing while the gate-specific action advances to Set Work Zero, verification, or start review.
- It dispatches the existing guarded full-homing request and is disabled, not hidden, during active
  job states. Re-homing starts a new homing session, so the saved work zero must then be restored or set.
- Local browser QA confirmed the control is visible in Job Readiness. Full verification passed 30
  files / 285 tests; no firmware change or firmware upload is required for this UI-only update.

## 2026-07-14 Aircut stepdown-collapse handoff

- Aircut no longer repeats an identical XY cutting pass merely because the source repeats it at other
  Z depths. The first geometry pass is retained and later different-Z copies are removed.
- Same-Z repeats are deliberately preserved, as are different contours and final travel/parking moves.
- Generated Aircut remains a bounded browser-side artifact; firmware still validates and streams the
  uploaded test-motion file without loading the production job into RAM.
- Functional tests cover line contours in both traversal directions, intentional same-Z repeats,
  distinct geometry, trailing travel, and repeated native arc passes.
- Browser QA confirmed the module loads and the operator hint describes the one-pass behavior. Full
  verification passed 31 files / 290 tests. This is a web-asset change; no firmware upload is required.

## 2026-07-14 2D / orthographic 3D workspace handoff

- The preview canvas now has a persistent 2D/3D view selector. 2D remains the default for a browser
  with no saved choice; 3D uses a fixed orthographic camera, not a perspective camera.
- `workbench-ui.js` owns the pure world-to-canvas projection. `preview.js` supplies machine-space XY
  and path-relative Z consistently to paths, bounds, recovery overlays, and the live tool marker.
- When live telemetry is explicitly machine-frame data, its Z is rendered relative to the active
  work zero while X/Y stay in homing-table coordinates. Work-coordinate telemetry remains unchanged.
- Switching views resets only camera zoom/pan and retains the current Fit target, layers, job state,
  and all machine state. The choice is stored under `lowrider.workbench.view-mode.v1`.
- This is a web-only change. Browser QA covered both projections, Fit Active/Table, and saved-view
  restoration. JavaScript syntax and diff checks pass; the full suite passes 31 files / 293 tests.

## 2026-07-16 dynamic Safe Z handoff

- Firmware is authoritative for Safe Z. Normal Start, validated test motion, and Go To Work Zero
  call the same validator; the former fixed `0..200` UI/API range is no longer a safety boundary.
- In a homed frame, `machine target Z = workZeroMachineZ + requested work Z`. The target must stay
  inside the Marlin-discovered full Z range and must not be lower than the current work Z for a
  safety lift. Manual/unhomed frames can only use the discovered work range and are exposed as
  `mappedToMachine: false`.
- Installed tool length is represented by the active Z work zero, so it is intentionally not added
  a second time. Tool-change station Z remains an independent G53 target and is checked at settings
  save, M6 park, and M6 return time.
- `/api/machine/frame.safeZ` is the browser contract. Deploy firmware together with `preview.js` and
  `machine-bar.js`; otherwise old browser inputs will not display the narrower live range even though
  firmware will still reject unsafe motion.
- Full verification passes 39 files / 328 tests. ESP32-CAM firmware build uses 19.6% RAM / 70.7%
  flash.

## 2026-07-16 persistent tool-change handoff

- `/logs/active-job.json` now uses checkpoint schema 2. Its nested `toolChange` object contains the
  authoritative M6 phase and all evidence required to understand an interrupted change without the
  original browser session.
- The phase sequence is requested -> optional parking -> waiting for tool -> ready after Z zero ->
  resuming. Firmware persists each critical boundary immediately; ordinary periodic checkpointing
  remains unchanged for streamed progress.
- `nextByteOffset` points after the intercepted M6 command and `nextLineNumber` names the following
  source line. These are recovery evidence only: boot still sends M5, invalidates position, and never
  automatically resumes or completes a tool change.
- Park completion and the captured work-coordinate return position are persisted separately. A
  restart or error therefore cannot imply that parking or return motion completed when it did not.
- `POST /api/job/tool-change/complete` now requires both `{ confirmed: true, routerReady: true }`
  after Z zero. The Preview UI supplies `routerReady` only after the operator checks the new
  router/spindle-state confirmation.
- Deploy firmware, `preview.html`, and `preview.js` together because older UI code does not send the
  new required confirmation field.
- Full verification passes 39 files / 328 tests; firmware build is 19.6% RAM / 70.8% flash.

## 2026-07-16 Pause / Stop / M5 safety handoff

- Pause Safely is intentionally not immediate: firmware closes the stream, sends priority M5, then
  waits on M400 while Marlin completes movement already in its planner. Normal Resume remains valid.
- Stop Now is the abrupt path: firmware sends M5 followed by M410. Once both are acknowledged, the
  current machine/work position, homing frame, and active work zero are invalidated. The next motion
  requires Home All and the existing recovery review; no automatic coordinate restoration occurs.
- `/api/machine/frame` now includes `positionValid`. A false value updates frame trust without
  replacing the last operator-visible coordinate readout with zeroes.
- Output Off (M5) only controls router/spindle output and explicitly does not claim to stop motion.
  If `/api/job/stop` fails, both browser surfaces make only this best-effort M5 attempt and do not
  mark the run stopped or send M400 as a substitute for M410.
- Deploy firmware together with `machine-bar.js`, `preview.html`, and `preview.js`. Full verification
  passes 39 files / 329 tests; firmware build is 19.6% RAM / 70.9% flash.

## 2026-07-16 single-operator lock handoff

- A new or erased device has no operator PIN and rejects all state-changing requests. Connect to the
  device Setup AP at `192.168.4.1`, enter a controller name, and choose a unique 6-12 digit PIN. NVS
  stores only `SHA-256(deviceId + ":" + PIN)`.
- The controller cookie is HttpOnly and SameSite=Strict. Its firmware-side lease expires 45 seconds
  after the last authorized request/heartbeat; sleeping or disconnected browsers therefore do not
  lock out the machine indefinitely. A new client can claim only after release/expiry and still
  needs the PIN.
- All mutating HTTP routes are firmware-guarded. Read-only clients retain health, job status,
  telemetry, file lists/downloads, and preview exploration, but cannot send commands or mutate SD,
  settings, coordinate frames, jobs, jog state, WiFi, or restart state.
- OTA is not enabled merely by owning the controller lease. The Update page requires the PIN again,
  the firmware verifies that job/jog/priority motion is idle, and one upload may begin within the
  two-minute unlock window.
- Deploy firmware and at least `machine-bar.js` plus `style.css` together. An updated UI connected to
  older firmware fails closed as read-only because `/api/operator/status` is absent.
- Automated verification passes 40 files / 334 tests, browser QA passes, and the ESP32-CAM
  PlatformIO build succeeds at 19.6% RAM (64,236 bytes) and 71.3% flash (1,401,681 bytes).

## 2026-07-19 Aurora Glass UI/UX skin handoff

- Implemented the `aurora-glass` theme using glassmorphism design parameters generated via the Cyber-Rage Design Intelligence Engine.
- The skin is defined in `/www/skins/aurora-glass/` containing `skin.json` and `theme.css`.
- Registered `aurora-glass` as an active skin in `/www/lib/ui-skins.js` under the `KNOWN_SKINS` array.
- Included validation assertions in `/test/ui/ui-skins.test.mjs` to check the `skin.json` syntax and icon availability.
- Deploy the new `/www/` resources to the SD card (under `/www/skins/aurora-glass/` and `/www/lib/ui-skins.js`) to make it selectable in the settings/skin selector of the web pendant UI.
- All 42 tests and 350 assertions verify the new skin structure. Build footprint is unchanged.

## 2026-07-23 remembered controller handoff

- Deploy firmware and `www/machine-bar.js` together. The updated claim request includes `browserId`,
  and old firmware does not provide `/api/operator/reconnect`.
- On the first successful claim, the browser keeps a random 256-bit identity under
  `cnc.operator.browserId`. Firmware persists only
  `SHA-256(deviceId + ":browser:" + browserId)` plus the controller display name.
- Opening or refreshing the page stays read-only while status is checked. If that browser identity
  matches the last controller stored by ESP32, reconnect happens silently and a fresh HttpOnly cookie
  is issued; otherwise no dialog appears until the user attempts a machine-changing action.
- Cancel only closes the panel. Release Control intentionally also forgets the browser on both sides,
  so the next controller claim requires the PIN and establishes a new remembered browser.
- DEV MOCK and firmware contract tests cover restart recovery and wrong-browser rejection. Full suite
  passes 42 files / 352 tests; PlatformIO ESP32-CAM build succeeds at 19.7% RAM / 72.1% flash.

## 2026-07-23 Bounds/Aircut and transformed-bounds handoff

- Deploy `www/preview.js`, `www/lib/job-workflow.js`, and
  `www/lib/toolpath-transform.js` together; no firmware update is needed.
- The generated bounds contract now describes commands actually written to the run file. A
  transformed parser `from` coordinate is not counted when the emitted command changes only Z.
- For SD `ex2.gc` at 5°, the corrected placement and generated bounds are both
  X 0..547.68, Y 0..547.68. The old -224.26 mm Y minimum was metadata-only and was never an emitted
  XY target.
- Normal preflight failures are deferred until after the current preparation step, so they cannot
  remove the Bounds Check and Full Aircut choices. A real firmware recovery checkpoint still blocks
  preparation until explicitly resolved.
- Full suite passes 42 files / 354 tests, including a regression with an initial Z-only move before
  the first transformed XY command.

## 2026-07-25 Immediate Stop handoff

- Firmware Stop now preempts queued/active lower-priority control state and transmits priority
  `M410` synchronously in `/api/job/stop`; priority `M5` follows only after the M410 acknowledgement.
- The endpoint still returns without waiting for Stop completion, and the firmware runner owns the
  remaining `STOPPING` to `STOPPED` transition if the browser disconnects.
- The existing machine-frame state is invalidated when M410 is issued. Home All is required to
  restore trusted position before recovery or safety-sensitive motion.
- `stopEmergencyParserDetected` and `stopWarning` are included in job telemetry. When M115 did not
  report `EMERGENCY_PARSER`, Stop remains functional but explicitly warns that immediate interruption
  cannot be guaranteed.
- DEV MOCK and firmware contract tests now cover asynchronous acceptance, `M410` before `M5`, stream
  cancellation, priority failures, ACK/lower-priority preemption, and capability warnings.
- Verification passes: 42 test files / 357 tests, plus an AI-Thinker ESP32-CAM PlatformIO build at
  19.7% RAM (64,412 bytes) and 72.1% flash (1,417,845 bytes).
- Deploy the firmware and updated `www/machine-bar.js` / `www/preview.js` together so displayed Stop
  order and Emergency Parser warnings match the controller behavior.

## 2026-07-25 workflow/history/recovery refactor design handoff

- The implementation boundary is browser metadata and UI normalization; firmware movement behavior
  does not need to change. Firmware already treats `STOPPED`, `COMPLETED`, and `ERROR` as non-active.
- Preserve the existing `activeRun` metadata name for executable-file compatibility, but expose it
  to new logic as the execution target. Use `liveStatus` for physical operation state and
  `lastOutcome` for historical/terminal telemetry.
- Add `recoveries` without replacing `recoveryHistory`: the former is the saved opportunity
  collection, while the latter remains an append-only action/event audit.
- Migration must be deterministic and idempotent by `runId`; older Job JSON remains loadable and no
  fingerprints, generated validation, zero history, run history, or recovery events may be dropped.

## 2026-07-25 live readiness separation handoff

- `buildJobReadiness().run` now exposes `liveStatus`, `lastOutcome`, and `latest`. The old `status`
  key remains as an alias of `liveStatus` for compatibility.
- Do not reintroduce a primary-action branch based on `runHistory`. Recovery/history affordances
  belong in badges and secondary actions.
- Firmware keeps its existing terminal telemetry for diagnostics; browser normalization supplies the
  required idle live-state behavior without changing Stop movement semantics.

## 2026-07-25 multi-recovery metadata handoff

- Job JSON now carries `recoveries` alongside the append-only `recoveryHistory`. Each entry references
  an immutable `runHistory` record and snapshots the execution identity needed for later validation.
- `normalizeRecoveries()` is safe to call repeatedly and derives only missing entries for eligible
  runs with stable ids. It does not remove legacy history or fingerprints.
- `planMotionOnlyRecovery()` accepts `recoveryId` or `runId`; callers should pass the operator's
  explicit selection instead of relying on default newest-eligible selection.
- Closing states (`abandoned`, `marked_finished`, `recovery_completed`) remain auditable in the
  collection but are excluded from active recovery counts.

## 2026-07-25 persistent setup tools handoff

- Readiness has a static setup-tool row. Keep it independent from the dynamic primary recommendation.
- Re-zeroing retains the prior verification decision with `staleReason`/`staleAt`, marks completed
  dry-run modes stale, and clears authorization. This keeps history inspectable and makes immediate
  Bounds/Aircut repetition possible.
- Placement/execution identity invalidation follows the same pattern and continues to enforce
  generated-file identity rather than falling back to source G-code.

## 2026-07-25 recovery collection UI handoff

- The Recovery tab lists every active saved opportunity and passes the selected recovery id into the
  planner. Closing a recovery preserves both its collection entry and original run audit.
- The dashboard shows recovery count separately. Its current-job action no longer branches on
  terminal firmware telemetry or the latest historical run.

## 2026-07-25 durable checkpoint handoff

- Preview startup saves a production firmware checkpoint into the `jobPath` recorded by firmware,
  including when a different job is selected, then acknowledges the checkpoint.
- Upload must remain before acknowledgement. If recorded metadata cannot be written, firmware keeps
  its checkpoint and continues to fail closed for Start; ordinary preparation remains visible.
- Legacy test-motion checkpoints still require deliberate clearing because they are not recoverable
  production runs.

## 2026-07-25 workflow/recovery documentation handoff

- `docs/job-metadata.md`, `docs/recovery.md`, and `docs/mobile-job-flow.md` now describe the separated
  live/current/history/recovery model and supersede older newest-run/Review-Last-Run behavior.

## 2026-07-25 workflow/history/recovery verification handoff

- Full suite: 42 files / 365 tests passing.
- This refactor is an SD web-asset/metadata change; firmware movement behavior is unchanged.
- Real-machine acceptance should still cover Stop A -> select/run B -> reopen A, stale Bounds after
  re-zero, generated-file-change recovery blocking, and deliberate material/fixture confirmation.
