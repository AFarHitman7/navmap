# Map Authoring and Visitor Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch subagents without explicit user approval of that execution mode.

**Goal:** Deliver contextual, undoable map authoring with abstracted paths, named map storage, geographic/static canvases, higher zoom, and destination-focused visitor maps.

**Architecture:** Preserve the full survey/routing graph and derive separate editor, survey, and visitor presentations. Introduce a V5 frame-aware contract with explicit geographic/local coordinates while retaining V4 readers; use shared pure editing operations and transactional history. Reuse venue storage for named maps and store validated, immutable PNG assets for static backgrounds.

**Tech Stack:** React 19, TypeScript, Leaflet 1.9, Fastify 5, SQLite, Zod, Vitest, Playwright, React Native/Android, Jest. Add browser `pdfjs-dist`, backend `@fastify/multipart` and `sharp`; lock compatible versions in existing lockfiles and use a bundled PDF worker, not a CDN.

**Spec:** `docs/superpowers/specs/2026-10-14-map-authoring-redesign-design.md`

## Global Constraints

- One canvas type per map for this release. No in-place Geographic/Static conversion of populated maps and no hybrid georeferenced image overlays.
- Existing V4 drafts/manifests remain readable. New saves/publications use schemaVersion 5 with explicit coordinate/frame information. V4 immutable manifests are never rewritten. Web, backend, and mobile readers must be deployed together before V5 authoring is enabled.
- Upload limits: source PNG/PDF <=20 MiB; PDF <=20 pages; derivative <=4096 pixels on either axis and <=16,000,000 pixels. PNG validation happens server-side as well as in the browser. PDF conversion is cancelable with a 30-second budget per page.
- Saving keeps editor history; switching/reloading maps resets session history. History is bounded to 100 completed document edits. Map creation/rename, upload transport, and publication are management/server operations, not undoable canvas edits; assigning/replacing a background in the draft is undoable.
- No map deletion, duplication, collaborative editing, OSM offline tile downloads, or automatic GPS snapping into an indoor routing graph in this release.
- Do not delete user maps, reset the database, rewrite immutable V4 manifests, or auto-delete offline packs on schema errors.
- Preserve anchors, Wi-Fi samples, stable node IDs, shared junctions, and existing elevator connections.
- Hide the full path network and active-route lines in visitor mode; never hide internal graph data from routing/survey logic.
- OSM supplies map tiles, not GPS. Static mode never requests geolocation; GPS never establishes an indoor room or floor.

---

## Repository findings

- `navmap-web/src/OrganizerV3.tsx` is the large editor controller and inspector. Its `edit()` helper is not the only mutation entry point: audit every `setDraft()` call.
- `navmap-web/src/MapCanvasV3.tsx` draws every graph edge/node. Current maxZoom is 20 and tile maxNativeZoom is 19.
- `navmap-web/src/editor-v3/paths.ts` already groups paths, samples nodes, tracks controlNodeIds, and handles junctions. Preserve these behaviors.
- `navmap-backend/src/venues.ts` and `src/routes/venues.ts` already list/create/rename maps; `navmap-web/src/api-v3.ts` does not expose these calls.
- V3-named contract modules actually require schemaVersion 4. Web/backend/mobile have separate strict parsers and different Zod versions.
- `navmap-backend/src/publish-v3.ts` currently publishes no images; mobile `src/pack.ts` currently downloads JSON only.
- `navmap-mobile/src/positioning-v3.ts` resolves Wi-Fi/QR/manual nodes and GPS zones. Mobile GPS does not currently resolve routing nodes.
- `navmap-web/playwright.config.ts` already starts backend and web test servers, with desktop and Pixel 7 projects.

## File and responsibility map

Keep legacy filenames as entry points where necessary; do not rename the entire repository.

| New unit | Responsibility |
|---|---|
| `{navmap-web,navmap-mobile}/src/map-contract.ts`, `navmap-backend/src/map-contract.ts` | V5 schemas/types and V4-to-V5 read adapter |
| `{navmap-web,navmap-mobile,navmap-backend}/src/map-geometry.ts` | Explicit geographic/local geometry; no Leaflet dependency |
| `navmap-web/src/editor-v3/history.ts`, `useEditorDocument.ts` | Transactions, dirty state, history, revision safety |
| `navmap-web/src/editor-v3/objects.ts`, `presentation.ts`, `tool-state.ts` | Logical transition operations, visible object projection, discriminated tool/selection state |
| `navmap-web/src/editor-v3/inspectors/*.tsx` | One active-tool or selection inspector per component |
| `navmap-web/src/maps/{MapPicker,NewMapDialog}.tsx` | Existing venue identity/name management |
| `navmap-web/src/layouts/{pdf-import,layout-api}.ts`, `LayoutImportPanel.tsx` | Bounded PDF conversion, PNG upload, floor/frame assignment |
| `navmap-backend/src/layout-assets.ts`, `src/routes/layout-assets.ts` | Asset validation/storage/authenticated draft and manifest-scoped public reads |
| `navmap-web/src/map/{GeographicCanvas,StaticCanvas,CanvasHost}.tsx` | Canvas lifecycle, CRS and background selection |
| `navmap-web/src/location/{useGeolocation,location-view}.ts` | Opt-in browser position and honest display state |
| `navmap-web/src/directions.ts`, `navmap-mobile/src/directions.ts` | Meaningful route instructions, not reference-node dumps |
| `navmap-web/test/fixtures/map-v5.ts`, `navmap-backend/test/fixtures/map-v5.ts`, `navmap-mobile/__tests__/fixtures/map-v5.ts` | Equivalent named fixtures for both coordinate modes |

Tests live in the existing test directories. Contract fixture JSON files are copied to all three clients; no shared package is introduced in this release.

## Dependency and delivery gates

Execute in order: **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16**.

- Gate A (Tasks 1–3): compatible readers, frame-aware graph, trustworthy undo; V5 authoring remains disabled until all consumers support it.
- Gate B (Tasks 4–7): validated static assets, publication, canvas and survey/offline support.
- Gate C (Tasks 8–13): named maps and editor UX, including removal of Connect only after transition parity.
- Gate D (Tasks 14–16): visitor abstraction, GPS display, integrated release verification.

Every task follows red/green tests, then a narrowly scoped commit. Run commands from the package directory stated for that task. Stage only that task's files, never `git add .` across unrelated work. Do not commit during plan creation.

### Task 1: Add the V5 contract and compatibility fixtures

