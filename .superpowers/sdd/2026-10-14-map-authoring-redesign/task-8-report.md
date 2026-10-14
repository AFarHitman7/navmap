# Task 8 implementation report

## Result

Added persistent named-map management and guarded map switching for V4 and V5 editors. New-map requests carry `canvasKind` through the existing venue-creation endpoint so the server atomically initializes a matching V5 draft; old requests without that field still create V4 drafts. V5 creation is capability-gated both in the UI and API.

## Interfaces and behavior

- `api-v3.ts`: `VenueSummary`, `listMaps(signal?)`, `createMap(name, kind)`, `renameMap(id, name)`, and raw `getDraftVersion(id)`; all storage and routes continue to use venue IDs.
- `maps/MapPicker.tsx` and `maps/NewMapDialog.tsx`: abortable named map listing, retry/error handling, stable-ID selection, capability-aware creation, and rename without changing identity. The global picker remains available from both editor routes; demo remains in the options and `/` still opens demo.
- `App.tsx`: dispatches using the raw stored schema and the capability result. A V4 draft stays on the legacy editor when V5 writes are disabled; V4 can route through V5 normalization only when enabled; V5 is never sent to V4 and remains readable if capability lookup fails.
- Both editors use router blocking for dirty drafts and unfinished gestures. Save proceeds only after a successful save; failures retain the active document/history. Discard and Cancel remain explicit. Gesture state must be finished/cancelled before Save.
- Backend creation validates optional `canvasKind`, applies the existing global capability, and reuses the existing atomic V4/V5 venue storage path.

## Tests and verification

- `navmap-web`: `npm test -- --run` — 26 files, 227 tests passed.
- `navmap-web`: `npm run typecheck`, `npm run lint`, `npm run build` — passed. Build retains existing Vite large-chunk advisories (683.74 kB app chunk; 1,103.94 kB PDF worker).
- `navmap-web`: `npx playwright test e2e/static-v5-canvas.spec.ts` — desktop and mobile passed (2 tests).
- `navmap-backend`: `npm test -- --run` — 13 files, 118 tests passed; includes enabled/disabled creation, static/geographic map isolation, rename ID stability, and default legacy V4 creation.
- `navmap-backend`: `npm run typecheck`, `npm run build` — passed. No backend lint script exists.
- `git diff --check` — passed.

## TDD and limitations

Focused picker/API/backend tests pass, but RED evidence was not preserved: the initial production edits preceded their tests, so this continuation does not claim a fully verified red-green cycle. One full-web run initially exposed the existing V5 route test relying on the old `getDraftV5` dispatch; after adapting it to mock raw schema/capability/list APIs, the full suite passed. Browser switching with a real authenticated backend was not exercised; browser verification covered the existing static V5 canvas flow only.

## Skills

Used: `using-superpowers` (dispatched-worker exception), `executing-plans`, `using-git-worktrees` (verified existing feature worktree), `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review` (controller protocol forbids dispatching reviewers), `frontend-design`, `ui-design`, `anti-ui-slop`, `better-typography`, `vercel-react-best-practices`, `webapp-testing`, and `code-security-auditor` (reviewed only relevant server/API boundary; no new dependency or file/URL handling added).

`receiving-code-review` was not applicable because no review feedback was received; reviewer dispatch is controller-owned. No external UI reference service result is claimed.

## Concerns

- Map listing uses the existing admin-authenticated venues endpoint; unauthenticated access produces a visible retry state. Existing global organizer authentication remains responsible for access.
- No delete/duplicate operation was added.
