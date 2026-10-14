# Task 7 implementation report

## Result

Implemented V5 geographic/static canvas routing while retaining the existing V4 editor, plus native offline static-map rendering and survey support. Static coordinates are top-left normalized local positions, static editing requires an explicitly selected assigned frame, and static paths do not use GPS or map tiles.

## Interfaces and files

- Web: `CanvasHost` selects geographic or CRS.Simple rendering; static image overlays use the frame's source dimensions and normalized coordinate conversion. `OrganizerV5` routes V5 edits and importer/history actions; `App.tsx` dispatches by document version while preserving V4.
- Mobile: pack adapters provide byte fetch/read/write/hash operations. Referenced PNGs are staged and verified before activation; failures preserve the active pack. Static WebView output embeds only the active bounded PNG as a data URI. Visitor and survey screens render local positions and do not invoke GPS classification for static maps.
- Added web routing/static canvas tests and browser coverage; added mobile pack rollback/integrity and static survey/no-GPS tests. Updated existing V3/V5 pack tests for the byte adapter.

## Verification evidence

- `navmap-web`: `npm test` — 24 files, 225 tests passed.
- `navmap-web`: `npm run typecheck` — passed.
- `navmap-web`: `npm run lint` — passed.
- `navmap-web`: `npm run build` — passed. Existing Vite warning remains: main JS chunk is 678.69 kB (500 kB advisory threshold); PDF worker is 1,103.94 kB.
- `navmap-web`: `npx playwright test e2e/static-v5-canvas.spec.ts` — desktop and mobile browser projects passed (2 tests), including PNG load and local node placement without tile/GPS requests.
- `navmap-mobile`: `npm test -- --runInBand` — 19 suites, 104 tests passed.
- `navmap-mobile`: `npm run typecheck` — passed.
- `git diff --check` — passed. Git emitted only line-ending conversion notices for modified files.

The implementation checkpoint records that the browser test exposed a canvas lifecycle issue and that it was fixed before the current passing run. Historical red-run output was not retained in this continuation, so no precise RED command/result is claimed here.

## Skills and limitations

- Invoked in this continuation: `using-superpowers`, `verification-before-completion`.
- External UI-reference integration was unavailable; no external screen research is claimed.
- Mobile Jest output includes existing `react-test-renderer` deprecation warnings. No backend files changed; backend regressions were not rerun.
- Deployment still requires compatible web/backend/mobile readers before enabling V5 authoring, as required by the global rollout constraint.
