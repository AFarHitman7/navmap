import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { VENUE_ID_RE } from './venue-id.js';

// LEGACY V4 contract: preserved as-is for existing readers. New saves use the
// explicit V5 geographic/static contract in ./map-contract.ts; V4 documents
// upgrade to V5 in memory only (see upgradeV4Draft/upgradeV4Manifest).

export const venueIdSchema = z.string().regex(VENUE_ID_RE);
export const BSSID_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;
export const normalizeBssid = (bssid: string): string => bssid.trim().toUpperCase();

const boundsSchema = z.object({ north: z.number(), south: z.number(), east: z.number(), west: z.number() })
  .strict().refine((b) => b.north > b.south && b.east > b.west, { message: 'bounds must span north>south and east>west' });
const floorSchema = z.object({ z: z.number().int(), label: z.string().min(1) }).strict();
const indoorZoneSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), bounds: boundsSchema, floors: z.array(floorSchema).min(1),
}).strict();
const nodeSchema = z.object({
  id: z.string().min(1), name: z.string().refine((name) => name.trim().length > 0, { message: 'name must be non-empty' }),
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  z: z.number().int(), zoneId: z.string().min(1).nullable(), fingerprintRevision: z.number().int().nonnegative(),
  generated: z.boolean().optional(),
}).strict();
const edgeSchema = z.object({
  from: z.string().min(1), to: z.string().min(1), meters: z.number().positive(),
  kind: z.enum(['path', 'entrance', 'stairs', 'elevator']),
}).strict();
const placeSchema = z.object({ id: z.string().min(1), name: z.string().min(1), zoneId: z.string().min(1), nodeId: z.string().min(1) }).strict();
const anchorSchema = z.object({ id: z.string().min(1), nodeId: z.string().min(1), label: z.string() }).strict();
const pathV3Schema = z.object({
  id: z.string().min(1), name: z.string().min(1), nodeIds: z.array(z.string().min(1)).min(2),
  controlNodeIds: z.array(z.string().min(1)).min(2).optional(),
}).strict();
const nodeProfileSchema = z.object({
  nodeId: z.string().min(1), fingerprintRevision: z.number().int().nonnegative(),
  medianRssi: z.record(z.number()), scanCount: z.number().int().nonnegative(),
}).strict();

export const draftV3Schema = z.object({
  schemaVersion: z.literal(4), venueId: venueIdSchema, boundary: boundsSchema.nullable(),
  indoorZones: z.array(indoorZoneSchema), nodes: z.array(nodeSchema), edges: z.array(edgeSchema),
  places: z.array(placeSchema), anchors: z.array(anchorSchema), aps: z.array(z.string()),
  paths: z.array(pathV3Schema).optional(),
}).strict();
export type DraftV3 = z.infer<typeof draftV3Schema>;
export type BoundsV3 = z.infer<typeof boundsSchema>;
export type NodeV3 = z.infer<typeof nodeSchema>;
export type IndoorZoneV3 = z.infer<typeof indoorZoneSchema>;
export type PathV3 = z.infer<typeof pathV3Schema>;
export type NodeProfileV3 = z.infer<typeof nodeProfileSchema>;
export function parseDraftV3(raw: unknown): DraftV3 { return draftV3Schema.parse(raw); }

/** Dispatch helper for mixed V4/V5 storage: inspects schemaVersion without parsing. */
export function draftSchemaVersion(raw: unknown): 4 | 5 | undefined {
  if (typeof raw === 'object' && raw !== null && 'schemaVersion' in raw) {
    const v = (raw as { schemaVersion?: unknown }).schemaVersion;
    if (v === 4 || v === 5) return v;
  }
  return undefined;
}

export const manifestV3Schema = z.object({
  schemaVersion: z.literal(4), venueId: venueIdSchema, version: z.number().int().positive(),
  boundary: boundsSchema, indoorZones: z.array(indoorZoneSchema), nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema), places: z.array(placeSchema), anchors: z.array(anchorSchema),
  aps: z.array(z.string()), profiles: z.array(nodeProfileSchema), paths: z.array(pathV3Schema).optional(),
}).strict();
export type ManifestV3 = z.infer<typeof manifestV3Schema>;
export function parseManifestV3(raw: unknown): ManifestV3 { return manifestV3Schema.parse(raw); }

