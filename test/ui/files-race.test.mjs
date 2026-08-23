import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

const appSource = await readFile(new URL('../../www/app.js', import.meta.url), 'utf8');

// The rendering harness evaluates the REAL www/app.js source inside a Function
// with stub globals so the DOM/Fetch behaviour is exactly the shipped code.
// Only the top-level dynamic import() calls are neutralised into a parameter;
// everything else (renderFiles, loadFiles, routeFromHash, showView, the nav
// click handler) runs unchanged.

function jobPathFor(gcodePath) {
  const normalized = String(gcodePath || '').replace(/^\/+/, '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const readable = normalized.replace(/[^A-Za-z0-9._-]/g, '_').slice(-72) || 'job';
  return `/jobs/${readable}-${(hash >>> 0).toString(16).padStart(8, '0')}.job.json`;
}

function makeResponse(body, ok = true) {
  const payload = body === null ? null : body;
  return {
    ok,
    status: ok ? 200 : 500,
    async text() { return JSON.stringify(payload); },
    async json() { return payload; },
    clone() { return this; },
  };
}

function createElement(id = '', className = '') {
  const attributes = new Map();
  const listeners = new Map();
  const children = [];
  const node = {
    id,
    className,
    disabled: false,
    hidden: false,
    checked: false,
    value: '',
    textContentValue: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    _type: 'element',
    _listeners: listeners,
    _children: children,
    style: { setProperty() {} },
    get childElementCount() { return node._children.length; },
    get children() { return node._children; },
    append(...nodes) {
      for (const n of nodes) {
        if (n && n._type === 'fragment') node._children.push(...n._children);
        else node._children.push(n);
      }
      node.textContentValue = '';
    },
    prepend() {},
    replaceChildren(...nodes) {
      const flat = [];
      for (const n of nodes) {
        if (n && n._type === 'fragment') flat.push(...n._children);
        else if (n) flat.push(n);
      }
      node._children.length = 0;
      node._children.push(...flat);
      node.textContentValue = '';
    },
    addEventListener(type, listener) {
      const list = listeners.get(type) || [];
      list.push(listener);
      listeners.set(type, list);
    },
    removeEventListener() {},
    _fire(type, event = {}) {
      for (const listener of listeners.get(type) || []) {
        listener({ currentTarget: node, target: node, preventDefault() {}, shiftKey: false, ...event });
      }
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
        node.dataset[key] = String(value);
      }
    },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    matches(selector) {
      return selector.split(',').some((part) => {
        const item = part.trim();
        if (item.startsWith('#')) return node.id === item.slice(1);
        if (item.startsWith('.')) return (node.className || '').split(/\s+/).includes(item.slice(1));
        const dataMatch = item.match(/^\[([a-z0-9-]+)\]$/i);
        return dataMatch ? attributes.has(dataMatch[1]) : false;
      });
    },
    closest(selector) { return node.matches(selector) ? node : null; },
    querySelector() { return createElement('query-result'); },
    querySelectorAll(selector) {
      return node._children.filter((child) => child.matches && child.matches(selector));
    },
    getBoundingClientRect() {
      return { height: 48, width: 300, top: 0, bottom: 48, left: 0, right: 300 };
    },
  };
  // textContent setter mirrors the DOM: assigning text clears child elements.
  Object.defineProperty(node, 'textContent', {
    get() { return node.textContentValue; },
    set(value) {
      node.textContentValue = String(value);
      node._children.length = 0;
    },
  });
  node.classList = {
    add(name) {
      if (!(node.className || '').split(/\s+/).includes(name)) node.className = `${node.className || ''} ${name}`.trim();
    },
    remove(name) {
      node.className = (node.className || '').split(/\s+/).filter((v) => v !== name).join(' ');
    },
    toggle(name, force) {
      const enabled = force ?? !(node.className || '').split(/\s+/).includes(name);
      if (enabled) node.classList.add(name);
      else node.classList.remove(name);
    },
  };
  return node;
}

