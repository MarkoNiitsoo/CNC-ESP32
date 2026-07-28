# Progress

## 2026-07-28 - Controller Contact Safety & Motion Gating Pass

- Completed Controller Contact Safety and Motion Gating pass on `feature/phase1-websocket-transport`:
  1. Distinguish M400/M114 Outcomes (`www/preview.js`):
     - UART owner busy (HTTP 409): Returns busy error, shows active owner, and does NOT mark Marlin unresponsive.
     - M400 waiting: Renders `"Waiting for the machine to finish current motion…"`, awaits M400 completion before sending M114, and allows operator cancel without sending movement.
     - Malformed M114 position: Terminal `ok` response with invalid coordinates triggers AT MOST ONE controlled retry (`M114`). If 2nd M114 also fails, aborts with `"Marlin responded, but a complete X/Y/Z position could not be read. Cut Bounds was not started."` (retains controller contact).
     - M400 / M114 timeout: Sets controller communication state to `UNRESPONSIVE`, aborts Cut Bounds, and blocks normal commands.
  2. Authoritative Controller Communication State (`src/main.cpp`, `dev/mock-job-runner.mjs`, `dev/mock-server.mjs`): Added `ControllerCommunicationState` enum (`Unknown`, `Connected`, `Waiting`, `Unresponsive`, `Recovering`) and `ControllerCommunicationTelemetry` struct. Serialized `controllerState` and `controllerCommunication` telemetry object into status JSON.
  3. Gate Ordinary Machine Commands (`src/main.cpp`, `dev/mock-job-runner.mjs`, `dev/mock-server.mjs`): Gated Home, Jog, Bounds, Aircut, Job Start, Resume, Work Zero set/restore/goto, and `/api/cmd` when state is `UNRESPONSIVE` or `RECOVERING` (HTTP 503 error). Physical Stop / E-stop pathways remain callable.
  4. Controlled Recovery Sequence (`src/main.cpp`, `dev/mock-job-runner.mjs`, `dev/mock-server.mjs`): Implemented `POST /api/controller/recover` performing UART drain -> quiet period -> enter `RECOVERING` -> send `M115` identity probe (invalidates homing/frame if reset detected) -> send `M114` position probe -> transition to `CONNECTED`.
  5. Browser UI & Behavior (`www/preview.js`): Added `renderControllerStatus()` status badge and `recoverControllerConnection()` retry button calling `/api/controller/recover`.
  6. Executable Safety Test Suite (`test/firmware/controller-communication.test.mjs`): Added 14 executable test cases proving all safety scenarios.
  7. Verification: `npm test` passed 48/48 test files and 501/501 tests. `pio run -e esp32cam` compiled cleanly (RAM: 19.6%, Flash: 73.9%).

## 2026-07-28 - Project Safe Z & Cut Bounds Safety Corrections Pass

- Completed Project Safe Z and Cut Bounds safety corrections on `feature/phase1-websocket-transport`:
  1. Frame-Aware Safe Z Lookup (`www/lib/job-safe-z.js`, `www/preview.js`): Updated `effectiveProjectSafeZ(job, options)` to accept and forward `options`. Updated `projectSafeZValue()` and all UI `migrateProjectSafeZ` calls to pass `{ frame: currentMachineFrame || {} }`. Added integration test in `test/ui/job-safe-z.test.mjs` proving machine-max Safe Z stays resolved across Work Zero changes (25mm -> 45mm, 30mm -> 40mm).
  2. Position Capture & Unconfirmed M114 Handling (`www/preview.js`): Removed all `|| 0` fallbacks in `sendBoundingBoxTrace()`. Require `startX`, `startY`, `startZ` to be finite numbers. If unconfirmed or missing/null/NaN: logs `"Current X/Y/Z could not be confirmed; Cut Bounds was not started."`, updates dry run log and job result, and returns before file generation/upload or API calls. Added assertions in `test/ui/machine-controls.test.mjs`.
  3. Non-Blocking Raw Bounds Fallback Warning Classifier (`www/preview.js`): Updated `isDryRunWarningMessage()` to classify `"Cut bounds could not be identified..."` as a non-blocking warning (`error: false`), keeping the action button enabled when `traceSafety.ok === true`.
  4. Stateful Firmware & Mock Bounds Sequence Validation (`src/main.cpp`, `dev/mock-job-runner.mjs`): Updated `POST /api/test-motion/start` payload to include `startPosition: { x, y, z }`. Implemented 9-step stateful sequence validator enforcing: 1. M5 first, 2. G21/G90/G54 established before motion, 3. first motion is `G0 Z<safeZ>` without XY, 4. no XY motion before initial Safe Z lift, 5. bounds/perimeter motion Z >= safeZ, 6. return `G0 X<startX> Y<startY>` followed by `M400`, 7. next motion is `G0 Z<startZ>` without XY, 8. ends with `M400`, 9. no motion following final M400.
  5. Mock Marlin Command Log Execution Tests (`test/mock/mock-job-runner.test.mjs`): Added 10-point Marlin command log inspection tests asserting exact TX command ordering, `M400` separation, initial Safe Z lift, return X/Y before Z descent, final Z equality, unconfirmed start position rejection, early Z descent rejection, and absence of descent after Stop or error.
  6. Verification: `npm test` passed 47/47 test files and 487/487 tests. `pio run -e esp32cam` compiled cleanly (RAM: 19.6%, Flash: 73.7%).

## 2026-07-28 - Project Safe Z Integration & Cut Bounds Execution Repair Pass

- Completed Project Safe Z integration and Cut Bounds test motion execution repair on `feature/phase1-websocket-transport`:
  1. Active-Run `programZ` Persistence (`www/lib/toolpath-model.js`, `www/lib/preview-data-adapter.js`, `www/preview.js`): Connected parsed `model.programZ` into `buildPreviewMetadata()` and `buildPreviewSummaryData()`. Updated `applyActiveRunParse()` to clone `run.model.programZ` into `jobState.programZ`, recalculate Project Safe Z with existing `extraClearanceMm`, and mark dependent states (Bounding Box, Aircut, verification decision, generated validation, Arm, Start authorization, recoveries) stale whenever program Z changes. Switching active runs updates program Z to the active run's evidence.
  2. New Job Initialization (`www/preview.js`): Removed Version 1 legacy initialization fields (`workZeroReference`, `workpieceHeightMm`, `stockTopWorkZ`, `safeZClearanceMm: 5`). New jobs initialize with Version 2 shape (`extraClearanceMm: 0`, `resolved: false`). Persisted job value and input default to `0 mm`.
  3. Machine-Maximum Fallback (`www/lib/job-safe-z.js`): Removed hardcoded `?? 70` zMax fallback. `programSafeZ = zMax - zeroMachineZ` requires trusted machine position, active Work Zero, finite `zeroMachineZ`, finite discovered `zMax`, and current frame identity. Unresolved state reports `Safe Z is waiting for a trusted machine position, active Work Zero and known machine Z limits. Home the machine and restore or set Work Zero.`. Machine-max is dynamically recomputed on frame identity changes.
  4. Firmware & Mock Version 2 Verification (`src/main.cpp`, `dev/mock-job-runner.mjs`): Updated `loadProjectSafeZ()` and `assertProjectSafeZ()` to read `version`, `programSafeZ`, `extraClearanceMm`, `effectiveSafeZ`, `resolved`. Independently verifies `effectiveSafeZ == programSafeZ + extraClearanceMm` within 0.001 mm. Rejects non-finite values, negative clearance, unresolved state, or stale effectiveSafeZ without clamping unreachable machine Z. Retained Version 1 compatibility fallback for legacy jobs.
  5. Placed Cut Bounds Selection (`www/preview.js`): Updated `generatedBounds()` to prioritize `placementBounds` -> `cutBounds` -> `rawTravelBounds` (fallback). Displays warning `Cut bounds could not be identified. This trace includes the complete G-code travel extents, including possible parking or lead-in movement.` when raw travel fallback is used. Margin is applied after selecting base bounds.
  6. Single Test-Motion Stream Cut Bounds (`www/preview.js`, `src/main.cpp`, `dev/mock-job-runner.mjs`): Replaced repeated `/api/cmd` HTTP calls with single `POST /api/test-motion/start` using `mode: "bounds"`. Firmware and mock validate mode `"bounds"`, forbid M3/M4/G92/G53/out-of-bounds Z, and enforce `safeZ`.
  7. Start XYZ Restoration (`www/preview.js`): `sendBoundingBoxTrace()` captures starting XYZ, runs bounds trace at `safeZ`, returns to start X/Y at `safeZ`, `M400` waits, restores `startZ` via `G0 Z<startZ>`, `M400` waits. Successful completion reports `Cut Bounds complete. Starting X/Y/Z restored.`.
  8. Interrupted/Failed Safety (`www/preview.js`): On Stop, error, or exception, automatic Z descent is NOT performed. Displays `Cut Bounds stopped before the starting position was restored. Automatic Z descent was not performed because the current X/Y position is not confirmed.`.
  9. Telemetry & HTTP Jog Isolation: Retained 12KB `ws-telemetry` task stack, FreeRTOS stack hooks, single-item log event streaming, and `resyncPending` handling. HTTP Jog semantics and transport remained unchanged; WebSocket Jog was not implemented in this task.
  10. Verification: `npm test` passed 47/47 test files and 480/480 tests. `pio run -e esp32cam` compiled cleanly (RAM: 19.6%, Flash: 73.5%).

## 2026-07-28 - ESP32 Panic Reboot Loop Investigation & Fix

- Investigated and resolved ESP32 panic reboot loop on `feature/phase1-websocket-transport`:
  1. Decoded Panic & Root Cause: `processNetworkTelemetry()` allocated `LogTelemetryEvent events[32];` (9,344 bytes) and `MotionTelemetryEvent events[16];` (1,184 bytes) directly on the task stack inside `telemetryNetworkTask`, exceeding the 8,192-byte stack allocation and causing a task stack overflow panic during startup when log events accumulated.
  2. Stack Overflow Fix (`src/main.cpp`): Replaced the 32-element local stack array in `processNetworkTelemetry()` with single-item `LogTelemetryEvent logEv;` processing (292 bytes stack) and reduced `MotionTelemetryEvent` batch array to 4 items (296 bytes stack). Increased `ws-telemetry` task stack from 8,192 to 12,288 bytes.
  3. Diagnostic Checkpoints & FreeRTOS Hooks (`src/main.cpp`): Added `logSystemEvent` checkpoints for mutex creation, queue creation, task creation, and Bluetooth setup. Installed `vApplicationStackOverflowHook` and `vApplicationMallocFailedHook`.
  4. Cross-Task SD Safety: Maintained strict isolation so `telemetryNetworkTask` (Core 0) never accesses SD or calls `logSystemEvent()` directly, preventing concurrency races with Core 1.
  5. Regression Testing (`test/firmware/transport-protocol.test.mjs`): Added unit tests verifying 12KB task stack, single-item log event streaming, FreeRTOS hooks, and startup checkpoints.
  6. Verification: PlatformIO build (`pio run -e esp32cam`) compiled cleanly (19.6% RAM, 73.4% Flash). Full test suite (`npm test`) passed all 47 test files and 468 tests.

## 2026-07-28 - Aurora Glass Skin Joystick CSS Fix

- Fixed Aurora Glass skin joystick positioning regression (`www/skins/aurora-glass/theme.css`):
  1. CSS Fix: Removed `transform: translateY(-1px)` and `transform: translateY(1px)` from generic `button:not(:disabled):hover` and `button:not(:disabled):active` rules, preserving hover feedback strictly via background, border, and box-shadow properties.
  2. Joystick Positioning Preservation: Verified `.machine-jog-center`, `.machine-jog-direction`, `.machine-jog-z-slider`, and `.machine-jog-z-handle` retain their original positioning transforms without `!important` overrides.
  3. UI Skin Regression Test (`test/ui/ui-skins.test.mjs`): Added focused unit test asserting Aurora theme generic button hover and active selectors contain no `transform` property.
  4. Verification: Full test suite (`npm test`) passed all 47 test files and 464 tests.

## 2026-07-28 - Phase 1 WebSocket First-Valid-Clock-Wins & Test-Accuracy Cleanup

- Completed Phase 1 WebSocket First-Valid-Clock-Wins & Test-Accuracy Cleanup on `feature/phase1-websocket-transport`:
  1. First-Valid-Clock-Wins Rule (`src/main.cpp`, `dev/mock-server.mjs`, `docs/protocol.md`): Simplified WebSocket `hello` wall-clock processing to strict first-valid-clock-wins. Removed client-supplied `owner`/`operatorOwner` checks from `hello` handling. Subsequent `hello` clock proposals after `wallClock.valid == true` are completely ignored without changing timezone, `dirtySystem`, or `stateRevision`.
  2. Mock `stateRevision` Alignment (`dev/mock-server.mjs`): First valid clock proposal increments `mockStateRevision` exactly once (`1 -> 2`), ensuring the initial snapshot carries revision 2. Subsequent rejected clock proposals do not increment `mockStateRevision`.
  3. Two-Client Clock Test (`test/firmware/websocket-runtime.test.mjs`): Updated Test 20 to assert both retained timezone (`Europe/Tallinn`) and unchanged `stateRevision` after second client connects.
  4. Future-ACK-Zero Browser Test (`test/ui/telemetry-protocol-browser.test.mjs`): Updated Test 5 to use `throwOnInitSend: true` so `highestClientSeqSuccessfullySent` remains `0`, verifying `invalid future ACK` protocol error, resync attempt, and non-advanced ACK (`0`).
  5. Strengthened Coalescing Test (`test/firmware/websocket-runtime.test.mjs`): Updated Test 12 to modify `controller` slice multiple times inside `coalesceStateChanges()` (`running` -> `paused` -> `idle`), asserting exactly 1 patch packet, 1 revision increment, and final `controller.state = 'idle'`.
  6. Verification: Verified clean firmware build (`pio run -e esp32cam`) and full test suite pass (`npm test`, 47 test files, 463 tests). No transport architecture, HTTP command, or Jog changes were made.

## 2026-07-28 - Phase 1 WebSocket Test Completion, Docs Sync & Wall-Clock Owner Pass

- Completed Phase 1 WebSocket Test Completion, Docs Sync & Wall-Clock Owner Pass on `feature/phase1-websocket-transport`:
  1. Executable Raw TCP WebSocket Runtime Tests (`test/firmware/websocket-runtime.test.mjs`): Replaced all placeholder tests with 20 executable TCP WebSocket runtime tests matching exact required titles and assertions. Updated `parseServerWsFrames()` parser to expose `opcode` and `raw` payload.
  2. Complete Browser Telemetry Client Tests (`test/ui/telemetry-protocol-browser.test.mjs` & `www/telemetry.js`): Added separate executable unit tests for monotonic ACK advance, old ACK non-regression, zero-sent future ACK rejection, protocol-error sequence commitment, same-boot absent canonical slice clearing, snapshot job/jog emission, motion event dispatch, and log event dispatch. Gated `window.CncTelemetry.__test__` behind `window.CNC_TELEMETRY_TEST_MODE === true` and verified it is absent by default.
  3. Single Wall-Clock Authority (`src/main.cpp` & `dev/mock-server.mjs`): Enforced single wall-clock authority rules across firmware and mock server. First valid browser `hello` initializes ESP wall clock. Secondary connections do not rewrite valid clock/timezone unless from current control owner. Rejected or unchanged clock proposals do not set `dirtySystem` or increment `stateRevision`.
  4. Documentation Synchronization (`docs/protocol.md`): Updated protocol documentation to include `"event"` type, exact event envelope structure, `"motion"` and `"log"` channels, local connection state definition, low-rate stable system diagnostics, and wall-clock authority rules.
  5. Verification: `pio run -e esp32cam` compiled cleanly. Full test suite (`npm test`) passed all 47 test files and 463 tests (increasing total test count).

## 2026-07-28 - Phase 1 WebSocket Final Protocol-Correctness Repair Pass

- Completed Phase 1 WebSocket Final Protocol-Correctness Repair Pass on `feature/phase1-websocket-transport`:
  1. Firmware Authoritative Slice Builders & Central Event Helper (`src/main.cpp`): Updated `healthStatusJson(bool quantizedForAuthoritativeState)` to omit raw `millis()`, `freeHeap`, `rssi`, and SD sizes when `quantizedForAuthoritativeState == true`. Created `buildAuthoritativeJobSliceJson()` and `buildAuthoritativeJogSliceJson()` to omit volatile `elapsedMs`, `heartbeatAgeMs`, and `uptimeMs` from state diff comparisons. Added 10s low-rate scheduler for candidate `systemBaseJson` in `stageTelemetryUpdates()`, preventing continuous `stateRevision` churn. Implemented central `sendClientEvent(client, channel, dataJson, revision)` helper and updated `"motion"` and `"log"` channels to use `type: "event"`, `channel: "motion"|"log"`. Removed `connection` slice from `buildSnapshotFromStagedState()`.
  2. Browser Telemetry Client (`www/telemetry.js`): Added revision regression check in `applySocketMessage()`: within an unchanged `bootId`, packets with `stateRevision < lastStateRevision` trigger `cnc-telemetry-protocol-error` event and `requestResync()` without regressing state. Exposed gated `window.CncTelemetry.__test__` getters when `window.CNC_TELEMETRY_TEST_MODE === true`.
  3. Mock Dev Server & Test Hooks (`dev/mock-server.mjs`): Initialized `env.clockValid = false` once on server creation (removed per-socket reset in upgrade handler). Removed `connection` slice from `mockNormalizedAuthoritativeState()`. Added test hooks: `listClientProtocolStates()`, `simulateNextOutboundWriteFailure(clientIndex)`, `triggerStateSliceChange()`, `coalesceStateChanges()`, `triggerIdleSync()`.
  4. Real Browser Protocol Tests (`test/ui/telemetry-protocol-browser.test.mjs`): Expanded browser protocol test suite to 10 tests covering all required browser protocol assertions.
  5. Expanded Raw TCP WebSocket Runtime Tests (`test/firmware/websocket-runtime.test.mjs`): Exposed `opcode` in `parseServerWsFrames()`, covering all 16 raw WebSocket runtime scenarios.
  6. Documentation, Schema Parity & Verification: Added schema parity test in `test/firmware/transport-protocol.test.mjs`. Updated `docs/protocol.md` and `docs/architecture.md`. Verified clean firmware build (`pio run -e esp32cam` with 19.6% RAM, 73.4% Flash). Verified full test suite (`npm test`) passes all 47 test files and 455 tests.

