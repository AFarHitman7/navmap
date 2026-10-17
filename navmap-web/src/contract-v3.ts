import { z } from 'zod';

// LEGACY V4 contract: preserved as-is for existing readers. New saves use the
// explicit V5 geographic/static contract in ./map-contract.ts; V4 documents
// upgrade to V5 in memory only (see upgradeV4Draft/upgradeV4Manifest).

export const boundsV3Schema = z
  .object({
    north: z.number(),
    south: z.number(),
    east: z.number(),
    west: z.number(),
  })
  .strict()
  .refine((b) => b.north > b.south && b.east > b.west, {
    message: 'bounds must span north>south and east>west',
  });

export const floorV3Schema = z.object({ z: z.number().int(), label: z.string().min(1) }).strict();

export const indoorZoneV3Schema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    bounds: boundsV3Schema,
    floors: z.array(floorV3Schema).min(1),
  })
  .strict();

export const nodeV3Schema = z
  .object({
    id: z.string().min(1),
    name: z.string().refine((name) => name.trim().length > 0, { message: 'name must be non-empty' }),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    z: z.number().int(),
    zoneId: z.string().min(1).nullable(),
    fingerprintRevision: z.number().int().nonnegative(),
    generated: z.boolean().optional(),
  })
  .strict();

export const edgeV3Schema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    meters: z.number().positive(),
    kind: z.enum(['path', 'entrance', 'stairs', 'elevator']),
  })
  .strict();

const placeV3Schema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    zoneId: z.string().min(1),
    nodeId: z.string().min(1),
  })
  .strict();

const anchorV3Schema = z
  .object({
    id: z.string().min(1),
    nodeId: z.string().min(1),
    label: z.string().min(1),
  })
  .strict();

const pathV3Schema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    nodeIds: z.array(z.string().min(1)).min(2),
    controlNodeIds: z.array(z.string().min(1)).min(2).optional(),
  })
  .strict();

export const nodeProfileV3Schema = z
  .object({
    nodeId: z.string().min(1),
    fingerprintRevision: z.number().int().nonnegative(),
    medianRssi: z.record(z.string(), z.number()),
    scanCount: z.number().int().nonnegative(),
  })
  .strict();

export const draftV3Schema = z
  .object({
    schemaVersion: z.literal(4),
    venueId: z.string().min(1),
    boundary: boundsV3Schema.nullable(),
    indoorZones: z.array(indoorZoneV3Schema),
    nodes: z.array(nodeV3Schema),
    edges: z.array(edgeV3Schema),
    places: z.array(placeV3Schema),
    anchors: z.array(anchorV3Schema),
    aps: z.array(z.string()),
    paths: z.array(pathV3Schema).optional(),
  })
  .strict();

export const manifestV3Schema = z
  .object({
    schemaVersion: z.literal(4),
    venueId: z.string().min(1),
    version: z.number().int().positive(),
    boundary: boundsV3Schema,
    indoorZones: z.array(indoorZoneV3Schema),
    nodes: z.array(nodeV3Schema),
    edges: z.array(edgeV3Schema),
    places: z.array(placeV3Schema),
    anchors: z.array(anchorV3Schema),
    aps: z.array(z.string()),
    profiles: z.array(nodeProfileV3Schema),
    paths: z.array(pathV3Schema).optional(),
  })
  .strict();

export type BoundsV3 = z.infer<typeof boundsV3Schema>;
export type FloorV3 = z.infer<typeof floorV3Schema>;
export type IndoorZoneV3 = z.infer<typeof indoorZoneV3Schema>;
export type NodeV3 = z.infer<typeof nodeV3Schema>;
export type EdgeV3 = z.infer<typeof edgeV3Schema>;
export type PlaceV3 = z.infer<typeof placeV3Schema>;
export type PathV3 = z.infer<typeof pathV3Schema>;
export type NodeProfileV3 = z.infer<typeof nodeProfileV3Schema>;
export type DraftV3 = z.infer<typeof draftV3Schema>;
export type ManifestV3 = z.infer<typeof manifestV3Schema>;

export function parseDraftV3(raw: unknown): DraftV3 {
  return draftV3Schema.parse(raw);
}

export function parseManifestV3(raw: unknown): ManifestV3 {
  return manifestV3Schema.parse(raw);
}
