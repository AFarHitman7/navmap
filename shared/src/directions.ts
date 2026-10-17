export type DirectionKind = 'start' | 'walk' | 'entrance' | 'stairs' | 'elevator' | 'arrival';
export type DirectionInstruction = { kind: DirectionKind; text: string; frameId: string };
export type Directions = { instructions: DirectionInstruction[]; totalMeters?: number };
export type DirectionsMap = {
  nodes: Array<{ id: string; name: string; frameId: string; zoneId: string | null; z: number; generated?: boolean; visitorVisible: boolean }>;
  edges: Array<{ from: string; to: string; kind: 'path' | 'entrance' | 'stairs' | 'elevator'; cost: number; meters?: number }>;
  places: Array<{ nodeId: string; name: string }>;
  indoorZones: Array<{ id: string; name: string; floors: Array<{ z: number; label: string }> }>;
};

function locationLabel(map: DirectionsMap, nodeId: string): string {
  const place = map.places.find((candidate) => candidate.nodeId === nodeId);
  if (place) return place.name;
  const node = map.nodes.find((candidate) => candidate.id === nodeId)!;
  if (!node.generated && node.visitorVisible) return node.name;
  const zone = map.indoorZones.find((candidate) => candidate.id === node.zoneId);
  const floor = zone?.floors.find((candidate) => candidate.z === node.z)?.label;
  return zone ? `${zone.name} · ${floor ?? `Floor ${node.z}`}` : 'Outdoors';
}

function routeEdge(map: DirectionsMap, from: string, to: string) {
  return map.edges.filter((edge) => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from))
    .sort((a, b) => a.cost - b.cost)[0];
}

export function buildDirections(map: DirectionsMap, nodeIds: string[]): Directions {
  if (!nodeIds.length) return { instructions: [] };
  const nodeById = new Map(map.nodes.map((node) => [node.id, node]));
  const first = nodeById.get(nodeIds[0]!);
  if (!first) return { instructions: [] };
  const instructions: DirectionInstruction[] = [{ kind: 'start', text: `Start at ${locationLabel(map, first.id)}`, frameId: first.frameId }];
  if (nodeIds.length === 1) return { instructions };

  const routeEdges = nodeIds.slice(1).map((id, index) => routeEdge(map, nodeIds[index]!, id));
  const totalMeters = routeEdges.every((edge) => edge && edge.meters !== undefined && Number.isFinite(edge.meters) && edge.meters > 0)
    ? routeEdges.reduce((sum, edge) => sum + edge!.meters!, 0) : undefined;
  let pendingWalkEnd: string | null = null;
  const flushWalk = () => {
    if (!pendingWalkEnd) return;
    const node = nodeById.get(pendingWalkEnd);
    if (node) instructions.push({ kind: 'walk', text: `Walk to ${locationLabel(map, node.id)}`, frameId: node.frameId });
    pendingWalkEnd = null;
  };

  for (let index = 0; index < routeEdges.length; index++) {
    const edge = routeEdges[index];
    const target = nodeById.get(nodeIds[index + 1]!);
    if (!edge || !target) { flushWalk(); continue; }
    if (edge.kind === 'path') { pendingWalkEnd = target.id; continue; }
    flushWalk();
    const kind: DirectionKind = edge.kind === 'entrance' ? 'entrance' : edge.kind;
    const action = edge.kind === 'entrance' ? 'Use entrance to'
      : edge.kind === 'stairs' || edge.kind === 'elevator' ? `Take ${edge.kind} to` : `Walk to`;
    instructions.push({ kind, text: `${action} ${locationLabel(map, target.id)}`, frameId: target.frameId });
  }
  flushWalk();
  const last = nodeById.get(nodeIds[nodeIds.length - 1]!);
  if (last) instructions.push({ kind: 'arrival', text: `Arrive at ${locationLabel(map, last.id)}`, frameId: last.frameId });
  return totalMeters === undefined ? { instructions } : { instructions, totalMeters };
}
