export const LOWRIDER_LIMITS = {
  xMin: 0,
  xMax: 1625,
  yMin: 0,
  yMax: 5800,
};

const EMPTY_BOUNDS = Object.freeze({
  xMin: null,
  xMax: null,
  yMin: null,
  yMax: null,
  zMin: null,
  zMax: null,
});

export function stripGCodeComments(line) {
  return String(line || '')
    .replace(/\([^)]*\)/g, '')
    .replace(/;.*/, '')
    .trim();
}

function cloneBounds(bounds) {
  return { ...bounds };
}

function createMutableBounds() {
  return {
    xMin: Infinity,
    xMax: -Infinity,
    yMin: Infinity,
    yMax: -Infinity,
    zMin: Infinity,
    zMax: -Infinity,
  };
}

function finalizeBounds(bounds) {
  if (!Number.isFinite(bounds.xMin)) return cloneBounds(EMPTY_BOUNDS);
  return {
    xMin: bounds.xMin,
    xMax: bounds.xMax,
    yMin: bounds.yMin,
    yMax: bounds.yMax,
    zMin: bounds.zMin,
    zMax: bounds.zMax,
  };
}

function updateBounds(bounds, point) {
  bounds.xMin = Math.min(bounds.xMin, point.x);
  bounds.xMax = Math.max(bounds.xMax, point.x);
  bounds.yMin = Math.min(bounds.yMin, point.y);
  bounds.yMax = Math.max(bounds.yMax, point.y);
  bounds.zMin = Math.min(bounds.zMin, point.z);
  bounds.zMax = Math.max(bounds.zMax, point.z);
}

function boundsAvailable(bounds) {
  return bounds && Number.isFinite(bounds.xMin) && Number.isFinite(bounds.xMax) &&
    Number.isFinite(bounds.yMin) && Number.isFinite(bounds.yMax);
}

function parseWords(line) {
  const words = [];
  const matches = String(line || '').matchAll(/([A-Z])\s*(-?\d+(?:\.\d+)?)/gi);
  for (const match of matches) {
    words.push({ letter: match[1].toUpperCase(), value: Number(match[2]) });
  }
  return words;
}

function codeValue(code) {
  return Number(String(code).slice(1));
}

function codeName(letter, value) {
  if (!Number.isFinite(value)) return `${letter}`;
  if (Number.isInteger(value)) return `${letter}${value}`;
  return `${letter}${value}`;
}

function addWarning(model, code, message, lineNumber = null) {
  model.warnings.push({ code, message, lineNumber });
}

function addUnsupported(model, command, message, lineNumber) {
  model.unsupportedCommands.push({ command, message, lineNumber });
  addWarning(model, 'unsupported-command', message, lineNumber);
}

function distance3d(from, to) {
  return Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
}

function arcSweep(startAngle, endAngle, clockwise, fullCircle = false) {
  if (fullCircle) return clockwise ? -Math.PI * 2 : Math.PI * 2;
  let sweep = endAngle - startAngle;
  if (clockwise) {
    while (sweep >= 0) sweep -= Math.PI * 2;
  } else {
    while (sweep <= 0) sweep += Math.PI * 2;
  }
  return sweep;
}

function arcFromCenter(from, to, center, clockwise) {
  const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
  const endAngle = Math.atan2(to.y - center.y, to.x - center.x);
  const radius = Math.hypot(from.x - center.x, from.y - center.y);
  const endRadius = Math.hypot(to.x - center.x, to.y - center.y);
  const fullCircle = Math.hypot(to.x - from.x, to.y - from.y) < 1e-8;
  if (!Number.isFinite(radius) || radius < 1e-8 || Math.abs(radius - endRadius) > Math.max(0.05, radius * 0.002)) {
    return null;
  }
  return {
    center,
    radius,
    startAngle,
    sweepRadians: arcSweep(startAngle, endAngle, clockwise, fullCircle),
  };
}

