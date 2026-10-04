import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

// Dedicated disposable browser-test server. Never opens the organizer's database.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navmap-browser-'));
fs.mkdirSync(path.join(dataDir, 'uploads'));
const db = openDb(':memory:');
const app = buildApp(db, { dataDir, adminPasswordHash: hashPassword('browser-test-only') });
app.get('/health', async () => ({ ok: true }));
await app.listen({ host: '127.0.0.1', port: 3197 });
async function stop() {
  await app.close();
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
