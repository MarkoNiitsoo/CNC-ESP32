import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGCodeToToolpath } from '../../www/lib/toolpath-model.js';
import {
  adaptToolpathForPreview,
  buildPreviewSummaryData,
  mergePreviewIntoJob,
} from '../../www/lib/preview-data-adapter.js';

const fixture = (name) => readFileSync(join('test', 'fixtures', name), 'utf8');

describe('preview data adapter', () => {
  it('preserves command numbers used by live motion telemetry', () => {
    const model = parseGCodeToToolpath('G21\nG90\nG0 X10 Y20\nG1 Z-1 F600\nG1 X30 Y40\n');
    const preview = adaptToolpathForPreview(model);
    expect(preview.segments.map((segment) => segment.commandNumber)).toEqual([3, 4, 5]);
    expect(preview.segments[2]).toMatchObject({ feed: 600, length: Math.sqrt(800) });
  });
  it('converts ToolpathModel into legacy preview data with all bound types', () => {
    const model = parseGCodeToToolpath(fixture('simple-square.gc'));
    const adapted = adaptToolpathForPreview(model);

    expect(adapted.bounds).toEqual(model.bounds.rawTravelBounds);
    expect(adapted.toolpathBounds.rawTravelBounds.xMax).toBe(10);
    expect(adapted.toolpathBounds.cutBounds.xMax).toBe(10);
    expect(adapted.toolpathBounds.placementBounds).toEqual(adapted.toolpathBounds.cutBounds);
    expect(adapted.segments[0]).toHaveProperty('rapid');
    expect(adapted.analysis.feeds.feedCommandCount).toBe(2);
  });

  it('preserves negative offsets and adds origin-fix info', () => {
    const model = parseGCodeToToolpath(fixture('negative-x-offset.gc'));
    const summary = buildPreviewSummaryData(model);

    expect(summary.rawTravelBounds.xMin).toBe(-2);
    expect(summary.cutBounds.xMin).toBe(-2);
    expect(summary.infos.join('\n')).toContain('Future action: Fix Origin / normalize to bounds');
  });

  it('shows parking move difference without distorting cut bounds', () => {
    const model = parseGCodeToToolpath(fixture('parking-move-away-from-cut.gc'));
    const summary = buildPreviewSummaryData(model);

    expect(summary.rawTravelBounds.xMax).toBe(1000);
    expect(summary.cutBounds.xMax).toBe(10);
    expect(summary.placementBounds).toEqual(summary.cutBounds);
    expect(summary.infos.join('\n')).toContain('travel/parking moves outside the cutting area');
  });

  it('groups workspace and transform-sensitive warnings', () => {
    const model = parseGCodeToToolpath([
      'G21',
      'G90',
      'G54',
      'G55',
      'G91',
      'G53 X0',
      'G92 X0',
    ].join('\n'));
    const adapted = adaptToolpathForPreview(model);

    expect(adapted.warningGroups.workspace.join('\n')).toContain('G54 default workspace');
    expect(adapted.warningGroups.unsupported.join('\n')).toContain('G91');
    expect(adapted.warningGroups.transformSensitive.join('\n')).toContain('G92 inside source');
  });

  it('applies feed override to effective estimate summary', () => {
    const model = parseGCodeToToolpath(fixture('simple-square.gc'));
    const summary = buildPreviewSummaryData(model, { startPercent: 50 });

    expect(summary.effectiveEstimateSeconds).toBeCloseTo(summary.estimate.nominalSeconds * 2);
  });

  it('merges preview metadata without erasing job safety state', () => {
    const model = parseGCodeToToolpath(fixture('simple-square.gc'));
    const original = {
      workZero: { beforeG92: { rawM114: 'before' } },
      toolZero: { afterG92Z: { rawM114: 'after' } },
      dryRun: { lastBoundingBoxTraceStatus: 'complete' },
      arm: { state: 'ARMED' },
      feedOverride: { startPercent: 75 },
    };
    const merged = mergePreviewIntoJob(original, model, '/jobs/thumbs/simple.gc.png');

    expect(merged.workZero).toBe(original.workZero);
    expect(merged.toolZero).toBe(original.toolZero);
    expect(merged.dryRun).toBe(original.dryRun);
    expect(merged.arm).toBe(original.arm);
    expect(merged.feedOverride).toBe(original.feedOverride);
    expect(merged.preview.bounds.rawTravelBounds.xMax).toBe(10);
    expect(merged.thumbnailPath).toBe('/jobs/thumbs/simple.gc.png');
  });

  it('preview adapter does not produce streamable movement files', () => {
    const source = fixture('source-g92-warning.gc');
    const model = parseGCodeToToolpath(source);
    const summary = buildPreviewSummaryData(model);

    expect(model.source.originalText).toBe(source);
    expect(summary.metadata.generatedRunPath).toBeUndefined();
    expect(JSON.stringify(summary.metadata)).not.toContain('G1 X10');
  });
});
