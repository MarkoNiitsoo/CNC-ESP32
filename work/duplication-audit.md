# Duplication Audit — Layer 1 (token/line clones)

Date: 2026-09-13 · Branch: `feature/phase1-websocket-transport` · Tree: clean at `f8ee342`

Tool: [`jscpd-rs`](https://github.com/vv-bogdanov/jscpd-rs) (skill `jscpd`), thresholds **min 5 lines /
min 40 tokens**. Refactoring method for follow-ups: skill `dry-refactoring`. Both installed at
`.zcode/skills/` with lock file `skills-lock.json`.

This layer detects copy/paste and near-duplicate code only. The semantic duplicate-state /
source-of-ownership audit (layer 2) is explicitly **not** started; section 8 lists the findings that
should seed it.

## 1. How to reproduce

```bash
npx jscpd-rs www src          # uses .jscpd.json in the repo root (added with this audit)
npx jscpd-rs --reporters json --output <dir> www src   # machine-readable detail
```

`.jscpd.json` pins `minLines: 5, minTokens: 40, maxLines: 20000, maxSize: 2mb, reporters: ["ai"]`.

⚠️ **Coverage trap:** jscpd-rs defaults to `--max-lines 1000` / `--max-size 100kb` and *silently
skips* larger files. With defaults, only 44 files / 7,330 lines were analyzed and 22 clones were
reported — `main.cpp` (10,939 lines), `preview.js` (7,128), `machine-bar.js` (2,494), `app.js`
(1,421) and `telemetry.js` (1,112) were all invisible. Always run with the raised caps
(`.jscpd.json` now does this).

Scope: `www/` and `src/` (production code). Excluded: `node_modules`, `data/` (generated SPIFFS
mirror of `www/`), `test/` (test duplication deliberately out of scope for this pass), `dev/` mock
server, `screenshots/`, `work/` logs. The JSON token counter in reports shows `0` (rs-build quirk);
the console reporter emits real token counts.

## 2. Headline numbers (full corpus)

| Format     | Files | Lines  | Clones | Duplicated lines |
|------------|-------|--------|--------|------------------|
| cpp        | 3     | 11,201 | 51     | 451 (4.0%)       |
| javascript | 29    | 17,845 | 64     | 532 (3.0%)       |
| markup     | 7     | 838    | 8      | 124 (14.8%)      |
| json       | 4     | 178    | 3      | 89 (50%)         |
| css        | 6     | 3,300  | 2      | 23 (0.7%)        |
| **Total**  | **51**| **33,456** | **128** | **1,219 (3.64%)** |

128 raw clone pairs collapse to **~70 distinct families** (overlapping ranges merged). Family
verdicts: **~30 CONSOLIDATE (safety/state-relevant)**, ~20 CONSOLIDATE (boilerplate), ~13
INTENTIONAL. Nothing was refactored in this pass.

Severity used below:

- **S1** — safety-relevant duplication: drift can change machine motion, admission gating, estop
  state, or operator-facing safety status. Some copies have *already diverged*.
- **S2** — state/identity duplication: drift silently corrupts stored/derived job state, not motion.
- **S3** — boilerplate/formatters: consolidate opportunistically; drift is cosmetic.
- **I** — intentional duplication; leave as is.

## 3. Firmware (`src/`) families

`main.cpp` (10,939 lines) carries 50 of the 51 cpp clones. Families (line ranges as reported by
jscpd):

| # | Family | Ranges (first ~ second) | Sev | Verdict |
|---|--------|--------------------------|-----|---------|
| F1 | `jsonEscape`/`htmlEscape` | 999-1006 ~ 964-971 | — | I (different escape targets) |
| F2 | Hand-rolled JSON field extraction; `extractCmdFromJson` re-implements `extractJsonString` | 1176-1191 ~ 1123-1138; 3778-3793 ~ 1093-1108 | S1 | CONSOLIDATE — `extractCmdFromJson` parses the raw G-code sent to Marlin |
| F3 | Device/BT config recursive-descent parsers ×3 | 1331-1343 ~ 1289-1301; 1355-1364 ~ 1270-1279; 1374-1386 ~ 1289-1301 | S3 | CONSOLIDATE (one object-walk helper) |
| F4 | WS packet send + seq bookkeeping (`sendClientPacket`/`sendClientEvent`) | 2490-2502 ~ 2463-2475 | S2 | CONSOLIDATE (handshake gate difference is the intentional part) |
| F5 | Staged-telemetry housekeeping (cachedSlices commit, dirty clear, hello/resync snapshot, event broadcast) | 2832-2842 ~ 2671-2681; 3422-3430 ~ 2661-2670; 3193-3198 ~ 3174-3179; 3539-3544 ~ 3503-3508 | S2 | CONSOLIDATE — stale cache would serve wrong position/homing state |
| F6 | Marlin response numeric scanners (`parseAxisValue`/`parseAxisAfter`/`parseWordAfter`) | 4920-4930 ~ 4893-4904; 4958-4974 ~ 4919-4935 | S1 | CONSOLIDATE — these parse M114/M92; a fix to one scanner leaves wrong positions elsewhere |
| F7 | Jog position capture (M400 wait + M114 parse + captured flags) | 5188-5198 ~ 5159-5169 | S1 | CONSOLIDATE — captured Z is the jog-restore reference |
| F8 | Jog quickstop/teardown (`M410;M5;G90` sequences, session reset vs estop) ×4 | 5381-5387 ~ 5366-5372; 5413-5422 ~ 5257-5266 | S1 | CONSOLIDATE — drift can leave spindle on or `zRestoreAvailable` stale |
| F9 | Serial async-line drain + position update (job runner vs idle autoreport) | 6245-6253 ~ 5123-5131 | S1 | CONSOLIDATE — position-during-job tracking duplicated |
| F10 | Job command ack-state reset (`processJobRunner` vs `completeJob`) | 6290-6300 ~ 6175-6185 | S2 | CONSOLIDATE |
| F11 | Streaming G-code validation readers (bounds / test-motion / production-resume) | 5867-5874 ~ 5723-5730; 5981-5989 ~ 5723-5730; 5901-5910 ~ 5883-5892 | **S1 top** | CONSOLIDATE — these decide which G-code may run; extract one `forEachGcodeLine(file, cb)` so line-length/trailing-line rules cannot diverge |
| F12 | `handleHealth` duplicates `healthStatusJson(false)` field-for-field | 6551-6589 ~ 2296-2334 | S2 | CONSOLIDATE — new health fields currently land in one transport only |
| F13 | G-code word scanners (`gcodeHasM6` vs `extractGcodeIntegerWord`) | 6627-6633 ~ 6610-6616 | **S1 top** | CONSOLIDATE — M6 detection gates tool-change pause; scanners already differ subtly (letter-precedence, sign handling) |
| F14 | HTTP motion-handler preamble guards (idle/busy/`sdMounted`/`hasArg("plain")`) ×6 | 6814-6822 ~ 6726-6734; 10116-10125 ~ 6726-6734; 9205-9214 ~ 8372-8381; 10204-10213 ~ 8372-8381; 8463-8483 ~ 8363-8383 | **S1 top** | CONSOLIDATE — these guards stop motion endpoints firing during an active job; extract `beginGuardedMotionRequest(...)` so no handler can forget a check |
| F15 | SHA-256 digest helpers (operator PIN / browser digest) | 6945-6952 ~ 6937-6944 | S3 | CONSOLIDATE |
| F16 | Operator session issue tail (token + Set-Cookie flags) | 7236-7242 ~ 7200-7206 | S2 | CONSOLIDATE — cookie security flags duplicated |
| F17 | SD path-guard preamble (`handleMkdir`/`handleDelete`) | 7677-7689 ~ 7644-7655 | S3 | CONSOLIDATE (note: `handleDelete` also checks locked-file mutation, mkdir does not — verify asymmetry is intended) |
| F18 | Filtered job-JSON loaders (execution authorization / project Safe Z / production-resume identity) | 7925-7930 ~ 7843-7847; 8162-8192 ~ 7843-7963 | **S1 top** | CONSOLIDATE — three copies gate what is authorized to run; extract `openFilteredJobJson(...)` |
| F19 | Motion-stream start block (`handleProductionResumeStart` vs `handleTestMotionStart`) | 8554-8565 ~ 8443-8454; 8586-8593 ~ 8454-8461 | S1 | CONSOLIDATE — keep safety fields explicit in a shared `startMotionStreamJob(cfg)` |
| F20 | `MachineOperationResult` HTTP wrappers ×5 (feed-override/pause/resume/stop/home) | 8884-8892 ~ 8626-8634; 8934-8942 ~ 8884-8942; 9181-9189 ~ 8884-8942 | S3 | CONSOLIDATE (one `sendMachineOperationResult`) |
| F21 | Stop/quickstop state transition ×3-4 (`recoveryRequired`, frame invalidation, priority stop) | 9085-9094 ~ 9026-9035; 9137-9153 ~ 9027-9095 | **S1 top** | CONSOLIDATE — drift changes post-M410 state derivation (the exact class of bug from the 2026-09 jog incidents) |
| F22 | Tool-change flag reset (stop path vs `completeJob`, 8 fields) | 9145-9153 ~ 6187-6195 | S1 | CONSOLIDATE — stale tool-change state blocks or wrongly allows resume |
| F23 | Work-zero result JSON builders ×4 (manual zero / set-work-zero / set-z-zero / touch-plate) | 9978-9984 ~ 9938-9944; 10004-10010 ~ 9938-9984; 10092-10097 ~ 9939-9944 | S2 | CONSOLIDATE — UI derives zero-capture validity from these strings |
| F24 | Work-zero restore motion prologue (`M5;G21;G90(;G54)` + G53 lift + M400 barriers) | 10248-10253 ~ 10160-10164 | **S1 top** | CONSOLIDATE — emits actual zero-restore motion; safety prologue must not exist twice |
| CC1 | `reserveTransaction` token allocation, `OrdinarySync` vs `RecoveryProbe` twins | controller_comm.cpp 91-97 ~ 104-110 | S3 | CONSOLIDATE (small private helper) |

## 4. Web (`www/`) — cross-file families

| # | Family | Copies | Sev | Verdict |
|---|--------|--------|-----|---------|
| W1 | **Job preflight/readiness (`computePreflight`) — ALREADY DIVERGED**: preview.js copy adds the homed-frame / `workZeroMatchesMachineFrame()` check and "discovered work area"; `lib/job-core.mjs` copy does not | preview.js 1218-1283 ~ job-core.mjs 43-98 (4 pairs) | **S1 top** | CONSOLIDATE — READY/NOT_READY gating can differ between UI and library; one copy can accept a stale work zero |
| W2 | **Job sidecar path + FNV-1a fingerprint identity** — `.job.json` derivation and run-file hashing must be bit-identical | app.js 212-226 / files.js 269-283 (`jobPathFor`), files.js 273-279 ~ upload-thumbnail.js 18-24 (`jobPathForUpload`), preview.js 729-736 ~ job-active-run.js 9-16 (hash) | **S2 top** | CONSOLIDATE — drift makes UIs read/write *different job JSONs* or accept a run file that wasn't previewed; single shared module required |
| W3 | **Safe-Z limit derivation — ALREADY DIVERGED**: machine-bar jogs clamp against `{min:1,max:MACHINE_Z_MAX_MM}`-style fallback, preview recovery uses `RECOVERY_LIMITS` + `mappedToMachine` | machine-bar.js 384-390 ~ preview.js 4863-4869 | **S1 top** | CONSOLIDATE — jog and recovery currently clamp Z against different limits |
| W4 | **Feed-override confirmation (`M220` completed?)** byte-identical today | machine-bar.js 674-693 ~ preview.js 1662-1681 | S1 | CONSOLIDATE — drift misreports applied feed rate |
| W5 | **Resume-command scaffolds** in recovery builders: feed validation + blocking early-return + `number()` + `M5/G21/G90/G54` + Safe-Z-first `G0` sequence | job-recovery.js 392-402 ~ 451-458 (+ tail) | **S1 top** | CONSOLIDATE carefully — the shared scaffold is the safety envelope of every resume; extract it, keep per-plan differences explicit |
| W6 | **Job-state hydration sequence** (workflow, zero state, active-run shape, history, safe-Z migration, checklist defaults) inline in load vs `applyLoadedJobState` | preview.js 4636-4654 ~ 4568-4588 | **S1 top** | CONSOLIDATE — one load path could skip `migrateProjectSafeZ` or arm-checklist defaults |
| W7 | **Work-zero restore POST payload** (machineXYZ, safeMachineZ, travelFeed, axes, moveToZ) | preview.js 4228-4246 ~ 2648-2665 | S1 | CONSOLIDATE — commands a real machine move to a stored zero; callers already differ in `axes` handling |
| W8 | Resume phase catch/finally (stopped-vs-error → best-effort `M5` → finish event → save → render), production phase 1 vs 2 | preview.js 3481-3501 ~ 3440-3460 | S1 | CONSOLIDATE — if one copy loses the best-effort `M5`, spindle stays on after a failed phase |
| W9 | Recovery-event metadata block (runId/path/fingerprint/resumePoint/safeZ/minZ), production vs toolless | preview.js 3414-3419 ~ 3220-3225; job-history.js 124-138 ~ 90-104 (event builders) | S2 | CONSOLIDATE — recorded fingerprints/safeZ gate later resume verification |
| W10 | Event finishers (`finishToollessResumeEvent`/`finishProductionResumeEvent`) and `ensureHistory` | job-history.js 166-174 ~ 111-119; preview.js 2290-2296 ~ job-history.js 55-61 | S2 | CONSOLIDATE (preview copy normalizes `recoveries`, lib copy does not) |
| W11 | **Bounds-helper trio — ALREADY DIVERGED IN NAMING**: `updateBounds`/`addPoint`, `hasBounds`/`boundsAvailable`, `finishBounds`/`finalizeBounds`, `EMPTY_BOUNDS` ×2, plus `parseWords`/`parseCodes` regexes that already differ (`+` sign handling) | toolpath-model.js 128-142 ~ toolpath-transform.js 12-37; preview-data-adapter.js 7-12 ~ toolpath-model.js 137-142; preview.js 5527-5541 ~ gcode-core.mjs 28-42; preview.js 1097-1112 ~ toolpath-transform.js 121-136 (placement defaults) | **S1** | CONSOLIDATE — geometry/bounds + command-parsing is motion-relevant and now exists in 3-4 copies; natural home is `lib/gcode-core.mjs` |
| W12 | Marlin axis-report parsing (`parseMarlinMaxFeedrates` M203 vs `parseMarlinStepsPerMm` M92) | motion-settings.js 7-15 ~ 20-28 | S3 | CONSOLIDATE (one `parseMarlinAxisReport(code, required)`) |
| W13 | Position-at-line vs position-at-command scan loops | workbench-ui.js 136-144 ~ 167-175 | S3 | CONSOLIDATE (parameterize by key) |
| W14 | WS command packet build + send + `SEND_FAILED` settle; pending-identity resolution; session/socket guards | telemetry.js 306-315 ~ 235-244; 337-346 ~ 382-391; 195-200 ~ 416-421; 219-225 ~ 425-431 | S2 | CONSOLIDATE within `telemetry.js` (keep 1-phase vs 2-phase APIs, share the packet/guard/identity helpers) |
| W15 | File/JSON POST helpers (`readJson`, `apiPost`/`postJobAction`/`postCriticalJobAction`, mkdir-thumbs 409 tolerance) | app.js 246-258 ~ machine-bar.js 546-558; machine-bar.js 597-604 ~ preview.js 1795-1802; files.js 237-244 ~ preview.js 4850-4858; preview.js internal 1795-1813 | S3 | CONSOLIDATE (keep `postCriticalJobAction`'s deliberate "result uncertain" semantics) |
| W16 | `html()` escaper ×3 | app.js 107-117 ~ files.js 42-52 (+ preview.js) | S3 | CONSOLIDATE — injection-safety logic should live once |
| W17 | Delete/rename handlers incl. duplicated `..` path-traversal guard | app.js 1051-1071 ~ files.js 493-515; files.js 495-502 ~ 561-568 | S2 | CONSOLIDATE — a drifting traversal check reopens one UI |
| W18 | Job sidecar load + thumbnail fallback (`fileMetadataFor`/`loadFileMeta`) | app.js 903-919 ~ files.js 291-307 | S2 | CONSOLIDATE |
| W19 | Marlin log formatter (`!`/`->`/`<-` panel text) ×3 | app.js 1221-1232 ~ machine-bar.js 1863-1871 (+ machine-bar 1970-1977) | S3 | CONSOLIDATE |
| W20 | Formatters (`formatMinutes`/`formatBytes`/duration/`boundsText`/`placementBoundsText` verbatim copy, `boundsOf`, file badges) | app.js/files.js/preview.js ~10 small pairs (e.g. preview.js 6398-6403 ~ 6046-6051; 6691-6701 ~ 4766-4776 — the latter already drifted, one copy misses estimate refresh) | S3 | CONSOLIDATE into `lib/ui-format.js` |
| W21 | "WS beginCommand + admission + HTTP fallback" wrapper (home, set-z-zero) | machine-bar.js 1720-1728 ~ 1639-1647 | S2 | CONSOLIDATE (`sendMachineCommand(ws, payload, httpUrl, confirm)`) |
| W22 | Jog-stop pointer handlers ×3 (joystick / direction pad / Z slider); second arg is the quickstop flag | machine-bar.js 1533-1538 ~ 1499-1504; 1568-1573 ~ 1499-1504 | **S1** | CONSOLIDATE — drift changes whether releasing a control hard-stops motion |
| W23 | Pause-transition confirmation + operator messaging (WS path vs HTTP fallback) | machine-bar.js 779-787 ~ 767-775 | S2 | CONSOLIDATE — PAUSING-vs-PAUSED wording is the operator's "is motion still happening" signal |
| W24 | Stream-watch promise skeleton (test motion vs production resume) | preview.js 4059-4071 ~ 3378-3390 | S2 | CONSOLIDATE |
| W25 | `captureM114` sendCmd-or-blocked try/catch ×2 (`M400`/`M114`) | preview.js 4498-4509 ~ 4484-4495 | S3 | CONSOLIDATE |
| W26 | Run-history finalize tail (`markLatestRunStopped` vs `syncRunHistoryFromStatus`) | preview.js 2149-2156 ~ 2134-2141 | S2 | CONSOLIDATE — drift can skip save/recovery refresh on one stop path |
| W27 | `generatedValidation` default object (ensure-shape vs new job) | preview.js 2202-2213 ~ 1039-1050 | S2 | CONSOLIDATE |
| W28 | Job-JSON upload (`uploadJobJson` vs `saveJob`, error conditions already differ) | preview.js 4826-4831 ~ 4604-4610 | S2 | CONSOLIDATE (`saveJob` should call `uploadJobJson`) |
| W29 | Stop-pending / quickstop "M410 + G90" UI handlers | machine-bar.js 1164-1170 ~ 1107-1113; 1970-1977 ~ 1863-1868 | S3 | CONSOLIDATE |
| W30 | `jobPathFor` + `saveJobSidecar` upload prologue | files.js 269-283 ~ app.js 212-226 (see W2) | S2 | part of W2 |

preview.js internal remainder: 4980-4986 ~ 4960-4966 (409-retry merge — **I**, deliberate reload-retry);
6398/6046 counted in W20.

## 5. Intentional duplication (leave alone)

- **Skins**: `icons.svg` ×4, `skin.json` ×4 (36-37 of 40 lines shared), `theme.css` overlaps —
  theming variants are *supposed* to share structure; only tokens differ. Merging them into data
  would make skins harder to inspect (violates "keep web assets static and easy to inspect").
- **HTML head/nav chrome** across `index.html` / `preview.html` / `files.html` (doctype/meta/script
  lists, nav/footer) — static page scaffolding; no logic to drift.
- **CSS** overlaps (`style.css` ↔ `skins/default/theme.css`, `preview.css` ↔ `style.css`) — same
  reasoning as skins; 23 duplicated lines total, harmless.
- **`data/`** — generated SPIFFS mirror of `www/` (build output, excluded from scan).
- **`lib/*.mjs` vs preview.js older copies** — this is *mid-refactor debt*, not intentional: the lib
  modules look like an extraction in progress while preview.js still carries diverged older copies
  (see W1, W11). Verify import wiring, then finish the extraction rather than reverting to one side.
- **`postCriticalJobAction` vs `postJobAction`** prologue — intentionally different network
  semantics (only the 6-line fetch prologue could be shared).
- **Test fixtures** — out of scope this pass; per the dry-refactoring guardrails, fixtures may stay
  duplicated when that aids readability.

## 6. Top 5 findings (safety-weighted)

1. **F11 + F13 (main.cpp) — G-code admission logic duplicated and already diverging.** Three
   streaming validators decide which G-code may run (5867-6000 region) and the two M6-word scanners
   differ subtly. This is the strongest candidate for the layer-2 source-of-truth work: one
   `forEachGcodeLine` + one word-scanner.
2. **F21 + F8 + F22 (main.cpp) — stop/quickstop state transition exists in ~7 near-copies**
   (estop teardown, tool-change flag reset, recoveryRequired/frame-invalidation). Drift here
   produces exactly the class of post-M410 state bugs seen in the September jog incidents.
3. **F14 + F18 (main.cpp) — motion-endpoint guards and job-authorization loaders duplicated.**
   Six handlers re-type idle/busy/SD guards; three loaders re-implement filtered job-JSON
   authorization. One forgotten guard = motion during a job; one drifting loader = wrong resume
   identity/Safe-Z accepted.
4. **W1 + W3 (www) — preflight gating and Safe-Z clamps already diverged between UI copies.**
   `computePreflight` in preview.js checks the homed/work-zero frame; `lib/job-core.mjs` does not.
   machine-bar.js and preview.js clamp Z against different fallback limits. These are live
   inconsistencies, not just future risk.
5. **W2 + W9 (www) — job identity duplicated across five files.** `.job.json` sidecar-path
   derivation (app.js, files.js ×2, upload-thumbnail.js) and the FNV-1a run fingerprint
   (preview.js, job-active-run.js) must stay bit-identical; drift silently orphans work-zero/arm
   state or authorizes a file that was never previewed. Prime input for the layer-2
   state-ownership audit.

Runners-up: F6/F7/F9 (Marlin position parsing/capture duplicated in firmware), F24 + W5/W7/W8
(resume/zero-restore motion prologues and their best-effort `M5` cleanup in 2-4 copies each),
W22 (jog quickstop flag in three UI handlers).

## 7. Recommended order for the later DRY work (not executed)

1. Firmware admission + validation: F11, F13, F2 (`forEachGcodeLine`, one word scanner, delete
   `extractCmdFromJson`). Small diffs, high safety value, native tests exist.
2. Firmware guards/wrappers: F14, F18, F19, F20, F21/F8/F22, F24 — mechanical extraction, big
   `main.cpp` shrink; do after (1) lands.
3. Web identity: W2 (single `lib/job-paths.js`: `jobPathFor`, `fnv1a`, `thumbnailPathFor`) then
   W1 (finish the `job-core.mjs` extraction so preview.js stops carrying its own preflight).
4. Web safety envelopes: W3 (one safe-Z limit module), W5/W8 (shared resume scaffold +
   phase-cleanup), W22/W23/W21 (machine-bar jog/pause/home wrappers).
5. Boilerplate sweep: F3/F15/F16/F17/CC1, W12-W20, W25-W29 — safe, low-judgment, good
   parallelizable worker tasks.

Each step should be its own focused commit, per `AGENTS.md`. Steps 3-5 are UI-only (SPIFFS) and
leave `firmware.bin` byte-identical; steps 1-2 require firmware rebuild + field deploy.

## 8. Seeds for layer 2 (duplicate-state / source-of-truth audit)

Token-level duplication is only the visible part. The scan surfaced state that is *owned* in
multiple places even when the code differs textually:

- Job identity (path hash + run fingerprint) — W2.
- Work-zero validity: firmware `before/after/frame` strings (F23) vs UI `workZeroMatchesMachineFrame()`
  (W1) vs telemetry cachedSlices (F5) — three owners of "is the frame trusted".
- Safe-Z: project Safe Z in job JSON (F18), `mappedToMachine` limits (W3), safe-Z migration in job
  hydration (W6).
- Resume authorization: production-resume identity loader (F18), fingerprint match (W2/W9),
  checklist/ack state (F10/W6).
- Bounds/travel state: `EMPTY_BOUNDS`-family (W11) exists as raw/placement/placementText variants
  across four modules.

These should be walked in the layer-2 audit regardless of whether the token clones get consolidated
first.
