import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { buildApp, type AppOptions } from '../src/app.js';

export function createDbForTest() {
  return openDb(':memory:');
}

export function testContext(options: Pick<AppOptions, 'layoutAssetHooks'> = {}) {
  const db = createDbForTest();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navmap-test-'));
  const app = buildApp(db, { adminPasswordHash: hashPassword('correct-password'), dataDir, ...options });
  return { db, app, dataDir };
}

export async function login(app: ReturnType<typeof buildApp>, password = 'correct-password') {
  const res = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password } });
  const cookieEntry = res.cookies.find((c) => c.name === 'navmap_session');
  const cookie = cookieEntry ? `${cookieEntry.name}=${cookieEntry.value}` : '';
  const token = (res.json() as { token?: string }).token ?? '';
  return { res, cookie, token };
}

export function discardDb(db: { close(): void }) {
  try { db.close(); } catch { /* already closed */ }
}
