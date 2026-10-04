# NavMap Backend Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a single-process local API that protects draft writes and publishes one immutable, downloadable venue version with surveyed Wi-Fi fingerprints.

**Architecture:** Fastify runs on Node.js 24.15+ LTS. Built-in `node:sqlite` in WAL mode stores one draft, samples, sessions and published manifests; versioned images are ordinary files beneath `DATA_DIR`. No queue or external database.

**Tech Stack:** TypeScript, Fastify, built-in `node:sqlite` (`DatabaseSync`), Zod, Vitest, Node `crypto` and filesystem; npm.

**Spec:** `../specs/2026-09-27-navmap-prototype-design.md`; companion contract/setup: `../../navmap-prototype-implementation-plan.md` (paths from the parent planning directory, not this future repository).

## Global Constraints

- Exactly three independent repos; this plan's paths are relative to future `navmap-backend/`.
- One seeded organizer, one `demo` venue, v1 `schemaVersion: 1`; public read-only access, protected writes.
- One outdoor zone with bounds, one indoor zone with width in metres; image size maximum 1.5 MB each.
- Versioned published manifests/images must be immutable; source draft remains editable.
- No paid/closed-source dependency, Docker, PostGIS, Redis, hosted auth, tile store or private package publish.

---

## File map

- `src/app.ts`: Fastify registration and request validation; `src/server.ts`: start/listen, optional static web build.
- `src/db.ts`: SQLite open/migrate/transaction lifecycle; `src/auth.ts`: password hash/session issue/check.
- `src/draft.ts`: JSON draft schema and graph checks; `src/routes/admin.ts`: protected draft/AP/image/sample/publish endpoints.
- `src/survey.ts`: sanitize samples, reject duplicate timestamps, compute room profiles.
- `src/publish.ts`: graph/profile validation and immutable manifest + assets.
- `src/routes/public.ts`: latest/versioned manifest and asset reads.
- `fixtures/demo-v1.json`: small representative v1 manifest copied to client tests.
- `test/*.test.ts`: route and pure-logic behavior; `.env.example`, `README.md`, `package.json`.

### Task 1: Bootable API, login, and protected editable draft

