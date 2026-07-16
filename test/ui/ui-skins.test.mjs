import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_SKIN_ID,
  iconMarkup,
  loadSkinManifests,
  readSelectedSkin,
  resolveIconRole,
  saveSelectedSkin,
  validateSkinManifest,
} from '../../www/lib/ui-skins.js';

const manifest = (id) => JSON.parse(readFileSync(join('www', 'skins', id, 'skin.json'), 'utf8'));

describe('UI skin manifests and semantic icons', () => {
  it('validates every bundled skin manifest', () => {
    ['default', 'freecad-like', 'high-contrast'].forEach((id) => {
      const skin = manifest(id);
      const sprite = readFileSync(join('www', 'skins', id, 'icons.svg'), 'utf8');
      expect(validateSkinManifest(skin)).toEqual({ ok: true, errors: [] });
      Object.values(skin.icons).forEach((symbolId) => expect(sprite).toContain(`id="${symbolId}"`));
    });
  });

  it('falls back to the default skin for a missing icon role', () => {
    const active = { ...manifest('freecad-like'), icons: { ...manifest('freecad-like').icons } };
    delete active.icons.stop;
    expect(resolveIconRole('stop', active, manifest('default'))).toMatchObject({
      skinId: 'default',
      symbolId: 'icon-stop',
      fallback: true,
    });
  });

  it('returns accessible SVG/use markup without replacing text labels', () => {
    const markup = iconMarkup('start', { label: 'Start cut' }, manifest('freecad-like'), manifest('default'));
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Start cut"');
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(markup).toContain('/skins/freecad-like/icons.svg#icon-start');
  });
});

describe('UI skin loading and persistence', () => {
  it('persists a valid selected skin id', () => {
    const values = new Map();
    const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
    expect(saveSelectedSkin('freecad-like', storage)).toBe('freecad-like');
    expect(readSelectedSkin(storage)).toBe('freecad-like');
  });

  it('falls back to default when selected skin loading fails', async () => {
    const defaultSkin = manifest('default');
    const fetcher = async (url) => url.includes('/default/')
      ? { ok: true, json: async () => defaultSkin }
      : { ok: false, status: 404, json: async () => ({}) };
    const loaded = await loadSkinManifests('missing-skin', { fetcher });

    expect(loaded.selectedId).toBe(DEFAULT_SKIN_ID);
    expect(loaded.activeManifest.id).toBe(DEFAULT_SKIN_ID);
    expect(loaded.warnings.join('\n')).toContain('using Default');
  });

  it('contains no machine movement, homing, or automatic zero commands', () => {
    const source = readFileSync(join('www', 'lib', 'ui-skins.js'), 'utf8');
    expect(source).not.toMatch(/\bG28\b|\bG92\b|\bM3\b|\bM4\b/);
  });

  it('keeps critical controls textual and accessible while using semantic icon roles', () => {
    const preview = readFileSync(join('www', 'preview.html'), 'utf8');
    const machineBar = readFileSync(join('www', 'machine-bar.js'), 'utf8');
    expect(preview).toMatch(/id="start-job"[^>]*aria-label="Hold to Start Cut"[^>]*data-icon="start"[^>]*>Hold to Start Cut/);
    expect(preview).toMatch(/id="stop-job"[^>]*aria-label="Stop Now with M410"[^>]*data-icon="stop"/);
    expect(machineBar).toMatch(/id="mb-pause"[^>]*aria-label="Pause Safely job"[^>]*data-icon="pause"[^>]*><span class="machine-button-label">Pause Safely<\/span>/);
    expect(machineBar).toMatch(/id="mb-m5"[^>]*aria-label="Output Off M5; motion continues"[^>]*data-icon="m5"[^>]*>Output Off \(M5\)/);
  });

  it('uses theme variables for workbench status and canvas layers', () => {
    const previewCss = readFileSync(join('www', 'preview.css'), 'utf8');
    const previewJs = readFileSync(join('www', 'preview.js'), 'utf8');
    expect(previewCss).toContain('var(--cnc-panel-strong)');
    expect(previewCss).toContain('var(--cnc-accent)');
    expect(previewCss).toContain('--workbench-glass-top');
    expect(previewCss).toContain('--workbench-glass-panel');
    expect(previewCss).toContain('--workbench-glass-soft');
    expect(previewJs).toContain("themeColor('--cnc-path-generated'");
    expect(previewJs).toContain("themeColor('--cnc-zero'");
  });
});
