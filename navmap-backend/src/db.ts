import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFile, resolveDataPaths } from './env.js';
import { parseMapDraft } from './map-contract.js';

export type Db = DatabaseSync;

export const DEMO_VENUE_ID = 'demo';

export function blankDraftV3Json(venueId: string = DEMO_VENUE_ID): string {
  return JSON.stringify({
    schemaVersion: 4,
    venueId,
    boundary: null,
    indoorZones: [],
    nodes: [],
    edges: [],
    places: [],
    anchors: [],
    aps: [],
  });
}

/** Blank V5 draft for explicit canvas-kind creation (strictly validated). */
export function blankDraftV5Json(venueId: string, kind: 'geographic' | 'static'): string {
  return JSON.stringify(
    parseMapDraft({
      schemaVersion: 5,
      venueId,
      canvas: { kind },
      boundary: kind === 'static' ? { kind: 'local', left: 0, top: 0, right: 1, bottom: 1 } : null,
      indoorZones: [],
      frames: [],
      nodes: [],
      edges: [],
      paths: [],
      transitions: [],
      places: [],
      anchors: [],
      aps: [],
    }),
  );
}

export function openDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode=WAL');
  }
  initializeSchema(db);
  return db;
}

export function initializeSchema(db: DatabaseSync): void {
  const existingTables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name),
  );
  if (existingTables.has('drafts') || existingTables.has('samples')) {
    throw new Error('legacy schema detected; run the explicit local data reset before starting the V3-only backend');
  }
  if (existingTables.has('drafts_v3')) {
    const drafts = db.prepare('SELECT json FROM drafts_v3').all() as Array<{ json: string }>;
    for (const row of drafts) {
      let schemaVersion: unknown;
      try {
        schemaVersion = (JSON.parse(row.json) as { schemaVersion?: unknown }).schemaVersion;
      } catch {
        schemaVersion = undefined;
      }
      if (schemaVersion !== 4 && schemaVersion !== 5) {
        throw new Error('legacy schema detected; run the explicit local data reset before starting the V4/V5 backend');
      }
    }
  }
  if (existingTables.has('versions')) {
    const rows = db.prepare('SELECT manifest_json FROM versions').all() as Array<{ manifest_json: string }>;
    for (const row of rows) {
      let schemaVersion: unknown;
      try {
        schemaVersion = (JSON.parse(row.manifest_json) as { schemaVersion?: unknown }).schemaVersion;
      } catch {
        schemaVersion = undefined;
      }
      if (schemaVersion !== 4 && schemaVersion !== 5) {
        throw new Error('legacy schema detected; run the explicit local data reset before starting the V4/V5 backend');
      }
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS versions (
      venue_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      manifest_json TEXT NOT NULL,
      PRIMARY KEY (venue_id, version)
    );
    CREATE TABLE IF NOT EXISTS venues (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drafts_v3 (
      venue_id TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS node_samples (
      venue_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      fingerprint_revision INTEGER NOT NULL,
      captured_at INTEGER NOT NULL,
      readings_json TEXT NOT NULL,
      PRIMARY KEY (venue_id, node_id, fingerprint_revision, captured_at)
    );
    CREATE TABLE IF NOT EXISTS node_revision_highwater (
      venue_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      PRIMARY KEY (venue_id, node_id)
    );
  `);
  const venueRow = db.prepare('SELECT id FROM venues WHERE id = ?').get(DEMO_VENUE_ID) as
    | { id: string }
    | undefined;
  if (!venueRow) {
    db.prepare('INSERT INTO venues (id, name) VALUES (?, ?)').run(DEMO_VENUE_ID, 'Demo map');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS aps (
      venue_id TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );
  `);
  db.prepare('INSERT OR IGNORE INTO aps (venue_id, json) VALUES (?, ?)').run(DEMO_VENUE_ID, '[]');
  db.prepare('INSERT OR IGNORE INTO drafts_v3 (venue_id, json) VALUES (?, ?)').run(DEMO_VENUE_ID, blankDraftV3Json());
}

export function getLatestVersion(db: DatabaseSync, venueId: string): number {
  const row = db
    .prepare('SELECT MAX(version) AS v FROM versions WHERE venue_id = ?')
    .get(venueId) as { v: number | null } | undefined;
  return row?.v ?? 0;
}

/** Remove orphan version dirs: *.tmp staging dirs, and version dirs with no DB row. */
export function cleanupOrphanVersions(db: DatabaseSync, dataDir: string): void {
  const venueIds = db.prepare('SELECT id FROM venues').all() as Array<{ id: string }>;
  const ids = venueIds.length ? venueIds.map((r) => r.id) : [DEMO_VENUE_ID];
  const baseRoot = path.join(dataDir, 'versions');
  for (const venueId of ids) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(venueId)) continue;
    const base = path.join(baseRoot, venueId);
    let entries: string[];
    try {
      entries = fs.readdirSync(base);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(base, entry);
      let stat;
      try {
        stat = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (entry.endsWith('.tmp')) {
        if (!/^\d+\.tmp$/.test(entry)) continue;
        fs.rmSync(full, { recursive: true, force: true });
        continue;
      }
      if (/^\d+$/.test(entry)) {
        const row = db
          .prepare('SELECT version FROM versions WHERE venue_id = ? AND version = ?')
          .get(venueId, Number(entry)) as { version: number } | undefined;
        if (!row) fs.rmSync(full, { recursive: true, force: true });
      }
    }
  }
}

// CLI: npm run db:init -> tsx src/db.ts --init
const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).endsWith(path.join('src', 'db.ts'));
if (isMain && process.argv.includes('--init')) {
  loadEnvFile();
  const { dataDir, dbPath } = resolveDataPaths();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  const db = openDb(dbPath);
  cleanupOrphanVersions(db, dataDir);
  db.close();
  console.log(`initialized ${dbPath}`);
}
