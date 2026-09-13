# Manual And Simulated Tests

## Purpose

This project currently has no automated test harness. Until one exists, safety-critical firmware and
UI changes must have documented simulated or manual checks before real cutting.

Software stop is not a physical emergency stop. Start real machine checks with router/spindle off,
tool above material, low feed override, and a physical stop/power cut within reach.

## Actionable Cut Blocker and Planner-Carry Regression

1. Load an existing generated job whose saved `activeRun` lacks `sizeBytes`, complete Home, Zero,
   and Bounds Check, then review Start Cut.
2. Confirm the job JSON is repaired with the measured active-run size and Cut is not rejected with
   `requested file does not match job activeRun identity`. Confirm a matching completed Box/Aircut
   with a legacy zero size is backfilled and is not repeated only for that missing metadata.
3. If Start is deliberately rejected, confirm the Run panel opens automatically and shows the exact
   error, plain-language next step, and `Show Required Steps` without opening Technical log.
4. Run an Aircut containing a long move followed by a short move. Confirm the second command's job
   log entry has non-zero `plannerWaitMs`, its hard timeout includes that allowance, and the stream
   completes. Confirm a later acknowledged `M400` clears the allowance.

## Guided Recovery Blocker and Non-Recoverable Aircut

1. Start from a pending interrupted production checkpoint and open the affected job.
2. Confirm the readiness card blocks the normal workflow before Home and explains that an
   interrupted cut needs a decision.
3. Confirm the card offers `Review Recovery Options` and `Discard Interrupted Cut Record`.
4. Review the recovery details without discarding them, then return and deliberately discard the
   record. Confirm the UI immediately says the next step is Home All.
5. Complete Home All, set work zero, then verify Bounds Check/Full Aircut is offered before Cut.
6. Start and stop or fail an Aircut, reboot the ESP, and confirm no Aircut recovery record appears.
7. Install over firmware that has an old `validated_test_motion` checkpoint and confirm boot logs
   `discarded legacy non-recoverable test-motion checkpoint` once, with normal workflow restored.

## Interrupted Cut Import, Home, and Zero Order

1. Stop a production Cut after several acknowledged commands, reboot without discarding
   `/logs/active-job.json`, and reopen the affected job.
2. Confirm the firmware checkpoint is copied into durable run history and then acknowledged. The
   saved run must retain its checkpoint `STOPPED`/`ERROR` state, not become `PAUSED`.
3. Confirm the recovery problem card shows its repairs in place: `Home All` first and `Restore
   Saved Work Zero` second. The second button must remain disabled until Home All completes.
4. Complete Home All and confirm step 1 becomes `DONE` in the same card without a page reload.
5. Restore the interrupted work zero and confirm step 2 becomes `DONE`, the current Home All frame
   matches, and the recovery candidate becomes available without visiting Zero History or logs.
6. Confirm the generated run and interrupted stream remain locked throughout review; only the
   matching `.job.json` may be updated so the checkpoint can be imported before acknowledgement.
7. At 412 x 915, confirm both repair actions use the full card width without horizontal overflow,
   and guarded Production Resume remains visible outside collapsed motion-only diagnostics.

## SD System Diagnostics

1. Install the diagnostic firmware through root `/firmware.bin`, allow the ESP to rename it to
   `/firmware.done.bin`, and wait for the automatic reboot.
2. After attempting to open `http://192.168.4.1/api/health`, power down and inspect
   `/logs/system.log` on a computer.
3. Confirm one boot session contains `SD mounted`, `BOOT firmware`, checkpoint and SPIFFS
   start/complete pairs, WiFi/AP details, mDNS result, `HTTP server started`, telemetry result, and
   `BOOT complete`.
4. If setup reaches HTTP, confirm the log contains `HTTP GET /api/health from=192.168.4...`.
   Missing HTTP request lines means the request never reached the ESP; a request line proves the
   server accepted the connection.
5. Repeated identical polling requests should appear no more than once per five seconds. Confirm
   the log never contains Cookie headers, operator PINs, WiFi passwords, or request bodies.
6. Grow or simulate `/logs/system.log` past 128 KiB and confirm it rotates once to
   `/logs/system.previous.log` while new events continue in `/logs/system.log`.

If the card itself cannot mount, no SD log can be written. In that case the absence of a new boot
session in `system.log`, together with a powered ESP, is the diagnostic signal.

## Remembered Controller And Passive Viewer

1. Claim control from a phone, then leave the CNC WiFi network for longer than 45 seconds.
2. Rejoin the same network and confirm the phone shows itself as controller without requesting the
   PIN again; use a harmless state-changing action to confirm the lease is renewed.
3. Repeat with Chrome fully closed and reopened. The remembered controller cookie should survive.
4. While that phone is connected, open the pendant from another browser and confirm it stays
   read-only without opening the PIN panel while only status, files, and preview are viewed.
