import { useEffect, useMemo, useState } from 'react';
import { getPublishedVisitorMap } from './api-v3';
import type { MapManifest } from './map-contract';
import { CanvasHost } from './map/CanvasHost';
import { LayerPicker } from './LayerPicker';
import { resolveFloorVisibility, type ZoneFloorVisibility } from './floor-visibility';
import { shortestPathV3 } from './route-v3';

export function VisitorV3({ venueId = 'demo' }: { venueId?: string }) {
  const [manifest, setManifest] = useState<MapManifest | null>(null);
  const [mapName, setMapName] = useState(venueId);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [start, setStart] = useState('');
  const [destination, setDestination] = useState('');
  const [floorChoices, setFloorChoices] = useState<ZoneFloorVisibility>({});
  const [showOutdoors, setShowOutdoors] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    getPublishedVisitorMap(venueId, controller.signal).then(({ manifest: map, name }) => {
      if (active) { setManifest(map); setMapName(name); }
    }, (err: unknown) => {
      if (!active) return;
      const detail = err instanceof Error ? err.message : 'Try loading the map again.';
      setError(/no published version/.test(detail)
        ? 'This venue has not been published yet. Publish it in the editor, then try again.'
        : `Could not load the visitor map. ${detail}`);
    });
    return () => { active = false; controller.abort(); };
  }, [venueId, attempt]);

  const legacyZones = useMemo(() => (manifest?.indoorZones ?? []).map((zone) => ({ ...zone,
    bounds: zone.bounds?.kind === 'geographic' ? { north: zone.bounds.north, south: zone.bounds.south, east: zone.bounds.east, west: zone.bounds.west }
      : { north: 1, south: 0, east: 1, west: 0 } })), [manifest]);
  const visibility = useMemo(() => resolveFloorVisibility(legacyZones, floorChoices), [legacyZones, floorChoices]);
  const visibleNodes = useMemo(() => manifest?.nodes.filter((node) => node.visitorVisible) ?? [], [manifest]);
  const byId = useMemo(() => new Map(visibleNodes.map((node) => [node.id, node])), [visibleNodes]);
  const places = useMemo(() => manifest?.places.filter((place) => byId.has(place.nodeId)) ?? [], [manifest, byId]);
  const route = useMemo(() => manifest && start && destination && byId.has(start) && byId.has(destination)
    ? shortestPathV3(manifest, start, destination) : null, [manifest, start, destination, byId]);

  if (!manifest) return <div className="page-state">
    <h1>Visitor map — {mapName}</h1>
    {error ? <><p className="error" role="alert">{error}</p>
      <button onClick={() => { setError(''); setManifest(null); setAttempt((value) => value + 1); }}>Try again</button></>
      : <p role="status">Loading published map…</p>}
  </div>;

  const location = (id: string) => {
    const node = byId.get(id)!;
    const zone = manifest.indoorZones.find((item) => item.id === node.zoneId);
    return zone ? `${zone.name} · ${manifest.frames.find((frame) => frame.id === node.frameId)?.z ?? node.z}` : 'Outdoors';
  };
  const edgeFor = (from: string, to: string) => manifest.edges.filter((edge) =>
    (edge.from === from && edge.to === to) || (edge.to === from && edge.from === to))
    .sort((a, b) => a.cost - b.cost)[0];
  const routeEdges = route?.slice(1).map((id, index) => edgeFor(route[index]!, id));
  const meters = route && route.length > 1 && routeEdges?.every((edge) => edge?.meters !== undefined)
    ? routeEdges.reduce<number>((sum, edge) => sum + edge!.meters!, 0) : null;
  const activeFrame = manifest.frames.find((frame) => frame.zoneId === null && showOutdoors)
    ?? manifest.frames.find((frame) => frame.zoneId && visibility[frame.zoneId] === frame.z)
    ?? manifest.frames.find((frame) => frame.zoneId && visibility[frame.zoneId] !== 'hidden') ?? manifest.frames[0];
  const startNode = byId.get(start);
  const canShowStartLocation = !!startNode && !startNode.generated;

  return <div className="visitor">
    <div className="workspace-heading"><div>
      <span className="eyebrow">PUBLISHED MAP · VERSION {manifest.version}</span>
      <h1>Visitor map — {mapName}</h1>
    </div><p>Choose a starting point and destination.</p></div>
    <div className="visitor-layout">
      <aside className="visitor-sidebar">
        <h2>Find your way</h2>
        {!visibleNodes.length ? <p className="empty-hint">No visitor locations are available in this published map.</p> : <>
          <label>Starting point
            <select aria-label="Starting point" value={start} onChange={(e) => setStart(e.target.value)}>
              <option value="">Choose a starting point</option>
              {places.map((place) => <option key={place.id} value={place.nodeId}>{place.name} · {location(place.nodeId)}</option>)}
            </select>
          </label>
          <label>Destination
            <select aria-label="Destination" value={destination} onChange={(e) => setDestination(e.target.value)}>
              <option value="">Choose a destination</option>
              {places.map((place) => <option key={place.id} value={place.nodeId}>{place.name} · {location(place.nodeId)}</option>)}
            </select>
          </label>
        </>}
        {start && destination && <section className="route-panel" aria-label="Directions" aria-live="polite">
          <h3>Directions</h3>
          {!route ? <p className="error" role="alert">No connected route between these places. Choose another destination.</p>
            : route.length === 1 ? <p className="notice">You’re already at your destination.</p> : <>
              <p className="route-summary">{meters === null ? '' : `${Math.round(meters)} m · `}{route.length - 1} steps</p>
              <ol>{route.slice(1).map((id, index) => {
                const edge = routeEdges![index];
                const node = byId.get(id)!;
                const place = places.find((item) => item.nodeId === id);
                const transition = edge?.kind === 'stairs' ? 'Take stairs'
                  : edge?.kind === 'elevator' ? 'Take elevator' : edge?.kind === 'entrance' ? 'Use the entrance' : null;
                const instruction = transition ? `${transition} · ${location(id)}`
                  : `${index === route.length - 2 ? 'Arrive at' : 'Continue to'} ${place?.name ?? 'your destination'} · ${location(id)}`;
                return <li key={`${id}-${index}`}>{instruction}
                  {node.zoneId !== null && <button type="button" className="text-button"
                    onClick={() => setFloorChoices((choices) => ({ ...choices, [node.zoneId!]: node.z }))}>Show {location(id)}</button>}
                </li>;
              })}</ol>
              <p>Choose a floor in Layers to view each part of your route.</p>
            </>}
        </section>}
      </aside>
      <div className="visitor-map">
        <LayerPicker zones={legacyZones} visibility={visibility} showOutdoors={showOutdoors}
          onFloorChange={(id, floor) => setFloorChoices((choices) => ({ ...choices, [id]: floor }))}
          onOutdoorsChange={setShowOutdoors} />
        <div className="map-frame">
          {activeFrame && <CanvasHost document={manifest} activeFrameId={activeFrame.id} mode="navigate" view="visitor"
            callbacks={{}} selection={{ kind: 'none' }} />}
        </div>
        {start && <div className="visitor-location" aria-label="Current location">
          {canShowStartLocation ? `Starting from ${places.find((place) => place.nodeId === start)?.name ?? 'selected place'}` : 'Starting point selected'}
        </div>}
      </div>
    </div>
  </div>;
}
