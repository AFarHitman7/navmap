import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import type { DatabaseSync } from 'node:sqlite';
import { LAYOUT_ASSET_ID_RE, LAYOUT_SOURCE_MAX_BYTES, readLayoutAsset, storeLayoutPng } from '../layout-assets.js';
import { normalizeVenueId } from '../venue-id.js';
import { ensureVenue } from '../venues.js';

export type LayoutAssetProcessingStage = 'metadata' | 'canonicalize' | 'verify';

/** Optional lifecycle seam for deterministic transport tests; unset in production. */
export type LayoutAssetRouteHooks = {
  onRequestStarted?: (signal: AbortSignal) => void;
  onMultipartFileStarted?: () => void;
  onBodyConsumed?: () => void;
  onPipelineStarted?: (stage: LayoutAssetProcessingStage, signal: AbortSignal) => void | Promise<void>;
  onPipelineCancelled?: (stage: LayoutAssetProcessingStage) => void;
};

function sendMappedError(reply: { code(n: number): unknown; send(b: unknown): unknown }, err: unknown): unknown {
  const status = (err as { statusCode?: number }).statusCode;
  const code = typeof status === 'number' && Number.isInteger(status) ? status : 400;
  return (reply as { code(n: number): { send(b: unknown): unknown } }).code(code).send({ error: (err as Error).message });
}

export function registerLayoutAssetRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  opts: { dataDir: string; hooks?: LayoutAssetRouteHooks },
): void {
  app.post('/api/admin/venues/:venueId/layout-assets', async (req, reply) => {
    const { venueId } = req.params as { venueId: string };
    // Observe aborts from before multipart parsing through native processing.
    // IncomingMessage `close` is intentionally not used: it also fires on a
    // normal completed request body, before processing begins.
    const controller = new AbortController();
    const onRequestAborted = (): void => controller.abort();
    const onResponseClose = (): void => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    const onSocketClose = (): void => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    req.raw.on('aborted', onRequestAborted);
    reply.raw.on('close', onResponseClose);
    req.raw.socket.on('close', onSocketClose);
    opts.hooks?.onRequestStarted?.(controller.signal);
    try {
      try {
        normalizeVenueId(venueId);
        ensureVenue(db, venueId);
      } catch (err) {
        return sendMappedError(reply, err);
      }
      if (typeof (req as { isMultipart?: () => boolean }).isMultipart === 'function') {
        if (!(req as { isMultipart: () => boolean }).isMultipart()) {
          return reply.code(400).send({ error: 'layout upload must be multipart with one PNG file' });
        }
      }
      // NOTE: each file stream must be consumed inside the iteration —
      // busboy holds the parse until the current part is fully read, so
      // deferring toBuffer() until after the loop deadlocks iteration.
      let bytes: Buffer | undefined;
      for await (const part of req.parts()) {
        if (!(part as Partial<MultipartFile>).file) {
          return reply.code(400).send({ error: 'layout upload accepts a single PNG file' });
        }
        if (bytes) return reply.code(400).send({ error: 'layout upload accepts a single PNG file' });
        const file = part as MultipartFile;
        const mime = String(file.mimetype ?? '').split(';')[0]!.trim().toLowerCase();
        if (mime !== 'image/png') {
          return reply.code(400).send({ error: 'layout upload must declare image/png' });
        }
        opts.hooks?.onMultipartFileStarted?.();
        bytes = await file.toBuffer();
      }
      opts.hooks?.onBodyConsumed?.();
      if (!bytes) return reply.code(400).send({ error: 'a PNG file is required' });
      if (bytes.length > LAYOUT_SOURCE_MAX_BYTES) {
        return reply.code(413).send({ error: 'layout image exceeds the 20 MiB source limit' });
      }
      const asset = await storeLayoutPng(db, opts.dataDir, venueId, bytes, {
        signal: controller.signal,
        onPipelineStarted: (stage) => opts.hooks?.onPipelineStarted?.(stage, controller.signal),
        onPipelineCancelled: opts.hooks?.onPipelineCancelled,
      });
      return asset;
    } catch (err) {
      if (controller.signal.aborted) return;
      return sendMappedError(reply, err);
    } finally {
      req.raw.off('aborted', onRequestAborted);
      reply.raw.off('close', onResponseClose);
      req.raw.socket.off('close', onSocketClose);
    }
  });

  app.get('/api/admin/venues/:venueId/layout-assets/:assetId', async (req, reply) => {
    const { venueId, assetId } = req.params as { venueId: string; assetId: string };
    try {
      if (!LAYOUT_ASSET_ID_RE.test(assetId)) {
        return reply.code(404).send({ error: 'unknown layout asset' });
      }
      const { bytes } = readLayoutAsset(db, opts.dataDir, venueId, assetId);
      reply.header('content-type', 'image/png');
      reply.header('x-content-type-options', 'nosniff');
      reply.header('cache-control', 'private, no-store');
      return reply.send(bytes);
    } catch (err) {
      return sendMappedError(reply, err);
    }
  });
}
