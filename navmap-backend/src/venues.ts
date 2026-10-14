import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { blankDraftV3Json, blankDraftV5Json, DEMO_VENUE_ID, getLatestVersion } from './db.js';
import { normalizeVenueId, normalizeVenueName, VENUE_ID_RE, VENUE_NAME_MAX } from './venue-id.js';

export { normalizeVenueId, normalizeVenueName, VENUE_ID_RE, VENUE_NAME_MAX };

export type VenueSummary = { id: string; name: string; latestVersion: number };

function ensureVenueExists(db: DatabaseSync, venueId: string): { id: string; name: string } {
  const row = db.prepare('SELECT id, name FROM venues WHERE id = ?').get(venueId) as
    | { id: string; name: string }
    | undefined;
  if (!row) throw Object.assign(new Error(`unknown venue: ${venueId}`), { statusCode: 404 });
  return row;
}

export function listVenues(db: DatabaseSync): VenueSummary[] {
  const rows = db.prepare('SELECT id, name FROM venues ORDER BY name ASC, id ASC').all() as Array<{
    id: string;
    name: string;
  }>;
  return rows.map((r) => ({ id: r.id, name: r.name, latestVersion: getLatestVersion(db, r.id) }));
}

export function createVenue(db: DatabaseSync, name: string, draftKind: 'v4' | 'geographic' | 'static' = 'v4'): VenueSummary {
  const clean = normalizeVenueName(name);
  const id = randomUUID().toLowerCase();
  normalizeVenueId(id);
  // Legacy default stays V4; V5 blanks are explicit per canvas kind.
  const blank = draftKind === 'v4' ? blankDraftV3Json(id) : blankDraftV5Json(id, draftKind);
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO venues (id, name) VALUES (?, ?)').run(id, clean);
    db.prepare('INSERT INTO drafts_v3 (venue_id, json) VALUES (?, ?)').run(id, blank);
    db.prepare('INSERT OR IGNORE INTO aps (venue_id, json) VALUES (?, ?)').run(id, JSON.stringify([]));
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
  return { id, name: clean, latestVersion: 0 };
}

export function renameVenue(db: DatabaseSync, venueId: string, name: string): VenueSummary {
  normalizeVenueId(venueId);
  const clean = normalizeVenueName(name);
  ensureVenueExists(db, venueId);
  db.prepare('UPDATE venues SET name = ? WHERE id = ?').run(clean, venueId);
  return { id: venueId, name: clean, latestVersion: getLatestVersion(db, venueId) };
}

export function ensureVenue(db: DatabaseSync, venueId: string): void {
  normalizeVenueId(venueId);
  ensureVenueExists(db, venueId);
}
