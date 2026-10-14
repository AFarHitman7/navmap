import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { normalizeVenueId } from './venue-id.js';
import { ensureVenue } from './venues.js';

export type LayoutAsset = {
  assetId: string;
  width: number;
  height: number;
  sha256: string;
  byteLength: number;
};

/** Source PNG uploads are capped at 20 MiB before decoding. */
export const LAYOUT_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
/** Decoded (and canonical) images stay within 4096 px per axis ... */
export const LAYOUT_MAX_DIMENSION = 4096;
/** ... and within 16,000,000 total pixels. Both limits apply. */
export const LAYOUT_MAX_PIXELS = 16_000_000;
/** Initial per-venue asset quota; new content beyond it is rejected with 413. */
export const LAYOUT_VENUE_QUOTA_BYTES = 256 * 1024 * 1024;
/** Native decode/re-encode budget per job. */
export const LAYOUT_PROCESS_TIMEOUT_MS = 30_000;
export const LAYOUT_MAX_CONCURRENT_JOBS = 2;
export const LAYOUT_ASSET_ID_RE = /^[0-9a-f]{64}$/;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

// ---------------------------------------------------------------------------
// Bounded decode job queue: at most two concurrent native Sharp jobs; excess
// upload requests are rejected with 429 instead of queueing unbounded work.
// ---------------------------------------------------------------------------

let activeDecodeJobs = 0;

function acquireDecodeSlot(): void {
  if (activeDecodeJobs >= LAYOUT_MAX_CONCURRENT_JOBS) {
    throw httpError(429, 'too many layout image jobs in flight');
  }
  activeDecodeJobs += 1;
}

function releaseDecodeSlot(): void {
  activeDecodeJobs = Math.max(0, activeDecodeJobs - 1);
}

/**
 * Detect an APNG `acTL` animation chunk before the first `IDAT` chunk with a
 * bounded chunk-header scan. Malformed headers return false and let the
 * native decoder reject the bytes.
 */
function hasAnimationChunk(bytes: Buffer): boolean {
  let offset = PNG_SIGNATURE.length;
  for (let i = 0; i < 64; i++) {
    if (offset + 8 > bytes.length) return false;
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') return true;
    if (type === 'IDAT') return false;
    if (!Number.isSafeInteger(length) || length > LAYOUT_SOURCE_MAX_BYTES) return false;
    offset += 12 + length;
  }
  return false;
}

export type DecodeOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

/**
 * Decode source bytes and re-encode them as canonical sanitized PNG bytes
 * (ancillary chunks and metadata stripped). Processing is bounded by the
 * native libvips timeout, and a watchdog destroys the Sharp pipeline on
 * timeout or caller abort — real cancellation and resource cleanup, not a
 * detached Promise.race. Dimensions and identity are derived from the stored
 * canonical bytes, never from client-supplied claims.
 */
export async function canonicalizeLayoutPng(
  source: Buffer,
  opts: DecodeOptions = {},
): Promise<{ bytes: Buffer; width: number; height: number }> {
  const timeoutMs = opts.timeoutMs ?? LAYOUT_PROCESS_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  if (opts.signal?.aborted) throw httpError(400, 'layout processing cancelled');
  if (source.length > LAYOUT_SOURCE_MAX_BYTES) {
    throw httpError(413, 'layout image exceeds the 20 MiB source limit');
  }
  if (source.length < PNG_SIGNATURE.length || !source.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw httpError(400, 'unsupported layout image');
  }
  if (hasAnimationChunk(source)) {
    throw httpError(400, 'animated layout images are not supported');
  }

  const runBounded = async <T>(make: () => Sharp, use: (image: Sharp) => Promise<T>): Promise<T> => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw httpError(503, 'layout processing timed out');
    const image = make();
    image.timeout({ seconds: Math.min(3600, Math.max(1, Math.ceil(remainingMs / 1000))) });
    // A destroyed pipeline emits 'error'; without a listener that emission is
    // an uncaught exception (a client disconnect would crash the server). The
    // awaiting operation still rejects through its own handlers.
    image.on('error', () => {});
    let timer: NodeJS.Timeout | undefined;
    const onAbort = (): void => {
      try {
        image.destroy(new Error('layout processing cancelled'));
      } catch {
        /* already settled */
      }
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    const watchdog = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const err = httpError(503, 'layout processing timed out');
        try {
          image.destroy(err);
        } catch {
          /* already settled */
        }
        reject(err);
      }, remainingMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([use(image), watchdog]);
    } finally {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  };

  let metadata: Metadata;
  try {
    metadata = await runBounded(
      () => sharp(source, { limitInputPixels: LAYOUT_MAX_PIXELS, animated: false }),
      (image) => image.metadata(),
    );
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode) throw err;
    throw httpError(400, 'unsupported layout image');
  }
  if (
    metadata.format !== 'png' ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > LAYOUT_MAX_DIMENSION ||
    metadata.height > LAYOUT_MAX_DIMENSION ||
    metadata.width * metadata.height > LAYOUT_MAX_PIXELS ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw httpError(400, 'unsupported layout image');
  }
  let canonical: Buffer;
  try {
    canonical = await runBounded(
      () => sharp(source, { limitInputPixels: LAYOUT_MAX_PIXELS, animated: false }),
      (image) => image.png().toBuffer(),
    );
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode) throw err;
    throw httpError(400, 'unsupported layout image');
  }
  // Authoritative geometry comes from re-reading the stored canonical bytes.
  let stored: Metadata;
  try {
    stored = await runBounded(
      () => sharp(canonical, { animated: false }),
      (image) => image.metadata(),
    );
  } catch {
    throw httpError(400, 'unsupported layout image');
  }
  if (stored.format !== 'png' || stored.width !== metadata.width || stored.height !== metadata.height) {
    throw httpError(400, 'unsupported layout image');
  }
  return { bytes: canonical, width: metadata.width, height: metadata.height };
}

