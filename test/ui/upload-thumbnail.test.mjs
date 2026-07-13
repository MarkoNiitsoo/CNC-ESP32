import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  THUMBNAIL_SIZE,
  isGcodeFileName,
  jobPathForUpload,
  mergeUploadedFileMetadata,
  thumbnailFileName,
  thumbnailPathFor,
} from '../../www/lib/upload-thumbnail.js';

const filesSource = await readFile(new URL('../../www/files.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../../www/app.js', import.meta.url), 'utf8');
const previewSource = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const toolpathSource = await readFile(new URL('../../www/lib/toolpath-model.js', import.meta.url), 'utf8');

describe('upload-time PNG thumbnails', () => {
  it('uses deterministic compact PNG sidecar names', () => {
    expect(THUMBNAIL_SIZE).toBe(128);
    expect(isGcodeFileName('part.GC')).toBe(true);
    expect(isGcodeFileName('notes.txt')).toBe(false);
    expect(thumbnailFileName('part 1.gc')).toBe('part_1.gc.png');
    expect(thumbnailPathFor('part 1.gc')).toBe('/jobs/thumbs/part_1.gc.png');
  });

  it('scopes job metadata to the complete G-code path', () => {
    const first = jobPathForUpload('/gcode/customer-a/part.gc');
    const second = jobPathForUpload('/gcode/customer-b/part.gc');
    expect(first).not.toBe(second);
    expect(first).toMatch(/^\/jobs\/.*-[0-9a-f]{8}\.job\.json$/);
    expect(previewSource).toContain('loaded.sourceGcodePath === filePath');
    expect(filesSource).toContain('loaded?.sourceGcodePath === item.path');
  });

  it('does not show another file\'s completed run as the newly opened job', () => {
    expect(previewSource).toMatch(/belongsToAnotherFile[\s\S]*previousJobPath/);
  });

  it('preserves existing safety and history metadata while refreshing preview fields', () => {
    const original = {
      schemaVersion: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      workZero: { capturedAt: 'keep' }, arm: { state: 'ARMED' },
      runHistory: [{ id: 'run-1' }], recoveryHistory: [{ id: 'recovery-1' }],
      preview: { oldField: true },
    };
    const merged = mergeUploadedFileMetadata(original, {
      gcodePath: '/gcode/part.gc', jobPath: '/jobs/part.gc.job.json',
      thumbnailPath: '/jobs/thumbs/part.gc.png', preview: { lineCount: 20 },
      updatedAt: '2026-07-07T10:00:00.000Z',
    });
    expect(merged.workZero).toBe(original.workZero);
    expect(merged.arm).toBe(original.arm);
    expect(merged.runHistory).toBe(original.runHistory);
    expect(merged.recoveryHistory).toBe(original.recoveryHistory);
    expect(merged.preview).toMatchObject({ oldField: true, lineCount: 20 });
    expect(merged.thumbnailPath).toBe('/jobs/thumbs/part.gc.png');
  });

  it('generates PNG in both upload surfaces without retaining SVG thumbnail output', () => {
    for (const source of [filesSource, appSource]) {
      expect(source).toContain("'image/png'");
      expect(source).toContain('toBlob');
      expect(source).toContain('thumbnailPath');
    }
    expect(toolpathSource).not.toContain('renderToolpathThumbnailSvg');
    expect(filesSource).not.toContain('image/svg+xml');
    expect(appSource).not.toContain('image/svg+xml');
  });

  it('creates and persists a missing PNG during the first preview open', () => {
    expect(previewSource).toContain("const thumbnailModulePromise = import('/lib/upload-thumbnail.js')");
    expect(previewSource).toMatch(/async function createMissingPreviewThumbnail[\s\S]*sourceToolpathModel \|\| toolpathModel[\s\S]*renderToolpathToCanvas[\s\S]*previewCanvasPngBlob[\s\S]*\/api\/upload\?overwrite=true/);
    expect(previewSource).toMatch(/syncPreviewMetadata[\s\S]*createMissingPreviewThumbnail\(thumbnailPath\)[\s\S]*thumbnailPath \|\| null/);
    expect(previewSource).toContain('await syncPreviewMetadata();');
  });

  it('loads stored thumbnail paths through the SD download API', () => {
    for (const source of [filesSource, appSource]) {
      expect(source).toContain('/api/download?path=${encodeURIComponent(path)}');
      expect(source).toContain('thumbnailUrl(');
      expect(source).not.toMatch(/src="\$\{html\((?:itemMeta|meta)\.thumbnailPath\)\}"/);
    }
  });

  it('falls back to an existing PNG when the new path-scoped Job JSON is not created yet', () => {
    for (const source of [filesSource, appSource]) {
      expect(source).toMatch(/thumbnailPathFor\(item\.name \|\| basename\(item\.path\)\)/);
      expect(source).toMatch(/thumbnailRes\?\.ok \? \{ sourceGcodePath: item\.path, thumbnailPath \} : null/);
    }
  });
});
