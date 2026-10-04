import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { canRequestScan, collectDistinctScans, type SurveyScan, type WifiScanResults } from './scan';
import type { HttpPost, TokenStore } from './api';
import { apiBase } from './pack';
import type { DraftV3, ManifestV3 } from './contract-v3';
import { pathPointLabels, orderSurveyNodes } from './path-survey';

/** Upload node samples; defaults to POST /api/admin/venues/:venueId/node-samples. */
export type PostNodeSamples = (
  venueId: string,
  nodeId: string,
  scans: SurveyScan[],
) => Promise<number>;

export type SurveyScreenProps = {
  events: WifiScanResults[];
  lastRequestAt: number;
  now: number;
  throttleMessage: string | null;
  onRequestScan: () => void;
  httpPost: HttpPost;
  tokenStore: TokenStore;
  onSaved: (count: number) => void;
  venueId?: string;
  /** v3 map to survey any node in (place flow is used when absent). */
  draft: DraftV3 | ManifestV3;
  postNodeSamples?: PostNodeSamples;
};

export const MIN_SCANS = 3;
export const MIN_APS_PER_SCAN = 2;

/** Organizer survey: only fresh, distinct, allowlisted scans count. */
export function SurveyScreen(props: SurveyScreenProps): React.JSX.Element {
  return <NodeSurveyScreen {...props} draft={props.draft} />;
}

export default SurveyScreen;

const OUTDOORS = 'outdoors';

/** v3 survey for any node: venue is fixed, then zone > floor > node cascade. */
function NodeSurveyScreen(
  props: SurveyScreenProps & { draft: DraftV3 | ManifestV3 },
): React.JSX.Element {
  const { draft } = props;
  const venueId = props.venueId ?? draft.venueId;
  const allowlist = draft.aps;
  const [zoneId, setZoneId] = React.useState<string | null>(null);
  const [floorZ, setFloorZ] = React.useState<number | null>(null);
  const [nodeId, setNodeId] = React.useState<string | null>(null);

  const zone = zoneId && zoneId !== OUTDOORS ? draft.indoorZones.find((z) => z.id === zoneId) ?? null : null;
  const floors = zone ? zone.floors : zoneId === OUTDOORS ? [{ z: 0, label: 'Ground' }] : [];
  const floorLabel = floors.find((f) => f.z === floorZ)?.label ?? null;
  const nodes = orderSurveyNodes(
    draft,
    zoneId === null || floorZ === null
      ? []
      : draft.nodes.filter((n) =>
          zoneId === OUTDOORS ? n.zoneId === null && n.z === floorZ : n.zoneId === zoneId && n.z === floorZ,
        ),
  );
  const node = nodeId ? draft.nodes.find((n) => n.id === nodeId) ?? null : null;
  const accepted: SurveyScan[] = node
    ? collectDistinctScans(props.events, allowlist, node.id)
    : [];
  const ready = node !== null && accepted.length >= MIN_SCANS;
  const cooldown = !canRequestScan(props.lastRequestAt, props.now);

  const postSamples: PostNodeSamples =
    props.postNodeSamples ??
    (async (vId, nId, scans) => {
      const token = await props.tokenStore.getToken();
      if (!token) throw new Error('survey login required');
      const target = draft.nodes.find((n) => n.id === nId) ?? null;
      const url = `${apiBase()}/api/admin/venues/${encodeURIComponent(vId)}/node-samples`;
      const res = await props.httpPost(
        url,
        {
          nodeId: nId,
          scans: scans.map((s) => ({
            nodeId: nId,
            fingerprintRevision: target?.fingerprintRevision ?? 0,
            capturedAt: s.capturedAt,
            readings: s.readings,
          })),
        },
        token,
      );
      if (res.status !== 200 && res.status !== 201) {
        throw new Error(`save node survey failed (${res.status})`);
      }
      const data = (await res.json()) as { count?: number };
      if (typeof data.count !== 'number') throw new Error('save node survey failed (bad response)');
      return data.count;
    });

  return (
    <View testID="survey-screen">
      <Text testID="v3-venue">Venue {venueId}</Text>
      {draft.indoorZones.map((z) => (
        <Pressable
          key={z.id}
          testID={`v3-zone-${z.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Survey zone ${z.name}`}
          onPress={() => {
            setZoneId(z.id);
            setFloorZ(null);
            setNodeId(null);
          }}
        >
          <Text>{z.name}</Text>
        </Pressable>
      ))}
      <Pressable
        testID="v3-zone-outdoors"
        accessibilityRole="button"
        accessibilityLabel="Survey outdoors"
        onPress={() => {
          setZoneId(OUTDOORS);
          setFloorZ(null);
          setNodeId(null);
        }}
      >
        <Text>Outdoors</Text>
      </Pressable>
      {floors.map((f) => (
        <Pressable
          key={f.z}
          testID={`v3-floor-${f.z}`}
          accessibilityRole="button"
          accessibilityLabel={`Survey floor ${f.label}`}
          onPress={() => {
            setFloorZ(f.z);
            setNodeId(null);
          }}
        >
          <Text>{f.label}</Text>
        </Pressable>
      ))}
      {nodes.map((n) => (
        <Pressable
          key={n.id}
          testID={`v3-node-${n.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Survey node ${n.name}`}
          onPress={() => setNodeId(n.id)}
        >
          <Text>
            {n.name}
            {pathPointLabels(draft, n.id).map((l) => ` ${l.pathName} · Point ${l.index} of ${l.total}`)}
          </Text>
        </Pressable>
      ))}
      {node ? (
        <View testID="v3-confirm">
          <Text>Node {node.name} ({node.id})</Text>
          <Text>Zone {zone ? `${zone.id} (${zone.name})` : 'Outdoors'}</Text>
          <Text>Floor {floorLabel ?? String(node.z)}</Text>
          <Text>
            Coords {node.lat}, {node.lng}
          </Text>
          {pathPointLabels(draft, node.id).map((l) => (
            <Text key={l.pathId}>
              {l.pathName} · Point {l.index} of {l.total}
            </Text>
          ))}
        </View>
      ) : null}
      <Text testID="v3-survey-status" accessibilityRole="text">
        {accepted.length}/{MIN_SCANS} fresh scans (need {MIN_APS_PER_SCAN}+ registered APs each)
      </Text>
      {props.throttleMessage ? (
        <Text testID="survey-throttle" accessibilityRole="alert">
          {props.throttleMessage}
        </Text>
      ) : null}
      {cooldown ? (
        <Text testID="survey-cooldown">
          Scan cooldown: wait before requesting again. Passive scans may arrive sooner.
        </Text>
      ) : null}
      <Pressable
        testID="v3-survey-request-scan"
        accessibilityRole="button"
        accessibilityLabel="Request scan"
        disabled={cooldown}
        onPress={props.onRequestScan}
      >
        <Text>Request scan</Text>
      </Pressable>
      <Pressable
        testID="v3-survey-save"
        accessibilityRole="button"
        accessibilityLabel="Save node survey"
        disabled={!ready}
        onPress={() => {
          if (!node) return;
          void postSamples(venueId, node.id, accepted).then(props.onSaved);
        }}
      >
        <Text>Save node survey</Text>
      </Pressable>
    </View>
  );
}
