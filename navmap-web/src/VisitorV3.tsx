import { useEffect, useMemo, useState } from 'react';
import { getPublishedManifestV3 } from './api-v3';
import type { ManifestV3 } from './contract-v3';
import { LayerPicker } from './LayerPicker';
import { MapCanvasV3 } from './MapCanvasV3';
import { resolveFloorVisibility, type ZoneFloorVisibility } from './floor-visibility';
import { shortestPathV3 } from './route-v3';

export function VisitorV3({ venueId = 'demo' }: { venueId?: string }) {
  const [manifest, setManifest] = useState<ManifestV3 | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [start, setStart] = useState('');
  const [destination, setDestination] = useState('');
  const [floorChoices, setFloorChoices] = useState<ZoneFloorVisibility>({});
  const [showOutdoors, setShowOutdoors] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    getPublishedManifestV3(venueId, controller.signal).then((map) => {
      if (active) setManifest(map);
    }, (err: unknown) => {
      if (!active) return;
      const detail = err instanceof Error ? err.message : 'Try loading the map again.';
      setError(/no published version/.test(detail)
        ? 'This venue has not been published yet. Publish it in the editor, then try again.'
        : `Could not load the visitor map. ${detail}`);
    });
    return () => { active = false; controller.abort(); };
  }, [venueId, attempt]);

  const visibility = useMemo(() => resolveFloorVisibility(manifest?.indoorZones ?? [], floorChoices), [manifest, floorChoices]);
  const byId = useMemo(() => new Map(manifest?.nodes.map((node) => [node.id, node])), [manifest]);
  const route = useMemo(() => manifest && start && destination ? shortestPathV3(manifest, start, destination) : null,
    [manifest, start, destination]);

  if (!manifest) return <div className="page-state">
    <h1>Visitor map — {venueId}</h1>
    {error ? <><p className="error" role="alert">{error}</p>
      <button onClick={() => { setError(''); setManifest(null); setAttempt((value) => value + 1); }}>Try again</button></>
      : <p role="status">Loading published map…</p>}
  </div>;

  const location = (id: string) => {
    const node = byId.get(id)!;
    const zone = manifest.indoorZones.find((item) => item.id === node.zoneId);
    return zone ? `${zone.name} · Floor ${node.z}` : 'Outdoors';
  };
  const placeNodes = new Set(manifest.places.map((place) => place.nodeId));
  const distance = route?.slice(1).reduce((sum, id, index) => sum + Math.min(...manifest.edges
    .filter((edge) => (edge.from === route[index] && edge.to === id) || (edge.to === route[index] && edge.from === id))
    .map((edge) => edge.meters)), 0);

  return <div className="visitor">
    <div className="workspace-heading"><div>
      <span className="eyebrow">PUBLISHED MAP · VERSION {manifest.version}</span>
      <h1>Visitor map — {venueId}</h1>
    </div><p>Choose your starting point and destination.</p></div>
    <div className="visitor-layout">
      <aside className="visitor-sidebar">
        <h2>Find your way</h2>
        {manifest.nodes.length === 0 ? <p className="empty-hint">No path points are available in this published map.</p> : <>
          <label>Starting point
            <select aria-label="Starting point" value={start} onChange={(e) => setStart(e.target.value)}>
              <option value="">Choose a starting point</option>
              {manifest.nodes.map((node) => <option key={node.id} value={node.id}>{node.name} · {location(node.id)}</option>)}
            </select>
          </label>
          <label>Destination
            <select aria-label="Destination" value={destination} onChange={(e) => setDestination(e.target.value)}>
              <option value="">Choose a destination</option>
              {manifest.places.length > 0 && <optgroup label="Places">
                {manifest.places.map((place) => <option key={place.id} value={place.nodeId}>{place.name} · {location(place.nodeId)}</option>)}
              </optgroup>}
              <optgroup label="Path points">
                {manifest.nodes.filter((node) => !placeNodes.has(node.id)).map((node) =>
                  <option key={node.id} value={node.id}>{node.name} · {location(node.id)}</option>)}
              </optgroup>
            </select>
          </label>
        </>}
        {start && destination && <section className="route-panel" aria-label="Directions" aria-live="polite">
          <h3>Directions</h3>
          {!route ? <p className="error" role="alert">No connected route between these points. Choose another destination.</p>
            : route.length === 1 ? <p className="notice">You’re already at your destination.</p> : <>
              <p className="route-summary">{Math.round(distance ?? 0)} m · {route.length - 1} connections</p>
              <ol>{route.map((id, index) => {
                const node = byId.get(id)!;
                const previous = index > 0 ? byId.get(route[index - 1]) : undefined;
                const edge = previous ? manifest.edges.filter((item) => (item.from === previous.id && item.to === id)
                  || (item.to === previous.id && item.from === id)).sort((a, b) => a.meters - b.meters)[0] : undefined;
                const instruction = edge?.kind === 'stairs' || edge?.kind === 'elevator'
                  ? `Take ${edge.kind} to ${location(id)}`
                  : `${index === 0 ? 'Start at' : index === route.length - 1 ? 'Arrive at' : 'Continue to'} ${node.name} · ${location(id)}`;
                return <li key={id}>{instruction}
                  {node.zoneId !== null && <button type="button" className="text-button"
                    onClick={() => setFloorChoices((choices) => ({ ...choices, [node.zoneId!]: node.z }))}>
                    Show {location(id)}
                  </button>}
                </li>;
              })}</ol>
              <p>Switch floors in Layers to see each part of your route.</p>
            </>}
        </section>}
      </aside>
      <div className="visitor-map">
        <LayerPicker zones={manifest.indoorZones} visibility={visibility} showOutdoors={showOutdoors}
          onFloorChange={(id, floor) => setFloorChoices((choices) => ({ ...choices, [id]: floor }))}
          onOutdoorsChange={setShowOutdoors} />
        <div className="map-frame">
          <MapCanvasV3 draft={manifest} selectedZoneId={null} selectedNodeId={destination}
            zoneFloorVisibility={visibility} showOutdoors={showOutdoors} routeNodeIds={route ?? undefined}
            onNodeClick={(id) => { if (!start) setStart(id); else setDestination(id); }} />
        </div>
      </div>
    </div>
  </div>;
}
