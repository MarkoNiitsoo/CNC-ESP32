const statusEl = document.querySelector('#sd-status');
const pathInput = document.querySelector('#current-path');
const listEl = document.querySelector('#file-list');
const refreshButton = document.querySelector('#refresh');
const uploadForm = document.querySelector('#upload-form');
const uploadFile = document.querySelector('#upload-file');
const overwriteUpload = document.querySelector('#overwrite-upload');
const mkdirForm = document.querySelector('#mkdir-form');
const folderName = document.querySelector('#folder-name');
const pathPicker = document.querySelector('#path-picker');
const pathTree = document.querySelector('#path-tree');
const closePathPicker = document.querySelector('#close-path-picker');

let currentPath = '/gcode';
const allowedRoots = ['/gcode', '/www', '/firmware', '/jobs', '/logs'];

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

function canPreview(item) {
  return item.type === 'file' && /\.(gcode|gc|nc|tap)$/i.test(item.name);
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
  button.addEventListener('click', onClick);
  return button;
}

function renderList(items) {
  listEl.textContent = '';

  if (!allowedRoots.includes(currentPath)) {
    const row = document.createElement('div');
    row.className = 'file-row';
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'file-name';
    link.textContent = '.. parent';
    link.addEventListener('click', chooseParent);
    row.append(link);
    listEl.append(row);
  }

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'file-row';

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'file-name';
    name.textContent = item.type === 'dir' ? `${item.name}/` : item.name;
    if (item.type === 'dir') {
      name.addEventListener('click', () => loadPath(item.path));
    } else {
      name.disabled = true;
    }

    const meta = document.createElement('span');
    meta.className = 'file-meta';
    meta.textContent = item.type === 'file' ? formatBytes(item.size) : 'folder';

    const actions = document.createElement('div');
    actions.className = 'file-actions';

    if (canPreview(item)) {
      const preview = document.createElement('a');
      preview.className = 'maintenance-link';
      preview.href = `/preview.html?path=${encodeURIComponent(item.path)}`;
      preview.textContent = 'Preview';
      actions.append(preview);
    }

    if (item.type === 'file') {
      const download = document.createElement('a');
      download.className = 'maintenance-link';
      download.href = `/api/download?path=${encodeURIComponent(item.path)}`;
      download.textContent = 'Download';
      actions.append(download);
    }

    actions.append(rowButton('Rename', () => renamePath(item.path)));
    actions.append(rowButton('Delete', () => deletePath(item.path)));
    row.append(name, meta, actions);
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

  const form = new FormData();
  form.append('path', currentPath);
  form.append('file', uploadFile.files[0]);

  const uploadUrl = overwriteUpload?.checked ? '/api/upload?overwrite=true' : '/api/upload';
  const res = await fetch(uploadUrl, { method: 'POST', body: form });
  if (!res.ok) {
    const data = await res.json();
    alert(data.error || 'Upload failed');
  }
  uploadForm.reset();
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
loadPath(currentPath);
