# State-Ownership / Source-of-Truth Audit — Layer 2

Date: 2026-09-13 · Branch: `feature/phase1-websocket-transport` · Builds on `work/duplication-audit.md` §8

Evidence: four parallel read-only subsystem audits (firmware job lifecycle, firmware frame/telemetry,
browser job/identity, browser machine/telemetry) + primary-agent verification of every load-bearing
claim. Evidence marks: **[V]** = re-verified against source in this session by the primary agent;
**[A]** = researcher-verified with exact refs, not re-verified line-by-line; **[I]** = inference,
unverified at runtime. All line refs are to `src/main.cpp` (firmware) or `www/<file>` (browser)
unless noted. **No production code was changed in this pass.**

Core question applied to every fact: *can more than one representation independently change the
logical fact?* A mirror that only reads is fine; a second writer (or a second invalidation/admission
policy) is a defect.

---

## 1. Executive summary

The firmware's *representation* discipline is better than the layer-1 clone counts suggested: there
is exactly one position commit function, one job-phase enum, one admission core for job.start, one
stop core, and the telemetry staging pipeline has a single committer. The real Source-of-Truth
defects are almost never two variables holding the same value — they are **one fact whose control
policy lives in several code paths**: five different frame-invalidation routines with different
field coverage (one whole class of paths — jog M410 — invalidates nothing), four different
"may this motion stream start" predicates, four different stop/reset field slams, five different
"can I cut?" computers in the browser (one of them scraping the DOM), and a job-authorization
decision that is *stored inside a browser-writable file*.

The single most dangerous pattern found: **recovery-phase raw motion is gated only by a
browser-persisted belief** (`sessionStorage positionTrust`, self-grantable by one button) while the
firmware passes `/api/cmd` G0/G28/G92 to Marlin with only busy-state gating. The second: **jog-side
M410 quickstops never invalidate the machine frame**, although every job-side M410 does — "is the
frame trusted" depends on which entry point happened to fire.

Counts: **22 logical state domains audited · 14 confirmed multiple-Source-of-Truth findings
(5 × S1, 9 × S2) · 8 stored-derived-state findings (S3) · 13 intentional mirrors that should
remain · 10 contradictory-state possibilities** (§7). Top 10 risks and fix order in §4/§9.

## 2. Logical-state ownership matrix

Canonical-owner proposals use: **FW** = firmware RAM global (single writer), **MARLIN** = physical
truth, **SIDECAR** = `/jobs/*.job.json` (operator intent/workflow record), **BROWSER-DERIVED** =
computed at render time, never persisted, **BROWSER-PREF** = localStorage (preferences/credentials
only).