5. Attempt a machine control from the viewer and confirm the PIN panel opens only then.
6. Let the phone lease expire, claim from the second browser, and confirm the old phone becomes
   read-only and cannot revive its former controller identity.
7. Explicitly release control and confirm the PIN panel closes instead of immediately asking the
   releasing browser to identify itself again.

## Priority Pause

Simulated or air-cut check:

1. Start a small known-safe job.
2. Press Pause while the job is streaming.
3. Confirm the UI changes to `PAUSING` immediately.
4. Confirm `/api/job/status` shows `pauseRequested` or `PAUSING` quickly.
5. Confirm no additional normal file lines are sent after pause is requested.
6. Confirm Pause does not show a Marlin timeout confirmation prompt.
7. Confirm the state becomes `PAUSED` or `ERROR` with a clear reason, never silently resumes.

## Duration-Aware Motion Acknowledgements

Simulated or router-off Aircut check:

1. Use an absolute-millimeter file containing a known long `G1` and a semicircular `G2/G3` move
   with explicit feed rates, including the formerly failing `G3 X248.087 Y304.767 I-4.913 J51.767
   F1500` case.
2. Confirm `/api/job/status.ackWatchdog` reports the estimated command duration and a hard timeout
   equal to at least three times that estimate plus five seconds, capped at 30 minutes.
3. Confirm the long arc may continue beyond ten seconds while fresh `busy:` responses arrive, then
   advances only after Marlin sends `ok`.
4. Confirm a `busy:` stream that stops for more than five seconds still enters
   `COMMUNICATION_LOST`, sends immediate M5, and never resends the uncertain motion command.
5. Confirm motion whose starting coordinate cannot be established receives the conservative
   three-minute hard timeout rather than the former ten-second limit.
6. Repeat at 50% feed override and confirm the estimated duration approximately doubles.

## Aircut Animation Uses The Streamed Path

1. Load a job whose production toolpath repeats the same XY contour at several step-down depths.
2. Generate Aircut and confirm the command preview reports the repeated step-down passes skipped.
3. Start Aircut with the router off and watch the tool marker for the whole run.
4. Confirm the marker follows every collapsed XY path once at the Aircut safe Z; it must not replay
   the original production depth passes.
5. Confirm progress reaches completion together with the firmware stream instead of continuing an
   extra production-style animation after the machine has finished.
6. Run the normal production Cut separately and confirm its animation still includes the original
   production passes.

## Priority Stop

Simulated or air-cut check:

1. Start a small known-safe job.
2. Press Stop while `RUNNING`, `PAUSING`, or `PAUSED`.
3. Confirm the UI changes to `STOPPING` immediately.
4. Confirm no additional normal file lines are sent.
5. Confirm the Marlin log shows priority `M410` transmitted before priority `M5`.
6. Repeat with an `M220` queued and confirm Stop replaces it instead of waiting.
7. Confirm telemetry warns when `EMERGENCY_PARSER` is not detected.
8. Confirm position remains untrusted until Home All and resume is not allowed from `STOPPED`.

## M5 Priority

Simulated or air-cut check:

1. Start a job.
2. Press M5 from the Machine Bar.
3. Confirm `/api/cmd` accepts `M5` while the job is active.
4. Confirm `M5` does not wait behind normal streamed file lines.
5. Confirm the UI still says this is not a physical emergency stop.

## Feed Override

Simulated or air-cut check:

1. Set feed override to `75` while idle and confirm `M220 S75` is sent.
2. Start a job and set feed override to `50`.
3. Confirm `M220 S50` is sent through the priority path.
4. Try invalid values below `10` and above `200`; confirm they are rejected.
5. While feed override is queued or active, press M5/Stop/Pause and confirm safety controls win.
6. Confirm the UI states that feed override changes movement speed only, not router RPM.

## Marlin Log

Simulated or air-cut check:

1. Send `M114`.
2. Open `/api/marlin/log`.
3. Confirm command entries use `direction: "tx"` and responses use `direction: "rx"`.
4. Confirm priority commands have `priority: true`.
5. Trigger or simulate a critical Marlin response such as `Error:` or `Resend`.
6. Confirm `lastCritical` is populated and the Machine Bar shows the critical message.
7. Confirm the log remains bounded to recent entries.

## Safety Invariants

For each test above, confirm:

1. Pause, Resume, Stop, and idle-only Advanced Manual M5 do not send `G28`.
2. No automatic homing is introduced.
3. No new movement command is introduced except the explicitly tested control command.
4. Software stop is not described as a physical emergency stop.
5. Pause sends no `M5`, `M410`, Z lift, or park command; Resume sends no repositioning command.
6. Standalone M5 is rejected during active, intact-paused, resumable, stopping, and recovery states.

