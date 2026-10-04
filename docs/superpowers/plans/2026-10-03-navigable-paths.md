# Navigable Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline execution, or superpowers:subagent-driven-development if the user chooses delegated execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw and delete bent, intersecting paths with surveyable Wi-Fi reference points and explicit staircase transitions.

**Architecture:** Store route grouping over the existing nodes and edges. A pure web graph module generates sample nodes and shared junctions; backend publication validates and preserves grouping, and mobile surveying and positioning consume the same nodes. Keep schema version 4 with optional additive metadata so existing maps continue to parse in the updated clients.

**Tech Stack:** TypeScript, React, Leaflet, Zod, Fastify, SQLite, React Native, Vitest, Jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-03-navigable-paths-design.md`

## Global Constraints

- Reference-point spacing defaults to 3 metres through a named code constant, not a user-facing setting.
- Preserve endpoints, corners, and junctions even when they are closer than that spacing.
- Each point has an integer floor and a zone; do not interpolate fractional floors.
- Stairs connect explicit landings within one building; overlapping geometry on different floors does not connect.
- Do not invent or interpolate Wi-Fi fingerprints from drawing geometry.
- Never delete manually placed nodes as a side effect of path deletion.
- Generated node identities must not be reused after deletion.
- Cancel and rejected edits must leave the graph unchanged.
- Preserve the current editor layout, save/publish behavior, and revision-based survey invalidation.
- No new dependencies or unrelated refactors. Existing entrance/elevator behavior remains supported.
- The root directory is not a Git repository. Before execution inspect each nested repository's status; never stage or commit unrelated user work. Commits below are optional checkpoints, not authorization to commit user changes.

## File responsibilities

- `navmap-web/src/contract-v3.ts`, `navmap-backend/src/draft.ts`, `navmap-mobile/src/contract-v3.ts`: matching additive path and generated-point contracts.
- `navmap-web/src/editor-v3/path-geometry.ts`: segment subdivision and geometric intersection calculations only.
- `navmap-web/src/editor-v3/paths.ts`: immutable path graph creation, intersection splitting, removal, and legacy disconnection.
- `navmap-web/src/editor-v3/model.ts`: existing node operations coordinated with grouped paths.
- `navmap-backend/src/path-validation.ts`: grouping-to-graph consistency checks used by publication.
- `navmap-backend/src/validate-v3.ts`, `navmap-backend/src/publish-v3.ts`: invoke validation and preserve grouping in published manifests.
- `navmap-web/src/editor-v3/PathControls.tsx`: drawing controls and selected-path details, kept out of the already large organizer component.
- `navmap-web/src/OrganizerV3.tsx`: draft state, pending pen vertices, floor selection, and committing path edits.
- `navmap-web/src/MapCanvasV3.tsx`: interactive path selection, in-progress polylines, and floor-aware rendering.
- `navmap-mobile/src/path-survey.ts`, `navmap-mobile/src/SurveyScreen.tsx`: ordered survey labels and point selection.
- Existing web/mobile route and positioning modules: retain their algorithms, add integration tests using generated nodes.

### Task 1: Add backward-compatible path contracts

**Files:**
- Modify: `navmap-web/src/contract-v3.ts`
- Modify: `navmap-backend/src/draft.ts`
- Modify: `navmap-mobile/src/contract-v3.ts`
- Test: `navmap-web/test/contract-v3.test.ts`
- Test: `navmap-backend/test/contract-v3.test.ts`
- Test: `navmap-mobile/__tests__/contract-v3.test.ts`

**Interfaces:** All three contracts expose `PathV3 = { id: string; name: string; nodeIds: string[] }`. Add `paths?: PathV3[]` to drafts/manifests and `generated?: boolean` to nodes. Omission remains omission, not an inserted default; callers use `draft.paths ?? []`. All new objects remain strict and path node sequences require at least two nonempty IDs.

- [ ] Write a failing test in each contract suite, using its existing valid fixture and parser imports:

```ts
const grouped = {
  ...fixture,
  nodes: fixture.nodes.map((n, i) => i === 0 ? { ...n, generated: true } : n),
  paths: [{ id: 'route-1', name: 'Corridor', nodeIds: fixture.nodes.slice(0, 2).map(n => n.id) }],
};
expect(parseDraftV3(grouped).paths).toEqual(grouped.paths);
expect(parseDraftV3(fixture).paths).toBeUndefined();
expect(() => parseDraftV3({ ...grouped, paths: [{ id: 'x', name: 'X', nodeIds: ['one'] }] })).toThrow();
```

Use a two-node local fixture if the existing fixture has fewer nodes; its coordinates do not need semantic publication validation. Also test nonboolean `generated`, malformed sequences, unknown path keys, and manifest parsing.

- [ ] Run `npm test -- test/contract-v3.test.ts` in web/backend and `npm test -- --runInBand __tests__/contract-v3.test.ts` in mobile; confirm the new metadata is rejected before implementation.
- [ ] Add the web/backend schema fields and exported type:

```ts
const pathV3Schema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nodeIds: z.array(z.string().min(1)).min(2),
}).strict();
// Node object field: generated: z.boolean().optional()
// Draft and manifest object field: paths: z.array(pathV3Schema).optional()
export type PathV3 = z.infer<typeof pathV3Schema>;
```

In mobile add `paths` and `generated` to strict allowed-key lists; check array length and every string; parse optional metadata only when present. This must not introduce Zod or Node APIs to Hermes.

- [ ] Re-run focused contract suites and each project's `npm run typecheck`.
- [ ] Checkpoint only these changed contract files and tests in their respective repositories if commits are desired.

### Task 2: Generate points and calculate intersections

**Files:**
- Create: `navmap-web/src/editor-v3/path-geometry.ts`
- Create: `navmap-web/test/path-geometry.test.ts`

**Interfaces:**

```ts
export const PATH_POINT_SPACING_METERS = 3;
export type GeoPoint = { lat: number; lng: number };
export type SegmentIntersection =
  | { kind: 'point'; point: GeoPoint; aFraction: number; bFraction: number }
  | { kind: 'overlap' }
  | null;