**Files:** Create the three `src/map-contract.ts` modules, three `map-v5.ts` fixture builders, and `fixtures/map-v5-geographic.json` / `fixtures/map-v5-static.json` in each package. Modify `src/contract-v3.ts` (web/mobile), backend `src/draft.ts`, and existing contract tests. Keep V4 schemas available as legacy exports.

**Interfaces:** Export `Position`, `Rect`, `MapDraft`, `MapManifest`, `MapNode`, `MapEdge`, `MapFrame`, `MapPath`, `MapTransition`, `parseMapDraft(raw: unknown): MapDraft`, `parseMapManifest(raw: unknown): MapManifest`, and `upgradeV4Draft(raw: DraftV3): MapDraft`. Upgrade is an in-memory read adapter; only explicit Save writes V5. Test fixtures export `geographicDraft(): MapDraft` and `staticDraft(): MapDraft`.

```ts
type Position = { kind: 'geographic'; lat: number; lng: number }
  | { kind: 'local'; x: number; y: number };
type Rect = { kind: 'geographic'; north: number; south: number; east: number; west: number }
  | { kind: 'local'; left: number; top: number; right: number; bottom: number };
type MapFrame = {
  id: string; zoneId: string | null; z: number; bounds: Rect;
  background?: { assetId: string; width: number; height: number; sha256: string; byteLength: number };
  calibration?: { metersPerPixel: number };
};
type MapNode = {
  id: string; name: string; frameId: string; position: Position;
  zoneId: string | null; z: number; fingerprintRevision: number;
  generated?: boolean; visitorVisible: boolean;
};
type MapEdge = {
  from: string; to: string; kind: 'path' | 'entrance' | 'stairs' | 'elevator';
  cost: number; meters?: number;
};
type MapPath = {
  id: string; name: string; kind: 'regular' | 'stair';
  nodeIds: string[]; controlNodeIds?: string[];
};
type MapTransition = {
  id: string; name: string; kind: 'entrance' | 'stair' | 'elevator';
  nodeIds: [string, string];
};
// MapDraft: schemaVersion: 5, venueId, canvas: { kind: 'geographic' | 'static' },
// boundary: Rect | null, indoorZones: { id, name, bounds?: Rect, floors }[],
// frames: MapFrame[], nodes, edges, paths, transitions, places, anchors, aps.
// MapManifest adds version/profiles, requires a valid boundary for geographic
// maps and assigned backgrounds for static frames with navigable content.
```

- [ ] Write failing tests for V4 upgrade, V5 geographic/static parsing, nonfinite coordinates, unknown fields/version, invalid local ranges/frame references, and transition pairs. The geographic fixture has two floor frames plus an outdoor frame; the static fixture has two 1000×1000 PNG floor frames and an optional outdoor frame.
```ts
it('reads a static layout without invented geographic coordinates', () => {
  const draft = parseMapDraft(staticDraft());
  expect(draft.canvas.kind).toBe('static');
  expect(draft.nodes[0].position).toMatchObject({ kind: 'local', x: 0.2, y: 0.3 });
  expect('lat' in draft.nodes[0].position).toBe(false);
});
```
- [ ] Run `npm test -- test/contract-v3.test.ts` in web/backend; mobile `npm test -- --runInBand __tests__/contract-v3.test.ts`. Expect the new assertions to fail before the new modules exist.
- [ ] Implement strict schemas above. V4 edges map `cost=meters`; derive frames from zone/floor membership; preserve omitted metadata, IDs, profiles/revisions, and source V4 immutable publications. Legacy authored non-generated nodes and place-linked nodes become visitorVisible. Recover transition groups from entrance/stairs/elevator edges without changing edge IDs/endpoints; split mixed legacy path groups at transition edges, assigning stable derived group IDs and preserving graph topology.
- [ ] Read fixtures in all parsers and compare normalized output. Re-run the focused tests and typechecks; V4 exports still compile for consumers not yet migrated.
- [ ] Commit the contract/fixture files: `feat: add explicit geographic and static map contracts`.

### Task 2: Make geometry, routing, validation, and persistence frame-aware

**Files:** Create three `src/map-geometry.ts` modules. Modify web `editor-v3/{model,paths,path-geometry}.ts`, `geo-v3.ts`, `route-v3.ts`, `api-v3.ts`; backend `draft.ts`, `validate-v3.ts`, `path-validation.ts`, `path-geometry.ts`, `geo-v3.ts`, `node-survey.ts`, `venues.ts`, `db.ts`, `publish-v3.ts`, routes `{venues,public}.ts`; mobile `contract-v3.ts`, `route-v3.ts`, `geo.ts`, `path-survey.ts`, `positioning-v3.ts`, `Root.tsx`, `SurveyScreen.tsx`. Update relevant existing model/path/route/publication tests in all packages.

**Interfaces:** `segmentMetrics(a: MapNode, b: MapNode, frame: MapFrame): { cost: number; meters?: number }`, `containsPosition(frame: MapFrame, position: Position): boolean`, `emptyMapDraft(venueId: string, kind: 'geographic' | 'static'): MapDraft`. Existing graph entry points consume MapDraft/MapManifest; frame/node ID references remain stable.

```ts
// Local geometry operates in source pixel units, not screen pixels.
const pixels = Math.hypot((bx - ax) * width, (by - ay) * height);
const cost = pixels / Math.max(width, height);
const meters = calibration ? pixels * calibration.metersPerPixel : undefined;
// Geographic regular edges use distanceMeters for cost and metres.
// Cross-frame transitions use explicit positive cost; default stair cost is
// 4 * abs(to.z - from.z), entrance cost 1. Metres are omitted unless supplied
// for static transitions; these costs are not displayed as physical distances.
```

