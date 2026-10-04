# NavMap contract: unified V4 over V3-named modules

Source fixture: `fixtures/unified-v3.json` (copied into web and mobile; no
shared package).

## Truth model

- `schemaVersion` is exactly `4` for drafts and published manifests.
- A venue has one geographic boundary, zero or more indoor zones, nodes with
  WGS84 `lat`/`lng` and integer floor `z`, and explicit walkable edges.
- Outdoor nodes have `zoneId: null` and `z: 0`. Stacked nodes at identical
  coordinates on different floors are valid.
- Edge kinds are `path`, `entrance`, `stairs`, and `elevator`.
- Places and QR anchors refer to node IDs. Wi-Fi profiles are attached to
  nodes and their fingerprint revisions.
- No image uploads, pixel-space positions, V1/V2 parsing, or automatic legacy
  migration are supported.

## API

- `POST /api/admin/login`
- `GET/PUT /api/admin/venues/:venueId/draft-v3`
- `POST /api/admin/venues/:venueId/node-samples`
- `POST /api/admin/venues/:venueId/publish-v3`
- `GET /api/venues/:venueId/latest`
- `GET /api/venues/:venueId/versions/:version/manifest`

V4 published manifests are immutable. Unsupported schemas fail explicitly.
The local development database and assets were cleared for the unified reset;
production and remote data were not touched.

## Verification and release caveat

Run `npm test`, `npm run typecheck`, and `npm run build`. Physical Android
positioning and offline acceptance still requires a real device.
