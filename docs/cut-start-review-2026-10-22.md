# Cutting start field review — 2026-10-22

## Evidence

The local snapshot `.pio-build/field-logs/2026-10-22-cut-blocked/` contains the
SD logs and job sidecars. Boot `14E5FF74-0DE323B0` ran the previous jog-drain
firmware (1,540,640 bytes, SHA-256 beginning `FE1071AA`). Home All completed
successfully at uptime 46963 ms; Work Zero completed at 96690 ms and Z Zero at
130119 ms. Ordinary jog releases logged confirmed M400/M114 completion. Jog
smoothness is explicitly outside this change.

The KAR job contains three failed Start attempts, all at line zero with no
cutting command sent. The rejection was:

> active work zero does not match this absolute Home All session; restore or set work zero again

Its active Work Zero saved XY `(0, 0)`, while the later Z Zero captured the
firmware origin at approximately `(283.802, 431.449, 38.28)` in the same Home
session. Updating Z alone left the stale saved XY unchanged. There were no
`/api/test-motion/start` requests during this boot: Bounds/Aircut were blocked
in the browser before a motion request reached firmware.

## Corrections

- Browser zero confirmation used any newer frame revision, including position
  reports emitted before zero finalization. It now waits for `zeroRevision`,
  stamped only when Work Zero, Z Zero, or touch-plate zero successfully finishes.
  HTTP reconciliation uses the same slice shape and predicate as WebSocket;
  it neither re-executes the command nor compares unrelated sequence counters.
- Homed Work/Z Zero now derives its origin from fresh M114 counts after M400,
  before G92. Admission-time cached position is insufficient after physical
  joystick motion. Missing work XYZ or count/calibration evidence fails before
  changing zero. Finalization preserves the latest reported machine position.
- Bounds/Aircut previously required raw before/after M114 text, absent from
  WebSocket command results. Matching trusted frame evidence and the active
  saved homed zero now suffice. The firmware Start coordinate check is retained.
- Readiness rejects a saved zero that disagrees with the live Home session or
  origin and directs the user to set Work Zero again. Z Zero cannot silently
  carry stale XY into the current frame. Verification actions show blocked,
  running, completed, failed, or canceled status and serialize repeated clicks.

## Hardware acceptance

Install the matching firmware and complete `www/` payload. Refresh the browser
after boot. The old KAR sidecar is preserved for its history; it must acquire a
fresh Work Zero before use.

1. Home All and wait for completion.
2. Select KAR; position the tool using the physical joystick, release it, then
   Set Work Zero at the intended work origin. If XY is set above the surface,
   lower Z to the material surface and use Z Zero separately.
3. Confirm readiness retains the Home session and the saved Work Zero matches
   the current frame. Moving physically must not silently redefine the origin.
4. Run Bounds Check, then Aircut. Observe visible progress or the specific
   blocker. Both should now reach `/api/test-motion/start` when eligible.
5. After verifying the path and normal cutting checklist, start Cut. Confirm
   that the runner advances beyond line zero. Actual machine acceptance remains
   pending until this test; desktop tests cannot establish the physical result.

Automated coverage includes the cached-intermediate-frame race for both zero
commands, WebSocket loss before and during confirmation without redispatch,
matching empty-raw WS evidence, the observed stale-XY sidecar, and native
counts-to-machine-coordinate conversion with invalid calibration rejection.

Final local validation passed 918/918 Vitest tests, 33/33 native C++ tests, and
the ESP32-CAM build. The existing `admitJobStart` int-to-uint16_t warning remains.
Firmware: 1,541,632 bytes, SHA-256
`da23b705634eb5120ab982e412635e127d9b97dbf8baf1d74d70e5efc1c9a894`.
