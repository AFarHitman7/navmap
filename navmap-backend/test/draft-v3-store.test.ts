import { describe, expect, it } from 'vitest';
import { createDbForTest, discardDb, login, testContext } from './helpers.js';
import {
  getRevisionHighWater,
  loadDraftV3Json,
  parseDraftV3,
  updateDraftV3,
} from '../src/draft.js';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5.js';

function withFlag<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.MAP_V5_AUTHORING_ENABLED;
  if (value === undefined) delete process.env.MAP_V5_AUTHORING_ENABLED;
  else process.env.MAP_V5_AUTHORING_ENABLED = value;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.MAP_V5_AUTHORING_ENABLED;
    else process.env.MAP_V5_AUTHORING_ENABLED = prev;
  });
}

const V4_NODE = { id: 'n1', name: 'Lobby', lat: 13.05, lng: 80.25, z: 0, zoneId: null, fingerprintRevision: 1 };
const V4_DRAFT = {
  schemaVersion: 4,
  venueId: 'demo',
  boundary: null,
  indoorZones: [],
  nodes: [V4_NODE],
  edges: [],
  places: [],
  anchors: [],
  aps: [],
} as const;

function moved(revision: number) {
  return {
    ...V4_DRAFT,
    nodes: [{ ...V4_NODE, lat: 13.051, lng: 80.251, fingerprintRevision: revision }],
  };
}

describe('drafts_v3 store', () => {
  it('seeds a blank V4 draft in the drafts_v3 store', () => {
    const db = createDbForTest();
    try {
      const raw = loadDraftV3Json(db, 'demo')!;
      const d = parseDraftV3(JSON.parse(raw));
      expect(d.schemaVersion).toBe(4);
      expect(d.boundary).toBeNull();
    } finally {
      discardDb(db);
    }
  });

  it('records per-node revision high-water marks on save', () => {
    const db = createDbForTest();
    try {
      updateDraftV3(db, V4_DRAFT);
      expect(getRevisionHighWater(db, 'demo').get('n1')).toBe(1);
      updateDraftV3(db, moved(2));
      expect(getRevisionHighWater(db, 'demo').get('n1')).toBe(2);
    } finally {
      discardDb(db);
    }
  });

  it('rejects geometry moves that reuse revisions without persisting', () => {
    const db = createDbForTest();
    try {
      updateDraftV3(db, V4_DRAFT);
      const before = loadDraftV3Json(db, 'demo');
      let failure: unknown;
      try {
        updateDraftV3(db, moved(1));
      } catch (err) {
        failure = err;
      }
      expect(failure).toMatchObject({ statusCode: 409, code: 'revision_conflict', nodeIds: ['n1'] });
      expect((failure as { currentRevisions: Record<string, number> }).currentRevisions).toMatchObject({ n1: 1 });
      expect(loadDraftV3Json(db, 'demo')).toBe(before);
      expect(getRevisionHighWater(db, 'demo').get('n1')).toBe(1);
    } finally {
      discardDb(db);
    }
  });

  it('accepts renames at the same revision and moves with bumped revisions', () => {
    const db = createDbForTest();
    try {
      updateDraftV3(db, V4_DRAFT);
      const renamed = { ...V4_DRAFT, nodes: [{ ...V4_NODE, name: 'Main lobby' }] };
      expect(updateDraftV3(db, renamed).nodes[0]!.name).toBe('Main lobby');
      expect(updateDraftV3(db, moved(2)).nodes[0]!.lat).toBe(13.051);
    } finally {
      discardDb(db);
    }
  });

  it('enforces high-water marks across deletion and restore', () => {
    const db = createDbForTest();
    try {
      updateDraftV3(db, V4_DRAFT);
      updateDraftV3(db, { ...V4_DRAFT, nodes: [] });
      // The high-water row survives deletion of the node itself.
      expect(getRevisionHighWater(db, 'demo').get('n1')).toBe(1);
      expect(() => updateDraftV3(db, V4_DRAFT)).toThrowError(
        expect.objectContaining({ statusCode: 409, code: 'revision_conflict' }),
      );
      const restored = { ...V4_DRAFT, nodes: [{ ...V4_NODE, fingerprintRevision: 2 }] };
      expect(updateDraftV3(db, restored).nodes[0]!.fingerprintRevision).toBe(2);
    } finally {
      discardDb(db);
    }
  });

  it('returns a structured 409 conflict over HTTP and keeps the stored draft', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const first = await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie, origin: 'http://localhost' }, payload: V4_DRAFT });
      expect(first.statusCode).toBe(200);
      const conflict = await app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie, origin: 'http://localhost' }, payload: moved(1) });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toMatchObject({ code: 'revision_conflict', nodeIds: ['n1'], currentRevisions: { n1: 1 } });
      expect(typeof (conflict.json() as { error: unknown }).error).toBe('string');
      const get = await app.inject({ method: 'GET', url: '/api/admin/venues/demo/draft-v3', headers: { cookie, origin: 'http://localhost' } });
      expect(get.json().nodes[0]).toMatchObject({ lat: 13.05, fingerprintRevision: 1 });
    } finally {
      discardDb(db);
    }
  });
});

