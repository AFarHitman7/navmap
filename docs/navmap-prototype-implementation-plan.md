# NavMap prototype — implementation and development guide

**Source of truth:** [approved prototype design](superpowers/specs/2026-09-27-navmap-prototype-design.md). The older `2026-09-12-navmap-super-doc.md` describes the long-term product; its two-repo, app-only, multi-tenant, tile-server, PostGIS and rapid-scan assumptions are superseded for this prototype.

## Deliverable

One organizer creates a mixed outdoor/indoor venue on web, an Android phone surveys a few rooms, and the organizer publishes. Visitors on web and Android search for a place and see a route. Android downloads the published venue and continues to search, route, and estimate a room without the API. Target: **8 of 10** correct room selections at preselected indoor test spots on the actual demo phone with 3–4 fixed APs. Indoor positioning is **best effort**: show the fix age and confidence, rather than claiming continuous high-frequency room tracking.

## Architecture and stack

| Repository | Responsibility | Stack / storage | Runs locally |
|---|---|---|---|
| `navmap-backend` | Admin login, one editable venue, AP registry, survey samples, immutable versioned publish, static images/JSON | Node.js 24.15+ LTS, TypeScript, Fastify, built-in `node:sqlite` (WAL), filesystem, Vitest | `http://<laptop-LAN-IP>:3000` |
| `navmap-web` | Organizer map editor; connected visitor map, search, route and GPS/QR/manual location | React, Vite, TypeScript, Leaflet, plain CSS, Vitest + React Testing Library | `http://localhost:5173` on laptop; trusted HTTPS on phone for GPS |
| `navmap-mobile` | Android survey, Wi-Fi match, visitor map/search/route, verified offline download | Bare React Native + TypeScript, WebView with locally bundled Leaflet, Kotlin `WifiManager` bridge, `react-native-fs`, Vitest/Jest for pure TS | Real Android phone; debug APK points to laptop LAN IP |

All three are **separate Git repos**. The backend's versioned JSON snapshot is the only shared data contract. Copy the small fixture JSON to each client's tests when the contract changes; do not create a shared package or publishing pipeline. All suggested libraries are open source; development needs no paid accounts or hosted service. Use npm and committed lockfiles independently in each repo.

### Data flow

```text
web editor -> API draft in SQLite + uploaded images on laptop disk
Android survey -> API samples per room and allowlisted BSSID
web publish -> API validates graph/survey -> immutable version N manifest + images
web visitor -> GET latest version -> Leaflet + search + local Dijkstra
Android visitor -> GET version + images -> SHA-256 verify -> atomic activate
Android offline -> stored Leaflet HTML/image + local Dijkstra + Wi-Fi matcher
```

Keep one outdoor image with entered north/south/east/west bounds and one indoor floor image with measured width. Draw places and paths as normalized `[0,1]` image coordinates. Store route edges with measured/derived metre lengths; an entrance edge joins the outdoor and indoor nodes. Online visitors can turn on an OSM tile background; the authored outdoor image and path graph remain the source of truth. **Do not prefetch or bundle OSM standard tiles.** Display OSM attribution when those tiles are visible.

### Minimal contract (v1)

All IDs are stable strings. A release of `POST /api/admin/publish` increments `version` and freezes the returned data. Public GETs return the same manifest until the next publish. There is one venue ID, `demo`, in the initial seed.

```ts
type ImageRef = { url: string; sha256: string; bytes: number };
type Zone = {
  id: string; kind: 'outdoor' | 'indoor'; image: ImageRef;
  bounds?: { north: number; south: number; east: number; west: number };
  widthMeters?: number;
};
type Node = { id: string; zoneId: string; x: number; y: number };
type Edge = { from: string; to: string; meters: number };
type Place = { id: string; name: string; zoneId: string; nodeId: string };
type Anchor = { id: string; nodeId: string; label: string };
type Profile = {
  placeId: string; medianRssi: Record<string, number>; scanCount: number;
};
type Manifest = {
  schemaVersion: 1; venueId: string; version: number;
  zones: Zone[]; nodes: Node[]; edges: Edge[]; entranceNodeId: string;
  aps: string[];
  places: Place[]; anchors: Anchor[]; profiles: Profile[];
};
type Draft = Omit<Manifest, 'schemaVersion' | 'version' | 'profiles'>;
type Reading = { bssid: string; rssi: number };
type Scan = { placeId: string; capturedAt: number; readings: Reading[] };
```

`Zone.bounds` is mandatory for outdoor; `Zone.widthMeters` is mandatory for indoor. `entranceNodeId` is the outdoor node linked by a cross-zone edge to the indoor entrance. `aps` is the uppercase fixed-BSSID allowlist used for matching. A route is a sequence of node IDs over undirected edges. Indoor coordinates are image-relative, not GPS coordinates. A matching Wi-Fi profile yields a `placeId` and hence a graph start `nodeId`; GPS outdoors maps linearly into outdoor normalized coordinates, then chooses the nearest outdoor graph node when its reported accuracy is acceptable. Do not project GPS into an indoor room.

