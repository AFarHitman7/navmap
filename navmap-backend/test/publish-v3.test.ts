import { describe, expect, it } from 'vitest';
import { validatePublishV3 } from '../src/validate-v3.js';
import { saveDraftV3Json, type DraftV3 } from '../src/draft.js';
import { publishV3 } from '../src/publish-v3.js';
import { addNodeSamples } from '../src/node-survey.js';
import { createDbForTest, discardDb } from './helpers.js';

const BOUNDARY = { north: 13.1, south: 13.0, east: 80.3, west: 80.2 };
const ZONE_A = {
  id: 'b-a',
  name: 'Building A',
  bounds: { north: 13.08, south: 13.02, east: 80.28, west: 80.22 },
  floors: [
    { z: 0, label: 'Ground' },
    { z: 1, label: 'Level 1' },
  ],
};

function base(): DraftV3 {
  return {
    schemaVersion: 4,
    venueId: 'demo',
    boundary: { ...BOUNDARY },
    indoorZones: [{ ...ZONE_A }],
    nodes: [{ id: 'n-out', name: 'Outdoor Pin', lat: 13.05, lng: 80.25, z: 0, zoneId: null, fingerprintRevision: 1 }],
    edges: [],
    places: [],
    anchors: [],
    aps: [],
  };
}

describe('validatePublishV3', () => {
  it('accepts a boundary-only map', () => {
    expect(validatePublishV3({ ...base(), indoorZones: [], nodes: [] })).toEqual([]);
  });

  it('rejects zones outside the boundary and positive-area overlap', () => {
    const outside: DraftV3 = {
      ...base(),
      indoorZones: [
        { ...ZONE_A },
        {
          id: 'b-b',
          name: 'B',
          bounds: { north: 13.5, south: 13.4, east: 80.5, west: 80.4 },
          floors: [{ z: 0, label: 'Ground' }],
        },
      ],
    };
    expect(validatePublishV3(outside).join(';')).toMatch(/outside|boundary/);
    const overlap: DraftV3 = {
      ...base(),
      indoorZones: [
        { ...ZONE_A },
        {
          id: 'b-c',
          name: 'C',
          bounds: { north: 13.07, south: 13.03, east: 80.27, west: 80.23 },
          floors: [{ z: 0, label: 'Ground' }],
        },
      ],
    };
    expect(validatePublishV3(overlap).join(';')).toMatch(/overlap/);
  });

  it('rejects path edges across floors and allows stairs within a building', () => {
    const bad: DraftV3 = {
      ...base(),
      nodes: [
        { id: 'g', name: 'Ground Stair', lat: 13.05, lng: 80.245, z: 0, zoneId: 'b-a', fingerprintRevision: 1 },
        { id: 'u', name: 'Upper Stair', lat: 13.05, lng: 80.245, z: 1, zoneId: 'b-a', fingerprintRevision: 1 },
      ],
      edges: [{ from: 'g', to: 'u', meters: 5, kind: 'path' }],
    };
    expect(validatePublishV3(bad).join(';')).toMatch(/same zone and floor|path/);
    const ok: DraftV3 = { ...bad, edges: [{ from: 'g', to: 'u', meters: 4, kind: 'stairs' }] };
    expect(validatePublishV3(ok)).toEqual([]);
  });

  it('rejects grouped routes with missing graph connections', () => {
    const d = { ...base(), nodes: [
      { id: 'a', name: 'A', lat: 13.05, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1 },
      { id: 'b', name: 'B', lat: 13.05001, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1, generated: true },
    ], paths: [{ id: 'corridor', name: 'Corridor', nodeIds: ['a', 'b'] }] } satisfies DraftV3;
    expect(validatePublishV3(d).join(';')).toMatch(/corridor.*connection/);
    expect(validatePublishV3({ ...d, edges: [{ from: 'a', to: 'b', meters: 1.12, kind: 'path' }] })).toEqual([]);
  });

  it('rejects duplicate path IDs, unknown nodes, repeated consecutive IDs, and missing sequence edges', () => {
    const d: DraftV3 = {
      ...base(),
      nodes: [
        { id: 'a', name: 'A', lat: 13.05, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1 },
        { id: 'b', name: 'B', lat: 13.05001, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1 },
        { id: 'c', name: 'C', lat: 13.05002, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1 },
      ],
      edges: [{ from: 'a', to: 'b', meters: 1, kind: 'path' }],
      paths: [
        { id: 'dup', name: 'First duplicate', nodeIds: ['a', 'b'] },
        { id: 'dup', name: 'Second duplicate', nodeIds: ['a', 'b'] },
        { id: 'unknown', name: 'Unknown node', nodeIds: ['a', 'missing'] },
        { id: 'same-step', name: 'Consecutive duplicate', nodeIds: ['a', 'a'] },
        { id: 'gap', name: 'Missing edge', nodeIds: ['b', 'c'] },
      ],
    };
    const joined = validatePublishV3(d).join(';');
    expect(joined).toMatch(/duplicate path id: dup/);
    expect(joined).toMatch(/unknown.*missing/);
    expect(joined).toMatch(/same-step.*consecutive/);
    expect(joined).toMatch(/gap.*connection/);
  });

  it('allows valid loops and stairs sequences in grouped routes', () => {
    const d: DraftV3 = {
      ...base(),
      nodes: [
        { id: 'a', name: 'A', lat: 13.05, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1 },
        { id: 'b', name: 'B', lat: 13.05001, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1 },
        { id: 'c', name: 'C', lat: 13.05002, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1 },
        { id: 'u', name: 'Upper', lat: 13.05002, lng: 80.25, z: 1, zoneId: 'b-a', fingerprintRevision: 1 },
      ],
      edges: [
        { from: 'a', to: 'b', meters: 1, kind: 'path' },
        { from: 'b', to: 'c', meters: 1, kind: 'path' },
        { from: 'c', to: 'u', meters: 4, kind: 'stairs' },
      ],
      paths: [
        { id: 'loop', name: 'Loop', nodeIds: ['a', 'b', 'c', 'b', 'a'], controlNodeIds: ['b', 'b'] },
        { id: 'stairs-route', name: 'Stairs route', nodeIds: ['b', 'c', 'u'] },
      ],
    };
    expect(validatePublishV3(d)).toEqual([]);
  });

  it('rejects controls outside the path sequence or out of sequence order', () => {
    const d: DraftV3 = {
      ...base(),
      nodes: [
        { id: 'a', name: 'A', lat: 13.05, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1 },
        { id: 'b', name: 'B', lat: 13.05001, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1 },
        { id: 'c', name: 'C', lat: 13.05002, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1 },
      ],
      edges: [
        { from: 'a', to: 'b', meters: 1, kind: 'path' },
        { from: 'b', to: 'c', meters: 1, kind: 'path' },
      ],
      paths: [
        { id: 'missing-control', name: 'Missing control', nodeIds: ['a', 'b'], controlNodeIds: ['a', 'c'] },
        { id: 'wrong-order', name: 'Wrong order', nodeIds: ['a', 'b', 'c'], controlNodeIds: ['c', 'b'] },
      ],
    };
    const joined = validatePublishV3(d).join(';');
    expect(joined).toMatch(/missing-control.*control.*c.*sequence/);
    expect(joined).toMatch(/wrong-order.*control.*order/);
  });
});

