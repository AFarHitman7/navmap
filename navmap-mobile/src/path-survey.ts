import type { DraftV3, NodeV3 } from './contract-v3';
import type { MapDraft, MapManifest } from './map-contract';

export type PathPointLabel = { pathId: string; pathName: string; index: number; total: number };

type PathHolder = Pick<DraftV3, 'paths'> | Pick<MapDraft, 'paths'> | Pick<MapManifest, 'paths'>;

/** One-based ordered path memberships for a node; shared junctions list each path. */
export function pathPointLabels(map: PathHolder, nodeId: string): PathPointLabel[] {
  return (map.paths ?? []).flatMap((path) => {
    const index = path.nodeIds.indexOf(nodeId);
    return index < 0 ? [] : [{ pathId: path.id, pathName: path.name, index: index + 1, total: path.nodeIds.length }];
  });
}

/**
 * First-seen path-sequence position per node id, following path declaration
 * order. Shared junctions keep their earliest position, so they sort once.
 */
export function pathSequencePositions(map: PathHolder): Map<string, number> {
  const positions = new Map<string, number>();
  for (const path of map.paths ?? []) {
    for (const id of path.nodeIds) {
      if (!positions.has(id)) positions.set(id, positions.size);
    }
  }
  return positions;
}

/**
 * Order survey candidates: generated path members in first-seen path-sequence
 * order, then every other node in draft order. Manual nodes are retained (never
 * hidden or reordered into the route), and each node id appears at most once.
 * Accepts V4 or V5 maps; generated graph junctions keep stable ids.
 */
export function orderSurveyNodes<T extends Pick<NodeV3, 'id' | 'generated'>>(
  map: PathHolder,
  nodes: T[],
): T[] {
  const seen = new Set<string>();
  const unique = nodes.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });
  const positions = pathSequencePositions(map);
  const members: T[] = [];
  const rest: T[] = [];
  for (const n of unique) {
    if (n.generated === true && positions.has(n.id)) members.push(n);
    else rest.push(n);
  }
  members.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
  return [...members, ...rest];
}
