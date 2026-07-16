export const DEFAULT_TOOL_CHANGE_SETTINGS = Object.freeze({
  handling: 'pause',
  parkMachineX: 0,
  parkMachineY: 0,
  parkMachineZ: 70,
  zZeroMethod: 'manual',
  touchPlateEnabled: false,
  touchPlateThickness: 15,
  touchPlateProbeDistance: 30,
  touchPlateProbeFeed: 100,
  touchPlateRetractDistance: 3,
});

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeToolChangeSettings(settings = {}) {
  const handling = settings.handling === 'park' ? 'park' : 'pause';
  const touchPlateEnabled = settings.touchPlateEnabled === true;
  const requestedZMethod = settings.zZeroMethod === 'touchplate' ? 'touchplate' : 'manual';
  return {
    handling,
    parkMachineX: finite(settings.parkMachineX, DEFAULT_TOOL_CHANGE_SETTINGS.parkMachineX),
    parkMachineY: finite(settings.parkMachineY, DEFAULT_TOOL_CHANGE_SETTINGS.parkMachineY),
    parkMachineZ: finite(settings.parkMachineZ, DEFAULT_TOOL_CHANGE_SETTINGS.parkMachineZ),
    zZeroMethod: requestedZMethod === 'touchplate' && touchPlateEnabled ? 'touchplate' : 'manual',
    touchPlateEnabled,
    touchPlateThickness: Math.max(0.01, finite(settings.touchPlateThickness, DEFAULT_TOOL_CHANGE_SETTINGS.touchPlateThickness)),
    touchPlateProbeDistance: Math.max(0.1, finite(settings.touchPlateProbeDistance, DEFAULT_TOOL_CHANGE_SETTINGS.touchPlateProbeDistance)),
    touchPlateProbeFeed: Math.max(1, finite(settings.touchPlateProbeFeed, DEFAULT_TOOL_CHANGE_SETTINGS.touchPlateProbeFeed)),
    touchPlateRetractDistance: Math.max(0.1, finite(settings.touchPlateRetractDistance, DEFAULT_TOOL_CHANGE_SETTINGS.touchPlateRetractDistance)),
  };
}

export function touchPlateAvailable(settings = {}) {
  return normalizeToolChangeSettings(settings).touchPlateEnabled;
}