The v1 fixture graph uses `out-gate -> out-entrance -> in-entrance -> room-a`; other room nodes branch from `in-entrance`. Anchor `a1` points at `in-entrance`. Keep these IDs in backend, web and mobile fixture tests so route and QR assertions are comparable.

**API, v1:** `POST /api/admin/login` (password; sets HttpOnly SameSite=Lax cookie for browser, returns session token for Android), `GET/PUT /api/admin/draft`, `POST /api/admin/images/:zoneId` (PNG/JPEG/WebP, maximum 1.5 MB), `PUT /api/admin/aps` (3–4 fixed BSSIDs), `POST /api/admin/samples` (`placeId`, array of scans with distinct fresh timestamps and BSSID/RSSI readings), `POST /api/admin/publish`, `GET /api/venues/demo/latest`, `GET /api/venues/demo/versions/:version/manifest`, and `GET /api/assets/:version/:filename`. Admin writes require an active session; public reads do not. Use schema validation at the API boundary; reject unknown fields where they can change the published graph. Serve web build assets from the API process only for demo deployment, after the API routes.

**Offline contract:** Download manifest plus its two image URLs into `packs/demo/<version>.staging/`; verify `schemaVersion`, image sizes/digests and graph references; rename to `packs/demo/<version>/` and set `activeVersion` last. On network interruption, corrupt file, or unsupported schema, retain the old pack. Save the small venue JSON and keep images <=1.5 MB each so Leaflet in WebView can receive image data URIs without a local file server. Prove this on a real phone before making it foundational.

**Location contract:** Use only registered BSSIDs. Store median RSSI for each AP/room from distinct fresh scans; compute a deterministic distance with a missing-AP penalty; expose best room, confidence, common-AP count, and fix age. Never treat cached scan results as fresh. Android: fresh credible Wi-Fi -> accurate outdoor GPS -> offline anchor QR -> manual start. Web: accurate outdoor GPS -> connected QR link -> manual start. Unknown or stale results show an explicit fallback, not a silently moving dot.

## Order of work (solo developer, 2–3 weeks)

| Time | Deliverable | Stop/go evidence |
|---|---|---|
| Day 1 | **Android feasibility spike:** WifiManager permission/scan timestamps under default throttling; WebView renders bundled Leaflet + saved images with network off. | Video/log on real phone; no scan-timer assumptions. If map image transport fails, fix the bridge before editor work. |
| Days 2–5 | [Backend plan](superpowers/plans/2026-09-27-navmap-backend.md): draft, auth, samples, publishing, immutable pack. | Tests prove graph validation, correct snapshots and protected writes. |
| Days 6–9 | [Web plan](superpowers/plans/2026-09-27-navmap-web.md): organizer editor first, then visitor map/search/routes. | Organizer authors the demo venue without editing JSON manually; web visitor routes. |
| Days 10–14 | [Android plan](superpowers/plans/2026-09-27-navmap-mobile.md): survey, download, best-effort Wi-Fi positioning, offline visitor route. | Offline route and 8/10 room measurement on the target phone. |
| Days 15–16 | Integration and demo rehearsal, bug fixes evidenced by reproductions/tests. | Full walkthrough with laptop API deliberately stopped; printed dual QR sign; installation/setup followed from a clean checkout. |

This is a planning estimate, not a promise of continuous indoor accuracy. Keep the editor at **one outdoor zone + one indoor zone** and one organizer account. Defer multi-tenancy, iOS, BLE/IMU fusion, background sync, PDF export, turn-by-turn voice, indoor polygon editing, multi-floor routing, self-hosted tile infrastructure, and a package registry.

## Setup and daily development

