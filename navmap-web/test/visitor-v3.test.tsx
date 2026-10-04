import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VisitorV3 } from '../src/VisitorV3';
import fixture from '../src/fixtures/unified-v3.json';

const manifest = { ...fixture, version: 1, profiles: [] };
function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('public visitor map', () => {
  it('explains an unpublished venue and recovers after publishing without an admin request', async () => {
    const user = userEvent.setup();
    let published = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/venues/demo/latest') return published
        ? jsonResponse({ venueId: 'demo', version: 1 }) : jsonResponse({ error: 'no published version' }, 404);
      if (url === '/api/venues/demo/versions/1/manifest') return jsonResponse(manifest);
      throw new Error(`Unexpected request: ${url}`);
    }));
    render(<VisitorV3 />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading published map');
    expect(await screen.findByRole('alert')).toHaveTextContent('Publish it in the editor');
    published = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Starting point')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports disconnected points and an already-reached destination instead of stale directions', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/latest')
      ? jsonResponse({ venueId: 'demo', version: 1 }) : jsonResponse(manifest)));
    render(<VisitorV3 />);
    await user.selectOptions(await screen.findByLabelText('Starting point'), 'n-out');
    await user.selectOptions(screen.getByLabelText('Destination'), 'n-a1');
    expect(screen.getByText(/Take stairs to Building A · Floor 1/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Destination'), 'n-b0');
    expect(screen.getByRole('alert')).toHaveTextContent('No connected route');
    expect(screen.queryByText(/Take stairs/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Destination'), 'n-out');
    expect(screen.getByText('You’re already at your destination.')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
