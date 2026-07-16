export const THUMBNAIL_VIEW_STORAGE_KEY = 'lowrider.thumbnail.view-mode.v1';

export function normalizeThumbnailViewMode(mode) {
  return mode === '3d' ? '3d' : '2d';
}

export function loadThumbnailViewMode(storage = globalThis.localStorage) {
  try {
    return normalizeThumbnailViewMode(storage?.getItem(THUMBNAIL_VIEW_STORAGE_KEY));
  } catch (_) {
    return '2d';
  }
}

export function saveThumbnailViewMode(mode, storage = globalThis.localStorage) {
  const normalized = normalizeThumbnailViewMode(mode);
  try {
    storage?.setItem(THUMBNAIL_VIEW_STORAGE_KEY, normalized);
  } catch (_) {
    // Storage can be unavailable; keep using the selected value for this page load.
  }
  return normalized;
}
