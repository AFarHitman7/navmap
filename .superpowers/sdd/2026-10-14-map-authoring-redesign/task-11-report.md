# Task 11 report — abstract paths and object browser

## Result

Implemented the Task 11 projection and wired it into both production V5 canvases (`GeographicCanvas` and `StaticCanvas`), the V5 editor, and the legacy V3 editor’s reference-point visibility. No routing, profile, persistence, or location feature code was removed or changed.

## Interfaces and behavior

- `editor-v3/presentation.ts` exports `projectMap(document, view, selection)` and uses the existing `Selection` union from `editor-v3/tool-state.ts`.
- Editor projection hides generated nodes by default while retaining every path’s ordered geometry. Same-frame path stretches produce one polyline; cross-frame paths split at frame boundaries. Authored intermediate controls and endpoints are selectable handles only while their path is selected; generated samples are handles only when explicitly listed in `controlNodeIds`.
- Unowned same-frame path edges retain their legacy edge-click fallback. Clicks on any grouped segment select the owning path. Stair paths are represented by transition landing badges in the relevant frame, not by a line across floors.
- Visitor projection emits visitor-visible nodes only and no lines, handles, or transition badges. Survey projection retains generated references. Reference-point toggles are editor-only and do not alter graph data.
- `ObjectBrowser` is a distinct Nodes/Paths panel with search, human-readable type/floor details, logical transition rows, and no ordinary-list UUID or point-count dump. Point count and ID are under the path inspector’s Advanced details.
- Transition badge labels are HTML-escaped before being passed to Leaflet’s HTML icon API.

## Tests and verification

- RED evidence: the first projection run failed its handle and shared-junction assertions. The implementation was corrected to include authored controls only and the test graph now contains a real shared branch. An initial missing-module import failure also confirmed the new projection module was not yet present.
- Note: the ObjectBrowser UI test was added after its first component draft, so a separate pre-implementation RED run was not captured for that component.
- `cd navmap-web && npm test` — 33 files, 259 tests passed.
- `cd navmap-web && npm run typecheck` — passed.
- `cd navmap-web && npm run lint` — passed without warnings.
- `cd navmap-web && npm run build` — passed. Existing Vite large-chunk advisory remains (PDF worker / app chunks); no dependency changes were made.
- `cd navmap-web && npm run e2e -- e2e/static-v5-canvas.spec.ts` — 4 tests passed across desktop and 390px mobile, including real Leaflet path click, hidden default sample, editor-only reference toggle, and node authoring.
- New geographic/static canvas and projection tests cover generated samples, selected handles, branching/shared geometry, cross-floor split/landings, visitor stripping, and survey references.
- `git diff --check` — passed after all source and report changes (Git only noted configured LF-to-CRLF normalization warnings).

## Files changed

`navmap-web/src/editor-v3/presentation.ts`, `navmap-web/src/ObjectBrowser.tsx`, `navmap-web/src/OrganizerV5.tsx`, `navmap-web/src/OrganizerV3.tsx`, `navmap-web/src/MapCanvasV3.tsx`, `navmap-web/src/map/CanvasHost.tsx`, `navmap-web/src/map/GeographicCanvas.tsx`, `navmap-web/src/map/StaticCanvas.tsx`, `navmap-web/src/editor-v3/inspectors/PathInspector.tsx`, `navmap-web/src/styles.css`; tests in `navmap-web/test/{map-presentation.test.ts,object-browser.test.tsx,geographic-canvas.test.tsx,static-canvas.test.tsx,map-canvas-v3.test.tsx,editor-v5-routing.test.tsx}` and `navmap-web/e2e/static-v5-canvas.spec.ts`.

## Skills and concerns

Invoked the 15 skills listed in `agent-protocol.md`: using-superpowers, executing-plans, using-git-worktrees, test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review, receiving-code-review, frontend-design, ui-design, anti-ui-slop, better-typography, vercel-react-best-practices, webapp-testing, and code-security-auditor. No subagents/reviewers were spawned per protocol. UI work follows the existing V5 editor tokens; no Uizze reference integration was available or needed. Security review was scoped to the newly rendered Leaflet badge HTML and no dependencies were added. Mobile survey/native behavior was not changed, so no mobile suite was run. Full Task 16 release/browser acceptance remains out of scope.

## Fix round 1 — review findings

- Shared path deletion now preserves an undirected graph edge whenever any remaining path still contains that node pair. Added parameterized coverage deleting either owner, strict-parsing the result, and verifying `shortestPathV3` remains unchanged.
- Visitor projection now exposes a transition descriptor only when an endpoint is explicitly `visitorVisible`; visitor canvases place noninteractive badges at an existing visible landing in the active frame. Hidden endpoints are not rendered as graph markers, and visitor lines/handles remain empty. Geographic/static canvas tests cover visible and fully-hidden transition pairs.
- Replaced the Playwright synthetic `dispatchEvent('click')` with `page.mouse.click` at the rendered SVG path’s computed geometric midpoint; both desktop and 390px projects still select the whole path.
- RED/GREEN: new shared-edge tests failed because `removePathV5` removed an edge still referenced by the remaining path; visitor tests failed because visitor projections returned no transitions. All were green after the minimal fixes.
- Final fix-round checks: `npm test` — 33 files / 263 tests passed; `npm run typecheck`, `npm run lint`, `npm run build` passed; `npm run e2e -- e2e/static-v5-canvas.spec.ts` — 4/4 desktop/mobile tests passed. Build continues to emit the existing large-chunk advisory.
