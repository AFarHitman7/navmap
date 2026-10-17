import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getLatestVersion } from './db.js';
import {
  loadDraftV3Json,
  loadAps,
  manifestV3Schema,
  parseDraftV3,
  draftSchemaVersion,
  type ManifestV3,
} from './draft.js';
import {
  mapManifestSchema,
  parseMapDraft,
  type MapDraft,
  type MapManifest,
} from './map-contract.js';
import { normalizeVenueId } from './venue-id.js';
import { ensureVenue } from './venues.js';
import { isV5AuthoringEnabled } from './env.js';
import { validatePublishV3, validatePublishV5 } from './validate-v3.js';
import { buildNodeProfiles, loadNodeSamples } from './node-survey.js';
import { versionDir } from './version-dir.js';
import { layoutAssetPath, type LayoutAsset } from './layout-assets.js';

/**
 * Publish a coordinated draft: no images required. Node profiles are built from
 * current-revision samples; only viable profiles (scanCount >= 3 with at
 * least 2 APs) are published. Stale-revision samples never publish.
 */
export type PublishV3Hooks = {
  /** Test synchronization seam; not supplied by production callers. */
  afterStage?: (stagingDir: string) => void;
  afterRename?: (versionDir: string) => void;
};

export function publishV3(db: DatabaseSync, dataDir: string, venueId: string, hooks?: PublishV3Hooks): ManifestV3 | MapManifest {
  normalizeVenueId(venueId);
  ensureVenue(db, venueId);
  const raw = loadDraftV3Json(db, venueId);
  if (!raw) throw Object.assign(new Error(`no v3 draft for venue ${venueId}`), { statusCode: 404 });
  const json = JSON.parse(raw);
  if (draftSchemaVersion(json) === 5) return publishV5Draft(db, dataDir, venueId, json, hooks);
  return publishV4Draft(db, dataDir, venueId, json);
}

/** Validate immutable static frame claims against assets owned by this venue. */
export function validatePublicationAssets(
  draft: MapDraft,
  lookup: (assetId: string) => LayoutAsset | undefined,
): string[] {
  const errors: string[] = [];
  const framesWithContent = new Set(draft.nodes.map((node) => node.frameId));
  for (const frame of draft.frames) {
    const background = frame.background;
    if (!background) {
      if (draft.canvas.kind === 'static' && framesWithContent.has(frame.id)) {
        errors.push('Static frame with content requires a background');
      }
      continue;
    }
    const stored = lookup(background.assetId);
    if (!stored) {
      errors.push('Layout asset is missing or not owned by this venue');
      continue;
    }
    if (background.assetId !== stored.assetId || background.sha256 !== stored.sha256 ||
        background.width !== stored.width || background.height !== stored.height ||
        background.byteLength !== stored.byteLength) {
      errors.push('Layout asset metadata does not match stored asset');
    }
  }
  return errors;
}

function publishV4Draft(db: DatabaseSync, dataDir: string, venueId: string, json: unknown): ManifestV3 {
  const draft = parseDraftV3(json);
  const errors = validatePublishV3(draft);
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join('; ')), { statusCode: 400, errors });
  }
  const allowlist = loadAps(db, venueId);
  const profiles = draft.nodes.flatMap((node) =>
    buildNodeProfiles(loadNodeSamples(db, venueId, node.id, node.fingerprintRevision), allowlist).filter(
      (p) => p.scanCount >= 3 && Object.keys(p.medianRssi).length >= 2,
    ),
  );
  const version = getLatestVersion(db, venueId) + 1;
  const manifest: ManifestV3 = {
    schemaVersion: 4,
    venueId,
    version,
    boundary: draft.boundary!,
    indoorZones: draft.indoorZones,
    nodes: draft.nodes,
    edges: draft.edges,
    places: draft.places,
    anchors: draft.anchors,
    aps: allowlist,
    profiles,
    ...(draft.paths !== undefined ? { paths: draft.paths } : {}),
  };
  manifestV3Schema.parse(manifest);
  insertVersion(db, dataDir, venueId, version, manifest);
  return manifest;
}

/**
 * Explicit V5 publish (reader-first gate): requires MAP_V5_AUTHORING_ENABLED.
 * The manifest preserves canvas/frames/transitions/visitorVisible; static
 * canvases publish only after their venue-owned canonical assets have
 * been verified and copied into the immutable version directory.
 */
