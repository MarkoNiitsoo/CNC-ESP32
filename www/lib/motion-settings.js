export const MOTION_SETTINGS_KEY = 'lowrider.motionSettings';
export const DEFAULT_TRAVEL_SPEED_MM_S = 50;
export const MIN_TRAVEL_SPEED_MM_S = 10;
export const MAX_TRAVEL_SPEED_MM_S = 100;

export function parseMarlinMaxFeedrates(response = '') {
  const line = String(response).split(/\r?\n/).find((item) => /(?:^|\s)M203(?:\s|$)/i.test(item));
  if (!line) return null;
  const axis = (letter) => {
    const match = line.match(new RegExp(`(?:^|\\s)${letter}(-?\\d+(?:\\.\\d+)?)`, 'i'));
    const value = Number(match?.[1]);
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  const result = { x: axis('X'), y: axis('Y'), z: axis('Z') };
  if (!result.x || !result.y) return null;
  return result;
}

export function parseMarlinStepsPerMm(response = '') {
  const line = String(response).split(/\r?\n/).find((item) => /(?:^|\s)M92(?:\s|$)/i.test(item));
  if (!line) return null;
  const axis = (letter) => {
    const match = line.match(new RegExp(`(?:^|\\s)${letter}(-?\\d+(?:\\.\\d+)?)`, 'i'));
    const value = Number(match?.[1]);
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  const result = { x: axis('X'), y: axis('Y'), z: axis('Z') };
  return result.x && result.y && result.z ? result : null;
}

export function machinePositionFromCounts(counts = {}, stepsPerMm = {}) {
  const position = {};
  for (const axis of ['x', 'y', 'z']) {
    const count = Number(counts?.[axis]);
    const steps = Number(stepsPerMm?.[axis]);
    position[axis] = Number.isFinite(count) && Number.isFinite(steps) && steps > 0 ? count / steps : null;
  }
  return Object.values(position).every(Number.isFinite) ? position : null;
}

export function buildMachineReference(capture = {}, m503Response = '', capturedAt = new Date().toISOString()) {
  const stepsPerMm = parseMarlinStepsPerMm(m503Response);
  const position = machinePositionFromCounts(capture?.counts, stepsPerMm);
  if (!stepsPerMm || !position) return null;
  return {
    source: 'M114 counts + M503 M92',
    capturedAt,
    counts: { ...capture.counts },
    stepsPerMm,
    position,
  };
}

export function travelSpeedUpperLimit(settings = {}) {
  const detected = Math.min(Number(settings.marlinMaxFeedrates?.x), Number(settings.marlinMaxFeedrates?.y));
  return Number.isFinite(detected) && detected > 0
    ? Math.max(MIN_TRAVEL_SPEED_MM_S, Math.min(MAX_TRAVEL_SPEED_MM_S, Math.floor(detected)))
    : MAX_TRAVEL_SPEED_MM_S;
}

export function normalizeTravelSpeed(value, maximum = MAX_TRAVEL_SPEED_MM_S) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_TRAVEL_SPEED_MM_S;
  return Math.max(MIN_TRAVEL_SPEED_MM_S, Math.min(maximum, Math.round(number)));
}

export function loadMotionSettings(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(MOTION_SETTINGS_KEY) || 'null');
    const settings = {
      travelSpeedMmS: saved?.travelSpeedMmS,
      marlinMaxFeedrates: saved?.marlinMaxFeedrates || null,
    };
    settings.travelSpeedMmS = normalizeTravelSpeed(settings.travelSpeedMmS, travelSpeedUpperLimit(settings));
    return settings;
  } catch (err) {
    return { travelSpeedMmS: DEFAULT_TRAVEL_SPEED_MM_S, marlinMaxFeedrates: null };
  }
}

export function saveMotionSettings(settings = {}, storage = globalThis.localStorage) {
  const current = loadMotionSettings(storage);
  const normalized = {
    ...current,
    ...settings,
    marlinMaxFeedrates: settings.marlinMaxFeedrates === undefined
      ? current.marlinMaxFeedrates
      : settings.marlinMaxFeedrates,
  };
  normalized.travelSpeedMmS = normalizeTravelSpeed(normalized.travelSpeedMmS, travelSpeedUpperLimit(normalized));
  storage?.setItem(MOTION_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

export function travelFeedMmMin(settings = {}) {
  return normalizeTravelSpeed(settings.travelSpeedMmS, travelSpeedUpperLimit(settings)) * 60;
}
