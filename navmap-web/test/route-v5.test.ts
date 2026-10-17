// Task 2 RED: frame-aware routing over V5 graphs (cost-based, no lat/lng).
import { describe, expect, it } from 'vitest';
import { parseManifestV3, type ManifestV3 } from '../src/contract-v3';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5';
import { parseMapManifest, upgradeV4Manifest, type MapDraft, type MapManifest } from '../src/map-contract';
import { shortestPathV3 } from '../src/route-v3';
import fixtureRaw from '../src/fixtures/unified-v3.json';

function v5manifest(draft: MapDraft): MapManifest {
  return parseMapManifest({ ...draft, version: 1, profiles: [] });
}

describe('shortestPathV3 over V5 graphs', () => {
  it('routes an uncalibrated static graph without claiming metres', () => {
    const draft = staticDraft();
    expect(shortestPathV3(draft, draft.nodes[0]!.id, draft.nodes[1]!.id)).not.toBeNull();
    expect(draft.edges[0]!.meters).toBeUndefined();
    expect(draft.edges[0]!.cost).toBeGreaterThan(0);
  });

  it('reaches the same local position on a different floor via stairs', () => {
    const draft = staticDraft();
    expect(shortestPathV3(draft, 's-a0', 's-a1')).toEqual(['s-a0', 's-a1']);
    expect(shortestPathV3(draft, 's-a0b', 's-a1b')).toEqual(['s-a0b', 's-a0', 's-a1', 's-a1b']);
  });

  it('ignores ordinary edges across frames', () => {
    const draft = staticDraft();
    const crossed: MapDraft = {
      ...draft,
      edges: [...draft.edges, { from: 's-a0b', to: 's-a1b', kind: 'path', cost: 0.01 }],
    };
    // Direct cross-frame path edge must not route; stairs path still works.
    expect(shortestPathV3(crossed, 's-a0b', 's-a1b')).toEqual(['s-a0b', 's-a0', 's-a1', 's-a1b']);
  });

  it('routes entrances only between outdoors and the ground floor', () => {
    const draft = geographicDraft();
    expect(shortestPathV3(draft, 'n-out', 'n-a0')).toEqual(['n-out', 'n-a0']);
    const bad: MapDraft = {
      ...draft,
      edges: [...draft.edges, { from: 'n-out', to: 'n-a1', kind: 'entrance', cost: 3, meters: 3 }],
    };
    expect(shortestPathV3(bad, 'n-out', 'n-a1')).toEqual(['n-out', 'n-a0', 'n-a1']);
  });

  it('preserves existing geographic results after V4 upgrade', () => {
    const raw = fixtureRaw as Record<string, unknown>;
    const v4 = parseManifestV3({ ...raw, version: 1, profiles: [] }) as ManifestV3;
    const upgraded = upgradeV4Manifest({ ...raw, version: 1, profiles: [] });
    for (const n of v4.nodes) {
      for (const m of v4.nodes) {
        expect(shortestPathV3(upgraded, n.id, m.id)).toEqual(shortestPathV3(v4, n.id, m.id));
      }
    }
  });

  it('routes a V5 manifest the same as its draft', () => {
    const draft = staticDraft();
    const manifest = v5manifest(draft);
    expect(shortestPathV3(manifest, 's-a0b', 's-a1b')).toEqual(shortestPathV3(draft, 's-a0b', 's-a1b'));
  });
});
