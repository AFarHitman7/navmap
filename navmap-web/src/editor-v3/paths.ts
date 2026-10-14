import type { DraftV3, EdgeV3, NodeV3, PathV3 } from '../contract-v3';
import { containsPoint, distanceMeters } from '../geo-v3';
import { parseMapDraft, type MapDraft, type MapEdge, type MapFrame, type MapNode, type Position } from '../map-contract';
import { assertSampleBudget, segmentMetrics, transitionMetrics } from '../map-geometry';
import { intersectLocalSegments, intersectSegments, sameLocalPoint, subdivideSegment, type GeoPoint } from './path-geometry';
import { containsPosition } from '../map-geometry';

export type PathVertex = {
  lat: number;
  lng: number;
  zoneId: string | null;
  z: number;
  nodeId?: string;
  incomingKind?: 'path' | 'stairs';
};

type WorkDraft = DraftV3 & { paths: PathV3[] };
type OrdinarySegment = { from: string; to: string; a: NodeV3; b: NodeV3 };
type RecoveredControl = { nodeId: string; pathIndex: number; incomingKind?: 'path' | 'stairs' };

const EPS = 1e-12;

export function isGroupedPathNode(draft: DraftV3, id: string): boolean {
  return (draft.paths ?? []).some((path) => path.nodeIds.includes(id));
}

export function addDrawnPath(draft: DraftV3, vertices: PathVertex[], name?: string): DraftV3 {
  if (vertices.length < 2) throw new Error('Path needs at least two points');
  const work = cloneDraft(draft);
  const pathId = randomId();
  const pathName = name?.trim() || `Path ${(work.paths?.length ?? 0) + 1}`;
  const nodeIds: string[] = [];
  const controlNodeIds: string[] = [];

  const resolved = vertices.map((vertex) => resolveVertex(work, vertex));
  for (let i = 1; i < resolved.length; i++) {
    const kind = vertices[i]!.incomingKind ?? 'path';
    validateConnection(resolved[i - 1]!, resolved[i]!, kind);
    if (kind === 'path') validateOrdinarySegmentMembership(work, resolved[i - 1]!, resolved[i]!);
  }

  let previous = ensureNode(work, resolved[0]!);
  nodeIds.push(previous.id);
  controlNodeIds.push(previous.id);

  for (let i = 1; i < resolved.length; i++) {
    const currentVertex = resolved[i]!;
    const kind = vertices[i]!.incomingKind ?? 'path';
    const current = ensureNode(work, currentVertex);
    controlNodeIds.push(current.id);
    if (kind === 'stairs') {
      if (findEdge(work, previous.id, current.id)) throw new Error('Cannot create stairs over an existing transition connection; delete the existing connection first.');
      addUniqueEdge(work, previous.id, current.id, 'stairs', stairLength(previous, current));
      nodeIds.push(current.id);
    } else {
      rejectOverlapWithOrdinarySegments(work, previous, current);
      const points = subdivideSegment(previous, current).slice(1);
      let from = previous;
      for (const point of points) {
        const target = ensureNode(work, { ...currentVertex, lat: point.lat, lng: point.lng, nodeId: samePoint(point, current) ? current.id : undefined }, false);
        const chain = addOrdinarySegment(work, from, target, nodeIds);
        appendChain(nodeIds, chain);
        from = target;
      }
    }
    previous = current;
  }

  work.paths = [...work.paths, { id: pathId, name: pathName, nodeIds, controlNodeIds }];
  return work;
}

function rejectOverlapWithOrdinarySegments(draft: WorkDraft, from: NodeV3, to: NodeV3): void {
  for (const segment of ordinarySegments(draft)) {
    if (!sameMembership(from, segment.a)) continue;
    const intersection = intersectSegments(from, to, segment.a, segment.b);
    if (intersection?.kind === 'overlap') throw new Error('Overlapping path segments are ambiguous. Draw separate non-overlapping paths.');
  }
}

export function removeDrawnPath(draft: DraftV3, pathId: string): DraftV3;
export function removeDrawnPath(draft: MapDraft, pathId: string): MapDraft;
export function removeDrawnPath(draft: DraftV3 | MapDraft, pathId: string): DraftV3 | MapDraft {
  if ((draft as MapDraft).schemaVersion === 5) return removeDrawnPathV5(draft as MapDraft, pathId);
  return removeDrawnPathV4(draft as DraftV3, pathId);
}

function removeDrawnPathV4(draft: DraftV3, pathId: string): DraftV3 {
  const paths = draft.paths ?? [];
  const deletedPath = paths.find((path) => path.id === pathId);
  if (!deletedPath) throw new Error(`Unknown path ${pathId}`);
  const remainingPaths = paths.filter((path) => path.id !== pathId);
  const remainingKeys = new Set(remainingPaths.flatMap((path) => routeKeys(path.nodeIds)));
  const deletedKeys = new Set(routeKeys(deletedPath.nodeIds));
  const edges = draft.edges.filter((edge) => !deletedKeys.has(edgeKey(edge.from, edge.to)) || remainingKeys.has(edgeKey(edge.from, edge.to)));
  const referenced = new Set([
    ...remainingPaths.flatMap((path) => path.nodeIds),
    ...edges.flatMap((edge) => [edge.from, edge.to]),
    ...draft.places.map((place) => place.nodeId),
    ...draft.anchors.map((anchor) => anchor.nodeId),
  ]);
  const nodes = draft.nodes.filter((node) => !node.generated || referenced.has(node.id));
  return { ...draft, paths: remainingPaths, edges, nodes };
}

export function deleteConnection(draft: DraftV3, from: string, to: string): DraftV3 {
  const key = edgeKey(from, to);
  const owningPath = (draft.paths ?? []).find((path) => routeKeys(path.nodeIds).includes(key));
  if (owningPath) return removeDrawnPath(draft, owningPath.id);
  return { ...draft, edges: draft.edges.filter((edge) => edgeKey(edge.from, edge.to) !== key) };
}

