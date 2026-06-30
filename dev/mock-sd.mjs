import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MOCK_ROOTS = ['/gcode', '/jobs', '/logs', '/firmware', '/www'];

const SAMPLE_FILES = {
  '/gcode/safe-square.gc': `; Safe 100 mm square\nG21\nG90\nG17\nG54\nM5\nG0 Z15\nG0 X10 Y10\nG1 Z-2 F300\nG1 X110 Y10 F900\nG1 X110 Y110\nG1 X10 Y110\nG1 X10 Y10\nG0 Z15\nM5\n`,
  '/gcode/safe-rectangle.gc': `G21\nG90\nG17\nG54\nM5\nG0 Z15\nG0 X20 Y20\nG1 Z-3 F250\nG1 X220 Y20 F1000\nG1 X220 Y100\nG1 X20 Y100\nG1 X20 Y20\nG0 Z15\nM5\n`,
  '/gcode/negative-x-offset.gc': `G21\nG90\nG17\nG54\nM5\nG0 Z15\nG0 X-10 Y20\nG1 X80 Y20 F700\nG1 X80 Y80\nG1 X-10 Y80\n`,
  '/gcode/out-of-bounds.gc': `G21\nG90\nG17\nG54\nM5\nG0 Z15\nG1 X1700 Y100 F800\n`,
  '/gcode/dangerous-z-dive.gc': `G21\nG90\nG17\nG54\nM5\nG0 X50 Y50\nG1 Z-45 F200\n`,
};

function normalizeEspPath(value) {
  const input = String(value || '').trim();
  if (!input.startsWith('/') || input.includes('\\') || input.includes('..') || input.includes('//')) {
    throw new Error('unsafe path');
  }
  const normalized = path.posix.normalize(input);
  const root = MOCK_ROOTS.find((item) => normalized === item || normalized.startsWith(`${item}/`));
  if (!root) throw new Error('path is outside mock SD roots');
  return normalized;
}

export class MockSD {
  constructor(rootPath) {
    this.rootPath = path.resolve(rootPath);
  }

  resolve(espPath) {
    const normalized = normalizeEspPath(espPath);
    const relative = normalized.slice(1).split('/');
    const localPath = path.resolve(this.rootPath, ...relative);
    if (localPath !== this.rootPath && !localPath.startsWith(`${this.rootPath}${path.sep}`)) {
      throw new Error('unsafe path');
    }
    return { espPath: normalized, localPath };
  }

  async ensure() {
    for (const root of MOCK_ROOTS) await mkdir(this.resolve(root).localPath, { recursive: true });
    await mkdir(this.resolve('/jobs/generated').localPath, { recursive: true });
    await mkdir(this.resolve('/jobs/thumbs').localPath, { recursive: true });
  }

  async seedSamples() {
    await this.ensure();
    for (const [espPath, contents] of Object.entries(SAMPLE_FILES)) {
      if (!(await this.exists(espPath))) await this.writeText(espPath, contents, { overwrite: false });
    }
  }

  async reset() {
    await rm(this.rootPath, { recursive: true, force: true });
    await this.seedSamples();
  }

  async exists(espPath) {
    try {
      await stat(this.resolve(espPath).localPath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async list(espPath = '/gcode') {
    const { espPath: normalized, localPath } = this.resolve(espPath);
    const entries = await readdir(localPath, { withFileTypes: true });
    const items = await Promise.all(entries.map(async (entry) => {
      const itemPath = `${normalized}/${entry.name}`;
      const info = entry.isDirectory() ? null : await stat(this.resolve(itemPath).localPath);
      return {
        name: entry.name,
        path: itemPath,
        type: entry.isDirectory() ? 'dir' : 'file',
        size: info?.size || 0,
      };
    }));
    items.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1);
    return { path: normalized, items };
  }

  async read(espPath) {
    return readFile(this.resolve(espPath).localPath);
  }

  async readText(espPath) {
    return readFile(this.resolve(espPath).localPath, 'utf8');
  }

  async write(espPath, contents, { overwrite = false } = {}) {
    const { localPath } = this.resolve(espPath);
    await mkdir(path.dirname(localPath), { recursive: true });
    if (!overwrite && await this.exists(espPath)) throw new Error('file exists');
    await writeFile(localPath, contents, { flag: overwrite ? 'w' : 'wx' });
  }

  async writeText(espPath, contents, options) {
    await this.write(espPath, String(contents), options);
  }

  async mkdir(espPath) {
    const { localPath } = this.resolve(espPath);
    if (await this.exists(espPath)) throw new Error('path already exists');
    await mkdir(localPath);
  }

  async delete(espPath) {
    const { espPath: normalized, localPath } = this.resolve(espPath);
    if (MOCK_ROOTS.includes(normalized)) throw new Error('cannot delete mock SD root');
    const info = await stat(localPath);
    await rm(localPath, { recursive: false });
    return { type: info.isDirectory() ? 'dir' : 'file' };
  }

  async rename(from, to) {
    const source = this.resolve(from);
    const target = this.resolve(to);
    if (MOCK_ROOTS.includes(source.espPath) || MOCK_ROOTS.includes(target.espPath)) {
      throw new Error('cannot rename mock SD root');
    }
    if (await this.exists(to)) throw new Error('target exists');
    await mkdir(path.dirname(target.localPath), { recursive: true });
    await rename(source.localPath, target.localPath);
  }
}

export function sampleFiles() {
  return { ...SAMPLE_FILES };
}
