import { describe, expect, it } from 'vitest';
import { login, testContext, discardDb } from './helpers.js';

const DRAFT = {
  schemaVersion: 4,
  venueId: 'demo',
  boundary: { north: 13.1, south: 13.0, east: 80.3, west: 80.2 },
  indoorZones: [],
  nodes: [],
  edges: [],
  places: [],
  anchors: [],
  aps: [],
};

describe('v3 api', () => {
  it('creates static maps with a V5 draft atomically when authoring is enabled', async () => {
    const prior = process.env.MAP_V5_AUTHORING_ENABLED;
    process.env.MAP_V5_AUTHORING_ENABLED = '1';
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const headers = { cookie, origin: 'http://localhost' };
      const staticCreated = await app.inject({ method: 'POST', url: '/api/admin/venues', headers, payload: { name: 'Gallery', canvasKind: 'static' } });
      const geoCreated = await app.inject({ method: 'POST', url: '/api/admin/venues', headers, payload: { name: 'Gallery', canvasKind: 'geographic' } });
      expect(staticCreated.statusCode).toBe(201);
      expect(geoCreated.statusCode).toBe(201);
      const staticMap = staticCreated.json();
      const geoMap = geoCreated.json();
      expect(staticMap.id).not.toBe(geoMap.id);
      const staticUrl = `/api/admin/venues/${staticMap.id}/draft-v3`;
      const geoUrl = `/api/admin/venues/${geoMap.id}/draft-v3`;
      const staticDraft = (await app.inject({ method: 'GET', url: staticUrl, headers })).json();
      const geoDraft = (await app.inject({ method: 'GET', url: geoUrl, headers })).json();
      expect(staticDraft).toMatchObject({ schemaVersion: 5, venueId: staticMap.id, canvas: { kind: 'static' } });
      expect(geoDraft).toMatchObject({ schemaVersion: 5, venueId: geoMap.id, canvas: { kind: 'geographic' } });
      const saved = await app.inject({ method: 'PUT', url: staticUrl, headers, payload: staticDraft });
      expect(saved.statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: geoUrl, headers })).json()).toMatchObject({ canvas: { kind: 'geographic' }, venueId: geoMap.id });
      const renamed = await app.inject({ method: 'PATCH', url: `/api/admin/venues/${staticMap.id}`, headers, payload: { name: 'Gallery North' } });
      expect(renamed.json()).toMatchObject({ id: staticMap.id, name: 'Gallery North' });
    } finally {
      discardDb(db);
      if (prior === undefined) delete process.env.MAP_V5_AUTHORING_ENABLED;
      else process.env.MAP_V5_AUTHORING_ENABLED = prior;
    }
  });

  it('rejects V5 map creation when the authoring capability is disabled', async () => {
    const prior = process.env.MAP_V5_AUTHORING_ENABLED;
    delete process.env.MAP_V5_AUTHORING_ENABLED;
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const denied = await app.inject({ method: 'POST', url: '/api/admin/venues', headers: { cookie, origin: 'http://localhost' }, payload: { name: 'Blocked', canvasKind: 'static' } });
      expect(denied.statusCode).toBe(403);
      const legacy = await app.inject({ method: 'POST', url: '/api/admin/venues', headers: { cookie, origin: 'http://localhost' }, payload: { name: 'Legacy' } });
      expect(legacy.statusCode).toBe(201);
      const draft = await app.inject({ method: 'GET', url: `/api/admin/venues/${legacy.json().id}/draft-v3`, headers: { cookie, origin: 'http://localhost' } });
      expect(draft.json()).toMatchObject({ schemaVersion: 4, venueId: legacy.json().id });
    } finally {
      discardDb(db);
      if (prior !== undefined) process.env.MAP_V5_AUTHORING_ENABLED = prior;
    }
  });

  it('round-trips a boundary-only draft and publishes without images or surveys', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const anon = await app.inject({ method: 'GET', url: '/api/admin/venues/demo/draft-v3' });
      expect(anon.statusCode).toBe(401);
      const put = await app.inject({
        method: 'PUT',
        url: '/api/admin/venues/demo/draft-v3',
        headers: { cookie, origin: 'http://localhost' },
        payload: DRAFT,
      });
      expect(put.statusCode).toBe(200);
      const get = await app.inject({
        method: 'GET',
        url: '/api/admin/venues/demo/draft-v3',
        headers: { cookie, origin: 'http://localhost' },
      });
      expect(get.statusCode).toBe(200);
      expect(get.json()).toMatchObject({ schemaVersion: 4, venueId: 'demo' });
      const pub = await app.inject({
        method: 'POST',
        url: '/api/admin/venues/demo/publish-v3',
        headers: { cookie, origin: 'http://localhost' },
      });
      expect(pub.statusCode).toBe(200);
      expect(pub.json()).toMatchObject({ schemaVersion: 4, version: 1, profiles: [] });
      const manifest = await app.inject({ method: 'GET', url: '/api/venues/demo/versions/1/manifest' });
      expect(manifest.statusCode).toBe(200);
      expect(manifest.json()).toMatchObject({ schemaVersion: 4, version: 1 });
    } finally {
      discardDb(db);
    }
  });

  it('rejects node samples for unknown nodes and publishes viable node profiles', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const draft = {
        ...DRAFT,
        indoorZones: [
          {
            id: 'b-a',
            name: 'A',
            bounds: { north: 13.08, south: 13.02, east: 80.28, west: 80.22 },
            floors: [{ z: 0, label: 'Ground' }],
          },
        ],
        nodes: [{ id: 'n1', name: 'North Lobby', lat: 13.05, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1 }],
        aps: ['AA:BB:CC:DD:EE:01', 'AA:BB:CC:DD:EE:02'],
      };
      expect(
        (await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie, origin: 'http://localhost' }, payload: draft })).statusCode,
      ).toBe(200);
      const bad = await app.inject({
        method: 'POST',
        url: '/api/admin/venues/demo/node-samples',
        headers: { cookie, origin: 'http://localhost' },
        payload: {
          nodeId: 'nope',
          scans: [{ nodeId: 'nope', fingerprintRevision: 1, capturedAt: 1, readings: [{ bssid: 'AA:BB:CC:DD:EE:01', rssi: -50 }] }],
        },
      });
      expect(bad.statusCode).toBe(400);
      const scans = [1, 2, 3].map((i) => ({
        nodeId: 'n1',
        fingerprintRevision: 1,
        capturedAt: 1000 + i,
        readings: [
          { bssid: 'AA:BB:CC:DD:EE:01', rssi: -50 - i },
          { bssid: 'AA:BB:CC:DD:EE:02', rssi: -60 },
        ],
      }));
      const ok = await app.inject({
        method: 'POST',
        url: '/api/admin/venues/demo/node-samples',
        headers: { cookie, origin: 'http://localhost' },
        payload: { nodeId: 'n1', scans },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ count: 3 });
      const pub = await app.inject({ method: 'POST', url: '/api/admin/venues/demo/publish-v3', headers: { cookie, origin: 'http://localhost' } });
      expect(pub.statusCode).toBe(200);
      expect(pub.json().profiles).toHaveLength(1);
      expect(pub.json().profiles[0]).toMatchObject({ nodeId: 'n1', scanCount: 3 });
    } finally {
      discardDb(db);
    }
  });

  it('rejects venue mismatch without writing to the other venue', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const created = await app.inject({
        method: 'POST',
        url: '/api/admin/venues',
        headers: { cookie, origin: 'http://localhost' },
        payload: { name: 'Second' },
      });
      const otherId = (created.json() as { id: string }).id;
      const mismatch = await app.inject({
        method: 'PUT',
        url: '/api/admin/venues/demo/draft-v3',
        headers: { cookie, origin: 'http://localhost' },
        payload: { ...DRAFT, venueId: otherId },
      });
      expect(mismatch.statusCode).toBe(400);
      const other = await app.inject({
        method: 'GET',
        url: `/api/admin/venues/${otherId}/draft-v3`,
        headers: { cookie, origin: 'http://localhost' },
      });
      expect(other.statusCode).toBe(200);
      expect(other.json()).toMatchObject({ schemaVersion: 4, venueId: otherId, boundary: null, nodes: [] });
    } finally {
      discardDb(db);
    }
  });

  it('round-trips named V4 nodes exactly', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const draft = {
        ...DRAFT,
        indoorZones: [
          {
            id: 'b-a',
            name: 'A',
            bounds: { north: 13.08, south: 13.02, east: 80.28, west: 80.22 },
            floors: [{ z: 0, label: 'Ground' }],
          },
        ],
        nodes: [
          { id: 'n1', name: '  Lobby Desk – East  ', lat: 13.05, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 7 },
        ],
      };
      const put = await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie, origin: 'http://localhost' }, payload: draft });
      expect(put.statusCode).toBe(200);
      const get = await app.inject({ method: 'GET', url: '/api/admin/venues/demo/draft-v3', headers: { cookie, origin: 'http://localhost' } });
      expect(get.statusCode).toBe(200);
      expect(get.json().nodes[0]).toMatchObject({ id: 'n1', name: '  Lobby Desk – East  ', fingerprintRevision: 7 });
    } finally {
      discardDb(db);
    }
  });

  it('round-trips grouped paths through save, load, publish, and manifest fetch', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const draft = {
        ...DRAFT,
        indoorZones: [
          {
            id: 'b-a',
            name: 'A',
            bounds: { north: 13.08, south: 13.02, east: 80.28, west: 80.22 },
            floors: [{ z: 0, label: 'Ground' }],
          },
        ],
        nodes: [
          { id: 'a', name: 'A', lat: 13.05, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1 },
          { id: 'b', name: 'B', lat: 13.05001, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1, generated: true },
        ],
        edges: [{ from: 'a', to: 'b', meters: 1.12, kind: 'path' }],
        paths: [{ id: 'corridor', name: 'Corridor', nodeIds: ['a', 'b'], controlNodeIds: ['a', 'b'] }],
      };
      const put = await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie, origin: 'http://localhost' }, payload: draft });
      expect(put.statusCode).toBe(200);
      const get = await app.inject({ method: 'GET', url: '/api/admin/venues/demo/draft-v3', headers: { cookie, origin: 'http://localhost' } });
      expect(get.statusCode).toBe(200);
      expect(get.json().paths).toEqual(draft.paths);
      const pub = await app.inject({ method: 'POST', url: '/api/admin/venues/demo/publish-v3', headers: { cookie, origin: 'http://localhost' } });
      expect(pub.statusCode).toBe(200);
      expect(pub.json().paths).toEqual(draft.paths);
      const manifest = await app.inject({ method: 'GET', url: '/api/venues/demo/versions/1/manifest' });
      expect(manifest.statusCode).toBe(200);
      expect(manifest.json().paths).toEqual(draft.paths);
    } finally {
      discardDb(db);
    }
  });
});