| # | Domain | Representations (owner today) | Writers | Confirmed conflict | Class → target |
|---|--------|-------------------------------|---------|--------------------|----------------|
| 1 | Job phase | `jobStatus.state` enum (133-146, 47 values incl. RecoveryRequired) | 20+ transition sites, all gated on current state [A] | — | OK core; **FW canonical** |
| 2 | `jobRunning` bool | main.cpp:554 | 11 writers, **0 readers** [V] | disagrees with state inside Stopping (9030 vs 9036), unobservable only because dead | **S2 → RESOLVED (deleted in phase 1, commit d639837)** |
| 3 | Pause/resume substate | `pauseRequested` 170, `stopRequested` 176, `directResumeValid` 173, `pauseRealtimeHold` 171, `pauseMode` 175 | per-transition 8-17 field slams [A] | `pauseRealtimeHold`+`pauseMode` = one fact twice; error/complete paths leave residue (F-4) | **S2/S3 → derive flags from state where possible; single `resetJobSubstates()`** |
| 4 | `recoveryRequired` | bool 174 + enum value | set true unconditionally in Stopping→Stopped **and** →RecoveryRequired (4757-4763) [V]; JSON-only reader | bool semantics ≠ enum semantics; `true` on clean stop | **S2 → RESOLVED (derived serialization from the enum, phase 1, commit d639837)** |
| 5 | Tool-change substate | bool cluster 180-185 **and** `toolChangePhase` string 197 (two FSMs) | begin 6656-6662; ready 4729-4732; complete 9004-9008; resets ×3 divergent (6188-6194, 6215-6219, 9146-9152) [V: asymmetry] | stop paths disagree (F-4) | **S2 → one FSM (string), one reset fn** |
| 6 | Stop/estop outcome | `stopWarning`, `stopEmergencyParserDetected` 215-216; enum Stopping/Stopped | performJobStop 9070-9178 (3 field-slams [V]); jog quickstop separate | post-stop state is path-dependent (F-1, F-4) | **S1 → single transition fn** |
| 7 | Recovery/checkpoint | NVS active-job marker 1755-1766; `jobCheckpoint*` 856-867; browser `recoveries[]` + `runHistory[].firmwareCheckpoint` | FW writes checkpoint; browser imports (preview 2888-2944) **before** ack (2930) | browser writes sidecar possibly of another job (2856-2931) | OK-MIRROR + S2 note (import is path-keyed, ordering safe) |
| 8 | Frame trust + homing epoch | `machineFrame` 418-445; `trusted` **computed** 5077-5078 [V]; epoch/session 441-442 | establishment: Home-all finalize only (9605-9615); invalidation: **≥5 divergent routines** (F-1) | jog M410 paths invalidate nothing [V] | **S1 → one `invalidateMachineFrame(reason, scope)`** |
| 9 | Machine position | `marlinPosition` 411-416; commit `updatePositionFromMarlinResponse` 4982-5026 — **single committer** [A] | 7 producers converge on it (§ position map in evidence) | first-`X:` parse vs interleaved autoreport (4883) — residual stale-sample window [I] | OK core; **FW canonical** |
| 10 | Work zero | live `workZeroMachine*` 429-431; `workZeroValid` 422; saved zeros in sidecar `zeroHistory[]`; checkpoint SD copy 1837-1844; restore writes browser coords (10271-10273) | machine ops; browser restore (gated trusted 10202-10206 [A]) | saved-zero ↔ live-frame match checked in browser **and** FW (±0.05 mm, same tuple) | dual but equivalent — OK-DOMAIN; keep FW authoritative |
| 11 | Safe Z | `frame.safeZ` (FW, work-frame mm); projectSafeZ in sidecar (job-safe-z.js 10-78); RECOVERY/TOOLLESS/MACHINE limits (preview 176-178); machine-bar fallback `{1..70}` (52, 394) [V]; jog lift (9226-9235); SAFETY_Z_FEED 400 | FW computes frame.safeZ; browser clamps in 2 divergent formulas (F-9) | two clamp policies for the same work-frame value [V] | **S1/S2 → one browser safe-Z policy module over frame.safeZ** |
| 12 | Jog session | `jogStatus` 256+ (state, commanded work pos, horizon); machine-bar jog vector + optimistic session reset (1370-1389) | FW runner; browser intent-only vector | commanded-position open-loop accumulation parallels marlinPosition (S3-4) | FW canonical; browser = intent + display |
| 13 | Controller comm state | `ControllerCommManager` telemetry.state + activeTransaction token (controller_comm.h 8-71); mirrors `activeJobRunning/activeJogRunning` synced-on-use [A] | reserve/clear family | none found | OK-MIRROR (sync-on-use is safe: same task) |
| 14 | Operator authorization | FW session (epoch+cookie / WS packet token, 560-577, 2883-2897); browser `browserId` localStorage (machine-bar 958-967) + silent reconnect 1061-1088; epoch reconciliation 1029-1056 [A] | claim/reconnect/release both sides | persisted bearer credential is by-design reconnect; bypassed entirely when `claimRequired=false` (7307) | OK-DOMAIN + document; browser flag must stay display-only |
| 15 | Browser trust belief | `positionTrust` sessionStorage (preview 240, 2434-2462) | homing event, operator self-grant 6904-6906 [V], local invalidations, reboot detection | **gates recovery motion with no FW counterpart** (F-2) | **S1 → make display-only; move gate to FW** |
| 16 | Telemetry transport | WS conn + seq/revision/resync (telemetry.js 813-870); HTTP fallback polls | telemetry.js single cache writer [A] | preview `jobRunStatus` written by both transports (F-6) | cache OK; F-6 is the defect |
| 17 | Telemetry slices | stagedState/cachedSlices (820-841, 1649-1668), single loop-context committer 2721-2858 [A]; browser mirrors via subscribe | `touch*` invalidators | dead global dirty flags 2396-2401 [V] → **RESOLVED (deleted, phase 1)** | OK-MIRROR |
| 18 | Job identity | path-FNV sidecar path ×4 copies [V layer-1]; content fingerprint ×3 producers (SHA-256 / `size:fnv1a:cyrb53` preview 752-770 / `size:fnv1a` job-active-run 9-17); runId/zeroId/checkpointId | browser produces, FW re-hashes **bytes** (8045-8092) vs browser text [I] | producer fragmentation (F-10) | **S2 → one identity module; FW stays hash arbiter** |
| 19 | Job authorization | sidecar `startAuthorizationToken='AUTHORIZED'` (preview 2014 [V]; FW check 8100 [V]) + identity tuple + byte hash (8095-8143); checklist fields NOT read by FW (filter 7942-7944) [A] | browser writes; FW validates consistency only | the decision lives in a browser-writable file (F-5) | **S1 → FW-issued token/bind to evidence** |
| 20 | Readiness ("can I cut?") | preview `computePreflight` 1207-1288 (live); job-readiness.js 117-269; app.js ladder 709-732; machine-bar DOM scrape 564-586 [V]; orphaned lib/job-core.mjs **deleted** (phase 1, commit 725df11) | four computers remain | same question, different answers per surface (F-8) | **S2 → one readiness module, display-only** |
| 21 | Run history | sidecar `runHistory[]` — optimistic entries (preview 2016), terminal sync 2141-2154 [V: no path check] | browser only | cross-file contamination (F-7) | **S2 → path-checked, terminal-only writes** |
| 22 | Run-progress display | `animatedToolPosition` PREDICTED beats MACHINE on canvas during run (preview 837-858 [V]); readouts always telemetry | preview only, source-tagged, 1 s age guard | display-only; precedence is surprising but labeled | S3 note; keep labeled, prefer MACHINE |

