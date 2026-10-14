// Task 2: native pack readers stay real for V5 (V4 bytes untouched).
import { describe, expect, it } from '@jest/globals';
import { downloadPack, loadActivePack, parsePackManifest } from '../src/pack';
import type { PackAdapter } from '../src/pack';
import { geographicDraft } from '../src/fixtures/map-v5';

function memoryAdapter(routes: Record<string, unknown>): PackAdapter & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
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
    rename: async (from: string, to: string) => {
      for (const [k, v] of [...files]) {
        if (k === from || k.startsWith(`${from}/`)) {
          files.set(k.replace(from, to), v);
          files.delete(k);
        }
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
});