/** Application-owned asset directory for one venue (no client paths). */
export function layoutAssetDir(dataDir: string, venueId: string): string {
  normalizeVenueId(venueId);
  return path.join(dataDir, 'layout-assets', venueId);
}

/** Application-owned file path for one asset (validated venue/hash IDs only). */
export function layoutAssetPath(dataDir: string, venueId: string, sha256: string): string {
  normalizeVenueId(venueId);
  if (!LAYOUT_ASSET_ID_RE.test(sha256)) throw httpError(404, 'unknown layout asset');
  return path.join(layoutAssetDir(dataDir, venueId), `${sha256}.png`);
}

/**
 * Validate, canonicalize, and persist a source PNG for a venue. The asset ID
 * is the SHA-256 of the canonical bytes, so repeated uploads of the same
 * image deduplicate to one registry row and one file. New content that would
 * push the venue past its 256 MiB quota is rejected with 413; already-stored
 * assets stay reusable. No client filename or path is persisted.
 */
export async function storeLayoutPng(
  db: DatabaseSync,
  dataDir: string,
  venueId: string,
  bytes: Buffer,
  opts: DecodeOptions = {},
): Promise<LayoutAsset> {
  normalizeVenueId(venueId);
  ensureVenue(db, venueId);
  if (bytes.length > LAYOUT_SOURCE_MAX_BYTES) {
    throw httpError(413, 'layout image exceeds the 20 MiB source limit');
  }
  acquireDecodeSlot();
  try {
    const { bytes: canonical, width, height } = await canonicalizeLayoutPng(bytes, opts);
    const sha256 = createHash('sha256').update(canonical).digest('hex');
    // Synchronous commit section (no awaits): quota check, atomic file
    // publish, and registry insert run to completion without interleaving.
    const existing = db
      .prepare('SELECT asset_id, width, height, sha256, byte_length FROM layout_assets WHERE venue_id = ? AND asset_id = ?')
      .get(venueId, sha256) as
      | { asset_id: string; width: number; height: number; sha256: string; byte_length: number }
      | undefined;
    if (!existing) {
      const usage = db
        .prepare('SELECT COALESCE(SUM(byte_length), 0) AS total FROM layout_assets WHERE venue_id = ?')
        .get(venueId) as { total: number };
      if (usage.total + canonical.length > LAYOUT_VENUE_QUOTA_BYTES) {
        throw httpError(413, 'venue layout asset quota exceeded');
      }
    }
    ensureAssetFile(dataDir, venueId, sha256, canonical);
    if (existing) {
      return {
        assetId: existing.asset_id,
        width: existing.width,
        height: existing.height,
        sha256: existing.sha256,
        byteLength: existing.byte_length,
      };
    }
    db.prepare(
      'INSERT OR IGNORE INTO layout_assets (venue_id, asset_id, width, height, sha256, byte_length) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(venueId, sha256, width, height, sha256, canonical.length);
    return { assetId: sha256, width, height, sha256, byteLength: canonical.length };
  } finally {
    releaseDecodeSlot();
  }
}

/** Publish canonical bytes with a temporary file plus atomic rename. */
function ensureAssetFile(dataDir: string, venueId: string, sha256: string, canonical: Buffer): void {
  const dir = layoutAssetDir(dataDir, venueId);
  fs.mkdirSync(dir, { recursive: true });
  const target = layoutAssetPath(dataDir, venueId, sha256);
  try {
    const current = fs.readFileSync(target);
    if (current.length === canonical.length && createHash('sha256').update(current).digest('hex') === sha256) {
      return;
    }
  } catch {
    /* missing or unreadable: (re)write below */
  }
  const tmp = path.join(dir, `.tmp-${randomUUID()}.png`);
  try {
    fs.writeFileSync(tmp, canonical, { flag: 'wx' });
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * Read an asset through validated DB ownership. Served bytes are integrity
 * checked against the registry (SHA-256 and length), so manifest or client
 * metadata can never claim dimensions or hashes different from stored bytes.
 */
export function readLayoutAsset(
  db: DatabaseSync,
  dataDir: string,
  venueId: string,
  assetId: string,
): { bytes: Buffer; asset: LayoutAsset } {
  normalizeVenueId(venueId);
  ensureVenue(db, venueId);
  if (!LAYOUT_ASSET_ID_RE.test(assetId)) throw httpError(404, 'unknown layout asset');
  const row = db
    .prepare('SELECT asset_id, width, height, sha256, byte_length FROM layout_assets WHERE venue_id = ? AND asset_id = ?')
    .get(venueId, assetId) as
    | { asset_id: string; width: number; height: number; sha256: string; byte_length: number }
    | undefined;
  if (!row) throw httpError(404, 'unknown layout asset');
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(layoutAssetPath(dataDir, venueId, row.sha256));
  } catch {
    throw httpError(404, 'unknown layout asset');
  }
  if (bytes.length !== row.byte_length || createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
    throw httpError(500, 'stored layout asset failed its integrity check');
  }
  return {
    bytes,
    asset: { assetId: row.asset_id, width: row.width, height: row.height, sha256: row.sha256, byteLength: row.byte_length },
  };
}