function resolveRadiusArc(from, to, radiusWord, clockwise) {
  const radius = Math.abs(radiusWord);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chord = Math.hypot(dx, dy);
  if (!Number.isFinite(radius) || radius < 1e-8 || chord < 1e-8 || chord > radius * 2 + 1e-7) return null;

  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const h = Math.sqrt(Math.max(0, radius * radius - chord * chord / 4));
  const nx = -dy / chord;
  const ny = dx / chord;
  const candidates = [
    { x: mx + nx * h, y: my + ny * h },
    { x: mx - nx * h, y: my - ny * h },
  ].map((center) => arcFromCenter(from, to, center, clockwise)).filter(Boolean);
  const wantsMajor = radiusWord < 0;
  return candidates.find((arc) => (Math.abs(arc.sweepRadians) > Math.PI + 1e-7) === wantsMajor) || candidates[0] || null;
}

function resolveArc(from, to, byLetter, scale, motion, options = {}) {
  const clockwise = motion === 'G2';
  let arc = null;
  if (Number.isFinite(byLetter.I) || Number.isFinite(byLetter.J)) {
    arc = arcFromCenter(from, to, {
      x: from.x + (Number(byLetter.I) || 0) * scale,
      y: from.y + (Number(byLetter.J) || 0) * scale,
    }, clockwise);
  } else if (Number.isFinite(byLetter.R)) {
    arc = resolveRadiusArc(from, to, byLetter.R * scale, clockwise);
  }
  if (!arc) return null;

  const maxAngle = Number(options.arcMaxAngleDeg || 5) * Math.PI / 180;
  const maxLength = Math.max(0.1, Number(options.arcSegmentLength || 2));
  const count = Math.max(2, Math.min(1440, Math.ceil(Math.max(
    Math.abs(arc.sweepRadians) / maxAngle,
    Math.abs(arc.sweepRadians) * arc.radius / maxLength,
  ))));
  const points = [];
  for (let index = 1; index <= count; index += 1) {
    const ratio = index / count;
    const angle = arc.startAngle + arc.sweepRadians * ratio;
    points.push({
      x: arc.center.x + Math.cos(angle) * arc.radius,
      y: arc.center.y + Math.sin(angle) * arc.radius,
      z: from.z + (to.z - from.z) * ratio,
    });
  }
  points[points.length - 1] = { ...to };
  return {
    command: motion,
    clockwise,
    center: { ...arc.center, z: from.z },
    radius: arc.radius,
    sweepRadians: arc.sweepRadians,
    points,
    length: Math.hypot(Math.abs(arc.sweepRadians) * arc.radius, to.z - from.z),
  };
}

function xyChanged(from, to) {
  return from.x !== to.x || from.y !== to.y;
}

function classifyLinearMove({ motion, from, to }) {
  if (motion === 'G0') return 'rapid';
  if (to.z > from.z && !xyChanged(from, to)) return 'retract';
  if (to.z < from.z && !xyChanged(from, to)) return 'plunge';
  if (xyChanged(from, to) && (from.z < 0 || to.z < 0)) return 'cut';
  return 'rapid';
}

function addSegment(model, rawBounds, cutBounds, segment) {
  updateBounds(rawBounds, segment.from);
  updateBounds(rawBounds, segment.to);
  (segment.points || []).forEach((point) => updateBounds(rawBounds, point));
  if (segment.engaged) {
    updateBounds(cutBounds, segment.from);
    updateBounds(cutBounds, segment.to);
    (segment.points || []).forEach((point) => updateBounds(cutBounds, point));
  }
  model.segments.push(segment);
}

function wordsObject(words) {
  const out = {};
  for (const word of words) out[word.letter] = word.value;
  return out;
}

