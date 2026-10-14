// V5 explicit geographic/static map contract (Hermes-compatible, no zod).
//
// Additive read/upgrade module mirroring the zod schemas in
// navmap-web/src/map-contract.ts and navmap-backend/src/map-contract.ts.
// The V4 contract in ./contract-v3.ts stays available as legacy exports.
// V4 documents upgrade in memory; only explicit Save writes V5.
import { parseDraftV3, parseManifestV3, VENUE_ID_RE } from './contract-v3';
import type { DraftV3, ManifestV3, NodeV3 } from './contract-v3';

export type Position = { kind: 'geographic'; lat: number; lng: number } | { kind: 'local'; x: number; y: number };
export type Rect =
  | { kind: 'geographic'; north: number; south: number; east: number; west: number }
  | { kind: 'local'; left: number; top: number; right: number; bottom: number };
export type MapCanvas = { kind: 'geographic' | 'static' };
export type MapFloor = { z: number; label: string };
export type MapIndoorZone = { id: string; name: string; bounds?: Rect; floors: MapFloor[] };
export type MapBackground = { assetId: string; width: number; height: number; sha256: string; byteLength: number };
export type MapCalibration = { metersPerPixel: number };
export type MapFrame = {
  id: string;
  zoneId: string | null;
  z: number;
  bounds: Rect;
  background?: MapBackground;
  calibration?: MapCalibration;
};
export type MapNode = {
  id: string;
  name: string;
  frameId: string;
  position: Position;
  zoneId: string | null;
  z: number;
  fingerprintRevision: number;
  generated?: boolean;
  visitorVisible: boolean;
};
export type MapEdge = {
  from: string;
  to: string;
  kind: 'path' | 'entrance' | 'stairs' | 'elevator';
  cost: number;
  meters?: number;
};
export type MapPath = {
  id: string;
  name: string;
  kind: 'regular' | 'stair';
  nodeIds: string[];
  controlNodeIds?: string[];
  transitionId?: string;
};
export type MapTransition = {
  id: string;
  name: string;
  kind: 'entrance' | 'stair' | 'elevator';
  nodeIds: [string, string];
};
export type MapPlace = { id: string; name: string; zoneId: string; nodeId: string };
export type MapAnchor = { id: string; nodeId: string; label: string };
export type MapNodeProfile = {
  nodeId: string;
  fingerprintRevision: number;
  medianRssi: Record<string, number>;
  scanCount: number;
};
export type MapDraft = {
  schemaVersion: 5;
  venueId: string;
  canvas: MapCanvas;
  boundary: Rect | null;
  indoorZones: MapIndoorZone[];
  frames: MapFrame[];
  nodes: MapNode[];
  edges: MapEdge[];
  paths?: MapPath[];
  transitions: MapTransition[];
  places: MapPlace[];
  anchors: MapAnchor[];
  aps: string[];
};
export type MapManifest = MapDraft & { version: number; profiles: MapNodeProfile[] };

const EDGE_KINDS = ['path', 'entrance', 'stairs', 'elevator'] as const;
const SHA256_RE = /^[0-9a-fA-F]{64}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(msg: string): never {
  throw new Error(`mapContract: ${msg}`);
}

function checkStrict(obj: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) fail(`${what} has unknown key ${k}`);
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function finiteIn(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(`${what} must be a finite number in [${min}, ${max}]`);
  return v as number;
}

function positiveFinite(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || !(v > 0)) fail(`${what} must be a positive finite number`);
  return v as number;
}

function parsePosition(raw: unknown): Position {
  if (!isRecord(raw)) fail('position must be an object');
  if (raw.kind === 'geographic') {
    checkStrict(raw, ['kind', 'lat', 'lng'], 'position');
    return {
      kind: 'geographic',
      lat: finiteIn(raw.lat, -90, 90, 'position.lat'),
      lng: finiteIn(raw.lng, -180, 180, 'position.lng'),
    };
  }
  if (raw.kind === 'local') {
    checkStrict(raw, ['kind', 'x', 'y'], 'position');
    return { kind: 'local', x: finiteIn(raw.x, 0, 1, 'position.x'), y: finiteIn(raw.y, 0, 1, 'position.y') };
  }
  fail(`position.kind must be geographic|local`);
}

