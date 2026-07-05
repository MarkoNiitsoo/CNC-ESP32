# Job Metadata

## Coordinate frame identity

Work-zero records store `machineReference.position` and `frame.homingEpoch`. Arming binds the run
to `activeWorkZeroId`; Start sends that identity and machine-space XYZ to firmware for verification.
`beforeG92.position` remains for audit/backward compatibility but is not the canvas table anchor
when a machine reference exists. Normal Start never creates or replaces a zero.

## Purpose

`job.json` is the job memory. It stores the relationship between the original file, generated run
files, preview data, placement decisions, zero history, run history, feed override, and recovery
information.

Original G-code remains in `/gcode`. Job sidecars live in `/jobs`.

## Source File

Planned fields:

```json
{
  "gcodePath": "/gcode/example.gc",
  "sourceFingerprint": "size+fnv1a32+cyrb53:...",
  "generatedRunPath": "/jobs/generated/example.generated.gc",
  "thumbnailPath": "/jobs/thumbs/example.png"
}
```

`generatedRunPath` and `thumbnailPath` are optional until those features exist.

## Preview

Current ToolpathModel preview fields:

```json
{
  "preview": {
    "bounds": {
      "rawTravelBounds": {},
      "cutBounds": {},
      "placementBounds": {}
    },
    "warnings": [],
    "feed": {
      "min": null,
      "max": null,
      "commandCount": 0,
      "lastFeed": null,
      "rapidDistance": 0,
      "cuttingDistance": 0,
      "plungeDistance": 0,
      "retractDistance": 0
    },
    "estimate": {
      "nominalSeconds": null,
      "effectiveSecondsWithOverride": null,
      "confidence": "low",
      "notes": []
    },
    "lineCount": 0,
    "segmentCount": 0,
    "toolpathModelVersion": 1,
    "parserLimitations": []
  }
}
```

Upload-time preview metadata updates must preserve existing `workZero`, `toolZero`, `arm`,
`dryRun`, run, and feed override fields. The browser may also store:

```json
{
  "thumbnailPath": "/jobs/thumbs/example.gc.svg"
}
```

The thumbnail is an SVG sidecar and is never embedded into the original G-code.

Full preview metadata updates follow the same rule: parsing `/preview.html?path=...` refreshes
`preview.bounds`, `preview.warnings`, `preview.feed`, `preview.estimate`, line count, segment count,
and parser limitation notes, but must not delete setup, zero, dry-run, arm, feed override, zero
history, or run history data.

## Placement

Planned fields:

```json
{
  "placement": {
    "rotationDeg": 0,
    "originAnchor": "rawBoundsLowerLeft",
    "placementBoundsMode": "rawTravelBounds",
    "normalizeToOrigin": true,
    "generatedAt": null,
    "generatedRunPath": null,
    "generatedRunBounds": null,
    "sourceFingerprint": "...",
    "transformFingerprint": "..."
  }
}
```

Implemented operator policy:

- Rotation `0` is identity and always executes the original `/gcode` source file.
- A non-zero rotation uses `rawBoundsLowerLeft`, `rawTravelBounds`, and origin normalization for the
  complete executable movement path. These are no longer operator-facing choices.
- Returning rotation to `0` selects the original source file automatically.
- `cutBounds` remains useful preview/statistics metadata, but it does not define generated-file
  placement because every travel and lead-in move must receive the same transform.

When generation succeeds, the browser writes `/jobs/generated/<safe-original-name>.run.gc`, then
stores `generatedRunPath`, `generatedRunBounds`, `generatedAt`, `sourceFingerprint`, and
`transformFingerprint`. If upload fails, `generatedRunPath` is not marked valid in job metadata.

The visible transformed preview is the operator's intent. Generated files are an implementation
detail used to make that visible placement streamable by firmware. If placement is identity/default,
`activeRun` may remain the original source file. If the operator rotates, changes origin/bounds
mode, or otherwise changes placement, `activeRun.mode` becomes `generated` and the generated file
must be updated and validated before Dry Run, Arm, or Start Job can proceed. The UI must never show
a transformed placement while silently cutting the original source file.

