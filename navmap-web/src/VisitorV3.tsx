import { useEffect, useMemo, useState } from 'react';
import { getPublishedVisitorMap } from './api-v3';
import type { MapManifest } from './map-contract';
import { CanvasHost } from './map/CanvasHost';
import { shortestPathV3 } from './route-v3';
import { buildDirections } from '../../shared/src/directions';

export function VisitorV3({ venueId = 'demo' }: { venueId?: string }) {
  const [manifest, setManifest] = useState<MapManifest | null>(null);
  const [mapName, setMapName] = useState(venueId);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [start, setStart] = useState('');
  const [destination, setDestination] = useState('');
  const [manualFrameId, setManualFrameId] = useState<string | null>(null);
  const [loadedVenueId, setLoadedVenueId] = useState(venueId);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    getPublishedVisitorMap(venueId, controller.signal).then(({ manifest: map, name }) => {
      if (active) { setManifest(map); setMapName(name); setLoadedVenueId(venueId); }
    }, (err: unknown) => {
      if (!active) return;
      const detail = err instanceof Error ? err.message : 'Try loading the map again.';
      setError(/no published version/.test(detail)
        ? 'This venue has not been published yet. Publish it in the editor, then try again.'
        : `Could not load the visitor map. ${detail}`);
    });
    return () => { active = false; controller.abort(); };
  }, [venueId, attempt]);

  const currentManifest = loadedVenueId === venueId ? manifest : null;
  const graphNodes = useMemo(() => currentManifest?.nodes ?? [], [currentManifest]);
  const graphById = useMemo(() => new Map(graphNodes.map((node) => [node.id, node])), [graphNodes]);
  const visibleNodes = useMemo(() => graphNodes.filter((node) => node.visitorVisible && (!node.generated || currentManifest?.places.some((place) => place.nodeId === node.id))), [graphNodes, currentManifest]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const places = useMemo(() => currentManifest?.places.filter((place) => visibleIds.has(place.nodeId)) ?? [], [currentManifest, visibleIds]);
  const placeByNodeId = useMemo(() => new Map(places.map((place) => [place.nodeId, place])), [places]);
  const route = useMemo(() => currentManifest && start && destination && graphById.has(start) && graphById.has(destination)
    ? shortestPathV3(currentManifest, start, destination) : null, [currentManifest, start, destination, graphById]);
  const directions = useMemo(() => currentManifest && route ? buildDirections(currentManifest, route) : null, [currentManifest, route]);

  if (!currentManifest) return <div className="page-state">
    <h1>Visitor map — {mapName}</h1>
    {error ? <><p className="error" role="alert">{error}</p>
      <button onClick={() => { setError(''); setManifest(null); setAttempt((value) => value + 1); }}>Try again</button></>
      : <p role="status">Loading published map…</p>}
  </div>;

  const locationLabel = (nodeId: string) => {
    const node = graphById.get(nodeId);
    const place = placeByNodeId.get(nodeId);
    if (place) return place.name;
    if (node && !node.generated && node.visitorVisible) return node.name;
    const zone = currentManifest.indoorZones.find((item) => item.id === node?.zoneId);
    const floor = zone?.floors.find((item) => item.z === node?.z)?.label;
    return zone ? `${zone.name} · ${floor ?? `Floor ${node?.z ?? 0}`}` : 'Known location';
  };
  const startNode = graphById.get(start);
  const followedFrame = currentManifest.frames.find((frame) => frame.id === startNode?.frameId) ?? currentManifest.frames.find((frame) => frame.zoneId === null) ?? currentManifest.frames[0];
  const activeFrame = currentManifest.frames.find((frame) => frame.id === manualFrameId) ?? (manualFrameId ? undefined : followedFrame);
  const visitorChoices = visibleNodes.map((node) => ({ node, label: placeByNodeId.get(node.id)?.name ?? node.name }));
  const chooseFrame = (frameId: string) => setManualFrameId(frameId);
  const selectedNode = start && graphById.get(start);

  return <div className="visitor">
    <div className="workspace-heading"><div>
      <span className="eyebrow">PUBLISHED MAP · VERSION {currentManifest.version}</span>
      <h1>Visitor map — {mapName}</h1>
    </div><p>Choose a starting point and destination.</p></div>
    <div className="visitor-layout">
      <aside className="visitor-sidebar">
        <h2>Find your way</h2>
        {!visibleNodes.length ? <p className="empty-hint">No visitor locations are available in this published map.</p> : <>
          <label>Starting point
            <select aria-label="Starting point" value={start} onChange={(e) => setStart(e.target.value)}>
              <option value="">Choose a starting point</option>
              {visitorChoices.map(({ node, label }) => <option key={node.id} value={node.id}>{label}</option>)}
            </select>
          </label>
          <label>Destination
            <select aria-label="Destination" value={destination} onChange={(e) => setDestination(e.target.value)}>
              <option value="">Choose a destination</option>
              {visitorChoices.map(({ node, label }) => <option key={node.id} value={node.id}>{label}</option>)}
            </select>
          </label>
        </>}
        {start && destination && <section className="route-panel" aria-label="Directions" aria-live="polite">
          <h3>Directions</h3>
          {!route ? <p className="error" role="alert">No connected route between these places. Choose another destination.</p>
            : route.length === 1 ? <p className="notice">You’re already at your destination.</p> : <>
              {directions?.totalMeters !== undefined && <p className="route-summary">{Math.round(directions.totalMeters)} m</p>}
              <ol>{directions?.instructions.map((instruction, index) => <li key={`${instruction.kind}-${instruction.frameId}-${index}`}>
                {instruction.text}
                {instruction.frameId !== activeFrame?.id && <button type="button" className="text-button"
                  onClick={() => chooseFrame(instruction.frameId)}>Show this floor</button>}
              </li>)}</ol>
            </>}
        </section>}
      </aside>
      <div className="visitor-map">
        <div className="visitor-frame-picker" aria-label="Map layers">
          <span className="layer-current-frame" aria-live="polite">{activeFrame ? `${currentManifest.indoorZones.find((zone) => zone.id === activeFrame.zoneId)?.name ?? 'Outdoor'} · ${currentManifest.indoorZones.find((zone) => zone.id === activeFrame.zoneId)?.floors.find((floor) => floor.z === activeFrame.z)?.label ?? 'Outdoor'}` : 'Choose a floor'}</span>
          <label>Manual floor
            <select aria-label="Manual floor selection" value={manualFrameId ?? ''} onChange={(event) => setManualFrameId(event.target.value || null)}>
              <option value="">Follow location</option>
              {currentManifest.frames.map((frame) => <option key={frame.id} value={frame.id}>
                {currentManifest.indoorZones.find((zone) => zone.id === frame.zoneId)?.name ?? 'Outdoor'} · {currentManifest.indoorZones.find((zone) => zone.id === frame.zoneId)?.floors.find((floor) => floor.z === frame.z)?.label ?? 'Outdoor'}{!frame.background && currentManifest.canvas.kind === 'static' ? ' · no plan' : ''}
              </option>)}
            </select>
          </label>
        </div>
        {manualFrameId && <button type="button" className="text-button" onClick={() => setManualFrameId(null)}>Resume follow</button>}
        <div className="map-frame">
          {activeFrame && <CanvasHost document={currentManifest} activeFrameId={activeFrame.id} mode="navigate" view="visitor"
            callbacks={{}} selection={selectedNode ? { kind: 'node', id: selectedNode.id } : { kind: 'none' }} />}
        </div>
        {start && <div className="visitor-location" aria-label="Current location">
          Starting from {startNode?.generated && !placeByNodeId.has(start) ? 'Known location' : locationLabel(start)}
        </div>}
      </div>
    </div>
  </div>;
}
