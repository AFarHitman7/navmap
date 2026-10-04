# Unified Map v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace separate outdoor/indoor maps with one OSM geographic map per venue (boundary + multiple indoor rectangles + floor-aware nodes).

**Architecture:** Geographic v3 model (lat/lng+z) with legacy v1/v2 adapters; one Leaflet EPSG3857 canvas; GPS classifies zones, Wi-Fi identifies nodes; explicit graph routing with floor-aware edges.

**Tech Stack:** Fastify+Zod+SQLite backend, React+Leaflet web, React Native+WebView mobile, Vitest/Jest/Playwright.

**Spec:** Conversation design 2026-10-02 (boundary > zones > nodes anywhere; GPS zones, Wi-Fi nodes, z floor index). Prior contract: `navmap-backend/CONTRACT.md`.

## Progress (2026-10-02, continued)

- [x] Task 1: v3 contract + fixtures (backend/web/mobile) + web multi-zone draft + web api-v3 client + mobile profile alignment
- [x] Task 2: Geographic utilities (backend/web-pending/mobile)
- [x] Task 3: Migration/store — drafts_v3 + node_samples tables, node surveys w/ revision guard, explicit v2→v3 migration helper/report (automatic migration intentionally not performed)
- [x] Task 4: v3 API + publish validation + mismatch-before-write fix + review fixes
- [x] Task 5: Unified organizer single-canvas UI (editor-v3 model, MapCanvasV3, OrganizerV3 page + /edit-v3 route, guarded boundary redraw)
- [x] Task 6: Node survey UI (mobile venue→zone→floor→node picker and node-sample upload; backend done)
- [x] Task 7: Mobile matchNode + classifyGpsZone + resolveLocation state machine, live clock, manual/QR precedence and Resume auto
- [x] Task 8: Floor-aware explicit-edge routing on web and mobile; matching golden cases
- [x] Task 9: v3 web visitor + mobile visitor renderer and imageless offline packs; legacy v1/v2 paths retained
- [ ] Task 10 (partial): Web E2E suite 16/16, unit/type/build checks; real Android field acceptance and dedicated floors/migration E2E remain

## Global Constraints

- Node 24.15+ LTS; preserve all uncommitted work in navmap-backend (branch `work`), navmap-web/mobile (branch `unified-map-v3`).
- No shared package: copy `unified-v3.json` fixture into each repo when contract changes.
- Published v1/v2 manifests immutable and readable; new publishes use `schemaVersion: 3`.
- North-up rectangles only (`rotationDegrees: 0` rejected otherwise); WGS84 lat/lng; `z` integer floor index (ground 0, up positive, basement negative); outdoor nodes `z: 0`, `zoneId: null`.
- Boundary-only maps publishable without images/surveys; v3 requires no zone images or placeholder PNGs.
- Browser has no Wi-Fi scan API: web visitor must not present Wi-Fi positioning as available.
- TDD mandatory: failing test first, verify red, minimal green, verify green, refactor; verification-before-completion for every claim.
- Never start implementation on main/master (web/mobile now on `unified-map-v3`, backend on `work`).

---

### Task 1: v3 contract + fixtures (all repos)

**Files:**
- Create: `navmap-backend/src/geo-v3.ts`, `navmap-backend/test/contract-v3.test.ts`, `navmap-backend/fixtures/unified-v3.json`
- Modify: `navmap-backend/src/draft.ts`, `navmap-backend/CONTRACT.md`
- Create: `navmap-web/src/contract-v3.ts`, `navmap-web/test/contract-v3.test.ts`, `navmap-web/src/fixtures/unified-v3.json`
- Create: `navmap-mobile/src/contract-v3.ts`, `navmap-mobile/__tests__/contract-v3.test.ts`, `navmap-mobile/src/fixtures/unified-v3.json`

**Interfaces:**
- Consumes: existing v1/v2 zod schemas in each `draft.ts`/`contract.ts`.
- Produces: `parseDraftV3(raw): DraftV3`, `parseManifestV3(raw): ManifestV3`, `isV3Manifest(m): boolean`, fixture `unified-v3.json` (boundary + 2 buildings + stacked nodes + stairs edge).

