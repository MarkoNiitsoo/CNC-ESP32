import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  actionPolicy,
  adaptiveGridStep,
  activeRunBadge,
  buildWorkbenchStatus,
  commandedPositionAtLine,
  commandedPositionAtCommand,
  createCanvasProjection,
  createWorkspaceProjection,
  createWorkbenchState,
  layoutModeForWidth,
  interpolateMotionSegment,
  motionDurationMs,
  orthographicPoint,
  projectedVolumeBounds,
  reduceWorkbenchState,
  segmentAtCommand,
  segmentsBetweenCommands,
  translateBounds,
  translatePosition,
  workCoordinateAtMachine,
  workspaceToolPosition,
  workZeroTablePosition,
  zoomPanForGesture,
} from '../../www/lib/workbench-ui.js';
import {
  LAYER_STORAGE_KEY,
  VIEW_MODE_STORAGE_KEY,
  loadLayerPreferences,
  loadViewMode,
  saveLayerPreferences,
  saveViewMode,
} from '../../www/lib/workbench-controller.js';

const controllerSource = await readFile(new URL('../../www/lib/workbench-controller.js', import.meta.url), 'utf8');
const previewHtml = await readFile(new URL('../../www/preview.html', import.meta.url), 'utf8');
const previewStyles = await readFile(new URL('../../www/preview.css', import.meta.url), 'utf8');
const globalStyles = await readFile(new URL('../../www/style.css', import.meta.url), 'utf8');

const sourceJob = {
  gcodePath: '/gcode/test.gc',
  sourceGcodePath: '/gcode/test.gc',
  activeRun: { mode: 'source', path: '/gcode/test.gc' },
};

const generatedJob = {
  ...sourceJob,
  placement: { rotationDeg: 15, dirty: false, generatedRunPath: '/jobs/generated/test.run.gc' },
  activeRun: { mode: 'generated', path: '/jobs/generated/test.run.gc' },
  generatedValidation: { status: 'valid', generatedPath: '/jobs/generated/test.run.gc' },
};

