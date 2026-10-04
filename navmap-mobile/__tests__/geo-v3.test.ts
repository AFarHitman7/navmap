import { containsBounds, containsPoint, distanceMeters, rectsOverlap } from '../src/geo';

const outer = { north: 13.1, south: 13.0, east: 80.3, west: 80.2 };
const inner = { north: 13.07, south: 13.03, east: 80.26, west: 80.23 };

test('containsPoint includes edges, excludes outside', () => {
  expect(containsPoint(outer, 13.05, 80.25)).toBe(true);
  expect(containsPoint(outer, 13.1, 80.2)).toBe(true); // boundary edges count
  expect(containsPoint(outer, 13.2, 80.25)).toBe(false);
  expect(containsPoint(outer, 13.05, 80.4)).toBe(false);
});

test('containsBounds and rectsOverlap semantics', () => {
  expect(containsBounds(outer, inner)).toBe(true);
  expect(containsBounds(inner, outer)).toBe(false);
  expect(rectsOverlap(outer, inner)).toBe(true);
  // Touching edges share no positive area.
  const east = { north: 13.1, south: 13.0, east: 80.4, west: 80.3 };
  expect(rectsOverlap(outer, east)).toBe(false);
  const far = { north: 14.1, south: 14.0, east: 81.3, west: 81.2 };
  expect(rectsOverlap(outer, far)).toBe(false);
});

test('distanceMeters is zero for the same point and ~111m per 0.001 deg latitude', () => {
  expect(distanceMeters(13.05, 80.25, 13.05, 80.25)).toBe(0);
  const d = distanceMeters(13.05, 80.25, 13.051, 80.25);
  expect(d).toBeGreaterThan(100);
  expect(d).toBeLessThan(125);
});