## 2026-07-28 - Phase 1 WebSocket Protocol-Correctness Repair Pass

- Completed Phase 1 WebSocket Protocol-Correctness Repair Pass on `feature/phase1-websocket-transport`:
  1. Firmware Canonical Schema & Slice Alignment (`src/main.cpp`): Fixed `buildMachineSliceJson()` so `homingEpoch` is at the root of `machine` slice: `{"position":{...},"frame":{...},"homedAxes":{"x":...,"y":...,"z":...},"homingEpoch":0}`. Serialized capabilities dynamically from `controllerAdapter.capabilities`. Quantized `uptimeMs` to 10s and `freeHeap` to 10KB in `buildSystemBaseJson()` for stable candidate state comparisons. Fixed patch send error handling in `processNetworkTelemetry()` to mark `cs.resyncPending = true` on write failure. Formatted motion streaming events as `{"type":"event","channel":"motion","data":{...}}`.
  2. Browser Telemetry Client (`www/telemetry.js`): Updated `sendSocketPacket()` to increment `clientSeq` and `highestClientSeqSuccessfullySent` ONLY after successful transmission. Corrected timezone offset sign to `-new Date().getTimezoneOffset()`. Standardized `applySocketMessage()` validation order: protocolVersion -> bootId transition -> packet sequence -> peer ACK -> stateRevision -> dispatch. Removed duplicate snapshot exception (all duplicate `seq <= lastServerSeq` are ignored). Implemented full canonical snapshot replacement (clears absent canonical slices) and top-level slice patch replacement.
  3. Mock Dev Server & Test Hooks (`dev/mock-server.mjs`): Initialized `env.clockValid = false` before `hello`. Non-throwing `socket.write()` accepted as valid write. Marked `handshakeComplete = true` after snapshot write succeeds. Added test hooks: `triggerStateSliceChange`, `coalesceStateChanges`, `getClientProtocolState`, `simulateOutboundWriteFailure`.
  4. Real Browser Telemetry Client Tests (`test/ui/telemetry-protocol-browser.test.mjs`): Created dedicated browser protocol test suite executing `www/telemetry.js` against a fake DOM environment covering all 14 browser scenarios.
  5. Expanded Raw TCP WebSocket Runtime Tests (`test/firmware/websocket-runtime.test.mjs`): Expanded raw WebSocket test suite covering all 12 raw WebSocket scenarios including unsupported version, non-seq-1 hello, handshake requirement, monotonic ACK, duplicate sequence, resync snapshot, and write failure simulation.
  6. Documentation & Test Suite Verification: Updated `test/firmware/transport-protocol.test.mjs` and `docs/protocol.md`. Verified firmware build (`pio run -e esp32cam`) compiles cleanly (19.6% RAM, 73.4% Flash). Verified full test suite (`npm test`) passes all 47 test files and 450 tests.

## 2026-07-27 - Phase 1 WebSocket Protocol Correctness Pass

- Completed Phase 1 WebSocket Protocol Correctness Pass on `feature/phase1-websocket-transport`:
  1. Firmware Outbound Helper & Sequence Invariant: Refactored all outbound sends (`snapshot`, `patch`, `sync`, `protocol-error`, `motion`, `log`) behind `sendClientPacket()`. Sequence numbers (`nextServerSeq`) are committed and incremented ONLY AFTER `telemetrySocket.sendTXT()` returns `true`.
  2. ACK Validation & Monotonicity: Enforced `lastServerSeqAcknowledgedByClient <= ack <= highestServerSeqSuccessfullySent`. Out-of-bounds/future ACKs generate a `protocol-error` and trigger resync. Old ACKs are ignored without regressing.
  3. Browser Client Alignment (`www/telemetry.js`): Added outbound `sendSocketPacket()` helper, sequence gap/duplicate detection, monotonic ACK tracking (`highestClientSeqSuccessfullySent`, `highestClientSeqAcknowledgedByESP`), top-level slice replacement on `patch` without recursive shallow merge, and `cnc-telemetry-protocol-error` event dispatching.
  4. Mock Dev Server Parity & Framing (`dev/mock-server.mjs`): Added per-client sequence and monotonic ACK validation, outbound write sequence commitment, `/` and `/ws` upgrade paths, and framing support (masked frames, length > 125, multi-frame chunks, split frames, control frames).
  5. Real Executable Runtime WebSocket Tests (`test/firmware/websocket-runtime.test.mjs`): Created dedicated runtime WebSocket test suite connecting real socket clients to mock server covering 22 protocol runtime scenarios.
  6. Schema & Slice Alignment: Fixed `machine` schema so `homingEpoch` is consistently positioned in snapshot and patch. Compare complete top-level slice JSON strings in `stageTelemetryUpdates()`.
  7. Documentation: Updated `docs/protocol.md`.
  8. Verification: `pio run -e esp32cam` compiled cleanly (19.6% RAM, 73.3% Flash). `npm test` passed 46 test files and 441 tests.

## 2026-07-27 - Phase 1 WebSocket Transport Isolation 3 Correctness Fixes

- Completed final 3 transport-isolation correctness fixes on `feature/phase1-websocket-transport`:
  1. Reduced Mutex Critical-Section Scope: Candidate `systemBaseJson` string is built completely on main task stack (`buildSystemBaseJson()`) BEFORE acquiring `telemetryStateMutex` in `stageTelemetryUpdates()`. Mutex is held only to copy staged strings, dirty flags, and revision. Removed unused `diffSystem`.
  2. Monotonic Revision Fallback: Maintained `netLastObservedRevision` (initialized to 1 and updated whenever `stagedState.globalRevision > netLastObservedRevision` under lock). On mutex timeout, `getStagedStateRevision()` returns `netLastObservedRevision` instead of regressing to 1.
  3. Verified Snapshot Send Success: In `hello`, `resync`, and pending snapshot retry handlers, checked `bool sentOK = telemetrySocket.sendTXT(...)`. Set `cs.handshakeComplete = true` and cleared `snapshotPending`/`resyncPending` ONLY AFTER `sentOK` returns true. Preserved `snapshotPending`/`resyncPending` on send failure for automatic retry.
  4. Added 3 focused source-architecture regression tests in `test/firmware/transport-protocol.test.mjs`.
  5. Verification: `pio run -e esp32cam` succeeded (19.6% RAM, 73.4% Flash). `npm test` passed with 45 test files and 430 tests.

## 2026-07-27 - Phase 1 WebSocket Transport Isolation Correctness Fixes

- Implemented final transport-isolation correctness fixes on `feature/phase1-websocket-transport`:
  1. Staged System-Base Design: Main task serializes `stagedState.systemBaseJson` (`buildSystemBaseJson()`). Pure string helper `buildSystemSliceJsonFromBaseAndClock()` stitches system JSON from `systemBaseJson` and `stagedState.wallClock` under mutex without reading main business state (`healthStatusJson()`). Network task never queries WiFi, SD, or main business state.
  2. Published Clock Changes: Valid browser time updates `stagedState.wallClock`, sets `stagedState.dirtySystem = true`, and increments `stagedState.globalRevision` once under mutex. Connected clients receive system patch and connecting client receives initial snapshot with updated clock.
  3. Reliable Handshake & Resync Snapshot Delivery: `cs.handshakeComplete` is marked true ONLY AFTER snapshot envelope is successfully built and sent. If mutex acquisition fails, `cs.snapshotPending` or `cs.resyncPending` is retained and retried automatically in `processNetworkTelemetry()`.
  4. Single-Task SD Logging: Removed `logSystemEvent()` call from `telemetryNetworkTask`. SD logging remains 100% single-task owned by main loop on Core 1.
  5. Unified Authoritative Revision: Removed `protocolState.globalStateRevision`. `stagedState.globalRevision` under `telemetryStateMutex` is the sole revision representation. Revision is read under mutex via `getStagedStateRevision()` or snapshot copy.
  6. Task-Safe Transport Readiness: Replaced unprotected bool with spinlock-guarded helpers `isTelemetryStarted()` and `setTelemetryStarted(bool)` using `portENTER_CRITICAL(&telemetryDropMux)`.
  7. Cleanup: Removed `buildSystemSliceJson()` compatibility wrapper and duplicate revision variables.
  8. Added 9 focused source-architecture regression tests in `test/firmware/transport-protocol.test.mjs`.
  9. Verification: `pio run -e esp32cam` succeeded (19.6% RAM, 73.4% Flash). `npm test` passed with 45 test files and 428 tests.

## 2026-07-27 - Phase 1 WebSocket Transport Isolation Final Cleanup

- Completed final transport-isolation cleanup on `feature/phase1-websocket-transport`:
  1. Removed unsafe snapshot fallback: deleted `normalizedAuthoritativeStateJson()` completely. All WebSocket snapshots originate strictly from `stagedState` under mutex via `buildSnapshotFromStagedState(snapshotRev)`.
  2. Established single-source cross-task safe wall-clock state: created `StagedWallClockState` POD struct with fixed-size `char timeZone[64]` inside `StagedTelemetryState` protected by `telemetryStateMutex`. Removed duplicate un-synchronized wall-clock variables from `TelemetryProtocolState` and `CachedAuthoritativeSlices`.
  3. First-hello snapshot time synchronization: network task validates incoming `hello` browser time, acquires `telemetryStateMutex`, updates `stagedState.wallClock`, updates `stagedState.systemJson`, increments state revision, and immediately sends the initial `snapshot` carrying valid browser time.
  4. Moved WebSocket startup ownership: `telemetrySocket.begin()` and `telemetrySocket.onEvent(handleTelemetrySocket)` are owned exclusively by `telemetryNetworkTask` on Core 0 after task creation succeeds. If task creation fails, no WebSocket server remains started (`telemetryStarted = false`).
  5. Log drop counter integration: updated `processNetworkTelemetry()` to fetch and reset `logTelemetryDropped` via `fetchAndResetLogTelemetryDropped()` and include `"dropped": <count>` in outbound log patch packets.
  6. Added 5 focused source-architecture regression tests in `test/firmware/transport-protocol.test.mjs`.
  7. Verification: `pio run -e esp32cam` succeeded with 0 errors (19.6% RAM, 73.3% Flash). All 45 test files and 423 tests passed in `npm test`.

## 2026-07-27 - Phase 1 WebSocket Transport Isolation Runtime & Safety Defect Repairs

- Repaired all runtime and cross-task safety defects in the transport-isolation implementation:
  1. Fixed fatal `touchJobStatus()` infinite recursion by removing recursive self-call; verified no `touch*Status()` helper calls itself directly or indirectly.
  2. Implemented strict Commit-After-Stage invariant in `stageTelemetryUpdates()`: business slice cache (`cachedSlices`) is updated ONLY AFTER `xSemaphoreTake(telemetryStateMutex, 0)` succeeds and writes to `stagedState`. Failed zero-wait mutex acquisitions leave changes uncommitted and retryable on subsequent main-loop ticks.
  3. Isolated network task from direct main business state reads: `handleTelemetrySocket` hello and resync build snapshots strictly from `stagedState` under mutex (`buildSnapshotFromStagedState`), and initialized `stagedState` in single-threaded `initializeStagedState()`.
  4. Redefined `LogTelemetryEvent` as a POD struct with fixed-size char arrays (`id`, `timeMs`, `direction`, `priority`, `level`, `text`, `lastCriticalMessage`) to enqueue immutable log snapshots via `xQueueSend(logEventQueue, &ev, 0)`. Network task formats log JSON directly from queued POD items without touching `marlinLog` ring buffer or `lastCriticalMarlinMessage`.
  5. Added `feedOverridePercent` snapshot to `MotionTelemetryEvent` POD struct so network task formats motion JSON without touching `jobStatus`.
  6. Protected drop counters (`motionTelemetryDropped`, `logTelemetryDropped`) with FreeRTOS spinlock critical sections (`portENTER_CRITICAL(&telemetryDropMux)` / `portEXIT_CRITICAL(&telemetryDropMux)`).
  7. Added comprehensive resource allocation and task creation checks (`telemetryStateMutex`, `motionEventQueue`, `logEventQueue`, `xTaskCreatePinnedToCore`) in `startHttpServer()`, setting `telemetryStarted = false` and logging errors on failure.
  8. Cleaned up obsolete helper declarations and duplicate code blocks.
  9. Added focused source-architecture regression tests in `test/firmware/transport-protocol.test.mjs`.
  10. Verification: `pio run -e esp32cam` succeeded with 0 errors (19.6% RAM, 73.3% Flash). All 45 test files and 419 tests passed in `npm test`.

## 2026-07-27 - Phase 1 WebSocket Transport Isolation Repair

- Implemented strict low-priority FreeRTOS network task (`telemetryNetworkTask`) pinned to Core 0 (`xTaskCreatePinnedToCore`).
- Completely isolated the Arduino `loop()` (Core 1) from calling any WebSocket library functions (`telemetrySocket.loop()`, `sendTXT()`, `broadcastTXT()`).
- Added thread-safe latest-value replacement (coalescing) for top-level state slices (`system`, `controller`, `machine`, `job`, `jog`, `control`) using FreeRTOS mutex (`telemetryStateMutex`). State producers serialize dirty slices into `StagedTelemetryState` without blocking (`xSemaphoreTake(..., 0)`).
- Replaced old no-op `enqueueTelemetry` with bounded non-blocking FreeRTOS queues (`motionEventQueue` size 16, `logEventQueue` size 32) using `xQueueSend(..., 0)`. Queue saturation increments drop counters (`motionTelemetryDropped`, `logTelemetryDropped`) without applying backpressure or blocking SD/UART streaming or Jog.
- Removed dead Phase 1 transport artifacts: `enqueueTelemetry()`, unused `TelemetryPacket`, dead queue handles, and obsolete dirty flags.
- Updated `docs/architecture.md` to document the actual FreeRTOS task, mutex, queue, and WebSocket isolation model.
- Updated test suites (`test/firmware/marlin-transport.test.mjs`, `test/ui/telemetry.test.mjs`) to verify network task creation, main-loop isolation, latest-value replacement, and bounded non-blocking queues.
- Verification: `pio run -e esp32cam` succeeded with 19.6% RAM (64,228 bytes) and 73.3% Flash (1,441,273 bytes). All 45 test files and 411 tests passed in `npm test`.

## 2026-07-27 - Phase 1 WebSocket Transport Protocol Repair & Parity

- Repaired Phase 1 protocol implementation on branch `feature/phase1-websocket-transport`.
- Removed orphaned duplicate code in `src/main.cpp`.
- Implemented per-WebSocket-client protocol state in firmware (`connected`, `handshakeComplete`, `nextServerSeq`, `lastContiguousClientSeq`, `lastServerSeqAcknowledgedByClient`, `lastOutboundAtMs`).
- Enforced required `hello` handshake on socket open; server sends `snapshot` only after receiving `hello` with `protocolVersion: 1` and `seq: 1`.
- Added wall-clock time sync (`utcMs`, `timezoneOffsetMinutes`, `timeZone`) with `wallClockValid` flag.
- Ensured authoritative `stateRevision` increments on state slice changes, and idle `sync` timers check per-client idle intervals without modifying state revision.
- Implemented client state coalescing in `updateAuthoritativeStateRevisionIfNeeded()` to avoid sending redundant WebSocket packets when state is unchanged.
- Updated `dev/mock-server.mjs` and `www/telemetry.js` to match identical protocol semantics (per-connection sequence tracking, handshake requirement, clock validity, deep slice equality checks).
- Verification: `pio run -e esp32cam` succeeded with 19.8% RAM (64,740 bytes) and 73.1% Flash (1,437,301 bytes). All 45 test files and 411 tests passed in `npm test`.

## 2026-07-19 - Recovery import order and in-place repairs

- SD evidence showed the rebooted firmware retained a valid production checkpoint at acknowledged
  line 140. The later Home All and work-zero restore requests reached firmware, but Production
  Resume never did.
- Fixed a circular lock: recovery import must save the interrupted run into its matching job JSON
  before acknowledging the checkpoint, while firmware previously locked that JSON. During idle
  review only that exact `.job.json` is now writable; the interrupted G-code and active run remain
  protected.
- Recovery import now preserves the checkpoint's real `STOPPED`/`ERROR` state instead of forcing
  `PAUSED`, which the recovery planner correctly treats as an active, non-recoverable state.
- Home All and interrupted work-zero restoration now appear as an ordered action card directly
  beside their blocker. Success, cancellation, import failure, and restore failure are visible
  there rather than only in the collapsed technical log.
- Corrected the Recovery HTML nesting so guarded Production Resume is no longer inside the
  collapsed motion-only panel. A 412 x 915 browser check measured a 386 px action card and 342 px
  restore button with no horizontal overflow.
- Verification: focused recovery/lock tests pass 28 tests; full suite passes 42 files / 350 tests.
  ESP32-CAM build succeeds at 19.6% RAM (64,348 bytes) and 72.0% flash (1,414,885 bytes).
- Deployed `firmware.bin`, `preview.js`, `preview.html`, and `preview.css` to SD drive `E:`. All
  four source/SD SHA-256 comparisons match; final firmware SHA-256 is
  `E36A7F5718344453600470FDEF2E6BFBEB6C35E45AAF8E6D73CE681377646A93`.

## 2026-07-18 - Aircut animation follows its one-pass stream

- Found that Aircut motion telemetry carried the correct generated-stream command sequence, but
  the browser resolved those sequence numbers against the original production segments. On jobs
  with repeated step-downs this made the marker appear to perform normal multi-depth cutting.
- Test-motion startup now parses the exact generated commands sent to firmware and retains those
  segments for the active Aircut/tool-less stream. Live telemetry and the fallback marker both
  select that stream-specific model; production Cut and Production Resume keep their own models.
- Added a regression test and a manual repeated-stepdown Aircut check.
- Verification: focused Aircut/telemetry tests pass 17 tests; full suite passes 42 files / 348
  tests.
- Deployed `www/preview.js` to `E:\www\preview.js`; source and SD SHA-256 both equal
  `28D9CB4858A9C02BF90A76097317EEDDAE55449CA41D332CAB007343EBAD01E5`.

## 2026-07-18 - Actionable BLOCKED state and planner-aware ACK carry

- SD evidence separated two failures: Aircut timed out on a short arc queued behind a 13.9-second
  move, while production Cut was rejected because the saved `activeRun` omitted `sizeBytes` and
  therefore did not match the browser's 9529-byte execution identity.