function parseRect(raw: unknown, what: string): Rect {
  if (!isRecord(raw)) fail(`${what} must be an object`);
  if (raw.kind === 'geographic') {
    checkStrict(raw, ['kind', 'north', 'south', 'east', 'west'], what);
    const rect: Rect = {
      kind: 'geographic',
      north: finiteIn(raw.north, -90, 90, `${what}.north`),
      south: finiteIn(raw.south, -90, 90, `${what}.south`),
      east: finiteIn(raw.east, -180, 180, `${what}.east`),
      west: finiteIn(raw.west, -180, 180, `${what}.west`),
    };
    if (!(rect.north > rect.south && rect.east > rect.west)) fail(`${what} bounds must span north>south and east>west`);
    return rect;
  }
  if (raw.kind === 'local') {
    checkStrict(raw, ['kind', 'left', 'top', 'right', 'bottom'], what);
    const rect: Rect = {
      kind: 'local',
      left: finiteIn(raw.left, 0, 1, `${what}.left`),
      top: finiteIn(raw.top, 0, 1, `${what}.top`),
      right: finiteIn(raw.right, 0, 1, `${what}.right`),
      bottom: finiteIn(raw.bottom, 0, 1, `${what}.bottom`),
    };
    if (!(rect.left < rect.right && rect.top < rect.bottom)) fail(`${what} bounds must span left<right and top<bottom`);
    return rect;
  }
  fail(`${what}.kind must be geographic|local`);
}

function parseCanvas(raw: unknown): MapCanvas {
  if (!isRecord(raw)) fail('canvas must be an object');
  checkStrict(raw, ['kind'], 'canvas');
  if (raw.kind !== 'geographic' && raw.kind !== 'static') fail('canvas.kind must be geographic|static');
  return { kind: raw.kind };
}

function parseFloor(raw: unknown, what: string): MapFloor {
  if (!isRecord(raw)) fail(`${what} floor must be an object`);
  checkStrict(raw, ['z', 'label'], `${what} floor`);
  if (!Number.isInteger(raw.z)) fail(`${what} floor.z must be an integer`);
  if (!isNonEmptyString(raw.label)) fail(`${what} floor.label must be a non-empty string`);
  return { z: raw.z as number, label: raw.label as string };
}

function parseIndoorZone(raw: unknown): MapIndoorZone {
  if (!isRecord(raw)) fail('indoorZone must be an object');
  checkStrict(raw, ['id', 'name', 'bounds', 'floors'], 'indoorZone');
  if (!isNonEmptyString(raw.id)) fail('indoorZone.id must be a non-empty string');
  if (!isNonEmptyString(raw.name)) fail('indoorZone.name must be a non-empty string');
  const zone: MapIndoorZone = {
    id: raw.id as string,
    name: raw.name as string,
    floors: [],
  };
  if (raw.bounds !== undefined) zone.bounds = parseRect(raw.bounds, `indoorZone ${raw.id} bounds`);
  if (!Array.isArray(raw.floors) || raw.floors.length < 1) fail(`indoorZone ${raw.id} needs at least one floor`);
  zone.floors = (raw.floors as unknown[]).map((f) => parseFloor(f, `indoorZone ${raw.id}`));
  return zone;
}

function parseBackground(raw: unknown, what: string): MapBackground {
  if (!isRecord(raw)) fail(`${what} background must be an object`);
  checkStrict(raw, ['assetId', 'width', 'height', 'sha256', 'byteLength'], `${what} background`);
  if (!isNonEmptyString(raw.assetId)) fail(`${what} background.assetId must be a non-empty string`);
  if (!Number.isInteger(raw.width) || (raw.width as number) <= 0) fail(`${what} background.width must be a positive integer`);
  if (!Number.isInteger(raw.height) || (raw.height as number) <= 0) fail(`${what} background.height must be a positive integer`);
  if (typeof raw.sha256 !== 'string' || !SHA256_RE.test(raw.sha256)) fail(`${what} background.sha256 must be 64 hex characters`);
  if (!Number.isInteger(raw.byteLength) || (raw.byteLength as number) <= 0) {
    fail(`${what} background.byteLength must be a positive integer`);
  }
  return {
    assetId: raw.assetId as string,
    width: raw.width as number,
    height: raw.height as number,
    sha256: raw.sha256 as string,
    byteLength: raw.byteLength as number,
  };
}