## S1 Safety Acceptance Suite (Phases 2-6, audit findings F-1..F-5)

Hardware acceptance for the five resolved S1 state-ownership findings. Execute on the real
ESP32 + Marlin CNC. Record one log block per test (template below). Do not mark a finding
hardware-verified until the physical result is recorded in `work/current-task.md`.

### Pre-flight (every session)

1. Router/spindle physically disabled (unplugged or ERC off): no test in this suite needs it.
2. Tool safely above the table and fixtures; no workpiece required; only air moves are sent.
3. Connect directly to the machine AP (192.168.4.1); note the firmware commit flashed and the
   UI build/commit served (SD /www must match the firmware commit under test).
4. Keep the physical emergency stop within reach. Software stop is not a physical e-stop.
5. Useful observables: Run panel Technical log, /logs/job.log on SD (grep
   "machine frame invalidated: scope=... reason=..."), GET /api/machine/frame (trusted,
   workZeroValid, revision, homingEpoch), and HTTP status/error text from direct calls.

Logging template (one block per test):

```
Firmware commit: <sha>
UI commit/build: <sha>
Test ID: <A1 / B2 / ...>
Preconditions: <frame/state before the action>
Action: <exact user step or HTTP call>
HTTP response/code: <status + error text where relevant>
Observed UI state: <chips, buttons, panel messages>
Observed machine behavior: <motion/spindle/log markers>
Result: PASS / FAIL
Notes: <anything unexpected>
```

Failure rule: if a test fails, STOP that subsystem's sequence, record exact reproduction steps
plus job.log/HTTP/telemetry evidence, and do not proceed to further tests or any S2 refactor
until the failure is understood. Never weaken an expected invariant to make a test pass.

### Test A - F-1: jog quickstop invalidates the frame

Precondition: Home All completed, work zero set, GET /api/machine/frame reports
"trusted":true, UI shows POSITION TRUSTED and no STALE chip.

A1 - emergency jog quickstop:
1. Start a small Safe Jog (short distance, low speed).
2. While motion is active, trigger the emergency release deterministically:
   POST /api/jog/stop with body {"emergency":true}. (Closing the control tab mid-jog sends
   the same emergency release; a stall does NOT - stalls pause motion under the
   motion-grant model, and the 10 s session teardown is M410-free by design.)
3. Observe: motion stops immediately; the jog ends with M410 then M5 transmissions, and
   job.log contains "machine frame invalidated: scope=full reason=jog-quickstop".
4. Observe UI: work-zero chip shows STALE / POSITION UNTRUSTED (derived from firmware frame
   trust; there is no operator trust button anymore).
5. Attempt POST /api/job/authorize-start for any prepared job: expect HTTP 409
   FRAME_STATE_CONFLICT and no motion.
6. Home All again and confirm GET /api/machine/frame returns "trusted":true and the UI
   clears the STALE state.

Expected: motion stops; spindle-off safety command occurs; frame untrusted after the
quickstop; job authorization refused; Home All restores trust.

A2 - control test, ordinary jog release:
1. Restore the trusted state as above. Start a small jog and release it normally (pointer
   release).
2. Observe: the commanded horizon drains, motion stops smoothly, NO M410 is transmitted, no
   "machine frame invalidated" line appears, /api/machine/frame stays "trusted":true, and no
   Home All requirement appears.

Expected: frame remains trusted; no unnecessary Home All requirement.

### Test B - F-3: motion-owner exclusion

B1 - active job blocks jog:
1. Start a harmless air stream (Bounds/Aircut test motion, or a tiny air-only job).
2. While it is running, attempt a jog (UI joystick/direction button, or POST /api/jog/start
   directly with a small safe payload).
3. Expect HTTP 409 "jog rejected while a job is active" (direct call) or the equivalent
   refusal in the UI. Confirm the running stream is undisturbed and completes normally.

B2 - active jog blocks job start:
1. With the machine homed/trusted and no job running, hold a jog active (keep the joystick
   engaged, or start jog directly).
2. Attempt Start Cutting in the UI, or directly POST /api/job/authorize-start for a prepared
   job. Expect HTTP 409 "jog motion is active; release it before starting".
3. Confirm the jog remains the sole motion owner and no job stream begins. Release the jog.

B3 - active jog blocks test motion:
1. Hold a jog active, then POST /api/test-motion/start for a prepared generated file. Expect
   HTTP 409 "jog motion is active; release it before starting".

B4 - production resume (execute only if a safe RECOVERY_REQUIRED state with a prepared
production stream already exists from Test C; otherwise record NOT EXECUTED - the shared
admission policy and source-audit tests cover it):
1. While in that state with jog held active, attempt POST /api/recovery/production/start.
   Expect HTTP 409 "jog motion is active; release it before starting".

