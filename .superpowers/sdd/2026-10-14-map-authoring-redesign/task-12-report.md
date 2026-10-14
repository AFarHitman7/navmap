# Task 12 report — unified authoring parity

## Outcome

- V5 authoring retains only its unified Path and explicit Node subtype tools; no standalone Connect toolbar, connection-kind dropdown, or “Link next landing as stairs” control is present in V5.
- Added node-ID data attributes to both V5 canvases so browser tests can click the real Leaflet markers by stable identity. Existing-node clicks in Regular Path now have real desktop/mobile coverage; a bent path is completed as one history edit.
- V5 pending gestures now handle Escape (discard) and Ctrl/Cmd+Z (remove the last pending point/endpoint) without consuming native input undo. Existing elevator edit/delete, entrance pair completion, stair-path naming, and legacy V4 edge deletion are exercised in browser tests.
- Legacy V4 rollback stays usable: its editor is visibly labelled “LEGACY V4 COMPATIBILITY EDITOR”, and its toolbar action is labelled “Legacy connect”. Legacy inline stairs controls remain confined to that compatibility editor; upgraded V4 maps routed to V5 do not show them. `connectNodes` remains available internally.
- Updated the old point-creation status from “Connect it…” to “Draw a path to it.” No published schema or backend/native files changed.

## RED/GREEN and verification

- RED: new end-to-end test first exposed absent marker IDs; after adding stable `data-node-id` selectors it reached the live path interaction. Separately removed the pending-key handler and reran the focused test: Ctrl+Z failed to remove the pending vertex as expected. Restored the handler; focused test passes.
- `cd navmap-web && npm run e2e -- e2e/unified-tools.spec.ts --project=desktop --project=mobile --reporter=line` — 10/10 passed.
- `cd navmap-web && npm test` — 33 files / 263 tests passed.
- `cd navmap-web && npm test -- test/organizer-v3.test.tsx` — 15/15 passed.
- `cd navmap-web && npm run typecheck`, `npm run lint`, `npm run build` — passed. Build retains the existing >500 kB chunk warning.
- `git diff --check` — passed (Git reports configured LF-to-CRLF normalization warnings).
- Additional Task 10 real-canvas E2E rerun: **4 failed**. Its static marker-count assertions expect a count inconsistent with the rendered fixture (3 rendered vs 4 expected desktop; 2 vs 4 mobile); geographic entrance endpoint click expectation and mobile “Outdoor” locator also fail. These were not changed in Task 12; they are recorded for the controller to triage rather than represented as passing.

## Scope and concerns

- The old V3/V4 rollback editor intentionally still contains its legacy Connect flow, connection-kind control, and inline stairs gesture. Removing those would impair capability-flag-false V4 rollback usability; this is the explicitly labelled compatibility exception, not a claim of repository-wide grep-zero. New and upgraded V5 authoring has no such controls.
- Existing Task 10 browser coverage contains stair-pair authoring; this task's new E2E names a stair path from an existing stair transition rather than creating a second stair pair.
- No backend/native changes were made, so backend/native suites were not run. No dependency/security surfaces changed. No reviewers or subagents were spawned per the task protocol.
- Skills invoked: using-superpowers (dispatched-worker exception), executing-plans, using-git-worktrees (existing feature worktree verified), test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review (review evidence provided to controller; dispatch prohibited), receiving-code-review, frontend-design, ui-design, anti-ui-slop, better-typography, vercel-react-best-practices, webapp-testing, code-security-auditor (no changed security surface).

## Files changed

`navmap-web/src/OrganizerV3.tsx`, `navmap-web/src/OrganizerV5.tsx`, `navmap-web/src/map/GeographicCanvas.tsx`, `navmap-web/src/map/StaticCanvas.tsx`, `navmap-web/e2e/unified-tools.spec.ts`.