function defaultModel() {
  return {
    units: 'mm',
    absolute: true,
    plane: 'G17',
    segments: [],
    warnings: [],
    unsupportedCommands: [],
    modal: {
      units: 'G21',
      positioning: 'G90',
      plane: 'G17',
      workspace: 'G54',
    },
    bounds: {
      rawTravelBounds: cloneBounds(EMPTY_BOUNDS),
      cutBounds: cloneBounds(EMPTY_BOUNDS),
      placementBounds: cloneBounds(EMPTY_BOUNDS),
    },
    feed: {
      min: null,
      max: null,
      commandCount: 0,
      lastFeed: null,
      rapidDistance: 0,
      cuttingDistance: 0,
      plungeDistance: 0,
      retractDistance: 0,
    },
    estimate: {
      nominalSeconds: null,
      effectiveSecondsWithOverride: null,
      confidence: 'low',
      notes: [],
    },
    source: {
      lineCount: 0,
      originalText: '',
    },
  };
}

export function parseGCodeToToolpath(sourceText, options = {}) {
  const model = defaultModel();
  const rawBounds = createMutableBounds();
  const cutBounds = createMutableBounds();
  const lines = String(sourceText || '').split(/\r?\n/);
  const sourceScale = { value: 1 };
  const initialPosition = options.initialPosition || {};
  const position = {
    x: Number.isFinite(Number(initialPosition.x)) ? Number(initialPosition.x) : 0,
    y: Number.isFinite(Number(initialPosition.y)) ? Number(initialPosition.y) : 0,
    z: Number.isFinite(Number(initialPosition.z)) ? Number(initialPosition.z) : 0,
  };
  let motion = null;
  let commandNumber = 0;

  model.source = {
    lineCount: lines.length,
    originalText: String(sourceText || ''),
  };
  updateBounds(rawBounds, position);

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const cleaned = stripGCodeComments(rawLine).toUpperCase();
    if (!cleaned) return;
    commandNumber += 1;

    const words = parseWords(cleaned);
    const byLetter = wordsObject(words);

    for (const word of words) {
      if (word.letter === 'G') {
        const g = codeValue(`G${word.value}`);
        const command = codeName('G', word.value);
        if (g === 0) motion = 'G0';
        else if (g === 1) motion = 'G1';
        else if (g === 2 || g === 3) {
          motion = command;
        } else if (g === 17) {
          model.plane = 'G17';
          model.modal.plane = 'G17';
        } else if (g === 18 || g === 19) {
          model.plane = command;
          model.modal.plane = command;
          addUnsupported(model, command, `${command} non-XY plane is not supported for transform-safe preview.`, lineNumber);
        } else if (g === 20) {
          model.units = 'inch';
          model.modal.units = 'G20';
          sourceScale.value = 25.4;
          addWarning(model, 'inch-mode', 'G20 inch mode found; coordinates are converted to millimeters for preview.', lineNumber);
        } else if (g === 21) {
          model.units = 'mm';
          model.modal.units = 'G21';
          sourceScale.value = 1;
        } else if (g === 53) {
          addUnsupported(model, command, 'G53 machine-coordinate move is unsafe for transform/resume assumptions.', lineNumber);
        } else if (g === 54) {
          model.modal.workspace = 'G54';
        } else if ((g >= 55 && g <= 59) || [59.1, 59.2, 59.3].includes(g)) {
          model.modal.workspace = command;
          addUnsupported(model, command, 'Non-default workspace command found. This may conflict with captured work zero.', lineNumber);
        } else if (g === 90) {
          model.absolute = true;
          model.modal.positioning = 'G90';
        } else if (g === 91) {
          model.absolute = false;
          model.modal.positioning = 'G91';
          addUnsupported(model, command, 'G91 relative mode is unsupported for future transform-safe processing.', lineNumber);
        } else if (g === 92) {
          addUnsupported(model, command, 'G92 inside source G-code changes work zero and must be reviewed.', lineNumber);
        } else if (g === 41 || g === 42) {
          addUnsupported(model, command, `${command} cutter compensation is not supported.`, lineNumber);
        } else if (g >= 80 && g <= 89) {
          addUnsupported(model, command, `${command} canned cycle is not supported.`, lineNumber);
        } else {
          addUnsupported(model, command, `${command} is not supported by the ToolpathModel MVP.`, lineNumber);
        }
      } else if (word.letter === 'M') {
        const command = codeName('M', word.value);
        if (command === 'M3' || command === 'M4') {
          addWarning(model, 'spindle-on', `${command} spindle/laser enable command found.`, lineNumber);
        }
      } else if (word.letter === 'F') {
        const feed = word.value * sourceScale.value;
        model.feed.lastFeed = feed;
        model.feed.commandCount += 1;
        model.feed.min = model.feed.min === null ? feed : Math.min(model.feed.min, feed);
        model.feed.max = model.feed.max === null ? feed : Math.max(model.feed.max, feed);
      }
    }

    const hasMove = ['X', 'Y', 'Z'].some((axis) => Number.isFinite(byLetter[axis])) ||
      ((motion === 'G2' || motion === 'G3') && ['I', 'J', 'R'].some((word) => Number.isFinite(byLetter[word])));
    if (!hasMove || !motion) return;

    const next = { ...position };
    for (const axis of ['X', 'Y', 'Z']) {
      if (!Number.isFinite(byLetter[axis])) continue;
      const key = axis.toLowerCase();
      const value = byLetter[axis] * sourceScale.value;
      next[key] = model.absolute ? value : next[key] + value;
    }

    const type = motion === 'G2' || motion === 'G3'
      ? 'arc'
      : classifyLinearMove({ motion, from: position, to: next });
    const arc = type === 'arc'
      ? resolveArc(position, next, byLetter, sourceScale.value, motion, options)
      : null;
    if (type === 'arc' && !arc) {
      addWarning(model, 'arc-invalid', `${motion} arc geometry is invalid or missing I/J/R; showing its endpoint as a straight line.`, lineNumber);
    }
    const length = arc?.length || distance3d(position, next);
    const engaged = type === 'cut' || type === 'arc';
    const segment = {
      type,
      from: { ...position },
      to: { ...next },
      feed: type === 'rapid' ? null : model.feed.lastFeed,
      lineNumber,
      commandNumber,
      source: rawLine,
      engaged,
      arc,
      points: arc?.points || [],
      length,
    };
    addSegment(model, rawBounds, cutBounds, segment);

    if (type === 'rapid') model.feed.rapidDistance += length;
    else if (type === 'cut' || type === 'arc') model.feed.cuttingDistance += length;
    else if (type === 'plunge') model.feed.plungeDistance += length;
    else if (type === 'retract') model.feed.retractDistance += length;

    Object.assign(position, next);
  });

  model.bounds.rawTravelBounds = finalizeBounds(rawBounds);
  model.bounds.cutBounds = finalizeBounds(cutBounds);
  model.bounds.placementBounds = boundsAvailable(cutBounds)
    ? finalizeBounds(cutBounds)
    : finalizeBounds(rawBounds);

  if (!boundsAvailable(cutBounds)) {
    addWarning(model, 'cut-bounds-uncertain', 'No engaged cutting XY movement was detected; placement bounds use raw travel bounds.');
  }

  return calculateToolpathStats(model, options);
}

