import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  buildMachineReference,
  loadMotionSettings,
  machinePositionFromCounts,
  parseMarlinMaxFeedrates,
  parseMarlinStepsPerMm,
  saveMotionSettings,
  travelFeedMmMin,
  travelSpeedUpperLimit,
} from '../../www/lib/motion-settings.js';

const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../../www/app.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../../www/index.html', import.meta.url), 'utf8');
const firmware = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');

function memoryStorage() {
  let value = null;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
  };
}

describe('shared automatic travel speed', () => {
  it('defaults to 50 mm/s and stores feed in mm/min', () => {
    const storage = memoryStorage();
    expect(loadMotionSettings(storage).travelSpeedMmS).toBe(50);
    const saved = saveMotionSettings({ travelSpeedMmS: 75 }, storage);
    expect(saved.travelSpeedMmS).toBe(75);
    expect(travelFeedMmMin(saved)).toBe(4500);
  });

  it('parses M203 and narrows the UI range to the slower XY axis', () => {
    const limits = parseMarlinMaxFeedrates('echo:Steps\n  M203 X120.00 Y80.00 Z5.00 E25.00\nok\n');
    expect(limits).toEqual({ x: 120, y: 80, z: 5 });
    expect(travelSpeedUpperLimit({ marlinMaxFeedrates: limits })).toBe(80);
    const storage = memoryStorage();
    const saved = saveMotionSettings({ travelSpeedMmS: 100, marlinMaxFeedrates: limits }, storage);
    expect(saved.travelSpeedMmS).toBe(80);
  });

  it('derives a restorable machine position from M114 counts and M92', () => {
    const response = 'echo:Steps per unit:\n M92 X100.00 Y100.00 Z400.00 E100\nok\n';
    expect(parseMarlinStepsPerMm(response)).toEqual({ x: 100, y: 100, z: 400 });
    expect(machinePositionFromCounts({ x: 10000, y: 50000, z: 28000 }, { x: 100, y: 100, z: 400 }))
      .toEqual({ x: 100, y: 500, z: 70 });
    expect(buildMachineReference({ counts: { x: 10000, y: 50000, z: 28000 } }, response))
      .toMatchObject({ source: 'M114 counts + M503 M92', position: { x: 100, y: 500, z: 70 } });
  });

  it('keeps a conservative 100 mm/s ceiling and tolerates missing M203', () => {
    expect(parseMarlinMaxFeedrates('ok')).toBeNull();
    expect(travelSpeedUpperLimit({ marlinMaxFeedrates: { x: 300, y: 200, z: 10 } })).toBe(100);
  });

  it('exposes Settings controls and M503 parsing without changing cutting feeds', () => {
    expect(index).toContain('id="travel-speed"');
    expect(index).toContain('id="read-marlin-limits"');
    expect(app).toContain("JSON.stringify({ cmd: 'M503' })");
    expect(preview).toContain('`G0 Z${fmtMm(safeZ)} F${SAFETY_Z_FEED_MM_MIN}`');
    expect(preview).toContain('`G0 X${fmtMm(bounds.xMin)} Y${fmtMm(bounds.yMin)} F${automaticTravelFeed()}`');
    expect(preview).toMatch(/const rapid = segment\.rapid[\s\S]*const feedValue = segment\.feedrate \?\? segment\.feed[\s\S]*automaticTravelFeed\(\)/);
    expect(preview).toContain("segment.arc.sweepRadians < 0 ? 'G2' : 'G3'");
  });

  it('sets XY travel feed after the slow job-start Z lift', () => {
    const preamble = firmware.slice(firmware.indexOf('bool runJobStartPreamble() {'), firmware.indexOf('void handleJobStatus()'));
    expect(preamble.indexOf('kJobStartZFeed')).toBeLessThan(preamble.indexOf('jobStatus.travelFeedMmMin'));
    expect(preamble).toContain('sendMarlinSafetyCommand("M400")');
    expect(preamble).toContain('"G0 F" + String(jobStatus.travelFeedMmMin');
    expect(firmware).toContain('firmwareVersion = "0.5.5-machine-profile"');
  });
});
