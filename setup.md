# setup.md — first-time agent setup for navmap2

## Goal

Set up all three repos from a clean checkout so `run.md` can start them. Do not start long-running dev servers here except for verification. Do not commit secrets, `data/`, or `.env` files.

## Prerequisites to verify

- `node --version` is Node 24.15+ LTS, `npm --version` works.
- Android Studio + SDK/Java matching `navmap-mobile` React Native 0.82.1, plus `adb`.
- Repos present: `navmap-backend/`, `navmap-web/`, `navmap-mobile/`, each with `package.json` and `.env.example`.

## Steps

1. Backend:
   - `cd navmap-backend`
   - `npm ci`
   - Copy `.env.example` to `.env` if missing. Set `ADMIN_PASSWORD` to a fresh dev password, `DATA_DIR=./data`, `HOST=0.0.0.0`, `PORT=3000`.
   - `npm run db:init` — expect `data/navmap.db` and `data/uploads/`.
   - `npm test`, `npm run typecheck`, `npm run build` — all must exit 0.
2. Web:
   - `cd ../navmap-web`
   - `npm ci`
   - Copy `.env.example` to `.env` if missing. Set `VITE_API_PROXY_TARGET=http://127.0.0.1:3000`, `VITE_PUBLIC_WEB_ORIGIN=http://localhost:5173` for local dev.
   - `npx playwright install --with-deps chromium` if browsers are missing.
   - `npm test`, `npm run typecheck`, `npm run build` — all must exit 0.
3. Mobile:
   - `cd ../navmap-mobile`
   - `npm ci`
   - Copy `.env.example` to `.env` if missing. Set `API_BASE_URL=http://<laptop-LAN-IP>:3000` using the real LAN IP for debug builds.
   - `npm run preandroid` — expect `src/map/leafletHtml.ts` regenerated.
   - `npm test`, `npm run typecheck` — must exit 0. Do not require a connected device here.
   - `adb devices` — report whether a device is listed; if none, stop and report mobile as setup-only.

## Done check

Report `node`/`npm` versions, each repo's test/typecheck/build result, that backend `data/` exists, that no secrets were committed, and any missing prerequisite.
