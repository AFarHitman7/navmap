import type { APIRequestContext } from '@playwright/test';

/**
 * Shared admin API helpers for browser tests.
 *
 * The backend rejects cookie-authenticated admin writes without a same-origin
 * `Origin` (or `Referer`) header (`403 cross-origin write rejected`).
 * Playwright's `APIRequestContext` sends neither by default, so every write
 * below attaches the web origin explicitly. Do not remove these headers;
 * the server-side hardening must stay as-is.
 */
export const E2E_ORIGIN = 'http://127.0.0.1:5197';
export const E2E_PASSWORD = 'browser-test-only';

export function originHeaders(): Record<string, string> {
  return { Origin: E2E_ORIGIN };
}

export async function adminLogin(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/admin/login', { data: { password: E2E_PASSWORD } });
  if (!res.ok()) throw new Error(`admin login failed: ${res.status()}`);
}

export async function createVenue(
  request: APIRequestContext,
  name: string,
  canvasKind?: 'geographic' | 'static',
): Promise<string> {
  const res = await request.post('/api/admin/venues', {
    headers: originHeaders(),
    data: canvasKind ? { name, canvasKind } : { name },
  });
  if (!res.ok()) throw new Error(`venue creation failed: ${res.status()} ${await res.text()}`);
  return (await res.json()).id as string;
}

export async function putDraft(
  request: APIRequestContext,
  venueId: string,
  draft: unknown,
): Promise<void> {
  const res = await request.put(`/api/admin/venues/${venueId}/draft-v3`, {
    headers: originHeaders(),
    data: draft,
  });
  if (!res.ok()) throw new Error(`draft save failed: ${res.status()} ${await res.text()}`);
}

export async function getDraftJson(request: APIRequestContext, venueId: string): Promise<unknown> {
  const res = await request.get(`/api/admin/venues/${venueId}/draft-v3`);
  if (!res.ok()) throw new Error(`draft read failed: ${res.status()} ${await res.text()}`);
  return res.json();
}
