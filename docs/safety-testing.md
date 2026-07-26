# Safety Testing

## Coordinate-frame regression test

First hardware test must use router/spindle off and preferably no cutter:

1. Home All and verify status shows machine and work coordinates separately.
2. Jog to approximately machine X100/Y500 and leave enough Z clearance for Safe Z.
3. Set Work Zero. Work must report about X0/Y0/Z0 while machine remains near X100/Y500.
4. Reload Preview. WORK ZERO and job geometry must appear at the saved machine position.
5. Run Bounding Box and verify it follows that placement and restores captured X/Y/Z.
6. Arm and Start. The Marlin Start preamble must contain no G92.
7. Confirm file X0/Y0 remains at the saved physical work zero and does not move to Home.
8. Home All again. The old job must block until saved zero is restored or a new zero is set.

## Streaming and large-file separation

1. Verify normal job execution reads through `File`/`readNextCleanJobLine` and never builds a RAM
   string containing the complete G-code file.
2. Run a G-code file above the 4 MiB preview warning threshold in DEV MOCK or a no-cutter fixture.
   Confirm the browser shows a clear memory/performance warning.
3. Confirm that warning does not change the selected `activeRun.path` and does not add a firmware
   job-start rejection.
4. Confirm generated test/resume streams above their separate 2 MiB safety cap are rejected before
   motion, without changing normal job execution policy.

## Machine profile and EEPROM settings

1. Boot with Marlin attached and verify the cached profile appears immediately, then M115 refreshes
   firmware identity, capabilities, and `area.full` / `area.work` while idle.
2. Start a job or jog and verify machine refresh/apply/M500 return busy rather than sharing UART.
3. Confirm Advanced Manual M5 remains available only while discovery, job, jog, and automatic
   motion are idle.
4. Read M503 and verify M92/M203/M201/M204 fields match Marlin output; M211 must visibly report ON,
   OFF, or unrecognized.
5. Apply a harmless test value, verify M503 changes, restart Marlin without M500, and verify the
   value reverts.
6. Apply again, press `Save applied changes to Marlin EEPROM (M500)`, restart Marlin, and verify the
   value persists.
7. Restore the original value and save it. Treat M92 as high risk because it changes physical travel
   per commanded millimeter.

## Desktop Mock Layer

`npm run dev:mock` provides a no-hardware workflow layer before SD-card or machine testing. It
serves the production `www/` UI but routes APIs to local MockSD, MockMarlin, and MockJobRunner
components.

Automated mock coverage verifies:

- path traversal rejection and persistent SD file operations
- M114/G92 position behavior, M5, M220, and G0/G1 state
- X/Y/Z soft-limit errors plus unexpected file/manual G28/G53 rejection
- explicit firmware-internal Safe Jog `G53` movement to the clamped machine Z ceiling after G92
- exact source/generated active-run streaming with no silent source fallback
- stale or missing generated run blocking
- completion, intact pause/resume, stop ordering, active-job M5 rejection, feed override, and error
  status
- core HTTP compatibility for UI, files, commands, job start, and status

Mock tests reduce iteration time but do not replace real-machine tests. They do not model inertia,
step loss, acceleration, electrical faults, router behavior, endstop wiring, or browser/WiFi failure.
Use the visible `DEV MOCK - NO REAL MACHINE` badge to distinguish simulation from hardware.

## Core Rule

Any code path that can move the tool, change coordinate zero, start or resume a job, transform
G-code, or alter live feed must have tests before it is trusted.

This project does not replace a physical emergency stop. Software stop is not a physical emergency
stop. UI, browser, ESP32 firmware, WiFi, serial communication, and Marlin can fail.

Movement-related code is safety-critical. New movement logic must be tested with fake or simulated
Marlin before being used on real hardware. Real machine testing must start with the spindle/router
off and the tool safely above material.

## Travel Speed Checks

