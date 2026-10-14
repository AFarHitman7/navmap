import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { staticDraft } from '../src/fixtures/map-v5.js';
import { validatePublicationAssets } from '../src/publish-v3.js';
import type { LayoutAsset } from '../src/layout-assets.js';
import { publishV3 } from '../src/publish-v3.js';
import { saveDraftV3Json } from '../src/draft.js';
import { cleanupOrphanVersions } from '../src/db.js';
import { createDbForTest, discardDb } from './helpers.js';

const assetBytes = Buffer.from('immutable png payload');
const asset: LayoutAsset = {
  assetId: createHash('sha256').update(assetBytes).digest('hex'),
  width: 1000,
  height: 1000,
  sha256: createHash('sha256').update(assetBytes).digest('hex'),
  byteLength: assetBytes.length,
};
const changedBytes = Buffer.from('replacement png payload');
const replacement: LayoutAsset = {
  assetId: createHash('sha256').update(changedBytes).digest('hex'),
  width: 1000,
  height: 1000,
  sha256: createHash('sha256').update(changedBytes).digest('hex'),
  byteLength: changedBytes.length,
};

function draftWithAssets() {
  const draft = { ...staticDraft(), venueId: 'demo' };
  draft.frames = draft.frames.map((frame) => frame.background
    ? { ...frame, background: { ...asset } }
    : frame);
  return draft;
}

describe('validatePublicationAssets', () => {
  it('requires matching stored layout metadata and reports missing/foreign assets', () => {
    const draft = draftWithAssets();
    const first = draft.frames[0].background!;
    draft.frames[0] = { ...draft.frames[0], background: { ...first, sha256: '0'.repeat(64) } };
    expect(validatePublicationAssets(draft, id => id === asset.assetId ? asset : undefined))
      .toContain('Layout asset metadata does not match stored asset');
    expect(validatePublicationAssets(draft, () => undefined)).toContain('Layout asset is missing or not owned by this venue');
    const widthMismatch = draftWithAssets();
    widthMismatch.frames[0] = { ...widthMismatch.frames[0], background: { ...widthMismatch.frames[0].background!, width: 999 } };
    expect(validatePublicationAssets(widthMismatch, () => asset)).toContain('Layout asset metadata does not match stored asset');
  });

  it('requires a background on each frame containing navigable content', () => {
    const draft = draftWithAssets();
    draft.frames = draft.frames.map(frame => frame.id === 'frame-b-a-z0' ? { ...frame, background: undefined } : frame);
    expect(validatePublicationAssets(draft, () => asset)).toContain('Static frame with content requires a background');
  });
});

