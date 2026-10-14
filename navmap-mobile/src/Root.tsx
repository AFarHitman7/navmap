import React from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { handleAnchorUrl } from './anchor';
import { apiBaseUrl, venueId as defaultVenueId } from './config';
import {
  downloadPack,
  loadActivePack,
  type AnyManifest,
  type PackAdapter,
} from './pack';
import { memoryTokenStore, type HttpPost, type TokenStore } from './api';
import { canRequestScan, SCAN_COOLDOWN_MS, type WifiScanResults } from './scan';
import { onScanResults as defaultOnScanResults, requestScan as defaultRequestScan, scanAnchor as defaultScanAnchor } from './native';
import { fsPackAdapter, keychainTokenStore } from './storage';
import type { ManifestV3 } from './contract-v3';
import type { MapManifest } from './map-contract';
import { classifyGpsZone, matchNode, resolveLocation, type LocationState } from './positioning-v3';
import { SurveyScreen } from './SurveyScreen';
import { VisitorScreen } from './VisitorScreen';
import { AnchorScanner } from './AnchorScanner';

type GpsFix = { lat: number; lon: number; accuracy: number; seenAt: number };

export type RootDeps = {
  venueId?: string;
  initialManifest?: AnyManifest | null;
  packAdapter?: PackAdapter;
  httpPost?: HttpPost;
  tokenStore?: TokenStore;
  subscribeScans?: (handler: (e: WifiScanResults) => void) => () => void;
  requestScanFn?: () => Promise<boolean>;
  scanAnchorFn?: () => Promise<string>;
  getGps?: () => Promise<GpsFix | null>;
  initialUrl?: string | null;
};

const fetchHttpPost: HttpPost = async (url, body, token) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: () => res.json() as Promise<unknown> };
};

