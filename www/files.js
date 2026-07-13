const statusEl = document.querySelector('#sd-status');
const pathInput = document.querySelector('#current-path');
const listEl = document.querySelector('#file-list');
const refreshButton = document.querySelector('#refresh');
const uploadForm = document.querySelector('#upload-form');
const uploadFile = document.querySelector('#upload-file');
const overwriteUpload = document.querySelector('#overwrite-upload');
const uploadSubmit = document.querySelector('#upload-submit');
const uploadThumbnailPreview = document.querySelector('#upload-thumbnail-preview');
const uploadThumbnailCanvas = document.querySelector('#upload-thumbnail-canvas');
const uploadThumbnailStatus = document.querySelector('#upload-thumbnail-status');
const mkdirForm = document.querySelector('#mkdir-form');
const folderName = document.querySelector('#folder-name');
const pathPicker = document.querySelector('#path-picker');
const pathTree = document.querySelector('#path-tree');
const closePathPicker = document.querySelector('#close-path-picker');

let currentPath = '/gcode';
let activeItemPath = '';
let fileMetaByPath = new Map();
const allowedRoots = ['/gcode', '/www', '/firmware', '/jobs', '/logs'];
const currentJobKey = 'lowrider.currentJob';
const LONG_PRESS_MS = 450;
const thumbnailModulesPromise = Promise.all([
  import('/lib/toolpath-model.js'),
  import('/lib/upload-thumbnail.js'),
]);
let selectedThumbnail = null;
let thumbnailGeneration = 0;

function parentPath(path) {
  const index = path.lastIndexOf('/');
  if (index <= 0) return currentPath;
  const parent = path.slice(0, index);
  return allowedRoots.includes(path) ? path : parent;
}

function isAllowedRoot(path) {
  return allowedRoots.some((root) => path === root || path.startsWith(`${root}/`));
}

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function normalizePath(path) {
  const trimmed = String(path || '').trim().replace(/\/+$/g, '');
  return trimmed || '/gcode';
}