- ACK hard deadlines now carry the preceding acknowledged motion duration as Marlin planner wait
  allowance into the next command. `M400` clears the allowance, and status/job logs expose
  `plannerWaitAllowanceMs` / `plannerWaitMs` for future diagnosis.
- Production start now writes the measured active-run byte size into `job.activeRun` before saving
  authorization. Matching legacy Box/Aircut decisions with a missing size are backfilled too, so a
  completed physical check is not repeated solely because old metadata omitted the byte count.
- Removed the firmware's obsolete hidden `arm` requirement. Current authorization is the visible
  final checklist plus hold-to-start, bound to active run, verification, work zero, homing session,
  generated validation, and a streamed on-SD fingerprint check.
- Replaced the opaque error presentation with a visible action-required card containing the exact
  firmware error, plain-language meaning, safe next step, and `Show Required Steps`. Rejected Cut
  opens this card automatically; the top status also exposes the first blocker in its label text.
- Verification: full suite passes 42 files / 347 tests. ESP32-CAM build succeeds at 19.6% RAM
  (64,348 bytes) and 72.0% flash (1,414,613 bytes).

## 2026-07-18 - Visible recovery decisions and production-only checkpoints

- Removed persistent active-job checkpoint creation from Aircut and other validated test-motion
  streams. They remain firmware-streamed and safety-controlled, but are not resumable production
  work and no longer create a recovery record after stop/error/reboot.
- Added a boot migration that clears legacy `validated_test_motion` checkpoints, including the old
  Aircut record currently blocking the machine.
- Connected pending production recovery to the guided workflow as a visible hard blocker with
  direct `Review Recovery Options` and deliberate discard actions. Legacy test records receive a
  specifically worded clear action instead of being presented as an interrupted cut.
- Hid the normal Home action while a recovery decision is pending. Resolving recovery now visibly
  reveals Home as the first normal step instead of presenting it out of order beside recovery.
- Confirmed and regression-tested the normal operator order: Home → Zero → Bounds/Aircut → Cut.
- Verification: full suite passes 42 files / 345 tests; ESP32-CAM build succeeds at 19.6% RAM
  (64,332 bytes) and 72.0% flash (1,414,921 bytes). A 412 x 915 mobile check confirms that pending
  recovery hides Home and exposes only the two recovery-resolution actions.

## 2026-07-18 - Distinguish operator locks from file locks

- Fixed the global browser fetch monitor so HTTP 423 opens the operator PIN panel only when the
  response contains the firmware's operator-lock state (`readOnly` and `configured`).
- Active/interrupted job file locks still return 423 and remain enforced, but now reach the calling
  workflow as their real error instead of being mislabeled as an operator authentication problem.
- SD evidence identified the trigger: the interrupted aircut checkpoint locked
  `/jobs/generated/ex1.run.gc.aircut.gc`, and a new aircut tried to overwrite that same file.
- Replaced the full-width controller-owner row with a compact, absolutely positioned owner badge in
  the machine bar's upper-left corner. It remains clickable but no longer consumes a grid row or
  changes the height/layout of the safety controls.
- Verification: full suite passes 42 files / 343 tests; the 412 px mobile layout measures the badge
  at 17 px high and 1 px from the top-left without changing the machine-bar grid height.

## 2026-07-18 - Duration-aware Marlin motion ACK watchdog

- Replaced the fixed ten-second streamed-command hard limit with a motion estimator that follows
  modal G0/G1/G2/G3, G17/G18/G19, G20/G21, G90/G91, axis targets, feed, and live M220 override.
- Linear distance and native IJK/R arc length now produce an expected physical duration. Known
  motion receives a hard ACK limit of three times the estimate plus five seconds (10-second floor,
  30-minute ceiling); unknown or machine-coordinate motion receives a conservative three minutes.
- A command that has not produced any response may wait for its duration-aware hard limit. Once
  Marlin reports `busy:`, the existing five-second liveness rule remains active, so a stalled
  transport is still detected promptly. Uncertain motion is never resent and timeout still sends M5.
- Applied the same policy to normal streams and priority sequences. M114 resynchronizes predicted
  coordinates, and job status/logs expose estimate, inactivity timeout, and hard deadline evidence.
- Verification: full suite passes 42 files / 343 tests; PlatformIO ESP32-CAM build succeeds at
  19.6% RAM and 72.0% flash.

## 2026-07-18 - Persistent SD boot, network, and HTTP diagnostics

- Added `/logs/system.log` with boot-session and millisecond prefixes. It records the reset reason,
  firmware build, successful SD mount details, checkpoint and SPIFFS boundaries, device identity,
  operator configuration state, WiFi/AP/STA addresses, mDNS result, HTTP/telemetry startup, BLE
  completion, and scheduled reboot execution.
- Routed all registered HTTP handlers and SD-served fallback paths through request logging. Entries
  include only method, URI, and remote IP; secrets, cookies, bodies, PINs, and passwords are never
  recorded. Immediate identical polling requests are coalesced for five seconds.
- Bounded the active log to 128 KiB with one `/logs/system.previous.log` rotation to avoid unlimited
  growth. UART0 remains exclusively assigned to Marlin.
- Added focused coverage and updated route-contract tests to recognize the shared logged wrapper.
- Verification: full suite passes 42 files / 342 tests; PlatformIO ESP32-CAM build succeeds at
  19.6% RAM and 71.6% flash.

## 2026-07-18 - Remembered controller and lazy viewer identification

- Made the HttpOnly controller cookie persistent for one year and retained the last controller
  token after its renewable 45-second lease becomes idle. The same browser can renew its lease on
  its next authorized action without entering the PIN again.
- Preserved single-controller takeover behavior: once the idle lease is claimed by another browser,
  the old token no longer matches and cannot regain control without the PIN.
- Kept the operator panel closed during initial read-only viewing, heartbeat/network failures, and
  explicit release. Machine-control interaction or a rejected mutating request opens it on demand;
  status, files, telemetry, and preview viewing remain passive.
- Updated the development mock and added focused firmware/mock coverage for persistent cookies,
  expired-lease recognition, automatic renewal, and takeover-safe status behavior.
- Verification: full suite passes 41 files / 339 tests; PlatformIO ESP32-CAM build succeeds at
  19.6% RAM and 71.3% flash.

## 2026-07-16 - Configurable 2D/3D thumbnail view

- Added an Appearance setting for choosing 2D top-view or fixed orthographic 3D thumbnail PNGs;
  2D remains the default and the browser preference is stored locally.
- Applied the choice to thumbnail generation on the main upload surface, SD Files upload surface,
  and first-preview fallback without changing streaming job execution or loading behavior.
- Extended the shared canvas renderer to project X/Y/Z geometry for 3D thumbnails while preserving
  the existing 2D output when no option is supplied.
- Existing stored thumbnail PNGs are intentionally not rewritten merely by changing the setting;
  the selected mode applies the next time a thumbnail is generated.
- Verification passes the full suite: 41 files / 337 tests and `git diff --check`.

## 2026-07-16 - Active and interrupted job file locks

- Added firmware-owned path locks for the currently streamed G-code/Production Resume file, its job
  JSON, and the bound original active run. The same artifacts remain locked while interrupted-job
  evidence is waiting for review.
- Upload overwrite, delete, and rename now return HTTP 423 for locked artifacts. Renaming or deleting
  a directory containing a locked artifact is also rejected, while unrelated SD files remain fully
  manageable during a job.
- Production Resume records its original active-run path in the checkpoint, so both the temporary
  recovery stream and the source/generated provenance file remain protected across restart.
- Fixed upload-abort cleanup to remove a target only if this request actually opened it; rejecting or
  aborting an upload can no longer delete a pre-existing active file.
- DEV MOCK mirrors the same selective locking and regression coverage verifies unchanged file content
  after a rejected overwrite.
- Verification passed: 38 test files / 325 tests, `git diff --check`, and the ESP32-CAM PlatformIO
  build (RAM 19.6%, flash 70.6%).

## 2026-07-16 - Firmware-owned exact active-run identity

- Replaced normal job and Production Resume job-JSON token searches with ArduinoJson filtered
  deserialization, so field scope and object ownership are parsed instead of inferred from text.
- Active source/generated runs now carry an explicit byte size. Firmware requires the request,
  `activeRun`, one-time start authorization, arm record, and physical-verification record to agree on
  mode, exact path, size, and fingerprint before any start preamble or movement can begin.
- Work-zero ID plus homing epoch/session are also bound into the one-time authorization and compared
  with both job metadata and the current firmware-owned machine frame.
- Firmware streams the selected file through SHA-256 verification when Web Crypto supplied a SHA;
  the offline fallback uses byte-based size + FNV-1a. A same-size modified file is rejected.
- Production Resume now hashes and sizes its generated Phase 2 stream separately, stores that
  identity in the authorization, and firmware validates the parsed recovery event, authorization,
  request, and actual file before streaming.
- The whole-file fingerprint inherently covers all T/M6 commands and tool comments, so a changed
  tool plan also invalidates arm/start authorization without requiring the full G-code in RAM.
- DEV MOCK mirrors the strict normal-start and Production Resume identity checks.
- Verification passed: 37 test files / 321 tests, JavaScript syntax checks, `git diff --check`, and
  the ESP32-CAM PlatformIO build (RAM 19.6%, flash 70.5%).

## 2026-07-16 - Persistent interrupted-job checkpoint and browser-independent recovery

- Added a small streaming-safe SD checkpoint at `/logs/active-job.json` plus an NVS active-job
  marker. The marker and initial checkpoint are written before normal cut, test-motion, or Production
  Resume movement can begin.
- While a stream is active, firmware checkpoints state transitions and acknowledged progress at most
  every 2 seconds or 4096 acknowledged bytes. The record includes run identity, acknowledged
  byte/line, work-zero and homing identity, tool-change state, feed override, and last known positions.
- Clean completion removes the checkpoint. Stop, runner error, communication loss, brownout, or
  reboot preserve an interrupted record for later review without globally blocking new motion.
- Boot with an active marker sends immediate `M5`, invalidates the coordinate frame, requires Home
  All before position can be trusted again, and deliberately does not seek or resume the file.
- Added recovery checkpoint GET/acknowledge endpoints and matching DEV MOCK behavior. Preview imports
  a checkpoint belonging to the open job into durable run history before acknowledging firmware;
  records for another job are imported into their recorded Job JSON. Machine Bar shows
  `RECOVERY AVAILABLE` while review is pending without disabling homing/setup or Start.
- Added focused firmware, UI, and mock API regression coverage.
- Verification passed: 36 test files / 317 tests, JavaScript syntax checks, `git diff --check`, and
  the ESP32-CAM PlatformIO build (RAM 19.6%, flash 69.3%).

## 2026-07-16 - Job runner ACK watchdog and communication-loss fail-safe

- Confirmed that the local runner already had a basic 5-second acknowledgement timeout, then
  hardened it with command-specific 180-second windows for `M400`, homing/probing, and M6 sequences.
- Every streamed and priority command now has both a liveness deadline and an absolute hard deadline,
  so repeated `busy:` messages cannot keep a command alive forever.
- An ACK timeout now attempts an immediate queue-bypassing `M5`, closes the stream, and reports
  `ERROR` with `errorCode: COMMUNICATION_LOST`. Automatic `M410` remains deliberately disabled
  because its abrupt position-losing stop requires a separate operator safety policy.
- Status now distinguishes bytes/lines merely read or sent from the last acknowledged stream boundary,
  and progress is based on the acknowledged offset. Communication-loss evidence freezes the failed
  command, sent/acknowledged offsets, and last trusted work/machine positions and records them in the
  SD job log.
- Unsupported Marlin `Resend:` and explicit command rejection now also attempt immediate `M5` and
  expose stable error codes without replaying uncertain motion.
- DEV MOCK mirrors the new acknowledged-offset/status contract, while Preview and Machine Bar show a
  distinct communication-loss state and the last confirmed offset.
- Verification passed: 34 test files / 309 tests, JavaScript syntax checks, `git diff --check`, and
  the ESP32-CAM PlatformIO build (RAM 19.5%, flash 68.8%).

## 2026-07-14 - Firmware-owned manual M6 tool changes

- The streaming job runner now consumes standalone `Tn` selections and exact `M6` commands itself;
  neither is forwarded blindly to Marlin.
- At `M6`, firmware first queues `M400`, then `M5`, so already planned cutting motion finishes before
  the spindle is stopped. The default unconfigured path pauses in place and alerts the operator.
- Optional configured parking captures the current work position with `M114`, lifts and parks with
  absolute `G53` moves, then returns through Safe machine Z to the captured work XYZ only after the
  new tool, Z zero, and explicit operator confirmation are complete.
- Generic Resume is blocked while a tool change is pending. A dedicated confirmed endpoint owns the
  transition back to streaming, so closing the browser does not lose the M6 state.
- Manual `G92 Z0` and configured `G38.2` touch-plate probing are allowed in the controlled M6 stop;
  probing restores `G90` on failure and only marks Z complete after zero/retract succeeds.
- Toolpath parsing now collects tool number, nearby G-code tool comment, diameter, M6 line/command,
  and following spindle `S` value without affecting streaming execution or loading the file in RAM.
- Preview shows a prominent tool-change operator panel and only enables Continue after Z zero.
  Configured touch-plate Z zero is also available in normal Preview and Machine Bar zero controls.
- Browser QA caught and fixed an initial-render race: the M6 panel now rerenders when the active
  ToolpathModel finishes loading, so comment, diameter, and RPM replace the early command fallback.
- Browser QA also removed the misleading global Resume action: Machine Bar shows a disabled
  `Tool Change` state while M6 is pending and leaves continuation to the guarded M6 panel.
- The compact Machine Bar regression test now covers that guarded M6 label/disable state as well as
  the normal Pause/Resume action row.
- DEV MOCK mirrors M6 pause/park/return, manual/touch-plate Z completion, and confirmed continuation.
- Verification: the full suite passed (34 files, 306 tests), JavaScript syntax checks and
  `git diff --check` passed, and the ESP32-CAM PlatformIO build succeeded. Browser QA completed a
  parked T2 change through touch-plate probing and confirmed return/resume with no console errors;
  `T2`/`M6` stayed host-owned while `G38.2` reached the mock Marlin.

## 2026-07-14 - Tool-change and touch-plate device settings

- Added device-owned tool-change settings for the upcoming manual `M6` workflow: pause in place or
  park at configured absolute machine X/Y/Safe-Z coordinates.
- Added the default post-change Z-zero choice and shared touch-plate configuration: enabled state,
  plate thickness, maximum probe distance, probe feed, and retract distance.
- Kept the unconfigured behavior deliberately conservative: pause at `M6`, require a manual Z-zero,
  and do not expose touch-plate probing until it is explicitly enabled.
- Firmware persists the settings in NVS and exposes guarded `GET`/`PUT`
  `/api/tool-change/settings` endpoints; settings cannot change while motion is active.
- Settings UI and the DEV MOCK server use the same normalized contract.
- Verification: `npm.cmd test -- --run test/ui/tool-change-settings.test.mjs test/mock/mock-server.test.mjs`
  passed (16 tests).

## 2026-07-10 - Files card view and hold actions

- Refactored the dedicated Files page so previewable G-code entries no longer expose duplicate
  `Select`, `Open Job`, and `Full Preview` actions that all opened the same full preview page.
- Files and folders now render as thumbnail-first cards instead of compact rows, giving stored job
  preview images much more visual weight in the grid.
- A normal tap/click on a G-code card now opens that file as the current job in Preview; folders
  still open directly on tap.
- Added hold/right-click card actions for maintenance operations instead: file cards now expose
  download, rename, and delete from the expanded action area, while folders expose rename/delete.
- Added a focused UI regression test to lock the direct-open behavior, long-press/context-menu
  action handling, and icon-card layout expectations.
- Verification: `npm test -- test/ui/files-view.test.mjs` passed.

## 2026-07-10 - Setup AP retained during station mode

- Investigated a phone-to-ESP32 connectivity regression after recent firmware changes.
- Root cause was in WiFi startup: once saved STA credentials connected, firmware switched to a
  station-only path and the phone could no longer rely on the ESP32 setup AP staying available.
- Updated WiFi startup so the setup AP remains active in `ap+sta` mode while the saved STA link is
  connected; failed STA joins still settle back to plain setup AP.
- Added a small `/wifi` diagnostics improvement so the page shows the setup AP name/IP when both
  radio paths are active.
- Verification: `C:\Users\marko\.platformio\penv\Scripts\platformio.exe run --environment esp32cam` passed.

## 2026-07-10 - Pause/resume drain timeout fix

- Investigated the live SD `E:\logs\job.log` after a failed resume attempt.
- Root cause: some pauses only reached `pause requested` and never logged `paused:` before the user
  tried Resume. One captured run also showed `priority timeout` during pause handling.
- Firmware pause handling was using the normal 5 s Marlin acknowledgement timeout even for the
  pause-drain `M400`, which can legitimately take longer while Marlin finishes the in-flight move.
- Added a dedicated 30 s timeout for priority `M400` while the runner is in `PAUSING`; normal job
  and other priority acknowledgements still use the 5 s guard.
- Added focused firmware transport regression coverage to lock the longer pause-drain timeout path.
- Verification: `npm test -- test/firmware/marlin-transport.test.mjs` passed and
  `C:\Users\marko\.platformio\penv\Scripts\pio.exe run` passed.

## 2026-07-10 - Preview preflight listener null-guard

- Fixed a preview startup crash in `www/preview.js` caused by unconditional event binding on the
  Preflight buttons.
- Root cause: `saveJobPreflightButton.addEventListener(...)` and
  `refreshPreflightButton.addEventListener(...)` assumed those nodes always existed, while the rest
  of the preview page already treated optional UI sections as nullable.
- Updated both bindings to use optional chaining so `preview.js` does not throw during startup when
  markup and script drift or a partial preview surface is rendered.
- Verification: `npm test -- test/ui/machine-controls.test.mjs` passed.

## 2026-07-08 - Preview file-open regression fixed

- Reproduced the failure in the mock browser by opening a G-code file from the Files dashboard.
- Root cause was a preview startup crash in `www/preview.js`: the Dry Run `stop-m5` button had been
  removed from `www/preview.html`, but startup still called `stopM5Button.addEventListener(...)`
  unconditionally.
