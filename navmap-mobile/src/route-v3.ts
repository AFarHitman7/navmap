import type { EdgeV3, ManifestV3, NodeV3 } from './contract-v3';
import type { MapDraft, MapEdge, MapManifest, MapNode } from './map-contract';

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

function isTraversableV5(kind: MapEdge['kind'], a: MapNode, b: MapNode): boolean {
  switch (kind) {
    case 'path':
      // Ordinary edges never cross frames.
      return a.frameId === b.frameId;
    case 'entrance': {
      const aOut = a.zoneId === null;
      const bOut = b.zoneId === null;
      if (aOut === bOut) return false;
      return aOut ? b.z === 0 : a.z === 0;
    }
    case 'stairs':
    case 'elevator':
      return a.zoneId !== null && a.zoneId === b.zoneId && a.z !== b.z && a.frameId !== b.frameId;
    default:
      return false;
  }
}

function dijkstra(ids: string[], adj: Map<string, Array<{ to: string; cost: number }>>, start: string, goal: string): string[] | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  for (const id of ids) {
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
    for (const { to, cost } of adj.get(current)!) {
      const alt = best + cost;
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

/**
 * Dijkstra over EXPLICIT v3 edges only. Never synthesizes connections.
 * Same-zone/same-floor path cost is the stored edge meters.
 * Pure TS, no Node APIs (Hermes-compatible).
 */
export function shortestPathV3(manifest: ManifestV3, start: string, goal: string): string[] | null;
export function shortestPathV3(manifest: MapDraft | MapManifest, start: string, goal: string): string[] | null;
export function shortestPathV3(
  manifest: ManifestV3 | MapDraft | MapManifest,
  start: string,
  goal: string,
): string[] | null {
  if ((manifest as MapDraft).schemaVersion === 5) return shortestPathV5(manifest as MapDraft | MapManifest, start, goal);
  return shortestPathLegacy(manifest as ManifestV3, start, goal);
}

function shortestPathLegacy(manifest: ManifestV3, start: string, goal: string): string[] | null {
  const byId = new Map<string, NodeV3>();
  for (const n of manifest.nodes) byId.set(n.id, n);
  if (!byId.has(start) || !byId.has(goal)) return null;
  if (start === goal) return [start];

  const adj = new Map<string, Array<{ to: string; cost: number }>>();
  for (const id of byId.keys()) adj.set(id, []);
  for (const edge of manifest.edges) {
    if (!(edge.meters > 0)) continue;
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) continue;
    if (!isTraversable(edge.kind, a, b)) continue;
    adj.get(edge.from)!.push({ to: edge.to, cost: edge.meters });
    adj.get(edge.to)!.push({ to: edge.from, cost: edge.meters });
  }
  return dijkstra([...byId.keys()], adj, start, goal);
}

/**
 * Dijkstra over EXPLICIT V5 edges only. Routing weight is the stored edge
 * cost (physical metres are optional and never required); ordinary edges
 * never cross frames. Pure TS, no Node APIs (Hermes-compatible).
 */
function shortestPathV5(manifest: MapDraft | MapManifest, start: string, goal: string): string[] | null {
  const byId = new Map<string, MapNode>();
  for (const n of manifest.nodes) byId.set(n.id, n);
  if (!byId.has(start) || !byId.has(goal)) return null;
  if (start === goal) return [start];

  const adj = new Map<string, Array<{ to: string; cost: number }>>();
  for (const id of byId.keys()) adj.set(id, []);
  for (const edge of manifest.edges) {
    const cost = edge.cost > 0 ? edge.cost : edge.meters !== undefined && edge.meters > 0 ? edge.meters : NaN;
    if (!Number.isFinite(cost) || !(cost > 0)) continue;
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) continue;
    if (!isTraversableV5(edge.kind, a, b)) continue;
    adj.get(edge.from)!.push({ to: edge.to, cost });
    adj.get(edge.to)!.push({ to: edge.from, cost });
  }
  return dijkstra([...byId.keys()], adj, start, goal);
}
