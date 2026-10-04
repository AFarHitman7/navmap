import { isFreshScan, type WifiScanResults } from '../src/scan';

const B = 'AA:BB:CC:DD:EE:01';
const reading = (seen: number) => ({ bssid: B, rssi: -50, seenAtElapsedMicros: seen });
const event = (observed: number, seen: number, updated = true): WifiScanResults => ({
  updated,
  observedAtElapsedMicros: observed,
  readings: [reading(seen)],
});

test('stale re-delivered scan is not fresh', () => {
  expect(isFreshScan(event(1_000_000, 900_000), 1_100_000)).toBe(false);
});

test('newer OS timestamp is fresh', () => {
  expect(isFreshScan(event(1_200_000, 1_200_000), 1_100_000)).toBe(true);
});

test('updated=false is never fresh', () => {
  expect(isFreshScan(event(2_000_000, 2_000_000, false), 1_100_000)).toBe(false);
});