export function movePathNode(draft: DraftV3, id: string, location: { lat: number; lng: number; zoneId: string | null; z: number }): DraftV3 {
  const paths = (draft.paths ?? []).filter((path) => path.nodeIds.includes(id));
  if (!paths.length) throw new Error(`Node ${id} is not part of a drawn path`);
  const node = requireNode(draft, id);
  const changed = node.lat !== location.lat || node.lng !== location.lng || node.zoneId !== location.zoneId || node.z !== location.z;
  if (paths.length > 1 && changed) {
    throw new Error('Cannot move a shared junction; delete or redraw one of its paths first.');
  }
  validateLocation(draft, location.lat, location.lng, location.zoneId, location.z);

  const path = paths[0]!;
  if (changed && hasExternalIncidentConnection(draft, id, path)) {
    throw new Error('Disconnect or delete external connections before moving this path point.');
  }
  const initialControls = recoverPathControls(draft, path, id);
  const movedControlIndexes = initialControls
    .map((control, index) => (control.nodeId === id ? index : -1))
    .filter((index) => index >= 0);
  const affectedInteriorIds = new Set<string>();
  for (const movedControlIndex of movedControlIndexes) {
    for (const interiorId of affectedInteriorNodeIds(path, initialControls, movedControlIndex)) {
      affectedInteriorIds.add(interiorId);
    }
  }
  const controls = recoverPathControls(draft, path, id, affectedInteriorIds);
  const updatedNodes = draft.nodes.map((n) =>
    n.id === id ? { ...n, ...location, fingerprintRevision: n.fingerprintRevision + 1 } : n,
  );
  const updatedDraft = { ...draft, nodes: updatedNodes };
  validateIncidentEdges(updatedDraft, id, path);
  const vertices = controls.map((control, index) => {
    const nodeId = control.nodeId;
    const n = updatedNodes.find((item) => item.id === nodeId)!;
    return { lat: n.lat, lng: n.lng, zoneId: n.zoneId, z: n.z, nodeId: n.id, incomingKind: index === 0 ? undefined : control.incomingKind };
  });

  const stripped = removeDrawnPath({ ...updatedDraft, paths: draft.paths }, path.id);
  const keptNodes = new Map(stripped.nodes.map((n) => [n.id, n]));
  const controlIds = new Set(controls.map((control) => control.nodeId));
  for (const n of updatedNodes) {
    if (!path.nodeIds.includes(n.id)) continue;
    if (controlIds.has(n.id) || !affectedInteriorIds.has(n.id)) keptNodes.set(n.id, n);
  }
  const rebuilt = addDrawnPath({ ...stripped, nodes: [...keptNodes.values()] }, vertices, path.name);
  const newPath = rebuilt.paths!.at(-1)!;
  const controlNodeIds = desiredControlNodeIds(path, newPath, id);
  return {
    ...rebuilt,
    paths: [...rebuilt.paths!.filter((p) => p.id !== newPath.id), { ...newPath, id: path.id, controlNodeIds }],
  };
}

function desiredControlNodeIds(oldPath: PathV3, newPath: PathV3, movedId: string): string[] | undefined {
  if (!oldPath.controlNodeIds) return newPath.controlNodeIds;
  const eligible = new Set(oldPath.controlNodeIds);
  if (newPath.nodeIds.includes(movedId)) eligible.add(movedId);
  const remainingOccurrences = new Map<string, number>();
  for (const id of oldPath.controlNodeIds) remainingOccurrences.set(id, (remainingOccurrences.get(id) ?? 0) + 1);
  if (!oldPath.controlNodeIds.includes(movedId) && newPath.nodeIds.includes(movedId)) {
    remainingOccurrences.set(movedId, (remainingOccurrences.get(movedId) ?? 0) + 1);
  }
  const controls: string[] = [];
  for (const id of newPath.nodeIds) {
    if (!eligible.has(id)) continue;
    const remaining = remainingOccurrences.get(id) ?? 0;
    if (remaining <= 0) continue;
    controls.push(id);
    remainingOccurrences.set(id, remaining - 1);
  }
  return controls;
}

function recoverPathControls(draft: DraftV3, path: PathV3, movedId: string, affectedInteriorIds?: Set<string>): RecoveredControl[] {
  const controlIndexes: number[] = [];
  const explicitControlIds = path.controlNodeIds ?? [];
  for (let i = 0; i < path.nodeIds.length; i++) {
    const nodeId = path.nodeIds[i]!;
    if (
      i === 0 ||
      i === path.nodeIds.length - 1 ||
      explicitControlIds.includes(nodeId) ||
      nodeId === movedId ||
      (affectedInteriorIds !== undefined && !affectedInteriorIds.has(nodeId)) ||
      isStructuralPathNode(draft, path, i, explicitControlIds.length > 0)
    ) {
      controlIndexes.push(i);
    }
  }
  return controlIndexes.map((pathIndex, index) => ({
    nodeId: path.nodeIds[pathIndex]!,
    pathIndex,
    incomingKind: index === 0 ? undefined : kindAcrossSpan(draft, path, controlIndexes[index - 1]!, pathIndex),
  }));
}

function isStructuralPathNode(draft: DraftV3, path: PathV3, index: number, hasExplicitControls: boolean): boolean {
  const nodeId = path.nodeIds[index]!;
  const node = requireNode(draft, nodeId);
  if (!node.generated) return true;
  if (draft.places.some((place) => place.nodeId === nodeId) || draft.anchors.some((anchor) => anchor.nodeId === nodeId)) return true;
  if ((draft.paths ?? []).filter((candidate) => candidate.nodeIds.includes(nodeId)).length > 1) return true;
  const previousId = path.nodeIds[index - 1];
  const nextId = path.nodeIds[index + 1];
  if (!previousId || !nextId) return true;
  const previousKind = edgeKind(draft, previousId, nodeId);
  const nextKind = edgeKind(draft, nodeId, nextId);
  if (previousKind === 'stairs' || nextKind === 'stairs') return true;
  if (hasExternalIncidentEdge(draft, nodeId, previousId, nextId)) return true;
  if (hasExplicitControls) return false;
  const previous = requireNode(draft, previousId);
  const next = requireNode(draft, nextId);
  return !collinear(previous, node, next);
}

