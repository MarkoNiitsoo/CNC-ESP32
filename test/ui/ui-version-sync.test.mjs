import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const HTML_FILES = [
  '../../www/index.html',
  '../../www/files.html',
  '../../www/preview.html',
];

describe('UI version badge and cache-buster sync', () => {
  it('keeps #ui-version-badge and ?v= asset query strings synchronized across all HTML entrypoints', async () => {
    const badges = [];
    for (const relPath of HTML_FILES) {
      const html = await readFile(new URL(relPath, import.meta.url), 'utf8');
      const badgeMatch = html.match(/<span id="ui-version-badge">UI\s+(\d{4}\.\d{2}\.\d{2}-\d+)<\/span>/);
      expect(badgeMatch, `${relPath} should declare #ui-version-badge`).not.toBeNull();
      const displayVersion = badgeMatch[1];
      const expectedQuery = displayVersion.replace(/\./g, '');
      badges.push(displayVersion);

      const assetRefs = [...html.matchAll(/(?:href|src)="(\/[^"]+\.(?:css|js)(?:\?[^"]*)?)"/g)].map((m) => m[1]);
      expect(assetRefs.length, `${relPath} should reference local CSS/JS assets`).toBeGreaterThan(0);
      for (const ref of assetRefs) {
        expect(ref, `${relPath} asset ${ref} must carry ?v=${expectedQuery}`).toMatch(
          new RegExp(`\\?v=${expectedQuery}$`),
        );
      }
    }

    expect(new Set(badges).size).toBe(1);
  });
});
