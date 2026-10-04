# NavMap three-repo prototype design

**Status:** Approved in conversation on 2026-09-27. This prototype design supersedes the two-repo, app-only and production-scale implementation choices in `2026-09-12-navmap-super-doc.md`; that document remains the product concept.

## Purpose and success

A solo developer should demonstrate, within a 2–3 week target, one outdoor campus area connected to one indoor floor with a few rooms. An organizer authors and publishes the map on web, surveys rooms on Android with 3–4 fixed access points, and a visitor searches and routes on web or Android. The Android visitor can route with the API disconnected after downloading the venue; Wi-Fi can remain on to observe local APs. At 10 preselected indoor spots on the demo device, at least 8 position estimates should select the correct room. This is a measured goal, not a claim of 3–5 m continuous accuracy.

## Boundaries

Three independent Git repositories: `navmap-web`, `navmap-backend`, `navmap-mobile`. No monorepo, private package registry, generated client, hosted proprietary service, or paid/closed-source dependency. One venue, one seeded organizer account, public read-only visitor access. Web owns organizer editing and online visitor navigation. Android owns surveying and visitor navigation; it has no geometry editor. Web visitors have the same search, map, destination and routing capabilities as Android visitors, apart from Wi-Fi positioning and offline use. Android is the only mobile platform.

## Stack and runtime

- Web: TypeScript, React, Vite, Leaflet, browser Geolocation API, SVG route overlays; static build served by the backend for a one-process demo deployment. During development Vite proxies `/api` to the backend. Browser GPS needs HTTPS when the browser is reached from another device; localhost is a secure-context exception.
- Backend: Node.js 24.15+ LTS, TypeScript, Fastify, built-in `node:sqlite` in WAL mode, local disk uploads; one process and one database file. One seeded admin password verified against a salted hash; server-managed expiring sessions (HttpOnly cookie for web, bearer token in Android secure storage for survey). Public snapshot retrieval does not need a login. No container, Redis, PostGIS, S3, background worker, or external identity provider.
- Mobile: bare React Native, TypeScript, `react-native-webview` displaying bundled Leaflet HTML, small Kotlin `WifiManager` bridge for scan broadcasts and result timestamps, and local files for downloaded snapshots. Bundled Leaflet assets and size-limited downloaded images are delivered to the WebView locally; no live network is needed to display the saved map. Android-specific location/scan permissions are requested in context. No Google Maps SDK.
- Map imagery: online OSM standard raster tiles only for interactive viewing, with visible attribution and compliant caching/identification; never bulk download or package these tiles. An organizer supplies a north-up outdoor image with north/south/east/west bounds and one indoor floor image. Both images and the route graph are saved for Android offline display. The online OSM layer is an optional background; published image and graph are authoritative for routing.

## Data and interfaces

SQLite stores an editable draft: venue metadata and images, `zones` (outdoor/indoor), `places`, `nodes`, `edges`, `anchors`, an AP BSSID allowlist, and `samples`. A node has `id`, `zoneId`, normalized image `x,y` in `[0,1]`; an edge connects existing node IDs and carries a positive length in metres. The outdoor zone has geographic bounds; the indoor image has a measured width in metres. An entrance edge joins one outdoor node to one indoor node. Each place and QR anchor refers to a routable node. The editor permits adding/moving/deleting places and connected path nodes/edges; no polygon/floor-transform editor.

`POST /api/admin/login`, authenticated `/api/admin/draft` reads/edits and image upload, `/api/admin/aps`, `/api/admin/samples`, and `/api/admin/publish` are the write surface. Public `GET /api/venues/:id/latest`, `GET /api/venues/:id/versions/:version/manifest`, and versioned asset URLs are the read surface. Each public snapshot is immutable and contains `schemaVersion: 1`, venue ID, integer version, zones and image digests, entrance node ID, AP BSSID allowlist, places, graph, anchors and aggregated per-room fingerprints. Published JSON and images have stable URLs and SHA-256 digests; Android downloads into a staging directory, verifies schema and digests, then atomically changes its active-version pointer. Failed download or incompatible schema keeps the previously usable pack. Web and mobile have local schema validators and the same small fixture from the backend; there is no separate contracts package. A contract change increments `schemaVersion` and needs coordinated client updates.

