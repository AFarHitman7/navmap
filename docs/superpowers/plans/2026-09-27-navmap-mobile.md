# NavMap Android Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture genuine Android Wi-Fi room surveys and ship visitor search, positioning and routing from a complete saved venue when the API is disconnected.

**Architecture:** A bare React Native Android app hosts one locally bundled Leaflet map in WebView. A small Kotlin module exposes timestamped OS Wi-Fi results to TypeScript; normal RN screens handle survey and visitor controls. A versioned JSON manifest and two compressed images are downloaded and activated atomically.

**Tech Stack:** React Native, TypeScript, Kotlin Android `WifiManager`, `react-native-webview`, `react-native-fs`, `react-native-keychain`, `react-native-geolocation-service`, Leaflet, Jest for pure TS and RN Testing Library for screens; npm. All open source.

**Spec:** `../specs/2026-09-27-navmap-prototype-design.md`; companion contract/setup: `../../navmap-prototype-implementation-plan.md` (paths refer to the parent planning directory).

## Global Constraints

- Separate `navmap-mobile` Git repo. Android only; run physical-device tests with scan throttling enabled.
- WebView Leaflet must show both images and paths offline with no API or tile connection; standard OSM tiles are online-only, never packaged.
- Accept a scan only if the OS reports a new result timestamp; no 2-second scan loop or background tracking.
- Survey requires admin login; visitor pack/search/route does not. Never upload visitor positions.
- Download failure, unsupported schema or bad SHA-256 must leave previous pack active.
- Location order: fresh credible Wi-Fi, usable outdoor GPS, offline QR anchor, manual start; show source, confidence and fix age.

---

## File map

- `android/app/src/main/java/.../WifiScanModule.kt`, `WifiScanPackage.kt`: native broadcast/scan bridge; `AndroidManifest.xml`: scan/location and custom-scheme intent filter; debug manifest: LAN HTTP allowance only.
- `src/scan.ts`: fresh scan event contract, throttled request policy; `src/match.ts`: pure room fingerprint comparison.
- `src/pack.ts`: version download/check/activation; `src/contract.ts`, `src/fixtures/demo-v1.json`: v1 validation and fixture.
- `src/map/leafletHtml.ts`, `scripts/embed-leaflet.mjs`, `src/map/MapView.tsx`: embedded Leaflet HTML/WebView message protocol, optional online OSM, bundled offline image display.
- `src/route.ts`: pure shortest path over graph; `src/SurveyScreen.tsx`, `src/VisitorScreen.tsx`, `src/App.tsx`: flows.
- `src/location.ts`: Wi-Fi/GPS/QR/manual precedence; `__tests__/*.test.ts(x)`: behavior.

### Task 1: Day-one real-device feasibility spike (gate before all other tasks)

**Files:** Create initial React Native app and `package.json`, `scripts/embed-leaflet.mjs`, `src/map/leafletHtml.ts`, `src/map/MapView.tsx`, `src/scan.ts`, `__tests__/scan.test.ts`, `android/app/src/main/java/.../WifiScanModule.kt`, `WifiScanPackage.kt`, Android manifests, `docs/p0-device-results.md`.

**Interfaces:** native `WifiScanModule.requestScan(): Promise<boolean>` returns whether OS accepted request; emits `WifiScanResults` with `{updated:boolean,observedAtElapsedMicros:number,readings:{bssid:string,rssi:number,seenAtElapsedMicros:number}[]}`. `MapView` receives test zone JSON and base64 image URIs.

- [ ] **Step 1: Create the bare RN app using the currently supported CLI, install `react-native-webview`, `react-native-fs`, `leaflet`; add `typecheck: tsc --noEmit` and bundle script `preandroid: node scripts/embed-leaflet.mjs`; write a small failing TS test for staleness.** The test checks a scan from an earlier OS timestamp is not accepted merely because `getScanResults()` returned it again.

```ts
expect(isFreshScan({updated:true,observedAtElapsedMicros:1_000_000,readings:[{bssid:'AA',rssi:-50,seenAtElapsedMicros:900_000}]}, 1_100_000)).toBe(false);
expect(isFreshScan({updated:true,observedAtElapsedMicros:1_200_000,readings:[{bssid:'AA',rssi:-50,seenAtElapsedMicros:1_200_000}]}, 1_100_000)).toBe(true);
```

