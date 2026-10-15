import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { staticDraft } from '../src/fixtures/map-v5.js';
import { publishV3 } from '../src/publish-v3.js';
import { saveDraftV3Json } from '../src/draft.js';

// Dedicated disposable browser-test server. Never opens the organizer's database.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navmap-browser-'));
fs.mkdirSync(path.join(dataDir, 'uploads'));
const db = openDb(':memory:');
process.env.MAP_V5_AUTHORING_ENABLED = '1';
const publishedId = 'browser-static';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Tz8AAAAASUVORK5CYII=', 'base64');
const digest = createHash('sha256').update(png).digest('hex');
db.prepare('INSERT INTO venues (id, name) VALUES (?, ?)').run(publishedId, 'Browser Static Hall');
db.prepare('INSERT INTO aps (venue_id, json) VALUES (?, ?)').run(publishedId, '[]');
const publishedDraft = staticDraft();
publishedDraft.venueId = publishedId;
publishedDraft.frames = publishedDraft.frames.map((frame) => frame.background
  ? { ...frame, background: { assetId: digest, width: 1, height: 1, sha256: digest, byteLength: png.length } }
  : frame);
saveDraftV3Json(db, publishedId, JSON.stringify(publishedDraft));
db.prepare('INSERT INTO layout_assets (venue_id, asset_id, width, height, sha256, byte_length) VALUES (?, ?, ?, ?, ?, ?)')
  .run(publishedId, digest, 1, 1, digest, png.length);
const assetDir = path.join(dataDir, 'layout-assets', publishedId);
fs.mkdirSync(assetDir, { recursive: true });
fs.writeFileSync(path.join(assetDir, `${digest}.png`), png);
publishV3(db, dataDir, publishedId);
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
