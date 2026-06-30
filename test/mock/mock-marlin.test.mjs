import { describe, expect, it } from 'vitest';
import { MockMarlin } from '../../dev/mock-marlin.mjs';

describe('MockMarlin', () => {
  it('reports firmware, position, and G92 work zero', () => {
    const marlin = new MockMarlin();
    expect(marlin.execute('M115').response).toContain('MockMarlin');
    expect(marlin.execute('G0 X20 Y30 Z10').ok).toBe(true);
    expect(marlin.execute('M114').response).toContain('X:20.0000 Y:30.0000 Z:10.0000');
    marlin.execute('G92 X0 Y0 Z0');
    expect(marlin.execute('M114').response).toContain('X:0.0000 Y:0.0000 Z:0.0000');
  });

  it('tracks movement, M5, and feed override', () => {
    const marlin = new MockMarlin();
    marlin.execute('M3');
    expect(marlin.spindleOff).toBe(false);
    marlin.execute('M5');
    expect(marlin.spindleOff).toBe(true);
    marlin.execute('M220 S75');
    expect(marlin.feedOverride).toBe(75);
    marlin.execute('G91');
    marlin.execute('G0 X5 Y4 F600');
    expect(marlin.position).toMatchObject({ x: 5, y: 4 });
  });

  it('rejects soft-limit, G53, and unapproved homing moves', () => {
    const marlin = new MockMarlin();
    expect(marlin.execute('G0 X1700').error).toMatch(/soft limit/);
    expect(marlin.execute('G53 G0 X0').error).toMatch(/G53/);
    expect(marlin.execute('G28').error).toMatch(/G28/);
  });

  it('allows an explicit internal G53 move without changing the G92 work offset', () => {
    const marlin = new MockMarlin({ machine: { zMax: 70 } });
    marlin.execute('G0 Z40');
    marlin.execute('G92 Z0');
    expect(marlin.execute('G53 G0 Z70', { allowMachineCoordinates: true }).ok).toBe(true);
    expect(marlin.machinePosition.z).toBe(70);
    expect(marlin.position.z).toBe(30);
  });
});
