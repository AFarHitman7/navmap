import fixture from '../src/fixtures/unified-v3.json';
import { parseDraftV3, parseManifestV3 } from '../src/contract-v3';

const base = {
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
  nodes: [{ id: 'n1', name: 'Outdoor node', lat: 13.05, lng: 80.25, z: 0, zoneId: null, fingerprintRevision: 1 }],
  edges: [],
  places: [],
  anchors: [],
  aps: [],
};

function twoNodeDraft(overrides: Record<string, unknown> = {}) {
  return {
    ...base,
    nodes: [
      { id: 'n-a', name: 'Path start', lat: 13.05, lng: 80.25, z: 0, zoneId: null, fingerprintRevision: 1 },
      { id: 'n-b', name: 'Path end', lat: 13.06, lng: 80.26, z: 0, zoneId: null, fingerprintRevision: 1 },
    ],
    ...overrides,
  };
}

test('parses boundary + zones', () => {
  const d = parseDraftV3(base);
  expect(d.boundary).toEqual({ north: 13.1, south: 13.0, east: 80.3, west: 80.2 });
  expect(d.indoorZones).toHaveLength(1);
  expect(d.nodes[0]!.zoneId).toBeNull();
  // Backend fixture parses as a draft too.
  expect(parseDraftV3(fixture).indoorZones).toHaveLength(2);
});

test('stacked nodes on different floors at the same coordinates are allowed', () => {
  const d = parseDraftV3({
    ...base,
    nodes: [
      { id: 'n-g', name: 'Ground stair', lat: 13.05, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1 },
      { id: 'n-u', name: 'Upper stair', lat: 13.05, lng: 80.25, z: 1, zoneId: 'b-a', fingerprintRevision: 1 },
    ],
    edges: [{ from: 'n-g', to: 'n-u', meters: 4, kind: 'stairs' }],
  });
  expect(d.nodes).toHaveLength(2);
});

test('manifest profiles with fingerprintRevision (backend shape) parse', () => {
  const m = parseManifestV3({
    ...base,
    version: 1,
    profiles: [{ nodeId: 'n1', fingerprintRevision: 1, medianRssi: { 'AA:BB:CC:DD:EE:01': -52 }, scanCount: 3 }],
  });
  expect(m.profiles).toHaveLength(1);
});

test('v4 named nodes parse with stable id references', () => {
  const d = parseDraftV3(base);
  expect(d.schemaVersion).toBe(4);
  expect(d.nodes[0]).toMatchObject({ id: 'n1', name: 'Outdoor node', fingerprintRevision: 1 });
});

test('optional generated nodes and draft paths parse without defaulting omitted paths', () => {
  const fixture = twoNodeDraft();
  const grouped = {
    ...fixture,
    nodes: fixture.nodes.map((n, i) => (i === 0 ? { ...n, generated: true } : n)),
    paths: [{ id: 'route-1', name: 'Corridor', nodeIds: fixture.nodes.slice(0, 2).map((n) => n.id), controlNodeIds: ['n-a', 'n-b'] }],
  };

  expect((parseDraftV3(grouped) as Record<string, unknown>).paths).toEqual(grouped.paths);
  expect((parseDraftV3(fixture) as Record<string, unknown>).paths).toBeUndefined();
  expect(() => parseDraftV3({ ...grouped, paths: [{ id: 'x', name: 'X', nodeIds: ['one'] }] })).toThrow();
});

test('malformed draft path metadata and nonboolean generated flags fail strict parsing', () => {
  const fixture = twoNodeDraft();
  const grouped = {
    ...fixture,
    paths: [{ id: 'route-1', name: 'Corridor', nodeIds: ['n-a', 'n-b'] }],
  };

  expect(() => parseDraftV3({ ...fixture, nodes: [{ ...fixture.nodes[0], generated: 'yes' }, fixture.nodes[1]] })).toThrow(/generated/);
  expect(() => parseDraftV3({ ...grouped, paths: [{ id: 'route-1', name: 'Corridor', nodeIds: ['n-a', ''] }] })).toThrow(/nodeIds/);
  expect(() => parseDraftV3({ ...grouped, paths: [{ id: 'route-1', name: 'Corridor', nodeIds: ['n-a', 'n-b'], controlNodeIds: ['n-a'] }] })).toThrow(/controlNodeIds/);
  expect(() => parseDraftV3({ ...grouped, paths: [{ id: 'route-1', name: 'Corridor', nodeIds: ['n-a', 'n-b'], controlNodeIds: ['n-a', ''] }] })).toThrow(/controlNodeIds/);
  expect(() => parseDraftV3({ ...grouped, paths: [{ id: 'route-1', name: 'Corridor', nodeIds: ['n-a', 'n-b'], color: 'blue' }] })).toThrow(/unknown key/);
});

test('optional generated nodes and paths parse in manifests', () => {
  const fixture = twoNodeDraft();
  const grouped = {
    ...fixture,
    nodes: fixture.nodes.map((n, i) => (i === 0 ? { ...n, generated: true } : n)),
    paths: [{ id: 'route-1', name: 'Corridor', nodeIds: fixture.nodes.slice(0, 2).map((n) => n.id), controlNodeIds: ['n-a', 'n-b'] }],
    version: 1,
    profiles: [],
  };

  expect((parseManifestV3(grouped) as Record<string, unknown>).paths).toEqual(grouped.paths);
  expect((parseManifestV3({ ...fixture, version: 1, profiles: [] }) as Record<string, unknown>).paths).toBeUndefined();
  expect(() => parseManifestV3({ ...grouped, paths: [{ id: 'x', name: 'X', nodeIds: ['one'] }] })).toThrow();
});

test('missing or blank node names fail strict parsing', () => {
  expect(() => parseDraftV3({ ...base, nodes: [{ id: 'n1', lat: 13.05, lng: 80.25, z: 0, zoneId: null, fingerprintRevision: 1 }] })).toThrow(/name/);
  expect(() => parseDraftV3({ ...base, nodes: [{ id: 'n1', name: '', lat: 13.05, lng: 80.25, z: 0, zoneId: null, fingerprintRevision: 1 }] })).toThrow(/name/);
  expect(() => parseDraftV3({ ...base, nodes: [{ id: 'n1', name: '   ', lat: 13.05, lng: 80.25, z: 0, zoneId: null, fingerprintRevision: 1 }] })).toThrow(/name/);
});

test('schemaVersion 3 fails strict draft and manifest parsing', () => {
  expect(() => parseDraftV3({ ...base, schemaVersion: 3 })).toThrow(/schemaVersion/);
  expect(() => parseManifestV3({ ...base, schemaVersion: 3, version: 1, profiles: [] })).toThrow(/schemaVersion/);
});

test('object venueId fails strict draft and manifest parsing', () => {
  expect(() => parseDraftV3({ ...base, venueId: { id: 'demo' } })).toThrow(/venueId/);
  expect(() => parseManifestV3({ ...base, venueId: { id: 'demo' }, version: 1, profiles: [] })).toThrow(/venueId/);
});

test('bad bounds ordering is rejected', () => {
  expect(() =>
    parseDraftV3({ ...base, boundary: { north: 13.0, south: 13.1, east: 80.3, west: 80.2 } }),
  ).toThrow(/north>south/);
  expect(() =>
    parseManifestV3({ ...base, boundary: null, version: 1, profiles: [] }),
  ).toThrow(/non-null/);
});