async function listDirs(path) {
  const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Could not list ${path}`);
  return (data.items || []).filter((item) => item.type === 'dir');
}

async function addTreeLines(path, depth, lines) {
  if (depth > 6) return;
  try {
    const dirs = await listDirs(path);
    for (const dir of dirs) {
      lines.push({ path: dir.path, label: dir.name, depth });
      await addTreeLines(dir.path, depth + 1, lines);
    }
  } catch (err) {
    lines.push({ path, label: `Could not read ${path}: ${err.message}`, depth, disabled: true });
  }
}

async function buildPathTree() {
  if (!pathTree) return;
  pathTree.textContent = 'Loading folders...';

  const lines = [];
  for (const root of allowedRoots) {
    lines.push({ path: root, label: root, depth: 0 });
    await addTreeLines(root, 1, lines);
  }

  pathTree.textContent = '';
  lines.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'path-tree-item';
    button.style.paddingLeft = `${12 + item.depth * 18}px`;
    button.innerHTML = item.disabled ? html(item.label) : `${html(item.label)} <span>${html(item.path)}</span>`;
    button.disabled = Boolean(item.disabled);
    button.classList.toggle('active', item.path === currentPath);
    button.addEventListener('click', async () => {
      pathPicker.hidden = true;
      await loadPath(item.path);
    });
    pathTree.append(button);
  });
}

async function openPathPicker() {
  if (!pathPicker) return;
  pathPicker.hidden = false;
  await buildPathTree();
}

async function chooseParent() {
  if (allowedRoots.includes(currentPath)) {
    await openPathPicker();
    return;
  }
  await loadPath(parentPath(currentPath));
}

async function choosePathFromInput() {
  await openPathPicker();
}

function safeJoin(dir, name) {
  return `${dir.replace(/\/+$/g, '')}/${name}`;
}

function validateTargetPath(path) {
  const normalized = normalizePath(path);
  if (!isAllowedRoot(normalized)) {
    throw new Error('Path must be under /gcode, /www, /firmware, /jobs, or /logs');
  }
  if (normalized.includes('..') || normalized.includes('//') || normalized.includes('\\')) {
    throw new Error('Unsafe path');
  }
  return normalized;
}

function basename(path) {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(index + 1) : path;
}

function formatBytes(value) {
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatMinutes(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 60) return `~${Math.max(1, Math.round(value))} sec`;
  return `~${Math.max(1, Math.round(value / 60))} min`;
}

function canPreview(item) {
  return item.type === 'file' && /\.(gcode|gc|nc|tap)$/i.test(item.name);
}

function thumbnailUrl(path) {
  return `/api/download?path=${encodeURIComponent(path)}`;
}

function canvasPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Browser could not encode the thumbnail PNG.'));
    }, 'image/png');
  });
}

async function generateSelectedThumbnail() {
  const token = ++thumbnailGeneration;
  selectedThumbnail = null;
  const file = uploadFile.files?.[0];
  if (!file) {
    uploadThumbnailPreview.hidden = true;
    return;
  }
  const [, thumbnail] = await thumbnailModulesPromise;
  if (!thumbnail.isGcodeFileName(file.name)) {
    uploadThumbnailPreview.hidden = true;
    return;
  }

  uploadThumbnailPreview.hidden = false;
  uploadThumbnailStatus.textContent = 'Generating 128 x 128 PNG preview...';
  uploadSubmit.disabled = true;
  try {
    const [toolpath] = await thumbnailModulesPromise;
    const text = await file.text();
    if (token !== thumbnailGeneration) return;
    const model = toolpath.parseGCodeToToolpath(text);
    toolpath.renderToolpathToCanvas(model, uploadThumbnailCanvas, {
      width: thumbnail.THUMBNAIL_SIZE,
      height: thumbnail.THUMBNAIL_SIZE,
    });
    const blob = await canvasPngBlob(uploadThumbnailCanvas);
    if (token !== thumbnailGeneration) return;
    selectedThumbnail = {
      fileName: file.name,
      fileSize: file.size,
      lastModified: file.lastModified,
      blob,
      model,
      path: thumbnail.thumbnailPathFor(file.name),
      jobPath: thumbnail.jobPathForUpload(file.name),
    };
    uploadThumbnailStatus.textContent = `PNG ready | ${formatBytes(blob.size)} | ${model.segments.length} segments`;
  } catch (err) {
    selectedThumbnail = null;
    uploadThumbnailStatus.textContent = `Thumbnail unavailable: ${err.message}`;
  } finally {
    if (token === thumbnailGeneration) uploadSubmit.disabled = false;
  }
}

function selectedThumbnailMatches(file) {
  return selectedThumbnail && selectedThumbnail.fileName === file.name &&
    selectedThumbnail.fileSize === file.size && selectedThumbnail.lastModified === file.lastModified;
}

async function uploadFileTo(path, file, overwrite = true) {
  const form = new FormData();
  form.append('path', path);
  form.append('file', file);
  const url = overwrite ? '/api/upload?overwrite=true' : '/api/upload';
  const res = await fetch(url, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `Upload failed for ${file.name}`);
  return data;
}

async function ensureThumbnailDirectory() {
  const res = await fetch('/api/mkdir', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/jobs/thumbs' }),
  });
  if (!res.ok && res.status !== 409) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not create /jobs/thumbs');
  }
}

async function existingJob(path) {
  const res = await fetch(`/api/download?path=${encodeURIComponent(path)}`);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function uploadThumbnailSidecars(gcodePath, selected) {
  const [toolpath, thumbnail] = await thumbnailModulesPromise;
  await ensureThumbnailDirectory();
  const pngName = basename(selected.path);
  await uploadFileTo('/jobs/thumbs', new File([selected.blob], pngName, { type: 'image/png' }), true);
  const sidecarJobPath = thumbnail.jobPathForUpload(gcodePath);
  const previous = await existingJob(sidecarJobPath);
  const job = thumbnail.mergeUploadedFileMetadata(previous, {
    gcodePath,
    jobPath: sidecarJobPath,
    thumbnailPath: selected.path,
    preview: toolpath.buildPreviewMetadata(selected.model),
  });
  await uploadFileTo('/jobs', new File([JSON.stringify(job, null, 2)], basename(sidecarJobPath), {
    type: 'application/json',
  }), true);
}

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

function saveCurrentJob(gcodePath) {
  localStorage.setItem(currentJobKey, JSON.stringify({
    gcodePath,
    jobPath: jobPathFor(gcodePath),
  }));
}

async function loadFileMeta(item) {
  if (!canPreview(item)) return null;
  try {
    const res = await fetch(`/api/download?path=${encodeURIComponent(jobPathFor(item.path))}`);
    if (res.ok) {
      const loaded = await res.json();
      if (loaded?.sourceGcodePath === item.path) return loaded;
    }
  } catch (err) {
    // A thumbnail may still exist even when this file has no current Job JSON.
  }
  const [, thumbnail] = await thumbnailModulesPromise;
  const thumbnailPath = thumbnail.thumbnailPathFor(item.name || basename(item.path));
  const thumbnailRes = await fetch(thumbnailUrl(thumbnailPath)).catch(() => null);
  return thumbnailRes?.ok ? { sourceGcodePath: item.path, thumbnailPath } : null;
}

function fileBadges(item, meta) {
  const badges = [];
  const warnings = (meta?.preview?.warnings || []).filter((warning) => !/G54 default workspace|default-workspace/i.test(String(warning?.message || warning)));
  if (warnings.length) badges.push(`${warnings.length} need attention`);
  const estimate = formatMinutes(meta?.preview?.estimate?.effectiveSecondsWithOverride || meta?.preview?.estimate?.nominalSeconds);
  if (estimate) badges.push(estimate);
  return badges.map((badge) => `<span class="status-badge">${html(badge)}</span>`).join('');
}

async function refreshStatus() {
  const res = await fetch('/api/sd/status');
  const data = await res.json();
  if (!data.mounted) {
    statusEl.textContent = 'SD card not mounted';
    return;
  }
  statusEl.textContent = `${data.cardType} | ${formatBytes(data.freeBytes)} free of ${formatBytes(data.totalBytes)}`;
}

function rowButton(text, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick(event);
  });
  return button;
}

function openItem(item) {
  if (item.type === 'dir') {
    loadPath(item.path);
    return;
  }
  if (canPreview(item)) {
    saveCurrentJob(item.path);
    window.location.href = `/preview.html?path=${encodeURIComponent(item.path)}`;
    return;
  }
  activeItemPath = activeItemPath === item.path ? '' : item.path;
}

function openActions(item) {
  activeItemPath = item.path;
}

function bindCardInteractions(target, item, items) {
  let longPressTimer = null;
  let suppressClick = false;

  const clearLongPress = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  target.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openActions(item);
    renderList(items);
  });

  target.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    suppressClick = false;
    clearLongPress();
    longPressTimer = setTimeout(() => {
      suppressClick = true;
      openActions(item);
      renderList(items);
    }, LONG_PRESS_MS);
  });

  ['pointerup', 'pointercancel', 'pointerleave', 'dragstart'].forEach((eventName) => {
    target.addEventListener(eventName, clearLongPress);
  });

  target.addEventListener('click', (event) => {
    if (event.target?.closest?.('.file-actions')) return;
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      openActions(item);
      renderList(items);
      return;
    }
    openItem(item);
    renderList(items);
  });

  target.addEventListener('keydown', (event) => {
    if (event.target?.closest?.('.file-actions')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openItem(item);
    renderList(items);
  });
}

function renderList(items) {
  listEl.textContent = '';

  if (!allowedRoots.includes(currentPath)) {
    const row = document.createElement('div');
    row.className = 'file-row file-parent-row';
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'file-name';
    link.textContent = '.. parent';
    link.addEventListener('click', chooseParent);
    row.append(link);
    listEl.append(row);
  }

  items.forEach((item) => {
    const itemMeta = fileMetaByPath.get(item.path) || null;
    const row = document.createElement('div');
    row.className = 'file-row file-card compact-row';
    row.classList.toggle('expanded', item.path === activeItemPath);
    row.dataset.itemType = item.type;

    row.tabIndex = 0;
    row.setAttribute('role', 'button');

    const name = document.createElement('div');
    name.className = 'file-name file-main';
    name.innerHTML = `
      ${itemMeta?.thumbnailPath ? `<img class="thumb-image" src="${html(thumbnailUrl(itemMeta.thumbnailPath))}" alt="">` : `<span class="thumb-placeholder" aria-hidden="true">${item.type === 'dir' ? 'Folder' : 'No preview'}</span>`}
      <span>
        <strong>${html(item.type === 'dir' ? `${item.name}/` : item.name)}</strong>
        <small>${item.type === 'file' ? formatBytes(item.size) : 'folder'}</small>
        <span class="badge-row">${fileBadges(item, itemMeta)}</span>
      </span>
    `;
    bindCardInteractions(row, item, items);

    const actions = document.createElement('div');
    actions.className = 'file-actions';
    actions.hidden = item.path !== activeItemPath;

    if (item.type === 'file') {
      const download = document.createElement('a');
      download.className = 'maintenance-link';
      download.href = `/api/download?path=${encodeURIComponent(item.path)}`;
      download.textContent = 'Download';
      download.addEventListener('click', (event) => event.stopPropagation());
      actions.append(download);
    }

    actions.append(rowButton('Rename', () => renamePath(item.path)));
    actions.append(rowButton('Delete', () => deletePath(item.path)));
    row.append(name, actions);
    listEl.append(row);
  });
}

async function loadPath(path) {
  try {
    currentPath = validateTargetPath(path || '/gcode');
  } catch (err) {
    alert(err.message);
    currentPath = '/gcode';
  }
  pathInput.value = currentPath;
  await refreshStatus();

  const res = await fetch(`/api/files?path=${encodeURIComponent(currentPath)}`);
  const data = await res.json();
  if (!res.ok) {
    listEl.textContent = data.error || 'Could not list files';
    return;
  }
  fileMetaByPath = new Map();
  await Promise.all((data.items || []).map(async (item) => {
    const meta = await loadFileMeta(item);
    if (meta) fileMetaByPath.set(item.path, meta);
  }));
  renderList(data.items || []);
}

async function deletePath(path) {
  if (!confirm(`Delete ${basename(path)}?`)) return;
  const res = await fetch('/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const data = await res.json();
    alert(data.error || 'Delete failed');
  }
  await loadPath(currentPath);
}

async function renamePath(path) {
  const oldName = basename(path);
  const nextName = prompt('Rename to:', oldName);
  if (!nextName || nextName === oldName) return;
  if (nextName.includes('/') || nextName.includes('\\') || nextName.includes('..')) {
    alert('Unsafe file name');
    return;
  }
  const target = `${parentPath(path)}/${nextName}`;
  const res = await fetch('/api/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: path, to: target }),
  });
  if (!res.ok) {
    const data = await res.json();
    alert(data.error || 'Rename failed');
  }
  await loadPath(currentPath);
}

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!uploadFile.files.length) return;

  const file = uploadFile.files[0];
  uploadSubmit.disabled = true;
  try {
    await uploadFileTo(currentPath, file, Boolean(overwriteUpload?.checked));
    if ((currentPath === '/gcode' || currentPath.startsWith('/gcode/')) && selectedThumbnailMatches(file)) {
      try {
        await uploadThumbnailSidecars(safeJoin(currentPath, file.name), selectedThumbnail);
      } catch (err) {
        alert(`G-code uploaded, but its PNG thumbnail/job metadata failed: ${err.message}`);
      }
    }
  } catch (err) {
    alert(err.message);
    uploadSubmit.disabled = false;
    return;
  }
  uploadForm.reset();
  selectedThumbnail = null;
  uploadThumbnailPreview.hidden = true;
  uploadSubmit.disabled = false;
  await loadPath(currentPath);
});

mkdirForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = folderName.value.trim();
  if (!name) return;

  const path = safeJoin(currentPath, name);
  const res = await fetch('/api/mkdir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const data = await res.json();
    alert(data.error || 'Create folder failed');
  }
  mkdirForm.reset();
  await loadPath(currentPath);
});

refreshButton.addEventListener('click', () => loadPath(currentPath));
pathInput.addEventListener('click', choosePathFromInput);
pathInput.addEventListener('focus', choosePathFromInput);
closePathPicker?.addEventListener('click', () => {
  pathPicker.hidden = true;
});
uploadFile.addEventListener('change', () => {
  generateSelectedThumbnail().catch((err) => {
    uploadThumbnailStatus.textContent = `Thumbnail unavailable: ${err.message}`;
    uploadSubmit.disabled = false;
  });
});
loadPath(currentPath);
