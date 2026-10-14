import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ManifestV3 } from './contract-v3';
import type { MapManifest } from './map-contract';
import type { LocationState } from './positioning-v3';
import { shortestPathV3 } from './route-v3';
import { MapView } from './map/MapView';

export type AnyVisitorManifest = ManifestV3 | MapManifest;

function isV5Static(manifest: AnyVisitorManifest): boolean {
  return (manifest as MapManifest).schemaVersion === 5 && (manifest as MapManifest).canvas.kind === 'static';
}

/**
 * Project a readable manifest to the geographic tile-map input. V4 passes
 * through; V5-geographic projects frame positions; static has no tile map
 * yet (null) and renders a placeholder instead.
 */
function toTileInput(
  manifest: AnyVisitorManifest,
  activeZoneId: string | null,
  floorFilter: number | null,
): {
  boundary: { north: number; south: number; east: number; west: number } | null;
  zones: { id: string; name: string; bounds: { north: number; south: number; east: number; west: number } }[];
  nodes: { id: string; lat: number; lng: number; z: number; zoneId: string | null }[];
  activeZoneId: string | null;
  floorFilter: number | null;
} | null {
  if (isV5Static(manifest)) return null;
  if ((manifest as MapManifest).schemaVersion === 5) {
    const v5 = manifest as MapManifest;
    if (v5.boundary === null || v5.boundary.kind !== 'geographic') return null;
    const { kind: _bKind, ...boundary } = v5.boundary;
    const zones = v5.indoorZones.flatMap((z) =>
      z.bounds && z.bounds.kind === 'geographic'
        ? [{ id: z.id, name: z.name, bounds: { north: z.bounds.north, south: z.bounds.south, east: z.bounds.east, west: z.bounds.west } }]
        : [],
    );
    const nodes = v5.nodes.flatMap((n) =>
      n.position.kind === 'geographic'
        ? [{ id: n.id, lat: n.position.lat, lng: n.position.lng, z: n.z, zoneId: n.zoneId }]
        : [],
    );
    return { boundary, zones, nodes, activeZoneId, floorFilter };
  }
  const v4 = manifest as ManifestV3;
  return { boundary: v4.boundary, zones: v4.indoorZones, nodes: v4.nodes, activeZoneId, floorFilter };
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
};

export function VisitorScreen(props: VisitorScreenProps): React.JSX.Element {
  const { manifest } = props;
  const [zoneId, setZoneId] = React.useState<string | null>(props.v3ZoneId);
  const [floorZ, setFloorZ] = React.useState<number | null>(0);
  const [destinationId, setDestinationId] = React.useState(props.destinationId || manifest.places[0]?.id || '');
  React.useEffect(() => setZoneId(props.v3ZoneId), [props.v3ZoneId]);
  const destination = manifest.places.find((p) => p.id === destinationId);
  const destinationNodeId = destination?.nodeId ?? (manifest.nodes.some((n) => n.id === destinationId) ? destinationId : '');
  const startId = props.v3NodeId ?? props.qrNodeId ?? props.manualNodeId;
  const startNode = startId ? manifest.nodes.find((n) => n.id === startId) ?? null : null;
  const route =
    startId && destinationNodeId
      ? ((manifest as MapManifest).schemaVersion === 5
          ? shortestPathV3(manifest as MapManifest, startId, destinationNodeId)
          : shortestPathV3(manifest as ManifestV3, startId, destinationNodeId)) ?? []
      : [];
  const floors = zoneId ? manifest.indoorZones.find((z) => z.id === zoneId)?.floors ?? [] : [{ z: 0, label: 'Ground' }];
  // The geographic tile map renders V4 and V5-geographic manifests; static
  // canvases render in a later task and show an explicit placeholder here.
  const staticCanvas = isV5Static(manifest);
  const tileInput = staticCanvas ? null : toTileInput(manifest, zoneId, floorZ);

  return <View testID="visitor-screen">
    <Text testID="visitor-title">Visitor</Text>
    <Text testID="visitor-v3-location">Start: {startNode?.name ?? startId ?? 'unknown'}{startNode ? ` (${startNode.id})` : ''}{props.v3ZoneId ? ` · zone ${props.v3ZoneId}` : ''}</Text>
    <Text testID="visitor-gps-note">GPS can suggest an area; it does not identify a node or floor.</Text>
    <Text testID="visitor-wifi-note">Wi-Fi node positioning is app-only.</Text>
    <Text>Destinations</Text>
    {manifest.places.map((p) => <Pressable key={p.id} testID={`visitor-dest-${p.id}`} onPress={() => { setDestinationId(p.id); props.onDestination(p.id); }}><Text>{p.name}</Text></Pressable>)}
    {manifest.nodes.map((n) => <Pressable key={`dest-${n.id}`} testID={`visitor-v3-dest-${n.id}`} onPress={() => setDestinationId(n.id)}><Text>Destination {n.name}</Text></Pressable>)}
    {manifest.nodes.map((n) => <Pressable key={n.id} testID={`visitor-start-${n.id}`} onPress={() => props.onManualStart(n.id)}><Text>Start at {n.name}</Text></Pressable>)}
    <Pressable testID="visitor-resume-auto" accessibilityRole="button" accessibilityLabel="Resume auto" onPress={props.onResumeAuto}><Text>Resume auto</Text></Pressable>
    <Text testID="visitor-route">Route: {route.length ? route.join(' → ') : 'no route (pick a start and connected destination)'}</Text>
    {manifest.indoorZones.map((z) => <Pressable key={z.id} testID={`visitor-v3-zone-${z.id}`} onPress={() => { setZoneId(z.id); setFloorZ(z.floors[0]?.z ?? 0); }}><Text>{z.name}</Text></Pressable>)}
    <Pressable testID="visitor-v3-zone-outdoors" onPress={() => { setZoneId(null); setFloorZ(0); }}><Text>Outdoors</Text></Pressable>
    {floors.map((f) => <Pressable key={f.z} testID={`visitor-v3-floor-${f.z}`} onPress={() => setFloorZ(f.z)}><Text>{f.label}{floorZ === f.z ? ' (viewing)' : ''}</Text></Pressable>)}
    {staticCanvas || !tileInput ? (
      <Text testID="visitor-static-note">Static floor-plan rendering arrives in a later update; routing and survey work now.</Text>
    ) : (
      <MapView path={route} onlineTiles v3={tileInput} />
    )}
  </View>;
}

export default VisitorScreen;
