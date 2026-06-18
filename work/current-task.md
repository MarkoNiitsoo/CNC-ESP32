# Current Task

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
- Job resume.
- WebSocket.
