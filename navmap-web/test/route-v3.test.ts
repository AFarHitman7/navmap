import { describe, expect, it } from 'vitest';
import type { EdgeV3, ManifestV3, NodeV3 } from '../src/contract-v3';
import { shortestPathV3 } from '../src/route-v3';

function node(id: string, zoneId: string | null, z: number): NodeV3 {
  return { id, name: id, lat: 12, lng: 77, z, zoneId, fingerprintRevision: 0 };
}

function edge(from: string, to: string, meters: number, kind: EdgeV3['kind']): EdgeV3 {
  return { from, to, meters, kind };
}

function makeManifest(nodes: NodeV3[], edges: EdgeV3[]): ManifestV3 {
  return {
    schemaVersion: 4,
    venueId: 'demo',
    version: 1,
    boundary: { north: 1, south: 0, east: 1, west: 0 },
    indoorZones: [
      {
        id: 'hall',
        name: 'Hall',
        bounds: { north: 1, south: 0, east: 1, west: 0 },
        floors: [
          { z: 0, label: 'G' },
          { z: 1, label: '1' },
        ],
      },
      {
        id: 'annex',
        name: 'Annex',
        bounds: { north: 1, south: 0, east: 1, west: 0 },
        floors: [{ z: 0, label: 'G' }],
      },
    ],
    nodes,
    edges,
    places: [],
    anchors: [],
    aps: [],
    profiles: [],
  };
}

describe('shortestPathV3', () => {
  it('(1) outdoor->entrance->stairs->upper room resolves full chain', () => {
    const m = makeManifest(
      [
        node('out-gate', null, 0),
        node('out-door', null, 0),
        node('in-lobby', 'hall', 0),
        node('stair-base', 'hall', 0),
        node('stair-top', 'hall', 1),
        node('room-201', 'hall', 1),
      ],
      [
        edge('out-gate', 'out-door', 10, 'path'),
        edge('out-door', 'in-lobby', 2, 'entrance'),
        edge('in-lobby', 'stair-base', 5, 'path'),
        edge('stair-base', 'stair-top', 4, 'stairs'),
        edge('stair-top', 'room-201', 6, 'path'),
      ],
    );
    expect(shortestPathV3(m, 'out-gate', 'room-201')).toEqual([
      'out-gate',
      'out-door',
      'in-lobby',
      'stair-base',
      'stair-top',
      'room-201',
    ]);
  });

  it('(2) two entrances picks the shorter total', () => {
    const m = makeManifest(
      [
        node('out-gate', null, 0),
        node('door-a', null, 0),
        node('lobby-a', 'hall', 0),
        node('door-b', null, 0),
        node('lobby-b', 'hall', 0),
        node('goal', 'hall', 0),
      ],
      [
        edge('out-gate', 'door-a', 10, 'path'),
        edge('door-a', 'lobby-a', 2, 'entrance'),
        edge('lobby-a', 'goal', 20, 'path'),
        edge('out-gate', 'door-b', 3, 'path'),
        edge('door-b', 'lobby-b', 2, 'entrance'),
        edge('lobby-b', 'goal', 4, 'path'),
      ],
    );
    expect(shortestPathV3(m, 'out-gate', 'goal')).toEqual([
      'out-gate',
      'door-b',
      'lobby-b',
      'goal',
    ]);
  });

  it('(3) stacked nodes with no vertical edge yield null', () => {
    const m = makeManifest(
      [node('base', 'hall', 0), node('top', 'hall', 1)],
      [],
    );
    expect(shortestPathV3(m, 'base', 'top')).toBeNull();
  });

  it('(4) nodes in different buildings with no connecting edges yield null', () => {
    const m = makeManifest(
      [
        node('hall-a', 'hall', 0),
        node('hall-b', 'hall', 0),
        node('annex-a', 'annex', 0),
        node('annex-b', 'annex', 0),
      ],
      [
        edge('hall-a', 'hall-b', 5, 'path'),
        edge('annex-a', 'annex-b', 5, 'path'),
      ],
    );
    expect(shortestPathV3(m, 'hall-a', 'annex-a')).toBeNull();
  });

  it('(5) elevator edge works like stairs', () => {
    const m = makeManifest(
      [
        node('out-gate', null, 0),
        node('out-door', null, 0),
        node('in-lobby', 'hall', 0),
        node('lift-0', 'hall', 0),
        node('lift-1', 'hall', 1),
        node('room-201', 'hall', 1),
      ],
      [
        edge('out-gate', 'out-door', 10, 'path'),
        edge('out-door', 'in-lobby', 2, 'entrance'),
        edge('in-lobby', 'lift-0', 5, 'path'),
        edge('lift-0', 'lift-1', 4, 'elevator'),
        edge('lift-1', 'room-201', 6, 'path'),
      ],
    );
    expect(shortestPathV3(m, 'out-gate', 'room-201')).toEqual([
      'out-gate',
      'out-door',
      'in-lobby',
      'lift-0',
      'lift-1',
      'room-201',
    ]);
  });

  it('(6) generated path point routes via bend, shared junction, and stairs', () => {
    const gen = (id: string, zoneId: string | null, z: number): NodeV3 => ({ ...node(id, zoneId, z), generated: true });
    const m = makeManifest(
      [
        gen('gen-start', 'hall', 0),
        gen('bend', 'hall', 0),
        gen('junc', 'hall', 0),
        node('side-a', 'hall', 0),
        gen('landing-0', 'hall', 0),
        gen('landing-1', 'hall', 1),
        node('room-201', 'hall', 1),
        node('ghost', 'hall', 1),
      ],
      [
        edge('gen-start', 'bend', 3, 'path'),
        edge('bend', 'junc', 3, 'path'),
        edge('junc', 'landing-0', 4, 'path'),
        edge('side-a', 'junc', 2, 'path'),
        edge('landing-0', 'landing-1', 4, 'stairs'),
        edge('landing-1', 'room-201', 6, 'path'),
        // Ordinary edge crossing floors: rejected by the same-floor path rule.
        edge('ghost', 'landing-0', 4, 'path'),
      ],
    );
    expect(shortestPathV3(m, 'gen-start', 'room-201')).toEqual([
      'gen-start',
      'bend',
      'junc',
      'landing-0',
      'landing-1',
      'room-201',
    ]);
    // Ghost touches the graph but stays unreachable: no vertical link reaches floor 1.
    expect(shortestPathV3(m, 'gen-start', 'ghost')).toBeNull();
  });
});
