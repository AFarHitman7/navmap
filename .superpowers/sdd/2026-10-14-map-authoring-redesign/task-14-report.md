# Task 14 implementation report

## Changes

- Added public visitor-map loading that validates version metadata, reads V4/V5 published manifests, and upgrades V4 in memory only.
- Visitor choices use authored Places attached to visitor-visible nodes. Visitor canvases omit editor node/transition data attributes.
- Visitor titles use published venue names from latest metadata; the public latest response now includes the name.
- Directions use authored place labels and generic transition instructions, omit node IDs/connection counts, and show meters only if every route edge has known physical meters.
- Static background assets continue to use immutable public version-scoped URLs rather than draft endpoints.
- Added shared `shared/src/directions.ts` instructions derived from the full graph, grouping path samples, applying Place labels, and omitting meters unless every edge is calibrated.
- Visitor node choices are separated from full-graph routing; hidden generated intermediates no longer crash route directions or leak generated names. Generated current locations use generic labels.
- V4 native visitor rendering upgrades in memory, shows visitor-safe authored choices, and hides network/route lines, IDs, and hidden samples. Native and web floor selection use exact manifest frames, with manual selection retained until resume-follow.
- Geographic visitor projections now suppress graph paths, active routes, editor bounds, transition labels, and editor metadata. Browser tests validate public static asset requests without credentials and V4/V5 geographic safety.

## Verification

- New V5 visitor regression was observed failing before normalization and passing afterward.
- Web: 35 suites / 273 tests; typecheck, lint, and production build pass. Build retains a >500 kB main chunk warning.
- Mobile: 19 suites / 109 tests; typecheck and Android Metro bundle pass (Metro prints two existing unknown serializer-option warnings).
- Backend: 13 suites / 119 tests; build passes.
- Browser: 4 visitor E2E cases pass (published V5 static asset loading and V4/V5 geographic visitor safety on desktop and 390px mobile).

## Limitations

- The task brief, agent protocol, global constraints, rulings, and tracked task plan/spec were unavailable. The supplied SDD directory contained only task10-round1 screenshot artifacts.
- No GPS watch/live-position overlay was added; this remains Task 15 scope. Survey code was untouched.
- Native rendering has unit coverage but no actual-device WebView QA.
- Skill instructions loaded during this follow-up: executing-plans, using-git-worktrees, systematic-debugging, test-driven-development, verification-before-completion, requesting-code-review, receiving-code-review, frontend-design, anti-ui-slop, better-typography, vercel-react-best-practices, webapp-testing, code-security-auditor, and ui-design. No subagents were spawned.

## Task 14 fix round 1

- Native geographic hidden generated start markers now use “Known location,” matching static visitor behavior; UI source distinguishes manual start, QR check-in, Wi-Fi estimate with its reading timestamp, unknown location, and destination-only state.
- Web visitor canvas projection now shares selector eligibility: visitor-visible authored nodes and explicitly Place-referenced generated nodes only. Full graph routing remains unchanged.
- Added regressions for hidden generated geographic start names, native location sources/unknown/destination-only, and visitor-visible generated nodes with/without Places in both web canvas types.
- Verification for this round (run 2026-10-16 in this worktree): web `npm test` 35 suites / 276 tests pass; web `npm run typecheck` passes; web `npm run lint` (oxlint) passes; web `npm run build` passes (pre-existing >500 kB main-chunk warning only). Mobile `npm test` 19 suites / 112 tests pass; mobile `npm run typecheck` passes. Backend skipped: this round's diff touches no backend files.
- Red/green: with the two source files reverted to HEAD (`presentation.ts`, `VisitorScreen.tsx`) the 3 new web tests and 3 new native tests fail; with the fixes restored all pass (web targeted files 18/18, mobile `visitor-v3` suite 7/7).
