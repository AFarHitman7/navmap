// v3 unified geographic contract (mirrors backend draftV3Schema, no shared package).
//
// NOTE: navmap-mobile has no zod dependency, so this module hand-rolls the
// same structural checks as the backend zod schemas in
// navmap-backend/src/draft.ts (draftV3Schema). Field names, ranges, strict
// (unknown-key) rejection and bounds-ordering rules match. Pure TS, no Node
// APIs (Hermes-compatible).

export type BoundsV3 = { north: number; south: number; east: number; west: number };
export type FloorV3 = { z: number; label: string };
export type IndoorZoneV3 = { id: string; name: string; bounds: BoundsV3; floors: FloorV3[] };
export type NodeV3 = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  z: number;
  zoneId: string | null;
  fingerprintRevision: number;
  generated?: boolean;
};
export type EdgeV3 = { from: string; to: string; meters: number; kind: 'path' | 'entrance' | 'stairs' | 'elevator' };
export type PlaceV3 = { id: string; name: string; zoneId: string; nodeId: string };
export type AnchorV3 = { id: string; nodeId: string; label: string };
export type PathV3 = { id: string; name: string; nodeIds: string[]; controlNodeIds?: string[] };
// Positioning profiles attach to geographic nodes.
export type NodeProfileV3 = { nodeId: string; fingerprintRevision?: number; medianRssi: Record<string, number>; scanCount: number };

export type DraftV3 = {
  schemaVersion: 4;
  venueId: string;
  boundary: BoundsV3 | null;
  indoorZones: IndoorZoneV3[];
  nodes: NodeV3[];
  edges: EdgeV3[];
  places: PlaceV3[];
  anchors: AnchorV3[];
  aps: string[];
  paths?: PathV3[];
};

// Manifest = draft + published version, non-null boundary, node profiles.
export type ManifestV3 = Omit<DraftV3, 'boundary'> & {
  version: number;
  boundary: BoundsV3;
  profiles: NodeProfileV3[];
};

