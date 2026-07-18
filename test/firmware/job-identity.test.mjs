import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const firmware = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');
const platformio = await readFile(new URL('../../platformio.ini', import.meta.url), 'utf8');
const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');

describe('firmware-owned active run identity', () => {
  it('uses a real filtered JSON parser instead of token searches for normal job authorization', () => {
    expect(platformio).toContain('bblanchon/ArduinoJson@^7.4.0');
    const loader = firmware.slice(
      firmware.indexOf('bool loadJobExecutionAuthorization('),
      firmware.indexOf('bool isHexSha256('),
    );
    expect(loader).toContain('deserializeJson(doc, file, DeserializationOption::Filter(filter))');
    expect(loader).toContain('filter["activeRun"]');
    expect(loader).toContain('filter["startAuthorization"]');
    expect(loader).toContain('filter["verificationDecision"]');
    expect(loader).not.toContain('filter["arm"]');
    expect(loader).not.toContain('jobFileContainsText');
  });

  it('binds path, mode, size, fingerprint, arm, verification, work zero, and homing identity', () => {
    const start = firmware.indexOf('bool validateJobExecutionAuthorization(');
    const validator = firmware.slice(start, firmware.indexOf('struct ProductionResumeIdentity', start));
    for (const field of [
      'activeRunMode', 'activeRunPath', 'activeRunFingerprint', 'activeRunSizeBytes',
      'authorizationRunMode', 'verificationRunFingerprint',
      'activeWorkZeroId', 'authorizationHomingEpoch', 'authorizationHomingSessionId',
    ]) expect(validator).toContain(field);
    expect(validator).toContain('activeRunFileMatches');
    expect(validator).not.toContain('arm identity');
  });

  it('streams the file through SHA-256 or byte-based FNV and checks size before movement', () => {
    const matcher = firmware.slice(
      firmware.indexOf('bool activeRunFileMatches('),
      firmware.indexOf('bool validateJobExecutionAuthorization('),
    );
    expect(matcher).toContain('file.size() != expectedSize');
    expect(matcher).toContain('mbedtls_sha256_update_ret');
    expect(matcher).toContain('hash *= 0x01000193u');
    expect(preview).toContain('job.activeRun = { ...(job.activeRun || {}), sizeBytes: activeRunSizeBytes }');
    expect(preview).toContain('verification.activeRunSizeBytes = activeRunSizeBytes');
    expect(preview).toContain('activeRunSizeBytes,');
    expect(firmware).toMatch(/validateJobExecutionAuthorization[\s\S]*beginPersistentJobCheckpoint/);
  });
});
