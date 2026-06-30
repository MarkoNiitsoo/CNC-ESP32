import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const machineBar = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
const firmware = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');

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
    expect(machineBar.indexOf('mb-jog-pad')).toBeLessThan(machineBar.indexOf('id="machine-drawer"'));
    expect(machineBar).toContain('if (!STATE.jogDockOpen) STATE.jogSettingsOpen = false');
  });

  it('stops active jog on pointer release, cancel, blur, and visibility loss', () => {
    expect(machineBar).toMatch(/pointerup[\s\S]*pointercancel/);
    expect(machineBar).toContain("window.addEventListener('blur', () => stopJog()");
    expect(machineBar).toMatch(/document\.hidden[\s\S]*stopJog\(\)/);
    expect(machineBar).toContain("if (!force && !jogTimer && !jogIsUiActive()) return");
  });

  it('publishes M114 positions but does not poll them during active jobs', () => {
    expect(machineBar).toContain("new CustomEvent('cnc-position-update'");
    expect(machineBar).toMatch(/async function pollPosition\(\)[\s\S]*ACTIVE_STATES\.has\(state\)[\s\S]*cmd: 'M114'/);
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