describe('canvas workbench responsive state', () => {
  it('keeps one edge Tools entry point and translucent blue actions', () => {
    expect(previewHtml).not.toContain('id="open-tools-drawer"');
    expect(previewHtml).toContain('id="left-edge-handle"');
    expect(globalStyles).toMatch(/button:not\(\.danger-button\):not\(\.warning-button\)[\s\S]*color-mix\(in srgb, var\(--cnc-accent\) 68%, transparent\)/);
    expect(previewStyles).toMatch(/\.drawer-tabs button\.active[\s\S]*color-mix\(in srgb, var\(--cnc-accent\) 68%, transparent\)/);
  });

  it('chooses readable 1/2/5 grid intervals as canvas scale changes', () => {
    expect(adaptiveGridStep(0.1, 80)).toBe(1000);
    expect(adaptiveGridStep(1, 80)).toBe(100);
    expect(adaptiveGridStep(4, 80)).toBe(20);
    expect(adaptiveGridStep(20, 80)).toBe(5);
  });

  it('places work zero, job geometry, and tool position in homing-table coordinates', () => {
    const job = {
      workZero: { beforeG92: { position: { x: 120, y: 340, z: 12 } } },
    };
    const zero = workZeroTablePosition(job);

    expect(zero).toEqual({ x: 120, y: 340, z: 12 });
    expect(translatePosition({ x: 5, y: -2, z: 1 }, zero)).toMatchObject({ x: 125, y: 338, z: 1 });
    expect(translateBounds({ xMin: 0, xMax: 20, yMin: -5, yMax: 10 }, zero)).toMatchObject({
      xMin: 120, xMax: 140, yMin: 335, yMax: 350,
    });
    expect(workspaceToolPosition({ x: 125, y: 338, z: 15, isMachine: true }, zero))
      .toMatchObject({ x: 125, y: 338, z: 3, isMachine: true });
    expect(workspaceToolPosition({ x: 5, y: -2, z: 3 }, zero))
      .toMatchObject({ x: 125, y: 338, z: 3 });
  });

  it('keeps grid lines in machine space while ruler values use work zero', () => {
    expect(workCoordinateAtMachine(0, 100)).toBe(-100);
    expect(workCoordinateAtMachine(100, 100)).toBe(0);
    expect(workCoordinateAtMachine(0, 500)).toBe(-500);
    expect(workCoordinateAtMachine(750, 500)).toBe(250);
  });

  it('prefers the selected work-zero history anchor over the compatibility capture', () => {
    const job = {
      activeWorkZeroId: 'zero-selected',
      zeroHistory: [
        { id: 'zero-selected', type: 'workZero', positionBefore: { x: 500, y: 600, z: 7 } },
      ],
      workZero: { beforeG92: { position: { x: 10, y: 20, z: 3 } } },
    };

    expect(workZeroTablePosition(job)).toEqual({ x: 500, y: 600, z: 7 });
  });

  it('maps acknowledged G-code line progress to the last commanded tool endpoint', () => {
    const segments = [
      { to: { x: 999, y: 999, z: 999 } },
      { lineNumber: 5, to: { x: 1, y: 2, z: 3 } },
      { lineNumber: 8, to: { x: 10, y: 20, z: -1 } },
    ];

    expect(commandedPositionAtLine(segments, 4)).toBeNull();
    expect(commandedPositionAtLine(segments, 5)).toEqual({ x: 1, y: 2, z: 3 });
    expect(commandedPositionAtLine(segments, 7)).toEqual({ x: 1, y: 2, z: 3 });
    expect(commandedPositionAtLine(segments, 8)).toEqual({ x: 10, y: 20, z: -1 });
  });

  it('moves the rendered image in the same screen direction as pointer pan', () => {
    const base = createCanvasProjection({
      width: 400,
      height: 300,
      bounds: { xMin: 0, xMax: 100, yMin: 0, yMax: 100 },
      scale: 2,
    });
    const draggedUp = createCanvasProjection({
      width: 400,
      height: 300,
      bounds: { xMin: 0, xMax: 100, yMin: 0, yMax: 100 },
      scale: 2,
      panX: 18,
      panY: -24,
    });

    expect(draggedUp.x(50) - base.x(50)).toBe(18);
    expect(draggedUp.y(50) - base.y(50)).toBe(-24);
  });

  it('keeps wheel zoom anchored exactly under the cursor', () => {
    const bounds = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
    const cursor = { x: 310, y: 90 };
    const viewportCenter = { x: 200, y: 150 };
    const before = createCanvasProjection({ width: 400, height: 300, bounds, scale: 2, panX: 12, panY: -8 });
    const world = { x: (cursor.x - 100 - 12) / 2, y: (250 - cursor.y - 8) / 2 };
    const nextPan = zoomPanForGesture({
      panX: 12, panY: -8, startPoint: cursor, currentPoint: cursor, viewportCenter, ratio: 1.5,
    });
    const after = createCanvasProjection({ width: 400, height: 300, bounds, scale: 3, ...nextPan });

    expect(before.x(world.x)).toBeCloseTo(cursor.x, 8);
    expect(before.y(world.y)).toBeCloseTo(cursor.y, 8);
    expect(after.x(world.x)).toBeCloseTo(cursor.x, 8);
    expect(after.y(world.y)).toBeCloseTo(cursor.y, 8);
  });

  it('keeps pinch zoom anchored under the moving two-pointer midpoint', () => {
    const bounds = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
    const start = { x: 120, y: 180 };
    const current = { x: 145, y: 155 };
    const center = { x: 200, y: 150 };
    const before = createCanvasProjection({ width: 400, height: 300, bounds, scale: 2 });
    const world = { x: (start.x - 100) / 2, y: (250 - start.y) / 2 };
    const nextPan = zoomPanForGesture({ startPoint: start, currentPoint: current, viewportCenter: center, ratio: 2 });
    const after = createCanvasProjection({ width: 400, height: 300, bounds, scale: 4, ...nextPan });

    expect(before.x(world.x)).toBeCloseTo(start.x, 8);
    expect(before.y(world.y)).toBeCloseTo(start.y, 8);
    expect(after.x(world.x)).toBeCloseTo(current.x, 8);
    expect(after.y(world.y)).toBeCloseTo(current.y, 8);
  });

  it('rebases the remaining pointer after pinch without triggering double tap fit', () => {
    expect(controllerSource).toContain('gestureHadPinch = true');
    expect(controllerSource).toMatch(/pointers\.size === 1[\s\S]*dragStart = \{ point: remaining, panX: view\.panX, panY: view\.panY \}/);
    expect(controllerSource).toContain("if (!gestureHadPinch && event.type === 'pointerup')");
  });

  it('uses edge drawers on phones and overlay/sidebar modes on larger screens', () => {
    expect(layoutModeForWidth(390)).toBe('edge');
    expect(layoutModeForWidth(820)).toBe('overlay');
    expect(layoutModeForWidth(1440)).toBe('sidebar');
  });

  it('opens and closes drawers without changing job or activeRun metadata', () => {
    const jobBefore = JSON.stringify(generatedJob);
    const initial = createWorkbenchState(390);
    const opened = reduceWorkbenchState(initial, { type: 'open-left' });
    const switched = reduceWorkbenchState(opened, { type: 'open-right' });
    const closed = reduceWorkbenchState(switched, { type: 'close-drawers' });

    expect(opened.leftDrawer).toBe('open');
    expect(switched).toMatchObject({ leftDrawer: 'closed', rightDrawer: 'open' });
    expect(closed).toMatchObject({ leftDrawer: 'closed', rightDrawer: 'closed' });
    expect(JSON.stringify(generatedJob)).toBe(jobBefore);
  });

  it('toggles visual layers without encoding machine movement', () => {
    const state = reduceWorkbenchState(createWorkbenchState(390), { type: 'toggle-layer', layer: 'travel' });
    expect(state.layers.travel).toBe(false);
    expect(JSON.stringify(state)).not.toMatch(/G28|G92|M3|M4/);
  });

  it('treats placement drawer state as UI intent only', () => {
    const initial = createWorkbenchState(390);
    const placementOpen = reduceWorkbenchState(initial, { type: 'open-left' });
    expect(placementOpen.leftDrawer).toBe('open');
    expect(JSON.stringify(placementOpen)).not.toMatch(/G0|G1|G28|G92|M3|M4/);
  });
});

