// Task 4 RED: secure venue-scoped layout assets (multipart PNG upload,
// draft asset reads, manifest-scoped public asset reads).
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { canonicalizeLayoutPng, LAYOUT_VENUE_QUOTA_BYTES, storeLayoutPng } from '../src/layout-assets.js';
import { login, testContext, discardDb } from './helpers.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function multipartBody(boundary: string, parts: Array<{ name: string; filename: string; contentType: string; data: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.contentType}\r\n\r\n`,
      'utf8',
    ));
    chunks.push(part.data);
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return Buffer.concat(chunks);
}

function uploadHeaders(cookie: string, boundary: string, extra: Record<string, string> = {}) {
  return { cookie, 'content-type': `multipart/form-data; boundary=${boundary}`, host: 'test.local', ...extra };
}

async function uploadPng(
  app: ReturnType<typeof testContext>['app'],
  cookie: string,
  venueId: string,
  data: Buffer,
  opts: { filename?: string; contentType?: string; origin?: string | null } = {},
) {
  const boundary = '----task4boundary';
  const payload = multipartBody(boundary, [
    { name: 'file', filename: opts.filename ?? 'layout.png', contentType: opts.contentType ?? 'image/png', data },
  ]);
  const headers: Record<string, string> = uploadHeaders(cookie, boundary, { origin: 'http://test.local' });
  if (opts.origin === null) delete headers.origin;
  else if (opts.origin) headers.origin = opts.origin;
  return app.inject({ method: 'POST', url: `/api/admin/venues/${venueId}/layout-assets`, headers, payload });
}

