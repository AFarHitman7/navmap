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

## Path-point surveying

Surveys treat every node — manual or `generated` — as a physical stop: stand
at the selected point (the confirmation panel prints its `Coords lat, lng`),
select building/floor/node, confirm the ordered label
(`<Path name> · Point <i> of <n>`; shared junctions list one label per path,
landings included), then scan. Generated route members are listed in
path-sequence order ahead of the remaining nodes; manual nodes are never
hidden or reordered into the route. Uploads post scans against the node ID
and its current `fingerprintRevision`, never a path ID, and profiles are
built only from fresh scans at their current revision.

Physical-device limitation: mocked suites cover labels, ordering, uploads,
and routing through generated points, but real-device Wi-Fi accuracy,
offline rendering, and floor-aware routes remain unverified until exercised
on hardware (see Field acceptance below).

## Field acceptance

Real-device checks for GPS zone hints, Wi-Fi node matching, QR/manual override,
offline rendering, and floor-aware routes remain a release gate.
