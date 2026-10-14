import { describe, expect, it } from 'vitest';
import { parseDraftV3, parseManifestV3 } from '../src/contract-v3';
import { parseMapDraft, parseMapManifest, upgradeV4Draft, upgradeV4Manifest } from '../src/map-contract';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5';
import geographicJson from '../src/fixtures/map-v5-geographic.json';
import staticJson from '../src/fixtures/map-v5-static.json';

function v4MixedDraft(): Record<string, unknown> {
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
    nodes: [
      { id: 'n-out', name: 'Outdoor node', lat: 13.05, lng: 80.25, z: 0, zoneId: null, fingerprintRevision: 1 },
      { id: 'n-a0', name: 'Lobby', lat: 13.05, lng: 80.245, z: 0, zoneId: 'b-a', fingerprintRevision: 2 },
      { id: 'n-a1', name: 'Landing', lat: 13.05, lng: 80.245, z: 1, zoneId: 'b-a', fingerprintRevision: 3 },
      { id: 'n-a0b', name: 'Corridor', lat: 13.055, lng: 80.248, z: 0, zoneId: 'b-a', fingerprintRevision: 1, generated: true },
      { id: 'n-gen', name: 'Survey point', lat: 13.052, lng: 80.246, z: 0, zoneId: 'b-a', fingerprintRevision: 1, generated: true },
    ],
    edges: [
      { from: 'n-out', to: 'n-a0', meters: 12, kind: 'entrance' },
      { from: 'n-a0', to: 'n-a1', meters: 4, kind: 'stairs' },
      { from: 'n-a0', to: 'n-a0b', meters: 18, kind: 'path' },
      { from: 'n-a0b', to: 'n-a0', meters: 20, kind: 'path' },
      { from: 'n-a0', to: 'n-gen', meters: 5, kind: 'path' },
    ],
    places: [{ id: 'p-1', name: 'Lobby desk', zoneId: 'b-a', nodeId: 'n-a0b' }],
    anchors: [{ id: 'a-1', nodeId: 'n-a0', label: 'lobby-qr' }],
    aps: [],
    paths: [{ id: 'route-mixed', name: 'Mixed route', nodeIds: ['n-a0b', 'n-a0', 'n-a1'] }],
  };
}

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

