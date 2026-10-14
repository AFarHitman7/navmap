import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { getLatestVersion } from '../db.js';
import { draftSchemaVersion, parseManifestV3 } from '../draft.js';
import { parseMapManifest } from '../map-contract.js';
import { isV5AuthoringEnabled } from '../env.js';
import { normalizeVenueId } from '../venue-id.js';

/**
 * Load the stored manifest JSON after validating its schema. V4 documents
 * validate against the legacy schema; V5 against the frame-aware contract.
 * Callers send the ORIGINAL stored bytes (never a re-serialized in-memory
 * upgrade), so immutable V4 responses stay byte-identical V4 JSON.
 */
function loadManifestJson(db: DatabaseSync, venueId: string, version: number): string {
  normalizeVenueId(venueId);
  const row = db.prepare('SELECT manifest_json FROM versions WHERE venue_id = ? AND version = ?').get(venueId, version) as
    | { manifest_json: string }
    | undefined;
  if (!row) throw Object.assign(new Error('unknown version'), { statusCode: 404 });
  let json: unknown;
  try {
    json = JSON.parse(row.manifest_json);
  } catch {
    throw Object.assign(new Error('unsupported manifest schema; only V3 is served'), { statusCode: 415 });
  }
  try {
    if (draftSchemaVersion(json) === 5) parseMapManifest(json);
    else parseManifestV3(json);
  } catch {
    throw Object.assign(new Error('unsupported manifest schema; only V3 is served'), { statusCode: 415 });
  }
  return row.manifest_json;
}

export function registerPublicRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/capabilities', async () => ({ mapV5AuthoringEnabled: isV5AuthoringEnabled() }));

  app.get('/api/venues/:venueId/latest', async (req, reply) => {
    const { venueId } = req.params as { venueId: string };
    try { normalizeVenueId(venueId); }
    catch { return reply.code(404).send({ error: 'unknown venue' }); }
    const version = getLatestVersion(db, venueId);
    if (version <= 0) return reply.code(404).send({ error: 'no published version' });
    reply.header('cache-control', 'no-store');
    return { venueId, version };
  });

  app.get('/api/venues/:venueId/versions/:version/manifest', async (req, reply) => {
    const { venueId, version: rawVersion } = req.params as { venueId: string; version: string };
    const version = Number(rawVersion);
    if (!Number.isInteger(version) || version <= 0) return reply.code(404).send({ error: 'unknown version' });
    try {
      const body = loadManifestJson(db, venueId, version);
      reply.header('cache-control', 'public, max-age=31536000, immutable');
      reply.header('etag', `"${createHash('sha256').update(body).digest('hex')}"`);
      reply.header('content-type', 'application/json');
      return reply.send(body);
    } catch (err) {
      return reply.code((err as { statusCode?: number }).statusCode ?? 404).send({ error: (err as Error).message });
    }
  });
}
