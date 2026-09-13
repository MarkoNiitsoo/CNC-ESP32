import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const page = await readFile(new URL('../../www/test.html', import.meta.url), 'utf8');

function countMatches(text, regex) {
  return (text.match(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`)) || []).length;
}

// The acceptance console is diagnostic-only: it drives the exact production API,
// never auto-runs motion, never stores authority, and never invents contracts.
describe('S1 test console guards', () => {
  it('presents the full F-1..F-5 suite with per-test verdicts', () => {
    expect(page).toContain('S1 Hardware Acceptance Tests');
    for (const id of ['A1', 'A2', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'C5',
                      'D1', 'D2', 'D3', 'D4', 'E1', 'E2']) {
      expect(page).toContain(`data-verdict="${id}:`);
    }
  });

  it('gates every motion button behind the three-checkbox safety pre-flight', () => {
    expect(page).toContain('id="safety-router"');
    expect(page).toContain('id="safety-tool"');
    expect(page).toContain('id="safety-estop"');
    expect(page).toContain('button.disabled = !safetyChecked()');
    // Every motion button is marked data-motion so the interlock can find it.
    expect(countMatches(page, /data-motion/)).toBeGreaterThanOrEqual(15);
  });

  it('never issues a request outside the production API allowlist', () => {
    const allowed = [
      '/api/health', '/api/machine/frame', '/api/job/status', '/api/jog/status',
      '/api/operator/status', '/api/files', '/api/download', '/api/machine/home',
      '/api/jog/stop', '/api/job/pause', '/api/job/resume', '/api/job/stop',
      '/api/job/authorize-start', '/api/job/start', '/api/recovery/move', '/api/cmd',
    ];
    const paths = [...page.matchAll(/['"](\/api\/[^'"]*)['"]/g)].map((match) => match[1]);
    const unique = [...new Set(paths.map((path) => path.split('?')[0]))];
    for (const path of unique) expect(allowed, path).toContain(path);
  });

  it('polls only read-only GET state in the live refresh loop', () => {
    const refresh = page.slice(page.indexOf('async function refreshState()'),
                               page.indexOf('$(') >= 0 ? page.indexOf("$('btn-refresh')") : undefined);
    expect(refresh).toContain("api('GET', '/api/health'");
    expect(refresh).toContain("api('GET', '/api/machine/frame'");
    expect(refresh).toContain("api('GET', '/api/job/status'");
    expect(refresh).toContain("api('GET', '/api/jog/status'");
    expect(refresh).toContain("api('GET', '/api/operator/status'");
    expect(refresh).not.toContain("api('POST'");
  });

  it('keeps the start grant in page memory only', () => {
    expect(page).toContain('let startGrant = null');
    expect(page).not.toMatch(/(localStorage|sessionStorage)[^\n]*startGrant/i);
    expect(page).not.toMatch(/startGrant[^\n]*(localStorage|sessionStorage)/i);
  });

  it('stores only test documentation in localStorage under the results key', () => {
    expect(page).toContain("RESULTS_KEY = 's1AcceptanceResults'");
    expect(countMatches(page, /localStorage\.setItem\(/)).toBe(1);
    expect(page).toMatch(/never participate in any CNC\s+authorization or safety decision/);
  });

  it('uses the real production contracts, not invented ones', () => {
    expect(page).toContain("'/api/jog/stop'");
    expect(page).toContain('emergency: true');
    expect(page).not.toContain('/api/jog/start'); // no second jog protocol
    expect(page).toContain("'/api/recovery/move'");
    expect(page).toContain("'/api/job/authorize-start'");
    expect(page).toContain("'/api/job/start'");
    expect(page).toContain("'/api/job/stop'");
  });

  it('confirms before deliberate physical actions', () => {
    const confirmCount = countMatches(page, /if \(!confirm\(/);
    expect(confirmCount).toBeGreaterThanOrEqual(10);
    expect(page).toContain('Move X to work coordinate 1 mm at F600?');
    expect(page).toContain('Send EMERGENCY jog stop');
  });

  it('never auto-runs motion on page load', () => {
    // The only code that runs at load is state polling (read-only GETs), interlock
    // setup, and result rendering: no POST-capable helper is invoked at top level.
    expect(page).not.toMatch(/^(?![\s])[^\n]*postMotion\('[^']*'\)[^;]*;?\s*$/m);
    const topLevel = page.slice(page.indexOf("<script>"), page.indexOf('// ── safety interlock'));
    expect(topLevel).not.toContain('postMotion(');
    expect(topLevel).not.toContain('recoveryMove(');
  });

  it('shows the software-stop warning and the operator-claim hint', () => {
    expect(page).toContain('Software Stop is NOT a physical emergency stop.');
    expect(page).toContain('Open the main UI and claim machine control first');
  });
});
