import { describe, expect, it } from 'vitest';
import { distanceMeters } from '../src/geo-v3';
import { intersectSegments, subdivideSegment } from '../src/editor-v3/path-geometry';

describe('path geometry', () => {
  it('retains exact endpoints and limits reference gaps to 3 metres', () => {
    const a = { lat: 13.05, lng: 80.25 };
    const b = { lat: 13.0501, lng: 80.25 };

    const points = subdivideSegment(a, b);

    expect(points[0]).toEqual(a);
    expect(points.at(-1)).toEqual(b);
    for (let i = 1; i < points.length; i++) {
      expect(distanceMeters(points[i - 1]!.lat, points[i - 1]!.lng, points[i]!.lat, points[i]!.lng)).toBeLessThanOrEqual(
        3.001,
      );
    }
  });

  it('finds crossing and endpoint joins, but identifies positive-length overlap', () => {
    const p = (lat: number, lng: number) => ({ lat, lng });

    expect(intersectSegments(p(0, 0), p(0, 2), p(-1, 1), p(1, 1))).toMatchObject({
      kind: 'point',
      point: p(0, 1),
    });
    expect(intersectSegments(p(0, 0), p(0, 2), p(0, 1), p(1, 1))).toMatchObject({ kind: 'point' });
    expect(intersectSegments(p(0, 0), p(0, 2), p(0, 1), p(0, 3))).toEqual({ kind: 'overlap' });
  });

  it('returns null for parallel disjoint lines', () => {
    const p = (lat: number, lng: number) => ({ lat, lng });

    expect(intersectSegments(p(0, 0), p(0, 2), p(1, 0), p(1, 2))).toBeNull();
  });

  it('treats coincident endpoints as point intersections', () => {
    const p = (lat: number, lng: number) => ({ lat, lng });

    expect(intersectSegments(p(0, 0), p(0, 1), p(0, 1), p(1, 1))).toEqual({
      kind: 'point',
      point: p(0, 1),
      aFraction: 1,
      bFraction: 0,
    });
  });

  it('rejects zero-length segments for subdivision and intersection', () => {
    const p = (lat: number, lng: number) => ({ lat, lng });

    expect(() => subdivideSegment(p(0, 0), p(0, 0))).toThrow(/positive finite length/i);
    expect(() => intersectSegments(p(0, 0), p(0, 0), p(0, 1), p(1, 1))).toThrow(/positive finite length/i);
  });

  it('rejects NaN and Infinity coordinates on either intersection segment', () => {
    const p = (lat: number, lng: number) => ({ lat, lng });

    expect(() => intersectSegments(p(Number.NaN, 0), p(0, 1), p(0, 0), p(1, 0))).toThrow(/finite/i);
    expect(() => intersectSegments(p(0, 0), p(0, Number.POSITIVE_INFINITY), p(0, 0), p(1, 0))).toThrow(/finite/i);
    expect(() => intersectSegments(p(0, 0), p(0, 1), p(Number.NaN, 0), p(1, 0))).toThrow(/finite/i);
    expect(() => intersectSegments(p(0, 0), p(0, 1), p(0, 0), p(1, Number.POSITIVE_INFINITY))).toThrow(/finite/i);
  });

  it('rejects finite coordinates that produce nonfinite segment lengths before intersection math', () => {
    const p = (lat: number, lng: number) => ({ lat, lng });

    expect(() => subdivideSegment(p(0, 0), p(0, Number.MAX_VALUE))).toThrow(/positive finite length/i);
    expect(() => intersectSegments(p(0, 0), p(0, Number.MAX_VALUE), p(0, 0), p(1, 0))).toThrow(
      /positive finite length/i,
    );
    expect(() => intersectSegments(p(0, 0), p(0, 1), p(0, 0), p(0, Number.MAX_VALUE))).toThrow(
      /positive finite length/i,
    );
  });

  it('clamps numerical tolerance near an endpoint to the endpoint fraction', () => {
    const p = (lat: number, lng: number) => ({ lat, lng });
    const oneMillimetreInDegrees = 0.001 / 111_320;

    expect(intersectSegments(p(0, 0), p(0, 1), p(oneMillimetreInDegrees, 1), p(1, 1))).toEqual({
      kind: 'point',
      point: p(0, 1),
      aFraction: 1,
      bFraction: 0,
    });
  });
});
