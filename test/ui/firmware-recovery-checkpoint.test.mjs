import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../../www/preview.html', import.meta.url), 'utf8');
const machineBar = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../../www/preview.css', import.meta.url), 'utf8');

describe('firmware recovery checkpoint UI', () => {
  it('shows pending firmware evidence and provides a deliberate dismiss action', () => {
    expect(html).toContain('id="firmware-recovery-checkpoint"');
    expect(html).toContain('id="firmware-recovery-dismiss"');
    expect(preview).toContain("fetch('/api/recovery/checkpoint')");
    expect(preview).toContain("fetch('/api/recovery/checkpoint/acknowledge'");
    expect(preview).toContain('Clear Old Aircut Record');
    expect(preview).toContain('Discard Interrupted Cut Record');
    expect(preview).toContain("workflowButton('Review Recovery Options'");
    expect(preview).toContain("checkpoint.startMode === 'validated_test_motion'");
    expect(preview).toContain('Home → Zero → Bounds/Aircut → Cut');
  });

  it('imports only a matching job and saves durable history before acknowledgement', () => {
    expect(preview).toMatch(/function firmwareCheckpointMatchesCurrentJob[\s\S]*Boolean\(checkpoint\.jobPath\)[\s\S]*checkpoint\.jobPath === jobPathFor\(filePath\)/);
    const importer = preview.slice(
      preview.indexOf('async function loadFirmwareRecoveryCheckpoint()'),
      preview.indexOf('async function dismissFirmwareRecoveryCheckpoint()'),
    );
    expect(importer).toContain("state: checkpoint.state || (checkpoint.interrupted ? 'STOPPED' : 'ERROR')");
    expect(importer).toContain('lastAcknowledgedByteOffset');
    expect(importer.indexOf('await saveJobQuietly()')).toBeLessThan(importer.indexOf('await acknowledgeFirmwareRecoveryCheckpoint()'));
    expect(importer).toMatch(/if \(!firmwareCheckpointMatchesCurrentJob\(checkpoint\)\) return/);
  });

  it('puts ordered Home and work-zero repairs directly beside recovery blockers', () => {
    expect(preview).toContain('Fix this here');
    expect(preview).toContain('data-recovery-fix="home"');
    expect(preview).toContain('data-recovery-fix="restore"');
    expect(preview).toContain('Recovery record could not be imported:');
    expect(styles).toContain('.recovery-fix-card');
    expect((html.match(/<details\b/g) || []).length).toBe((html.match(/<\/details>/g) || []).length);
  });

  it('marks pending evidence in the persistent machine bar without blocking setup controls', () => {
    expect(machineBar).toContain("? 'RECOVERY'");
    expect(machineBar).toContain('Interrupted-job evidence requires review before new motion');
    expect(machineBar).toMatch(/function canSetup\(\)[\s\S]*SETUP_STATES\.has\(state\)/);
  });

  it('makes pending recovery a visible workflow blocker before normal preparation', () => {
    const blockers = preview.slice(
      preview.indexOf('function workflowHardBlockers()'),
      preview.indexOf('function guidedWorkflowStatus()'),
    );
    expect(blockers).toContain('firmwareRecoveryCheckpoint?.requiresReview === true');
    expect(blockers).toContain('interrupted cutting job requires a recovery decision');
    expect(preview).toContain('readinessHomeAllButton.hidden = recoveryPending');
    expect(styles).toMatch(/#readiness-home-all\[hidden\][\s\S]*display: none/);
  });
});