`activeRun` is the execution truth. UI panels may display `sourceGcodePath` as the original uploaded
file, but execution-oriented actions such as Preflight, Dry Run, Arm, Start, and Run History must
use `activeRun.path`. Older job JSON files that only contain `gcodePath` are treated as source-mode
jobs by deriving:

```json
{
  "sourceGcodePath": "/gcode/example.gc",
  "activeRun": {
    "mode": "source",
    "path": "/gcode/example.gc"
  }
}
```

```json
{
  "sourceGcodePath": "/gcode/example.gc",
  "generatedRunPath": "/jobs/generated/example.run.gc",
  "activeRun": {
    "mode": "generated",
    "path": "/jobs/generated/example.run.gc",
    "reason": "placement-transform",
    "updatedAt": "2026-06-23T12:00:00.000Z",
    "sourceFingerprint": "...",
    "generatedFingerprint": "...",
    "transformFingerprint": "..."
  },
  "generatedValidation": {
    "status": "valid",
    "validatedAt": "2026-06-23T12:00:00.000Z",
    "sourceFingerprint": "...",
    "generatedFingerprint": "...",
    "transformFingerprint": "...",
    "warnings": [],
    "errors": [],
    "bounds": {},
    "feed": {},
    "estimate": {}
  }
}
```

Changing placement marks `placement.dirty = true`, sets `generatedValidation.status` to `pending`
or `stale`, marks arm/dry-run data stale, and blocks cutting workflow until the generated run file is
updated. `Reset Placement / Use Original` is the explicit way back to `activeRun.mode = "source"`.

When a job is armed, the browser stores `activeRunMode`, `activeRunPath`,
`activeRunFingerprint`, `sourceFingerprint`, optional `generatedFingerprint`, and optional
`transformFingerprint`. If any of these change after arming, the arm state is stale and the job
must be reviewed and re-armed. Dry-run metadata also records the active run identity so a dry run
completed for a previous source/generated file can be treated as stale.

Firmware accepts `/jobs/generated/...` at job start only when the browser sends
`activeRunMode: "generated"` and the saved job JSON contains the same generated path as a validated
active run.

## Readiness Model

The SD UI derives the visible Current Job / Job Readiness state from job JSON and live job status.
The shared helper is `www/lib/job-readiness.js`.

It returns:

```json
{
  "activeRun": {
    "mode": "source",
    "path": "/gcode/example.gc",
    "status": "ok",
    "fingerprint": "..."
  },
  "placement": {
    "identity": true,
    "dirty": false,
    "requiresGenerated": false
  },
  "zero": {
    "workZero": "ok",
    "zZero": "ok"
  },
  "dryRun": {
    "status": "ok"
  },
  "arm": {
    "status": "armed"
  },
  "run": {
    "status": "idle"
  },
  "blockingReasons": [],
  "primaryAction": {},
  "secondaryActions": [],
  "badges": []
}
```

This model does not send commands. It is a decision/audit layer only. The Preview / Job page may use
the primary action to open the exact relevant panel or update the generated run file. It must not
introduce new movement behavior.

Generated run stale rules:

- `placement.dirty = true` blocks workflow.
- Missing, pending, stale, or invalid `generatedValidation.status` blocks workflow.
- Active generated path must match the placement/generated path.
- Dry-run and arm metadata are stale if their stored active run path or fingerprint differs from the
  current active run.
- Fallback fingerprints may be stored as `size+fnv1a` or the stronger `size+fnv1a+cyrb53` form.
  They identify the same bytes when both size and FNV-1a match; optional extra components do not by
  themselves make generated output stale. A changed shared component still blocks execution.

There is no silent source fallback. If the operator changed placement, the generated active run file
is required until `Reset Placement / Use Original` explicitly returns the job to source mode.

## Feed Override

Planned fields:

