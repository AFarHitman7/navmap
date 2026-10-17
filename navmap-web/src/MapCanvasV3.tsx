import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { BoundsV3, DraftV3, NodeV3, PathV3 } from './contract-v3';
import { INDIA_INITIAL_VIEW, boundsFromCorners } from './geo-v3';
import { isNodeVisible, type ZoneFloorVisibility } from './floor-visibility';
import type { PathVertex } from './editor-v3/paths';

export type MapV3Mode = 'navigate' | 'draw-boundary' | 'draw-zone' | 'add-nodes' | 'move' | 'connect' | 'draw-path';
export interface MapCanvasV3Props {
  draft: DraftV3;
  selectedZoneId: string | null;
  selectedNodeId?: string;
  floorFilter?: { zoneId: string; z: number } | null;
  zoneFloorVisibility?: ZoneFloorVisibility;
  showOutdoors?: boolean;
  routeNodeIds?: string[];
  pathPreview?: PathVertex[];
  selectedPathId?: string;
  showReferencePoints?: boolean;
  mode?: MapV3Mode;
  disabled?: boolean;
  onPointClick?: (point: { lat: number; lng: number }) => void;
  onNodeMove?: (id: string, lat: number, lng: number) => void;
  onNodeClick?: (id: string) => void;
  onPathClick?: (id: string) => void;
  onEdgeClick?: (from: string, to: string) => void;
  onZoneClick?: (id: string | null) => void;
  onRectangle?: (bounds: BoundsV3) => void;
  onError?: (message: string) => void;
}

function geographicBounds(b: BoundsV3): L.LatLngBoundsExpression {
  return [[b.south, b.west], [b.north, b.east]];
}

function isDimmed(n: NodeV3, floorFilter?: { zoneId: string; z: number } | null): boolean {
  if (!floorFilter) return false;
  return n.zoneId !== floorFilter.zoneId || n.z !== floorFilter.z;
}

function edgeKey(from: string, to: string): string {
  return JSON.stringify([from, to].sort());
}

function routePathForEdge(paths: PathV3[] | undefined, from: string, to: string): PathV3 | undefined {
  const key = edgeKey(from, to);
  return paths?.find((path) => path.nodeIds.slice(1).some((id, index) => edgeKey(path.nodeIds[index]!, id) === key));
}

function transitionLabel(edgeKind: string, hidden: NodeV3): string {
  const label = edgeKind === 'elevator' ? 'Elevator' : 'Stairs';
  return `${label} to floor ${hidden.z}`;
}

function isPreviewVisible(vertex: PathVertex, visibility?: ZoneFloorVisibility, showOutdoors = true): boolean {
  return isNodeVisible({ zoneId: vertex.zoneId, z: vertex.z }, visibility, showOutdoors);
}