function defaultGetGps(): Promise<GpsFix | null> {
  try {
    // Lazy require keeps jest (node env) from loading the native module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Geolocation = require('react-native-geolocation-service').default ??
      require('react-native-geolocation-service');
    return new Promise((resolve) => {
      Geolocation.getCurrentPosition(
        (pos: { coords: { latitude: number; longitude: number; accuracy: number } }) => {
          resolve({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            seenAt: Date.now(),
          });
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
      );
    });
  } catch {
    return Promise.resolve(null);
  }
}

/**
 * Launchable app root (registered as NavMapPrototype in index.js).
 * Offline-first: loads the active pack on mount; no network required after
 * a pack is active. Download/survey need LAN (API_BASE_URL).
 */
export function Root(deps: RootDeps = {}): React.JSX.Element {
  const venueId = deps.venueId ?? defaultVenueId();
  const adapterRef = React.useRef<PackAdapter | undefined>(deps.packAdapter);
  if (!adapterRef.current) {
    try {
      adapterRef.current = fsPackAdapter();
    } catch {
      adapterRef.current = undefined;
    }
  }
  const adapter = adapterRef.current;
  const httpPost = deps.httpPost ?? fetchHttpPost;
  const tokenStoreRef = React.useRef(deps.tokenStore);
  if (!tokenStoreRef.current) {
    try {
      tokenStoreRef.current = keychainTokenStore();
    } catch {
      tokenStoreRef.current = memoryTokenStore();
    }
  }
  const tokenStore = tokenStoreRef.current;
  const subscribeScans = deps.subscribeScans ?? defaultOnScanResults;
  const requestScanFn = deps.requestScanFn ?? defaultRequestScan;
  const scanAnchorFn = deps.scanAnchorFn ?? defaultScanAnchor;
  const getGps = deps.getGps ?? defaultGetGps;

  const [manifest, setManifest] = React.useState<AnyManifest | null>(deps.initialManifest ?? null);
  const [packStatus, setPackStatus] = React.useState(deps.initialManifest ? 'ready' : 'idle');
  const [packMessage, setPackMessage] = React.useState<string | null>(null);
  const [gps, setGps] = React.useState<GpsFix | null>(null);
  const [events, setEvents] = React.useState<WifiScanResults[]>([]);
  const [lastRequestAt, setLastRequestAt] = React.useState(0);
  const [throttleMessage, setThrottleMessage] = React.useState<string | null>(null);
  const lastHandledUrlRef = React.useRef<string | null>(null);
  const [qrNodeId, setQrNodeId] = React.useState<string | null>(null);
  const [manualNodeId, setManualNodeId] = React.useState<string | null>(null);
  const [destinationId, setDestinationId] = React.useState(deps.initialManifest?.places[0]?.id ?? '');
  const [now, setNow] = React.useState(() => Date.now());
  const [wifiNode, setWifiNode] = React.useState<{ nodeId: string; confidence: 'high' | 'medium' | 'low'; seenAt: number } | null>(null);
  const v3PrevRef = React.useRef<LocationState | null>(null);
  const manifestRef = React.useRef(manifest);
  manifestRef.current = manifest;

  // Live clock for position expiry (v3 resolveLocation + wifi age).
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const handleUrl = React.useCallback(
    (url: string | null) => {
      const m = manifestRef.current;
      if (!url || !m) return;
      const fix = handleAnchorUrl(url, m, lastHandledUrlRef.current);
      if (fix) {
        lastHandledUrlRef.current = url;
        setQrNodeId(fix.nodeId);
      }
    },
    [],
  );

  // Cold-start pack load (offline-first) + initial deep link.
  React.useEffect(() => {
    let live = true;
    if (!adapter) return () => undefined;
    if (deps.initialManifest) {
      return () => undefined;
    }
    void (async () => {
      try {
        const m = await loadActivePack(venueId, adapter);
        if (!live) return;
        if (m) {
          setManifest(m);
          setPackStatus('ready');
        } else {
          setPackStatus('empty');
        }
      } catch (e) {
        if (live) {
          setPackStatus('error');
          setPackMessage(e instanceof Error ? e.message : 'pack load failed');
        }
      }
    })();
    Linking.getInitialURL()
      .then((url) => {
        if (live && url) handleUrl(url);
      })
      .catch(() => undefined);
    const sub = Linking.addEventListener('url', ({ url }: { url: string }) => handleUrl(url));
    return () => {
      live = false;
      if (typeof sub?.remove === 'function') sub.remove();
    };
  }, [adapter, venueId, handleUrl, deps.initialManifest]);

  // Resumed deep links when the manifest arrives after the URL.
  React.useEffect(() => {
    if (deps.initialUrl && manifest) handleUrl(deps.initialUrl);
  }, [deps.initialUrl, manifest, handleUrl]);

  // Live Wi-Fi scan results -> room match -> wifi fix.
  React.useEffect(() => {
    setDestinationId(manifest?.places[0]?.id ?? '');
  }, [manifest]);

  React.useEffect(() => {
    let unsub: () => void = () => undefined;
    try {
      unsub = subscribeScans((e) => {
        setEvents((prev) => [...prev.slice(-19), e]);
        const m = manifestRef.current;
        if (!m) return;
        const nm = matchNode(
          e.readings.map((r) => ({ bssid: r.bssid, rssi: r.rssi })),
          m.profiles,
          m.aps,
        );
        if (nm) setWifiNode({ nodeId: nm.nodeId, confidence: nm.confidence, seenAt: Date.now() });
      });
    } catch {
      // Native bridge unavailable (jest / no device) — survey stays manual.
    }
    return unsub;
  }, [subscribeScans]);

  const onDownload = () => {
    if (!adapter) {
      setPackMessage('pack storage unavailable');
      return;
    }
    setPackStatus('loading');
    setPackMessage(null);
    void downloadPack(venueId, 0, adapter, apiBaseUrl()).then(
      async (m) => {
        setManifest(m);
        setPackStatus('ready');
      },
      (e: unknown) => {
        setPackStatus('error');
        setPackMessage(e instanceof Error ? e.message : 'download failed');
      },
    );
  };

  const onRequestScan = () => {
    const nowMs = Date.now();
    if (!canRequestScan(lastRequestAt, nowMs)) {
      setThrottleMessage(
        `Scan cooldown: wait ${Math.ceil((SCAN_COOLDOWN_MS - (nowMs - lastRequestAt)) / 1000)}s.`,
      );
      return;
    }
    setLastRequestAt(nowMs);
    void requestScanFn().then(
      (accepted) => {
        setThrottleMessage(accepted ? null : 'OS throttled the scan request; passive scans may arrive.');
      },
      (e: unknown) => {
        setThrottleMessage(e instanceof Error ? e.message : 'scan request failed');
      },
    );
  };

  const onRefreshGps = () => {
    // Static mode never requests geolocation: GPS cannot classify floor plans.
    if (manifest !== null && (manifest as MapManifest).schemaVersion === 5 && (manifest as MapManifest).canvas.kind === 'static') {
      return;
    }
    void getGps().then((fix) => {
      if (fix) setGps(fix);
    });
  };

  const manifestV3: AnyManifest | null = manifest;
  const manifestCanvas = manifest !== null && (manifest as MapManifest).schemaVersion === 5
    ? (manifest as MapManifest).canvas
    : undefined;
  const gpsZone = manifestV3 && gps
    ? classifyGpsZone({ boundary: manifestV3.boundary, indoorZones: manifestV3.indoorZones, canvas: manifestCanvas }, gps.lat, gps.lon)
    : null;
  let v3Location: LocationState | null = null;
  if (manifestV3) {
    v3Location = resolveLocation(
      {
        wifi: wifiNode,
        gpsZone,
        gpsSeenAt: gps?.seenAt ?? null,
        qr: qrNodeId ? { nodeId: qrNodeId } : null,
        manual: manualNodeId ? { nodeId: manualNodeId } : null,
      },
      v3PrevRef.current,
      manifestV3,
      now,
    );
    v3PrevRef.current = v3Location;
  }
  const v3NodeId = v3Location?.kind === 'node' ? v3Location.nodeId : null;
  const v3ZoneId = v3Location?.kind === 'node' ? v3Location.zoneId : v3Location?.kind === 'zone' ? v3Location.zoneId : null;
  const resumeAuto = React.useCallback(() => {
    setQrNodeId(null);
    setManualNodeId(null);
  }, []);

  return (
    <ScrollView testID="root">
      <View testID="root-header">
        <Text testID="root-title">NavMap Prototype</Text>
        <Text testID="pack-status">
          Pack {venueId}: {packStatus}
          {packMessage ? ` — ${packMessage}` : ''}
        </Text>
        <Pressable testID="pack-download" accessibilityRole="button" accessibilityLabel="Download pack" onPress={onDownload}>
          <Text>Download pack ({apiBaseUrl()})</Text>
        </Pressable>
        <Pressable testID="gps-refresh" accessibilityRole="button" accessibilityLabel="Refresh GPS" onPress={onRefreshGps}>
          <Text>Refresh GPS{gps ? ` (${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)})` : ''}</Text>
        </Pressable>
        {manifest ? (
          <Pressable testID="resume-auto" accessibilityRole="button" accessibilityLabel="Resume auto" onPress={resumeAuto}>
            <Text>Resume auto</Text>
          </Pressable>
        ) : null}
      </View>
      <AnchorScanner scanAnchor={scanAnchorFn} onScanned={(payload) => handleUrl(payload)} />
      {manifest ? (
        <>
          {manifestV3 ? <SurveyScreen
            events={events}
            lastRequestAt={lastRequestAt} now={now} throttleMessage={throttleMessage}
            onRequestScan={onRequestScan} httpPost={httpPost} tokenStore={tokenStore}
            onSaved={() => undefined} draft={manifestV3} venueId={venueId}
            packAdapter={adapter}
          /> : null}
          <VisitorScreen
            manifest={manifest}
            packAdapter={adapter}
            qrNodeId={qrNodeId}
            manualNodeId={manualNodeId}
            destinationId={destinationId}
            onDestination={setDestinationId}
            onManualStart={setManualNodeId}
            v3Location={v3Location}
            v3NodeId={v3NodeId}
            v3ZoneId={v3ZoneId}
            onResumeAuto={resumeAuto}
          />
        </>
      ) : (
        <View testID="root-empty">
          <Text>No V3 venue pack downloaded yet. Connect to the organizer and download the latest pack.</Text>
        </View>
      )}
    </ScrollView>
  );
}

export default Root;
