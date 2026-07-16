import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = await readFile(new URL('../../src/main.cpp', import.meta.url), 'utf8');

describe('firmware-owned M6 tool change', () => {
  it('intercepts exact M6 and drains motion before stopping the spindle', () => {
    expect(source).toContain('if (gcodeHasM6(line))');
    expect(source).toMatch(/beginToolChange[\s\S]*appendPriorityCommand\("M400"\)[\s\S]*appendPriorityCommand\("M5"\)/);
    expect(source).toContain('tool change ready: ');
    expect(source).toContain('complete the pending tool change before resuming');
    expect(source).toContain('jobStatus.toolChangePhase = "TOOL_CHANGE_REQUESTED"');
    expect(source).toContain('jobStatus.toolChangePhase = "WAITING_FOR_TOOL"');
  });

  it('captures a return point, parks with G53, and returns only after explicit confirmation', () => {
    expect(source).toContain('jobStatus.toolChangeReturnPositionCaptured = true');
    expect(source).toContain('G53 G0 Z');
    expect(source).toContain('G53 G0 X');
    expect(source).toContain('confirmed true is required after the tool has been installed');
    expect(source).toContain('routerReady true is required after verifying the router or spindle state');
    expect(source).toContain('jobStatus.toolChangePhase = "RESUMING"');
    expect(source).toContain('set Z zero manually or with the configured touch plate before continuing');
    expect(source).toContain('server.on("/api/job/tool-change/complete", HTTP_POST, handleToolChangeComplete)');
  });

  it('offers guarded manual and touch-plate Z-zero transactions during the M6 stop', () => {
    expect(source).toContain('bool toolChangeZZeroWindowOpen()');
    expect(source).toContain('G38.2 Z-');
    expect(source).toContain('toolChangeSettings.touchPlateThickness');
    expect(source).toContain('jobStatus.toolChangeZZeroCompleted = true');
    expect(source).toContain('jobStatus.toolChangePhase = "READY_TO_CONTINUE"');
    expect(source).toContain('server.on("/api/work-zero/touch-plate", HTTP_POST, handleTouchPlateZZero)');
  });
});
