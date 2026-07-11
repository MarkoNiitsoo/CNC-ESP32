import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const machineBar = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
const firmware = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');
const styles = await readFile(new URL('../../www/style.css', import.meta.url), 'utf8');
const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const previewHtml = await readFile(new URL('../../www/preview.html', import.meta.url), 'utf8');

describe('compact machine drawer', () => {
  it('keeps geometry left and the guided preparation workflow together on the right', () => {
    expect(previewHtml).toContain('<h2>Placement</h2>');
    expect(previewHtml).toContain('<h2>Prepare & Cut</h2>');
    expect(previewHtml).not.toContain('data-preview-tab-button="setup"');
    expect(previewHtml).not.toContain('data-preview-tab-button="dry-run"');
    expect(preview).toContain("workflowButton('Continue Without Homing'");
    expect(preview).toContain("workflowButton('Use Existing G54 Coordinates'");
    expect(preview).toContain("workflowButton('Run Bounds Check'");
    expect(preview).toContain("workflowButton('Continue Without Check'");
  });

  it('persists Bounds and Aircut evidence immediately as one workflow decision', () => {
    expect(preview).toMatch(/lastBoundingBoxTraceStatus = 'complete';[\s\S]*await recordPhysicalVerification\('bounds'/);
    expect(preview).toMatch(/lastAircutStatus = 'complete';[\s\S]*await recordPhysicalVerification\('aircut'/);
    expect(preview).toMatch(/async function recordPhysicalVerification[\s\S]*ensureJobState\(\)[\s\S]*createVerificationDecision[\s\S]*await saveJobQuietly\(\)/);
  });

  it('uses one operator-facing Review and Start workflow with a one-time authorization', () => {
    expect(previewHtml).not.toContain('data-preview-tab-button="arm"');
    expect(previewHtml).toContain('data-preview-tab-button="run" data-icon="start">Start Cutting');
    expect(previewHtml).toContain('data-run-check="materialAndPathClear"');
    expect(previewHtml).toContain('data-run-check="toolAndZZeroVerified"');
    expect(previewHtml).toContain('data-run-check="spindleStateReady"');
    expect(previewHtml).not.toContain('data-run-check="toolAtWorkZero"');
    expect(preview).toMatch(/reviewAndStartJobRun[\s\S]*await startJobRun\(\)/);
    expect(preview).toContain("job.startAuthorizationToken = 'AUTHORIZED'");
  });

  it('prevents mobile long-press selection on interactive buttons', () => {
    expect(styles).toMatch(/button,[\s\S]*?\[role="button"\][\s\S]*?user-select:\s*none;[\s\S]*?-webkit-user-select:\s*none;[\s\S]*?-webkit-touch-callout:\s*none;/);
  });

  it('sets Preview work zero through the firmware-owned frame transaction', async () => {
    const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
    const start = preview.indexOf('async function setWorkZeroWithCapture(');
    const end = preview.indexOf('function downloadJobJson()', start);
    const action = preview.slice(start, end);
    expect(action).toContain("fetch('/api/work-zero/set'");
    expect(action).not.toContain("sendCmd('G92 X0 Y0 Z0')");
    expect(action).toContain('data.frame?.workZeroMachine');
    expect(action).toContain('homingEpoch');
    expect(action).toContain("job.startMode = 'use_active_work_zero'");
    expect(action).toContain('startModeSelect.value = job.startMode');
  });

  it('restores the captured X/Y before restoring Z after bounding box trace', async () => {
    const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
    const helperStart = preview.indexOf('function traceCommandsWithReturnPosition');
    const helperEnd = preview.indexOf('function commandForSegment', helperStart);
    const helper = preview.slice(helperStart, helperEnd);
    expect(helper.indexOf('`G0 X${fmtMm(position.x)} Y${fmtMm(position.y)}')).toBeLessThan(helper.indexOf('`G0 Z${fmtMm(position.z)}'));
    expect(helper).toContain("const finalWait = result.lastIndexOf('M400')");
    const sendStart = preview.indexOf('async function sendBoundingBoxTrace()');
    const sendEnd = preview.indexOf('async function sendAircutToolpath()', sendStart);
    const send = preview.slice(sendStart, sendEnd);
    expect(send).toContain('const returnCapture = await captureM114()');
    expect(send).toContain('traceCommandsWithReturnPosition(traceCommands, returnCapture)');
  });

  it('keeps the dry run operator UI minimal and mode-driven', () => {
    expect(previewHtml).toContain('id="send-dry-run"');
    expect(previewHtml).toContain('id="dry-run-aircut"');
    expect(previewHtml).toContain('id="stop-m5"');
    expect(previewHtml).toContain('Stop spindle/laser M5');
    expect(previewHtml).not.toContain('Generate Bounding Box Commands');
    expect(previewHtml).not.toContain('Generate Aircut Commands');
    expect(previewHtml).not.toContain('Copy Commands');
    expect(previewHtml).not.toContain('Copy Aircut Commands');
    expect(preview).toContain("function sendSelectedDryRun()");
    expect(preview).toContain("return dryRunModeIsAircut() ? 'Send Aircut Toolpath' : 'Send Box Trace';");
    expect(preview).toContain("if (dryRunModeIsAircut()) await sendAircutToolpath();");
    expect(preview).toContain("Spindle/laser start commands are suppressed.");
  });

  it('normalizes missing zero objects in accepted v3 job JSON before capture', async () => {
    const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
    expect(preview).toContain('function ensureZeroState(job)');
    expect(preview).toMatch(/function ensureJobState\(\)[\s\S]*?ensureZeroState\(jobState\)/);
    expect(preview).toMatch(/jobState = loaded;[\s\S]*?ensureZeroState\(jobState\)/);
    expect(preview).toMatch(/jobState = existingJob;\s*ensureZeroState\(jobState\)/);
    expect(preview).toContain('beforeG92: normalizedCapture(workZero.beforeG92)');
    expect(preview).toContain('beforeG92Z: normalizedCapture(toolZero.beforeG92Z)');
  });

  it('keeps mock identity inside the compact state and XYZ row', () => {
    const stateStart = machineBar.indexOf('<button id="mb-toggle"');
    const stateEnd = machineBar.indexOf('</button>', stateStart);
    const stateMarkup = machineBar.slice(stateStart, stateEnd);
    expect(stateMarkup).toContain('id="mb-job-state"');
    expect(stateMarkup).toContain('id="mb-xyz"');
    expect(stateMarkup).toContain('id="mb-mock-badge"');
    expect(stateMarkup).not.toContain('DEV MOCK - NO REAL MACHINE</strong>');
  });

  it('keeps Pause/Resume, Stop, and M5 in one compact action row', () => {
    expect(machineBar).toMatch(/machine-drawer-actions[\s\S]*mb-drawer-pause-resume[\s\S]*mb-drawer-stop[\s\S]*mb-drawer-m5/);
    expect(machineBar).toContain("const pauseLabel = paused ? 'Resume' : 'Pause'");
  });

  it('keeps feed presets, homing, terminal, and the joystick edge dock compact and present', () => {
    expect(machineBar).toMatch(/machine-feed-adjust[\s\S]*machine-feed-presets/);
    expect(machineBar).toMatch(/machine-homing-axis-row[\s\S]*machine-homing-action-row/);
    expect(machineBar).toMatch(/mb-terminal-select[\s\S]*mb-marlin-log/);
    expect(machineBar).toMatch(/machine-jog-dock[\s\S]*mb-jog-dock-toggle[\s\S]*mb-jog-settings-toggle[\s\S]*mb-jog-pad/);
    expect(machineBar).toMatch(/machine-jog-dock-settings[\s\S]*data-mb-jog-z="1"[\s\S]*data-mb-jog-z="-1"/);
    expect(machineBar).toContain('machine-jog-handle-label');
    expect(machineBar).toContain('>Jog</span>');
    expect(machineBar.indexOf('mb-jog-pad')).toBeLessThan(machineBar.indexOf('id="machine-drawer"'));
    expect(machineBar).toContain('if (!STATE.jogDockOpen) STATE.jogSettingsOpen = false');
  });

  it('stops active jog on pointer release, cancel, blur, and visibility loss', () => {
    expect(machineBar).toContain("window.addEventListener('pointerup', end, true)");
    expect(machineBar).toContain("window.addEventListener('pointercancel', end, true)");
    expect(machineBar).toContain("pad?.addEventListener('lostpointercapture', end)");
    expect(machineBar).toContain("window.addEventListener('blur', () => stopJog()");
    expect(machineBar).toMatch(/document\.hidden[\s\S]*stopJog\(\)/);
    expect(machineBar).toMatch(/async function stopJog[\s\S]*resetJoystickVisual\(\)[\s\S]*if \(!shouldStop\) return/);
    expect(machineBar).toContain('if (sessionId === jogSessionId) STATE.jog = jog');
    expect(styles).toMatch(/\.machine-jog-dock\s*\{[\s\S]*?z-index:\s*120;[\s\S]*?pointer-events:\s*none;/);
    expect(styles).toMatch(/\.machine-jog-dock-panel\s*\{[\s\S]*?pointer-events:\s*auto;/);
    expect(styles).toMatch(/\.machine-jog-handle\s*\{[\s\S]*?width:\s*28px;[\s\S]*?min-height:\s*74px;[\s\S]*?var\(--cnc-accent\) 68%/);
    expect(styles).toMatch(/\.machine-jog-z-settings button[\s\S]*?-webkit-touch-callout:\s*none;/);
    expect(machineBar).toContain("item.addEventListener('contextmenu', (event) => event.preventDefault())");
  });

  it('publishes commanded jog positions immediately without periodic M114 traffic', () => {
    expect(machineBar).toContain("publishPosition('JOG_CMD')");
    expect(machineBar).toContain("publishPosition('M114')");
    expect(machineBar).toMatch(/sendJogUpdate[\s\S]*applyPredictedJogTick\(vector, settings\)/);
    expect(machineBar).not.toMatch(/setInterval\([\s\S]{0,180}pollPosition/);
    expect(machineBar).not.toContain('refreshJobStatus().then(() => pollPosition())');
    expect(machineBar).toContain("button('mb-m114', refreshPosition)");
    expect(machineBar).toContain("subscribe('position'");
    expect(machineBar).toContain("applyFrame(data, 'MARLIN')");
    expect(machineBar).toMatch(/async function home[\s\S]*apiPost\('\/api\/machine\/home'/);
  });
});

describe('firmware-backed Go To Work Zero', () => {
  it('anchors machine coordinates to Home All counts instead of the previous G92 frame', () => {
    expect(firmware).toContain('parseM114Counts');
    expect(firmware).toContain('parseM92Steps');
    expect(firmware).toContain('machineFrame.absoluteFromHome = true');
    expect(firmware).toMatch(/countX - machineFrame\.homeCountX/);
    expect(firmware).toContain('homingSessionId');
    expect(preview).toContain('homingSessionId: zeroReference.homingSessionId');
  });
  const handler = firmware.slice(
    firmware.indexOf('void handleGoToWorkZero()'),
    firmware.indexOf('void handleRestoreWorkZero()')
  );

  it('allows only X, Y, or XY and blocks active job, jog, and OTA', () => {
    expect(handler).toMatch(/axes != "x" && axes != "y" && axes != "xy"/);
    expect(handler).toMatch(/otaActive[\s\S]*jobIsActive\(\)[\s\S]*jogIsActive\(\)/);
  });

  it('lifts before XY in safe mode and never sends G92, G28, M3, or M4', () => {
    expect(handler.indexOf('G0 Z')).toBeLessThan(handler.indexOf('String move = "G0"'));
    expect(handler).toContain('Z will remain at safe height after XY movement');
    expect(handler).not.toMatch(/sendChecked\("(?:G92|G28|M3|M4)(?:\s|")/);
    expect(handler).toContain('extractJsonFloat(body, "travelFeedMmMin", kDefaultTravelFeed)');
    expect(handler).toContain('String(travelFeedMmMin, 0)');
    expect(machineBar).toContain('travelFeedMmMin: Math.round(travelSpeedMmS * 60)');
  });
});

describe('firmware-owned coordinate frames', () => {
  it('owns homing and work-zero transitions in dedicated endpoints', () => {
    expect(firmware).toContain('server.on("/api/machine/frame", HTTP_GET, handleMachineFrame)');
    expect(firmware).toContain('server.on("/api/machine/home", HTTP_POST, handleMachineHome)');
    expect(firmware).toContain('server.on("/api/work-zero/set", HTTP_POST, handleSetWorkZero)');
    expect(machineBar).toContain("apiPost('/api/machine/home'");
    expect(machineBar).toContain("apiPost('/api/work-zero/set'");
  });

  it('never reapplies G92 from the normal Start Job preamble', () => {
    const preamble = firmware.slice(firmware.indexOf('bool runJobStartPreamble() {'), firmware.indexOf('void handleJobStatus()'));
    expect(preamble).not.toMatch(/G92/);
    expect(firmware).toContain('startMode must use an active homed or manually confirmed work frame');
    expect(preview).toContain("'use_manual_work_frame'");
    expect(previewHtml).not.toContain('value="apply_current_position_as_work_zero"');
  });

  it('runs Start Job preamble asynchronously before streaming file lines', () => {
    const preamble = firmware.slice(firmware.indexOf('bool runJobStartPreamble() {'), firmware.indexOf('void handleJobStatus()'));
    expect(preamble).toContain('appendPriorityCommand(command)');
    expect(firmware).toContain('jobStatus.state == JobRunnerState::Preparing');
    expect(firmware).toContain('start preamble complete: ');
    expect(preview).toContain('Network reply was lost; reconciled');
  });

  it('enables position autoreport and parses reports while a streamed command is active', () => {
    const preamble = firmware.slice(firmware.indexOf('bool runJobStartPreamble() {'), firmware.indexOf('void handleJobStatus()'));
    const runner = firmware.slice(firmware.indexOf('void processJobRunner() {'), firmware.indexOf('String htmlPage'));
    expect(preamble).toContain('appendPriorityCommand("M154 S1")');
    expect(runner).toContain('updatePositionFromMarlinResponse(marlinAsyncLine)');
    expect(firmware).toContain('machinePosition');
    expect(preview).toContain('sequence: data.currentLineNumber');
  });

  it('keeps position fields valid inside job status JSON', () => {
    const statusJson = firmware.slice(firmware.indexOf('String jobStatusJson()'), firmware.indexOf('String jobStatusJsonWithMessage'));
    expect(statusJson).toContain('json += ",\\\"machinePosition\\\":"');
    expect(statusJson).toContain('json += ",\\\"uptimeMs\\\":"');
    expect(statusJson).not.toContain('json += "\\\",\\\"uptimeMs\\\":"');
  });

  it('shows separate machine/work coordinates and predicts both from jog commands', () => {
    expect(machineBar).toContain('`M X ${fmtAxis(machine.x)}');
    expect(machineBar).toContain('STATE.frame.work = { ...STATE.position }');
    expect(machineBar).toContain('x: zero.x + STATE.position.x');
  });
});

describe('firmware-backed Safe Jog Z ceiling', () => {
  const startHandler = firmware.slice(firmware.indexOf('void handleJogStart()'), firmware.indexOf('void handleJogUpdate()'));
  const safeLift = firmware.slice(firmware.indexOf('bool prepareSafeJogLift()'), firmware.indexOf('void processJogRunner()'));

  it('silently clamps the requested target and moves in native machine coordinates', () => {
    expect(firmware).toContain('constexpr float kMachineZMaxMm = 70.0f');
    expect(startHandler).toContain('0.0f, kMachineZMaxMm');
    expect(safeLift).toContain('G53 G0 Z');
    expect(safeLift).toContain('captureJogSafeLiftWorkZ()');
    expect(machineBar).toContain('Math.min(MACHINE_Z_MAX_MM');
    expect(machineBar).toContain('max="70"');
  });

  it('decouples smooth 25 ms movement ticks from browser heartbeat timing', () => {
    const runner = firmware.slice(firmware.indexOf('void processJogRunner()'), firmware.indexOf('void processJogZRestore()'));
    expect(firmware).toContain('constexpr uint32_t kJogTickIntervalMs = 25');
    expect(firmware).toContain('constexpr uint8_t kJogPlannerLookahead = 6');
    expect(firmware).toContain('constexpr float kJogVectorRampPerTick = 0.125f');
    expect(startHandler).toContain('sendJogCommandForResponse("G91", 300)');
    expect(runner).toContain('processJogResponses()');
    expect(runner).toContain('jogStatus.pendingMoveAcks >= kJogPlannerLookahead');
    expect(runner).toContain('String cmd = "G1"');
    expect(runner).not.toContain('String cmd = "G91\\nG0"');
    expect(runner).not.toContain('readMarlinResponseFor(60');
  });

  it('restores absolute mode for release, deadman, and acknowledgement failure', () => {
    const stop = firmware.slice(firmware.indexOf('void stopJogInternal'), firmware.indexOf('void setJogError'));
    const runner = firmware.slice(firmware.indexOf('void processJogRunner()'), firmware.indexOf('void processJogZRestore()'));
    expect(stop).toContain('sendJogCommand("G90")');
    expect(runner).toContain('kJogDeadmanMs');
    expect(runner).toContain('Marlin jog acknowledgement timed out');
    expect(runner).toContain('sendJogCommand("M410")');
    expect(runner).toContain('sendJogCommand("G90")');
  });
});
