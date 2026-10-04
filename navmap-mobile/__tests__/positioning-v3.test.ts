import { classifyGpsZone, matchNode } from '../src/positioning-v3';
import { shortestPathV3 } from '../src/route-v3';
import type { EdgeV3, ManifestV3, NodeV3 } from '../src/contract-v3';

const ALLOW = ['AA:BB:CC:DD:EE:01', 'AA:BB:CC:DD:EE:02', 'AA:BB:CC:DD:EE:03'];

const PROFILES = [
  { nodeId: 'n-g', medianRssi: { 'AA:BB:CC:DD:EE:01': -50, 'AA:BB:CC:DD:EE:02': -60 }, scanCount: 3 },
  { nodeId: 'n-u', medianRssi: { 'AA:BB:CC:DD:EE:01': -75, 'AA:BB:CC:DD:EE:02': -62 }, scanCount: 3 },
];

const MAP = {
  boundary: { north: 13.1, south: 13.0, east: 80.3, west: 80.2 },
  indoorZones: [
    { id: 'b-a', name: 'A', bounds: { north: 13.08, south: 13.02, east: 80.28, west: 80.22 }, floors: [{ z: 0, label: 'Ground' }] },
  ],
};

test('matchNode distinguishes stacked-floor nodes by fingerprint', () => {
  const m = matchNode(
    [
      { bssid: 'AA:BB:CC:DD:EE:01', rssi: -51 },
      { bssid: 'AA:BB:CC:DD:EE:02', rssi: -61 },
    ],
    PROFILES,
    ALLOW,
  );
  expect(m?.nodeId).toBe('n-g');
});

test('matchNode rejects a poor absolute fit even with no runner-up', () => {
  const m = matchNode(
    [
      { bssid: 'AA:BB:CC:DD:EE:01', rssi: -90 },
      { bssid: 'AA:BB:CC:DD:EE:02', rssi: -20 },
    ],
    [PROFILES[0]!],
    ALLOW,
  );
  expect(m).toBeNull();
});

test('classifyGpsZone separates indoors, outdoors, and outside', () => {
  expect(classifyGpsZone(MAP, 13.05, 80.25)).toEqual({ kind: 'indoors', zoneId: 'b-a' });
  expect(classifyGpsZone(MAP, 13.09, 80.29)).toEqual({ kind: 'outdoors' });
  expect(classifyGpsZone(MAP, 14.0, 81.0)).toEqual({ kind: 'outside' });
});

function pathNode(id: string, zoneId: string | null, z: number, generated = false): NodeV3 {
  return { id, name: id, lat: 12.5, lng: 77.5, z, zoneId, fingerprintRevision: 1, ...(generated ? { generated: true as const } : {}) };
}

function pathEdge(from: string, to: string, meters: number, kind: EdgeV3['kind']): EdgeV3 {
  return { from, to, meters, kind };
}

/** Manifest with a bend, a shared junction, and an explicit stairs link. */
function pathManifest(): ManifestV3 {
  return {
    schemaVersion: 4,
    venueId: 'paths',
    version: 1,
    boundary: { north: 13, south: 12, east: 78, west: 77 },
    indoorZones: [
      {
        id: 'hall',
        name: 'Hall',
        bounds: { north: 13, south: 12, east: 78, west: 77 },
        floors: [
          { z: 0, label: 'G' },
          { z: 1, label: '1' },
        ],
      },
    ],
    nodes: [
      pathNode('gen-start', 'hall', 0, true),
      pathNode('bend', 'hall', 0, true),
      pathNode('junc', 'hall', 0, true),
      pathNode('side-a', 'hall', 0),
      pathNode('landing-0', 'hall', 0, true),
      pathNode('landing-1', 'hall', 1, true),
      pathNode('room-201', 'hall', 1),
      { ...pathNode('ghost', 'hall', 1), lat: 12.5, lng: 77.5 },
    ],
    edges: [
      pathEdge('gen-start', 'bend', 3, 'path'),
      pathEdge('bend', 'junc', 3, 'path'),
      pathEdge('junc', 'landing-0', 4, 'path'),
      pathEdge('side-a', 'junc', 2, 'path'),
      pathEdge('landing-0', 'landing-1', 4, 'stairs'),
      pathEdge('landing-1', 'room-201', 6, 'path'),
      // Ordinary edge crossing floors: rejected by the same-floor path rule.
      pathEdge('ghost', 'landing-0', 4, 'path'),
    ],
    places: [],
    anchors: [],
    aps: ALLOW,
    profiles: [],
    paths: [
      { id: 'p-main', name: 'Corridor', nodeIds: ['gen-start', 'bend', 'junc', 'landing-0', 'landing-1'] },
      { id: 'p-side', name: 'Link', nodeIds: ['side-a', 'junc'] },
    ],
  };
}

test('matchNode picks the generated reference point, which routes via junction and stairs', () => {
  const profiles = [
    { nodeId: 'gen-start', medianRssi: { 'AA:BB:CC:DD:EE:01': -50, 'AA:BB:CC:DD:EE:02': -60 }, scanCount: 3 },
    { nodeId: 'landing-0', medianRssi: { 'AA:BB:CC:DD:EE:01': -70, 'AA:BB:CC:DD:EE:02': -62 }, scanCount: 3 },
    { nodeId: 'room-201', medianRssi: { 'AA:BB:CC:DD:EE:01': -80, 'AA:BB:CC:DD:EE:02': -75 }, scanCount: 3 },
  ];
  const m = matchNode(
    [
      { bssid: 'AA:BB:CC:DD:EE:01', rssi: -51 },
      { bssid: 'AA:BB:CC:DD:EE:02', rssi: -61 },
    ],
    profiles,
    ALLOW,
  );
  expect(m?.nodeId).toBe('gen-start');
  const manifest = pathManifest();
  expect(shortestPathV3(manifest, m!.nodeId, 'room-201')).toEqual([
    'gen-start',
    'bend',
    'junc',
    'landing-0',
    'landing-1',
    'room-201',
  ]);
  // Ghost touches the graph but stays unreachable: no vertical link reaches floor 1.
  expect(shortestPathV3(manifest, 'gen-start', 'ghost')).toBeNull();
});
