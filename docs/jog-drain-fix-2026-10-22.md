# Jog completion changes — 2026-10-22

## Findings

The inspected SD run escalated a normal release into M410 after waiting one second for
a move acknowledgement. Browser code also requested emergency jog stop on pointer cancellation,
lost capture, blur, visibility loss and failed starts. Neither a normal release nor loss of a
browser gesture should initiate a quickstop automatically.

Two additional defects were found in the code: normal completion inferred planner completion
from a wall-clock estimate and move acknowledgements, without an M400 barrier; a new jog start
was allowed to replace an already active or stopping jog, resetting its pending-response state.
The browser also set its start-pending guard only after asynchronous preparation, allowing a
release to race with a later start.

The historical missing acknowledgement itself has not been reproduced or attributed to a
specific UART/parser fault. These fixes remove the abrupt escalation, correct completion and
ownership, and add evidence for a hardware retest. They do not claim that the UART fault is solved.

## Implemented behavior

- All automatic browser cleanup sends `emergency:false`; the start guard is set before awaits,
  and cancellation is checked before submitting motion. Explicit operator Stop remains available.
- Firmware normal release zeros intent and retains `STOPPING`/UART ownership. It waits for every
  outstanding move reply, then M400 acknowledgement, then fresh XYZ plus M114 acknowledgement.
  Only a confirmed drain enters Idle and preserves the existing homing reference.
- A one-second delayed move acknowledgement stops new targets and enters the same graceful drain.
  It does not issue M410. Duplicate releases cannot extend its confirmation deadline.
- Each drain phase has a ten-second deadline. Unconfirmed completion or a controller error
  attempts spindle-off, marks communication unresponsive, clears trust with reason
  `jog-unconfirmed`, and reports Error. It neither claims a confirmed position nor quickstops.
- Admission rejects a new jog while one is active/stopping, before changing any jog state.
- Bounded failure diagnostics include drain phase, pending replies, last command, and last
  received line/age. Successful stops explicitly log the confirmed M400/M114 boundary.
- Luna consolidated the duplicate XYZ Work Zero actions into one primary Zero/Origin button,
  with readiness navigation, progress, repeat-click protection and error feedback.

The firmware's omitted-body emergency jog API behavior remains for legacy callers. Canonical
joystick cleanup always sends an explicit false. Safe Z preparation and explicit emergency-stop
internals are outside this change; the motion completion runner itself is cooperative.

## Checks and delivery

Native C++ tests exercise the production drain state machine: delayed/lost replies, ordered
M400/M114 barriers, duplicate release, missing fresh position, empty jog and clock wrap.
Browser tests execute pointerup, pointercancel, lost capture, blur and visibility handlers and
verify graceful requests, retained authoritative homing and terminal error reporting. Admission
tests cover rejection without replacing existing jog state.

Full Vitest validation: 905/905 tests across 76 files. Native validation: 30/30 cases.
ESP32 build and local SD-package verification are recorded in `work/handoff.md` after final checks.
No machine test or SD installation has been performed for these changes.

## Hardware acceptance still needed

With the updated firmware and matching UI, start with the cutter off and clear travel space:

1. Home All. Confirm the UI shows a valid Home reference.
2. Jog a short distance on X/Y and Z, releasing normally. Verify smooth stopping, Idle,
   and retained Home reference. Repeat several short gestures, including a quick release.
3. While jogging, cancel the touch or switch browser focus. Verify the same graceful result.
4. Set Work Zero once. Confirm Zero/Origin updates and the active job saves its zero capture.
5. If a stop remains unconfirmed, collect `/logs/job.log` and `/logs/system.log`; record which
   gesture/axis triggered it. The new phase/pending/last-response diagnostics distinguish a
   missing move reply, motion-barrier reply or position reply.

Operator Stop remains a deliberate interruption that invalidates Home. It should not be used
as the normal way to release the joystick. Hardware smoothness and UART reliability cannot be
established by simulator/native tests alone.