- [ ] **Step 2: Run `npm test -- scan.test.ts`.** Expected: FAIL because `isFreshScan` is absent.
- [ ] **Step 3: Add the smallest bridge and offline map.** Register `SCAN_RESULTS_AVAILABLE_ACTION`; emit only after reading `EXTRA_RESULTS_UPDATED`, OS result timestamps and `SystemClock.elapsedRealtimeNanos()/1000`; request `ACCESS_FINE_LOCATION`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE`, enabled Location Services, and applicable target-SDK Wi-Fi permissions. Respect normal OS throttling and permit passive platform scan broadcasts. Add Android `VIEW`/`BROWSABLE` intent filter for `navmap://anchor/` and log the incoming URL so the P0 camera check can run. Generate a local `leafletHtml.ts` by embedding Leaflet JS/CSS at build time (no remote script/CDN). Inject one tiny base64 outdoor image and one indoor image as `data:` URIs; use RN WebView `source={{html: html}}`, no local HTTP server. Toggle OSM layer only with network, show attribution, and set a stable identifying WebView `userAgent` such as `NavMapPrototype/0.1 (Android)`; confirm tile caching on the target device. Limit uploaded images to 1.5 MB each in backend.

```kotlin
val results = wifiManager.scanResults.map { r ->
  // r.timestamp is microseconds since boot, NOT Unix time.
  mapOf("bssid" to r.BSSID, "rssi" to r.level, "seenAtElapsedMicros" to r.timestamp)
}
```

- [ ] **Step 4: On a physical Android phone with scan throttling ON, run `npm run android` and record a 10-minute observation.** Expected: permission prompts, fresh result timestamps distinguish stale/duplicate scans, and two local images/route line remain visible in WebView after API/network is switched off. Scan a `navmap://anchor/demo/1/a1` test QR with the external camera while offline; record whether the app receives the link. Record phone model, Android API, permissions, scan request success/failure times, unique timestamps, offline map open time and memory observation in `docs/p0-device-results.md`. If a criterion fails, diagnose exact boundary (permissions, native event, RN bridge, HTML, base64 transfer, or QR handoff) before Task 2; do not simulate success with emulator or disable throttling.
- [ ] **Step 5: Commit** `git add . && git commit -m "spike: prove Android scans and offline map on device"`.

### Task 2: Survey rooms with allowlisted, distinct scans

**Files:** Create `src/SurveyScreen.tsx`, `src/api.ts`, `__tests__/survey.test.tsx`; modify `src/scan.ts`, `src/App.tsx`, `README.md`.

**Interfaces:** `startSurvey(placeId: string): void`, `saveSurvey(placeId: string, scans: Scan[]): Promise<number>` POSTs `/api/admin/samples`; `PUT /api/admin/aps` updates fixed BSSID allowlist; admin login returns a session token saved by `react-native-keychain`.

- [ ] **Step 1: Write failing survey test.** With a selected room and 4 allowlisted BSSIDs, display only fresh scans; two callbacks with the same OS timestamp count as one. Saving requires >=3 distinct scans with >=2 visible registered APs per scan.

```ts
const accepted = collectDistinctScans([scanAt(100),scanAt(100),scanAt(135),scanAt(170)], registeredBssids);
expect(accepted).toHaveLength(3);
expect(accepted[0].readings.every(r => registeredBssids.includes(r.bssid))).toBe(true);
```

- [ ] **Step 2: Run `npm test -- survey.test.tsx`.** Expected: FAIL because `collectDistinctScans` is absent.
- [ ] **Step 3: Implement organizer login and survey screen.** Admin enters password once, token goes in OS secure storage; GET draft places/APs, choose room, show latest distinct result timestamp, visible registered BSSIDs and age, button to request next scan with a >=35-second cooldown (passive fresh scans may arrive earlier), progress toward 3 fresh scans, Save POST. AP setup shows nearby BSSIDs and permits organizer to select 3–4 fixed devices; label them by recognizable SSID but match by BSSID. A throttled/permission-denied scan shows what to change; never increment count for a cached result. Survey uploads are online foreground actions only.

```ts
if (event.updated && event.readings.some(r => r.seenAtElapsedMicros > lastAcceptedMicros)) {
  lastAcceptedMicros = Math.max(...event.readings.map(r => r.seenAtElapsedMicros));
  appendDistinctSurveyScan(event);
}
```

- [ ] **Step 4: Run `npm test -- survey.test.tsx`, `npm run typecheck`, `npm run android`.** Expected: tests/typecheck exit 0; on the real phone, 3 unique timestamped scans can be saved for each of three demo rooms and the API confirms only allowlisted BSSIDs were stored.
- [ ] **Step 5: Commit** `git add . && git commit -m "feat: survey rooms with real Wi-Fi scans"`.

