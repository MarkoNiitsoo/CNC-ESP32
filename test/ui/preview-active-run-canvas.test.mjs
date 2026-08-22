import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = async (rel) => (await readFile(path.join(repoRoot, rel), 'utf8')).replace(/\r\n/g, '\n');
const previewJs = await read('www/preview.js');
const previewHtml = await read('www/preview.html');
const workbenchUiJs = await read('www/lib/workbench-ui.js');

function extractFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `${name} should exist`).toBeGreaterThan(0);
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

// eslint-disable-next-line no-new-func
const compileFn = (source, name) => new Function(`return (${extractFunctionSource(source, name)});`)();
const drawPlan = compileFn(previewJs, 'activeRunDrawPlan');

const layerToggleNames = [...previewHtml.matchAll(/data-canvas-layer="([^"]+)"[^>]*>\s*([^<]*)</g)]
  .map((m) => ({ key: m[1], label: m[2].trim() }));

function drawBlock() {
  const start = previewJs.indexOf('const drawPlan = activeRunDrawPlan({');
  const end = previewJs.indexOf('if (recoveryOverlayVisible', start);
  return previewJs.slice(start, end);
}

describe('Active Run is the single primary preview toolpath', () => {
  it('removes Path and Generated from the Layers UI and the layer model', () => {
    const keys = layerToggleNames.map((l) => l.key);
    expect(keys).not.toContain('path');
    expect(keys).not.toContain('source');
    expect(keys).not.toContain('generated');
    expect(keys).toEqual(['bounds', 'zero', 'travel', 'compareSource', 'table']);
    expect(previewHtml).not.toMatch(/>\s*Path\s*</);
    expect(previewHtml).not.toMatch(/>\s*Generated\s*</);
    expect(workbenchUiJs).toMatch(/DEFAULT_LAYERS = Object\.freeze\(\{\s*bounds: true,\s*zero: true,\s*travel: true,\s*compareSource: false,\s*table: true,\s*\}\)/);
  });

  it('labels the single source-comparison toggle and defaults it OFF', () => {
    const compare = layerToggleNames.find((l) => l.key === 'compareSource');
    expect(compare?.label).toBe('Compare original');
    expect(compare?.key).toBe('compareSource');
    expect(workbenchUiJs).toContain('compareSource: false');
    // Hidden whenever the Active Run is the source (comparison would duplicate it).
    expect(previewHtml).toContain('id="compare-source-layer" hidden');
    expect(previewJs).toContain("compareLayer.hidden = activeMode !== 'generated'");
  });

  it('source Active Run renders the source toolpath as primary', () => {
    const plan = drawPlan({ mode: 'source', validationStatus: 'unknown', compareSource: false, hasSource: true, hasPlacementPreview: false });
    expect(plan.primaryIsGenerated).toBe(false);
  });

  it('generated Active Run renders the generated toolpath as primary', () => {
    const plan = drawPlan({ mode: 'generated', validationStatus: 'valid', compareSource: false, hasSource: true, hasPlacementPreview: true });
    expect(plan.primaryIsGenerated).toBe(true);
  });

  it('the primary Active Run path has no toggle and cannot be hidden', () => {
    const block = drawBlock();
    // Primary draw is unconditional inside draw(): no layers.* guard wraps it.
    const primaryIndex = block.indexOf('drawSegments(parsed.segments');
    expect(primaryIndex).toBeGreaterThan(0);
    const before = block.slice(0, primaryIndex);
    expect(before.slice(before.lastIndexOf('\n', before.length - 1))).not.toMatch(/if\s*\(layers\./);
    // No layer key can disable it because no such keys exist anymore.
    expect(workbenchUiJs).not.toMatch(/layers\s*\.\s*(path|source|generated)/);
  });

  it('source comparison only adds a ghost overlay; it never replaces Active Run', () => {
    const plan = drawPlan({ mode: 'generated', validationStatus: 'valid', compareSource: true, hasSource: true, hasPlacementPreview: false });
    expect(plan.drawCompareSource).toBe(true);
    expect(plan.primaryIsGenerated).toBe(true);
    const block = drawBlock();
    // Comparison renders after and subdued relative to the primary.
    expect(block.indexOf('drawSegments(parsed.segments')).toBeLessThan(block.indexOf('drawSegments(sourceParsed.segments'));
    expect(block).toMatch(/alpha: 0\.34/);
  });

  it('a source Active Run never duplicates itself when comparison is enabled', () => {
    const plan = drawPlan({ mode: 'source', validationStatus: 'unknown', compareSource: true, hasSource: true, hasPlacementPreview: false });
    expect(plan.drawCompareSource).toBe(false);
  });

  it('the Travel toggle still gates travel inside the primary path and overlays', () => {
    const block = drawBlock();
    const travelUses = [...block.matchAll(/showTravel: layers\.travel/g)].length;
    expect(travelUses).toBe(3); // primary, source comparison, placement preview
  });

  it('the renderer reuses the existing active-run decision instead of a new heuristic', () => {
    const block = drawBlock();
    expect(block).toContain('mode: currentRunMode()');
    expect(block).toContain("validationStatus: jobState?.generatedValidation?.status || 'unknown'");
    // No independent fingerprint or selection logic in the canvas path.
    expect(block).not.toMatch(/fingerprint/i);
  });

  it('a placement preview does not become Active Run before activation/validation', () => {
    // Source active, transform in progress: preview stays a separate overlay.
    const placing = drawPlan({ mode: 'source', validationStatus: 'unknown', compareSource: false, hasSource: true, hasPlacementPreview: true });
    expect(placing.primaryIsGenerated).toBe(false);
    expect(placing.drawPlacementPreview).toBe(true);
    // Generated active but not yet current: still distinct from the primary.
    const stale = drawPlan({ mode: 'generated', validationStatus: 'stale', compareSource: false, hasSource: true, hasPlacementPreview: true });
    expect(stale.drawPlacementPreview).toBe(true);
    expect(stale.primaryIsGenerated).toBe(true);
    // Once the generated run is current, its own parse is the primary and the
    // temporary placement preview stops rendering as a separate path.
    const current = drawPlan({ mode: 'generated', validationStatus: 'valid', compareSource: false, hasSource: true, hasPlacementPreview: true });
    expect(current.drawPlacementPreview).toBe(false);
    expect(current.primaryIsGenerated).toBe(true);
  });

  it('labels the canvas with the active run identity', () => {
    expect(previewJs).toContain("`ACTIVE RUN${activeMode === 'generated' ? ' · GENERATED' : ''}`");
  });

  it('keeps Job Start dispatch untouched (pinned by job-start-ws suite)', () => {
    // The Start path is pinned by test/ui/job-start-ws.test.mjs; here we only
    // assert the canvas refactor did not leak into it.
    const start = previewJs.indexOf('async function dispatchJobStart(');
    const end = previewJs.indexOf('\n}', start);
    const body = previewJs.slice(start, end);
    expect(body).toContain("beginCommand('job.start'");
    expect(body).not.toContain('drawPlan');
    expect(body).not.toContain('activeRunDrawPlan');
  });
});
