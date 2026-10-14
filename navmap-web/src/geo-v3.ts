import type { BoundsV3 } from './contract-v3';

export const INDIA_INITIAL_VIEW: BoundsV3 = {
  north: 37.5,
  south: 6.7,
  east: 97.5,
  west: 68,
};

export function boundsFromCorners(a: { lat: number; lng: number }, b: { lat: number; lng: number }): BoundsV3 {
  const bounds = {
    north: Math.max(a.lat, b.lat),
    south: Math.min(a.lat, b.lat),
    east: Math.max(a.lng, b.lng),
    west: Math.min(a.lng, b.lng),
  };
  if (!(bounds.north > bounds.south && bounds.east > bounds.west)) {
    throw new Error('Draw a rectangle with a positive area, not a line or point.');
  }
  return bounds;
}

export function containsPoint(b: BoundsV3, lat: number, lng: number): boolean {
  return lat <= b.north && lat >= b.south && lng <= b.east && lng >= b.west;
}

export function containsBounds(outer: BoundsV3, inner: BoundsV3): boolean {
  return inner.north <= outer.north && inner.south >= outer.south && inner.east <= outer.east && inner.west >= outer.west;
}

/** Positive-area overlap only; touching edges return false. */
export function rectsOverlap(a: BoundsV3, b: BoundsV3): boolean {
  return a.south < b.north && b.south < a.north && a.west < b.east && b.west < a.east;
}

export type LocalBoundsV3 = { left: number; top: number; right: number; bottom: number };

/** Local (unit source-pixel space) containment for static frames. */
export function containsLocalPoint(b: LocalBoundsV3, x: number, y: number): boolean {
  return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
}

export function containsLocalBounds(outer: LocalBoundsV3, inner: LocalBoundsV3): boolean {
  return inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
}

/** Positive-area overlap only; touching edges return false. */
export function localRectsOverlap(a: LocalBoundsV3, b: LocalBoundsV3): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLa = ((bLat - aLat) * Math.PI) / 180;
  const dLo = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLa / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
