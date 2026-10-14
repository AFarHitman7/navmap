// v3 geo helpers (ports navmap-backend/src/geo-v3.ts). Pure math, no Node APIs.
import type { BoundsV3 } from './contract-v3';

export type Bounds = BoundsV3;

export function containsPoint(b: Bounds, lat: number, lng: number): boolean {
  return lat <= b.north && lat >= b.south && lng <= b.east && lng >= b.west;
}

export function containsBounds(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.north <= outer.north &&
    inner.south >= outer.south &&
    inner.east <= outer.east &&
    inner.west >= outer.west
  );
}

/** Positive-area overlap only; touching edges return false. */
export function rectsOverlap(a: Bounds, b: Bounds): boolean {
  return a.south < b.north && b.south < a.north && a.west < b.east && b.west < a.east;
}

export type LocalBounds = { left: number; top: number; right: number; bottom: number };

/** Local (unit source-pixel space) containment for static frames. Pure TS. */
export function containsLocalPoint(b: LocalBounds, x: number, y: number): boolean {
  return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
}

/** Positive-area overlap only; touching edges return false. */
export function localRectsOverlap(a: LocalBounds, b: LocalBounds): boolean {
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
