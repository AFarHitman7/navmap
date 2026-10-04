import { describe, expect, it } from 'vitest';
import { isNodeVisible, resolveFloorVisibility } from '../src/floor-visibility';

describe('zone floor visibility', () => {
  it('defaults to ground or the first floor and replaces a removed floor selection', () => {
    const zones = [{ id: 'a', name: 'A', bounds: { north: 1, south: 0, east: 1, west: 0 },
      floors: [{ z: -1, label: 'Basement' }, { z: 0, label: 'Ground' }] },
    { id: 'b', name: 'B', bounds: { north: 1, south: 0, east: 1, west: 0 }, floors: [{ z: 2, label: 'Second' }] }];
    expect(resolveFloorVisibility(zones, {})).toEqual({ a: 0, b: 2 });
    expect(resolveFloorVisibility(zones, { a: 1, b: 'hidden' })).toEqual({ a: 0, b: 'hidden' });
    expect(resolveFloorVisibility(zones, { a: 'all', b: 2 })).toEqual({ a: 'all', b: 2 });
  });

  it('allows an explicit all-floors view while keeping outdoors independently hidden', () => {
    expect(isNodeVisible({ zoneId: 'a', z: -1 }, { a: 'all' }, false)).toBe(true);
    expect(isNodeVisible({ zoneId: 'a', z: 0 }, { a: 'hidden' })).toBe(false);
    expect(isNodeVisible({ zoneId: null, z: 0 }, { a: 'all' }, false)).toBe(false);
  });
});