- [ ] **Step 1: Write the failing backend contract test**

```ts
// navmap-backend/test/contract-v3.test.ts
import { describe, expect, it } from 'vitest';
import { parseDraftV3 } from '../src/draft.js';
describe('v3 draft', () => {
  it('accepts boundary + two indoor zones + stacked nodes', () => {
    const d = parseDraftV3({ schemaVersion: 3, venueId: 'demo', boundary: { north: 13.1, south: 13.0, east: 80.3, west: 80.2 }, indoorZones: [{ id: 'b-a', name: 'A', bounds: { north: 13.08, south: 13.02, east: 80.28, west: 80.22 }, floors: [{ z: 0, label: 'Ground' }, { z: 1, label: 'Level 1' }] }], nodes: [{ id: 'n1', lat: 13.05, lng: 80.25, z: 0, zoneId: null, fingerprintRevision: 1 }], edges: [], places: [], anchors: [], aps: [] });
    expect(d.indoorZones).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- contract-v3` (in `navmap-backend`)
Expected: FAIL with "parseDraftV3 is not defined / not exported"

- [ ] **Step 3: Write minimal v3 zod schemas + parsers in backend**

```ts
// navmap-backend/src/draft.ts (append)
import { z } from 'zod';
export const boundsV3Schema = z.object({ north: z.number(), south: z.number(), east: z.number(), west: z.number() }).strict().refine(b => b.north > b.south && b.east > b.west);
export const draftV3Schema = z.object({ schemaVersion: z.literal(3), venueId: venueIdSchema, boundary: boundsV3Schema.nullable(), indoorZones: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), bounds: boundsV3Schema, floors: z.array(z.object({ z: z.number().int(), label: z.string().min(1) })).min(1) }).strict()), nodes: z.array(z.object({ id: z.string().min(1), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), z: z.number().int(), zoneId: z.string().min(1).nullable(), fingerprintRevision: z.number().int().nonnegative() }).strict()), edges: z.array(z.object({ from: z.string().min(1), to: z.string().min(1), meters: z.number().positive(), kind: z.enum(['path','entrance','stairs','elevator']) }).strict()), places: z.array(placeSchema), anchors: z.array(anchorSchema), aps: z.array(z.string()) }).strict();
export type DraftV3 = z.infer<typeof draftV3Schema>;
export function parseDraftV3(raw: unknown): DraftV3 { return draftV3Schema.parse(raw); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- contract-v3` + `npm run typecheck` (backend)
Expected: PASS, typecheck exit 0

- [ ] **Step 5: Commit**

```bash
git add src/draft.ts test/contract-v3.test.ts fixtures/unified-v3.json CONTRACT.md
git commit -m "feat(v3): add unified geographic contract and fixture"
```

### Task 2: Geographic utilities (all repos)

**Files:**
- Create: `navmap-backend/src/geo-v3.ts`, `navmap-backend/test/geo-v3.test.ts`
- Modify: `navmap-web/src/geo.ts`, `navmap-web/test/bounds.test.ts`
- Create: `navmap-mobile/src/geo.ts`, `navmap-mobile/__tests__/geo-v3.test.ts`

**Interfaces:**
- Consumes: `Bounds { north, south, east, west }` from Task 1.
- Produces: `containsPoint(b, lat, lng): boolean`, `containsBounds(outer, inner): boolean`, `rectsOverlap(a, b): boolean`, `distanceMeters(aLat, aLng, bLat, bLng): number`, `classifyZone(map, lat, lng): string | null | 'ambiguous'`.

- [ ] **Step 1: Write failing geo test**

```ts
// backend test/geo-v3.test.ts
import { describe, expect, it } from 'vitest';
import { containsPoint, distanceMeters } from '../src/geo-v3.js';
describe('geo-v3', () => {
  it('contains interior point but not exterior', () => {
    const b = { north: 13.1, south: 13.0, east: 80.3, west: 80.2 };
    expect(containsPoint(b, 13.05, 80.25)).toBe(true);
    expect(containsPoint(b, 13.2, 80.25)).toBe(false);
  });
  it('measures ~111m per 0.001deg latitude', () => {
    expect(distanceMeters(13.0, 80.25, 13.001, 80.25)).toBeGreaterThan(100);
  });
});
```

