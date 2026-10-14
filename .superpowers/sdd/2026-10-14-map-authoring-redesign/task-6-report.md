# Task 6 — PNG/PDF import, floor assignment, and calibration

## Outcome and scope

Implemented a bounded PNG/PDF import flow and reusable responsive `LayoutImportPanel`. PDF pages are parsed and rasterized in the browser with pinned `pdfjs-dist`; Vite emits the worker as a same-origin local asset (no CDN). The panel is deliberately not mounted in `OrganizerV3` or the V4 editor: Task 7 can wire it into the V5 static canvas without changing the live V4 path.

Only a browser-converted/re-encoded PNG is sent to the existing authenticated `POST /api/admin/venues/:venueId/layout-assets` endpoint. The server remains responsible for canonical PNG validation and returned asset metadata is checked before assignment.

## Interfaces

- `readLayoutSource(file: File, signal: AbortSignal): Promise<LayoutSource>` where `LayoutSource` is `{ pages: number; renderPage(page: number): Promise<Blob>; close(): Promise<void> }`.
- `uploadLayout(venueId: string, png: Blob, signal: AbortSignal): Promise<LayoutAsset>` in `src/layout-api.ts`; `LayoutAsset` is also type-exported by `src/api-v3.ts`.
- `assignBackground(draft: MapDraft, frameId: string, asset: LayoutAsset): MapDraft`.
- `calibrateFrame(draft, frameId, a, b, meters): MapDraft`, with normalized points `{x:number;y:number}`.
- `LayoutImportPanel({ venueId, draft, commit })`; `commit` is the shared `useEditorDocument` transaction function shape. No parallel history implementation was added.

## Behavior and safety

- Checks source size (20 MiB) before parsing. PNG IHDR dimensions are checked before decode; both 4096-pixel axes and 16,000,000 pixels are enforced. PDFs are capped at 20 pages and each raster derivative is aspect-preserving and bounded by both output limits.
- pdf.js is dynamically loaded only when a file is selected. Its worker is imported using Vite's local `?url` asset handling. Page render has a 30-second timeout; abort, timeout, and close cancel active render work, destroy the loading task/worker, and release canvases. Preview object URLs are revoked on replacement/unmount.
- Encrypted/password-protected and corrupt PDFs receive clear errors; no password prompt or persistence was introduced. Source PDFs are never uploaded.
- Floor assignment/replacement happens only after upload succeeds. Cancellation, upload errors, or failed draft commits do not mutate the document. Replacing an assigned background requires confirmation, preserves normalized node positions, clears calibration and derived internal-edge metres, and increments every node fingerprint revision in that frame. Cross-frame explicit metres and graph costs/topology remain unchanged.
- Calibration rejects non-finite/non-positive metres, identical/out-of-range points, and missing/unassigned frames. It stores metres-per-pixel, updates optional within-frame edge metres, and bumps frame node fingerprints without changing route weights or graph topology. Both assignment and calibration use the existing shared transaction history and undo correctly.
- V5 frame selection uses frame IDs and labels assigned/missing plans and uncalibrated floors. Empty-frame state and upload/conversion errors are presented accessibly.

## Tests and verification evidence

TDD RED evidence: the first focused run failed because `assignBackground`, `calibrateFrame`, and `pdf-import.ts` were absent. A later regression test also failed on replacement retaining stale optional edge metres; the implementation was corrected and that test passed.

Actual PDF fixtures under `navmap-web/test/fixtures/layouts/` include a valid two-page PDF, a valid 21-page PDF for the cap, an oversized-page PDF for output scaling, an encrypted PDF, and a corrupt PDF. Conversion tests parse and render these real PDFs with pdf.js and verify PNG dimensions; the UI integration test assigns a rendered page, calibrates it, and undoes both edits. Canvas rendering in jsdom uses `@napi-rs/canvas`; the PDF documents themselves are not mocked.

Fresh final verification:

- `npm test` — **22 files, 214 tests passed**.
- `npm run typecheck` — passed.
- `npm run lint` — passed with no lint warnings.
- `npm run build` — passed. Existing main-entry chunk warning remains: 639.03 kB minified (>500 kB threshold). The V4 entry does not import Task 6 UI by design.
- `git diff --check` — passed (Git emitted only line-ending normalization notices).
- Separate Vite `build({write:false, rollupOptions:{input:'src/LayoutImportPanel.tsx'}})` verification — emitted `assets/pdf.worker.min-DjJoeDqY.mjs` locally (1,103,947 bytes), confirming the panel's production worker reference is bundled locally when the component is included.
- `npm audit --omit=dev` — 0 production vulnerabilities. Full `npm audit` reports one high dev/transitive `source-map-js@1.2.1` advisory (GHSA-68fv-2mgg-jv7q), reached through existing Vitest/jsdom/Vite dependency paths; the baseline audit already recorded one web high. No unrelated dependency upgrades were made.

