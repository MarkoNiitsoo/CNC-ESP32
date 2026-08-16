// Shared verification for physical zero transactions.
//
// HTTP zero responses carry raw Marlin M114 before/after text; WebSocket
// commandResults carry only { commandId, ok, code, message }. When the M114
// text is unavailable (WS path), the socket-confirmed machine frame's work
// coordinates are the authoritative verification source: a zeroed axis reads
// ~0 in work coordinates immediately after the G92 transaction.

const ZERO_TOLERANCE_MM = 0.02;

function axisList(axes) {
  if (Array.isArray(axes)) return axes;
  if (axes === 'x' || axes === 'y' || axes === 'z') return [axes];
  return ['x', 'y', 'z'];
}

export function zeroAxesVerified({ afterPosition = null, frame = null, axes = 'xyz' } = {}) {
  const list = axisList(axes);
  const hasAfterText = afterPosition != null &&
    list.every((axis) => Number.isFinite(Number(afterPosition[axis])));
  if (hasAfterText) {
    return {
      confirmed: list.every((axis) => Math.abs(Number(afterPosition[axis])) <= ZERO_TOLERANCE_MM),
      source: 'marlin-after',
    };
  }
  const work = frame?.work ?? frame?.position?.work ?? null;
  if (work && list.every((axis) => Number.isFinite(Number(work[axis])))) {
    return {
      confirmed: list.every((axis) => Math.abs(Number(work[axis])) <= ZERO_TOLERANCE_MM),
      source: 'socket-frame-work',
    };
  }
  return { confirmed: false, source: 'unavailable' };
}

export function zeroReferenceCounts({ before = null, frame = null } = {}) {
  const counts = before?.counts;
  if (counts && Object.values(counts).some((value) => Number.isFinite(Number(value)))) {
    return { ...counts };
  }
  return { ...(frame?.homeReference?.counts || {}) };
}
