# Task 10 — Contextual V5 map-authoring inspector

## Outcome

Implemented the V5 contextual inspector and discriminated tool/selection workflow in `OrganizerV5`. V4 fallback behavior is unchanged; the existing feature-flag route continues to select V5 for enabled legacy maps.

## Skills used

- `using-superpowers`
- `systematic-debugging`
- `verification-before-completion`

## Interfaces and implementation

- `src/editor-v3/tool-state.ts` defines discriminated editor tools, selections, pending gestures, and inspector views.
- `src/editor-v3/inspectors/` contains focused boundary, building/floor, node, path, transition, Places, Publish, and floor-plan settings panels.
- `src/editor-v3/ToolMenu.tsx` supplies accessible Node and Path subtype menus.
- `OrganizerV5.tsx` coordinates context-sensitive inspectors, selection, pending gestures, and tool actions. Geographic and static canvas callbacks report path selection and map interactions.
- `model.ts` provides V5 edit adapters and graph-safe deletion behavior. Incomplete gestures stay outside saved history until committed.
- Added focused tests for inspector/workflow behavior, adapters, guards, and updated routing expectations.

## Verification evidence

- `npm run typecheck` — passed.
- `npm test -- test/contextual-inspector.test.tsx test/editor-v5-guard.test.tsx test/editor-inspector-adapters.test.ts --reporter=dot` — 3 files, 12 tests passed.
- `npm test -- --reporter=dot` — 30 files, 249 tests passed.
- `npm run build` — passed. Vite reported its existing large-chunk advisory.
- Initial `npm run lint` exited successfully with warnings in inspector synchronization effects and one unused test import; these were cleaned up during the review follow-up below.
- `git diff --check` — passed; Git emitted line-ending normalization notices.

## Concerns / follow-up

- Vite continues to report its large-chunk advisory during production build.
- The full suite emits unrelated PDF indexing and unmatched-route console warnings.

## Review follow-up — round 1

- Added `navmap-web/e2e/task10-inspector-real-canvas.spec.ts`. It uses API fixture transport but performs pointer input on the actual Leaflet canvases; it is run in both configured projects (desktop 1280×800 and mobile 390×844).
- Browser walkthroughs cover static Regular node and Regular path creation; paired Stair endpoints across two floors; paired Entrance endpoints across indoor/outdoor frames; subtype-menu arrow navigation, Escape, and focus restoration; selected-node rename/delete/undo; pending gesture across a frame switch and explicit discard; Boundary, Building, Floor plans, Places, and Publish forms; and document horizontal overflow at both sizes. A Geographic Leaflet run separately verifies Entrance endpoint frame selection and geographic Boundary fields.
- Screenshots: `.superpowers/sdd/2026-10-14-map-authoring-redesign/artifacts/task10-round1/` (`static-initial-*`, `static-publish-*`, `geographic-initial-*`, for both viewport sizes).
- Command: `npm run e2e -- e2e/task10-inspector-real-canvas.spec.ts` — 4 tests passed (static + geographic at desktop and 390×844).
- Replaced inspector effect-based resets with keyed form components in Boundary, Building, Node, Path, and Transition inspectors. Removed the unused adapter-test import. `npm run lint` now exits cleanly without warnings.
- Full web checks after these production changes: `npm run typecheck` passed; `npm run lint` passed without warnings; `npm test -- --reporter=dot` passed (30 files, 249 tests); `npm run build` passed (Vite still emits the large-chunk advisory).
- No Task 11 abstraction was introduced. The browser run exposed no production defect; an initial test attempt used entrance endpoints in the wrong indoor/outdoor order, then the walkthrough was corrected to follow the inspector’s labeled landing order.