- Restored the Dry Run secondary `Stop spindle/laser M5` button and made the event binding tolerant
  with optional chaining so preview boot does not crash if the control is absent.
- Browser verification: opening `ex1.gc` now reaches `preview.html` successfully and renders the
  toolpath instead of failing on a startup `TypeError`.
- Verification: `npm test -- test/ui/machine-controls.test.mjs` passed.

## 2026-07-08 - Route-first app startup and lazy Files loading

- Fixed main app startup so it resolves the requested hash route before loading any heavy view data.
- Removed unconditional startup calls that loaded current-job metadata and `/gcode` file listings even
  when opening non-files routes like Settings.
- Added route-scoped lazy loaders for Files, Job, and Logs so only the active view fetches its own
  data.
- Settings now opens directly without mounting Files first or triggering `/api/files`, `/api/sd/status`,
  or job JSON fetches.
- Added startup guards so the initial route does not double-fetch Files or Job data during boot.
- Follow-up: removed unconditional `health` / `job` telemetry boot requests that still made Settings
  startup feel half-complete. Telemetry is now demand-driven for those channels too.
- App dashboard now demands `health` only for Settings and `job` only for the Job route.
- Machine Bar now demands `health` / `job` only while the drawer is open. Preview explicitly opts in
  to `health` / `job` telemetry because it needs live run and recovery state.
- Broader entrypoint audit covered `index.html`/`app.js`, `files.html`/`files.js`,
  `preview.html`/`preview.js`, `machine-bar.js`, `telemetry.js`, and `skin-init.js`.
- `files.js` remains route-scoped by design: it loads file list and SD status only for the dedicated
  Files page and does not opt into unrelated telemetry demand.
- `skin-init.js` remains safe at startup; it initializes local UI skin state only and performs no ESP32
  fetches.
- `telemetry.js` now also gates WebSocket startup behind real socket-capable demand (`job`, `jog`, or
  `log`) instead of opening a socket on pages that do not need one.
- Added navigation regression tests to lock the `resolveInitialView -> showView -> ensureViewData`
  startup order and prevent Files-first boot behavior from returning.
- Verification: `npm test -- test/ui/navigation.test.mjs test/ui/telemetry.test.mjs test/ui/device-settings.test.mjs`
  passed; broader telemetry/navigation audit validation also passed, and full `npm test` passed with
  28 files / 263 tests.

## 2026-07-08 - Minimal Dry Run operator control

- Refactored the Preview Dry Run panel into one operator-focused control path.
- Removed visible generate/copy command actions, raw command preview, run-file/run-mode details,
  detailed bounds, and command counts from the normal Dry Run UI.
- Added one Aircut toggle, one primary send button with mode-driven label, and kept `M5` as a
  smaller secondary safety action.
- Bounding-box commands still auto-generate from the active run and now refresh from Safe Z,
  margin, placement, and run-file updates without requiring a separate Generate step.
- Aircut generation remains internal, auto-regenerates only when Aircut mode is selected, and the
  operator UI states that spindle/laser start commands are suppressed.
- Added a focused UI regression in `test/ui/machine-controls.test.mjs` to lock the minimal Dry Run
  surface and dynamic send behavior.
- Verification: `npm test -- test/ui/machine-controls.test.mjs` passed with 22 tests.

## 2026-07-05 - WebSocket task isolation and persistent Layers

- Live Marlin log showed the prior job did eventually complete, but a sleeping phone produced
  repeated 15-20 second gaps between commands. Synchronous WebSocket delivery shared the execution
  loop and could delay the next SD/UART line until TCP timeout.
- Added a bounded 12-item FreeRTOS telemetry queue. Execution uses `xQueueSend(..., 0)` and never
  calls WebSocket send/loop functions.
- Added a dedicated low-priority core-0 task that owns the WebSocket server, delta delivery, client
  subscriptions, and reconnect snapshots.
- Queue saturation drops UI deltas; latest job/jog/position state is cached for reconnect.
- Browser keeps WebSocket as the primary job/motion channel and activates HTTP polling after socket
  disconnect. Critical HTTP responses update shared telemetry state immediately.
- Layers are stored under `lowrider.workbench.layers.v1` in localStorage; unknown/non-boolean keys
  are ignored and storage failure leaves page-local behavior intact.
- Firmware version: `0.6.0-stream-isolation`.
- Verification: 24 test files / 223 tests passed; PlatformIO build succeeded at 15.8% RAM and 52.0%
  flash.

## 2026-07-05 - Job status JSON / false OFFLINE fix

- Live diagnostics confirmed the device and WebSocket port were reachable, but `/api/job/status`
  contained malformed JSON: `"machinePosition":null","uptimeMs"`.
- Removed the extra quote and added a source-level regression check around the position/uptime
  boundary in `jobStatusJson()`.
- Firmware version is `0.5.9-json-status`.
- Verification: 24 test files / 221 tests passed; PlatformIO build succeeded at 15.8% RAM and 52.0%
  flash.

## 2026-07-05 - Live cutting position restored

- Confirmed the live SD UI already subscribed to motion telemetry, but the Preview adapter removed
  `commandNumber` from parsed segments. Every motion event therefore failed segment lookup and no
  predictive tool animation started.
- Preserved `commandNumber` in `/www/lib/preview-data-adapter.js`.
- Preserved segment `length` and `feed`; without them every animation was clamped to the 40 ms
  minimum and appeared as a point-to-point jump.
- Restored `M154 S1` as an acknowledged asynchronous Start-preamble command when a telemetry client
  is connected, then made active-job autoreport independent of WebSocket availability.
- Stream processing now parses complete M154 position lines immediately, including while Marlin is
  still processing a long G2/G3 command and before its final `ok`.
- HTTP job-status fallback now carries work/machine position and synthesizes the same deduplicated
  motion animation event when the phone's WebSocket is unavailable.
- Firmware version is `0.5.8-live-position`.
- Verification: 24 test files / 220 tests passed; PlatformIO build succeeded at 15.8% RAM and 52.0%
  flash.

## 2026-07-05 - Async Start transport fix

- Inspected the live pendant at `192.168.8.147`: firmware, active generated run, arm fingerprint,
  homing epoch, and work-zero machine reference were valid.
- The prior Aircut had ended in `ERROR` after an `M5` priority timeout; normal Start then reported
  `Failed to fetch` because its full Marlin preamble ran synchronously inside the HTTP handler.
- Normal Start now returns `PREPARING` immediately and executes its ten-command preamble through
  the acknowledged priority queue.
- File streaming begins only after the whole preamble succeeds. Preamble error/timeout closes the
  file and sets `ERROR`.
- Browser critical actions now reconcile a lost HTTP reply against `/api/job/status` before
  declaring failure.
- Verification complete: 24 test files / 218 tests passed; PlatformIO build succeeded at 15.8%
  RAM and 52.0% flash.

## 2026-07-05 - Coordinate frame firmware ownership

- Added firmware-owned machine frame state with separate machine, work, and work-zero-machine coordinates.
- Added `GET /api/machine/frame`, `POST /api/machine/home`, and `POST /api/work-zero/set`.
- Full homing now creates a new homing epoch and a deterministic temporary baseline frame.
- Job Start no longer sends `G92`; it rejects missing or mismatched homing/work-zero frame identity.
- Position telemetry remains backward-compatible at top-level X/Y/Z and now includes both coordinate frames.
- UI wiring, mock parity, compile verification, and device tests remain.

## 2026-07-05 - Unified homing and work-zero UI

- Machine Bar homing now calls firmware `/api/machine/home`; it no longer sends browser-owned `G28` sequences.
- Machine Bar and Preview work-zero actions now share `/api/work-zero/set`.
- Preview saves the returned machine-space zero and homing epoch immediately into job JSON/history.
- Arm/Preflight require the saved zero to match the live firmware frame.
- Start requests include work-zero ID, homing epoch, and machine-space XYZ; the visible start-mode selector was removed.
- Status bar now distinguishes machine (`M`) and work (`W`) coordinates.

## 2026-07-05 - Coordinate frame refactor verified

- Added firmware-owned Z-zero transaction so tool changes cannot desynchronize the machine frame.
- Canvas anchors job geometry and WORK ZERO to saved machine-space coordinates; the tool marker uses
  machine coordinates while predicted job/jog motion remains work-relative.
- DEV MOCK covers Home All -> move to X100/Y500 -> Set Work Zero -> Start and verifies Start sends no G92.
- Verification: 24 Vitest files / 217 tests; PlatformIO build succeeds at 15.8% RAM and 51.9% flash.
- Firmware version is `0.5.6-coordinate-frame`.

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
  - falls back to `G-code-CNC-Setup` AP with password `12345678`
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
  - validates safe Z, work zero, G-code CNC X/Y bounds, large command counts, and Preflight failures before sending
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
  - validates work zero, safe Z, and G-code CNC X/Y limits before enabling send
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
  - a fitted detail no longer shows the misleading `Generated bounds exceed configured G-code CNC work area`
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
- 2026-06-30: Started motion-only interrupted-job recovery on branch `codex/motion-only-recovery`. Added pure `www/lib/job-recovery.js` planner and command generator. It validates activeRun path/fingerprint, zero identities, position trust, Safe Z, acknowledged progress, and XYZ limits; selects only a previous non-cut clearance point; splits recovery overlay geometry; and generates only M5/G21/G90/G54/Safe-Z/XY/M400 commands. ToolpathModel segments now include firmware-compatible cleaned `commandNumber` alongside raw source `lineNumber`. Added focused planner, visual, limits, trust, and forbidden-command tests.
- 2026-06-30: Corrected the out-of-bounds test fixture to exclude the actual X0 recovery candidate (`xMin: 1`); no planner behavior changed.
- 2026-06-30: Added `recoveryHistory` metadata and `appendMotionOnlyRecoveryEvent()`. Motion tests record run ID, activeRun identity, Safe-Z resume point, result, and command summary without changing the interrupted run state or creating cutting-resume state. Added regression coverage.
- 2026-06-30: Integrated Motion-only Recovery into the Preview readiness drawer. Added session-only position trust (successful homing or explicit confirmation), firmware reboot invalidation, active-job blocking, Recovery overlay/fit controls, completed/remaining path styling, interruption/resume markers, dashed Safe-Z travel, sequential `/api/cmd` movement, and additive recoveryHistory recording. No firmware or cutting-stream changes.
- 2026-06-30: Verified Motion-only Recovery end to end against the local DEV MOCK server with an interrupted fixture. The UI initially blocked movement while position was untrusted, then sent only `M5`, `G21`, `G90`, `G54`, `G0 Z15`, `G0 X10 Y10`, and `M400` after explicit trust and confirmation. The completed event persisted in `recoveryHistory`; no cutting command, negative Z move, stream restart, or browser console error occurred.
- 2026-07-01: Audited Recovery V0 against the complete task contract. Planner now considers only the newest run, applies normal generated-run validation with no source fallback, reports run mode/path and sent/acknowledged progress, rejects Safe Z outside configured Z limits, and records normalized `completed` recovery events with activeRun mode and reason. Recovery UI now shows interrupted/current path comparison and the exact motion-only command summary. Focused recovery/history suite passes 25 tests.
- 2026-07-01: Final Recovery V0 verification passes all 19 test files / 160 tests, every requested `node --check`, and `git diff --check`. `src/main.cpp` is unchanged, so this feature requires SD `/www` updates only and no firmware flash.
- 2026-07-01: Merge-readiness review tightened activeRun proof and history semantics. A missing interrupted-run path or detected run-mode mismatch now blocks recovery; user-initiated blocked motion attempts record `blocked` without modifying the original run. Renamed misleading `Cancel / Start Over` to `Hide Recovery`. No movement sequence or firmware behavior changed.
- 2026-07-01: Merge-readiness verification complete: all 19 test files / 160 tests pass, every requested JavaScript syntax check passes, `git diff --check` is clean, and `src/main.cpp` remains unchanged. PlatformIO was intentionally not run.
- 2026-07-02: Added shared browser motion settings in `www/lib/motion-settings.js`. Settings now owns automatic XY travel speed (default 50 mm/s), joystick XY max reads/writes the same value, and an explicit M503 action parses Marlin M203 X/Y/Z maxima. Detected X/Y limits can narrow the selectable 10–100 mm/s range; failure leaves the conservative default range intact. No Marlin movement behavior changed in this step.
- 2026-07-02: Applied explicit feedrates to browser-generated automatic moves. Bounding box and aircut Z moves use conservative F400, their XY rapid moves use shared travel feed, and linear aircut moves preserve file F values. Motion-only recovery now emits separate Z and XY feedrates, and work-zero requests carry the selected XY travel feed. No cutting feed is rewritten.
- 2026-07-02: Firmware `0.5.1-travel-speed` now accepts a clamped 600–6000 mm/min travel feed for job start and Go To Work Zero. Job start keeps Safe-Z lift at F400, waits with M400, then sends a no-axis `G0 F<travelFeed>` so the first file G0 no longer inherits the slow Z feed; a file-provided F still overrides it. Job status reports the active travel feed.
- 2026-07-02: Added focused travel-setting, generated-command, recovery-order, firmware-preamble, and work-zero tests. DEV MOCK now returns configurable M203 maxima from M503 so the Settings detection flow can be tested without hardware. Focused suite and JavaScript syntax checks pass.
- 2026-07-02: Final travel-speed verification passes 20 test files / 166 tests, changed JavaScript syntax checks, and `git diff --check`. PlatformIO builds firmware `0.5.1-travel-speed` successfully at 50,884 bytes RAM (15.5%) and 998,169 bytes flash (50.8%).
- 2026-07-02: Added pure Toolless Resume planning and command generation to `www/lib/job-recovery.js`. It reuses Recovery V0 identity/trust checks, validates full remaining X/Y/Z path limits and non-rapid feeds, blocks unsafe coordinate commands, safely repositions at Safe Z, then emits controlled absolute G0/G1 commands from ToolpathModel. Arcs use existing line-segment approximation; raw M-codes are never streamed.
- 2026-07-02: Added additive `toolless-resume-test` recovery history lifecycle helpers. Events record activeRun identity, resume line/point, Safe Z, minimum Z, command counts, timestamps, and state without changing the original interrupted run or marking production resume.
- 2026-07-02: Added the Toolless Resume Test UI and browser execution loop. The Recovery drawer shows active run, resume line, Safe-Z reposition, first Z descent, min Z, estimate, blockers, warnings, and command count. A no-cutter checkbox plus one explicit confirmation gates execution. Pause/Stop/M5 cancel further browser commands; Pause/Stop also use existing `/api/jog/stop` M410+M5 and clear position trust. Backgrounding the page cancels the test. No new firmware behavior was added.
- 2026-07-02: Added dedicated Toolless Resume tests and documentation. The focused 33-test recovery/history suite passes. Documentation now distinguishes Motion-only Recovery, Toolless Resume with real Z and no cutter, and future production cutting resume.
- 2026-07-02: Final Toolless Resume verification passes 21 test files / 174 tests, all requested syntax checks, and `git diff --check`. DEV MOCK browser inspection showed an available plan with resume command 7, first descent Z15 to Z-2, min Z -2, 14 commands, no console errors, and a button that remains disabled until explicit no-cutter confirmation. No Toolless movement was executed during browser verification.
- 2026-07-03: Added pure Guarded Production Resume planning. Z-zero changes are now warnings for Safe-Z/Toolless motion and require two additional Production acknowledgements instead of a hard block; work-zero mismatch remains blocking. Production commands are split into Safe-Z/XY Phase 1 and controlled remaining-path Phase 2, which stays unavailable until Phase 1 and manual-router checkpoint are complete. Forbidden commands remain rejected.
- 2026-07-03: Added separate `production-resume` history lifecycle helpers with checklist snapshot, activeRun identity, previous/current Z-zero IDs, acknowledgement state, Phase-1 timestamp, command counts, and terminal state. Original interrupted run is not mutated.
- 2026-07-03: Added the guarded two-phase Production Resume UI and corrected recovery tests so Motion-only, Toolless, and Production labels are verified within their own tiers. Run History now explains that recovery attempts are separate events instead of claiming resume is unavailable.
- 2026-07-03: Focused recovery tests exposed and corrected one remaining terminology mismatch: the Safe-Z-only action is now labelled `Move Axes to Resume Point`, clearly separate from Toolless and Production resume actions.
- 2026-07-03: Documented all three recovery tiers, Production Resume's two phases/manual-router checkpoint, unchanged-work-zero hard block, acknowledgement-gated Z-zero replacement, forbidden-command invariants, separate history event, and remaining browser-owned/power-loss limitations.
- 2026-07-03: Final Guarded Production Resume verification passes 22 test files / 182 tests, all requested syntax checks, and `git diff --check`. DEV MOCK shows Motion-only, Toolless, and GUARDED Production tiers, eight total checklist controls (six base plus two conditional Z-change acknowledgements), disabled Phase 1/hold actions while blocked, and no console warnings/errors. No movement was executed during browser verification.
- 2026-07-03: Removed stale README/current-task claims that all job resume is unimplemented. They now distinguish the guarded browser-owned foundation from future firmware-owned, automatic, and power-loss recovery.
- 2026-07-03: Stabilized the floating joystick layout: its status now occupies one fixed-height ellipsis row, so long commands/errors cannot wrap and push the joystick upward. The full status remains available as a title tooltip.
- 2026-07-03: Diagnosed Aircut/Toolless stutter: both flatten arcs to short G1 segments and then perform one complete HTTP `/api/cmd` round trip per segment. Chosen fix is a dedicated validated test-motion file mode using the existing firmware `ok`-paced SD streamer, with native G2/G3 preservation and existing priority Pause/Stop/M5 controls.
- 2026-07-03: Added firmware `0.5.2-motion-stream` foundation with `POST /api/test-motion/start`. It accepts only `/jobs/generated` files in `aircut` or `toolless` mode, validates the complete file before motion, revalidates every streamed command, enforces size/command limits, requires M5 first and M400 last, and only permits G21/G90/G54/M5/M400 plus G0/G1/G2/G3 motion words. Aircut additionally rejects any Z differing from configured Safe Z.
- 2026-07-03: Aircut and Toolless command generation now preserves valid XY arcs as single native Marlin G2/G3 commands with I/J offsets and feed, instead of expanding each arc into 2-4 mm G1 chords. Aircut now uses the shared ToolpathModel and includes explicit G54.
- 2026-07-03: Aircut and Toolless UI execution now uploads a generated motion file once and starts the firmware-owned stream through `/api/test-motion/start`. Progress comes from shared job telemetry instead of per-command HTTP. Critical Pause/Stop/M5 and page hiding request firmware job-stop; normal run history ignores `aircut`/`toolless` stream states.
- 2026-07-03: Added matching DEV MOCK test-motion validation/stream support so Aircut and Toolless can be exercised locally with the same path/mode/Safe-Z/allowlist rules before hardware flashing.
- 2026-07-03: Added regression coverage for native G2/G3 Toolless output, firmware test-motion allowlisting, M5-first/M400-last framing, Aircut Safe-Z enforcement, forbidden M3 rejection before motion, and DEV MOCK native-arc streaming.
- 2026-07-03: PlatformIO build passes for firmware `0.5.2-motion-stream`: RAM 15.5% (50,900 bytes), flash 51.1% (1,003,709 bytes). The OTA-ready binary is `.pio-build/esp32cam/firmware.bin`.
- 2026-07-03: Hardened test-motion words with numeric validation and forced an immediate shared job-status refresh after stream start, avoiding the idle 10-second HTTP fallback interval while retaining low-rate telemetry updates.
- 2026-07-03: Documented the validated test-motion API, allowlist and limits, native arc behavior, Aircut Safe-Z invariant, shared priority controls, streamMode telemetry, and hardware test procedure.
- 2026-07-03: Updated travel-speed regression expectations for the shared ToolpathModel/native-arc generator and firmware `0.5.2-motion-stream`; no travel or cutting feed policy changed.
- 2026-07-03: Added end-to-end mock HTTP coverage for multipart temporary-file upload, one `/api/test-motion/start` request, native G2 execution, telemetry status, and completion.
- 2026-07-03: Final verification passes 22 test files / 186 tests, all changed JavaScript syntax checks, `git diff --check`, and PlatformIO firmware build. Final firmware usage is 15.5% RAM and 51.1% flash. Real machine motion was not executed automatically.
- 2026-07-03: Added work-zero machine-reference helpers based on M114 step counts plus M503/M92 steps-per-mm. New zero-history entries can store the derived machine position; restore attempts are audited on the original zero entry so interrupted-run zero identity remains stable. Older entries with counts can be derived at restore time.
- 2026-07-03: Added firmware `0.5.3-zero-restore` endpoint `POST /api/work-zero/restore`. While idle, it validates saved machine XY/Safe-Z limits and sends M5, G21/G90, G53 Safe-Z, G53 XY, G54, G92 X0 Y0, and M114 with M400 barriers. It never changes Z zero or homes automatically.
- 2026-07-03: Added a dedicated Saved Work Zero block directly inside Recovery, with one `Restore Saved XY Work Zero` action and explicit text that homing is not automatic and Z zero remains unchanged.
- 2026-07-03: Wired the one-action restore workflow. Recovery resolves the interrupted run's exact zero ID, requires session position trust, reads current M503/M92, blocks configuration mismatch, derives machine XY from saved counts, shows one exact movement confirmation, calls firmware restore, audits the restore, and reactivates the same zero ID. Work-zero capture now stores machineReference when M92 is available.
- 2026-07-03: Tightened restore trust: partial X/Y/Z homing no longer qualifies for saved machine-coordinate restore. Only Home All or the explicit all-axes operator trust action sets `fullHoming`; firmware reboot/untrust clears it.
- 2026-07-03: Extended DEV MOCK with realistic M114 step counts, M503/M92 output, and `/api/work-zero/restore`, including explicit G53 permission only for this guarded restore sequence.
- 2026-07-03: Added tests for M92 parsing, counts-to-machine-coordinate conversion, machineReference creation, restore audit/zero-ID stability, firmware Safe-Z-before-XY ordering, no G28/G92 Z0, and end-to-end mock restore with unchanged Z zero.
- 2026-07-03: Zero History now shows saved machine XY when available and the number of successful restores; legacy count-only entries are identified as derived during restore.
- 2026-07-03: Documented the streamlined Home All -> Restore Saved XY -> review/re-touch Z -> Recovery workflow, machineReference schema, G53 endpoint exception, blockers, and no-cutter hardware test procedure.
## 2026-07-03 - Saved work-zero restore test cleanup

