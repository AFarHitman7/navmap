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
      if (url === '/api/venues/demo/latest') return jsonResponse({ venueId: 'demo', version: 1 });
      if (url === '/api/venues/demo/versions/1/manifest') return jsonResponse({ ...fixture, version: 1, profiles: [],
        places: [{ id: 'p-landing', name: 'Upper landing', nodeId: 'n-a1', zoneId: 'b-a' }] });
      return jsonResponse({}, 404);
    }));

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Draw boundary' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Maps' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Visitor' }));
    expect(await screen.findByRole('heading', { name: 'Visitor map — demo' })).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Starting point'), 'n-out');
    await user.selectOptions(screen.getByLabelText('Destination'), 'n-a1');
    expect(await screen.findByText(/Take stairs to Building A · Floor 1/)).toBeVisible();
    expect(screen.getByLabelText('Visible floor — Building A')).toHaveValue('0');
    await user.selectOptions(screen.getByLabelText('Visible floor — Building A'), '1');
    expect(document.querySelector('[data-node="n-a1"]')).not.toBeNull();
    expect(document.querySelector('[data-node="n-a0"]')).toBeNull();
  });

});
