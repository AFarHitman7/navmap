import { describe, expect, it } from 'vitest';
import {
  GPS_STALE_MS,
  NODE_STALE_MS,
  isGpsStale,
  isNodeStale,
  isSecureContextForGeolocation,
  isValidGpsReading,
  markGpsStale,
  toNodeDisplay,
  type LocationDisplay,
} from '../src/location-view';

describe('location-view', () => {
  it('keeps GPS stale timeout at 60s and node stale timeout at 120s', () => {
    expect(GPS_STALE_MS).toBe(60_000);
    expect(NODE_STALE_MS).toBe(120_000);
  });

  it('marks GPS readings older than 60s as stale, not merely old', () => {
    const seenAt = 1_000_000;
    expect(isGpsStale(seenAt, seenAt + 59_999)).toBe(false);
    expect(isGpsStale(seenAt, seenAt + 60_000)).toBe(false);
    expect(isGpsStale(seenAt, seenAt + 60_001)).toBe(true);
  });

  it('marks automatic node observations stale only after 120s', () => {
    const seenAt = 1_000_000;
    expect(isNodeStale(seenAt, seenAt + 119_999)).toBe(false);
    expect(isNodeStale(seenAt, seenAt + 120_001)).toBe(true);
  });

  it('rejects non-finite and out-of-range GPS readings', () => {
    expect(isValidGpsReading(13.05, 80.25, 10, 1_000_000)).toBe(true);
    expect(isValidGpsReading(Number.NaN, 80.25, 10, 1_000_000)).toBe(false);
    expect(isValidGpsReading(13.05, Number.POSITIVE_INFINITY, 10, 1_000_000)).toBe(false);
    expect(isValidGpsReading(91, 80.25, 10, 1_000_000)).toBe(false);
    expect(isValidGpsReading(-91, 80.25, 10, 1_000_000)).toBe(false);
    expect(isValidGpsReading(13.05, 181, 10, 1_000_000)).toBe(false);
    expect(isValidGpsReading(13.05, -181, 10, 1_000_000)).toBe(false);
    expect(isValidGpsReading(13.05, 80.25, Number.NaN, 1_000_000)).toBe(false);
    expect(isValidGpsReading(13.05, 80.25, -1, 1_000_000)).toBe(false);
    expect(isValidGpsReading(13.05, 80.25, 10, Number.NaN)).toBe(false);
  });

  it('converts a stale GPS display to unknown/stale without inventing a node', () => {
    const fresh: LocationDisplay = {
      kind: 'gps',
      position: { kind: 'geographic', lat: 13.05, lng: 80.25 },
      accuracyMeters: 12,
      seenAt: 1_000_000,
    };
    expect(markGpsStale(fresh, 1_000_000 + 30_000)).toBe(fresh);
    expect(markGpsStale(fresh, 1_000_000 + 60_001)).toEqual({ kind: 'unknown', reason: 'stale' });
    const unknown: LocationDisplay = { kind: 'unknown', reason: 'idle' };
    expect(markGpsStale(unknown, 1_000_000 + 600_000)).toBe(unknown);
  });

  it('labels node displays stale only after the automatic-observation timeout', () => {
    const seenAt = 1_000_000;
    expect(toNodeDisplay({ nodeId: 'n-a0', source: 'wifi', seenAt }, seenAt + 30_000))
      .toEqual({ kind: 'node', nodeId: 'n-a0', source: 'wifi', seenAt, stale: false });
    expect(toNodeDisplay({ nodeId: 'n-a0', source: 'wifi', seenAt }, seenAt + 120_001).stale).toBe(true);
    expect(toNodeDisplay({ nodeId: 'n-a0', source: 'manual', seenAt }, seenAt + 30_000).source).toBe('manual');
    expect(toNodeDisplay({ nodeId: 'n-a0', source: 'qr', seenAt }, seenAt + 30_000).source).toBe('qr');
  });

  it('allows geolocation only in secure contexts, with localhost treated as secure', () => {
    expect(isSecureContextForGeolocation({ isSecureContext: true, hostname: 'example.com' })).toBe(true);
    expect(isSecureContextForGeolocation({ isSecureContext: false, hostname: 'localhost' })).toBe(true);
    expect(isSecureContextForGeolocation({ isSecureContext: false, hostname: '127.0.0.1' })).toBe(true);
    expect(isSecureContextForGeolocation({ isSecureContext: false, hostname: '::1' })).toBe(true);
    expect(isSecureContextForGeolocation({ isSecureContext: false, hostname: 'example.com' })).toBe(false);
    expect(isSecureContextForGeolocation({ isSecureContext: false, hostname: '' })).toBe(false);
  });
});
