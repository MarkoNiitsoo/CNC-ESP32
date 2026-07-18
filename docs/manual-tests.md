# Manual And Simulated Tests

## Purpose

This project currently has no automated test harness. Until one exists, safety-critical firmware and
UI changes must have documented simulated or manual checks before real cutting.

Software stop is not a physical emergency stop. Start real machine checks with router/spindle off,
tool above material, low feed override, and a physical stop/power cut within reach.

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
