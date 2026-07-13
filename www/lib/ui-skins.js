export const DEFAULT_SKIN_ID = 'default';
export const SKIN_STORAGE_KEY = 'lowrider.uiSkin';
export const KNOWN_SKINS = Object.freeze([
  { id: 'default', name: 'Default' },
  { id: 'freecad-like', name: 'FreeCAD-like' },
  { id: 'high-contrast', name: 'High Contrast' },
]);

export const REQUIRED_ICON_ROLES = Object.freeze([
  'menu', 'placement', 'rotate', 'origin', 'zero', 'workZero', 'zZero', 'fitJob', 'fitTable',
  'fitWorkArea', 'pan', 'zoomIn', 'zoomOut', 'source', 'generated', 'bounds', 'dryRun', 'arm',
  'start', 'pause', 'stop', 'm5', 'warning', 'ok', 'blocked', 'files', 'settings', 'terminal', 'log',
]);

const BUILTIN_ICONS = Object.fromEntries(REQUIRED_ICON_ROLES.map((role) => [
  role,
  `icon-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
]));

export const BUILTIN_DEFAULT_MANIFEST = Object.freeze({
  id: DEFAULT_SKIN_ID,
  name: 'Default',
  description: 'Built-in fallback for the CNC-ESP32 UI.',
  version: '1.0.0',
  author: 'CNC-ESP32 project',
  license: 'MIT',
  icons: Object.freeze(BUILTIN_ICONS),
  colors: Object.freeze({}),
  touch: Object.freeze({ buttonSize: 44, largeButtonSize: 56, iconStrokeWidth: 2 }),
});

function safeSkinId(value) {
  const id = String(value || '').trim();
  return /^[a-z0-9][a-z0-9-]*$/.test(id) ? id : DEFAULT_SKIN_ID;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
}

export function skinAssetPath(skinId, fileName) {
  return `/skins/${safeSkinId(skinId)}/${fileName}`;
}

export function validateSkinManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') return { ok: false, errors: ['Manifest must be an object.'] };
  if (safeSkinId(manifest.id) !== manifest.id) errors.push('Skin id must contain lowercase letters, numbers, or hyphens.');
  ['name', 'description', 'version', 'author', 'license'].forEach((field) => {
    if (!String(manifest[field] || '').trim()) errors.push(`Missing ${field}.`);
  });
  if (!manifest.icons || typeof manifest.icons !== 'object') errors.push('Missing icons map.');
  REQUIRED_ICON_ROLES.forEach((role) => {
    if (!String(manifest.icons?.[role] || '').trim()) errors.push(`Missing icon role: ${role}.`);
  });
  if (!manifest.colors || typeof manifest.colors !== 'object') errors.push('Missing colors map.');
  if (!manifest.touch || !Number.isFinite(Number(manifest.touch.buttonSize))) errors.push('Missing touch.buttonSize.');
  return { ok: errors.length === 0, errors };
}

export function resolveIconRole(role, activeManifest, defaultManifest = BUILTIN_DEFAULT_MANIFEST) {
  const activeId = safeSkinId(activeManifest?.id);
  const activeSymbol = activeManifest?.icons?.[role];
  if (activeSymbol) return { skinId: activeId, symbolId: activeSymbol, fallback: false };
  const fallbackSymbol = defaultManifest?.icons?.[role] || BUILTIN_DEFAULT_MANIFEST.icons[role] || BUILTIN_DEFAULT_MANIFEST.icons.warning;
  return {
    skinId: safeSkinId(defaultManifest?.id || DEFAULT_SKIN_ID),
    symbolId: fallbackSymbol,
    fallback: true,
  };
}

export function iconMarkup(role, options = {}, activeManifest, defaultManifest) {
  const resolved = resolveIconRole(role, activeManifest, defaultManifest);
  const label = String(options.label || '').trim();
  const accessibility = label
    ? `role="img" aria-label="${escapeHtml(label)}"`
    : 'aria-hidden="true" focusable="false"';
  return `<svg class="cnc-icon" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" ${accessibility}><use href="${skinAssetPath(resolved.skinId, 'icons.svg')}#${escapeHtml(resolved.symbolId)}"></use></svg>`;
}

async function fetchManifest(id, fetcher) {
  const response = await fetcher(skinAssetPath(id, 'skin.json'));
  if (!response?.ok) throw new Error(`Skin manifest ${id} returned HTTP ${response?.status || 'error'}.`);
  const manifest = await response.json();
  const validation = validateSkinManifest(manifest);
  if (!validation.ok) throw new Error(`Invalid ${id} skin: ${validation.errors.join(' ')}`);
  return manifest;
}

export async function loadSkinManifests(selectedId, options = {}) {
  const fetcher = options.fetcher || globalThis.fetch;
  const warnings = [];
  let defaultManifest = BUILTIN_DEFAULT_MANIFEST;
  try {
    defaultManifest = await fetchManifest(DEFAULT_SKIN_ID, fetcher);
  } catch (error) {
    warnings.push(`Default skin manifest unavailable; using built-in fallback. ${error.message}`);
  }

  const requestedId = safeSkinId(selectedId);
  if (requestedId === DEFAULT_SKIN_ID) {
    return { selectedId: DEFAULT_SKIN_ID, activeManifest: defaultManifest, defaultManifest, warnings };
  }
  try {
    const activeManifest = await fetchManifest(requestedId, fetcher);
    return { selectedId: requestedId, activeManifest, defaultManifest, warnings };
  } catch (error) {
    warnings.push(`Skin ${requestedId} unavailable; using Default. ${error.message}`);
    return { selectedId: DEFAULT_SKIN_ID, activeManifest: defaultManifest, defaultManifest, warnings };
  }
}

export function readSelectedSkin(storage = globalThis.localStorage) {
  try {
    return safeSkinId(storage?.getItem(SKIN_STORAGE_KEY) || DEFAULT_SKIN_ID);
  } catch {
    return DEFAULT_SKIN_ID;
  }
}

export function saveSelectedSkin(skinId, storage = globalThis.localStorage) {
  const id = safeSkinId(skinId);
  try {
    storage?.setItem(SKIN_STORAGE_KEY, id);
  } catch {
    // Storage is optional; the active skin still works for this page load.
  }
  return id;
}

export function applyIconRoles(root, activeManifest, defaultManifest) {
  if (!root?.querySelectorAll) return 0;
  let count = 0;
  const elements = [
    ...(root.matches?.('[data-icon]') ? [root] : []),
    ...root.querySelectorAll('[data-icon]'),
  ];
  elements.forEach((element) => {
    const role = element.dataset.icon;
    let slot = element.querySelector(':scope > .cnc-icon-slot');
    if (!slot) {
      slot = element.ownerDocument.createElement('span');
      slot.className = 'cnc-icon-slot';
      slot.setAttribute('aria-hidden', 'true');
      element.prepend(slot);
    }
    const markup = iconMarkup(role, {}, activeManifest, defaultManifest);
    if (slot.innerHTML !== markup) {
      slot.innerHTML = markup;
      count += 1;
    }
  });
  return count;
}

export async function initializeSkinSystem(options = {}) {
  const root = options.root || globalThis.document;
  const storage = options.storage || globalThis.localStorage;
  const fetcher = options.fetcher || globalThis.fetch;
  const onWarning = options.onWarning || (() => {});
  let loaded = null;

  async function attachTheme(skinId) {
    if (!root?.head) return true;
    let link = root.getElementById('cnc-skin-theme');
    if (!link) {
      link = root.createElement('link');
      link.id = 'cnc-skin-theme';
      link.rel = 'stylesheet';
      root.head.append(link);
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        link.onload = null;
        link.onerror = null;
        resolve(ok);
      };
      link.onload = () => finish(true);
      link.onerror = () => finish(false);
      link.href = skinAssetPath(skinId, 'theme.css');
      setTimeout(() => finish(Boolean(link.sheet)), 1200);
    });
  }

  async function apply(skinId) {
    loaded = await loadSkinManifests(skinId, { fetcher });
    for (const warning of loaded.warnings) onWarning(warning);
    const active = loaded.activeManifest;

    try {
      const iconResponse = await fetcher(skinAssetPath(active.id, 'icons.svg'));
      if (!iconResponse?.ok) throw new Error(`HTTP ${iconResponse?.status || 'error'}`);
      await iconResponse.text();
    } catch (error) {
      if (active.id !== DEFAULT_SKIN_ID) {
        onWarning(`Icons for ${active.name} unavailable; using Default.`);
        loaded = await loadSkinManifests(DEFAULT_SKIN_ID, { fetcher });
      }
    }

    let finalManifest = loaded.activeManifest;
    const themeLoaded = await attachTheme(finalManifest.id);
    if (!themeLoaded && finalManifest.id !== DEFAULT_SKIN_ID) {
      onWarning(`Theme for ${finalManifest.name} unavailable; using Default.`);
      loaded = await loadSkinManifests(DEFAULT_SKIN_ID, { fetcher });
      finalManifest = loaded.activeManifest;
      await attachTheme(DEFAULT_SKIN_ID);
    }
    if (root?.documentElement) root.documentElement.dataset.skin = finalManifest.id;
    saveSelectedSkin(finalManifest.id, storage);
    applyIconRoles(root, finalManifest, loaded.defaultManifest);
    return finalManifest;
  }

  await apply(readSelectedSkin(storage));
  return {
    apply,
    applyIcons: (target = root) => applyIconRoles(target, loaded.activeManifest, loaded.defaultManifest),
    get activeManifest() { return loaded.activeManifest; },
    get defaultManifest() { return loaded.defaultManifest; },
    icon: (role, iconOptions = {}) => iconMarkup(role, iconOptions, loaded.activeManifest, loaded.defaultManifest),
  };
}
