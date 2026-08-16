import { describe, expect, it } from 'vitest';
import { zeroAxesVerified, zeroReferenceCounts } from '../../www/lib/zero-verification.js';

describe('zero transaction verification', () => {
  it('verifies from Marlin after-text when the HTTP response provides it', () => {
    expect(zeroAxesVerified({
      afterPosition: { x: 0.001, y: -0.01, z: 0 },
      axes: 'xyz',
    })).toMatchObject({ confirmed: true, source: 'marlin-after' });

    expect(zeroAxesVerified({
      afterPosition: { x: 0.5, y: 0, z: 0 },
      axes: 'xyz',
    })).toMatchObject({ confirmed: false, source: 'marlin-after' });
  });

  it('verifies per-axis zeroing from Marlin after-text', () => {
    expect(zeroAxesVerified({
      afterPosition: { x: 0, y: 2.7, z: -1 },
      axes: 'x',
    })).toMatchObject({ confirmed: true, source: 'marlin-after' });
    // Y was not zeroed and must fail when asked.
    expect(zeroAxesVerified({
      afterPosition: { x: 0, y: 2.7, z: -1 },
      axes: 'y',
    })).toMatchObject({ confirmed: false, source: 'marlin-after' });
  });

  it('falls back to the socket-confirmed frame work coordinates for WS commandResults', () => {
    // WS commandResults carry only {commandId, ok, code, message}: no M114 text.
    const frame = {
      work: { x: 0.005, y: -0.01, z: 0 },
      workZeroMachine: { x: 2, y: 3, z: 4 },
    };
    expect(zeroAxesVerified({ afterPosition: null, frame, axes: 'xyz' }))
      .toMatchObject({ confirmed: true, source: 'socket-frame-work' });
    expect(zeroAxesVerified({ afterPosition: {}, frame, axes: 'xyz' }))
      .toMatchObject({ confirmed: true, source: 'socket-frame-work' });
  });

  it('also accepts the machine-slice position.work shape used by telemetry slices', () => {
    const frame = { position: { work: { x: 0, y: 0, z: 0.02 } } };
    expect(zeroAxesVerified({ frame, axes: 'xyz' }))
      .toMatchObject({ confirmed: true, source: 'socket-frame-work' });
  });

  it('rejects when neither Marlin text nor frame work coordinates are available', () => {
    expect(zeroAxesVerified({ afterPosition: null, frame: null, axes: 'xyz' }))
      .toMatchObject({ confirmed: false, source: 'unavailable' });
    expect(zeroAxesVerified({ afterPosition: null, frame: {}, axes: 'xyz' }))
      .toMatchObject({ confirmed: false, source: 'unavailable' });
    expect(zeroAxesVerified({
      afterPosition: null,
      frame: { work: { x: 0, y: Number.NaN, z: 0 } },
      axes: 'xyz',
    })).toMatchObject({ confirmed: false, source: 'unavailable' });
  });

  it('fails a non-zero work coordinate in the frame fallback', () => {
    expect(zeroAxesVerified({
      frame: { work: { x: 0, y: 0, z: 1.4 } },
      axes: 'xyz',
    })).toMatchObject({ confirmed: false, source: 'socket-frame-work' });
  });

  it('prefers Marlin before-counts and falls back to the frame home reference', () => {
    const before = { counts: { x: 100, y: 200, z: 300 } };
    expect(zeroReferenceCounts({ before, frame: null })).toEqual({ x: 100, y: 200, z: 300 });
    expect(zeroReferenceCounts({
      before: { counts: {} },
      frame: { homeReference: { counts: { x: 11, y: 22, z: 33 }, stepsPerMm: { x: 80 } } },
    })).toEqual({ x: 11, y: 22, z: 33 });
    expect(zeroReferenceCounts({ before: null, frame: null })).toEqual({});
  });
});
