import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { getLatestVersion } from '../db.js';
import { parseManifestV3 } from '../draft.js';
import { normalizeVenueId } from '../venue-id.js';

function loadManifest(db: DatabaseSync, venueId: string, version: number) {
  normalizeVenueId(venueId);
  const row = db.prepare('SELECT manifest_json FROM versions WHERE venue_id = ? AND version = ?').get(venueId, version) as
    | { manifest_json: string }
    | undefined;
  if (!row) throw Object.assign(new Error('unknown version'), { statusCode: 404 });
  try {
    return parseManifestV3(JSON.parse(row.manifest_json));
  } catch {
    throw Object.assign(new Error('unsupported manifest schema; only V3 is served'), { statusCode: 415 });
  }
}

export function registerPublicRoutes(app: FastifyInstance, db: DatabaseSync): void {
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
      const manifest = loadManifest(db, venueId, version);
      const body = JSON.stringify(manifest);
      reply.header('cache-control', 'public, max-age=31536000, immutable');
      reply.header('etag', `"${createHash('sha256').update(body).digest('hex')}"`);
      reply.header('content-type', 'application/json');
      return reply.send(body);
    } catch (err) {
      return reply.code((err as { statusCode?: number }).statusCode ?? 404).send({ error: (err as Error).message });
    }
  });
}
