import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ManifestV3 } from './contract-v3';
import { upgradeV4Manifest, type MapManifest } from './map-contract';
import type { LocationState } from './positioning-v3';
import { shortestPathV3 } from './route-v3';
import { MapView } from './map/MapView';
import type { PackAdapter } from './pack';
import { encodeBase64, readFrameBackground } from './pack';
import { buildDirections } from '../../shared/src/directions';

export type AnyVisitorManifest = ManifestV3 | MapManifest;

function geographicInput(map: MapManifest, frameId: string, startId?: string) {
  const boundary = map.boundary?.kind === 'geographic'
    ? { north: map.boundary.north, south: map.boundary.south, east: map.boundary.east, west: map.boundary.west }
    : null;
  if (!boundary) return null;
  const zones = map.indoorZones.flatMap((zone) => zone.bounds?.kind === 'geographic'
    ? [{ id: zone.id, name: zone.name, bounds: { north: zone.bounds.north, south: zone.bounds.south, east: zone.bounds.east, west: zone.bounds.west } }]
    : []);
  const frame = map.frames.find((candidate) => candidate.id === frameId);
  const nodes = map.nodes.flatMap((node) => (node.visitorVisible || node.id === startId) && node.position.kind === 'geographic'
    ? [{ id: node.id, name: map.places.find((place) => place.nodeId === node.id)?.name ?? node.name,
      lat: node.position.lat, lng: node.position.lng, z: node.z, zoneId: node.zoneId }]
    : []);
  return { boundary, zones, nodes, activeZoneId: frame?.zoneId ?? null, floorFilter: frame?.z ?? 0 };
}

export type VisitorScreenProps = {
  manifest: AnyVisitorManifest;
  qrNodeId: string | null;
  manualNodeId: string | null;
  destinationId: string;
  v3Location: LocationState | null;
  v3NodeId: string | null;
  v3ZoneId: string | null;
  onDestination: (placeId: string) => void;
  onManualStart: (nodeId: string) => void;
  onResumeAuto: () => void;
  packAdapter?: PackAdapter;
};