- [ ] **Step 2: Run to verify fail** Run: `npm test -- geo-v3` Expected: FAIL missing module
- [ ] **Step 3: Implement haversine + rect ops (rotation 0 only)**
```ts
export function containsPoint(b: Bounds, lat: number, lng: number): boolean { return lat <= b.north && lat >= b.south && lng <= b.east && lng >= b.west; }
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number { const R = 6371000; const dLa = (bLat - aLat) * Math.PI / 180; const dLo = (bLng - aLng) * Math.PI / 180; const s = Math.sin(dLa/2)**2 + Math.cos(aLat*Math.PI/180)*Math.cos(bLat*Math.PI/180)*Math.sin(dLo/2)**2; return 2 * R * Math.asin(Math.sqrt(s)); }
```
- [ ] **Step 4: Run tests + typecheck** Expected: PASS
- [ ] **Step 5: Commit** `git commit -m "feat(v3): add geographic utilities"`

### Task 3: Migration + node-sample persistence (backend)

**Files:**
- Create: `navmap-backend/src/migration-v3.ts`, `navmap-backend/test/migration-v3.test.ts`
- Modify: `navmap-backend/src/db.ts`, `navmap-backend/src/survey.ts`

**Interfaces:**
- Consumes: `DraftV2`, `DraftV3`, `containsPoint`, `footprint` conversion.
- Produces: `migrateDraftToV3(v2draft): { draft: DraftV3; report: string[]; needsReview: boolean }`, `addNodeSamples(db, nodeId, rev, scans)`.

- [ ] **Step 1: Failing migration test** (v2 outdoor node 0.5,0.5 -> lat/lng center; indoor without footprint -> needsReview true)
- [ ] **Step 2: Run fail** `npm test -- migration-v3`
- [ ] **Step 3: Implement conversion + `node_samples` table** (`venue_id, node_id, fingerprint_revision, captured_at, readings_json`, PK all four)
- [ ] **Step 4: Verify** `npm test -- migration-v3 survey` + typecheck
- [ ] **Step 5: Commit**

### Task 4: v3 API + publish validation (backend)

**Files:**
- Modify: `navmap-backend/src/publish.ts`, `navmap-backend/src/routes/venues.ts`, `navmap-backend/src/routes/admin.ts`
- Create: `navmap-backend/test/publish-v3.test.ts`

**Interfaces:**
- Consumes: Task 1-3 parsers/validators.
- Produces: `validatePublishV3(draft): string[]`, endpoints `draft-v3`, `node-samples`, `publish-v3`.

- [ ] **Step 1: Failing publish test** (boundary-only publishes; zone outside boundary blocked; stacked nodes allowed)
- [ ] **Step 2: Run fail**
- [ ] **Step 3: Implement validators** (exactly boundary required at publish; zones inside + no positive-area overlap; node membership matches geometry; edge kinds: path same zone+floor, entrance outdoor->ground, stairs/elevator same building different floor)
- [ ] **Step 4: Verify** full backend `npm test`, typecheck, build
- [ ] **Step 5: Commit**

### Task 5: Unified organizer (web, anti-ui-slop/distill)

**Files:**
- Modify: `navmap-web/src/MapCanvas.tsx`, `navmap-web/src/Organizer.tsx`, `navmap-web/src/graph.ts`, `navmap-web/src/api.ts`, `navmap-web/src/styles.css`
- Create: `navmap-web/src/editor/ZoneInspector.tsx`, `navmap-web/src/editor/FloorSelector.tsx`, `navmap-web/test/unified-map.test.tsx`

**Interfaces:**
- Consumes: `contract-v3.ts` parsers, geo utils.
- Produces: single EPSG3857 canvas; zone list; floor-scoped node creation; atomic zone redraw+reassignment.

