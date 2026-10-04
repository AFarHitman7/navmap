import { collectDistinctScans, type WifiScanResults } from '../src/scan';

const AP = [
  'AA:BB:CC:DD:EE:01',
  'AA:BB:CC:DD:EE:02',
  'AA:BB:CC:DD:EE:03',
  'AA:BB:CC:DD:EE:04',
];

const scanAt = (t: number): WifiScanResults => ({
  updated: true,
  observedAtElapsedMicros: t,
  readings: [
    { bssid: AP[0], rssi: -50, seenAtElapsedMicros: t },
    { bssid: AP[1], rssi: -65, seenAtElapsedMicros: t },
    { bssid: 'FF:FF:FF:FF:FF:FF', rssi: -40, seenAtElapsedMicros: t },
  ],
});

test('duplicate OS timestamps count once; unknown BSSIDs filtered', () => {
  const accepted = collectDistinctScans(
    [scanAt(100), scanAt(100), scanAt(135), scanAt(170)],
    AP,
  );
  expect(accepted).toHaveLength(3);
  expect(accepted[0].readings.every((r) => AP.includes(r.bssid))).toBe(true);
});

test('scans with fewer than 2 registered APs are rejected', () => {
  const thin: WifiScanResults = {
    updated: true,
    observedAtElapsedMicros: 200,
    readings: [{ bssid: AP[0], rssi: -50, seenAtElapsedMicros: 200 }],
  };
  expect(collectDistinctScans([thin], AP)).toHaveLength(0);
});