1. Create three sibling repositories (`navmap-backend/`, `navmap-web/`, `navmap-mobile/`), each with its own `git init`, `package.json`, `package-lock.json`, `README.md`, `.gitignore`, and `.env.example` when needed. Create a short `CONTRACT.md` in backend pointing to the approved spec and the v1 fixture; copy only the fixture into both client repos. Keep this planning directory as the reference, outside the three runtime repositories.
2. Install Node.js **24.15+ LTS**, npm, Android Studio and Android SDK/Java version required by the selected React Native release, plus a real Android phone with USB debugging. Pin the current mutually compatible React Native, Kotlin, Gradle, Leaflet and WebView versions in the mobile lockfile after the day-one spike; do not copy the older concept's pinned RN 0.76/Node 20 versions. Node SQLite API reference: https://nodejs.org/docs/latest-v24.x/api/sqlite.html.
3. In backend, copy `.env.example` to `.env` and set `ADMIN_PASSWORD`, `DATA_DIR=./data`, `HOST=0.0.0.0`, `PORT=3000`; run `npm ci`, `npm run db:init`, `npm run dev`. The database, sessions and uploaded images live beneath ignored `data/`. Do not commit passwords, tokens, database files or survey samples.
4. In web, set `VITE_API_PROXY_TARGET=http://127.0.0.1:3000` and `VITE_PUBLIC_WEB_ORIGIN` to the phone-reachable web origin, then run `npm ci` and `npm run dev -- --host 0.0.0.0`. Vite proxies `/api` so web login cookies use the page origin. On the laptop, `http://localhost:5173` permits browser geolocation. On a second phone, use **trusted HTTPS** for browser GPS: with the open-source `mkcert` tool, run `mkcert -install` and `mkcert <laptop-LAN-IP> localhost`, configure Vite with the resulting certificate/key and install/trust that local CA on the test phone. Set `VITE_PUBLIC_WEB_ORIGIN=https://<laptop-LAN-IP>:5173`; print the phone-reachable URL, never a `localhost` QR. Without this setup, test QR/manual start rather than promising GPS on LAN HTTP. For a single-process demo served by the backend, configure the same trusted TLS certificate there before testing phone-browser GPS.
5. In mobile, set `API_BASE_URL=http://<laptop-LAN-IP>:3000` for a **debug-only** build, run `npm ci`, connect the phone, `adb devices`, then `npm run android`. Allow LAN cleartext only in the debug manifest. At demo time the phone and laptop share the same LAN for publishing/downloading; the visitor then works with the laptop server stopped. Wi-Fi radios/APs remain powered; airplane mode may be used with Wi-Fi turned back on for a truly disconnected Wi-Fi-fingerprint test.
6. Each day: work on a branch or isolated Git worktree within the affected repo after checking its baseline; run the failing behavior test first, implement the smallest passing slice, run `npm test`, `npm run typecheck` and `npm run build` where applicable, review the change, then commit there. When the manifest changes, update backend fixture and both clients' validators/fixture tests in the same integration session. Diagnose any integration failure at the boundary (HTTP response, saved pack, native scan timestamp, WebView message) before changing code.

## Demo script and release gate

1. Start API and web; sign in as seeded organizer. Upload two small images, enter outdoor geographic bounds/indoor width, draw entrance/path graph and 3 room places, and register fixed AP BSSIDs.
2. Install Android debug APK on actual phone. Survey each room with **distinct, fresh** OS scan results; keep the original phone settings and throttling enabled. Publish on web; rejected drafts explain graph or survey gaps.
3. On web, open visitor view; search a room, allow outdoor GPS in a secure browser context or select an outdoor start, and confirm path crossing the entrance. Test the browser anchor QR on LAN.
4. Download version 1 on Android. Print the Android `navmap://` anchor QR and LAN browser QR. Stop the laptop API, leave AP radios available, select a destination, test search, route, last-fix age, offline Android QR scanning (external camera or in-app scanner, chosen by the day-one device check), and manual start/code entry.
5. Record the predicted room at the 10 predetermined indoor spots; pass at **8 or more correct**. Reject duplicated/cached samples during the survey. Verify an interrupted/corrupted v2 download still leaves v1 active. Report measured results rather than implied real-time accuracy.

## Risks that drive the first task

- **Android scan throttle:** normal foreground scan requests are limited, and a successful API call can still return cached scans. Use the broadcast's success flag and per-result timestamp; listen for passive platform scans. The UI reports stale/uncertain fixes. Android reference: https://developer.android.com/develop/connectivity/wifi/wifi-scan.
- **Image delivery to WebView:** a few megabytes of base64 data URIs may work for the tiny demo, but it must be benchmarked on the target handset before the editor depends on it. Keep images small; reject oversized uploads. The P0 spike records load time and memory behavior.
- **OSM license/policy:** tiles displayed online only with attribution and browser/native identification and caching; never archive standard OSM tiles for offline use. https://operations.osmfoundation.org/policies/tiles/.
- **Offline QR handoff:** no public domain is available for verified Android App Links. Test the installed phone's camera handling of `navmap://` on day one; if it cannot open the scheme, add an open-source in-app ZXing scanner and verify it resolves the saved anchor offline. Printed short-code entry remains a manual backup.
- **Local HTTP and browser GPS:** secure context is mandatory for web GPS on phones; one-time locally trusted HTTPS setup is part of testing web parity. https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API.

## Planning methods used

Fifteen available skills informed this plan: `using-superpowers`, `brainstorming`, `writing-plans` (scope and task order); `systematic-debugging`, `test-driven-development`, `verification-before-completion`, `webapp-testing`, `requesting-code-review`, `using-git-worktrees` (spike, evidence, isolation and review gates); `frontend-design`, `design-taste-frontend`, `anti-ui-slop`, `ui-design`, `better-typography`, `vercel-react-best-practices` (map-first editor, readable recovery states and a small responsive React client). The requested `grill-me` skill was unavailable; the decision questions and design-approval rounds above were used instead. No optional paid UI reference service is required.
