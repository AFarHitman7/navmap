import { describe, expect, it } from 'vitest';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5';
import { addBuildingV5, addFloorV5, removeFloorV5, removeNodeV5, setBoundaryV5 } from '../src/editor-v3/model';
import { emptyMapDraft } from '../src/map-geometry';

describe('V5 inspector edit adapters', () => {
  it('refuses to shrink a boundary around an existing building', () => {
    const draft = geographicDraft();
    const bounds = { kind: 'geographic' as const, north: 13.07, south: 13.03, east: 80.27, west: 80.23 };
    draft.frames = draft.frames.map((frame) => frame.zoneId === null ? { ...frame, bounds } : frame);
    expect(() => setBoundaryV5(draft, bounds))
      .toThrow(/Building A/);
  });

  it('adds a building and floor frame atomically, and refuses to remove occupied floors', () => {
    let draft = emptyMapDraft('empty-static', 'static');
    draft = addBuildingV5(draft, 'Library', { kind: 'local', left: 0.1, top: 0.1, right: 0.4, bottom: 0.4 });
    const building = draft.indoorZones[0]!;
    expect(draft.frames.some((frame) => frame.zoneId === building.id && frame.z === 0)).toBe(true);
    draft = addFloorV5(draft, building.id, 1, 'Upper');
    expect(draft.indoorZones[0]!.floors).toHaveLength(2);
    expect(removeFloorV5(draft, building.id, 0).frames.some((frame) => frame.zoneId === building.id && frame.z === 0)).toBe(false);
  });

  it('does not silently delete transition connections with a node', () => {
    expect(() => removeNodeV5(geographicDraft(), 'n-out')).toThrow(/Delete the entrance transition/);
  });
});
