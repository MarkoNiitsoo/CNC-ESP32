import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const agents = await readFile(new URL('../../AGENTS.md', import.meta.url), 'utf8');
const firmware = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');
const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const previewHtml = await readFile(new URL('../../www/preview.html', import.meta.url), 'utf8');

describe('G-code memory ownership rules', () => {
  it('records streaming execution and separate preview-limit rules', () => {
    expect(agents).toContain('Job execution must be streaming-based');
    expect(agents).toContain('must not require loading the full G-code file into RAM');
    expect(agents).toContain('Preview/transform may have separate file-size limits');
  });

  it('streams normal jobs from SD with one bounded line buffer', () => {
    expect(firmware).toContain('constexpr size_t kMaxGcodeLineLength = 180');
    expect(firmware).toMatch(/bool openJobFileAtOffset\(\)[\s\S]*SD_MMC\.open\(jobStatus\.gcodePath, FILE_READ\)/);
    expect(firmware).toMatch(/bool readNextCleanJobLine\(String &cleanedLine\)[\s\S]*jobFile\.read\(\)/);
    expect(firmware).toMatch(/raw\.length\(\) > kMaxGcodeLineLength[\s\S]*setJobError\("G-code line is too long"\)/);
    expect(firmware).toMatch(/processJobRunner\(\)[\s\S]*readNextCleanJobLine\(line\)[\s\S]*Serial\.print\(line\)/);
  });

  it('keeps preview warnings browser-only and non-blocking for execution', () => {
    expect(previewHtml).toContain('id="preview-file-warning"');
    expect(preview).toContain('PREVIEW_SOFT_WARNING_BYTES = 4 * 1024 * 1024');
    expect(preview).toContain('TRANSFORM_SOFT_WARNING_BYTES = 2 * 1024 * 1024');
    expect(preview).toContain('Firmware job execution remains SD-streamed and is not limited by preview size.');
    expect(preview).toMatch(/sourceGcodeSizeBytes = Number\(res\.headers\.get\('content-length'\)\)[\s\S]*renderPreviewFileWarning\(\)[\s\S]*sourceGcodeText = await res\.text\(\)/);
  });
});
