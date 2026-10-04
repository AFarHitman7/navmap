# Outdoor-only Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an outdoor boundary without an indoor plan, paths, images, APs or surveys, and open that v2 publication on web and Android without breaking existing v1 packs.

**Architecture:** Backend owns v2 publication and v1 draft normalization; web and Android parse v1 and v2 with a discriminated `schemaVersion` union. Stage this as a coordinated release: empty maps have a transparent immutable image asset, and route/survey controls present empty states. Do not implement multiple indoors, rotated editing, barriers, imagery capture, or AP discovery in this phase; these are separate releases in `2026-09-29-navmap-release-roadmap.md`.

**Tech Stack:** Node.js 24.15+, Fastify, `node:sqlite`, TypeScript, Zod, Vitest; React/Vite/Leaflet, React Testing Library and Playwright; React Native Android, Jest and offline file packs.

**Spec:** `docs/superpowers/specs/2026-09-29-navmap-incremental-map-publishing-design.md`

## Global Constraints

- One venue, three separate Git repositories: `navmap-backend`, `navmap-web`, `navmap-mobile`. Do not reset or overwrite existing uncommitted changes.
- `schemaVersion: 2` for new publications; v1 manifests and already-downloaded packs remain readable and immutable.
- Outdoor boundary alone is publishable; places, nodes, zones other than outdoor, APs, profiles, anchors, survey scans and uploaded images are optional.
- Keep the existing 1.5 MB per-image limit, SHA-256 verification, immutable version assets and atomic Android pack activation.
- Never save or bundle `tile.openstreetmap.org` tiles; existing online interactive OSM attribution stays visible.
- This phase creates only north-up outdoor footprints with `rotationDegrees: 0`. Phase 2 adds rotation and indoor footprints. `widthMeters`, `heightMeters` and `center` are derived from drawn bounds, never requested in an initial form. New v2 zones default to `navigationMode:'free'`; this phase supports direct links in an outdoor zone with no barriers, and phase 3 adds barrier intersection and the path-only switch.
- Do not publish v2 from a server until a corresponding v2-capable Android release is available; old clients keep their v1 active pack on rejected downloads.

## File map

- `navmap-backend/src/footprint.ts`: single bounds→north-up footprint conversion and envelope validation, shared by legacy draft conversion and publishing; no editor responsibilities.
- `navmap-backend/src/draft.ts`: draft v2 type/validation and v1 normalization; preserve v1 manifest shape separately for stored versions.
- `navmap-backend/src/publish.ts`: validation, optional image fallback, filtered optional survey profiles, v2 manifest creation.
- `navmap-backend/src/routes/admin.ts`: serve normalized draft, preserve structured error details, keep current auth/image routes.
- `navmap-web/src/contract.ts`: v1/v2 discriminated manifest parser, v2 draft parser; `src/api.ts` parses structured errors.
- `navmap-web/src/Organizer.tsx`, `src/editor/model.ts`, `src/editor/PublishPanel.tsx`: outdoor-only publish/checklist, no manual AP entry, ready state with zero anchors.
- `navmap-web/src/Visitor.tsx`, `src/MapCanvas.tsx`, `src/route.ts`, `src/geo.ts`: boundary-only display, free outdoor routing, route empty states, v1 compatibility.
- `navmap-mobile/src/contract.ts`, `src/pack.ts`: validate v1/v2, preserve pack pointer on failure, load blank-map image.
- `navmap-mobile/src/Root.tsx`, `src/VisitorScreen.tsx`: no fixed `room-a` assumption; empty destination/survey and outdoor-only view.
- Add focused tests alongside existing backend `test/*`, web `test/*` and `e2e/*`, Android `__tests__/*`. Update each repository's README/contract only when its behavior changes.

## Task 1: Prove the present publish failure and lock the v1 regression

**Files:** Test: `navmap-backend/test/publish.test.ts`, `navmap-web/test/organizer.test.tsx`. Modify no production code in this task.

**Interfaces:** Consumes existing `demoDraft`, `testContext`, `login`, `updateDraft`, `/api/admin/draft` and `/api/admin/publish`. Produces tests documenting the old rejection and distinguishing save from publish failures.