describe('V5 frame revision conflicts', () => {
  const FRAME = 'frame-b-a-z0';
  const frameNodeIds = () => staticDraft().nodes.filter((n) => n.frameId === FRAME).map((n) => n.id);

  it('rejects background replacement without bumped frame revisions', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      await withFlag('1', async () => {
        const put = (payload: Record<string, unknown>) =>
          app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie, origin: 'http://localhost' }, payload });
        expect((await put({ ...staticDraft(), venueId: 'demo' })).statusCode).toBe(200);
        const before = loadDraftV3Json(db, 'demo');
        const base = staticDraft();
        const swapped = {
          ...base,
          venueId: 'demo',
          frames: base.frames.map((f) =>
            f.id === FRAME ? { ...f, background: { ...f.background!, assetId: 'bg-b-a-z0-v2' } } : f,
          ),
        };
        const conflict = await put(swapped);
        expect(conflict.statusCode).toBe(409);
        expect(conflict.json()).toMatchObject({ code: 'revision_conflict' });
        for (const id of frameNodeIds()) {
          expect((conflict.json() as { nodeIds: string[] }).nodeIds).toContain(id);
        }
        expect(loadDraftV3Json(db, 'demo')).toBe(before);
      });
    } finally {
      discardDb(db);
    }
  });

  it('rejects calibration changes without bumped frame revisions', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      await withFlag('1', async () => {
        const put = (payload: Record<string, unknown>) =>
          app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie, origin: 'http://localhost' }, payload });
        expect((await put({ ...staticDraft(), venueId: 'demo' })).statusCode).toBe(200);
        const base = staticDraft();
        const calibrated = {
          ...base,
          venueId: 'demo',
          frames: base.frames.map((f) => (f.id === FRAME ? { ...f, calibration: { metersPerPixel: 0.5 } } : f)),
        };
        const conflict = await put(calibrated);
        expect(conflict.statusCode).toBe(409);
        expect((conflict.json() as { nodeIds: string[] }).nodeIds).toEqual(expect.arrayContaining(frameNodeIds()));
      });
    } finally {
      discardDb(db);
    }
  });

  it('accepts bumped background replacements and rename-only saves', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      await withFlag('1', async () => {
        const put = (payload: Record<string, unknown>) =>
          app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie, origin: 'http://localhost' }, payload });
        expect((await put({ ...staticDraft(), venueId: 'demo' })).statusCode).toBe(200);
        const base = staticDraft();
        const renamed = {
          ...base,
          venueId: 'demo',
          nodes: base.nodes.map((n) => (n.id === 's-a0' ? { ...n, name: 'Gate' } : n)),
        };
        expect((await put(renamed)).statusCode).toBe(200);
        const swapped = {
          ...base,
          venueId: 'demo',
          frames: base.frames.map((f) =>
            f.id === FRAME ? { ...f, background: { ...f.background!, assetId: 'bg-b-a-z0-v2' } } : f,
          ),
          nodes: base.nodes.map((n) =>
            n.frameId === FRAME ? { ...n, fingerprintRevision: n.fingerprintRevision + 1 } : n,
          ),
        };
        expect((await put(swapped)).statusCode).toBe(200);
        expect(getRevisionHighWater(db, 'demo').get('s-a0')).toBe(2);
      });
    } finally {
      discardDb(db);
    }
  });

  it('rejects V5 geometry moves that reuse revisions', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      await withFlag('1', async () => {
        const put = (payload: Record<string, unknown>) =>
          app.inject({ method: 'PUT', url: '/api/admin/venues/demo/draft-v3', headers: { cookie, origin: 'http://localhost' }, payload });
        expect((await put({ ...geographicDraft(), venueId: 'demo' })).statusCode).toBe(200);
        const base = geographicDraft();
        const moved = {
          ...base,
          venueId: 'demo',
          nodes: base.nodes.map((n) =>
            n.id === 'n-a0b' ? { ...n, position: { kind: 'geographic', lat: 13.056, lng: 80.249 } } : n,
          ),
        };
        const conflict = await put(moved);
        expect(conflict.statusCode).toBe(409);
        expect(conflict.json()).toMatchObject({ code: 'revision_conflict', nodeIds: ['n-a0b'] });
        void db;
      });
    } finally {
      discardDb(db);
    }
  });
});