- Updated Recovery UI safety tests for the explicit full-homing trust signal.
- Scoped the existing Go To Work Zero firmware test to its own handler so the separate guarded restore endpoint does not affect its forbidden-command assertions.
- No production behavior changed in this cleanup step.
## 2026-07-03 - Saved work-zero restore verified

- Full Vitest suite passes: 22 test files, 190 tests.
- JavaScript syntax checks pass for the changed UI, history, settings, and mock-server modules.
- `git diff --check` passes; only existing Windows line-ending notices were reported.
- PlatformIO firmware build passes for `esp32cam`: 15.5% RAM and 51.3% flash.
- User flow is deliberately short: Home All, open Recovery, restore the saved XY work zero, review/re-touch Z zero, then continue the guarded recovery workflow.
## 2026-07-03 - Firmware-owned Production Resume Phase 2 foundation

- Added firmware `0.5.4-production-resume-stream` and guarded `POST /api/recovery/production/start`.
- Firmware validates the complete generated Phase 2 file before motion, then revalidates every streamed command while pacing against Marlin `ok` responses.
- Start requires matching saved Production Resume event, interrupted run, activeRun path/mode/fingerprint, completed Phase 1, and manual-router checkpoint metadata.
- Production Resume accepts only G21/G90/G54, bounded G0/G1/G2/G3 movement, M400, and safe numeric words; G28/G53/G92/M3/M4 remain rejected.
- Existing Pause, Stop, M5, feed override, and telemetry continue to use the shared firmware runner and priority controls.
## 2026-07-03 - Production Resume UI and mock integration

- Production Phase 2 now uploads one generated resume file and starts the guarded firmware endpoint instead of sending each cutting command through browser `/api/cmd` calls.
- The browser becomes a status monitor after start; Pause, Stop, and M5 still target the shared firmware priority controls.
- Production history stores the router-checkpoint timestamp and generated stream path, and terminal firmware status reconciles completed/stopped/error history after reconnect.
- DEV MOCK implements the same metadata, command allowlist, bounds, and firmware-stream behavior for safe browser testing.
## 2026-07-03 - Production Resume ownership documented

- Documented the guarded Production Resume endpoint, metadata proof, command allowlist, firmware-owned Phase 2, reconnect behavior, and remaining power-loss limitations.
- Updated safety testing to require a no-cutter WiFi-disconnect trial and to verify a single start request instead of per-line browser commands.
## 2026-07-03 - Production Resume regression cleanup

- Focused Production Resume, firmware transport, and mock HTTP tests pass: 3 files / 26 tests.
- Full regression found only one stale firmware-version assertion; updated it to `0.5.4-production-resume-stream` without changing behavior.
## 2026-07-03 - Production Resume long-job metadata hardening

- Added one-shot `productionResumeAuthorization` metadata before firmware start and clear it after terminal status.
- Firmware scans the complete job JSON for exact authorization tokens, avoiding false rejection when accumulated history exceeds the older 16 KiB snippet window.
- DEV MOCK and tests use the same authorization contract.
## 2026-07-03 - Firmware-owned Production Resume Phase 2 verified

- Full suite passes: 22 test files / 192 tests.
- Changed JavaScript and mock modules pass syntax checks; `git diff --check` passes with only existing Windows line-ending notices.
- PlatformIO builds firmware `0.5.4-production-resume-stream`: 15.5% RAM and 51.7% flash.
- Production Phase 2 is no longer browser-command-owned. After explicit hold and one guarded start request, ESP32 validates and streams the resume file independently of browser/WiFi continuity.
## 2026-07-04 - Streaming execution and preview-size rules

- Added two project rules to `AGENTS.md`: execution must stream without full-file RAM loading, while preview/transform limits must remain separate and visible.
- Added a browser-only soft warning at 2 MiB for transform memory and 4 MiB for preview parsing. The warning explicitly states that firmware execution remains SD-streamed and is not limited by preview size.
- No execution limit or firmware behavior changed in this step.
## 2026-07-04 - Streaming execution audit coverage

- Added regression tests for the two new project rules, bounded SD line streaming, and non-blocking browser size warnings.
- Documented memory ownership in architecture, protocol, safety testing, and README.
- Clarified that temporary Aircut/Toolless/Production Resume files retain their separate 2 MiB validation cap while still being read incrementally.
## 2026-07-04 - Streaming/preview rules verified

- Full suite passes: 23 test files / 195 tests.
- `www/preview.js` and the new streaming policy test pass syntax checks; `git diff --check` passes with only existing Windows line-ending notices.
- Firmware source was audited but not changed in this step, so PlatformIO was not rerun.
- Compliance result: normal jobs are fully SD-streamed; browser preview/transform uses full-file browser memory but now shows independent soft warnings without changing execution eligibility.
## 2026-07-04 - Workbench button cleanup

- Removed the duplicate topbar Tools button; the persistent left-edge Tools handle remains the single entry point to the same drawer.
- Standardized normal blue buttons to a 68% accent/transparent fill with a subtle accent border, matching the translucent active Checks tab.
- Kept danger, warning, armed, and other semantic state colors separate.
## 2026-07-04 - Workbench visual regression coverage

- Added a UI regression test requiring one left-edge Tools entry point, no duplicate topbar Tools button, and the shared 68% translucent accent treatment.
- Focused workbench/skin tests pass: 2 files / 26 tests before the new assertion.
## 2026-07-04 - Workbench visual cleanup verified

- Full suite passes: 23 test files / 196 tests.
- `www/preview.js` syntax and `git diff --check` pass; only existing Windows line-ending notices remain.
- No firmware behavior changed and PlatformIO was not rerun.
## 2026-07-04 - Machine discovery and guarded configuration firmware

- Added firmware `0.5.5-machine-profile` with delayed idle-only, non-blocking M115 discovery after boot.
- Parses and caches Marlin identity, custom `area.full`/`area.work`, and EEPROM/ARCS/emergency-parser/autoreport-position/SD/motion-mode capabilities in Preferences namespace `machine`.
- Added GET `/api/machine/info` and POST `/api/machine/refresh`.
- Added idle-only validated POST `/api/machine/apply` for M92/M203/M201/M204 and explicit POST `/api/machine/save` for M500.
- Manual M115 also refreshes the cache; M5 remains an immediate exception during discovery.
## 2026-07-04 - Machine Configuration settings UI

- Added Hardware Info with cached/refreshing M115 identity, physical/work area, and capability display.
- Added editable M92, M203, M201, and M204 forms. Each Apply changes Marlin RAM only and reports the exact command.
- Added explicit `Save applied changes to Marlin EEPROM (M500)` with a clear persistence result.
- Settings reads M503 and M211 on first visit, fills supported fields, updates shared M203 travel limits, and warns when software endstops are not confirmed ON.
## 2026-07-04 - Machine profile compile cleanup

- Added forward declarations for discovery helpers used before their definitions.
- Moved the M5-during-discovery exception from an accidentally matched feed-override helper into the actual command handler.
- No behavior or API contract changed beyond placing the intended logic correctly.
## 2026-07-04 - Machine Configuration DEV MOCK support

- Mock M115 now reports identity, capabilities, and custom full/work area matching the real 515DL response shape.
- Mock M503 reports M92/M203/M201/M204; M211 reports software-endstop state.
- Mock apply endpoints update live values and M500 records an EEPROM save, with active-job rejection matching firmware intent.
## 2026-07-04 - Discovered machine area connected to safety/UI

- Preview loads cached `/api/machine/info` and uses `area.full` for table grid, bounds, preflight, recovery, and dry-run limits, with existing defaults as fallback.
- Firmware Production Resume and saved-work-zero restore bounds now use the cached full machine profile instead of duplicated fixed XY/Z constants.
- Hardware Info is therefore an active machine profile, not display-only metadata.
## 2026-07-04 - Machine Configuration regression coverage

- Added parser/UI/firmware contract tests for M115 cache, M503 groups, M211, idle-only apply, and explicit M500 persistence.
- Extended mock unit and HTTP tests to verify live M92/M203/M201/M204 changes and EEPROM save behavior.
## 2026-07-04 - Machine Configuration documented

- Documented boot discovery, NVS cache, active `area.full` usage, API bodies, UART ownership, RAM-only Apply semantics, and explicit M500 persistence.
- Added a safety procedure proving values revert without M500 and persist only after the dedicated save action.
- M500 is disabled in UI when cached M115 explicitly reports no EEPROM capability.
## 2026-07-04 - Machine profile regression cleanup

- Updated the Production Resume source-contract test from fixed constants to discovered machine limit accessors.
- Initial full run passed 200 tests; the only failure was this stale assertion.
## 2026-07-04 - Machine Configuration verified

- Full suite passes: 24 test files / 201 tests.
- Changed JavaScript/mock files pass syntax checks and `git diff --check` passes with only existing Windows line-ending notices.
- PlatformIO builds firmware `0.5.5-machine-profile`: 15.6% RAM and 52.9% flash.
- Discovery, active machine area, guarded RAM edits, M211 visibility, and explicit M500 persistence are ready for real 515DL testing.
## 2026-07-04 - Marlin UART contamination diagnosed and blocked

- Interrupted KAK runs contained ESP32 `WebServer.cpp` error logs inside Marlin responses; one
  framework log was concatenated with a real G2/G3 command and Marlin rejected it as unknown.
- Disabled Arduino core debug output and removed SD rescue diagnostics from UART0.
- Added a transport regression test enforcing that UART0 remains Marlin-only.
- Verification passes: focused transport tests 11/11, full suite 24 files / 202 tests, and
  PlatformIO firmware build at 15.5% RAM / 51.4% flash.
## 2026-07-04 - SD downloads force attachment handling

- `/api/download` now returns `Content-Disposition: attachment` with a sanitized original filename.
- Text G-code such as `.gc` downloads instead of opening as a browser document.
- DEV MOCK and endpoint contract coverage were updated to match firmware behavior.
- Verification passes: 24 test files / 203 tests and PlatformIO firmware build at 15.5% RAM /
  51.4% flash.
## 2026-07-04 - Maintenance page header overlap fixed

- Firmware Update and WiFi Settings no longer reuse the sticky main-page `.topbar`.
- Their headers remain in normal document flow and cannot cover file/form controls.
- Verification passes: 24 test files / 204 tests and PlatformIO firmware build at 15.5% RAM /
  51.4% flash.
## 2026-07-04 - Mobile button long-press selection disabled

- All buttons, button inputs, and explicit button roles now suppress text selection and WebKit
  touch callouts.
- Normal page text and editable inputs remain selectable.
- Verification passes: focused mobile-control test and full suite, 24 files / 205 tests.
## 2026-07-04 - Preview Capture + Set Work Zero made atomic and verified

- Preview now runs the same critical sequence as the working drawer action before any optional
  machine-reference discovery: M400, M114, G92 X0 Y0 Z0, M400, M114.
- M503 runs only after Marlin has confirmed X/Y/Z near zero.
- Failed G92 confirmation is shown as an error and is not recorded as a valid job work zero.
- A confirmed capture switches Start Job to `use_active_work_zero`, preventing start from replacing
  the chosen zero after later jog or dry-run movement.
- Verification passes: `node --check`, focused work-zero coverage, and 24 files / 206 tests.
## 2026-07-04 - Bounding Box Trace restores starting Z

- Trace captures current X/Y/Z before movement.
- Completion returns to captured X/Y at Safe Z, then restores captured Z and waits with M400.
- Invalid position capture blocks motion; failed/stopped traces do not automatically descend.
- Verification passes: preview syntax, focused ordering coverage, and 24 files / 207 tests.
## 2026-07-04 - Partial job zero-state migration fixed

- Old/generated job JSON without `workZero` or `toolZero` is normalized before use.
- Missing capture position/count subfields are filled without replacing existing values.
- Capture and Set Work/Z Zero no longer throw while assigning `capturedAt`.
- Verification passes: preview syntax, partial-job regression coverage, and 24 files / 208 tests.
## 2026-07-04 - Large job JSON arm validation fixed

- Diagnosed UI ARMED / firmware not-ARMED disagreement as an 8192-byte firmware snippet limit.
- ARMED, workspace permission, and generated active-run checks now scan the complete SD file with
  the existing bounded rolling-window helper.
- Job JSON remains streamed and is not loaded fully into ESP32 RAM.
- Verification passes: focused metadata coverage, 24 files / 209 tests, and PlatformIO build at
  15.5% RAM / 51.4% flash.
## 2026-07-04 - Event-driven motion telemetry integrated

- Firmware batches compact motion events keyed by cleaned command number and limits full job
  progress telemetry to 2 Hz.
- Visible clients enable Marlin M154 at 1 s during motion and 2 s while idle; no client requests
  M154 S0. Unchanged positions do not reach the browser.
- Preview animates G0/G1 and native G2/G3 locally with requestAnimationFrame and no network polling.
- Reported positions remain direct idle/external-motion information; prediction correction is
  intentionally deferred.
- Verification so far: JavaScript syntax checks, focused 40 tests, full 24 files / 212 tests, and
  `git diff --check`. PlatformIO build is pending because the execution approval quota was reached
  before compilation started.
# 2026-07-04 - Automatic cut-bounds placement

- Changed placement anchoring from raw travel bounds to actual engaged cut bounds.
- An unrotated source file that already fits the discovered machine work area remains the original active run.
- If the cut is outside the work area but its width and height fit, the UI automatically creates a generated run with the cut lower-left at work zero.
- Oversize cuts remain outside and blocked; parking/lead-in travel does not choose the origin but remains visible to generated-run safety validation.
- Added focused transform and active-run tests for automatic placement and source/generated selection.

## 2026-07-05 - README and screenshot refresh

- Replaced the obsolete June UI gallery with eight representative July workbench screenshots.
- Updated the project overview, feature list, architecture, workflow, and FreeCAD/work-zero text to
  match the current SD-hosted workbench and firmware-owned streaming design.
- Documented that normal Start uses the saved active work zero and does not issue a new `G92`.
- Removed 24 obsolete June screenshots; firmware, PlatformIO configuration, and `/www` were unchanged.

## 2026-07-06 - Device identity loading

- Added default `cnc` / `ESP32 CNC` identity and uppercase six-hex MAC suffix device ID.
- Added bounded parsing of `/esp32-cnc/config.json` with `/config.json` fallback.
- Added lowercase DNS-label sanitization, `.local` suffix removal, and MAC-derived safe fallback.
- Valid SD identity is persisted to Preferences namespace `device`; missing/invalid SD config falls
  back to NVS and then firmware defaults.

