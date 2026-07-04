import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const machineBar = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
const firmware = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');
const styles = await readFile(new URL('../../www/style.css', import.meta.url), 'utf8');

describe('compact machine drawer', () => {
  it('prevents mobile long-press selection on interactive buttons', () => {
    expect(styles).toMatch(/button,[\s\S]*?\[role="button"\][\s\S]*?user-select:\s*none;[\s\S]*?-webkit-user-select:\s*none;[\s\S]*?-webkit-touch-callout:\s*none;/);
  });

  it('sets and verifies Preview work zero before optional machine-reference discovery', async () => {
    const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
    const start = preview.indexOf('async function setWorkZeroWithCapture()');
    const end = preview.indexOf('function downloadJobJson()', start);
    const action = preview.slice(start, end);
    expect(action.indexOf("await sendCmd('G92 X0 Y0 Z0')")).toBeLessThan(action.indexOf("await sendCmd('M503')"));
    expect(action).toContain('Marlin did not confirm work zero after G92');
    expect(action).toMatch(/G92 X0 Y0 Z0'[\s\S]*const after = await captureM114\(\)/);
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

  it('normalizes missing zero objects in old or partial job JSON before capture', async () => {
    const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
    expect(preview).toContain('function ensureZeroState(job)');
    expect(preview).toMatch(/function ensureJobState\(\)[\s\S]*?ensureZeroState\(jobState\)/);
    expect(preview).toMatch(/jobState = await res\.json\(\);\s*ensureZeroState\(jobState\)/);
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
    expect(machineBar).toContain("publishPosition('MARLIN')");
    expect(machineBar).toMatch(/async function home[\s\S]*await sendCmd\(cmd\);[\s\S]*await refreshPosition\(\)/);
  });
});

describe('firmware-backed Go To Work Zero', () => {
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
});
