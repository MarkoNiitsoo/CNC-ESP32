# AGENTS.md

## Project

Offline CNC web pendant firmware for an AI-Thinker ESP32-CAM talking to Marlin on a BTT SKR Pro.

## Working Rules

- Keep changes small, readable, and documented.
- Update `work/progress.md` and `work/handoff.md` after every implementation step.
- Finish every completed implementation task with a focused Git commit. Do not leave completed task
  changes uncommitted or mix unrelated tasks in the same commit.
- Job execution must be streaming-based and must not require loading the full G-code file into RAM.
- Preview/transform may have separate file-size limits and must show a clear warning instead of affecting execution.
- Do not initialize or use the ESP32-CAM camera yet.
- Do not add camera streaming or SD upload. (Historical MVP-only bans on G-code preview, job resume,
  WebSocket transport, and OTA update are obsolete: this branch carries the Phase 1–3 WebSocket
  telemetry/command architecture, the recovery/checkpoint resume workflow, and SD/OTA firmware
  update. See `docs/protocol.md` and `docs/architecture.md` before changing transport behavior.)
- Long-running machine operations (Home / Work Zero / Z Zero) must stay cooperative: never execute a
  multi-second Marlin transaction synchronously inside `processWsCommandQueue()` or an HTTP handler
  on the WS path — use the machine-operation engine so Stop, heartbeats, and telemetry stay live.

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
