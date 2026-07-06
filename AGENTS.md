# AGENTS.md

## Project

Offline CNC web pendant firmware for an AI-Thinker ESP32-CAM talking to Marlin on a BTT SKR Pro.

## Working Rules

- Keep changes small, readable, and documented.
- Update `work/progress.md` and `work/handoff.md` after every implementation step.
- Job execution must be streaming-based and must not require loading the full G-code file into RAM.
- Preview/transform may have separate file-size limits and must show a clear warning instead of affecting execution.
- Do not initialize or use the ESP32-CAM camera yet.
- Do not add camera streaming, G-code preview, job resume, SD upload, WebSocket, or OTA update for the MVP.

## Hardware Defaults

- ESP32 board: AI-Thinker ESP32-CAM.
- WiFi mode: AP only.
- AP SSID: `G-code-CNC`.
- HTTP address: `192.168.4.1`.
- Marlin UART: UART0 on ESP32, RX GPIO3, TX GPIO1.
- Marlin baudrate: `250000`.
- Power: 5V input from an external buck converter.
- Ground: common GND between ESP32-CAM and SKR Pro.
- SKR Pro side: UART6, ESP TX to SKR RX6, ESP RX from SKR TX6.

## Code Style

- Prefer simple Arduino/PlatformIO code over abstractions.
- Keep web assets static and easy to inspect.
- Use JSON endpoints for browser-to-firmware calls.
