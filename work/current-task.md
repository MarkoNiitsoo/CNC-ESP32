# Current Task

## Home-relative coordinate frame and recovery bounds

- Anchor machine coordinates to Home All M114 counts and M92 steps/mm.
- Distinguish homing sessions across ESP restarts.
- Validate recovery work paths in physical machine space through the saved work-zero transform.
- Keep legacy zeros for audit and explicit restore, never silent activation.

## Local device discovery and SD identity

Use `cnc.local` without setup for a single machine. Load an optional hostname and friendly name
from `/esp32-cnc/config.json` (or `/config.json`), persist valid SD identity to NVS, advertise HTTP
and `_esp32cnc._tcp` through mDNS, and expose non-sensitive identity through `/api/device`.

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

- Start WiFi AP named `G-code-CNC`.
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

## Duplication audit — layer 2 (report complete; refactoring pending approval)

Layer 1 (jscpd-rs clone scan): `work/duplication-audit.md`. Layer 2 (semantic state-ownership /
source-of-truth audit): `work/state-ownership-audit.md` — 22 domains, 14 confirmed MST findings
(5 × S1), ownership model, 11-step fix plan, 13 invariant tests. Phase 1 executed (commits
e139670..15d8e33): acceptance fences for F-1..F-5 + zero-risk dead-state cleanup. Phase 2
executed (commit b94eb63): F-1 resolved via canonical
`invalidateMachineFrame(scope, reason)` — jog M410 paths now invalidate frame trust identically
to job quickstops; fences promoted to positive invariants. Phase 3 executed (commit 848d646):
F-4 resolved via canonical `resetJobSubstates(JobSubstateResetScope)` (StopInitiated/Terminal) —
all seven terminal/interrupt paths migrated, evidence-before-cleanup ordering enforced and
tested, non-terminal pause/resume excluded. Phase 4 executed (commit 765c3a8): F-3 resolved
via canonical `admitMotionStream(MotionStreamKind)` — active-jog asymmetry removed, machine-op
exclusions extended to all streams, production resume frame gate added, fences promoted.
Still open, individually fenced: F-2 (firmware recovery-move gate), F-5 (firmware-issued
start token), then identity/safe-Z/readiness consolidation.
Phase 5 executed (commit a3c59f7): F-2 resolved — recovery-motion authority moved into
firmware via operator-gated `POST /api/recovery/move` (RECOVERY_REQUIRED + trusted frame +
valid work zero + ownership ladder + strict command allowlist + envelope validation);
generic `/api/cmd` locked to read-only diagnostics during RECOVERY_REQUIRED; browser
positionTrust machinery deleted (presentation derives from the machine-frame slice).
Phase 6 executed (commit ad677e9): F-5 resolved — the sidecar "AUTHORIZED" contract is
removed; job start requires a firmware-issued one-time start grant via
`POST /api/job/authorize-start` (60 s TTL, identity-bound, consume-on-attempt, cleared on
frame invalidation). No open S1 findings remain. Still open (S2/S3, individually fenced):
identity consolidation, Safe-Z policy consolidation, readiness consolidation,
run-history contamination fix, telemetry transport-order cleanup.

## S1 hardware acceptance checklist (procedure: docs/manual-tests.md "S1 Safety Acceptance Suite")

Safety pre-flight applies every session: router/spindle physically disabled, tool high,
air-only moves, physical e-stop in reach. Record one log block per test in the manual-tests
document; do NOT mark hardware-verified until Marko reports the physical result.

- F-1 hardware (jog quickstop invalidates frame + ordinary release preserves trust): pending
- F-2 hardware (untrusted frame blocks recovery move; /api/cmd locked; trusted tiny move ok): pending
- F-3 hardware (active job blocks jog; active jog blocks job/test/production): pending
- F-4 hardware (Pause->Resume intact; Stop leaves clean terminal state): pending
- F-5 hardware (no grant refused; grant+start admitted; re-use refused; identity mutation refused): pending

Failure rule: on any FAIL, stop that subsystem's sequence, capture reproduction + job.log/
HTTP/telemetry evidence, and do not continue into S2 refactoring until understood.
## Operator Zero / Origin workflow

Replace developer-facing Setup zero controls with one compact operator panel, automatic metadata
persistence, single-axis zero actions, and a modal history/diagnostics view.
