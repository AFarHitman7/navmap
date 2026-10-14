// Task 2 RED: V5 persistence — capability gate, frame-aware save validation,
// V5 publish (geographic real, static rejected), original-bytes public reads.
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5.js';
import { loadDraftV3Json } from '../src/draft.js';
import { login, testContext, discardDb } from './helpers.js';

function withFlag<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.MAP_V5_AUTHORING_ENABLED;
  if (value === undefined) delete process.env.MAP_V5_AUTHORING_ENABLED;
  else process.env.MAP_V5_AUTHORING_ENABLED = value;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.MAP_V5_AUTHORING_ENABLED;
    else process.env.MAP_V5_AUTHORING_ENABLED = prev;
  });
}

describe('v5 persistence', () => {
  it('reports the authoring capability as disabled by default', async () => {
    const { db, app } = testContext();
    try {
      await withFlag(undefined, async () => {
        const res = await app.inject({ method: 'GET', url: '/api/capabilities' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ mapV5AuthoringEnabled: false });
      });
      await withFlag('1', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/capabilities' });
        expect(res.json()).toEqual({ mapV5AuthoringEnabled: true });
      });
    } finally {
      discardDb(db);
    }
  });

  it('rejects V5 saves while the flag is disabled, without touching the draft', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const before = loadDraftV3Json(db, 'demo');
      await withFlag(undefined, async () => {
        const put = await app.inject({
          method: 'PUT',
          url: '/api/admin/venues/demo/draft-v3',
          headers: { cookie },
          payload: { ...geographicDraft(), venueId: 'demo' },
        });
        expect(put.statusCode).toBe(403);
      });
      expect(loadDraftV3Json(db, 'demo')).toBe(before);
    } finally {
      discardDb(db);
    }
  });

  it('saves and reloads a V5 geographic draft with the flag enabled', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      await withFlag('1', async () => {
        const put = await app.inject({
          method: 'PUT',
          url: '/api/admin/venues/demo/draft-v3',
          headers: { cookie },
          payload: { ...geographicDraft(), venueId: 'demo' },
        });
        expect(put.statusCode).toBe(200);
        expect(put.json()).toMatchObject({ schemaVersion: 5, canvas: { kind: 'geographic' } });
        const get = await app.inject({ method: 'GET', url: '/api/admin/venues/demo/draft-v3', headers: { cookie } });
        expect(get.statusCode).toBe(200);
        expect(get.json()).toMatchObject({ schemaVersion: 5, venueId: 'demo' });
      });
    } finally {
      discardDb(db);
    }
  });

  it('validates graph/frame membership at save time, not only at publish', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      await withFlag('1', async () => {
        const badFrame = { ...geographicDraft(), venueId: 'demo' };
        (badFrame.nodes[0] as { frameId: string }).frameId = 'frame-missing';
        const put = await app.inject({
          method: 'PUT',
          url: '/api/admin/venues/demo/draft-v3',
          headers: { cookie },
          payload: badFrame,
        });
        expect(put.statusCode).toBe(400);
        // Static content on a background-less frame is rejected at save.
        const draft = { ...staticDraft(), venueId: 'demo' };
        const outdoor = draft.frames.find((f) => f.id === 'frame-outdoor-z0')!;
        const lo = outdoor.bounds as { kind: 'local'; left: number; top: number; right: number; bottom: number };
        const loDraft = {
          ...draft,
          nodes: [
            ...draft.nodes,
            {
              id: 's-x', name: 'Outdoor point', frameId: 'frame-outdoor-z0',
              position: { kind: 'local', x: (lo.left + lo.right) / 2, y: (lo.top + lo.bottom) / 2 },
              zoneId: null, z: 0, fingerprintRevision: 1, visitorVisible: true,
            },
          ],
        };
        const putStatic = await app.inject({
          method: 'PUT',
          url: '/api/admin/venues/demo/draft-v3',
          headers: { cookie },
          payload: loDraft,
        });
        expect(putStatic.statusCode).toBe(400);
      });
    } finally {
      discardDb(db);
    }
  });

  it('publishes a V5 geographic map preserving frames/transitions/visibility', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      await withFlag('1', async () => {
        await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie }, payload: { ...geographicDraft(), venueId: 'demo' } });
        const pub = await app.inject({ method: 'POST', url: '/api/admin/venues/demo/publish-v3', headers: { cookie } });
        expect(pub.statusCode).toBe(200);
        expect(pub.json()).toMatchObject({
          schemaVersion: 5,
          version: 1,
          canvas: { kind: 'geographic' },
          frames: expect.any(Array),
          transitions: expect.any(Array),
        });
        const manifest = await app.inject({ method: 'GET', url: '/api/venues/demo/versions/1/manifest' });
        expect(manifest.statusCode).toBe(200);
        expect(manifest.json()).toMatchObject({ schemaVersion: 5, canvas: { kind: 'geographic' } });
        const hidden = (manifest.json() as { nodes: Array<{ id: string; visitorVisible: boolean }> }).nodes.find((n) => n.id === 'n-a0g');
        expect(hidden?.visitorVisible).toBe(false);
      });
    } finally {
      discardDb(db);
    }
  });

  it('rejects static publication until frame assets are verified', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      await withFlag('1', async () => {
        await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie }, payload: { ...staticDraft(), venueId: 'demo' } });
        const pub = await app.inject({ method: 'POST', url: '/api/admin/venues/demo/publish-v3', headers: { cookie } });
        expect(pub.statusCode).toBe(400);
        expect((pub.json() as { error: string }).error).toMatch(/asset/i);
      });
    } finally {
      discardDb(db);
    }
  });

  it('serves the original V4 JSON bytes for V4 publications', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const draft = {
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
      await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie }, payload: draft });
      await app.inject({ method: 'POST', url: '/api/admin/venues/demo/publish-v3', headers: { cookie } });
      const row = (db as DatabaseSync).prepare('SELECT manifest_json FROM versions WHERE venue_id = ? AND version = 1').get('demo') as {
        manifest_json: string;
      };
      const res = await app.inject({ method: 'GET', url: '/api/venues/demo/versions/1/manifest' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(row.manifest_json);
      expect(res.json()).toMatchObject({ schemaVersion: 4 });
    } finally {
      discardDb(db);
    }
  });
});

