import { parseMapDraft, type MapDraft, type MapNode, type Position } from '../map-contract';
import { connectNodesV5, addNodeAtV5 } from './model';
import { addDrawnPathV5, type PathVertexV5 } from './paths';

export type Endpoint = string | { nodeId: string } | { frameId: string; position: Position; name?: string };

function positionDelta(a: Position, b: Position): number | null {
  if (a.kind !== b.kind) return null;
  if (a.kind === 'local' && b.kind === 'local') return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  if (a.kind === 'geographic' && b.kind === 'geographic') return Math.max(Math.abs(a.lat - b.lat), Math.abs(a.lng - b.lng));
  return null;
}

function endpoint(draft: MapDraft, value: Endpoint): [MapDraft, MapNode] {
  if (typeof value === 'string' || 'nodeId' in value) {
    const id = typeof value === 'string' ? value : value.nodeId;
    const node = draft.nodes.find((item) => item.id === id);
    if (!node) throw new Error(`Unknown node ${id}`);
    return [draft, node];
  }
  const existing = draft.nodes
    .flatMap((node) => {
      if (node.frameId !== value.frameId) return [];
      const delta = positionDelta(node.position, value.position);
      return delta !== null && delta <= 1e-9 ? [{ node, delta }] : [];
    })
    .sort((a, b) => a.delta - b.delta || a.node.id.localeCompare(b.node.id))[0]?.node;
  if (existing) return [draft, existing];
  const next = addNodeAtV5(draft, value.frameId, value.position, value.name);
  return [next, next.nodes.at(-1)!];
}

function idFor(prefix: string, used: string[]): string {
  let id = prefix;
  for (let suffix = 2; used.includes(id); suffix++) id = `${prefix}-${suffix}`;
  return id;
}

export function addRegularNode(draft: MapDraft, frameId: string, position: Position, name: string): MapDraft {
  const next = addNodeAtV5(draft, frameId, position, name);
  const node = next.nodes.at(-1)!;
  if (node.zoneId === null) throw new Error('Regular nodes must be indoors');
  return next;
}

export function addEntrance(draft: MapDraft, indoor: Endpoint, outdoor: Endpoint, name: string, meters?: number): MapDraft {
  let work = draft;
  let inside: MapNode;
  let outside: MapNode;
  [work, inside] = endpoint(work, indoor);
  [work, outside] = endpoint(work, outdoor);
  if (inside.zoneId === null || outside.zoneId !== null) throw new Error('Entrance endpoints must be indoor then outdoor');
  const next = connectNodesV5(work, inside.id, outside.id, 'entrance', meters);
  const transition = next.transitions.at(-1)!;
  return parseMapDraft({ ...next, transitions: next.transitions.map((item) => item.id === transition.id ? { ...item, name: name.trim() || item.name } : item) });
}

export function addStair(draft: MapDraft, lower: Endpoint, upper: Endpoint, name: string, meters?: number): MapDraft {
  let work = draft;
  let from: MapNode;
  let to: MapNode;
  [work, from] = endpoint(work, lower);
  [work, to] = endpoint(work, upper);
  if (!from.zoneId || from.zoneId !== to.zoneId || from.z >= to.z) throw new Error('Stairs must connect lower to upper floors in one building');
  const next = connectNodesV5(work, from.id, to.id, 'stairs', meters);
  const transition = next.transitions.at(-1)!;
  return parseMapDraft({ ...next, transitions: next.transitions.map((item) => item.id === transition.id ? { ...item, name: name.trim() || item.name } : item) });
}

export function addRegularPath(draft: MapDraft, vertices: Array<Endpoint | PathVertexV5>, name: string): MapDraft {
  if (vertices.length < 2) throw new Error('Path needs at least two points');
  if (vertices.some((vertex) => typeof vertex !== 'string' && 'incomingKind' in vertex && vertex.incomingKind === 'stairs')) {
    throw new Error('Regular paths cannot contain stair toggles; create a separate stair transition.');
  }
  let work = draft;
  const resolved: PathVertexV5[] = vertices.map((vertex) => {
    if (typeof vertex === 'string') {
      const node = work.nodes.find((item) => item.id === vertex);
      if (!node) throw new Error(`Unknown node ${vertex}`);
      return { frameId: node.frameId, position: node.position, nodeId: node.id };
    }
    if ('nodeId' in vertex && !('frameId' in vertex)) {
      const node = work.nodes.find((item) => item.id === vertex.nodeId);
      if (!node) throw new Error(`Unknown node ${vertex.nodeId}`);
      return { frameId: node.frameId, position: node.position, nodeId: node.id };
    }
    if ('frameId' in vertex && 'position' in vertex) {
      if ('nodeId' in vertex && vertex.nodeId) return vertex;
      work = addNodeAtV5(work, vertex.frameId, vertex.position, 'Path point');
      const node = work.nodes.at(-1)!;
      return { frameId: node.frameId, position: node.position, nodeId: node.id };
    }
    throw new Error('Path vertices must be existing nodes or positioned frame points');
  });
  const next = addDrawnPathV5(work, resolved, name);
  return parseMapDraft({ ...next, paths: next.paths?.map((path) => path === next.paths!.at(-1) ? { ...path, name: name.trim() || path.name, kind: 'regular' } : path) });
}

export function addStairPath(draft: MapDraft, transitionId: string, name: string): MapDraft {
  const transition = draft.transitions.find((item) => item.id === transitionId);
  if (!transition || transition.kind !== 'stair') throw new Error(`Unknown stair transition ${transitionId}`);
  if (draft.paths?.some((path) => path.transitionId === transitionId)) throw new Error('This stair transition already has a path group');
  const id = idFor(`path-${transitionId}`, (draft.paths ?? []).map((path) => path.id));
  return parseMapDraft({ ...draft, paths: [...(draft.paths ?? []), { id, name: name.trim() || transition.name, kind: 'stair', nodeIds: [...transition.nodeIds], transitionId }] });
}

export function removeTransition(draft: MapDraft, id: string, options: { removeEndpoints?: boolean } = {}): MapDraft {
  const transition = draft.transitions.find((item) => item.id === id);
  if (!transition) throw new Error(`Unknown transition ${id}`);
  const [a, b] = transition.nodeIds;
  const path = (draft.paths ?? []).find((item) => item.transitionId === id);
  const paths = (draft.paths ?? []).filter((item) => item.transitionId !== id);
  let nodes = draft.nodes;
  if (options.removeEndpoints) {
    for (const nodeId of [a, b]) {
      if (draft.places.some((item) => item.nodeId === nodeId) || draft.anchors.some((item) => item.nodeId === nodeId) ||
          draft.edges.some((edge) => (edge.from === nodeId || edge.to === nodeId) && !(edge.from === a && edge.to === b) && !(edge.from === b && edge.to === a)) ||
          draft.paths?.some((item) => item.id !== path?.id && item.nodeIds.includes(nodeId))) {
        throw new Error(`Cannot remove shared, place-linked, or anchored endpoint ${nodeId}`);
      }
    }
    nodes = nodes.filter((node) => node.id !== a && node.id !== b);
  }
  const key = (x: string, y: string) => x < y ? `${x}\0${y}` : `${y}\0${x}`;
  return parseMapDraft({ ...draft, paths, nodes, edges: draft.edges.filter((edge) => key(edge.from, edge.to) !== key(a, b)), transitions: draft.transitions.filter((item) => item.id !== id) });
}
