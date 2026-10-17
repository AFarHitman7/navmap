import { decodeBase64, downloadPack, encodeBase64, loadActivePack, readFrameBackground, type PackAdapter } from '../src/pack';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5';

test.each([
  [new Uint8Array([]), ''],
  [new Uint8Array([77]), 'TQ=='],
  [new Uint8Array([77, 97]), 'TWE='],
  [new Uint8Array([77, 97, 110]), 'TWFu'],
])('binary pack bytes encode and decode as base64', (bytes, encoded) => {
  expect(encodeBase64(bytes)).toBe(encoded);
  expect(decodeBase64(encoded)).toEqual(bytes);
});

function adapterFor(manifest: unknown, assets: Record<string, Uint8Array> = {}) {
  const text = new Map<string, string>();
  const binary = new Map<string, Uint8Array>();
  const adapter: PackAdapter = {
    getJson: async (url) => url.endsWith('/latest') ? { version: 4 } : manifest,
    getBytes: async (url) => { const bytes = assets[url]; if (!bytes) throw new Error('missing/corrupt asset'); return bytes; },
    writeFile: async (path, data) => { text.set(path, data); },
    readFile: async (path) => { const value = text.get(path); if (!value) throw new Error('ENOENT'); return value; },
    writeBytes: async (path, bytes) => { binary.set(path, bytes); },
    readBytes: async (path) => { const value = binary.get(path); if (!value) throw new Error('missing local file'); return value; },
    hashBytes: async (bytes) => bytes[0] === 7 ? '7'.repeat(64) : '8'.repeat(64),
    rename: async (from, to) => {
      for (const [path, data] of [...text]) if (path === from || path.startsWith(`${from}/`)) { text.set(path.replace(from, to), data); text.delete(path); }
      for (const [path, data] of [...binary]) if (path === from || path.startsWith(`${from}/`)) { binary.set(path.replace(from, to), data); binary.delete(path); }
    },
    rmrf: async (path) => {
      for (const file of [...text.keys()]) if (file === path || file.startsWith(`${path}/`)) text.delete(file);
      for (const file of [...binary.keys()]) if (file === path || file.startsWith(`${path}/`)) binary.delete(file);
    },
  };
  return { adapter, text, binary };
}

test('offline static pack verifies every PNG and serves active frame bytes', async () => {
  const raw = { ...staticDraft(), frames: staticDraft().frames.map((frame) => frame.background ? ({ ...frame, background: { ...frame.background, sha256: '7'.repeat(64), byteLength: 1 } }) : frame) };
  const manifest = { ...raw, venueId: 'venue', version: 4, profiles: [] };
  const bytes = new Uint8Array([7]);
  const assets = Object.fromEntries(raw.frames.flatMap((frame) => frame.background ? [[`https://api.test/api/venues/venue/versions/4/assets/${frame.background.assetId}`, bytes]] : []));
  const { adapter, binary } = adapterFor(manifest, assets);
  await downloadPack('venue', 0, adapter, 'https://api.test');
  const active = await loadActivePack('venue', adapter);
  expect(binary.size).toBe(raw.frames.filter((frame) => frame.background).length);
  expect(await readFrameBackground(active!, raw.frames[0]!.id, adapter)).toEqual(bytes);
});

test.each(['missing', 'wrong-hash'])('failed static asset %s keeps prior active pack and files', async (fault) => {
  const previous = { ...geographicDraft(), venueId: 'venue', version: 1, profiles: [] };
  const next = { ...staticDraft(), venueId: 'venue', version: 4, profiles: [], frames: staticDraft().frames.map((frame) => frame.background ? ({ ...frame, background: { ...frame.background, sha256: '7'.repeat(64), byteLength: 1 } }) : frame) };
  const backgrounds = next.frames.flatMap((frame) => frame.background ? [frame.background] : []);
  const assets = Object.fromEntries(backgrounds.flatMap((background, index) => {
    if (fault === 'missing' && index > 0) return [];
    const value = fault === 'wrong-hash' && index > 0 ? new Uint8Array([8]) : new Uint8Array([7]);
    return [[`https://api.test/api/venues/venue/versions/4/assets/${background.assetId}`, value]];
  }));
  const { adapter, text, binary } = adapterFor(next, assets);
  text.set('packs/venue/active.json', JSON.stringify({ activeVersion: 1 }));
  text.set('packs/venue/1/manifest.json', JSON.stringify(previous));
  await expect(downloadPack('venue', 0, adapter, 'https://api.test')).rejects.toThrow(/asset|integrity/i);
  expect(JSON.parse(text.get('packs/venue/active.json')!)).toEqual({ activeVersion: 1 });
  expect(binary.size).toBe(0);
  expect((await loadActivePack('venue', adapter))?.version).toBe(1);
});

test('unsupported and corrupt active pack data is recoverable and never triggers venue deletion', async () => {
  const { adapter, text } = adapterFor({ schemaVersion: 999 });
  text.set('packs/venue/active.json', JSON.stringify({ activeVersion: 1 }));
  text.set('packs/venue/1/manifest.json', JSON.stringify({ schemaVersion: 999 }));
  await expect(loadActivePack('venue', adapter)).rejects.toThrow(/manifest|schema/i);
  expect(text.has('packs/venue/active.json')).toBe(true);
});