export function subdivideSegment(a: GeoPoint, b: GeoPoint): GeoPoint[];
export function intersectSegments(a: GeoPoint, b: GeoPoint, c: GeoPoint, d: GeoPoint): SegmentIntersection;
```

- [ ] Write failing tests for spacing and crossings:

```ts
import { expect, it } from 'vitest';
import { distanceMeters } from '../src/geo-v3';
import { subdivideSegment, intersectSegments } from '../src/editor-v3/path-geometry';
it('retains exact endpoints and limits reference gaps to 3 metres', () => {
  const a = { lat: 13.05, lng: 80.25 };
  const b = { lat: 13.0501, lng: 80.25 };
  const points = subdivideSegment(a, b);
  expect(points[0]).toEqual(a);
  expect(points.at(-1)).toEqual(b);
  for (let i = 1; i < points.length; i++) {
    expect(distanceMeters(points[i-1]!.lat, points[i-1]!.lng, points[i]!.lat, points[i]!.lng)).toBeLessThanOrEqual(3.001);
  }
});
it('finds crossing and endpoint joins, but identifies positive-length overlap', () => {
  const p = (lat: number, lng: number) => ({ lat, lng });
  expect(intersectSegments(p(0, 0), p(0, 2), p(-1, 1), p(1, 1))).toMatchObject({ kind: 'point', point: p(0, 1) });
  expect(intersectSegments(p(0, 0), p(0, 2), p(0, 1), p(1, 1))).toMatchObject({ kind: 'point' });
  expect(intersectSegments(p(0, 0), p(0, 2), p(0, 1), p(0, 3))).toEqual({ kind: 'overlap' });
});
```

Also test parallel disjoint lines, coincident endpoints, zero-length segments, and numerical tolerance near an endpoint.

- [ ] Run `npm test -- test/path-geometry.test.ts` in web and confirm failure.
- [ ] Implement subdivision using the existing haversine length and `Math.ceil(length / PATH_POINT_SPACING_METERS)`. Return interpolated interior coordinates between exact endpoints. Reject nonfinite or zero-length input before subdivision. For intersections use cross products in a local longitude/latitude plane, clamp fractions within tolerance to `[0,1]`, and explicitly classify collinear projected interval overlap. Geographic equality tolerance should correspond to at most 1 centimetre, not visible pixel distance.

```ts
const steps = Math.ceil(distanceMeters(a.lat, a.lng, b.lat, b.lng) / PATH_POINT_SPACING_METERS);
const points = Array.from({ length: steps + 1 }, (_, i) => ({
  lat: a.lat + (b.lat - a.lat) * i / steps,
  lng: a.lng + (b.lng - a.lng) * i / steps,
}));
points[0] = a;
points[steps] = b;
```

- [ ] Re-run geometry tests and `npm run typecheck`.
- [ ] Checkpoint the two geometry files independently.

### Task 3: Build grouped paths over the existing graph

**Files:**
- Create: `navmap-web/src/editor-v3/paths.ts`
- Modify: `navmap-web/src/editor-v3/model.ts`
- Create: `navmap-web/test/paths.test.ts`
- Modify: `navmap-web/test/editor-v3-model.test.ts`

**Interfaces:**

```ts
export type PathVertex = {
  lat: number; lng: number; zoneId: string | null; z: number;
  nodeId?: string;
  // Incoming connection from previous vertex. Cross-floor links require 'stairs'.
  incomingKind?: 'path' | 'stairs';
};
export function addDrawnPath(draft: DraftV3, vertices: PathVertex[], name?: string): DraftV3;
export function removeDrawnPath(draft: DraftV3, pathId: string): DraftV3;
export function deleteConnection(draft: DraftV3, from: string, to: string): DraftV3;
export function movePathNode(draft: DraftV3, id: string, location: {
  lat: number; lng: number; zoneId: string | null; z: number;
}): DraftV3;
```

`addDrawnPath` consumes Task 2 geometry and Task 1 contracts. Generate route and generated-node IDs with `crypto.randomUUID()` so deletion never permits sample identity reuse. Keep deterministic IDs for existing manual `addNodeAt` behavior.

- [ ] Write failing graph tests with this complete small fixture helper:

```ts
import { expect, it } from 'vitest';
import { emptyDraftV3 } from '../src/editor-v3/model';
import { addDrawnPath, removeDrawnPath } from '../src/editor-v3/paths';
import type { PathVertex } from '../src/editor-v3/paths';
const base = () => ({
  ...emptyDraftV3(), boundary: { south: 13, north: 13.1, west: 80.2, east: 80.3 },
  indoorZones: [{ id: 'b-a', name: 'A', bounds: { south: 13.02, north: 13.08, west: 80.22, east: 80.28 },
    floors: [{ z: 0, label: 'Ground' }, { z: 1, label: 'Upper' }] }],
});
const vertex = (lat: number, lng: number, z = 0): PathVertex => ({ lat, lng, z, zoneId: 'b-a' });
it('retains a bend and deletes a grouped path', () => {
  const d = addDrawnPath(base(), [vertex(13.05, 80.25), vertex(13.0501, 80.25), vertex(13.0501, 80.2501)]);
  expect(d.nodes.some(n => n.lat === 13.0501 && n.lng === 80.25)).toBe(true);
  expect(d.paths).toHaveLength(1);
  const removed = removeDrawnPath(d, d.paths![0]!.id);
  expect(removed.edges).toEqual([]);
  expect(removed.nodes).toEqual([]);
});
it('shares a same-floor crossing without moving existing samples', () => {
  const first = addDrawnPath(base(), [vertex(13.05, 80.2499), vertex(13.05, 80.2501)]);
  const second = addDrawnPath(first, [vertex(13.0499, 80.25), vertex(13.0501, 80.25)]);
  const shared = second.paths![0]!.nodeIds.filter(id => second.paths![1]!.nodeIds.includes(id));
  expect(shared).toHaveLength(1);
  for (const n of first.nodes) expect(second.nodes.find(x => x.id === n.id)).toEqual(n);
  const removed = removeDrawnPath(second, second.paths![1]!.id);
  expect(removed.nodes.some(n => n.id === shared[0])).toBe(true);
});
```

Add tests for endpoint-on-segment joins, crossings with legacy path edges, different-floor/zone isolation, duplicate consecutive vertices, self-crossings, overlapping-segment rejection, manual endpoints surviving deletion, anchor/place references surviving deletion, unique recreated IDs, explicit stairs at coincident coordinates, and rejection of implicit cross-floor links. Verify the input draft is untouched on every thrown error.

- [ ] Run `npm test -- test/paths.test.ts test/editor-v3-model.test.ts` and confirm the new graph tests fail.
- [ ] Implement immutable creation in phases: validate all vertices; produce ordinary floor-local subdivisions and unsampled explicit stairs edges; detect intersections against existing ordinary edges and other new ordinary segments; reuse an existing colocated same-zone/same-floor node or allocate a generated node; sort split points by segment fraction; update every affected stored path sequence; rebuild affected edge chains with actual geographic lengths. Include legacy edges in intersection splitting without converting them to owned route metadata. Skip shared endpoints; reject positive-length overlaps and zero-length ordinary edges. Never intersect stairs/entrance/elevator edges geometrically.

Use the following ownership rule for deletion rather than storing duplicate edge ownership fields:

```ts
const edgeKey = (from: string, to: string) => JSON.stringify([from, to].sort());
const routeKeys = (nodeIds: string[]) => nodeIds.slice(1).map((to, i) => edgeKey(nodeIds[i]!, to));
const remainingKeys = new Set(remainingPaths.flatMap(p => routeKeys(p.nodeIds)));
const deletedKeys = new Set(routeKeys(deletedPath.nodeIds));
const edges = draft.edges.filter(e => !deletedKeys.has(edgeKey(e.from, e.to)) || remainingKeys.has(edgeKey(e.from, e.to)));
const referenced = new Set([
  ...remainingPaths.flatMap(p => p.nodeIds), ...edges.flatMap(e => [e.from, e.to]),
  ...draft.places.map(p => p.nodeId), ...draft.anchors.map(a => a.nodeId),
]);
const nodes = draft.nodes.filter(n => !n.generated || referenced.has(n.id));
```

For `deleteConnection`, if the connection belongs to a grouped route delete that whole route through `removeDrawnPath`; otherwise remove only the legacy edge. Avoid leaving a path sequence pointing at a removed edge.

For grouped point moves, replace the location, increment that point's revision once, revalidate its incident connection kinds, and regenerate its adjacent ordinary segment interiors through the same intersection pipeline. Preserve unchanged node IDs/revisions, manual points, shared junctions, and unrelated segments. Wire `moveNode`, `updateNodeLocation`, and `setNodeFloor` into this behavior only for grouped points. Reject moving a shared junction if it would break another route rather than silently detaching it. Reject deleting a still-grouped node with an instruction to delete its path first. Existing unrelated model behavior must remain unchanged.

- [ ] Re-run focused tests, existing editor/route tests, and `npm run typecheck`.
- [ ] Checkpoint graph/model files and their tests.

### Task 4: Validate and publish grouped paths

**Files:**
- Create: `navmap-backend/src/path-validation.ts`
- Modify: `navmap-backend/src/validate-v3.ts`
- Modify: `navmap-backend/src/publish-v3.ts`
- Modify: `navmap-backend/test/publish-v3.test.ts`
- Modify: `navmap-backend/test/draft-v3-api.test.ts`

**Interfaces:** `validatePathGroups(draft: DraftV3): string[]`; `validatePublishV3` appends its errors. `publishV3` includes optional `paths` only when present in the draft. Task 1 parsers remain authoritative for shapes.

- [ ] Add this failing consistency test using the existing `base()` fixture:

```ts
it('rejects grouped routes with missing graph connections', () => {
  const d = { ...base(), nodes: [
    { id: 'a', name: 'A', lat: 13.05, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1 },
    { id: 'b', name: 'B', lat: 13.05001, lng: 80.25, z: 0, zoneId: 'b-a', fingerprintRevision: 1, generated: true },
  ], paths: [{ id: 'corridor', name: 'Corridor', nodeIds: ['a', 'b'] }] };
  expect(validatePublishV3(d).join(';')).toMatch(/corridor.*connection/);
  expect(validatePublishV3({ ...d, edges: [{ from: 'a', to: 'b', meters: 1.12, kind: 'path' }] })).toEqual([]);
});
```

Add cases for duplicate path IDs, unknown node IDs, consecutive identical IDs, missing sequence edges, and explicit stairs sequences. Extend the existing SQLite publication test to set a two-node `paths` entry and one connecting edge, attach scans to a generated point, and assert both metadata and its current-revision profile survive publishing. Add API save/load round-trip coverage.

- [ ] Run `npm test -- test/publish-v3.test.ts test/draft-v3-api.test.ts` in backend; confirm new semantic/publication assertions fail.
- [ ] Implement path validation using node and unordered edge-key maps. Reject duplicate path IDs and missing sequence references/connections, but allow a nonconsecutive repeated node for a valid loop. Existing edge-kind validation enforces stairs rules. Preserve optional grouping:

```ts
// Within the manifest object in publishV3:
...(draft.paths !== undefined ? { paths: draft.paths } : {}),
// In validatePublishV3 after existing edge checks:
errors.push(...validatePathGroups(draft));
```

Profiles remain built from actual current-revision node samples; never synthesize profiles for unscanned points.

- [ ] Run focused tests, full backend `npm test`, `npm run typecheck`, and `npm run build`.
- [ ] Checkpoint backend validation/publication changes and tests.

### Task 5: Expose pen drawing, stairs, selection, and deletion

**Files:**
- Create: `navmap-web/src/editor-v3/PathControls.tsx`
- Modify: `navmap-web/src/OrganizerV3.tsx`
- Modify: `navmap-web/src/MapCanvasV3.tsx`
- Modify: `navmap-web/test/organizer-v3.test.tsx`
- Modify: `navmap-web/test/map-canvas-v3.test.tsx`
- Create: `navmap-web/e2e/navigable-paths.spec.ts`

**Interfaces:** Extend `MapV3Mode` with `'draw-path'`; add `pathPreview?: PathVertex[]`, `selectedPathId?: string`, `onPathClick?: (id: string) => void`, and `onEdgeClick?: (from: string, to: string) => void` to map props. `PathControls` receives pending vertices, selected path/connection, busy state, and callback props; it does not mutate drafts.

- [ ] Extend the organizer's mocked map with two distinct corner buttons, node click buttons, and a path selection button. Add failing interaction tests based on the existing fetch and render helpers:

```ts
await user.click(await screen.findByRole('button', { name: 'Draw path' }));
await user.click(screen.getByRole('button', { name: 'Mock path start' }));
await user.click(screen.getByRole('button', { name: 'Mock path corner' }));
await user.click(screen.getByRole('button', { name: 'Mock path end' }));
await user.click(screen.getByRole('button', { name: 'Finish path' }));
await user.click(screen.getByRole('button', { name: 'Mock select path' }));
expect(screen.getByRole('button', { name: 'Delete path' })).toBeEnabled();
await user.click(screen.getByRole('button', { name: 'Delete path' }));
```

Assert the next saved request contains the route after finishing and no route after deletion; destination nodes must remain. Add Cancel/Escape tests asserting no graph changes. Add a staircase test that selects a ground landing, switches Placement floor, explicitly arms a stairs link, selects an upper landing, adds an upper-floor segment, and finishes. Assert the saved edge kinds include exactly the intended stairs transition. Existing Floor visibility controls must not change Placement floor implicitly.

- [ ] Run organizer/map tests and confirm missing controls fail.
- [ ] Implement local pending-vertex state; no draft writes until `Finish path` calls `addDrawnPath`. Map clicks append floor-local vertices; marker clicks append existing nodes. For stairs expose an explicit `Link next landing as stairs` control; a floor change alone must never create a transition. Require a different-floor landing in the same building, label its transition, and then resume ordinary drawing. Expose `Finish path` (disabled below two vertices), `Cancel path`, selected-route point count, and `Delete path`. Keep legacy connection selection/deletion available and add explicit kind selection to the existing Connect flow for stairs/elevator links.

```tsx
<button type="button" disabled={busy || vertices.length < 2} onClick={onFinish}>Finish path</button>
<button type="button" disabled={busy} onClick={onCancel}>Cancel path</button>
<button type="button" disabled={busy || !selectedPath} onClick={onDelete}>Delete path</button>
```

Map implementation: allow delayed point-click dispatch for `draw-path` as well as `add-nodes`; let building rectangles bubble clicks in drawing mode without resetting the placement floor. Render preview floor-local stretches with dashed lines and noninteractive vertices; render stairs as distinct transitions. Make graph edges selectable, stop their events from adding pen vertices, and highlight all edges belonging to a selected route. Generated points use smaller markers than destinations. Where only one stair landing is visible, render a labeled floor-transition indicator at that landing instead of hiding the link entirely. Keep visitor route stretches broken at floor transitions.

- [ ] Run focused component tests and `npm run typecheck`. Write the browser test by reusing existing intercepted draft requests and Leaflet coordinate-click helpers from `e2e/unified-map.spec.ts`; verify a bent saved route, same-floor junction, different-floor isolation, cancellation, and selected-route deletion.
- [ ] Run `npm run e2e -- e2e/navigable-paths.spec.ts` and inspect a screenshot at desktop and narrow widths. Controls must remain operable without horizontal overflow; tile failures must not block edits.
- [ ] Checkpoint editor/map changes and tests.

### Task 6: Survey path points and verify navigation

**Files:**
- Create: `navmap-mobile/src/path-survey.ts`
- Modify: `navmap-mobile/src/SurveyScreen.tsx`
- Modify: `navmap-mobile/__tests__/survey-v3.test.tsx`
- Modify: `navmap-mobile/__tests__/positioning-v3.test.ts`
- Modify: `navmap-mobile/__tests__/route-v3.test.ts`
- Modify: `navmap-web/test/route-v3.test.ts`

**Interfaces:**

```ts
export type PathPointLabel = { pathId: string; pathName: string; index: number; total: number };
export function pathPointLabels(map: Pick<DraftV3, 'paths'>, nodeId: string): PathPointLabel[];
```

Indices are one-based, include landings, and a shared junction can have labels for multiple paths. Existing node survey IDs, uploads, fresh-scan rules, and revisions stay compatible.

- [ ] Add a generated-node survey test to the current React Native suite: attach `paths` to its existing draft, mark `n-l1` as generated, select building/floor/node, and assert the confirmation includes `Corridor · Point 2 of 2` plus the correct floor. Verify Save posts scans using `n-l1` and revision 7, not a path ID. Test a shared-junction confirmation showing both memberships.
- [ ] Add this helper test:

```ts
expect(pathPointLabels({ paths: [{ id: 'p', name: 'Corridor', nodeIds: ['a', 'b'] }] }, 'b'))
  .toEqual([{ pathId: 'p', pathName: 'Corridor', index: 2, total: 2 }]);
