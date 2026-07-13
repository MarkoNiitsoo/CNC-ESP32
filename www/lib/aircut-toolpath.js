const DEFAULT_PRECISION_MM = 0.001;

function numberKey(value, precision) {
  if (!Number.isFinite(Number(value))) return '?';
  return String(Math.round(Number(value) / precision));
}

function pointKey(point, precision) {
  return `${numberKey(point?.x, precision)},${numberKey(point?.y, precision)}`;
}

function orderedPairKey(first, second) {
  return first < second ? `${first}>${second}` : `${second}>${first}`;
}

function hasXyMotion(segment) {
  if (segment?.type === 'arc' && segment.arc?.center) return true;
  return Number(segment?.from?.x) !== Number(segment?.to?.x) ||
    Number(segment?.from?.y) !== Number(segment?.to?.y);
}

function arcGeometryKey(segment, precision) {
  const arc = segment.arc;
  const start = pointKey(segment.from, precision);
  const end = pointKey(segment.to, precision);
  const center = pointKey(arc.center, precision);
  const radius = Number.isFinite(Number(arc.radius))
    ? Number(arc.radius)
    : Math.hypot(segment.from.x - arc.center.x, segment.from.y - arc.center.y);
  const sweep = Math.abs(Number(arc.sweepRadians));
  const startAngle = Math.atan2(segment.from.y - arc.center.y, segment.from.x - arc.center.x);
  const middleAngle = startAngle + Number(arc.sweepRadians) / 2;
  const middle = pointKey({
    x: arc.center.x + Math.cos(middleAngle) * radius,
    y: arc.center.y + Math.sin(middleAngle) * radius,
  }, precision);
  return `A:${orderedPairKey(start, end)}:${center}:${middle}:${numberKey(radius, precision)}:${numberKey(sweep, 0.000001)}`;
}

function segmentGeometryKey(segment, precision) {
  if (segment?.type === 'arc' && segment.arc?.center && Number.isFinite(Number(segment.arc.sweepRadians))) {
    return arcGeometryKey(segment, precision);
  }
  return `L:${orderedPairKey(pointKey(segment?.from, precision), pointKey(segment?.to, precision))}`;
}

function passGeometryKey(segments, precision) {
  return segments.map((segment) => segmentGeometryKey(segment, precision)).sort().join('|');
}

function passZKey(segments, precision) {
  return segments.map((segment) => orderedPairKey(
    numberKey(segment?.from?.z, precision),
    numberKey(segment?.to?.z, precision),
  )).sort().join('|');
}

export function collapseRepeatedStepdownPasses(segments, options = {}) {
  const precision = Math.max(0.000001, Number(options.precisionMm) || DEFAULT_PRECISION_MM);
  const selected = [];
  const seenProfiles = new Map();
  let pendingTravel = [];
  let activePass = [];
  let skippedPasses = 0;
  let skippedSegments = 0;
  let keptPasses = 0;

  const flushPass = () => {
    if (!activePass.length) return;
    const geometry = passGeometryKey(activePass, precision);
    const zProfile = passZKey(activePass, precision);
    const profiles = seenProfiles.get(geometry) || new Set();
    const repeatedAtAnotherZ = profiles.size > 0 && !profiles.has(zProfile);
    profiles.add(zProfile);
    seenProfiles.set(geometry, profiles);

    if (repeatedAtAnotherZ) {
      skippedPasses += 1;
      skippedSegments += activePass.length;
      pendingTravel = [];
    } else {
      selected.push(...pendingTravel, ...activePass);
      pendingTravel = [];
      keptPasses += 1;
    }
    activePass = [];
  };

  for (const segment of segments || []) {
    const xyMotion = hasXyMotion(segment);
    if (xyMotion && segment?.engaged === true) {
      activePass.push(segment);
      continue;
    }
    flushPass();
    if (xyMotion) pendingTravel.push(segment);
  }
  flushPass();
  selected.push(...pendingTravel);

  return {
    segments: selected,
    skippedPasses,
    skippedSegments,
    keptPasses,
  };
}