- [ ] **Step 1: Write the reproduction test** in `navmap-backend/test/publish.test.ts` using the existing helpers:

```ts
it('reports the actual first-publish failure for a boundary-only draft', async () => {
  const { db, app } = testContext();
  try {
    const { cookie } = await login(app);
    const draft = {
      venueId: 'demo', zones: [{ id: 'outdoor', kind: 'outdoor',
        bounds: { north: 52.1, south: 52.0, east: 4.4, west: 4.3 } }],
      nodes: [], edges: [], places: [], anchors: [], aps: [], entranceNodeId: '',
    };
    const saved = await app.inject({ method: 'PUT', url: '/api/admin/draft', headers: { cookie }, payload: draft });
    expect(saved.statusCode).toBe(200);
    const response = await app.inject({ method: 'POST', url: '/api/admin/publish', headers: { cookie } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/indoor|entrance|AP/i);
  } finally { db.close(); }
});
```

- [ ] **Step 2: Run the reproduction**: `npm test -- test/publish.test.ts` from `navmap-backend`. Expected: PASS confirming server validation rejection; if PUT instead fails, inspect the response body and update the test to assert the observed boundary instead of guessing. Also exercise the existing web mock save-failure test with `npm test -- test/organizer.test.tsx` from `navmap-web`; record response codes and messages in the implementation review.
- [ ] **Step 3: Commit only this test** if the repositories are clean enough to stage exact files: `git add test/publish.test.ts && git commit -m "test: document boundary-only publish rejection"` from `navmap-backend`. Existing unrelated changes stay unstaged. If an existing modification in this file belongs to the user, review the diff and stage only owned hunks; do not include unrelated work.

## Task 2: Normalize the draft and define an outdoor-only v2 snapshot

**Files:** Create `navmap-backend/src/footprint.ts`; modify `navmap-backend/src/draft.ts`, `src/db.ts`, `src/routes/admin.ts`; test `navmap-backend/test/draft-v2.test.ts`.

**Interfaces:** Produces `type Footprint = { center: { lat:number; lng:number }; widthMeters:number; heightMeters:number; rotationDegrees:number }`, `footprintFromBounds(bounds): Footprint`, and `normalizeDraft(raw: unknown): DraftV2`. Consumers are Task 3 and the web v2 draft parser. The v2 draft shape is `{ venueId:'demo', zones: V2Zone[], nodes: GraphNode[], edges: V2Edge[], places: Place[], anchors: Anchor[], aps: string[] }`, without global `entranceNodeId`; `V2Edge = {from:string;to:string;meters:number;role:'path'|'portal'}`. An outdoor `V2Zone` has `id`, `kind:'outdoor'`, `bounds`, `footprint`, `navigationMode:'free'`, `barriers:[]`, and optional `image`. A migrated legacy indoor zone additionally has `entranceNodeId`, `entryNodeId`, `navigationMode:'paths'`, and draft-only `placementNeedsReview:true` until phase 2 lets the organizer position it on the building footprint. Legacy authored same-zone edges become `role:'path'`; the old cross-zone entrance edge becomes `role:'portal'`. Phase 3 adds barriers and the path-only editor switch.

- [ ] **Step 1: Write failing normalization tests** in `test/draft-v2.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeDraft } from '../src/draft.js';
import { footprintFromBounds } from '../src/footprint.js';
import { demoDraft } from './helpers.js';

describe('draft v2 normalization', () => {
  it('converts a saved north-up boundary without requiring indoor data', () => {
    const old = { venueId: 'demo', zones: [{ id: 'outdoor', kind: 'outdoor',
      bounds: { north: 52.1, south: 52, east: 4.4, west: 4.3 } }],
      nodes: [], edges: [], places: [], anchors: [], aps: [], entranceNodeId: '' };
    const draft = normalizeDraft(old);
    expect(draft.zones[0]).toMatchObject({ kind: 'outdoor', navigationMode: 'free', barriers: [],
      footprint: { rotationDegrees: 0 } });
    expect(draft).not.toHaveProperty('entranceNodeId');
    expect(footprintFromBounds(old.zones[0]!.bounds).widthMeters).toBeGreaterThan(0);
  });
  it('preserves a legacy indoor plan, nodes, images and entrance edge', () => {
    const old = demoDraft();
    const next = normalizeDraft(old);
    expect(next.zones.find(z => z.kind === 'indoor')).toMatchObject({ id: 'indoor', placementNeedsReview: true });
    expect(next.edges.map(({ role, ...edge }) => edge)).toEqual(old.edges);
    expect(next.edges.filter(e => e.role === 'portal')).toHaveLength(1);
    expect(next.nodes).toEqual(old.nodes);
  });
});
```

