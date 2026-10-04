import { distanceMeters } from '../geo-v3';

export const PATH_POINT_SPACING_METERS = 3;
export type GeoPoint = { lat: number; lng: number };
export type SegmentIntersection =
  | { kind: 'point'; point: GeoPoint; aFraction: number; bFraction: number }
  | { kind: 'overlap' }
  | null;

const EARTH_METERS_PER_DEGREE = 111_320;
const GEOGRAPHIC_EQUALITY_TOLERANCE_METERS = 0.01;

type PlanePoint = { x: number; y: number };

export function subdivideSegment(a: GeoPoint, b: GeoPoint): GeoPoint[] {
  assertFinitePoint(a);
  assertFinitePoint(b);
  const length = assertFinitePositiveSegmentLength(a, b);

  const steps = Math.ceil(length / PATH_POINT_SPACING_METERS);
  const points = Array.from({ length: steps + 1 }, (_, i) => ({
    lat: a.lat + ((b.lat - a.lat) * i) / steps,
    lng: a.lng + ((b.lng - a.lng) * i) / steps,
  }));
  points[0] = a;
  points[steps] = b;
  return points;
}

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
    if (Math.abs(cross(qMinusP, r)) > GEOGRAPHIC_EQUALITY_TOLERANCE_METERS * aLength) {
      return null;
    }
    return intersectCollinear(a, b, c, d, pa, r, aLength, aTolerance, bTolerance);
  }

  const aFraction = cross(qMinusP, s) / denominator;
  const bFraction = cross(qMinusP, r) / denominator;
  if (!withinSegmentFraction(aFraction, aTolerance) || !withinSegmentFraction(bFraction, bTolerance)) {
    return null;
  }

  const clampedA = clampSegmentFraction(aFraction, aTolerance);
  const clampedB = clampSegmentFraction(bFraction, bTolerance);
  return {
    kind: 'point',
    point: interpolate(a, b, clampedA),
    aFraction: clampedA,
    bFraction: clampedB,
  };
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

  if ((end - start) * aLength > GEOGRAPHIC_EQUALITY_TOLERANCE_METERS) {
    return { kind: 'overlap' };
  }
  if (end < -aTolerance || start > 1 + aTolerance) {
    return null;
  }

  const aFraction = clampSegmentFraction((start + end) / 2, aTolerance);
  const point = interpolate(a, b, aFraction);
  const bFraction = fractionAlongSegment(c, d, point);
  if (!withinSegmentFraction(bFraction, bTolerance)) {
    return null;
  }
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
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    throw new Error('Path segment coordinates must be finite.');
  }
}

function assertFinitePositiveSegmentLength(a: GeoPoint, b: GeoPoint): number {
  const length = segmentLength(a, b);
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error('Path segments must have a positive finite length.');
  }
  return length;
}

function segmentLength(a: GeoPoint, b: GeoPoint): number {
  return distanceMeters(a.lat, a.lng, b.lat, b.lng);
}

function fractionTolerance(length: number): number {
  return GEOGRAPHIC_EQUALITY_TOLERANCE_METERS / length;
}

function withinSegmentFraction(fraction: number, tolerance: number): boolean {
  return fraction >= -tolerance && fraction <= 1 + tolerance;
}

function clampSegmentFraction(fraction: number, tolerance: number): number {
  if (Math.abs(fraction) <= tolerance) {
    return 0;
  }
  if (Math.abs(fraction - 1) <= tolerance) {
    return 1;
  }
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
