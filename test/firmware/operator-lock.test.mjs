import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const firmware = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');
const machineBar = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../../www/style.css', import.meta.url), 'utf8');

describe('single operator control lease', () => {
  it('stores only a PIN digest and issues one expiring HttpOnly controller cookie', () => {
    expect(firmware).toContain('kOperatorPrefsPinHashKey = "pinHash"');
    expect(firmware).toContain('operatorPinDigest(const String &pin)');
    expect(firmware).toContain('mbedtls_sha256_ret');
    expect(firmware).toContain('kOperatorLeaseMs = 45000');
    expect(firmware).toContain('Set-Cookie", "cnc_operator=" + operatorSessionToken');
    expect(firmware).toContain('SameSite=Strict; HttpOnly');
    expect(firmware).toContain('kOperatorMaxPinAttempts = 5');
    expect(firmware).toContain('server.client().localIP() != WiFi.softAPIP()');
    expect(firmware).toContain('initial operator PIN must be set through the device Setup AP');
  });

  it('guards every state-changing machine route while leaving status reads public', () => {
    expect(firmware).toContain('server.on("/api/operator/status", HTTP_GET, handleOperatorStatus)');
    expect(firmware).toContain('server.on("/api/operator/claim", HTTP_POST, handleOperatorClaim)');
    for (const route of [
      '/api/cmd', '/api/job/start', '/api/job/pause', '/api/job/resume', '/api/job/stop',
      '/api/jog/start', '/api/jog/update', '/api/jog/stop', '/api/machine/home',
      '/api/work-zero/set', '/api/work-zero/restore', '/api/delete', '/api/rename',
    ]) expect(firmware).toContain(`operatorRoute("${route}"`);
    expect(firmware).toContain('server.on("/api/job/status", HTTP_GET, handleJobStatus)');
    expect(firmware).toContain('server.on("/api/machine/frame", HTTP_GET, handleMachineFrame)');
  });

  it('requires an idle controller and a second PIN confirmation for OTA', () => {
    expect(firmware).toContain('server.on("/api/operator/ota-unlock", HTTP_POST, handleOperatorOtaUnlock)');
    expect(firmware).toContain('kOperatorOtaUnlockMs = 120000');
    expect(firmware).toMatch(/handleOperatorOtaUnlock[\s\S]*jobIsActive\(\)[\s\S]*verifyOperatorPin/);
    expect(firmware).toMatch(/UPLOAD_FILE_START[\s\S]*operatorOtaUnlocked\(\)/);
    expect(firmware).not.toContain('TODO: Protect OTA');
  });

  it('shows the controller owner and blocks motion controls in read-only browsers', () => {
    expect(machineBar).toContain('id="mb-operator-strip"');
    expect(machineBar).toContain('READ ONLY: claim control');
    expect(machineBar).toContain('CONTROL: ${owner}');
    expect(machineBar).toContain("fetch('/api/operator/heartbeat'");
    expect(machineBar).toContain("fetch('/api/operator/pin'");
    expect(styles).toContain('body.operator-read-only .machine-actions');
    expect(styles).toContain('body.operator-read-only .machine-jog-dock');
  });
});
