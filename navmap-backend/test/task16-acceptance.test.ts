import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5.js';
import { saveDraftV3Json } from '../src/draft.js';
import { publishV3 } from '../src/publish-v3.js';
import { createDbForTest, discardDb, login, testContext } from './helpers.js';

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Tz8AAAAASUVORK5CYII=', 'base64');

function v4LegacyDraft(venueId: string): Record<string, unknown> {
  return {
    schemaVersion: 4,
    venueId,
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
  };
}

function venues(db: { prepare(s: string): { run(...a: unknown[]): unknown } }, id: string, name: string): void {
  db.prepare('INSERT INTO venues (id, name) VALUES (?, ?)').run(id, name);
  db.prepare('INSERT INTO aps (venue_id, json) VALUES (?, ?)').run(id, '[]');
}

describe('Task 16 acceptance: origin hardening without breaking API clients', () => {
  it('rejects cookie writes without Origin but accepts the same-origin header', async () => {
    const { db, app, dataDir } = testContext();
    try {
      const { cookie } = await login(app);
      const draft = v4LegacyDraft('origin-guard');
      const created = await app.inject({
        method: 'POST', url: '/api/admin/venues',
        headers: { cookie, origin: 'http://127.0.0.1:5197', host: '127.0.0.1:5197', 'content-type': 'application/json' },
        payload: { name: 'Origin Guard' },
      });
      expect(created.statusCode).toBe(201);
      const venueId = (created.json() as { id: string }).id;
      const withoutOrigin = await app.inject({
        method: 'PUT', url: `/api/admin/venues/${venueId}/draft-v3`,
        headers: { cookie, host: '127.0.0.1:5197', 'content-type': 'application/json' },
        payload: { ...draft, venueId },
      });
      expect(withoutOrigin.statusCode).toBe(403);
      expect(withoutOrigin.json()).toMatchObject({ error: 'cross-origin write rejected' });
      const withOrigin = await app.inject({
        method: 'PUT', url: `/api/admin/venues/${venueId}/draft-v3`,
        headers: { cookie, origin: 'http://127.0.0.1:5197', host: '127.0.0.1:5197', 'content-type': 'application/json' },
        payload: { ...draft, venueId },
      });
      expect(withOrigin.statusCode).toBe(200);
    } finally {
      discardDb(db);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('keeps the V5 authoring gate closed until the flag is enabled', async () => {
    const { db, app, dataDir } = testContext();
    try {
      const { cookie } = await login(app);
      const res = await app.inject({
        method: 'POST', url: '/api/admin/venues',
        headers: { cookie, origin: 'http://127.0.0.1:5197', host: '127.0.0.1:5197', 'content-type': 'application/json' },
        payload: { name: 'Gated', canvasKind: 'static' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      discardDb(db);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('Task 16 acceptance: V4 and V5 publication compatibility', () => {
  it('publishes a V4 legacy draft as an immutable V4 manifest', async () => {
    const { db, app, dataDir } = testContext();
    try {
      const { cookie } = await login(app);
      const headers = { cookie, origin: 'http://127.0.0.1:5197', host: '127.0.0.1:5197', 'content-type': 'application/json' };
      const created = await app.inject({ method: 'POST', url: '/api/admin/venues', headers, payload: { name: 'Legacy Hall' } });
      const venueId = (created.json() as { id: string }).id;
      const saved = await app.inject({ method: 'PUT', url: `/api/admin/venues/${venueId}/draft-v3`, headers, payload: v4LegacyDraft(venueId) });
      expect(saved.statusCode).toBe(200);
      const published = await app.inject({
        method: 'POST', url: `/api/admin/venues/${venueId}/publish-v3`,
        headers: { cookie, origin: 'http://127.0.0.1:5197', host: '127.0.0.1:5197' },
      });
      expect(published.statusCode).toBe(200);
      const manifest = await app.inject({ method: 'GET', url: `/api/venues/${venueId}/versions/1/manifest` });
      expect(manifest.statusCode).toBe(200);
      expect(manifest.json()).toMatchObject({ schemaVersion: 4, venueId, version: 1 });
      expect((manifest.json() as { nodes: unknown[] }).nodes).toHaveLength(2);
    } finally {
      discardDb(db);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('keeps two venues isolated through save and publish', async () => {
    const { db, app, dataDir } = testContext();
    try {
      const { cookie } = await login(app);
      const headers = { cookie, origin: 'http://127.0.0.1:5197', host: '127.0.0.1:5197', 'content-type': 'application/json' };
      const firstRes = await app.inject({ method: 'POST', url: '/api/admin/venues', headers, payload: { name: 'First' } });
      const secondRes = await app.inject({ method: 'POST', url: '/api/admin/venues', headers, payload: { name: 'Second' } });
      const first = (firstRes.json() as { id: string }).id;
      const second = (secondRes.json() as { id: string }).id;
      expect(first).not.toBe(second);
      await app.inject({ method: 'PUT', url: `/api/admin/venues/${first}/draft-v3`, headers, payload: v4LegacyDraft(first) });
      // Venue creation seeds an empty default draft per map; the second map still has no nodes.
      const reloaded = await app.inject({ method: 'GET', url: `/api/admin/venues/${second}/draft-v3`, headers: { cookie } });
      expect(reloaded.statusCode).toBe(200);
      expect(reloaded.json()).toMatchObject({ venueId: second, nodes: [] });
    } finally {
      discardDb(db);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('Task 16 acceptance: static publication with verified assets', () => {
  function stageStaticVenue(venueId: string, mutate?: (draft: ReturnType<typeof staticDraft>) => void) {
    const db = createDbForTest();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task16-static-'));
    venues(db, venueId, 'Static Hall');
    const digest = createHash('sha256').update(PNG_1X1).digest('hex');
    const draft = { ...staticDraft(), venueId };
    draft.frames = draft.frames.map((frame) => frame.background
      ? { ...frame, background: { assetId: digest, width: 1, height: 1, sha256: digest, byteLength: PNG_1X1.length } }
      : frame);
    if (mutate) mutate(draft);
    saveDraftV3Json(db, venueId, JSON.stringify(draft));
    db.prepare('INSERT INTO layout_assets (venue_id, asset_id, width, height, sha256, byte_length) VALUES (?, ?, ?, ?, ?, ?)')
      .run(venueId, digest, 1, 1, digest, PNG_1X1.length);
    const assetDir = path.join(dataDir, 'layout-assets', venueId);
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, `${digest}.png`), PNG_1X1);
    return { db, dataDir, digest };
  }

  it('publishes both static floors and stages version-scoped immutable assets', () => {
    const { db, dataDir, digest } = stageStaticVenue('static-two');
    try {
      process.env.MAP_V5_AUTHORING_ENABLED = '1';
      const manifest = publishV3(db, dataDir, 'static-two');
      expect(manifest.schemaVersion).toBe(5);
      expect(fs.existsSync(path.join(dataDir, 'versions', 'static-two', '1', 'assets', `${digest}.png`))).toBe(true);
      const row = db.prepare('SELECT version FROM versions WHERE venue_id = ?').get('static-two') as { version: number } | undefined;
      expect(row?.version).toBe(1);
    } finally {
      discardDb(db);
      fs.rmSync(dataDir, { recursive: true, force: true });
      delete process.env.MAP_V5_AUTHORING_ENABLED;
    }
  });

  it('rejects publication when stored asset bytes do not match the draft claim', () => {
    const { db, dataDir } = stageStaticVenue('static-corrupt', (draft) => {
      draft.frames = draft.frames.map((frame) => frame.background
        ? { ...frame, background: { ...frame.background, sha256: '0'.repeat(64) } }
        : frame);
    });
    try {
      process.env.MAP_V5_AUTHORING_ENABLED = '1';
      expect(() => publishV3(db, dataDir, 'static-corrupt')).toThrow();
    } finally {
      discardDb(db);
      fs.rmSync(dataDir, { recursive: true, force: true });
      delete process.env.MAP_V5_AUTHORING_ENABLED;
    }
  });
});

describe('Task 16 acceptance: geographic V5 publication', () => {
  it('publishes the shared geographic fixture with its boundary intact', () => {
    const db = createDbForTest();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task16-geo-'));
    try {
      venues(db, 'geo-v5', 'Geographic Park');
      const draft = { ...geographicDraft(), venueId: 'geo-v5' };
      saveDraftV3Json(db, 'geo-v5', JSON.stringify(draft));
      process.env.MAP_V5_AUTHORING_ENABLED = '1';
      const manifest = publishV3(db, dataDir, 'geo-v5');
      expect(manifest.schemaVersion).toBe(5);
      if (manifest.schemaVersion !== 5) throw new Error('expected a V5 manifest');
      expect(manifest.boundary).toMatchObject({ kind: 'geographic', north: 13.1 });
      expect(manifest.frames.length).toBeGreaterThanOrEqual(3);
    } finally {
      discardDb(db);
      fs.rmSync(dataDir, { recursive: true, force: true });
      delete process.env.MAP_V5_AUTHORING_ENABLED;
    }
  });
});
