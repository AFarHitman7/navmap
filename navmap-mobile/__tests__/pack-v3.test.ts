import { downloadPack, loadActivePack, type PackAdapter } from '../src/pack';
import type { ManifestV3 } from '../src/contract-v3';

const V4_MANIFEST: ManifestV3 = {
  schemaVersion: 4,
  venueId: 'demo',
  version: 1,
  boundary: { north: 13.1, south: 13.0, east: 80.3, west: 80.2 },
  indoorZones: [
    {
      id: 'b-a',
      name: 'Building A',
      bounds: { north: 13.08, south: 13.02, east: 80.28, west: 80.22 },
      floors: [
        { z: 0, label: 'Ground' },
        { z: 1, label: 'Level 1' },
      ],
    },
  ],
  nodes: [{ id: 'n1', name: 'Outdoor lobby node', lat: 13.05, lng: 80.25, z: 0, zoneId: null, fingerprintRevision: 1 }],
  edges: [],
  places: [{ id: 'lobby', name: 'Lobby', zoneId: 'b-a', nodeId: 'n1' }],
  anchors: [],
  aps: [],
  profiles: [],
};

function memoryAdapter(getManifest: (version: number) => unknown): PackAdapter & { files: Map<string, string> } {
  const files = new Map<string, string>();
  const bytes = new Map<string, Uint8Array>();
  return {
    files,
    getBytes: async () => { throw new Error('unexpected asset request'); },
    writeBytes: async (path: string, data: Uint8Array) => { bytes.set(path, data); },
    readBytes: async (path: string) => { const value = bytes.get(path); if (!value) throw new Error(`ENOENT ${path}`); return value; },
    hashBytes: async () => '0'.repeat(64),
    getJson: async (url: string) => {
      if (url.endsWith('/latest')) return { version: 1 };
      const m = /\/versions\/(\d+)\/manifest/.exec(url);
      return getManifest(Number(m?.[1] ?? 1));
    },
    rename: async (from: string, to: string) => {
      for (const [k, v] of [...files]) {
        if (k === from || k.startsWith(from + '/')) {
          files.set(to + k.slice(from.length), v);
          files.delete(k);
        }
      }
    },
    writeFile: async (path: string, data: string) => {
      files.set(path, data);
    },
    readFile: async (path: string) => {
      const v = files.get(path);
      if (v === undefined) throw new Error(`ENOENT ${path}`);
      return v;
    },
    rmrf: async (path: string) => {
      for (const k of [...files.keys()]) {
        if (k === path || k.startsWith(path + '/')) files.delete(k);
      }
    },
  };
}

test('v4 manifest pack activates with no raster assets', async () => {
  const adapter = memoryAdapter((v) => ({ ...V4_MANIFEST, version: v }));
  const manifest = await downloadPack('demo', 1, adapter, 'http://x');
  expect((manifest as unknown as ManifestV3).schemaVersion).toBe(4);
  expect(JSON.parse(adapter.files.get('packs/demo/active.json')!)).toEqual({ activeVersion: 1 });
  expect(JSON.parse(adapter.files.get('packs/demo/1/manifest.json')!)).toMatchObject({ schemaVersion: 4 });
  const active = await loadActivePack('demo', adapter);
  expect((active as unknown as ManifestV3 | null)?.schemaVersion).toBe(4);
  expect((active as unknown as ManifestV3 | null)?.version).toBe(1);
});

test('corrupt v4 manifest keeps the old active version', async () => {
  const adapter = memoryAdapter((v) =>
    v === 1 ? { ...V4_MANIFEST, version: 1 } : { nope: 'not a manifest' },
  );
  await downloadPack('demo', 1, adapter, 'http://x');
  expect(((await loadActivePack('demo', adapter)) as unknown as ManifestV3)?.version).toBe(1);
  await expect(downloadPack('demo', 2, adapter, 'http://x')).rejects.toThrow(/manifest|draftV3/i);
  expect(((await loadActivePack('demo', adapter)) as unknown as ManifestV3)?.version).toBe(1);
  expect(JSON.parse(adapter.files.get('packs/demo/active.json')!)).toEqual({ activeVersion: 1 });
});

test.each([1, 2])('a saved unsupported schema V%s pack is rejected without deleting local data', async (schemaVersion) => {
  const adapter = memoryAdapter(() => ({ schemaVersion }));
  adapter.files.set('packs/demo/active.json', JSON.stringify({ activeVersion: 1 }));
  adapter.files.set('packs/demo/1/manifest.json', JSON.stringify({ schemaVersion }));
  await expect(loadActivePack('demo', adapter)).rejects.toThrow(/unsupported|manifest/i);
  expect(adapter.files.has('packs/demo/active.json')).toBe(true);
});
