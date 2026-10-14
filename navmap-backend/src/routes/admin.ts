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
    // regardless of content type. Non-browser callers should use bearer auth;
    // cookie writes require an Origin or (when Origin is absent) same-origin
    // Referer, validated against the request's actual scheme and Host.
    if (viaCookie && ['PUT', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.headers.origin;
      const host = req.headers.host;
      const candidate = origin ?? req.headers.referer;
      if (!host || !candidate || !isSameRequestOrigin(candidate, req.protocol, host, origin !== undefined)) {
        return reply.code(403).send({ error: 'cross-origin write rejected' });
      }
    }
  });

  registerVenueRoutes(app, db, { dataDir: opts.dataDir });
}

function isSameRequestOrigin(reference: string, protocol: string, host: string, originHeader: boolean): boolean {
  try {
    const url = new URL(reference);
    const requestOrigin = new URL(`${protocol}://${host}`).origin;
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username !== '' ||
      url.password !== '' ||
      url.origin !== requestOrigin
    ) return false;
    // Origin is serialized as a bare origin, unlike Referer which includes a path.
    return !originHeader || (url.pathname === '/' && url.search === '' && url.hash === '');
  } catch {
    return false;
  }
}
