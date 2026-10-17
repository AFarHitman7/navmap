import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { staticDraft, geographicDraft } from '../src/fixtures/map-v5.js';
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
db.prepare('INSERT INTO layout_assets (venue_id, asset_id, width, height, sha256, byte_length) VALUES (?, ?, ?, ?, ?, ?)').run(publishedId, digest, 1, 1, digest, png.length);
const assetDir = path.join(dataDir, 'layout-assets', publishedId);
fs.mkdirSync(assetDir, { recursive: true });
fs.writeFileSync(path.join(assetDir, `${digest}.png`), png);
publishV3(db, dataDir, publishedId);

// --- Task 16 acceptance fixtures (disposable: temp dir + :memory: db) ---
// V4 legacy venue: readable by old parsers, published as an immutable V4 manifest.
const legacyId = 'legacy-v4';
db.prepare('INSERT INTO venues (id, name) VALUES (?, ?)').run(legacyId, 'Legacy V4 Hall');
db.prepare('INSERT INTO aps (venue_id, json) VALUES (?, ?)').run(legacyId, '[]');
saveDraftV3Json(db, legacyId, JSON.stringify({
  schemaVersion: 4,
  venueId: legacyId,
  boundary: { north: 13.1, south: 13.0, east: 80.3, west: 80.2 },
  indoorZones: [{
    id: 'b-legacy', name: 'Legacy Hall',
    bounds: { north: 13.08, south: 13.02, east: 80.28, west: 80.22 },
    floors: [{ z: 0, label: 'Ground' }],
  }],
  nodes: [
    { id: 'n-legacy-out', name: 'Legacy entrance', lat: 13.09, lng: 80.29, z: 0, zoneId: null, fingerprintRevision: 1 },
    { id: 'n-legacy-hall', name: 'Legacy hall', lat: 13.05, lng: 80.245, z: 0, zoneId: 'b-legacy', fingerprintRevision: 1 },
  ],
  edges: [{ from: 'n-legacy-out', to: 'n-legacy-hall', meters: 12, kind: 'entrance' }],
  places: [{ id: 'p-legacy', name: 'Legacy lobby', zoneId: 'b-legacy', nodeId: 'n-legacy-hall' }],
  anchors: [],
  aps: [],
}));
publishV3(db, dataDir, legacyId);

// V5 geographic venue: published from the shared geographic fixture.
const geoId = 'geo-v5';
db.prepare('INSERT INTO venues (id, name) VALUES (?, ?)').run(geoId, 'Geographic V5 Park');
db.prepare('INSERT INTO aps (venue_id, json) VALUES (?, ?)').run(geoId, '[]');
const geoDraft = geographicDraft();
geoDraft.venueId = geoId;
saveDraftV3Json(db, geoId, JSON.stringify(geoDraft));
publishV3(db, dataDir, geoId);

// Two-floor V5 static venue: published with verified 1x1 PNG stand-ins so
// visitor tests can load immutable floor assets without touching dev data.
const staticId = 'static-two-floor';
db.prepare('INSERT INTO venues (id, name) VALUES (?, ?)').run(staticId, 'Static Two-Floor Hall');
db.prepare('INSERT INTO aps (venue_id, json) VALUES (?, ?)').run(staticId, '[]');
const twoFloorDraft = staticDraft();
twoFloorDraft.venueId = staticId;
twoFloorDraft.frames = twoFloorDraft.frames.map((frame) => frame.background
  ? { ...frame, background: { assetId: digest, width: 1, height: 1, sha256: digest, byteLength: png.length } }
  : frame);
saveDraftV3Json(db, staticId, JSON.stringify(twoFloorDraft));
db.prepare('INSERT INTO layout_assets (venue_id, asset_id, width, height, sha256, byte_length) VALUES (?, ?, ?, ?, ?, ?)').run(staticId, digest, 1, 1, digest, png.length);
const staticAssetDir = path.join(dataDir, 'layout-assets', staticId);
fs.mkdirSync(staticAssetDir, { recursive: true });
fs.writeFileSync(path.join(staticAssetDir, `${digest}.png`), png);
publishV3(db, dataDir, staticId);
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