### Task 3: Verified venue download with rollback

**Files:** Create `src/contract.ts`, `src/pack.ts`, `src/fixtures/demo-v1.json`, `__tests__/pack.test.ts`; modify `src/App.tsx`, `README.md`.

**Interfaces:** `downloadPack(venueId: string, version: number): Promise<void>`; `loadActivePack(venueId: string): Promise<Manifest | null>`; `parseManifest(raw: unknown): Manifest` rejects non-v1. Files live under the app document directory `packs/demo/`.

- [ ] **Step 1: Write failing rollback test using an injected file/HTTP adapter.** Install v1, corrupt the digest of v2's indoor image, call `downloadPack`, assert v1 is still active and staging is removable. Unsupported `schemaVersion: 2` is rejected before activation.

```ts
await downloadPack('demo',1);
await expect(downloadPack('demo',2)).rejects.toThrow(/checksum|sha-256/i);
expect((await loadActivePack('demo'))?.version).toBe(1);
```

- [ ] **Step 2: Run `npm test -- pack.test.ts`.** Expected: FAIL because `downloadPack` does not exist.
- [ ] **Step 3: Implement full-version download.** GET `/latest` then version manifest, validate graph references and two assets, download each image to `<version>.staging`, use `react-native-fs.hash(path,'sha256')`, compare bytes/digests, rename staging to version folder, and update a tiny `active.json` last. Do not edit an installed version in place. Show progress and a Retry button; allow the visitor to keep using installed v1 during a failed v2 download. Copy backend `fixtures/demo-v1.json` to mobile tests and assert the same schema.

```ts
if (manifest.schemaVersion !== 1) throw new Error('This map needs a newer app');
if (downloadedSha256 !== image.sha256) throw new Error('Image checksum mismatch');
// Write active.json only after all images and manifest are verified and renamed.
```

- [ ] **Step 4: Run `npm test -- pack.test.ts`, `npm run typecheck` and a real-phone interrupted-download test.** Expected: tests/typecheck exit 0; existing v1 still opens when v2 request is cut mid-transfer and after app restart.
- [ ] **Step 5: Commit** `git add . && git commit -m "feat: save checked venue packs offline"`.

### Task 4: On-device room match, visitor route, GPS and QR fallbacks

**Files:** Create `src/match.ts`, `src/location.ts`, `src/route.ts`, `src/anchor.ts`, `src/VisitorScreen.tsx`, `__tests__/match.test.ts`, `__tests__/route.test.ts`, `__tests__/location.test.ts`, `__tests__/deeplink.test.ts`; modify `src/map/MapView.tsx`, `src/App.tsx`, Android manifest, `README.md`.

**Interfaces:** `matchRoom(readings: Reading[], profiles: Profile[], allowlist: string[]): Match | null` returns `{placeId,score,commonAps,confidence}`; `shortestPath(manifest,start,goal): string[] | null` returns node IDs; `chooseStart({wifi,gps,qr,manual},manifest,now): StartFix | null`; `parseAnchorUrl(url: string, manifest: Manifest): {nodeId:string,version:number} | null` resolves `navmap://anchor/demo/:version/:anchorId` against a saved pack.

- [ ] **Step 1: Write failing matching, route, deep-link and precedence tests.** The fixtures include two different room RSSI signatures; unknown BSSIDs have no effect, fewer than 2 common APs yield no credible Wi-Fi fix, stale Wi-Fi yields GPS outdoors (not indoors), and a graph with no entrance edge yields no route.

```ts
expect(matchRoom([{bssid:'AA:BB:CC:DD:EE:01',rssi:-50},{bssid:'AA:BB:CC:DD:EE:02',rssi:-65}], profiles, allowlist)?.placeId).toBe('room-a');
expect(chooseStart({wifi:{placeId:'room-a',seenAt:0},gps:outdoorGps,qr:null,manual:null},manifest,90_000).source).toBe('gps');
expect(shortestPath(manifest,'out-gate','room-a')).toEqual(['out-gate','out-entrance','in-entrance','room-a']);
expect(parseAnchorUrl('navmap://anchor/demo/1/a1',manifest)).toEqual({nodeId:'in-entrance',version:1});
```

