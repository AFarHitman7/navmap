import { NativeEventEmitter, NativeModules } from 'react-native';
import type { WifiScanResults } from './scan';

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
