import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const firmware = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');

describe('persistent active-job checkpoint', () => {
  it('records acknowledged streaming progress and execution identity on SD', () => {
    expect(firmware).toContain('kSdActiveJobCheckpointPath = "/logs/active-job.json"');
    expect(firmware).toContain('kJobCheckpointIntervalMs = 2000');
    expect(firmware).toContain('kJobCheckpointByteInterval = 4096');
    const writer = firmware.slice(
      firmware.indexOf('bool writePersistentJobCheckpoint(bool'),
      firmware.indexOf('bool beginPersistentJobCheckpoint() {'),
    );
    for (const field of [
      'activeRunFingerprint', 'lastAcknowledgedByteOffset', 'lastAcknowledgedLineNumber',
      'workZeroId', 'homingSessionId', 'toolChange', 'workPosition', 'machinePosition',
    ]) expect(writer).toContain(`\\"${field}\\"`);
    for (const field of [
      'phase', 'parked', 'toolConfirmed', 'routerReadyConfirmed', 'nextLineNumber',
      'nextByteOffset', 'command', 'handling', 'zZeroMethod', 'returnPosition',
    ]) expect(writer).toContain(`\\"${field}\\"`);
    expect(writer).toContain('{\\"schemaVersion\\":2');
  });

  it('sets the non-volatile active marker before any start path can move', () => {
    const begin = firmware.slice(
      firmware.indexOf('bool beginPersistentJobCheckpoint() {'),
      firmware.indexOf('void clearPersistentJobCheckpoint() {'),
    );
    expect(begin).toMatch(/setPersistentActiveJobMarker\(true\)[\s\S]*writePersistentJobCheckpoint\(true, false/);
    expect(firmware.match(/if \(!beginPersistentJobCheckpoint\(\)\)/g)).toHaveLength(2);
    expect(firmware).toMatch(/handleJobStart\(\)[\s\S]*beginPersistentJobCheckpoint\(\)[\s\S]*runJobStartPreamble\(\)/);
    const testMotion = firmware.slice(
      firmware.indexOf('void handleTestMotionStart()'),
      firmware.indexOf('void handleProductionResumeStart()'),
    );
    expect(testMotion).not.toContain('beginPersistentJobCheckpoint()');
  });

  it('keeps interrupted evidence, removes completed evidence, and never auto-resumes at boot', () => {
    const process = firmware.slice(
      firmware.indexOf('void processPersistentJobCheckpoint()'),
      firmware.indexOf('void loadPersistentJobCheckpointAtBoot()'),
    );
    expect(process).toMatch(/Completed[\s\S]*clearPersistentJobCheckpoint\(\)/);
    expect(process).toMatch(/Stopped[\s\S]*Error[\s\S]*writePersistentJobCheckpoint\(false, true/);
    expect(process).toContain('kJobCheckpointIntervalMs');
    expect(process).toContain('kJobCheckpointByteInterval');
    expect(process).toContain('toolChangePhaseChanged');

    const boot = firmware.slice(
      firmware.indexOf('void loadPersistentJobCheckpointAtBoot()'),
      firmware.indexOf('String jobStatusJson()'),
    );
    expect(boot).toContain('sendImmediateJobSafetyM5');
    expect(boot).toContain('machineFrame = MachineFrameState()');
    expect(boot).toContain('discarded legacy non-recoverable test-motion checkpoint');
    expect(boot).toMatch(/startMode.*validated_test_motion[\s\S]*clearPersistentJobCheckpoint\(\)/);
    expect(boot).not.toContain('openJobFileAtOffset');
    expect(boot).not.toMatch(/jobRunning\s*=\s*true/);
  });

  it('requires explicit review through dedicated recovery endpoints before new motion', () => {
    expect(firmware).toContain('httpRoute("/api/recovery/checkpoint", HTTP_GET, handleRecoveryCheckpointGet)');
    expect(firmware).toContain('operatorRoute("/api/recovery/checkpoint/acknowledge", HTTP_POST, handleRecoveryCheckpointAcknowledge)');
    expect(firmware).toContain('confirmed true is required after importing or deliberately dismissing recovery evidence');
    expect(firmware.match(/if \(recoveryCheckpointRequiresReview\)/g).length).toBeGreaterThanOrEqual(3);
  });
});
