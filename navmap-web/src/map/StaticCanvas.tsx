import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapDraft, MapManifest } from '../map-contract';
import type { CanvasProps } from './GeographicCanvas';
import { fromLeaflet, toLeaflet } from './static-coordinates';
import { projectMap } from '../editor-v3/presentation';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

function backgroundUrl(document: MapDraft | MapManifest, assetId: string): string {
  const manifest = document as MapManifest;
  return 'version' in manifest
    ? `/api/venues/${encodeURIComponent(document.venueId)}/versions/${manifest.version}/assets/${encodeURIComponent(assetId)}`
    : `/api/admin/venues/${encodeURIComponent(document.venueId)}/layout-assets/${encodeURIComponent(assetId)}`;
}

export function StaticCanvas({ document, activeFrameId, mode, callbacks, view = 'editor', selection = { kind: 'none' }, showReferencePoints = false }: CanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const fitFrameRef = useRef('');
  const [mapReady, setMapReady] = useState(false);
  const propsRef = useRef({ document, activeFrameId, mode, callbacks, view });
  useLayoutEffect(() => { propsRef.current = { document, activeFrameId, mode, callbacks, view }; }, [document, activeFrameId, mode, callbacks, view]);
  useEffect(() => {
    if (!host.current) return;
    const map = L.map(host.current, { crs: L.CRS.Simple, minZoom: -4, maxZoom: 8, zoomSnap: 0.25, attributionControl: false });
    mapRef.current = map;
    layers.current = L.layerGroup().addTo(map);
    setMapReady(true);
    map.on('click', (event: L.LeafletMouseEvent) => {
      const current = propsRef.current;
      const frame = current.document.frames.find((item) => item.id === current.activeFrameId);
      if (!frame?.background || (current.mode !== 'place-node' && current.mode !== 'draw-path' && current.mode !== 'endpoints')) return;
      const p = fromLeaflet(event.latlng.lat, event.latlng.lng, frame.background.width, frame.background.height);
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
      current.callbacks.onPointClick?.(p, frame.id);
    });
    return () => { map.remove(); mapRef.current = null; layers.current = null; setMapReady(false); };
  }, [document.canvas.kind]);
  useEffect(() => {
    const map = mapRef.current, group = layers.current;
    if (!mapReady || !map || !group) return;
    group.clearLayers();
    const frame = document.frames.find((item) => item.id === activeFrameId);
    if (!frame?.background) { map.setView([0, 0], 0); return; }
    const bounds: L.LatLngBoundsExpression = [[0, 0], [frame.background.height, frame.background.width]];
    L.imageOverlay(backgroundUrl(document, frame.background.assetId), bounds).addTo(group);
    if (fitFrameRef.current !== frame.id) {
      map.fitBounds(bounds, { animate: false });
      fitFrameRef.current = frame.id;
    }
    const projection = projectMap(document, view, selection);
    const nodes = [...projection.nodes, ...(view === 'editor' && showReferencePoints ? document.nodes.filter((node) => node.generated) : [])]
      .filter((node) => node.frameId === frame.id && node.position.kind === 'local');
    const projectedNodeIds = new Set(projection.nodes.map((node) => node.id));
    const byId = new Map(document.nodes.filter((node) => node.frameId === frame.id).map((node) => [node.id, node]));
    for (const pathLine of projection.lines.filter((item) => item.frameId === frame.id)) {
      const points = pathLine.nodeIds.flatMap((id) => { const n = byId.get(id); return n?.position.kind === 'local' ? [toLeaflet(n.position, frame.background!.width, frame.background!.height)] : []; });
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
      if (node.position.kind !== 'local') continue;
      const point = toLeaflet(node.position, frame.background.width, frame.background.height);
      const handle = projection.handles.some((item) => item.id === node.id) && view === 'editor';
      const selected = selection.kind === 'node' && selection.id === node.id;
      const marker = L.marker(point, {
        draggable: view === 'editor' && mode === 'move',
        icon: L.divIcon({ className: `v5-node-marker${handle ? ' v5-path-handle' : ''}${selected ? ' is-selected' : ''}${node.generated ? ' is-reference' : ''}`, html: '<span aria-hidden="true"></span>', iconSize: [handle ? 14 : 18, handle ? 14 : 18], iconAnchor: [handle ? 7 : 9, handle ? 7 : 9] }),
      }).addTo(group);
      marker.getElement()?.setAttribute('data-node-id', node.id);
      marker.bindTooltip(node.name);
      marker.on('click', () => callbacks.onNodeClick?.(node.id));
      if (view === 'editor' && mode === 'move') marker.on('dragend', () => {
        const moved = marker.getLatLng();
        const p = fromLeaflet(moved.lat, moved.lng, frame.background!.width, frame.background!.height);
        callbacks.onNodeMove?.(node.id, p, frame.id);
      });
    }
    for (const transition of projection.transitions) {
      const pair = transition.nodeIds.map((id) => document.nodes.find((node) => node.id === id));
      const localIndex = pair.findIndex((node) => node?.frameId === frame.id && node.position.kind === 'local' && (view !== 'visitor' || projectedNodeIds.has(node.id)));
      const local = pair[localIndex], other = pair[1 - localIndex];
      if (!local || !other || local.position.kind !== 'local') continue;
      const semanticLabel = transition.kind === 'elevator' ? 'Elevator' : transition.kind === 'entrance' ? 'Entrance' : 'Stairs';
      const label = escapeHtml(view === 'visitor' ? semanticLabel : `${semanticLabel} · ${other.zoneId ? document.indoorZones.find((zone) => zone.id === other.zoneId)?.name ?? 'Building' : 'Outdoor'} floor ${other.z}`);
      const badge = L.marker(toLeaflet(local.position, frame.background.width, frame.background.height), { interactive: view === 'editor', icon: L.divIcon({ className: 'v5-transition-badge', html: `<span>${label}</span>`, iconSize: [132, 24], iconAnchor: [0, 12] }) }).addTo(group);
      badge.getElement()?.setAttribute('data-transition', transition.id);
      if (view === 'editor') badge.on('click', (event) => { L.DomEvent.stopPropagation(event); callbacks.onTransitionClick?.(transition.id); });
    }
  }, [document, activeFrameId, mode, callbacks, view, mapReady, selection, showReferencePoints]);
  return <div ref={host} className="map-canvas static-canvas" role="application" aria-label="Static floor plan" />;
}
