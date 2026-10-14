import type { MapDraft, MapManifest, MapNode, MapTransition } from '../map-contract';
import type { Selection } from './tool-state';

export type MapView = 'editor' | 'visitor' | 'survey';
export type ProjectedLine = { pathId: string; frameId: string; nodeIds: string[]; legacyEdge?: [string, string] };
export type MapProjection = { nodes: MapNode[]; lines: ProjectedLine[]; handles: MapNode[]; transitions: MapTransition[] };

/** A read-only display model. The full graph stays intact for routing and survey consumers. */
export function projectMap(document: MapDraft | MapManifest, view: MapView, selection: Selection): MapProjection {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const nodes = document.nodes.filter((node) => view === 'survey' || (view === 'visitor' ? node.visitorVisible : !node.generated));
  const visibleIds = new Set(nodes.map((node) => node.id));
  const lines: ProjectedLine[] = [];
  if (view !== 'visitor') {
    const groupedPairs = new Set<string>();
    for (const path of document.paths ?? []) {
      if (path.kind === 'stair') continue;
      let stretch: string[] = [];
      let frameId = '';
      const flush = () => { if (stretch.length > 1) lines.push({ pathId: path.id, frameId, nodeIds: stretch }); stretch = []; };
      for (const id of path.nodeIds) {
        const node = nodeById.get(id);
        if (!node) { flush(); continue; }
        if (frameId && frameId !== node.frameId) flush();
        if (stretch.length === 0) frameId = node.frameId;
        stretch.push(id);
      }
      flush();
      for (let index = 1; index < path.nodeIds.length; index++) {
        const a = path.nodeIds[index - 1]!, b = path.nodeIds[index]!;
        groupedPairs.add(a < b ? `${a}\u001f${b}` : `${b}\u001f${a}`);
      }
    }
    // Old documents may contain graph edges that were never grouped into paths.
    for (const edge of document.edges) {
      const a = nodeById.get(edge.from), b = nodeById.get(edge.to);
      const key = edge.from < edge.to ? `${edge.from}\u001f${edge.to}` : `${edge.to}\u001f${edge.from}`;
      if (edge.kind !== 'path' || groupedPairs.has(key) || !a || !b || a.frameId !== b.frameId) continue;
      lines.push({ pathId: `legacy:${key}`, frameId: a.frameId, nodeIds: [a.id, b.id], legacyEdge: [a.id, b.id] });
    }
  }
  const handles = view === 'editor' && selection.kind === 'path'
    ? (() => {
      const path = document.paths?.find((item) => item.id === selection.id);
      if (!path) return [];
      const authoredControls = new Set(path.controlNodeIds ?? []);
      for (const id of path.nodeIds) if (!nodeById.get(id)?.generated) authoredControls.add(id);
      const start = path.nodeIds.map((id) => nodeById.get(id)).find((node) => node && !node.generated);
      const end = [...path.nodeIds].reverse().map((id) => nodeById.get(id)).find((node) => node && !node.generated);
      if (start) authoredControls.add(start.id);
      if (end) authoredControls.add(end.id);
      return path.nodeIds.filter((id, index) => authoredControls.has(id) && path.nodeIds.indexOf(id) === index)
        .map((id) => nodeById.get(id)).filter((node): node is MapNode => Boolean(node));
    })() : [];
  const transitions = view === 'editor'
    ? document.transitions.filter((transition) => transition.nodeIds.some((id) => visibleIds.has(id)))
    : view === 'visitor'
      ? document.transitions.filter((transition) => transition.nodeIds.some((id) => nodeById.get(id)?.visitorVisible === true))
    : [];
  return { nodes, lines, handles, transitions };
}
