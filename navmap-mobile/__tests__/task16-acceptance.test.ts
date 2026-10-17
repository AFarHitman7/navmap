import { geographicDraft, staticDraft } from '../src/fixtures/map-v5';
import { parseMapManifest, parseMapDraft, upgradeV4Draft, upgradeV4Manifest } from '../src/map-contract';
import { parsePackManifest, loadActivePack, packDir, type PackAdapter } from '../src/pack';
import {
  WIFI_LOCATION_NOTE,
  classifyGpsZone,
  gpsDisplayDot,
  isGpsFixStale,
  isValidGpsFix,
  resolveLocation,
} from '../src/positioning-v3';

function v4Manifest(venueId: string): Record<string, unknown> {
  return {
    schemaVersion: 4,
    venueId,
    version: 1,
    boundary: { north: 13.1, south: 13.0, east: 80.3, west: 80.2 },
    indoorZones: [{
      id: 'b-legacy', name: 'Legacy Hall',
      bounds: { north: 13.08, south: 13.02, east: 80.28, west: 80.22 },
      floors: [{ z: 0, label: 'Ground' }],
    }],
    nodes: [
      { id: 'n-legacy-out', name: 'Legacy entrance', lat: 13.09, lng: 80.29, z: 0, zoneId: null, fingerprintRevision: 1 },
      { id: 'n-legacy-hall', name: 'Legacy hall', lat: 13.05, lng: 80.245, z: 0, zoneId: 'b-legacy', fingerprintRevision: 1 },
    ],
    edges: [{ from: 'n-legacy-out', to: 'n-legacy-hall', meters: 12, kind: 'entrance' }],
    places: [{ id: 'p-legacy', name: 'Legacy lobby', zoneId: 'b-legacy', nodeId: 'n-legacy-hall' }],
    anchors: [],
    aps: [],
    profiles: [],
  };
}

function memoryAdapter(files: Record<string, string>): PackAdapter {
  return {
    getJson: async () => { throw new Error('offline'); },
    getBytes: async () => { throw new Error('offline'); },
    writeFile: async () => { throw new Error('read-only'); },
    readFile: async (p) => { const v = files[p]; if (v === undefined) throw new Error('ENOENT'); return v; },
    writeBytes: async () => { throw new Error('read-only'); },
    readBytes: async () => { throw new Error('ENOENT'); },
    hashBytes: async () => '0'.repeat(64),
    rename: async () => { throw new Error('read-only'); },
    rmrf: async () => undefined,
  };
}

test('V4 packs stay readable through the in-memory upgrade adapter', () => {
  const manifest = parsePackManifest(v4Manifest('legacy-v4'));
  expect(manifest.schemaVersion).toBe(4);
  const upgraded = upgradeV4Manifest(v4Manifest('legacy-v4'));
  expect(upgraded.schemaVersion).toBe(5);
  expect(upgraded.canvas.kind).toBe('geographic');
  const { version: _v, profiles: _p, ...v4draft } = v4Manifest('legacy-v4');
  void _v; void _p;
  expect(upgradeV4Draft(v4draft).schemaVersion).toBe(5);
  expect(parseMapDraft(geographicDraft())).toBeTruthy();
  expect(parseMapManifest({ ...staticDraft(), version: 1, profiles: [] }).schemaVersion).toBe(5);
});

test('offline packs are isolated per map and never resolve across venues', async () => {
  const first = { ...geographicDraft(), venueId: 'map-a', version: 2, profiles: [] };
  const second = { ...geographicDraft(), venueId: 'map-b', version: 3, profiles: [] };
  expect(packDir('map-a', 2)).toBe('packs/map-a/2');
  expect(packDir('map-b', 3)).toBe('packs/map-b/3');
  expect(packDir('map-a', 2)).not.toBe(packDir('map-b', 3));
  const adapter = memoryAdapter({
    'packs/map-a/active.json': JSON.stringify({ activeVersion: 2 }),
    [`${packDir('map-a', 2)}/manifest.json`]: JSON.stringify(first),
    'packs/map-b/active.json': JSON.stringify({ activeVersion: 3 }),
    [`${packDir('map-b', 3)}/manifest.json`]: JSON.stringify(second),
  });
  expect((await loadActivePack('map-a', adapter))?.version).toBe(2);
  expect((await loadActivePack('map-b', adapter))?.version).toBe(3);
  expect(await loadActivePack('map-c', adapter)).toBeNull();
});

test('GPS evidence never claims an indoor node, room, or floor', () => {
  const geo = geographicDraft();
  expect(classifyGpsZone(geo, 13.05, 80.26)).toMatchObject({ kind: 'indoors', zoneId: 'b-a' });
  expect(classifyGpsZone(geo, 13.09, 80.29)).toMatchObject({ kind: 'outdoors' });
  // Static canvases are never classified: GPS cannot name a floor there either.
  expect(classifyGpsZone({ ...staticDraft(), canvas: { kind: 'static' } }, 0.5, 0.5)).toEqual({ kind: 'outside' });
  const now = Date.now();
  expect(isValidGpsFix({ lat: 13.05, lon: 80.25, accuracy: 8, seenAt: now })).toBe(true);
  expect(isValidGpsFix({ lat: 91, lon: 80.25, accuracy: 8, seenAt: now })).toBe(false);
  expect(isValidGpsFix({ lat: 13.05, lon: 80.25, accuracy: -1, seenAt: now })).toBe(false);
  expect(isGpsFixStale(now - 61_000, now)).toBe(true);
  expect(gpsDisplayDot({ lat: 13.05, lon: 80.25, accuracy: 8, seenAt: now - 61_000 }, now)).toBeNull();
  expect(gpsDisplayDot(null, now)).toBeNull();
  expect(WIFI_LOCATION_NOTE).toMatch(/native/i);
});

test('Wi-Fi and manual starts win over GPS; stale evidence never becomes a live dot', () => {
  const now = Date.now();
  const nodes = [{ id: 'n-a0', zoneId: 'b-a', z: 0 }];
  const wifi = resolveLocation(
    { wifi: { nodeId: 'n-a0', confidence: 'high', seenAt: now }, gpsZone: { kind: 'indoors', zoneId: 'b-a' }, gpsSeenAt: now, qr: null, manual: null },
    null, { nodes }, now,
  );
  expect(wifi).toMatchObject({ kind: 'node', source: 'wifi' });
  const manual = resolveLocation(
    { wifi: null, gpsZone: { kind: 'outdoors' }, gpsSeenAt: now, qr: null, manual: { nodeId: 'n-a0' } },
    null, { nodes }, now,
  );
  expect(manual).toMatchObject({ kind: 'node', source: 'manual' });
});
