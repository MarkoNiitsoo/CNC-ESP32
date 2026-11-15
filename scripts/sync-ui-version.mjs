import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HTML_FILES = [
  'www/index.html',
  'www/files.html',
  'www/preview.html',
];

function computeNextVersion(currentBadge) {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const today = `${yyyy}.${mm}.${dd}`;
  const match = String(currentBadge || '').match(/^(\d{4}\.\d{2}\.\d{2})-(\d+)$/);
  if (match && match[1] === today) {
    return `${today}-${Number(match[2]) + 1}`;
  }
  return `${today}-1`;
}

function toQueryVersion(displayVersion) {
  return displayVersion.replace(/\./g, '');
}

const previewPath = resolve(process.cwd(), 'www/preview.html');
const previewSource = readFileSync(previewPath, 'utf8');
const currentMatch = previewSource.match(/id="ui-version-badge">UI\s+([^<]+)</);
const requested = process.argv[2]?.trim();
const displayVersion = requested || computeNextVersion(currentMatch?.[1]);
if (!/^\d{4}\.\d{2}\.\d{2}-\d+$/.test(displayVersion)) {
  console.error(`Invalid UI version "${displayVersion}". Expected YYYY.MM.DD-N`);
  process.exit(1);
}
const queryVersion = toQueryVersion(displayVersion);

for (const relPath of HTML_FILES) {
  const fullPath = resolve(process.cwd(), relPath);
  const original = readFileSync(fullPath, 'utf8');
  let updated = original.replace(
    /(<span id="ui-version-badge">UI\s+)[^<]+(<\/span>)/g,
    `$1${displayVersion}$2`,
  );
  updated = updated.replace(
    /((?:href|src)="\/[^"?]+\.(?:css|js))(?:\?v=[^"]+)?(")/g,
    `$1?v=${queryVersion}$2`,
  );
  if (updated !== original) {
    writeFileSync(fullPath, updated, 'utf8');
    console.log(`Updated ${relPath} -> UI ${displayVersion} (?v=${queryVersion})`);
  } else {
    console.log(`Unchanged ${relPath} (already UI ${displayVersion})`);
  }
}
