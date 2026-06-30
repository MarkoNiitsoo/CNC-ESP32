import { createWorkbenchState, reduceWorkbenchState, zoomPanForGesture } from './workbench-ui.js';

const LEFT_TABS = new Set(['preview', 'setup', 'dry-run']);
const RIGHT_TABS = new Set(['preflight', 'arm', 'run']);

function byId(id) {
  return document.getElementById(id);
}

function appendExisting(target, selectors) {
  selectors.forEach((selector) => {
    const node = document.querySelector(selector);
    if (node) target?.append(node);
  });
}

export function installWorkbench(options = {}) {
  const canvas = options.canvas;
  let state = createWorkbenchState(window.innerWidth);
  const view = { zoom: 1, panX: 0, panY: 0, fitMode: 'active' };
  const pointers = new Map();
  let dragStart = null;
  let pinchStart = null;
  let edgeStart = null;
  let lastTapAt = 0;

  const leftDrawer = byId('tools-drawer');
  const rightDrawer = byId('readiness-drawer');
  const scrim = byId('workbench-scrim');
  const layerPanel = byId('canvas-layers');

  function syncMachineBarHeight() {
    const height = Math.ceil(document.querySelector('.machine-shell')?.getBoundingClientRect().height || 58);
    document.documentElement.style.setProperty('--machine-bar-height', `${height}px`);
  }

  appendExisting(byId('tools-drawer-content'), [
    '.preview-stats',
    '.placement-panel',
    '#preview-warnings-panel',
    '.job-panel',
    '.tool-zero-panel',
    '.zero-history-panel',
    '.run-history-panel',
    '.feed-override-panel',
    '.dry-run-panel',
  ]);
  appendExisting(byId('readiness-drawer-content'), [
    '.readiness-panel',
    '.preflight-panel',
    '.arm-panel',
    '.run-panel',
  ]);

  function notify() {
    options.onViewChange?.({ view: { ...view }, layers: { ...state.layers }, state: { ...state } });
  }

  function renderState() {
    leftDrawer?.classList.toggle('open', state.leftDrawer === 'open');
    rightDrawer?.classList.toggle('open', state.rightDrawer === 'open');
    leftDrawer?.setAttribute('aria-hidden', String(state.leftDrawer !== 'open'));
    rightDrawer?.setAttribute('aria-hidden', String(state.rightDrawer !== 'open'));
    if (scrim) scrim.hidden = state.leftDrawer !== 'open' && state.rightDrawer !== 'open';
    if (layerPanel) layerPanel.hidden = state.bottomDrawer !== 'expanded';
    canvas?.classList.toggle('select-mode', state.interactionMode === 'select');
    const modeButton = byId('canvas-mode');
    if (modeButton) modeButton.textContent = state.interactionMode === 'pan' ? 'Pan' : 'Select';
    notify();
  }

  function dispatch(action) {
    state = reduceWorkbenchState(state, action);
    renderState();
  }

  function openDrawer(side) {
    dispatch({ type: side === 'right' ? 'open-right' : 'open-left' });
  }

  function closeDrawers() {
    dispatch({ type: 'close-drawers' });
  }

  function openForTab(tab) {
    if (LEFT_TABS.has(tab)) openDrawer('left');
    else if (RIGHT_TABS.has(tab)) openDrawer('right');
  }

  function fit(mode = 'active') {
    view.fitMode = mode;
    view.zoom = 1;
    view.panX = 0;
    view.panY = 0;
    notify();
  }

  function zoomBy(factor, center = null) {
    const previous = view.zoom;
    view.zoom = Math.max(0.15, Math.min(30, previous * factor));
    if (center && previous > 0) {
      const ratio = view.zoom / previous;
      const rect = canvas.getBoundingClientRect();
      const nextPan = zoomPanForGesture({
        panX: view.panX,
        panY: view.panY,
        startPoint: center,
        currentPoint: center,
        viewportCenter: { x: rect.width / 2, y: rect.height / 2 },
        ratio,
      });
      view.panX = nextPan.panX;
      view.panY = nextPan.panY;
    }
    notify();
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  canvas?.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.12 : 0.89, point(event));
  }, { passive: false });

  canvas?.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    const current = point(event);
    pointers.set(event.pointerId, current);
    canvas.classList.add('is-dragging');
    if (pointers.size === 1) {
      dragStart = { point: current, panX: view.panX, panY: view.panY };
      const width = canvas.getBoundingClientRect().width;
      if (current.x <= 18) edgeStart = { side: 'left', x: current.x };
      else if (current.x >= width - 18) edgeStart = { side: 'right', x: current.x };
      else edgeStart = null;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = {
        distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        zoom: view.zoom,
        panX: view.panX,
        panY: view.panY,
      };
    }
  });

  canvas?.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    const current = point(event);
    pointers.set(event.pointerId, current);
    if (pointers.size >= 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      view.zoom = Math.max(0.15, Math.min(30, pinchStart.zoom * distance / pinchStart.distance));
      const rect = canvas.getBoundingClientRect();
      const nextPan = zoomPanForGesture({
        panX: pinchStart.panX,
        panY: pinchStart.panY,
        startPoint: pinchStart.center,
        currentPoint: center,
        viewportCenter: { x: rect.width / 2, y: rect.height / 2 },
        ratio: view.zoom / pinchStart.zoom,
      });
      view.panX = nextPan.panX;
      view.panY = nextPan.panY;
      notify();
      return;
    }
    if (dragStart && state.interactionMode === 'pan') {
      view.panX = dragStart.panX + current.x - dragStart.point.x;
      view.panY = dragStart.panY + current.y - dragStart.point.y;
      notify();
    }
    if (edgeStart) {
      const distance = current.x - edgeStart.x;
      if (edgeStart.side === 'left' && distance > 52) {
        openDrawer('left');
        edgeStart = null;
      } else if (edgeStart.side === 'right' && distance < -52) {
        openDrawer('right');
        edgeStart = null;
      }
    }
  });

  function endPointer(event) {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) {
      canvas?.classList.remove('is-dragging');
      dragStart = null;
      edgeStart = null;
      const now = Date.now();
      if (now - lastTapAt < 320) fit('active');
      lastTapAt = now;
    }
  }

  canvas?.addEventListener('pointerup', endPointer);
  canvas?.addEventListener('pointercancel', endPointer);
  canvas?.addEventListener('dblclick', () => fit('active'));

  function openTabDrawer(tab, side) {
    options.onTabRequested?.(tab);
    openDrawer(side);
  }

  byId('open-tools-drawer')?.addEventListener('click', () => openTabDrawer('preview', 'left'));
  byId('left-edge-handle')?.addEventListener('click', () => openTabDrawer('preview', 'left'));
  byId('close-tools-drawer')?.addEventListener('click', () => dispatch({ type: 'close-left' }));
  byId('open-readiness-drawer')?.addEventListener('click', () => openTabDrawer('preflight', 'right'));
  byId('right-edge-handle')?.addEventListener('click', () => openTabDrawer('preflight', 'right'));
  byId('close-readiness-drawer')?.addEventListener('click', () => dispatch({ type: 'close-right' }));
  scrim?.addEventListener('click', closeDrawers);

  function installDrawerSwipe(drawer, side) {
    let startX = null;
    drawer?.addEventListener('pointerdown', (event) => {
      startX = event.clientX;
    });
    drawer?.addEventListener('pointerup', (event) => {
      if (startX === null) return;
      const distance = event.clientX - startX;
      if ((side === 'left' && distance < -60) || (side === 'right' && distance > 60)) {
        dispatch({ type: side === 'left' ? 'close-left' : 'close-right' });
      }
      startX = null;
    });
    drawer?.addEventListener('pointercancel', () => { startX = null; });
  }

  installDrawerSwipe(leftDrawer, 'left');
  installDrawerSwipe(rightDrawer, 'right');
  byId('toggle-layers')?.addEventListener('click', () => dispatch({ type: 'toggle-bottom' }));
  byId('canvas-mode')?.addEventListener('click', () => dispatch({
    type: 'set-interaction',
    mode: state.interactionMode === 'pan' ? 'select' : 'pan',
  }));
  document.querySelectorAll('[data-fit-view]').forEach((button) => {
    button.addEventListener('click', () => fit(button.dataset.fitView));
  });
  document.querySelectorAll('[data-canvas-zoom]').forEach((button) => {
    button.addEventListener('click', () => zoomBy(button.dataset.canvasZoom === 'in' ? 1.2 : 0.83));
  });
  document.querySelectorAll('[data-canvas-layer]').forEach((input) => {
    input.addEventListener('change', () => dispatch({ type: 'toggle-layer', layer: input.dataset.canvasLayer }));
  });
  window.addEventListener('resize', () => {
    syncMachineBarHeight();
    dispatch({ type: 'resize', width: window.innerWidth });
  });

  syncMachineBarHeight();
  renderState();
  return {
    closeDrawers,
    fit,
    getLayers: () => ({ ...state.layers }),
    getState: () => ({ ...state, layers: { ...state.layers } }),
    getView: () => ({ ...view }),
    openDrawer,
    openForTab,
    zoomBy,
  };
}