- [ ] **Step 1: Failing editor test** (draw boundary then second indoor zone keeps first; node inside zone auto-assigns zoneId; moving node across boundary previews reassignment)
- [ ] **Step 2: Run fail** `npm test -- unified-map`
- [ ] **Step 3: Implement**: remove CRS.Simple branch; render boundary + all zones as Leaflet rectangles on OSM; zone selector by id; floor selector; keep existing toolbar/copy/tokens
- [ ] **Step 4: Verify** `npm test`, typecheck, lint, `npm run e2e` boundary spec
- [ ] **Step 5: Commit**

### Task 6: Node surveys (backend+mobile) — implemented

- [x] **Step 1: Failing test** survey unnamed node `nodeId` (not placeId), revision mismatch 400
- [x] **Step 2: Run fail**
- [x] **Step 3: Implement** `node-samples` endpoints + mobile SurveyScreen node picker (venue>building/outdoors>floor>node)
- [x] **Step 4: Verify** backend + mobile jest
- [ ] **Step 5: Commit** (not committed in this continuation)

### Task 7: Positioning — GPS zones + Wi-Fi nodes (mobile/web) — implemented

**Files:** `navmap-mobile/src/match.ts`, `location.ts`, new `positioning.ts`, `Root.tsx`; `navmap-web/src/geo.ts`, `Visitor.tsx`.

- [x] **Step 1: Failing tests**: GPS never returns node/floor; confident Wi-Fi sets zone+floor with GPS absent; stale fix expires; ambiguous floor rejected
- [x] **Step 2: Run fail**
- [x] **Step 3: Implement** `classifyGpsZone` + node-scoped `matchNode` (min common APs, absolute fit, scoped penalty, deterministic ties) + `resolveLocation` state machine + live `now` clock
- [x] **Step 4: Verify** jest + web vitest
- [ ] **Step 5: Commit** (not committed in this continuation)

### Task 8: Floor-aware routing (web+mobile) — implemented

- [x] **Step 1: Failing golden route tests** (outdoor>entrance>stairs>room; no shortcut through building; stacked nodes disconnected without vertical edge)
- [x] **Step 2: Run fail**
- [x] **Step 3: Implement** edge-kind validation in routing + break polylines at vertical transitions + explicit outdoor paths (no pairwise free-routing through buildings)
- [x] **Step 4: Verify** both repos route tests match
- [ ] **Step 5: Commit** (not committed in this continuation)

### Task 9: Visitor renderer + offline packs (web+mobile) — implemented

- [x] **Step 1: Failing tests** geographic node render; no image assets; corrupt pack keeps active version
- [x] **Step 2: Run fail**
- [x] **Step 3: Implement** OSM visitor with building/floor filter; mobile Leaflet geographic template (regen `leafletHtml.ts` via `npm run preandroid`, never hand-edit); pack v3 without images
- [x] **Step 4: Verify** jest/vitest + `preandroid`; Android assemble/device lane unavailable in this environment
- [ ] **Step 5: Commit** (not committed in this continuation)

### Task 10: E2E, field acceptance, docs

Progress: unified-map and floors browser flows are green on desktop/mobile; full browser suite is 18/18. Web/mobile/backend run notes have been updated. Migration behavior is covered by backend unit tests; no browser/API migration workflow exists to exercise in Playwright. Physical-device GPS/Wi-Fi/QR/manual/offline checks cannot be completed in this environment and remain release acceptance gates.

- [ ] **Step 1: Add** `navmap-web/e2e/unified-map.spec.ts` (boundary>3 zones>stacked nodes>publish>route) + `floors.spec.ts` + `migration-v3.spec.ts`
- [ ] **Step 2: Run fail** (no v3 UI yet on first run)
- [ ] **Step 3: Implement** missing hooks/testids + update READMEs/CONTRACT run notes
- [ ] **Step 4: Verify** `npm run e2e`, field checklist on physical Android (GPS/Wi-Fi/QR/manual/offline, confusion matrix)
- [ ] **Step 5: Commit**
