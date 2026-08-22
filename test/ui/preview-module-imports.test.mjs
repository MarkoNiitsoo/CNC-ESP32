import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const previewSource = (await readFile(path.join(repoRoot, 'www', 'preview.js'), 'utf8')).replace(/\r\n/g, '\n');

// Preview boots as a module; a used-but-unimported export name is a latent
// ReferenceError that only fires on the exact UI path that reaches the call
// (loadPreview bounced straight back to /#files for weeks before anyone saw
// 'markSafeZDependentsStale is not defined').
function importedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.\/lib\/[^']+)';/g)) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim().split(' as ').pop().trim();
      if (name) names.add(name);
    }
  }
  return names;
}

describe('preview module imports', () => {
  it('imports every referenced export from the modules it pulls in', async () => {
    const imports = importedNames(previewSource);
    const definedLocally = new Set(
      [...previewSource.matchAll(/(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    );
    const modules = [...new Set(
      [...previewSource.matchAll(/import\s*\{[^}]+\}\s*from\s*'(\.\/lib\/[^']+)';/g)].map((m) => m[1]),
    )];

    expect(modules.length).toBeGreaterThan(0);
    const missing = [];
    for (const modulePath of modules) {
      const moduleSource = (await readFile(path.join(repoRoot, 'www', modulePath.replace('./', '/')), 'utf8')).replace(/\r\n/g, '\n');
      for (const exportMatch of moduleSource.matchAll(/export\s+(?:function|const|class)\s+([A-Za-z_$][\w$]*)/g)) {
        const name = exportMatch[1];
        const usedInPreview = new RegExp(`(?<![\\w.$])${name}\\s*\\(`).test(previewSource);
        if (usedInPreview && !imports.has(name) && !definedLocally.has(name)) {
          missing.push(`${name} (used but not imported from ${modulePath})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps the safe-Z staleness helper imported for the program-Z change path', () => {
    expect(previewSource).toMatch(/import\s*\{[^}]*markSafeZDependentsStale[^}]*\}\s*from\s*'\.\/lib\/job-safe-z\.js';/);
    expect(previewSource).toContain("markSafeZDependentsStale(jobState, { now: nowIso(), reason: 'Active run program Z changed.' });");
  });
});