- [ ] Add failing tests: same local position on different floors is valid; ordinary edges across frames are invalid; stairs inside one building across floors are valid; entrances pair outdoors and ground-floor indoors; invalid places/anchors fail; positive routing costs work without meters; shortest paths preserve existing geographic results.
```ts
it('routes an uncalibrated static graph without claiming metres', () => {
  const draft = staticDraft();
  expect(shortestPathV3(draft, draft.nodes[0].id, draft.nodes[1].id)).not.toBeNull();
  expect(draft.edges[0].meters).toBeUndefined();
  expect(draft.edges[0].cost).toBeGreaterThan(0);
});
```
- [ ] Run focused tests (`npm test -- test/paths.test.ts test/route-v3.test.ts` in web; corresponding backend tests; mobile route/survey tests) and confirm the new cases fail.
- [ ] Implement coordinate dispatch explicitly. Geographic sampling remains metre-based; local sampling uses 20 source pixels by default, capped at 5000 generated nodes per authored path. A calibrated frame can sample by physical spacing instead. Keep intersections in the same frame; never interpolate across stairs/entrances or compare coordinates from different frames. Replace all edge.meters routing comparisons with edge.cost and keep physical distance optional. Validate graph/frame membership when saving, not only publishing. Audit all lat/lng assumptions using grep across the three src directories and update callers.
- [ ] Make geographic-only GPS classification reject/bypass static maps. Update empty-draft creation and server save/publication to V5. Public readers validate V4 using the legacy schema and send the original V4 JSON, rather than serializing the in-memory upgraded object; V5 manifests preserve canvas/frames/transitions/visibility. Upload and asset publication are added in Tasks 4–5; static publishing remains rejected until every referenced asset is verified there. Keep legacy fixture readers working through adapters.
- [ ] Run package tests/typechecks; confirm generated graph count limits reject before large mutation/allocation. Commit: `feat: support frame-aware editing and routing`.

### Task 3: Centralize document changes and implement safe undo/redo

**Files:** Create web `editor-v3/history.ts`, `useEditorDocument.ts`, tests `history.test.ts`, `editor-history.test.tsx`; modify `OrganizerV3.tsx`, `UnsavedChangesDialog.tsx`, backend `draft.ts` and `node-survey.ts`, tests `draft-v3-store.test.ts` / `node-survey.test.ts`.

**Interfaces:** `createHistory(document: MapDraft)`, `commitEdit(state, next: MapDraft, label: string)`, `undoEdit(state)`, `redoEdit(state)`; state contains past/present/future plus lastSaved and per-node revision high-water marks. `useEditorDocument(initial)` exposes `{ document, dirty, canUndo, canRedo, commit, undo, redo, markSaved, reset }`. Pending tool geometry is not part of saved document history.

```ts
it('keeps save history and returns to a clean saved geometry', () => {
  const first = geographicDraft();
  let state = createHistory(first);
  const second = { ...first, nodes: first.nodes.map((n, i) => i ? n : { ...n, name: 'Lab' }) };
  state = commitEdit(state, second, 'Rename node');
  state = { ...state, lastSaved: second };
  expect(undoEdit(state).present.nodes[0].name).toBe(first.nodes[0].name);
  expect(redoEdit(undoEdit(state)).present).toEqual(second);
});
```

- [ ] Add failing tests for all edit categories; no-op/failed edits create no history; redo clears on new edits; max history 100; moves and path generation group into one transaction; undo removes latest pending corner before committed edits. Test Ctrl/Cmd+Z, Ctrl+Y, Ctrl/Cmd+Shift+Z and input/contenteditable native undo.
- [ ] Run `npm test -- test/history.test.ts test/editor-history.test.tsx`; expect missing reducer/hook failures.
- [ ] Implement snapshots with immutable operations. Remove document `setDraft()` writes outside the hook (load/reset and server acknowledgement use reset/markSaved only). Save responses update lastSaved without overwriting newer local edits; disable conflicting edits while save runs for the initial release. Lock destructive shortcuts while loading/saving/publishing. Reconcile invalid selections after undo; do not record pan, zoom, selection, or visibility.
- [ ] Implement monotonic fingerprint revision high-water marks: geometry change, undo of geometry, redo, background replacement, or calibration affecting surveyed coordinates increases affected nodes' revision; rename/visibility does not. Server compares stored geometry and historical sample revision maximum and rejects stale/reused revisions; return a structured conflict without silently activating old Wi-Fi samples. Geometry undone before saving may be geometrically equal but remains dirty if revisions changed. Node deletion/restore follows the same high-water rule.
```ts
// Never restore an old sample identity solely because geometry was undone.
restored.fingerprintRevision = Math.max(previousRevision, highWater[nodeId]) + 1;
```
- [ ] Add disabled-state Undo/Redo buttons and accessible labels. Test undo after Save cannot resurrect stale published samples; run web/backend focused tests and typechecks. Commit: `feat: add transaction-based undo and redo`.

### Task 4: Add secure venue-scoped layout assets

**Files:** Create backend `src/layout-assets.ts`, `src/routes/layout-assets.ts`, `test/layout-assets.test.ts`; modify `package.json`, lockfile, `src/routes/admin.ts`, `src/app.ts`, `src/db.ts`, `src/routes/public.ts`.

**Interfaces:** `storeLayoutPng(db, dataDir, venueId, bytes: Buffer): Promise<LayoutAsset>` where `LayoutAsset={assetId,width,height,sha256,byteLength}`. `POST /api/admin/venues/:venueId/layout-assets` accepts one multipart PNG; authenticated `GET /api/admin/venues/:venueId/layout-assets/:assetId` serves drafts. Public `GET /api/venues/:venueId/versions/:version/assets/:assetId` serves only assets referenced by that stored manifest. Pass dataDir to public route registration.

```ts
// Registration limit and decoded-image limit are separate protections.
await app.register(multipart, { limits: { files: 1, fileSize: 20 * 1024 * 1024, fields: 0 } });
const image = sharp(bytes, { limitInputPixels: 16_000_000, animated: false });
const metadata = await image.metadata();
if (metadata.format !== 'png' || !metadata.width || !metadata.height ||
    metadata.width > 4096 || metadata.height > 4096 || (metadata.pages ?? 1) !== 1) {
  throw Object.assign(new Error('Unsupported layout image'), { statusCode: 400 });
}
// Re-encode as PNG to strip ancillary payloads; hash the canonical bytes.
```

- [ ] Add failing API tests using existing `test/helpers.ts`: missing auth→401; foreign origin→403 for multipart; false MIME/signature→400; oversized→413; unknown map/foreign asset→404; corrupt/animated image→400; repeated canonical upload→same asset ID. Include decoded dimension limits and path traversal requests.
- [ ] Run `npm test -- test/layout-assets.test.ts`; expect new routes to be missing.
- [ ] Install compatible dependencies, create an additive `layout_assets` table keyed by (venue_id, asset_id), use server-generated SHA-256 IDs and a generated venue/hash path. Perform bounded decoding with a 30-second processing timeout and cancel/cleanup on disconnect. Use temporary files and atomic rename; no client filename/path is persisted. Extend origin checks to all cookie-authenticated write media types; do not rely on the existing JSON-only check. Limit concurrent image processing to two jobs and reject excess requests with 429.
- [ ] Read assets only through validated DB ownership and manifest references; set image/png, nosniff, and private/no-store for draft access. Public immutable assets receive long-lived cache headers. Ensure metadata cannot claim dimensions/hash different from stored bytes.
- [ ] Run tests/typecheck/build. Commit: `feat: store validated static layout assets`.

