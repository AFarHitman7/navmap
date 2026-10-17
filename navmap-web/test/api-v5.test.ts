// Task 2: capability gate + V5 client endpoints (V4 client untouched).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCapabilities,
  getDraftV5,
  isV5AuthoringEnabled,
  publishV5,
  saveDraftV5,
} from '../src/api-v3';
import { geographicDraft } from '../src/fixtures/map-v5';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  (globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
}

describe('v5 api client gate', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('reads the capability flag and defaults closed on transport errors', async () => {
    mockFetch((url) => {
      expect(url).toBe('/api/capabilities');
      return jsonResponse({ mapV5AuthoringEnabled: true });
    });
    expect(await getCapabilities()).toEqual({ mapV5AuthoringEnabled: true });
    expect(await isV5AuthoringEnabled()).toBe(true);
    mockFetch(() => {
      throw new Error('offline');
    });
    expect(await isV5AuthoringEnabled()).toBe(false);
  });

  it('refuses V5 saves while the flag is disabled', async () => {
    const seen: string[] = [];
    mockFetch((url) => {
      seen.push(url);
      return jsonResponse({ mapV5AuthoringEnabled: false });
    });
    await expect(saveDraftV5(geographicDraft())).rejects.toThrow(/disabled/);
    await expect(publishV5()).rejects.toThrow(/disabled/);
    expect(seen).toEqual(['/api/capabilities', '/api/capabilities']);
  });

  it('saves and publishes V5 once enabled', async () => {
    const draft = { ...geographicDraft(), venueId: 'demo' };
    const seen: string[] = [];
    mockFetch((url) => {
      seen.push(url);
      if (url === '/api/capabilities') return jsonResponse({ mapV5AuthoringEnabled: true });
      if (url.endsWith('/publish-v3')) return jsonResponse({ ...draft, version: 1, profiles: [] });
      return jsonResponse(draft);
    });
    expect((await saveDraftV5(draft, 'demo')).schemaVersion).toBe(5);
    const result = await publishV5('demo');
    expect(result.manifest.schemaVersion).toBe(5);
    expect(result.downloadUrl).toBe('/api/venues/demo/versions/1/manifest');
    const fetched = await getDraftV5('demo');
    expect(fetched.canvas).toEqual({ kind: 'geographic' });
    expect(seen).toContain('/api/capabilities');
  });
});