- [ ] **Step 2: Run red**: `npm test -- test/draft-v2.test.ts` in `navmap-backend`; expected import failure for `footprintFromBounds`/`normalizeDraft`.
- [ ] **Step 3: Implement normalization**: use the metre-per-degree approximation only for venue-sized, north-up phase-1 bounds; reject zero/negative spans and nonfinite coordinates. Keep old draft decoding separate from strict v2 writes, and preserve legacy indoor image/edge/entrance data with a migration marker for phase 2. The minimal conversion core is:

```ts
export function footprintFromBounds(b: { north:number; south:number; east:number; west:number }) {
  if (![b.north,b.south,b.east,b.west].every(Number.isFinite) ||
      !(b.north > b.south && b.east > b.west) || b.north > 90 || b.south < -90) {
    throw new Error('Outdoor boundary needs valid north/south/east/west coordinates');
  }
  const lat = (b.north + b.south) / 2;
  const lng = (b.east + b.west) / 2;
  const heightMeters = (b.north - b.south) * 111_320;
  const widthMeters = (b.east - b.west) * 111_320 * Math.cos(lat * Math.PI / 180);
  if (!(widthMeters > 0 && heightMeters > 0) || widthMeters > 20_000 || heightMeters > 20_000)
    throw new Error('Boundary must be smaller than 20 km in each direction');
  return { center: { lat, lng }, widthMeters, heightMeters, rotationDegrees: 0 };
}
```

`normalizeDraft` must map old outdoor bounds with this function, add empty barriers/navigation mode, retain indoor data with `entryNodeId` inferred from the old cross-zone edge and `entranceNodeId` inferred from its outdoor endpoint. For a v1 indoor zone with no georeferencing, center its first v2 footprint at that outdoor entrance's geographic position, use the old `widthMeters` and `heightMeters = widthMeters * 3/4`, and zero rotation; set draft-only `placementNeedsReview:true`. This is a reversible placement estimate; the editor labels it “review building placement”. V2 publish rejects a zone with this marker until phase 2 lets the organizer position it on the building footprint. The marker is never emitted in a public manifest. Map authored edges to `role:'path'` and the cross-zone link to `role:'portal'`. Reject ambiguous/missing pairings at publish with a message to review the legacy plan. A v2 blank draft written by `blankDraftJson()` has no zones and no global entrance field. `GET /api/admin/draft` normalizes old saved JSON; `PUT` accepts valid v2 and continues syncing `aps` with its table. Never update old version rows.
- [ ] **Step 4: Run green**: `npm test -- test/draft-v2.test.ts` and `npm run typecheck` from `navmap-backend`; expected PASS. Stage exact backend files, then `git commit -m "feat: normalize editable drafts to v2"`.

## Task 3: Publish a valid boundary without survey prerequisites

**Files:** Modify `navmap-backend/src/draft.ts`, `src/publish.ts`, `CONTRACT.md`; test `navmap-backend/test/publish.test.ts`, `test/imageless.test.ts`, `test/public.test.ts`. `src/routes/admin.ts` already returns both the publish error and structured `errors` array; keep that handler unchanged unless a new regression test proves it needs a change.

**Interfaces:** Consumes `DraftV2`, `footprintFromBounds`, existing `generatePlaceholderPng`, `buildProfiles`, `checkZoneImages`, `loadVersion`. Produces `ManifestV2` with `schemaVersion:2`, one outdoor zone, `image` ref, empty `nodes/edges/places/anchors/aps/profiles`, no global entrance; `loadVersion` accepts both v1 and v2. `validatePublish(draft, profiles, aps): string[]` must not reject absent APs/scans/indoors/anchors.

