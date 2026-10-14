import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapDraft, MapManifest } from '../map-contract';
import type { CanvasProps } from './GeographicCanvas';
import { fromLeaflet, toLeaflet } from './static-coordinates';

function backgroundUrl(document: MapDraft | MapManifest, assetId: string): string {
  const manifest = document as MapManifest;
  return 'version' in manifest
    ? `/api/venues/${encodeURIComponent(document.venueId)}/versions/${manifest.version}/assets/${encodeURIComponent(assetId)}`
    : `/api/admin/venues/${encodeURIComponent(document.venueId)}/layout-assets/${encodeURIComponent(assetId)}`;
}

export function StaticCanvas({ document, activeFrameId, mode, callbacks, view = 'editor' }: CanvasProps) {
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
      if (!frame?.background || (current.mode !== 'place-node' && current.mode !== 'draw-path')) return;
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
    const nodes = document.nodes.filter((node) => node.frameId === frame.id && node.position.kind === 'local');
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const path of document.paths ?? []) {
      const points = path.nodeIds.flatMap((id) => { const n = byId.get(id); return n?.position.kind === 'local' ? [toLeaflet(n.position, frame.background!.width, frame.background!.height)] : []; });
      if (points.length > 1) L.polyline(points, { color: '#16776c', weight: 3 }).addTo(group);
    }
    for (const node of nodes) {
      if (node.position.kind !== 'local' || (view === 'visitor' && !node.visitorVisible)) continue;
      const point = toLeaflet(node.position, frame.background.width, frame.background.height);
      const marker = L.marker(point, {
        draggable: view === 'editor' && mode === 'move',
        icon: L.divIcon({ className: 'v5-node-marker', html: '<span aria-hidden="true"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      }).addTo(group);
      marker.bindTooltip(node.name);
      marker.on('click', () => callbacks.onNodeClick?.(node.id));
      if (view === 'editor' && mode === 'move') marker.on('dragend', () => {
        const moved = marker.getLatLng();
        const p = fromLeaflet(moved.lat, moved.lng, frame.background!.width, frame.background!.height);
        callbacks.onNodeMove?.(node.id, p, frame.id);
      });
    }
  }, [document, activeFrameId, mode, callbacks, view, mapReady]);
  return <div ref={host} className="map-canvas static-canvas" role="application" aria-label="Static floor plan" />;
}