describe('v5 save-time graph/frame validation', () => {
  it('rejects a geographic node outside its frame bounds without persisting', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      await withFlag('1', async () => {
        const valid = { ...geographicDraft(), venueId: 'demo' };
        expect((await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie }, payload: valid })).statusCode).toBe(200);
        const before = loadDraftV3Json(db, 'demo');
        const bad = { ...geographicDraft(), venueId: 'demo' };
        const target = bad.nodes.find((n) => n.id === 'n-a0b')!;
        // Frame frame-b-a-z0 spans north 13.08; 13.09 parses but leaves the frame.
        (target.position as { kind: 'geographic'; lat: number; lng: number }).lat = 13.09;
        const put = await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie }, payload: bad });
        expect(put.statusCode).toBe(400);
        expect(put.body).toMatch(/outside its frame/);
        expect(loadDraftV3Json(db, 'demo')).toBe(before);
      });
    } finally {
      discardDb(db);
    }
  });

  it('rejects geographic cross-frame ordinary edges without persisting', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      await withFlag('1', async () => {
        const valid = { ...geographicDraft(), venueId: 'demo' };
        expect((await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie }, payload: valid })).statusCode).toBe(200);
        const before = loadDraftV3Json(db, 'demo');
        const bad = {
          ...geographicDraft(),
          venueId: 'demo',
          edges: [...geographicDraft().edges, { from: 'n-a0b', to: 'n-a1', kind: 'path', cost: 1, meters: 1 }],
        };
        const put = await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie }, payload: bad });
        expect(put.statusCode).toBe(400);
        expect(put.body).toMatch(/same frame/);
        expect(loadDraftV3Json(db, 'demo')).toBe(before);
      });
    } finally {
      discardDb(db);
    }
  });

  it('rejects invalid geographic transition geometry without persisting', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      await withFlag('1', async () => {
        const valid = { ...geographicDraft(), venueId: 'demo' };
        expect((await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie }, payload: valid })).statusCode).toBe(200);
        const before = loadDraftV3Json(db, 'demo');
        const bad = {
          ...geographicDraft(),
          venueId: 'demo',
          edges: [...geographicDraft().edges, { from: 'n-a0', to: 'n-a0g', kind: 'stairs', cost: 4 }],
          transitions: [
            ...geographicDraft().transitions,
            { id: 'tr-stairs-same-floor', name: 'stairs n-a0 ↔ n-a0g', kind: 'stair', nodeIds: ['n-a0', 'n-a0g'] },
          ],
        };
        const put = await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie }, payload: bad });
        expect(put.statusCode).toBe(400);
        expect(put.body).toMatch(/different floors/);
        expect(loadDraftV3Json(db, 'demo')).toBe(before);
      });
    } finally {
      discardDb(db);
    }
  });

  it('rejects a static node outside its frame bounds without persisting', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      await withFlag('1', async () => {
        const valid = { ...staticDraft(), venueId: 'demo' };
        expect((await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie }, payload: valid })).statusCode).toBe(200);
        const before = loadDraftV3Json(db, 'demo');
        const base = staticDraft();
        const bad = {
          ...base,
          venueId: 'demo',
          // Narrow one frame: s-a0 at (0.2, 0.3) still parses but leaves its frame.
          frames: base.frames.map((f) =>
            f.id === 'frame-b-a-z0' ? { ...f, bounds: { kind: 'local', left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 } } : f,
          ),
        };
        const put = await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie }, payload: bad });
        expect(put.statusCode).toBe(400);
        expect(put.body).toMatch(/outside its frame/);
        expect(loadDraftV3Json(db, 'demo')).toBe(before);
      });
    } finally {
      discardDb(db);
    }
  });

  it('rejects static cross-frame ordinary edges without persisting', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      await withFlag('1', async () => {
        const valid = { ...staticDraft(), venueId: 'demo' };
        expect((await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie }, payload: valid })).statusCode).toBe(200);
        const before = loadDraftV3Json(db, 'demo');
        const bad = {
          ...staticDraft(),
          venueId: 'demo',
          edges: [...staticDraft().edges, { from: 's-a0b', to: 's-a1b', kind: 'path', cost: 0.01 }],
        };
        const put = await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie }, payload: bad });
        expect(put.statusCode).toBe(400);
        expect(put.body).toMatch(/same frame/);
        expect(loadDraftV3Json(db, 'demo')).toBe(before);
      });
    } finally {
      discardDb(db);
    }
  });

  it('rejects invalid static transition geometry without persisting', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      await withFlag('1', async () => {
        const valid = { ...staticDraft(), venueId: 'demo' };
        expect((await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie }, payload: valid })).statusCode).toBe(200);
        const before = loadDraftV3Json(db, 'demo');
        const bad = {
          ...staticDraft(),
          venueId: 'demo',
          edges: [...staticDraft().edges, { from: 's-a0b', to: 's-a1', kind: 'entrance', cost: 1 }],
          transitions: [
            ...staticDraft().transitions,
            { id: 'tr-indoor-entrance', name: 'entrance s-a0b ↔ s-a1', kind: 'entrance', nodeIds: ['s-a0b', 's-a1'] },
          ],
        };
        const put = await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie }, payload: bad });
        expect(put.statusCode).toBe(400);
        expect(put.body).toMatch(/outdoors/);
        expect(loadDraftV3Json(db, 'demo')).toBe(before);
      });
    } finally {
      discardDb(db);
    }
  });
});
