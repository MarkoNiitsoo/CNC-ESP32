import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LAYERS,
  createWorkbenchState,
  reduceWorkbenchState,
} from '../../www/lib/workbench-ui.js';
import {
  LAYER_STORAGE_KEY,
  loadLayerPreferences,
  saveLayerPreferences,
} from '../../www/lib/workbench-controller.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = async (rel) => (await readFile(path.join(repoRoot, rel), 'utf8')).replace(/\r\n/g, '\n');
const previewJs = await read('www/preview.js');
const previewHtml = await read('www/preview.html');
const workbenchUiJs = await read('www/lib/workbench-ui.js');
const workbenchControllerJs = await read('www/lib/workbench-controller.js');

const KNOWN_LAYER_KEYS = ['bounds', 'zero', 'travel', 'table'];

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
const identity = compileFn(previewJs, 'canvasIdentity');

const layerToggleNames = [...previewHtml.matchAll(/data-canvas-layer="([^"]+)"[^>]*>\s*([^<]*)</g)]
  .map((m) => ({ key: m[1], label: m[2].trim() }));

// The draw-plan → recovery region: everything draw() renders for job geometry
// BEFORE the recovery overlay (whose drawSegments calls live below the guard).
function jobGeometryRegion() {
  const start = previewJs.indexOf('const drawPlan = currentDisplayPlan();');
  expect(start, 'draw() should build the plan via currentDisplayPlan()').toBeGreaterThan(0);
  const end = previewJs.indexOf('if (recoveryOverlayVisible', start);
  expect(end, 'recovery guard should follow the job geometry').toBeGreaterThan(start);
  return previewJs.slice(start, end);
}

function boundsBlock() {
  const start = previewJs.indexOf('const drawPlan = currentDisplayPlan();');
  const boundsStart = previewJs.indexOf('if (layers.bounds) {', start);
  expect(boundsStart, 'bounds block should follow the draw plan').toBeGreaterThan(start);
  const end = previewJs.indexOf('const displayedSegments', boundsStart);
  expect(end, 'path drawing should follow the bounds block').toBeGreaterThan(boundsStart);
  return previewJs.slice(boundsStart, end);
}

