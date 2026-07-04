# Current Task

## Guarded Production Resume foundation

Add a separate two-phase cutting-resume workflow: guarded Safe-Z reposition, manual router
checkpoint, then a hold-to-confirm controlled remaining X/Y/Z stream. Never generate M3/M4,
G28/G53/G92, auto-home, auto-zero, or source fallback.

Phase 2 is firmware-owned after the hold: the browser uploads one validated resume file and starts
the ESP32 stream once. Browser/WiFi loss must not interrupt an already-started cutting stream.

## Toolless Resume Test

Extend Recovery Planner V0 with a no-cutter test that safely repositions to the selected recovery
point, then follows controlled ToolpathModel X/Y/Z commands while omitting spindle, homing, and zero
commands. This is not production cutting resume.

## Shared automatic travel speed

Add one browser setting for automatic XY travel speed. Keep Z safety movement conservative, apply
the XY setting to bounding-box/aircut/recovery moves and firmware-owned job-start/work-zero travel,
and allow Settings to derive a conservative upper range from Marlin `M503` / `M203`.

## Motion-only recovery planner

Implement a first-stage interrupted-job recovery preview and Safe-Z motion test. This task must not
resume cutting, descend to cutting depth, start a spindle/laser, home automatically, or restore
zeros automatically. Firmware changes are avoided; approved motion uses the existing command API.

Create a new PlatformIO Arduino project for an AI-Thinker ESP32-CAM offline CNC web pendant
for Marlin on a BTT SKR Pro.

## MVP

- Start WiFi AP named `LowRider-CNC`.
- Start HTTP server at `192.168.4.1`.
- Serve `index.html`, `app.js`, and `style.css`.
- Provide terminal-style command UI with quick buttons.
- Add `POST /api/cmd`.
- Add `GET /api/health`.
- Communicate with Marlin on UART0 at 250000 baud.
- Support browser-based firmware update after one wired flash.
- Support saved WiFi station mode with setup AP fallback.
- Support SD-card rescue firmware update before WiFi startup.
- Support safe SD-card file management from the browser.
- Support SD-card hosted web UI files from `/www` with built-in UI fallback.
- Support browser-side G-code preview from SD-hosted UI files.
- Support SD-hosted job metadata and work-zero capture from the preview page.
- Support firmware-owned CNC job streaming from ARMED `/jobs` metadata and `/gcode` files.
- Support firmware-backed safe analog jogging with browser heartbeat deadman timeout.
- Support a mobile-first SD-hosted UI layout with dashboard, bottom navigation, files, job workflow,
  controls, and settings sections.
- Support a global SD-hosted mobile Machine Bar / Safety Drawer with job safety, position, zero,
  and homing controls.

## Not Implemented

- Camera streaming.
- Automatic or power-loss job resume. Guarded Production Resume is two-phase, requires manual
  router verification, and gives firmware ownership of Phase 2 after explicit operator hold.
- WebSocket.
