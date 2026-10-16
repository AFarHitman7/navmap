import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGeolocation } from '../src/location/useGeolocation';

function installGeolocation(stubs: {
  watchPosition?: ReturnType<typeof vi.fn>;
  clearWatch?: ReturnType<typeof vi.fn>;
} = {}) {
  const watch = stubs.watchPosition ?? vi.fn(() => 7);
  const clear = stubs.clearWatch ?? vi.fn();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: watch, clearWatch: clear } });
  return { watch, clear };
}

function removeGeolocation() {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useGeolocation', () => {
  it('never asks for GPS on an uploaded layout', () => {
    const watch = vi.fn();
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: watch, clearWatch: vi.fn() } });
    const { result } = renderHook(() => useGeolocation({ enabled: true, canvasKind: 'static' }));
    act(() => result.current.start());
    expect(watch).not.toHaveBeenCalled();
    expect(result.current.location).toEqual({ kind: 'unknown', reason: 'idle' });
  });

  it('makes no geolocation call until an explicit Locate me action', () => {
    const { watch } = installGeolocation();
    const { result } = renderHook(() => useGeolocation({ enabled: true, canvasKind: 'geographic' }));
    expect(watch).not.toHaveBeenCalled();
    expect(result.current.location).toEqual({ kind: 'unknown', reason: 'idle' });
    let watchId = 0;
    act(() => result.current.start());
    expect(watch).toHaveBeenCalledTimes(1);
    watchId = watch.mock.results[0]?.value as number;
    expect(typeof watchId).toBe('number');
  });

  it('reports an unsnapped geographic fix with accuracy after Locate me', () => {
    const { watch } = installGeolocation();
    const { result } = renderHook(() => useGeolocation({ enabled: true, canvasKind: 'geographic' }));
    act(() => result.current.start());
    const onSuccess = watch.mock.calls[0]?.[0] as (pos: {
      coords: { latitude: number; longitude: number; accuracy: number };
      timestamp: number;
    }) => void;
    act(() => onSuccess({ coords: { latitude: 13.05, longitude: 80.25, accuracy: 12 }, timestamp: Date.now() }));
    expect(result.current.location).toEqual({
      kind: 'gps',
      position: { kind: 'geographic', lat: 13.05, lng: 80.25 },
      accuracyMeters: 12,
      seenAt: expect.any(Number),
    });
  });

  it('maps denial, unavailability, and timeout to honest unknown reasons', () => {
    for (const [code, reason] of [[1, 'denied'], [2, 'unavailable'], [3, 'timeout']] as const) {
      const { watch } = installGeolocation();
      const { result } = renderHook(() => useGeolocation({ enabled: true, canvasKind: 'geographic' }));
      act(() => result.current.start());
      const onError = watch.mock.calls[0]?.[1] as (err: { code: number }) => void;
      act(() => onError({ code }));
      expect(result.current.location).toEqual({ kind: 'unknown', reason });
    }
  });

  it('treats non-finite readings as unavailable, never as a position', () => {
    const { watch } = installGeolocation();
    const { result } = renderHook(() => useGeolocation({ enabled: true, canvasKind: 'geographic' }));
    act(() => result.current.start());
    const onSuccess = watch.mock.calls[0]?.[0] as (pos: {
      coords: { latitude: number; longitude: number; accuracy: number };
      timestamp: number;
    }) => void;
    act(() => onSuccess({ coords: { latitude: Number.NaN, longitude: 80.25, accuracy: 12 }, timestamp: 1_700_000_000_000 }));
    expect(result.current.location).toEqual({ kind: 'unknown', reason: 'unavailable' });
  });

  it('clears the watch on stop, unmount, and canvas switching', () => {
    const { watch, clear } = installGeolocation();
    const { result, rerender, unmount } = renderHook(
      ({ canvasKind }: { canvasKind: 'geographic' | 'static' }) => useGeolocation({ enabled: true, canvasKind }),
      { initialProps: { canvasKind: 'geographic' as const } },
    );
    act(() => result.current.start());
    const watchId = watch.mock.results[0]?.value;
    act(() => result.current.stop());
    expect(clear).toHaveBeenCalledWith(watchId);

    act(() => result.current.start());
    const secondId = watch.mock.results[1]?.value;
    rerender({ canvasKind: 'static' });
    expect(clear).toHaveBeenCalledWith(secondId);

    const { result: second, unmount: unmountSecond } = renderHook(
      () => useGeolocation({ enabled: true, canvasKind: 'geographic' }),
    );
    act(() => second.current.start());
    const thirdId = watch.mock.results[2]?.value;
    unmountSecond();
    expect(clear).toHaveBeenCalledWith(thirdId);
    unmount();
  });

  it('marks GPS older than 60s as stale', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const { watch } = installGeolocation();
    const { result } = renderHook(() => useGeolocation({ enabled: true, canvasKind: 'geographic' }));
    act(() => result.current.start());
    const onSuccess = watch.mock.calls[0]?.[0] as (pos: {
      coords: { latitude: number; longitude: number; accuracy: number };
      timestamp: number;
    }) => void;
    act(() => onSuccess({ coords: { latitude: 13.05, longitude: 80.25, accuracy: 12 }, timestamp: 1_700_000_000_000 }));
    expect(result.current.location.kind).toBe('gps');
    act(() => { vi.advanceTimersByTime(65_000); });
    expect(result.current.location).toEqual({ kind: 'unknown', reason: 'stale' });
  });

  it('reports unavailable when the browser has no geolocation', () => {
    removeGeolocation();
    const { result } = renderHook(() => useGeolocation({ enabled: true, canvasKind: 'geographic' }));
    act(() => result.current.start());
    expect(result.current.location).toEqual({ kind: 'unknown', reason: 'unavailable' });
  });

  it('does nothing until enabled', () => {
    const { watch } = installGeolocation();
    const { result } = renderHook(() => useGeolocation({ enabled: false, canvasKind: 'geographic' }));
    act(() => result.current.start());
    expect(watch).not.toHaveBeenCalled();
    expect(result.current.location).toEqual({ kind: 'unknown', reason: 'idle' });
  });
});
