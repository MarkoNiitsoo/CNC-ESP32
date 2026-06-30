import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../../www/app.js', import.meta.url), 'utf8');

describe('files-first navigation', () => {
  it('redirects preview to Files when path is absent or cannot be opened', () => {
    expect(preview).toContain("window.location.replace('/#files')");
    expect(preview).toMatch(/if \(!filePath\)[\s\S]*redirectToFiles\(\)/);
    expect(preview).toMatch(/if \(!res\.ok\)[\s\S]*redirectToFiles\(filePath\)/);
    expect(preview).toContain('loadPreview().catch(() => redirectToFiles(filePath))');
  });

  it('does not expose an empty Job section and clears stale file pointers', () => {
    expect(app).toMatch(/requested === 'job' && !currentJob \? 'files'/);
    expect(app).toMatch(/target === 'job' && !currentJob[\s\S]*replaceState\(null, '', '#files'\)/);
    expect(app).toMatch(/async function validateCurrentJobFile[\s\S]*saveCurrentJob\(null\)/);
    expect(app).not.toContain('<h2>No Current Job</h2>');
  });
});
