import type { EdgeV3, ManifestV3, NodeV3 } from './contract-v3';

function isTraversable(kind: EdgeV3['kind'], a: NodeV3, b: NodeV3): boolean {
  switch (kind) {
    case 'path':
      // Same zone (outdoor = both null counts) on the same floor.
      return a.zoneId === b.zoneId && a.z === b.z;
    case 'entrance': {
      // Exactly one endpoint outdoors (zoneId null); indoor end must be z=0.
      const aOut = a.zoneId === null;
      const bOut = b.zoneId === null;
      if (aOut === bOut) return false;
      return aOut ? b.z === 0 : a.z === 0;
    }
    case 'stairs':
    case 'elevator':
      // Vertical move inside one building: same non-null zone, different floors.
      return a.zoneId !== null && a.zoneId === b.zoneId && a.z !== b.z;
    default:
      return false;
  }
}

/**
 * Dijkstra over EXPLICIT v3 edges only. Never synthesizes connections.
 * Same-zone/same-floor path cost is the stored edge meters.
 */
export function shortestPathV3(
  manifest: ManifestV3,
  start: string,
  goal: string,
): string[] | null {
  const byId = new Map<string, NodeV3>();
  for (const n of manifest.nodes) byId.set(n.id, n);
  if (!byId.has(start) || !byId.has(goal)) return null;
  if (start === goal) return [start];

  const adj = new Map<string, Array<{ to: string; meters: number }>>();
  for (const id of byId.keys()) adj.set(id, []);
  for (const edge of manifest.edges) {
    if (!(edge.meters > 0)) continue;
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) continue;
    if (!isTraversable(edge.kind, a, b)) continue;
    adj.get(edge.from)!.push({ to: edge.to, meters: edge.meters });
    adj.get(edge.to)!.push({ to: edge.from, meters: edge.meters });
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  for (const id of byId.keys()) {
    dist.set(id, Infinity);
    prev.set(id, null);
  }
  dist.set(start, 0);
  const visited = new Set<string>();

  for (;;) {
    let current: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) {
        best = d;
        current = id;
      }
    }
    if (current === null || best === Infinity) return null;
    if (current === goal) break;
    visited.add(current);
    for (const { to, meters } of adj.get(current)!) {
      const alt = best + meters;
      if (alt < dist.get(to)!) {
        dist.set(to, alt);
        prev.set(to, current);
      }
    }
  }

  const path: string[] = [];
  let cursor: string | null = goal;
  while (cursor !== null) {
    path.unshift(cursor);
    cursor = prev.get(cursor)!;
  }
  return path[0] === start ? path : null;
}
