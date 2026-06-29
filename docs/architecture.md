# Architecture

## Goal

This firmware turns an AI-Thinker ESP32-CAM into an offline CNC web pendant for Marlin.

The ESP32-CAM connects to saved WiFi credentials when available. If it cannot connect within
15 seconds, it starts a setup access point named `LowRider-CNC-Setup` at `192.168.4.1`. It serves
a small web UI and forwards one command at a time to Marlin over UART0.

## Architecture rule

Firmware is infrastructure. UI is content.
Prefer changing /www files on SD card for UI features.
Modify firmware only for new APIs, hardware access, protocol handling, OTA/recovery, or security.
The primary app UI is SD-hosted under `/www`; firmware is only changed for APIs, hardware behavior,
or job runner functionality.

## MVP Components

- WiFi station mode with setup AP fallback.
- WiFi credential storage in Preferences/NVS namespace `wifi`.
- HTTP server for static assets and JSON API routes.
- Static browser UI:
  - `index.html`
  - `app.js`
  - `style.css`
- UART command bridge to Marlin:
  - Send command plus newline.
  - Wait up to 1500 ms.
  - Collect the response.
  - Return the response as JSON.
- Web OTA update route:
  - Browser form at `/update`.
  - Firmware upload endpoint at `/api/update`.
  - Sends `M5` and `M400` before accepting firmware data.
- SD rescue update:
  - Checks `/firmware/update.bin` and `/firmware/INSTALL.NOW` before WiFi starts.
  - Streams firmware from SD with Arduino `Update`.
  - Logs to `/logs/update.log`.
- SD file manager:
  - Browser page at `/files`.
  - JSON file APIs under `/api/files`, `/api/upload`, `/api/download`, `/api/delete`,
    `/api/mkdir`, and `/api/rename`.
  - Restricts operations to `/gcode`, `/www`, `/firmware`, `/jobs`, and `/logs`.
- SD-hosted UI:
  - Serves `/www/index.html` from SD for `/` when present.
  - Serves `/www/app.js`, `/www/style.css`, `/www/files.html`, `/www/files.js`, and other safe
    `/www` assets when present.
  - Falls back to built-in SPIFFS UI files when SD UI files are missing.
- CNC job runner:
  - Starts only from an ARMED job JSON under `/jobs`.
  - Streams a selected G-code file from `/gcode` on the ESP32 SD card to Marlin over UART.
  - Runs in `loop()` with one command in flight and waits for Marlin `ok` before sending the next
    cleaned line.
  - Provides start, status, pause, resume, and stop API endpoints for the browser UI.
  - Keeps normal file streaming separate from priority controls such as Pause, Stop, M5, and
    feed override.
  - Captures recent Marlin commands/responses in a bounded log for global UI visibility.
- Safe analog jog:
  - Browser sends joystick intent and heartbeat updates only.
  - ESP32 firmware owns the jog state machine, safe Z lift, short relative movement ticks, and
    500 ms deadman timeout.
  - Safe Jog mode captures current Z, sends `M5`, moves to an absolute safe Z target, and restores
    the captured Z after jogging stops if Z was not changed.
  - The XY speed slider sets the maximum feedrate; joystick distance from center sets each tick's
    movement length and the firmware scales feedrate so partial stick movement remains smooth.
- WiFi settings route:
  - Browser form at `/wifi`.
  - Save endpoint at `/api/wifi/save`.
  - Forget endpoint at `/api/wifi/forget`.

## Explicitly Out Of Scope

- Camera initialization or streaming.
- G-code preview.
- Job resume.
- WebSocket.
