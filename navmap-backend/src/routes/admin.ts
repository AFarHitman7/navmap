import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { checkSession, extractToken, issueSession, SESSION_COOKIE, verifyPassword } from '../auth.js';
import { registerVenueRoutes } from './venues.js';

export function registerAdminRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  opts: { adminPasswordHash: string; dataDir: string },
): void {
  app.post('/api/admin/login', async (req, reply) => {
    const body = (req.body ?? {}) as { password?: string };
    if (typeof body.password !== 'string' || !verifyPassword(body.password, opts.adminPasswordHash)) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    const token = issueSession(db);
    (reply as unknown as { setCookie(name: string, value: string, opts: object): void }).setCookie(
      SESSION_COOKIE,
      token,
      { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 24 * 60 * 60 },
    );
    return { token };
  });

  app.addHook('preHandler', async (req, reply) => {
    const url = req.url.split('?')[0]!;
    if (!url.startsWith('/api/admin/') || url === '/api/admin/login') return;
    const { token, viaCookie } = extractToken(req.headers.cookie, req.headers.authorization);
    if (!checkSession(db, token)) return reply.code(401).send({ error: 'login required' });
    // Foreign-origin protection covers every cookie-authenticated write,
    // regardless of content type (JSON, multipart, or otherwise): a browser
    // holding the session cookie must present a same-origin Origin header.
    if (viaCookie && ['PUT', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.headers.origin;
      const host = req.headers.host;
      const forwarded = req.headers['x-forwarded-host'];
      const forwardedHost = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0])?.trim();
      if (origin && host) {
        try {
          const originHost = new URL(origin).host;
          if (!new Set([host, forwardedHost].filter(Boolean)).has(originHost)) {
            return reply.code(403).send({ error: 'cross-origin write rejected' });
          }
        } catch {
          return reply.code(403).send({ error: 'invalid origin' });
        }
      }
    }
  });

  registerVenueRoutes(app, db, { dataDir: opts.dataDir });
}
