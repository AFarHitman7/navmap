import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { cleanupOrphanVersions } from './db.js';
import { LAYOUT_SOURCE_MAX_BYTES } from './layout-assets.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerLayoutAssetRoutes } from './routes/layout-assets.js';
import { registerPublicRoutes } from './routes/public.js';

export type AppOptions = {
  adminPasswordHash: string;
  dataDir: string;
  webDistDir?: string;
  https?: { cert: Buffer; key: Buffer };
};

export function buildApp(db: DatabaseSync, options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false, ...(options.https ? { https: options.https } : {}) });
  cleanupOrphanVersions(db, options.dataDir);

  void app.register(cookie);
  // Skip-override plugin: multipart parsing is available to every root route.
  // Registration and decoded-image limits are separate protections: the
  // plugin caps transport (one file, 20 MiB, no fields) while layout-assets
  // enforces decoded dimensions and pixel counts after parsing.
  void app.register(multipart, { limits: { files: 1, fileSize: LAYOUT_SOURCE_MAX_BYTES, fields: 0 } });
  registerAdminRoutes(app, db, {
    adminPasswordHash: options.adminPasswordHash,
    dataDir: options.dataDir,
  });
  registerLayoutAssetRoutes(app, db, { dataDir: options.dataDir });
  registerPublicRoutes(app, db, { dataDir: options.dataDir });

  const dist = options.webDistDir;
  if (dist && fs.existsSync(dist)) {
    void app.register(fastifyStatic, { root: dist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