expect(pathPointLabels({}, 'b')).toEqual([]);
```

Add a three-profile Wi-Fi matching test whose closest viable profile belongs to a generated reference point. Build a manifest with a bend, shared junction, and explicit stairs edge; assert `shortestPathV3` can start at the matched generated point, turn at the junction, and reach an upper-floor destination. Assert the same coordinates on another floor without a stairs edge are unreachable. Use existing route-test manifest builders rather than changes to the routing algorithms.

- [ ] Run `npm test -- --runInBand __tests__/survey-v3.test.tsx __tests__/positioning-v3.test.ts __tests__/route-v3.test.ts` in mobile and confirm new survey label assertions fail.
- [ ] Implement pure membership labels and show them next to node names and in the confirmation. Keep zone/floor filters and existing test IDs. Use path sequence order when displaying generated points, without hiding manual nodes or duplicating shared-node buttons. Add a selected node's coordinate text to make physical survey placement unambiguous.

```ts
export function pathPointLabels(map: Pick<DraftV3, 'paths'>, nodeId: string): PathPointLabel[] {
  return (map.paths ?? []).flatMap(path => {
    const index = path.nodeIds.indexOf(nodeId);
    return index < 0 ? [] : [{ pathId: path.id, pathName: path.name, index: index + 1, total: path.nodeIds.length }];
  });
}
```

- [ ] Re-run focused mobile tests, web route tests, full mobile `npm test -- --runInBand`, and mobile `npm run typecheck`.
- [ ] Checkpoint mobile survey/helper changes and route/positioning tests.

### Task 7: Final regression and documentation

**Files:**
- Modify: `navmap-backend/CONTRACT.md`
- Modify: `navmap-web/README.md`
- Modify: `navmap-mobile/README.md`
- Update: this plan's completion checkboxes only after verified execution.

**Interfaces:** No new runtime API; document the Task 1 shapes and the Task 5/6 workflows.

- [x] Run full backend `npm test`, `npm run typecheck`, and `npm run build` independently.
- [x] Run full web `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run e2e` independently.
- [x] Run full mobile `npm test -- --runInBand` and `npm run typecheck` independently. Do not claim Android device Wi-Fi accuracy from mocked tests; report physical-device surveying as unverified unless actually exercised.
- [x] Document these concrete additions: optional `paths: [{ id, name, nodeIds }]`, optional node `generated`, 3-metre code constant, pen Finish/Cancel controls, same-floor junctions, explicit staircase landings, route deletion semantics, and physical scanning at each point. Explain that old clients with strict parsers require an update to read manifests containing new metadata.
- [x] Review diffs in all three nested repositories and root documentation. Confirm no fixture/data reset, survey deletion, unrelated user changes, new user spacing control, or silently inferred cross-floor connection slipped in.
- [x] Report passed verification commands, any blocked tests, and physical-device limitations. Do not claim completion without fresh command results.

## Plan self-review

Spec coverage: drawing/preview/cancellation and stairs controls are in Task 5; spacing/geometry in Task 2; identity, intersections, moves and deletion in Task 3; contract compatibility in Task 1; publication and profile lifecycle in Task 4; ordered physical survey and navigation integration in Task 6; regression and operator documentation in Task 7.

Type consistency: all route grouping uses `PathV3.nodeIds`; point ownership uses `NodeV3.generated`; incoming connection kinds use existing graph edge kinds without fractional-floor nodes. Paths are optional in all three consumers. Geometry functions never decide zone/floor membership; the graph module does.