```json
{
  "feedOverride": {
    "startPercent": 100,
    "lastUsedPercent": null,
    "resetTo100AfterJob": true,
    "updatedAt": null,
    "source": "user"
  }
}
```

Feed override changes movement speed only. It does not change router RPM.

## Zero History

Implemented in the SD-hosted UI through `www/lib/job-history.js`.

Every zero-setting action creates a timestamped zero snapshot:

- Work Zero: confirmed `G92 X0 Y0 Z0`.
- Tool / Z Zero: confirmed `G92 Z0`.

Capture-only actions do not create history entries because they do not change the coordinate zero.

Store:

- `id`.
- `type`: `workZero` or `zZero`.
- `method`: `G92 X0 Y0 Z0` or `G92 Z0`.
- `capturedAt`.
- `workspace`, usually `G54`.
- `rawM114Before`.
- `rawM114After`.
- `positionBefore`.
- `positionAfter`.
- `countsBefore`.
- `countsAfter`.
- Related `gcodePath` and `jobPath` if known.
- Optional user `label`.
- `usedByRuns` array.

This matters because:

- If the user accidentally overwrites zero, previous zeros remain visible.
- If a job was cut using a previous zero, the correct zero can be selected again.
- If cutting fails, the zero used for the failed run can be recovered.

The compatibility fields `workZero` and `toolZero` remain in place for existing UI and firmware
code. `zeroHistory` is additive. The current metadata selectors are:

```json
{
  "activeWorkZeroId": "zero-...",
  "activeZZeroId": "zero-..."
}
```

Selecting a previous zero in the browser updates only these metadata IDs. It does not move the
machine and does not send `G92`. A future explicit restore flow must be separate and safety-tested.

## Run History

Implemented in the SD-hosted UI through `www/lib/job-history.js`.

Every job start attempt creates a run record before `/api/job/start` is sent. The run links to the
current `activeWorkZeroId` and `activeZZeroId`, and those zero entries receive the run ID in
`usedByRuns`.

Store:

- `id`.
- `startedAt`.
- `endedAt`.
- `state`: `completed`, `stopped`, `interrupted`, or `error`.
- `gcodePath`.
- `sourceGcodePath`.
- `activeRunMode`.
- `activeRunPath`.
- `generatedRunPath`.
- `sourceFingerprint`.
- `generatedFingerprint`.
- `transformFingerprint`.
- `zeroId`.
- `zZeroId` if available.
- `feedOverrideStart`.
- `feedOverrideLast`.
- `currentLineNumber`.
- `lastSentLineNumber`.
- `lastAckedLineNumber` if available.
- `lastKnownPosition`.
- `lastSentCommand`.
- `lastMarlinResponse`.
- Stop or error reason.
- `actualDurationSeconds`.

Current lifecycle data comes from the existing job APIs:

- Start attempt: browser-side timestamp, active zero IDs, job path, G-code path, feed override.
- Start accepted: `/api/job/start` response when available.
- Stop: `/api/job/stop` response or best-effort stop fallback.
- Completed/stopped/error: `/api/job/status` terminal states when the browser observes them.

Some fields remain `null` until firmware exposes richer runner data or the browser observes a
terminal state. This is intentional; the history should not invent recovery data.

## Zero And Run Relationship

Work-zero entries may store `machineReference` with M114 `counts`, M92 `stepsPerMm`, derived machine
`position`, and a `restores` audit array. Restore records stay on the same zero entry so the
interrupted run's `zeroId` remains valid. Legacy count-only entries can derive the reference using
current M92 at restore time.

A zero entry should show whether:

- It was used by a completed run.
- It was used by an interrupted run.
- It was set but never used.
- It was set after an interruption and may be accidental.
- It is a Z zero/toolchange zero.

This makes recovery and troubleshooting much less guessy.

Current UI status badges distinguish current active zero, used by completed run, used by
stopped/interrupted run, used by error run, used by run, and unused. If a zero is also current
active, that current-active status takes display priority.

