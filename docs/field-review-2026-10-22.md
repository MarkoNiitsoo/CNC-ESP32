# SD field review: Home, Work Zero and jog

Follow-up implementation: `jog-drain-fix-2026-10-22.md` describes the subsequent jog and UI
changes. The log observations below describe the original card contents, before those fixes.

Reviewed on 2026-10-22. Read-only copies of `job.log`, `system.log`,
`system.previous.log` and `update.log` are retained locally under
`.pio-build/field-logs/2026-10-22-2ba84e75/`. These raw logs are not committed.
The SD filesystem timestamps are not a reliable event clock. Times below are
device uptime in milliseconds; the principal boot session is `59AD0D54-52DDC697`.

## Deployment verified

- The update log records successful installation of the 1,539,328-byte root image,
  rename to `firmware.done.bin`, and reboot.
- The installed image SHA-256 matches the October 20 staged image:
  `11BB1CC9387B880A269D7320E1C282642884203288A37095051F453F518E1BC0`.
- The boot log identifies build `Oct 18 2026 20:21:22`.
- All 46 canonical `www` files on the SD match the repository. Stale SD assets
  do not explain the reported behavior.

## Work Zero: confirmed firmware-to-UI contract defect

Home completed successfully at 79086 ms. After a jog failure and recovery,
another Home completed at 312469 ms. Six subsequent XYZ Work Zero operations
completed with `ok=true code=OK`, at 347667, 369238, 378666, 392344, 412132
and 439668 ms. The first changed the reported coordinates from
`X:51.0246 Y:454.7455 Z:-32.0218` to `X:0.0000 Y:0.0000 Z:0.0000`.
The stepper counts remained unchanged, as expected for changing the work offset.

`machineFrameJson()` omitted the boolean `workZeroValid`. Both the HTTP frame
endpoint and WebSocket machine slice use that serializer. The browser's
`setWorkZero()` confirmation requires `frame.workZeroValid === true`; without
it, a successful machine command times out in the UI and does not emit the
confirmed event used to capture the zero in the job. The Zero/Origin panel also
reads this flag. The mock already supplies it, masking the production omission.

The WebSocket stayed connected throughout the six commands. The three inspected
SD job records have no active Work Zero ID or capture history, and there is no
job upload after these zero attempts. This supports the missing-confirmation
diagnosis; it is not evidence that Marlin rejected G92.

Local fix: serialize `machineFrame.workZeroValid` explicitly, including false.
Added a production-source contract regression covering its inclusion and reuse
by HTTP and WS. No motion commands, timeout values or trust rules were changed.

## Three buttons: duplicate entry points

The persistent readiness toolbar button (`readiness-set-work-zero`), the dynamic
readiness action (`Set Work Zero Here`), and the Zero/Origin panel button
(`set-work-zero`) all invoke the same XYZ Work Zero operation. They are not three
different zero modes. Advanced single-axis controls are separate.

Recommended follow-up: keep one primary button in Zero/Origin and make readiness
guidance navigate to it. Display command progress, confirmation, and failure
beside that button. This review does not change the buttons.

## Jog: real frame invalidation after a normal release

The first jog began around 99718 ms. A normal jog stop was received at 102325 ms.
At 103424 ms the controller became unresponsive while waiting for M410. At
103442 ms the firmware logged `scope=full reason=jog-quickstop`, followed by
`Marlin graceful jog stop acknowledgement timed out` at 103451 ms. Another stop
was recorded as emergency in ERROR state; recovery subsequently restored the
controller connection. The second Home restored the homing reference.

In `processJogRunner()`, a pending move acknowledgement older than 1000 ms while
stopping triggers M410/M5/G90, full frame invalidation and a jog error. Thus the
lost homing status was not merely a UI rendering problem. A real quickstop makes
the position uncertain, so retaining a trusted Home flag would hide the failure.

These logs do not establish why the move acknowledgement remained pending. The
next change should add bounded diagnostics for pending acknowledgement count,
last move timing and received Marlin replies, then reproduce a normal jog
release. Do not infer a fix from an arbitrary longer timeout or suppress frame
invalidation. The earlier boot also reports `OTHER_WATCHDOG`; its precise cause
is not established by the available logs.

## Validation and delivery boundary

- Focused firmware/UI contract tests: 55/55 passed.
- Full Vitest suite: 895/895 passed across 76 files.
- ESP32-CAM build: SUCCESS. Existing narrowing-conversion warning in
  `admitJobStart()` remains; unrelated to this change.
- The new image was built locally only. It has not been copied to SD or tested
  on the machine. No SD files or job records were modified during this review.
- Next hardware acceptance: Home, position with jog, normal release without
  quickstop, set Work Zero once, verify UI confirmation and saved job capture.
  Jog diagnosis remains necessary before claiming that complete flow works.
- Earlier open Stop-latch, zero-capture timing and job-completion findings in
  `restart-review-2026-10-18.md` remain open.