function publishV5Draft(db: DatabaseSync, dataDir: string, venueId: string, json: unknown, hooks?: PublishV3Hooks): MapManifest {
  if (!isV5AuthoringEnabled()) {
    throw Object.assign(new Error('V5 map authoring is disabled on this server (MAP_V5_AUTHORING_ENABLED)'), { statusCode: 403 });
  }
  const draft: MapDraft = parseMapDraft(json);
  const errors = validatePublishV5(draft);
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join('; ')), { statusCode: 400, errors });
  }
  // BEGIN IMMEDIATE serializes version allocation across SQLite connections
  // and processes. The filesystem stage and rename complete before row commit;
  // latest remains derived from DB rows, never from directories.
  db.exec('BEGIN IMMEDIATE');
  let version = 0;
  let stagingDir: string | undefined;
  let finalDir: string | undefined;
  let finalDirectoryCreated = false;
  const verified = new Map<string, Buffer>();
  try {
    // Read and validate ownership metadata under the same write lock as version
    // allocation, source verification, filesystem staging, and DB insertion.
    const assetRows = db.prepare(
      'SELECT asset_id, width, height, sha256, byte_length FROM layout_assets WHERE venue_id = ?',
    ).all(venueId) as Array<{ asset_id: string; width: number; height: number; sha256: string; byte_length: number }>;
    const assets = new Map(assetRows.map((row) => [row.asset_id, {
      assetId: row.asset_id, width: row.width, height: row.height, sha256: row.sha256, byteLength: row.byte_length,
    }]));
    const assetErrors = validatePublicationAssets(draft, (id) => assets.get(id));
    if (assetErrors.length) throw Object.assign(new Error(assetErrors.join('; ')), { statusCode: 400, errors: assetErrors });
    const allowlist = loadAps(db, venueId);
    const profiles = draft.nodes.flatMap((node) =>
      buildNodeProfiles(loadNodeSamples(db, venueId, node.id, node.fingerprintRevision), allowlist)
        .filter((p) => p.scanCount >= 3 && Object.keys(p.medianRssi).length >= 2)
        .map((p) => ({ nodeId: p.nodeId, fingerprintRevision: p.fingerprintRevision, medianRssi: { ...p.medianRssi }, scanCount: p.scanCount })),
    );
    version = getLatestVersion(db, venueId) + 1;
    for (const frame of draft.frames) {
      const background = frame.background;
      if (!background || verified.has(background.assetId)) continue;
      const bytes = fs.readFileSync(layoutAssetPath(dataDir, venueId, background.sha256));
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (bytes.length !== background.byteLength || digest !== background.sha256) {
        throw Object.assign(new Error('Stored layout asset failed its integrity check'), { statusCode: 400 });
      }
      verified.set(background.assetId, bytes);
    }
    const manifest: MapManifest = {
      schemaVersion: 5,
      venueId,
      canvas: draft.canvas,
      boundary: draft.boundary,
      indoorZones: draft.indoorZones,
      frames: draft.frames,
      nodes: draft.nodes,
      edges: draft.edges,
      transitions: draft.transitions,
      places: draft.places,
      anchors: draft.anchors,
      aps: allowlist,
      version,
      profiles,
      ...(draft.paths !== undefined ? { paths: draft.paths } : {}),
    };
    mapManifestSchema.parse(manifest);
    finalDir = versionDir(dataDir, venueId, version);
    stagingDir = `${finalDir}.tmp-${randomUUID()}`;
    fs.mkdirSync(path.join(stagingDir, 'assets'), { recursive: true });
    for (const frame of draft.frames) {
      const background = frame.background;
      if (!background || !verified.has(background.assetId)) continue;
      const target = path.join(stagingDir, 'assets', `${background.assetId}.png`);
      if (!fs.existsSync(target)) fs.writeFileSync(target, verified.get(background.assetId)!, { flag: 'wx' });
    }
    hooks?.afterStage?.(stagingDir);
    fs.mkdirSync(path.dirname(finalDir), { recursive: true });
    if (fs.existsSync(finalDir)) throw new Error('version directory already exists');
    fs.renameSync(stagingDir, finalDir);
    finalDirectoryCreated = true;
    hooks?.afterRename?.(finalDir);
    stagingDir = undefined;
    db.prepare('INSERT INTO versions (venue_id, version, manifest_json) VALUES (?, ?, ?)').run(venueId, version, JSON.stringify(manifest));
    db.exec('COMMIT');
    return manifest;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* transaction may already have ended */ }
    // Only remove paths created by this attempt and only when no committed row
    // references the final directory.
    for (const owned of [stagingDir, finalDirectoryCreated ? finalDir : undefined]) {
      if (!owned) continue;
      const committed = version > 0 && (db.prepare('SELECT 1 AS present FROM versions WHERE venue_id = ? AND version = ?').get(venueId, version) as { present: number } | undefined);
      if (!committed) {
        try { fs.rmSync(owned, { recursive: true, force: true }); } catch { /* preserve original error */ }
      }
    }
    throw err;
  }
}

function insertVersion(db: DatabaseSync, dataDir: string, venueId: string, version: number, manifest: unknown): void {
  try {
    db.exec('BEGIN');
    db.prepare('INSERT INTO versions (venue_id, version, manifest_json) VALUES (?, ?, ?)').run(
      venueId,
      version,
      JSON.stringify(manifest),
    );
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
  // v3 publishes no image files; the version dir exists for cleanup symmetry.
  fs.mkdirSync(versionDir(dataDir, venueId, version), { recursive: true });
}
