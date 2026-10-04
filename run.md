# run.md — daily agent dev startup for navmap2

Assume `setup.md` was already completed. Do not reinstall unless `node_modules` is missing. Do not reset backend `data/` or commit `.env`.

## Goal

Bring up backend + web locally, verify them, and report mobile status.

## Steps

1. Checks:
   - `node --version`, `npm --version`.
   - `navmap-backend/.env` and `navmap-web/.env` exist; if not, stop and say `setup.md` must be run first.
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
