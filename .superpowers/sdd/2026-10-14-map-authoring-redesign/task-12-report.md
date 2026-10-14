# Task 12 report — unified authoring parity

## Outcome

- V5 authoring retains only its unified Path and explicit Node subtype tools; no standalone Connect toolbar, connection-kind dropdown, or “Link next landing as stairs” control is present in V5.
- Added node-ID data attributes to both V5 canvases so browser tests can click the real Leaflet markers by stable identity. Existing-node clicks in Regular Path now have real desktop/mobile coverage; a bent path is completed as one history edit.
- V5 pending gestures now handle Escape (discard) and Ctrl/Cmd+Z (remove the last pending point/endpoint); when the gesture has no pending items, undo falls through to document history instead of consuming the key. Existing elevator edit/delete, entrance pair completion, cross-floor stair-pair creation and stair-path association, and legacy V4 edge history are exercised in browser tests.
- Legacy V4 rollback stays usable: its editor is visibly labelled “LEGACY V4 COMPATIBILITY EDITOR”, and its toolbar action is labelled “Legacy connect”. Legacy inline stairs controls remain confined to that compatibility editor; upgraded V4 maps routed to V5 do not show them. `connectNodes` remains available internally.
- Updated the old point-creation status from “Connect it…” to “Draw a path to it.” No published schema or backend/native files changed.

## RED/GREEN and verification

- RED: added a positioned-endpoint identity-reuse test; it failed because `addRegularPath` unconditionally created a new node rather than using the shared endpoint resolver. After routing positioned endpoints through that resolver, the existing junction ID is reused. Added duplicate-endpoint rejection coverage; existing `paths.test.ts` covers overlapping segments.
- RED: the updated pending-undo browser scenario covers one pending point removed, a second Ctrl/Cmd+Z reaching a previously committed rename (including zero-pending fallback), and Escape with incomplete Entrance/Stair gestures while Finish remains disabled.
- RED: Task 10's stable-ID path and frame-marker replacements exposed mobile-only canvas assumptions plus an existing-path overlap. Tests now use the active image's actual screen bounds for canvas placement, a newly authored node and stable node IDs for path creation, and real existing endpoints in geographic mode; pending step labels assert indoor/outdoor frame identity.
- `cd navmap-web && npm run e2e -- e2e/task10-inspector-real-canvas.spec.ts e2e/unified-tools.spec.ts --project=desktop --project=mobile --reporter=line` — 14/14 passed (Task 10 and Task 12 real-canvas cases on desktop and mobile).
- `cd navmap-web && npm test` — 33 files / 265 tests passed.
- `cd navmap-web && npm run typecheck`, `npm run lint`, `npm run build` — passed without lint warnings. Build retains the existing >500 kB chunk warning.
- `git diff --check` — passed (Git reports configured LF-to-CRLF normalization warnings).
- The Task 10 failures from the prior report are resolved: static marker expectations are identity-based and exclude hidden generated markers; geographic endpoint pairing and responsive Outdoor selection pass on both viewport projects.

## Scope and concerns

- The old V3/V4 rollback editor intentionally still contains its legacy Connect flow, connection-kind control, and inline stairs gesture. Removing those would impair capability-flag-false V4 rollback usability; this is the explicitly labelled compatibility exception, not a claim of repository-wide grep-zero. New and upgraded V5 authoring has no such controls.
- Existing-node endpoint labels now identify the resolved node and frame, improving visible confirmation of which geographic landing is pending.
- No backend/native changes were made, so backend/native suites were not run. No dependency/security surfaces changed. No reviewers or subagents were spawned per the task protocol.
- Skills invoked: using-superpowers (dispatched-worker exception), executing-plans, using-git-worktrees (existing feature worktree verified), test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review (review evidence provided to controller; dispatch prohibited), receiving-code-review, frontend-design, ui-design, anti-ui-slop, better-typography, vercel-react-best-practices, webapp-testing, code-security-auditor (no changed security surface).

## Files changed

`navmap-web/src/OrganizerV3.tsx`, `navmap-web/src/OrganizerV5.tsx`, `navmap-web/src/editor-v3/inspectors/NodeInspector.tsx`, `navmap-web/src/editor-v3/objects.ts`, `navmap-web/src/map/GeographicCanvas.tsx`, `navmap-web/src/map/StaticCanvas.tsx`, `navmap-web/e2e/task10-inspector-real-canvas.spec.ts`, `navmap-web/e2e/unified-tools.spec.ts`, `navmap-web/test/editor-objects.test.ts`.

## Task 12 follow-up (round 1)

- Implemented zero-pending Ctrl/Cmd+Z fallback to document undo; Escape cancels partial entrance/stair input and Finish stays disabled until both endpoints are present.
- Fixed positioned path endpoint resolution to reuse an existing matching node instead of adding a duplicate; duplicate endpoint and existing overlap validation are covered.
- Expanded browser evidence for a newly created cross-floor stair pair, stair path association, elevator deletion preserving both endpoint nodes, and V4 legacy-edge delete/undo/redo.
- Corrected Task 10 assertions and interaction setup: node identity rather than marker totals, mobile map click from the rendered active-frame image transform, and geographic endpoint selection via known node IDs with frame-label assertions.
