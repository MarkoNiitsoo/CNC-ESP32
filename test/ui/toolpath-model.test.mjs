import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPreviewMetadata,
  estimateToolpathTime,
  getToolpathWarnings,
  mergePreviewMetadata,
  parseGCodeToToolpath,
  renderToolpathThumbnailSvg,
  stripGCodeComments,
} from '../../www/lib/toolpath-model.js';

const fixture = (name) => readFileSync(join('test', 'fixtures', name), 'utf8');

describe('ToolpathModel parser basics', () => {
  it('parses G21/G90/G17/G54, G0/G1/F, line numbers, and comments', () => {
    const model = parseGCodeToToolpath(fixture('freecad-g54.gc'));

    expect(stripGCodeComments('G1 X1 (hidden) Y2 ; trailing')).toBe('G1 X1  Y2');
    expect(model.modal).toMatchObject({
      units: 'G21',
      positioning: 'G90',
      plane: 'G17',
      workspace: 'G54',
    });
    expect(model.segments.length).toBeGreaterThan(5);
    expect(model.segments.find((segment) => segment.type === 'cut')).toMatchObject({
      feed: 900,
      engaged: true,
    });
    expect(model.segments.every((segment) => Number.isInteger(segment.lineNumber))).toBe(true);
    expect(model.feed).toMatchObject({
      min: 300,
      max: 900,
      commandCount: 2,
      lastFeed: 900,
    });
  });

  it('converts G20 inch coordinates to millimeters and warns', () => {
    const model = parseGCodeToToolpath('G20\nG90\nG0 X1 Y2\n');

    expect(model.units).toBe('inch');
    expect(model.bounds.rawTravelBounds.xMax).toBeCloseTo(25.4);
    expect(model.bounds.rawTravelBounds.yMax).toBeCloseTo(50.8);
    expect(getToolpathWarnings(model).join('\n')).toContain('G20 inch mode found');
  });
});

describe('ToolpathModel bounds', () => {
  it('keeps raw travel bounds and cut bounds for a simple square', () => {
    const model = parseGCodeToToolpath(fixture('simple-square.gc'));

    expect(model.bounds.rawTravelBounds).toMatchObject({ xMin: 0, xMax: 10, yMin: 0, yMax: 10, zMin: -2, zMax: 5 });
    expect(model.bounds.cutBounds).toMatchObject({ xMin: 0, xMax: 10, yMin: 0, yMax: 10, zMin: -2, zMax: -2 });
    expect(model.bounds.placementBounds).toEqual(model.bounds.cutBounds);
  });

  it('reports negative X offsets in bounds', () => {
    const model = parseGCodeToToolpath(fixture('negative-x-offset.gc'));

    expect(model.bounds.rawTravelBounds.xMin).toBe(-2);
    expect(model.bounds.cutBounds.xMin).toBe(-2);
  });

  it('does not let a far parking move distort cut/placement bounds', () => {
    const model = parseGCodeToToolpath(fixture('parking-move-away-from-cut.gc'));

    expect(model.bounds.rawTravelBounds.xMax).toBe(1000);
    expect(model.bounds.rawTravelBounds.yMax).toBe(1000);
    expect(model.bounds.cutBounds.xMax).toBe(10);
    expect(model.bounds.cutBounds.yMax).toBe(10);
    expect(model.bounds.placementBounds).toEqual(model.bounds.cutBounds);
  });
});

