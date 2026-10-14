import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMap, listMaps, renameMap } from '../src/api-v3';

describe('named map storage API', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('uses stable IDs for list, create, and rename regardless of duplicate names', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'POST') return Response.json({ id: 'id-1', name: 'Atrium', latestVersion: 0 });
      if (init?.method === 'PATCH') return Response.json({ id: 'id-1', name: 'Atrium East', latestVersion: 0 });
      return Response.json([{ id: 'id-1', name: 'Atrium', latestVersion: 0 }, { id: 'id-2', name: 'Atrium', latestVersion: 2 }]);
    }));
    const maps = await listMaps();
    const created = await createMap('Atrium', 'geographic');
    const renamed = await renameMap(created.id, 'Atrium East');
    expect(maps.map((map) => map.id)).toEqual(['id-1', 'id-2']);
    expect(renamed).toMatchObject({ id: 'id-1', name: 'Atrium East' });
    expect(calls[2].url).toBe('/api/admin/venues/id-1');
    vi.unstubAllGlobals();
  });
});
