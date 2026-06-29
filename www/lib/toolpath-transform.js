const EMPTY_BOUNDS = {
  xMin: null,
  xMax: null,
  yMin: null,
  yMax: null,
  zMin: null,
  zMax: null,
};

const UNSAFE_COMMAND_RE = /^(G91|G53|G92|G18|G19|G4[12]|G8[0-9]|G5[5-9](?:\.[1-3])?)$/;

function hasBounds(bounds) {
  return bounds && Number.isFinite(bounds.xMin) && Number.isFinite(bounds.xMax) &&
    Number.isFinite(bounds.yMin) && Number.isFinite(bounds.yMax);
}

function mutableBounds() {
  return {
    xMin: Infinity,
    xMax: -Infinity,
    yMin: Infinity,
    yMax: -Infinity,
    zMin: Infinity,
    zMax: -Infinity,
  };
}

function addPoint(bounds, point) {
  bounds.xMin = Math.min(bounds.xMin, point.x);
  bounds.xMax = Math.max(bounds.xMax, point.x);
  bounds.yMin = Math.min(bounds.yMin, point.y);
  bounds.yMax = Math.max(bounds.yMax, point.y);
  bounds.zMin = Math.min(bounds.zMin, point.z);
  bounds.zMax = Math.max(bounds.zMax, point.z);
}

function finishBounds(bounds) {
  if (!Number.isFinite(bounds.xMin)) return { ...EMPTY_BOUNDS };
  return { ...bounds };
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function fmt(value) {
  const rounded = round(value, 4);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function anchorPoint(bounds, anchor) {
  if (anchor === 'cutBoundsCenter') {
    return {
      x: (bounds.xMin + bounds.xMax) / 2,
      y: (bounds.yMin + bounds.yMax) / 2,
    };
  }
  return { x: bounds.xMin, y: bounds.yMin };
}

function rotatePoint(point, pivot, degrees) {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    ...point,
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  };
}

function selectedBounds(model, placement) {
  const mode = placement.placementBoundsMode || defaultPlacement(model).placementBoundsMode;
  if (mode === 'rawTravelBounds') return model.bounds.rawTravelBounds;
  return hasBounds(model.bounds.cutBounds) ? model.bounds.cutBounds : model.bounds.rawTravelBounds;
}

function selectedSegments(model, placement) {
  const mode = placement.placementBoundsMode || defaultPlacement(model).placementBoundsMode;
  if (mode === 'rawTravelBounds') return model.segments || [];
  const engaged = (model.segments || []).filter((segment) => segment.engaged);
  return engaged.length ? engaged : (model.segments || []);
}

function calculateBounds(segments) {
  const bounds = mutableBounds();
  for (const segment of segments) {
    addPoint(bounds, segment.from);
    addPoint(bounds, segment.to);
    (segment.points || []).forEach((point) => addPoint(bounds, point));
  }
  return finishBounds(bounds);
}

export function defaultPlacement(model = {}) {
  return {
    rotationDeg: 0,
    originAnchor: 'rawBoundsLowerLeft',
    placementBoundsMode: 'rawTravelBounds',
    normalizeToOrigin: true,
    generatedAt: null,
    generatedRunPath: null,
    generatedRunBounds: null,
    sourceFingerprint: '',
    transformFingerprint: '',
  };
}

export function normalizePlacement(model, placement = {}) {
  const next = {
    ...defaultPlacement(model),
    ...placement,
  };
  next.rotationDeg = Number(next.rotationDeg || 0);
  next.originAnchor = 'rawBoundsLowerLeft';
  next.placementBoundsMode = 'rawTravelBounds';
  next.normalizeToOrigin = true;
  return next;
}

export function transformFingerprint(placement, sourceFingerprint = '') {
  const stable = {
    sourceFingerprint,
    rotationDeg: round(placement.rotationDeg, 4),
    originAnchor: placement.originAnchor,
    placementBoundsMode: placement.placementBoundsMode,
    normalizeToOrigin: Boolean(placement.normalizeToOrigin),
  };
  return `placement:${JSON.stringify(stable)}`;
}

export function transformSafety(model) {
  const warnings = [];
  const blockers = [];
  for (const item of model.unsupportedCommands || []) {
    if (UNSAFE_COMMAND_RE.test(item.command)) {
      blockers.push(`${item.command}: ${item.message || 'transform-unsafe command'}`);
    }
  }
  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
  };
}

