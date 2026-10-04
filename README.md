# navmap (monorepo)

Single root repo for the NavMap project. See `setup.md` (first-time setup) and `run.md` (daily dev startup).

## Layout

- `navmap-backend/` — API + SQLite store, v3 contract only
- `navmap-web/` — organizer + visitor web app
- `navmap-mobile/` — React Native app
- `docs/` — implementation plan and notes

Each former sub-repo's full git history is archived as a bundle in `../navmap-git-history-backup/` (outside this repo, not committed).
