import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const machineBarPath = path.join(repoRoot, 'www', 'machine-bar.js');
const source = (await readFile(machineBarPath, 'utf8')).replace(/\r\n/g, '\n');

// Extract a complete top-level function declaration, tolerating default
// parameter values that contain braces (e.g. options = {}).
function extractFunctionSource(name) {
  const start = source.indexOf(`  function ${name}(`);
  expect(start, `${name} should exist in machine-bar.js`).toBeGreaterThan(0);
  const paramOpen = source.indexOf('(', start);
  let parenDepth = 0;
  let paramClose = -1;
  for (let i = paramOpen; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    else if (source[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) { paramClose = i; break; }
    }
  }
  expect(paramClose, `${name} parameters should be balanced`).toBeGreaterThan(0);
  const bodyOpen = source.indexOf('{', paramClose);
  let depth = 0;
  let end = -1;
  for (let i = bodyOpen; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  expect(end, `${name} should be a complete function`).toBeGreaterThan(0);
  return source.slice(start, end);
}

// Node whose `disabled` setter counts real value changes exactly like a DOM
// element reflected attribute would queue MutationObserver records.
function makeCountingNode(initialDisabled) {
  let disabled = Boolean(initialDisabled);
  return {
    writes: 0,
    get disabled() { return disabled; },
    set disabled(value) {
      // Same-value reflection still mutates the attribute in the browser; the
      // production fix avoids issuing it, so the harness counts every set.
      disabled = Boolean(value);
      this.writes += 1;
    },
  };
}

// Compile an extracted function against its closure dependencies and run it
// once with the supplied closure values. new Function builds a factory whose
// parameters become the extracted function's closure bindings.
// eslint-disable-next-line no-new-func
const runWithClosure = (fnSource, closureNames, closureValues) =>
  new Function(...closureNames, `return (${fnSource});`)(...closureValues)();

describe('ordinary control guard idempotency (MutationObserver feedback loop)', () => {
  it('re-applying the blocked guard never rewrites an already-disabled node', () => {
    const guard = extractFunctionSource('applyOrdinaryControlGuard');
    const closureNames = ['document', 'markOrdinaryMachineControls', 'ordinaryMachineControlBlocked',
      'ordinaryControlSelectors', 'ordinaryLocalDisabled', 'ordinaryGuardForced'];
    const nodes = [makeCountingNode(false), makeCountingNode(false)];
    const forced = new Set();
    const localDisabled = new Map();
    const env = () => [
      { querySelectorAll: () => nodes },
      () => {},
      () => true,
      [],
      localDisabled,
      forced,
    ];

    runWithClosure(guard, closureNames, env());
    for (const node of nodes) {
      expect(node.disabled).toBe(true);
      expect(node.writes).toBe(1);
      expect(forced.has(node)).toBe(true);
    }

    // The observer re-enters the guard on every disabled-attribute record; a
    // value-unchanged rewrite here starved the page in an endless microtask
    // cascade while the socket was not yet synchronized.
    for (let pass = 0; pass < 5; pass += 1) runWithClosure(guard, closureNames, env());
    for (const node of nodes) expect(node.writes).toBe(1);
  });

  it('unblocking restores the remembered local state exactly once', () => {
    const guard = extractFunctionSource('applyOrdinaryControlGuard');
    const closureNames = ['document', 'markOrdinaryMachineControls', 'ordinaryMachineControlBlocked',
      'ordinaryControlSelectors', 'ordinaryLocalDisabled', 'ordinaryGuardForced'];
    const enabledNode = makeCountingNode(false);
    const locallyDisabledNode = makeCountingNode(true);
    const nodes = [enabledNode, locallyDisabledNode];
    const forced = new Set();
    const localDisabled = new Map();
    const env = (blocked) => [
      { querySelectorAll: () => nodes },
      () => {},
      () => blocked,
      [],
      localDisabled,
      forced,
    ];

    runWithClosure(guard, closureNames, env(true));
    expect(enabledNode.writes).toBe(1);
    expect(locallyDisabledNode.writes).toBe(0); // already disabled before the guard

    for (let pass = 0; pass < 3; pass += 1) runWithClosure(guard, closureNames, env(false));
    expect(enabledNode.disabled).toBe(false);
    expect(enabledNode.writes).toBe(2); // disable + single re-enable
    expect(locallyDisabledNode.disabled).toBe(true);
    expect(locallyDisabledNode.writes).toBe(0); // never left its disabled state
    expect(forced.size).toBe(0);
  });

  it('setMachineControlDisabled is value-changing only', () => {
    const setterFactory = new Function('ordinaryLocalDisabled', 'ordinaryMachineControlBlocked', 'ordinaryGuardForced',
      `return (${extractFunctionSource('setMachineControlDisabled')});`);
    const node = makeCountingNode(true);
    Object.defineProperty(node, 'matches', { value: () => true });
    const forced = new Set();
    const localDisabled = new Map();

    setterFactory(localDisabled, () => true, forced)(node, true, {});
    expect(node.disabled).toBe(true);
    expect(node.writes).toBe(0); // blocked and already disabled: no attribute write
    setterFactory(localDisabled, () => true, forced)(node, true, {});
    expect(node.writes).toBe(0);
    setterFactory(localDisabled, () => false, forced)(node, false, {});
    expect(node.disabled).toBe(false);
    expect(node.writes).toBe(1); // exactly one re-enable
    setterFactory(localDisabled, () => false, forced)(node, false, {});
    expect(node.writes).toBe(1);
  });

  it('keeps the guard wired to the observer with only value-changing disabled writes', () => {
    expect(source).toContain('ordinaryGuardObserver = new MutationObserver(() => {');
    const guardBody = extractFunctionSource('applyOrdinaryControlGuard');
    const writeLines = guardBody.split('\n').filter((line) => /node\.disabled\s*=[^=]/.test(line));
    expect(writeLines.length).toBe(2);
    for (const line of writeLines) {
      // Every disabled write in the guard must be behind a same-value check,
      // because even same-value attribute reflection queues an observer record.
      expect(line).toContain('!==');
    }
  });
});
