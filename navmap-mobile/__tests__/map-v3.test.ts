import { buildLeafletHtml } from '../src/map/leafletHtml';

const V3_INPUT = {
  path: ['n-out', 'n-a0'],
  v3: {
    boundary: { north: 13.1, south: 13.0, east: 80.3, west: 80.2 },
    zones: [
      {
        id: 'b-a',
        name: 'Building A',
        bounds: { north: 13.08, south: 13.02, east: 80.28, west: 80.22 },
      },
    ],
    nodes: [
      { id: 'n-out', lat: 13.05, lng: 80.25, z: 0, zoneId: null as string | null },
      { id: 'n-a0', lat: 13.05, lng: 80.245, z: 0, zoneId: 'b-a' as string | null },
    ],
    activeZoneId: null as string | null,
    floorFilter: null as number | null,
  },
};

function appRenderer(html: string): string {
  return html.slice(html.indexOf('window.__NAVMAP__='), html.indexOf('//# sourceURL=navmap-leaflet'));
}

test('v3 input embeds boundary/zone coordinates and node ids on a geographic map', () => {
  const html = buildLeafletHtml(V3_INPUT);
  // Boundary + zone rectangles.
  expect(html).toContain('13.1');
  expect(html).toContain('80.2');
  expect(html).toContain('13.08');
  expect(html).toContain('80.22');
  expect(html).toContain('Building A');
  // Node ids ride along for markers + path polyline.
  expect(html).toContain('n-out');
  expect(html).toContain('n-a0');
  // Geographic renderer: default EPSG3857, no pixel-space image overlay.
  expect(appRenderer(html)).not.toMatch(/CRS\.Simple/);
  expect(appRenderer(html)).not.toMatch(/imageOverlay/);
  expect(appRenderer(html)).toContain('routeSegment');
});

test('v3 loads OSM tiles only when online; offline keeps a plain fallback with no remote src', () => {
  const offline = buildLeafletHtml(V3_INPUT);
  expect(offline).not.toMatch(/src="https?:\/\//);
  expect(offline).toMatch(/tile\.openstreetmap\.org/);
  const online = buildLeafletHtml({ ...V3_INPUT, onlineTiles: true });
  expect(online).toMatch(/tile\.openstreetmap\.org/);
});
