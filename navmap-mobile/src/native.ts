import { NativeEventEmitter, NativeModules } from 'react-native';
import type { WifiScanResults } from './scan';

/**
 * Honest capability messaging for permission prompts and settings screens.
 * Wi-Fi positioning needs native Android capabilities and surveyed profiles;
 * GPS suggests an area only and never identifies an indoor node or floor.
 * Canonical strings live in positioning-v3 so pure-logic tests can assert
 * them without loading the native bridge.
 */
export { GPS_AREA_NOTE, WIFI_LOCATION_NOTE } from './positioning-v3';

const { WifiScanModule, AnchorQrModule } = NativeModules as {
  WifiScanModule?: { requestScan: () => Promise<boolean> };
  AnchorQrModule?: { scanAnchor: () => Promise<string> };
};

/** Returns whether the OS accepted the scan request (throttling may say no). */
export function requestScan(): Promise<boolean> {
  if (!WifiScanModule) return Promise.resolve(false);
  return WifiScanModule.requestScan();
}

export function onScanResults(handler: (e: WifiScanResults) => void): () => void {
  const emitter = new NativeEventEmitter(NativeModules.WifiScanModule);
  const sub = emitter.addListener('WifiScanResults', handler);
  return () => sub.remove();
}

export function scanAnchor(): Promise<string> {
  if (!AnchorQrModule) return Promise.reject(new Error('scanner unavailable'));
  return AnchorQrModule.scanAnchor();
}
