/**
 * Honest location display states for visitor maps.
 *
 * A GPS fix is display-only evidence: it is rendered as an unsnapped dot
 * plus accuracy circle and never establishes an indoor node, room, or floor.
 * Node-based positions (wifi/qr/manual) resolve to a known graph node but
 * manual/QR labels must stay explicit and never imply continuous tracking.
 */

export const GPS_STALE_MS = 60_000;
export const NODE_STALE_MS = 120_000;

export type LocationUnknownReason = 'idle' | 'denied' | 'unavailable' | 'timeout' | 'stale';

export type LocationDisplay =
  | { kind: 'unknown'; reason: LocationUnknownReason }
  | {
      kind: 'gps';
      position: { kind: 'geographic'; lat: number; lng: number };
      accuracyMeters: number;
      seenAt: number;
    }
  | { kind: 'node'; nodeId: string; source: 'wifi' | 'qr' | 'manual'; seenAt: number; stale: boolean };

export function isValidGpsReading(
  lat: number,
  lng: number,
  accuracyMeters: number,
  timestampMs: number,
): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (!Number.isFinite(accuracyMeters) || accuracyMeters < 0) return false;
  if (!Number.isFinite(timestampMs)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return true;
}

export function isGpsStale(seenAt: number, now: number): boolean {
  return now - seenAt > GPS_STALE_MS;
}

export function isNodeStale(seenAt: number, now: number): boolean {
  return now - seenAt > NODE_STALE_MS;
}

/** A stale GPS fix carries no position: report unknown/stale instead of guessing. */
export function markGpsStale(display: LocationDisplay, now: number): LocationDisplay {
  if (display.kind === 'gps' && isGpsStale(display.seenAt, now)) {
    return { kind: 'unknown', reason: 'stale' };
  }
  return display;
}

export function toNodeDisplay(
  input: { nodeId: string; source: 'wifi' | 'qr' | 'manual'; seenAt: number },
  now: number,
): LocationDisplay {
  return {
    kind: 'node',
    nodeId: input.nodeId,
    source: input.source,
    seenAt: input.seenAt,
    stale: isNodeStale(input.seenAt, now),
  };
}

type SecureEnv = { isSecureContext?: boolean; hostname?: string };

function readSecureEnv(): SecureEnv {
  try {
    const w = window as Window & { isSecureContext?: boolean };
    return { isSecureContext: w.isSecureContext, hostname: w.location?.hostname };
  } catch {
    return {};
  }
}

/**
 * Geolocation watchPosition requires a secure context; plain localhost
 * (and loopback) origins are treated as secure for local development.
 */
export function isSecureContextForGeolocation(env?: SecureEnv): boolean {
  const { isSecureContext, hostname } = env ?? readSecureEnv();
  if (isSecureContext) return true;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}
