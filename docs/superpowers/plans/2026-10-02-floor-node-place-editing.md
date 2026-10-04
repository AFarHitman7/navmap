# Floor-aware Node and Place Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a coordinated new map schema with named nodes and an organizer that places on an explicit floor, edits nodes and places, and moves nodes by dragging.

**Architecture:** Bump the shared published/draft contract to schema version 4 in the backend, web, and mobile projects, without a v3 migration path. Keep stable node IDs as the graph/survey key and add a required display name; keep places as separately editable records. In the web editor, the active placement floor is separate from the visibility filter, and Leaflet marker dragging is enabled only in Move mode while map panning is disabled.

**Tech Stack:** TypeScript, React, Leaflet, Zod, Fastify, React Native, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-floor-node-place-editing-design.md`

## Global Constraints

- Use schema version 4 consistently for the new coordinated contract.
- No migration or compatibility adapter for schema version 3 maps is required.
- Node IDs remain stable references for edges, places, anchors, and survey samples; rename must not increment fingerprint revision.
- Indoor placement uses the explicitly selected zone/floor; outdoor nodes remain on floor zero.
- Preserve the existing zone/boundary and place/node integrity validation.
- Run tests before implementation changes (TDD), and run every project's available verification before completion.
- This workspace has no Git repository; do not include commit steps or claim changes are committed.

---

## File map

### Web
- `navmap-web/src/contract-v3.ts`: contract/types and schema version literal; rename only if doing so is proportionate to the existing V3 naming convention.
- `navmap-web/src/editor-v3/model.ts`: node rename/update and place CRUD operations; node creation default name.
- `navmap-web/src/OrganizerV3.tsx`: active-floor state/control, node/place forms, and selection/edit flow.
- `navmap-web/src/MapCanvasV3.tsx`: display names, marker drag callbacks, and mode-specific map interaction.
- `navmap-web/src/styles.css`: compact form and active-floor styling.
- `navmap-web/src/fixtures/unified-v3.json`: coordinated fixture (rename/version file only if module imports are updated).
- `navmap-web/test/contract-v3.test.ts`, `navmap-web/test/organizer-v3.test.tsx`, `navmap-web/test/map-canvas-v3.test.tsx`, and a new or existing model test: regression coverage.
- `navmap-web/e2e/unified-map.spec.ts`: browser verification for floor placement and node dragging if existing harness supports direct map interaction.

### Backend
- `navmap-backend/src/draft.ts`: version 4 node/draft/manifest validation and types.
- `navmap-backend/src/publish-v3.ts` and call sites/tests: publish schema version 4 and emit names.
- `navmap-backend/src/validate-v3.ts`: update version-specific type imports only if needed; maintain graph rules.
- `navmap-backend/test/contract-v3.test.ts`, `navmap-backend/test/draft-v3-api.test.ts`, `navmap-backend/test/publish-v3.test.ts`: required-name, persistence, and publish coverage.
- `navmap-backend/fixtures/unified-v3.json`: synchronized v4 fixture.

### Mobile
- `navmap-mobile/src/contract-v3.ts`: version 4 types, strict validation, and version check.
- `navmap-mobile/src/VisitorScreen.tsx`, `navmap-mobile/src/SurveyScreen.tsx`, and any other UI found by searching node-ID-only labels: display node name while retaining ID for technical identity.
- `navmap-mobile/src/fixtures/unified-v3.json` and contract/visitor/survey tests: synchronized version 4 fixture and regression coverage.

> Keep existing `V3` module/function names unless a rename is needed to prevent an actual contract/version ambiguity. The serialized `schemaVersion` is authoritative; avoid broad cosmetic renaming.

---

### Task 1: Version 4 contract and fixtures across all three projects

**Files:**
- Modify: `navmap-backend/src/draft.ts`, `navmap-backend/test/contract-v3.test.ts`, `navmap-backend/fixtures/unified-v3.json`
- Modify: `navmap-web/src/contract-v3.ts`, `navmap-web/test/contract-v3.test.ts`, `navmap-web/src/fixtures/unified-v3.json`
- Modify: `navmap-mobile/src/contract-v3.ts`, `navmap-mobile/src/fixtures/unified-v3.json`, mobile contract tests

**Interfaces:**
- Produces a schema-version-4 node shape with required non-empty `name` and unchanged stable `id`.
- All V4 draft and manifest validators reject version 3 and reject missing/blank node names.
- The three fixture copies have identical serialized structure and node names.

- [ ] **Step 1: Write backend contract tests first.** Add cases proving a V4 draft and manifest accept `{ id, name, lat, lng, z, zoneId, fingerprintRevision }`, reject an empty name, reject a missing name, and reject `schemaVersion: 3`.
- [ ] **Step 2: Run the focused backend contract test and confirm expected failures.** Run `npm test -- contract-v3` in `navmap-backend`; failures must be schema/version assertions, not test setup errors.
- [ ] **Step 3: Write web schema tests.** Add matching V4 parse/reject cases in `navmap-web/test/contract-v3.test.ts`.
- [ ] **Step 4: Write mobile parser tests.** Verify V4 named node parse succeeds, missing/blank name fails, and V3 version fails in the hand-written strict parser.
- [ ] **Step 5: Implement contract types/validators in all projects.** Add `name: string`, validate trimmed non-empty names, change draft/manifest `schemaVersion` literals to 4, and retain strict unknown-key checks.
- [ ] **Step 6: Update all three fixtures together.** Add stable illustrative names to every node and set root `schemaVersion` to 4. Compare canonical JSON structures across projects.
- [ ] **Step 7: Run focused contract tests.** Backend: `npm test -- contract-v3`; web: `npm test -- contract-v3`; mobile: run the existing Jest command for `contract-v3`.

### Task 2: Backend persistence, publishing, and all V3 assumptions

**Files:**
- Modify: `navmap-backend/src/draft.ts`, `navmap-backend/src/publish-v3.ts`, API handlers/call sites located by search for `schemaVersion: 3` and `draftV3Schema`
- Modify: `navmap-backend/test/draft-v3-api.test.ts`, `navmap-backend/test/publish-v3.test.ts`, related contract fixtures

**Interfaces:**
- Draft update/GET round-trips required node names unchanged.
- Publishing emits `schemaVersion: 4` and preserves node names exactly.
- Survey profile lookup remains keyed by node `id` and `fingerprintRevision` only.

- [ ] **Step 1: Search backend for V3 literals and fixture assumptions.** Run `rg "schemaVersion: 3|literal\(3\)|schemaVersion.*3" src test` in `navmap-backend`; list each remaining occurrence as either intentionally legacy or to update.
- [ ] **Step 2: Add failing API round-trip test.** POST a V4 draft with a named node, GET it, and assert the name survives exactly.
- [ ] **Step 3: Add failing publish test.** Publish a V4 draft and assert manifest version 4 and named nodes; assert sample/profile identity remains the node ID.
- [ ] **Step 4: Run focused API/publish tests and confirm contract failures.** Run `npm test -- draft-v3-api` and `npm test -- publish-v3` in backend.
- [ ] **Step 5: Update API/publish paths.** Make V4 validators authoritative, publish version 4, and keep `id`/revision usage unchanged. Do not add v3 conversion logic.
- [ ] **Step 6: Run focused backend tests.** Run `npm test -- draft-v3-api`, `npm test -- publish-v3`, and `npm test -- node-survey`.

### Task 3: Web model operations for nodes and places

**Files:**
- Modify: `navmap-web/src/editor-v3/model.ts`
- Modify: `navmap-web/test/organizer-v3.test.tsx` or add `navmap-web/test/editor-v3-model.test.ts`
- Modify: V4 creation in `navmap-web/src/contract-v3.ts`

**Interfaces:**
- `addNodeAt(draft, lat, lng, zoneId?, z?)` creates a node with a deterministic non-empty default name based on its ID.
- Add pure model operations to rename a node, update node position/floor, add a place to a node, edit place name/assignment, and remove a place.
- Renaming never changes node ID or fingerprint revision. Position/floor changes retain existing location/fingerprint rules.
- Place operations enforce one place per node unless current contract tests/data prove the existing model intentionally supports more.

- [ ] **Step 1: Add failing tests for default name and rename invariants.** Assert new nodes have a name; renaming trims and rejects blank names; ID, edges, place references, and fingerprint revision remain unchanged.
- [ ] **Step 2: Run the focused model test and confirm failures.** Run `npm test -- editor-v3-model` in web.
- [ ] **Step 3: Add failing place CRUD tests.** Cover create, rename, reassignment to a valid node/zone, delete, blank names, unknown IDs, and invalid zone/node pairing.
- [ ] **Step 4: Implement minimal model operations.** Keep immutable draft updates and throw validation errors in the same style as existing model functions.
- [ ] **Step 5: Run model and contract tests.** Run `npm test -- editor-v3-model` and `npm test -- contract-v3`.

### Task 4: Explicit active-floor placement in OrganizerV3

**Files:**
- Modify: `navmap-web/src/OrganizerV3.tsx`, `navmap-web/src/styles.css`
- Consume Task 6's marker-label rendering in `navmap-web/src/MapCanvasV3.tsx` (do not duplicate map-label implementation here).
- Modify: `navmap-web/test/organizer-v3.test.tsx`

**Interfaces:**
- Add state for active placement floor distinct from `floorZ` visibility-filter state.
- Active zone/floor is explicit in the UI. Selecting an indoor zone initializes placement to that zone's Ground floor if present, otherwise the first configured floor. Changing zone cannot retain an invalid prior floor.
- Node add passes the active zone and floor explicitly; outdoor add always uses `zoneId: null, z: 0`.

- [ ] **Step 1: Add failing organizer test with a multi-floor zone.** Select the zone, choose Level 1 as active floor, click Add nodes and simulate a map point inside the zone; assert the resulting node belongs to that zone and has `z: 1`.
- [ ] **Step 2: Add failing test proving visibility filter is independent.** Set “All floors” visibility and Level 1 placement, then add; assert placement remains Level 1.
- [ ] **Step 3: Run `npm test -- organizer-v3` and confirm the new behavior fails.**
- [ ] **Step 4: Add the active-floor UI/state and ensure zone selection initializes a valid floor.** Leave current floor visibility filtering unchanged.
- [ ] **Step 5: Run organizer tests and web typecheck.** Run `npm test -- organizer-v3` and `npm run typecheck` in `navmap-web`.

### Task 5: Node inspector and linked place authoring

**Files:**
- Modify: `navmap-web/src/OrganizerV3.tsx`, `navmap-web/src/styles.css`
- Modify: `navmap-web/test/organizer-v3.test.tsx`
- Consumes Task 6's marker-label rendering in `navmap-web/src/MapCanvasV3.tsx`; do not duplicate map-label implementation here.

**Interfaces:**
- Selected-node inspector edits name, latitude, longitude, and floor, with floor choices constrained by zone.
- Node lists and details show display name with ID as secondary identity; Task 6 renders the same labels on map markers/tooltips.
- Inspector can create/edit/delete the node's place; Places tab links to the same editing UI.
- Every submit goes through existing `edit(...)` draft update/status/error flow.

- [ ] **Step 1: Add failing UI test for node rename and coordinate/floor edits.** Assert visible name updates, ID remains stable, and floor selection cannot choose a floor outside the node's zone.
- [ ] **Step 2: Run `npm test -- organizer-v3` and confirm fields/actions are absent.**
- [ ] **Step 3: Add failing place interaction tests.** From a selected node create a place, edit its name and assignment, delete it, and verify invalid/blank submissions report an error without corrupting draft state.
- [ ] **Step 4: Implement accessible forms and actions.** Use explicit labels, stable `aria-label`s, controlled or keyed form state so selection changes do not retain stale values, and route model errors through existing status/error UI.
- [ ] **Step 5: Update the Places tab.** Replace its read-only copy with controls that select the linked node and open/edit the linked place.
- [ ] **Step 6: Run organizer tests and lint.** Run `npm test -- organizer-v3` and `npm run lint` in web.

### Task 6: Drag selected nodes in Move mode without map panning

**Files:**
- Modify: `navmap-web/src/MapCanvasV3.tsx`, `navmap-web/src/OrganizerV3.tsx`
- Modify: `navmap-web/test/map-canvas-v3.test.tsx`, `navmap-web/e2e/unified-map.spec.ts`

**Interfaces:**
- Add a map callback such as `onNodeMove(id: string, lat: number, lng: number): void`.
- Move mode enables dragging node markers and disables Leaflet map dragging; empty-map pointer drags do not pan.
- Other modes retain standard pan and zoom; marker click still selects the node outside an active drag.
- Commit the moved position through the existing editor model and its boundary/fingerprint validation.

- [ ] **Step 1: Add failing component/integration test.** In Move mode drag a known marker to a distinct map location and assert callback receives the same node ID and changed coordinates.
- [ ] **Step 2: Add failing behavior test for empty-map drag and normal navigation.** Ensure Move mode map dragging is disabled, while navigate mode enables map dragging.
- [ ] **Step 3: Run `npm test -- map-canvas-v3` and confirm failures for missing drag behavior.**
- [ ] **Step 4: Implement marker drag events and mode-scoped interaction.** Convert Leaflet drag `LatLng` to callback arguments; guard callback when disabled; avoid the map-click-to-move path so a map click cannot reposition a node.
- [ ] **Step 5: Connect OrganizerV3 to `moveNode` and preserve error messages/revision rules.**
- [ ] **Step 6: Add/update Playwright E2E coverage.** Verify dragging a marker changes inspector coordinates and an empty-map drag leaves map center unchanged in Move mode; verify normal navigate-mode pan still works.
- [ ] **Step 7: Run component and browser tests.** Run `npm test -- map-canvas-v3` and `npm run e2e -- --grep "node drag"` in web.

### Task 7: Mobile V4 support and meaningful node labels

**Files:**
- Modify: `navmap-mobile/src/contract-v3.ts`, `navmap-mobile/src/VisitorScreen.tsx`, `navmap-mobile/src/SurveyScreen.tsx`
- Modify: `navmap-mobile/src/fixtures/unified-v3.json` and related tests under `navmap-mobile/__tests__`

**Interfaces:**
- Mobile accepts only V4 manifests for the new path and requires non-empty node names.
- Visitor and survey screens show node names to people while IDs remain available in details/debug where useful.
- QR/manual starts, edges, profiles, and sample upload continue referencing stable node IDs.

- [ ] **Step 1: Add failing mobile validator test for V4 and required names.**
- [ ] **Step 2: Add failing UI tests proving survey node picker and visitor node presentation use display names.**
- [ ] **Step 3: Run focused Jest tests and confirm expected failures.**
- [ ] **Step 4: Update mobile types, strict parser, version checks, and user-facing node labels.** Do not alter route or survey IDs.
- [ ] **Step 5: Run mobile contract, visitor, survey, and route tests.** Use the scripts in `navmap-mobile/package.json`.

### Task 8: Cross-repository integration verification

**Files:**
- Modify any remaining V3-only root version checks, endpoint tests, README/contract documentation, and fixtures found by repository-wide searches.

**Interfaces:**
- A V4 draft saved by the web editor is accepted by backend and publishes a V4 manifest consumed by mobile.
- All three checked-in fixture copies represent the same data; node display names do not alter routing or survey/profile identity.

- [ ] **Step 1: Search all projects for serialized schema version 3 assumptions.** Search for `schemaVersion`, version literals, and V3 fixture imports; distinguish intentional old-release code from active unified editor/publication paths.
- [ ] **Step 2: Run the full backend suite.** `npm test` in `navmap-backend`.
- [ ] **Step 3: Run web unit tests, typecheck, lint, build, and E2E.** In `navmap-web`, run `npm test -- --maxWorkers=1`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run e2e`.
- [ ] **Step 4: Run mobile test, typecheck, and build scripts.** Inspect `navmap-mobile/package.json` and run each supported check.
- [ ] **Step 5: Inspect working tree changes and report verification accurately.** No Git commands that assume a repository are applicable in this workspace.