const VENUE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const EDGE_KINDS = ['path', 'entrance', 'stairs', 'elevator'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(msg: string): never {
  throw new Error(`draftV3: ${msg}`);
}

function checkStrict(obj: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) fail(`${what} has unknown key ${k}`);
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isNonBlankString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function parseBounds(raw: unknown, what: string): BoundsV3 {
  if (!isRecord(raw)) fail(`${what} bounds must be an object`);
  checkStrict(raw, ['north', 'south', 'east', 'west'], `${what} bounds`);
  for (const k of ['north', 'south', 'east', 'west'] as const) {
    if (typeof raw[k] !== 'number' || Number.isNaN(raw[k])) fail(`${what} bounds.${k} must be a number`);
  }
  const b = raw as unknown as BoundsV3;
  if (!(b.north > b.south && b.east > b.west)) {
    fail(`${what} bounds must span north>south and east>west`);
  }
  return { north: b.north, south: b.south, east: b.east, west: b.west };
}

function parseFloor(raw: unknown, what: string): FloorV3 {
  if (!isRecord(raw)) fail(`${what} floor must be an object`);
  checkStrict(raw, ['z', 'label'], `${what} floor`);
  if (!Number.isInteger(raw.z)) fail(`${what} floor.z must be an integer`);
  if (!isNonEmptyString(raw.label)) fail(`${what} floor.label must be a non-empty string`);
  return { z: raw.z as number, label: raw.label as string };
}

function parseIndoorZone(raw: unknown): IndoorZoneV3 {
  if (!isRecord(raw)) fail('indoorZone must be an object');
  checkStrict(raw, ['id', 'name', 'bounds', 'floors'], 'indoorZone');
  if (!isNonEmptyString(raw.id)) fail('indoorZone.id must be a non-empty string');
  if (!isNonEmptyString(raw.name)) fail('indoorZone.name must be a non-empty string');
  const bounds = parseBounds(raw.bounds, `indoorZone ${raw.id}`);
  if (!Array.isArray(raw.floors) || raw.floors.length < 1) fail(`indoorZone ${raw.id} needs at least one floor`);
  const floors = raw.floors.map((f) => parseFloor(f, `indoorZone ${raw.id}`));
  return { id: raw.id, name: raw.name, bounds, floors };
}

function parseNode(raw: unknown): NodeV3 {
  if (!isRecord(raw)) fail('node must be an object');
  checkStrict(raw, ['id', 'name', 'lat', 'lng', 'z', 'zoneId', 'fingerprintRevision', 'generated'], 'node');
  if (!isNonEmptyString(raw.id)) fail('node.id must be a non-empty string');
  if (!isNonBlankString(raw.name)) fail(`node ${raw.id} name must be a non-empty string`);
  if (typeof raw.lat !== 'number' || Number.isNaN(raw.lat) || raw.lat < -90 || raw.lat > 90) {
    fail(`node ${raw.id} lat must be within [-90, 90]`);
  }
  if (typeof raw.lng !== 'number' || Number.isNaN(raw.lng) || raw.lng < -180 || raw.lng > 180) {
    fail(`node ${raw.id} lng must be within [-180, 180]`);
  }
  if (!Number.isInteger(raw.z)) fail(`node ${raw.id} z must be an integer`);
  if (!(raw.zoneId === null || isNonEmptyString(raw.zoneId))) fail(`node ${raw.id} zoneId must be a string or null`);
  if (!Number.isInteger(raw.fingerprintRevision) || (raw.fingerprintRevision as number) < 0) {
    fail(`node ${raw.id} fingerprintRevision must be a non-negative integer`);
  }
  if (raw.generated !== undefined && typeof raw.generated !== 'boolean') fail(`node ${raw.id} generated must be a boolean`);
  return {
    id: raw.id,
    name: raw.name,
    lat: raw.lat,
    lng: raw.lng,
    z: raw.z,
    zoneId: raw.zoneId,
    fingerprintRevision: raw.fingerprintRevision,
    ...(raw.generated === undefined ? {} : { generated: raw.generated }),
  } as NodeV3;
}

function parseEdge(raw: unknown): EdgeV3 {
  if (!isRecord(raw)) fail('edge must be an object');
  checkStrict(raw, ['from', 'to', 'meters', 'kind'], 'edge');
  if (!isNonEmptyString(raw.from)) fail('edge.from must be a non-empty string');
  if (!isNonEmptyString(raw.to)) fail('edge.to must be a non-empty string');
  if (typeof raw.meters !== 'number' || !(raw.meters > 0)) fail(`edge ${raw.from}->${raw.to} meters must be positive`);
  if (!EDGE_KINDS.includes(raw.kind as (typeof EDGE_KINDS)[number])) {
    fail(`edge ${raw.from}->${raw.to} kind must be one of ${EDGE_KINDS.join('|')}`);
  }
  return raw as unknown as EdgeV3;
}

function parsePlace(raw: unknown): PlaceV3 {
  if (!isRecord(raw)) fail('place must be an object');
  checkStrict(raw, ['id', 'name', 'zoneId', 'nodeId'], 'place');
  if (!isNonEmptyString(raw.id)) fail('place.id must be a non-empty string');
  if (!isNonEmptyString(raw.name)) fail('place.name must be a non-empty string');
  if (!isNonEmptyString(raw.zoneId)) fail(`place ${raw.id} zoneId must be a non-empty string`);
  if (!isNonEmptyString(raw.nodeId)) fail(`place ${raw.id} nodeId must be a non-empty string`);
  return raw as unknown as PlaceV3;
}

function parseAnchor(raw: unknown): AnchorV3 {
  if (!isRecord(raw)) fail('anchor must be an object');
  checkStrict(raw, ['id', 'nodeId', 'label'], 'anchor');
  if (!isNonEmptyString(raw.id)) fail('anchor.id must be a non-empty string');
  if (!isNonEmptyString(raw.nodeId)) fail(`anchor ${raw.id} nodeId must be a non-empty string`);
  if (typeof raw.label !== 'string') fail(`anchor ${raw.id} label must be a string`);
  return raw as unknown as AnchorV3;
}

function parsePath(raw: unknown): PathV3 {
  if (!isRecord(raw)) fail('path must be an object');
  checkStrict(raw, ['id', 'name', 'nodeIds', 'controlNodeIds'], 'path');
  if (!isNonEmptyString(raw.id)) fail('path.id must be a non-empty string');
  if (!isNonEmptyString(raw.name)) fail(`path ${raw.id} name must be a non-empty string`);
  if (!Array.isArray(raw.nodeIds) || raw.nodeIds.length < 2) fail(`path ${raw.id} nodeIds needs at least two ids`);
  const nodeIds = raw.nodeIds.map((nodeId) => {
    if (!isNonEmptyString(nodeId)) fail(`path ${raw.id} nodeIds must be non-empty strings`);
    return nodeId;
  });
  if (raw.controlNodeIds === undefined) return { id: raw.id, name: raw.name, nodeIds };
  if (!Array.isArray(raw.controlNodeIds) || raw.controlNodeIds.length < 2) fail(`path ${raw.id} controlNodeIds needs at least two ids`);
  const controlNodeIds = raw.controlNodeIds.map((nodeId) => {
    if (!isNonEmptyString(nodeId)) fail(`path ${raw.id} controlNodeIds must be non-empty strings`);
    return nodeId;
  });
  return { id: raw.id, name: raw.name, nodeIds, controlNodeIds };
}

function parseNodeProfile(raw: unknown): NodeProfileV3 {
  if (!isRecord(raw)) fail('profile must be an object');
  checkStrict(raw, ['nodeId', 'fingerprintRevision', 'medianRssi', 'scanCount'], 'profile');
  if (!isNonEmptyString(raw.nodeId)) fail('profile.nodeId must be a non-empty string');
  if (raw.fingerprintRevision !== undefined && !Number.isInteger(raw.fingerprintRevision)) {
    fail(`profile ${raw.nodeId} fingerprintRevision must be an integer`);
  }
  if (!isRecord(raw.medianRssi)) fail(`profile ${raw.nodeId} medianRssi must be an object`);
  for (const v of Object.values(raw.medianRssi)) {
    if (typeof v !== 'number' || Number.isNaN(v)) fail(`profile ${raw.nodeId} medianRssi values must be numbers`);
  }
  if (typeof raw.scanCount !== 'number' || Number.isNaN(raw.scanCount)) {
    fail(`profile ${raw.nodeId} scanCount must be a number`);
  }
  return raw as unknown as NodeProfileV3;
}

function parseDraftBody(raw: Record<string, unknown>): Omit<DraftV3, 'boundary'> & { boundary: BoundsV3 | null } {
  if (typeof raw.venueId !== 'string' || !VENUE_ID_RE.test(raw.venueId)) {
    fail('venueId');
  }
  for (const [key, what] of [
    ['indoorZones', 'indoorZones'],
    ['nodes', 'nodes'],
    ['edges', 'edges'],
    ['places', 'places'],
    ['anchors', 'anchors'],
    ['aps', 'aps'],
  ] as const) {
    if (!Array.isArray(raw[key])) fail(what);
  }
  const body: Omit<DraftV3, 'boundary'> & { boundary: BoundsV3 | null } = {
    schemaVersion: 4,
    venueId: raw.venueId as string,
    boundary: null, // replaced by caller
    indoorZones: (raw.indoorZones as unknown[]).map(parseIndoorZone),
    nodes: (raw.nodes as unknown[]).map(parseNode),
    edges: (raw.edges as unknown[]).map(parseEdge),
    places: (raw.places as unknown[]).map(parsePlace),
    anchors: (raw.anchors as unknown[]).map(parseAnchor),
    aps: (raw.aps as unknown[]).map((a) => {
      if (typeof a !== 'string') fail('aps must be strings');
      return a;
    }),
  };
  if (raw.paths !== undefined) {
    if (!Array.isArray(raw.paths)) fail('paths');
    return { ...body, paths: (raw.paths as unknown[]).map(parsePath) };
  }
  return body;
}

const DRAFT_KEYS = ['schemaVersion', 'venueId', 'boundary', 'indoorZones', 'nodes', 'edges', 'places', 'anchors', 'aps', 'paths'] as const;

export function parseDraftV3(raw: unknown): DraftV3 {
  if (!isRecord(raw)) fail('not an object');
  checkStrict(raw, DRAFT_KEYS, 'draft');
  if (raw.schemaVersion !== 4) fail(`unsupported schemaVersion ${String(raw.schemaVersion)}`);
  const body = parseDraftBody(raw);
  if (raw.boundary !== null) {
    // boundary may be absent-key? No: strict schema requires the key; null allowed.
    body.boundary = parseBounds(raw.boundary, 'boundary');
  }
  return { ...body, boundary: body.boundary };
}

const MANIFEST_KEYS = [...DRAFT_KEYS, 'version', 'profiles'] as const;

export function parseManifestV3(raw: unknown): ManifestV3 {
  if (!isRecord(raw)) fail('not an object');
  checkStrict(raw, MANIFEST_KEYS, 'manifest');
  if (raw.schemaVersion !== 4) fail(`unsupported schemaVersion ${String(raw.schemaVersion)}`);
  const body = parseDraftBody(raw);
  if (!Number.isInteger(raw.version) || (raw.version as number) < 1) fail('version must be a positive integer');
  if (raw.boundary === null || raw.boundary === undefined) fail('manifest boundary must be non-null');
  const boundary = parseBounds(raw.boundary, 'boundary');
  if (!Array.isArray(raw.profiles)) fail('profiles');
  const profiles = (raw.profiles as unknown[]).map(parseNodeProfile);
  return { ...body, boundary, version: raw.version as number, profiles };
}
