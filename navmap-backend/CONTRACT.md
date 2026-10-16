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

## Navigable paths (optional route grouping)

Drafts and published manifests may carry optional route grouping over the
ordinary node/edge graph:

- `paths?: [{ id, name, nodeIds, controlNodeIds? }]` on drafts and manifests.
  `nodeIds` is the full sampled point sequence (at least two IDs);
  `controlNodeIds` optionally records the authored corner/landing vertices in
  order so later edits can tell intentional collinear clicks apart from
  spacing samples; when present it holds at least two IDs, each of which must
  appear in `nodeIds` in the same order. Omission stays omission: parsers leave `paths` undefined
  and callers use `draft.paths ?? []`.
- Node `generated?: boolean` marks surveyable reference points sampled along a
  drawn route. Generated points are ordinary graph nodes with integer floor
  `z`, zone membership, and fingerprint revisions.

Publication validates grouping with `validatePathGroups` (`duplicate path
id`, `unknown node`, `consecutive identical node id`, `missing connection`,
and `control node ... not in path sequence / out of order` errors) and
preserves `paths` in the manifest only when the draft defines it. Wi-Fi
profiles are still built only from actual current-revision node samples;
nothing is synthesized for unscanned points.

Compatibility: `schemaVersion` stays `4` and old maps without the new fields
parse unchanged. All three parsers are strict, so an older client whose
parser predates `paths`/`generated`/`controlNodeIds` rejects manifests that
contain the new metadata — those clients require an update before they can
read maps with drawn routes.

## Verification and release caveat

Run `npm test`, `npm run typecheck`, and `npm run build`. Physical Android
positioning and offline acceptance still requires a real device.

## V5 frame-aware contract (schemaVersion 5)

V5 replaces WGS84 `lat`/`lng` node fields with explicit positions:
`{ kind: 'geographic', lat, lng }` or `{ kind: 'local', x, y }`. A map has
one canvas kind (`geographic` | `static`), an optional boundary, indoor
zones with floors, and frames: one frame per zone/floor plus an optional
outdoor frame. Nodes, edges, paths, transitions, places, and anchors all
name their frame; ordinary edges never cross frames.

- Node subcategories are structural: regular nodes, `entrance` transitions
  (indoor/outdoor pair), and `stair`/`elevator` transitions (cross-floor
  pair). Path subcategories are `regular` and `stair` (a stair path follows
  exactly one stair transition's ordered landings).
- Static frame backgrounds reference immutable layout assets
  `{ assetId, width, height, sha256, byteLength }` verified against
  venue-scoped storage. Publication stages verified PNGs, renames the
  version directory, then commits the version row; failed attempts keep the
  previous latest version.
- Routing uses positive costs (geographic edges keep legacy metre weights;
  static edges use source-pixel distance over frame width; cross-frame
  transitions use explicit costs). Metre totals are optional and shown only
  when every edge carries valid metres.
- V4 drafts and immutable V4 manifests remain readable; V4 is upgraded to
  V5 in memory only and never rewritten. New saves/publications use
  schemaVersion 5 and require `MAP_V5_AUTHORING_ENABLED=1` (see
  `docs/map-schema-v5-rollout.md`).
- Upload limits: source PNG/PDF <= 20 MiB, PDF <= 20 pages, derivative
  <= 4096 px per side and <= 16,000,000 px. See the rollout doc for the
  full limits, GPS/positioning honesty rules, and multi-process caveats.

New endpoints: `POST /api/admin/venues` accepts optional
`canvasKind: 'geographic' | 'static'`; `PATCH /api/admin/venues/:venueId`
renames; `POST /api/admin/venues/:venueId/layout-assets` uploads one PNG;
`GET /api/admin/venues/:venueId/layout-assets/:assetId` serves draft
artwork; `GET /api/venues/:venueId/versions/:version/assets/:assetId`
serves published artwork; `GET /api/capabilities` reports the authoring
flag. Cookie-authenticated writes require a same-origin `Origin` (or
`Referer`) header; browser test contexts must send it explicitly.