## Files changed

- `navmap-web/src/pdf-import.ts`
- `navmap-web/src/layout-api.ts`
- `navmap-web/src/LayoutImportPanel.tsx`
- `navmap-web/src/editor-v3/model.ts`
- `navmap-web/src/api-v3.ts`
- `navmap-web/src/styles.css`
- `.gitattributes` (keep generated PDF fixtures binary in Git)
- `navmap-web/package.json`, `navmap-web/package-lock.json` (exact versions)
- `navmap-web/test/layout-import.test.tsx`, `navmap-web/test/layout-calibration.test.ts`
- `navmap-web/test/fixtures/layouts/{two-page,twenty-one-pages,oversized-page,encrypted,corrupt}.pdf`

## Skills and review constraints

Invoked the protocol's 15-skill toolkit: using-superpowers (subagent stop exception), executing-plans, using-git-worktrees, test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review, receiving-code-review, frontend-design, ui-design, anti-ui-slop, better-typography, vercel-react-best-practices, webapp-testing, and code-security-auditor. Applied UI guidance from `ui-design/reference/new-work.md`; existing product tokens, labels, floor names, focus treatment, and mobile input sizing were retained/extended.

No UIZZE reference MCP result/service was connected; no external visual research is claimed. The worker protocol forbids spawning agents/reviewers, so no separate reviewer was dispatched; controller-owned review remains available. Static security review was limited to this feature's file/dependency/data flow (no arbitrary paths/URLs, no PDF upload, no CDN worker, same-origin authenticated upload); this was not a whole-repository security audit. No live-browser viewport screenshot was taken because this panel is intentionally not wired into the V4 editor until Task 7; interactions were verified through the real-PDF React integration tests.

## Remaining concern

Task 7 must import/use `LayoutImportPanel` in the V5 static editor. At that point, confirm the generated local worker asset is present in that application's final bundle and inspect the panel at desktop/mobile viewports. The existing 639 kB main-entry warning and dev-only transitive audit advisory are recorded above.

## Round 1 review fixes

Read `.superpowers/sdd/2026-10-14-map-authoring-redesign/artifacts/task-6-review.md` and reproduced both Important findings before changing production code.

1. **Stale upload/map switch:** the RED deferred-upload regression resolved a real two-page PDF, held the upload response, reset the shared editor to `map-b` with the same `frame-outdoor-z0` ID, then completed transport. Before the fix, the hook assigned the asset into `map-b` (`map-b:<assetId>`). `LayoutImportPanel` now keys its session by `{venueId,draft.venueId}`, so map switches unmount/abort and clear preview, source, selected frame, calibration, and confirmation state. The assignment's functional history updater additionally requires the current document object to be exactly the captured source snapshot and both document/venue IDs to match. A second regression resets to a changed snapshot of the same venue while upload is pending; it verifies the upload cannot commit and history stays unchanged.
2. **Full-page conversion budget:** RED used a real parsed/rendered PDF and stalled the actual canvas `toBlob` callback. With the old implementation the observed state remained `pending` after the budget expired because the timer had already been cleared after `render.promise`. The budget now wraps PDF page retrieval, render, and PNG encoding, races the abort signal, and on timeout/abort destroys the task/worker and zeros the canvas. A closed-state check after encoding prevents late callbacks from returning a derivative. Actual stalled-encode tests verify timeout and abort rejection, canvas dimensions become zero, and a late PNG callback cannot turn the operation into success.

TDD evidence:

- RED: `npm test -- --run test/layout-import.test.tsx -t 'late upload into another map'` — failed with the expected stale frame assignment on `map-b`.
- RED: `npm test -- --run test/layout-import.test.tsx -t 'stalled PNG encoding'` — failed with `expected 'pending' to be 'rejected'` after the actual encode was stalled beyond the simulated 30-second budget.
- GREEN focused: `npm test -- --run test/layout-import.test.tsx test/layout-calibration.test.ts` — **23 tests passed**.
- Final full verification: `npm test` — **22 files, 218 tests passed**; `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` passed. Build retains the already-recorded 639.03 kB main-entry warning.

Round 1 changed only `navmap-web/src/LayoutImportPanel.tsx`, `navmap-web/src/pdf-import.ts`, and `navmap-web/test/layout-import.test.tsx` in addition to this report. No hook/history code was duplicated or modified; `useEditorDocument` remains the transaction owner. The V4 editor remains unwired.