## 2026-07-06 - Local discovery and device API

- Applied the selected bare hostname to STA/AP network setup and started mDNS after WiFi.
- Advertises `_http._tcp` and `_esp32cnc._tcp` on port 80 with friendly name/device ID TXT data.
- Added `GET /api/device` with device ID, hostname, friendly name, `.local` URL, IP, active mode,
  mDNS state, and non-sensitive config source.

## 2026-07-06 - Discovery documentation and regression coverage

- Added `docs/device-config.md` with exact SD JSON, sanitization, startup priority, NVS persistence,
  discovery behavior, and IP fallback guidance.
- Updated README, architecture, and protocol docs for `cnc.local` and `GET /api/device`.
- Added focused firmware-source regression tests for defaults, SD/NVS priority, bounded strict
  parsing, hostname normalization, mDNS services, and the public-only API response.

## 2026-07-06 - Device discovery verification

- Full test suite passes: 25 test files / 228 tests.
- PlatformIO `esp32cam` build passes with ESPmDNS linked: 16.4% RAM and 53.7% flash.
- Firmware artifact is `.pio-build/esp32cam/firmware.bin` (`0.6.1-device-config`).

## 2026-07-06 - BLE discovery configuration and advertisement

- Extended SD config with optional `bluetooth.enabled` and `bluetooth.advertiseName` booleans;
  missing Bluetooth config defaults both to true and valid values persist to NVS.
- Added compile-time `ESP32CNC_ENABLE_BLE`, free-heap guard, and low-frequency non-connectable BLE
  name advertising started only after WiFi, mDNS, HTTP, and WebSocket infrastructure.
- STA names prefer `CNC <hostname>.local`; AP fallback prefers `CNC 192.168.4.1`; long hostnames
  fall back through `CNC <hostname>` to `CNC-<deviceId>`.

## 2026-07-06 - BLE discovery docs and regression coverage

- Updated firmware version to `0.6.2-ble-discovery` and documented BLE as an identification-only
  helper in README, architecture, protocol, and device configuration guidance.
- Extended `/api/device` documentation with configured, started, and selected-name BLE state.
- Added regression assertions for config defaults/NVS persistence, 26-byte naming priority,
  non-connectable low-memory-guarded advertising, and web-stack-before-BLE startup order.

## 2026-07-06 - BLE footprint correction

- Rejected the first Bluedroid build at 92.3% flash as too costly for an optional discovery label.
- Switched to NimBLE-Arduino 2.5.x with checked initialization/config/start return values while
  preserving non-connectable, low-frequency, WiFi-first behavior.

## 2026-07-06 - BLE discovery verification

- Full suite passes: 25 test files / 230 tests.
- NimBLE PlatformIO build passes at 19.4% RAM and 66.6% flash, reducing the rejected Bluedroid
  flash footprint by 25.7 percentage points.
- Firmware artifact is `.pio-build/esp32cam/firmware.bin` (`0.6.2-ble-discovery`).

## 2026-07-06 - Device identity update and safe restart APIs

- Added idle-only `PATCH /api/device` with server-side hostname sanitization and a pending URL/BLE
  name response; active and paused job states return HTTP 409.
- Identity updates always persist to NVS and attempt a recoverable temp/backup/rename update of
  `/esp32-cnc/config.json`; SD failure returns a warning without losing the NVS save.
- Added `POST /api/system/restart`, blocked by active job, pending Marlin response, jog, OTA, or
  priority controls. Firmware version is now `0.6.3-device-settings`.

## 2026-07-06 - Machine Identity settings UI

- Added a phone-friendly Machine Identity panel showing friendly name, clickable local address,
  device ID, current IP, and BLE name.
- Added bare-hostname/friendly-name editing with live sanitized `.local` URL preview, idle-state
  locking, NVS/SD warning display, and restart-to-apply action.
- Added shared browser helpers for hostname preview normalization and active-job state locking.

## 2026-07-06 - Device Settings mock, tests, and docs

- Added local mock support for GET/PATCH device identity, SD config persistence, and guarded restart.
- Added UI helper tests, firmware contract assertions, mock integration coverage, and paused-state
  rejection checks.
- Documented Settings behavior, PATCH/restart APIs, NVS-first persistence, SD warning semantics,
  and restart-only application of mDNS/BLE names.

## 2026-07-06 - Device Settings final verification

- JavaScript syntax checks pass for the Settings UI, shared identity helper, and mock server.
- Full suite passes: 26 test files / 237 tests, including idle save/restart, SD persistence, and
  active/paused-state rejection.
- PlatformIO build passes at 19.4% RAM and 66.8% flash. Firmware artifact is
  `.pio-build/esp32cam/firmware.bin` (`0.6.3-device-settings`).

## 2026-07-06 - Marlin stream stall diagnosis and ACK guard

- Diagnosed first-start failure as the shared 1500 ms priority timeout expiring during Safe-Z or
  `M400`; a second start worked because the first attempt had already completed the Z lift.
- Priority preamble and file streaming now use a 5 second ACK inactivity guard extended only by
  Marlin `busy:` liveness. Missing acknowledgements enter a descriptive ERROR without resending a
  possibly executed motion command.
- Liveness inspects only newly received UART bytes, so an older `busy:` cannot be kept alive by
  unrelated M154 position reports.
- The normal SD stream remains firmware-owned and independent of browser/WebSocket availability.

## 2026-07-06 - Compact telemetry animation gap recovery

- Diagnosed straight-line jumps as compact firmware batches dropping intermediate fast commands
  once their fixed event batch filled; native arcs arrived slowly enough to remain smooth.
- The browser now reconstructs every preview segment between received command numbers without any
  additional ESP32, UART, HTTP, or WebSocket traffic.
- Increased only the browser-side animation backlog ceiling so planner bursts do not immediately
  discard visible line motion.
- Bumped firmware identity to `0.6.4-stream-ack-guard` so the transport fix is visible in Health.

## 2026-07-06 - Stream and animation verification

- JavaScript syntax checks pass; focused transport/workbench suite passes 40 tests.
- Full regression passes: 26 test files / 239 tests.
- PlatformIO builds `0.6.4-stream-ack-guard` successfully at 19.4% RAM and 66.9% flash.
- Live read-only diagnostics confirmed the device was healthy and idle on `cnc.local`; its current
  firmware was still `0.6.3-device-settings`, so hardware validation requires the new binary.

## 2026-07-06 - Home-relative work-zero audit

- Read recent job JSON directly from the device. Historical machine references were reconstructed
  through the previous G92 origin; values happened to match saved counts but any stale frame could
  contaminate every later zero.
- Home All now captures M114 step counts plus M503/M92 scale and gives the frame a unique
  `homingSessionId`. Machine position is derived directly from physical home counts.
- Setting work zero now requires this absolute Home All frame. Start requires the exact session ID,
  preventing an ESP reboot's reused epoch value from accepting an old active frame.

## 2026-07-06 - Recovery physical-bounds correction

- Diagnosed false out-of-bounds recovery: work coordinates, including valid negative cutting Z,
  were compared directly with physical machine limits.
- Motion-only, Toolless, and Production Resume now translate work points through the interrupted
  run's saved Home-relative work zero before checking X/Y/Z limits.
- Explicit saved-zero restore now updates the firmware frame and stamps the restored zero with the
  current homing session; Z remains intentionally untouched until the operator sets it.
- Recovery motion is blocked until that saved zero actually matches the live Home All session;
  merely selecting an old zero ID cannot authorize movement in the baseline home work frame.
- Firmware version is `0.6.5-home-frame-recovery`.

## 2026-07-06 - Home-frame recovery verification

- JavaScript syntax checks pass and focused recovery/frame tests pass 70/70.
- Full regression passes: 26 test files / 241 tests.
- PlatformIO builds `0.6.5-home-frame-recovery` at 19.4% RAM and 67.1% flash.
- DEV MOCK now exposes the same absolute-home/session fields as hardware for browser workflow tests.

## 2026-07-07 - Compact upload thumbnail foundation

- Added deterministic `/jobs/thumbs/<gcode-name>.png` naming and a metadata merge helper that
  preserves existing job setup, zero, arm, run, and recovery fields.
- Replaced the canvas thumbnail stub with direct proportional toolpath raster drawing; PNG creation
  no longer requires constructing a potentially large SVG path string.

## 2026-07-07 - Upload-time PNG thumbnail workflow

- G-code selection on `/files` now parses locally and shows a 128x128 PNG preview before upload.
- One Upload action writes the G-code, PNG under `/jobs/thumbs`, and merged job JSON containing
  preview metadata plus `thumbnailPath`; existing job safety/history fields remain intact.
- Non-G-code and non-`/gcode` uploads keep the existing single-file behavior.
- Removed the obsolete SVG thumbnail generator; nested `/gcode/...` uploads also receive PNG
  sidecars, and partial sidecar failure is reported without claiming the G-code upload failed.
- Migrated the dashboard G-code launcher upload flow from embedded/generated SVG to the same
  128x128 PNG sidecar contract used by the full file manager.

## 2026-07-07 - PNG thumbnail regression coverage

- Added tests for deterministic PNG paths, direct canvas rendering, both upload surfaces, and
  preservation of work-zero/arm/run/recovery metadata during upload-time preview refresh.
- Dashboard upload is disabled while the selected file is still being parsed/encoded, preventing
  a fast submit from racing ahead of its PNG sidecar.

## 2026-07-07 - PNG thumbnail verification

- JavaScript syntax checks pass for both upload surfaces and shared modules.
- Full regression passes: 27 test files / 244 tests.
- Local mock file manager renders without console errors. Firmware was unchanged, so PlatformIO
  was not rerun.

## 2026-07-07 - PNG thumbnail display route fix

- File lists now load `/jobs/thumbs/*.png` through `/api/download?path=...` instead of treating
  SD job paths as public static URLs, which previously returned `{"ok":false,"error":"not found"}`.
- Added regression coverage for both the dashboard and full file manager thumbnail URLs.
- Full regression passes: 27 test files / 245 tests; JavaScript syntax and diff checks pass.

## 2026-07-07 - Browser sleep and recovery animation fix

- Removed the preview visibility handler that incorrectly sent `/api/job/stop` when a phone locked
  or hid the browser during firmware-owned Toolless/Production Resume streaming.
- Production Resume motion telemetry now uses a dedicated command model starting at the known
  recovery point instead of matching restarted recovery sequence numbers against the full source.
- Added regression coverage for browser-sleep stream ownership and recovery animation coordinates.
- Full regression passes: 27 test files / 248 tests; JavaScript syntax and diff checks pass.

## 2026-07-08 - Firmware-owned smooth jog cadence

- Decoupled joystick movement cadence from browser HTTP timing: browser updates only the desired
  vector while firmware emits one short `G0` movement every 50 ms.
- Jog enters `G91` once, limits planner lookahead to three ticks, tracks Marlin ACKs without a
  blocking per-tick read, and restores `G90` on release, deadman, and error paths.
- Added vector ramping and an ACK timeout that issues `M410`, `M5`, and `G90` on transport failure.
- Full regression passes: 27 test files / 250 tests. PlatformIO builds successfully at 19.4% RAM
  and 67.2% flash.

## 2026-07-08 - Operator Zero / Origin workflow

- Replaced inline Job Setup, Tool/Z Zero, Zero History, and Run History panels with one compact
  Zero / Origin panel showing trusted Home-relative XYZ and five operator actions.
- Added automatic capture, verification, history creation, active-zero selection, and job JSON
  persistence for Work, X, Y, and Z zero actions; normal controls no longer expose G92 or M114.
- Moved compact zero history into a modal with run outcome/use/restore summaries; raw IDs, M114,
  full records, manual metadata controls, and run history remain collapsed under diagnostics.
- Extended the existing firmware work-zero endpoint with backward-compatible `x`, `y`, and `xyz`
  axis selection. Z continues through the dedicated Z endpoint.
- Mobile mock verification passes at 390x844: Zero opens at drawer top, History is a bounded modal,
  and neither surface has horizontal overflow. Full regression passes 28 files / 255 tests.
- PlatformIO builds firmware `0.6.7-zero-origin` at 19.4% RAM and 67.2% flash.

## 2026-07-08 - Animation freshness and recovery Z-origin correction

- Browser motion animation now discards telemetry older than one second, bounds queued animation to
  roughly one second, and resynchronizes to the latest command after visibility reconnect.
- Saved work-zero restore no longer overwrites the interrupted job's saved Home-relative Z origin
  with the temporary post-home Z frame. Recovery bounds therefore keep the captured XYZ origin.
- Saved absolute machine-frame position is authoritative; raw count/steps reconstruction remains a
  legacy fallback instead of replacing a valid recorded position.
- Extended guarded `/api/work-zero/restore` for optional Safe-Z-first XYZ travel and selected G92
  axes. Recovery restores its saved XYZ origin; every Zero History entry now offers `Restore & Go`.
- Moved Feed Override out of Zero/Setup and into Run.
- Verification: all 28 test files / 257 tests pass; PlatformIO builds `0.6.8-zero-restore`
  at 19.4% RAM and 67.3% flash.

## 2026-07-10 - Smooth physical jog and long-line animation

- Changed firmware jog planning from 50 ms G0 chunks to 25 ms coordinated G1 chunks, doubled the
  bounded Marlin lookahead, and halved per-tick ramp/step limits so acceleration time and safety
  behavior remain unchanged while physical motion receives smaller, smoother vectors.
- Removed the one-second queued-duration trim that could cancel an active long straight whenever
  later motion telemetry arrived. Fresh long moves now run for their feed-derived duration; stale
  reconnect telemetry is still rejected and an abnormal 128-segment queue triggers resync.
- Firmware version is now `0.6.9-smooth-motion`; focused and full verification remain to be run.
- Focused motion/telemetry tests pass 56/56. The first full run passed 262/264; its only failures
  were two stale assertions that still expected firmware version `0.6.8`, now updated to `0.6.9`.
- Final verification passes: 28 test files / 264 tests, JavaScript syntax, and diff checks. The
  AI-Thinker ESP32-CAM PlatformIO build succeeds at 19.4% RAM and 67.3% flash.

## 2026-07-10 - Simple root SD firmware update

- Added automatic boot-time installation of root `/firmware.bin` without an `INSTALL.NOW` marker.
- A successful root update is renamed to `/firmware.done.bin`, preventing repeat installation.
- The existing `/firmware/update.bin` plus `/firmware/INSTALL.NOW` rescue flow remains supported
  and takes precedence when both update forms are present.
- Firmware version is `0.6.10-root-sd-update`; verification remains to be run.
- Updated the firmware-update, protocol, architecture, and README instructions so `/firmware.bin`
  is documented as the primary marker-free SD update path.
- Verification passes: 28 test files / 265 tests and PlatformIO build. Firmware uses 19.4% RAM
  and 67.3% flash.

## 2026-07-10 - Simplified cutting workflow

- Removed the operator-facing Arm tab and renamed Run to Start Cutting.
- Replaced the duplicated Arm/Run checklists with one three-item final cutting check.
- Moved feed setup and stream diagnostics behind collapsed advanced details while keeping
  Hold-to-Start and the live safety controls prominent.
- Added a contextual Home Machine button beside zero/origin setup; behavior wiring is next.
- Readiness now shows one next action and a five-step preparation count; full blockers, paths, and
  placement metadata are available only under expanded details.
- Start Cutting automatically saves the internal arm snapshot after the three final checks and the
  deliberate hold, then starts through the unchanged firmware arm validation.
- Home Machine delegates to the existing guarded Home All control and returns trust updates to the
  active setup/readiness view.
- Simplified the dashboard Job card to operator essentials and moved file paths, generated-state,
  blocker lists, and Marlin diagnostics into a collapsed section.
- Updated shared readiness actions to route an unarmed-but-prepared job directly to Review & Start;
  added regression coverage for the merged checklist, automatic arm snapshot, and contextual home.
- Verification passes: JavaScript syntax, diff checks, 60/60 focused workflow tests, and the full
  28-file / 267-test regression suite.
- In-app localhost visual verification was unavailable because the browser surface rejected that
  local target; mobile structure and visibility were therefore verified through DOM/CSS contracts
  and regression assertions instead of switching to an unapproved browser mechanism.

## 2026-07-10 - Job workflow v3 foundation

- Added a non-migrating Job JSON v3 workflow model with explicit frame, work-zero, verification,
  and start-authorization decisions.
- Added a central gate evaluator for homing/manual frame, work zero, physical verification, and cut.
- Replaced ambiguous parallel dry-run state in the new model with one active decision: Bounds,
  Aircut, or deliberately Skipped, scoped to run/transform/work-zero identity.
- Added unit coverage for gate progression, skip evidence, stale sibling isolation, invalidation,
  and boot-session expiry. Preview integration remains.
- Preview and dashboard now accept only schema-3 setup metadata; older Job JSON setup state is
  rejected and replaced by a fresh pending workflow rather than migrated.
- New uploads create schema-3 workflow placeholders and ignore legacy setup fields.

### Firmware frame integration

- Firmware now exposes a per-boot session and distinguishes `homed`, `manual-unhomed`, and
  `untrusted` frames. A manual frame can preserve current G54 coordinates or set current XYZ as
  zero, and expires automatically after an ESP restart.
- Work-zero and Z-zero capture now operate in either an absolute homed frame or the explicitly
  acknowledged manual frame. Manual job starts require the matching boot session; homed starts
  retain absolute machine-coordinate validation.
- Firmware authorization now targets the v3 `startAuthorizationToken` instead of legacy Arm state.

### Guided Prepare & Cut integration

- The left drawer now contains only geometry, placement, and rotation; zero setup, physical checks,
  recovery, and cutting live in one right-side `Prepare & Cut` workflow.
- Each incomplete gate explains the problem and offers its corrective actions in place: Home All or
  confirmed unhomed override, work-zero choice, then Bounds / Full Aircut / deliberate skip.
- Bounds and Aircut completion are persisted immediately as one immutable verification decision;
  an unrelated stale check can no longer invalidate the selected completed check.
- Final hold writes a compact one-use v3 start authorization, starts the exact active run, then
  clears the authorization. Manual-frame and skipped-check warnings are also drawn on the canvas.
