import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const machineBar = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
const firmware = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');
const styles = await readFile(new URL('../../www/style.css', import.meta.url), 'utf8');

describe('compact machine drawer', () => {
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
  const handler = firmware.slice(firmware.indexOf('void handleGoToWorkZero()'), firmware.indexOf('void handleUpdatePage()'));

  it('allows only X, Y, or XY and blocks active job, jog, and OTA', () => {
    expect(handler).toMatch(/axes != "x" && axes != "y" && axes != "xy"/);
    expect(handler).toMatch(/otaActive[\s\S]*jobIsActive\(\)[\s\S]*jogIsActive\(\)/);
  });

  it('lifts before XY in safe mode and never sends G92, G28, M3, or M4', () => {
    expect(handler.indexOf('G0 Z')).toBeLessThan(handler.indexOf('String move = "G0"'));
    expect(handler).toContain('Z will remain at safe height after XY movement');
    expect(handler).not.toMatch(/sendChecked\("(?:G92|G28|M3|M4)(?:\s|")/);
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
