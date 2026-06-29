import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGcode, stripComments } from '../../www/lib/gcode-core.mjs';

const fixture = (name) => readFileSync(join('test', 'fixtures', name), 'utf8');

describe('G-code parser safety basics', () => {
  it('strips semicolon and parenthesized comments deterministically', () => {
    expect(stripComments('G1 X10 (inside) Y20 ; after')).toBe('G1 X10  Y20');
  });

  it('parses normal FreeCAD G54 output without treating G54 as unsupported', () => {
    const parsed = parseGcode(fixture('freecad-g54-square.gcode'));

    expect(parsed.analysis.hasG21).toBe(true);
    expect(parsed.analysis.hasG90).toBe(true);
    expect(parsed.analysis.hasG54).toBe(true);
    expect(parsed.analysis.nonDefaultWorkspaceCommands).toEqual([]);
    expect(parsed.warnings).toContain('G54 default workspace command found.');
    expect(parsed.warnings.some((warning) => warning.includes('Unsupported commands'))).toBe(false);
    expect(parsed.bounds).toMatchObject({
      xMin: 0,
      xMax: 100,
      yMin: 0,
      yMax: 100,
      zMin: -3,
      zMax: 5,
    });
    expect(parsed.analysis.feeds).toMatchObject({
      minFeed: 300,
      maxFeed: 1200,
      feedCommandCount: 2,
    });
  });

  it('detects inch mode, relative mode, non-default workspace, and spindle enable', () => {
    const parsed = parseGcode(fixture('unsafe-relative-inch-workspace.gcode'));

    expect(parsed.analysis.hasG20).toBe(true);
    expect(parsed.analysis.hasG91).toBe(true);
    expect(parsed.analysis.hasSpindleOn).toBe(true);
    expect(parsed.analysis.nonDefaultWorkspaceCommands).toEqual(['G55']);
    expect(parsed.bounds.xMax).toBeCloseTo(50.8);
    expect(parsed.bounds.zMin).toBeCloseTo(-50.8);
  });
});
