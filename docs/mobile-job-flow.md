# Mobile Job Flow

## Browser telemetry budget

`/www/telemetry.js` is the single per-page owner of read-only HTTP telemetry. Machine Bar and page
controllers subscribe to its events instead of starting independent intervals. It deduplicates
in-flight requests, polls job status every 1 second only while a job is active and every 10 seconds
when idle, and polls health every 30 seconds. Marlin log and jog status are demand-driven while the
related drawer/view is open. Position `M114` is manual until firmware-owned delta telemetry is
available; the browser must not add a periodic `M114` poll.

## Mock Mode Indicator

When `/api/health` reports `mockMode: true`, the shared Machine Bar shows a compact `DEV MOCK` badge
beside machine state and XYZ. The badge is intentionally global so Dashboard, Files, Preview,
drawers, and settings cannot be mistaken for a live CNC session without consuming a separate row.

Production firmware does not return `mockMode`, so the badge remains hidden on the ESP32. The mock
indicator changes presentation only; it does not alter active-run, readiness, arming, or command
logic.

## Automatic Travel Speed

Settings exposes one XY automatic travel speed shared with joystick XY max. The default is 50 mm/s
and the normal UI range is 10–100 mm/s. Reading Marlin limits sends M503 and uses M203 X/Y to narrow
the upper range when needed. Bounding box and other generated XY rapid moves use this feed; Safe-Z
moves remain F400 and G-code G1 cutting feeds remain unchanged.

## Canvas-First Workbench

The selected job opens in `/preview.html?path=...` as a fixed full-screen workbench. The graphical
work area is the main view and does not page-scroll during the normal job workflow. Existing job
panels are reused inside translucent overlays so desktop, tablet, and phone share one component and
state model.

Top action area:

- The existing Machine Bar remains the first row with direct Pause, Stop, and M5 actions.
- A compact workbench row shows connection, `activeRun` state, readiness, Tools, and overflow links.
- `activeRun.path` remains execution truth. Badges are ORIGINAL, GENERATED, STALE, or BLOCKED.
- Readiness is READY, BLOCKED, ARMED, RUNNING, or PAUSED.

Edge drawers:

- Left Tools drawer: Placement, Zero/Setup, Dry Run, Files, and Settings.
- Right Readiness drawer: active path, status chips, blockers, primary next action, Preflight, Arm,
  and Run.
- On phone widths the drawers cover about 82% of the screen and slide over the canvas.
- Drawers open from top buttons, edge buttons, or edge swipes and close with the scrim, close button,
  or outward swipe.
- Drawer state never changes job metadata or `activeRun`.

Bottom canvas toolbar:

- Fit Job, Fit Table, Fit Active, and Fit Zero.
- Zoom in/out.
- Pan/select interaction mode.
- Layer toggles for Path, Bounds, Zero, Travel, Source, Generated, and Table.
- Completed dry-run bounds and current position appear when existing metadata exposes them.

Touch and mouse:

- One pointer or mouse drag pans.
- Two pointers pinch zoom.
- Releasing one pointer after pinch rebases the remaining pointer at the current pan position, so
  continuing with one finger cannot jump back to the pre-pinch drag origin. A pinch is not counted
  as a double tap.
- Mouse wheel zooms around the pointer.
- Double tap or double click fits the active run.
- The canvas uses Pointer Events and `touch-action: none`; separate competing touch/mouse gesture
  implementations are avoided.

Responsive modes from `www/lib/workbench-ui.js`:

- `edge`: up to 680 px, phone edge drawers.
- `overlay`: 681-1100 px, larger overlay drawers.
- `sidebar`: above 1100 px, desktop-sized overlay/sidebar presentation with the same components.

The current placement policy intentionally remains simple: rotation `0` uses the source file;
non-zero rotation uses the complete raw travel path, lower-left origin, and normalization. These
fixed choices are shown as compact read-only chips instead of reintroducing options that can make
the visible placement disagree with executable travel.

