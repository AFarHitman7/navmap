# Task 4 report — venue-scoped layout assets

## Status

Implemented and verified. Added server-validated canonical PNG storage, authenticated draft upload/read APIs, and immutable-manifest-scoped public asset reads. Public registration receives `dataDir`; existing V4 public manifest responses are unchanged.

## Interfaces and security behavior

- `storeLayoutPng(db, dataDir, venueId, bytes, opts?)` returns `{assetId,width,height,sha256,byteLength}`. The optional cancellation/timeout options are internal testable controls; IDs are SHA-256 of sanitized canonical PNG bytes.
- `POST /api/admin/venues/:venueId/layout-assets` accepts exactly one `image/png` multipart file; multipart transport caps one file, zero fields, and 20 MiB. `GET /api/admin/venues/:venueId/layout-assets/:assetId` requires admin auth and serves `image/png`, `nosniff`, `private, no-store`.
- `GET /api/venues/:venueId/versions/:version/assets/:assetId` serves only a registered venue-owned asset explicitly referenced by a valid stored V5 manifest, with claim metadata checked against the DB and bytes. Immutable response uses a one-year cache and ETag.
- PNG signature/decoder format, corruption, APNG animation, decoded dimensions (4096 max per axis and 16M pixels), and source size are checked. Canonicalization strips ancillary metadata; filesystem names are generated only from validated venue IDs and SHA-256 IDs. Reads recheck byte length and SHA-256.
- The additive registry tracks venue/hash, canonical dimensions, hash, and byte length. The per-venue quota is 256 MiB; existing hashes remain reusable. Native processing is limited to two active jobs, 30 seconds total per job, and cancellation destroys Sharp pipelines. Temp files are atomically renamed and cleaned on write failure.
- Cookie-authenticated write origin validation in the admin pre-handler applies regardless of content type.

## Tests and verification evidence

The task files and main implementation were already present as uncommitted task-scoped changes when this worker began, so I did not observe a clean-baseline RED run for those existing changes. Initial focused tests passed. The first typecheck/build exposed a TypeScript Sharp namespace type error; fixed with Sharp type imports. Added explicit timeout/cancellation-budget and venue-quota API tests.

- `npm test -- test/layout-assets.test.ts` — 14 tests passed.
- `npm test` — 12 files, 103 tests passed.
- `npm run typecheck` — passed.
- `npm run build` — passed.
- `npm ls @fastify/multipart sharp --depth=0` — `@fastify/multipart@10.1.3`, `sharp@0.35.5`.
- `git diff --check` — passed (Git printed only its existing LF-to-CRLF warning for `public.ts`).

Coverage includes unauthenticated access, foreign-origin multipart upload, MIME/signature mismatch, corrupt/APNG input, oversized upload and decoded dimensions/pixels, timeout and pre-cancel, quota enforcement, canonical deduplication, unknown venue/foreign asset/path traversal, draft cache headers/integrity, public manifest scoping, and forged metadata.

## Skills

Invoked and applied: `using-superpowers` (dispatched-worker exception), `test-driven-development`, `code-security-auditor` (static review of paths, dependency additions, parser and write protections), and `verification-before-completion`.

Other relevant skills available to later stages: `systematic-debugging`, `requesting-code-review`, `receiving-code-review`. UI, React, and browser skills do not apply to this backend-only task.

## Concerns / limitations

- A multi-process deployment sharing the same SQLite DB/filesystem needs the separately documented database-backed serialization/locking strategy; this task's synchronous quota/write section only serializes within one Node process.
- `npm audit` artifacts in the SDD directory predate this task and were not regenerated or used to force dependency upgrades.