function parseFrame(raw: unknown): MapFrame {
  if (!isRecord(raw)) fail('frame must be an object');
  checkStrict(raw, ['id', 'zoneId', 'z', 'bounds', 'background', 'calibration'], 'frame');
  if (!isNonEmptyString(raw.id)) fail('frame.id must be a non-empty string');
  if (!(raw.zoneId === null || isNonEmptyString(raw.zoneId))) fail(`frame ${raw.id} zoneId must be a string or null`);
  if (!Number.isInteger(raw.z)) fail(`frame ${raw.id} z must be an integer`);
  const frame: MapFrame = {
    id: raw.id as string,
    zoneId: raw.zoneId as string | null,
    z: raw.z as number,
    bounds: parseRect(raw.bounds, `frame ${raw.id} bounds`),
  };
  if (raw.background !== undefined) frame.background = parseBackground(raw.background, `frame ${raw.id}`);
  if (raw.calibration !== undefined) {
    if (!isRecord(raw.calibration)) fail(`frame ${raw.id} calibration must be an object`);
    checkStrict(raw.calibration, ['metersPerPixel'], `frame ${raw.id} calibration`);
    frame.calibration = { metersPerPixel: positiveFinite(raw.calibration.metersPerPixel, `frame ${raw.id} calibration.metersPerPixel`) };
  }
  return frame;
}

function parseNode(raw: unknown): MapNode {
  if (!isRecord(raw)) fail('node must be an object');
  checkStrict(raw, ['id', 'name', 'frameId', 'position', 'zoneId', 'z', 'fingerprintRevision', 'generated', 'visitorVisible'], 'node');
  if (!isNonEmptyString(raw.id)) fail('node.id must be a non-empty string');
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) fail(`node ${raw.id} name must be a non-empty string`);
  if (!isNonEmptyString(raw.frameId)) fail(`node ${raw.id} frameId must be a non-empty string`);
  if (!(raw.zoneId === null || isNonEmptyString(raw.zoneId))) fail(`node ${raw.id} zoneId must be a string or null`);
  if (!Number.isInteger(raw.z)) fail(`node ${raw.id} z must be an integer`);
  if (!Number.isInteger(raw.fingerprintRevision) || (raw.fingerprintRevision as number) < 0) {
    fail(`node ${raw.id} fingerprintRevision must be a non-negative integer`);
  }
  if (raw.generated !== undefined && typeof raw.generated !== 'boolean') fail(`node ${raw.id} generated must be a boolean`);
  if (typeof raw.visitorVisible !== 'boolean') fail(`node ${raw.id} visitorVisible must be a boolean`);
  return {
    id: raw.id as string,
    name: raw.name as string,
    frameId: raw.frameId as string,
    position: parsePosition(raw.position),
    zoneId: raw.zoneId as string | null,
    z: raw.z as number,
    fingerprintRevision: raw.fingerprintRevision as number,
    ...(raw.generated === undefined ? {} : { generated: raw.generated as boolean }),
    visitorVisible: raw.visitorVisible as boolean,
  };
}

function parseEdge(raw: unknown): MapEdge {
  if (!isRecord(raw)) fail('edge must be an object');
  checkStrict(raw, ['from', 'to', 'kind', 'cost', 'meters'], 'edge');
  if (!isNonEmptyString(raw.from)) fail('edge.from must be a non-empty string');
  if (!isNonEmptyString(raw.to)) fail('edge.to must be a non-empty string');
  if (!EDGE_KINDS.includes(raw.kind as (typeof EDGE_KINDS)[number])) {
    fail(`edge ${raw.from}->${raw.to} kind must be one of ${EDGE_KINDS.join('|')}`);
  }
  const edge: MapEdge = {
    from: raw.from as string,
    to: raw.to as string,
    kind: raw.kind as MapEdge['kind'],
    cost: positiveFinite(raw.cost, `edge ${raw.from}->${raw.to} cost`),
  };
  if (raw.meters !== undefined) edge.meters = positiveFinite(raw.meters, `edge ${raw.from}->${raw.to} meters`);
  return edge;
}

