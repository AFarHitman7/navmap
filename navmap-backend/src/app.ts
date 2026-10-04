import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { cleanupOrphanVersions } from './db.js';
import { registerAdminRoutes } from './routes/admin.js';
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
  registerAdminRoutes(app, db, {
    adminPasswordHash: options.adminPasswordHash,
    dataDir: options.dataDir,
  });
  registerPublicRoutes(app, db);

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
