import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const firmware = (await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const machineBar = (await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const styles = (await readFile(new URL('../../www/style.css', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

describe('single operator control lease', () => {
  it('stores only a PIN digest and issues one persistent HttpOnly controller cookie', () => {
    expect(firmware).toContain('kOperatorPrefsPinHashKey = "pinHash"');
    expect(firmware).toContain('operatorPinDigest(const String &pin)');
    expect(firmware).toContain('mbedtls_sha256_ret');
    expect(firmware).toContain('kOperatorLeaseMs = 45000');
    expect(firmware).toContain('Set-Cookie", "cnc_operator=" + operatorSessionToken');
    expect(firmware).toContain('SameSite=Strict; HttpOnly');
    expect(firmware).toContain('kOperatorCookieMaxAgeSeconds = 31536000');
    expect(firmware).toContain('kOperatorMaxPinAttempts = 5');
    expect(firmware).toContain('server.client().localIP() != WiFi.softAPIP()');
    expect(firmware).toContain('initial operator PIN must be set through the device Setup AP');
  });

  it('recognizes the same browser after lease expiry without blocking a later takeover', () => {
    expect(firmware).not.toContain('operatorSessionToken = "";\n  operatorSessionOwner = "";\n  operatorOtaUnlockedUntilMs = 0;\n  return false;');
    expect(firmware).toMatch(/operatorRequestAuthorized[\s\S]*token != operatorSessionToken[\s\S]*!operatorSessionActive\(\)[\s\S]*operatorSessionLastSeenMs = millis\(\)/);
    expect(firmware).toMatch(/const bool controller = active && operatorSessionToken\.length\(\) > 0/);
  });

  it('restores only the remembered browser after restart without asking for the PIN', () => {
    expect(firmware).toContain('kOperatorPrefsBrowserHashKey = "browserHash"');
    expect(firmware).toContain('operatorBrowserDigest(const String &browserId)');
    expect(firmware).toContain('httpRoute("/api/operator/reconnect", HTTP_POST, handleOperatorReconnect)');
    expect(firmware).toMatch(/handleOperatorReconnect[\s\S]*operatorRememberedBrowserHash[\s\S]*newOperatorToken/);
    expect(machineBar).toContain("const OPERATOR_BROWSER_ID_KEY = 'cnc.operator.browserId'");
    expect(machineBar).toContain("fetch('/api/operator/reconnect'");
    expect(machineBar).toContain('body: JSON.stringify({ owner, pin, browserId })');
  });

  it('uses a stable non-secret control session epoch instead of the owner label', () => {
    expect(firmware).toContain('uint32_t operatorControlSessionEpoch = 0');
    expect(firmware).toContain('void beginOperatorControlSession()');
    expect(firmware).toContain('controlSessionEpoch');
    expect(firmware).toMatch(/handleOperatorClaim[\s\S]*beginOperatorControlSession\(\)/);
    expect(firmware).toMatch(/handleOperatorReconnect[\s\S]*if \(activeSession\)[\s\S]*operatorSessionLastSeenMs = millis\(\);[\s\S]*else \{[\s\S]*beginOperatorControlSession\(\)/);
    expect(machineBar).toContain('localSessionEpoch === globalSessionEpoch');
    expect(machineBar).not.toContain('data.owner !== local.owner');
  });

  it('guards every state-changing machine route while leaving status reads public', () => {
    expect(firmware).toContain('httpRoute("/api/operator/status", HTTP_GET, handleOperatorStatus)');
    expect(firmware).toContain('httpRoute("/api/operator/claim", HTTP_POST, handleOperatorClaim)');
    for (const route of [
      '/api/cmd', '/api/job/start', '/api/job/pause', '/api/job/resume', '/api/job/stop',
      '/api/jog/start', '/api/jog/update', '/api/jog/stop', '/api/machine/home',
      '/api/work-zero/set', '/api/work-zero/restore', '/api/delete', '/api/rename',
    ]) expect(firmware).toContain(`operatorRoute("${route}"`);
    expect(firmware).toContain('httpRoute("/api/job/status", HTTP_GET, handleJobStatus)');
    expect(firmware).toContain('httpRoute("/api/machine/frame", HTTP_GET, handleMachineFrame)');
  });

  it('requires an idle controller and a second PIN confirmation for OTA', () => {
    expect(firmware).toContain('httpRoute("/api/operator/ota-unlock", HTTP_POST, handleOperatorOtaUnlock)');
    expect(firmware).toContain('kOperatorOtaUnlockMs = 120000');
    expect(firmware).toMatch(/handleOperatorOtaUnlock[\s\S]*jobIsActive\(\)[\s\S]*verifyOperatorPin/);
    expect(firmware).toMatch(/UPLOAD_FILE_START[\s\S]*operatorOtaUnlocked\(\)/);
    expect(firmware).not.toContain('TODO: Protect OTA');
  });

  it('shows the controller owner and blocks motion controls in read-only browsers', () => {
    expect(machineBar).toContain('id="mb-operator-strip"');
    expect(machineBar).toContain("controller ? `● ${owner}`");
    expect(machineBar).toContain("button.title = controller");
    expect(machineBar).toContain("? `Controller: ${owner}`");
    expect(machineBar).toContain("fetch('/api/operator/heartbeat'");
    expect(machineBar).toContain("fetch('/api/operator/pin'");
    expect(machineBar).toContain('panel.hidden = !STATE.operatorPanelOpen');
    expect(machineBar).toContain("response.status === 423");
    expect(machineBar).toContain("const data = await response.clone().json().catch(() => ({}))");
    expect(machineBar).toContain("data?.readOnly === true && typeof data?.configured === 'boolean'");
    expect(machineBar).toContain('operatorRequestWasUserInitiated && response.status === 423');
    expect(machineBar).toContain('id="mb-operator-cancel"');
    expect(machineBar).toMatch(/mb-operator-cancel[\s\S]*STATE\.operatorPanelOpen = false/);
    expect(machineBar).not.toContain('STATE.operatorPanelOpen = true;\n    }\n    renderOperatorLock();');
    expect(styles).toContain('body.operator-read-only .machine-actions');
    expect(styles).toContain('body.operator-read-only .machine-jog-dock');
    expect(styles).toMatch(/\.machine-operator-strip \{[\s\S]*position: absolute;[\s\S]*top: 1px;/);
    expect(styles).toMatch(/\.machine-operator-strip button \{[\s\S]*font-size: 0\.56rem;/);
    expect(styles).not.toMatch(/body\.operator-read-only \.machine-actions,[\s\S]{0,100}pointer-events: none/);
  });
});