### Task 5: Publish static assets atomically and preserve version isolation

**Files:** Modify backend `src/publish-v3.ts`, `version-dir.ts`, `db.ts`, `routes/public.ts`, tests `publish-v3.test.ts`, `manifest-v3.test.ts`; create `test/static-publish.test.ts`.

**Interfaces:** Existing publish API still returns a MapManifest and latest metadata. Frame backgrounds reference immutable asset IDs; version asset GET is scoped to that version. `publishV3()` remains the entry point and stages verified assets before storing the manifest row. Add `validatePublicationAssets(draft: MapDraft, lookup: (assetId: string) => LayoutAsset | undefined): string[]`; the production lookup is scoped to draft.venueId. Keep `validatePublishV3(draft)` for pure graph checks.

```ts
// Order is significant: verify -> stage -> rename -> DB commit -> visible latest.
// A renamed directory without a DB row is an orphan, not a published version.
// Never expose a DB version row whose image files do not exist.
```

- [ ] Write failing tests: missing/foreign/corrupt asset blocks publication; background dimensions must match asset metadata; frame with content needs a background; publication preserves profiles; replacing draft background leaves old manifest/asset bytes unchanged; copy/DB failure leaves latest version unchanged.
```ts
it('requires matching stored layout metadata', () => {
  const draft = staticDraft();
  const actual = { ...draft.frames[0].background! };
  draft.frames[0].background!.sha256 = '0'.repeat(64);
  expect(validatePublicationAssets(draft, id => id === actual.assetId ? actual : undefined))
    .toContain('Layout asset metadata does not match stored asset');
});
```
- [ ] Run `npm test -- test/static-publish.test.ts test/publish-v3.test.ts`; expect failures before asset-aware staging.
- [ ] Implement asset-aware validation separately from pure graph validation. Stage a version directory on the same filesystem; verify hash, copy PNGs, rename it, then commit version DB row. Clean only the failed staging/orphan directory created by this attempt. Serialize publication per venue to avoid racing version numbers. Update existing startup cleanup to recognize V5 assets and never remove referenced content-addressed assets.
- [ ] Test restart after simulated failure and old-version reads. Do not add broad asset garbage collection in this release because undo can reference previously assigned assets. Run backend tests/typecheck/build. Commit: `feat: publish immutable static map backgrounds`.

### Task 6: Implement PNG/PDF import, floor assignment, and calibration

**Files:** Create web `layouts/pdf-import.ts`, `layout-api.ts`, `LayoutImportPanel.tsx`; modify package/lockfile, `editor-v3/model.ts`, `api-v3.ts`; create tests `layout-import.test.tsx`, `layout-calibration.test.ts`; add valid two-page/encrypted/corrupt test PDFs under `test/fixtures/layouts/`.

**Interfaces:** `readLayoutSource(file: File, signal: AbortSignal): Promise<{ pages: number; renderPage(page: number): Promise<Blob>; close(): Promise<void> }>`; `uploadLayout(venueId: string, png: Blob, signal: AbortSignal): Promise<LayoutAsset>`; `assignBackground(draft: MapDraft, frameId: string, asset: LayoutAsset): MapDraft`; `calibrateFrame(draft, frameId, a: {x:number;y:number}, b: {x:number;y:number}, meters: number): MapDraft`.

```ts
const pixelDistance = Math.hypot((b.x - a.x) * background.width, (b.y - a.y) * background.height);
if (!(meters > 0 && Number.isFinite(meters)) || pixelDistance === 0) throw new Error('Choose two distinct points and a positive distance');
const metersPerPixel = meters / pixelDistance;
```

- [ ] Write failing tests for PNG import, multi-page preview/page→floor assignment, duplicate assignment confirmation, missing floor, size/page/dimension limits, corrupt/password-protected PDFs, cancel, timeout, upload error, calibration validation and undo of background/scale assignment.
```ts
it('calibrates a 100-pixel segment as ten metres', () => {
  const next = calibrateFrame(staticDraft(), 'floor-0', { x: .1, y: .2 }, { x: .2, y: .2 }, 10);
  expect(next.frames.find(f => f.id === 'floor-0')!.calibration!.metersPerPixel).toBeCloseTo(.1);
});
```
- [ ] Run `npm test -- test/layout-import.test.tsx test/layout-calibration.test.ts`; expect importer/model exports missing.
- [ ] Bundle pdfjs-dist and its worker; inspect source size before parsing, require <=20 pages, render selected pages sequentially to bounded canvases preserving aspect ratio, and export PNG. Cancel/timeout destroys loading/render tasks, worker and canvases; revoke preview object URLs. Reject encrypted PDFs with a clear message instead of adding password storage. Server accepts only converted PNG, never executable PDF content.
- [ ] Upload derivative first, then commit assignment using Task 3 history. Upload does not change the draft if assignment fails/cancels. New frames start normalized bounds [0,1]. Replacement preserves normalized node positions, asks confirmation if nodes exist, clears old calibration and bumps affected fingerprint revisions; no silent rescale or image cropping. Calibration recomputes optional edge metres but not topology/routing costs.
- [ ] UI labels uncalibrated frames and incomplete assignments; floor switching uses frame IDs. Re-run tests/typecheck/build. Commit: `feat: import and calibrate static floor layouts`.

### Task 7: Add static canvas plus native survey/offline support

**Files:** Create web `map/{GeographicCanvas,StaticCanvas,CanvasHost}.tsx`; modify `MapCanvasV3.tsx`, `OrganizerV3.tsx`, mobile `src/map/MapView.tsx`, `src/map/leafletHtml.ts`, `src/{pack,storage,native,path-survey}.ts`, `src/Root.tsx`, `src/SurveyScreen.tsx`, and their existing tests. Create web `test/static-canvas.test.tsx`, mobile `__tests__/static-pack.test.ts`, `__tests__/static-survey.test.tsx`.