Safety interaction policy:

- Start Cut requires a continuous one-second hold after existing arm, checklist, preflight, and
  active-run checks pass.
- Pause, Stop, and M5 remain direct one-tap actions and do not show modal confirmations.
- Drawer, pan, zoom, fit, and layer interactions send no G-code.
- No homing, zero restore, resume, or new movement behavior is introduced by the workbench.

Mobile text is reduced to badges, short blocker reasons, one primary next action, and expandable
details in the drawers. Full logs and file management remain separate pages linked from overlays.

## Skins And Semantic Icons

The workbench uses semantic icon roles and `--cnc-*` theme variables. The bundled Default,
FreeCAD-like, and High Contrast skins share one UI/component model. Appearance selection is stored
locally in the browser and applies to the Machine Bar, canvas controls, drawers, readiness badges,
critical actions, and path/bounds/zero colors.

FreeCAD-like is conceptual inspiration only. Its icons are original CNC-ESP32 artwork; no FreeCAD
SVG paths or artwork are copied. Critical actions always retain text and accessible labels.

See `docs/ui-skins.md` for role mapping, fallback rules, and custom skin instructions.

## Purpose

The mobile UI should guide the CNC operator through the next useful physical action. It should not
be a collection of pages full of unrelated buttons.

The intended story is:

```text
File -> visual job -> placement/origin -> zero -> checks -> arm -> cut -> recover if needed
```

The UI may allow an experienced operator to skip recommended steps, but required steps must stay
clear. Each job view should show what is required, recommended, and optional.

## Core Principles

- The next step should be an action, not only navigation to another page.
- The UI should reflect the physical state of the machine and the selected job.
- Dangerous actions must be visually separated from normal workflow actions.
- Machine controls belong in a persistent machine area, while job setup belongs in the job story.
- The main screen should change depending on whether a job is selected.

## Top Machine Drawer

The Top Machine Drawer is the persistent machine-control layer.

It should have an always visible sticky header with:

- Pause or Resume.
- Stop.
- Spindle/Laser Off.
- Last known machine/job state.

Pause, Stop, and Spindle/Laser Off must remain visible even when the drawer content scrolls. These
are software controls and must never be described as a physical emergency stop.

The drawer should contain machine controls:

- Feed/speed override.
- Homing.
- Firmware-backed joystick.
- Goto Work Zero.
- Terminal.
- Marlin messages.

The drawer is for machine control, not for the job story. The joystick should move from the
Controls page into the drawer so it is reachable from every main view.

Current implementation uses a compact layout:

- one state-aware Pause/Resume button beside direct Stop and M5
- feed current value centered between -10/-1 and +1/+10, with five presets below
- firmware-deadman XY joystick, Z hold buttons, Safe Z, speed limits, and explicit Stop Jog
- X/Y/Z homing on one row, then Home All and M119
- X0/Y0/XY0 work-zero moves on one row with Safe move enabled by default
- command dropdown followed immediately by the shared Marlin command/response log

The canvas keeps physical table grid lines anchored to homed machine coordinates. Job geometry and
the Work Zero marker are translated to the captured pre-G92 machine position, while ruler labels
are shown relative to Work Zero. For example, Work Zero at machine `X100 Y500` places the job at
that physical table location and labels the homed table edges `X-100` and `Y-500` without moving
the physical grid.

While a job is active, the latest Marlin response is visible in the Machine Bar. Critical Marlin
messages remain globally visible even outside an active run. Pause/Resume, Stop, and M5 stay in the
sticky drawer header while the rest scrolls.

## Files-First Home

When no job is selected, the default home view should be the file list. A generic dashboard full of
random controls is not useful before there is a selected job.

The file list should be compact. File actions should appear only for the active or expanded file.
Long press may enter select mode, but there should also be a visible Select button for clarity.

