# Floor-aware node and place editing design

**Status:** Approved in conversation on 2026-10-02; awaiting written-spec review.

## Goal

Make the organizer reliably place nodes on any configured floor, edit node and
place information, and move nodes by dragging them instead of panning the map.
Node display names are persistent shared map data. Preserving old maps is not a
requirement; no old-map migration is planned.

## Contract and data flow

Introduce a coordinated new map schema version across `navmap-web`,
`navmap-backend`, and `navmap-mobile`. The new node contract requires a
non-empty `name`, retaining stable `id`, geographic coordinates, zone/floor,
and fingerprint revision. IDs remain the references used by edges, places,
anchors, and surveys; renaming a node does not change its ID or invalidate
survey samples. Place records remain separate and contain their existing name,
zone ID, and node ID. Update backend validation, draft persistence/API,
publish output, mobile validation/display paths, fixtures, and tests together.
No migration or compatibility adapter for the previous map schema is required.

## Organizer behavior

- Retain the current map-wide floor visibility filter, but add a separate,
  explicit active-floor control used only when placing nodes. Selecting a zone
  selects its configured ground floor by default; the active floor is shown
  clearly. Outdoor placement remains ground-level only. Adding a node to an
  indoor zone uses the chosen floor, never an implicit lowest-floor fallback.
- In Move mode, dragging a node changes its geographic position. Disable map
  panning while that mode is active; empty-map drags do not move the map. Normal
  pan and zoom return in other modes. Preserve existing boundary validation,
  fingerprint-revision behavior, and map selection semantics when moving.
- The selected-node inspector edits the node display name, coordinates, and
  floor. Floor choices are restricted to the node's zone; outdoor nodes remain
  floor zero. Names appear in node lists and map markers/tooltips, with IDs
  available as secondary identifying information.
- The inspector allows an organizer to create a place for a node and edit or
  delete its linked place. Place name and node/zone assignment are distinct
  from the node display name. Assignment must satisfy existing zone/node
  integrity validation. The Places tab provides the same edit path rather than
  remaining read-only.
- All changes use the existing draft edit/save flow, status/error reporting,
  and dirty-state behavior.

## Scope boundaries

No changes to route algorithms, survey identity, map geometry, multi-place-per-
node behavior, mobile map authoring, or preservation of old schema drafts and
published packs. Unless existing validation demonstrates otherwise, retain the
current single-place-per-node model.

## Verification

- Backend: new-version contract accepts named nodes, rejects missing/blank
  names, persists edits, and publishes named nodes.
- Web: model tests cover add on a non-ground active floor, rename, coordinate
  and floor edits, and place create/edit/delete with invalid assignments
  rejected. Organizer tests cover active-floor placement and node/place forms.
- Map: component or browser tests verify node drag updates coordinates, empty
  map drag does not pan in Move mode, and normal navigation still pans.
- Mobile: validator and UI tests accept/display node names and exercise the new
  manifest version; contract fixtures are synchronized across all three
  projects.
- Run each repository's relevant tests, typecheck/lint, and build. Run the web
  E2E suite for the editor interaction.
