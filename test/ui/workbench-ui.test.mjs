import { describe, expect, it } from 'vitest';
import {
  actionPolicy,
  activeRunBadge,
  buildWorkbenchStatus,
  createWorkbenchState,
  layoutModeForWidth,
  reduceWorkbenchState,
} from '../../www/lib/workbench-ui.js';

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
  it('keeps Start Cut deliberate while Pause, Stop, and M5 remain direct', () => {
    expect(actionPolicy('start_cut')).toMatchObject({ mode: 'hold', holdMs: 1000 });
    expect(actionPolicy('pause').mode).toBe('direct');
    expect(actionPolicy('stop').mode).toBe('direct');
    expect(actionPolicy('m5').mode).toBe('direct');
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
