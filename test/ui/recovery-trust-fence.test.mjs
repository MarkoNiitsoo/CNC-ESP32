import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const jobRecovery = await readFile(new URL('../../www/lib/job-recovery.js', import.meta.url), 'utf8');

describe('position-trust anchors (F-2 audit evidence)', () => {
  it('preview.js owns the trust belief with an operator self-grant path today', () => {
    expect(preview).toContain('function setPositionTrust(');
    expect(preview).toContain('restorePositionTrust');
    expect(preview).toContain("'operator-confirmed-home-all'");
  });

  it('job-recovery.js blocks recovery planning and motion on the browser trust belief', () => {
    expect(jobRecovery).toContain('positionTrusted === true');
    expect(jobRecovery).toContain('Machine position is not trusted');
  });
});

describe('recovery trust invariants (F-2 acceptance fences)', () => {
  it.fails('SAFETY FENCE (F-2, expected failing until fixed): position trust belief must not persist across page reloads', () => {
    expect(preview).not.toMatch(/sessionStorage\.(setItem|getItem)\(positionTrustKey/);
  });

  it.fails('SAFETY FENCE (F-2, expected failing until fixed): position trust must not be operator-self-granted without firmware confirmation', () => {
    expect(preview).not.toContain("'operator-confirmed-home-all'");
  });
});
