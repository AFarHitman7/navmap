// Task 2: native pack readers stay real for V5 (V4 bytes untouched).
import { describe, expect, it } from '@jest/globals';
import { downloadPack, loadActivePack, parsePackManifest } from '../src/pack';
import type { PackAdapter } from '../src/pack';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5';

function memoryAdapter(routes: Record<string, unknown>, assets: Record<string, Uint8Array> = {}): PackAdapter & { files: Map<string, string>; bytes: Map<string, Uint8Array> } {
  const files = new Map<string, string>();
  const bytes = new Map<string, Uint8Array>();
  return {
    files,
    bytes,
    getJson: async (url: string) => {
      if (!(url in routes)) throw new Error(`no route ${url}`);
      return routes[url];
    },
    writeFile: async (path: string, data: string) => {
      files.set(path, data);
    },
    readFile: async (path: string) => {
      const data = files.get(path);
      if (data === undefined) throw new Error(`missing ${path}`);
      return data;
    },
    getBytes: async (url: string) => {
      const asset = assets[url];
      if (!asset) throw new Error(`missing asset ${url}`);
      return asset;
    },
    writeBytes: async (path: string, data: Uint8Array) => { bytes.set(path, data); },
    readBytes: async (path: string) => {
      const data = bytes.get(path);
      if (!data) throw new Error(`missing ${path}`);
      return data;
    },
    hashBytes: async (data: Uint8Array) => data[0] === 1 ? 'a'.repeat(64) : 'b'.repeat(64),
    rename: async (from: string, to: string) => {
      for (const [k, v] of [...files]) {
        if (k === from || k.startsWith(`${from}/`)) {
          files.set(k.replace(from, to), v);
          files.delete(k);
        }
      }
      for (const [k, v] of [...bytes]) {
        if (k === from || k.startsWith(`${from}/`)) { bytes.set(k.replace(from, to), v); bytes.delete(k); }
      }
    },
    rmrf: async (path: string) => {
      for (const k of [...files.keys()]) {
        if (k === path || k.startsWith(`${path}/`)) files.delete(k);
      }
    },
  };
}

describe('native V5 pack readers', () => {
  it('downloads and reloads a V5 geographic pack', async () => {
    const manifest = { ...geographicDraft(), venueId: 'demo', version: 2, profiles: [] };
    const adapter = memoryAdapter({
      'http://x/api/venues/demo/latest': { version: 2 },
      'http://x/api/venues/demo/versions/2/manifest': manifest,
    });
    const downloaded = await downloadPack('demo', 0, adapter, 'http://x');
    expect(downloaded.schemaVersion).toBe(5);
    if (downloaded.schemaVersion !== 5) throw new Error('expected V5');
    expect(downloaded.canvas).toEqual({ kind: 'geographic' });
    expect(downloaded.transitions).toHaveLength(2);
    const active = await loadActivePack('demo', adapter);
    expect(active?.schemaVersion).toBe(5);
    expect(active?.version).toBe(2);
  });

  it('parses V5 through the shared reader without rewriting V4', () => {
    const parsed = parsePackManifest({ ...geographicDraft(), venueId: 'demo', version: 1, profiles: [] });
    expect(parsed.schemaVersion).toBe(5);
  });

  it('downloads, verifies, stages and reloads each static background', async () => {
    const baseManifest = staticDraft();
    const manifest = { ...baseManifest, venueId: 'demo', version: 3, profiles: [], frames: baseManifest.frames.map((f, i) => ({
      ...f, background: { assetId: `asset-${i}`, width: 100, height: 80, sha256: 'a'.repeat(64), byteLength: 1 },
    })) };
    const assets = Object.fromEntries(manifest.frames.map((f) => [`http://x/api/venues/demo/versions/3/assets/${f.background.assetId}`, new Uint8Array([1])]));
    const adapter = memoryAdapter({
      'http://x/api/venues/demo/latest': { version: 3 },
      'http://x/api/venues/demo/versions/3/manifest': manifest,
    }, assets);
    await downloadPack('demo', 0, adapter, 'http://x');
    const loaded = await loadActivePack('demo', adapter);
    expect(loaded?.schemaVersion).toBe(5);
    expect(adapter.bytes.size).toBe(manifest.frames.filter((frame) => frame.background).length);
  });

  it('retains the previous active version when a referenced static image is missing or corrupt', async () => {
    const adapter = memoryAdapter({
      'http://x/api/venues/demo/latest': { version: 2 },
      'http://x/api/venues/demo/versions/2/manifest': {
        ...staticDraft(), venueId: 'demo', version: 2, profiles: [],
        frames: staticDraft().frames.map((f) => ({ ...f, background: { assetId: 'asset-x', width: 100, height: 80, sha256: 'a'.repeat(64), byteLength: 2 } })),
      },
    });
    adapter.files.set('packs/demo/active.json', JSON.stringify({ activeVersion: 1 }));
    adapter.files.set('packs/demo/1/manifest.json', JSON.stringify({ ...geographicDraft(), venueId: 'demo', version: 1, profiles: [] }));
    await expect(downloadPack('demo', 0, adapter, 'http://x')).rejects.toThrow();
    expect(JSON.parse(adapter.files.get('packs/demo/active.json')!)).toEqual({ activeVersion: 1 });
    expect((await loadActivePack('demo', adapter))?.version).toBe(1);
  });
});
