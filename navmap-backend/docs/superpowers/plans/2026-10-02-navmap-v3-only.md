# NavMap V3-Only Hard Cut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make V3 the only UI, API, persisted format, and mobile pack format; remove old interfaces and clear local dev data.

**Architecture:** Web root is the V3 organizer. Backend stores and serves only geographic V3 records. Mobile reads and writes only V3 offline packs. A guarded local reset command clears the configured development data directory; it never runs automatically.

**Tech Stack:** Fastify, TypeScript, Zod, SQLite; React, React Router, Vite; React Native, Jest, Vitest, Playwright.

**Spec:** `navmap-backend/docs/superpowers/specs/2026-10-02-navmap-v3-only-design.md`

## Global Constraints

- Do not deploy, push, or modify remote/production systems.
- V3 is the only supported contract; V1/V2 clients and packs become incompatible.
- Do not automatically delete data on startup; local destructive reset must name and guard its exact resolved target.
- Never erase Android-device storage from this workspace; stale packs must be handled by the app itself.
- Use test-first changes, run the relevant suite after each task, and preserve unrelated working-tree changes.

---

### Task 1: V3-only web entry point

**Files:**
- Modify: `navmap-web/src/App.tsx`, `navmap-web/src/Maps.tsx`, `navmap-web/src/OrganizerV3.tsx`
- Test: `navmap-web/test/app.test.tsx`, `navmap-web/test/maps.test.tsx`
- Remove after references are gone: `navmap-web/src/Organizer.tsx`, `navmap-web/src/Visitor.tsx`, `navmap-web/src/VisitorV3.tsx`, `navmap-web/src/Maps.tsx` (retain only if the V3 editor needs venue selection)

**Interfaces:** Root route renders `OrganizerV3`; `/maps`, legacy edit, and visitor-preview routes are absent. Keep V3 API calls and V3 authoring controls.

- [x] Write app routing tests that assert root contains V3 organizer controls and old routes render the not-found state.
- [x] Run the focused root test before the routing change and confirm its expected failure.
- [x] Point the root route at `OrganizerV3`, remove retired routes/header links, and add an explicit V3-only not-found state.
- [x] Remove unused legacy UI modules only after reference checks; remove or rewrite tests that assert retired behavior.
- [x] Run the web test suite, typecheck, lint, production build, and browser checks.

### Task 2: V3-only backend contract and API

**Files:**
- Modify: `navmap-backend/src/app.ts`, `src/routes/admin.ts`, `src/routes/public.ts`, `src/routes/venues.ts`, `src/db.ts`, `src/draft.ts`, `src/publish.ts`, `src/venues.ts`, `CONTRACT.md`
- Remove after reference audit: V1/V2 parsers, publishers, migration helper, survey modules, schemas, and legacy-only route files/tests.
- Test: `navmap-backend/test/app-v3-only.test.ts`, existing V3 API/publish tests.

**Interfaces:** Preserve authenticated V3 draft/survey/publish endpoints and public V3 manifest reads. Unsupported schema versions return an explicit 400/415 error, not a parser fallback.

- [x] Add API tests proving V3 draft and publication still work, legacy draft/publish endpoints are unavailable, and non-V3 manifests are rejected.
- [x] Run the focused API test before cutting the old route surface and confirm its expected failure.
- [x] Remove route registration and aliases that only served old schemas; retain shared auth for V3 routes.
- [x] Remove old schemas/tables/helpers and retain only V3 tables in the database initializer.
- [x] Remove the migration helper and dead parsers after checking live references; remove obsolete tests/fixtures while retaining V3 fixtures.
- [x] Run backend tests, typecheck, and build.

### Task 3: Safe explicit local data reset

**Files:**
- Create: `navmap-backend/scripts/reset-dev-data.ts`
- Modify: `navmap-backend/package.json`, `src/env.ts`, `README.md`
- Test: `navmap-backend/test/reset-dev-data.test.ts`

**Interfaces:** `npm run data:reset -- --confirm-v3-reset` resolves `DATA_DIR`/`DB_PATH`, prints the exact target, refuses paths outside the backend workspace unless a second explicit override flag is present, and deletes DB/sidecars/uploads/versions once. It does not run on server start.

- [x] Write temporary-directory tests for successful deletion, wrong-token refusal, workspace-root refusal, and outside-workspace refusal.
- [x] Run the focused test before adding the reset function and confirm the expected missing-command failure.
- [x] Implement the reset command with the exact token, canonical path confirmation for external targets, and empty/root guards.
- [x] Run focused tests and inspect the recreated local database read-only; it contains only the blank V3 demo draft and V3 tables.
- [x] Verify the CLI prints resolved paths and refuses to run without its token; do not run it against the live local database again.

### Task 4: V3-only mobile contracts and offline packs

**Files:**
- Modify: `navmap-mobile/src/pack.ts`, `src/Root.tsx`, `src/api.ts`, `src/contract-v3.ts`, mobile README/config copy.
- Remove after reference audit: `src/contract.ts`, `src/fixtures/demo-v1.ts`, V1/V2 route/location fallbacks, and legacy-only pack helpers/tests.
- Test: V3 pack tests plus app-root tests.

**Interfaces:** Offline pack APIs accept `ManifestV3` only. Legacy pack payloads fail with an unsupported-schema error; downloaded and existing incompatible local packs are removed or marked unusable without crashing.

- [x] Add tests for V3 pack round trip and explicit rejection/removal of schema versions 1 and 2.
- [x] Run the focused mobile test suite and confirm the V3 pack behavior.
- [x] Restrict pack parsing and visitor/root state to V3 types; remove stale incompatible local packs safely when encountered.
- [x] Remove legacy-only contracts, route branches, asset helpers, and obsolete docs/fixtures after reference checks.
- [x] Run the mobile test suite and typecheck.

### Task 5: Remove map-list fix residue and close the V3 web path

**Files:**
- Modify: `navmap-web/src/Maps.tsx`, `navmap-web/test/maps.test.tsx`, `src/App.tsx`, `test/app.test.tsx`

- [x] Adapt the pending Maps-page regression change into root V3 routing; do not retain the maps list in the final product.
- [x] Prove the organizer loads a V3 draft at `/` and save/publish controls remain reachable.
- [x] Run web tests, typecheck, lint, production build, and desktop/mobile browser flows.

### Task 6: Cross-repo documentation and final verification

**Files:**
- Modify: each repo README/contract docs and `docs/superpowers/plans/2026-10-02-navmap-v3-only.md`.

- [x] Remove stale setup and feature instructions that advertise legacy editors, old routes, or old-format downloads.
- [x] Search all three repos for live old-format parsers/routes/copy; remove dead code and retain only intentional historical/spec/test references.
- [x] Run backend tests/typecheck/build; web tests/typecheck/lint/build; mobile tests/typecheck.
- [x] Verify all three working trees and document local-only data deletion, breaking compatibility, and Android-device acceptance limitations.