**Files:** Create `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `src/db.ts`, `src/auth.ts`, `src/draft.ts`, `src/routes/admin.ts`, `src/app.ts`, `src/server.ts`, `test/admin.test.ts`, `README.md`.

**Interfaces:** `buildApp(db: DatabaseSync, options: {adminPasswordHash: string}): FastifyInstance`; `openDb(path: string): DatabaseSync`; `Draft` holds `zones,nodes,edges,places,anchors,aps,entranceNodeId`; `GET/PUT /api/admin/draft`, `POST /api/admin/login`.

- [ ] **Step 1: Scaffold repo and write the first failing endpoint test.** `npm init -y`; install `fastify @fastify/cookie @fastify/multipart zod`; install dev `typescript tsx vitest @types/node`. Add scripts `dev: tsx watch src/server.ts`, `db:init: tsx src/db.ts --init`, `test: vitest run`, `typecheck: tsc --noEmit`, `build: tsc`. Test an in-memory `new DatabaseSync(':memory:')` and injected requests:

```ts
// test/admin.test.ts — createDbForTest uses openDb(':memory:')
const app = buildApp(createDbForTest(), {adminPasswordHash: hashPassword('correct-password')});
expect((await app.inject({method:'PUT',url:'/api/admin/draft',payload:{venueId:'demo'}})).statusCode).toBe(401);
const login = await app.inject({method:'POST',url:'/api/admin/login',payload:{password:'correct-password'}});
expect(login.statusCode).toBe(200);
const cookie = login.cookies.find(c => c.name === 'navmap_session')!.name + '=' + login.cookies.find(c => c.name === 'navmap_session')!.value;
expect((await app.inject({method:'GET',url:'/api/admin/draft',headers:{cookie}})).statusCode).toBe(200);
```

- [ ] **Step 2: Run `npm test -- test/admin.test.ts`.** Expected: FAIL because `openDb`, `hashPassword` and `buildApp` do not exist yet.
- [ ] **Step 3: Implement the minimum.** `src/db.ts` uses `new DatabaseSync(path)` to create `drafts(venue_id TEXT PRIMARY KEY, json TEXT)`, `sessions(token_hash TEXT PRIMARY KEY, expires_at INTEGER)`, `samples(...)`, `versions(venue_id, version, manifest_json, PRIMARY KEY(venue_id,version))`; enable `PRAGMA journal_mode=WAL` for file-backed DBs. `src/auth.ts` uses Node `scryptSync` with random salt for the seeded password and `randomBytes(32)` for a session token; store its SHA-256 digest, expire after 24 h. Login sets `HttpOnly; SameSite=Lax` cookie and returns `{token}` for Android. Protect every `/api/admin/*` path except login with cookie or bearer token. Reject body writes for any `venueId` other than `demo`; no request may select a different venue. Initialize a blank draft with one `demo` venue. Add `.env.example` names from the companion guide and a `data/` ignore rule.

```ts
// src/auth.ts, core check
const key = createHash('sha256').update(token).digest('hex');
const row = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(key);
return Boolean(row && row.expires_at > Date.now());
```

- [ ] **Step 4: Run `npm test -- test/admin.test.ts`, `npm run typecheck`, `npm run build`.** Expected: all exit 0; an unauthenticated write remains 401. Add an Origin check for cookie-authenticated JSON writes (same-origin Vite `/api` proxy); keep bearer writes available for Android.
- [ ] **Step 5: Commit** `git add . && git commit -m "feat: bootstrap local API and organizer draft"`.

### Task 2: Real survey samples and stable profiles

**Files:** Create `src/survey.ts`, `test/survey.test.ts`; modify `src/routes/admin.ts` (or admin registration in `src/app.ts`), `src/db.ts`, `README.md`.

**Interfaces:** `putAps(db, bssids: string[]): void`; `addSamples(db, placeId: string, scans: Scan[]): number`; `buildProfiles(scans: Scan[], allowlist: string[]): Profile[]` produces `{placeId,medianRssi,scanCount}`. Admin routes: `PUT /api/admin/aps`, `POST /api/admin/samples`.

- [ ] **Step 1: Write the failing pure-function and route tests.** Use distinct room IDs and timestamps; the unknown AP must not influence medians, a repeated scan-result timestamp must be rejected, and a sample write without login must return 401.

```ts
expect(buildProfiles([
  {placeId:'room-a',capturedAt:101,readings:[{bssid:'AA:BB:CC:DD:EE:01',rssi:-49},{bssid:'FF:FF:FF:FF:FF:FF',rssi:-1}]},
  {placeId:'room-a',capturedAt:102,readings:[{bssid:'AA:BB:CC:DD:EE:01',rssi:-53}]},
  {placeId:'room-a',capturedAt:103,readings:[{bssid:'AA:BB:CC:DD:EE:01',rssi:-51}]},
], ['AA:BB:CC:DD:EE:01'])).toEqual([{placeId:'room-a',medianRssi:{'AA:BB:CC:DD:EE:01':-51},scanCount:3}]);
```

- [ ] **Step 2: Run `npm test -- test/survey.test.ts`.** Expected: FAIL because `buildProfiles` is absent.
- [ ] **Step 3: Implement the smallest aggregation.** Normalize BSSID uppercase, require RSSI in `[-100,0]`, deduplicate scans by `(placeId,capturedAt)`, keep only allowlisted BSSIDs, take a median of observed values per room/AP, and set `scanCount` to distinct scans for that room. Validate each sample's place exists in the draft; reject arrays over 20 scans/request and unknown room IDs with 400. Keep every write under admin session; do not store visitor positions.

```ts
const median = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]; // 3 scans minimum for publish
};
```

- [ ] **Step 4: Run `npm test -- test/survey.test.ts`, `npm run typecheck`.** Expected: both exit 0; a duplicate timestamp and unknown place each produce 400.
- [ ] **Step 5: Commit** `git add . && git commit -m "feat: collect allowlisted room surveys"`.

### Task 3: Validate and publish immutable complete versions

**Files:** Create `src/publish.ts`, `test/publish.test.ts`, `fixtures/demo-v1.json`; modify `src/draft.ts`, `src/routes/admin.ts`, `src/db.ts`.

**Interfaces:** `validateDraft(draft: Draft, profiles: Profile[]): string[]` returns actionable messages; `updateDraft(db, draft: Draft): void` and `loadVersion(db, venueId: string, version: number): Manifest` support tests/routes; `publish(db, dataDir: string): Manifest` returns v1 contract; `POST /api/admin/images/:zoneId`, `POST /api/admin/publish`.

- [ ] **Step 1: Write failing graph, image, and immutability tests.** Assemble a fixture with two zones, an entrance edge, three room places, three anchors, four APs and at least three scans/room; assert publish version 1. Remove the entrance edge and assert 400 with a connectivity message. After publishing, change the draft and assert version 1 JSON and image digests are unchanged.

```ts
const v1 = await publish(db, tempDir);
expect(v1).toMatchObject({schemaVersion:1,venueId:'demo',version:1});
await updateDraft(db, {...draft, places:[...draft.places,{id:'later',name:'Later',zoneId:'indoor',nodeId:'n3'}]});
expect(await loadVersion(db, 'demo', 1)).toEqual(v1);
```

- [ ] **Step 2: Run `npm test -- test/publish.test.ts`.** Expected: FAIL because `publish` and `loadVersion` are missing.
- [ ] **Step 3: Implement upload and publish.** Accept PNG/JPEG/WebP, reject >1.5 MB and unsafe file extensions, store uploads with generated names, calculate SHA-256 with Node `createHash`. Validate outdoor bounds ordering, indoor width >0, `[0,1]` node coordinates, unique IDs, positive edge metres and existing edge endpoints/place nodes. Breadth-first walk from `draft.entranceNodeId` must reach every path node and place; require its outdoor node to connect by an edge to an indoor entrance node. Require an indoor anchor and 3–4 registered APs; for each demo room require >=3 distinct fresh scans and >=2 common allowlisted BSSIDs. Include those AP BSSIDs in the manifest. Build profiles and copy images to a temporary version directory, rename it to immutable `versions/demo/N/`, then insert the manifest in a DB transaction. If DB insertion fails, remove the new version directory; if the process crashes before insertion, clean orphan version directories at startup. An invalid draft returns all actionable errors and does not advance the version.

```ts
// src/publish.ts, graph check
const reachable = new Set<string>([entranceNodeId]);
const queue = [entranceNodeId];
for (const id of queue) for (const next of adjacency.get(id) ?? []) {
  if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
}
for (const place of draft.places) if (!reachable.has(place.nodeId)) errors.push(`${place.name} is disconnected from the entrance`);
```

- [ ] **Step 4: Run `npm test -- test/publish.test.ts`, `npm run typecheck`, `npm run build`.** Expected: pass, with snapshot JSON and original image digest unchanged after draft edits. Save an actual small `fixtures/demo-v1.json` generated from the seeded venue; verify this fixture against the v1 schema.
- [ ] **Step 5: Commit** `git add . && git commit -m "feat: publish immutable checked venue snapshots"`.

### Task 4: Public delivery and local running guide

**Files:** Create `src/routes/public.ts`, `test/public.test.ts`; modify `src/app.ts`, `src/server.ts`, `.env.example`, `README.md`.

**Interfaces:** `GET /api/venues/demo/latest` returns `{venueId:'demo',version:N}`; `GET /api/venues/demo/versions/:version/manifest` returns `Manifest`; `GET /api/assets/:version/:filename` returns immutable bytes; unknown versions return 404.

- [ ] **Step 1: Write the failing public read test.** Publish v1, fetch manifest without login, fetch image bytes from the manifest URL, and assert `sha256(bytes) === image.sha256`; old v1 remains readable after publishing v2.

```ts
const response = await app.inject({method:'GET',url:'/api/venues/demo/versions/1/manifest'});
expect(response.statusCode).toBe(200);
expect(response.json().version).toBe(1);
expect(response.headers['cache-control']).toContain('immutable');
```

- [ ] **Step 2: Run `npm test -- test/public.test.ts`.** Expected: FAIL (missing public route).
- [ ] **Step 3: Add public routes with ETag and immutable version cache headers.** Install open-source `@fastify/static`. Validate version as a positive integer and asset filename against the published manifest; no arbitrary file paths. `/latest` gets `no-store`, versioned JSON/images get `public, max-age=31536000, immutable`. Serve `../navmap-web/dist` only when a configured `WEB_DIST_DIR` exists; `/api` has priority. Allow optional `TLS_CERT_FILE`/`TLS_KEY_FILE` for one-process phone-browser GPS testing over trusted HTTPS. README includes Windows-friendly `npm ci`, `npm run db:init`, `npm run dev`, `.env` values, LAN IP discovery and backup (`copy data/` while stopped).

```ts
reply.header('cache-control', 'public, max-age=31536000, immutable');
reply.header('etag', `"${createHash('sha256').update(body).digest('hex')}"`);
return reply.send(body);
```

- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build`; test the README from a clean checkout.** Expected: all exit 0; unauthenticated `GET` succeeds but every admin `PUT/POST` (except login) returns 401; invalid/unknown asset paths return 404.
- [ ] **Step 5: Commit** `git add . && git commit -m "feat: serve versioned public venue packs"`.
