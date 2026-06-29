# Manual And Simulated Tests

## Purpose

This project currently has no automated test harness. Until one exists, safety-critical firmware and
UI changes must have documented simulated or manual checks before real cutting.

Software stop is not a physical emergency stop. Start real machine checks with router/spindle off,
tool above material, low feed override, and a physical stop/power cut within reach.

## Priority Pause

Simulated or air-cut check:

1. Start a small known-safe job.
2. Press Pause while the job is streaming.
3. Confirm the UI changes to `PAUSING` immediately.
4. Confirm `/api/job/status` shows `pauseRequested` or `PAUSING` quickly.
5. Confirm no additional normal file lines are sent after pause is requested.
6. Confirm Pause does not show a Marlin timeout confirmation prompt.
7. Confirm the state becomes `PAUSED` or `ERROR` with a clear reason, never silently resumes.

## Priority Stop

Simulated or air-cut check:

1. Start a small known-safe job.
2. Press Stop while `RUNNING`, `PAUSING`, or `PAUSED`.
3. Confirm the UI changes to `STOPPING` immediately.
4. Confirm no additional normal file lines are sent.
5. Confirm priority `M5` and `M410` are requested.
6. Confirm resume is not allowed from `STOPPED`.

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

1. Pause, Stop, and M5 do not send `G28`.
2. No automatic homing is introduced.
3. No new movement command is introduced except the explicitly tested control command.
4. Software stop is not described as a physical emergency stop.

