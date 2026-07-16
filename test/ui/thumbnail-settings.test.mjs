import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  THUMBNAIL_VIEW_STORAGE_KEY,
  loadThumbnailViewMode,
  normalizeThumbnailViewMode,
  saveThumbnailViewMode,
} from '../../www/lib/thumbnail-settings.js';

const indexHtml = await readFile(new URL('../../www/index.html', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../../www/app.js', import.meta.url), 'utf8');
const filesSource = await readFile(new URL('../../www/files.js', import.meta.url), 'utf8');
const previewSource = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

describe('thumbnail view settings', () => {
  it('defaults invalid and missing values to 2D and persists a valid 3D choice', () => {
    const storage = memoryStorage();
    expect(loadThumbnailViewMode(storage)).toBe('2d');
    expect(normalizeThumbnailViewMode('side')).toBe('2d');
    expect(saveThumbnailViewMode('3d', storage)).toBe('3d');
    expect(storage.getItem(THUMBNAIL_VIEW_STORAGE_KEY)).toBe('3d');
    expect(loadThumbnailViewMode(storage)).toBe('3d');
  });

  it('exposes the 2D/3D choice in Settings and uses it in every thumbnail generator', () => {
    expect(indexHtml).toContain('id="thumbnail-view-mode"');
    expect(indexHtml).toContain('<option value="2d">2D top view</option>');
    expect(indexHtml).toContain('<option value="3d">3D orthographic view</option>');
    expect(appSource).toContain('saveThumbnailViewMode(thumbnailViewMode.value)');
    for (const source of [appSource, filesSource, previewSource]) {
      expect(source).toContain('viewMode:');
      expect(source).toContain('loadThumbnailViewMode()');
    }
  });
});