**Interfaces:** `CanvasHost({document, view, activeFrameId, mode, callbacks})` selects geographic/static renderer by canvas.kind and keys Leaflet instance lifecycle to CRS. Callback `onPointClick(position: Position, frameId: string)` returns map coordinates, not pixels. PackAdapter gains `getBytes(url): Promise<Uint8Array>`, `writeBytes(path, bytes): Promise<void>`, `readBytes(path): Promise<Uint8Array>`, `hashBytes(bytes): Promise<string>` implemented through native adapters. Keep existing JSON methods.

```ts
// CRS.Simple uses bottom-left-oriented Leaflet coordinates; local model is top-left.
const toLeaflet = (p: { x: number; y: number }, width: number, height: number) =>
  [height * (1 - p.y), width * p.x] as [number, number];
const fromLeaflet = (lat: number, lng: number, width: number, height: number) =>
  ({ kind: 'local' as const, x: lng / width, y: 1 - lat / height });
```

- [ ] Add failing coordinate roundtrip tests for corners/centre, multiple dimensions, floor switches, placement/drag, independent fit bounds, and no tile/GPS requests on static maps. Native tests require original generated reference points to remain surveyable even when hidden in visitors.
- [ ] Run web static-canvas tests and mobile `npm test -- --runInBand __tests__/static-pack.test.ts __tests__/static-survey.test.tsx`.
- [ ] Extract canvas lifecycle without altering graph algorithms; use CRS.Simple and imageOverlay for static frames. Leaflet instance remounts on canvas kind change; floor changes swap overlays/visible graph without changing positions. Route all coordinate callbacks through the shared Position type. Reject clicks outside the frame. Use an explicit frame selector for static editing (one active frame at a time); geographical controls can still show multiple buildings/floors.
- [ ] Extend offline packs: download all referenced immutable PNGs to staging, verify size/hash, write manifest, atomically activate only complete packs. Failed downloads retain previous active pack. Unsupported-schema loading returns a recoverable error and never runs existing broad `rmrf(packs/venue)` logic. Embed bounded local PNGs in mobile WebView using existing data-URI approach; no file path from a manifest is evaluated as a URL/HTML script. Escape labels and apply safe bridge payload parsing.
- [ ] Update survey UI to pick frame/floor, list internal reference points, scan current-revision nodes, and render local positions. Wi-Fi matching remains node-ID based; GPS classifier is never called for static maps. Run relevant tests/typechecks. Commit: `feat: render and survey static maps with offline assets`.

### Task 8: Add named maps and guarded map selection

**Files:** Create web `maps/MapPicker.tsx`, `NewMapDialog.tsx`, tests `map-picker.test.tsx`, `map-storage.test.ts`; modify `api-v3.ts`, `App.tsx`, `OrganizerV3.tsx`, `UnsavedChangesDialog.tsx`, backend `venues.ts`, `routes/venues.ts`, tests `draft-v3-api.test.ts`.

**Interfaces:** `VenueSummary={id:string;name:string;latestVersion:number}`, `listMaps(signal?:AbortSignal): Promise<VenueSummary[]>`, `createMap(name:string, kind:'geographic'|'static'):Promise<VenueSummary>`, `renameMap(id:string,name:string):Promise<VenueSummary>`. Extend existing POST venues body to optional canvasKind; absent kind remains geographic for old callers. Server creation atomically initializes correctly typed empty V5 draft.

```ts
// Continue using venue IDs, not names, in storage keys and deep links.
const editorUrl = (id: string) => `/editor/${encodeURIComponent(id)}`;
// New map creation receives explicit canvas kind; no later destructive toggle.
```

- [ ] Write failing tests: two named maps save independent graphs/backgrounds; reload preserves names/content; new static map is typed static from its first stored draft; duplicate human names do not collide IDs; rename cannot change ID; demo remains listed; loading/auth/retry/empty states work.
- [ ] Run `npm test -- test/map-picker.test.tsx test/map-storage.test.ts` and backend draft API tests.
- [ ] Implement wrappers over existing APIs and map picker/New map/Rename dialogs. Header always displays name and saved state. Preserve root demo route and direct editor/visitor URLs. Use router navigation for switching so useBlocker participates; Save→switch only after confirmed success, failed Save keeps the current document, Discard requires explicit choice, Cancel preserves pending drawing. Warn about unfinished drawing even if the committed document is clean; finishing or canceling the gesture is explicit.
- [ ] Reset selection/tools/history on map load; abort stale list/load requests. Rename is a management operation outside document undo. Reuse global admin authentication; do not invent per-user ownership. Do not add Delete or Duplicate.
- [ ] Run focused tests/typechecks and two-map API integration tests. Commit: `feat: add persistent named map picker`.

### Task 9: Implement logical node and path subcategories

**Files:** Create web `editor-v3/objects.ts`, tests `editor-objects.test.ts`; modify `editor-v3/{model,paths}.ts`, backend `validate-v3.ts`, `path-validation.ts`, native `path-survey.ts`, and matching tests.

**Interfaces:** `addRegularNode(draft, frameId, position, name): MapDraft`; `addEntrance(draft, indoorNodeId, outdoorNodeId, name): MapDraft`; `addStair(draft, lowerNodeId, upperNodeId, name): MapDraft`; `addRegularPath(draft, vertices, name): MapDraft`; `addStairPath(draft, transitionId, name): MapDraft`; `removeTransition(draft,id):MapDraft`. Operations return an entire valid graph transaction.

```ts
it('represents a stair as two real survey landings', () => {
  const draft = staticDraft();
  const next = addStair(draft, 'landing-0', 'landing-1', 'East stairs');
  expect(next.transitions.at(-1)).toMatchObject({ kind: 'stair', nodeIds: ['landing-0', 'landing-1'] });
  expect(next.edges.some(e => e.kind === 'stairs' && e.from === 'landing-0' && e.to === 'landing-1')).toBe(true);
});
```

- [ ] Write failing tests for indoor regular nodes, paired entrances, floor X/Y stair creation, snapping to existing landings, explicit stair paths, duplicate pairs, same-floor/cross-building rejection, ground-floor entrance constraints, deletion with shared points/places/anchors, and one-entry undo of compound changes.
- [ ] Run `npm test -- test/editor-objects.test.ts` and backend path/publication tests.
- [ ] Implement groups over real nodes/edges; regular paths cannot carry inline stair toggles. For legacy mixed paths use Task 1's split groups. Entrance workflow lets users select/create indoor and outdoor endpoints; a static entrance can only complete after an outdoor frame is assigned. Stair workflow asks building, floors X/Y, then landing positions; no fabricated spatial line between different local frames. Allow optional physical length for static transitions. Preserve elevators as selectable existing transition objects with edit/delete capability using their kind and paired landings.
- [ ] Show regular/stair category from explicit path.kind, not name inference. Renaming/visibility never resamples a path; moving controls reuses stable IDs when coordinates persist, bumps revisions for changed geometry and protects references before removing nodes. Prevent a group deletion from deleting shared/anchored/place-linked endpoints silently.
- [ ] Run tests/typechecks and mobile survey regressions. Commit: `feat: add explicit node and path subcategories`.

