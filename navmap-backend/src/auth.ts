import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const SESSION_COOKIE = 'navmap_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const derived = scryptSync(password, salt, 64);
  const expBuf = Buffer.from(expected, 'hex');
  if (derived.length !== expBuf.length) return false;
  return timingSafeEqual(derived, expBuf);
}

export function issueSession(db: DatabaseSync, now = Date.now()): string {
  const token = randomBytes(32).toString('hex');
  const digest = createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').run(
    digest,
    now + SESSION_TTL_MS,
  );
  return token;
}

export function checkSession(db: DatabaseSync, token: string): boolean {
  if (!token) return false;
  const key = createHash('sha256').update(token).digest('hex');
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(key) as {
    expires_at: number;
  } | undefined;
  return Boolean(row && row.expires_at > Date.now());
}

export function extractToken(cookieHeader: string | undefined, authHeader: string | undefined): {
  token: string;
  viaCookie: boolean;
} {
  if (authHeader) {
    const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (m) return { token: m[1].trim(), viaCookie: false };
  }
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === SESSION_COOKIE) {
        return { token: decodeURIComponent(rest.join('=')), viaCookie: true };
      }
    }
  }
  return { token: '', viaCookie: false };
}
