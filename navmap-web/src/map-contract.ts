// V5 explicit geographic/static map contract.
//
// Additive read/upgrade module: the V4 contract in ./contract-v3.ts stays
// available as legacy exports and keeps parsing existing drafts. New saves
// use schemaVersion 5; V4 documents are upgraded in memory via
// upgradeV4Draft/upgradeV4Manifest (explicit Save writes V5, never rewrites
// immutable V4 publications).
import { z } from 'zod';
import { parseDraftV3, parseManifestV3, type DraftV3, type ManifestV3, type NodeV3 } from './contract-v3';

const finiteIn = (min: number, max: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .refine((n) => Number.isFinite(n), { message: 'must be finite' });

const positiveFinite = () =>
  z
    .number()
    .positive()
    .refine((n) => Number.isFinite(n), { message: 'must be finite' });

const venueIdV5Schema = z.string().min(1);

const positionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('geographic'),
      lat: finiteIn(-90, 90),
      lng: finiteIn(-180, 180),
    })
    .strict(),
  z
    .object({
      kind: z.literal('local'),
      x: finiteIn(0, 1),
      y: finiteIn(0, 1),
    })
    .strict(),
]);

const geoRectBase = z
  .object({
    kind: z.literal('geographic'),
    north: finiteIn(-90, 90),
    south: finiteIn(-90, 90),
    east: finiteIn(-180, 180),
    west: finiteIn(-180, 180),
  })
  .strict();

const localRectBase = z
  .object({
    kind: z.literal('local'),
    left: finiteIn(0, 1),
    top: finiteIn(0, 1),
    right: finiteIn(0, 1),
    bottom: finiteIn(0, 1),
  })
  .strict();

const rectSchema = z.discriminatedUnion('kind', [geoRectBase, localRectBase]).superRefine((rect, ctx) => {
  const ok =
    rect.kind === 'geographic'
      ? rect.north > rect.south && rect.east > rect.west
      : rect.left < rect.right && rect.top < rect.bottom;
  if (!ok) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        rect.kind === 'geographic'
          ? 'bounds must span north>south and east>west'
          : 'bounds must span left<right and top<bottom',
    });
  }
});

const canvasSchema = z.object({ kind: z.enum(['geographic', 'static']) }).strict();

const floorV5Schema = z.object({ z: z.number().int(), label: z.string().min(1) }).strict();

const indoorZoneV5Schema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    bounds: rectSchema.optional(),
    floors: z.array(floorV5Schema).min(1),
  })
  .strict();

const backgroundSchema = z
  .object({
    assetId: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
    byteLength: z.number().int().positive(),
  })
  .strict();

const calibrationSchema = z.object({ metersPerPixel: positiveFinite() }).strict();

const frameSchema = z
  .object({
    id: z.string().min(1),
    zoneId: z.string().min(1).nullable(),
    z: z.number().int(),
    bounds: rectSchema,
    background: backgroundSchema.optional(),
    calibration: calibrationSchema.optional(),
  })
  .strict();

const nodeSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().refine((name) => name.trim().length > 0, { message: 'name must be non-empty' }),
    frameId: z.string().min(1),
    position: positionSchema,
    zoneId: z.string().min(1).nullable(),
    z: z.number().int(),
    fingerprintRevision: z.number().int().nonnegative(),
    generated: z.boolean().optional(),
    visitorVisible: z.boolean(),
  })
  .strict();

const edgeSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    kind: z.enum(['path', 'entrance', 'stairs', 'elevator']),
    cost: positiveFinite(),
    meters: positiveFinite().optional(),
  })
  .strict();

const pathSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(['regular', 'stair']),
    nodeIds: z.array(z.string().min(1)).min(2),
    controlNodeIds: z.array(z.string().min(1)).min(2).optional(),
  })
  .strict();

const transitionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(['entrance', 'stair', 'elevator']),
    nodeIds: z.tuple([z.string().min(1), z.string().min(1)]),
  })
  .strict();

