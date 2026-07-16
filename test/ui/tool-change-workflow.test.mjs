import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const html = await readFile(new URL('../../www/preview.html', import.meta.url), 'utf8');
const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const machineBar = await readFile(new URL('../../www/machine-bar.js', import.meta.url), 'utf8');
const mockServer = await readFile(new URL('../../dev/mock-server.mjs', import.meta.url), 'utf8');

describe('manual tool-change operator workflow', () => {
  it('shows G-code tool information and keeps generic Resume out of the M6 path', () => {
    expect(html).toContain('id="tool-change-operator"');
    expect(html).toContain('id="tool-change-manual-z"');
    expect(html).toContain('id="tool-change-touch-plate"');
    expect(html).toContain('id="tool-change-complete"');
    expect(preview).toContain('pendingToolChangeInfo()');
    expect(preview).toContain('info?.diameterMm');
    expect(preview).toContain('info?.spindleRpm');
    expect(preview).toMatch(/function applyActiveRunParse[\s\S]*renderWorkbenchStatus\(\);[\s\S]*renderRunPanel\(\);/);
    expect(preview).toContain('resumeJobButton.hidden = !paused || toolChangePending');
    expect(preview).toContain("postCriticalJobAction('/api/job/tool-change/complete', { confirmed: true })");
  });

  it('exposes configured touch-plate Z zero beside normal Z-zero controls too', () => {
    expect(html).toContain('id="touch-plate-z-zero"');
    expect(machineBar).toContain('id="mb-touch-plate-z-zero"');
    expect(preview).toContain("fetch('/api/work-zero/touch-plate'");
    expect(machineBar).toContain("apiPost('/api/work-zero/touch-plate', {})");
    expect(mockServer).toContain("pathname === '/api/work-zero/touch-plate'");
  });

  it('does not offer the generic Machine Bar Resume while M6 is pending', () => {
    expect(machineBar).toContain("STATE.job?.toolChangePending === true");
    expect(machineBar).toContain("const pauseLabel = toolChangePending ? 'Tool Change'");
    expect(machineBar).toContain("setDisabled('mb-pause', !(running || paused || isUnknown()) || toolChangePending)");
  });
});
