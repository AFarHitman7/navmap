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
  saveDraftV3Json(db, draft.venueId, JSON.stringify(draft));
  db.prepare('INSERT INTO aps (venue_id, json) VALUES (?, ?) ON CONFLICT(venue_id) DO UPDATE SET json = excluded.json').run(draft.venueId, JSON.stringify(aps));
  return draft;
}