const placeV5Schema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    zoneId: z.string().min(1),
    nodeId: z.string().min(1),
  })
  .strict();

const anchorV5Schema = z
  .object({
    id: z.string().min(1),
    nodeId: z.string().min(1),
    label: z.string(),
  })
  .strict();

const nodeProfileV5Schema = z
  .object({
    nodeId: z.string().min(1),
    fingerprintRevision: z.number().int().nonnegative(),
    medianRssi: z.record(z.string(), z.number()),
    scanCount: z.number().int().nonnegative(),
  })
  .strict();

const draftFields = {
  schemaVersion: z.literal(5),
  venueId: venueIdV5Schema,
  canvas: canvasSchema,
  boundary: rectSchema.nullable(),
  indoorZones: z.array(indoorZoneV5Schema),
  frames: z.array(frameSchema),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  paths: z.array(pathSchema).optional(),
  transitions: z.array(transitionSchema),
  places: z.array(placeV5Schema),
  anchors: z.array(anchorV5Schema),
  aps: z.array(z.string()),
};

const draftObjectSchema = z.object(draftFields).strict();

const manifestObjectSchema = z
  .object({
    ...draftFields,
    version: z.number().int().positive(),
    profiles: z.array(nodeProfileV5Schema),
  })
  .strict();

type DraftRaw = z.infer<typeof draftObjectSchema>;
type ManifestRaw = z.infer<typeof manifestObjectSchema>;