function kindAcrossSpan(draft: DraftV3, path: PathV3, fromIndex: number, toIndex: number): 'path' | 'stairs' {
  for (let i = fromIndex + 1; i <= toIndex; i++) {
    if (edgeKind(draft, path.nodeIds[i - 1]!, path.nodeIds[i]!) === 'stairs') return 'stairs';
  }
  return 'path';
}

function edgeKind(draft: DraftV3, from: string, to: string): EdgeV3['kind'] {
  return draft.edges.find((edge) => edgeKey(edge.from, edge.to) === edgeKey(from, to))?.kind ?? 'path';
}

function hasExternalIncidentEdge(draft: DraftV3, nodeId: string, previousId: string, nextId: string): boolean {
  const adjacent = new Set([edgeKey(previousId, nodeId), edgeKey(nodeId, nextId)]);
  return draft.edges.some((edge) => (edge.from === nodeId || edge.to === nodeId) && !adjacent.has(edgeKey(edge.from, edge.to)));
}

function hasExternalIncidentConnection(draft: DraftV3, nodeId: string, path: PathV3): boolean {
  const routeEdges = new Set(routeKeys(path.nodeIds));
  return draft.edges.some((edge) => (edge.from === nodeId || edge.to === nodeId) && !routeEdges.has(edgeKey(edge.from, edge.to)));
}

function validateIncidentEdges(draft: DraftV3, nodeId: string, path: PathV3): void {
  const routeEdges = new Set(routeKeys(path.nodeIds));
  for (const edge of draft.edges) {
    if (edge.from !== nodeId && edge.to !== nodeId) continue;
    if (routeEdges.has(edgeKey(edge.from, edge.to))) continue;
    const from = requireNode(draft, edge.from);
    const to = requireNode(draft, edge.to);
    if (edge.kind === 'path' && !sameMembership(from, to)) throw new Error('Cannot move path point: incident path connection must stay in the same zone and floor.');
    if (edge.kind === 'entrance') {
      const outdoorIndoor = (from.zoneId === null) !== (to.zoneId === null);
      const indoor = from.zoneId === null ? to : from;
      if (!outdoorIndoor || indoor.z !== 0) throw new Error('Cannot move path point: incident entrance connection would be invalid.');
    }
    if ((edge.kind === 'stairs' || edge.kind === 'elevator') && (from.zoneId === null || from.zoneId !== to.zoneId || from.z === to.z)) {
      throw new Error('Cannot move path point: incident transition connection would be invalid.');
    }
  }
}

function affectedInteriorNodeIds(path: PathV3, controls: RecoveredControl[], movedControlIndex: number): Set<string> {
  const affected = new Set<string>();
  for (const neighborIndex of [movedControlIndex - 1, movedControlIndex + 1]) {
    const neighbor = controls[neighborIndex];
    const moved = controls[movedControlIndex];
    if (!neighbor || !moved) continue;
    const start = Math.min(neighbor.pathIndex, moved.pathIndex) + 1;
    const end = Math.max(neighbor.pathIndex, moved.pathIndex);
    for (let i = start; i < end; i++) affected.add(path.nodeIds[i]!);
  }
  return affected;
}

