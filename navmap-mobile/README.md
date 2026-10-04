# NavMap V3 Android client

Offline-first Android client for V3 geographic venue packs. V3 is the only
supported pack schema. It provides node/floor positioning, QR/manual starts,
GPS zone hints, surveys, explicit-edge routing, and an OSM-based map renderer.

## Setup

```sh
npm ci
npm test -- --runInBand --forceExit
npm run typecheck
npm run android
```

Set `API_BASE_URL` and `VENUE_ID` for the local backend (defaults to the
configured development service and `demo`). V3 manifests contain geographic
coordinates and no image assets. OSM tiles require connectivity; the route and
saved map geometry remain available offline.

A stale non-V3 pack is rejected and removed from the app's local pack store.
This does not erase packs on a physical device until the updated app runs there.

## Field acceptance

Real-device checks for GPS zone hints, Wi-Fi node matching, QR/manual override,
offline rendering, and floor-aware routes remain a release gate.
