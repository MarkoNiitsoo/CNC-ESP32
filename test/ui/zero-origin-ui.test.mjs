import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const html = await readFile(new URL('../../www/preview.html', import.meta.url), 'utf8');
const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const machineBar = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
const firmware = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');
const controller = await readFile(new URL('../../www/lib/workbench-controller.js', import.meta.url), 'utf8');

describe('operator Zero / Origin workflow', () => {
  it('keeps operator zero actions and saved-zero restore visible at the start of Prepare', () => {
    const panel = html.slice(html.indexOf('zero-origin-panel'), html.indexOf('feed-override-panel'));
    expect(panel).toContain('Zero / Origin');
    expect(panel).toContain('Home Machine');
    expect(panel).toContain('Set Work Zero');
    expect(panel).toContain('Set Zero X');
    expect(panel).toContain('Set Zero Y');
    expect(panel).toContain('Set Zero Z');
    expect(panel).toContain('History');
    expect(panel).toContain('data-preview-tab="preflight"');
    expect(panel).toContain('id="prepare-work-zero-history"');
    expect(panel).toContain('id="restore-prepare-work-zero"');
    expect(panel).toContain('Restore &amp; Activate');
    expect(panel).not.toMatch(/Load Job|Save Job|Capture Current Position|G92|Job JSON|Raw M114/);
    expect(controller).toContain("'.zero-origin-panel'");
    expect(controller).not.toContain("'.tool-zero-panel'");
    expect(html).toContain('class="panel feed-override-panel preview-tab-panel" data-preview-tab="run"');
  });

  it('offers guarded Home All where homing is required', () => {
    expect(preview).toContain("workflowButton('Home All'");
    expect(preview).toContain("workflowButton('Continue Without Homing'");
    expect(preview).toContain("window.dispatchEvent(new CustomEvent('cnc-home-machine-request'))");
    expect(machineBar).toMatch(/cnc-home-machine-request[\s\S]*home\('G28'[\s\S]*true\)/);
  });

  it('keeps detailed history in a dialog while exposing work-zero restore inline', () => {
    expect(html).toContain('<dialog id="zero-history-dialog"');
    expect(html).toContain('<details class="diagnostics-panel">');
    expect(html).toContain('<summary>Advanced / Diagnostics</summary>');
    expect(preview).toContain("zeroHistoryDialog.showModal()");
    expect(preview).toContain('Last run: not used yet');
    expect(preview).toContain('Restore &amp; Go');
    expect(preview).toContain('function renderPrepareWorkZeroHistory()');
    expect(preview).toContain('function selectedPrepareWorkZero()');
    expect(preview).toContain('Saved work zero — not active');
    expect(preview).toContain('currentMachineFrame?.workZeroValid === true');
    expect(preview).toMatch(/restorePrepareWorkZeroButton[\s\S]*restoreHistoryZero\(zero\)/);
    expect(preview).toMatch(/async function restoreHistoryZero[\s\S]*safeMachineZ[\s\S]*moveToZ: true/);
    expect(preview).toContain('Legacy zero — machine position not recorded');
  });

  it('automatically saves verified XYZ/X/Y/Z zero transactions', () => {
    expect(preview).toContain("setWorkZeroWithCapture(null, 'xyz')");
    expect(preview).toContain("setWorkZeroWithCapture(null, 'x')");
    expect(preview).toContain("setWorkZeroWithCapture(null, 'y')");
    expect(preview).toContain("setZZeroWithCapture(null, { confirm: false })");
    expect(preview).toMatch(/async function setWorkZeroWithCapture[\s\S]*await saveJobQuietly\(\)/);
    expect(preview).toMatch(/async function setZZeroWithCapture[\s\S]*await saveJobQuietly\(\)/);
  });

  it('supports backward-compatible per-axis firmware zeroing', () => {
    const handler = firmware.slice(firmware.indexOf('void handleSetWorkZero()'), firmware.indexOf('void handleSetZZero()'));
    expect(handler).toContain('if (axes.length() == 0) axes = "xyz"');
    expect(handler).toContain('axes must be x, y, or xyz');
    expect(handler).toContain('zeroCommand += " X0"');
    expect(handler).toContain('zeroCommand += " Y0"');
    expect(handler).toContain('if (axes == "xyz") zeroCommand += " Z0"');
  });
});
