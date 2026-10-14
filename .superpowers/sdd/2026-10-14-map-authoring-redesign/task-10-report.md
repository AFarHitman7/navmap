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
- `npm run lint` — exited successfully with warnings: new inspector state-sync effects trigger `react(set-state-in-effect)` (plus dependency warnings in BoundaryInspector), and `editor-inspector-adapters.test.ts` has one unused import.
- `git diff --check` — passed; Git emitted line-ending normalization notices.
- Browser verification at desktop and 390px was not run.

## Concerns / follow-up

- Review whether inspector form synchronization should be refactored to avoid lint warnings; no lint errors currently block the build.
- Run desktop and 390px browser verification when the local app/browser test environment is available.
- The full suite emits unrelated PDF indexing and unmatched-route console warnings.
