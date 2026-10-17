// Task 2 RED: frame-aware native routing + GPS bypass for static maps.
import { describe, expect, it } from '@jest/globals';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5';
import type { MapDraft } from '../src/map-contract';
import { shortestPathV3 } from '../src/route-v3';
import { classifyGpsZone } from '../src/positioning-v3';

describe('native V5 routing', () => {
  it('routes an uncalibrated static graph without claiming metres', () => {
    const draft = staticDraft();
    expect(shortestPathV3(draft, draft.nodes[0]!.id, draft.nodes[1]!.id)).not.toBeNull();
    expect(draft.edges[0]!.meters).toBeUndefined();
    expect(draft.edges[0]!.cost).toBeGreaterThan(0);
  });

  it('reaches the same local position on a different floor via stairs', () => {
    const draft = staticDraft();
    expect(shortestPathV3(draft, 's-a0b', 's-a1b')).toEqual(['s-a0b', 's-a0', 's-a1', 's-a1b']);
  });

  it('ignores ordinary edges across frames', () => {
    const draft = staticDraft();
    const crossed: MapDraft = {
      ...draft,
      edges: [...draft.edges, { from: 's-a0b', to: 's-a1b', kind: 'path', cost: 0.01 }],
    };
    expect(shortestPathV3(crossed, 's-a0b', 's-a1b')).toEqual(['s-a0b', 's-a0', 's-a1', 's-a1b']);
  });

  it('keeps geographic routing on cost', () => {
    const draft = geographicDraft();
    expect(shortestPathV3(draft, 'n-out', 'n-a1')).toEqual(['n-out', 'n-a0', 'n-a1']);
  });
});

describe('GPS classification is geographic-only', () => {
  it('bypasses static maps instead of classifying zones', () => {
    const draft = staticDraft();
    expect(
      classifyGpsZone({ boundary: draft.boundary, indoorZones: draft.indoorZones, canvas: draft.canvas }, 0.5, 0.5),
    ).toEqual({ kind: 'outside' });
  });

  it('still classifies geographic maps', () => {
    const draft = geographicDraft();
    const boundary = draft.boundary!;
    if (boundary.kind !== 'geographic') throw new Error('fixture must be geographic');
    expect(classifyGpsZone({ boundary, indoorZones: draft.indoorZones }, 13.05, 80.25)).toEqual({
      kind: 'indoors',
      zoneId: 'b-a',
    });
  });
});
