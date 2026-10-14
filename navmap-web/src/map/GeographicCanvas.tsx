import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapDraft, MapManifest, Position } from '../map-contract';

export type CanvasCallbacks = {
  onPointClick?: (position: Position, frameId: string) => void;
  onNodeMove?: (nodeId: string, position: Position, frameId: string) => void;
  onNodeClick?: (nodeId: string) => void;
  onPathClick?: (pathId: string) => void;
};
export type CanvasProps = { document: MapDraft | MapManifest; activeFrameId: string; mode: string; callbacks: CanvasCallbacks; view?: 'editor' | 'visitor' | 'survey' };

export function GeographicCanvas({ document, activeFrameId, mode, callbacks, view = 'editor' }: CanvasProps) {
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
      if (now.mode !== 'place-node' && now.mode !== 'draw-path') return;
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
    const nodes = document.nodes.filter((node) => node.position.kind === 'geographic' && node.frameId === activeFrameId);
    const byId = new Map(document.nodes.map((node) => [node.id, node]));
    for (const path of document.paths ?? []) {
      const points = path.nodeIds.flatMap((id) => { const n = byId.get(id); return n?.position.kind === 'geographic' && n.frameId === activeFrameId ? [[n.position.lat, n.position.lng] as L.LatLngTuple] : []; });
      if (points.length > 1) L.polyline(points, { color: '#16776c', weight: 3 }).addTo(group);
    }
    for (const node of nodes) {
      if (node.position.kind !== 'geographic') continue;
      const marker = L.marker([node.position.lat, node.position.lng], {
        draggable: mode === 'move' && view === 'editor',
        icon: L.divIcon({ className: 'v5-node-marker', html: '<span aria-hidden="true"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      }).addTo(group);
      marker.bindTooltip(node.name);
      marker.on('click', () => callbacks.onNodeClick?.(node.id));
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        callbacks.onNodeMove?.(node.id, { kind: 'geographic', lat: p.lat, lng: p.lng }, activeFrameId);
      });
    }
  }, [document, activeFrameId, mode, callbacks, view, mapReady]);
  return <div ref={host} className="map-canvas" role="application" aria-label="Geographic map" />;
}