- Read M503 and verify the displayed M203 X/Y/Z values match Marlin configuration.
- Confirm selectable XY travel does not exceed the slower X/Y M203 or the 100 mm/s UI ceiling.
- Confirm bounding-box Z moves use F400 and XY moves use selected travel feed.
- Confirm job start sends Safe Z at F400, waits with M400, then sets G0 feed before file lines.
- Confirm file G1 feed values and feed override behavior remain unchanged.

## Start Preamble Tests

Test that:

- `G54` is sent before `G92` in apply-current-position-as-work-zero mode.
- `G92 X0 Y0 Z0` is only sent when explicitly requested and confirmed.
- Use-active-work-zero mode does not send `G92`.
- Start never sends `G28`.
- File streaming starts only after the preamble completes.
- `M220` start override is applied before streaming when configured.

## Pause, Resume, Stop, And M5 Tests

Test that:

- Pause stops new file lines immediately.
- With explicit realtime reporting plus Emergency Parser capability, Pause sends `P000`, enters
  `PAUSED_INTACT`, leaves the cutter running, and sends no M5/M410/Z/park command.
- Without explicit realtime capability, Pause shows pending, finishes the current command, waits
  with `M400` at the acknowledged boundary, and never segments or rewrites G-code.
- Direct Resume from `PAUSED_INTACT` sends `R000` only for a realtime hold, preserves the original
  in-flight acknowledgement, and performs no modal setup or repositioning.
- A manual-movement request invalidates direct Resume before moving, persists the interrupted
  snapshot, executes M410 then M5, clears frame trust, and enters `RECOVERY_REQUIRED`.
- Stop stops new file lines immediately.
- Stop transmits M410 first and M5 only after motion has stopped.
- Standalone `M5` is rejected throughout active, intact-paused, resumable, stopping, and recovery
  states, and is absent from primary job controls.
- Pause, Resume, and Stop require a 500 ms hold and show no confirmation prompts.
- HTTP response for Pause/Stop returns quickly and state changes to `PAUSING`, `PAUSED_INTACT`, or
  `STOPPING`.

## Feed Override Tests

Test that:

- `M220 S<percent>` is sent.
- Range `10` to `200` is enforced.
- Stop has higher priority than feed override; Pause/Resume own their stateful transport path.
- New jobs default or reset to `100` unless job config says otherwise.
- Feed override does not change router RPM and the UI says so.

## Goto Work Zero Tests

Test that:

- Goto X0 only sends safe command for X.
- Goto Y0 only sends safe command for Y.
- Goto Z0 is clearly separate.
- Goto ALL must not plunge through material.
- Safe return lifts to safe Z before XY movement.
- Safe Z is not zero or negative.
- Movement is not absurdly fast or absurdly slow.

## Homing Tests

Test that:

- Home X/Y sends `G28 X Y`.
- Home Z sends `G28 Z`.
- Home All sends `G28`.
- Homing is disabled during `RUNNING`.
- Homing requires confirmation.
- Home All requires stronger confirmation.
- Homing is never automatically triggered by job start or resume.

## Joystick Tests

Test that:

- Joystick is disabled if firmware jog API is unavailable.
- Joystick uses firmware-backed deadman.
- Browser-only direct movement loops are not used for analog jog.
- `pointerup`, `pointercancel`, window blur, and visibility hidden stop jog.
- No update for 500 ms stops jog.
- Safe Jog lifts Z before XY movement by default.
- Direct XY jog requires explicit confirmation.
- Maximum XY/Z speed values are inside configured safe ranges.
- Movement ticks are small enough to be controllable, not long `G0` moves.
- Repeated pointer gestures before delayed Z restore retain the first captured work Z.
- Window blur or visibility loss sends jog stop only when jog is active; an idle page must not emit
  M410/M5 merely because browser focus changed.

## Go To Work Zero Tests

Test that:

- only X0, Y0, and XY0 targets are accepted
- active job, jog, and OTA states reject movement
- Safe move is enabled by default and requires positive bounded Safe Z
- safe sequence lifts Z before selected XY axes move
- X0 does not alter Y and Y0 does not alter X
- Z remains at Safe Z after the move and is never automatically lowered
- direct-at-current-Z mode has a stronger browser confirmation
- Marlin error, alarm, or missing acknowledgement aborts remaining commands
- no G92, G28, M3, M4, Z0, homing, or automatic zero restore appears in the endpoint

