import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../src/fixtures/unified-v3.json';
import App from '../src/App';
import userEvent from '@testing-library/user-event';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

describe('V3-only app shell', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('opens the editor and offers public visitor navigation with routes across floors', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/admin/venues/demo/draft-v3') return jsonResponse(fixture);
      if (url === '/api/admin/venues') return jsonResponse({ error: 'login required' }, 401);
      if (url === '/api/capabilities') return jsonResponse({ mapV5AuthoringEnabled: false });
      if (url === '/api/venues/demo/latest') return jsonResponse({ venueId: 'demo', version: 1 });
      if (url === '/api/venues/demo/versions/1/manifest') return jsonResponse({ ...fixture, version: 1, profiles: [],
        places: [{ id: 'p-lobby', name: 'Lobby', nodeId: 'n-a0', zoneId: 'b-a' },
          { id: 'p-landing', name: 'Upper landing', nodeId: 'n-a1', zoneId: 'b-a' }] });
      return jsonResponse({}, 404);
    }));

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Draw boundary' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Maps' })).not.toBeInTheDocument();
    // Organizer chrome surfaces the admin map list; visitors must not see it.
    expect(await screen.findByText(/login required/)).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Visitor' }));
    expect(await screen.findByRole('heading', { name: 'Visitor map — demo' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Editor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh maps' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New map' })).not.toBeInTheDocument();
    expect(screen.queryByText(/login required/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Starting point'), 'n-a0');
    await user.selectOptions(screen.getByLabelText('Destination'), 'n-a1');
    expect(await screen.findByText(/Take stairs to Upper landing/)).toBeVisible();
    expect(document.querySelector('.layer-current-frame')).toHaveTextContent('Building A · Ground');
    await user.selectOptions(screen.getByLabelText('Manual floor selection'), 'frame-b-a-z1');
    expect(document.querySelector('.layer-current-frame')).toHaveTextContent('Building A · Level 1');
    expect(document.querySelector('[data-node-id]')).toBeNull();
    expect(document.querySelector('[data-edge]')).toBeNull();
    expect(document.querySelector('.leaflet-overlay-pane svg path')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Resume follow' }));
    expect(document.querySelector('.layer-current-frame')).toHaveTextContent('Building A · Ground');
  });

});
