import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const files = await readFile(new URL('../../www/files.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../../www/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../../www/files.html', import.meta.url), 'utf8');
const previewHtml = await readFile(new URL('../../www/preview.html', import.meta.url), 'utf8');
const style = await readFile(new URL('../../www/style.css', import.meta.url), 'utf8');

describe('files icon view interactions', () => {
  it('opens previewable files directly and removes duplicate preview actions', () => {
    expect(files).toContain('function openItem(item)');
    expect(files).toContain('window.location.href = `/preview.html?path=${encodeURIComponent(item.path)}`;');
    expect(files).not.toContain("textContent = 'Open Job'");
    expect(files).not.toContain("textContent = 'Full Preview'");
    expect(files).not.toContain("textContent = item.type === 'file' ? 'Select' : 'Open'");
    expect(app).not.toContain('class="select-file"');
    expect(app).not.toContain('>Open Job</button>');
    expect(previewHtml).toContain('<script type="module" src="/preview.js"></script>');
  });

  it('opens maintenance actions on context menu and long press', () => {
    expect(files).toContain('const LONG_PRESS_MS = 450');
    expect(files).toContain("target.addEventListener('contextmenu'");
    expect(files).toContain("target.addEventListener('pointerdown'");
    expect(files).toContain('suppressClick = true;');
    expect(files).toContain('if (event.shiftKey)');
    expect(app).toContain("row.addEventListener('contextmenu'");
    expect(app).toContain('if (event.shiftKey)');
    expect(files).toContain('actions.hidden = item.path !== activeItemPath;');
  });

  it('renders folder contents as larger thumbnail cards', () => {
    expect(html).toContain('Hold or right-click a card for rename, delete, or download.');
    expect(style).toContain('grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));');
    expect(style).toContain('.file-card {');
    expect(style).toContain('aspect-ratio: 1 / 1;');
    expect(style).toContain('min-height: 224px;');
    expect(style).toMatch(/\.file-actions \{[\s\S]*position: absolute;[\s\S]*inset: 0;/);
  });

  it('shows only actionable warning and estimate badges', () => {
    expect(files).not.toContain("badges.push('has job')");
    expect(files).not.toContain("badges.push('preview')");
    expect(app).not.toContain("const badges = [item.name.split('.').pop()");
    expect(files).toContain('G54 default workspace|default-workspace');
  });
});