## 3. Behavior-ownership matrix

| Behavior | Canonical implementation (FW) | Entry points | Alternate implementations | G-code | State mutated | Safety checks | Duplicated policy / recommendation |
|---|---|---|---|---|---|---|---|
| START JOB | `admitJobStart` 8654-8826 + `runJobStartPreamble` 8300-8323 | HTTP /api/job/start 8828; WS `job.start` 3327 (shared core ✓) | test-motion 8361-8458 and production-resume 8461-8570 admissions are **separate** (F-3) | M5,G21,G90,G54,M220,M400,M114,G0 Zsafe,G0 Ftravel | jobStatus reset→Preparing→Running; checkpoint 8805 | comm/SD/job/machineOp/frame-echo/safeZ/auth+hash — **no jog check** | Unify admissions behind one `admitMotionStream(kind)` |
| STOP | `performJobStop` 9070-9178 + `startImmediateStopPrioritySequence` 4694-4700 + `finishPrioritySequence` Stopping 4750-4775 | HTTP /api/job/stop 9180; WS `job.stop` AND `safety.stop` 3315; jog branch 9111 | three ~10-17-field slams inside FW (9086-9109, 9137-9177) + `beginPausedManualInterruption` 9025-9053 [A] | M410, M5 (SafetyStop bypasses comm gates ✓) | state→Stopping→Stopped/RecoveryRequired; frame invalidated 9103/9166; toolChange reset only in main branch [V] | One `resetJobSubstates(reason)`; machine-bar firing WS+HTTP in parallel is acceptable redundancy |
| PAUSE | `performJobPause` 8837-8881 | HTTP /api/job/pause 8883; WS `job.pause` 3317; browser surfaces preview 2073 + machine-bar 754 | two 8-field blocks (8852-8863 ~ 8866-8876) | P000 (realtime) / M400 (boundary) | PausedIntact or Pausing→Paused(+directResumeValid/toolChangeReady) | state==Running 8838 | Low risk; fold blocks into one helper |
| RESUME | `performJobResume` 8892-8931 | HTTP /api/job/resume 8933; WS `job.resume` 3319; **three browser surfaces** (preview 2088, machine-bar 789, app.js 721) | — | R000 fire-and-forget (8911) | Resuming→Running next tick (6213-6221), no Marlin handshake [A,I] | PausedIntact+directResumeValid+!stopRequested+!toolChange 8893-8901 | Shared core good; browser: keep one dispatch helper |
| RECOVERY | toolless = test-motion engine (`mode=toolless`); production = `handleProductionResumeStart` 8461-8570 | HTTP only for both streams; planning is browser-only (`job-recovery.js` prediction) | production start skips frame gate [V] | browser-generated validated stream | see F-3 | identity/fingerprint/whitelist (5951-6013) | Fold into unified admission (F-3) |
| HOME | `admitMachineOperation(Home)` 9769-9796 + `processMachineOperation` 9673-9748 + `finalize` 9565-9625 | WS `machine.home` 3334 (cooperative ✓); HTTP 9944 sync wrapper (legacy, documented 9868) | — | G28; M400; G54; G92 X0Y0Z0; M114; M503 | homed flags, counts, steps, **epoch++ + new sessionId** (9605-9615) | machineFrameControlBusy, parse-or-invalidate | Single engine ✓ |
| SET ZERO | ops `SetWorkZero` 9797-9822 / `SetZZero` 9823-9837 + finalize 9628-9667 | WS 3346/3355; HTTP 9965/9996 | touchplate 10020-10095 (**own synchronous prologue**, not the engine); manual frame 9892-9942 (different trust tier `manualWorkFrameValid`) | M400,M114,G92…,M114 / G38.2 probe chain | workZeroMachine*, workZeroValid, epoch untouched | homed-or-manual 9801-9806; active frame 9829-9832 | Touchplate should use the op engine |
| RESTORE ZERO | `handleRestoreWorkZero` 10193-10297 | HTTP only 10777 | browser payload duplicated (preview 2651-2663 ≈ 4232-4244, layer-1 W7) | M5,G21,G90,G53 lift/XY,G54,G92,M114 | workZero from browser body | trusted Home frame 10202-10206 + limits [A] | Multi-second synchronous handler (loop-blocking); migrate to engine |
| SAFE Z MOVE | jog safe lift `handleJogStart` 9226-9239 + `processJogRunner` 9298-9302; `/api/work-zero/goto` 10097-10191 | HTTP jog/goto only | browser clamps duplicated (F-9) | G53/G0 lifts | jog config | project-SafeZ match vs frame 9222-9235 | One browser clamp module; FW keeps enforcement |
| JOG START/STOP | `handleJogStart` 9193-9274 / `stopJogInternal` 5242-5274 | HTTP /api/jog/* only (no WS jog actions) | graceful vs emergency stop branches; session teardown 5406-5428 (M410-free by design) | G90,G53 lift,G1 segments,M410;M5;G90 on emergency/timeout | jogStatus; **frame NOT invalidated on jog M410** [V] | motion-grant 400 ms (5394-5430); PausedIntact interruption 9199 | Admission too narrow (F-3); invalidation policy F-1 |
| EMERGENCY STOP | same core as STOP (SafetyStop class 4639-4640 never blocked, controller_comm.cpp 37-39 ✓) | Stop button hold (WS+HTTP parallel), jog release emergency, ack-timeout escalations | — | M410,M5 | see STOP | always allowed ✓ | Good single core; fix F-1 scope |
| FEED OVERRIDE | `performJobFeedOverride` 8593-8618 (applied on ack 4319-4333) | HTTP 8620; WS `job.setFeedOverride` 3321; browser machine-bar WS-first 706-729 + preview HTTP-only twin 1681-1719 (layer-1 W4) | — | M220 S | feedOverridePercent | 10-200 clamp 8598 (FW re-clamps 8758-8762) | Shared core good; browser twin to merge |
| TOOL CHANGE | `beginToolChange` 6651-6707 → ready 4715-4742 → Z-zero via engine/touchplate → `handleToolChangeComplete` 8942-9023 | complete is **HTTP-only** (10765) | flag resets ×3 divergent (F-4) | M400,M5,park/return G53 chains | phase string FSM; return pos from M114 ack 4839-4846 | park needs absolute frame 6684-6689; complete needs confirm+z-zero 8948-8964 | Complete via WS too; single reset fn |

## 4. Confirmed multiple-Source-of-Truth findings

### S1 — multiple authoritative safety state

**F-1 · Frame-trust invalidation policy is path-dependent; jog M410 invalidates nothing.** [V]
`trusted` is computed from `machineValid && absoluteFromHome && homedX/Y/Z` (5077-5078) — never
stored — so the *policy* lives entirely in who resets which fields: (a)
`invalidateMachineFrameAfterQuickstop` 4685-4692 from job stop 9103/9166 and paused-interruption
9049 only; (b) boot interrupted-job 1981-1983 (leaves `marlinPosition.x/y/z` non-zero, revision→0);
(c) Marlin-reset recovery 10631-10651 (skips position touch); (d) machine-op baseline failures
9701-9704/9740-9743 (partial); (e) partial home 9616-9621; (f) manual frame 9927-9936. **Jog M410
paths — `stopJogInternal(true)` 5256-5268 and both ack-timeout escalations 5365-5374/5381-5388 —
send `M410;M5;G90` and reset only jog flags**, so a jog quickstop leaves `trusted=true` and a stale
job.start echo (epoch/session/zero unchanged, gate 8691-8708) would still pass. Whether jog-M410
*should* invalidate is a design decision to make explicitly (homing reference arguably survives;
live-position confidence does not); today the decision is made implicitly by which code path ran.

**F-2 · Recovery motion is authorized by browser-persisted belief.** [V]
`positionTrust` lives in sessionStorage (preview.js 240, 2434-2462), can be **self-granted** by the
operator confirm button (6904-6906 `setPositionTrust(true,'operator-confirmed-home-all')`), survives
reload, and gates recovery planning and motion commands (job-recovery.js 273, 385; preview 2562).
The moves themselves go through `/api/cmd`, which the firmware gates only on busy state — M5 during
RecoveryRequired, active job/jog/discovery (7764-7784 [V]) — no trust, homing, or limit validation.
Firmware *does* enforce trust for `/api/work-zero/restore` (10202-10206) and job start (8691-8708),
so the raw-move gap is the inconsistency. Recommended shape: firmware-owned recovery-move command
class (or a trust gate in `/api/cmd` while `RecoveryRequired`), browser flag demoted to display.

**F-3 · "May this motion stream start" has four firmware answers.** [V]
`admitJobStart` 8654-8826: comm, SD, job, machineOp, frame echo, safe Z, auth — no jog check
(8654-8671 [V]). `handleTestMotionStart` 8361-8458: comm, SD, job, safe Z, file — no machineOp, no
jog, no frame. `handleProductionResumeStart` 8461-8570: identity/safe Z/file — **zero frame
references** ([V] via symbol scan). `handleJogStart` 9195-9210: two literal states only
(PausedIntact→interruption, Running→reject) — admits jog during Preparing/Pausing/Resuming/
tool-change-Paused [V]. Only the machine-op engine checks jog (`machineFrameControlBusy`
9412-9415). Consequences: start-during-jog interleaves two managed UART streams; jog during
Preparing/Resuming drains stream acks → spurious COMMUNICATION_LOST [A].

**F-4 · Post-stop job state depends on which stop path ran.** [V]
Main job stop resets `toolChange*` (9146-9152); the machine-op stop branch does not (9086-9105
[V]); `finishPrioritySequence` never does (4750-4775); `setJobError` (6015-6042) leaves
`directResumeValid`, `pauseRealtimeHold/pauseMode`, toolChange fields; `completeJob` (6170-6200)
clears toolChange but not the pause fields. Static path: Stop during a tool-change Z-zero machine
operation can leave `toolChangePending=true`, `phase="WAITING_FOR_TOOL"` in Stopped
[I — not runtime-verified].

**F-5 · The job-authorization decision is stored in a browser-writable file.** [V token + check]
`startAuthorizationToken` is the literal `'AUTHORIZED'` (preview.js 2014), validated as such by
firmware (8100) alongside the identity tuple and a re-hash of the referenced run file (8027-8093).
The file is browser-authored and, in open-control mode (`claimRequired=false`), the upload route is
ungated [A: 7301-7305, 10750-10752]; the byte-hash binds only to the forger's own referenced file.
The checklist contents (`startChecklist`) are filtered out and never firmware-checked (7942-7944)
— advisory by design, but worth documenting as such. Recommended: firmware-issued, NVS-bound,
single-use start token (or bind authorization to firmware-derived evidence only: frame echo + hash).

### S2 — multiple authoritative operational state

**F-6 · `jobRunStatus` dual-transport write race + latched health.** [V]
WS subscribe (preview.js 7071-7072) and the HTTP poll (1738-1756) both feed `applyJobRunStatus`;
the "skip poll when synchronized" guard runs at poll *entry* (1739), before `await fetch` — a slow
HTTP response can apply after a fresher WS slice. No revision/seq ordering on the HTTP path.
`jobStatusHealthy` is set true on any success (1761) and never reset (only init false, 203 [V
grep]) — the ONLINE chip (350-351) and `statusUnknown` gate (1561) latch.

**F-7 · Terminal sync can write another file's outcome into this job's run history.** [V]
`applyJobRunStatus` calls `syncRunHistoryFromStatus(data)` at 1762 *before* computing
`belongsToAnotherFile` (1765-1770), and the guard only rewrites the in-memory mirror (1768-1770).
`syncRunHistoryFromStatus` (2141-2154) checks terminal-ness only — never `status.gcodePath` vs
`currentRunPath()` — so a terminal slice for file B closes file A's unfinished optimistic run
(created at 2016 before admission), and recovery planning then trusts that history
(job-recovery.js 285-296).

**F-8 · Five computers answer "can I cut?", with a DOM scrape as a gating input.** [V]
preview `computePreflight` 1207-1288 (frame-aware, live); `lib/job-core.mjs computePreflight`
31-115 — **zero importers anywhere in www/ [V grep]**: a dead, diverged twin (no
work-zero-frame check, static limits) that layer-1 W1 flagged as "diverged" is actually *orphaned*;
`lib/job-readiness.js` 117-269 (chips/dashboard); app.js ladder 709-732; and machine-bar
`localArmState()` scraping `#arm-state` **DOM text rendered by preview** (machine-bar.js 564-568
[V]) folded into `visibleJobState()` 570-576 which gates `canSetup/canSetZ/Stop` — render-order
changes in preview silently change machine-bar gating.

**F-9 · Safe-Z clamp policy exists twice with divergent fallbacks.** [V]
`safeZBounds()` machine-bar.js 383-395 and `activeSafeZLimits()` preview.js 4862-4875 share the
`frame.safeZ` branch verbatim, then diverge: machine-bar falls back to hardcoded `{min:1,
max:MACHINE_Z_MAX_MM=70}` (52, 394); preview falls back to machine-frame `RECOVERY_LIMITS`
reinterpreted as work-frame (4874). The same slider/plan value can be in-range in one module and
out-of-range in the other. (`TOOLLESS_LIMITS` allowing negative Z is OK-DOMAIN.)

**F-10 · Job identity is one logical chain over three incompatible-in-principle hash producers.** [A, I]
Path identity: `jobPathFor` FNV-1a over the path string in 4 copies (layer-1 W2) — identical today
[V layer-1]. Content identity: preview SHA-256 via WebCrypto with `size:fnv1a:cyrb53` fallback
(752-770); `job-active-run.safeFingerprint` `size:fnv1a` (9-17); bridged only by
`fingerprintsMatch` (29-35) subset matching — SHA-hex vs FNV forms cannot match [A]. Browser hashes
decoded text; firmware hashes raw bytes (8045-8092) — BOM/encoding edge → false `generated_stale`
or start rejection [I]. Over plain HTTP (deployment reality) the fallback form is always used, so
this is dormant, not theoretical-free.

**F-11 · `projectSafeZ` browser mirror has two writers with different resolution.** [A]
preview dispatches frame-resolved `cnc-project-safe-z` (997-999); machine-bar `refreshProjectSafeZ`
(422-452) recomputes from `/api/download` job JSON *without* the frame option and overwrites —
last writer wins, and the machine-max fallback resolves differently than the frame-aware value
(job-safe-z.js 39-50 requires `frame.trusted`). Affects jog slider clamps and goToWorkZero payload.

**F-12 · `recoveryRequired` bool contradicts its enum.** [V] — set true unconditionally in the
Stopping branch (4762 area) regardless of Stopped vs RecoveryRequired; JSON-only reader (2054-2055).
Any consumer keying on the bool misclassifies a clean stop.

**F-13 · `jobRunning` is a write-only parallel state.** [V] — 11 writers, 0 readers (554; grep
across src/), self-described TODO, already disagrees with `jobIsActive()` inside Stopping (9030 vs
9036). Delete; any future reader would inherit a latent lie.

**F-14 · Operator-control shadow state is dual-channel but reconciled.** [A] — cookie session (HTTP)
vs epoch+packet token (WS) with lease refresh, browser `browserId` persisted for silent reconnect
(machine-bar 1061-1088), epoch-mismatch revocation (1029-1056). Works, but the silent-reclaim
credential outlives the tab and everything is bypassed when `claimRequired=false`. Keep, document,
and ensure the browser flag never gates anything firmware doesn't also gate (currently true outside
F-2's raw moves).

## 5. Suspicious cases requiring refactoring (stored-derived / S3)

| # | Finding | Refs | Note |
|---|---------|------|------|
| S3-1 | `pauseRealtimeHold` bool + `pauseMode` string encode one fact | 171/175; 8857-8858, 8871-8872, 4764-4765 [A] | Keep string, delete bool |
| S3-2 | Tool-change modeled as bool cluster **and** phase string (two FSMs) | 180-185, 197 [A] | Collapse to phase string |
| S3-3 | `jobStatus.homingEpoch/SessionId` stored copies of frame identity | 155-157 ← 8778-8779 [A] | These are *echo* fields consumed by job.start admission (8698-8705) — OK-DOMAIN if documented as request-state, S3 drift risk otherwise |
| S3-4 | Jog commanded position: open-loop accumulation per emitted G1 parallels Marlin truth | 5477-5489; invalidated on jog M410 (5260) but frame untouched [A] | Derived, display-intent; keep clearly scoped to jog |
| S3-5 | Dead global `dirty*` flags | 2396-2401, zero readers [V] | Delete |
| S3-6 | Dead browser predictive channels: `jogAnimationPosition` write-only, `cnc-commanded-jog-position`/`cnc-telemetry-connection/-health/-position`/`mirroredState` have no consumers | machine-bar 1308-1321; telemetry.js 486-497, 589-591 [A] | Delete or wire up deliberately |
| S3-7 | `dev/mock-sd/www/preview.js` is a stale manual copy of the workbench UI | differs from www/preview.js [V] | UI tests can validate diverged logic; sync or generate it |
| S3-8 | `marlinMaxFeedrates` cached in localStorage motionSettings; writer not located | motion-settings.js; app.js 149-154 [A,I] | Fine as cache; find/refresh the writer; FW clamps anyway (8715-8716) |

## 6. Intentional mirrors/caches that should remain

1. **Telemetry staging** `stagedState`/`cachedSlices` — single loop-context committer, mutex-guarded,
   diff-based broadcast (2721-2858). Textbook write-through cache; keep.
2. **Browser telemetry cache** `CncTelemetry.state` — WS-only writer by construction;
   `diagnosticRequest()` deliberately non-mutating (telemetry.js 595-614). Keep.
3. **machine-bar `STATE.*` slices** — subscribe-only mirrors of telemetry (2410-2468). Keep
   (replace only the DOM-scrape input, F-8).
4. **preview `currentMachineFrame`** — single upstream (WS machine slice), ~10 assignment sites but
   one source. Keep.
5. **app.js `jobStatus` mirror** — subscribe-only (1381-1384). Keep.
6. **Firmware checkpoint → `runHistory[].firmwareCheckpoint`** — imported before acknowledgement,
   identity-keyed. Keep.
7. **`activeJobRunning`/`activeJogRunning`** comm-manager mirrors — synced at every use in the same
   task (main.cpp 358-368). Keep.
8. **`toolChangeSettings` HTTP caches ×3** — read-only config, low churn. Keep (one fetch helper
   would be tidier; not a state defect).
9. **`lowrider.motionSettings` travel feed** — preference cache; firmware clamps the actual feed.
   Keep.
10. **`zeroHistory[]` / `recoveryHistory[]` / `runHistory[]` as operator audit logs** — append-only
    records of what happened; legitimately browser-owned *history* (not machine state), modulo F-7's
    path check.
11. **`safeZSnapshot`** in run history (job-history.js 298-301) — audit record of applied Safe Z.
    Keep.
12. **Canvas run-progress prediction** — source-tagged `PREDICTED`, age-guarded, reset on
    pause/stop; readouts never use it. Keep, but consider preferring MACHINE-frame when fresh
    (§7-10).
13. **Job-start echo fields** (requested epoch/session/zero in the start payload, checked against
    live frame ±0.05 mm) — identity *binding*, not duplicate state. Keep.

## 7. Contradictory-state possibilities

1. `jobRunning=false` while `state=Running/Stopping` — real today, unobservable only because no
   reader exists (F-13). [V]
2. `recoveryRequired:true` + `state:"STOPPED"` in the same job JSON — observable now (F-12). [V]
3. `toolChangePending/phase` set while `state=Stopped/RecoveryRequired` — static path via machine-op
   stop branch (F-4). [V asymmetry / I runtime]
4. Browser `positionTrust.trusted=true` + firmware `frame.trusted=false` — the two beliefs are
   independent; browser gates motion on its own (F-2). [V]
5. HTTP poll response older than the last WS slice applied anyway (F-6). [V]
6. File B's terminal slice closes file A's `running` history entry (F-7). [V]
7. `projectSafeZ` mirror value ≠ preview's frame-resolved value after machine-bar refresh (F-11). [A]
8. Same safe-Z value clamped valid by machine-bar, rejected by preview after fallback divergence
   (F-9). [V]
9. `directResumeValid=true` while `state=Pausing` (set at 8868 before boundary pause completes) —
   safe only because resume re-gates on PausedIntact (8897); representation-level contradiction,
   gate-enforced. [A]
10. Canvas tool position showing PREDICTED while `jobRunStatus.position` reports actual — labeled,
    but precedence means the "live" dot can lag/reorder vs the numeric readout during a run. [V]

## 8. Recommended canonical ownership model

Principle: **one writable source of truth per fact; everything else derived or read-only.**

| Tier | Owner | Owns | Rules |
|------|-------|------|-------|
| T0 | **Marlin** | physical position, planner, spindle | Observed only through M114/M-counts/autoreport → single commit fn (exists) |
| T1 | **Firmware RAM** (`machineFrame`, `marlinPosition`, `jobStatus`, `jogStatus`, `ControllerCommManager`) | frame trust + homing epoch, work zero, job phase + substates, jog session, comm/busy, authorization enforcement | One invalidation routine per fact class; one admission core per action; one reset fn per lifecycle boundary; browser never writes these except via explicit, validated commands |
| T2 | **Sidecar job JSON** | operator intent + workflow record: checklist, layer/transform choices, zero history, recovery history, notes, preview metadata | Browser-written (it is the operator's document) but **never authoritative for a safety decision**: firmware must re-derive authorization from evidence (frame echo, byte hash, FW-issued token). Replace the `'AUTHORIZED'` literal with a firmware-issued nonce |
| T3 | **Telemetry slices** (WS + HTTP snapshots) | transport projection of T1 | Read-only caches; add revision ordering to the HTTP fallback application path |
| T4 | **Browser derived state** | readiness, arm/STALE chips, safe-Z bounds, stop availability | Computed at render from T3 only; **never persisted** (sessionStorage `positionTrust` becomes display-only once F-2 moves the gate to FW); one shared implementation per question in `www/lib/` |
| T5 | **localStorage** | UI preferences + `browserId` credential + currentJob selection | Never a machine fact; `currentJob` may be seeded from firmware but must never gate |

Corollaries: `jobRunning` deleted; `recoveryRequired` bool deleted; `pauseRealtimeHold` folded into
`pauseMode`; `directResumeValid` stays (real authorization token, single revoker documented);
orphaned `job-core.mjs` deleted (or finished and adopted — deleting is the honest option today);
the five readiness computers collapse into `lib/job-readiness` consumed by all surfaces; the DOM
chip becomes an output only, never an input.

## 9. Ordered refactoring plan (each step = one focused commit; no step executed yet)

> **Phase 1 progress (2026-09-13, commits e139670/bd4f179/d639837/725df11):** the acceptance
> fence was built FIRST (17 inverted `it.fails` invariant tests for F-1..F-5 in
> `test/firmware/*fence*|invariants*` + `test/ui/recovery-trust-fence.test.mjs`), then the
> zero-risk cleanup landed: `jobRunning` deleted (F-13), dead dirty globals deleted (S3-5),
> `recoveryRequired` converted to derived serialization from the canonical enum (F-12 —
> wire contract unchanged in every steady state; divergence limited to a transient Stopping
> window and an error-after-stop edge, neither observed by any reader), orphaned
> `lib/job-core.mjs` + its test + its safety-testing.md entry removed (F-8 partial: four
> readiness computers remain). Known accepted gap: the live preview.js twins of
> clampFeedPercent/computePreflight/effectiveFeedRange/nextJobAction now have no direct unit
> tests — owned by step 10. F-5 refinement: `startChecklist` appears nowhere in main.cpp;
> the checklist is UI-side only (fence test documents this boundary). Steps 2-6+ below are
> still open.

1. **Zero-risk deletions** (S2/S3 dead state): `jobRunning` (11 writer lines), dead `dirty*` flags
   2396-2401, orphaned `lib/job-core.mjs`, write-only `jogAnimationPosition` + no-listener events,
   `pauseRealtimeHold`. UI-only; firmware.bin unaffected for the web half.
2. **FW: single `invalidateMachineFrame(reason, scope)`** used by all five variants; decide and
   implement jog-M410 policy (expected: invalidate live-position confidence, keep homing reference
   explicit). Closes F-1.
3. **FW: `resetJobSubstates(reason)`** covering `toolChange*` + pause fields, called from
   finishPrioritySequence, completeJob, setJobError, both stop branches, beginPausedManualInterruption.
   Closes F-4; delete `recoveryRequired` bool in the same commit (F-12).
4. **FW: unify stream admission** `admitMotionStream(kind)` adding `jogIsActive()` and machineOp
   checks to all four current predicates, and the frame gate to production-resume. Closes F-3.
5. **FW: trust-gate recovery-phase motion** — `/api/cmd` while `RecoveryRequired` restricted to a
   validated move set (or a new RecoveryMove command class); then demote browser `positionTrust` to
   display-only and stop persisting it. Closes F-2.
6. **FW: replace `'AUTHORIZED'` literal** with firmware-issued single-use start token bound to
   boot + job identity in NVS. Closes F-5.
7. **Web: transport ordering fixes** — ignore in-flight HTTP job polls once WS is synchronized
   (revision/seq compare), reset `jobStatusHealthy` on transport loss; add the `gcodePath` check to
   `syncRunHistoryFromStatus`. Closes F-6, F-7.
8. **Web: one identity module** (`jobPathFor`, FNV, canonical fingerprint form; define text-vs-bytes
   canonicalization with firmware as arbiter) — collapses F-10 and layer-1 W2.
9. **Web: one safe-Z policy module** over `frame.safeZ` (explicit error instead of divergent
   fallbacks) + single `projectSafeZ` writer. Closes F-9, F-11.
10. **Web: single readiness module** consumed by preview/app/machine-bar; machine-bar subscribes to
    slices instead of scraping `#arm-state`. Closes F-8.
11. **Docs**: record the ownership model (§8) and the advisory-vs-enforced boundary (§3 matrix) in
    `docs/architecture.md`.

Steps 2-6 are firmware (rebuild + field deploy, invariants testable native); 1 and 7-10 are
SPIFFS-only.

## 10. Suggested invariant tests

Status after phase 1: items 1-5 of the firmware list and the browser items 7-8 (source-audit
form) exist as **inverted acceptance fences** (`it.fails`, currently failing by design) in
`test/firmware/frame-trust-invariants.test.mjs`, `motion-stream-admission.test.mjs`,
`stop-cleanup-parity.test.mjs`, `job-authorization-fence.test.mjs`,
`test/ui/recovery-trust-fence.test.mjs`. Items 6, 9-13 and behavioral/mock variants of 1-5
remain to be written when their fix phases start.

Firmware (native/host tests):
1. **Frame-trust invariant**: for every M410-emitting entry point (job stop, jog emergency, jog ack
   timeout ×2, paused-interruption), assert the post-condition on `trusted`/epoch/revision matches
   the *documented* policy — fails today for jog paths (F-1).
2. **Stop-reset invariant**: property test — from every `JobRunnerState`, after stop/error/complete:
   `toolChangePending==false && phase=="NONE" && pauseMode=="none" && directResumeValid==false`
   (fails today per F-4).
3. **Admission matrix**: start/test/production/jog each rejected while `jogIsActive()` and while
   machine-op active (fails today per F-3).
4. **`recoveryRequired` ⟺ `state==RecoveryRequired`** serialization test (fails today, F-12).
5. **Health JSON equality**: `handleHealth` output == `healthStatusJson(false)` field-set (layer-1
   F12; golden test).
6. **Single-committer test**: position state changes only via `updatePositionFromMarlinResponse`
   (grep-based or linker-visibility test).

Browser (vitest):
7. **Transport ordering**: with WS synchronized, an in-flight HTTP `/api/job/status` response is
   ignored or revision-checked (fails today, F-6).
8. **`jobStatusHealthy` resets** on transport loss / error slice (fails today, F-6).
9. **History contamination**: `syncRunHistoryFromStatus` with `status.gcodePath` ≠ current run path
   leaves `runHistory` untouched (fails today, F-7).
10. **No-DOM gating**: with `#arm-state` removed from the DOM, machine-bar `canSetZ/canSetup/Stop`
    still derive correctly from slices (fails today, F-8).
11. **Safe-Z parity**: machine-bar and preview clamp modules agree on the same inputs, and missing
    `frame.safeZ` disables rather than falls back (fails today, F-9).
12. **Fingerprint contract**: `fingerprintsMatch` explicitly rejects SHA-hex vs FNV-form pairs
    instead of silent false-negative; document the canonical form (F-10).
13. **Sidecar contract**: golden test that the ArduinoJson filters (7942-7944, 8170-8178) read
    exactly the fields the browser writes (guards the browser↔firmware authorization channel).

## Appendix: evidence provenance

- Four subsystem audits (agent reports, condensed into §2-§7): fw-job-lifecycle, fw-frame-telemetry,
  web-job-identity, web-machine-telemetry.
- Primary-agent spot verifications this session (17/17 confirmed): jobRunning readers;
  recoveryRequired 4757-4763; admitJobStart guards 8654-8671; handleJogStart 9195-9210; stop-branch
  toolChange asymmetry 9086-9105 vs 9146-9152; invalidateMachineFrameAfterQuickstop call sites;
  stopJogInternal + escalations; `trusted` computation 5077-5078; dead dirty flags; production-resume
  frame-gate absence 8461-8570; pollJobStatusHttp race 1738-1756; jobStatusHealthy writers;
  safeZBounds/activeSafeZLimits fallbacks; localArmState DOM scrape; canvasToolPosition precedence;
  job-core.mjs zero importers; 'AUTHORIZED' literal + check; /api/cmd busy-only gating;
  syncRunHistoryFromStatus ordering.
