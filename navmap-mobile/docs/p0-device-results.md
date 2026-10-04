# P0 device results — feasibility spike

> Status: **NOT run on hardware in this environment.** No physical Android
> phone is attached to this build machine, so all device rows below are
> TODO. Code + unit evidence only (see `npm test`). Do NOT treat this file
> as a passing device log.

## Code evidence (this machine)

- [x] `isFreshScan` unit tests (`__tests__/scan.test.ts`) — stale
  re-delivery rejected, newer OS timestamp accepted.
- [x] Offline Leaflet HTML embeds data-URI images, no `src="http"`, no CDN
  (`__tests__/map.test.ts`).
- [x] Kotlin bridge reads `SCAN_RESULTS_AVAILABLE_ACTION` +
  `EXTRA_RESULTS_UPDATED` + `ScanResult.timestamp` (µs since boot) +
  `elapsedRealtimeNanos` (`android/.../WifiScanModule.kt`) — compile check
  pending on a machine with the Android SDK.
- [x] `navmap://anchor/` VIEW/BROWSABLE intent filter in
  `android/app/src/main/AndroidManifest.xml`.

## Manual device protocol (TODO — needs target phone, throttling ON)

1. `adb devices`, set `API_BASE_URL=http://<laptop-LAN-IP>:3000`, `npm ci`,
   `npm run preandroid`, `npm run android`.
2. Record: phone model, Android API, permissions granted, Location Services on.
3. Request scans ~10 min: log accepted (`requestScan()->true`) vs throttled
   times + unique `observedAtElapsedMicros` values. Confirm duplicates are
   distinguishable as stale.
4. Airplane mode + Wi-Fi back on: confirm both images + route line visible in
   WebView, record open time + memory observation.
5. External camera on offline `navmap://anchor/demo/1/a1` QR: record whether
   the app receives the link (log URL). If it fails, build `AnchorQrModule`
   + ZXing (stub present in `AnchorQrModule.kt` / `AnchorScanner.tsx`).

| Check | Result |
|---|---|
| Permission prompts | TODO |
| Fresh vs stale timestamps | TODO |
| Offline map (2 images + route) | TODO |
| `navmap://` camera handoff | TODO (decides in-app scanner) |
| OSM online attribution + UA | TODO |

## Handoff note for Task 5

If the camera handoff row fails, Task 5 must integrate ZXing Android
Embedded via `AnchorQrModule.scanAnchor()` before the demo.
