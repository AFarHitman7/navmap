# Map authoring and visitor redesign acceptance

End-to-end acceptance for the V5 contextual map authoring and visitor
redesign. Feature set is frozen: no conversion/hybrid/delete/duplicate/
collaboration additions were made in this task.

## Automated evidence

Commands were run separately from each package directory. Final results:

| Package | Command | Result |
|---|---|---|
| web | `npm test` | 39 files / 313 tests passed |
| web | `npm run typecheck` | clean |
| web | `npm run lint` | clean (1 pre-existing `useGeolocation` effect warning) |
| web | `npm run build` | succeeds (pre-existing >500 kB chunk advisory) |
| web | `npm run e2e` (desktop + mobile) | 80/80 passed (40 per project) |
| backend | `npm test` | 14 files / 126 tests passed |
| backend | `npm run typecheck` | clean |
| backend | `npm run build` | clean |
| mobile | `npm test -- --runInBand` | 22 suites / 128 tests passed |
| mobile | `npm run typecheck` | clean |

### New browser specs (Task 16)

- `navmap-web/e2e/map-storage.spec.ts` — named geographic/static maps are
  created from the picker, persist across reload, rename without identity
  change, switch without cross-talk, and store independent drafts.
- `navmap-web/e2e/static-layout.spec.ts` — PNG upload/assign/reload,
  calibration save/reload and zero-distance rejection, two-page PDF
  assignment to two floors, legacy V4 visitor readability, two-floor
  static visitor assets and floor switching, GPS permission states
  (unavailable on geographic; no Locate me on static).
- `navmap-web/e2e/undo-all-tools.spec.ts` — node place/rename/delete,
  regular-path finish/delete, entrance/stair atomic commit, place add/
  delete, Ctrl+Z during gestures (pending cleared, history untouched),
  failed-save document retention, and dirty map-switch guard.
- `navmap-web/e2e/admin-api.ts` — shared helper that sends the required
  same-origin `Origin` header for cookie-authenticated writes. This fixes
  the 10 legacy setup failures (`403 cross-origin write rejected`) in
  `navigable-paths.spec.ts` (3 tests) and `unified-map.spec.ts` (2 tests)
  across both projects. No server hardening was weakened.

### New integrated unit coverage (Task 16)

- web `test/task16-acceptance.test.ts` — V4 upgrade readability, two-map
  isolation, typed empty drafts, cross-frame safety, undo/redo for
  boundary/building/floor/background/calibration/place/path/node/
  transition edits (asserting geometry restore plus monotonic fingerprint
  revisions), presentation abstraction, destination-only directions,
  GPS/permission state mapping, JSON reload without invented coordinates.
- backend `test/task16-acceptance.test.ts` — origin guard behavior, V5
  authoring gate, V4 legacy publish and immutable manifest reads,
  two-venue isolation, static two-floor publication with version-scoped
  assets, corrupt-asset rejection, geographic V5 publication.
- mobile `__tests__/task16-acceptance.test.ts` — V4 pack readability,
  per-map pack isolation, GPS evidence rules (no indoor claims, stale
  handling), Wi-Fi/manual precedence over GPS.

### E2E server fixtures (Task 16)

`navmap-backend/scripts/e2e-server.ts` adds three disposable venues on top
of the existing `browser-static` venue (temp dir + `:memory:` database; no
development data is touched):

- `legacy-v4` — published immutable V4 manifest (V4 readability);
- `geo-v5` — published V5 geographic venue (GPS/visitor checks);
- `static-two-floor` — published two-floor V5 static venue with verified
  PNG stand-ins (visitor asset and floor-switch checks).

## Visual acceptance

Screenshots are saved under `docs/acceptance-screenshots/` for 1280×800
and 390×844 viewports. They record, but do not substitute for, the
functional tests above.

Checklist (verified in the referenced specs unless noted):

- Only relevant inspector fields are shown per tool/selection
  (`contextual-inspector.test.tsx`, `task10-inspector-real-canvas`).
- Default layers strip is a compact current-frame row (<=56 px) with the
  rest in a popover (`task13-layers-zoom.spec.ts`).
- No UUID path rows or sampling-marker chains in the object browser
  (`object-browser.test.tsx`, `static-v5-canvas.spec.ts`).
- Handles stay usable at overzoom; geographic zoom reaches 24 with raster
  tiles clamped at native z19 (`task13-layers-zoom.spec.ts`).
- Static image aspect ratio and corners align with the frame
  (`static-canvas.test.tsx`, `static-layout.spec.ts`).
- Visitor shows destinations and the source-labelled position only
  (`visitor-geographic-safety`, `visitor-published-static`,
  `static-layout.spec.ts`).

## Physical-device acceptance

No physical Android hardware or outdoor GPS access was available in this
environment. Every check below is therefore marked **Not run** — none is
claimed as passed.

| Check | Result |
|---|---|
| Geographic GPS outdoors with accuracy/denial handling | Not run |
| Indoor GPS never claims a room or floor | Not run |
| Native Wi-Fi/QR positioning on both canvas types | Not run |
| Floor transition on device | Not run |
| Offline static pack after restart in airplane mode | Not run |
| Stale position labelling on device | Not run |
| Old active pack survives a failed update on device | Not run (unit-covered only) |

## Deferred minors carried from earlier tasks

These were explicitly recorded by earlier tasks and remain limitations,
not regressions:

- T1: multi-transition path/control preservation table tests.
- T6: visual point-picking calibration flow (coordinates are numeric).
- T7: bundle lazy-loading for the editor.
- T9: `localeCompare` tiebreak edge cases in ordering.
- T10: deeper path/transition deletion cases and mobile control-row
  browser checks.
- T13: return focus to the Layers toggle after frame selection.
- T15: hook-level insecure-context test and native GPS reset on
  geographic venue change.
- Task 4: per-process asset job/quota serialization — a single-process
  deployment is assumed; multi-process needs a database-backed lock and
  is a documented release limitation (see `map-schema-v5-rollout.md`).

## Skills invoked

using-superpowers, executing-plans, using-git-worktrees,
test-driven-development (RED-first unit specs; E2E failures root-caused
before fixes), systematic-debugging (origin-header diagnosis, save-guard
diagnosis), verification-before-completion (per-package evidence below),
requesting-code-review (evidence for controller review), frontend-design,
ui-design, anti-ui-slop, better-typography
(visitor/editor copy kept compact, no UUID walls), vercel-react-best-
practices, webapp-testing (new Playwright specs), code-security-auditor
(upload/PDF/asset/cookie-origin review; no new dependencies or network
calls, no hardening weakened). No subagents were spawned.
