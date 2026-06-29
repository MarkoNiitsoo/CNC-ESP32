# Safety Testing

## Core Rule

Any code path that can move the tool, change coordinate zero, start or resume a job, transform
G-code, or alter live feed must have tests before it is trusted.

This project does not replace a physical emergency stop. Software stop is not a physical emergency
stop. UI, browser, ESP32 firmware, WiFi, serial communication, and Marlin can fail.

Movement-related code is safety-critical. New movement logic must be tested with fake or simulated
Marlin before being used on real hardware. Real machine testing must start with the spindle/router
off and the tool safely above material.

## Start Preamble Tests

Test that:

- `G54` is sent before `G92` in apply-current-position-as-work-zero mode.
- `G92 X0 Y0 Z0` is only sent when explicitly requested and confirmed.
- Use-active-work-zero mode does not send `G92`.
- Start never sends `G28`.
- File streaming starts only after the preamble completes.
- `M220` start override is applied before streaming when configured.

## Priority Command Tests

Test that:

- Pause stops new file lines immediately.
- Stop stops new file lines immediately.
- `M5` is accepted during `RUNNING`, `PAUSING`, and `PAUSED`.
- Pause, Stop, and `M5` do not wait behind normal file streaming.
- Pause does not show "Marlin did not respond, are you sure?" style prompts.
- HTTP response for Pause/Stop returns quickly and state changes to `PAUSING` or `STOPPING`.

## Feed Override Tests

Test that:

- `M220 S<percent>` is sent.
- Range `10` to `200` is enforced.
- Stop, Pause, and `M5` have higher priority than feed override.
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

## Manual Hardware Test Policy

Before testing real movement:

1. Router/spindle off.
2. Tool above material.
3. Hand near physical emergency stop.
4. Start with very low feed override.
5. Test air moves first.
6. Verify `M5`, Pause, and Stop before cutting.
7. Verify work zero and Z zero.
8. Verify generated run bounds.
