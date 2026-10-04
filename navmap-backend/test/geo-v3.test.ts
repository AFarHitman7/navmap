import { describe, expect, it } from 'vitest';
import {
  containsBounds,
  containsPoint,
  distanceMeters,
  rectsOverlap,
} from '../src/geo-v3.js';

const B = { north: 13.1, south: 13.0, east: 80.3, west: 80.2 };

describe('geo-v3', () => {
  it('contains interior point but not exterior', () => {
    expect(containsPoint(B, 13.05, 80.25)).toBe(true);
    expect(containsPoint(B, 13.2, 80.25)).toBe(false);
    expect(containsPoint(B, 13.05, 80.5)).toBe(false);
  });

  it('detects containment and overlap', () => {
    const inner = { north: 13.08, south: 13.02, east: 80.28, west: 80.22 };
    expect(containsBounds(B, inner)).toBe(true);
    expect(containsBounds(inner, B)).toBe(false);
    expect(rectsOverlap(inner, { north: 13.05, south: 13.01, east: 80.26, west: 80.2 })).toBe(true);
    expect(rectsOverlap(inner, { north: 12.9, south: 12.8, east: 80.1, west: 80.0 })).toBe(false);
  });

  it('touching edges do not count as positive-area overlap', () => {
    const a = { north: 13.06, south: 13.0, east: 80.25, west: 80.2 };
    const b = { north: 13.06, south: 13.0, east: 80.3, west: 80.25 };
    expect(rectsOverlap(a, b)).toBe(false);
  });

  it('measures ~111m per 0.001deg latitude', () => {
    const d = distanceMeters(13.0, 80.25, 13.001, 80.25);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(125);
  });
});
