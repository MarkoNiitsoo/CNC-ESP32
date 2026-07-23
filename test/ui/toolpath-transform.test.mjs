import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGCodeToToolpath } from '../../www/lib/toolpath-model.js';
import {
  defaultPlacement,
  generateRunGcode,
  generatedRunPathFor,
  mergePlacementIntoJob,
  normalizePlacement,
  resolveAutoPlacement,
  transformFingerprint,
  transformSafety,
  transformToolpath,
} from '../../www/lib/toolpath-transform.js';

const fixture = (name) => readFileSync(join('test', 'fixtures', name), 'utf8');

describe('toolpath transform math', () => {
  it('keeps 0 degree rotation bounds deterministic and does not mutate the source model', () => {
    const model = parseGCodeToToolpath(fixture('simple-square.gc'));
    const original = JSON.stringify(model);
    const result = transformToolpath(model, { rotationDeg: 0 });

    expect(result.selectedTransformedBounds).toMatchObject({ xMin: 0, xMax: 10, yMin: 0, yMax: 10 });
    expect(result.generatedRunBounds.zMin).toBe(-2);
    expect(JSON.stringify(model)).toBe(original);
  });

  it('rotates 90 degrees and normalizes to lower-left origin', () => {
    const model = parseGCodeToToolpath(fixture('rotated-rectangle.gc'));
    const result = transformToolpath(model, { rotationDeg: 90, originAnchor: 'cutBoundsLowerLeft' });

    expect(result.selectedTransformedBounds.xMin).toBeCloseTo(0);
    expect(result.selectedTransformedBounds.yMin).toBeCloseTo(0);
    expect(result.selectedTransformedBounds.xMax).toBeCloseTo(10);
    expect(result.selectedTransformedBounds.yMax).toBeCloseTo(20);
  });

  it('rotates arbitrary 45 degrees with deterministic bounds', () => {
    const model = parseGCodeToToolpath(fixture('rotated-rectangle.gc'));
    const result = transformToolpath(model, { rotationDeg: 45, originAnchor: 'cutBoundsLowerLeft' });

    expect(result.selectedTransformedBounds.xMin).toBeCloseTo(0);
    expect(result.selectedTransformedBounds.yMin).toBeCloseTo(0);
    expect(result.selectedTransformedBounds.xMax).toBeCloseTo(21.2132, 3);
    expect(result.selectedTransformedBounds.yMax).toBeCloseTo(21.2132, 3);
  });

  it('does not treat the transformed parser origin as a commanded negative move', () => {
    const model = parseGCodeToToolpath([
      'G21', 'G90', 'G0 Z5', 'G0 X-253 Y247', 'G1 Z-4', 'G1 X253 Y247', 'G1 X253 Y753',
      'G1 X-253 Y753', 'G1 X-253 Y247',
    ].join('\n'));
    const result = transformToolpath(model, { rotationDeg: 5 });

    expect(result.selectedTransformedBounds.xMin).toBeCloseTo(0);
    expect(result.selectedTransformedBounds.yMin).toBeCloseTo(0);
    expect(result.generatedRunBounds.xMin).toBeGreaterThanOrEqual(0);
    expect(result.generatedRunBounds.yMin).toBeGreaterThanOrEqual(0);
  });

  it('preserves Z and feed values in transformed segments', () => {
    const model = parseGCodeToToolpath(fixture('simple-feed-values.gc'));
    const result = transformToolpath(model, { rotationDeg: 12.5 });
    const sourceFeeds = model.segments.map((segment) => segment.feed);
    const targetFeeds = result.segments.map((segment) => segment.feed);

    expect(targetFeeds).toEqual(sourceFeeds);
    expect(Math.min(...result.segments.flatMap((segment) => [segment.from.z, segment.to.z]))).toBe(
      Math.min(...model.segments.flatMap((segment) => [segment.from.z, segment.to.z])),
    );
  });
});

describe('toolpath origin normalization and bounds mode', () => {
  it('auto-fits an outside cut to work zero when it fits the machine', () => {
    const model = parseGCodeToToolpath(fixture('negative-x-offset.gc'));
    const placement = resolveAutoPlacement(model, { rotationDeg: 0 }, {
      xMin: 0, xMax: 1625, yMin: 0, yMax: 5800,
    });
    const result = transformToolpath(model, placement);

    expect(placement.autoShiftToWorkZero).toBe(true);
    expect(result.selectedTransformedBounds.xMin).toBeCloseTo(0);
    expect(result.selectedTransformedBounds.yMin).toBeCloseTo(0);
  });

  it('uses actual cut bounds by default so parking moves do not choose the work origin', () => {
    const model = parseGCodeToToolpath(fixture('parking-move-away-from-cut.gc'));
    const placement = defaultPlacement(model);
    const result = transformToolpath(model, placement);

    expect(placement.placementBoundsMode).toBe('cutBounds');
    expect(result.selectedTransformedBounds.xMax).toBeLessThan(1000);
    expect(result.generatedRunBounds.xMax).toBe(1000);
  });

  it('keeps an in-bounds unrotated source at its original coordinates', () => {
    const model = parseGCodeToToolpath('G21\nG90\nG0 X100 Y200\nG1 Z-1\nG1 X110 Y210\n');
    const placement = resolveAutoPlacement(model, {}, { xMin: 0, xMax: 1625, yMin: 0, yMax: 5800 });
    const result = transformToolpath(model, placement);

    expect(placement.autoShiftToWorkZero).toBe(false);
    expect(result.selectedTransformedBounds).toMatchObject({ xMin: 100, xMax: 110, yMin: 200, yMax: 210 });
  });

  it('does not auto-fit a cut that is larger than the machine', () => {
    const model = parseGCodeToToolpath('G21\nG90\nG0 X-10 Y0\nG1 Z-1\nG1 X2000 Y10\n');
    const placement = resolveAutoPlacement(model, {}, { xMin: 0, xMax: 1625, yMin: 0, yMax: 5800 });
    const result = transformToolpath(model, placement);

    expect(placement.autoShiftToWorkZero).toBe(false);
    expect(result.selectedTransformedBounds.xMin).toBe(-10);
    expect(result.selectedTransformedBounds.xMax).toBe(2000);
  });
});

