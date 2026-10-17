import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isSecureContextForGeolocation,
  isValidGpsReading,
  markGpsStale,
  type LocationDisplay,
  type LocationUnknownReason,
} from '../location-view';

export type UseGeolocationCanvasKind = 'geographic' | 'static';

export type UseGeolocationOptions = {
  enabled: boolean;
  canvasKind: UseGeolocationCanvasKind;
};

export type UseGeolocationResult = {
  location: LocationDisplay;
  start: () => void;
  stop: () => void;
};

type GpsFix = { lat: number; lng: number; accuracyMeters: number; seenAt: number };

function errorReason(code: number): LocationUnknownReason {
  if (code === 1) return 'denied';
  if (code === 2) return 'unavailable';
  if (code === 3) return 'timeout';
  return 'unavailable';
}

/**
 * Opt-in browser geolocation for geographic canvases only.
 *
 * No watch starts until the caller invokes `start()` (the "Locate me"
 * action). Static canvases never touch `navigator.geolocation`. The watch
 * is cleared on `stop()`, unmount, `enabled` loss, and canvas-kind switches;
 * callers must also call `stop()` when switching maps/frames.
 */
export function useGeolocation({ enabled, canvasKind }: UseGeolocationOptions): UseGeolocationResult {
  const [fix, setFix] = useState<GpsFix | null>(null);
  const [failure, setFailure] = useState<LocationUnknownReason | null>(null);
  // Mount-time clock for staleness derivation; refreshed by the interval below.
  const [now, setNow] = useState(() => Date.now());
  const watchIdRef = useRef<number | null>(null);

  const clearWatch = useCallback(() => {
    const id = watchIdRef.current;
    watchIdRef.current = null;
    if (id === null) return;
    try {
      navigator.geolocation?.clearWatch(id);
    } catch {
      // Geolocation unavailable (tests, insecure embeds): nothing to cancel.
    }
  }, []);

  const stop = useCallback(() => {
    clearWatch();
    setFix(null);
    setFailure(null);
  }, [clearWatch]);

  const start = useCallback(() => {
    if (!enabled || canvasKind !== 'geographic') return;
    if (!isSecureContextForGeolocation()) {
      setFailure('unavailable');
      return;
    }
    const geolocation = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geolocation || typeof geolocation.watchPosition !== 'function') {
      setFailure('unavailable');
      return;
    }
    clearWatch();
    setFailure(null);
    try {
      watchIdRef.current = geolocation.watchPosition(
        (position: GeolocationPosition) => {
          const { latitude, longitude, accuracy } = position.coords;
          const seenAt = Number.isFinite(position.timestamp) ? position.timestamp : Date.now();
          if (!isValidGpsReading(latitude, longitude, accuracy, seenAt)) {
            setFix(null);
            setFailure('unavailable');
            return;
          }
          setFix({ lat: latitude, lng: longitude, accuracyMeters: accuracy, seenAt });
          setFailure(null);
        },
        (error: GeolocationPositionError) => {
          setFix(null);
          setFailure(errorReason(error?.code ?? 0));
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 },
      );
    } catch {
      setFailure('unavailable');
    }
  }, [enabled, canvasKind, clearWatch]);

  // Canvas-kind switches cancel the watch: a static upload never keeps a
  // geographic watch alive. Unmount clears via the same cleanup.
  useEffect(() => () => {
    clearWatch();
    setFix(null);
    setFailure(null);
  }, [canvasKind, clearWatch]);

  // Losing the enabled gate stops tracking instead of lingering.
  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  // Re-render so a fix older than 60s flips to unknown/stale without new fixes.
  useEffect(() => {
    if (!fix || failure) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [fix, failure]);

  useEffect(() => () => clearWatch(), [clearWatch]);

  const location: LocationDisplay = failure
    ? { kind: 'unknown', reason: failure }
    : fix
      ? markGpsStale(
          { kind: 'gps', position: { kind: 'geographic', lat: fix.lat, lng: fix.lng }, accuracyMeters: fix.accuracyMeters, seenAt: fix.seenAt },
          now,
        )
      : { kind: 'unknown', reason: 'idle' };

  return { location, start, stop };
}
