import { normalizeBssid } from './scan';
import { containsPoint } from './geo';
import type { BoundsV3 } from './contract-v3';
import type { Rect } from './map-contract';
export type Reading = { bssid: string; rssi: number };
export type NodeProfile = { nodeId: string; medianRssi: Record<string, number>; scanCount: number };
export type NodeMatch = { nodeId: string; score: number; commonAps: number; confidence: 'high' | 'medium' | 'low' };

export const MISSING_AP_PENALTY_DB = 8;
/** Worst acceptable mean absolute RSSI error; poorer fits are rejected outright. */
export const MAX_MEAN_ABS_ERROR_DB = 12;
export const HIGH_CONF_MIN_COMMON = 3;
export const HIGH_CONF_MIN_MARGIN_DB = 3;

/**
 * Node-level fingerprint match. Unlike place matching, the missing-AP
 * penalty is scoped to the candidate profile's own AP set so venues with
 * many APs don't drown out small fingerprints.
 */
export function matchNode(readings: Reading[], profiles: NodeProfile[], allowlist: string[]): NodeMatch | null {
  const allow = new Set(allowlist.map(normalizeBssid));
  const live = new Map<string, number>();
  for (const r of readings) {
    const b = normalizeBssid(r.bssid);
    if (!allow.has(b)) continue;
    const prev = live.get(b);
    if (prev === undefined || r.rssi > prev) live.set(b, r.rssi);
  }
  if (live.size === 0) return null;
  const scored = profiles.flatMap((p) => {
    const keys = Object.keys(p.medianRssi).filter((k) => allow.has(normalizeBssid(k)));
    const common = keys.filter((k) => live.has(normalizeBssid(k)));
    if (common.length < 2) return [];
    const meanErr =
      common.reduce((s, k) => s + Math.abs(live.get(normalizeBssid(k))! - p.medianRssi[k]!), 0) / common.length;
    if (meanErr > MAX_MEAN_ABS_ERROR_DB) return [];
    const missing = keys.length - common.length;
    return [{ nodeId: p.nodeId, score: meanErr + MISSING_AP_PENALTY_DB * missing, commonAps: common.length }];
  });
  if (scored.length === 0) return null;
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0]!;
  const margin = scored.length > 1 ? scored[1]!.score - best.score : Number.POSITIVE_INFINITY;
  const confidence =
    best.commonAps >= HIGH_CONF_MIN_COMMON && margin >= HIGH_CONF_MIN_MARGIN_DB
      ? 'high'
      : best.commonAps >= HIGH_CONF_MIN_COMMON || margin >= HIGH_CONF_MIN_MARGIN_DB
        ? 'medium'
        : 'low';
  return { ...best, confidence };
}

export type ZoneEstimate =
  | { kind: 'indoors'; zoneId: string }
  | { kind: 'outdoors' }
  | { kind: 'outside' };

type GeoBoundsLike = { north: number; south: number; east: number; west: number };
type ZoneBoundsLike = BoundsV3 | Rect;

function isGeographicBounds(bounds: unknown): bounds is GeoBoundsLike {
  if (typeof bounds !== 'object' || bounds === null) return false;
  const b = bounds as Record<string, unknown>;
  // Legacy V4 bounds carry no kind discriminant and are always geographic.
  if (!('kind' in b) || b.kind === undefined) {
    return (
      typeof b.north === 'number' && typeof b.south === 'number' && typeof b.east === 'number' && typeof b.west === 'number'
    );
  }
  return (b as { kind?: unknown }).kind === 'geographic';
}

/**
 * GPS classifies zones only — it never identifies a node or floor.
 * Geographic-only: static canvases are bypassed (reported as outside) and
 * never classified, and static mode never requests geolocation.
 */