/** One geographic map: boundary + every indoor zone + all nodes. No second canvas. */
export function MapCanvasV3(props: MapCanvasV3Props) {
  const { draft, selectedZoneId, selectedNodeId, mode = 'navigate', disabled = false, floorFilter = null,
    zoneFloorVisibility, showOutdoors = true, showReferencePoints = false } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const graph = useRef<L.LayerGroup | null>(null);
  const drawing = useRef<L.LayerGroup | null>(null);
  const live = useRef({ props, mode });
  const fitKey = useRef('');
  const singleClick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [tileError, setTileError] = useState(false);
  const firstCorner = useRef(false);
  useLayoutEffect(() => { live.current = { props, mode }; });

  const dimmedCount = draft.nodes.filter((n) => isDimmed(n, floorFilter)).length;

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const map = L.map(el, {
      minZoom: 2,
      maxZoom: 24,
      zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
      doubleClickZoom: false, boxZoom: false, zoomSnap: .25,
      attributionControl: true,
    });
    mapRef.current = map;
    graph.current = L.layerGroup().addTo(map);
    drawing.current = L.layerGroup().addTo(map);
    fitKey.current = '';
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 24, maxNativeZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).on('tileerror', () => setTileError(true)).on('tileload', () => setTileError(false)).addTo(map);
    map.fitBounds(geographicBounds(live.current.props.draft.boundary ?? INDIA_INITIAL_VIEW));
    const clearClick = () => { if (singleClick.current) clearTimeout(singleClick.current); };
    map.on('dblclick', clearClick);
    map.on('dragstart zoomstart', clearClick);
    map.on('click', (e: L.LeafletMouseEvent) => {
      const { mode: tool, props: current } = live.current;
      if (current.disabled || (tool !== 'add-nodes' && tool !== 'draw-path')) return;
      clearClick();
      if (e.originalEvent.detail > 1) return;
      singleClick.current = setTimeout(() => {
        if (live.current.mode !== tool || live.current.props.disabled) return;
        live.current.props.onPointClick?.({ lat: e.latlng.lat, lng: e.latlng.lng });
      }, 240);
    });
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.invalidateSize({ pan: false })) : null;
    observer?.observe(el);
    setReady(true);
    return () => {
      clearClick(); observer?.disconnect(); map.remove();
      mapRef.current = null; graph.current = null; drawing.current = null;
    };
  }, []);

  // Redraw when the draft, selection, filter, or route changes. Never refit except on geometry change.
  useEffect(() => {
    const map = mapRef.current;
    const layer = graph.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const boundary = draft.boundary;
    const key = JSON.stringify(boundary);
    if (fitKey.current !== key) {
      map.fitBounds(geographicBounds(boundary ?? INDIA_INITIAL_VIEW), { padding: [32, 32], animate: false });
      fitKey.current = key;
    }
    if (boundary) {
      L.rectangle(geographicBounds(boundary), { color: '#26796f', weight: 2, fillOpacity: 0.025, interactive: false }).addTo(layer);
    }
    for (const zone of draft.indoorZones) {
      if (zoneFloorVisibility?.[zone.id] === 'hidden') continue;
      const selected = zone.id === selectedZoneId;
      const rect = L.rectangle(geographicBounds(zone.bounds), {
        color: selected ? '#172f40' : '#b46926', weight: selected ? 3 : 2, dashArray: '6 4',
        fillColor: '#fff', fillOpacity: 0.12, bubblingMouseEvents: mode === 'add-nodes' || mode === 'draw-path',
      }).addTo(layer);
      rect.getElement()?.setAttribute('data-zone', zone.id);
      rect.bindTooltip(zone.name, { direction: 'top', sticky: true });
      rect.on('click', () => { if (!live.current.props.disabled) live.current.props.onZoneClick?.(zone.id); });
    }
    const byId = new Map(draft.nodes.map((n) => [n.id, n]));
    for (const edge of draft.edges) {
      const a = byId.get(edge.from);
      const c = byId.get(edge.to);
      if (!a || !c) continue;
      const aVisible = isNodeVisible(a, zoneFloorVisibility, showOutdoors);
      const cVisible = isNodeVisible(c, zoneFloorVisibility, showOutdoors);
      if (!aVisible || !cVisible) {
        if ((edge.kind === 'stairs' || edge.kind === 'elevator') && aVisible !== cVisible) {
          const visible = aVisible ? a : c;
          const hidden = aVisible ? c : a;
          const marker = L.marker([visible.lat, visible.lng], {
            interactive: false,
            icon: L.divIcon({
              className: 'transition-marker-icon',
              iconSize: [112, 24],
              iconAnchor: [0, 12],
              html: `<span>${transitionLabel(edge.kind, hidden)}</span>`,
            }),
          }).addTo(layer);
          marker.getElement()?.setAttribute('data-transition', `${edge.from}:${edge.to}`);
        }
        continue;
      }
      const vertical = a.z !== c.z;
      const owningPath = routePathForEdge(draft.paths, edge.from, edge.to);
      const selectedPath = owningPath?.id === props.selectedPathId;
      const line = L.polyline([[a.lat, a.lng], [c.lat, c.lng]], {
        color: selectedPath ? '#d97706' : edge.kind === 'stairs' ? '#7c3aed' : '#758f9b',
        weight: selectedPath ? 6 : 3,
        dashArray: vertical || edge.kind === 'stairs' || edge.kind === 'elevator' ? '4 4' : undefined,
        interactive: true,
        bubblingMouseEvents: false,
      }).addTo(layer);
      line.getElement()?.setAttribute('data-edge', `${edge.from}:${edge.to}`);
      if (owningPath) line.getElement()?.setAttribute('data-path', owningPath.id);
      line.on('click', (event: L.LeafletMouseEvent) => {
        event.originalEvent?.stopPropagation();
        const current = live.current.props;
        if (current.disabled) return;
        if (owningPath) current.onPathClick?.(owningPath.id);
        else current.onEdgeClick?.(edge.from, edge.to);
      });
    }
    const preview = props.pathPreview ?? [];
    let previewStretch: L.LatLngTuple[] = [];
    const flushPreview = () => {
      if (previewStretch.length > 1) {
        L.polyline(previewStretch, { color: '#0f766e', weight: 4, dashArray: '6 6', interactive: false }).addTo(layer);
      }
      previewStretch = [];
    };
    for (let i = 0; i < preview.length; i++) {
      const vertex = preview[i]!;
      const visible = isPreviewVisible(vertex, zoneFloorVisibility, showOutdoors);
      if (i > 0 && vertex.incomingKind === 'stairs') {
        flushPreview();
        const previous = preview[i - 1]!;
        const previousVisible = isPreviewVisible(previous, zoneFloorVisibility, showOutdoors);
        if (previousVisible && visible) L.polyline([[previous.lat, previous.lng], [vertex.lat, vertex.lng]], { color: '#7c3aed', weight: 4, dashArray: '4 4', interactive: false }).addTo(layer);
        else if (previousVisible !== visible) {
          const shown = previousVisible ? previous : vertex;
          const hidden = previousVisible ? vertex : previous;
          const marker = L.marker([shown.lat, shown.lng], {
            title: 'Path preview transition',
            interactive: false,
            icon: L.divIcon({ className: 'transition-marker-icon', iconSize: [112, 24], iconAnchor: [0, 12], html: `<span>Stairs to floor ${hidden.z}</span>` }),
          }).addTo(layer);
          marker.getElement()?.setAttribute('data-preview-transition', '1');
        }
      }
      if (visible) previewStretch.push([vertex.lat, vertex.lng]);
      else flushPreview();
    }
    flushPreview();
    for (const vertex of preview) {
      if (!isPreviewVisible(vertex, zoneFloorVisibility, showOutdoors)) continue;
      const marker = L.marker([vertex.lat, vertex.lng], {
        title: 'Path preview point',
        interactive: false,
        icon: L.divIcon({ className: 'preview-point-icon', iconSize: [8, 8], iconAnchor: [4, 4], html: '<span aria-hidden="true"></span>' }),
      }).addTo(layer);
      marker.getElement()?.setAttribute('data-preview-point', '1');
    }
    // Route: break at floor transitions so stairs never read as a flat walk.
    let stretch: L.LatLngTuple[] = [];
    let prevZ: number | null = null;
    const flush = () => { if (stretch.length > 1) L.polyline(stretch, { color: '#007b70', weight: 6, interactive: false }).addTo(layer); stretch = []; prevZ = null; };
    for (const id of props.routeNodeIds ?? []) {
      const node = byId.get(id);
      if (!node || !isNodeVisible(node, zoneFloorVisibility, showOutdoors)) { flush(); continue; }
      if (prevZ !== null && prevZ !== node.z) flush();
      stretch.push([node.lat, node.lng]);
      prevZ = node.z;
    }
    flush();
    for (const n of draft.nodes) {
      if (n.generated && !showReferencePoints) continue;
      if (!isNodeVisible(n, zoneFloorVisibility, showOutdoors)) continue;
      const dimmed = isDimmed(n, floorFilter);
      const selected = n.id === selectedNodeId;
      const generated = !!n.generated;
      const size = selected ? 18 : dimmed ? 8 : generated ? 9 : 14;
      const border = selected ? 3 : 2;
      const marker = L.marker([n.lat, n.lng], {
        draggable: mode === 'move' && selected && !disabled,
        title: n.name,
        bubblingMouseEvents: false,
        // Destination landings stay clickable above dense generated reference points.
        zIndexOffset: generated ? 0 : 1000,
        icon: L.divIcon({
          className: 'node-marker-icon',
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
          html: `<span aria-hidden="true" style="display:block;width:${size}px;height:${size}px;border-radius:999px;border:${border}px solid ${selected ? '#172f40' : '#fff'};background:#167f73;opacity:${dimmed ? 0.35 : 1};box-sizing:border-box;"></span>`,
        }),
      }).bindTooltip(`${n.name} · ${n.id} · ${n.zoneId ?? 'outdoors'} · floor ${n.z}`, { direction: 'top' }).addTo(layer);
      marker.on('click', () => { if (!live.current.props.disabled) live.current.props.onNodeClick?.(n.id); });
      marker.on('dragend', () => {
        const { mode: tool, props: current } = live.current;
        if (current.disabled || tool !== 'move') return;
        const p = marker.getLatLng();
        current.onNodeMove?.(n.id, p.lat, p.lng);
      });
      marker.getElement()?.setAttribute('data-node', n.id);
    }
  }, [ready, draft, selectedZoneId, selectedNodeId, floorFilter, mode, disabled, props.routeNodeIds, props.pathPreview, props.selectedPathId, showReferencePoints, zoneFloorVisibility, showOutdoors]);

  const start = useRef<L.Point | null>(null);
  const down = useRef<L.Point | null>(null);
  const drawingMode = mode === 'draw-boundary' || mode === 'draw-zone';
  useEffect(() => {
    drawing.current?.clearLayers(); start.current = null; down.current = null; firstCorner.current = false;
    const map = mapRef.current;
    if (!map) return;
    if (disabled) { map.dragging.disable(); map.touchZoom.disable(); map.scrollWheelZoom.disable(); }
    else if (drawingMode) { map.dragging.disable(); map.touchZoom.disable(); map.scrollWheelZoom.disable(); }
    else {
      if (mode === 'move') map.dragging.disable();
      else map.dragging.enable();
      map.touchZoom.enable(); map.scrollWheelZoom.enable();
    }
  }, [mode, disabled, drawingMode]);

  function point(e: React.PointerEvent<HTMLDivElement>) {
    const rect = container.current!.getBoundingClientRect();
    return L.point(Math.max(0, Math.min(rect.width, e.clientX - rect.left)), Math.max(0, Math.min(rect.height, e.clientY - rect.top)));
  }
  function preview(p: L.Point) {
    const map = mapRef.current;
    if (!start.current || !map) return;
    drawing.current?.clearLayers();
    L.rectangle(L.latLngBounds(map.containerPointToLatLng(start.current), map.containerPointToLatLng(p)), {
      color: '#b46926', weight: 2, dashArray: '6 4', fillOpacity: .12, interactive: false,
    }).addTo(drawing.current!);
  }
  function finish(p: L.Point) {
    if (!start.current || !mapRef.current) return;
    const a = start.current;
    if (Math.abs(a.x - p.x) < 10 || Math.abs(a.y - p.y) < 10) {
      props.onError?.('Draw a rectangle at least 10 pixels wide and tall.'); return;
    }
    preview(p);
    props.onRectangle?.(boundsFromCorners(mapRef.current.containerPointToLatLng(a), mapRef.current.containerPointToLatLng(p)));
    start.current = null; firstCorner.current = false;
  }

  return <div className="map-surface outdoor">
    <div ref={container} className="map-canvas" data-testid="leaflet-map-v3" data-ready={ready}
      data-zones={draft.indoorZones.length} data-nodes={draft.nodes.length} data-dimmed={dimmedCount}
      data-visible-nodes={draft.nodes.filter((n) => isNodeVisible(n, zoneFloorVisibility, showOutdoors)).length}
      role="region" aria-label="Unified venue map" />
    {drawingMode && !disabled && <div className="draw-surface" aria-label="Rectangle drawing surface"
      onPointerDown={e => { if (!e.isPrimary || e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); down.current = point(e); if (!start.current) start.current = down.current; }}
      onPointerMove={e => { if (start.current) preview(point(e)); }}
      onPointerUp={e => { if (!down.current) return; const p = point(e); if (firstCorner.current || p.distanceTo(down.current) > 8) finish(p); else firstCorner.current = true; down.current = null; }}
      onPointerCancel={() => { start.current = null; down.current = null; drawing.current?.clearLayers(); firstCorner.current = false; }} />}
    {drawingMode && <span className="map-badge">Drag a rectangle, or tap two corners</span>}
    {tileError && <span className="map-warning">OSM tiles unavailable. Your map edits are still here.</span>}
    <button className="fit-map" type="button" title="Fit venue to view" aria-label="Fit map" disabled={drawingMode} onClick={() => {
      mapRef.current?.fitBounds(geographicBounds(draft.boundary ?? INDIA_INITIAL_VIEW), { padding: [32, 32], animate: false });
    }}>↗ <span>Fit map</span></button>
  </div>;
}
