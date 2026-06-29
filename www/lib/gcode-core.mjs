export const MACHINE_LIMITS = {
  xMin: 0,
  xMax: 1625,
  yMin: 0,
  yMax: 5800,
};

export function stripComments(line) {
  return String(line || '')
    .replace(/\([^)]*\)/g, '')
    .replace(/;.*/, '')
    .trim();
}

export function parseWords(line) {
  const words = {};
  const matches = String(line || '').matchAll(/([A-Z])\s*(-?\d+(?:\.\d+)?)/gi);
  for (const match of matches) {
    words[match[1].toUpperCase()] = Number(match[2]);
  }
  return words;
}

export function parseCodes(line) {
  const codes = [];
  const matches = String(line || '').matchAll(/([GM])\s*(-?\d+(?:\.\d+)?)/gi);
  for (const match of matches) {
    codes.push(`${match[1].toUpperCase()}${match[2]}`);
  }
  return codes;
}

function updateBounds(bounds, pos) {
  bounds.xMin = Math.min(bounds.xMin, pos.x);
  bounds.xMax = Math.max(bounds.xMax, pos.x);
  bounds.yMin = Math.min(bounds.yMin, pos.y);
  bounds.yMax = Math.max(bounds.yMax, pos.y);
  bounds.zMin = Math.min(bounds.zMin, pos.z);
  bounds.zMax = Math.max(bounds.zMax, pos.z);
}

function addSegment(segments, bounds, from, to, rapid, feedrate = null) {
  updateBounds(bounds, from);
  updateBounds(bounds, to);
  if (from.x !== to.x || from.y !== to.y || from.z !== to.z) {
    segments.push({ from: { ...from }, to: { ...to }, rapid, feedrate });
  }
}

function unsupportedKey(code) {
  if (/^G0?0$/.test(code) || /^G0?1$/.test(code) || /^G0?2$/.test(code) || /^G0?3$/.test(code)) return '';
  if (['G20', 'G21', 'G54', 'G90', 'G91'].includes(code)) return '';
  if (['M3', 'M4', 'M5'].includes(code)) return '';
  return code;
}

export function parseGcode(text) {
  const bounds = {
    xMin: Infinity,
    xMax: -Infinity,
    yMin: Infinity,
    yMax: -Infinity,
    zMin: Infinity,
    zMax: -Infinity,
  };
  const pos = { x: 0, y: 0, z: 0 };
  const segments = [];
  const warnings = [];
  const unsupported = new Map();
  const nonDefaultWorkspaceCommands = [];
  let unitsScale = 1;
  let absolute = true;
  let motion = null;
  let feedrate = null;
  let minFeed = Infinity;
  let maxFeed = -Infinity;
  let feedCommandCount = 0;
  let arcApproximated = 0;
  let arcSkipped = 0;

  const analysis = {
    hasG20: false,
    hasG21: false,
    hasG90: false,
    hasG91: false,
    hasG54: false,
    hasZ: false,
    hasSpindleOn: false,
    fatalErrors: 0,
    unsupportedTotal: 0,
    nonDefaultWorkspaceCommands,
    arcApproximated: 0,
    arcSkipped: 0,
    feeds: {
      minFeed: null,
      maxFeed: null,
      feedCommandCount: 0,
    },
  };

  updateBounds(bounds, pos);
  const lines = String(text || '').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = stripComments(rawLine).toUpperCase();
    if (!line) continue;

    const words = parseWords(line);
    const codes = parseCodes(line);

    for (const code of codes) {
      if (/^G0?0$/.test(code)) motion = 0;
      else if (/^G0?1$/.test(code)) motion = 1;
      else if (/^G0?2$/.test(code)) motion = 2;
      else if (/^G0?3$/.test(code)) motion = 3;
      else if (code === 'G20') {
        unitsScale = 25.4;
        analysis.hasG20 = true;
      } else if (code === 'G21') {
        unitsScale = 1;
        analysis.hasG21 = true;
      } else if (code === 'G90') {
        absolute = true;
        analysis.hasG90 = true;
      } else if (code === 'G91') {
        absolute = false;
        analysis.hasG91 = true;
      } else if (code === 'G54') {
        analysis.hasG54 = true;
      } else if (/^G5[5-9](?:\.[1-3])?$/.test(code)) {
        nonDefaultWorkspaceCommands.push(code);
      } else if (code === 'M3' || code === 'M4') {
        analysis.hasSpindleOn = true;
      } else {
        const key = unsupportedKey(code);
        if (key) unsupported.set(key, (unsupported.get(key) || 0) + 1);
      }
    }

    if (Number.isFinite(words.F)) {
      feedrate = words.F * unitsScale;
      minFeed = Math.min(minFeed, feedrate);
      maxFeed = Math.max(maxFeed, feedrate);
      feedCommandCount += 1;
    }

    const hasMove = ['X', 'Y', 'Z'].some((axis) => Number.isFinite(words[axis]));
    if (!hasMove || motion === null) continue;

    const next = { ...pos };
    for (const axis of ['X', 'Y', 'Z']) {
      if (!Number.isFinite(words[axis])) continue;
      const key = axis.toLowerCase();
      const value = words[axis] * unitsScale;
      next[key] = absolute ? value : next[key] + value;
      if (axis === 'Z') analysis.hasZ = true;
    }

    if (motion === 0 || motion === 1) {
      addSegment(segments, bounds, pos, next, motion === 0, motion === 1 ? feedrate : null);
    } else {
      arcApproximated += 1;
      addSegment(segments, bounds, pos, next, false, feedrate);
    }
    Object.assign(pos, next);
  }

  if (analysis.hasG20) warnings.push('File contains G20 inch mode.');
  if (!analysis.hasG21) warnings.push('File does not contain G21 millimeter mode.');
  if (!analysis.hasG90) warnings.push('File does not contain G90 absolute mode.');
  if (analysis.hasG91) warnings.push('File contains G91 relative mode.');
  if (analysis.hasG54) warnings.push('G54 default workspace command found.');
  if (analysis.hasSpindleOn) warnings.push('File contains M3/M4 spindle or laser enable command.');
  if (analysis.hasZ && bounds.zMin < -30) warnings.push(`Z minimum ${bounds.zMin.toFixed(2)} mm is below -30 mm.`);
  if (bounds.xMin < MACHINE_LIMITS.xMin || bounds.xMax > MACHINE_LIMITS.xMax ||
      bounds.yMin < MACHINE_LIMITS.yMin || bounds.yMax > MACHINE_LIMITS.yMax) {
    warnings.push('Toolpath exceeds default LowRider work area.');
  }

  unsupported.forEach((count) => { analysis.unsupportedTotal += count; });
  if (analysis.unsupportedTotal > 0) {
    const list = [...unsupported.entries()].slice(0, 8).map(([code, count]) => `${code} x${count}`).join(', ');
    warnings.push(`Unsupported commands encountered: ${list}${unsupported.size > 8 ? ', ...' : ''}.`);
  }
  if (analysis.unsupportedTotal > 20) warnings.push('Unsupported commands are frequent; preview may be incomplete.');

  analysis.arcApproximated = arcApproximated;
  analysis.arcSkipped = arcSkipped;
  analysis.feeds = {
    minFeed: Number.isFinite(minFeed) ? minFeed : null,
    maxFeed: Number.isFinite(maxFeed) ? maxFeed : null,
    feedCommandCount,
  };

  return {
    lineCount: lines.length,
    segmentCount: segments.length,
    bounds,
    segments,
    warnings,
    analysis,
  };
}
