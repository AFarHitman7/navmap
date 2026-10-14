import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapDraft, MapManifest, Position } from '../map-contract';
import { projectMap } from '../editor-v3/presentation';
import type { Selection } from '../editor-v3/tool-state';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export type CanvasCallbacks = {
  onPointClick?: (position: Position, frameId: string) => void;
  onNodeMove?: (nodeId: string, position: Position, frameId: string) => void;
  onNodeClick?: (nodeId: string) => void;
  onPathClick?: (pathId: string) => void;
  onTransitionClick?: (transitionId: string) => void;
  onEdgeClick?: (from: string, to: string) => void;
};
export type CanvasProps = { document: MapDraft | MapManifest; activeFrameId: string; mode: string; callbacks: CanvasCallbacks; view?: 'editor' | 'visitor' | 'survey'; selection?: Selection; showReferencePoints?: boolean };

export function GeographicCanvas({ document, activeFrameId, mode, callbacks, view = 'editor', selection = { kind: 'none' }, showReferencePoints = false }: CanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const fitFrameRef = useRef('');
  const [mapReady, setMapReady] = useState(false);
  const propsRef = useRef({ document, activeFrameId, mode, callbacks });
  useLayoutEffect(() => { propsRef.current = { document, activeFrameId, mode, callbacks }; }, [document, activeFrameId, mode, callbacks]);
  useEffect(() => {
    if (!host.current) return;
    const map = L.map(host.current, { maxZoom: 24, zoomSnap: 0.25 });
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 24, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors' });
    tiles.addTo(map);
    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layers.current = group;
    setMapReady(true);
    map.on('click', (event: L.LeafletMouseEvent) => {
      const now = propsRef.current;
      if (now.mode !== 'place-node' && now.mode !== 'draw-path' && now.mode !== 'endpoints') return;
      const frame = now.document.frames.find((candidate) => candidate.id === now.activeFrameId);
      if (!frame || frame.bounds.kind !== 'geographic') return;
      const { lat, lng } = event.latlng;
      if (lat > frame.bounds.north || lat < frame.bounds.south || lng < frame.bounds.west || lng > frame.bounds.east) return;
      now.callbacks.onPointClick?.({ kind: 'geographic', lat, lng }, frame.id);
    });
    return () => { map.remove(); mapRef.current = null; layers.current = null; setMapReady(false); };
  }, [document.canvas.kind]);
  useEffect(() => {
    const map = mapRef.current, group = layers.current;
    if (!mapReady || !map || !group) return;
    group.clearLayers();
    const frame = document.frames.find((item) => item.id === activeFrameId);
    if (frame?.bounds.kind === 'geographic' && fitFrameRef.current !== frame.id) {
      map.fitBounds([[frame.bounds.south, frame.bounds.west], [frame.bounds.north, frame.bounds.east]], { animate: false });
      fitFrameRef.current = frame.id;
    }
    const projection = projectMap(document, view, selection);
    const nodes = [...projection.nodes, ...(view === 'editor' && showReferencePoints ? document.nodes.filter((node) => node.generated) : [])]
      .filter((node) => node.position.kind === 'geographic' && node.frameId === activeFrameId);
    const byId = new Map(document.nodes.map((node) => [node.id, node]));
    const projectedNodeIds = new Set(projection.nodes.map((node) => node.id));
    for (const pathLine of projection.lines.filter((item) => item.frameId === activeFrameId)) {
      const points = pathLine.nodeIds.flatMap((id) => { const n = byId.get(id); return n?.position.kind === 'geographic' && n.frameId === activeFrameId ? [[n.position.lat, n.position.lng] as L.LatLngTuple] : []; });
      if (points.length < 2) continue;
      const selected = selection.kind === 'path' && selection.id === pathLine.pathId;
      const line = L.polyline(points, { color: selected ? '#b46926' : '#16776c', weight: selected ? 6 : 4 }).addTo(group);
      if (view === 'editor') line.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        if (pathLine.legacyEdge) callbacks.onEdgeClick?.(...pathLine.legacyEdge);
        else callbacks.onPathClick?.(pathLine.pathId);
      });
    }
    const renderedNodes = [...new Map([...nodes, ...projection.handles].map((node) => [node.id, node])).values()];
    for (const node of renderedNodes) {
      if (node.position.kind !== 'geographic') continue;
      const handle = projection.handles.some((item) => item.id === node.id) && view === 'editor';
      const selected = selection.kind === 'node' && selection.id === node.id;
      const marker = L.marker([node.position.lat, node.position.lng], {
        draggable: mode === 'move' && view === 'editor',
        icon: L.divIcon({ className: `v5-node-marker${handle ? ' v5-path-handle' : ''}${selected ? ' is-selected' : ''}${node.generated ? ' is-reference' : ''}`, html: '<span aria-hidden="true"></span>', iconSize: [handle ? 14 : 18, handle ? 14 : 18], iconAnchor: [handle ? 7 : 9, handle ? 7 : 9] }),
      }).addTo(group);
      marker.getElement()?.setAttribute('data-node-id', node.id);
      marker.bindTooltip(node.name);
      marker.on('click', () => callbacks.onNodeClick?.(node.id));
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        callbacks.onNodeMove?.(node.id, { kind: 'geographic', lat: p.lat, lng: p.lng }, activeFrameId);
      });
    }
    for (const transition of projection.transitions) {
      const pair = transition.nodeIds.map((id) => byId.get(id));
      const localIndex = pair.findIndex((node) => node?.frameId === activeFrameId && node.position.kind === 'geographic' && (view !== 'visitor' || projectedNodeIds.has(node.id)));
      const local = pair[localIndex], other = pair[1 - localIndex];
      if (!local || !other || local.position.kind !== 'geographic') continue;
      const semanticLabel = transition.kind === 'elevator' ? 'Elevator' : transition.kind === 'entrance' ? 'Entrance' : 'Stairs';
      const label = escapeHtml(view === 'visitor' ? semanticLabel : `${semanticLabel} · ${other.zoneId ? document.indoorZones.find((zone) => zone.id === other.zoneId)?.name ?? 'Building' : 'Outdoor'} floor ${other.z}`);
      const badge = L.marker([local.position.lat, local.position.lng], { interactive: view === 'editor', icon: L.divIcon({ className: 'v5-transition-badge', html: `<span>${label}</span>`, iconSize: [132, 24], iconAnchor: [0, 12] }) }).addTo(group);
      badge.getElement()?.setAttribute('data-transition', transition.id);
      if (view === 'editor') badge.on('click', (event) => { L.DomEvent.stopPropagation(event); callbacks.onTransitionClick?.(transition.id); });
    }
  }, [document, activeFrameId, mode, callbacks, view, mapReady, selection, showReferencePoints]);
  return <div ref={host} className="map-canvas" role="application" aria-label="Geographic map" />;
}
