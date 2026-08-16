import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const firmware = readFileSync(new URL('../../src/main.cpp', import.meta.url), 'utf8');
const preview = await readFile(new URL('../../www/preview.js', import.meta.url), 'utf8');

function functionBody(marker, endMarker) {
  const start = firmware.indexOf(marker);
  expect(start, `missing ${marker}`).toBeGreaterThan(-1);
  const end = firmware.indexOf(endMarker, start);
  expect(end, `missing ${endMarker}`).toBeGreaterThan(-1);
  return firmware.slice(start, end);
}

describe('HTTP machine-route contract (Phase 3C)', () => {
  it('keeps the work-zero request body optional with an XYZ default', () => {
    const handler = functionBody('void handleSetWorkZero()', 'MachineOperationResult performSetWorkZero(');
    expect(handler).toMatch(
      /server\.hasArg\("plain"\)\s*\?\s*extractJsonString\(server\.arg\("plain"\), "axes"\)\s*:\s*""/);
    expect(handler).not.toContain('missing JSON body');
  });

  it('restores the {ok, axes, before, after, frame} work-zero response envelope', () => {
    const handler = functionBody('void handleSetWorkZero()', 'MachineOperationResult performSetWorkZero(');
    expect(handler).toContain('String json = "{\\"ok\\":true,\\"axes\\":\\"" + axes');
    expect(handler).toContain('jsonEscape(before)');
    expect(handler).toContain('jsonEscape(after)');
    expect(handler).toContain('",\\"frame\\":" + machineFrameJson() + "}"');
    expect(handler).not.toContain('server.send(200, "application/json", machineFrameJson())');
  });

  it('restores the {ok, before, after, frame} Z-zero response envelope', () => {
    const handler = functionBody('void handleSetZZero()', 'MachineOperationResult performSetZZero(');
    expect(handler).toContain('String json = "{\\"ok\\":true,\\"before\\":\\"" + jsonEscape(before)');
    expect(handler).toContain('jsonEscape(after)');
    expect(handler).toContain('",\\"frame\\":" + machineFrameJson() + "}"');
  });

  it('exposes the captured M114 transactions from the shared perform cores', () => {
    const workZero = functionBody(
      'MachineOperationResult performSetWorkZero(', 'void handleSetZZero()');
    expect(workZero).toContain('if (axesOut != nullptr) *axesOut = axes;');
    expect(workZero).toContain('if (beforeOut != nullptr) *beforeOut = before;');
    expect(workZero).toContain('if (afterOut != nullptr) *afterOut = after;');

    const zZero = functionBody(
      'MachineOperationResult performSetZZero(', 'void handleTouchPlateZZero()');
    expect(zZero).toContain('if (beforeOut != nullptr) *beforeOut = before;');
    expect(zZero).toContain('if (afterOut != nullptr) *afterOut = after;');
  });

  it('keeps the machine frame authoritative enough for WS-path zero verification', () => {
    // WS commandResults carry no M114 text; Preview verifies from the
    // socket-confirmed frame's work coordinates and home reference instead.
    expect(firmware).toContain(',\\"work\\":{');
    expect(firmware).toContain('\\"homeReference\\":{');
  });

  it('wires Preview verification through the shared zero-verification module', () => {
    expect(preview).toContain(
      "import { zeroAxesVerified, zeroReferenceCounts } from './lib/zero-verification.js';");
    expect(preview).toContain('zeroAxesVerified({ afterPosition: after.position, frame, axes: selectedAxes })');
    expect(preview).toContain('counts: zeroReferenceCounts({ before, frame })');
  });
});