On upload, the browser should parse the selected file immediately. It should generate thumbnail and
statistics before or during upload, then create or update the job metadata sidecar.

Current implementation: selecting a G-code file in the root Files / Job Launcher upload control
uses `ToolpathModel` in the browser to show an SVG thumbnail, placement bounds, warning count, feed
range, and approximate estimated time before upload. After upload, the browser tries to save the
thumbnail under `/jobs/thumbs` and merge preview metadata into `/jobs/<file>.job.json` while
preserving existing job setup fields.

The goal is that selecting a file naturally creates the next job context instead of sending the user
to hunt through pages.

## Current Job / Next Action

When a job is selected, home should become the Current Job / Next Action view.

It should show:

- Current file.
- Mini preview.
- Bounds.
- Warnings.
- Feed override.
- Estimated time.
- Work zero and Z zero status.
- Preflight status.
- Dry run status.
- Arm/run status.

It should show one large primary next action, plus smaller alternative actions.

Primary action examples:

- Choose G-code File.
- Update Run File.
- Fix Active Run.
- Set Work Zero.
- Set Z Zero.
- Run Bounding Box / Dry Run.
- Arm Job.
- Start Cut.
- Monitor Job.
- Resume Job, only for an actively paused firmware job.
- Review Last Run.

The current implementation uses `www/lib/job-readiness.js` as the shared decision layer for the
Dashboard and Preview / Job page. The helper derives a readiness model from the selected job JSON,
live job status, active run state, zero state, dry-run state, arm state, and run history.

Primary action priority:

- Running jobs show Monitor Job and expose Pause, Stop, and M5 as secondary actions.
- Paused jobs show Resume Job and expose Stop and M5.
- No selected file shows Choose G-code File.
- Transformed placement with missing, pending, stale, or invalid generated output shows Update Run
  File and blocks Dry Run, Arm, and Start.
- Missing/invalid active run shows Fix Active Run.
- Missing work zero shows Set Work Zero.
- Missing Z zero shows Set Z Zero.
- Missing or stale dry run shows Run Bounding Box / Dry Run.
- Missing or stale arm state shows Arm Job.
- Armed and otherwise ready jobs show Start Cut.
- Stopped, interrupted, or error run history shows Review Last Run. It opens the guarded Recovery
  panel; it never starts cutting directly.

The readiness card must always show the source `/gcode/...` file and the effective `activeRun.path`.
When placement is transformed but the generated run file is not valid, the UI must not present the
source file as the cutting path.

Older planning examples kept for context:

- Fix Origin.
- Update Run File.
- Set Work Zero.
- Set Z Zero.
- Run Bounding Box.
- Run Air Dry Run.
- Arm Job.
- Start Cut.
- Return to XY Zero after stop.
- Resume from Safe Point.

Buttons should perform the action or open the exact action context. They should not merely send the
operator to another tab and leave them to figure out what to press next.

## Full Preview

Preview should always be available when a job is selected.

A mini preview belongs in the Current Job card. Full preview opens from the job card and should
eventually support placement and origin decisions.

The visible preview is the operator's intent. If placement is changed, the generated run file is the
implementation detail that makes the visible placement streamable; the workflow must not silently
fall back to the original source file.

Current implementation: full preview uses the shared `ToolpathModel` layer. The Summary panel shows
raw travel bounds, cut bounds, placement bounds, feed statistics, rapid/cutting distance, and an
approximate estimated time. G17 G2/G3 arcs are drawn using their resolved arc geometry. Warning
groups separate workspace information, unsupported commands, coordinate issues, and general warnings.

The full preview page also has a Placement / Origin section. The operator changes only rotation.
At zero degrees the original `/gcode` file remains active. A non-zero rotation transforms and
normalizes the complete raw travel path, marks the generated run file stale/pending, and makes
`Update Run File` the next action until the `.run.gc` under `/jobs/generated` is valid. Returning
rotation to zero automatically selects the original file.