### Task 10: Build contextual inspector and tool state

**Files:** Create web `editor-v3/tool-state.ts`, `inspectors/{Inspector,BoundaryInspector,BuildingInspector,NodeInspector,PathInspector,TransitionInspector}.tsx`, tests `contextual-inspector.test.tsx`; modify `OrganizerV3.tsx`, `PathControls.tsx`, `styles.css`, `Icon.tsx`.

**Interfaces:**
```ts
type Tool = { kind: 'select' } | { kind: 'boundary' } | { kind: 'building' }
  | { kind: 'node'; subtype: 'regular' | 'entrance' | 'stair' }
  | { kind: 'path'; subtype: 'regular' | 'stair' };
type Selection = { kind: 'none' } | { kind: 'boundary' }
  | { kind: 'building'; id: string } | { kind: 'node'; id: string }
  | { kind: 'path'; id: string } | { kind: 'transition'; id: string };
// Active drawing tool takes precedence; select tool shows selected object.
// Inspector props: document, tool, selection, activeFrameId, commit, tool callbacks.
```

- [ ] Write failing component tests: Path hides boundary/building/node forms; Node subtype displays only required fields; select zone/node/path shows its own properties; none shows short guidance; Places/Publish remain separate views; static mode exposes import/frame settings rather than geographic boundary prompts.
- [ ] Run `npm test -- test/contextual-inspector.test.tsx`; expect the old stacked inspector to fail visibility assertions.
- [ ] Replace Build mega-panel with focused components and discriminated state. Extract only the touched editor concerns, not an unrelated wholesale rewrite. Toolbar Node/Path buttons expose accessible subtype menus with current subtype visible. Keep save state/actions and undo buttons fixed outside inspector scroll; each form has controlled submit/validation and uses Task 3 commits. Keep unfinished geometry across harmless selection events or require Finish/Discard/Cancel before changing tool.
- [ ] Remove repeated explanation paragraphs, numeric section prefixes, and internal UUID labels from normal controls. Use a compact status such as '3 corners' only when actively drawing. Keep optional coordinates/technical IDs under Advanced details. Right panel scroll is local to the relevant form; no unrelated collapsed sections fill it.
- [ ] Verify keyboard focus, subtype menu Escape behavior, no empty orphan inspector state after undo, and 390px layout. Run organizer and new tests/typecheck. Commit: `feat: show contextual tool and object settings`.

### Task 11: Render abstract paths and add a separate object browser

**Files:** Create web `editor-v3/presentation.ts`, `ObjectBrowser.tsx`, tests `map-presentation.test.ts`, `object-browser.test.tsx`; modify `MapCanvasV3.tsx`, `map/{GeographicCanvas,StaticCanvas}.tsx`, `OrganizerV3.tsx`, `styles.css`, existing canvas tests.

**Interfaces:** `projectMap(document: MapDraft|MapManifest, view:'editor'|'visitor'|'survey', selection:Selection): { nodes:MapNode[]; lines:{pathId:string;frameId:string;nodeIds:string[]}[]; handles:MapNode[]; transitions:MapTransition[] }`. Never mutate document in the projection. ObjectBrowser has separate Nodes/Paths tabs and search; transitions appear as logical main objects.

```ts
it('hides sampling markers without deleting the routing graph', () => {
  const draft = staticDraft();
  const projected = projectMap(draft, 'editor', { kind: 'none' });
  expect(projected.nodes.some(n => n.generated)).toBe(false);
  expect(draft.nodes.some(n => n.generated)).toBe(true);
  expect(projected.lines.length).toBeGreaterThan(0);
});
```

- [ ] Write failing tests: generated points absent by default; straight path has no intermediate handles; bent path retains its corners; branching/shared junctions connect correctly; selected path reveals authored controls only; clicking any segment selects its path; survey mode exposes references; list/search excludes hidden sample UUIDs.
- [ ] Run new projection/browser tests and `test/map-canvas-v3.test.tsx`.
- [ ] Draw one polyline per same-frame path stretch, not one visible object per sampled edge. Use full ordered geometry or safe collinear simplification, preserving control vertices and junctions; never connect endpoints across hidden frames. Render transition badges at visible landings. Generated controls can be handles when intentionally authored/selected but remain out of the ordinary node list. Legacy ungrouped edges retain a select/edit fallback until Task 12 parity passes.
- [ ] Object browser shows main nodes/logical transitions and named path rows with meaningful type, floor, and optional length; point count lives in Advanced details. Add an explicit survey/debug reference-points toggle in editor only. Visitor never inherits it.
- [ ] Verify deletion of shared paths, floor filters, selected objects, and route computation unchanged. Commit after tests/typecheck: `feat: abstract sampled paths in editor presentation`.

### Task 12: Remove Connect after unified workflow parity

**Files:** Modify web `OrganizerV3.tsx`, `MapCanvasV3.tsx`, `editor-v3/PathControls.tsx`, `editor-v3/{paths,objects,tool-state}.ts`; update tests `organizer-v3.test.tsx`, `paths.test.ts`; create `e2e/unified-tools.spec.ts`.

**Interfaces:** Node click in regular-path mode adds a snapped existing endpoint; Finish creates a regular path transaction. Selected legacy connections resolve to path/transition inspector actions. Remove `'connect'` from MapV3Mode only after parity tests pass; keep graph-level connectNodes available internally for operations/legacy import.

```ts
// Unified shortest authoring gesture:
// choose Path > Regular -> click existing A -> click existing B -> Finish.
// Entrance/Stair are explicit node workflows, not hidden connection-kind dropdowns.
```