## Toolpath Transform Tests

Test that:

- Rotation by arbitrary angle transforms X/Y correctly.
- Bounds after rotation are correct.
- Chosen origin/anchor normalizes the generated run file correctly.
- Small negative offsets such as `X -2` can be fixed by origin normalization.
- Generated placement transforms and fits every raw travel, lead-in, and cutting move consistently.
- Generated run file has no unexpected workspace, zero, or homing commands.
- `G90` absolute mode is handled.
- `G91` relative mode is rejected or explicitly unsupported for transform.
- `G53` machine coordinates are rejected.
- `G92` inside the source file is rejected or flagged as unsafe.
- `G2` / `G3` handling is tested for I/J and R geometry, preview bounds, and preserved transformed
  arc commands.

## Generated Run File Tests

Test that:

- Original G-code remains unchanged.
- Generated file is written separately under `/jobs/generated`.
- `job.json` references `generatedRunPath`.
- `activeRun.path` is the execution truth for Preflight, Dry Run, Arm, Start, and Run History.
- ESP32 streams the generated file, not the original, when placement transform is active.
- The UI never shows transformed placement while Start Job uses the original source path.
- Missing, stale, pending, or invalid generated files block Dry Run, Arm, and Start Job.
- Old source-only job JSON derives source-mode `activeRun` metadata without deleting work zero,
  tool zero, dry-run, arm, or history fields.
- Arming stores active run mode/path/fingerprint and changing any of them makes the arm state stale.
- Compatible fallback forms (`size+fnv1a` and `size+fnv1a+cyrb53`) match only when size and FNV-1a
  agree; tests also prove changed size or FNV-1a remains blocked.
- Generated file starts with a safe deterministic preamble.
- Generated file does not contain thumbnail or metadata garbage.
- Generated file never contains accidental ultra-fast feed values.

## Time Estimate Tests

Test that:

- Segment lengths are calculated.
- Feed values are respected.
- Feed override changes effective estimate.
- Estimated time is labelled approximate.
- Actual run duration can be stored later.

## Resume And Recovery Tests

Test that:

- Job runner records last sent line and last known position.
- Interrupted run is stored in run history.
- Resume does not start exactly in the middle of a dangerous cut by default.
- Resume candidate is a previous safe-Z point.
- Resume preamble lifts to safe Z, moves XY at safe height, then descends slowly.
- Resume requires confirmation of same work zero, same Z zero/tool, fixed material, and trusted
  machine position.
- Resume is disabled or strongly warned if machine was powered off or position trust is lost.

## Zero History Tests

Test that:

- Every `G92 X0 Y0 Z0` creates a work-zero history entry.
- Every `G92 Z0` creates a Z-zero history entry.
- Zero entries have timestamps.
- Zero entries link to runs that used them.
- UI can show whether a zero was used by completed, interrupted, or unused jobs.
- Previous zero can be selected as job zero.
- Restoring zero requires confirmation and clearly explains what will happen.
- Selecting a previous zero in the current UI changes only metadata and does not send movement or
  `G92`.
- Run history links to active work/Z zero IDs and updates zero `usedByRuns`.

## Marlin Message And Log Tests

Test that:

- Missing HTTP routes and other WebServer errors never appear on the Marlin UART.
- SD rescue update diagnostics are written to `/logs/update.log`, never UART0.
- With one visible UI client, M154 uses 2 seconds while idle and 1 second during job motion.
- Closing/hiding the last UI eventually sends M154 S0 without interrupting an active command.
- A physical Marlin joystick move while idle changes the UI position without browser M114 polling.
- Motion telemetry contains only movement command events; Pause/Resume and Stop remain HTTP
  controls.
- G2/G3 marker animation follows the arc and creates no additional network requests per frame.

- Marlin responses are captured.
- Commands and responses are distinguishable.
- Critical Marlin errors create a global visible warning.
- Ring buffer does not grow without limit.
- Logs can be opened from drawer or log page.
- Error/alarm is not hidden only in terminal.