- [ ] **Step 1: Replace the old-rejection expectation from Task 1 with the desired success and add invalid-boundary/immutability cases**:

```ts
const { cookie } = await login(app);
const saved = await app.inject({ method: 'PUT', url: '/api/admin/draft', headers: { cookie }, payload: {
  venueId: 'demo', zones: [{ id: 'outdoor', kind: 'outdoor',
    bounds: { north: 52.1, south: 52, east: 4.4, west: 4.3 },
    footprint: footprintFromBounds({ north: 52.1, south: 52, east: 4.4, west: 4.3 }),
    navigationMode: 'free', barriers: [] }],
  nodes: [], edges: [], places: [], anchors: [], aps: [] } });
expect(saved.statusCode).toBe(200);
const published = await app.inject({ method: 'POST', url: '/api/admin/publish', headers: { cookie } });
expect(published.statusCode).toBe(200);
expect(published.json()).toMatchObject({ schemaVersion: 2, aps: [], profiles: [], zones: [{ kind: 'outdoor' }] });
expect(published.json().zones[0].image.sha256).toMatch(/^[a-f0-9]{64}$/);
```

In the same file, publish twice and assert `loadVersion(db,'demo',1)` is byte-for-byte unchanged; save a draft with no valid outdoor bounds and assert HTTP 400 with an `errors` array mentioning the boundary, with the draft still readable. In `test/public.test.ts`, assert the manifest/asset public URLs return 200 and digested bytes for the v2 version.
- [ ] **Step 2: Run red**: `npm test -- test/publish.test.ts test/imageless.test.ts test/public.test.ts` from `navmap-backend`; expected failure on old validation or old schema.
- [ ] **Step 3: Implement publish**: branch stored v1 manifest validation by `schemaVersion`, remove AP/survey and indoor/anchor/entrance gates from v2, validate exactly one outdoor zone with valid footprint and bounds, verify every reference and positive explicit edge, retain uploaded-image validation, and generate the existing transparent PNG when no image exists. The v2 manifest assembly must include explicit empty arrays:

```ts
const manifest = {
  schemaVersion: 2 as const, venueId: 'demo', version,
  zones: manifestZones, nodes: draft.nodes, edges: draft.edges,
  places: draft.places, anchors: draft.anchors,
  aps: allowlist, profiles: buildProfiles(scans, allowlist).filter(p =>
    p.scanCount >= 3 && Object.keys(p.medianRssi).length >= 2),
};
```

Preserve the staging-directory write, rename, database transaction, cleanup, asset checksum and public route semantics in `publish.ts`. A legacy indoor draft must retain its portal and nodes in editable draft data; reject publish while its placement-review marker is set or its entrance association is ambiguous, return a named validation failure, and do not alter the saved draft. The existing v1 published snapshot remains available. Keep the current per-version image URLs.
- [ ] **Step 4: Run green**: `npm test` and `npm run typecheck` in `navmap-backend`; expected all backend tests pass after updating v1-only assertions to explicitly test stored v1 manifests. Update `CONTRACT.md` to describe v2 and legacy support. Stage only owned hunks; `git commit -m "feat: publish outdoor-only v2 maps"` in backend.

## Task 4: Web contract, checklist and publish feedback

**Files:** Modify `navmap-web/src/contract.ts`, `src/api.ts`, `src/Organizer.tsx`, `src/graph.ts`, `src/editor/model.ts`, `src/editor/NodeInspector.tsx`, `src/editor/PublishPanel.tsx`; test `navmap-web/test/contract.test.ts`, `test/organizer.test.tsx`, `test/editor-state.test.ts`.

