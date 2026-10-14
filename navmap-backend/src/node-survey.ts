import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { BSSID_RE, draftSchemaVersion, loadDraftV3Json, normalizeBssid, parseDraftV3, type NodeProfileV3 } from './draft.js';
import { parseMapDraft } from './map-contract.js';
import { normalizeVenueId } from './venue-id.js';

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

export type NodeReading = { bssid: string; rssi: number };
export type NodeScan = {
  nodeId: string;
  fingerprintRevision: number;
  capturedAt: number;
  readings: NodeReading[];
};

const nodeReadingSchema = z.object({ bssid: z.string(), rssi: z.number().int().min(-100).max(0) }).strict();

const nodeScanSchema = z
  .object({
    nodeId: z.string().min(1),
    fingerprintRevision: z.number().int().nonnegative(),
    capturedAt: z.number().int().positive(),
    readings: z.array(nodeReadingSchema).min(1).max(50),
  })
  .strict();

export const nodeSamplesBodySchema = z
  .object({ nodeId: z.string().min(1), scans: z.array(nodeScanSchema).min(1).max(20) })
  .strict();

function sanitizeBssid(raw: string): string {
  const bssid = normalizeBssid(raw);
  if (!BSSID_RE.test(bssid)) throw new Error(`invalid BSSID: ${raw}`);
  return bssid;
}

/** Draft node reference (V4 or V5): id plus current fingerprint revision. */
type DraftNodeRef = { id: string; fingerprintRevision: number };

function loadDraftNodeRefs(db: DatabaseSync, venueId: string): Map<string, DraftNodeRef> {
  const raw = loadDraftV3Json(db, venueId);
  if (!raw) throw Object.assign(new Error(`no v3 draft for venue ${venueId}`), { statusCode: 404 });
  const json = JSON.parse(raw);
  // V5 drafts dispatch to the frame-aware contract; V4 keeps the legacy path.
  const nodes: DraftNodeRef[] =
    draftSchemaVersion(json) === 5 ? parseMapDraft(json).nodes : parseDraftV3(json).nodes;
  return new Map(nodes.map((n) => [n.id, { id: n.id, fingerprintRevision: n.fingerprintRevision }]));
}

export function loadNodeSamples(
  db: DatabaseSync,
  venueId: string,
  nodeId: string,
  revision?: number,
): NodeScan[] {
  normalizeVenueId(venueId);
  const rows = (
    revision === undefined
      ? db
          .prepare(
            'SELECT node_id, fingerprint_revision, captured_at, readings_json FROM node_samples WHERE venue_id = ? AND node_id = ? ORDER BY captured_at ASC',
          )
          .all(venueId, nodeId)
      : db
          .prepare(
            'SELECT node_id, fingerprint_revision, captured_at, readings_json FROM node_samples WHERE venue_id = ? AND node_id = ? AND fingerprint_revision = ? ORDER BY captured_at ASC',
          )
          .all(venueId, nodeId, revision)
  ) as Array<{ node_id: string; fingerprint_revision: number; captured_at: number; readings_json: string }>;
  return rows.map((r) => ({
    nodeId: r.node_id,
    fingerprintRevision: r.fingerprint_revision,
    capturedAt: r.captured_at,
    readings: JSON.parse(r.readings_json) as NodeReading[],
  }));
}

/**
 * Validate the whole batch first, then insert in one transaction.
 * Node must exist in the v3 draft and the revision must match the node's
 * current fingerprintRevision (renames don't invalidate; moves do).
 */
export function addNodeSamples(
  db: DatabaseSync,
  venueId: string,
  nodeId: string,
  scans: NodeScan[],
): number {
  normalizeVenueId(venueId);
  if (scans.length > 20) throw Object.assign(new Error('at most 20 scans per request'), { statusCode: 400 });
  const node = loadDraftNodeRefs(db, venueId).get(nodeId);
  if (!node) throw Object.assign(new Error(`unknown node: ${nodeId}`), { statusCode: 400 });
  const seen = new Set<number>();
  const normalized = scans.map((scan) => {
    const parsed = nodeScanSchema.parse({ ...scan, nodeId });
    if (parsed.nodeId !== nodeId) {
      throw Object.assign(new Error('scan nodeId must match request nodeId'), { statusCode: 400 });
    }
    if (parsed.fingerprintRevision !== node.fingerprintRevision) {
      throw Object.assign(
        new Error(`stale fingerprint revision: scan ${parsed.fingerprintRevision}, node ${node.fingerprintRevision}`),
        { statusCode: 400 },
      );
    }
    if (seen.has(parsed.capturedAt)) {
      throw Object.assign(new Error(`duplicate capturedAt in request: ${parsed.capturedAt}`), { statusCode: 400 });
    }
    seen.add(parsed.capturedAt);
    const existing = db
      .prepare(
        'SELECT captured_at FROM node_samples WHERE venue_id = ? AND node_id = ? AND fingerprint_revision = ? AND captured_at = ?',
      )
      .get(venueId, nodeId, parsed.fingerprintRevision, parsed.capturedAt) as
      | { captured_at: number }
      | undefined;
    if (existing) {
      throw Object.assign(new Error(`duplicate scan timestamp: ${parsed.capturedAt}`), { statusCode: 400 });
    }
    return {
      ...parsed,
      readings: parsed.readings.map((r) => ({ bssid: sanitizeBssid(r.bssid), rssi: r.rssi })),
    };
  });
  db.exec('BEGIN');
  try {
    for (const s of normalized) {
      db.prepare(
        'INSERT INTO node_samples (venue_id, node_id, fingerprint_revision, captured_at, readings_json) VALUES (?, ?, ?, ?, ?)',
      ).run(venueId, nodeId, s.fingerprintRevision, s.capturedAt, JSON.stringify(s.readings));
    }
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
  return normalized.length;
}

export function buildNodeProfiles(scans: NodeScan[], allowlist: string[]): NodeProfileV3[] {
  const allowed = new Set(allowlist.map(normalizeBssid));
  const byNode = new Map<string, NodeScan[]>();
  for (const scan of scans) {
    if (!byNode.has(scan.nodeId)) byNode.set(scan.nodeId, []);
    byNode.get(scan.nodeId)!.push(scan);
  }
  const profiles: NodeProfileV3[] = [];
  for (const [nodeId, nodeScans] of byNode) {
    const distinct = new Map<number, NodeScan>();
    for (const s of nodeScans) {
      if (!distinct.has(s.capturedAt)) distinct.set(s.capturedAt, s);
    }
    const revision = distinct.values().next().value?.fingerprintRevision ?? 0;
    const values = new Map<string, number[]>();
    for (const s of distinct.values()) {
      for (const r of s.readings) {
        const bssid = normalizeBssid(r.bssid);
        if (!allowed.has(bssid)) continue;
        if (!Number.isInteger(r.rssi) || r.rssi < -100 || r.rssi > 0) continue;
        if (!values.has(bssid)) values.set(bssid, []);
        values.get(bssid)!.push(r.rssi);
      }
    }
    const medianRssi: Record<string, number> = {};
    for (const [bssid, rssis] of values) medianRssi[bssid] = median(rssis);
    profiles.push({ nodeId, fingerprintRevision: revision, medianRssi, scanCount: distinct.size });
  }
  return profiles.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}