## Movement Safety Invariants

Hard rules:

1. No job start may send `G28`.
2. No resume may send `G28`.
3. No generated run file may contain unexpected `G28`.
4. No automatic restore may assume position after power loss.
5. No XY rapid movement to a resume/work-zero point unless Z is first lifted to safe height.
6. No Z descent to cutting depth should happen at uncontrolled rapid speed.
7. No software stop is described as a physical emergency stop.
8. No analog joystick movement without firmware deadman.
9. No source G-code transform if unsupported modal commands are present.
10. No hidden coordinate-system changes.

## Testing Implementation Guidance

Prefer unit tests for browser-side parser, `ToolpathModel`, transform, and time estimate logic.

Prefer fake Marlin or mock serial tests for firmware job runner state machines.

Fixture G-code files should include:

- Simple square.
- File with `G54`.
- File with `X -2` offset.
- File with parking move far from cut bounds.
- File with `G2` / `G3` arcs.
- File with `G91` that should be rejected for transform.
- File with `G92` inside source that should be flagged.

Use golden expected outputs for generated run files. Automated tests should not require real CNC
hardware.

## Current Automated Test Package

The first automated test package uses Vitest for browser-side pure logic.

Run it with:

```powershell
npm.cmd test
```

Current coverage:

- `www/lib/workbench-ui.js`
  - phone edge-drawer, tablet overlay, and desktop sidebar layout selection
  - drawer open/close state does not mutate job or `activeRun`
  - source ORIGINAL and valid generated GENERATED badges
  - stale/invalid generated output remains on generated `activeRun.path` and requires Update Run File
  - visual layer and placement drawer state contains no movement commands
  - Start Cut uses its hold policy while Pause, Resume, and Stop use a 500 ms hold
  - no G28, automatic G92, homing, or restore metadata
- `www/lib/ui-skins.js`
  - bundled manifest validation and sprite symbol completeness
  - semantic icon role resolution and Default fallback
  - accessible SVG/use markup
  - selected skin localStorage persistence
  - manifest/icon/theme failure fallback policy
  - critical controls retain text and ARIA labels
  - workbench/status/canvas consume theme variables
  - no movement, homing, G28, automatic G92, M3, or M4 behavior

- `www/lib/gcode-core.mjs`
  - comment stripping
  - `G20` / `G21`
  - `G90` / `G91`
  - `G54` as default workspace
  - `G55+` as non-default workspace
  - `M3` / `M4` spindle or laser enable detection
  - X/Y/Z bounds
  - feed `F` min/max/count
- `www/lib/job-core.mjs`
  - feed override clamping and effective feed range
  - preflight READY/WARNINGS/NOT_READY classification
  - work-zero readiness checks
  - Current Job next-action ordering
- `www/lib/toolpath-model.js`
  - shared ToolpathModel parser
  - raw travel, cut, and placement bounds
  - parking move isolation from cut bounds
  - G54/G55, G91, G53, source G92, cutter compensation, canned-cycle warnings
  - feed stats and approximate estimated time
  - SVG thumbnail generation
  - preview metadata merge without erasing work/tool zero or arm data
- `www/lib/job-history.js`
  - zero history entries for `G92 X0 Y0 Z0` and `G92 Z0`
  - active work/Z zero metadata selection
  - run history creation, terminal state updates, and zero `usedByRuns`
  - merge safety for preview, arm, dry-run, feed override, work zero, and tool zero
  - safety invariant that previous-zero selection does not create a movement action
- `www/lib/toolpath-transform.js`
  - arbitrary-angle XY rotation
  - cut-bounds and raw-bounds origin normalization
  - parking/travel moves excluded from default cut-bounds placement
  - generated `.run.gc` preamble safety
  - rejection of transform-unsafe commands such as `G91`, `G53`, source `G92`, and `G55+`
  - generated run metadata merge without erasing job setup/history fields
