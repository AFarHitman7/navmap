// Fresh-scan contract for the Kotlin WifiManager bridge.
// r.timestamp from ScanResult is microseconds since boot (elapsedRealtime
// domain), NOT Unix time. Never treat a re-delivered result as fresh.

export type WifiReading = {
  bssid: string;
  rssi: number;
  seenAtElapsedMicros: number;
};

export type WifiScanResults = {
  updated: boolean;
  observedAtElapsedMicros: number;
  readings: WifiReading[];
};

export type SurveyScan = {
  placeId: string;
  capturedAt: number;
  readings: { bssid: string; rssi: number }[];
  seenAtElapsedMicros: number;
};

export function normalizeBssid(bssid: string): string {
  return bssid.trim().toUpperCase();
}

/** Accept a scan only if the OS reports a newer result timestamp. */
export function isFreshScan(
  event: WifiScanResults,
  lastAcceptedMicros: number,
): boolean {
  if (!event.updated) return false;
  if (!(event.observedAtElapsedMicros > lastAcceptedMicros)) return false;
  return event.readings.some((r) => r.seenAtElapsedMicros > lastAcceptedMicros);
}

function scanSeenAt(event: WifiScanResults): number {
  return Math.max(
    event.observedAtElapsedMicros,
    ...event.readings.map((r) => r.seenAtElapsedMicros),
  );
}

/**
 * Collect distinct fresh scans for survey. Two callbacks with the same OS
 * timestamp count as one. Only scans with >=2 visible registered (allowlisted)
 * APs are accepted. Returned readings are filtered to the allowlist.
 */
export function collectDistinctScans(
  events: WifiScanResults[],
  registeredBssids: string[],
  placeId = '',
): SurveyScan[] {
  const allow = new Set(registeredBssids.map(normalizeBssid));
  const accepted: SurveyScan[] = [];
  let lastAcceptedMicros = -1;
  for (const event of events) {
    if (!isFreshScan(event, lastAcceptedMicros)) continue;
    const filtered = event.readings
      .filter((r) => allow.has(normalizeBssid(r.bssid)))
      .map((r) => ({ bssid: normalizeBssid(r.bssid), rssi: r.rssi }));
    // Dedupe identical BSSIDs within one scan, keep strongest.
    const byBssid = new Map<string, number>();
    for (const r of filtered) {
      const prev = byBssid.get(r.bssid);
      if (prev === undefined || r.rssi > prev) byBssid.set(r.bssid, r.rssi);
    }
    const readings = [...byBssid.entries()].map(([bssid, rssi]) => ({
      bssid,
      rssi,
    }));
    if (readings.length < 2) continue;
    lastAcceptedMicros = scanSeenAt(event);
    accepted.push({
      placeId,
      capturedAt: Date.now(),
      readings,
      seenAtElapsedMicros: lastAcceptedMicros,
    });
  }
  return accepted;
}

/** Minimum ms between active scan requests; passive broadcasts may arrive sooner. */
export const SCAN_COOLDOWN_MS = 35_000;

export function canRequestScan(lastRequestAt: number, now: number): boolean {
  return now - lastRequestAt >= SCAN_COOLDOWN_MS;
}
