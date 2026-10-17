import type { DraftV3 } from './draft.js';
import type { MapDraft } from './map-contract.js';

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

export function validatePathGroups(draft: DraftV3): string[] {
  const errors: string[] = [];
  if (draft.paths === undefined) return errors;

  const nodeIds = new Set(draft.nodes.map((node) => node.id));
  const edgeKeys = new Set(draft.edges.map((edge) => edgeKey(edge.from, edge.to)));
  const seenPathIds = new Set<string>();

  for (const path of draft.paths) {
    if (seenPathIds.has(path.id)) errors.push(`duplicate path id: ${path.id}`);
    seenPathIds.add(path.id);

    for (const nodeId of path.nodeIds) {
      if (!nodeIds.has(nodeId)) errors.push(`path ${path.id} refers to unknown node ${nodeId}`);
    }

    for (let i = 1; i < path.nodeIds.length; i++) {
      const prev = path.nodeIds[i - 1]!;
      const curr = path.nodeIds[i]!;
      if (prev === curr) {
        errors.push(`path ${path.id} has consecutive identical node id ${curr}`);
        continue;
      }
      if (nodeIds.has(prev) && nodeIds.has(curr) && !edgeKeys.has(edgeKey(prev, curr))) {
        errors.push(`path ${path.id} is missing connection ${prev}->${curr}`);
      }
    }

    if (path.controlNodeIds !== undefined) {
      let searchFrom = 0;
      for (const controlNodeId of path.controlNodeIds) {
        const nextIndex = path.nodeIds.indexOf(controlNodeId, searchFrom);
        if (nextIndex >= 0) {
          searchFrom = nextIndex + 1;
          continue;
        }
        if (!path.nodeIds.includes(controlNodeId)) {
          errors.push(`path ${path.id} control node ${controlNodeId} is not in path sequence`);
        } else {
          errors.push(`path ${path.id} control nodes are out of order at ${controlNodeId}`);
        }
      }
    }
  }

  return errors;
}

/**
 * V5 path groups: regular groups use ordinary edges; stair groups explicitly
 * reference the paired stair transition and contain exactly its two landings.
 */
export function validatePathGroupsV5(draft: MapDraft): string[] {
  const errors: string[] = [];
  if (draft.paths === undefined) return errors;

  const nodeIds = new Set(draft.nodes.map((node) => node.id));
  const edgeKindByPair = new Map<string, string>();
  for (const edge of draft.edges) {
    const key = edgeKey(edge.from, edge.to);
    if (edgeKindByPair.has(key)) errors.push(`duplicate edge for node pair ${edge.from} ${edge.to}`);
    else edgeKindByPair.set(key, edge.kind);
  }
  const transitionPairs = new Set<string>();
  const transitionKindForEdge: Record<string, string> = { entrance: 'entrance', stairs: 'stair', elevator: 'elevator' };
  for (const transition of draft.transitions) {
    const key = edgeKey(transition.nodeIds[0], transition.nodeIds[1]);
    if (transitionPairs.has(key)) errors.push(`duplicate transition for node pair ${transition.nodeIds[0]} ${transition.nodeIds[1]}`);
    transitionPairs.add(key);
    if (transitionKindForEdge[edgeKindByPair.get(key) ?? ''] !== transition.kind) {
      errors.push(`transition ${transition.id} must match its transition edge`);
    }
  }
  const seenPathIds = new Set<string>();
  const seenStairGroups = new Set<string>();

  for (const path of draft.paths) {
    if (seenPathIds.has(path.id)) errors.push(`duplicate path id: ${path.id}`);
    seenPathIds.add(path.id);

    for (const nodeId of path.nodeIds) {
      if (!nodeIds.has(nodeId)) errors.push(`path ${path.id} refers to unknown node ${nodeId}`);
    }

    for (let i = 1; i < path.nodeIds.length; i++) {
      const prev = path.nodeIds[i - 1]!;
      const curr = path.nodeIds[i]!;
      if (prev === curr) {
        errors.push(`path ${path.id} has consecutive identical node id ${curr}`);
        continue;
      }
      if (!nodeIds.has(prev) || !nodeIds.has(curr)) continue;
      const kind = edgeKindByPair.get(edgeKey(prev, curr));
      if (!kind) {
        errors.push(`path ${path.id} is missing connection ${prev}->${curr}`);
      } else if (path.kind === 'regular' && kind !== 'path') {
        errors.push(`path ${path.id} traverses transition edge ${prev} ${curr}`);
      }
    }

    if (path.kind === 'stair') {
      const transition = path.transitionId ? draft.transitions.find((item) => item.id === path.transitionId) : undefined;
      if (path.transitionId && seenStairGroups.has(path.transitionId)) errors.push(`duplicate stair path group for transition ${path.transitionId}`);
      if (path.transitionId) seenStairGroups.add(path.transitionId);
      if (path.nodeIds.length !== 2 || !transition || transition.kind !== 'stair' ||
          transition.nodeIds[0] !== path.nodeIds[0] || transition.nodeIds[1] !== path.nodeIds[1]) {
        errors.push(`stair path ${path.id} must reference its matching stair transition and ordered stair landing pair`);
      }
    } else if (path.transitionId !== undefined) {
      errors.push(`regular path ${path.id} cannot reference a transition`);
    }

    if (path.controlNodeIds !== undefined) {
      let searchFrom = 0;
      for (const controlNodeId of path.controlNodeIds) {
        const nextIndex = path.nodeIds.indexOf(controlNodeId, searchFrom);
        if (nextIndex >= 0) {
          searchFrom = nextIndex + 1;
          continue;
        }
        if (!path.nodeIds.includes(controlNodeId)) {
          errors.push(`path ${path.id} control node ${controlNodeId} is not in path sequence`);
        } else {
          errors.push(`path ${path.id} control nodes are out of order at ${controlNodeId}`);
        }
      }
    }
  }

  return errors;
}