- [ ] Add failing E2E tests for the above two-node gesture, cornered path, entrance pair, cross-floor stair pair/path, existing elevator edit, and legacy edge deletion; assert no separate Connect toolbar button or 'Link next landing as stairs' control.
- [ ] Run `npm run e2e -- e2e/unified-tools.spec.ts --project=desktop`; old toolbar should fail the new assertions.
- [ ] Remove Connect toolbar/mode, connection-kind dropdown and inline stairsArmed UI. Replace internal from-node gesture state with pending path/transition state. Ensure tools can connect existing paths at junctions without duplicating sampled nodes; existing duplicate/overlap validation remains explicit. Replace status messages 'Connect it' with 'Draw a path to it'.
- [ ] Retain legacy edge selection and elevator inspector until all old maps are editable. Test Escape and Ctrl+Z for every pending gesture and Finish grouping. Re-run E2E/unit/typecheck. Commit: `refactor: unify connection authoring under paths and transitions`.

### Task 13: Compact layers and increase editor zoom

**Files:** Modify web `LayerPicker.tsx`, `styles.css`, `MapCanvasV3.tsx`, `map/{GeographicCanvas,StaticCanvas}.tsx`, `floor-visibility.ts`; create `test/layer-picker.test.tsx`, update `test/map-canvas-v3.test.tsx`, `e2e/floor-layers-visitor.spec.ts`; update native `src/map/leafletHtml.ts` zoom and floor controls where applicable.

**Interfaces:** LayerPicker consumes canvas kind, active frame/building/floor, and existing visibility callbacks. Geographic editor uses maxZoom 24 and maxNativeZoom 19. Static zoom is defined relative to fitted image scale and supports at least 16× magnification over fit; do not reuse geographic zoom numbers blindly.

```ts
const map = L.map(element, { maxZoom: 24, zoomSnap: .25 });
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 24, maxNativeZoom: 19, attribution: osmAttribution,
}).addTo(map);
```

- [ ] Add failing tests: default layers collapsed; current floor accessible in compact row; many buildings do not increase row height; Outdoor label no longer says 'Outdoor paths' in visitors; popover supports keyboard/Escape; zoom reaches 24 and never requests raster tile z>19.
- [ ] Run layer/canvas tests and the existing floor E2E file.
- [ ] Replace always-open details with current-frame/floor row plus Layers popover; move helper copy into tooltip/help. Show outdoor/all/hide controls inside popover. Static floor switching chooses exactly one active frame; do not attempt overlaying unrelated image coordinate frames.
- [ ] Raise geographical editor map/tile maxZoom together, retain attribution/native limits, and keep screen-sized markers/snap tolerance stable. At overzoom show optional short 'Magnified map tiles' hint, not a new tall banner. Preserve tile-error fallback and allow vector editing despite background failures.
- [ ] Capture desktop/390px screenshots; default floor strip <=56px tall excluding optional popover, no horizontal clipping or map-obscuring permanent panel. Run E2E in both projects and typecheck. Commit: `feat: compact map layers and allow higher editor zoom`.

### Task 14: Abstract web/mobile visitor maps and directions

**Files:** Create web/mobile `src/directions.ts`, corresponding tests; modify web `VisitorV3.tsx`, `MapCanvasV3.tsx`, `editor-v3/presentation.ts`, mobile `VisitorScreen.tsx`, `map/{MapView,leafletHtml}` and existing visitor/map tests; create `e2e/visitor-abstraction.spec.ts`.

**Interfaces:** `buildDirections(map:MapManifest, nodeIds:string[]): { instructions:{kind:'start'|'walk'|'entrance'|'stairs'|'elevator'|'arrival';text:string;frameId:string}[]; totalMeters?:number }`. `LocationDisplay` introduced in Task 15 is passed to canvases separately from projected destination nodes. Visitor projection has zero path lines and zero editor boundary/zone outlines/handles.

```ts
it('omits reference-point names and unknown metre totals', () => {
  const map = { ...staticDraft(), version: 1, profiles: [] };
  const result = buildDirections(map, map.paths[0].nodeIds);
  expect(result.totalMeters).toBeUndefined();
  expect(result.instructions.map(i => i.text).join(' ')).not.toContain('Path point');
});
```

- [ ] Add failing tests for both canvases: only visitorVisible main nodes/place destinations; generated node explicitly referenced by a place remains visible; no whole-network or active-route lines; no editor rectangles/UUIDs; current position can reference a hidden survey node without revealing its marker list; QR/manual starting point choices contain only meaningful nodes.
- [ ] Run visitor/projection/directions tests and mobile visitor/map tests.
- [ ] Pass explicit view='visitor', use projected nodes only for display, retain complete manifest for shortestPathV3 and Wi-Fi. Replace 'Path points' destination group with Places/main destinations and replace reference-node route output with grouped walking/entrance/floor instructions. Show physical distance only if every edge has valid metres; do not partially sum calibrated stretches and label as a full distance. Floor instruction buttons select the correct frame.
- [ ] Static visitors load published PNG backgrounds; geographic visitors load OSM. Show published human-readable map name via public latest metadata (extend to include name, retaining old fields) rather than venue UUID. Support unconnected/no destination/no known location states. Destination selection does not create or pretend a live location.
- [ ] Verify mobile survey view still shows internal points, visitor never exposes debug toggle, and automatic floor following does not override explicit user floor choice without a resume-follow action. Commit after tests/E2E: `feat: show destinations and location in visitor maps`.

### Task 15: Add opt-in geographic location display and static position states

**Files:** Create web `location/useGeolocation.ts`, `location-view.ts`, `test/geolocation.test.tsx`, `test/location-view.test.ts`; modify web `VisitorV3.tsx`, canvases, mobile `positioning-v3.ts`, `Root.tsx`, `VisitorScreen.tsx`, `native.ts`, `map/leafletHtml.ts`; extend mobile positioning tests.

**Interfaces:**
```ts
type LocationDisplay =
  | { kind: 'unknown'; reason: 'idle'|'denied'|'unavailable'|'timeout'|'stale' }
  | { kind: 'gps'; position: { kind:'geographic';lat:number;lng:number }; accuracyMeters:number; seenAt:number }
  | { kind: 'node'; nodeId:string; source:'wifi'|'qr'|'manual'; seenAt:number; stale:boolean };
// useGeolocation({enabled:boolean, canvasKind:'geographic'|'static'})
// returns {location:LocationDisplay, start:()=>void, stop:()=>void}.
```