- The development mock implements the same per-boot manual frame and v3 authorization contract.
- Final JavaScript/mock/static regression passes 29 files and 275 tests; `git diff --check` is clean.
- PlatformIO compilation could not be rerun because the sandbox cannot write `.platformio` and the
  required permission escalation was unavailable at the account usage limit. In-app localhost
  visual inspection was also rejected by the existing browser security policy for that target.

## 2026-07-11 - File opening and file-card UX

- Fixed all preview launches failing after the workflow-v3 integration: `preview.js` now loads as
  an ES module, matching its static imports.
- First file open now awaits metadata persistence and creates a complete Job JSON v3 from the live
  job state instead of briefly writing a partial preview-only setup.
- Both file surfaces open G-code directly from the card. Shift-click, right-click, or a 450 ms hold
  reveals Rename / Download / Details / Delete actions without a separate Select button.
- Maintenance actions are an absolute overlay, so opening them no longer changes card height or
  reflows the surrounding grid.
- Removed extension, `has job`, and `preview` badges. G54 is the normal system workspace and is no
  longer emitted or counted as a warning; legacy stored G54 messages are filtered from badges.
- Final verification passes 30 test files / 279 tests, JavaScript syntax checks, and
  `git diff --check`.

## 2026-07-11 - Bounds verification identity fix

- Bounds/Aircut/Skip now normalize the current Job state and copy the live active-run path, mode,
  and fingerprint before creating verification evidence. Saving can no longer make freshly created
  evidence stale by changing its identity afterward.
- Verification failures now identify the actual invalidation source: missing choice, active run,
  placement, or work zero, instead of the generic `Physical verification is not current` message.
- Full regression remains green at 30 files / 279 tests.

## 2026-07-11 - Thumbnail creation on file open

- Preview open now checks whether the Job JSON thumbnail path exists on SD.
- When missing, the already parsed source ToolpathModel is rendered through the shared canvas engine
  to a 128x128 PNG, `/jobs/thumbs` is created if needed, and the PNG is uploaded there.
- The resulting `thumbnailPath` is persisted in the same awaited Job JSON v3 metadata transaction.
  Existing valid thumbnails are reused without regeneration.
- Full regression passes 30 files / 280 tests.

## 2026-07-12 - File-scoped state and compact recovery

- Job JSON filenames now derive from the complete normalized G-code path plus a stable hash. Files
  with the same basename in different folders can no longer share preparation or run history.
- All Job JSON readers verify `sourceGcodePath`; unrelated or stale sidecars are ignored.
- A terminal firmware status belonging to another file is shown as idle after a new file is opened;
  active machine work remains visible and is never hidden.
- Recovery now leads with a short actionable summary and three production confirmations. Saved-zero
  restore, motion-only positioning, no-tool testing, settings, details, and logs are collapsed by
  default to preserve work-area space.
- Regression passes 30 test files / 282 tests.

## 2026-07-12 - Thumbnail fallback after Job path change

- File cards now probe the deterministic PNG sidecar when a new path-scoped Job JSON does not yet
  exist. Existing thumbnails remain visible without importing any legacy job state or history.
- Both dashboard and Files views use the same fallback.

## 2026-07-12 - Machine drawer below persistent controls

- The machine drawer and its scrim now begin below the measured machine-bar height, keeping the
  work-area state line and Pause / Stop / M5 controls visible while the drawer is open.
- Removed the duplicate state, feed, Pause, Stop, and M5 controls from the drawer header.

## 2026-07-13 - Direction-locked joystick controls

- Reworked the compact jog dock around one central free-direction XY joystick and eight nearby
  cardinal/diagonal arrow handles.
- Each arrow locks motion to its exact axis or 45-degree diagonal. Pressing begins at low speed;
  pulling outward increases the firmware jog vector magnitude and releasing stops the jog.
- Kept Z+/Z- as separate visible controls so Z motion cannot be mixed accidentally with XY.
- Replaced the settings chevron with a gear and changed Safe Z to a labelled range slider alongside
  the existing XY and Z maximum-speed sliders.
- Mobile render review moved Z+/Z- into a true vertical rail and added visible axis labels to the
  four cardinal arrows; diagonal arrows remain visually distinct without crowded labels.
- Browser hit-testing found the transparent XY pad above the settings gear; the gear now has an
  explicit foreground stacking level so it reliably opens the slider panel by touch.
- Verification: focused machine controls passed 26 tests; the full suite passed 30 files / 284
  tests. Local mobile mock review confirmed the vertical Z rail and the gear-opened three sliders.

## 2026-07-13 - Overlapped jog segments

- Kept the 25 ms jog send cadence but lengthened each queued G1 segment to 40 ms. The resulting
  15 ms planning overlap gives Marlin the next segment before the current movement should end.
- Increased the per-segment XY/Z caps in proportion to segment duration. Feed is still derived from
  the configured maximum speed, so the overlap does not raise that speed.
- Replaced separate Z+/Z- buttons with one spring-return vertical Z slider. Center is neutral;
  distance upward/downward controls Z+/Z- vector magnitude and release uses the existing hard stop.
- Styled the Z control as a compact vertical track with fixed Z+/Z- end labels and a centered
  spring-return handle, preserving the existing mobile jog dock width.
- Verification: focused jog/transport checks passed 45 tests; full suite passed 30 files / 284
  tests; PlatformIO build succeeded at 19.4% RAM and 67.5% flash.
- Local mock drag verification confirmed Z+ proportional input, release back to IDLE, centered
  handle reset, and an unobstructed settings-gear hit target.

## 2026-07-13 - Bounded jog horizon and natural release

- Replaced the continuously growing 25/40 ms submission pattern with an estimated motion horizon:
  refill starts at 40 ms and is capped at 80 ms while the 25 ms service tick remains responsive.
- Normal jog stop no longer sends M400 or M410. It stops producing segments, appends G90 after the
  already-sent relative moves, and remains STOPPING until acknowledgements and the short horizon drain.
- Deadman, acknowledgement timeout, and explicitly emergency stop requests retain M410/M5 so loss
  of browser control cannot silently turn into an unbounded natural coast.
- Browser pointerup now requests `{ emergency: false }`; pointer cancellation, lost capture, request
  failure, blur, and hidden-page events explicitly request the emergency stop path.
- Verification: focused jog/transport checks passed 45 tests; full suite passed 30 files / 284
  tests; PlatformIO build succeeded at 19.4% RAM and 67.6% flash.

## 2026-07-13 - User-confirmed Restore Z

- Removed timed automatic Z restoration. A completed Safe XY jog now exposes a saved restore target
  without issuing any Z movement by itself.
- Added `POST /api/jog/restore-z`. It requires idle state, rechecks current Z against the captured
  Safe Z within 0.5 mm, then performs and waits for the user-requested Z move.
- Emergency/deadman stops and any Z jog invalidate the pending restore target.
- Replaced the Restore Z checkbox with a disabled-by-default action button. After a natural Safe XY
  release it shows the captured target directly, for example `Restore Z 34 mm`, and asks for a
  current-X/Y clearance confirmation before calling the restore endpoint.
- Updated the development mock to preserve and explicitly restore the same target; it never moves Z
  automatically after a normal jog release.
- Z capture and validation now wait for Marlin's `M400` acknowledgement before sending `M114`, so
  the saved and checked coordinates cannot be confused with an earlier command response.
- Verification: focused Restore Z checks passed 39 tests; full suite passed 30 files / 285 tests;
  PlatformIO build succeeded at 19.4% RAM and 67.6% flash. Local UI review confirmed the
  disabled `Restore Z unavailable` button fits beside Safe in the gear panel.

## 2026-07-13 - Stable UI during jog

- Skin icon application now skips icon slots whose markup is already current, preventing unrelated
  state refreshes from rebuilding every button icon.
- Added targeted position, Marlin-log, and jog readout renderers; the 150 ms jog request path now
  refreshes only jog state instead of the complete machine bar.
- High-frequency jog, position, and Marlin-log telemetry subscriptions now use those targeted
  renderers. Position telemetry emits a machine-frame change only when its frame revision changes,
  so Preview does not rebuild setup/control panels for every moving coordinate.
- Pause/Resume keeps a stable label and icon slot; its icon is reapplied only when the actual
  Pause/Resume role changes.
- Predicted jog coordinates still refresh immediately, but only the two position text readouts are
  touched.
- Verification: focused UI/telemetry checks passed 46 tests; full suite passed 30 files / 285 tests;
  JavaScript syntax and diff checks passed.

## 2026-07-13 - Absolute jog targets

- Jog status now carries a captured absolute work-coordinate command target for X/Y/Z. This will be
  the single firmware/UI position source while jog segments are queued.
- Safe-Z completion now captures all three work axes after `M400`; non-Safe jog has a matching
  `M400` + `M114` capture path before any segment can be generated.
- Replaced `G91` jog segments with `G90` + absolute `G1 X/Y/Z` targets accumulated only in firmware.
  Emergency/error paths invalidate the target; every later jog start resynchronizes from `M114`.
- Jog heartbeat, emergency-stop, and transport errors are now persisted to `/logs/job.log` for
  diagnosing intermittent control loss.
- Browser position rendering no longer estimates or sums 150 ms jog steps. It accepts only complete
  firmware `commandedWorkX/Y/Z` snapshots and lets live Marlin position telemetry correct physical
  progress independently.
- Development mock now starts in `G90`, returns the same absolute commanded fields, and executes
  absolute G1 targets so browser/API tests exercise the production coordinate contract.
- While an absolute jog target is active, slower physical position autoreports no longer overwrite
  the displayed command target and cause a brief backwards/forwards jump. They resume immediately
  after jog stops or the target is invalidated.
- Verification: focused firmware/UI/mock coverage passed 58 tests; full suite passed 30 files / 285
  tests. PlatformIO build succeeded at 19.4% RAM and 67.7% flash.

## 2026-07-13 - Work-zero history restoration safety

- Kept the development mock aligned with firmware: `/api/work-zero/goto` now rejects movement until the current machine session has an active work zero.
- Extended the mock integration coverage to prove a cold/untrusted session is rejected and a fully homed active frame is accepted.
- The accepted-path fixture now homes, positions the mock in explicit machine coordinates, establishes an active XYZ zero, then verifies the bounded Safe-Z move instead of relying on an implicit startup coordinate frame.

- `/api/work-zero/goto` now rejects movement unless firmware has an active work zero. Saved Job JSON
  coordinates alone can no longer turn `G0 X0 Y0` into an unintended move toward machine Home.
- Moved Zero / Origin from the unreachable legacy `setup` tab into the start of the visible Prepare
  tab. Added an inline saved-work-zero selector and explicit `Restore & Activate` action.
- The Prepare selector lists only work-zero entries with complete home-relative XYZ references. It is
  enabled for selection immediately, but restoration remains blocked until Home All and an idle job.
- A saved zero from an earlier session is labelled `Saved work zero — not active`; only firmware
  `workZeroValid` plus matching homing session is labelled active.
- Machine-bar X0/Y0/XY0 controls are disabled whenever the live frame has no active work zero, with
  the same check repeated before the API call.
- Removed remaining operator routes to the hidden `#setup` tab. Work-zero setup now opens Prepare,
  interrupted work opens Recovery, and the dashboard calls metadata `Saved work zero — activate in
  Prepare` instead of implying it is live.
- Updated the dashboard's secondary `Choose previous zero` and `Review interrupted run` links to the
  same Prepare/Recovery destinations.
- Verification: focused work-zero/mock/UI coverage passed 6 files / 83 tests; full suite passed 30
  files / 285 tests. PlatformIO firmware build succeeded at 19.4% RAM and 67.7% flash.

## 2026-07-14 - Persistent Home All readiness control

- Moved Home All out of the changing guided-workflow action slot into a dedicated persistent control
  in Job Readiness. Advancing from machine-frame setup to work-zero setup no longer removes it.
- The persistent control reuses the existing confirmed `cnc-home-machine-request` flow and stays
  visible but disabled while a job is preparing, running, paused, resuming, or stopping.
- Readiness focus for a `home_machine` action now targets the persistent button.
- Updated UI coverage to assert that Home All is static and no longer generated only for the frame gate.
- Verification: local browser QA showed one visible, enabled Home All control in Job Readiness; focused
  UI coverage passed 3 files / 55 tests and the full suite passed 30 files / 285 tests.

## 2026-07-14 - Aircut collapses repeated stepdowns

- Added a browser-side Aircut geometry pass that groups engaged XY paths and compares them without Z.
- Identical geometry repeated at another Z depth is emitted once; intentional repeats with the same Z
  profile, different contours, trailing travel/parking moves, and arc geometry remain distinct.
- Aircut now inserts a Safe-Z rapid to the start of a retained cutting pass if optimization creates a
  discontinuity, preventing an unintended diagonal or invalid arc start.
- The Dry Run UI reports how many repeated stepdown passes were skipped and explains the behavior inline.
- Added focused coverage for multi-depth, same-depth, reverse-direction, and distinct-contour cases.
- Extended coverage to native G2/G3-style arc passes and asserted that the live Aircut generator uses
  the stepdown collapse result.
- Verification: local browser QA loaded the new module with no console errors and showed the updated
  Aircut explanation. Focused coverage passed 3 files / 46 tests, then 2 files / 32 tests after the
  arc integration assertion; the full suite passed 31 files / 290 tests.

## 2026-07-14 - 2D / orthographic 3D workspace view

- Added an accessible 2D/3D segmented control to the canvas toolbar; the selected view is saved in
  browser storage and restores without changing job or machine state.
- Kept the existing top-down 2D projection unchanged and added a fixed orthographic 3D projection
  with no perspective scaling. Fit, pan, wheel zoom, pinch zoom, and the existing fit targets work in
  both modes.
- 3D rendering now uses each toolpath point's Z coordinate, including source/generated paths,
  recovery travel, recovery markers, and the live tool position. The machine table becomes an
  orthographic grid with X/Y/Z axes and Z-limit guides.
- Absolute machine-frame live Z is converted to the active work-zero Z frame before projection, so
  the live marker and work-relative toolpath share the same rendered height without changing XY.
- Added pure projection and persistence coverage. Browser QA confirmed 2D, orthographic 3D, Fit
  Active, Fit Table, accessible pressed state, and saved-view restoration. JavaScript syntax and diff
  checks pass; the full suite passes 31 files / 293 tests.

## 2026-07-16 - Dynamic Safe Z validation

- Replaced the job-start and Go To Work Zero `0..200 mm` acceptance range with a firmware-owned
  work-Z range calculated from the discovered Marlin machine limits and active home-relative work
  zero. A requested work Z is transformed back to machine Z before it can be sent.
- Safe Z rejects a value that would move down from the latest work position. Invalid requests return
  an error instead of being silently clamped to a different motion.
- `/api/machine/frame` publishes work minimum/maximum, current lift minimum, machine Z limits,
  mapping confidence, the active-work-zero tool-length reference, and configured tool-change park Z.
- Run, dry-run, recovery, Go To Work Zero, and Safe Jog controls consume the live range. Safe Jog
  converts the selected work Z back to its native G53 machine Z and firmware validates it against
  discovered limits.
- Tool-change park coordinates are revalidated when M6 is reached and again before the return
  sequence, protecting against stale settings after a machine-profile change.
- The development mock mirrors the dynamic work/machine transform and explicit rejection behavior.
  Added focused firmware and HTTP coverage.
- Verification: full suite passes 39 files / 328 tests. PlatformIO ESP32-CAM build succeeds at
  19.6% RAM and 70.7% flash.

## 2026-07-16 - Persistent firmware-owned tool-change state

- Expanded the SD active-job checkpoint to schema 2 with explicit M6 phases:
  `TOOL_CHANGE_REQUESTED`, `PARKING_FOR_TOOL_CHANGE`, `WAITING_FOR_TOOL`,
  `READY_TO_CONTINUE`, and `RESUMING`.
- The checkpoint now records the expected tool, M6 command and line, next line/byte offset, selected
  handling and Z-zero method, whether parking completed, the pre-park return position, whether Z
  zero completed, and tool/router confirmation state.
- Critical phase changes are written immediately rather than waiting for the normal two-second or
  4096-byte checkpoint cadence. A failed transition write blocks continuation with a runner error.
- Tool-change evidence is retained if the runner enters ERROR, while deliberate Stop and normal
  completion clear the live M6 phase.
- Continue now requires a separate operator checkbox for the intended router/spindle state. The
  firmware independently requires `routerReady: true`; a browser dialog alone cannot bypass it.
- Recovery checkpoint UI shows an interrupted M6 phase, expected tool, next line, parked status,
  Z-zero requirement, and router confirmation status.
- DEV MOCK and focused firmware/UI tests mirror the phase and confirmation contract.
- Verification: full suite passes 39 files / 328 tests. PlatformIO ESP32-CAM build succeeds at
  19.6% RAM and 70.8% flash.

## 2026-07-16 - Explicit Pause Safely, Stop Now, and Output Off semantics

- Renamed and explained the three operator controls consistently in the machine bar and Run panel:
  Pause Safely stops new streaming and waits for buffered movement with `M5` then `M400`; Stop Now
  sends `M5` then abrupt `M410`; Output Off sends only `M5` and does not stop motion.
- Stop Now now requires an explicit warning confirmation. After Marlin acknowledges the quickstop,
  firmware invalidates homing, work-zero, and position trust and publishes `positionValid: false`.
  The UI retains the last visible coordinates instead of presenting an invented zero position.
- Removed the misleading Stop failure fallback that sent `M5/M400` and marked the run stopped. A
  failed Stop endpoint now attempts only M5, warns that motion may continue, and refreshes status.
- DEV MOCK mirrors the M410 position invalidation. Added coverage for exact Pause/Stop command order,
  position invalidation, distinct UI wording, and the output-only failure fallback.
- Verification: full suite passes 39 files / 329 tests. PlatformIO ESP32-CAM build succeeds at
  19.6% RAM and 70.9% flash.

## 2026-07-16 - Single-operator PIN control lease

- Added a firmware-owned operator PIN stored only as a device-salted SHA-256 digest in NVS. Initial
  PIN setup is accepted only through the device Setup AP; repeated incorrect PIN attempts are
  rate-limited.
- Exactly one browser receives an HttpOnly SameSite controller cookie and a 45-second renewable
  lease. The public status endpoint shows the controller name, lease state, and whether the current
  browser is controller or read-only; no PIN hash or session token is exposed.
- Wrapped every state-changing machine, job, jog, work-zero, file, settings, WiFi, and restart route
  in the firmware authorization boundary. Status, telemetry, file listing, and downloads remain
  available to read-only clients.