describe('generated run file safety', () => {
  it('creates a deterministic transformed run file with safe modal setup', () => {
    const model = parseGCodeToToolpath(fixture('simple-square.gc'));
    const generated = generateRunGcode(model, { rotationDeg: 0 }, {
      sourcePath: '/gcode/simple-square.gc',
      sourceFingerprint: 'fingerprint-a',
      generatedAt: '2026-06-23T12:00:00.000Z',
    });

    expect(generated.ok).toBe(true);
    expect(generated.gcode).toContain('; Generated by CNC-ESP32 browser ToolpathModel');
    expect(generated.gcode).toContain('; Generated transformed run file');
    expect(generated.gcode).toContain('G21\nG90\nG17\nG54');
    expect(generated.gcode).not.toMatch(/\bG28\b|\bG53\b|\bG92\b|\bM3\b|\bM4\b/);
    expect(generated.placement.generatedRunPath).toBe('/jobs/generated/simple-square.run.gc');
  });

  it('rejects transform-sensitive source commands', () => {
    const risky = [
      parseGCodeToToolpath(fixture('relative-g91-unsupported.gc')),
      parseGCodeToToolpath(fixture('source-g92-warning.gc')),
      parseGCodeToToolpath(fixture('g55-unsupported.gc')),
      parseGCodeToToolpath('G21\nG90\nG53 X0\nG0 X1\n'),
    ];

    risky.forEach((model) => {
      const generated = generateRunGcode(model, { rotationDeg: 0 });
      expect(generated.ok).toBe(false);
      expect(generated.error).toContain('Transform blocked');
    });
  });

  it('preserves transformed G2/G3 arcs with I/J geometry', () => {
    const model = parseGCodeToToolpath(fixture('arc-g2-g3.gc'));
    const generated = generateRunGcode(model, { rotationDeg: 0 });

    expect(generated.ok).toBe(true);
    expect(generated.warnings.join('\n')).not.toContain('G2/G3 arcs');
    expect(generated.gcode).toMatch(/G2 X10 Y0 I5 J0/);
    expect(generated.gcode).toMatch(/G3 X0 Y0 I-5 J0/);
  });
});

describe('generated coordinates and metadata merge', () => {
  it('transforms XY commands, preserves Z-only moves and feed values', () => {
    const model = parseGCodeToToolpath(fixture('simple-square.gc'));
    const generated = generateRunGcode(model, { rotationDeg: 90 });

    expect(generated.gcode).toContain('F300');
    expect(generated.gcode).toContain('F600');
    expect(generated.gcode).toContain('Z-2');
    expect(generated.gcode.split('\n').some((line) => /^G1 X/.test(line))).toBe(true);
  });

  it('stores placement metadata without deleting job setup fields', () => {
    const model = parseGCodeToToolpath(fixture('simple-square.gc'));
    const placement = normalizePlacement(model, { rotationDeg: 10 });
    placement.generatedRunPath = generatedRunPathFor('/gcode/simple-square.gc');
    placement.transformFingerprint = transformFingerprint(placement, 'source-a');
    const job = {
      preview: { lineCount: 1 },
      workZero: { method: 'G92 X0 Y0 Z0' },
      toolZero: { method: 'G92 Z0' },
      dryRun: { safeZ: 15 },
      arm: { state: 'ARMED' },
      feedOverride: { startPercent: 80 },
      zeroHistory: [{ id: 'zero-a' }],
      runHistory: [{ id: 'run-a' }],
    };
    const merged = mergePlacementIntoJob(job, placement);

    expect(merged.placement.rotationDeg).toBe(10);
    expect(merged.generatedRunPath).toBe('/jobs/generated/simple-square.run.gc');
    expect(merged.workZero).toBe(job.workZero);
    expect(merged.toolZero).toBe(job.toolZero);
    expect(merged.dryRun).toBe(job.dryRun);
    expect(merged.arm).toBe(job.arm);
    expect(merged.feedOverride).toBe(job.feedOverride);
    expect(merged.zeroHistory).toBe(job.zeroHistory);
    expect(merged.runHistory).toBe(job.runHistory);
  });

  it('changes transform fingerprint when placement changes and reports unsafe warnings', () => {
    const model = parseGCodeToToolpath(fixture('simple-square.gc'));
    const a = transformFingerprint(normalizePlacement(model, { rotationDeg: 0 }), 'source-a');
    const b = transformFingerprint(normalizePlacement(model, { rotationDeg: 1 }), 'source-a');

    expect(a).not.toBe(b);
    expect(transformSafety(parseGCodeToToolpath(fixture('g55-unsupported.gc'))).ok).toBe(false);
  });
});