## Resume Metadata

The first implemented recovery stage is motion-only. `www/lib/job-recovery.js` examines the latest
stopped/interrupted/error run and chooses a previous clearance point, but it does not generate a
cutting continuation. Toolpath segments carry both raw `lineNumber` and firmware-compatible
`commandNumber`; recovery progress must use `commandNumber` because run history counts cleaned,
non-empty commands.

Motion tests append a separate `recoveryHistory` entry:

```json
{
  "type": "motion-only-recovery-move",
  "motionOnly": true,
  "runId": "run-...",
  "activeRunPath": "/gcode/example.gc",
  "activeRunMode": "source",
  "resumeLineNumber": 12,
  "resumePoint": { "x": 20, "y": 30, "z": 15 },
  "safeZ": 15,
  "result": "completed",
  "commandsSent": ["M5", "G21", "G90", "G54", "G0 Z15 F400", "G0 X20 Y30 F3000", "M400"],
  "reason": ""
}
```

`result` is `completed`, `blocked`, or `error` for a user-initiated recovery motion test. This event
does not change the interrupted run to resumed or completed.

Toolless tests append a separate lifecycle event:

```json
{
  "type": "toolless-resume-test",
  "productionResume": false,
  "runId": "run-...",
  "activeRunPath": "/gcode/example.gc",
  "activeRunMode": "source",
  "startLineNumber": 12,
  "resumePoint": { "x": 20, "y": 30, "z": 15 },
  "safeZ": 15,
  "minZ": -3,
  "startedAt": "...",
  "endedAt": "...",
  "state": "completed",
  "commandsCount": 120,
  "commandsSent": 120,
  "reason": ""
}
```

State is `started`, `completed`, `stopped`, or `error`. The original run remains
interrupted/stopped/error and is never marked as production-resumed.

Guarded cutting attempts append a separate `production-resume` event rather than changing the
original run:

```json
{
  "type": "production-resume",
  "runId": "run-...",
  "activeRunPath": "/jobs/generated/example.run.gc",
  "activeRunMode": "generated",
  "startLineNumber": 12,
  "resumePoint": { "x": 20, "y": 30, "z": 15 },
  "safeZ": 15,
  "minZ": -3,
  "startedAt": "...",
  "endedAt": "...",
  "state": "completed",
  "commandsCount": 120,
  "checklist": {},
  "zZeroChanged": true,
  "previousZZeroId": "zero-z-old",
  "currentZZeroId": "zero-z-new",
  "zZeroChangeAcknowledged": true,
  "phase1CompletedAt": "...",
  "manualRouterConfirmedAt": "...",
  "streamPath": "/jobs/generated/example.gc.production-resume.gc",
  "reason": ""
}
```

The event also records the Phase-1 completion timestamp, manual-router checkpoint timestamp,
firmware stream path, and command summary. Terminal firmware status reconciles completed, stopped,
or error state after a temporary browser disconnect.

Immediately before firmware Phase 2 starts, the browser also stores a one-shot
`productionResumeAuthorization` object containing `authorized`, event/run IDs, activeRun identity,
fingerprint, stream path, and timestamp. Firmware scans the complete job file for this proof instead
of relying on the older 16 KiB metadata snippet. The browser clears `authorized` after terminal
firmware status is observed.
Production Resume requires unchanged work-zero identity. Changed Z-zero identity is recorded and
requires explicit acknowledgement, because deliberate tool replacement/re-touch is a valid CNC
recovery workflow.

Planned fields:

```json
{
  "resume": {
    "interruptionPosition": null,
    "interruptionLine": null,
    "recommendedResumeLine": null,
    "recommendedResumePosition": null,
    "previousSafePoint": null,
    "resumeCandidates": [],
    "resumeGeneratedPath": null
  }
}
```

Resume metadata must never imply that position is trusted after power loss. Resume should be
disabled or strongly warned when machine position, work zero, Z zero, tool, or material placement is
not trustworthy.