export function calculateToolpathStats(model, options = {}) {
  const feedOverridePercent = Number(options.feedOverridePercent || 100);
  const rapidFeed = Number(options.defaultRapidFeed || 3000);
  let nominalSeconds = 0;
  let knownSeconds = 0;
  let unknownSegments = 0;

  for (const segment of model.segments || []) {
    const length = Number(segment.length) || distance3d(segment.from, segment.to);
    const feed = segment.type === 'rapid' ? rapidFeed : segment.feed;
    if (Number.isFinite(feed) && feed > 0) {
      const seconds = length / feed * 60;
      nominalSeconds += seconds;
      knownSeconds += seconds;
    } else {
      unknownSegments += 1;
    }
  }

  const notes = [
    'Estimate is approximate.',
    'Acceleration/deceleration and short segment planner behavior are not included.',
    'Pauses, M400, dwell, operator actions, and live feed override changes are not included.',
    'Feed override changes movement speed only. It does not change router RPM.',
  ];
  if (unknownSegments > 0) notes.push(`${unknownSegments} segment(s) had no usable feed value.`);

  const confidence = unknownSegments > 0 || model.unsupportedCommands.length > 0
    ? 'low'
    : model.warnings.length > 0 ? 'medium' : 'high';

  model.estimate = {
    nominalSeconds: model.segments.length ? nominalSeconds : null,
    effectiveSecondsWithOverride: model.segments.length && feedOverridePercent > 0
      ? knownSeconds * 100 / feedOverridePercent
      : null,
    confidence,
    notes,
  };
  return model;
}

