import { describe, expect, it } from 'vitest';
import raw from '../src/fixtures/map-v5-static.json';
import { buildDirections } from '../../shared/src/directions';
import { parseMapManifest } from '../src/map-contract';

const map = parseMapManifest({ ...raw, version: 1, profiles: [] });

describe('buildDirections', () => {
  it('groups hidden route samples without exposing their ids or names', () => {
    const withHiddenRoute = { ...map, edges: [...map.edges,
      { from: 's-a0g', to: 's-a1', kind: 'stairs' as const, cost: 1 }] };
    const directions = buildDirections(withHiddenRoute, ['s-a0', 's-a0b', 's-a0g', 's-a1']);
    expect(directions.instructions.map(({ kind }) => kind)).toEqual(['start', 'walk', 'stairs', 'arrival']);
    const text = directions.instructions.map(({ text }) => text).join(' ');
    expect(text).not.toMatch(/s-a0|s-a0b|s-a0g|Survey point|connections|steps/);
    expect(directions.totalMeters).toBeUndefined();
  });

  it('uses authored Place labels and only totals meters when all route edges are calibrated', () => {
    const calibrated = parseMapManifest({
      ...raw, version: 1, profiles: [],
      edges: raw.edges.map((edge) => ({ ...edge, meters: edge.from === 's-a0' && edge.to === 's-a1' ? 8 : 1 })),
      places: [...raw.places, { id: 'p-upper', name: 'Gallery', nodeId: 's-a1', zoneId: 'b-a' }],
    });
    const result = buildDirections(calibrated, ['s-a0', 's-a1']);
    expect(result.instructions[0]?.text).toBe('Start at Lobby');
    expect(result.instructions[1]).toMatchObject({ kind: 'stairs', text: 'Take stairs to Gallery' });
    expect(result.instructions.at(-1)?.text).toBe('Arrive at Gallery');
    expect(result.totalMeters).toBe(8);
  });
});