Current Job and Preview should show both the original source file and the active run file. The
active run file is the one used for Preflight, Dry Run, Arm, Start, and Run History. Older job JSON
files that only have `gcodePath` remain valid by deriving a source-mode `activeRun` from that path.

## Marlin Messages

Marlin messages are the machine's voice and must not be hidden only in a terminal.

The UI should:

- Show critical Marlin messages globally.
- Show the last Marlin status in the top bar or drawer.
- Keep the full log available in Logs or the drawer terminal.
- Distinguish commands and responses.

Recommended visual prefixes:

```text
-> command sent
<- Marlin response
! warning or error
```

## Bottom Navigation

Suggested bottom navigation:

- Files.
- Job.
- Logs.
- Settings.

Controls should mostly move to the Top Machine Drawer. A separate Controls view may exist as a
secondary convenience, but it should not be the main way to reach urgent controls.

## 2026-06-22 SD UI Refactor Status

The SD-hosted `/www` UI now follows this direction without new firmware movement behavior:

- `/` opens to Files first when no current job is selected.
- `/#job` and `/preview.html` automatically return to `/#files` when no current G-code exists or
  the selected file cannot be opened; the UI does not present an empty "No Job" destination.
- Opening a G-code file stores a browser-side current job pointer and switches to Current Job.
- Current Job shows job metadata, work/Z zero status, warnings, dry-run status, arm state, and one
  next action.
- Current Job also shows active work/Z zero timestamps from `zeroHistory`, the latest
  `runHistory` state, and a stopped/interrupted badge when the last run did not complete.
- Preview / Job setup includes Zero History and Run History panels. Selecting a previous zero is
  metadata-only: it does not move the CNC and does not send `G92`.
- Stopped/interrupted runs route to Review Recovery. The Recovery drawer separates Safe-Z
  reposition, Toolless Resume Test, and guarded Production Resume.
- Logs are promoted to a bottom-nav view and use the existing `/api/marlin/log` endpoint when
  available.
- Machine controls live in the shared top Machine Bar / Drawer on `/`, `/files`, and preview pages.
- Goto Work Zero remains disabled/TODO because there is no bounded safe firmware API for it yet.
- Placement / Origin controls on full preview define the intended active run. If placement differs
  from identity/default, Start Job uses the validated generated run path, not the original source.

# Motion-only Recovery

The right readiness drawer includes a Recovery tab for stopped/interrupted/error runs. Its canvas
overlay separates completed and remaining geometry, marks interruption/resume positions, and shows
the Safe-Z recovery travel. Movement remains disabled until position trust, activeRun identity,
zero IDs, machine idle state, Safe Z, and XYZ limits pass. This panel has no cutting-resume action.
Only the newest run is eligible. Generated runs must remain validated; recovery never falls back to
the original source file when generated output is stale or invalid. Work-zero mismatch blocks.
Z-zero change is a warning for this Safe-Z-only movement.

The panel may also offer **Toolless Resume Test** when all Recovery V0 and full remaining X/Y/Z
checks pass. It requires explicit no-cutter confirmation and displays first Z descent, minimum Z,
estimate, and blockers. It follows controlled ToolpathModel G0/G1 motion including real Z while
omitting spindle starts. It is not production cutting resume.

The third tier is **Production Resume / Resume Cutting**. It requires matching activeRun and work
zero, trusted position, valid limits, a complete checklist, and extra acknowledgement when the tool
or Z zero changed intentionally. Phase 1 sends M5 and repositions at Safe Z. After the operator
manually starts/verifies the router, Phase 2 requires a 1.5-second hold and follows only the
controlled remaining ToolpathModel X/Y/Z commands. The UI never sends M3/M4, G28, G53, or G92 and
never homes, restores zero, or falls back to source automatically. After the hold, the browser
uploads one validated temporary file and firmware owns the Phase 2 SD/UART stream; browser or WiFi
loss does not stop cutting.