function parsePath(raw: unknown): MapPath {
  if (!isRecord(raw)) fail('path must be an object');
  checkStrict(raw, ['id', 'name', 'kind', 'nodeIds', 'controlNodeIds', 'transitionId'], 'path');
  if (!isNonEmptyString(raw.id)) fail('path.id must be a non-empty string');
  if (!isNonEmptyString(raw.name)) fail(`path ${raw.id} name must be a non-empty string`);
  if (raw.kind !== 'regular' && raw.kind !== 'stair') fail(`path ${raw.id} kind must be regular|stair`);
  if (!Array.isArray(raw.nodeIds) || raw.nodeIds.length < 2) fail(`path ${raw.id} nodeIds needs at least two ids`);
  const nodeIds = (raw.nodeIds as unknown[]).map((id) => {
    if (!isNonEmptyString(id)) fail(`path ${raw.id} nodeIds must be non-empty strings`);
    return id as string;
  });
  const path: MapPath = { id: raw.id as string, name: raw.name as string, kind: raw.kind, nodeIds };
  if (raw.transitionId !== undefined) {
    if (!isNonEmptyString(raw.transitionId)) fail(`path ${raw.id} transitionId must be a non-empty string`);
    path.transitionId = raw.transitionId;
  }
  if (raw.controlNodeIds !== undefined) {
    if (!Array.isArray(raw.controlNodeIds) || raw.controlNodeIds.length < 2) {
      fail(`path ${raw.id} controlNodeIds needs at least two ids`);
    }
    path.controlNodeIds = (raw.controlNodeIds as unknown[]).map((id) => {
      if (!isNonEmptyString(id)) fail(`path ${raw.id} controlNodeIds must be non-empty strings`);
      return id as string;
    });
  }
  return path;
}

function parseTransition(raw: unknown): MapTransition {
  if (!isRecord(raw)) fail('transition must be an object');
  checkStrict(raw, ['id', 'name', 'kind', 'nodeIds'], 'transition');
  if (!isNonEmptyString(raw.id)) fail('transition.id must be a non-empty string');
  if (!isNonEmptyString(raw.name)) fail(`transition ${raw.id} name must be a non-empty string`);
  if (raw.kind !== 'entrance' && raw.kind !== 'stair' && raw.kind !== 'elevator') {
    fail(`transition ${raw.id} kind must be entrance|stair|elevator`);
  }
  if (!Array.isArray(raw.nodeIds) || raw.nodeIds.length !== 2 || !isNonEmptyString(raw.nodeIds[0]) || !isNonEmptyString(raw.nodeIds[1])) {
    fail(`transition ${raw.id} nodeIds must be a pair of node ids`);
  }
  return { id: raw.id as string, name: raw.name as string, kind: raw.kind, nodeIds: [raw.nodeIds[0] as string, raw.nodeIds[1] as string] };
}

function parsePlace(raw: unknown): MapPlace {
  if (!isRecord(raw)) fail('place must be an object');
  checkStrict(raw, ['id', 'name', 'zoneId', 'nodeId'], 'place');
  if (!isNonEmptyString(raw.id)) fail('place.id must be a non-empty string');
  if (!isNonEmptyString(raw.name)) fail('place.name must be a non-empty string');
  if (!isNonEmptyString(raw.zoneId)) fail(`place ${raw.id} zoneId must be a non-empty string`);
  if (!isNonEmptyString(raw.nodeId)) fail(`place ${raw.id} nodeId must be a non-empty string`);
  return raw as unknown as MapPlace;
}

function parseAnchor(raw: unknown): MapAnchor {
  if (!isRecord(raw)) fail('anchor must be an object');
  checkStrict(raw, ['id', 'nodeId', 'label'], 'anchor');
  if (!isNonEmptyString(raw.id)) fail('anchor.id must be a non-empty string');
  if (!isNonEmptyString(raw.nodeId)) fail(`anchor ${raw.id} nodeId must be a non-empty string`);
  if (typeof raw.label !== 'string') fail(`anchor ${raw.id} label must be a string`);
  return raw as unknown as MapAnchor;
}

