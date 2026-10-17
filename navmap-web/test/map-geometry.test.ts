// Task 2 RED: frame-aware geometry primitives (shared semantics x3 packages).
import { describe, expect, it } from 'vitest';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5';
import {
  MAX_GENERATED_PER_PATH,
  containsPosition,
  emptyMapDraft,
  segmentMetrics,
  transitionMetrics,
} from '../src/map-geometry';

describe('map-geometry', () => {
  it('computes static cost in source pixels divided by max dimension', () => {
    const draft = staticDraft();
    const frame = draft.frames.find((f) => f.id === 'frame-b-a-z0')!;
    const a = draft.nodes.find((n) => n.id === 's-a0')!;
    const b = draft.nodes.find((n) => n.id === 's-a0b')!;
    // dx=0.3*1000=300px, dy=0.4*1000=400px -> 500px / 1000 = 0.5
    const m = segmentMetrics(a, b, frame);
    expect(m.cost).toBeCloseTo(0.5, 9);
    expect(m.meters).toBeUndefined();
  });

  it('adds physical metres only for calibrated static frames', () => {
    const draft = staticDraft();
    const frame = { ...draft.frames.find((f) => f.id === 'frame-b-a-z0')!, calibration: { metersPerPixel: 0.01 } };
    const a = draft.nodes.find((n) => n.id === 's-a0')!;
    const b = draft.nodes.find((n) => n.id === 's-a0b')!;
    const m = segmentMetrics(a, b, frame);
    expect(m.cost).toBeCloseTo(0.5, 9);
    expect(m.meters).toBeCloseTo(5, 9);
  });

  it('uses distanceMeters for geographic cost and metres', () => {
    const draft = geographicDraft();
    const frame = draft.frames.find((f) => f.id === 'frame-b-a-z0')!;
    const a = draft.nodes.find((n) => n.id === 'n-a0')!;
    const b = draft.nodes.find((n) => n.id === 'n-a0b')!;
    const m = segmentMetrics(a, b, frame);
    expect(m.cost).toBeGreaterThan(0);
    expect(m.meters).toBeCloseTo(m.cost, 9);
  });

  it('refuses static metrics without an assigned background', () => {
    const draft = staticDraft();
    const frame = draft.frames.find((f) => f.id === 'frame-outdoor-z0')!;
    const a = draft.nodes.find((n) => n.id === 's-a0')!;
    const b = draft.nodes.find((n) => n.id === 's-a0b')!;
    expect(() => segmentMetrics(a, b, frame)).toThrow(/background/);
  });

  it('computes transition costs without claiming metres', () => {
    const draft = staticDraft();
    const from = draft.nodes.find((n) => n.id === 's-a0')!;
    const to = draft.nodes.find((n) => n.id === 's-a1')!;
    expect(transitionMetrics('stair', from, to)).toEqual({ cost: 4 });
    expect(transitionMetrics('entrance', from, to)).toEqual({ cost: 1 });
    expect(transitionMetrics('entrance', from, to, 7)).toEqual({ cost: 7, meters: 7 });
  });

  it('containsPosition dispatches on frame bounds kind', () => {
    const geo = geographicDraft();
    const outdoor = geo.frames.find((f) => f.id === 'frame-outdoor-z0')!;
    expect(containsPosition(outdoor, { kind: 'geographic', lat: 13.05, lng: 80.25 })).toBe(true);
    expect(containsPosition(outdoor, { kind: 'geographic', lat: 0, lng: 0 })).toBe(false);
    const st = staticDraft();
    const floor = st.frames.find((f) => f.id === 'frame-b-a-z0')!;
    expect(containsPosition(floor, { kind: 'local', x: 0.5, y: 0.5 })).toBe(true);
    expect(containsPosition(floor, { kind: 'local', x: 2, y: 0.5 })).toBe(false);
    // Kind mismatch never matches.
    expect(containsPosition(floor, { kind: 'geographic', lat: 13.05, lng: 80.25 })).toBe(false);
  });

  it('emptyMapDraft builds a valid draft per canvas kind', () => {
    const geo = emptyMapDraft('v-geo', 'geographic');
    expect(geo.schemaVersion).toBe(5);
    expect(geo.canvas).toEqual({ kind: 'geographic' });
    expect(geo.venueId).toBe('v-geo');
    const st = emptyMapDraft('v-st', 'static');
    expect(st.canvas).toEqual({ kind: 'static' });
    expect(st.boundary).toEqual({ kind: 'local', left: 0, top: 0, right: 1, bottom: 1 });
  });

  it('caps generated nodes per authored path', () => {
    expect(MAX_GENERATED_PER_PATH).toBe(5000);
  });
});
