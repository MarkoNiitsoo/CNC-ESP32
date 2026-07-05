# Motion-only Recovery

## Scope

The first recovery stage is a motion test, not cutting resume. It visualizes an interrupted run,
selects a previous clearance point, and may move the machine to that XY point at Safe Z.

The cutter/router/laser should be absent or off during early testing. Firmware streaming is not
restarted and the machine does not descend to cutting depth.

## Required Conditions

- The latest run is `stopped`, `interrupted`, or `error`. An older interrupted run is never offered
  after a newer running or completed run.
- The activeRun path, mode (when recorded), and fingerprint match the interrupted run. A missing
  interrupted-run path blocks recovery because the execution file cannot be proven identical.
- A generated active run still passes normal `generatedValidation`; stale, pending, missing, or
  invalid generated output is blocked without falling back to the source file.
- Work-zero ID matches when the interrupted run recorded it. A mismatch is a hard blocker because
  the XY/material origin can no longer be proven.
- A changed Z-zero ID is shown as a warning. Safe-Z reposition and Toolless testing may continue;
  Production Resume additionally requires explicit acknowledgement that the tool change or Z
  re-touch was intentional and that the new Z zero is correct.
- The machine was homed in the current powered session and position is explicitly trusted.
- Safe Z and the resume target fit configured X/Y/Z limits.
- No job or pause state is currently active.

Position trust is anchored by firmware `homingEpoch` and homed-axis state. Successful Home All
creates the trusted frame consumed by Machine Bar and Preview. Operator confirmation remains an
additional recovery gate, not the source of machine coordinates. Firmware reboot,
firmware identity change, Cancel/Start Over, or the explicit untrust action clears it.

## Candidate Policy

Recovery uses ToolpathModel `commandNumber`, which matches firmware's cleaned non-empty command
counter. It does not use raw source `lineNumber` for run progress.

The planner searches backward from the last acknowledged command for a retract/travel point above
the work surface. The proposed target is raised to the configured Safe Z before any XY movement.
It never chooses a Z0 or mid-cut continuation point.
If no previous clearance point exists, motion is blocked.

## Command Sequence

```gcode
M5
G21
G90
G54
G0 Z<safeZ> F400
G0 X<resumeX> Y<resumeY> F<travelFeedMmMin>
M400
```

Commands are sent one at a time through `/api/cmd`. The sequence never sends `G28`, `G53`, `G92`,
`M3`, or `M4`. It does not automatically home or restore zeros.

## Canvas Overlay

- Completed geometry is faint gray.
- Remaining geometry keeps the normal path colors.
- The interruption marker is red.
- The proposed Safe-Z resume marker is blue.
- Dashed travel shows the motion-only XY path at Safe Z.

## History And Future Work

Each attempted movement appends `motion-only-recovery-move` to `recoveryHistory` with a
`completed`, `blocked`, or `error` result. Automatic planner refreshes do not create history spam.
The interrupted run remains interrupted/stopped/error.

## Restoring Saved XY Work Zero

After restart or lost position, Recovery presents the interrupted run's saved work zero directly:

1. Home All axes.
2. Press `Restore Saved XY Work Zero` and review the one confirmation with exact machine X/Y.
3. Firmware lifts to Safe machine Z, moves in G53 machine coordinates, and applies G92 X0 Y0 only.
4. Review or re-touch Z zero separately, then continue Recovery.

New captures store M114 counts, M92 steps/mm, and derived machine position. Legacy count-only entries
derive position using current M92. M92 mismatch, missing counts, missing Home All trust, active
motion, or out-of-bounds targets block before movement. Restore is audited on the original zero ID.

Motion-only Recovery never descends into the remaining path and never continues job streaming.

## Toolless Resume Test

Toolless Resume Test is development-only and requires no cutter/router installed. It reuses the
validated Recovery V0 point, repositions at Safe Z, then follows the remaining ToolpathModel X/Y/Z
path, including original negative Z values. It is not production cutting resume.

ActiveRun identity, generated validation, work-zero identity, position trust, idle state, and full
X/Y/Z limits must pass. A changed Z zero is allowed with a visible warning because no cutter is
installed. Any ToolpathModel unsupported command blocks the test. Raw G-code is never streamed.

```gcode
M5
G21
G90
G54
G0 Z<safeZ> F400
G0 X<resumeX> Y<resumeY> F<travelFeedMmMin>
G0 Z<original-clearance-Z> F400
; controlled remaining absolute G0/G1 path, including original Z
M5
M400
```

`G28`, `G53`, `G92`, `M3`, and `M4` are never generated. Source M3/M4 warnings are shown but all
spindle/laser starts are omitted. Pause/Stop/M5 stop further browser commands; Pause/Stop also
request existing M410+M5 and invalidate position trust.

## Guarded Production Resume

Production Resume is a separate, deliberate cutting workflow. It uses the newest recoverable run,
the exact matching `activeRun.path`, a matching fingerprint, valid generated output when applicable,
trusted position, unchanged work zero, valid XYZ limits, and a complete safety checklist. It never
falls back to the source file.

A changed work zero blocks resume. A changed Z zero is expected after some tool replacements and is
allowed only after the operator confirms both that the change was intentional and that the new Z
zero is correct.

The workflow is two-phase:

```gcode
; Phase 1: cutter output forced off; Safe-Z reposition only
M5
G21
G90
G54
G0 Z<safeZ> F400
G0 X<resumeX> Y<resumeY> F<travelFeedMmMin>
M400

; Manual checkpoint: operator starts/verifies the router
; Phase 2: firmware-owned controlled ToolpathModel G0/G1/G2/G3 stream
G21
G90
G54
; remaining original X/Y/Z path and feeds
M400
```

Phase 2 remains disabled until Phase 1 completes, the manual-router checkpoint is checked, and the
operator holds `Hold to Resume Cutting` for 1.5 seconds. The pendant does not send `M3` or `M4` and
does not start the router, spindle, or laser automatically. It also never generates `G28`, `G53`, or
`G92`, never homes, and never restores a zero automatically.

After the hold, the browser uploads one `/jobs/generated/*.production-resume.gc` file and sends one
`POST /api/recovery/production/start` request. Firmware verifies the prepared event provenance and
the complete command file before sending anything, then owns SD/UART streaming and Marlin `ok`
pacing. A browser or WiFi disconnect therefore does not interrupt Phase 2. Pause, Stop, and M5
remain priority HTTP controls when connectivity is available; the physical emergency stop remains
the independent final safety control.

Each attempt appends a separate `production-resume` history event. The original interrupted run
remains interrupted/stopped/error. Future hardening is still required for power-loss recovery,
durable on-device history persistence, richer modal reconstruction, and lead-in strategy.