function collinear(a: GeoPoint, b: GeoPoint, c: GeoPoint): boolean {
  const cross = (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
  return Math.abs(cross) <= 1e-10;
}

function cloneDraft(draft: DraftV3): WorkDraft {
  return {
    ...draft,
    nodes: draft.nodes.map((node) => ({ ...node })),
    edges: draft.edges.map((edge) => ({ ...edge })),
    paths: (draft.paths ?? []).map((path) => ({ ...path, nodeIds: [...path.nodeIds] })),
    places: draft.places.map((place) => ({ ...place })),
    anchors: draft.anchors.map((anchor) => ({ ...anchor })),
  };
}

function resolveVertex(draft: WorkDraft, vertex: PathVertex): PathVertex {
  if (vertex.nodeId) {
    const node = requireNode(draft, vertex.nodeId);
    validateLocation(draft, node.lat, node.lng, node.zoneId, node.z);
    return { ...vertex, lat: node.lat, lng: node.lng, zoneId: node.zoneId, z: node.z };
  }
  validateLocation(draft, vertex.lat, vertex.lng, vertex.zoneId, vertex.z);
  return vertex;
}

function validateLocation(draft: DraftV3, lat: number, lng: number, zoneId: string | null, z: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Path point coordinates must be finite');
  if (!draft.boundary || !containsPoint(draft.boundary, lat, lng)) throw new Error('Path points must be inside the outdoor boundary');
  if (zoneId === null) {
    if (z !== 0) throw new Error('Outdoor path points use the ground level');
    if (draft.indoorZones.some((zone) => containsPoint(zone.bounds, lat, lng))) throw new Error('Outdoor path points cannot lie inside indoor zones');
    return;
  }
  const zone = draft.indoorZones.find((item) => item.id === zoneId);
  if (!zone) throw new Error(`Unknown zone ${zoneId}`);
  if (!containsPoint(zone.bounds, lat, lng)) throw new Error(`Point is outside zone ${zone.name}`);
  if (!zone.floors.some((floor) => floor.z === z)) throw new Error(`Zone ${zone.name} has no floor ${z}`);
}

function validateOrdinarySegmentMembership(draft: DraftV3, from: PathVertex, to: PathVertex): void {
  if (from.zoneId !== null || to.zoneId !== null) return;
  for (const zone of draft.indoorZones) {
    if (segmentIntersectsBounds(from, to, zone.bounds)) throw new Error('Outdoor path segments cannot enter indoor zones');
  }
}

function validateConnection(from: PathVertex, to: PathVertex, kind: 'path' | 'stairs'): void {
  if (kind === 'path') {
    if ((from.zoneId ?? null) !== (to.zoneId ?? null) || from.z !== to.z) throw new Error('Cross-floor or cross-zone links must be explicit stairs.');
    if (distanceMeters(from.lat, from.lng, to.lat, to.lng) <= 0) throw new Error('Duplicate ordinary path vertices create a zero-length path segment.');
    return;
  }
  if (from.zoneId === null || from.zoneId !== to.zoneId || from.z === to.z) throw new Error('Stairs must stay within one building across floors.');
}

function ensureNode(draft: WorkDraft, vertex: PathVertex, reuseStairOnly = true): NodeV3 {
  if (vertex.nodeId) return requireNode(draft, vertex.nodeId);
  const existing = draft.nodes.find(
    (node) => node.zoneId === vertex.zoneId && node.z === vertex.z && samePoint(node, vertex) && (reuseStairOnly || !isStairOnlyNode(draft, node.id)),
  );
  if (existing) return existing;
  const id = randomId();
  const node: NodeV3 = { id, name: `Path point ${id}`, lat: vertex.lat, lng: vertex.lng, z: vertex.z, zoneId: vertex.zoneId, fingerprintRevision: 1, generated: true };
  draft.nodes.push(node);
  return node;
}

function addOrdinarySegment(draft: WorkDraft, from: NodeV3, to: NodeV3, currentNodeIds?: string[]): string[] {
  if (from.id === to.id || distanceMeters(from.lat, from.lng, to.lat, to.lng) <= 0) return [from.id];
  const splitIds = new Map<number, string>([[0, from.id], [1, to.id]]);
  for (const segment of ordinarySegments(draft)) {
    if (edgeKey(segment.from, segment.to) === edgeKey(from.id, to.id)) continue;
    if (!sameMembership(from, segment.a)) continue;
    const intersection = intersectSegments(from, to, segment.a, segment.b);
    if (!intersection) continue;
    if (intersection.kind === 'overlap') throw new Error('Overlapping path segments are ambiguous. Draw separate non-overlapping paths.');
    const touchesNewEndpoint = intersection.aFraction === 0 || intersection.aFraction === 1;
    const touchesExistingEndpoint = intersection.bFraction === 0 || intersection.bFraction === 1;
    if (touchesNewEndpoint && touchesExistingEndpoint) continue;
    const junction = ensureNode(draft, { lat: intersection.point.lat, lng: intersection.point.lng, zoneId: from.zoneId, z: from.z });
    splitExistingEdge(draft, segment, junction);
    if (currentNodeIds) spliceCurrentPath(currentNodeIds, segment.from, segment.to, junction.id);
    splitIds.set(intersection.aFraction, junction.id);
  }
  const ids = [...splitIds.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
  for (let i = 1; i < ids.length; i++) {
    const a = requireNode(draft, ids[i - 1]!);
    const b = requireNode(draft, ids[i]!);
    if (a.id !== b.id) addUniqueEdge(draft, a.id, b.id, 'path', distanceMeters(a.lat, a.lng, b.lat, b.lng));
  }
  return ids;
}

export function connectLegacyPathNodes(draft: DraftV3, fromId: string, toId: string, meters?: number): DraftV3 {
  const work = cloneDraft(draft);
  const from = requireNode(work, fromId);
  const to = requireNode(work, toId);
  validateOrdinarySegmentMembership(work, from, to);
  rejectOverlapWithOrdinarySegments(work, from, to);
  const chain = addOrdinarySegment(work, from, to);
  if (meters !== undefined) {
    const direct = findEdge(work, fromId, toId);
    if (direct) direct.meters = meters;
    else distributeMeters(work, chain, meters);
  }
  return work;
}

function distributeMeters(draft: WorkDraft, chain: string[], meters: number): void {
  const links = chain.slice(1).map((to, index) => {
    const a = requireNode(draft, chain[index]!);
    const b = requireNode(draft, to);
    return { key: edgeKey(a.id, b.id), length: distanceMeters(a.lat, a.lng, b.lat, b.lng) };
  });
  const total = links.reduce((sum, link) => sum + link.length, 0);
  for (const link of links) {
    const edge = draft.edges.find((candidate) => edgeKey(candidate.from, candidate.to) === link.key);
    if (edge) edge.meters = total > 0 ? (meters * link.length) / total : meters / links.length;
  }
}

function isStairOnlyNode(draft: WorkDraft, id: string): boolean {
  const incident = draft.edges.filter((edge) => edge.from === id || edge.to === id);
  return incident.length > 0 && incident.every((edge) => edge.kind === 'stairs');
}

function spliceCurrentPath(ids: string[], from: string, to: string, junction: string): void {
  const updated = insertBetween(ids, from, to, junction);
  ids.splice(0, ids.length, ...updated);
}

function ordinarySegments(draft: WorkDraft): OrdinarySegment[] {
  return draft.edges.flatMap((edge) => {
    if (edge.kind !== 'path') return [];
    const a = draft.nodes.find((node) => node.id === edge.from);
    const b = draft.nodes.find((node) => node.id === edge.to);
    if (!a || !b || a.zoneId !== b.zoneId || a.z !== b.z) return [];
    return [{ from: edge.from, to: edge.to, a, b }];
  });
}

function splitExistingEdge(draft: WorkDraft, segment: OrdinarySegment, junction: NodeV3): void {
  if (junction.id === segment.from || junction.id === segment.to) return;
  const segmentKey = edgeKey(segment.from, segment.to);
  const oldEdge = draft.edges.find((edge) => edgeKey(edge.from, edge.to) === segmentKey);
  if (!oldEdge) return;
  draft.edges = draft.edges.filter((edge) => edgeKey(edge.from, edge.to) !== segmentKey);
  addUniqueEdge(draft, segment.from, junction.id, 'path', distanceMeters(segment.a.lat, segment.a.lng, junction.lat, junction.lng));
  addUniqueEdge(draft, junction.id, segment.to, 'path', distanceMeters(junction.lat, junction.lng, segment.b.lat, segment.b.lng));
  draft.paths = draft.paths.map((path) => ({ ...path, nodeIds: insertBetween(path.nodeIds, segment.from, segment.to, junction.id) }));
}

function insertBetween(ids: string[], from: string, to: string, junction: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    out.push(ids[i]!);
    if (i < ids.length - 1 && edgeKey(ids[i]!, ids[i + 1]!) === edgeKey(from, to) && ids[i] !== junction && ids[i + 1] !== junction) {
      out.push(junction);
    }
  }
  return out;
}

function addUniqueEdge(draft: WorkDraft, from: string, to: string, kind: EdgeV3['kind'], meters: number): void {
  if (from === to) return;
  if (!Number.isFinite(meters) || meters <= 0) throw new Error('Path edges need a positive distance');
  const key = edgeKey(from, to);
  const existing = draft.edges.find((edge) => edgeKey(edge.from, edge.to) === key);
  if (existing) {
    if (existing.kind !== kind) throw new Error(`Existing ${existing.kind} connection conflicts with new ${kind} connection`);
    return;
  }
  draft.edges.push({ from, to, meters, kind });
}

function findEdge(draft: DraftV3, from: string, to: string): EdgeV3 | undefined {
  const key = edgeKey(from, to);
  return draft.edges.find((edge) => edgeKey(edge.from, edge.to) === key);
}

function sameMembership(a: Pick<NodeV3, 'zoneId' | 'z'>, b: Pick<NodeV3, 'zoneId' | 'z'>): boolean {
  return (a.zoneId ?? null) === (b.zoneId ?? null) && a.z === b.z;
}

function segmentIntersectsBounds(a: GeoPoint, b: GeoPoint, bounds: { north: number; south: number; east: number; west: number }): boolean {
  if (containsPoint(bounds, a.lat, a.lng) || containsPoint(bounds, b.lat, b.lng)) return true;
  const corners = [
    { lat: bounds.south, lng: bounds.west },
    { lat: bounds.south, lng: bounds.east },
    { lat: bounds.north, lng: bounds.east },
    { lat: bounds.north, lng: bounds.west },
  ];
  for (let i = 0; i < corners.length; i++) {
    if (intersectSegments(a, b, corners[i]!, corners[(i + 1) % corners.length]!)) return true;
  }
  return false;
}

function appendChain(nodeIds: string[], chain: string[]): void {
  for (const id of chain.slice(1)) nodeIds.push(id);
}

function edgeKey(from: string, to: string): string {
  return JSON.stringify([from, to].sort());
}

function routeKeys(nodeIds: string[]): string[] {
  return nodeIds.slice(1).map((to, index) => edgeKey(nodeIds[index]!, to));
}

function requireNode(draft: DraftV3, id: string): NodeV3 {
  const node = draft.nodes.find((item) => item.id === id);
  if (!node) throw new Error(`Unknown node ${id}`);
  return node;
}

function samePoint(a: GeoPoint, b: GeoPoint): boolean {
  return Math.abs(a.lat - b.lat) <= EPS && Math.abs(a.lng - b.lng) <= EPS;
}

function stairLength(from: NodeV3, to: NodeV3): number {
  return Math.max(Math.abs(to.z - from.z) * 4, 1);
}

function randomId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// V5 frame-aware drawn paths. Same-frame regular runs are sampled in the
// frame's own units (metres geographic, source pixels static, capped); stair
// links are single explicit edges with mirrored transitions and are never
// interpolated. Junctions reuse existing node ids; shared junctions, samples
// and anchors follow the same preservation rules as V4.
// ---------------------------------------------------------------------------

export type PathVertexV5 = {
  frameId: string;
  position: Position;
  nodeId?: string;
  incomingKind?: 'path' | 'stairs';
};

export type DrawPathOptsV5 = {
  spacingMeters?: number;
  spacingPixels?: number;
  physicalSpacingMeters?: number;
};

type WorkDraftV5 = MapDraft;

type OrdinarySegmentV5 = { from: string; to: string; a: MapNode; b: MapNode; frameId: string };

function requireFrameV5(draft: WorkDraftV5, frameId: string): MapFrame {
  const frame = draft.frames.find((f) => f.id === frameId);
  if (!frame) throw new Error(`Unknown frame ${frameId}`);
  return frame;
}

function requireNodeV5(draft: WorkDraftV5, id: string): MapNode {
  const node = draft.nodes.find((item) => item.id === id);
  if (!node) throw new Error(`Unknown node ${id}`);
  return node;
}

function coordKindV5(draft: WorkDraftV5): 'geographic' | 'local' {
  return draft.canvas.kind === 'static' ? 'local' : 'geographic';
}

function cloneDraftV5(draft: MapDraft): WorkDraftV5 {
  return {
    ...draft,
    nodes: draft.nodes.map((node) => ({ ...node, position: { ...node.position } })),
    edges: draft.edges.map((edge) => ({ ...edge })),
    paths: (draft.paths ?? []).map((path) => ({ ...path, nodeIds: [...path.nodeIds] })),
    transitions: draft.transitions.map((t) => ({ ...t, nodeIds: [...t.nodeIds] as [string, string] })),
    places: draft.places.map((place) => ({ ...place })),
    anchors: draft.anchors.map((anchor) => ({ ...anchor })),
  };
}

function resolveVertexV5(draft: WorkDraftV5, vertex: PathVertexV5): PathVertexV5 {
  if (vertex.nodeId) {
    const node = requireNodeV5(draft, vertex.nodeId);
    return { ...vertex, frameId: node.frameId, position: { ...node.position } };
  }
  const frame = requireFrameV5(draft, vertex.frameId);
  if (vertex.position.kind !== coordKindV5(draft)) {
    throw new Error(`${draft.canvas.kind} canvas needs ${coordKindV5(draft)} positions`);
  }
  if (draft.canvas.kind === 'static' && !frame.background) {
    throw new Error(`Frame ${frame.id} needs an assigned background before authoring`);
  }
  if (!containsPosition(frame, vertex.position)) throw new Error('Path points must be inside the frame bounds');
  return vertex;
}

function segmentLengthV5(draft: WorkDraftV5, from: PathVertexV5, to: PathVertexV5): number {
  if (from.position.kind === 'geographic' && to.position.kind === 'geographic') {
    return distanceMeters(from.position.lat, from.position.lng, to.position.lat, to.position.lng);
  }
  if (from.position.kind === 'local' && to.position.kind === 'local') {
    const frame = requireFrameV5(draft, from.frameId);
    const bg = frame.background;
    if (!bg) throw new Error(`Frame ${frame.id} needs an assigned background before authoring`);
    return Math.hypot((to.position.x - from.position.x) * bg.width, (to.position.y - from.position.y) * bg.height);
  }
  throw new Error('Path vertices must share one coordinate kind');
}

function validateConnectionV5(draft: WorkDraftV5, from: PathVertexV5, to: PathVertexV5, kind: 'path' | 'stairs'): void {
  if (kind === 'path') {
    if (from.frameId !== to.frameId) throw new Error('Cross-frame links must be explicit stairs.');
    if (!(segmentLengthV5(draft, from, to) > 0)) throw new Error('Duplicate ordinary path vertices create a zero-length path segment.');
    return;
  }
  const fromFrame = requireFrameV5(draft, from.frameId);
  const toFrame = requireFrameV5(draft, to.frameId);
  if (fromFrame.zoneId === null || fromFrame.zoneId !== toFrame.zoneId || fromFrame.id === toFrame.id || fromFrame.z === toFrame.z) {
    throw new Error('Stairs must stay within one building across floors.');
  }
}

function sameFrameMembership(a: MapNode, b: MapNode): boolean {
  return a.frameId === b.frameId;
}

function ensureNodeV5(draft: WorkDraftV5, vertex: PathVertexV5, reuseStairOnly = true): MapNode {
  if (vertex.nodeId) return requireNodeV5(draft, vertex.nodeId);
  const frame = requireFrameV5(draft, vertex.frameId);
  const existing = draft.nodes.find((node) => {
    if (node.frameId !== vertex.frameId) return false;
    if (reuseStairOnly === false && isStairOnlyNodeV5(draft, node.id)) return false;
    if (node.position.kind === 'geographic' && vertex.position.kind === 'geographic') {
      return Math.abs(node.position.lat - vertex.position.lat) <= EPS && Math.abs(node.position.lng - vertex.position.lng) <= EPS;
    }
    if (node.position.kind === 'local' && vertex.position.kind === 'local') {
      return sameLocalPoint(node.position, vertex.position);
    }
    return false;
  });
  if (existing) return existing;
  const id = randomId();
  const position = { ...vertex.position } as MapNode['position'];
  const node: MapNode = {
    id,
    name: `Path point ${id}`,
    frameId: frame.id,
    position,
    zoneId: frame.zoneId,
    z: frame.z,
    fingerprintRevision: 1,
    generated: true,
    visitorVisible: false,
  };
  draft.nodes.push(node);
  return node;
}

function isStairOnlyNodeV5(draft: WorkDraftV5, id: string): boolean {
  const incident = draft.edges.filter((edge) => edge.from === id || edge.to === id);
  return incident.length > 0 && incident.every((edge) => edge.kind === 'stairs');
}

function findEdgeV5(draft: WorkDraftV5, from: string, to: string): MapEdge | undefined {
  const key = edgeKey(from, to);
  return draft.edges.find((edge) => edgeKey(edge.from, edge.to) === key);
}

function ordinarySegmentsV5(draft: WorkDraftV5): OrdinarySegmentV5[] {
  return draft.edges.flatMap((edge) => {
    if (edge.kind !== 'path') return [];
    const a = draft.nodes.find((node) => node.id === edge.from);
    const b = draft.nodes.find((node) => node.id === edge.to);
    if (!a || !b || a.frameId !== b.frameId) return [];
    return [{ from: edge.from, to: edge.to, a, b, frameId: a.frameId }];
  });
}

function addUniqueEdgeV5(draft: WorkDraftV5, from: string, to: string, kind: MapEdge['kind'], cost: number, meters?: number): void {
  if (from === to) return;
  if (!Number.isFinite(cost) || cost <= 0) throw new Error('Path edges need a positive distance');
  const key = edgeKey(from, to);
  const existing = draft.edges.find((edge) => edgeKey(edge.from, edge.to) === key);
  if (existing) {
    if (existing.kind !== kind) throw new Error(`Existing ${existing.kind} connection conflicts with new ${kind} connection`);
    return;
  }
  draft.edges.push(meters === undefined ? { from, to, kind, cost } : { from, to, kind, cost, meters });
}

function transitionIdForV5(draft: WorkDraftV5, from: string, to: string): string {
  const base = `tr-${from.length}-${from}${to}`;
  if (!draft.transitions.some((t) => t.id === base)) return base;
  let i = 2;
  while (draft.transitions.some((t) => t.id === `${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function addTransitionEdgeV5(draft: WorkDraftV5, from: string, to: string, kind: 'entrance' | 'stairs' | 'elevator', cost: number, meters?: number): void {
  addUniqueEdgeV5(draft, from, to, kind === 'entrance' ? 'entrance' : kind === 'stairs' ? 'stairs' : 'elevator', cost, meters);
  const transitionKind = kind === 'stairs' ? 'stair' : kind;
  const key = edgeKey(from, to);
  if (draft.transitions.some((t) => edgeKey(t.nodeIds[0]!, t.nodeIds[1]!) === key)) return;
  draft.transitions.push({
    id: transitionIdForV5(draft, from, to),
    name: `${kind} ${from} ↔ ${to}`,
    kind: transitionKind as 'entrance' | 'stair' | 'elevator',
    nodeIds: [from, to],
  });
}

function localPointOf(position: Position): { x: number; y: number } {
  if (position.kind !== 'local') throw new Error('Static frames need local positions');
  return { x: position.x, y: position.y };
}

function geoPointOf(position: Position): GeoPoint {
  if (position.kind !== 'geographic') throw new Error('Geographic frames need geographic positions');
  return { lat: position.lat, lng: position.lng };
}

/** Sampled interior points for one ordinary run, excluding its endpoints. */
function sampleRunV5(
  from: MapNode,
  to: MapNode,
  frame: MapFrame,
  opts: DrawPathOptsV5 | undefined,
  priorCount: number,
): Position[] {
  if (from.position.kind === 'geographic' && to.position.kind === 'geographic') {
    const a = geoPointOf(from.position);
    const b = geoPointOf(to.position);
    const length = distanceMeters(a.lat, a.lng, b.lat, b.lng);
    const steps = Math.ceil(length / (opts?.spacingMeters ?? 3));
    assertSampleBudget(priorCount + steps + 1);
    if (steps <= 1) return [];
    return Array.from({ length: steps - 1 }, (_, k) => {
      const i = k + 1;
      return { kind: 'geographic', lat: a.lat + ((b.lat - a.lat) * i) / steps, lng: a.lng + ((b.lng - a.lng) * i) / steps } as Position;
    });
  }
  const bg = frame.background;
  if (!bg) throw new Error(`Frame ${frame.id} needs an assigned background before authoring`);
  let spacingPixels = opts?.spacingPixels ?? 20;
  if (opts?.physicalSpacingMeters !== undefined) {
    const metersPerPixel = frame.calibration?.metersPerPixel;
    if (!metersPerPixel) throw new Error(`Frame ${frame.id} is not calibrated for physical spacing`);
    spacingPixels = opts.physicalSpacingMeters / metersPerPixel;
  }
  const a = localPointOf(from.position);
  const b = localPointOf(to.position);
  const pixels = Math.hypot((b.x - a.x) * bg.width, (b.y - a.y) * bg.height);
  const steps = Math.ceil(pixels / spacingPixels);
  assertSampleBudget(priorCount + steps + 1);
  if (steps <= 1) return [];
  return Array.from({ length: steps - 1 }, (_, k) => {
    const i = k + 1;
    return { kind: 'local', x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps } as Position;
  });
}

function addOrdinarySegmentV5(draft: WorkDraftV5, from: MapNode, to: MapNode, currentNodeIds?: string[]): string[] {
  if (from.id === to.id || !(segmentLengthV5(draft, { frameId: from.frameId, position: from.position }, { frameId: to.frameId, position: to.position }) > 0)) {
    return [from.id];
  }
  const splitIds = new Map<number, string>([[0, from.id], [1, to.id]]);
  for (const segment of ordinarySegmentsV5(draft)) {
    if (edgeKey(segment.from, segment.to) === edgeKey(from.id, to.id)) continue;
    if (!sameFrameMembership(from, segment.a)) continue;
    const intersection =
      from.position.kind === 'geographic' && to.position.kind === 'geographic'
        ? intersectSegments(geoPointOf(from.position), geoPointOf(to.position), geoPointOf(segment.a.position), geoPointOf(segment.b.position))
        : intersectLocalSegments(localPointOf(from.position), localPointOf(to.position), localPointOf(segment.a.position), localPointOf(segment.b.position));
    if (!intersection) continue;
    if (intersection.kind === 'overlap') throw new Error('Overlapping path segments are ambiguous. Draw separate non-overlapping paths.');
    const touchesNewEndpoint = intersection.aFraction === 0 || intersection.aFraction === 1;
    const touchesExistingEndpoint = intersection.bFraction === 0 || intersection.bFraction === 1;
    if (touchesNewEndpoint && touchesExistingEndpoint) continue;
    const point = intersection.point;
    const position: Position =
      from.position.kind === 'geographic'
        ? { kind: 'geographic', lat: (point as GeoPoint).lat, lng: (point as GeoPoint).lng }
        : { kind: 'local', x: (point as { x: number }).x, y: (point as { y: number }).y };
    const junction = ensureNodeV5(draft, { frameId: from.frameId, position });
    splitExistingEdgeV5(draft, segment, junction);
    if (currentNodeIds) spliceCurrentPath(currentNodeIds, segment.from, segment.to, junction.id);
    splitIds.set(intersection.aFraction, junction.id);
  }
  const ids = [...splitIds.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
  const frame = requireFrameV5(draft, from.frameId);
  for (let i = 1; i < ids.length; i++) {
    const a = requireNodeV5(draft, ids[i - 1]!);
    const b = requireNodeV5(draft, ids[i]!);
    if (a.id !== b.id) {
      const m = segmentMetrics(a, b, frame);
      addUniqueEdgeV5(draft, a.id, b.id, 'path', m.cost, m.meters);
    }
  }
  return ids;
}

function splitExistingEdgeV5(draft: WorkDraftV5, segment: OrdinarySegmentV5, junction: MapNode): void {
  if (junction.id === segment.from || junction.id === segment.to) return;
  const segmentKey = edgeKey(segment.from, segment.to);
  const oldEdge = draft.edges.find((edge) => edgeKey(edge.from, edge.to) === segmentKey);
  if (!oldEdge) return;
  draft.edges = draft.edges.filter((edge) => edgeKey(edge.from, edge.to) !== segmentKey);
  const frame = requireFrameV5(draft, segment.frameId);
  const first = segmentMetrics(segment.a, junction, frame);
  const second = segmentMetrics(junction, segment.b, frame);
  addUniqueEdgeV5(draft, segment.from, junction.id, 'path', first.cost, first.meters);
  addUniqueEdgeV5(draft, junction.id, segment.to, 'path', second.cost, second.meters);
  draft.paths = (draft.paths ?? []).map((path) => ({ ...path, nodeIds: insertBetween(path.nodeIds, segment.from, segment.to, junction.id) }));
}

function rejectOverlapWithOrdinarySegmentsV5(draft: WorkDraftV5, from: MapNode, to: MapNode): void {
  for (const segment of ordinarySegmentsV5(draft)) {
    if (!sameFrameMembership(from, segment.a)) continue;
    const intersection =
      from.position.kind === 'geographic'
        ? intersectSegments(geoPointOf(from.position), geoPointOf(to.position), geoPointOf(segment.a.position), geoPointOf(segment.b.position))
        : intersectLocalSegments(localPointOf(from.position), localPointOf(to.position), localPointOf(segment.a.position), localPointOf(segment.b.position));
    if (intersection?.kind === 'overlap') throw new Error('Overlapping path segments are ambiguous. Draw separate non-overlapping paths.');
  }
}

function validateOutdoorRunV5(draft: WorkDraftV5, from: PathVertexV5, to: PathVertexV5): void {
  const frame = requireFrameV5(draft, from.frameId);
  if (frame.zoneId !== null || requireFrameV5(draft, to.frameId).zoneId !== null) return;
  if (draft.canvas.kind !== 'geographic') return;
  for (const zone of draft.indoorZones) {
    if (!zone.bounds || zone.bounds.kind !== 'geographic') continue;
    if (from.position.kind !== 'geographic' || to.position.kind !== 'geographic') continue;
    if (segmentIntersectsBoundsV5(from.position, to.position, zone.bounds)) {
      throw new Error('Outdoor path segments cannot enter indoor zones');
    }
  }
}

function segmentIntersectsBoundsV5(a: GeoPoint, b: GeoPoint, bounds: { north: number; south: number; east: number; west: number }): boolean {
  if (containsPoint(bounds, a.lat, a.lng) || containsPoint(bounds, b.lat, b.lng)) return true;
  const corners = [
    { lat: bounds.south, lng: bounds.west },
    { lat: bounds.south, lng: bounds.east },
    { lat: bounds.north, lng: bounds.east },
    { lat: bounds.north, lng: bounds.west },
  ];
  for (let i = 0; i < corners.length; i++) {
    if (intersectSegments(a, b, corners[i]!, corners[(i + 1) % corners.length]!)) return true;
  }
  return false;
}

export function addDrawnPathV5(draft: MapDraft, vertices: PathVertexV5[], name?: string, opts?: DrawPathOptsV5): MapDraft {
  if (vertices.length < 2) throw new Error('Path needs at least two points');
  const work = cloneDraftV5(draft);
  const pathName = name?.trim() || `Path ${((work.paths ?? []).length) + 1}`;

  const resolved = vertices.map((vertex) => resolveVertexV5(work, vertex));
  for (let i = 1; i < resolved.length; i++) {
    const kind = vertices[i]!.incomingKind ?? 'path';
    validateConnectionV5(work, resolved[i - 1]!, resolved[i]!, kind);
    if (kind === 'path') validateOutdoorRunV5(work, resolved[i - 1]!, resolved[i]!);
  }

  let budget = resolved.length;
  const runs: Array<{ nodeIds: string[]; controlNodeIds: string[] }> = [];
  let current: string[] = [];
  let controls: string[] = [];

  const closeRun = () => {
    if (current.length >= 2) runs.push({ nodeIds: [...current], controlNodeIds: [...controls] });
    current = [];
    controls = [];
  };

  let previous = ensureNodeV5(work, resolved[0]!);
  current.push(previous.id);
  controls.push(previous.id);

  for (let i = 1; i < resolved.length; i++) {
    const currentVertex = resolved[i]!;
    const kind = vertices[i]!.incomingKind ?? 'path';
    const currentNode = ensureNodeV5(work, currentVertex);
    if (!controls.includes(currentNode.id)) controls.push(currentNode.id);
    if (kind === 'stairs') {
      if (findEdgeV5(work, previous.id, currentNode.id)) {
        throw new Error('Cannot create stairs over an existing transition connection; delete the existing connection first.');
      }
      const fromFrame = requireFrameV5(work, previous.frameId);
      const toFrame = requireFrameV5(work, currentNode.frameId);
      const m = transitionMetrics('stair', previous, currentNode);
      void fromFrame;
      void toFrame;
      addTransitionEdgeV5(work, previous.id, currentNode.id, 'stairs', m.cost, m.meters);
      closeRun();
      current.push(currentNode.id);
      controls.push(currentNode.id);
    } else {
      rejectOverlapWithOrdinarySegmentsV5(work, previous, currentNode);
      const frame = requireFrameV5(work, previous.frameId);
      const samples = sampleRunV5(previous, currentNode, frame, opts, budget);
      budget += samples.length + 1;
      let from = previous;
      const chain: string[] = [previous.id];
      for (const sample of samples) {
        const target = ensureNodeV5(work, { frameId: frame.id, position: sample }, false);
        const piece = addOrdinarySegmentV5(work, from, target, current);
        appendChain(chain, piece);
        from = target;
      }
      const tail = addOrdinarySegmentV5(work, from, currentNode, current);
      appendChain(chain, tail);
      for (const id of chain.slice(1)) current.push(id);
    }
    previous = currentNode;
  }
  closeRun();

  const paths = [...(work.paths ?? [])];
  runs.forEach((run, index) => {
    const runName = runs.length === 1 ? pathName : `${pathName} (${index + 1} of ${runs.length})`;
    paths.push({
      id: randomId(),
      name: runName,
      kind: 'regular',
      nodeIds: run.nodeIds,
      controlNodeIds: run.controlNodeIds.length >= 2 ? run.controlNodeIds : undefined,
    });
  });
  return parseMapDraft({ ...work, paths });
}

function removeDrawnPathV5(draft: MapDraft, pathId: string): MapDraft {
  const paths = draft.paths ?? [];
  const deletedPath = paths.find((path) => path.id === pathId);
  if (!deletedPath) throw new Error(`Unknown path ${pathId}`);
  const remainingPaths = paths.filter((path) => path.id !== pathId);
  const remainingKeys = new Set(remainingPaths.flatMap((path) => routeKeys(path.nodeIds)));
  const deletedKeys = new Set(routeKeys(deletedPath.nodeIds));
  const edges = draft.edges.filter((edge) => !deletedKeys.has(edgeKey(edge.from, edge.to)) || remainingKeys.has(edgeKey(edge.from, edge.to)));
  const liveKeys = new Set(edges.map((edge) => edgeKey(edge.from, edge.to)));
  const transitions = draft.transitions.filter((t) => liveKeys.has(edgeKey(t.nodeIds[0]!, t.nodeIds[1]!)));
  const referenced = new Set([
    ...remainingPaths.flatMap((path) => path.nodeIds),
    ...edges.flatMap((edge) => [edge.from, edge.to]),
    ...draft.places.map((place) => place.nodeId),
    ...draft.anchors.map((anchor) => anchor.nodeId),
  ]);
  const nodes = draft.nodes.filter((node) => !node.generated || referenced.has(node.id));
  return parseMapDraft({ ...draft, paths: remainingPaths, edges, transitions, nodes });
}