export function classifyGpsZone(
  map: {
    boundary: BoundsV3 | { kind: string; north?: number; south?: number; east?: number; west?: number } | null;
    indoorZones: Array<{ id: string; bounds?: ZoneBoundsLike }>;
    canvas?: { kind: 'geographic' | 'static' };
  },
  lat: number,
  lng: number,
): ZoneEstimate {
  if (map.canvas?.kind === 'static') return { kind: 'outside' };
  if (!isGeographicBounds(map.boundary)) return { kind: 'outside' };
  const boundary = map.boundary as BoundsV3;
  if (!containsPoint(boundary, lat, lng)) return { kind: 'outside' };
  for (const zone of map.indoorZones) {
    if (!isGeographicBounds(zone.bounds)) continue;
    if (containsPoint(zone.bounds as BoundsV3, lat, lng)) return { kind: 'indoors', zoneId: zone.id };
  }
  return { kind: 'outdoors' };
}

export const WIFI_FRESH_MS = 60_000;
export const NODE_STALE_MS = 120_000;

export type LocationState =
  | { kind: 'unknown' }
  | { kind: 'node'; nodeId: string; zoneId: string | null; z: number; source: 'wifi' | 'qr' | 'manual'; seenAt: number }
  | { kind: 'zone'; zoneId: string | null; seenAt: number; staleNode?: LocationState };

export type LocationEvidence = {
  wifi: { nodeId: string; confidence: 'high' | 'medium' | 'low'; seenAt: number } | null;
  gpsZone: ZoneEstimate | null;
  gpsSeenAt: number | null;
  qr: { nodeId: string } | null;
  manual: { nodeId: string } | null;
};

type NodeRef = { id: string; zoneId: string | null; z: number };

/**
 * v3 location resolution. Precedence: manual -> qr -> fresh high/medium
 * wifi -> gps zone (or retained fresh node). GPS never sets node/floor.
 * Manual/qr stick until the caller clears them (resumeAuto).
 */
export function resolveLocation(
  evidence: LocationEvidence,
  previous: LocationState | null,
  map: { nodes: NodeRef[] },
  now: number,
): LocationState {
  if (evidence.manual) {
    const node = map.nodes.find((n) => n.id === evidence.manual!.nodeId);
    if (node) {
      return { kind: 'node', nodeId: node.id, zoneId: node.zoneId, z: node.z, source: 'manual', seenAt: now };
    }
  }
  if (evidence.qr) {
    const node = map.nodes.find((n) => n.id === evidence.qr!.nodeId);
    if (node) {
      return { kind: 'node', nodeId: node.id, zoneId: node.zoneId, z: node.z, source: 'qr', seenAt: now };
    }
  }
  const wifi = evidence.wifi;
  if (
    wifi &&
    now - wifi.seenAt <= WIFI_FRESH_MS &&
    (wifi.confidence === 'high' || wifi.confidence === 'medium')
  ) {
    const node = map.nodes.find((n) => n.id === wifi.nodeId);
    if (node) {
      return { kind: 'node', nodeId: node.id, zoneId: node.zoneId, z: node.z, source: 'wifi', seenAt: wifi.seenAt };
    }
  }
  // Low-confidence or stale/unknown wifi never sets a node — fall through.

  const prevNode = previous && previous.kind === 'node' ? previous : null;
  const gpsFresh =
    evidence.gpsZone !== null &&
    evidence.gpsSeenAt !== null &&
    now - (evidence.gpsSeenAt as number) <= WIFI_FRESH_MS;
  if (prevNode && now - prevNode.seenAt <= NODE_STALE_MS) {
    if (gpsFresh) {
      const zoneId = evidence.gpsZone!.kind === 'indoors' ? evidence.gpsZone!.zoneId : null;
      return { kind: 'zone', zoneId, seenAt: evidence.gpsSeenAt as number, staleNode: prevNode };
    }
    return prevNode;
  }
  if (gpsFresh) {
    const zoneId = evidence.gpsZone!.kind === 'indoors' ? evidence.gpsZone!.zoneId : null;
    return { kind: 'zone', zoneId, seenAt: evidence.gpsSeenAt as number };
  }
  if (previous && previous.kind === 'zone' && now - previous.seenAt <= WIFI_FRESH_MS) {
    return previous;
  }
  return { kind: 'unknown' };
}