- Added a persistent machine-bar claim/release and PIN-change panel. Other browsers visibly show
  who controls the machine; direct machine-bar motion and joystick controls are disabled while
  read-only, while local preview/navigation controls remain usable for inspection.
- OTA now additionally requires an idle machine and a separate PIN-confirmed two-minute unlock.
  Firmware upload consumes that unlock once rather than inheriting ordinary controller access.
- DEV MOCK mirrors claim, lease, owner visibility, read-only rejection, PIN change, release, and OTA
  unlock. Browser QA covered first PIN setup, the controller badge, release, and read-only motion
  blocking. Full automated verification passes 40 files / 334 tests.
- PlatformIO revalidation passes after correcting the handler callback type. The ESP32-CAM build
  uses 19.6% RAM (64,236 bytes) and 71.3% flash (1,401,681 bytes).

## 2026-07-19 - Glassmorphic "Aurora Glass" UI/UX skin

- Installed the custom `ui-ux-cr` (Cyber-Rage Design Intelligence Engine) assistant skill to `/config/plugins/ui-ux-cr`.
- Designed and implemented a new premium, high-readability glassmorphic theme called "Aurora Glass" (`aurora-glass`).
- Created a vibrant aurora mesh gradient body background and frosted translucent glass panels (`backdrop-filter: blur(16px)`).
- Applied rounded corners (`border-radius: 12px` and `16px`) to all panels, buttons, inputs, selects, and dialogs.
- Optimized design elements for touch safety and responsiveness across pad/tablet and mobile viewports.
- Registered the new skin in `www/lib/ui-skins.js` and added validation coverage to `test/ui/ui-skins.test.mjs`.
- Verified that all 42 test files and 350 test assertions pass successfully.

## 2026-07-23 - Remembered browser control without passive-view prompts

- Added a cryptographically random browser identity stored in browser `localStorage`. ESP32 stores
  only its device-salted SHA-256 digest and the last controller name in NVS.
- Added `/api/operator/reconnect`: after an ESP32 restart or lost cookie, the same remembered browser
  silently receives a fresh controller session without entering its name or PIN again. A different
  browser remains read-only and cannot restore that session by copying the visible controller name.
- Explicit Release Control now removes both the live session and the remembered-browser association.
- The global 423 monitor opens the claim panel only for a recent user control action; passive status
  and telemetry activity no longer puts the panel over the screen.
- Added a Cancel button that closes the claim/controller panel without claiming or releasing control.
- DEV MOCK mirrors claim, restart/reconnect, rejection of another browser, and remembered-state
  deletion. Full verification passes 42 files / 352 tests. ESP32-CAM build succeeds at 19.7% RAM
  (64,396 bytes) and 72.1% flash (1,417,129 bytes).

## 2026-07-23 - Restore Bounds/Aircut workflow and correct transformed bounds

- Diagnosed `ex2` from the SD logs and files. Its 506 × 506 mm cut area becomes a valid
  547.68 × 547.68 mm area at 5°, but `generatedRunBounds` incorrectly included the transformed
  parser origin attached to the initial Z-only move, producing a false Y minimum of -224.26 mm.
- Generated bounds now simulate the axes actually emitted by each G-code command. Internal parser
  coordinates on Z-only moves no longer appear as commanded X/Y travel; `ex2` now reports
  X 0..547.68 and Y 0..547.68 for both placement and generated execution.
- Ordinary active-run and preflight problems no longer skip ahead of the required
  Home → Zero → Bounds/Aircut → Cut sequence. Firmware recovery remains the only condition that can
  block the whole preparation sequence before those steps.
- A blocker that remains after physical verification now shows direct Update Run File or
  Review Placement & Preflight actions alongside Repeat Bounds Check and Run Full Aircut.
- Full verification passes 42 files / 354 tests. This is an SD web-asset change; firmware rebuild is
  not required.

## 2026-07-25 - Immediate firmware-owned job Stop (implementation)

- `/api/job/stop` now closes the SD stream, clears the streamed-command wait state, replaces any
  lower-priority sequence, and writes `M410` to UART directly from the request handler.
- `M5` remains on the asynchronous priority path and is sent only after the `M410` response.
- Stop invalidates the existing machine-frame and position trust immediately; Home All is the
  existing operation that restores trusted position.
- Job telemetry records whether `EMERGENCY_PARSER` was detected and exposes a warning when Marlin
  cannot guarantee immediate interruption. M115 discovery also logs the detected capability.
- Protocol/manual documentation and Stop UI wording now consistently describe `M410` then `M5`.
- DEV MOCK now preserves the asynchronous endpoint contract: Stop returns `STOPPING`, processes
  `M410` then `M5` independently of the caller, and reaches `STOPPED` or `ERROR`.
- Regression coverage checks long-command Stop ordering, no further file lines, fast acceptance,
  priority failure, lower-priority replacement, streamed ACK preemption, capability warnings, and
  the absence of movement segmentation/source rewriting.
- Verification passes: focused Stop coverage is 3 files / 67 tests; the full suite is 42 files /
  357 tests. The AI-Thinker ESP32-CAM PlatformIO build succeeds at 19.7% RAM (64,412 bytes) and
  72.1% flash (1,417,845 bytes).

## 2026-07-25 - Job workflow/history/recovery refactor design

- Keep firmware job telemetry as the source of truth for the live operation. Browser normalization
  treats active transition states and `PAUSED` as live; terminal `COMPLETED`, `STOPPED`, and `ERROR`
  describe the last outcome and normalize to an idle live operation.
- Keep `runHistory` immutable as the audit of Start Cut attempts. Historical outcomes never choose
  the current job's primary action.
- Add a normalized `recoveries` collection keyed by recovery id and original run id. Migrate eligible
  legacy terminal runs once per run id without removing `recoveryHistory` events or changing the run.
- Select recovery explicitly by recovery id. Recovery validation uses the referenced run identity,
  not the newest run or the current selected job by implication.
- Keep Home, Work Zero, Z Zero, Bounds Check, Aircut, history, and recovery controls persistent when
  live motion allows them. Workflow gates remain recommendations; file identity, generated output,
  bounds, and unsafe live motion remain hard execution blockers.
- Re-zeroing or changing placement/execution identity preserves history and marks dependent
  verification/authorization stale. Start authorization stays short-lived and is invalidated by
  relevant setup changes.

## 2026-07-25 - Live readiness separated from historical outcomes

- Job readiness now derives `run.liveStatus` only from firmware telemetry. Firmware terminal
  `STOPPED`, `COMPLETED`, and `ERROR` values normalize to live `idle` while remaining visible as
  `run.lastOutcome`.
- Removed the historical `Review Last Run` primary-action override. A valid selected job continues
  to Start Cut after an older stopped/error run.
- Saved recoveries and run history are secondary actions, and active recoveries get a separate badge.
- Added readiness regressions for idle-after-stop, terminal firmware telemetry, running, paused, and
  historical errors.

## 2026-07-25 - Multi-recovery metadata and per-run planning

- Added an idempotent `recoveries` collection migration for every eligible stopped, interrupted, or
  error run with a stable run id. Existing `recoveryHistory` remains the action audit.
- Recovery planning accepts an explicit recovery id/run id and can evaluate an older interruption
  after newer completed history entries.
- Abandon and Mark Finished are recovery status transitions that remove an item from the active list,
  append an audit event, and never rewrite or delete the original run.
- New and loaded Job JSON normalizes the collection, and terminal run synchronization creates any
  missing saved opportunity before metadata is persisted.

## 2026-07-25 - Persistent and repeatable setup tools

- Added one persistent readiness tool row for Work Zero, Z Zero, Bounding Box, Aircut, Preflight,
  and Recovery/History. Completed actions change to `Again` labels instead of disappearing.
- The tool row is disabled only while live machine motion/transition state makes setup unsafe; the
  recommended Next Action no longer controls tool visibility.
- Work/Z zero changes now preserve the completed verification record for audit, expose it as stale,
  stale completed dry-run results, and invalidate Arm and temporary start authorization.
- Placement/execution-target changes now also preserve stale verification evidence and invalidate
  temporary start authorization in addition to the existing generated-file and dry-run safeguards.

## 2026-07-25 - Recovery collection UI and dashboard separation

- Recovery now opens as a collection of saved opportunities rather than implicitly using only the
  latest run. Operators can explicitly Review/Resume, Abandon Recovery, or Mark as Finished.
- Recovery planning and saved-zero lookup follow the selected recovery's original run id.
- The dashboard reports saved recovery count and links to the drawer as a secondary action.
  Stopped/error telemetry and historical interruptions no longer replace the dashboard's current-job
  Next Action.

## 2026-07-25 - Durable Stop checkpoint handoff without a global workflow lock

- A production interruption checkpoint is imported into its recorded Job JSON even when another job
  is selected. Missing metadata is created conservatively with the checkpoint's exact execution
  identity, so unverifiable details remain recovery blockers instead of being guessed.
- Firmware evidence is acknowledged only after the target Job JSON upload succeeds. This releases
  the stream lock while retaining the older recovery for later.
- Added explicit older-run history updates so checkpoint import cannot rewrite a newer run record.
- Pending import remains visible without blocking Start, Home, or ordinary setup tools. Dashboard
  terminal telemetry displays the physical machine as Idle.

## 2026-07-25 - Workflow/recovery documentation

- Updated the metadata contract for `liveStatus`, `lastOutcome`, immutable run attempts, normalized
  `recoveries`, closed recovery states, and idempotent legacy migration.
- Updated operator flow and recovery safety docs for persistent setup actions, explicit older
  recovery selection, cross-job checkpoint preservation, and material/fixture confirmation.

## 2026-07-25 - Workflow/history/recovery final verification

- Full automated verification passes 42 test files / 366 tests.
- JavaScript syntax checks pass for `www/preview.js` and `www/app.js`; `git diff --check` passes.
- No firmware movement code changed. Existing active-file identity, streaming, checkpoint, motion
  limit, tool-change, and production-resume suites remain green.

## 2026-07-25 - Readiness blocker audit follow-up

- Missing, stale, or failed Bounding Box/Aircut is now a visible warning and recommended primary
  action, not a hard execution-identity blocker. The existing deliberate skip path remains usable.
- Work/Z zero, Arm/start authorization, generated output identity, active path, and fingerprint
  constraints remain hard blockers.

## 2026-07-26 - Interrupted-job global start blocker removed

- Removed the recovery-checkpoint start rejection from firmware job, test-motion, and production
  resume handlers, the DEV MOCK runner, and browser readiness hard blockers.
- Machine Bar now reports `RECOVERY AVAILABLE`; Preflight remains READY when all current-job
  requirements pass.
- Same-source Start now offers Review / Resume Recovery, Restart From Beginning, and Cancel.
  Restart appends a fresh-restart audit event, creates a separate run attempt, and preserves the
  older recovery and immutable stopped run.
- Added regressions for same-source restart preservation, cross-job start while Job A evidence
  remains available, idempotent legacy recovery migration, explicit UI choices, and removal of the
  legacy global-gate message.
- Final verification passes 42 test files / 369 tests, JavaScript syntax checks for Preview, App,
  Machine Bar, and DEV MOCK, `git diff --check`, and the AI-Thinker ESP32-CAM PlatformIO build
  (19.7% RAM, 72.1% flash).

## 2026-07-26 - Project-derived Safe Z

- Added one versioned `projectSafeZ` metadata object containing workpiece height, Work Zero
  reference, derived stock-top work Z, operator clearance, and derived effective Safe Z.
- The shared calculation is `effectiveSafeZ = stockTopWorkZ + safeZClearanceMm`: stock-top Work
  Zero derives `stockTopWorkZ = 0`, stock-bottom derives it from workpiece height, and custom
  reference requires an explicit stock-top work Z.
- Preview exposes the stock model and one editable clearance. Unknown geometry remains unresolved;
  changing any input stales Bounds/Aircut/validation/recovery evidence and invalidates Arm/start
  authorization. Changing the Work Zero reference also invalidates the active saved Work Zero.
- Start Job, Bounding Box, Aircut, Safe Jog, Go To Work Zero, Toolless Resume, Production Resume,
  and recovery/return lifts now consume the same derived value. Safe Jog maps the work target to
  `G53` machine Z through the active Work Zero; unreachable targets are rejected without clamping.
- Firmware and DEV MOCK reload Job JSON, recompute the formula, and reject unresolved, stale, or
  mismatched browser targets. Machine-level Safe Z remains only as the explicit no-project manual
  jog fallback.
- Legacy absolute values migrate idempotently to clearance when stock top is known; otherwise the
  job stays unresolved rather than inferring safety from toolpath maximum Z. New run and recovery
  records preserve a Safe Z snapshot while recovery is revalidated against the current project.
- Added focused browser, recovery, mock-runner/server, and firmware contract regressions. Final
  verification passes 43 files / 383 tests, all relevant JavaScript syntax checks, `git diff
  --check`, and the AI-Thinker ESP32-CAM PlatformIO build (19.7% RAM, 72.3% flash).

## 2026-07-26 - Final Pause, Resume, Stop, and M5 safety semantics

- Replaced the ordinary `PAUSED` path with explicit `PAUSING -> PAUSED_INTACT -> RESUMING`.
  Tool-change `PAUSED` remains separate. Direct Resume is valid only while the intact stream has
  not been invalidated; manual movement transitions through `STOPPING` to `RECOVERY_REQUIRED`.
- Added conservative Marlin realtime-hold discovery. Firmware enables `P000/R000` only when M115
  explicitly reports realtime reporting commands together with `EMERGENCY_PARSER`; the capability
  is persisted and exposed through machine/job telemetry.
- Realtime Pause preserves the open stream and any in-flight acknowledgement. Fallback Pause waits
  for the current command, sends `M400` at the confirmed command boundary, and reopens at the exact
  next-unsent byte on Resume. Neither path sends M5/M410, lifts Z, parks, rewrites, or segments
  source G-code, and the cutter remains running.
- Manual motion requested from `PAUSED_INTACT` first invalidates direct Resume, sends M410, persists
  the interrupted snapshot before clearing frame trust, sends M5 only after quickstop completion,
  and exposes the normal Recovery workflow.
- Stop remains immediate stream cancellation with ordered M410 then M5. Primary standalone M5
  controls were removed; firmware and DEV MOCK reject active/recovery M5, while the idle Advanced
  Manual terminal retains it.
- Pause, Resume, and Stop use a real 500 ms hold without confirmation modals. Readiness, history,
  Preview, Machine Bar, mocks, protocol, architecture, recovery, and operator test documentation
  now use `PAUSED_INTACT` and `RECOVERY_REQUIRED`.
- Added and updated regression coverage for realtime/fallback holds, exact Resume, tool-change
  separation, manual-motion invalidation evidence, M410/M5 ordering, active M5 rejection, hold
  controls, and recovery/history classification.
- Final verification passes 43 test files / 387 tests, `git diff --check`, and the AI-Thinker
  ESP32-CAM PlatformIO build (19.7% RAM, 72.5% flash).

## 2026-07-27 - Preview first-open metadata implementation

- Fixed Preview startup calling the missing `jobIsLive()` helper before loading the source file.
- Preview metadata loading now distinguishes loaded, missing (HTTP 404), invalid, and non-404/error
  results. Invalid or unavailable metadata shows a non-fatal warning and is not overwritten.
- A genuine 404 now initializes the existing full schema-3 source-mode job, parses the source,
  merges complete preview/fingerprint data, and uses a create-with-conflict-reload save path.
- Preview now uses the shared canonical hash-based job-path resolver; `/gcode/KAR.gc` remains
  `/jobs/gcode_KAR.gc-7390e1b6.job.json`.
- Added focused regressions for canonical identity, 404, invalid JSON/API objects, wrong ownership,
  old schema, HTTP 403/409/500, network failure, bootstrap ordering, conflict reload, and persisted
  state preservation, including keeping a valid generated active run selected. Focused verification
  passes 4 files / 43 tests.
- Final automated verification passes 44 test files / 400 tests. JavaScript syntax checks for
  `www/preview.js` and `www/lib/preview-job-metadata.js` and `git diff --check` also pass.

## 2026-07-27 - Phase 1 Full-Duplex WebSocket Protocol & State Foundation

- Implemented versioned full-duplex WebSocket application protocol (`protocolVersion: 1`) shared across firmware, browser UI, dev mock server, and test suites.
- Added common packet envelope (`protocolVersion`, `type`, `seq`, `ack`, `bootId`, `stateRevision`).
- Implemented independent monotonic sequence counters per direction, assigned only upon wire transmission.
- Implemented piggybacked ACKs, ESP boot ID tracking, and browser mirrored state invalidation when `bootId` changes.
- Defined firmware-side `ControllerAdapter` boundary and controller-independent authoritative state schema normalizing `system`, `connection`, `controller`, `machine`, `job`, `jog`, and `control`.
- Implemented 0.001 mm floating-point tolerance on coordinate change detection to suppress parser noise.
- Added browser-to-ESP wall-clock synchronization derived from browser UTC timestamp, preserving independent monotonic uptime for motion timing.
- Added idle `sync` heartbeat broadcast after 3000 ms of inactivity over FreeRTOS queue without blocking the main execution/cutting loop.
- Implemented full protocol parity and HTTP upgrade handler in `dev/mock-server.mjs`.
- Removed non-port-80 WebSocket restrictions from `www/telemetry.js`.
- Added dedicated transport protocol Vitest test suite (`test/firmware/transport-protocol.test.mjs`). All 45 test files / 411 tests pass cleanly.

### Temporary Coexistence & Deletion Manifest Checklist

The following legacy endpoints and assumptions are retained temporarily during Phase 1 for safety and will be removed in subsequent migration phases:

- `[ ]` Health HTTP polling (`GET /api/health` polling fallback)
- `[ ]` Job status HTTP polling (`GET /api/job/status` fallback polling)
- `[ ]` Jog status HTTP polling (`GET /api/jog/status` fallback polling)
- `[ ]` Marlin log HTTP fallback (`GET /api/marlin/log?after=...`)
- `[ ]` Read-only WebSocket assumptions in legacy event handlers
- `[ ]` Legacy telemetry event channel aliases (`job`, `jog`, `position`)
- `[ ]` Hardcoded WebSocket port/origin behavior in legacy docs
- `[ ]` Duplicated legacy state serializers (`telemetrySnapshotData()`)

