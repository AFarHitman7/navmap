import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ManifestV3 } from './contract-v3';
import type { LocationState } from './positioning-v3';
import { shortestPathV3 } from './route-v3';
import { MapView } from './map/MapView';

export type VisitorScreenProps = {
  manifest: ManifestV3;
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
  const route = startId && destinationNodeId ? shortestPathV3(manifest, startId, destinationNodeId) ?? [] : [];
  const floors = zoneId ? manifest.indoorZones.find((z) => z.id === zoneId)?.floors ?? [] : [{ z: 0, label: 'Ground' }];

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
    <MapView path={route} onlineTiles v3={{ boundary: manifest.boundary, zones: manifest.indoorZones, nodes: manifest.nodes, activeZoneId: zoneId, floorFilter: floorZ }} />
  </View>;
}

export default VisitorScreen;
