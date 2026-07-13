import { describe, expect, it } from 'vitest';
import { collapseRepeatedStepdownPasses } from '../../www/lib/aircut-toolpath.js';
import { parseGCodeToToolpath } from '../../www/lib/toolpath-model.js';

function collapse(gcode) {
  return collapseRepeatedStepdownPasses(parseGCodeToToolpath(gcode).segments);
}

const squareAtDepth = (z, size = 10, reverse = false) => reverse ? [
  `G1 Z${z}`,
  `G1 X0 Y${size}`,
  `G1 X${size} Y${size}`,
  `G1 X${size} Y0`,
  'G1 X0 Y0',
] : [
  `G1 Z${z}`,
  `G1 X${size} Y0`,
  `G1 X${size} Y${size}`,
  `G1 X0 Y${size}`,
  'G1 X0 Y0',
];

describe('Aircut stepdown collapsing', () => {
  it('keeps one XY pass when the same contour repeats at several Z depths', () => {
    const result = collapse([
      'G21', 'G90', 'G0 Z5', 'G0 X0 Y0',
      ...squareAtDepth(-1), 'G0 Z5',
      ...squareAtDepth(-2), 'G0 Z5',
      ...squareAtDepth(-3), 'G0 Z5', 'G0 X50 Y50',
    ].join('\n'));

    expect(result.skippedPasses).toBe(2);
    expect(result.skippedSegments).toBe(8);
    expect(result.segments.filter((segment) => segment.engaged)).toHaveLength(4);
    expect(result.segments.at(-1).to).toMatchObject({ x: 50, y: 50 });
  });

  it('does not remove an intentional repeat at the same Z depth', () => {
    const result = collapse([
      'G21', 'G90', 'G0 Z5',
      ...squareAtDepth(-2), 'G0 Z5',
      ...squareAtDepth(-2), 'G0 Z5',
    ].join('\n'));

    expect(result.skippedPasses).toBe(0);
    expect(result.segments.filter((segment) => segment.engaged)).toHaveLength(8);
  });

  it('recognizes the same contour when another depth traverses it in reverse', () => {
    const result = collapse([
      'G21', 'G90', 'G0 Z5',
      ...squareAtDepth(-1), 'G0 Z5',
      ...squareAtDepth(-2, 10, true), 'G0 Z5',
    ].join('\n'));

    expect(result.skippedPasses).toBe(1);
    expect(result.segments.filter((segment) => segment.engaged)).toHaveLength(4);
  });

  it('keeps geometrically different contours even when their Z depths differ', () => {
    const result = collapse([
      'G21', 'G90', 'G0 Z5',
      ...squareAtDepth(-1, 10), 'G0 Z5',
      ...squareAtDepth(-2, 20), 'G0 Z5',
    ].join('\n'));

    expect(result.skippedPasses).toBe(0);
    expect(result.segments.filter((segment) => segment.engaged)).toHaveLength(8);
  });

  it('collapses the same arc pass repeated at another depth', () => {
    const result = collapse([
      'G21', 'G90', 'G17', 'G0 Z5', 'G0 X10 Y0',
      'G1 Z-1', 'G2 X10 Y0 I-10 J0 F500', 'G0 Z5',
      'G1 Z-2', 'G2 X10 Y0 I-10 J0 F500', 'G0 Z5',
    ].join('\n'));

    expect(result.skippedPasses).toBe(1);
    expect(result.segments.filter((segment) => segment.type === 'arc')).toHaveLength(1);
  });
});