describe('publishV3', () => {
  it('emits V4 manifests with grouped paths and profiles keyed by generated node id and revision', () => {
    const db = createDbForTest();
    try {
      const draft: DraftV3 = {
        ...base(),
        nodes: [
          { id: 'entry', name: 'Entry', lat: 13.05, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1 },
          { id: 'generated-point', name: 'Generated midpoint', lat: 13.05001, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 9, generated: true },
        ],
        edges: [{ from: 'entry', to: 'generated-point', meters: 1.12, kind: 'path' }],
        paths: [{ id: 'corridor', name: 'Corridor', nodeIds: ['entry', 'generated-point'], controlNodeIds: ['entry', 'generated-point'] }],
        aps: ['AA:BB:CC:DD:EE:01', 'AA:BB:CC:DD:EE:02'],
      };
      saveDraftV3Json(db, 'demo', JSON.stringify(draft));
      db.prepare('INSERT INTO aps (venue_id, json) VALUES (?, ?) ON CONFLICT(venue_id) DO UPDATE SET json = excluded.json').run(
        'demo',
        JSON.stringify(draft.aps),
      );
      addNodeSamples(db, 'demo', 'generated-point', [1, 2, 3].map((i) => ({
        nodeId: 'generated-point',
        fingerprintRevision: 9,
        capturedAt: 1000 + i,
        readings: [
          { bssid: 'AA:BB:CC:DD:EE:01', rssi: -50 - i },
          { bssid: 'AA:BB:CC:DD:EE:02', rssi: -60 },
        ],
      })));
      for (const i of [1, 2, 3]) {
        db.prepare('INSERT INTO node_samples (venue_id, node_id, fingerprint_revision, captured_at, readings_json) VALUES (?, ?, ?, ?, ?)').run(
          'demo',
          'generated-point',
          8,
          900 + i,
          JSON.stringify([
            { bssid: 'AA:BB:CC:DD:EE:01', rssi: -20 },
            { bssid: 'AA:BB:CC:DD:EE:02', rssi: -30 },
          ]),
        );
      }

      const manifest = publishV3(db, 'unused-test-data-dir', 'demo');

      expect(manifest.schemaVersion).toBe(4);
      expect(manifest.nodes[1]).toMatchObject({ id: 'generated-point', name: 'Generated midpoint', generated: true, fingerprintRevision: 9 });
      expect(manifest.paths).toEqual(draft.paths);
      expect(manifest.profiles).toHaveLength(1);
      expect(manifest.profiles[0]).toMatchObject({ nodeId: 'generated-point', fingerprintRevision: 9, scanCount: 3 });
    } finally {
      discardDb(db);
    }
  });
});