- `www/lib/job-active-run.js`
  - identity/default placement uses source
  - non-default placement implies generated active-run intent
  - generated selection after generation requires valid generated file validation
  - stale source or transform fingerprints block generated selection
  - placement changes invalidate arm/dry-run state and block workflow until run file update
  - reset/source selection preserves existing job metadata
  - validation and metadata selection do not create movement commands
- `www/lib/job-readiness.js`
  - source jobs progress through Set Work Zero, Set Z Zero, Dry Run, Arm, and Start Cut
  - transformed jobs with missing, stale, pending, or invalid generated output show Update Run File
  - valid generated jobs continue through the same zero/dry-run/arm/start gates
  - stale dry-run or arm metadata points back to the correct next action
  - running and paused live states override setup actions
  - stopped/interrupted runs show Review Last Run without implementing resume execution
  - readiness metadata does not encode movement, homing, spindle-on, or zero-setting commands
- `www/lib/job-history.js`
  - run history records `sourceGcodePath`, `activeRunMode`, `activeRunPath`, and generated
    provenance fingerprints

Fixtures are under `test/fixtures`. Tests are under `test/ui`.

Next automation steps should move more production UI logic into these pure modules instead of
duplicating safety decisions in DOM-heavy page scripts.

## Canvas Workbench Manual Checks

Phone portrait (390x844 or similar):

1. Confirm body does not scroll and canvas fills the remaining screen below the fixed top bars.
2. Open Tools and Readiness; confirm each overlays the canvas and leaves an edge visible.
3. Close with button, scrim, and outward swipe.
4. Pan with one finger and mouse drag; pinch and wheel zoom; double tap fits active run.
5. Toggle every visual layer and confirm no API/machine command is sent.
6. Change rotation while Tools is open and confirm the graphical path updates immediately.
7. Confirm stale generated state shows Update Run File and never silently switches to source.
8. Confirm Start Cut requires its hold; Pause, Resume, and Stop require 500 ms holds without modal
   confirmation, and no primary M5 button exists.

Tablet/desktop:

1. Confirm the same drawer content is used with wider overlay/sidebar dimensions.
2. Confirm canvas remains dominant and no separate desktop-only workflow has appeared.
3. Verify mouse wheel zoom, drag pan, toolbar fit actions, and keyboard hold-to-start.

Remaining UI TODOs:

- Add a richer current-position feed when firmware status exposes structured XY/Z consistently.
- Consider optional previous-zero markers after their machine/work coordinate meaning is explicit.
- Add browser integration tests with mocked ESP APIs and representative generated/source jobs.
- Consider dynamic `/www/skins` discovery so user skins do not require a static registry entry.

## Manual Hardware Test Policy

### Browser and network independence

- Start a harmless router-off stream, then lock the phone or disable its WiFi for at least 30
  seconds. Motion must continue and commands must not acquire TCP-timeout-sized gaps.
- Restore the browser. WebSocket reconnect must receive a current snapshot; missing intermediate
  animation frames are acceptable.
- A full telemetry queue must drop UI updates. It must never pause, stop, or delay the next G-code
  line after Marlin `ok`.

Before testing real movement:

1. Router/spindle off.
2. Tool above material.
3. Hand near physical emergency stop.
4. Start with very low feed override.
5. Test air moves first.
6. Verify `M5`, Pause, and Stop before cutting.
7. Verify work zero and Z zero.
8. Verify generated run bounds.
# Motion-only Recovery Test

Start with no cutter/router/laser installed or with it positively disabled.

1. Use a known small job and create a stopped/interrupted mock run.
2. Confirm Recovery is blocked while position is untrusted.
3. Home the machine or explicitly confirm it was homed in this powered session.
4. Verify activeRun fingerprint and zero IDs match the interrupted run.
5. For generated output, make validation stale and confirm recovery blocks without source fallback.
6. Verify the resume marker and dashed Safe-Z path are inside the table.
7. Execute Move Axes to Resume Point with a physical emergency stop within reach.
8. Confirm M5 is first, Z lifts before XY, and the machine remains at Safe Z.
9. Confirm no G28, G53, G92, M3, or M4 is sent.
10. Confirm recoveryHistory records the test while the original run remains interrupted.
11. Reboot firmware and confirm position trust clears before further recovery motion.