export function transformToolpath(model, placement = {}) {
  const resolved = normalizePlacement(model, placement);
  const baseBounds = selectedBounds(model, resolved);
  if (!hasBounds(baseBounds)) {
    return {
      placement: resolved,
      segments: [],
      generatedRunBounds: { ...EMPTY_BOUNDS },
      selectedTransformedBounds: { ...EMPTY_BOUNDS },
      warnings: ['No usable placement bounds are available.'],
    };
  }

  const pivot = anchorPoint(baseBounds, resolved.originAnchor);
  const rotated = (model.segments || []).map((segment) => ({
    ...segment,
    from: rotatePoint(segment.from, pivot, resolved.rotationDeg),
    to: rotatePoint(segment.to, pivot, resolved.rotationDeg),
    points: (segment.points || []).map((point) => rotatePoint(point, pivot, resolved.rotationDeg)),
    arc: segment.arc ? {
      ...segment.arc,
      center: rotatePoint(segment.arc.center, pivot, resolved.rotationDeg),
    } : null,
    sourceSegment: segment,
  }));

  const selectedOriginal = new Set(selectedSegments(model, resolved));
  const rotatedSelected = rotated.filter((segment) => selectedOriginal.has(segment.sourceSegment));
  const selectedRotatedBounds = calculateBounds(rotatedSelected.length ? rotatedSelected : rotated);
  const shiftAnchor = anchorPoint(selectedRotatedBounds, resolved.originAnchor);
  const shift = resolved.normalizeToOrigin ? { x: -shiftAnchor.x, y: -shiftAnchor.y } : { x: 0, y: 0 };
  const segments = rotated.map((segment) => ({
    ...segment,
    from: { ...segment.from, x: segment.from.x + shift.x, y: segment.from.y + shift.y },
    to: { ...segment.to, x: segment.to.x + shift.x, y: segment.to.y + shift.y },
    points: (segment.points || []).map((point) => ({ ...point, x: point.x + shift.x, y: point.y + shift.y })),
    arc: segment.arc ? {
      ...segment.arc,
      center: {
        ...segment.arc.center,
        x: segment.arc.center.x + shift.x,
        y: segment.arc.center.y + shift.y,
      },
    } : null,
  }));
  const selectedSegmentsAfterShift = segments.filter((segment) => selectedOriginal.has(segment.sourceSegment));
  const selectedTransformedBounds = calculateBounds(selectedSegmentsAfterShift.length ? selectedSegmentsAfterShift : segments);
  const generatedRunBounds = calculateBounds(segments);

  return {
    placement: resolved,
    pivot,
    shift,
    segments,
    generatedRunBounds,
    selectedTransformedBounds,
    warnings: transformSafety(model).warnings,
  };
}

export function generatedRunPathFor(sourcePath) {
  const base = String(sourcePath || 'job')
    .split('/')
    .pop()
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/\.(gcode|gc|nc|tap)$/i, '') || 'job';
  return `/jobs/generated/${base}.run.gc`;
}

export function generateRunGcode(model, placement = {}, options = {}) {
  const safety = transformSafety(model);
  if (!safety.ok) {
    return {
      ok: false,
      error: `Transform blocked: ${safety.blockers.join('; ')}`,
      warnings: safety.warnings,
    };
  }

  const transformed = transformToolpath(model, placement);
  const sourcePath = options.sourcePath || model.gcodePath || '';
  const sourceFingerprint = options.sourceFingerprint || '';
  const resolved = {
    ...transformed.placement,
    generatedAt: options.generatedAt || new Date().toISOString(),
    generatedRunPath: options.generatedRunPath || generatedRunPathFor(sourcePath),
    generatedRunBounds: transformed.generatedRunBounds,
    sourceFingerprint,
  };
  resolved.transformFingerprint = transformFingerprint(resolved, sourceFingerprint);

  const lines = [
    '; Generated by CNC-ESP32 browser ToolpathModel',
    `; Source: ${sourcePath || '-'}`,
    `; Rotation: ${fmt(resolved.rotationDeg)} deg`,
    `; Origin: ${resolved.originAnchor}`,
    `; Placement bounds: ${resolved.placementBoundsMode}`,
    '; Do not edit manually unless you know what you are doing',
    '; Generated transformed run file. Review preview, dry run, and arm before cutting.',
    'G21',
    'G90',
    'G17',
    'G54',
  ];

  let lastFeed = null;
  for (const segment of transformed.segments) {
    const motion = segment.type === 'arc' && segment.arc
      ? segment.arc.command
      : segment.type === 'rapid' || segment.type === 'retract' ? 'G0' : 'G1';
    const parts = [motion];
    const xyChanged = round(segment.from.x) !== round(segment.to.x) || round(segment.from.y) !== round(segment.to.y);
    if (xyChanged) {
      parts.push(`X${fmt(segment.to.x)}`);
      parts.push(`Y${fmt(segment.to.y)}`);
    }
    if (round(segment.from.z) !== round(segment.to.z)) parts.push(`Z${fmt(segment.to.z)}`);
    if ((motion === 'G2' || motion === 'G3') && segment.arc) {
      parts.push(`I${fmt(segment.arc.center.x - segment.from.x)}`);
      parts.push(`J${fmt(segment.arc.center.y - segment.from.y)}`);
    }
    if (motion !== 'G0' && Number.isFinite(segment.feed) && segment.feed !== lastFeed) {
      parts.push(`F${fmt(segment.feed)}`);
      lastFeed = segment.feed;
    }
    if (parts.length > 1) lines.push(parts.join(' '));
  }
  lines.push('M5');
  lines.push('M400');

  return {
    ok: true,
    gcode: `${lines.join('\n')}\n`,
    placement: resolved,
    transformed,
    warnings: safety.warnings,
  };
}

export function mergePlacementIntoJob(job, placement) {
  return {
    ...(job || {}),
    placement: {
      ...((job || {}).placement || {}),
      ...placement,
    },
    generatedRunPath: placement.generatedRunPath || (job || {}).generatedRunPath || null,
  };
}
