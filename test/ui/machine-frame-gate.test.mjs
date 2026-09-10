import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = (await readFile(path.join(repoRoot, 'www', 'preview.js'), 'utf8')).replace(/\r\n/g, '\n');

function extractFunctionSource(name) {
  let start = source.indexOf(`function ${name}(`);
  expect(start, `${name} should exist in preview.js`).toBeGreaterThan(0);
  const paramOpen = source.indexOf('(', start);
  let depth = 0;
  let paramClose = -1;
  for (let i = paramOpen; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) { paramClose = i; break; }
    }
  }
  const bodyOpen = source.indexOf('{', paramClose);
  depth = 0;
  let end = -1;
  for (let i = bodyOpen; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  expect(end, `${name} should be complete`).toBeGreaterThan(0);
  return source.slice(start, end);
}

// Compile the real applyMachineFrameSlice body. currentMachineFrame and
// lastAppliedFrameGateKey are free variables in the page; in the compiled
// function they resolve to globals, so the harness plants them on globalThis.
const compileApplyMachineFrameSlice = ({ renderWorkbenchStatusCalls, renderRunPanelCalls }) => {
  const machineFrameFromSlice = new Function(
    `return (${extractFunctionSource('machineFrameFromSlice')});`,
  )();
  const factory = new Function(
    'machineFrameFromSlice',
    'renderWorkbenchStatus',
    'renderRunPanel',
    `return (${extractFunctionSource('applyMachineFrameSlice')});`,
  );
  return factory(machineFrameFromSlice, () => {
    renderWorkbenchStatusCalls.push('workbench');
  }, () => {
    renderRunPanelCalls.push('run-panel');
  });
};

const trustedHomeSlice = {
  frame: { trusted: true, absoluteFromHome: true, workZeroValid: false, revision: 12 },
  position: { machine: { x: 1, y: 2, z: 3 }, work: { x: 1, y: 2, z: 3 } },
  homedAxes: { x: true, y: true, z: true },
  homingEpoch: 4,
};

const untrustedSlice = {
  frame: { trusted: false, absoluteFromHome: false, workZeroValid: false, revision: 13 },
  position: { machine: { x: 5, y: 6, z: 7 } },
  homedAxes: { x: false, y: false, z: false },
  homingEpoch: 4,
};

describe('workbench frame state follows the live machine slice', () => {
  beforeEach(() => {
    globalThis.currentMachineFrame = null;
    globalThis.lastAppliedFrameGateKey = '';
  });

  afterEach(() => {
    delete globalThis.currentMachineFrame;
    delete globalThis.lastAppliedFrameGateKey;
  });

  it('marks the machine homed when a trusted frame arrives', () => {
    const workbenchCalls = [];
    const runPanelCalls = [];
    const apply = compileApplyMachineFrameSlice({ renderWorkbenchStatusCalls: workbenchCalls, renderRunPanelCalls: runPanelCalls });

    apply(trustedHomeSlice);

    expect(globalThis.currentMachineFrame.trusted).toBe(true);
    expect(globalThis.currentMachineFrame.absoluteFromHome).toBe(true);
    expect(globalThis.currentMachineFrame.machine).toEqual({ x: 1, y: 2, z: 3 });
    expect(globalThis.currentMachineFrame.homingEpoch).toBe(4);
    expect(runPanelCalls).toHaveLength(1);
    expect(workbenchCalls).toHaveLength(1);
  });

  it('reverts the gate when the frame becomes untrusted', () => {
    const workbenchCalls = [];
    const runPanelCalls = [];
    const apply = compileApplyMachineFrameSlice({ renderWorkbenchStatusCalls: workbenchCalls, renderRunPanelCalls: runPanelCalls });

    apply(trustedHomeSlice);
    apply(untrustedSlice);

    expect(globalThis.currentMachineFrame.trusted).toBe(false);
    expect(runPanelCalls).toHaveLength(2);
  });

  it('stays silent on position-only updates so jog streaming does not thrash rendering', () => {
    const workbenchCalls = [];
    const runPanelCalls = [];
    const apply = compileApplyMachineFrameSlice({ renderWorkbenchStatusCalls: workbenchCalls, renderRunPanelCalls: runPanelCalls });

    apply(trustedHomeSlice);
    apply({
      frame: { trusted: true, absoluteFromHome: true, workZeroValid: false, revision: 14 },
      position: { machine: { x: 9, y: 9, z: 9 } },
      homingEpoch: 4,
    });

    // The frame state itself is refreshed with the newest coordinates...
    expect(globalThis.currentMachineFrame.machine).toEqual({ x: 9, y: 9, z: 9 });
    // ...but the trust tuple did not change, so no re-render happened.
    expect(runPanelCalls).toHaveLength(1);
    expect(workbenchCalls).toHaveLength(1);
  });

  it('ignores empty slice payloads', () => {
    const runPanelCalls = [];
    const apply = compileApplyMachineFrameSlice({ renderWorkbenchStatusCalls: [], renderRunPanelCalls: runPanelCalls });

    apply(null);
    apply(undefined);

    expect(globalThis.currentMachineFrame).toBeNull();
    expect(runPanelCalls).toHaveLength(0);
  });

  it('registers the machine slice subscription in the page', () => {
    expect(source).toContain("subscribe('machine', applyMachineFrameSlice)");
  });
});
