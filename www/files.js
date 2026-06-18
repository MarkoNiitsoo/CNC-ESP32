const statusEl = document.querySelector('#sd-status');
const pathInput = document.querySelector('#current-path');
const listEl = document.querySelector('#file-list');
const refreshButton = document.querySelector('#refresh');
const uploadForm = document.querySelector('#upload-form');
const uploadFile = document.querySelector('#upload-file');
const mkdirForm = document.querySelector('#mkdir-form');
const folderName = document.querySelector('#folder-name');

let currentPath = '/gcode';

function parentPath(path) {
  const index = path.lastIndexOf('/');
  if (index <= 0) return '/gcode';
  return path.slice(0, index);
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

  if (currentPath !== '/gcode') {
    const row = document.createElement('div');
    row.className = 'file-row';
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'file-name';
    link.textContent = '.. parent';
    link.addEventListener('click', () => loadPath(parentPath(currentPath)));
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
  currentPath = path || '/gcode';
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

  const res = await fetch('/api/upload', { method: 'POST', body: form });
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

  const path = `${currentPath}/${name}`;
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
loadPath(currentPath);
