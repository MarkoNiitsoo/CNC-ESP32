# UI Skins

## Purpose

The SD-hosted UI supports lightweight visual skins without firmware changes. A skin controls
semantic icons, workbench colors, path/bounds colors, and touch sizing while preserving the same
job and safety behavior.

Bundled skins:

- `default`: quiet dark CNC workbench.
- `freecad-like`: familiar CAD/CAM grouping and color cues.
- `high-contrast`: black background and stronger path/control contrast.

The selected skin is stored in browser localStorage under `lowrider.uiSkin`.

## FreeCAD-Like Rule

FreeCAD-like means conceptual familiarity only:

- axes and origin markers;
- sketch/grid and bounds metaphors;
- path nodes and toolpath cues;
- CAD workbench-style grouping and colors.

Do not copy FreeCAD icon SVGs, paths, logos, or other artwork unless their exact source, license,
and redistribution requirements have first been verified and documented. The bundled icons are
original CNC-ESP32 project artwork and do not contain FreeCAD icon paths.

## Folder Layout

Each skin is self-contained under SD `/www`:

```text
/www/skins/<skin-id>/skin.json
/www/skins/<skin-id>/icons.svg
/www/skins/<skin-id>/theme.css
```

The browser loads manifests and sprites through `www/lib/ui-skins.js`. `www/skin-init.js` applies
the active theme and watches dynamically created controls such as the Machine Bar.

## Manifest

`skin.json` includes:

- stable lowercase `id`;
- name, description, version, author, and license;
- complete semantic `icons` role map;
- documented color values;
- touch button sizes and icon stroke width.

Required icon roles:

```text
menu placement rotate origin zero workZero zZero
fitJob fitTable fitWorkArea pan zoomIn zoomOut
source generated bounds dryRun arm start pause stop m5
warning ok blocked files settings terminal log
```

UI components refer to these roles with `data-icon`, not SVG paths. Critical controls retain short
text and ARIA labels, so icon loading failure never makes Start, Pause, Stop, M5, Arm, or active-run
state ambiguous.

## Theme Variables

Key variables:

```css
--cnc-bg
--cnc-panel
--cnc-panel-strong
--cnc-text
--cnc-muted
--cnc-accent
--cnc-ok
--cnc-warning
--cnc-danger
--cnc-blocked
--cnc-path-source
--cnc-path-generated
--cnc-path-travel
--cnc-path-cut
--cnc-bounds-raw
--cnc-bounds-cut
--cnc-bounds-placement
--cnc-zero
--cnc-current-position
--cnc-button-size
--cnc-large-button-size
--cnc-icon-stroke
```

The canvas reads path, bounds, zero, and current-position values from computed CSS variables and
redraws after `cnc-skin-change`.

## Fallback Behavior

- Invalid selected IDs become `default`.
- Invalid/missing selected manifests fall back to Default.
- Missing icon roles resolve to the Default icon role.
- Missing selected sprite or theme falls back to Default.
- If even Default network files fail, built-in manifest metadata and base CSS keep text controls
  usable.
- Failures are non-blocking and are sent to console, `#skin-status` when present, and the
  `cnc-skin-warning` browser event.

Skin failures never change job metadata, `activeRun`, or machine behavior.

## Adding A User Skin

1. Copy one bundled skin folder as a starting point.
2. Choose a lowercase ID such as `my-shop`.
3. Update every manifest metadata field and keep all required icon roles.
4. Draw or license the icon symbols and document provenance. Do not copy unverified FreeCAD art.
5. Define every `--cnc-*` variable in `theme.css`.
6. Upload the folder under `/www/skins/my-shop` with the SD file manager.
7. Add `{ id: "my-shop", name: "My Shop" }` to `KNOWN_SKINS` in `www/lib/ui-skins.js`.
8. Upload the changed UI module and refresh the browser.

Dynamic skin-directory discovery is not available yet, so the Appearance selector uses this static
known-skin registry. A future API or static registry file may remove the code edit requirement.

## Safety Boundary

Skin and icon code must not:

- send G-code;
- add homing or movement behavior;
- restore coordinate zeros;
- change Start/Pause/Resume/Stop hold policy or the idle-only Advanced Manual M5 restriction;
- modify `activeRun.path` or generated validation.

Automated tests validate manifests, sprite completeness, fallback behavior, persistence,
accessibility labels, theme-variable integration, and movement-command absence.
