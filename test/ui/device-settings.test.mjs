import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { deviceIdentityLocked, localUrlForHostname, sanitizeHostnameInput } from '../../www/lib/device-settings.js';

const html = await readFile(new URL('../../www/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../../www/app.js', import.meta.url), 'utf8');

describe('Machine Identity settings', () => {
  it('previews the same safe bare hostname rules as firmware', () => {
    expect(sanitizeHostnameInput(' Low Rider 3 ')).toBe('low-rider-3');
    expect(sanitizeHostnameInput('cnc.local')).toBe('cnc');
    expect(sanitizeHostnameInput('___')).toBe('cnc');
    expect(localUrlForHostname('g-code-cnc')).toBe('http://g-code-cnc.local');
  });

  it('locks identity changes for every active and paused runner state', () => {
    ['PREPARING', 'RUNNING', 'PAUSING', 'PAUSED', 'RESUMING', 'STOPPING'].forEach((state) => {
      expect(deviceIdentityLocked(state)).toBe(true);
    });
    ['IDLE', 'STOPPED', 'COMPLETED', 'ERROR'].forEach((state) => {
      expect(deviceIdentityLocked(state)).toBe(false);
    });
  });

  it('shows current identity, editable fields, URL preview, and restart action', () => {
    expect(html).toContain('Machine Identity');
    expect(html).toContain('id="device-friendly-name"');
    expect(html).toContain('id="device-hostname"');
    expect(html).toContain('id="device-url-preview"');
    expect(html).toContain('without .local');
    expect(html).toContain('id="restart-device"');
  });

  it('uses PATCH and the safe restart endpoint', () => {
    expect(app).toContain("method: 'PATCH'");
    expect(app).toContain("fetch('/api/device'");
    expect(app).toContain("fetch('/api/system/restart', { method: 'POST' })");
    expect(app).toContain('New address will be available after restart');
  });
});
