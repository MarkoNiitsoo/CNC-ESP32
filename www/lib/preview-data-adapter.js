import {
  buildPreviewMetadata,
  getToolpathWarnings,
  mergePreviewMetadata,
} from './toolpath-model.js';

function boundsAvailable(bounds) {
  return bounds && Number.isFinite(bounds.xMin) && Number.isFinite(bounds.xMax) &&
    Number.isFinite(bounds.yMin) && Number.isFinite(bounds.yMax);
}

function toLegacyBounds(model) {
  return boundsAvailable(model.bounds.rawTravelBounds)
    ? model.bounds.rawTravelBounds
    : model.bounds.placementBounds;
}

function legacySegments(model) {
  return (model.segments || []).map((segment) => ({
    from: { ...segment.from },
    to: { ...segment.to },
    rapid: segment.type === 'rapid' || segment.type === 'retract',
    feedrate: segment.feed,
    type: segment.type,
    engaged: segment.engaged,
    lineNumber: segment.lineNumber,
    source: segment.source,
    points: (segment.points || []).map((point) => ({ ...point })),
    arc: segment.arc ? { ...segment.arc, center: { ...segment.arc.center } } : null,
  }));
}

function legacyAnalysis(model) {
  const unsupported = model.unsupportedCommands || [];
  return {
    hasG20: model.modal.units === 'G20',
    hasG21: model.modal.units === 'G21',
    hasG90: model.modal.positioning === 'G90',
    hasG91: unsupported.some((item) => item.command === 'G91'),
    hasG54: model.modal.workspace === 'G54' ||
      (model.warnings || []).some((warning) => warning.code === 'default-workspace'),
    hasZ: (model.segments || []).some((segment) => segment.from.z !== segment.to.z),
    hasSpindleOn: (model.warnings || []).some((warning) => warning.code === 'spindle-on'),
    hasSpindleOff: false,
    nonDefaultWorkspaceCommands: unsupported
      .filter((item) => /^G5[5-9](?:\.[1-3])?$/.test(item.command))
      .map((item) => item.command),
    unsupportedTotal: unsupported.length,
    arcSkipped: 0,
    arcApproximated: 0,
    fatalErrors: 0,
    feeds: {
      minFeed: model.feed.min,
      maxFeed: model.feed.max,
      feedCommandCount: model.feed.commandCount,
    },
  };
}

export function adaptToolpathForPreview(model) {
  return {
    bounds: toLegacyBounds(model),
    toolpathBounds: {
      rawTravelBounds: model.bounds.rawTravelBounds,
      cutBounds: model.bounds.cutBounds,
      placementBounds: model.bounds.placementBounds,
    },
    parsedLines: model.source.lineCount,
    segments: legacySegments(model),
    warnings: getToolpathWarnings(model),
    warningGroups: groupToolpathWarnings(model),
    analysis: legacyAnalysis(model),
    feedStats: { ...model.feed },
    estimate: { ...model.estimate },
    toolpathModel: model,
  };
}

export function groupToolpathWarnings(model) {
  const groups = {
    workspace: [],
    unsupported: [],
    transformSensitive: [],
    arcs: [],
    coordinates: [],
    general: [],
  };

  for (const warning of model.warnings || []) {
    const message = warning.message || String(warning);
    if (warning.code === 'default-workspace' || message.includes('workspace')) groups.workspace.push(message);
    else if (warning.code === 'arc-approximated' || warning.code === 'arc-invalid') groups.arcs.push(message);
    else if (warning.code === 'inch-mode') groups.coordinates.push(message);
    else if (warning.code === 'cut-bounds-uncertain') groups.general.push(message);
    else groups.general.push(message);
  }

  for (const item of model.unsupportedCommands || []) {
    const message = item.message || `${item.command} unsupported`;
    groups.unsupported.push(message);
    if (/^(G91|G53|G92|G18|G19|G4[12]|G8[0-9])$/.test(item.command) ||
        /^G5[5-9](?:\.[1-3])?$/.test(item.command)) {
      groups.transformSensitive.push(message);
    }
  }

  return groups;
}

export function buildPreviewSummaryData(model, feedOverride = {}) {
  const metadata = buildPreviewMetadata(model);
  const raw = model.bounds.rawTravelBounds;
  const cut = model.bounds.cutBounds;
  const placement = model.bounds.placementBounds;
  const infos = [];
  const negatives = [raw, cut, placement]
    .filter(boundsAvailable)
    .flatMap((bounds) => [bounds.xMin, bounds.yMin])
    .filter((value) => Number.isFinite(value) && value < 0);

  if (!boundsAvailable(cut)) {
    infos.push('Cut bounds not available; using raw travel bounds.');
  }
  if (boundsAvailable(raw) && boundsAvailable(cut) &&
      (Math.abs(raw.xMin - cut.xMin) > 1 || Math.abs(raw.xMax - cut.xMax) > 1 ||
       Math.abs(raw.yMin - cut.yMin) > 1 || Math.abs(raw.yMax - cut.yMax) > 1)) {
    infos.push('This file has travel/parking moves outside the cutting area.');
  }
  if (negatives.length > 0) {
    infos.push('Small negative coordinates are present. Future action: Fix Origin / normalize to bounds.');
  }

  return {
    metadata,
    rawTravelBounds: raw,
    cutBounds: cut,
    placementBounds: placement,
    warningGroups: groupToolpathWarnings(model),
    feed: model.feed,
    estimate: model.estimate,
    effectiveEstimateSeconds: feedOverride.startPercent
      ? model.estimate.nominalSeconds * 100 / Number(feedOverride.startPercent)
      : model.estimate.effectiveSecondsWithOverride,
    infos,
  };
}

export function mergePreviewIntoJob(job, model, thumbnailPath = null) {
  return mergePreviewMetadata(job, buildPreviewMetadata(model), thumbnailPath || job?.thumbnailPath || null);
}
