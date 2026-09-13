import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { MockSD } from '../../dev/mock-sd.mjs';

const roots = [];
async function makeSd() {
  const root = await mkdtemp(path.join(tmpdir(), 'cnc-mock-sd-'));
  roots.push(root);
  const sd = new MockSD(root);
  await sd.ensure();
  return sd;
}
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('MockSD', () => {
  it('maps ESP paths and rejects traversal', async () => {
    const sd = await makeSd();
    expect(sd.resolve('/gcode/test.gc').localPath).toContain(path.join('gcode', 'test.gc'));
    expect(() => sd.resolve('/gcode/../secret')).toThrow(/unsafe/);
    expect(() => sd.resolve('/etc/passwd')).toThrow(/outside/);
  });

  it('writes, reads, lists, renames, and deletes files', async () => {
    const sd = await makeSd();
    await sd.writeText('/gcode/test.gc', 'G21\n');
    expect(await sd.readText('/gcode/test.gc')).toBe('G21\n');
    expect((await sd.list('/gcode')).items[0]).toMatchObject({ name: 'test.gc', type: 'file' });
    await sd.rename('/gcode/test.gc', '/gcode/renamed.gc');
    expect(await sd.exists('/gcode/renamed.gc')).toBe(true);
    await sd.delete('/gcode/renamed.gc');
    expect(await sd.exists('/gcode/renamed.gc')).toBe(false);
  });

  it('supports generated run files under jobs/generated', async () => {
    const sd = await makeSd();
    await sd.writeText('/jobs/generated/part.run.gc', 'G21\nG90\n');
    expect(await sd.readText('/jobs/generated/part.run.gc')).toContain('G90');
    expect((await sd.list('/firmware')).path).toBe('/firmware');
  });
});

// Single-source rule (state-ownership audit, Step 0): the mock dev server serves all
// UI from the repo's www/ directory. The mock SD's /www emulates the card's data
// directory and must never contain UI code, or tests can pass against a stale copy.
describe('mock SD UI single-source rule', () => {
  it('keeps dev/mock-sd/www free of UI code (UI is served from www/ only)', async () => {
    const mockWww = fileURLToPath(new URL('../../dev/mock-sd/www', import.meta.url));
    let entries = [];
    try {
      entries = await readdir(mockWww, { recursive: true });
    } catch (error) {
      if (error.code === 'ENOENT') return; // directory not created yet: nothing to guard
      throw error;
    }
    const uiFiles = entries.filter((name) => /\.(html|js|mjs|css)$/i.test(name));
    expect(uiFiles, [
      'dev/mock-sd/www contains UI code copies:',
      ...uiFiles.map((name) => `  ${name}`),
      'UI must come from the repo www/ directory only.',
      'Delete these files (or run: npm run dev:mock:reset).',
    ].join('\n')).toEqual([]);
  });
});