function createFilesEnv(options = {}) {
  const elements = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const calls = [];
  const pending = [];

  const ensure = (id, className = '') => {
    if (!elements.has(id)) elements.set(id, createElement(id, className));
    return elements.get(id);
  };

  const elementIds = [
    'launcher-list', 'refresh-files', 'upload-form', 'upload-file', 'upload-preview', 'upload-submit',
    'sd-status', 'health', 'page-title', 'current-job-card', 'next-action-card', 'system-summary',
    'marlin-log', 'critical-log', 'refresh-logs', 'travel-speed', 'travel-speed-number',
    'travel-speed-status', 'machine-info-summary', 'refresh-machine-info', 'machine-config-result',
    'device-info-summary', 'device-id-badge', 'device-settings-result', 'device-friendly-name',
    'device-hostname', 'device-url-preview', 'save-device-settings', 'restart-device',
    'thumbnail-view-mode', 'thumbnail-view-status', 'clear-current-job',
  ];
  elementIds.forEach((id) => ensure(id));

  const storage = new Map(Object.entries(options.storage || {}));
  const localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };

  const document = {
    readyState: 'complete',
    documentElement: { style: { setProperty() {} } },
    body: { prepend() {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } },
    createElement(tag) { return createElement(`${tag}-${Math.random().toString(36).slice(2)}`); },
    createDocumentFragment() {
      return { _type: 'fragment', _children: [], append(...nodes) { this._children.push(...nodes); } };
    },
    getElementById: ensure,
    querySelector(selector) {
      if (selector.startsWith('#')) return ensure(selector.slice(1));
      return ensure(`query-${selector}`);
    },
    querySelectorAll(selector) {
      return [...elements.values()].filter((node) => node.matches(selector));
    },
    addEventListener(type, listener) {
      const list = documentListeners.get(type) || [];
      list.push(listener);
      documentListeners.set(type, list);
    },
    removeEventListener() {},
    _fire(type, event = {}) {
      for (const listener of documentListeners.get(type) || []) listener(event);
    },
  };
  // createDocumentFragment must return a fresh node each time (not id-keyed).
  document.createElement = (tag) => createElement(`${tag}-${calls.length}-${Math.random().toString(36).slice(2)}`);

  const location = { href: options.href || '', hash: options.hash || '' };
  const historyReplace = vi.fn();
  const window = {
    location,
    history: { replaceState: historyReplace },
    CncTelemetry: undefined,
    LowRiderMachineBar: undefined,
    addEventListener(type, listener) {
      const list = windowListeners.get(type) || [];
      list.push(listener);
      windowListeners.set(type, list);
    },
    removeEventListener() {},
    dispatchEvent() {},
  };

  const moduleStubs = {
    '/lib/motion-settings.js': {
      loadMotionSettings: () => ({ travelSpeedMmS: 3000 }),
      travelSpeedUpperLimit: () => 100,
      normalizeTravelSpeed: () => 50,
    },
    '/lib/machine-config.js': {},
    '/lib/device-settings.js': {},
    '/lib/upload-thumbnail.js': { thumbnailPathFor: (name) => `/thumb/${name}` },
    '/lib/tool-change-settings.js': {},
    '/lib/thumbnail-settings.js': {
      loadThumbnailViewMode: () => 'grid',
      saveThumbnailViewMode: (v) => v,
    },
    '/lib/toolpath-model.js': {},
    '/lib/job-active-run.js': {},
    '/lib/job-readiness.js': {
      buildJobReadiness: () => ({
        primaryAction: { id: 'choose_file', target: 'files', label: 'Choose G-code File' },
        blockingReasons: [],
      }),
    },
  };
  const __dynamicImport = (url) => Promise.resolve(moduleStubs[url] || {});

  const fetchImpl = async (url) => {
    calls.push(String(url));
    return new Promise((resolve) => {
      pending.push({ url: String(url), resolve });
    });
  };

  const appCode = appSource.replace(/\bimport\s*\(/g, '__dynamicImport(');
  const setup = new Function(
    'window', 'document', 'localStorage', 'fetch', '__dynamicImport',
    'CustomEvent', 'dispatchEvent', 'history', 'alert', 'confirm', 'prompt',
    `${appCode}
    ; return {
      init,
      loadFiles,
      ensureFilesViewData,
      showView,
      __test: {
        filesLoadedPath: () => (typeof filesLoadedPath !== 'undefined' ? filesLoadedPath : ''),
        resetFilesState() {
          if (typeof filesInFlight !== 'undefined') filesInFlight = null;
          if (typeof filesLoadedPath !== 'undefined') filesLoadedPath = '';
          if (typeof launcherList !== 'undefined') launcherList.textContent = '';
        },
      },
    };`,
  );
  const api = setup(
    window, document, localStorage, fetchImpl, __dynamicImport,
    class FakeCustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    () => {}, { replaceState: historyReplace },
    () => true, () => true, () => '',
  );

  const flush = async (times = 40) => {
    for (let i = 0; i < times; i += 1) await Promise.resolve();
  };

  const resolveUrl = async (url, body, ok = true) => {
    const matches = pending.filter((d) => d.url === url);
    const count = matches.length;
    for (const d of matches) d.resolve(makeResponse(body, ok));
    if (count) await flush();
    return count;
  };

  const resolveWhere = async (predicate, body, ok = true) => {
    const matches = pending.filter((d) => predicate(d.url));
    const count = matches.length;
    for (const d of matches) d.resolve(makeResponse(body, ok));
    if (count) await flush();
    return count;
  };

  // Resolve every pending /api/download response so fileMetadataFor settles.
  // A matching jobPath returns real metadata; unknown (thumbnail) paths 404 so
  // the guard falls through and no further fetch is spawned.
  const resolveDownloads = async (allItems) => {
    const byJobPath = new Map(allItems.map((item) => [jobPathFor(item.path), item]));
    for (let pass = 0; pass < 8; pass += 1) {
      const downloads = pending.filter((d) => d.url.startsWith('/api/download?path='));
      if (!downloads.length) break;
      for (const d of downloads) {
        const raw = d.url.split('?')[1] || '';
        const path = decodeURIComponent(raw.replace(/^path=/, ''));
        const item = byJobPath.get(path);
        if (item) {
          d.resolve(makeResponse({
            sourceGcodePath: item.path,
            preview: { warnings: item._warnings || [], estimate: { nominalSeconds: 120 } },
          }, true));
        } else {
          d.resolve(makeResponse({}, false));
        }
      }
      await flush();
    }
  };

  const setHash = (hash) => {
    window.location.hash = hash;
    for (const listener of windowListeners.get('hashchange') || []) listener();
  };

  return {
    api,
    launcherList: ensure('launcher-list'),
    refreshButton: ensure('refresh-files'),
    document,
    window,
    location,
    historyReplace,
    calls,
    pending,
    flush,
    resolveUrl,
    resolveWhere,
    resolveDownloads,
    setHash,
    fireDocumentClick(event) {
      for (const listener of documentListeners.get('click') || []) listener({
        preventDefault() {}, shiftKey: false, ...event,
      });
    },
    countCalls(predicate) { return calls.filter((u) => predicate(u)).length; },
  };
}