describe('atomic static publication', () => {
  it('publishes version-scoped immutable files and leaves old versions untouched when draft changes', () => {
    const db = createDbForTest();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-publish-'));
    try {
      saveDraftV3Json(db, 'demo', JSON.stringify(draftWithAssets()));
      db.prepare('INSERT INTO layout_assets (venue_id, asset_id, width, height, sha256, byte_length) VALUES (?, ?, ?, ?, ?, ?)')
        .run('demo', asset.assetId, asset.width, asset.height, asset.sha256, asset.byteLength);
      const source = path.join(dataDir, 'layout-assets', 'demo');
      fs.mkdirSync(source, { recursive: true });
      fs.writeFileSync(path.join(source, `${asset.assetId}.png`), assetBytes);
      const secondId = replacement.assetId;
      db.prepare('INSERT INTO layout_assets (venue_id, asset_id, width, height, sha256, byte_length) VALUES (?, ?, ?, ?, ?, ?)')
        .run('demo', secondId, replacement.width, replacement.height, replacement.sha256, replacement.byteLength);
      fs.writeFileSync(path.join(source, `${secondId}.png`), changedBytes);
      process.env.MAP_V5_AUTHORING_ENABLED = '1';
      const first = publishV3(db, dataDir, 'demo') as ReturnType<typeof staticDraft> & { version: number };
      expect(first.version).toBe(1);
      expect(fs.readFileSync(path.join(dataDir, 'versions', 'demo', '1', 'assets', `${asset.assetId}.png`))).toEqual(assetBytes);
      const originalManifest = db.prepare('SELECT manifest_json FROM versions WHERE venue_id = ? AND version = 1').get('demo') as { manifest_json: string };
      const changed = draftWithAssets();
      changed.frames = changed.frames.map((frame, i) => frame.background && i === 0
        ? { ...frame, background: { ...replacement } }
        : frame);
      saveDraftV3Json(db, 'demo', JSON.stringify(changed));
      const second = publishV3(db, dataDir, 'demo') as { version: number };
      expect(second.version).toBe(2);
      expect((db.prepare('SELECT manifest_json FROM versions WHERE venue_id = ? AND version = 1').get('demo') as { manifest_json: string }).manifest_json)
        .toBe(originalManifest.manifest_json);
      expect(fs.readFileSync(path.join(dataDir, 'versions', 'demo', '1', 'assets', `${asset.assetId}.png`))).toEqual(assetBytes);
    } finally {
      delete process.env.MAP_V5_AUTHORING_ENABLED;
      fs.rmSync(dataDir, { recursive: true, force: true });
      discardDb(db);
    }
  });

  it('rejects corrupt source bytes without creating a version or replacing latest', () => {
    const db = createDbForTest();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-corrupt-'));
    try {
      saveDraftV3Json(db, 'demo', JSON.stringify(draftWithAssets()));
      db.prepare('INSERT INTO layout_assets (venue_id, asset_id, width, height, sha256, byte_length) VALUES (?, ?, ?, ?, ?, ?)')
        .run('demo', asset.assetId, asset.width, asset.height, asset.sha256, asset.byteLength);
      const source = path.join(dataDir, 'layout-assets', 'demo');
      fs.mkdirSync(source, { recursive: true });
      fs.writeFileSync(path.join(source, `${asset.assetId}.png`), Buffer.from('corrupt'));
      process.env.MAP_V5_AUTHORING_ENABLED = '1';
      expect(() => publishV3(db, dataDir, 'demo')).toThrow(/integrity check/i);
      expect(db.prepare('SELECT MAX(version) AS v FROM versions WHERE venue_id = ?').get('demo')).toMatchObject({ v: null });
      expect(fs.existsSync(path.join(dataDir, 'versions', 'demo'))).toBe(false);
    } finally {
      delete process.env.MAP_V5_AUTHORING_ENABLED;
      fs.rmSync(dataDir, { recursive: true, force: true });
      discardDb(db);
    }
  });

  it('rolls back a failed DB insert and restart cleanup preserves referenced history', () => {
    const db = createDbForTest();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-recovery-'));
    try {
      saveDraftV3Json(db, 'demo', JSON.stringify(draftWithAssets()));
      db.prepare('INSERT INTO layout_assets (venue_id, asset_id, width, height, sha256, byte_length) VALUES (?, ?, ?, ?, ?, ?)')
        .run('demo', asset.assetId, asset.width, asset.height, asset.sha256, asset.byteLength);
      const source = path.join(dataDir, 'layout-assets', 'demo');
      fs.mkdirSync(source, { recursive: true });
      fs.writeFileSync(path.join(source, `${asset.assetId}.png`), assetBytes);
      process.env.MAP_V5_AUTHORING_ENABLED = '1';
      db.exec("CREATE TRIGGER reject_publish BEFORE INSERT ON versions BEGIN SELECT RAISE(ABORT, 'injected db failure'); END");
      expect(() => publishV3(db, dataDir, 'demo')).toThrow(/injected db failure/);
      expect(db.prepare('SELECT MAX(version) AS v FROM versions WHERE venue_id = ?').get('demo')).toMatchObject({ v: null });
      expect(fs.existsSync(path.join(dataDir, 'versions', 'demo', '1'))).toBe(false);
      db.exec('DROP TRIGGER reject_publish');

      // A crash can leave a renamed-but-uncommitted directory; startup cleanup
      // removes only that orphan and leaves every DB-referenced version intact.
      publishV3(db, dataDir, 'demo');
      const referenced = path.join(dataDir, 'versions', 'demo', '1');
      const orphan = path.join(dataDir, 'versions', 'demo', '2');
      const staging = path.join(dataDir, 'versions', 'demo', '3.tmp-deadbeef');
      fs.mkdirSync(orphan, { recursive: true });
      fs.mkdirSync(staging, { recursive: true });
      cleanupOrphanVersions(db, dataDir);
      expect(fs.existsSync(referenced)).toBe(true);
      expect(fs.existsSync(orphan)).toBe(false);
      expect(fs.existsSync(staging)).toBe(false);
    } finally {
      delete process.env.MAP_V5_AUTHORING_ENABLED;
      fs.rmSync(dataDir, { recursive: true, force: true });
      discardDb(db);
    }
  });

  it('does not delete a pre-existing orphan when this attempt collides with its version path', () => {
    const db = createDbForTest();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-orphan-collision-'));
    try {
      saveDraftV3Json(db, 'demo', JSON.stringify(draftWithAssets()));
      db.prepare('INSERT INTO layout_assets (venue_id, asset_id, width, height, sha256, byte_length) VALUES (?, ?, ?, ?, ?, ?)')
        .run('demo', asset.assetId, asset.width, asset.height, asset.sha256, asset.byteLength);
      const source = path.join(dataDir, 'layout-assets', 'demo');
      fs.mkdirSync(source, { recursive: true });
      fs.writeFileSync(path.join(source, `${asset.assetId}.png`), assetBytes);
      const orphan = path.join(dataDir, 'versions', 'demo', '1');
      fs.mkdirSync(orphan, { recursive: true });
      fs.writeFileSync(path.join(orphan, 'recovery-marker'), 'pre-existing');
      process.env.MAP_V5_AUTHORING_ENABLED = '1';
      expect(() => publishV3(db, dataDir, 'demo')).toThrow(/directory already exists/);
      expect(fs.readFileSync(path.join(orphan, 'recovery-marker'), 'utf8')).toBe('pre-existing');
      expect(db.prepare('SELECT MAX(version) AS v FROM versions WHERE venue_id = ?').get('demo')).toMatchObject({ v: null });
    } finally {
      delete process.env.MAP_V5_AUTHORING_ENABLED;
      fs.rmSync(dataDir, { recursive: true, force: true });
      discardDb(db);
    }
  });
});