- [ ] Write failing tests with mocked navigator.geolocation: no call until explicit Locate me; static never calls it; permission denial/unavailable/timeout/nonfinite reading; clearWatch on stop/unmount/map switch; accuracy ring; >60s GPS reading marked stale. Existing node stale timeout remains 120s for automatic node observations; manual/QR source labels remain explicit rather than implying continuous tracking.
```ts
it('never asks for GPS on an uploaded layout', () => {
  const watch = vi.fn();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: watch, clearWatch: vi.fn() } });
  const { result } = renderHook(() => useGeolocation({ enabled: true, canvasKind: 'static' }));
  act(() => result.current.start());
  expect(watch).not.toHaveBeenCalled();
});
```
- [ ] Run new web tests and mobile positioning tests; expect missing hook/display support.
- [ ] Implement optional watchPosition on secure contexts (localhost allowed), validate coordinates/accuracy/timestamp, handle browser errors with retry/manual-start fallback, and clear resources. Render unsnapped geographic dot plus accuracy circle; outside venue is labelled as outside. Geographic GPS display is separate from a trustworthy node-based routing start. Do not infer an indoor floor or silently choose the nearest graph point. User can select a known start when GPS cannot establish one.
- [ ] Native geographic mode may retain raw GPS evidence for dot/accuracy while existing resolution keeps Wi-Fi/QR/manual node precedence. Static mode disables GPS watching/classification and displays node-based Wi-Fi estimates or labelled QR/manual positions via local frame coordinates. Low-confidence/no-match/stale Wi-Fi does not become a precise live dot. Keep permission messaging honest: Wi-Fi positioning requires native Android capabilities and surveyed profiles.
- [ ] Verify browser navigation/map switching cancels watches; native physical verification belongs to Task 16. Commit after tests/typecheck: `feat: display honest geographic and node-based location states`.

### Task 16: End-to-end acceptance, compatibility and release documentation

**Files:** Create web `e2e/map-storage.spec.ts`, `static-layout.spec.ts`, `undo-all-tools.spec.ts`; update existing E2E fixtures/specs, backend `scripts/e2e-server.ts`, docs `CONTRACT.md`, package READMEs, root `run.md`; create `docs/map-authoring-acceptance.md` and `docs/map-schema-v5-rollout.md`.

**Interfaces:** No new runtime API. The acceptance checklist records automated evidence separately from physical-device evidence. E2E server fixtures add V4 legacy, V5 geographic, and two-floor V5 static venues without touching real development data.

```ts
test('persists two differently typed named maps independently', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New map' }).click();
  await page.getByLabel('Map name').fill('Venue layout');
  await page.getByLabel('Static layout').check();
  await page.getByRole('button', { name: 'Create map', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Venue layout' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Venue layout' })).toBeVisible();
});
```

- [ ] Add failing integrated tests for PNG/PDF floor upload and reload, calibration, path abstraction, stair/entrance authoring, every edit tool's undo/redo (including background/floor/place deletion), Ctrl+Z during a gesture, save-failure/map-switch guard, two-map isolation, visitor invisibility of paths, GPS permission states, zoom 24, V4 readability and corrupt offline asset recovery.
- [ ] Run selected E2E tests before completing assertions/fixtures; confirm failures correspond to missing integration rather than absent servers/browser binaries. Use existing Playwright setup; install browsers only when needed.
- [ ] Complete wiring discovered by integrated tests; preserve red/green regression cases for any bug fix. Freeze the feature set: no conversion/hybrid/delete/duplicate/collaboration additions.
- [ ] Run web `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run e2e`; backend `npm test`, `npm run typecheck`, `npm run build`; mobile `npm test -- --runInBand`, `npm run typecheck`. Execute separately from each package directory and record exit/output evidence. Run physical Android build/test with the supported local toolchain, not an assumed desktop environment.
- [ ] Physical acceptance: geographic GPS outdoors with accuracy/denial; indoor GPS does not claim room/floor; native Wi-Fi/QR on both canvas types; floor transition; offline static pack after restart in airplane mode; stale position; old active pack survives failed update. If hardware is unavailable mark these checks Not run, never Passed.
- [ ] Visual acceptance on 1280×800 and 390×844: only relevant inspector fields; compact <=56px default layers strip; no UUID path rows/sampling-marker chains; usable handles at overzoom; static image aspect ratio/corners align; visitor shows destinations and source-labelled position only. Save screenshots without substituting screenshots for functional tests.
- [ ] Document V5 reader-first rollout, backups and feature flag: deploy compatible backend/web/mobile readers, verify V4 fixtures and packs, then enable new authoring. Old clients that cannot read V5 must receive an update-required message. Rollback stops V5 authoring but does not convert/delete saved V5 maps. Document upload limits, PDF rasterization, optional scale, OSM overzoom blur, online-only tiles, and GPS/native positioning limits.
- [ ] Commit verified release tests/docs: `test: cover map authoring and visitor redesign acceptance`.

## Coverage checklist

| User change | Tasks |
|---|---|
| Context-only right menu | 10 |
| Hide path points from nodes/list; expose paths | 1, 9, 11 |
| Visually straight/continuous paths without sub-node dots | 11 |
| Ctrl+Z for every editor tool | 3, 6, 9, 12, 16 |
| Reduce layers/path-control vertical space | 10, 13 |
| Clarify/remove Connect without losing capabilities | 9, 12 |
| Node Regular/Entrance/Stair; Path Regular/Stair | 1, 9, 10 |
| Named stored maps and picker | 8, 16 |
| Visitor destinations + location, no paths | 14, 15 |
| Geographic GPS with realistic limitations | 2, 15 |
| PNG/PDF static canvas and manual survey | 1, 2, 4, 5, 6, 7 |
| OSM higher zoom | 13 |
| Mobile schema/survey/offline compatibility | 1, 2, 7, 14, 15, 16 |

## Plan self-review / execution notes

- The schema migration is additive/read-compatible and explicit; it is not a reset of V4 data.
- The displayed graph is a projection. Reference points remain intact for surveys, anchors, shortest paths, and Wi-Fi profiles.
- Static coordinates always name a frame; cross-frame transitions never appear as a flat image-space line.
- Physical distance is optional, while routing always has positive costs. Missing scale never produces misleading metre totals.
- History cannot restore stale fingerprint identities, including after a save or restored deletion.
- Asset assignment is reversible; uploading/publishing server data is not treated as undoable remote deletion.
- Atomic publication and offline activation have explicit failure tests.
- Finish Task 12 parity before removing Connect. Finish multi-client readers before enabling V5 creation.
- This plan contains no implementation changes and no test results. Execution and physical testing require a separate handoff.
