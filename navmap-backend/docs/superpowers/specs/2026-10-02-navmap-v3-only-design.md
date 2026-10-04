# NavMap V3-Only Hard Cut Design

## Goal

Make the unified geographic V3 model the only supported NavMap truth across
the local web organizer, backend persistence/API, and mobile offline-pack
reader. Remove legacy editor/map-management/visitor UI and V1/V2 compatibility
paths. Reset the local development data so startup begins with a clean V3
workspace.

## Decisions

- V3 is the only editable and persisted contract after this change.
- The web application opens directly into the V3 organizer. It has no legacy
  organizer, maps-list workflow, or visitor-preview routes.
- Backend draft, survey, publish, and public manifest endpoints use V3 only.
  Versioned published records are no longer retained as V1/V2 archives.
- Mobile offline packs accept V3 only. Legacy V1/V2 parsers, fallbacks, and
  compatibility UI are removed.
- Existing development database content and uploaded/version assets are to be
  cleared. Preserve code fixtures needed for V3 tests; do not preserve user
  records as fixtures.
- No production or remote environment is to be modified or deployed.

## Web behavior

- `/` renders `OrganizerV3` directly for the configured/default venue.
- Remove routes and UI for the V1/V2 organizer, maps list, and visitor preview.
- V3 editing, saving, surveying, and publishing remain available.
- Remove cross-navigation links to retired pages. Keep only navigation useful
  within the V3 authoring experience.

## Backend and storage

- Keep V3 schemas, draft storage, V3 validation/publishing, and V3 public reads.
- Remove V1/V2 draft parsing/storage, legacy aliases, publishing paths,
  migration helpers, and compatibility-only routes/types once no V3 path
  depends on them.
- Startup/init creates a clean V3 demo draft and only V3 schema/storage.
- Purge the configured local development `DATA_DIR` contents (SQLite DB and
  sidecars, uploads, and published-version files) as a one-time local reset.
  Do not silently wipe on every startup. A repeatable explicit reset command
  should require a clear confirmation token and print the exact resolved
  target before deleting anything.
- Never reset if configured storage resolves outside the backend workspace
  unless the operator explicitly confirms that exact path.

## Mobile behavior

- V3 is the only downloaded, persisted, and rendered pack format.
- Remove V1/V2 contract parsing, route/location fallbacks, and legacy wording.
- Existing packs on physical devices are not remotely erased; updated app
  behavior must clearly reject/remove stale incompatible packs or require a
  local app-data reset. Device data is outside the local workspace reset.

## Failure handling and compatibility

- Unsupported V1/V2 API payloads/manifests fail explicitly with an
  unsupported-schema response rather than being misparsed as V3.
- Existing clients and saved V1/V2 packs are intentionally incompatible after
  the hard cut. This is a development reset, not a backward-compatible
  rollout.
- Preserve authentication and V3 API error behavior.

## Validation

- Add route tests proving the root opens V3 and retired paths are absent.
- Add backend tests proving V3-only init/storage/API behavior and rejection of
  legacy payloads.
- Add mobile tests proving V3 pack round trips and rejection of V1/V2 packs.
- Run backend/mobile/web full tests and typechecks; backend build; web lint and
  relevant browser tests.
- Verify reset safety with a temporary directory and verify the actual
  resolved local path before deleting workspace data.
- Physical Android behavior remains unverified until tested on a device.

## Explicitly out of scope

- Production data deletion, deployment, push, or PR creation.
- Remote erasure of already-installed Android offline packs.
- Adding an automatic V1/V2 migration path; legacy data is intentionally
  discarded under this approved hard-cut design.