**Interfaces:** Consumes backend Task 3 v2 JSON. Produces `parseManifest(raw): ManifestV1 | ManifestV2`, `parseDraft(raw): DraftV2`, `publicationChecks(draft): {label:string;ok:boolean}[]`; `getDraft/saveDraft/publishVenue` use these parsers. Keep a v1 fixture test. Existing zone drawing can still supply bounds; the v2 payload derives its zero-rotation footprint with a web-local `footprintFromBounds` using the exact backend formula and no client-only scale or rounding, adds outdoor `navigationMode:'free', barriers:[]`, and gives legacy indoor zones `navigationMode:'paths'`. The single legacy-draft adapter must derive outdoor footprints from bounds, preserve images/nodes/places/anchors/APs, migrate ordinary edges to `role:'path'`, migrate only cross-zone outdoor↔indoor edges to `role:'portal'`, and infer `entranceNodeId` (outdoor endpoint) / `entryNodeId` (indoor endpoint) from that portal. Missing or ambiguous legacy pairings keep the indoor zone marked `placementNeedsReview:true`; zone references must point to nodes in the correct zone. V2 draft/manifest schemas require edge roles; the legacy adapter, not the v2 schema, handles role-less v1 edges. Migrate graph editing from the v1 global `entranceNodeId` to v2 indoor-zone `entranceNodeId`/`entryNodeId`, and assign edge roles (`path` within a zone, `portal` across zones). All later indoor editing stays unchanged or is explicitly labelled legacy until phase 2.

- [ ] **Step 1: Write failing web tests**:

```ts
it('accepts the server v2 boundary-only manifest and keeps the v1 fixture', () => {
  expect(parseManifest(demoFixture).schemaVersion).toBe(1);
  const outdoor = { id: 'outdoor', kind: 'outdoor', bounds: { north: 52.1, south: 52, east: 4.4, west: 4.3 },
    footprint: { center: { lat: 52.05, lng: 4.35 }, widthMeters: 6845.89,
      heightMeters: 11132, rotationDegrees: 0 }, navigationMode: 'free', barriers: [],
    image: { url: '/api/assets/1/outdoor.png', sha256: 'a'.repeat(64), bytes: 68 } };
  expect(parseManifest({ schemaVersion: 2, venueId: 'demo', version: 1, zones: [outdoor],
    nodes: [], edges: [], places: [], anchors: [], aps: [], profiles: [] }).zones).toHaveLength(1);
});

it('allows boundary-only publish and does not list APs or indoor width', () => {
  const labels = publicationChecks({ venueId: 'demo', zones: [outdoorDraft],
    nodes: [], edges: [], places: [], anchors: [], aps: [] }).map(c => c.label);
  expect(labels).toEqual(['Outdoor boundary drawn']);
});
```

Define `outdoorDraft` explicitly and add an Organizer mock test: GET/PUT returns v2 draft; POST returns structured `{error:'invalid map', errors:['Outdoor boundary is outside supported range']}`; after clicking Publish, assert the named item appears and draft remains visible. Retain the old save-failure test.

```ts
const outdoorDraft = {
  id: 'outdoor', kind: 'outdoor' as const,
  bounds: { north: 52.1, south: 52, east: 4.4, west: 4.3 },
  footprint: { center: { lat: 52.05, lng: 4.35 }, widthMeters: 6845.89,
    heightMeters: 11132, rotationDegrees: 0 },
  navigationMode: 'free' as const, barriers: [],
};
```
- [ ] **Step 2: Run red**: `npm test -- test/contract.test.ts test/organizer.test.tsx test/editor-state.test.ts` from `navmap-web`; expected v2 parser/checklist failures.
- [ ] **Step 3: Implement** discriminated Zod schemas (leave the v1 schema untouched), normalize legacy draft responses/manifests to valid v2 zone and edge shapes via a single adapter, make `emptyDraft` v2, give new zones their v2 navigation defaults, and add the exact backend-derived footprint on boundary application. Keep indoor `navigationMode:'paths'`, outdoor↔indoor endpoint assignments, and required `path|portal` edge roles consistent with backend. Do not create/upload a fake placeholder image merely to establish an indoor drawing. For publish errors, preserve `errors` from JSON as a typed `PublishValidationError` rather than losing them in `throwForStatus`:

```ts
export class PublishValidationError extends Error {
  constructor(message: string, readonly issues: string[]) { super(message); }
}
// In publishVenue when !res.ok:
if (!res.ok && typeof body === 'object' && body && 'errors' in body &&
    Array.isArray(body.errors)) {
  throw new PublishValidationError(String((body as { error?: string }).error ?? 'Publish failed'),
    body.errors.filter((item): item is string => typeof item === 'string'));
}
```

