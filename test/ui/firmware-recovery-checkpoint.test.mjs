import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../../www/preview.html', import.meta.url), 'utf8');
const machineBar = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');

describe('firmware recovery checkpoint UI', () => {
  it('shows pending firmware evidence and provides a deliberate dismiss action', () => {
    expect(html).toContain('id="firmware-recovery-checkpoint"');
    expect(html).toContain('id="firmware-recovery-dismiss"');
    expect(preview).toContain("fetch('/api/recovery/checkpoint')");
    expect(preview).toContain("fetch('/api/recovery/checkpoint/acknowledge'");
    expect(preview).toContain('Dismiss this firmware recovery record without importing it into a job?');
  });

  it('imports only a matching job and saves durable history before acknowledgement', () => {
    expect(preview).toMatch(/function firmwareCheckpointMatchesCurrentJob[\s\S]*Boolean\(checkpoint\.jobPath\)[\s\S]*checkpoint\.jobPath === jobPathFor\(filePath\)/);
    const importer = preview.slice(
      preview.indexOf('async function loadFirmwareRecoveryCheckpoint()'),
      preview.indexOf('async function dismissFirmwareRecoveryCheckpoint()'),
    );
    expect(importer).toContain("state: 'PAUSED'");
    expect(importer).toContain('lastAcknowledgedByteOffset');
    expect(importer.indexOf('await saveJobQuietly()')).toBeLessThan(importer.indexOf('await acknowledgeFirmwareRecoveryCheckpoint()'));
    expect(importer).toMatch(/if \(!firmwareCheckpointMatchesCurrentJob\(checkpoint\)\) return/);
  });

  it('marks pending evidence in the persistent machine bar without blocking setup controls', () => {
    expect(machineBar).toContain("? 'RECOVERY'");
    expect(machineBar).toContain('Interrupted-job evidence requires review before new motion');
    expect(machineBar).toMatch(/function canSetup\(\)[\s\S]*SETUP_STATES\.has\(state\)/);
  });
});
