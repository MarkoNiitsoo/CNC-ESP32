import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseM211State, parseM503Configuration } from '../../www/lib/machine-config.js';

const firmware = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');
const html = await readFile(new URL('../../www/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../../www/app.js', import.meta.url), 'utf8');
const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');

describe('machine discovery and configuration', () => {
  it('parses editable M503 groups and M211 state', () => {
    const response = 'M92 X100 Y101 Z400\nM203 X120 Y80 Z6\nM201 X1000 Y900 Z100\nM204 P500 R400 T800\nok\n';
    expect(parseM503Configuration(response)).toEqual({
      M92: { x: 100, y: 101, z: 400 }, M203: { x: 120, y: 80, z: 6 },
      M201: { x: 1000, y: 900, z: 100 }, M204: { p: 500, r: 400, t: 800 },
    });
    expect(parseM211State('Software Endstops: On\nok')).toMatchObject({ enabled: true });
    expect(parseM211State('Software Endstops: Off\nok')).toMatchObject({ enabled: false });
  });

  it('exposes cached M115 info and guarded editable endpoints', () => {
    expect(firmware).toContain('firmwareVersion = "0.6.7-zero-origin"');
    expect(firmware).toContain('Preferences machinePrefs');
    expect(firmware).toContain('area:{full:{min:{x:%f,y:%f,z:%f}');
    expect(firmware).toContain('server.on("/api/machine/info", HTTP_GET, handleMachineInfo)');
    expect(firmware).toContain('server.on("/api/machine/apply", HTTP_POST, handleMachineApply)');
    expect(firmware).toContain('server.on("/api/machine/save", HTTP_POST, handleMachineSave)');
    expect(firmware).toMatch(/machineConfigurationBusy\(\)[\s\S]*machineDiscoveryTransportBusy/);
    expect(firmware).toContain('editable group must be M92, M203, M201, or M204');
  });

  it('makes Apply temporary and M500 persistence explicit in Settings', () => {
    expect(html).toContain('id="machine-info-summary"');
    expect(html).toContain('data-machine-group="M92"');
    expect(html).toContain('data-machine-group="M203"');
    expect(html).toContain('data-machine-group="M201"');
    expect(html).toContain('data-machine-group="M204"');
    expect(html).toContain('Save applied changes to Marlin EEPROM (M500)');
    expect(app).toContain("fetch('/api/machine/save'");
    expect(app).toContain('applied to Marlin RAM');
    expect(preview).toContain("fetch('/api/machine/info')");
  });
});