describe('ToolpathModel warnings and unsupported commands', () => {
  it('treats G54 as default info, and G55+/G91/G92/G53 as transform-sensitive warnings', () => {
    const g54 = parseGCodeToToolpath(fixture('freecad-g54.gc'));
    expect(g54.unsupportedCommands.map((item) => item.command)).not.toContain('G54');
    expect(getToolpathWarnings(g54).join('\n')).toContain('G54 default workspace command found');

    const risky = parseGCodeToToolpath([
      'G21',
      'G90',
      'G53 X0',
      'G55',
      'G91',
      'G92 X0',
      'G41',
      'G81',
    ].join('\n'));
    expect(risky.unsupportedCommands.map((item) => item.command)).toEqual(
      expect.arrayContaining(['G53', 'G55', 'G91', 'G92', 'G41', 'G81']),
    );
  });

  it('interpolates G2/G3 arcs with their true XY extent', () => {
    const model = parseGCodeToToolpath(fixture('arc-g2-g3.gc'));

    expect(model.segments.filter((segment) => segment.type === 'arc')).toHaveLength(2);
    expect(model.segments.filter((segment) => segment.type === 'arc').every((segment) => segment.points.length > 2)).toBe(true);
    expect(model.bounds.rawTravelBounds.yMax).toBeCloseTo(5, 2);
    expect(getToolpathWarnings(model).join('\n')).not.toContain('arc approximated');
  });

  it('resolves R-form arcs instead of drawing a straight chord', () => {
    const model = parseGCodeToToolpath('G21\nG90\nG17\nG0 X0 Y0\nG2 X10 Y0 R5 F600\n');
    const arc = model.segments.find((segment) => segment.type === 'arc');

    expect(arc.arc.radius).toBeCloseTo(5);
    expect(arc.points.length).toBeGreaterThan(2);
    expect(model.bounds.rawTravelBounds.yMax).toBeCloseTo(5, 2);
  });
});

describe('ToolpathModel feed stats and time estimates', () => {
  it('tracks feed min/max/count and movement distances', () => {
    const model = parseGCodeToToolpath(fixture('simple-feed-values.gc'));

    expect(model.feed.min).toBe(120);
    expect(model.feed.max).toBe(1200);
    expect(model.feed.commandCount).toBe(3);
    expect(model.feed.cuttingDistance).toBeGreaterThan(0);
    expect(model.feed.rapidDistance).toBe(0);
  });

  it('returns deterministic approximate time and applies feed override', () => {
    const model = parseGCodeToToolpath(fixture('simple-square.gc'), { feedOverridePercent: 50 });
    const estimate = estimateToolpathTime(model, { feedOverridePercent: 50 });

    expect(estimate.nominalSeconds).toBeGreaterThan(0);
    expect(estimate.effectiveSecondsWithOverride).toBeCloseTo(estimate.nominalSeconds * 2);
    expect(estimate.notes.join('\n')).toContain('Estimate is approximate');
    expect(estimate.notes.join('\n')).toContain('router RPM');
  });
});

describe('ToolpathModel thumbnails and metadata', () => {
  it('generates SVG thumbnail data without modifying original G-code text', () => {
    const source = fixture('simple-square.gc');
    const model = parseGCodeToToolpath(source);
    const svg = renderToolpathThumbnailSvg(model, { width: 120, height: 80 });

    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');
    expect(model.source.originalText).toBe(source);
  });

  it('handles empty input with a valid no-preview SVG', () => {
    const model = parseGCodeToToolpath('');
    const svg = renderToolpathThumbnailSvg(model);

    expect(svg).toContain('<svg');
    expect(svg).toContain('No preview');
  });

  it('merges preview metadata without erasing workZero/toolZero/arm data', () => {
    const model = parseGCodeToToolpath(fixture('simple-square.gc'));
    const metadata = buildPreviewMetadata(model);
    const originalJob = {
      workZero: { beforeG92: { rawM114: 'before' } },
      toolZero: { afterG92Z: { rawM114: 'after' } },
      arm: { state: 'ARMED' },
      preview: { oldField: true },
    };
    const merged = mergePreviewMetadata(originalJob, metadata, '/jobs/thumbs/simple-square.svg');

    expect(merged.workZero).toBe(originalJob.workZero);
    expect(merged.toolZero).toBe(originalJob.toolZero);
    expect(merged.arm).toBe(originalJob.arm);
    expect(merged.preview.oldField).toBe(true);
    expect(merged.preview.bounds.cutBounds.xMax).toBe(10);
    expect(merged.thumbnailPath).toBe('/jobs/thumbs/simple-square.svg');
  });

  it('does not create machine movement commands or generated run files', () => {
    const model = parseGCodeToToolpath(fixture('simple-square.gc'));
    const metadata = buildPreviewMetadata(model);

    expect(metadata.generatedRunPath).toBeUndefined();
    expect(JSON.stringify(metadata)).not.toContain('G0 ');
    expect(JSON.stringify(metadata)).not.toContain('G1 ');
  });
});
