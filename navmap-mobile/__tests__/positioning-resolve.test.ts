import { resolveLocation } from '../src/positioning-v3';

const MAP = {
  nodes: [
    { id: 'n-a0', zoneId: 'b-a', z: 0 },
    { id: 'n-a1', zoneId: 'b-a', z: 1 },
    { id: 'n-out', zoneId: null, z: 0 },
  ],
};

test('wifi high-confidence sets node+zone+z with gps absent', () => {
  const loc = resolveLocation(
    {
      wifi: { nodeId: 'n-a1', confidence: 'high', seenAt: 90_000 },
      gpsZone: null,
      gpsSeenAt: null,
      qr: null,
      manual: null,
    },
    null,
    MAP as any,
    100_000,
  );
  expect(loc).toEqual({ kind: 'node', nodeId: 'n-a1', zoneId: 'b-a', z: 1, source: 'wifi', seenAt: 90_000 });
});

test('low-confidence wifi never sets node', () => {
  const loc = resolveLocation(
    {
      wifi: { nodeId: 'n-a0', confidence: 'low', seenAt: 90_000 },
      gpsZone: null,
      gpsSeenAt: null,
      qr: null,
      manual: null,
    },
    null,
    MAP as any,
    100_000,
  );
  expect(loc).toEqual({ kind: 'unknown' });
});

test('stale wifi expires to unknown', () => {
  const loc = resolveLocation(
    {
      wifi: { nodeId: 'n-a0', confidence: 'high', seenAt: 0 },
      gpsZone: null,
      gpsSeenAt: null,
      qr: null,
      manual: null,
    },
    null,
    MAP as any,
    100_000,
  );
  expect(loc).toEqual({ kind: 'unknown' });
});

test('manual overrides wifi until cleared', () => {
  const withManual = resolveLocation(
    {
      wifi: { nodeId: 'n-a0', confidence: 'high', seenAt: 90_000 },
      gpsZone: null,
      gpsSeenAt: null,
      qr: null,
      manual: { nodeId: 'n-out' },
    },
    null,
    MAP as any,
    100_000,
  );
  expect(withManual).toMatchObject({ kind: 'node', nodeId: 'n-out', source: 'manual' });
  // Caller clears manual (resumeAuto) -> wifi wins again.
  const cleared = resolveLocation(
    {
      wifi: { nodeId: 'n-a0', confidence: 'high', seenAt: 90_000 },
      gpsZone: null,
      gpsSeenAt: null,
      qr: null,
      manual: null,
    },
    withManual,
    MAP as any,
    100_000,
  );
  expect(cleared).toMatchObject({ kind: 'node', nodeId: 'n-a0', source: 'wifi' });
});

test('gps alone gives zone but never node/floor', () => {
  const loc = resolveLocation(
    {
      wifi: null,
      gpsZone: { kind: 'indoors', zoneId: 'b-a' },
      gpsSeenAt: 95_000,
      qr: null,
      manual: null,
    },
    null,
    MAP as any,
    100_000,
  );
  expect(loc.kind).toBe('zone');
  if (loc.kind === 'zone') {
    expect(loc.zoneId).toBe('b-a');
    expect(loc).not.toHaveProperty('nodeId');
    expect(loc).not.toHaveProperty('z');
  }
});