describe('canvas workbench active run and readiness', () => {
  it('shows ORIGINAL for source and GENERATED for valid generated execution truth', () => {
    expect(activeRunBadge(sourceJob)).toMatchObject({ label: 'ORIGINAL', path: '/gcode/test.gc' });
    expect(activeRunBadge(generatedJob)).toMatchObject({ label: 'GENERATED', path: '/jobs/generated/test.run.gc' });
  });

  it('shows stale or blocked generated state and keeps Update Run File as next action', () => {
    const stale = {
      ...generatedJob,
      placement: { ...generatedJob.placement, dirty: true },
      generatedValidation: { status: 'stale' },
    };
    const status = buildWorkbenchStatus(stale, { currentJob: { gcodePath: '/gcode/test.gc' } });

    expect(status.activeRun.label).toBe('STALE');
    expect(status.activeRunPath).toBe('/jobs/generated/test.run.gc');
    expect(status.primaryAction.label).toBe('Update Run File');
  });

  it('never silently falls back to source for transformed placement', () => {
    const invalid = {
      ...generatedJob,
      activeRun: { mode: 'generated', path: '/jobs/generated/test.run.gc' },
      generatedValidation: { status: 'invalid' },
    };
    const status = buildWorkbenchStatus(invalid, { currentJob: { gcodePath: '/gcode/test.gc' } });

    expect(status.activeRun.label).toBe('BLOCKED');
    expect(status.activeRunPath).toBe('/jobs/generated/test.run.gc');
    expect(status.primaryAction.label).toBe('Update Run File');
  });
});

