# Map schema V5 rollout

Reader-first rollout for the V5 frame-aware contract (`schemaVersion: 5` with
explicit geographic/local coordinates). V4 drafts and immutable V4 manifests
stay readable everywhere; no migration rewrites them.

## Order of operations

1. Deploy the compatible backend, web, and mobile readers together. Every
   reader parses V4 (strict V4 schemas are preserved as legacy exports) and
   upgrades V4 to V5 in memory only (`upgradeV4Draft` / `upgradeV4Manifest`).
2. Verify V4 fixtures and packs before enabling authoring:
   - backend `npm test` covers V4 contract, V4 publication, and the legacy
     `browser-static`/`legacy-v4` style venues;
   - mobile `npm test -- --runInBand` covers V4 pack parsing and the
     corrupt-pack recovery path (bad data is rejected; existing packs are
     never deleted);
   - web `npm run e2e` covers the published `legacy-v4` venue and the
     `browser-static` V5 venue.
3. Only then set `MAP_V5_AUTHORING_ENABLED=1` on the backend. Web and mobile
   clients gate creation/saving/publishing of V5 maps on
   `GET /api/capabilities` (`{ mapV5AuthoringEnabled }`); the editor shows a
   read-only notice while the flag is off, and the server rejects V5 writes
   with 403 even if a client ignores the flag.

## Client compatibility

- Old clients that cannot parse V5 receive `schemaVersion: 5` payloads they
  do not understand. They must show an **update-required message** and must
  not attempt to edit, re-save, or "repair" the document.
- The public manifest endpoints keep serving the stored bytes: V4 venues
  keep returning V4 JSON, V5 venues return V5 JSON.

## Rollback

Stopping V5 authoring means unsetting `MAP_V5_AUTHORING_ENABLED`. The server
then rejects new V5 creation/saves/publications with 403, but:

- already saved V5 drafts and published V5 versions keep working;
- nothing is converted back to V4 and no saved V5 map is deleted;
- V4 authoring (where still offered by the legacy editor) is unaffected.

## Backups

- The SQLite database (`DATA_DIR`) holds drafts, venue names, sessions,
  asset metadata, and revision high-water rows. Back it up before enabling
  V5 authoring and before any rollback.
- `DATA_DIR/versions/<venue>/<n>/` holds immutable published manifests and
  PNG assets; `DATA_DIR/layout-assets/<venue>/` holds draft assets. These
  directories are append-only by design (startup cleanup only removes
  uncommitted staging directories, never referenced versions).
- Never reset the database or delete user maps to "fix" a schema mismatch;
  V4 data is forward-readable, not disposable.

## Release limitations (documented, not silently fixed)

- Uploads: source PNG/PDF files up to 20 MiB; PDFs up to 20 pages; derived
  PNGs at most 4096 px per side and 16,000,000 px total. PDFs are rasterized
  in the browser; only converted PNG bytes are uploaded — executable PDF
  content never reaches the server. Conversion has a 30-second budget per
  page and is cancelable.
- Physical scale is optional: uncalibrated static maps route on
  dimensionless costs (source pixels divided by frame width). No metre
  totals are shown unless every edge carries valid metres; missing scale
  never produces misleading totals.
- OSM tiles are online-only. Geographic editors allow zoom 24 but raster
  tiles clamp at native z19 (visibly blurry when overzoomed); vector edits
  work while tiles fail. There are no offline OSM tile downloads.
- Static maps never request geolocation. GPS is an unsnapped outdoor dot
  with an accuracy ring; it never sets a starting point and never claims an
  indoor room or floor.
- Positioning limits: Wi-Fi positioning needs native Android capabilities
  and surveyed profiles; QR/manual starts are explicitly labelled and are
  not continuous tracking. GPS readings older than 60 s are stale; node
  observations older than 120 s are stale.
- Asset processing: image decoding is bounded to two concurrent jobs per
  server process (excess uploads get 429), and each venue has a 256 MiB
  asset quota (excess gets 413). In a multi-process deployment these
  in-process guards do not coordinate — run a single process or add a
  database-backed lock/quota before scaling out.
- No map deletion, duplication, collaborative editing, or automatic GPS
  snapping into the routing graph in this release.
