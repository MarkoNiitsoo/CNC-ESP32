import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOOL_CHANGE_SETTINGS,
  normalizeToolChangeSettings,
  touchPlateAvailable,
} from '../../www/lib/tool-change-settings.js';

const firmware = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');
const html = await readFile(new URL('../../www/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../../www/app.js', import.meta.url), 'utf8');

describe('tool-change device settings', () => {
  it('uses a safe manual pause when no choices have been made', () => {
    expect(DEFAULT_TOOL_CHANGE_SETTINGS).toMatchObject({
      handling: 'pause', zZeroMethod: 'manual', touchPlateEnabled: false,
    });
    expect(normalizeToolChangeSettings({ handling: 'unknown', zZeroMethod: 'touchplate' })).toMatchObject({
      handling: 'pause', zZeroMethod: 'manual', touchPlateEnabled: false,
    });
    expect(touchPlateAvailable({ touchPlateEnabled: true })).toBe(true);
  });

  it('normalizes persisted numeric settings and enables touch-plate Z zero explicitly', () => {
    expect(normalizeToolChangeSettings({
      handling: 'park', parkMachineX: '20.5', parkMachineY: '42', parkMachineZ: '70',
      zZeroMethod: 'touchplate', touchPlateEnabled: true, touchPlateThickness: '12.7',
      touchPlateProbeDistance: '25', touchPlateProbeFeed: '80', touchPlateRetractDistance: '2',
    })).toEqual({
      handling: 'park', parkMachineX: 20.5, parkMachineY: 42, parkMachineZ: 70,
      zZeroMethod: 'touchplate', touchPlateEnabled: true, touchPlateThickness: 12.7,
      touchPlateProbeDistance: 25, touchPlateProbeFeed: 80, touchPlateRetractDistance: 2,
    });
  });

  it('exposes editable device settings in firmware and the Settings view', () => {
    expect(html).toContain('id="tool-change-settings-form"');
    expect(html).toContain('id="tool-change-handling"');
    expect(html).toContain('id="touch-plate-enabled"');
    expect(html).toContain('name="touchPlateThickness"');
    expect(app).toContain("fetch('/api/tool-change/settings'");
    expect(app).toContain("method: 'PUT'");
    expect(firmware).toContain('Preferences toolChangePrefs');
    expect(firmware).toContain('server.on("/api/tool-change/settings", HTTP_GET, handleToolChangeSettingsGet)');
    expect(firmware).toContain('server.on("/api/tool-change/settings", HTTP_PUT, handleToolChangeSettingsPut)');
    expect(firmware).toContain('loadToolChangeSettings();');
  });
});
