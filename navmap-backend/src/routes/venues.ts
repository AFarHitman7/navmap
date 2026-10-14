import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { BSSID_RE, draftSchemaVersion, loadDraftV3Json, normalizeBssid, parseDraftV3, updateDraftV3 } from '../draft.js';
import { parseMapDraft } from '../map-contract.js';
import { isV5AuthoringEnabled } from '../env.js';
import { validateSaveV5 } from '../validate-v3.js';
import { saveDraftV3Json } from '../draft.js';
import { publishV3 } from '../publish-v3.js';
import { addNodeSamples, nodeSamplesBodySchema } from '../node-survey.js';
import { createVenue, ensureVenue, listVenues, renameVenue } from '../venues.js';
import { normalizeVenueId } from '../venue-id.js';
import { z } from 'zod';

const nameBody = z.object({ name: z.unknown() }).strict();

export function registerVenueRoutes(app: FastifyInstance, db: DatabaseSync, opts: { dataDir: string }): void {
  app.get('/api/admin/venues', async () => listVenues(db));
  app.post('/api/admin/venues', async (req, reply) => {
    const parsed = nameBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid venue name' });
    try { return reply.code(201).send(createVenue(db, parsed.data.name as string)); }
    catch (err) { return reply.code((err as { statusCode?: number }).statusCode ?? 400).send({ error: (err as Error).message }); }
  });
  app.patch('/api/admin/venues/:venueId', async (req, reply) => {
    const { venueId } = req.params as { venueId: string };
    const parsed = nameBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid venue name' });
    try { return renameVenue(db, venueId, parsed.data.name as string); }
    catch (err) { return reply.code((err as { statusCode?: number }).statusCode ?? 400).send({ error: (err as Error).message }); }
  });
  app.get('/api/admin/venues/:venueId/draft-v3', async (req, reply) => {
    const { venueId } = req.params as { venueId: string };
    try {
      normalizeVenueId(venueId);
      ensureVenue(db, venueId);
      const raw = loadDraftV3Json(db, venueId);
      if (!raw) return reply.code(404).send({ error: `no v3 draft for venue ${venueId}` });
      const json = JSON.parse(raw);
      // Mixed storage: V5 drafts validate against the frame-aware contract.
      return draftSchemaVersion(json) === 5 ? parseMapDraft(json) : parseDraftV3(json);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 404;
      return reply.code(status).send({ error: (err as Error).message });
    }
  });

  app.put('/api/admin/venues/:venueId/draft-v3', async (req, reply) => {
    const { venueId } = req.params as { venueId: string };
    try {
      normalizeVenueId(venueId);
      ensureVenue(db, venueId);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 404;
      return reply.code(status).send({ error: (err as Error).message });
    }
    // V5 saves dispatch before the legacy path (reader-first gate enforced).
    if (draftSchemaVersion(req.body) === 5) {
      if (!isV5AuthoringEnabled()) {
        return reply.code(403).send({ error: 'V5 map authoring is disabled on this server (MAP_V5_AUTHORING_ENABLED)' });
      }
      try {
        const parsed = parseMapDraft(req.body);
        if (parsed.venueId !== venueId) {
          return reply.code(400).send({ error: 'venue mismatch' });
        }
        return updateDraftV5(db, parsed);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode ?? 400;
        const issues = (err as { issues?: unknown }).issues;
        const errors = (err as { errors?: string[] }).errors;
        return reply.code(status).send({ error: (err as Error).message, ...(issues ? { issues } : {}), ...(errors ? { errors } : {}) });
      }
    }
    let draft;
    try {
      // Parse before writing: a venue mismatch must not touch any draft.
      const parsed = parseDraftV3(req.body);
      if (parsed.venueId !== venueId) {
        return reply.code(400).send({ error: 'venue mismatch' });
      }
      draft = updateDraftV3(db, parsed);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 400;
      const issues = (err as { issues?: unknown }).issues;
      return reply.code(status).send({ error: (err as Error).message, ...(issues ? { issues } : {}) });
    }
    return draft;
  });

  app.post('/api/admin/venues/:venueId/node-samples', async (req, reply) => {
    const { venueId } = req.params as { venueId: string };
    const parsed = nodeSamplesBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid node samples', issues: parsed.error.issues });
    }
    try {
      normalizeVenueId(venueId);
      ensureVenue(db, venueId);
      const count = addNodeSamples(db, venueId, parsed.data.nodeId, parsed.data.scans);
      return { count };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 400;
      return reply.code(status).send({ error: (err as Error).message });
    }
  });

  app.post('/api/admin/venues/:venueId/publish-v3', async (req, reply) => {
    const { venueId } = req.params as { venueId: string };
    try {
      return publishV3(db, opts.dataDir, venueId);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 400;
      const errors = (err as { errors?: string[] }).errors;
      return reply.code(status).send({ error: (err as Error).message, ...(errors ? { errors } : {}) });
    }
  });
}

/**
 * Explicit V5 save: strict frame-aware parse plus save-time graph/frame
 * membership checks (static content needs assigned backgrounds). APK/SSID
 * allowlist normalization mirrors the legacy path.
 */
export function updateDraftV5(db: DatabaseSync, parsed: ReturnType<typeof parseMapDraft>): ReturnType<typeof parseMapDraft> {
  const saveErrors = validateSaveV5(parsed);
  if (saveErrors.length > 0) {
    throw Object.assign(new Error(saveErrors.join('; ')), { statusCode: 400, errors: saveErrors });
  }
  const aps = [...new Set(parsed.aps.map(normalizeBssid))];
  for (const bssid of aps) {
    if (!BSSID_RE.test(bssid)) throw Object.assign(new Error(`invalid BSSID: ${bssid}`), { statusCode: 400 });
  }
  const draft = { ...parsed, aps };
  saveDraftV3Json(db, draft.venueId, JSON.stringify(draft));
  db.prepare('INSERT INTO aps (venue_id, json) VALUES (?, ?) ON CONFLICT(venue_id) DO UPDATE SET json = excluded.json').run(draft.venueId, JSON.stringify(aps));
  return parseMapDraft(draft);
}