### Test C - F-2: recovery authority

C1 - create a safe RECOVERY_REQUIRED state:
1. Start a tiny air-only job, then Pause it (intact pause).
2. Attempt a jog while paused intact. Expect HTTP 409 "direct Resume was invalidated; wait
   for RECOVERY_REQUIRED before jogging". The firmware converts the pause into
   RECOVERY_REQUIRED and (F-1) invalidates the frame: job.log shows "machine frame
   invalidated: scope=full reason=paused-manual-interruption" and the checkpoint evidence is
   persisted first.
3. Confirm the UI shows the recovery review state and POSITION UNTRUSTED.

C2 - untrusted frame cannot authorize recovery motion:
1. Directly POST /api/recovery/move with {"command":"G0 X1 F600"}: expect HTTP 409
   FRAME_UNTRUSTED and no physical motion. There is no browser trust grant anymore; older
   cached pages or any client-supplied trust flags change nothing.
2. Directly POST /api/cmd with {"cmd":"M114"}: expect HTTP 200 (diagnostics stay available).
3. Directly POST /api/cmd with {"cmd":"G0 X1"}: expect HTTP 409 with the /api/recovery/move
   lock message and no motion.
4. Directly POST /api/cmd with {"cmd":"M5"}: expect HTTP 409 with the reserved-M5 message
   (the recovery flow owns M5).

C3 - trusted frame accepts a tiny valid recovery move:
1. Complete Home All (frame becomes trusted), then set the work zero through the normal Zero
   workflow (work zero becomes valid). The job state remains RECOVERY_REQUIRED throughout.
2. Directly POST /api/recovery/move with {"command":"G0 X1 F600"} (1 mm): expect HTTP 200 and
   a small physical move inside the machine envelope.
3. Confirm forbidden commands are rejected at HTTP level only: POST /api/recovery/move with
   {"command":"G28"}, {"command":"G53 G0 Z5"}, {"command":"G92 X0"}, {"command":"M3 S1000"}
   each expect HTTP 400 "command is not part of the recovery motion command class" and
   nothing is forwarded to Marlin.
4. Exit the recovery state through the normal workflow (Cancel Recovery / dismiss the
   record) and confirm the state leaves RECOVERY_REQUIRED.

### Test D - F-5: firmware-issued start grant

Precondition: a prepared air-only job (armed, verification complete, project Safe Z metadata
valid) and a trusted frame.

D1 - no grant:
1. Directly POST /api/job/start with the full identity payload and NO startGrant field.
   Expect HTTP 403 code START_GRANT_REQUIRED and no motion. A sidecar that still contains an
   old startAuthorizationToken "AUTHORIZED" must change nothing.

D2 - valid grant:
1. POST /api/job/authorize-start with the same identity payload: expect HTTP 200 with an
   opaque startGrant and expiresInSeconds 60.
2. Immediately POST /api/job/start with the payload plus the returned startGrant: expect
   HTTP 200 and the normal PREPARING -> RUNNING transition in the job slice.

D3 - re-use:
1. Stop the job (or let a short air job complete), then re-send the SAME job.start payload
   with the same grant under a fresh command id. Expect HTTP 403 START_GRANT_INVALID (the
   grant was already consumed).

D4 - identity mutation:
1. Request a fresh grant, then change the bound identity before starting: complete Home All
   (homing epoch changes) or re-set the work zero (work-zero id changes).
2. Attempt job.start with the old grant: expect HTTP 403 START_GRANT_IDENTITY_CHANGED and no
   motion.

### Test E - F-4: terminal cleanup smoke check

E1 - Pause -> Resume stays intact:
1. Start a small air job, Pause it, confirm the intact-pause state and that Resume is
   offered.
2. Resume and confirm PREPARING/RESUMING -> RUNNING continues without a manual-interruption
   recovery state appearing.

E2 - Stop leaves clean terminal state:
1. Stop the job. Confirm the stop quickstops (M410 then M5), the frame becomes untrusted, and
   the UI guidance says Home All / recovery review is required - the recovery indication
   matches the position-invalidating nature of every firmware Stop.
2. After Home All, prepare and start a new air job. Confirm no stale tool-change prompt, no
   unexpected direct-Resume offer, and no leftover pause state: the new start behaves like a
   fresh job.

E3 - error path spot check (optional): force a benign stream error (for example a test file
that fails validation mid-run). Confirm the error terminal state shows the specific error
and no direct-Resume option.

### Result recording

After each session, fill the checklist in work/current-task.md (F-1..F-5 hardware:
pending/pass/fail) and keep the log blocks with the session notes. A FAIL follows the
failure rule above: stop, capture, understand - do not weaken the invariant.