function checkMapRelations(doc: DraftRaw, ctx: z.RefinementCtx, manifest: boolean): void {
  const issue = (message: string, path: (string | number)[] = []) => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
  };
  const kind = doc.canvas.kind;
  // Canvas 'static' uses local coordinates; canvas 'geographic' uses geographic ones.
  const coordKind = kind === 'static' ? 'local' : 'geographic';
  if (doc.boundary !== null && doc.boundary.kind !== coordKind) {
    issue(`${kind} canvas requires a ${coordKind} boundary`, ['boundary']);
  }
  doc.indoorZones.forEach((zone, i) => {
    if (zone.bounds && zone.bounds.kind !== coordKind) {
      issue(`indoorZone ${zone.id} bounds must match the ${kind} canvas`, ['indoorZones', i, 'bounds']);
    }
  });
  doc.frames.forEach((frame, i) => {
    if (frame.bounds.kind !== coordKind) {
      issue(`frame ${frame.id} bounds must match the ${kind} canvas`, ['frames', i, 'bounds']);
    }
  });
  doc.nodes.forEach((node, i) => {
    if (node.position.kind !== coordKind) {
      issue(`node ${node.id} position must match the ${kind} canvas`, ['nodes', i, 'position']);
    }
  });

  const unique = (ids: string[], what: string, pathKey: string) => {
    const seen = new Set<string>();
    ids.forEach((id, i) => {
      if (seen.has(id)) issue(`duplicate ${what} id ${id}`, [pathKey, i, 'id']);
      seen.add(id);
    });
  };
  unique(doc.frames.map((f) => f.id), 'frame', 'frames');
  unique(doc.nodes.map((n) => n.id), 'node', 'nodes');
  unique(doc.indoorZones.map((z) => z.id), 'indoorZone', 'indoorZones');
  doc.indoorZones.forEach((zone, zi) => {
    const seenLevels = new Set<number>();
    zone.floors.forEach((floor, fi) => {
      if (seenLevels.has(floor.z)) {
        issue(`duplicate floor z ${floor.z} in indoorZone ${zone.id}`, ['indoorZones', zi, 'floors', fi, 'z']);
      }
      seenLevels.add(floor.z);
    });
  });
  unique(doc.transitions.map((t) => t.id), 'transition', 'transitions');
  if (doc.paths) unique(doc.paths.map((p) => p.id), 'path', 'paths');
  unique(doc.places.map((p) => p.id), 'place', 'places');
  unique(doc.anchors.map((a) => a.id), 'anchor', 'anchors');

  const zoneIds = new Set(doc.indoorZones.map((z) => z.id));
  const frameById = new Map(doc.frames.map((f) => [f.id, f]));
  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
  doc.frames.forEach((frame, i) => {
    if (frame.zoneId !== null && !zoneIds.has(frame.zoneId)) {
      issue(`frame ${frame.id} references unknown zone ${frame.zoneId}`, ['frames', i, 'zoneId']);
    }
  });
  doc.nodes.forEach((node, i) => {
    const frame = frameById.get(node.frameId);
    if (!frame) {
      issue(`node ${node.id} references unknown frame ${node.frameId}`, ['nodes', i, 'frameId']);
      return;
    }
    if (node.zoneId !== frame.zoneId) {
      issue(`node ${node.id} zoneId must match frame ${frame.id} zoneId`, ['nodes', i, 'zoneId']);
    }
    if (node.z !== frame.z) {
      issue(`node ${node.id} z must match frame ${frame.id} z`, ['nodes', i, 'z']);
    }
    if (node.zoneId !== null && !zoneIds.has(node.zoneId)) {
      issue(`node ${node.id} references unknown zone ${node.zoneId}`, ['nodes', i, 'zoneId']);
    }
  });

  const pairKey = (a: string, b: string) => (a < b ? `${a}␟${b}` : `${b}␟${a}`);
  const edgeKindByPair = new Map<string, string>();
  doc.edges.forEach((edge, i) => {
    if (!nodeById.has(edge.from)) {
      issue(`edge ${edge.from}->${edge.to} references unknown node ${edge.from}`, ['edges', i, 'from']);
    }
    if (!nodeById.has(edge.to)) {
      issue(`edge ${edge.from}->${edge.to} references unknown node ${edge.to}`, ['edges', i, 'to']);
    }
    if (edge.from === edge.to) {
      issue(`edge ${edge.from}->${edge.to} must connect two different nodes`, ['edges', i]);
    }
    const key = pairKey(edge.from, edge.to);
    if (edgeKindByPair.has(key)) {
      issue(`duplicate edge for node pair ${edge.from} ${edge.to}`, ['edges', i]);
    } else {
      edgeKindByPair.set(key, edge.kind);
    }
  });

  if (doc.paths) {
    doc.paths.forEach((path, i) => {
      path.nodeIds.forEach((id) => {
        if (!nodeById.has(id)) issue(`path ${path.id} references unknown node ${id}`, ['paths', i, 'nodeIds']);
      });
      if (path.controlNodeIds) {
        path.controlNodeIds.forEach((id) => {
          if (!nodeById.has(id)) issue(`path ${path.id} references unknown control node ${id}`, ['paths', i, 'controlNodeIds']);
        });
      }
      for (let k = 0; k + 1 < path.nodeIds.length; k++) {
        const a = path.nodeIds[k] as string;
        const b = path.nodeIds[k + 1] as string;
        const hit = edgeKindByPair.get(pairKey(a, b));
        if (!hit) {
          issue(`path ${path.id} has no edge between ${a} and ${b}`, ['paths', i, 'nodeIds']);
        } else if (hit !== 'path') {
          issue(`path ${path.id} traverses transition edge ${a} ${b}`, ['paths', i, 'nodeIds']);
        }
      }
    });
  }

  // Each transition mirrors exactly one entrance/stairs/elevator edge pair.
  const transitionKindForEdge: Record<string, string> = { entrance: 'entrance', stairs: 'stair', elevator: 'elevator' };
  doc.transitions.forEach((t, i) => {
    const [a, b] = t.nodeIds;
    if (!nodeById.has(a)) issue(`transition ${t.id} references unknown node ${a}`, ['transitions', i, 'nodeIds']);
    if (!nodeById.has(b)) issue(`transition ${t.id} references unknown node ${b}`, ['transitions', i, 'nodeIds']);
    const hit = edgeKindByPair.get(pairKey(a, b));
    if (!hit || transitionKindForEdge[hit] !== t.kind) {
      issue(`transition ${t.id} must match a ${t.kind} edge between its nodes`, ['transitions', i, 'nodeIds']);
    }
  });

  doc.places.forEach((p, i) => {
    if (!zoneIds.has(p.zoneId)) issue(`place ${p.id} references unknown zone ${p.zoneId}`, ['places', i, 'zoneId']);
    if (!nodeById.has(p.nodeId)) issue(`place ${p.id} references unknown node ${p.nodeId}`, ['places', i, 'nodeId']);
  });
  doc.anchors.forEach((a, i) => {
    if (!nodeById.has(a.nodeId)) issue(`anchor ${a.id} references unknown node ${a.nodeId}`, ['anchors', i, 'nodeId']);
  });

  if (manifest) {
    const m = doc as ManifestRaw;
    if (kind === 'geographic' && doc.boundary === null) {
      issue('geographic manifest requires a boundary', ['boundary']);
    }
    if (kind === 'static') {
      const contentFrames = new Set<string>();
      doc.nodes.forEach((n) => contentFrames.add(n.frameId));
      if (doc.paths) {
        doc.paths.forEach((p) =>
          p.nodeIds.forEach((id) => {
            const n = nodeById.get(id);
            if (n) contentFrames.add(n.frameId);
          }),
        );
      }
      doc.transitions.forEach((t) =>
        t.nodeIds.forEach((id) => {
          const n = nodeById.get(id);
          if (n) contentFrames.add(n.frameId);
        }),
      );
      doc.frames.forEach((frame, i) => {
        if (contentFrames.has(frame.id) && !frame.background) {
          issue(`static frame ${frame.id} with navigable content requires an assigned background`, [
            'frames',
            i,
            'background',
          ]);
        }
      });
    }
    m.profiles.forEach((p, i) => {
      if (!nodeById.has(p.nodeId)) issue(`profile references unknown node ${p.nodeId}`, ['profiles', i, 'nodeId']);
    });
  }
}

