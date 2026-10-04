import {
  indoorZoneV3Schema,
  type BoundsV3,
  type DraftV3,
  type EdgeV3,
  type FloorV3,
  type NodeV3,
  type PlaceV3,
} from '../contract-v3';
import { containsBounds, containsPoint, distanceMeters, rectsOverlap } from '../geo-v3';
import { isGroupedPathNode, movePathNode } from './paths';

export function emptyDraftV3(venueId = 'demo'): DraftV3 {
  return {
    schemaVersion: 4,
    venueId,
    boundary: null,
    indoorZones: [],
    nodes: [],
    edges: [],
    places: [],
    anchors: [],
    aps: [],
  };
}

export function nextNodeId(draft: DraftV3): string {
  let i = 1;
  const ids = new Set(draft.nodes.map((n) => n.id));
  while (ids.has(`n-${i}`)) i++;
  return `n-${i}`;
}

export function nextPlaceId(draft: DraftV3): string {
  let i = 1;
  const ids = new Set(draft.places.map((p) => p.id));
  while (ids.has(`p-${i}`)) i++;
  return `p-${i}`;
}

function slug(name: string): string {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'zone';
}

function nextZoneId(draft: DraftV3, name: string): string {
  const base = `b-${slug(name)}`;
  if (!draft.indoorZones.some((z) => z.id === base)) return base;
  let i = 2;
  while (draft.indoorZones.some((z) => z.id === `${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function requireBoundary(draft: DraftV3): BoundsV3 {
  if (!draft.boundary) throw new Error('Draw the outdoor boundary first');
  return draft.boundary;
}

/**
 * Redraw the outdoor boundary. Positions never move: every zone and node
 * keeps its lat/lng, and the edit is rejected while anything falls outside.
 */
export function setBoundary(draft: DraftV3, boundary: BoundsV3): DraftV3 {
  if (!(boundary.north > boundary.south && boundary.east > boundary.west)) {
    throw new Error('Boundary needs valid bounds');
  }
  const outsideZones = draft.indoorZones.filter((z) => !containsBounds(boundary, z.bounds));
  const outsideNodes = draft.nodes.filter((n) => !containsPoint(boundary, n.lat, n.lng));
  const excluded = [...outsideZones.map((z) => z.name), ...outsideNodes.map((n) => n.id)];
  if (excluded.length) {
    throw new Error(`Boundary excludes ${excluded.join(', ')}. Draw a larger rectangle or move those points first.`);
  }
  return { ...draft, boundary };
}

function requireZone(draft: DraftV3, zoneId: string) {
  const zone = draft.indoorZones.find((z) => z.id === zoneId);
  if (!zone) throw new Error(`Unknown zone ${zoneId}`);
  return zone;
}

function requireNode(draft: DraftV3, id: string): NodeV3 {
  const node = draft.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`Unknown node ${id}`);
  return node;
}

function requirePlace(draft: DraftV3, id: string): PlaceV3 {
  const place = draft.places.find((p) => p.id === id);
  if (!place) throw new Error(`Unknown place ${id}`);
  return place;
}

function requireIndoorPlaceNode(draft: DraftV3, nodeId: string): NodeV3 & { zoneId: string } {
  const node = requireNode(draft, nodeId);
  if (node.zoneId === null) throw new Error('Place must be assigned to an indoor node');
  const zone = requireZone(draft, node.zoneId);
  if (!containsPoint(zone.bounds, node.lat, node.lng)) throw new Error(`Node ${node.id} does not match zone ${zone.id}`);
  if (!zone.floors.some((f) => f.z === node.z)) throw new Error(`Zone ${zone.name} has no floor ${node.z}`);
  return node as NodeV3 & { zoneId: string };
}

function validateNodeLocation(draft: DraftV3, lat: number, lng: number, zoneId: string | null | undefined, z: number | undefined) {
  const boundary = requireBoundary(draft);
  if (!containsPoint(boundary, lat, lng)) throw new Error('Nodes must be inside the outdoor boundary');
  const resolved = zoneId === undefined ? zoneMembership(draft, lat, lng) : zoneId;
  let floor = z;
  if (resolved === null) {
    if (floor !== undefined && floor !== 0) throw new Error('Outdoor points use the ground level');
    floor = 0;
  } else {
    const zone = requireZone(draft, resolved);
    if (!containsPoint(zone.bounds, lat, lng)) throw new Error(`Point is outside zone ${zone.name}`);
    floor ??= Math.min(...zone.floors.map((f) => f.z));
    if (!zone.floors.some((f) => f.z === floor)) throw new Error(`Zone ${zone.name} has no floor ${floor}`);
  }
  return { zoneId: resolved, z: floor };
}

/** Geographic membership of a point: innermost zone id, or null for outdoors. */
export function zoneMembership(draft: DraftV3, lat: number, lng: number): string | null {
  for (const zone of draft.indoorZones) {
    if (containsPoint(zone.bounds, lat, lng)) return zone.id;
  }
  return null;
}

export function addZone(
  draft: DraftV3,
  zone: { name: string; bounds: BoundsV3; floors?: FloorV3[] },
): DraftV3 {
  const boundary = requireBoundary(draft);
  const name = zone.name.trim();
  if (!name) throw new Error('Zone name is required');
  const floors = zone.floors ?? [{ z: 0, label: 'Ground' }];
  const parsed = indoorZoneV3Schema.parse({ id: 'tmp', name, bounds: zone.bounds, floors });
  if (!containsBounds(boundary, parsed.bounds)) throw new Error(`Zone ${name} is outside the outdoor boundary`);
  for (const other of draft.indoorZones) {
    if (rectsOverlap(other.bounds, parsed.bounds)) throw new Error(`Zone ${name} overlaps ${other.name}`);
  }
  return { ...draft, indoorZones: [...draft.indoorZones, { ...parsed, id: nextZoneId(draft, name) }] };
}

export function renameZone(draft: DraftV3, zoneId: string, name: string): DraftV3 {
  requireZone(draft, zoneId);
  const clean = name.trim();
  if (!clean) throw new Error('Zone name is required');
  return { ...draft, indoorZones: draft.indoorZones.map((z) => (z.id === zoneId ? { ...z, name: clean } : z)) };
}

export function setZoneBounds(draft: DraftV3, zoneId: string, bounds: BoundsV3): DraftV3 {
  const boundary = requireBoundary(draft);
  const zone = requireZone(draft, zoneId);
  if (!(bounds.north > bounds.south && bounds.east > bounds.west)) {
    throw new Error(`Zone ${zone.name} needs valid bounds`);
  }
  if (!containsBounds(boundary, bounds)) throw new Error(`Zone ${zone.name} is outside the outdoor boundary`);
  for (const other of draft.indoorZones) {
    if (other.id !== zoneId && rectsOverlap(other.bounds, bounds)) {
      throw new Error(`Zone ${zone.name} overlaps ${other.name}`);
    }
  }
  const excluded = draft.nodes.filter((n) => n.zoneId === zoneId && !containsPoint(bounds, n.lat, n.lng));
  if (excluded.length) {
    throw new Error(`Resizing excludes ${excluded.map((n) => n.id).join(', ')}. Move those points first.`);
  }
  return { ...draft, indoorZones: draft.indoorZones.map((z) => (z.id === zoneId ? { ...z, bounds } : z)) };
}

export function removeZone(
  draft: DraftV3,
  zoneId: string,
  opts?: { nodes: 'delete'; edges: 'delete' },
): DraftV3 {
  const zone = requireZone(draft, zoneId);
  const zoned = draft.nodes.filter((n) => n.zoneId === zoneId);
  if (zoned.length && !(opts?.nodes === 'delete' && opts?.edges === 'delete')) {
    throw new Error(`Zone ${zone.name} still has points. Reassign or delete them first.`);
  }
  const doomed = new Set(zoned.map((n) => n.id));
  for (const p of draft.places) {
    if (doomed.has(p.nodeId)) throw new Error(`Delete the place ${p.name} first`);
  }
  for (const a of draft.anchors) {
    if (doomed.has(a.nodeId)) throw new Error(`Delete the anchor ${a.label} first`);
  }
  return {
    ...draft,
    indoorZones: draft.indoorZones.filter((z) => z.id !== zoneId),
    nodes: draft.nodes.filter((n) => n.zoneId !== zoneId),
    edges: draft.edges.filter((e) => !doomed.has(e.from) && !doomed.has(e.to)),
  };
}

export function addNodeAt(draft: DraftV3, lat: number, lng: number, zoneId?: string | null, z?: number): DraftV3 {
  const id = nextNodeId(draft);
  const resolved = validateNodeLocation(draft, lat, lng, zoneId, z);
  return {
    ...draft,
    nodes: [...draft.nodes, { id, name: `Node ${id}`, lat, lng, z: resolved.z, zoneId: resolved.zoneId, fingerprintRevision: 1 }],
  };
}

export function renameNode(draft: DraftV3, id: string, name: string): DraftV3 {
  requireNode(draft, id);
  const clean = name.trim();
  if (!clean) throw new Error('Node name is required');
  return { ...draft, nodes: draft.nodes.map((n) => (n.id === id ? { ...n, name: clean } : n)) };
}

export function updateNodeLocation(
  draft: DraftV3,
  id: string,
  lat: number,
  lng: number,
  zoneId?: string | null,
  z?: number,
): DraftV3 {
  if (isGroupedPathNode(draft, id)) return movePathNode(draft, id, { lat, lng, zoneId: zoneId ?? zoneMembership(draft, lat, lng), z: z ?? requireNode(draft, id).z });
  requireNode(draft, id);
  const resolved = validateNodeLocation(draft, lat, lng, zoneId, z);
  const linkedPlace = draft.places.find((p) => p.nodeId === id);
  if (linkedPlace && resolved.zoneId === null) {
    throw new Error(`Delete or reassign the place ${linkedPlace.name} before moving this node outdoors`);
  }
  return bumpRevision({
    ...draft,
    nodes: draft.nodes.map((n) => (n.id === id ? { ...n, lat, lng, zoneId: resolved.zoneId, z: resolved.z } : n)),
    places: draft.places.map((p) => (p.nodeId === id && resolved.zoneId !== null ? { ...p, zoneId: resolved.zoneId } : p)),
  }, id);
}

export function moveNode(draft: DraftV3, id: string, lat: number, lng: number): DraftV3 {
  if (isGroupedPathNode(draft, id)) {
    const node = requireNode(draft, id);
    return movePathNode(draft, id, { lat, lng, zoneId: node.zoneId, z: node.z });
  }
  const boundary = requireBoundary(draft);
  if (!draft.nodes.some((n) => n.id === id)) throw new Error(`Unknown node ${id}`);
  if (!containsPoint(boundary, lat, lng)) throw new Error('Nodes must be inside the outdoor boundary');
  return bumpRevision({ ...draft, nodes: draft.nodes.map((n) => (n.id === id ? { ...n, lat, lng } : n)) }, id);
}

/** Where would this point belong? Used to preview a move across a zone edge. */
export function previewMove(draft: DraftV3, lat: number, lng: number): string | null {
  if (draft.boundary && !containsPoint(draft.boundary, lat, lng)) return 'outside';
  return zoneMembership(draft, lat, lng);
}

export function setNodeFloor(draft: DraftV3, id: string, z: number): DraftV3 {
  const node = requireNode(draft, id);
  if (isGroupedPathNode(draft, id)) return movePathNode(draft, id, { lat: node.lat, lng: node.lng, zoneId: node.zoneId, z });
  if (node.zoneId === null) {
    if (z !== 0) throw new Error('Outdoor points use the ground level');
  } else {
    const zone = requireZone(draft, node.zoneId);
    if (!zone.floors.some((f) => f.z === z)) throw new Error(`Zone ${zone.name} has no floor ${z}`);
  }
  return bumpRevision({ ...draft, nodes: draft.nodes.map((n) => (n.id === id ? { ...n, z } : n)) }, id);
}

export function bumpRevision(draft: DraftV3, id: string): DraftV3 {
  requireNode(draft, id);
  return {
    ...draft,
    nodes: draft.nodes.map((n) => (n.id === id ? { ...n, fingerprintRevision: n.fingerprintRevision + 1 } : n)),
  };
}

export function addPlaceToNode(draft: DraftV3, nodeId: string, name: string): DraftV3 {
  const clean = name.trim();
  if (!clean) throw new Error('Place name is required');
  const node = requireIndoorPlaceNode(draft, nodeId);
  if (draft.places.some((p) => p.nodeId === nodeId)) throw new Error(`Node ${nodeId} already has a place`);
  return { ...draft, places: [...draft.places, { id: nextPlaceId(draft), name: clean, zoneId: node.zoneId, nodeId }] };
}

export function editPlace(draft: DraftV3, id: string, updates: { name?: string; nodeId?: string }): DraftV3 {
  const place = requirePlace(draft, id);
  let name = place.name;
  if (updates.name !== undefined) {
    name = updates.name.trim();
    if (!name) throw new Error('Place name is required');
  }
  let nodeId = place.nodeId;
  let zoneId = place.zoneId;
  if (updates.nodeId !== undefined) {
    const node = requireIndoorPlaceNode(draft, updates.nodeId);
    if (draft.places.some((p) => p.id !== id && p.nodeId === updates.nodeId)) {
      throw new Error(`Node ${updates.nodeId} already has a place`);
    }
    nodeId = updates.nodeId;
    zoneId = node.zoneId;
  }
  return { ...draft, places: draft.places.map((p) => (p.id === id ? { ...p, name, nodeId, zoneId } : p)) };
}

export function removePlace(draft: DraftV3, id: string): DraftV3 {
  requirePlace(draft, id);
  return { ...draft, places: draft.places.filter((p) => p.id !== id) };
}

type EdgeKind = EdgeV3['kind'];

function inferKind(draft: DraftV3, fromId: string, toId: string, explicit?: EdgeKind): EdgeKind {
  if (explicit) return explicit;
  const from = draft.nodes.find((n) => n.id === fromId)!;
  const to = draft.nodes.find((n) => n.id === toId)!;
  if ((from.zoneId ?? null) === (to.zoneId ?? null) && from.z === to.z) return 'path';
  if ((from.zoneId === null) !== (to.zoneId === null)) return 'entrance';
  throw new Error('Choose stairs or elevator for connections between floors');
}

export function connectNodes(
  draft: DraftV3,
  from: string,
  to: string,
  kind?: EdgeKind,
  meters?: number,
): DraftV3 {
  const fromNode = draft.nodes.find((n) => n.id === from);
  const toNode = draft.nodes.find((n) => n.id === to);
  if (!fromNode || !toNode) throw new Error('Choose two existing points and a positive distance');
  if (from === to) throw new Error('Choose two different points');
  const resolved = inferKind(draft, from, to, kind);
  if (draft.edges.some((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from))) {
    throw new Error('Those points are already connected');
  }
  if (resolved === 'path' && ((fromNode.zoneId ?? null) !== (toNode.zoneId ?? null) || fromNode.z !== toNode.z)) {
    throw new Error('Path connections must stay in the same zone and floor');
  }
  if (resolved === 'entrance') {
    const outdoorIndoor = (fromNode.zoneId === null) !== (toNode.zoneId === null);
    if (!outdoorIndoor) throw new Error('Entrance connections must join outdoors to a building');
    const indoor = fromNode.zoneId === null ? toNode : fromNode;
    if (indoor.z !== 0) throw new Error('Entrances must land on the ground floor');
  }
  if ((resolved === 'stairs' || resolved === 'elevator') && (fromNode.zoneId === null || fromNode.zoneId !== toNode.zoneId || fromNode.z === toNode.z)) {
    throw new Error('Stairs and elevators must stay within one building across floors');
  }
  const length =
    meters ??
    (fromNode.z === toNode.z
      ? distanceMeters(fromNode.lat, fromNode.lng, toNode.lat, toNode.lng)
      : Math.abs(toNode.z - fromNode.z) * 4);
  if (!Number.isFinite(length) || length <= 0) throw new Error('Choose two existing points and a positive distance');
  return { ...draft, edges: [...draft.edges, { from, to, meters: length, kind: resolved }] };
}

export function disconnectNodes(draft: DraftV3, from: string, to: string): DraftV3 {
  return {
    ...draft,
    edges: draft.edges.filter((e) => !((e.from === from && e.to === to) || (e.from === to && e.to === from))),
  };
}

export function removeNode(draft: DraftV3, id: string): DraftV3 {
  if (isGroupedPathNode(draft, id)) throw new Error('This point is still part of a drawn path; delete its path first.');
  const place = draft.places.find((p) => p.nodeId === id);
  if (place) throw new Error(`Delete the place ${place.name} on this point first`);
  const anchor = draft.anchors.find((a) => a.nodeId === id);
  if (anchor) throw new Error(`Delete the anchor ${anchor.label} on this point first`);
  if (!draft.nodes.some((n) => n.id === id)) throw new Error(`Unknown node ${id}`);
  return {
    ...draft,
    nodes: draft.nodes.filter((n) => n.id !== id),
    edges: draft.edges.filter((e) => e.from !== id && e.to !== id),
  };
}

export function addFloor(draft: DraftV3, zoneId: string, floor: FloorV3): DraftV3 {
  const zone = requireZone(draft, zoneId);
  if (!Number.isInteger(floor.z)) throw new Error('Floor index must be an integer');
  if (!floor.label.trim()) throw new Error('Floor label is required');
  if (zone.floors.some((f) => f.z === floor.z)) throw new Error(`Zone ${zone.name} already has floor ${floor.z}`);
  return {
    ...draft,
    indoorZones: draft.indoorZones.map((z) =>
      z.id === zoneId ? { ...z, floors: [...z.floors, floor].sort((a, b) => a.z - b.z) } : z,
    ),
  };
}

export function removeFloor(draft: DraftV3, zoneId: string, z: number): DraftV3 {
  const zone = requireZone(draft, zoneId);
  if (!zone.floors.some((f) => f.z === z)) throw new Error(`Zone ${zone.name} has no floor ${z}`);
  if (zone.floors.length <= 1) throw new Error(`Zone ${zone.name} needs at least one floor`);
  const occupants = draft.nodes.filter((n) => n.zoneId === zoneId && n.z === z);
  if (occupants.length) {
    throw new Error(`Floor ${z} still has ${occupants.map((n) => n.id).join(', ')}. Move those points first.`);
  }
  return {
    ...draft,
    indoorZones: draft.indoorZones.map((item) =>
      item.id === zoneId ? { ...item, floors: item.floors.filter((f) => f.z !== z) } : item,
    ),
  };
}

/** Lightweight UI hints; the server publish is authoritative. */
export function publicationChecks(draft: DraftV3): string[] {
  if (!draft.boundary) return ['Draw the outdoor boundary first'];
  return [];
}
