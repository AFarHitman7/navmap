# run.md — daily agent dev startup for navmap2

Assume `setup.md` was already completed. Do not reinstall unless `node_modules` is missing. Do not reset backend `data/` or commit `.env`.

## Goal

Bring up backend + web locally, verify them, and report mobile status.

## Steps

1. Checks:
   - `node --version`, `npm --version`.
   - `navmap-backend/.env` and `navmap-web/.env` exist; if not, stop and say `setup.md` must be run first.
   - `navmap-backend/.env` sets `MAP_V5_AUTHORING_ENABLED=1` when the V5 (named geographic/static) editor is needed; without it the organizer shows V5 read-only and routes V4 maps to the legacy editor. The server reports the flag at `GET /api/capabilities` (`{mapV5AuthoringEnabled}`).
2. Start backend in background:
   - `cd navmap-backend && npm run dev` (uses `HOST`/`PORT` from `.env`, default `http://127.0.0.1:3000`).
   - Verify `GET /api/venues/demo/latest` returns 200 with `{venueId, version}` or 404 `{error:no published version}`. 404 before first publish is normal.
3. Start web in background:
   - `cd navmap-web && npm run dev -- --host 0.0.0.0` (default `http://localhost:5173`).
   - Verify organizer page loads and visitor `/v/demo` shows either the venue or a no-published-version retry state.
4. Mobile status only:
   - `cd navmap-mobile && npm run preandroid`
   - `adb devices` — if no device, report mobile as not runnable here. If a device is listed, run `npm run android` with `API_BASE_URL` pointing at the laptop LAN IP.

## Done check

Report backend URL + `/latest` response, web URL + page state, mobile device status, and PIDs or terminals left running.

## V5 acceptance evidence

- Web: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`,
  `npm run e2e` (desktop + mobile projects) from `navmap-web/`.
- Backend: `npm test`, `npm run typecheck`, `npm run build` from
  `navmap-backend/`.
- Mobile: `npm test -- --runInBand`, `npm run typecheck` from
  `navmap-mobile/`.
- Record per-package exit/output evidence in
  `docs/map-authoring-acceptance.md`. Physical-device checks that cannot
  run are marked "Not run", never "Passed".
- E2E fixtures (`legacy-v4`, `geo-v5`, `static-two-floor`) live in
  `navmap-backend/scripts/e2e-server.ts` and use disposable temp storage,
  never development data. Release order and limits:
  `docs/map-schema-v5-rollout.md`.