export const mapDraftSchema = draftObjectSchema.superRefine((doc, ctx) => checkMapRelations(doc, ctx, false));
export const mapManifestSchema = manifestObjectSchema.superRefine((doc, ctx) => checkMapRelations(doc, ctx, true));

export type Position = z.infer<typeof positionSchema>;
export type Rect = z.infer<typeof rectSchema>;
export type MapCanvas = z.infer<typeof canvasSchema>;
export type MapFrame = z.infer<typeof frameSchema>;
export type MapNode = z.infer<typeof nodeSchema>;
export type MapEdge = z.infer<typeof edgeSchema>;
export type MapPath = z.infer<typeof pathSchema>;
export type MapTransition = z.infer<typeof transitionSchema>;
export type MapPlace = z.infer<typeof placeV5Schema>;
export type MapAnchor = z.infer<typeof anchorV5Schema>;
export type MapNodeProfile = z.infer<typeof nodeProfileV5Schema>;
export type MapIndoorZone = z.infer<typeof indoorZoneV5Schema>;
export type MapDraft = z.infer<typeof mapDraftSchema>;
export type MapManifest = z.infer<typeof mapManifestSchema>;

export function parseMapDraft(raw: unknown): MapDraft {
  return mapDraftSchema.parse(raw);
}

export function parseMapManifest(raw: unknown): MapManifest {
  return mapManifestSchema.parse(raw);
}

const TRANSITION_KIND_FOR_EDGE = { entrance: 'entrance', stairs: 'stair', elevator: 'elevator' } as const;

