import type { DraftV3 } from './draft.js';

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
