import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = (await readFile(path.join(repoRoot, 'www', 'preview.js'), 'utf8')).replace(/\r\n/g, '\n');

function extractFunctionSource(name) {
  const start = source.indexOf(`function ${name}(`);
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

const boundsText = (b) => (!b || b.xMin === undefined) ? '-' :
  `X ${b.xMin.toFixed(2)} .. ${b.xMax.toFixed(2)}, Y ${b.yMin.toFixed(2)} .. ${b.yMax.toFixed(2)}, Z ${b.zMin.toFixed(2)} .. ${b.zMax.toFixed(2)} mm`;
const hasBounds = (b) => Boolean(b) && Number.isFinite(b.xMin);

function runRenderStats({ mode, validationStatus, activeBounds, summary }) {
  const appended = [];
  const statsEl = {
    innerHTML: '',
    append: (node) => appended.push(node.textContent),
  };
  const parsed = {
    bounds: { xMin: -253, xMax: 253, yMin: -253, yMax: 253, zMin: -24, zMax: 15 },
    analysis: { feeds: { feedCommandCount: 10 } },
    parsedLines: 5,
    segments: [],
    warnings: [],
  };
  const deps = {
    statsEl,
    parsed,
    previewSummaryData: summary,
    effectiveFeedRange: () => null,
    fmtMm: (v) => v.toFixed(2),
    boundsText,
    hasBounds,
    estimateText: () => '~1 min',
    currentRunMode: () => mode,
    jobState: { generatedValidation: { status: validationStatus } },
    lastPlacementPreview: activeBounds,
    warningsEl: { textContent: '', append: () => {} },
    document: { createElement: () => ({ className: '', textContent: '' }) },
  };
  // eslint-disable-next-line no-new-func
  const renderStats = new Function(
    ...Object.keys(deps),
    `return (${extractFunctionSource('renderStats')});`,
  )(...Object.values(deps));
  renderStats();
  return { html: statsEl.innerHTML, appended };
}

const sourceSummary = {
  rawTravelBounds: { xMin: -253, xMax: 253, yMin: -253, yMax: 253, zMin: -24, zMax: 15 },
  cutBounds: { xMin: -253, xMax: 253, yMin: -253, yMax: 253, zMin: -24, zMax: -4 },
  placementBounds: { xMin: -253, xMax: 253, yMin: -253, yMax: 253, zMin: -24, zMax: -4 },
  feed: { commandCount: 10, min: 600, max: 1500, rapidDistance: 5, cuttingDistance: 50 },
  estimate: { confidence: 'high', nominalSeconds: 60 },
  infos: ['Small negative coordinates are present. Future action: Fix Origin / normalize to bounds.'],
};
const transformedPreview = {
  generatedRunBounds: { xMin: 0, xMax: 506, yMin: 0, yMax: 506, zMin: -24, zMax: 15 },
  selectedTransformedBounds: { xMin: 0, xMax: 506, yMin: 0, yMax: 506, zMin: -24, zMax: -4 },
};

describe('summary bounds track the active run (stale generated fallback)', () => {
  it('shows transformed placement bounds when the generated run is the stale active run', () => {
    const { html, appended } = runRenderStats({
      mode: 'generated',
      validationStatus: 'stale',
      activeBounds: transformedPreview,
      summary: sourceSummary,
    });
    expect(html).toContain('X 0.00 .. 506.00, Y 0.00 .. 506.00, Z -24.00 .. 15.00 mm');
    expect(html).toContain('X 0.00 .. 506.00, Y 0.00 .. 506.00, Z -24.00 .. -4.00 mm');
    expect(html).not.toContain('-253.00');
    expect(html).toContain('Update Run File will produce');
    // Source negatives no longer apply once the placement is normalized.
    expect(appended.join('\n')).not.toContain('Small negative coordinates');
  });

  it('keeps the parsed summary bounds when the generated run is valid', () => {
    const { html } = runRenderStats({
      mode: 'generated',
      validationStatus: 'valid',
      activeBounds: transformedPreview,
      summary: sourceSummary, // valid mode parses the generated file itself
    });
    expect(html).toContain('-253.00');
    expect(html).not.toContain('Update Run File will produce');
  });

  it('keeps source bounds in original mode regardless of transform state', () => {
    const { html } = runRenderStats({
      mode: 'source',
      validationStatus: 'stale',
      activeBounds: transformedPreview,
      summary: sourceSummary,
    });
    expect(html).toContain('-253.00');
    expect(html).not.toContain('Update Run File will produce');
  });

  it('feeds and distances stay from the parse (a rigid transform preserves them)', () => {
    const { html } = runRenderStats({
      mode: 'generated',
      validationStatus: 'stale',
      activeBounds: transformedPreview,
      summary: sourceSummary,
    });
    expect(html).toContain('F600.00 .. F1500.00');
    expect(html).toContain('5.00 mm');
    expect(html).toContain('50.00 mm');
  });

  it('refreshes the summary when the placement preview is recomputed', () => {
    const updateBody = extractFunctionSource('updatePlacementPreview');
    expect(updateBody).toContain('lastPlacementPreview = preview;');
    expect(updateBody).toContain('if (parsed) renderStats();');
  });
});