export function VisitorScreen(props: VisitorScreenProps): React.JSX.Element {
  const map = React.useMemo(() => (props.manifest as MapManifest).schemaVersion === 5
    ? props.manifest as MapManifest : upgradeV4Manifest(props.manifest), [props.manifest]);
  const [destinationNodeId, setDestinationNodeId] = React.useState(() => {
    const place = map.places.find((candidate) => candidate.id === props.destinationId);
    return place?.nodeId ?? (map.nodes.some((node) => node.id === props.destinationId)
      ? props.destinationId : map.places[0]?.nodeId ?? '');
  });
  const [manualFrameId, setManualFrameId] = React.useState<string | null>(null);
  const startId = props.v3NodeId ?? props.qrNodeId ?? props.manualNodeId;
  const startNode = startId ? map.nodes.find((node) => node.id === startId) ?? null : null;
  const destination = map.nodes.find((node) => node.id === destinationNodeId);
  const route = startId && destination ? shortestPathV3(map, startId, destinationNodeId) : null;
  const directions = route ? buildDirections(map, route) : null;
  const visitorNodes = map.nodes.filter((node) => node.visitorVisible);
  const placeByNodeId = new Map(map.places.map((place) => [place.nodeId, place]));
  const visitorLabel = (nodeId: string) => {
    const node = map.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return 'Selected location';
    const place = placeByNodeId.get(nodeId);
    if (place) return place.name;
    if (!node.generated && node.visitorVisible) return node.name;
    const zone = map.indoorZones.find((candidate) => candidate.id === node.zoneId);
    const floor = zone?.floors.find((candidate) => candidate.z === node.z)?.label;
    return zone ? `${zone.name} · ${floor ?? `Floor ${node.z}`}` : 'Known location';
  };
  const followedFrame = map.frames.find((frame) => frame.id === startNode?.frameId)
    ?? map.frames.find((frame) => frame.zoneId === props.v3ZoneId && frame.z === 0)
    ?? map.frames.find((frame) => frame.zoneId === null) ?? map.frames[0];
  const activeFrame = map.frames.find((frame) => frame.id === manualFrameId) ?? (manualFrameId ? undefined : followedFrame);
  const staticCanvas = map.canvas.kind === 'static';
  const selectedFrame = staticCanvas ? activeFrame ?? null : null;
  const [backgroundData, setBackgroundData] = React.useState<string | null>(null);
  React.useEffect(() => {
    let active = true;
    setBackgroundData(null);
    if (!staticCanvas || !selectedFrame?.background || !props.packAdapter) return () => { active = false; };
    void readFrameBackground(map, selectedFrame.id, props.packAdapter).then((bytes) => {
      if (active) setBackgroundData(`data:image/png;base64,${encodeBase64(bytes)}`);
    }).catch(() => { if (active) setBackgroundData(null); });
    return () => { active = false; };
  }, [map, staticCanvas, selectedFrame?.id, props.packAdapter]);

  const staticNodes = selectedFrame?.background ? map.nodes
    .filter((node) => node.frameId === selectedFrame.id && (node.visitorVisible || node.id === startId) && node.position.kind === 'local')
    .map((node) => ({ id: node.id, name: node.id === startId && node.generated && !placeByNodeId.has(node.id)
      ? 'Known location' : visitorLabel(node.id),
      x: node.position.kind === 'local' ? node.position.x : 0, y: node.position.kind === 'local' ? node.position.y : 0 })) : [];
  const tileInput = !staticCanvas && activeFrame ? geographicInput(map, activeFrame.id, startId ?? undefined) : null;
  const locationText = startNode
    ? `Current location: ${visitorLabel(startNode.id)}`
    : props.v3Location?.kind === 'unknown' ? 'Current location: not available' : 'Current location: choose a starting point';
  const selectDestination = (nodeId: string) => {
    setDestinationNodeId(nodeId);
    const place = placeByNodeId.get(nodeId);
    if (place) props.onDestination(place.id);
  };

  return <View testID="visitor-screen">
    <Text testID="visitor-title">Visitor</Text>
    <Text testID="visitor-v3-location">{locationText}</Text>
    <Text testID="visitor-gps-note">GPS can suggest an area; it does not identify a node or floor.</Text>
    <Text testID="visitor-wifi-note">Wi-Fi node positioning is app-only.</Text>
    <Text>Destinations</Text>
    {visitorNodes.filter((node) => !node.generated || placeByNodeId.has(node.id)).map((node) => <Pressable key={`dest-${node.id}`} testID={`visitor-v3-dest-${node.id}`} onPress={() => selectDestination(node.id)}>
      <Text>Destination {visitorLabel(node.id)}</Text>
    </Pressable>)}
    <Text>Starting points</Text>
    {visitorNodes.filter((node) => !node.generated || placeByNodeId.has(node.id)).map((node) => <Pressable key={node.id} testID={`visitor-start-${node.id}`} onPress={() => props.onManualStart(node.id)}>
      <Text>Start at {visitorLabel(node.id)}</Text>
    </Pressable>)}
    <Pressable testID="visitor-resume-auto" accessibilityRole="button" accessibilityLabel="Resume auto" onPress={() => {
      setManualFrameId(null); props.onResumeAuto();
    }}><Text>Resume follow</Text></Pressable>
    {route === null && <Text testID="visitor-route">No connected route. Choose a starting point and destination.</Text>}
    {route && route.length > 1 && <View testID="visitor-route">
      {directions?.totalMeters !== undefined && <Text>{Math.round(directions.totalMeters)} m</Text>}
      {directions?.instructions.map((instruction, index) => <Text key={`${instruction.kind}-${index}`}>{instruction.text}</Text>)}
    </View>}
    {route?.length === 1 && <Text testID="visitor-route">You’re already at your destination.</Text>}
    <View testID="visitor-frame-picker">
      <Text>Layers</Text>
      {map.frames.map((frame) => {
        const zone = map.indoorZones.find((candidate) => candidate.id === frame.zoneId);
        const floor = zone?.floors.find((candidate) => candidate.z === frame.z)?.label;
        const label = zone ? `${zone.name} · ${floor ?? `Floor ${frame.z}`}` : 'Outdoor';
        return <Pressable key={frame.id} testID={`visitor-frame-${frame.id}`} accessibilityRole="button"
          accessibilityState={{ selected: activeFrame?.id === frame.id }} onPress={() => setManualFrameId(frame.id)}>
          <Text>{label}{staticCanvas && !frame.background ? ' · no plan' : ''}</Text>
        </Pressable>;
      })}
    </View>
    {staticCanvas ? (
      backgroundData && selectedFrame?.background
        ? <MapView path={[]} visitor staticFrame={{ width: selectedFrame.background.width, height: selectedFrame.background.height,
          imageDataUri: backgroundData, nodes: staticNodes }} v3={{ boundary: null, zones: [], nodes: [], activeZoneId: null, floorFilter: null }} />
        : <Text testID="visitor-static-note">{selectedFrame?.background ? 'Could not load this floor plan offline.' : 'No plan is assigned to this floor.'}</Text>
    ) : tileInput ? <MapView path={[]} onlineTiles visitor v3={tileInput} />
      : <Text testID="visitor-static-note">This map has no geographic frame to display.</Text>}
  </View>;
}

export default VisitorScreen;
