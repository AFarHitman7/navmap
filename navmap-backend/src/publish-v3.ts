import fs from 'node:fs';
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

/**
 * Publish a coordinated draft: no images required. Node profiles are built from
 * current-revision samples; only viable profiles (scanCount >= 3 with at
 * least 2 APs) are published. Stale-revision samples never publish.
 */
export function publishV3(db: DatabaseSync, dataDir: string, venueId: string): ManifestV3 | MapManifest {
  normalizeVenueId(venueId);
  ensureVenue(db, venueId);
  const raw = loadDraftV3Json(db, venueId);
  if (!raw) throw Object.assign(new Error(`no v3 draft for venue ${venueId}`), { statusCode: 404 });
  const json = JSON.parse(raw);
  if (draftSchemaVersion(json) === 5) return publishV5Draft(db, dataDir, venueId, json);
  return publishV4Draft(db, dataDir, venueId, json);
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
 * canvases stay rejected until frame assets are verified (later task).
 */
function publishV5Draft(db: DatabaseSync, dataDir: string, venueId: string, json: unknown): MapManifest {
  if (!isV5AuthoringEnabled()) {
    throw Object.assign(new Error('V5 map authoring is disabled on this server (MAP_V5_AUTHORING_ENABLED)'), { statusCode: 403 });
  }
  const draft: MapDraft = parseMapDraft(json);
  const errors = validatePublishV5(draft);
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join('; ')), { statusCode: 400, errors });
  }
  const allowlist = loadAps(db, venueId);
  const profiles = draft.nodes.flatMap((node) =>
    buildNodeProfiles(loadNodeSamples(db, venueId, node.id, node.fingerprintRevision), allowlist)
      .filter((p) => p.scanCount >= 3 && Object.keys(p.medianRssi).length >= 2)
      .map((p) => ({ nodeId: p.nodeId, fingerprintRevision: p.fingerprintRevision, medianRssi: { ...p.medianRssi }, scanCount: p.scanCount })),
  );
  const version = getLatestVersion(db, venueId) + 1;
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
  insertVersion(db, dataDir, venueId, version, manifest);
  return manifest;
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
