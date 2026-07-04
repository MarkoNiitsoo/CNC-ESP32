const GROUP_FIELDS = {
  M92: ['x', 'y', 'z'],
  M203: ['x', 'y', 'z'],
  M201: ['x', 'y', 'z'],
  M204: ['p', 'r', 't'],
};

function wordsForLine(response, code) {
  const line = String(response || '').split(/\r?\n/).find((item) =>
    new RegExp(`(?:^|\\s)${code}(?:\\s|$)`, 'i').test(item));
  if (!line) return null;
  const values = {};
  for (const match of line.matchAll(/\b([A-Z])\s*(-?\d+(?:\.\d+)?)/gi)) {
    values[match[1].toLowerCase()] = Number(match[2]);
  }
  return values;
}

export function parseM503Configuration(response) {
  return Object.fromEntries(Object.entries(GROUP_FIELDS).map(([group, fields]) => {
    const words = wordsForLine(response, group);
    const value = words && fields.every((field) => Number.isFinite(words[field]))
      ? Object.fromEntries(fields.map((field) => [field, words[field]]))
      : null;
    return [group, value];
  }));
}

export function parseM211State(response) {
  const text = String(response || '');
  const enabled = /Software Endstops:\s*(?:On|Enabled)/i.test(text)
    ? true
    : /Software Endstops:\s*(?:Off|Disabled)/i.test(text)
      ? false
      : null;
  return { enabled, raw: text.trim() };
}

export function editableGroups() {
  return structuredClone(GROUP_FIELDS);
}
