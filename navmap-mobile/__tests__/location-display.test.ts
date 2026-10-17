import {
  GPS_AREA_NOTE,
  GPS_STALE_MS,
  classifyGpsZone,
  gpsDisplayDot,
  isGpsFixStale,
  isValidGpsFix,
  resolveLocation,
  WIFI_LOCATION_NOTE,
} from '../src/positioning-v3';
import { buildLeafletHtml } from '../src/map/leafletHtml';

const GEO_MAP = {
  boundary: { kind: 'geographic', north: 13.1, south: 13.0, east: 80.3, west: 80.2 },
  indoorZones: [
    { id: 'b-a', name: 'A', bounds: { kind: 'geographic', north: 13.08, south: 13.02, east: 80.28, west: 80.22 }, floors: [{ z: 0, label: 'Ground' }] },
  ],
  canvas: { kind: 'geographic' },
};

const STATIC_MAP = {
  boundary: { kind: 'local', left: 0, top: 0, right: 1, bottom: 1 },
  indoorZones: [{ id: 'b-a', name: 'A', bounds: { kind: 'local', left: 0, top: 0, right: 1, bottom: 1 }, floors: [{ z: 0, label: 'Ground' }] }],
  canvas: { kind: 'static' },
};

test('GPS stale timeout is 60s and stale fixes never become a precise live dot', () => {
  expect(GPS_STALE_MS).toBe(60_000);
  const fresh = { lat: 13.05, lon: 80.25, accuracy: 12, seenAt: 100_000 };
  expect(gpsDisplayDot(fresh, 100_000 + 59_999)).toEqual(fresh);
  expect(gpsDisplayDot(fresh, 100_000 + 60_001)).toBeNull();
  expect(isGpsFixStale(100_000, 100_000 + 60_001)).toBe(true);
  expect(isGpsFixStale(100_000, 100_000 + 60_000)).toBe(false);
});

test('invalid GPS fixes never become a precise live dot', () => {
  expect(isValidGpsFix({ lat: 13.05, lon: 80.25, accuracy: 12, seenAt: 100 })).toBe(true);
  expect(isValidGpsFix({ lat: Number.NaN, lon: 80.25, accuracy: 12, seenAt: 100 })).toBe(false);
  expect(isValidGpsFix({ lat: 13.05, lon: Number.POSITIVE_INFINITY, accuracy: 12, seenAt: 100 })).toBe(false);
  expect(isValidGpsFix({ lat: 91, lon: 80.25, accuracy: 12, seenAt: 100 })).toBe(false);
  expect(isValidGpsFix({ lat: 13.05, lon: 80.25, accuracy: -1, seenAt: 100 })).toBe(false);
  expect(isValidGpsFix({ lat: 13.05, lon: 80.25, accuracy: Number.NaN, seenAt: 100 })).toBe(false);
  expect(isValidGpsFix({ lat: 13.05, lon: 80.25, accuracy: 12, seenAt: Number.NaN })).toBe(false);
  expect(isValidGpsFix(null)).toBe(false);
  expect(gpsDisplayDot({ lat: 91, lon: 80.25, accuracy: 12, seenAt: 100 }, 101)).toBeNull();
  expect(gpsDisplayDot(null, 101)).toBeNull();
});

test('static canvases never classify GPS: always outside, never a zone', () => {
  expect(classifyGpsZone(STATIC_MAP as any, 13.05, 80.25)).toEqual({ kind: 'outside' });
  expect(classifyGpsZone(GEO_MAP as any, 13.05, 80.25)).toEqual({ kind: 'indoors', zoneId: 'b-a' });
});

test('low-confidence, unmatched, and stale Wi-Fi never become a precise live dot', () => {
  const map = { nodes: [{ id: 'n-a0', zoneId: 'b-a', z: 0 }] };
  const low = resolveLocation(
    { wifi: { nodeId: 'n-a0', confidence: 'low', seenAt: 90_000 }, gpsZone: null, gpsSeenAt: null, qr: null, manual: null },
    null, map as any, 100_000,
  );
  expect(low).toEqual({ kind: 'unknown' });
  const stale = resolveLocation(
    { wifi: { nodeId: 'n-a0', confidence: 'high', seenAt: 0 }, gpsZone: null, gpsSeenAt: null, qr: null, manual: null },
    null, map as any, 100_000,
  );
  expect(stale).toEqual({ kind: 'unknown' });
  const noMatch = resolveLocation(
    { wifi: { nodeId: 'ghost', confidence: 'high', seenAt: 90_000 }, gpsZone: null, gpsSeenAt: null, qr: null, manual: null },
    null, map as any, 100_000,
  );
  expect(noMatch).toEqual({ kind: 'unknown' });
});

test('GPS evidence never resolves to a node, room, or floor', () => {
  const map = { nodes: [{ id: 'n-a0', zoneId: 'b-a', z: 0 }] };
  const loc = resolveLocation(
    { wifi: null, gpsZone: { kind: 'indoors', zoneId: 'b-a' }, gpsSeenAt: 95_000, qr: null, manual: null },
    null, map as any, 100_000,
  );
  expect(loc.kind).toBe('zone');
  expect(loc).not.toHaveProperty('nodeId');
});

test('permission messaging stays honest about native requirements', () => {
  expect(WIFI_LOCATION_NOTE).toMatch(/native Android/i);
  expect(WIFI_LOCATION_NOTE).toMatch(/surveyed profiles/i);
  expect(GPS_AREA_NOTE).toMatch(/does not identify a node or floor/i);
});

test('leaflet html renders the unsnapped GPS dot only on geographic canvases', () => {
  const v3 = { boundary: null, zones: [], nodes: [], activeZoneId: null, floorFilter: null };
  const geographic = buildLeafletHtml({
    path: [], visitor: true, onlineTiles: true,
    gps: { lat: 13.05, lng: 80.25, accuracyMeters: 12 }, v3,
  });
  expect(geographic).toContain('gps-accuracy-ring');
  expect(geographic).toContain('gps-dot-marker');
  expect(geographic).toContain('unsnapped');
  const staticHtml = buildLeafletHtml({
    path: [], visitor: true, onlineTiles: true,
    gps: { lat: 13.05, lng: 80.25, accuracyMeters: 12 }, v3,
    staticFrame: { width: 200, height: 100, imageDataUri: 'data:image/png;base64,AA==', nodes: [] },
  });
  expect(staticHtml).toContain('"gps":null');
  expect(staticHtml).not.toContain('13.05');
});
