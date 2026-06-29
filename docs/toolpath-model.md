# Toolpath Model

## Purpose

The browser should own heavy G-code interpretation work. One shared browser-side toolpath model
should feed thumbnails, preview, bounds, placement, estimates, generated run files, and future
resume visualization.

The ESP32 should stream already prepared G-code files and handle serial control, priority commands,
recovery, and safety-critical timing.

## Original G-code

Original uploaded files live under `/gcode`.

They should remain unchanged. Do not embed thumbnails, metadata, or transformed output into the
original G-code file.

## ToolpathModel

The browser parses G-code into a reusable `ToolpathModel`.

The model should track modal state where needed:

- `G90` / `G91`.
- `G20` / `G21`.
- `G17` / `G18` / `G19`.
- `G54`.
- Current feed `F`.
- Motion mode `G0` / `G1` / `G2` / `G3`.
- Z engagement state.

The MVP may support only a safe subset. Unsupported or risky modal commands should be rejected or
clearly flagged before transform, arm, or run.

## Implemented Module

The shared browser-side module now lives at:

```text
/www/lib/toolpath-model.js
```

It exports:

- `parseGCodeToToolpath(sourceText, options)`
- `calculateToolpathStats(model, options)`
- `renderToolpathThumbnailSvg(model, options)`
- `renderToolpathToCanvas(model, canvas, options)`
- `estimateToolpathTime(model, options)`
- `getToolpathWarnings(model)`
- `buildPreviewMetadata(model, options)`
- `mergePreviewMetadata(job, previewMetadata, thumbnailPath)`

The module is pure/testable and has no DOM dependency except the optional canvas renderer. The
SD-hosted upload flow uses it to parse a selected G-code file before upload, show a thumbnail and
stats, and then update the `/jobs/*.job.json` preview metadata when the existing file APIs allow it.

The full preview page also uses this same module now. `www/preview.js` parses the selected file with
`parseGCodeToToolpath()`, adapts the model through `www/lib/preview-data-adapter.js`, renders the
canvas from ToolpathModel segments, and updates preview metadata in the job JSON without replacing
work-zero, tool-zero, dry-run, feed override, or arm fields.

The browser-side transform/generator foundation lives at:

```text
/www/lib/toolpath-transform.js
```

It provides pure helpers for placement defaults, arbitrary-angle XY rotation, origin-anchor
normalization, generated bounds calculation, transform safety checks, inspection-only `.run.gc`
generation, and placement metadata merge into `job.json`.

## Bounds Types

Bounds must be kept separate because different decisions need different geometry.

`rawTravelBounds`:
All X/Y movement, including parking and travel moves.

`cutBounds`:
Actual cutting or drawing geometry.

`placementBounds`:
Bounds used for origin and rotation placement.

`generatedRunBounds`:
Bounds of the generated transformed run file.

A file may have a lonely parking or start point far away from the actual detail. `cutBounds` keeps
that distinction visible for inspection, but generated output transforms the complete
`rawTravelBounds` path so no executable move is left in a different coordinate frame.

The current MVP rule for `cutBounds` is intentionally simple: XY `G1` or arc movement below `Z0`
is treated as engaged cutting/drawing movement. If no engaged movement is detected,
`placementBounds` falls back to `rawTravelBounds` and the model emits a warning.

## Rotation And Origin

Position on the physical table is normally handled by Work Zero / `G92`.

The MVP does not need full drag-on-table placement. Rotation and origin/anchor selection are the
important placement transforms.

Rotation should support arbitrary degrees, not only 90 degrees. After rotation, the user should
choose a new origin or anchor. The generated run file should be normalized around that chosen origin.

Origin options may include:

- Cut bounds lower-left.
- Cut bounds center.
- Raw bounds lower-left.
- Custom origin.

If origin is accidentally wrong, the UI should allow fixing it and regenerating the run file.

## Generated Run Files

The browser should generate transformed G-code.

Generated run files should live under:

```text
/jobs/generated
```

`job.json` should reference the generated run path. The ESP32 should stream generated `.gc` files
like normal files.

Do not store large generated G-code inside `job.json`.

Current implementation:

- Generated files are written under `/jobs/generated/<safe-original-name>.run.gc`.
- The original file under `/gcode` is never modified.
- Generated files include a deterministic comment block and safe modal setup: `G21`, `G90`, `G17`,
  and `G54`.
- The visible transformed preview is the operator's intent.
- Generated files are implementation details used to stream that visible placement.
- When placement differs from identity/default, the browser marks `activeRun.mode = "generated"`,
  updates or schedules `/jobs/generated/<safe-original-name>.run.gc`, and blocks Dry Run / Arm /
  Start Job until `generatedValidation.status = "valid"`.
- There is no extra `Use Generated` confirmation in the normal placement workflow.
- `Reset Placement / Use Original` is the explicit way back to the original source file.
- Firmware accepts `/jobs/generated/...` at Start Job only when it is the validated active run in
  job JSON.
- Source fallback is forbidden when placement is transformed. The original `/gcode` file may still
  be shown as `sourceGcodePath`, but Preflight, Dry Run, Arm, Start, and Run History must use
  `activeRun.path`.

Generation is blocked when the source contains transform-unsafe commands: `G91`, `G53`, source
`G92`, `G55` through `G59.3`, `G18` / `G19`, `G41` / `G42`, canned cycles, or unknown
transform-sensitive commands.

Generated output must not contain hidden `G28`, `G53`, `G92`, `M3`, or `M4`.

## Arcs

Current implementation:

- G17 XY-plane `G2` / `G3` arcs resolve from standard I/J offsets or R radius form.
- Arc points are interpolated for accurate canvas, SVG thumbnail, bounds, distance, and time data.
- Generated rotated files preserve `G2` / `G3`; endpoints and I/J center offsets are transformed.
- Invalid or incomplete arc geometry is reported and shown as a straight endpoint line so it is not
  silently omitted.
- G18/G19 non-XY arcs remain transform blockers.

## Estimated Time

Estimated time should be calculated from segment length and current feed, including the configured
feed override.

The estimate must be labelled approximate. Real cutting time differs because of acceleration, short
segments, planner behavior, pauses, `M400`, dwell, Z moves, and live feed override changes.

Later, `job.json` can store actual run time and a correction factor per machine/job type.

## Current Limitations

- Rotation/origin transform is browser-side job setup tooling.
- Generated transformed run files are automatically selected when placement differs from the source
  and validation succeeds.
- `G2` / `G3` support is preview/statistics-level only.
- Full preview uses ToolpathModel data, but some dry-run/arm UI code still consumes a compatibility
  adapter shape while it is migrated.
- `G91`, `G53`, `G55+`, source `G92`, `G18` / `G19`, cutter compensation, canned cycles, and
  unknown commands are collected as warnings/unsupported commands for future transform safety.
- Estimated time is approximate and excludes acceleration, short segment planner behavior, pauses,
  `M400`, dwell, operator actions, and live feed override changes.