- [ ] **Step 2: Run `npm test -- match.test.ts route.test.ts location.test.ts deeplink.test.ts`.** Expected: FAIL because these functions are absent.
- [ ] **Step 3: Implement matcher and visitor UX.** Compare only allowlisted APs, using average absolute RSSI difference over common BSSIDs plus 8 dBm per missing registered AP. Require >=2 common APs for a credible estimate; mark high only with >=3 common APs and a clear runner-up margin, otherwise medium/low. Treat Wi-Fi result older than 60 s as stale and label elapsed time. If GPS reports <=30 m accuracy outdoors inside bounds, map it to the nearest outdoor graph node; never infer an indoor room from GPS. Use QR or manually selected room/entrance if automatic fixes fail. Run local Dijkstra (same backend fixture as web), render path on correct zone and a single entrance-transition step. Android `Linking.getInitialURL` and `Linking.addEventListener('url', ...)` resolve saved `navmap://` anchors without contacting the API; if wrong version/unknown anchor, show an actionable manual-start option. A list/search view remains usable when map tiles cannot load.

```ts
const distance = common.reduce((sum, bssid) => sum + Math.abs(live[bssid] - profile.medianRssi[bssid]), 0) / common.length;
const score = distance + 8 * missingAllowlistedCount;
// Keep the room winner and runner-up score to avoid claiming a strong fix on a tie.
```

- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run android`; unplug API and repeat the saved-venue walkthrough on a real handset.** Expected: test/typecheck exit 0; saved image, search, route, Wi-Fi age/confidence, QR handoff (if target camera supports custom schemes), and manual start work without API. Take 10 predictions at preselected spots and record correct-room count; require >=8. If less, diagnose scan freshness/AP placement/survey samples before changing scoring constants.
- [ ] **Step 5: Commit** `git add . && git commit -m "feat: navigate with best-effort Wi-Fi positioning offline"`.

### Task 5: Clean APK and complete demo rehearsal

**Files:** Modify `README.md`, Android debug/release manifests, `docs/p0-device-results.md`, `src/App.tsx`, `__tests__/deeplink.test.ts`; create `docs/demo-walkthrough.md`; if the P0 camera handoff failed, create `android/app/src/main/java/.../AnchorQrModule.kt` and `src/AnchorScanner.tsx` using open-source ZXing Android Embedded.

**Interfaces:** Release manifest permits HTTPS API only; debug variant permits LAN HTTP; `navmap://anchor/demo/:version/:anchorId` resolves without server; `handleAnchorUrl(url: string, active: Manifest, lastHandledUrl: string | null): StartFix | null` skips duplicate delivery; no backend user position endpoint is called.

- [ ] **Step 1: Write failing duplicate-delivery tests** for a valid saved QR arriving first as a cold-start URL and then as a resumed link event: the selected start changes once; unknown anchor and a different venue/version remain rejected by `parseAnchorUrl`.

```ts
expect(handleAnchorUrl('navmap://anchor/demo/1/a1',manifest,null)).toMatchObject({source:'qr',nodeId:'in-entrance'});
expect(handleAnchorUrl('navmap://anchor/demo/1/a1',manifest,'navmap://anchor/demo/1/a1')).toBeNull();
expect(parseAnchorUrl('navmap://anchor/other/1/a1',manifest)).toBeNull();
```

- [ ] **Step 2: Run `npm test -- deeplink.test.ts`.** Expected: FAIL because `handleAnchorUrl` and delivery deduplication are not implemented.
- [ ] **Step 3: Implement delivery deduplication and release config.** Complete cold-start + resumed link handling for the P0 intent filter and ignore a repeated URL until a new QR/manual start is requested. If the target camera failed the P0 handoff, integrate ZXing Android Embedded via a small Kotlin bridge with `scanAnchor(): Promise<string>` and feed its decoded payload to the same pure `parseAnchorUrl` function; camera permission is requested only on tapping Scan QR. Document APK installation, laptop LAN IP selection, granted permissions, 3–4 AP setup, real scan intervals, and offline Wi-Fi-on procedure. Confirm release build excludes debug cleartext/network-security override and sample logs never include an attendee's location.

```xml
<data android:scheme="navmap" android:host="anchor" />
```

- [ ] **Step 4: Run `npm test`, `npm run typecheck`, the selected RN version's Android release build command, and the demo walkthrough.** Expected: code checks and release build exit 0; v1 works with API stopped; the printed QR sets the saved start either by external camera or the in-app Scan QR control, and the 10-spot room count is recorded. Test unknown QR and denied camera permission with manual-code recovery.
- [ ] **Step 5: Commit** `git add . && git commit -m "docs: verify Android demo release and fallback"`.