Display `issues` as a list on the Publish tab and retain the saved draft. If a legacy indoor zone has `placementNeedsReview:true`, show “Review building placement before publishing” and direct the organizer to retain the previous published version until phase 2 is available; the backend blocks v2 publish in the meantime. Remove the manual AP form and AP/QR/width/indoor checks; when no published anchors exist, omit QR cards without showing an error. Make the Publish button usable with only an outdoor rectangle. Do not stage a placeholder upload just to create a zone; the backend already creates the empty image asset.
- [ ] **Step 4: Run green**: `npm test`, `npm run typecheck` and `npm run build` in `navmap-web`; expected PASS. Stage exact web files and owned test hunks; `git commit -m "feat: publish boundary-only maps from web"`.

## Task 5: Web visitor and Android offline empty-map support

**Files:** Modify `navmap-web/src/Visitor.tsx`, `src/MapCanvas.tsx`, `src/route.ts`; test `navmap-web/test/visitor.test.tsx`, `test/route.test.ts`; modify `navmap-mobile/src/contract.ts`, `src/pack.ts`, `src/Root.tsx`, `src/VisitorScreen.tsx`; test `navmap-mobile/__tests__/contract.test.ts`, `__tests__/pack.test.ts`, `__tests__/screens.test.tsx`.

**Interfaces:** Consumes `ManifestV1 | ManifestV2` from Task 4 and the identical v2 shape in Android's local validator. Produces boundary-only visitor view without routable selectors, Android map with its downloaded outdoor transparent image, v2 free-zone direct routing, and `parseManifest` retaining the strict v1 branch. V2 validators require at least one outdoor zone but permit zero or more indoor zones so a retained legacy plan is not rejected; this phase adds no new indoor editing. Preserve old v1 fixture routes. Produce `effectiveEdges(manifest): Edge[]` in `navmap-web/src/route.ts` and `navmap-mobile/src/route.ts`, consumed by each client's `shortestPath` and web `pathLength`.

- [ ] **Step 1: Write failing client tests**:

```ts
// Web: test/visitor.test.tsx
render(<Visitor manifest={boundaryOnlyV2} />);
expect(screen.getByText(/add destinations to enable routes/i)).toBeVisible();
expect(screen.queryByRole('combobox', { name: 'Destination' })).toBeNull();

// Web and Android route tests, using an outdoor v2 zone 100 m wide x 100 m high:
const a = { id: 'a', zoneId: 'outdoor', x: 0, y: 0 };
const b = { id: 'b', zoneId: 'outdoor', x: 1, y: 0 };
const c = { id: 'c', zoneId: 'outdoor', x: 1, y: 1 };
expect(shortestPath({ ...boundaryOnlyV2, nodes: [a, b, c] }, 'a', 'c')).toEqual(['a', 'c']);

// Android: __tests__/contract.test.ts
expect(parseManifest(boundaryOnlyV2).zones).toHaveLength(1);
expect(parseManifest(legacyFixture).schemaVersion).toBe(1);
expect(() => parseManifest({ ...boundaryOnlyV2, schemaVersion: 99 })).toThrow(/newer app/i);
```