function parseProfile(raw: unknown): MapNodeProfile {
  if (!isRecord(raw)) fail('profile must be an object');
  checkStrict(raw, ['nodeId', 'fingerprintRevision', 'medianRssi', 'scanCount'], 'profile');
  if (!isNonEmptyString(raw.nodeId)) fail('profile.nodeId must be a non-empty string');
  if (!Number.isInteger(raw.fingerprintRevision) || (raw.fingerprintRevision as number) < 0) {
    fail(`profile ${raw.nodeId} fingerprintRevision must be a non-negative integer`);
  }
  if (!isRecord(raw.medianRssi)) fail(`profile ${raw.nodeId} medianRssi must be an object`);
  for (const v of Object.values(raw.medianRssi)) {
    if (typeof v !== 'number' || Number.isNaN(v)) fail(`profile ${raw.nodeId} medianRssi values must be numbers`);
  }
  if (!Number.isInteger(raw.scanCount) || (raw.scanCount as number) < 0) {
    fail(`profile ${raw.nodeId} scanCount must be a non-negative integer`);
  }
  return raw as unknown as MapNodeProfile;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}␟${b}` : `${b}␟${a}`;
}

function transitionIdFor(from: string, to: string): string {
  // Length-prefixed endpoint tuple: unambiguous for arbitrary valid IDs, so
  // ("a-b", "c") and ("a", "b-c") encode differently and decode uniquely.
  return `tr-${from.length}-${from}${to}`;
}

function checkRelations(doc: MapDraft, manifest: boolean): void {
  const kind = doc.canvas.kind;
  // Canvas 'static' uses local coordinates; canvas 'geographic' uses geographic ones.
  const coordKind = kind === 'static' ? 'local' : 'geographic';
  if (doc.boundary !== null && doc.boundary.kind !== coordKind) fail(`${kind} canvas requires a ${coordKind} boundary`);
  doc.indoorZones.forEach((zone) => {
    if (zone.bounds && zone.bounds.kind !== coordKind) fail(`indoorZone ${zone.id} bounds must match the ${kind} canvas`);
  });
  doc.frames.forEach((frame) => {
    if (frame.bounds.kind !== coordKind) fail(`frame ${frame.id} bounds must match the ${kind} canvas`);
  });
  doc.nodes.forEach((node) => {
    if (node.position.kind !== coordKind) fail(`node ${node.id} position must match the ${kind} canvas`);
  });

  for (const [ids, what] of [
    [doc.frames.map((f) => f.id), 'frame'],
    [doc.nodes.map((n) => n.id), 'node'],
    [doc.indoorZones.map((z) => z.id), 'indoorZone'],
    [doc.transitions.map((t) => t.id), 'transition'],
    [doc.paths ? doc.paths.map((p) => p.id) : [], 'path'],
    [doc.places.map((p) => p.id), 'place'],
    [doc.anchors.map((a) => a.id), 'anchor'],
  ] as const) {
    const seen = new Set<string>();
    for (const id of ids as readonly string[]) {
      if (seen.has(id)) fail(`duplicate ${what} id ${id}`);
      seen.add(id);
    }
  }
  doc.indoorZones.forEach((zone) => {
    const seenLevels = new Set<number>();
    for (const floor of zone.floors) {
      if (seenLevels.has(floor.z)) fail(`duplicate floor z ${floor.z} in indoorZone ${zone.id}`);
      seenLevels.add(floor.z);
    }
  });

  const zoneIds = new Set(doc.indoorZones.map((z) => z.id));
  const frameById = new Map(doc.frames.map((f) => [f.id, f]));
  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
  doc.frames.forEach((frame) => {
    if (frame.zoneId !== null && !zoneIds.has(frame.zoneId)) fail(`frame ${frame.id} references unknown zone ${frame.zoneId}`);
  });
  doc.nodes.forEach((node) => {
    const frame = frameById.get(node.frameId);
    if (!frame) fail(`node ${node.id} references unknown frame ${node.frameId}`);
    if (node.zoneId !== frame.zoneId) fail(`node ${node.id} zoneId must match frame ${frame.id} zoneId`);
    if (node.z !== frame.z) fail(`node ${node.id} z must match frame ${frame.id} z`);
    if (node.zoneId !== null && !zoneIds.has(node.zoneId)) fail(`node ${node.id} references unknown zone ${node.zoneId}`);
  });

  const edgeKindByPair = new Map<string, string>();
  doc.edges.forEach((edge) => {
    if (!nodeById.has(edge.from)) fail(`edge ${edge.from}->${edge.to} references unknown node ${edge.from}`);
    if (!nodeById.has(edge.to)) fail(`edge ${edge.from}->${edge.to} references unknown node ${edge.to}`);
    if (edge.from === edge.to) fail(`edge ${edge.from}->${edge.to} must connect two different nodes`);
    const key = pairKey(edge.from, edge.to);
    if (edgeKindByPair.has(key)) fail(`duplicate edge for node pair ${edge.from} ${edge.to}`);
    edgeKindByPair.set(key, edge.kind);
  });

  if (doc.paths) {
    const stairGroups = new Set<string>();
    doc.paths.forEach((path) => {
      path.nodeIds.forEach((id) => {
        if (!nodeById.has(id)) fail(`path ${path.id} references unknown node ${id}`);
      });
      if (path.controlNodeIds) {
        path.controlNodeIds.forEach((id) => {
          if (!nodeById.has(id)) fail(`path ${path.id} references unknown control node ${id}`);
        });
      }
      for (let k = 0; k + 1 < path.nodeIds.length; k++) {
        const a = path.nodeIds[k] as string;
        const b = path.nodeIds[k + 1] as string;
        const hit = edgeKindByPair.get(pairKey(a, b));
        if (!hit) fail(`path ${path.id} has no edge between ${a} and ${b}`);
        else if (path.kind === 'regular' && hit !== 'path') fail(`regular path ${path.id} traverses transition edge ${a} ${b}`);
      }
      if (path.kind === 'stair') {
        const transition = path.transitionId ? doc.transitions.find((item) => item.id === path.transitionId) : undefined;
        if (path.nodeIds.length !== 2 || !transition || transition.kind !== 'stair' ||
            transition.nodeIds[0] !== path.nodeIds[0] || transition.nodeIds[1] !== path.nodeIds[1]) fail(`stair path ${path.id} must reference its matching stair transition and ordered stair landing pair`);
        if (path.transitionId && stairGroups.has(path.transitionId)) fail(`duplicate stair path group for transition ${path.transitionId}`);
        if (path.transitionId) stairGroups.add(path.transitionId);
      } else if (path.transitionId !== undefined) fail(`regular path ${path.id} cannot reference a transition`);
    });
  }

  const transitionKindForEdge: Record<string, string> = { entrance: 'entrance', stairs: 'stair', elevator: 'elevator' };
  const transitionPairs = new Set<string>();
  doc.transitions.forEach((t) => {
    const [a, b] = t.nodeIds;
    if (!nodeById.has(a)) fail(`transition ${t.id} references unknown node ${a}`);
    if (!nodeById.has(b)) fail(`transition ${t.id} references unknown node ${b}`);
    const hit = edgeKindByPair.get(pairKey(a, b));
    const transitionPair = pairKey(a, b);
    if (transitionPairs.has(transitionPair)) fail(`duplicate transition for node pair ${a} ${b}`);
    transitionPairs.add(transitionPair);
    if (!hit || transitionKindForEdge[hit] !== t.kind) {
      fail(`transition ${t.id} must match a ${t.kind} edge between its nodes`);
    }
  });

  doc.places.forEach((p) => {
    if (!zoneIds.has(p.zoneId)) fail(`place ${p.id} references unknown zone ${p.zoneId}`);
    if (!nodeById.has(p.nodeId)) fail(`place ${p.id} references unknown node ${p.nodeId}`);
  });
  doc.anchors.forEach((a) => {
    if (!nodeById.has(a.nodeId)) fail(`anchor ${a.id} references unknown node ${a.nodeId}`);
  });

  if (manifest) {
    const m = doc as MapManifest;
    if (kind === 'geographic' && doc.boundary === null) fail('geographic manifest requires a boundary');
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
      doc.frames.forEach((frame) => {
        if (contentFrames.has(frame.id) && !frame.background) {
          fail(`static frame ${frame.id} with navigable content requires an assigned background`);
        }
      });
    }
    m.profiles.forEach((p) => {
      if (!nodeById.has(p.nodeId)) fail(`profile references unknown node ${p.nodeId}`);
    });
  }
}

const DRAFT_KEYS = [
  'schemaVersion',
  'venueId',
  'canvas',
  'boundary',
  'indoorZones',
  'frames',
  'nodes',
  'edges',
  'paths',
  'transitions',
  'places',
  'anchors',
  'aps',
] as const;

function parseDraftBody(raw: Record<string, unknown>): MapDraft {
  if (typeof raw.venueId !== 'string' || !VENUE_ID_RE.test(raw.venueId)) fail('venueId');
  for (const key of ['indoorZones', 'frames', 'nodes', 'edges', 'transitions', 'places', 'anchors', 'aps'] as const) {
    if (!Array.isArray(raw[key])) fail(`${key} must be an array`);
  }
  const doc: MapDraft = {
    schemaVersion: 5,
    venueId: raw.venueId as string,
    canvas: parseCanvas(raw.canvas),
    boundary: raw.boundary === null ? null : parseRect(raw.boundary, 'boundary'),
    indoorZones: (raw.indoorZones as unknown[]).map(parseIndoorZone),
    frames: (raw.frames as unknown[]).map(parseFrame),
    nodes: (raw.nodes as unknown[]).map(parseNode),
    edges: (raw.edges as unknown[]).map(parseEdge),
    transitions: (raw.transitions as unknown[]).map(parseTransition),
    places: (raw.places as unknown[]).map(parsePlace),
    anchors: (raw.anchors as unknown[]).map(parseAnchor),
    aps: (raw.aps as unknown[]).map((a) => {
      if (typeof a !== 'string') fail('aps must be strings');
      return a;
    }),
  };
  if (raw.paths !== undefined) {
    if (!Array.isArray(raw.paths)) fail('paths must be an array');
    doc.paths = (raw.paths as unknown[]).map(parsePath);
  }
  return doc;
}

export function parseMapDraft(raw: unknown): MapDraft {
  if (!isRecord(raw)) fail('not an object');
  checkStrict(raw, DRAFT_KEYS, 'draft');
  if (raw.schemaVersion !== 5) fail(`unsupported schemaVersion ${String(raw.schemaVersion)}`);
  const doc = parseDraftBody(raw);
  checkRelations(doc, false);
  return doc;
}

const MANIFEST_KEYS = [...DRAFT_KEYS, 'version', 'profiles'] as const;

export function parseMapManifest(raw: unknown): MapManifest {
  if (!isRecord(raw)) fail('not an object');
  checkStrict(raw, MANIFEST_KEYS, 'manifest');
  if (raw.schemaVersion !== 5) fail(`unsupported schemaVersion ${String(raw.schemaVersion)}`);
  const doc = parseDraftBody(raw);
  if (!Number.isInteger(raw.version) || (raw.version as number) < 1) fail('version must be a positive integer');
  if (!Array.isArray(raw.profiles)) fail('profiles must be an array');
  const manifest: MapManifest = {
    ...doc,
    version: raw.version as number,
    profiles: (raw.profiles as unknown[]).map(parseProfile),
  };
  checkRelations(manifest, true);
  return manifest;
}

const TRANSITION_KIND_FOR_EDGE = { entrance: 'entrance', stairs: 'stair', elevator: 'elevator' } as const;

function frameIdFor(zoneId: string | null, z: number): string {
  return zoneId === null ? `frame-outdoor-z${z}` : `frame-${zoneId}-z${z}`;
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
    visitorVisible: node.generated !== true || placeNodeIds.has(node.id),
  }));

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
    cost: edge.meters,
    meters: edge.meters,
  }));

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
        const zValues = new Set(segment.map((id) => nodeById.get(id)?.z).filter((zValue) => zValue !== undefined));
        return zValues.size > 1 ? 'stair' : 'regular';
      };
      if (segments.length === 1) {
        const only = segments[0] as string[];
        const out: MapPath = {
          id: legacy.id,
          name: legacy.name,
          kind: kindFor(only),
          nodeIds: [...only],
        };
        if (legacy.controlNodeIds !== undefined) out.controlNodeIds = [...legacy.controlNodeIds];
        (paths as MapPath[]).push(out);
        continue;
      }
      segments.forEach((segment, index) => {
        const inSegment = new Set(segment);
        const controls = legacy.controlNodeIds?.filter((id) => inSegment.has(id));
        const out: MapPath = {
          id: `${legacy.id}#${index + 1}`,
          name: `${legacy.name} (${index + 1} of ${segments.length})`,
          kind: kindFor(segment),
          nodeIds: [...segment],
        };
        if (controls !== undefined && controls.length >= 2) out.controlNodeIds = controls;
        (paths as MapPath[]).push(out);
      });
    }
  }

  const upgraded: MapDraft = {
    schemaVersion: 5,
    venueId: v4.venueId,
    canvas: { kind: 'geographic' },
    boundary: v4.boundary ? { kind: 'geographic', ...v4.boundary } : null,
    indoorZones: v4.indoorZones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      bounds: { kind: 'geographic', ...zone.bounds },
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
