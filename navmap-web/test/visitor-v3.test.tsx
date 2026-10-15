import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VisitorV3 } from '../src/VisitorV3';
import fixture from '../src/fixtures/unified-v3.json';
import v5Fixture from '../src/fixtures/map-v5-static.json';

const manifest = { ...fixture, venueId: 'demo', version: 1, profiles: [], places: [
  { id: 'a0', name: 'Building A ground lobby', nodeId: 'n-a0', zoneId: 'b-a' },
  { id: 'a1', name: 'Building A level 1 landing', nodeId: 'n-a1', zoneId: 'b-a' },
  { id: 'b0', name: 'Building B ground lobby', nodeId: 'n-b0', zoneId: 'b-b' },
] };
function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('public visitor map', () => {
  it('normalizes V5 published map and only offers visitor-visible authored places', async () => {
    const published = { ...v5Fixture, venueId: 'demo', version: 2, profiles: [] };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/latest')
      ? jsonResponse({ venueId: 'demo', version: 2, name: 'Harbor Hall' }) : jsonResponse(published)));
    render(<VisitorV3 />);
    expect(await screen.findByRole('heading', { name: 'Visitor map — Harbor Hall' })).toBeVisible();
    expect(await screen.findByLabelText('Destination')).toBeVisible();
    expect(screen.queryByText('Survey point')).not.toBeInTheDocument();
    expect(screen.queryByText(/connections/)).not.toBeInTheDocument();
  });

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
    await user.selectOptions(await screen.findByLabelText('Starting point'), 'n-a0');
    await user.selectOptions(screen.getByLabelText('Destination'), 'n-a1');
    expect(screen.getByText(/Take stairs · Building A · 1/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Destination'), 'n-b0');
    expect(screen.getByRole('alert')).toHaveTextContent('No connected route');
    expect(screen.queryByText(/Take stairs/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Destination'), 'n-a0');
    expect(screen.getByText('You’re already at your destination.')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