Use the same explicit `boundaryOnlyV2` object as Task 4, with no nodes/places/APs/profiles. In `pack.test.ts`, download this v2 manifest with a correct image digest and assert `active.json` points to it; then attempt a v2 image with a mismatched digest and assert the former active pointer is unchanged. In `screens.test.tsx`, render `Root` with the v2 manifest and assert an outdoor-only map, no `room-a` default, and no survey save button when there is no indoor place.
- [ ] **Step 2: Run red**: `npm test -- test/visitor.test.tsx test/route.test.ts` in web, and `npm test -- --runInBand __tests__/contract.test.ts __tests__/pack.test.ts __tests__/screens.test.tsx` in mobile; expected v2 parsing or empty-state failures.
- [ ] **Step 3: Implement** v2 conditional branches without relaxing v1 checks. In both `route.ts` files, generate a direct candidate for each unordered pair of nodes in a v2 free zone, with cost `Math.hypot((a.x-b.x)*zone.footprint.widthMeters,(a.y-b.y)*zone.footprint.heightMeters)`; include `role:'path'` edges for path-mode zones and `role:'portal'` cross-zone edges; keep the v1 authored-edge implementation unchanged. Run Dijkstra against `effectiveEdges(manifest)` and web `pathLength` against the same list; do not draw every implicit edge in `MapCanvas`. For v2 with fewer than two nodes or no places, render the map and suppress route controls. Android v2 validator requires at least one outdoor zone, permits zero or more indoor zones, accepts empty `aps` and `nodes`, and validates v2 footprints/images; v1 still demands its old entrance/APs. In `Root`, initialize `destinationId` from `manifest?.places[0]?.id ?? ''`, update it on manifest changes, and only mount `SurveyScreen` when a real indoor place is selected. In `VisitorScreen`, initialize zone to outdoor when no indoor exists and choose the first indoor by ID only for old v1 manifests; display a helpful no-destinations route state. `pack.ts` iterates `manifest.zones` already: preserve that behavior and the atomic active pointer. Do not rewrite `leafletHtml.ts` embedded Leaflet constants; use the existing outdoor image data URI path for this north-up phase.
- [ ] **Step 4: Run green**: `npm test && npm run typecheck` separately in `navmap-web` and `navmap-mobile` (use the scripts present in each `package.json`); expected PASS. Commit owned web files as `feat: support empty published visitor maps`, then owned mobile files as `feat: open outdoor-only v2 packs offline`.

## Task 6: Cross-repo publish acceptance and release gate

**Files:** Modify `navmap-web/e2e/venue.spec.ts`, `navmap-web/README.md`, `navmap-backend/CONTRACT.md`, `navmap-mobile/README.md`.

**Interfaces:** Consumes Tasks 2–5 and existing Vite proxy/API test server. Produces an end-to-end browser proof and documented deployment order; this phase is not complete solely on unit tests.

- [ ] **Step 1: Add an end-to-end boundary-only case** to `e2e/venue.spec.ts`, preserving the existing surveyed-v1 case:

```ts
test('outdoor boundary publishes with no AP, survey, upload or indoor zone', async ({ page, request }) => {
  await request.post('/api/admin/login', { data: { password: 'browser-test-only' } });
  const draft = { venueId: 'demo', zones: [{ id: 'outdoor', kind: 'outdoor',
    bounds: { north: 52.1, south: 52, east: 4.4, west: 4.3 },
     footprint: { center: { lat: 52.05, lng: 4.35 }, widthMeters: 6845.89,
      heightMeters: 11132, rotationDegrees: 0 }, navigationMode: 'free', barriers: [] }],
    nodes: [], edges: [], places: [], anchors: [], aps: [] };
  expect((await request.put('/api/admin/draft', { data: draft })).ok()).toBe(true);
  await page.goto('/');
  await page.getByLabel('Admin password').fill('browser-test-only');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Published version/ })).toBeVisible();
  await page.goto('/v/demo');
  await expect(page.getByText(/add destinations to enable routes/i)).toBeVisible();
});
```

- [ ] **Step 2: Run E2E red/green** with backend test server started according to `navmap-web/playwright.config.ts`, then `npm run e2e -- e2e/venue.spec.ts` from web. Expected PASS without skips; if the API is absent, start it rather than treating the Playwright skip as success. Also run backend `npm test`, web `npm test && npm run build`, and mobile `npm test -- --runInBand` with their local dependencies installed.
- [ ] **Step 3: Manually inspect** the editor and visitor on an outdoor-only publication, Android download and airplane-mode map render on a real device, an old v1 saved pack, invalid-boundary publish error with draft retained, and a failed v2 checksum leaving the old active pack. Record observed results in each repo's README, including whether mobile v2 is installed before enabling backend v2 publication. Keep source tile attribution visible. Stage only owned docs/tests; commit each repository separately with `test: verify boundary-only publication`.

## Self-review / handoff

Phase 1 includes unblocked free movement within its single outdoor zone. Phase 2 owns entrance-linked multi-indoor geometry, visitor plan selection and rotation; phase 3 owns barriers and the explicit path-only mode; phase 4 owns licensed image capture and attribution; phase 5 owns mobile AP discovery. No AP, survey, indoor width or indoor plan gate remains in phase-1 publication. Before implementation, examine the current dirty working trees and reconcile owned hunks with user work rather than overwriting them.