export function loadDraftV3Json(db: DatabaseSync, venueId: string): string | null {
  const row = db.prepare('SELECT json FROM drafts_v3 WHERE venue_id = ?').get(venueId) as { json: string } | undefined;
  return row?.json ?? null;
}
export function loadAps(db: DatabaseSync, venueId: string): string[] {
  const row = db.prepare('SELECT json FROM aps WHERE venue_id = ?').get(venueId) as { json: string } | undefined;
  return row ? JSON.parse(row.json) as string[] : [];
}
export function saveDraftV3Json(db: DatabaseSync, venueId: string, json: string): void {
  db.prepare('INSERT INTO drafts_v3 (venue_id, json) VALUES (?, ?) ON CONFLICT(venue_id) DO UPDATE SET json = excluded.json').run(venueId, json);
}
export function updateDraftV3(db: DatabaseSync, raw: unknown): DraftV3 {
  const parsed = parseDraftV3(raw);
  const aps = [...new Set(parsed.aps.map(normalizeBssid))];
  for (const bssid of aps) {
    if (!BSSID_RE.test(bssid)) throw Object.assign(new Error(`invalid BSSID: ${bssid}`), { statusCode: 400 });
  }
  const draft = { ...parsed, aps };
  const incoming: RevisionNodeRef[] = draft.nodes.map((n) => ({
    id: n.id,
    fingerprintRevision: n.fingerprintRevision,
    geometry: nodeGeometryKeyV4(n),
  }));
  // Atomic check-and-write: BEGIN IMMEDIATE takes the write lock up front so
  // concurrent saves and sample submissions serialize instead of interleaving
  // half-applied. A 409 conflict persists nothing (no draft, AP, high-water,
  // or sample change).
  db.exec('BEGIN IMMEDIATE');
  try {
    const storedRaw = loadDraftV3Json(db, draft.venueId);
    let stored: RevisionNodeRef[] | null = null;
    if (storedRaw) {
      const json = JSON.parse(storedRaw);
      if (draftSchemaVersion(json) === 4) {
        stored = parseDraftV3(json).nodes.map((n) => ({
          id: n.id,
          fingerprintRevision: n.fingerprintRevision,
          geometry: nodeGeometryKeyV4(n),
        }));
      }
    }
    enforceMonotonicRevisions(db, draft.venueId, incoming, stored);
    saveDraftV3Json(db, draft.venueId, JSON.stringify(draft));
    db.prepare('INSERT INTO aps (venue_id, json) VALUES (?, ?) ON CONFLICT(venue_id) DO UPDATE SET json = excluded.json').run(draft.venueId, JSON.stringify(aps));
    recordRevisionHighWater(db, draft.venueId, draft.nodes);
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
  return draft;
}

// ---------------------------------------------------------------------------
// Per-node revision high-water marks (Task 3). The table survives node
// deletion, so restoring a deleted node (or replaying a stale snapshot) with
// a reused revision is a structured 409 instead of silently reactivating old
// Wi-Fi samples. Geometry and historical sample maxima are compared together.
// ---------------------------------------------------------------------------

/** Minimal identity the revision check needs per node. */
export type RevisionNodeRef = { id: string; fingerprintRevision: number; geometry: string };

/** Comparable surveyed-geometry identity for a V4 node. */
export function nodeGeometryKeyV4(node: { lat: number; lng: number; zoneId: string | null; z: number }): string {
  return JSON.stringify([node.lat, node.lng, node.zoneId ?? null, node.z]);
}

/** Comparable surveyed-geometry identity for a V5 node. */
export function nodeGeometryKeyV5(node: {
  frameId: string;
  position: unknown;
  zoneId: string | null;
  z: number;
}): string {
  return JSON.stringify([node.frameId, node.position, node.zoneId ?? null, node.z]);
}

function frameSignatureV5(frame: { background?: unknown; calibration?: unknown }): string {
  return JSON.stringify([frame.background ?? null, frame.calibration ?? null]);
}

/**
 * Incoming node ids sitting in a frame whose background or calibration changed
 * since the stored draft. Conservative: every such node counts as
 * geometry-changed even when its own coordinates are untouched.
 */
export function changedFrameNodeIdsV5(
  stored: { frames: Array<{ id: string; background?: unknown; calibration?: unknown }>; nodes: Array<{ id: string; frameId: string }> },
  incoming: { frames: Array<{ id: string; background?: unknown; calibration?: unknown }>; nodes: Array<{ id: string; frameId: string }> },
): Set<string> {
  const before = new Map(stored.frames.map((f) => [f.id, frameSignatureV5(f)]));
  const changed = new Set<string>();
  for (const frame of incoming.frames) {
    const signature = before.get(frame.id);
    if (signature !== undefined && signature !== frameSignatureV5(frame)) {
      for (const node of incoming.nodes) {
        if (node.frameId === frame.id) changed.add(node.id);
      }
    }
  }
  return changed;
}

export function getRevisionHighWater(db: DatabaseSync, venueId: string): Map<string, number> {
  const rows = db
    .prepare('SELECT node_id, revision FROM node_revision_highwater WHERE venue_id = ?')
    .all(venueId) as Array<{ node_id: string; revision: number }>;
  return new Map(rows.map((r) => [r.node_id, r.revision]));
}

export function recordRevisionHighWater(
  db: DatabaseSync,
  venueId: string,
  nodes: Array<{ id: string; fingerprintRevision: number }>,
): void {
  const stmt = db.prepare(
    'INSERT INTO node_revision_highwater (venue_id, node_id, revision) VALUES (?, ?, ?) ON CONFLICT(venue_id, node_id) DO UPDATE SET revision = MAX(revision, excluded.revision)',
  );
  for (const node of nodes) stmt.run(venueId, node.id, node.fingerprintRevision);
}

/** Highest historical sample revision for one node (null when never surveyed). */
export function maxSampleRevision(db: DatabaseSync, venueId: string, nodeId: string): number | null {
  const row = db
    .prepare('SELECT MAX(fingerprint_revision) AS m FROM node_samples WHERE venue_id = ? AND node_id = ?')
    .get(venueId, nodeId) as { m: number | null } | undefined;
  return row?.m ?? null;
}

export function revisionConflictError(nodeIds: string[], currentRevisions: Record<string, number>): Error {
  return Object.assign(new Error(`stale fingerprint revision for nodes: ${nodeIds.join(', ')}`), {
    statusCode: 409,
    code: 'revision_conflict',
    nodeIds,
    currentRevisions,
  });
}

/**
 * Enforce strictly newer revision tokens for every added, restored,
 * geometry-changed, or frame-invalidated node. Unchanged-geometry nodes
 * (renames) pass at any revision. Throws a structured 409 carrying
 * {code:'revision_conflict', nodeIds, currentRevisions}.
 */
export function enforceMonotonicRevisions(
  db: DatabaseSync,
  venueId: string,
  incoming: RevisionNodeRef[],
  stored: RevisionNodeRef[] | null,
  frameInvalidated?: Set<string>,
): void {
  const storedById = new Map((stored ?? []).map((n) => [n.id, n]));
  const highWater = getRevisionHighWater(db, venueId);
  const conflicts: string[] = [];
  const currentRevisions: Record<string, number> = {};
  for (const node of incoming) {
    const prev = storedById.get(node.id);
    const changed = !prev || prev.geometry !== node.geometry || (frameInvalidated?.has(node.id) ?? false);
    if (!changed) continue;
    const floor = Math.max(
      highWater.get(node.id) ?? Number.NEGATIVE_INFINITY,
      maxSampleRevision(db, venueId, node.id) ?? Number.NEGATIVE_INFINITY,
      prev?.fingerprintRevision ?? Number.NEGATIVE_INFINITY,
    );
    if (!(node.fingerprintRevision > floor)) {
      conflicts.push(node.id);
      currentRevisions[node.id] = floor;
    }
  }
  if (conflicts.length > 0) throw revisionConflictError(conflicts, currentRevisions);
}