export function renderToolpathToCanvas(model, canvas, options = {}) {
  if (!canvas?.getContext) return false;
  const ctx = canvas.getContext('2d');
  const width = canvas.width || options.width || 320;
  const height = canvas.height || options.height || 220;
  const bounds = boundsAvailable(model.bounds.placementBounds)
    ? model.bounds.placementBounds
    : model.bounds.rawTravelBounds;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#07100c';
  ctx.fillRect(0, 0, width, height);
  if (!boundsAvailable(bounds) || !model.segments?.length) return false;

  const pad = Number(options.padding ?? 7);
  const spanX = Math.max(0.001, bounds.xMax - bounds.xMin);
  const spanY = Math.max(0.001, bounds.yMax - bounds.yMin);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const contentWidth = spanX * scale;
  const contentHeight = spanY * scale;
  const offsetX = (width - contentWidth) / 2;
  const offsetY = (height - contentHeight) / 2;
  const px = (value) => offsetX + (value - bounds.xMin) * scale;
  const py = (value) => height - offsetY - (value - bounds.yMin) * scale;

  const drawSegments = (segments, strokeStyle, lineWidth) => {
    ctx.beginPath();
    for (const segment of segments) {
      ctx.moveTo(px(segment.from.x), py(segment.from.y));
      const points = segment.points?.length ? segment.points : [segment.to];
      for (const point of points) ctx.lineTo(px(point.x), py(point.y));
    }
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  drawSegments(model.segments.filter((segment) => !segment.engaged), '#2a4452', 1);
  const cutting = model.segments.filter((segment) => segment.engaged);
  drawSegments(cutting.length ? cutting : model.segments, '#3fc475', 1.5);
  ctx.strokeStyle = '#245f8f';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  return true;
}

export function estimateToolpathTime(model, options = {}) {
  return calculateToolpathStats({ ...model, estimate: { ...model.estimate } }, options).estimate;
}

export function getToolpathWarnings(model) {
  return (model.warnings || []).map((warning) => warning.message || String(warning));
}

export function buildPreviewMetadata(model, options = {}) {
  return {
    bounds: {
      rawTravelBounds: model.bounds.rawTravelBounds,
      cutBounds: model.bounds.cutBounds,
      placementBounds: model.bounds.placementBounds,
    },
    warnings: getToolpathWarnings(model),
    feed: { ...model.feed },
    estimate: { ...model.estimate },
    lineCount: model.source.lineCount,
    segmentCount: model.segments.length,
    toolpathModelVersion: 2,
    parserLimitations: [
      'G2/G3 arcs are interpolated for preview and retained in transformed output on the G17 XY plane.',
      'Cut bounds use an MVP engagement rule based on XY G1/arc movement below Z0.',
      'Unsupported transform-sensitive commands are warnings for future transform work.',
    ],
  };
}

export function mergePreviewMetadata(job, previewMetadata, thumbnailPath = null) {
  const next = {
    ...(job || {}),
    preview: {
      ...((job || {}).preview || {}),
      ...previewMetadata,
    },
  };
  if (thumbnailPath) next.thumbnailPath = thumbnailPath;
  return next;
}
