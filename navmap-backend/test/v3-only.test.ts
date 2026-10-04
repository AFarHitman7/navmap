import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initializeSchema } from '../src/db.js';
import { login, testContext, discardDb } from './helpers.js';

describe('V3-only API', () => {
  it('refuses to initialize over legacy draft tables instead of retaining legacy data', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE drafts (venue_id TEXT PRIMARY KEY, json TEXT NOT NULL)');
      expect(() => initializeSchema(db)).toThrow(/legacy schema detected/);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drafts_v3'").get()).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('refuses published versions with a non-V4 schema', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE versions (venue_id TEXT NOT NULL, version INTEGER NOT NULL, manifest_json TEXT NOT NULL)');
      db.prepare('INSERT INTO versions VALUES (?, ?, ?)').run('demo', 1, JSON.stringify({ schemaVersion: 2 }));
      expect(() => initializeSchema(db)).toThrow(/legacy schema detected/);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drafts_v3'").get()).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('serves a blank V4 draft and has no legacy draft routes', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const v3 = await app.inject({
        method: 'GET',
        url: '/api/admin/venues/demo/draft-v3',
        headers: { cookie },
      });
      expect(v3.statusCode).toBe(200);
      expect(v3.json()).toMatchObject({ schemaVersion: 4, venueId: 'demo', indoorZones: [], nodes: [] });

      const wrongSchema = await app.inject({
        method: 'PUT',
        url: '/api/admin/venues/demo/draft-v3',
        headers: { cookie },
        payload: { schemaVersion: 2, venueId: 'demo' },
      });
      expect(wrongSchema.statusCode).toBe(400);

      const legacy = await app.inject({
        method: 'GET',
        url: '/api/admin/draft',
        headers: { cookie },
      });
      expect(legacy.statusCode).toBe(404);
      const legacyPublish = await app.inject({ method: 'POST', url: '/api/admin/publish', headers: { cookie } });
      expect(legacyPublish.statusCode).toBe(404);

      const schemaRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
      const tables = schemaRows.map((row) => row.name);
      expect(tables).toContain('drafts_v3');
      expect(tables).not.toContain('drafts');
      expect(tables).not.toContain('samples');

      db.prepare('INSERT INTO versions (venue_id, version, manifest_json) VALUES (?, ?, ?)')
        .run('demo', 1, JSON.stringify({ schemaVersion: 2, venueId: 'demo', version: 1 }));
      const unsupported = await app.inject({ method: 'GET', url: '/api/venues/demo/versions/1/manifest' });
      expect(unsupported.statusCode).toBe(415);
    } finally {
      discardDb(db);
    }
  });
});
