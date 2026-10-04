import { describe, expect, it } from 'vitest';
import { parseDraftV3, parseManifestV3 } from '../src/contract-v3';

function baseDraft(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 4,
    venueId: 'demo',
    boundary: { north: 13.1, south: 13.0, east: 80.3, west: 80.2 },
    indoorZones: [
      {
        id: 'b-a',
        name: 'Building A',
        bounds: { north: 13.08, south: 13.02, east: 80.28, west: 80.22 },
        floors: [
          { z: 0, label: 'Ground' },
          { z: 1, label: 'Level 1' },
        ],
      },
    ],
    nodes: [{ id: 'n-out', name: 'Outdoor node', lat: 13.05, lng: 80.25, z: 0, zoneId: null, fingerprintRevision: 1 }],
    edges: [],
    places: [],
    anchors: [],
    aps: [],
    ...overrides,
  };
}

function twoNodeDraft(overrides: Record<string, unknown> = {}) {
  return baseDraft({
    nodes: [
      { id: 'n-a', name: 'Path start', lat: 13.05, lng: 80.25, z: 0, zoneId: null, fingerprintRevision: 1 },
      { id: 'n-b', name: 'Path end', lat: 13.06, lng: 80.26, z: 0, zoneId: null, fingerprintRevision: 1 },
    ],
    ...overrides,
  });
}

describe('contract-v3', () => {
  it('boundary+zone+outdoor node parses', () => {
    const d = parseDraftV3(baseDraft());
    expect(d.boundary).not.toBeNull();
    expect(d.indoorZones).toHaveLength(1);
    expect(d.nodes[0]!.zoneId).toBeNull();
  });

  it('stacked nodes same lat/lng different z parse', () => {
    const d = parseDraftV3(
      baseDraft({
        nodes: [
          { id: 'n-g', name: 'Ground stair', lat: 13.05, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1 },
          { id: 'n-u', name: 'Upper stair', lat: 13.05, lng: 80.25, z: 1, zoneId: 'b-a', fingerprintRevision: 1 },
        ],
        edges: [{ from: 'n-g', to: 'n-u', meters: 4, kind: 'stairs' }],
      }),
    );
    expect(d.nodes).toHaveLength(2);
    expect(d.nodes[0]!.lat).toBe(d.nodes[1]!.lat);
    expect(d.nodes[0]!.lng).toBe(d.nodes[1]!.lng);
    expect(d.nodes[0]!.z).not.toBe(d.nodes[1]!.z);
  });

  it('invalid bounds (north<=south) rejected', () => {
    expect(() =>
      parseDraftV3(baseDraft({ boundary: { north: 13.0, south: 13.1, east: 80.3, west: 80.2 } })),
    ).toThrow();
  });

  it('accepts a v4 draft node with stable id and required name', () => {
    const d = parseDraftV3(baseDraft());
    expect(d.schemaVersion).toBe(4);
    expect(d.nodes[0]).toMatchObject({ id: 'n-out', name: 'Outdoor node', fingerprintRevision: 1 });
  });

  it('accepts a v4 manifest node with stable id and required name', () => {
    const m = parseManifestV3({
      ...baseDraft(),
      version: 1,
      profiles: [{ nodeId: 'n-out', fingerprintRevision: 1, medianRssi: { 'AA:BB:CC:DD:EE:01': -52 }, scanCount: 3 }],
    });
    expect(m.schemaVersion).toBe(4);
    expect(m.nodes[0]).toMatchObject({ id: 'n-out', name: 'Outdoor node' });
  });

  it('accepts optional generated nodes and draft paths without defaulting omitted paths', () => {
    const fixture = twoNodeDraft();
    const grouped = {
      ...fixture,
      nodes: fixture.nodes.map((n, i) => (i === 0 ? { ...n, generated: true } : n)),
      paths: [{ id: 'route-1', name: 'Corridor', nodeIds: fixture.nodes.slice(0, 2).map((n) => n.id), controlNodeIds: ['n-a', 'n-b'] }],
    };

    expect(parseDraftV3(grouped).paths).toEqual(grouped.paths);
    expect(parseDraftV3(fixture).paths).toBeUndefined();
    expect(() => parseDraftV3({ ...grouped, paths: [{ id: 'x', name: 'X', nodeIds: ['one'] }] })).toThrow();
  });

  it('rejects malformed draft path metadata and nonboolean generated flags', () => {
    const fixture = twoNodeDraft();
    const grouped = {
      ...fixture,
      paths: [{ id: 'route-1', name: 'Corridor', nodeIds: ['n-a', 'n-b'] }],
    };

    expect(() => parseDraftV3({ ...fixture, nodes: [{ ...fixture.nodes[0], generated: 'yes' }, fixture.nodes[1]] })).toThrow();
    expect(() => parseDraftV3({ ...grouped, paths: [{ id: 'route-1', name: 'Corridor', nodeIds: ['n-a', ''] }] })).toThrow();
    expect(() => parseDraftV3({ ...grouped, paths: [{ id: 'route-1', name: 'Corridor', nodeIds: ['n-a', 'n-b'], controlNodeIds: ['n-a'] }] })).toThrow();
    expect(() => parseDraftV3({ ...grouped, paths: [{ id: 'route-1', name: 'Corridor', nodeIds: ['n-a', 'n-b'], controlNodeIds: ['n-a', ''] }] })).toThrow();
    expect(() => parseDraftV3({ ...grouped, paths: [{ id: 'route-1', name: 'Corridor', nodeIds: ['n-a', 'n-b'], color: 'blue' }] })).toThrow();
  });

  it('accepts optional generated nodes and paths in manifests', () => {
    const fixture = twoNodeDraft();
    const grouped = {
      ...fixture,
      nodes: fixture.nodes.map((n, i) => (i === 0 ? { ...n, generated: true } : n)),
      paths: [{ id: 'route-1', name: 'Corridor', nodeIds: fixture.nodes.slice(0, 2).map((n) => n.id), controlNodeIds: ['n-a', 'n-b'] }],
      version: 1,
      profiles: [],
    };

    expect(parseManifestV3(grouped).paths).toEqual(grouped.paths);
    expect(parseManifestV3({ ...fixture, version: 1, profiles: [] }).paths).toBeUndefined();
    expect(() => parseManifestV3({ ...grouped, paths: [{ id: 'x', name: 'X', nodeIds: ['one'] }] })).toThrow();
  });

  it('rejects empty, blank, and missing node names', () => {
    expect(() => parseDraftV3(baseDraft({ nodes: [{ id: 'n-out', name: '', lat: 13.05, lng: 80.25, z: 0, zoneId: null, fingerprintRevision: 1 }] }))).toThrow();
    expect(() => parseDraftV3(baseDraft({ nodes: [{ id: 'n-out', name: '   ', lat: 13.05, lng: 80.25, z: 0, zoneId: null, fingerprintRevision: 1 }] }))).toThrow();
    expect(() => parseDraftV3(baseDraft({ nodes: [{ id: 'n-out', lat: 13.05, lng: 80.25, z: 0, zoneId: null, fingerprintRevision: 1 }] }))).toThrow();
  });

  it('rejects schemaVersion 3 drafts and manifests', () => {
    expect(() => parseDraftV3(baseDraft({ schemaVersion: 3 }))).toThrow();
    expect(() => parseManifestV3({ ...baseDraft({ schemaVersion: 3 }), version: 1, profiles: [] })).toThrow();
  });
});
