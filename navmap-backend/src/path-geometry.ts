import { distanceMeters } from './geo-v3.js';

export type GeoPoint = { lat: number; lng: number };
export type LocalPoint = { x: number; y: number };
export type SegmentIntersection =
  | { kind: 'point'; point: GeoPoint; aFraction: number; bFraction: number }
  | { kind: 'overlap' }
  | null;
export type LocalSegmentIntersection =
  | { kind: 'point'; point: LocalPoint; aFraction: number; bFraction: number }
  | { kind: 'overlap' }
  | null;

const EARTH_METERS_PER_DEGREE = 111_320;
const GEOGRAPHIC_EQUALITY_TOLERANCE_METERS = 0.01;
/** Local equality tolerance in unit coordinates (~1 source pixel at 1000px). */
export const LOCAL_EQUALITY_TOLERANCE = 0.001;

type PlanePoint = { x: number; y: number };

export function intersectSegments(a: GeoPoint, b: GeoPoint, c: GeoPoint, d: GeoPoint): SegmentIntersection {
  assertFinitePoint(a);
  assertFinitePoint(b);
  assertFinitePoint(c);
  assertFinitePoint(d);
  const aLength = assertFinitePositiveSegmentLength(a, b);
  const bLength = assertFinitePositiveSegmentLength(c, d);

  const projector = createProjector(a, b, c, d);
  const pa = projector.toPlane(a);
  const pb = projector.toPlane(b);
  const pc = projector.toPlane(c);
  const pd = projector.toPlane(d);
  const r = subtract(pb, pa);
  const s = subtract(pd, pc);
  const qMinusP = subtract(pc, pa);
  const denominator = cross(r, s);
  const aTolerance = fractionTolerance(aLength);
  const bTolerance = fractionTolerance(bLength);

  if (Math.abs(denominator) <= GEOGRAPHIC_EQUALITY_TOLERANCE_METERS ** 2) {
    if (Math.abs(cross(qMinusP, r)) > GEOGRAPHIC_EQUALITY_TOLERANCE_METERS * aLength) return null;
    return intersectCollinear(a, b, c, d, pa, r, aLength, aTolerance, bTolerance);
  }

  const aFraction = cross(qMinusP, s) / denominator;
  const bFraction = cross(qMinusP, r) / denominator;
  if (!withinSegmentFraction(aFraction, aTolerance) || !withinSegmentFraction(bFraction, bTolerance)) return null;

  const clampedA = clampSegmentFraction(aFraction, aTolerance);
  const clampedB = clampSegmentFraction(bFraction, bTolerance);
  return { kind: 'point', point: interpolate(a, b, clampedA), aFraction: clampedA, bFraction: clampedB };
}

function intersectCollinear(
  a: GeoPoint,
  b: GeoPoint,
  c: GeoPoint,
  d: GeoPoint,
  pa: PlanePoint,
  r: PlanePoint,
  aLength: number,
  aTolerance: number,
  bTolerance: number,
): SegmentIntersection {
  const projector = createProjector(a, b, c, d);
  const pc = projector.toPlane(c);
  const pd = projector.toPlane(d);
  const rr = dot(r, r);
  const cFraction = dot(subtract(pc, pa), r) / rr;
  const dFraction = dot(subtract(pd, pa), r) / rr;
  const start = Math.max(0, Math.min(cFraction, dFraction));
  const end = Math.min(1, Math.max(cFraction, dFraction));

  if ((end - start) * aLength > GEOGRAPHIC_EQUALITY_TOLERANCE_METERS) return { kind: 'overlap' };
  if (end < -aTolerance || start > 1 + aTolerance) return null;

  const aFraction = clampSegmentFraction((start + end) / 2, aTolerance);
  const point = interpolate(a, b, aFraction);
  const bFraction = fractionAlongSegment(c, d, point);
  if (!withinSegmentFraction(bFraction, bTolerance)) return null;
  return { kind: 'point', point, aFraction, bFraction: clampSegmentFraction(bFraction, bTolerance) };
}

function createProjector(...points: GeoPoint[]) {
  const originLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const lngScale = Math.cos((originLat * Math.PI) / 180) * EARTH_METERS_PER_DEGREE;
  return {
    toPlane(point: GeoPoint): PlanePoint {
      return { x: point.lng * lngScale, y: point.lat * EARTH_METERS_PER_DEGREE };
    },
  };
}

function assertFinitePoint(point: GeoPoint): void {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) throw new Error('Path segment coordinates must be finite.');
}

function assertFinitePositiveSegmentLength(a: GeoPoint, b: GeoPoint): number {
  const length = distanceMeters(a.lat, a.lng, b.lat, b.lng);
  if (!Number.isFinite(length) || length <= 0) throw new Error('Path segments must have a positive finite length.');
  return length;
}

function fractionTolerance(length: number): number {
  return GEOGRAPHIC_EQUALITY_TOLERANCE_METERS / length;
}

function withinSegmentFraction(fraction: number, tolerance: number): boolean {
  return fraction >= -tolerance && fraction <= 1 + tolerance;
}