function frameIdFor(zoneId: string | null, z: number): string {
  return zoneId === null ? `frame-outdoor-z${z}` : `frame-${zoneId}-z${z}`;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}␟${b}` : `${b}␟${a}`;
}

function transitionIdFor(from: string, to: string): string {
  // Length-prefixed endpoint tuple: unambiguous for arbitrary valid IDs, so
  // ("a-b", "c") and ("a", "b-c") encode differently and decode uniquely.
  return `tr-${from.length}-${from}${to}`;
}

type GeoBounds = { north: number; south: number; east: number; west: number };

function boundsForFrame(
  zoneId: string | null,
  nodes: Pick<NodeV3, 'lat' | 'lng'>[],
  zoneBounds: GeoBounds | undefined,
  draftBoundary: GeoBounds | null,
): Rect {
  const source = zoneId !== null ? (zoneBounds ?? draftBoundary) : draftBoundary;
  if (source) return { kind: 'geographic', ...source };
  // Deterministic bbox fallback (only when neither zone nor draft bounds exist).
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const n of nodes) {
    if (n.lat > north) north = n.lat;
    if (n.lat < south) south = n.lat;
    if (n.lng > east) east = n.lng;
    if (n.lng < west) west = n.lng;
  }
  const latPad = Math.max((north - south) * 0.05, 0.0001);
  const lngPad = Math.max((east - west) * 0.05, 0.0001);
  return {
    kind: 'geographic',
    north: Math.min(90, north + latPad),
    south: Math.max(-90, south - latPad),
    east: Math.min(180, east + lngPad),
    west: Math.max(-180, west - lngPad),
  };
}

type EdgeV4 = DraftV3['edges'][number];

function upgradeParsedV4(v4: DraftV3): MapDraft {
  const zoneBounds = new Map(v4.indoorZones.map((zone) => [zone.id, zone.bounds]));
  const placeNodeIds = new Set(v4.places.map((p) => p.nodeId));

  // One frame per (zoneId, z) membership group, sorted for stability.
  const groups = new Map<string, { zoneId: string | null; z: number; nodes: NodeV3[] }>();
  for (const node of v4.nodes) {
    const key = `${node.zoneId ?? ''}␟${node.z}`;
    let group = groups.get(key);
    if (!group) {
      group = { zoneId: node.zoneId, z: node.z, nodes: [] };
      groups.set(key, group);
    }
    group.nodes.push(node);
  }
  const frames: MapFrame[] = [...groups.values()]
    .map((group) => ({
      id: frameIdFor(group.zoneId, group.z),
      zoneId: group.zoneId,
      z: group.z,
      bounds: boundsForFrame(group.zoneId, group.nodes, zoneBounds.get(group.zoneId ?? ''), v4.boundary),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const nodes: MapNode[] = v4.nodes.map((node): MapNode => ({
    id: node.id,
    name: node.name,
    frameId: frameIdFor(node.zoneId, node.z),
    position: { kind: 'geographic', lat: node.lat, lng: node.lng },
    zoneId: node.zoneId,
    z: node.z,
    fingerprintRevision: node.fingerprintRevision,
    ...(node.generated === undefined ? {} : { generated: node.generated }),
    // Legacy authored (non-generated) nodes and place-linked nodes are destinations.
    visitorVisible: node.generated !== true || placeNodeIds.has(node.id),
  }));

  // One undirected edge per node pair: keep the minimum-cost legacy edge.
  const kept: EdgeV4[] = [];
  const keptIndex = new Map<string, number>();
  v4.edges.forEach((edge) => {
    const key = pairKey(edge.from, edge.to);
    const prev = keptIndex.get(key);
    if (prev === undefined) {
      keptIndex.set(key, kept.length);
      kept.push(edge);
    } else if (edge.meters < (kept[prev] as EdgeV4).meters) {
      kept[prev] = edge;
    }
  });
  const edges: MapEdge[] = kept.map((edge) => ({
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    // Geographic cost keeps the legacy metre weight so route ordering is unchanged.
    cost: edge.meters,
    meters: edge.meters,
  }));

  // Transition groups mirror entrance/stairs/elevator edges; endpoints unchanged.
  const transitionKeys = new Set<string>();
  const transitions: MapTransition[] = [];
  for (const edge of kept) {
    if (edge.kind === 'path') continue;
    transitionKeys.add(pairKey(edge.from, edge.to));
    transitions.push({
      id: transitionIdFor(edge.from, edge.to),
      name: `${edge.kind} ${edge.from} ↔ ${edge.to}`,
      kind: TRANSITION_KIND_FOR_EDGE[edge.kind],
      nodeIds: [edge.from, edge.to],
    });
  }

  // Split legacy mixed path groups at transition edges with stable derived ids.
  const nodeById = new Map(v4.nodes.map((n) => [n.id, n]));
  let paths: MapPath[] | undefined;
  if (v4.paths !== undefined) {
    paths = [];
    for (const legacy of v4.paths) {
      const segments: string[][] = [];
      let current: string[] = [];
      const ids = legacy.nodeIds;
      for (let k = 0; k < ids.length; k++) {
        const id = ids[k] as string;
        if (k > 0 && transitionKeys.has(pairKey(ids[k - 1] as string, id))) {
          if (current.length >= 2) segments.push(current);
          current = [id];
        } else {
          current.push(id);
        }
      }
      if (current.length >= 2) segments.push(current);
      if (segments.length === 0) continue;
      const kindFor = (segment: string[]): 'regular' | 'stair' => {
        const zValues = new Set(
          segment.map((id) => nodeById.get(id)?.z).filter((zValue) => zValue !== undefined),
        );
        return zValues.size > 1 ? 'stair' : 'regular';
      };
      if (segments.length === 1) {
        const only = segments[0] as string[];
        paths.push({
          id: legacy.id,
          name: legacy.name,
          kind: kindFor(only),
          nodeIds: [...only],
          ...(legacy.controlNodeIds === undefined ? {} : { controlNodeIds: [...legacy.controlNodeIds] }),
        });
        continue;
      }
      segments.forEach((segment, index) => {
        const inSegment = new Set(segment);
        const controls = legacy.controlNodeIds?.filter((id) => inSegment.has(id));
        paths?.push({
          id: `${legacy.id}#${index + 1}`,
          name: `${legacy.name} (${index + 1} of ${segments.length})`,
          kind: kindFor(segment),
          nodeIds: [...segment],
          ...(controls !== undefined && controls.length >= 2 ? { controlNodeIds: controls } : {}),
        });
      });
    }
  }

  const upgraded = {
    schemaVersion: 5 as const,
    venueId: v4.venueId,
    canvas: { kind: 'geographic' as const },
    boundary: v4.boundary ? { kind: 'geographic' as const, ...v4.boundary } : null,
    indoorZones: v4.indoorZones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      bounds: { kind: 'geographic' as const, ...zone.bounds },
      floors: zone.floors.map((floor) => ({ z: floor.z, label: floor.label })),
    })),
    frames,
    nodes,
    edges,
    paths,
    transitions,
    places: v4.places.map((place) => ({ ...place })),
    anchors: v4.anchors.map((anchor) => ({ ...anchor })),
    aps: [...v4.aps],
  };
  return parseMapDraft(upgraded);
}

export function upgradeV4Draft(raw: unknown): MapDraft {
  return upgradeParsedV4(parseDraftV3(raw));
}

export function upgradeV4Manifest(raw: unknown): MapManifest {
  const v4: ManifestV3 = parseManifestV3(raw);
  const { version, profiles, ...draftPart } = v4;
  const upgraded = upgradeParsedV4(draftPart);
  return parseMapManifest({
    ...upgraded,
    version,
    profiles: profiles.map((profile) => ({ ...profile, medianRssi: { ...profile.medianRssi } })),
  });
}
