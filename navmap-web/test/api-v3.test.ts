import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDraftV3, getPublishedManifestV3, publishV3, postNodeSamples, saveDraftV3 } from '../src/api-v3';
import fixture from '../src/fixtures/unified-v3.json';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  (globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
}

describe('v3 api client', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('rejects mismatched published manifests and invalid latest versions', async () => {
    mockFetch((url) => jsonResponse(url.endsWith('/latest') ? { venueId: 'demo', version: 1 }
      : { ...fixture, venueId: 'other', version: 1, profiles: [] }));
    await expect(getPublishedManifestV3()).rejects.toThrow('wrong published map');
    mockFetch(() => jsonResponse({ venueId: 'demo', version: 0 }));
    await expect(getPublishedManifestV3()).rejects.toThrow('invalid published version');
  });

  it('fetches and parses the v4 draft for a venue via the v3-named endpoint', async () => {
    const seen: string[] = [];
    mockFetch((url) => {
      seen.push(url);
      return jsonResponse(fixture);
    });
    const draft = await getDraftV3('demo');
    expect(draft.schemaVersion).toBe(4);
    expect(seen).toEqual(['/api/admin/venues/demo/draft-v3']);
  });

  it('saves the draft and posts node samples', async () => {
    const seen: Array<{ url: string; method?: string }> = [];
    mockFetch((url, init) => {
      seen.push({ url, method: init?.method });
      if (url.endsWith('/node-samples')) return jsonResponse({ count: 3 });
      return jsonResponse(fixture);
    });
    await saveDraftV3(fixture as never, 'demo');
    const result = await postNodeSamples('demo', 'n1', [
      { nodeId: 'n1', fingerprintRevision: 1, capturedAt: 1, readings: [{ bssid: 'AA:BB:CC:DD:EE:01', rssi: -50 }] },
    ]);
    expect(result).toBe(3);
    expect(seen.map((s) => s.url)).toEqual([
      '/api/admin/venues/demo/draft-v3',
      '/api/admin/venues/demo/node-samples',
    ]);
  });

  it('publishes and surfaces validation issues', async () => {
    mockFetch(() => jsonResponse({ ...fixture, version: 1, profiles: [] }));
    const result = await publishV3('demo');
    expect(result.manifest.version).toBe(1);
      const { PublishValidationError } = await import('../src/api-v3');
    mockFetch(() => jsonResponse({ error: 'bad', errors: ['venue needs an outdoor boundary'] }, 400));
    await expect(publishV3('demo')).rejects.toBeInstanceOf(PublishValidationError);
  });
});