describe('Active Run is the single primary preview toolpath', () => {
  it('keeps exactly four layer toggles: bounds, zero, travel, table', () => {
    expect(Object.keys(DEFAULT_LAYERS)).toEqual(KNOWN_LAYER_KEYS);
    expect(DEFAULT_LAYERS).not.toHaveProperty('path');
    expect(DEFAULT_LAYERS).not.toHaveProperty('source');
    expect(DEFAULT_LAYERS).not.toHaveProperty('generated');
    expect(DEFAULT_LAYERS).not.toHaveProperty('compareSource');
    expect(workbenchUiJs).toMatch(/DEFAULT_LAYERS = Object\.freeze\(\{\s*bounds: true,\s*zero: true,\s*travel: true,\s*table: true,\s*\}\)/);
    expect(layerToggleNames.map((l) => l.key)).toEqual(KNOWN_LAYER_KEYS);
  });

  it('removes the Compare original toggle from the Layers UI', () => {
    expect(previewHtml).not.toContain('Compare original');
    expect(previewHtml).not.toContain('compare-source-layer');
    expect(previewHtml).not.toContain('data-canvas-layer="compareSource"');
    const checkboxes = [...previewHtml.matchAll(/data-canvas-layer=/g)];
    expect(checkboxes.length).toBe(4);
  });

  it('contains no compareSource references anywhere in the Web UI', () => {
    expect(workbenchUiJs).not.toContain('compareSource');
    expect(workbenchControllerJs).not.toContain('compareSource');
    expect(previewJs).not.toContain('compareSource');
    expect(previewHtml).not.toContain('compareSource');
  });

  it('workbench state keeps only the four known layer keys', () => {
    const state = createWorkbenchState(1024);
    expect(Object.keys(state.layers)).toEqual(KNOWN_LAYER_KEYS);
    const toggled = reduceWorkbenchState(state, { type: 'toggle-layer', layer: 'bounds' });
    expect(toggled.layers.bounds).toBe(false);
    expect(Object.keys(toggled.layers)).toEqual(KNOWN_LAYER_KEYS);
    // Legacy/unknown layer keys cannot be introduced through the reducer.
    const injected = reduceWorkbenchState(state, { type: 'toggle-layer', layer: 'compareSource' });
    expect(injected.layers).not.toHaveProperty('compareSource');
    expect(injected.layers).toEqual(state.layers);
  });

  it('drops legacy persisted layer keys and persists only the four known ones', () => {
    const values = new Map([[LAYER_STORAGE_KEY, JSON.stringify({
      travel: false, compareSource: true, path: true, source: true, generated: true,
    })]]);
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    const loaded = loadLayerPreferences(storage, DEFAULT_LAYERS);
    expect(Object.keys(loaded).sort()).toEqual([...KNOWN_LAYER_KEYS].sort());
    expect(loaded.travel).toBe(false);
    expect(loaded.bounds).toBe(true);
    expect(loaded.zero).toBe(true);
    expect(loaded.table).toBe(true);
    saveLayerPreferences(storage, loaded);
    expect(Object.keys(JSON.parse(values.get(LAYER_STORAGE_KEY))).sort())
      .toEqual([...KNOWN_LAYER_KEYS].sort());
  });

  it('renders the source Active Run as the displayed executable path', () => {
    expect(drawPlan({ mode: 'source' }))
      .toEqual({ mode: 'active-run', generated: false, executable: true });
  });

  it('renders a current generated Active Run as the displayed executable path', () => {
    expect(drawPlan({ mode: 'generated', validationStatus: 'valid' }))
      .toEqual({ mode: 'active-run', generated: true, executable: true });
  });

  it('a current generated run suppresses the placement preview', () => {
    expect(drawPlan({ mode: 'generated', validationStatus: 'valid', hasPlacementPreview: true }))
      .toEqual({ mode: 'active-run', generated: true, executable: true });
  });

  it('a stale generated run is replaced by the pending placement preview', () => {
    expect(drawPlan({ mode: 'generated', validationStatus: 'stale', hasPlacementPreview: true }))
      .toEqual({ mode: 'placement-preview', generated: true, executable: false });
  });

  it('a source run with dirty placement is replaced by the pending placement preview', () => {
    expect(drawPlan({ mode: 'source', hasPlacementPreview: true }))
      .toEqual({ mode: 'placement-preview', generated: false, executable: false });
  });

  it('draw() renders exactly ONE job-geometry path with no ghosting', () => {
    const region = jobGeometryRegion();
    const drawCalls = [...region.matchAll(/drawSegments\(/g)];
    expect(drawCalls.length).toBe(1);
    expect(region).toContain('showTravel: layers.travel');
    expect(region).not.toMatch(/alpha:/);
    expect(region).not.toContain('drawSegments(sourceParsed');
    expect(region).not.toContain('drawSegments(transformedPreview');
    expect(region).not.toContain('drawSegments(parsed.segments');
  });

  it('the placement preview replaces the displayed path instead of layering on top', () => {
    const region = jobGeometryRegion();
    expect(region).toMatch(/const displayedSegments = drawPlan\.mode === 'placement-preview'\s*\?\s*transformedPreview\?\.segments\s*:\s*parsed\?\.segments;/);
    expect(region).toContain('if (displayedSegments?.length)');
    expect(region).toContain('drawSegments(displayedSegments, jobProject, {');
  });

  it('bounds follow the ONE displayed geometry; verification margin is executable-mode only', () => {
    const block = boundsBlock();
    expect(block).toContain("const boundsModel = drawPlan.mode === 'placement-preview' ? transformedPreview : parsed;");
    expect(block).toContain('boundsModel.bounds.rawTravelBounds');
    expect(block).toContain('boundsModel.bounds.cutBounds');
    expect(block).not.toContain('sourceToolpathModel');
    // The verification margin rectangle exists only inside the active-run guard.
    const guardIndex = block.indexOf("if (drawPlan.mode === 'active-run')");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(block.indexOf('verificationDecision')).toBeGreaterThan(guardIndex);
    expect(block.indexOf('colors.placementBounds')).toBeGreaterThan(guardIndex);
  });

  it('labels the canvas from the same single-display decision as draw()', () => {
    expect(identity({ displayMode: 'placement-preview', runMode: 'source', hasFile: true }))
      .toEqual({ name: 'PLACEMENT PREVIEW', note: 'Not yet generated' });
    expect(identity({ displayMode: 'active-run', runMode: 'source', hasFile: false }))
      .toEqual({ name: 'No job', note: '' });
    expect(identity({ displayMode: 'active-run', runMode: 'generated', hasFile: true }))
      .toEqual({ name: 'ACTIVE RUN · GENERATED', note: '' });
    expect(identity({ displayMode: 'active-run', runMode: 'source', hasFile: true }))
      .toEqual({ name: 'ACTIVE RUN', note: '' });
    // Label and canvas share one decision source.
    const statusSource = extractFunctionSource(previewJs, 'renderWorkbenchStatus');
    expect(statusSource).toContain('currentDisplayPlan()');
    expect(statusSource).toContain('canvasIdentity(');
    expect(jobGeometryRegion()).toContain('const drawPlan = currentDisplayPlan();');
  });

  it('the renderer reuses the existing active-run decision instead of a new heuristic', () => {
    const planSource = extractFunctionSource(previewJs, 'currentDisplayPlan');
    expect(planSource).toContain('mode: currentRunMode()');
    expect(planSource).toContain("validationStatus: jobState?.generatedValidation?.status || 'unknown'");
    expect(planSource).toContain('hasPlacementPreview: Boolean(transformedPreview?.segments?.length)');
    // No independent fingerprint or selection logic in the canvas path.
    expect(jobGeometryRegion()).not.toMatch(/fingerprint/i);
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
