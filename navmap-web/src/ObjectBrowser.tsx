import { useMemo, useState } from 'react';
import type { MapDraft, MapManifest, MapNode, MapPath } from './map-contract';
import type { Selection } from './editor-v3/tool-state';

type Props = { document: MapDraft | MapManifest; selection: Selection; onSelect: (selection: Selection) => void };
const text = (value: string) => value.trim().toLocaleLowerCase();

function nodeKind(node: MapNode, document: MapDraft | MapManifest): string {
  if (node.generated) return 'Reference point';
  if (document.transitions.some((item) => item.nodeIds.includes(node.id) && item.kind === 'stair')) return 'Stair landing';
  if (document.transitions.some((item) => item.nodeIds.includes(node.id) && item.kind === 'entrance')) return 'Entrance';
  return document.places.some((place) => place.nodeId === node.id) ? 'Place' : 'Node';
}
function floorLabel(node: MapNode, document: MapDraft | MapManifest): string {
  const zone = node.zoneId ? document.indoorZones.find((item) => item.id === node.zoneId) : null;
  const floor = zone?.floors.find((item) => item.z === node.z);
  return `${zone?.name ?? 'Outdoor'}${floor ? ` · ${floor.label}` : ''}`;
}
function transitionTitle(item: MapDraft['transitions'][number], document: MapDraft | MapManifest): string {
  if (!/^(stairs?|elevator|entrance)\s+.+↔/i.test(item.name)) return item.name;
  const labels = item.nodeIds.map((id) => document.nodes.find((node) => node.id === id)).filter((node): node is MapNode => Boolean(node)).map((node) => floorLabel(node, document));
  return `${item.kind === 'stair' ? 'Stairs' : item.kind === 'elevator' ? 'Elevator' : 'Entrance'} · ${labels.join(' ↔ ')}`;
}
function transitionMeta(item: MapDraft['transitions'][number]): string {
  return item.kind === 'stair' ? 'Stair transition' : item.kind === 'elevator' ? 'Elevator transition' : 'Entrance transition';
}
function pathMeta(path: MapPath, document: MapDraft | MapManifest): string {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const members = path.nodeIds.map((id) => nodeById.get(id)).filter((node): node is MapNode => Boolean(node));
  const floors = [...new Set(members.map((node) => floorLabel(node, document)))];
  const edges = path.nodeIds.slice(1).map((id, index) => {
    const a = path.nodeIds[index]!;
    return document.edges.find((edge) => (edge.from === a && edge.to === id) || (edge.to === a && edge.from === id));
  });
  const meters = edges.length && edges.every((edge) => edge?.meters !== undefined)
    ? `${edges.reduce((sum, edge) => sum + edge!.meters!, 0).toFixed(0)} m` : undefined;
  return [path.kind === 'stair' ? 'Stair path' : 'Path', floors.join(' → '), meters].filter(Boolean).join(' · ');
}

export function ObjectBrowser({ document, selection, onSelect }: Props) {
  const [tab, setTab] = useState<'nodes' | 'paths'>('nodes');
  const [query, setQuery] = useState('');
  const needle = text(query);
  const nodes = useMemo(() => document.nodes.filter((node) => !node.generated)
    .filter((node) => !needle || text(`${node.name} ${nodeKind(node, document)} ${floorLabel(node, document)}`).includes(needle)), [document, needle]);
  const paths = useMemo(() => (document.paths ?? []).filter((path) => !needle || text(`${path.name} ${pathMeta(path, document)}`).includes(needle)), [document, needle]);
  const transitions = useMemo(() => document.transitions.filter((item) => !needle || text(`${transitionTitle(item, document)} ${transitionMeta(item)}`).includes(needle)), [document, needle]);
  return <section className="object-browser" aria-label="Map objects">
    <h2>Objects</h2>
    <div className="object-browser-tabs" role="tablist" aria-label="Object type">
      <button type="button" role="tab" aria-selected={tab === 'nodes'} onClick={() => setTab('nodes')}>Nodes</button>
      <button type="button" role="tab" aria-selected={tab === 'paths'} onClick={() => setTab('paths')}>Paths</button>
    </div>
    <label className="object-browser-search">Search objects<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, type, or floor" /></label>
    {tab === 'nodes' ? <ul className="object-browser-list" aria-label="Nodes">
      {nodes.map((node) => <li key={node.id}><button type="button" aria-pressed={selection.kind === 'node' && selection.id === node.id} onClick={() => onSelect({ kind: 'node', id: node.id })}>
        <span>{node.name}<small>{nodeKind(node, document)} · {floorLabel(node, document)}</small></span><span aria-hidden="true">›</span>
      </button></li>)}
      {transitions.map((item) => <li key={item.id}><button type="button" aria-pressed={selection.kind === 'transition' && selection.id === item.id} onClick={() => onSelect({ kind: 'transition', id: item.id })}>
        <span>{transitionTitle(item, document)}<small>{transitionMeta(item)}</small></span><span aria-hidden="true">›</span>
      </button></li>)}
      {!nodes.length && !transitions.length && <li className="object-browser-empty">No matching nodes.</li>}
    </ul> : <ul className="object-browser-list" aria-label="Paths">
      {paths.map((path) => <li key={path.id}><button type="button" aria-pressed={selection.kind === 'path' && selection.id === path.id} onClick={() => onSelect({ kind: 'path', id: path.id })}>
        <span>{path.name}<small>{pathMeta(path, document)}</small></span><span aria-hidden="true">›</span>
      </button></li>)}
      {transitions.map((item) => <li key={item.id}><button type="button" aria-pressed={selection.kind === 'transition' && selection.id === item.id} onClick={() => onSelect({ kind: 'transition', id: item.id })}>
        <span>{transitionTitle(item, document)}<small>{transitionMeta(item)}</small></span><span aria-hidden="true">›</span>
      </button></li>)}
      {!paths.length && !transitions.length && <li className="object-browser-empty">No matching paths.</li>}
    </ul>}
  </section>;
}