The backend aggregates fresh Android survey results by room/BSSID using median RSSI; only registered fixed BSSIDs participate. The Android matcher compares a fresh scan with room fingerprints using a deterministic normalized-distance rule with penalties for missing APs, returning room, confidence, timestamp and number of common APs. Fixture tests fix the matching rule. A scan is accepted as new only if the OS reports a newer scan-result timestamp; passive OS scan broadcasts can contribute, but requested scans obey Android's foreground throttle. There is no promise of a fresh room fix every few seconds. The displayed fix ages, degrades confidence when stale, and offers the fallbacks. Android uses Wi-Fi when fresh and credible, then usable GPS outdoors, then QR, then manual start; web starts at GPS outdoors, then QR, then manual start. GPS is not used to guess an indoor room. A shortest-path search over the small graph runs in each visitor client, with the backend fixture asserting the same expected route IDs.

## QR and access

Until there is a public HTTPS domain, each anchor sign has two printed QR codes: `navmap://anchor/<venue>/<version>/<anchor>` for offline Android opening by the device camera, and `https://<LAN-host>/v/<venue>/a/<anchor>` for a connected browser. Test the target phone's external camera in the day-one spike; if it does not hand off `navmap://` while offline, include a small open-source in-app QR scanner so scanning still sets the saved anchor without a network. Android also provides manual anchor-code/start selection. Unknown anchor, wrong venue or absent pack produces a clear prompt to download the venue or choose a start. A single verified HTTPS App Link can replace both codes later.

## Publish checks and failure states

Publishing requires both images and outdoor bounds, one connected route from the outdoor entrance to every published place, at least one indoor anchor, 3–4 registered AP BSSIDs, and usable fingerprint profiles for the demo rooms. Report missing items to the organizer before publishing; retain the editable draft. Unknown/stale scan results do not move the blue dot. If GPS permission is denied or GPS accuracy is insufficient, present QR/manual options. If the network fails, Android uses its last complete pack; web shows a retry state. Survey uploads are foreground/online only. Admin credentials and sample data remain on the laptop; visitor position is processed on-device and is not uploaded.

## Verification and operating constraints

Day-one proof on the target Android device: request/location permission behavior, fresh scan timestamps under production scan throttling, and a Leaflet map rendering both stored images in airplane mode with Wi-Fi re-enabled. If this proof fails, address that specific feasibility issue before building the editor. Automated checks cover draft validation, publish immutability, disconnected graph rejection, snapshot digests/rollback, route fixture, matching fixture, session enforcement and unauthorized writes. End-to-end manual walkthrough covers author → survey → publish → download → connected web route → disconnected Android search/route/position → QR/manual fallback. Use an actual handset and fixed APs for the 10-spot measurement; an emulator does not prove Wi-Fi positioning.

For laptop-and-phone development, run the API and Vite on LAN addresses; Android may use LAN HTTP in a development-only configuration. Browser GPS on a phone needs locally trusted HTTPS (for example an open-source local certificate tool) or an HTTPS deployment. A single backend process can serve built web assets and API for the demo; remote deployment, multi-tenant SaaS, iOS, map tile hosting, continuous high-frequency indoor tracking, media galleries, PDF export, and background sync are outside this prototype.

## External platform constraints

- Android Wi-Fi scanning: https://developer.android.com/develop/connectivity/wifi/wifi-scan (normal foreground scan requests are throttled; stale results are possible).
- OSM standard tile policy: https://operations.osmfoundation.org/policies/tiles/ (offline/prefetch downloads are prohibited).
- Browser geolocation: https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API (secure-context permission required).
