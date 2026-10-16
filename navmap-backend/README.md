# NavMap V3 backend

Fastify + TypeScript + SQLite backend for the unified geographic V3 map. V3 is
this service's only supported draft and published contract; there are no V1/V2
routes or migration paths.

## Local setup

```powershell
copy .env.example .env
# Set ADMIN_PASSWORD; optional DATA_DIR=./data, HOST=0.0.0.0, PORT=3000
npm ci
npm run db:init
npm run dev
```

Default storage is `./data`: SQLite database, sessions, and immutable V3
manifests. New databases start with one blank `demo` V3 draft. Existing local
development content was cleared; the running backend initialized a fresh V3
database at `DATA_DIR`.

To explicitly clear local development storage later, run
`npm run data:reset -- --confirm-v3-reset`. It prints the resolved `DATA_DIR`
and `DB_PATH` first. If the deletion target is outside this backend workspace,
also pass `--confirm-outside-path=<exact-canonical-target>`; no reset runs on
server startup.

## V3 API

Admin login: `POST /api/admin/login`.

Authenticated authoring:
- `GET/PUT /api/admin/venues/:venueId/draft-v3`
- `POST /api/admin/venues/:venueId/node-samples`
- `POST /api/admin/venues/:venueId/publish-v3`

Public V3 reads:
- `GET /api/venues/:venueId/latest`
- `GET /api/venues/:venueId/versions/:version/manifest`

Draft writes may be incomplete; publish validates geographic bounds, zones,
floors, nodes, explicit edges, anchors, and viable profiles. V3 maps use WGS84
latitude/longitude and integer floor `z`; published manifests have no raster
assets.

## Checks

```powershell
npm test
npm run typecheck
npm run build
```

## V5 contract and rollout

V4 drafts/manifests stay readable (upgraded in memory only, never
rewritten). New saves use schemaVersion 5 with explicit geographic/local
frames; see `CONTRACT.md` and `docs/map-schema-v5-rollout.md`.

Reader-first order: deploy backend/web/mobile readers together, verify V4
fixtures and packs, then set `MAP_V5_AUTHORING_ENABLED=1`. Rollback unsets
the flag and stops V5 authoring without converting or deleting saved V5
maps. Old clients that cannot parse V5 must show an update-required
message.

Upload limits: source PNG/PDF <= 20 MiB, PDF <= 20 pages, derivative
<= 4096 px per side and <= 16,000,000 px. Image decoding is bounded to two
concurrent jobs per process (excess gets 429); per-venue asset quota is
256 MiB (excess gets 413). Single-process deployment is assumed; see the
rollout doc before scaling out.