const fileItem = (name, extra = {}) => ({
  name, path: `/gcode/${name}`, type: 'file', size: 2048, ...extra,
});
const dirItem = (name) => ({ name, path: `/gcode/${name}`, type: 'dir' });
const atItem = (path, name, extra = {}) => ({
  name, path, type: 'file', size: 2048, ...extra,
});

describe('Files list render races', () => {
  it('1. two overlapping loads for /gcode can never produce duplicate cards', async () => {
    const env = createFilesEnv();
    // Boot settles the first Files render.
    await env.flush();
    await env.resolveUrl('/api/files?path=%2Fgcode', { items: [fileItem('ex1.gcode'), fileItem('ex2.gcode')] });
    await env.resolveWhere((u) => u === '/api/sd/status', { mounted: true, cardType: 'SD', freeBytes: 1048576 });
    await env.resolveDownloads([fileItem('ex1.gcode'), fileItem('ex2.gcode')]);
    await env.flush();
    expect(env.launcherList.children.length).toBe(2);

    // Trigger two concurrent, un-awaited reloads of /gcode.
    const p1 = env.api.loadFiles('/gcode');
    const p2 = env.api.loadFiles('/gcode');
    await env.flush();

    // One deduplicated request should be outstanding.
    await env.resolveUrl('/api/files?path=%2Fgcode', { items: [fileItem('ex1.gcode'), fileItem('ex2.gcode')] });
    await env.resolveWhere((u) => u === '/api/sd/status', { mounted: true, cardType: 'SD', freeBytes: 1024 });
    await env.resolveDownloads([fileItem('ex1.gcode'), fileItem('ex2.gcode')]);
    await env.flush();
    await Promise.all([p1, p2]);

    const cards = env.launcherList.children;
    const countFor = (p) => cards.filter((c) => c.dataset.path === p).length;
    expect(countFor('/gcode/ex1.gcode')).toBe(1);
    expect(countFor('/gcode/ex2.gcode')).toBe(1);
    expect(cards.length).toBe(2);
  });

  it('2. an older slower load completing after a newer load can not overwrite or append', async () => {
    const env = createFilesEnv();
    await env.flush();
    // Boot loads /gcode (already populated). Start a slow /gcode reload.
    const slow = env.api.loadFiles('/gcode');
    await env.flush();
    // Start a fast /gcode/sub load while /gcode is still pending.
    const fast = env.api.loadFiles('/gcode/sub');
    await env.flush();

    // Let the newer /gcode/sub load finish first.
    await env.resolveUrl('/api/files?path=%2Fgcode%2Fsub', {
      items: [atItem('/gcode/sub/sub1.gcode', 'sub1.gcode'), atItem('/gcode/sub/sub2.gcode', 'sub2.gcode')],
    });
    await env.resolveWhere((u) => u === '/api/sd/status', { mounted: true, cardType: 'SD', freeBytes: 1048576 });
    await env.resolveDownloads([atItem('/gcode/sub/sub1.gcode', 'sub1.gcode'), atItem('/gcode/sub/sub2.gcode', 'sub2.gcode')]);
    await env.flush();

    expect(env.api.__test.filesLoadedPath()).toBe('/gcode/sub');
    const cardsAfterFast = env.launcherList.children;
    expect(cardsAfterFast.map((c) => c.dataset.path)).toEqual([
      '/gcode/sub/sub1.gcode', '/gcode/sub/sub2.gcode',
    ]);

    // NOW the old slow /gcode load completes. It must be stale and do nothing.
    await env.resolveUrl('/api/files?path=%2Fgcode', {
      items: [fileItem('stale1.gcode'), fileItem('stale2.gcode'), fileItem('stale3.gcode')],
    });
    await env.resolveWhere((u) => u === '/api/sd/status', { mounted: true, cardType: 'SD', freeBytes: 1 });
    await env.resolveDownloads([
      fileItem('stale1.gcode'), fileItem('stale2.gcode'), fileItem('stale3.gcode'),
    ]);
    await env.flush();
    await Promise.all([slow, fast]);

    expect(env.api.__test.filesLoadedPath()).toBe('/gcode/sub');
    expect(env.launcherList.children.map((c) => c.dataset.path)).toEqual([
      '/gcode/sub/sub1.gcode', '/gcode/sub/sub2.gcode',
    ]);

    // Re-activating the newer path must not re-fetch (data already loaded).
    const subFilesBefore = env.countCalls((u) => u === '/api/files?path=%2Fgcode%2Fsub');
    await env.api.ensureFilesViewData('/gcode/sub');
    await env.flush();
    expect(env.countCalls((u) => u === '/api/files?path=%2Fgcode%2Fsub')).toBe(subFilesBefore);
  });

  it('3. each unique item.path renders at most one card', async () => {
    const env = createFilesEnv();
    await env.flush();
    const dup = fileItem('ex1.gcode');
    await env.resolveUrl('/api/files?path=%2Fgcode', {
      items: [dup, { ...dup }, dirItem('sub'), dirItem('sub')],
    });
    await env.resolveWhere((u) => u === '/api/sd/status', { mounted: true, cardType: 'SD', freeBytes: 1048576 });
    await env.resolveDownloads([dup, dirItem('sub')]);
    await env.flush();

    const cards = env.launcherList.children;
    const countFor = (p) => cards.filter((c) => c.dataset.path === p).length;
    expect(countFor('/gcode/ex1.gcode')).toBe(1);
    expect(countFor('/gcode/sub')).toBe(1);
    expect(cards.length).toBe(2);
  });

  it('4. switching to Files twice rapidly still yields one card per file and one request', async () => {
    const env = createFilesEnv();
    await env.flush();
    // Make sure Files is not already loaded so the double activation must load.
    env.api.__test.resetFilesState();

    const reqsBefore = env.countCalls((u) => u.startsWith('/api/files?path='));
    env.api.showView('files');
    env.api.showView('files');
    await env.flush();

    await env.resolveUrl('/api/files?path=%2Fgcode', { items: [fileItem('ex1.gcode')] });
    await env.resolveWhere((u) => u === '/api/sd/status', { mounted: true, cardType: 'SD', freeBytes: 1048576 });
    await env.resolveDownloads([fileItem('ex1.gcode')]);
    await env.flush();

    const cards = env.launcherList.children;
    const countFor = (p) => cards.filter((c) => c.dataset.path === p).length;
    expect(countFor('/gcode/ex1.gcode')).toBe(1);
    expect(cards.length).toBe(1);
    // Two rapid activations share a single request.
    expect(env.countCalls((u) => u.startsWith('/api/files?path=')) - reqsBefore).toBe(1);
  });

  it('5. metadata arriving in arbitrary order does not alter correctness', async () => {
    const env = createFilesEnv();
    await env.flush();
    const items = [
      fileItem('ex1.gcode'),   // no warnings
      fileItem('ex2.gcode', { _warnings: [{ message: 'high Z' }] }), // one warning -> badge
      fileItem('ex3.gcode'),   // no warnings
    ];
    await env.resolveUrl('/api/files?path=%2Fgcode', { items });
    await env.resolveWhere((u) => u === '/api/sd/status', { mounted: true, cardType: 'SD', freeBytes: 1048576 });

    // Resolve the per-file metadata deferreds in REVERSE order.
    const downloads = env.pending.filter((d) => d.url.startsWith('/api/download?path='));
    expect(downloads.length).toBe(3);
    const urlOf = (p) => `/api/download?path=${encodeURIComponent(jobPathFor(p))}`;
    for (const item of [...items].reverse()) {
      const d = downloads.find((dd) => dd.url === urlOf(item.path));
      if (d) d.resolve(makeResponse({
        sourceGcodePath: item.path,
        preview: { warnings: item._warnings || [], estimate: { nominalSeconds: 120 } },
      }, true));
      await env.flush();
    }
    await env.flush();

    const cards = env.launcherList.children;
    expect(cards.map((c) => c.dataset.path)).toEqual(items.map((i) => i.path));
    items.forEach((item, idx) => {
      expect(cards.filter((c) => c.dataset.path === item.path).length).toBe(1);
    });
    // Badges stay index-aligned: only ex2 shows a warning badge.
    const byPath = new Map(cards.map((c) => [c.dataset.path, c]));
    expect(byPath.get('/gcode/ex2.gcode').innerHTML).toContain('1 need attention');
    expect(byPath.get('/gcode/ex1.gcode').innerHTML).not.toContain('need attention');
  });

  it('6. Files -> Job -> Files keeps one card per file and avoids a re-fetch', async () => {
    const env = createFilesEnv();
    await env.flush();
    await env.resolveUrl('/api/files?path=%2Fgcode', {
      items: [fileItem('ex1.gcode'), fileItem('ex2.gcode')],
    });
    await env.resolveWhere((u) => u === '/api/sd/status', { mounted: true, cardType: 'SD', freeBytes: 1048576 });
    await env.resolveDownloads([fileItem('ex1.gcode'), fileItem('ex2.gcode')]);
    await env.flush();

    const filesAfterBoot = env.countCalls((u) => u === '/api/files?path=%2Fgcode');
    expect(filesAfterBoot).toBe(1);
    expect(env.launcherList.children.length).toBe(2);

    // Go to Job (no current job -> renders the empty Job view, no fetch).
    env.api.showView('job');
    await env.flush();

    // Back to Files: data is already loaded so no re-fetch occurs.
    env.api.showView('files');
    await env.flush();

    const countFor = (p) => env.launcherList.children.filter((c) => c.dataset.path === p).length;
    expect(countFor('/gcode/ex1.gcode')).toBe(1);
    expect(countFor('/gcode/ex2.gcode')).toBe(1);
    expect(env.launcherList.children.length).toBe(2);
    expect(env.countCalls((u) => u === '/api/files?path=%2Fgcode')).toBe(filesAfterBoot);
  });

  it('7. navigation click + hashchange does not start two independent file renders', async () => {
    const env = createFilesEnv();
    await env.flush();
    env.api.__test.resetFilesState(); // Files not loaded yet
    env.location.hash = '#job';

    const anchor = {
      href: '#files',
      dataset: { navTarget: 'files', actionView: '' },
      getAttribute(name) {
        if (name === 'href') return '#files';
        if (name === 'data-nav-target') return 'files';
        return null;
      },
      closest(sel) { return sel === '[data-nav-target], [data-action-view]' ? anchor : null; },
    };
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    anchor;

    const filesReq = (u) => u === '/api/files?path=%2Fgcode';
    const beforeClick = env.countCalls(filesReq);

    // The click ALONE must not start a file render (router owns hash links).
    env.fireDocumentClick({ target: anchor, currentTarget: anchor });
    await env.flush();
    expect(env.countCalls(filesReq)).toBe(beforeClick);

    // Browser updates hash + fires hashchange -> single render.
    env.setHash('#files');
    await env.flush();
    await env.resolveUrl('/api/files?path=%2Fgcode', { items: [fileItem('ex1.gcode')] });
    await env.resolveWhere((u) => u === '/api/sd/status', { mounted: true, cardType: 'SD', freeBytes: 1048576 });
    await env.resolveDownloads([fileItem('ex1.gcode')]);
    await env.flush();

    const countFor = (p) => env.launcherList.children.filter((c) => c.dataset.path === p).length;
    expect(env.countCalls(filesReq)).toBe(beforeClick + 1);
    expect(countFor('/gcode/ex1.gcode')).toBe(1);
    expect(env.launcherList.children.length).toBe(1);

    // Re-click when already on #files must still call showView so an error
    // state can be retried: a failed load clears filesLoadedPath, and the
    // re-click reloads instead of being swallowed.
    await env.flush();
    env.api.__test.resetFilesState();
    const failed = env.api.loadFiles('/gcode');
    await env.flush();
    await env.resolveUrl('/api/files?path=%2Fgcode', { items: [] }, false);
    await Promise.allSettled([failed]);
    await env.flush();
    expect(env.launcherList.textContent).not.toBe('');

    const beforeRetry = env.countCalls(filesReq);
    env.fireDocumentClick({ target: anchor, currentTarget: anchor });
    await env.flush();
    await env.resolveUrl('/api/files?path=%2Fgcode', { items: [fileItem('ex1.gcode')] });
    await env.resolveWhere((u) => u === '/api/sd/status', { mounted: true, cardType: 'SD', freeBytes: 1048576 });
    await env.resolveDownloads([fileItem('ex1.gcode')]);
    await env.flush();
    expect(env.countCalls(filesReq)).toBe(beforeRetry + 1);
    expect(env.launcherList.children.length).toBe(1);
  });

  it('8. refresh still reloads data normally (replaceChildren actually replaces)', async () => {
    const env = createFilesEnv();
    await env.flush();
    await env.resolveUrl('/api/files?path=%2Fgcode', {
      items: [fileItem('old1.gcode'), fileItem('old2.gcode')],
    });
    await env.resolveWhere((u) => u === '/api/sd/status', { mounted: true, cardType: 'SD', freeBytes: 1048576 });
    await env.resolveDownloads([fileItem('old1.gcode'), fileItem('old2.gcode')]);
    await env.flush();
    expect(env.launcherList.children.length).toBe(2);

    // Backend contents change; refresh via the refresh button.
    env.refreshButton._fire('click');
    await env.flush();
    await env.resolveUrl('/api/files?path=%2Fgcode', {
      items: [fileItem('new1.gcode'), fileItem('old2.gcode')],
    });
    await env.resolveWhere((u) => u === '/api/sd/status', { mounted: true, cardType: 'SD', freeBytes: 1048576 });
    await env.resolveDownloads([fileItem('new1.gcode'), fileItem('old2.gcode')]);
    await env.flush();

    const cards = env.launcherList.children;
    const countFor = (p) => cards.filter((c) => c.dataset.path === p).length;
    expect(countFor('/gcode/new1.gcode')).toBe(1);
    expect(countFor('/gcode/old2.gcode')).toBe(1);
    expect(countFor('/gcode/old1.gcode')).toBe(0);
    expect(cards.length).toBe(2);
  });

  it('9. directory navigation remains correct, including while another load is in flight', async () => {
    const env = createFilesEnv();
    await env.flush();
    await env.resolveUrl('/api/files?path=%2Fgcode', {
      items: [dirItem('sub'), fileItem('ex1.gcode')],
    });
    await env.resolveWhere((u) => u === '/api/sd/status', { mounted: true, cardType: 'SD', freeBytes: 1048576 });
    await env.resolveDownloads([dirItem('sub'), fileItem('ex1.gcode')]);
    await env.flush();

    const subRow = env.launcherList.children.find((c) => c.dataset.path === '/gcode/sub');
    expect(subRow).toBeTruthy();
    const filesReq = (u) => u.startsWith('/api/files?path=');
    const beforeClick = env.countCalls(filesReq);

    // Plain click on the dir row navigates into it.
    subRow._fire('click', { target: subRow, shiftKey: false });
    await env.flush();
    expect(env.calls.includes('/api/files?path=%2Fgcode%2Fsub')).toBe(true);

    await env.resolveUrl('/api/files?path=%2Fgcode%2Fsub', {
      items: [atItem('/gcode/sub/sub1.gcode', 'sub1.gcode')],
    });
    await env.resolveWhere((u) => u === '/api/sd/status', { mounted: true, cardType: 'SD', freeBytes: 1048576 });
    await env.resolveDownloads([atItem('/gcode/sub/sub1.gcode', 'sub1.gcode')]);
    await env.flush();

    expect(env.launcherList.children.map((c) => c.dataset.path)).toEqual(['/gcode/sub/sub1.gcode']);
    expect(env.countCalls(filesReq)).toBe(beforeClick + 1);

    // Folder-navigate while a slower /gcode reload is still in flight: the
    // stale /gcode reply must not leak rows into the sub view.
    const slow = env.api.loadFiles('/gcode');
    await env.flush();
    const beforeSubFetch = env.countCalls((u) => u === '/api/files?path=%2Fgcode%2Fsub');
    env.api.loadFiles('/gcode/sub');
    await env.flush();
    await env.resolveUrl('/api/files?path=%2Fgcode%2Fsub', {
      items: [atItem('/gcode/sub/sub1.gcode', 'sub1.gcode'), atItem('/gcode/sub/sub2.gcode', 'sub2.gcode')],
    });
    await env.resolveWhere((u) => u === '/api/sd/status', { mounted: true, cardType: 'SD', freeBytes: 1048576 });
    await env.resolveDownloads([
      atItem('/gcode/sub/sub1.gcode', 'sub1.gcode'),
      atItem('/gcode/sub/sub2.gcode', 'sub2.gcode'),
    ]);
    await env.flush();

    // Stale /gcode finishes now and must be ignored.
    await env.resolveUrl('/api/files?path=%2Fgcode', { items: [fileItem('zombie.gcode')] });
    await env.resolveWhere((u) => u === '/api/sd/status', { mounted: true, cardType: 'SD', freeBytes: 1 });
    await env.resolveDownloads([fileItem('zombie.gcode')]);
    await env.flush();
    await Promise.allSettled([slow]);

    const finalPaths = env.launcherList.children.map((c) => c.dataset.path);
    expect(finalPaths).toEqual(['/gcode/sub/sub1.gcode', '/gcode/sub/sub2.gcode']);
    expect(finalPaths.filter((p) => p.includes('zombie'))).toEqual([]);
  });
});