This does not validate cutting resume. There is no cutting-depth descent or remaining-file stream.

## Toolless Resume Test

Only perform this test with no cutter/router installed and spindle/laser output positively off.

1. Verify Recovery V0 selects the expected previous safe point.
2. Verify activeRun identity, generated validation, zero IDs, and position trust all match.
3. Confirm displayed first Z descent and minimum remaining Z are inside configured limits.
4. Confirm commands start M5/G21/G90/G54 and lift Z before XY reposition.
5. Confirm no generated command contains G28, G53, G92, M3, or M4.
6. Start with the explicit no-cutter checkbox and single confirmation.
7. Verify remaining X/Y/Z follows preview and spindle output stays off.
8. Press M5 and confirm no further browser path commands are sent.
9. Repeat with Stop; confirm M410+M5 is requested and position trust clears.
10. Confirm history records `toolless-resume-test` while the original run remains interrupted.

This is not production cutting resume. Do not repeat it with a cutter installed.

Aircut and Toolless execution should also verify the firmware-owned stream transport:

1. Confirm the browser uploads one temporary file under `/jobs/generated` and sends one
   `/api/test-motion/start` request rather than one `/api/cmd` request per movement.
2. Confirm valid XY arcs remain native `G2/G3` commands with I/J and feed.
3. Confirm M3/M4/G28/G53/G92 files are rejected before the first command reaches Marlin.
4. Confirm Aircut rejects any Z value different from configured Safe Z.
5. Confirm Pause/Resume and Stop remain responsive during a long stream; active-stream M5 is
   rejected.
6. Confirm `/api/job/status` reports progress and `streamMode` without changing normal run history.

## Guarded Production Resume Test

Before production testing, test Saved XY Work Zero Restore without a cutter: capture a zero, restart,
Home All, and confirm Safe machine Z occurs before G53 XY. Partial homing, M92 mismatch, missing
counts, active motion, and out-of-bounds XY must block. Confirm only G92 X0 Y0 is sent, Z zero is
unchanged, and the original zero ID receives the restore audit entry.

Only test with material secured, a known small fixture, and the physical emergency stop available.

1. Confirm the exact `activeRun.path` and fingerprint match the interrupted run; generated output
   must be valid and must never fall back to source.
2. Confirm changed work zero blocks with the XY/material-origin warning.
3. If Z zero changed after a deliberate tool replacement or re-touch, confirm both extra Z
   acknowledgements are required before proceeding.
4. Complete all six production checklist items and verify target XY, Safe Z, first descent, minimum
   Z, remaining distance, and estimated time.
5. Run Phase 1 and verify exactly M5, modal setup, Safe-Z lift, XY reposition, and M400. It must not
   descend into the cut.
6. Start and verify the router manually. The pendant must not send M3 or M4.
7. Check the manual-router checkpoint, then hold the final action for 1.5 seconds.
8. Verify the browser uploads one `.production-resume.gc` file and sends one
   `/api/recovery/production/start` request; it must not send cutting lines through `/api/cmd`.
9. Disconnect the browser/WiFi during a no-cutter fixture test and verify firmware continues its
   already-authorized Phase 2 stream. Reconnect and verify status/history reconciliation.
10. Verify Phase 2 follows only the controlled remaining ToolpathModel X/Y/Z path and no pre-resume
   lines.
11. Verify no phase sends G28, G53, G92, M3, or M4 and no automatic homing/zero restore occurs.
12. Verify Pause/Resume and Stop remain firmware-owned controls while connected and active-stream
    standalone M5 is rejected.
13. Confirm a separate `production-resume` event records checklist, activeRun, resume point, Safe Z,
    Z-zero change acknowledgement, result, and reason while the original run stays interrupted.

Manual router control remains operator-owned. Phase 2 command sequencing is firmware-owned, but
power-loss recovery and durable on-device recovery history are not implemented. Test without a
cutter first before considering any real cutting-resume trial.
