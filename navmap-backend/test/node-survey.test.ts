import { describe, expect, it } from 'vitest';
import { createDbForTest, discardDb } from './helpers.js';
import { saveDraftV3Json } from '../src/draft.js';
import { addNodeSamples, buildNodeProfiles, loadNodeSamples } from '../src/node-survey.js';

const DRAFT = {
  schemaVersion: 4,
  venueId: 'demo',
  boundary: { north: 13.1, south: 13.0, east: 80.3, west: 80.2 },
  indoorZones: [
    {
      id: 'b-a',
      name: 'A',
      bounds: { north: 13.08, south: 13.02, east: 80.28, west: 80.22 },
      floors: [{ z: 0, label: 'Ground' }],
    },
  ],
  nodes: [{ id: 'n1', name: 'Survey Node', lat: 13.05, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1 }],
  edges: [],
  places: [],
  anchors: [],
  aps: ['AA:BB:CC:DD:EE:01', 'AA:BB:CC:DD:EE:02'],
} as const;

function scans() {
  return [1, 2, 3].map((i) => ({
    nodeId: 'n1',
    fingerprintRevision: 1,
    capturedAt: 1000 + i,
    readings: [
      { bssid: 'aa:bb:cc:dd:ee:01', rssi: -50 - i },
      { bssid: 'AA:BB:CC:DD:EE:02', rssi: -60 },
    ],
  }));
}

describe('node surveys', () => {
  it('stores scans per node+revision and builds a median profile', () => {
    const db = createDbForTest();
    try {
      saveDraftV3Json(db, 'demo', JSON.stringify({ ...DRAFT, aps: [...DRAFT.aps] }));
      db.prepare('INSERT INTO aps (venue_id, json) VALUES (?, ?) ON CONFLICT(venue_id) DO UPDATE SET json = excluded.json').run(
        'demo',
        JSON.stringify(['AA:BB:CC:DD:EE:01', 'AA:BB:CC:DD:EE:02']),
      );
      expect(addNodeSamples(db, 'demo', 'n1', scans())).toBe(3);
      expect(loadNodeSamples(db, 'demo', 'n1')).toHaveLength(3);
      const profiles = buildNodeProfiles(loadNodeSamples(db, 'demo', 'n1'), [
        'AA:BB:CC:DD:EE:01',
        'AA:BB:CC:DD:EE:02',
      ]);
      expect(profiles).toHaveLength(1);
      expect(profiles[0]!.scanCount).toBe(3);
      expect(profiles[0]!.medianRssi['AA:BB:CC:DD:EE:01']).toBe(-52);
    } finally {
      discardDb(db);
    }
  });

  it('rejects scans for unknown nodes and stale revisions', () => {
    const db = createDbForTest();
    try {
      saveDraftV3Json(db, 'demo', JSON.stringify(DRAFT));
      expect(() => addNodeSamples(db, 'demo', 'nope', scans())).toThrow(/unknown node/);
      const stale = scans().map((s) => ({ ...s, fingerprintRevision: 0 }));
      expect(() => addNodeSamples(db, 'demo', 'n1', stale)).toThrow(/revision/);
    } finally {
      discardDb(db);
    }
  });
});
