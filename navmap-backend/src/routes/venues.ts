import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { loadDraftV3Json, parseDraftV3, updateDraftV3 } from '../draft.js';
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
      return parseDraftV3(JSON.parse(raw));
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