function clampSegmentFraction(fraction: number, tolerance: number): number {
  if (Math.abs(fraction) <= tolerance) return 0;
  if (Math.abs(fraction - 1) <= tolerance) return 1;
  return fraction;
}

function interpolate(a: GeoPoint, b: GeoPoint, fraction: number): GeoPoint {
  return { lat: a.lat + (b.lat - a.lat) * fraction, lng: a.lng + (b.lng - a.lng) * fraction };
}

function fractionAlongSegment(a: GeoPoint, b: GeoPoint, point: GeoPoint): number {
  const projector = createProjector(a, b, point);
  const pa = projector.toPlane(a);
  const pb = projector.toPlane(b);
  const pp = projector.toPlane(point);
  const segment = subtract(pb, pa);
  return dot(subtract(pp, pa), segment) / dot(segment, segment);
}

function subtract(a: PlanePoint, b: PlanePoint): PlanePoint {
  return { x: a.x - b.x, y: a.y - b.y };
}
function cross(a: PlanePoint, b: PlanePoint): number {
  return a.x * b.y - a.y * b.x;
}

function dot(a: PlanePoint, b: PlanePoint): number {
  return a.x * b.x + a.y * b.y;
}

/** Same-frame local intersection in unit coordinates. Never call across frames. */
export function intersectLocalSegments(a: LocalPoint, b: LocalPoint, c: LocalPoint, d: LocalPoint): LocalSegmentIntersection {
  assertFiniteLocalPoint(a);
  assertFiniteLocalPoint(b);
  assertFiniteLocalPoint(c);
  assertFiniteLocalPoint(d);
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const aLength = Math.hypot(r.x, r.y);
  const bLength = Math.hypot(s.x, s.y);
  if (!Number.isFinite(aLength) || aLength <= 0 || !Number.isFinite(bLength) || bLength <= 0) {
    throw new Error('Path segments must have a positive finite length.');
  }
  const qMinusP = { x: c.x - a.x, y: c.y - a.y };
  const denominator = r.x * s.y - r.y * s.x;
  const aTolerance = LOCAL_EQUALITY_TOLERANCE / aLength;
  const bTolerance = LOCAL_EQUALITY_TOLERANCE / bLength;

  if (Math.abs(denominator) <= LOCAL_EQUALITY_TOLERANCE ** 2) {
    if (Math.abs(qMinusP.x * r.y - qMinusP.y * r.x) > LOCAL_EQUALITY_TOLERANCE * aLength) return null;
    const rr = r.x * r.x + r.y * r.y;
    const cFraction = ((c.x - a.x) * r.x + (c.y - a.y) * r.y) / rr;
    const dFraction = ((d.x - a.x) * r.x + (d.y - a.y) * r.y) / rr;
    const start = Math.max(0, Math.min(cFraction, dFraction));
    const end = Math.min(1, Math.max(cFraction, dFraction));
    if ((end - start) * aLength > LOCAL_EQUALITY_TOLERANCE) return { kind: 'overlap' };
    if (end < -aTolerance || start > 1 + aTolerance) return null;
    const aFraction = clampLocalFraction((start + end) / 2, aTolerance);
    const point = interpolateLocal(a, b, aFraction);
    const seg = { x: d.x - c.x, y: d.y - c.y };
    const bFraction = ((point.x - c.x) * seg.x + (point.y - c.y) * seg.y) / (seg.x * seg.x + seg.y * seg.y);
    if (bFraction < -bTolerance || bFraction > 1 + bTolerance) return null;
    return { kind: 'point', point, aFraction, bFraction: clampLocalFraction(bFraction, bTolerance) };
  }

  const aFraction = (qMinusP.x * s.y - qMinusP.y * s.x) / denominator;
  const bFraction = (qMinusP.x * r.y - qMinusP.y * r.x) / denominator;
  if (aFraction < -aTolerance || aFraction > 1 + aTolerance || bFraction < -bTolerance || bFraction > 1 + bTolerance) {
    return null;
  }
  const clampedA = clampLocalFraction(aFraction, aTolerance);
  const clampedB = clampLocalFraction(bFraction, bTolerance);
  return { kind: 'point', point: interpolateLocal(a, b, clampedA), aFraction: clampedA, bFraction: clampedB };
}

export function sameLocalPoint(a: LocalPoint, b: LocalPoint): boolean {
  return Math.abs(a.x - b.x) <= LOCAL_EQUALITY_TOLERANCE && Math.abs(a.y - b.y) <= LOCAL_EQUALITY_TOLERANCE;
}

function assertFiniteLocalPoint(point: LocalPoint): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error('Path segment coordinates must be finite.');
  }
}

function clampLocalFraction(fraction: number, tolerance: number): number {
  if (Math.abs(fraction) <= tolerance) return 0;
  if (Math.abs(fraction - 1) <= tolerance) return 1;
  return fraction;
}

function interpolateLocal(a: LocalPoint, b: LocalPoint, fraction: number): LocalPoint {
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
}
