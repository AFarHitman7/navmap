import { describe, expect, it } from 'vitest';
import { boundsFromCorners, INDIA_INITIAL_VIEW } from '../src/geo-v3';

describe('boundsFromCorners', () => {
  it('builds N/S/E/W bounds regardless of drag direction', () => {
    expect(boundsFromCorners({ lat: 10, lng: 20 }, { lat: 12, lng: 25 })).toEqual({
      north: 12,
      south: 10,
      east: 25,
      west: 20,
    });
    expect(boundsFromCorners({ lat: 12, lng: 25 }, { lat: 10, lng: 20 })).toEqual({
      north: 12,
      south: 10,
      east: 25,
      west: 20,
    });
  });

  it('rejects degenerate rectangles', () => {
    expect(() => boundsFromCorners({ lat: 10, lng: 20 }, { lat: 10, lng: 25 })).toThrow();
    expect(() => boundsFromCorners({ lat: 10, lng: 20 }, { lat: 12, lng: 20 })).toThrow();
  });
});

describe('INDIA_INITIAL_VIEW', () => {
  it('frames India as a viewing position only', () => {
    expect(INDIA_INITIAL_VIEW.north).toBeGreaterThan(INDIA_INITIAL_VIEW.south);
    expect(INDIA_INITIAL_VIEW.east).toBeGreaterThan(INDIA_INITIAL_VIEW.west);
    expect(INDIA_INITIAL_VIEW.south).toBeGreaterThanOrEqual(5);
    expect(INDIA_INITIAL_VIEW.north).toBeLessThanOrEqual(40);
    expect(INDIA_INITIAL_VIEW.west).toBeGreaterThanOrEqual(65);
    expect(INDIA_INITIAL_VIEW.east).toBeLessThanOrEqual(100);
  });
});