describe('canvas workbench control policy', () => {
  it('maps compact motion events by command number and interpolates lines and arcs locally', () => {
    const line = { commandNumber: 4, type: 'cut', from: { x: 0, y: 0, z: 0 }, to: { x: 10, y: 0, z: -2 }, length: 10, feed: 600 };
    const arc = { commandNumber: 5, type: 'arc', from: { x: 10, y: 0, z: -2 }, to: { x: 0, y: 10, z: -2 }, length: Math.PI * 5, feed: 600, arc: { center: { x: 0, y: 0 }, sweepRadians: Math.PI / 2 } };
    expect(segmentAtCommand([line, arc], 4)).toBe(line);
    expect(commandedPositionAtCommand([line, arc], 4)).toEqual({ x: 10, y: 0, z: -2 });
    expect(interpolateMotionSegment(line, 0.5)).toEqual({ x: 5, y: 0, z: -1 });
    const middleArc = interpolateMotionSegment(arc, 0.5);
    expect(middleArc.x).toBeCloseTo(Math.SQRT1_2 * 10);
    expect(middleArc.y).toBeCloseTo(Math.SQRT1_2 * 10);
    expect(motionDurationMs(line, { feedOverridePercent: 100 })).toBe(1000);
    expect(motionDurationMs({ ...line, length: 3000, feed: 3000 }, { feedOverridePercent: 100 })).toBe(30000);
  });

  it('projects the workspace orthographically without depth-dependent scaling', () => {
    const origin = orthographicPoint({ x: 0, y: 0, z: 0 });
    const xAtFront = orthographicPoint({ x: 100, y: 0, z: 0 });
    const xAtBack = orthographicPoint({ x: 100, y: 200, z: 0 });
    const backOrigin = orthographicPoint({ x: 0, y: 200, z: 0 });
    expect(xAtFront.x - origin.x).toBeCloseTo(xAtBack.x - backOrigin.x, 8);
    expect(xAtFront.y - origin.y).toBeCloseTo(xAtBack.y - backOrigin.y, 8);

    const volume = projectedVolumeBounds({ xMin: 0, xMax: 100, yMin: 0, yMax: 200, zMin: -5, zMax: 20 }, '3d');
    expect(volume.xMax).toBeGreaterThan(volume.xMin);
    expect(volume.yMax).toBeGreaterThan(volume.yMin);
  });

  it('switches between top-down 2D and fixed orthographic 3D projections', () => {
    const options = {
      width: 500,
      height: 320,
      bounds: { xMin: 0, xMax: 100, yMin: 0, yMax: 200, zMin: 0, zMax: 40 },
    };
    const top = createWorkspaceProjection({ ...options, mode: '2d' });
    const ortho = createWorkspaceProjection({ ...options, mode: '3d' });
    expect(top.point({ x: 20, y: 30, z: 0 })).toEqual(top.point({ x: 20, y: 30, z: 40 }));
    expect(ortho.point({ x: 20, y: 30, z: 40 }).y).toBeLessThan(ortho.point({ x: 20, y: 30, z: 0 }).y);
    expect(ortho.mode).toBe('3d');
  });

  it('exposes an accessible persistent 2D/3D workspace toggle', () => {
    expect(previewHtml).toContain('data-workspace-view="2d"');
    expect(previewHtml).toContain('data-workspace-view="3d"');
    expect(previewHtml).toContain('aria-label="Workspace view"');
    expect(controllerSource).toContain("button.setAttribute('aria-pressed', String(active))");

    const values = new Map([[VIEW_MODE_STORAGE_KEY, '3d']]);
    const storage = {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    };
    expect(loadViewMode(storage)).toBe('3d');
    saveViewMode(storage, '2d');
    expect(values.get(VIEW_MODE_STORAGE_KEY)).toBe('2d');
  });

  it('reconstructs omitted compact telemetry events from preview command numbers', () => {
    const segments = [2, 4, 5, 8].map((commandNumber) => ({ commandNumber }));
    expect(segmentsBetweenCommands(segments, 2, 8)).toEqual([segments[1], segments[2], segments[3]]);
    expect(segmentsBetweenCommands(segments, 8, 8)).toEqual([]);
  });

  it('persists only known boolean layer preferences', () => {
    const values = new Map([[LAYER_STORAGE_KEY, JSON.stringify({ travel: false, path: true, injected: false })]]);
    const storage = {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    };
    const defaults = createWorkbenchState(390).layers;
    const loaded = loadLayerPreferences(storage, defaults);
    expect(loaded).toMatchObject({ travel: false, path: true });
    expect(loaded).not.toHaveProperty('injected');
    saveLayerPreferences(storage, { ...loaded, zero: false });
    expect(JSON.parse(values.get(LAYER_STORAGE_KEY)).zero).toBe(false);
  });

  it('prefers the saved machine-space work-zero reference for canvas placement', () => {
    const job = {
      activeWorkZeroId: 'zero-machine',
      zeroHistory: [{
        id: 'zero-machine', type: 'workZero',
        positionBefore: { x: 0, y: 0, z: 0 },
        machineReference: { position: { x: 100, y: 500, z: 42 } },
      }],
    };
    expect(workZeroTablePosition(job)).toEqual({ x: 100, y: 500, z: 42 });
    expect(translatePosition({ x: 10, y: 20, z: -2 }, workZeroTablePosition(job)))
      .toMatchObject({ x: 110, y: 520, z: -2 });
  });

  it('uses the specified hold policy for job controls and keeps M5 advanced-only', () => {
    expect(actionPolicy('start_cut')).toMatchObject({ mode: 'hold', holdMs: 1000 });
    expect(actionPolicy('pause')).toMatchObject({ mode: 'hold', holdMs: 500 });
    expect(actionPolicy('resume')).toMatchObject({ mode: 'hold', holdMs: 500 });
    expect(actionPolicy('stop')).toMatchObject({ mode: 'hold', holdMs: 500 });
    expect(actionPolicy('m5').mode).toBe('advanced-manual');
  });

  it('does not introduce homing or automatic zero commands', () => {
    const metadata = JSON.stringify([
      actionPolicy('start_cut'),
      actionPolicy('pause'),
      actionPolicy('stop'),
      actionPolicy('m5'),
    ]);
    expect(metadata).not.toMatch(/G28|G92|homing|restore/i);
  });
});