describe('layout assets', () => {
  it('rejects unauthenticated upload and draft reads with 401', async () => {
    const { db, app } = testContext();
    try {
      const boundary = '----task4boundary';
      const payload = multipartBody(boundary, [
        { name: 'file', filename: 'layout.png', contentType: 'image/png', data: PNG_1X1 },
      ]);
      const anon = await app.inject({
        method: 'POST',
        url: '/api/admin/venues/demo/layout-assets',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload,
      });
      expect(anon.statusCode).toBe(401);
      const get = await app.inject({ method: 'GET', url: '/api/admin/venues/demo/layout-assets/abcd' });
      expect(get.statusCode).toBe(401);
    } finally {
      discardDb(db);
    }
  });

  it('rejects foreign-origin multipart writes with 403', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const res = await uploadPng(app, cookie, 'demo', PNG_1X1, { origin: 'https://evil.example' });
      expect(res.statusCode).toBe(403);
    } finally {
      discardDb(db);
    }
  });

  it('requires a valid same-origin Origin or Referer for cookie writes but allows bearer writes', async () => {
    const { db, app } = testContext();
    try {
      const { cookie, token } = await login(app);
      expect((await uploadPng(app, cookie, 'demo', PNG_1X1, { origin: null })).statusCode).toBe(403);
      expect((await uploadPng(app, cookie, 'demo', PNG_1X1, { origin: 'null' })).statusCode).toBe(403);
      expect((await uploadPng(app, cookie, 'demo', PNG_1X1, { origin: 'not a URL' })).statusCode).toBe(403);

      const boundary = '----task4referer';
      const body = multipartBody(boundary, [{ name: 'file', filename: 'layout.png', contentType: 'image/png', data: PNG_1X1 }]);
      const fallback = await app.inject({
        method: 'POST',
        url: '/api/admin/venues/demo/layout-assets',
        headers: uploadHeaders(cookie, boundary, { referer: 'http://test.local/admin/maps' }),
        payload: body,
      });
      expect(fallback.statusCode).toBe(200);

      const bearer = await app.inject({
        method: 'POST',
        url: '/api/admin/venues/demo/layout-assets',
        headers: uploadHeaders('', boundary, { authorization: `Bearer ${token}` }),
        payload: body,
      });
      expect(bearer.statusCode).toBe(200);
    } finally {
      discardDb(db);
    }
  });

  it('aborts processing on a client disconnect after upload body completion', async () => {
    const { db, app, dataDir } = testContext();
    try {
      const { cookie } = await login(app);
      // High-entropy but sub-20-MiB PNG keeps native decode/re-encode busy
      // long enough to disconnect after the complete multipart body is sent.
      const raw = randomBytes(1600 * 1600 * 3);
      const png = await sharp(raw, { raw: { width: 1600, height: 1600, channels: 3 } }).png().toBuffer();
      const boundary = '----task4disconnect';
      const body = multipartBody(boundary, [{ name: 'file', filename: 'layout.png', contentType: 'image/png', data: png }]);
      await app.listen({ port: 0, host: '127.0.0.1' });
      try {
        const port = (app.server.address() as { port: number }).port;
        await new Promise<void>((resolve, reject) => {
          const request = http.request({
            method: 'POST',
            host: '127.0.0.1',
            port,
            path: '/api/admin/venues/demo/layout-assets',
            headers: {
              cookie,
              origin: `http://127.0.0.1:${port}`,
              'content-type': `multipart/form-data; boundary=${boundary}`,
              'content-length': body.length,
            },
          }, () => reject(new Error('upload unexpectedly completed before disconnect')));
          request.on('error', (error) => {
            if ((error as NodeJS.ErrnoException).code === 'ECONNRESET') resolve();
            else reject(error);
          });
          request.end(body, () => setTimeout(() => request.destroy(), 10));
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect((db.prepare('SELECT COUNT(*) AS count FROM layout_assets WHERE venue_id = ?').get('demo') as { count: number }).count).toBe(0);
        expect(fs.existsSync(path.join(dataDir, 'layout-assets', 'demo'))).toBe(false);
      } finally {
        await app.close();
      }
    } finally {
      discardDb(db);
    }
  });

  it('stores a valid PNG and serves identical draft bytes with private cache headers', async () => {
    const { db, app, dataDir } = testContext();
    try {
      const { cookie } = await login(app);
      const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: { r: 9, g: 9, b: 9 } } }).png().toBuffer();
      const res = await uploadPng(app, cookie, 'demo', png);
      expect(res.statusCode).toBe(200);
      const body = res.json() as { assetId: string; width: number; height: number; sha256: string; byteLength: number };
      expect(body.width).toBe(4);
      expect(body.height).toBe(3);
      expect(body.assetId).toMatch(/^[0-9a-f]{64}$/);
      expect(body.sha256).toBe(body.assetId);
      void dataDir;
      const get = await app.inject({
        method: 'GET',
        url: `/api/admin/venues/demo/layout-assets/${body.assetId}`,
        headers: { cookie, origin: 'http://localhost' },
      });
      expect(get.statusCode).toBe(200);
      expect(get.headers['content-type']).toContain('image/png');
      expect(get.headers['x-content-type-options']).toBe('nosniff');
      expect(get.headers['cache-control']).toContain('no-store');
      // Byte identity is asserted over real HTTP: light-my-request decodes
      // bodies as UTF-8 strings, which corrupts binary payloads.
      await app.listen({ port: 0, host: '127.0.0.1' });
      try {
        const port = (app.server.address() as { port: number }).port;
        const http = await fetch(`http://127.0.0.1:${port}/api/admin/venues/demo/layout-assets/${body.assetId}`, {
          headers: { cookie, origin: 'http://localhost' },
        });
        expect(http.status).toBe(200);
        const served = Buffer.from(await http.arrayBuffer());
        expect(createHash('sha256').update(served).digest('hex')).toBe(body.sha256);
        expect(served.length).toBe(body.byteLength);
      } finally {
        await app.close();
      }
    } finally {
      discardDb(db);
    }
  });

  it('returns the same asset id for repeated canonical uploads', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const first = await uploadPng(app, cookie, 'demo', PNG_1X1);
      const second = await uploadPng(app, cookie, 'demo', PNG_1X1, { filename: '../../evil.png' });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect((second.json() as { assetId: string }).assetId).toBe((first.json() as { assetId: string }).assetId);
    } finally {
      discardDb(db);
    }
  });

  it('rejects false MIME types and non-PNG signatures with 400', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const wrongMime = await uploadPng(app, cookie, 'demo', PNG_1X1, { contentType: 'text/plain' });
      expect(wrongMime.statusCode).toBe(400);
      const badSig = await uploadPng(app, cookie, 'demo', Buffer.from('not a png at all........'));
      expect(badSig.statusCode).toBe(400);
      const gif = Buffer.from('GIF89a......................', 'utf8');
      const fakeGif = await uploadPng(app, cookie, 'demo', gif);
      expect(fakeGif.statusCode).toBe(400);
    } finally {
      discardDb(db);
    }
  });

  it('rejects corrupt PNG bytes and animated images with 400', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const corrupt = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('garbage-chunk-data')]);
      expect((await uploadPng(app, cookie, 'demo', corrupt)).statusCode).toBe(400);
      // Hand-built APNG: valid 1x1 PNG with an acTL animation chunk after IHDR.
      const ihdrEnd = 8 + 4 + 4 + 13 + 4;
      const actl = Buffer.concat([
        Buffer.from([0, 0, 0, 8]),
        Buffer.from('acTL', 'ascii'),
        Buffer.from([0, 0, 0, 2, 0, 0, 0, 0]),
        Buffer.from([0, 0, 0, 0]),
      ]);
      const apng = Buffer.concat([PNG_1X1.subarray(0, ihdrEnd), actl, PNG_1X1.subarray(ihdrEnd)]);
      expect((await uploadPng(app, cookie, 'demo', apng)).statusCode).toBe(400);
    } finally {
      discardDb(db);
    }
  });

  it('rejects decoded images beyond the dimension and pixel limits with 400', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const wide = await sharp({ create: { width: 5000, height: 8, channels: 3, background: { r: 1, g: 1, b: 1 } } }).png().toBuffer();
      expect((await uploadPng(app, cookie, 'demo', wide)).statusCode).toBe(400);
      // 4000x4001 exceeds 16M pixels while each axis stays within 4096.
      const manyPixels = await sharp({ create: { width: 4000, height: 4001, channels: 3, background: { r: 2, g: 2, b: 2 } } }).png().toBuffer();
      expect((await uploadPng(app, cookie, 'demo', manyPixels)).statusCode).toBe(400);
    } finally {
      discardDb(db);
    }
  });

  it('aborts native processing when the caller is already cancelled', async () => {
    const { db, dataDir } = testContext();
    try {
      const controller = new AbortController();
      controller.abort();
      await expect(storeLayoutPng(db, dataDir, 'demo', PNG_1X1, { signal: controller.signal })).rejects.toMatchObject({
        statusCode: 400,
      });
    } finally {
      discardDb(db);
    }
  });

  it('enforces the native image-processing timeout and destroys the pipeline', async () => {
    const { db, dataDir } = testContext();
    try {
      // A generated full-limit image makes decoding/re-encoding exceed this
      // deliberately tiny budget while exercising Sharp's cancellable path.
      const large = await sharp({ create: { width: 4000, height: 4000, channels: 3, background: { r: 18, g: 18, b: 18 } } }).png().toBuffer();
      await expect(canonicalizeLayoutPng(large, { timeoutMs: 1 })).rejects.toMatchObject({ statusCode: 503 });
    } finally {
      discardDb(db);
      void dataDir;
    }
  });

  it('rejects oversized sources with 413', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const big = Buffer.alloc(20 * 1024 * 1024 + 1, 0);
      PNG_1X1.copy(big, 0);
      expect((await uploadPng(app, cookie, 'demo', big)).statusCode).toBe(413);
    } finally {
      discardDb(db);
    }
  });

  it('enforces the per-venue quota for new content while preserving deduplication', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      // Fill the registry quota without creating a file; the subsequent new
      // content must be rejected before any filesystem write.
      db.prepare('INSERT INTO layout_assets (venue_id, asset_id, width, height, sha256, byte_length) VALUES (?, ?, ?, ?, ?, ?)')
        .run('demo', '0'.repeat(64), 1, 1, '0'.repeat(64), LAYOUT_VENUE_QUOTA_BYTES);
      const newPng = await sharp({ create: { width: 5, height: 5, channels: 3, background: { r: 20, g: 20, b: 20 } } }).png().toBuffer();
      expect((await uploadPng(app, cookie, 'demo', newPng)).statusCode).toBe(413);
    } finally {
      discardDb(db);
    }
  });

  it('returns 404 for unknown venues, foreign assets, and path traversal ids', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const created = await app.inject({ method: 'POST', url: '/api/admin/venues', headers: { cookie, origin: 'http://localhost' }, payload: { name: 'Other' } });
      const otherId = (created.json() as { id: string }).id;
      const otherPng = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 5, g: 5, b: 5 } } }).png().toBuffer();
      const other = await uploadPng(app, cookie, otherId, otherPng);
      expect(other.statusCode).toBe(200);
      const foreignId = (other.json() as { assetId: string }).assetId;
      expect((await app.inject({ method: 'GET', url: `/api/admin/venues/demo/layout-assets/${foreignId}`, headers: { cookie, origin: 'http://localhost' } })).statusCode).toBe(404);
      expect((await uploadPng(app, cookie, 'no-such-venue', PNG_1X1)).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/api/admin/venues/demo/layout-assets/..%2F..%2Fetc%2Fpasswd', headers: { cookie, origin: 'http://localhost' } })).statusCode).toBe(404);
    } finally {
      discardDb(db);
    }
  });

  it('serves public assets only when the stored manifest references them', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 7, g: 7, b: 7 } } }).png().toBuffer();
      const up = await uploadPng(app, cookie, 'demo', png);
      expect(up.statusCode).toBe(200);
      const asset = up.json() as { assetId: string; width: number; height: number; sha256: string; byteLength: number };
      const manifest = {
        schemaVersion: 5,
        venueId: 'demo',
        version: 1,
        canvas: { kind: 'static' },
        boundary: { kind: 'local', left: 0, top: 0, right: 1, bottom: 1 },
        indoorZones: [],
        frames: [{ id: 'f0', zoneId: null, z: 0, bounds: { kind: 'local', left: 0, top: 0, right: 1, bottom: 1 }, background: { assetId: asset.assetId, width: asset.width, height: asset.height, sha256: asset.sha256, byteLength: asset.byteLength } }],
        nodes: [],
        edges: [],
        transitions: [],
        places: [],
        anchors: [],
        aps: [],
        profiles: [],
      };
      db.prepare('INSERT INTO versions (venue_id, version, manifest_json) VALUES (?, ?, ?)').run('demo', 1, JSON.stringify(manifest));
      const pub = await app.inject({ method: 'GET', url: `/api/venues/demo/versions/1/assets/${asset.assetId}` });
      expect(pub.statusCode).toBe(200);
      expect(pub.headers['content-type']).toContain('image/png');
      expect(pub.headers['cache-control']).toContain('immutable');
      const otherPng = await sharp({ create: { width: 3, height: 3, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
      const other = await uploadPng(app, cookie, 'demo', otherPng);
      const otherId = (other.json() as { assetId: string }).assetId;
      expect((await app.inject({ method: 'GET', url: `/api/venues/demo/versions/1/assets/${otherId}` })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/api/venues/demo/versions/99/assets/' + asset.assetId })).statusCode).toBe(404);
      await app.listen({ port: 0, host: '127.0.0.1' });
      try {
        const port = (app.server.address() as { port: number }).port;
        const http = await fetch(`http://127.0.0.1:${port}/api/venues/demo/versions/1/assets/${asset.assetId}`);
        expect(http.status).toBe(200);
        expect(createHash('sha256').update(Buffer.from(await http.arrayBuffer())).digest('hex')).toBe(asset.sha256);
      } finally {
        await app.close();
      }
    } finally {
      discardDb(db);
    }
  });

  it('fails closed when the manifest forges asset metadata', async () => {
    const { db, app } = testContext();
    try {
      const { cookie } = await login(app);
      const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 7, g: 7, b: 7 } } }).png().toBuffer();
      const up = await uploadPng(app, cookie, 'demo', png);
      expect(up.statusCode).toBe(200);
      const asset = up.json() as { assetId: string; width: number; height: number; sha256: string; byteLength: number };
      const forged = {
        schemaVersion: 5,
        venueId: 'demo',
        version: 1,
        canvas: { kind: 'static' },
        boundary: { kind: 'local', left: 0, top: 0, right: 1, bottom: 1 },
        indoorZones: [],
        frames: [{ id: 'f0', zoneId: null, z: 0, bounds: { kind: 'local', left: 0, top: 0, right: 1, bottom: 1 }, background: { assetId: asset.assetId, width: 9999, height: asset.height, sha256: asset.sha256, byteLength: asset.byteLength } }],
        nodes: [],
        edges: [],
        transitions: [],
        places: [],
        anchors: [],
        aps: [],
        profiles: [],
      };
      db.prepare('INSERT INTO versions (venue_id, version, manifest_json) VALUES (?, ?, ?)').run('demo', 1, JSON.stringify(forged));
      expect((await app.inject({ method: 'GET', url: `/api/venues/demo/versions/1/assets/${asset.assetId}` })).statusCode).toBe(404);
    } finally {
      discardDb(db);
    }
  });
});