describe('map-contract v5', () => {
  it('parses the geographic V5 fixture with floor and outdoor frames', () => {
    const draft = parseMapDraft(geographicDraft());
    expect(draft.schemaVersion).toBe(5);
    expect(draft.canvas).toEqual({ kind: 'geographic' });
    expect(draft.frames).toHaveLength(3);
    expect(draft.boundary).not.toBeNull();
    expect(draft.transitions).toHaveLength(2);
  });

  it('reads a static layout without invented geographic coordinates', () => {
    const draft = parseMapDraft(staticDraft());
    expect(draft.canvas.kind).toBe('static');
    expect(draft.nodes[0]!.position).toMatchObject({ kind: 'local', x: 0.2, y: 0.3 });
    expect('lat' in draft.nodes[0]!.position).toBe(false);
  });

  it('fixture JSON files match the builder output after parsing', () => {
    expect(parseMapDraft(geographicJson)).toEqual(parseMapDraft(geographicDraft()));
    expect(parseMapDraft(staticJson)).toEqual(parseMapDraft(staticDraft()));
  });

  it('upgrades a V4 draft without graph loss', () => {
    const upgraded = upgradeV4Draft(v4MixedDraft());
    expect(upgraded.schemaVersion).toBe(5);
    expect(upgraded.canvas).toEqual({ kind: 'geographic' });
    expect(upgraded.frames.map((f) => f.id).sort()).toEqual(['frame-b-a-z0', 'frame-b-a-z1', 'frame-outdoor-z0']);
    // Duplicate undirected edge pair collapses to the minimum cost with direction preserved.
    expect(upgraded.edges).toHaveLength(4);
    expect(upgraded.edges.find((e) => e.from === 'n-a0' && e.to === 'n-a0b')).toMatchObject({
      kind: 'path',
      cost: 18,
      meters: 18,
    });
    // Transition groups recovered without changing edge endpoints.
    expect(upgraded.transitions.map((t) => t.kind).sort()).toEqual(['entrance', 'stair']);
    expect(upgraded.transitions.find((t) => t.kind === 'entrance')!.nodeIds).toEqual(['n-out', 'n-a0']);
    // Mixed legacy path splits at the transition edge.
    expect(upgraded.paths!.find((p) => p.id === 'route-mixed')).toMatchObject({
      kind: 'regular',
      nodeIds: ['n-a0b', 'n-a0'],
    });
    // Authored and place-linked nodes stay visible; unlinked generated nodes hide.
    const byId = new Map(upgraded.nodes.map((n) => [n.id, n]));
    expect(byId.get('n-a0')!.visitorVisible).toBe(true);
    expect(byId.get('n-a0b')!.visitorVisible).toBe(true);
    expect(byId.get('n-gen')!.visitorVisible).toBe(false);
    expect(byId.get('n-a0')!.fingerprintRevision).toBe(2);
    expect(parseMapDraft(upgraded)).toEqual(upgraded);
  });

  it('preserves omitted V4 paths as omitted', () => {
    const v4 = v4MixedDraft();
    const { paths: _dropped, ...noPaths } = v4;
    expect(_dropped).toBeDefined();
    expect(upgradeV4Draft(noPaths).paths).toBeUndefined();
  });

  it('rejects nonfinite coordinates', () => {
    const geo = geographicDraft();
    expect(() =>
      parseMapDraft({
        ...geo,
        nodes: geo.nodes.map((n, i) =>
          i === 0 ? { ...n, position: { kind: 'geographic', lat: Number.POSITIVE_INFINITY, lng: 80.25 } } : n,
        ),
      }),
    ).toThrow();
    const st = staticDraft();
    expect(() =>
      parseMapDraft({
        ...st,
        nodes: st.nodes.map((n, i) => (i === 0 ? { ...n, position: { kind: 'local', x: Number.NaN, y: 0.3 } } : n)),
      }),
    ).toThrow();
  });

  it('rejects unknown fields and unsupported versions', () => {
    expect(() => parseMapDraft({ ...geographicDraft(), schemaVersion: 4 })).toThrow();
    expect(() => parseMapDraft({ ...geographicDraft(), future: true })).toThrow();
    const geo = geographicDraft();
    expect(() => parseMapDraft({ ...geo, nodes: [{ ...geo.nodes[0], color: 'blue' }] })).toThrow();
  });

  it('rejects out-of-range local coordinates and bad frame references', () => {
    const st = staticDraft();
    expect(() =>
      parseMapDraft({ ...st, nodes: [{ ...st.nodes[0], position: { kind: 'local', x: 1.5, y: 0.3 } }] }),
    ).toThrow();
    const geo = geographicDraft();
    expect(() => parseMapDraft({ ...geo, nodes: [{ ...geo.nodes[0], frameId: 'frame-missing' }] })).toThrow();
    expect(() => parseMapDraft({ ...geo, edges: [{ from: 'n-a0', to: 'n-missing', kind: 'path', cost: 1 }] })).toThrow();
  });

  it('rejects duplicate undirected edges and invalid transition pairs', () => {
    const geo = geographicDraft();
    expect(() =>
      parseMapDraft({ ...geo, edges: [...geo.edges, { from: 'n-a0b', to: 'n-a0', kind: 'path', cost: 1 }] }),
    ).toThrow();
    expect(() =>
      parseMapDraft({
        ...geo,
        transitions: [{ id: 'tr-bad', name: 'bad', kind: 'entrance', nodeIds: ['n-a0', 'n-a0b'] }],
      }),
    ).toThrow();
    expect(() =>
      parseMapDraft({
        ...geo,
        transitions: [{ id: 'tr-ghost', name: 'ghost', kind: 'stair', nodeIds: ['n-a0', 'n-ghost'] }],
      }),
    ).toThrow();
  });

  it('manifests require boundaries for geographic maps and backgrounds for static content frames', () => {
    const geo = geographicDraft();
    const manifest = parseMapManifest({
      ...geo,
      version: 1,
      profiles: [{ nodeId: 'n-a0', fingerprintRevision: 2, medianRssi: {}, scanCount: 1 }],
    });
    expect(manifest.version).toBe(1);
    expect(() => parseMapManifest({ ...geo, boundary: null, version: 1, profiles: [] })).toThrow();
    const st = staticDraft();
    expect(parseMapManifest({ ...st, version: 1, profiles: [] }).version).toBe(1);
    const noBg = { ...st, frames: st.frames.map((f) => ({ ...f, background: undefined })) };
    expect(() => parseMapManifest({ ...noBg, version: 1, profiles: [] })).toThrow();
  });

  it('upgrades a V4 manifest preserving version and profiles', () => {
    const upgraded = upgradeV4Manifest({
      ...v4MixedDraft(),
      version: 3,
      profiles: [{ nodeId: 'n-a0', fingerprintRevision: 2, medianRssi: { 'AA:BB:CC:DD:EE:01': -52 }, scanCount: 3 }],
    });
    expect(upgraded.version).toBe(3);
    expect(upgraded.profiles).toHaveLength(1);
    expect(parseMapManifest(upgraded)).toEqual(upgraded);
  });
});
