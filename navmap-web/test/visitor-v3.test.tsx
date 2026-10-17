import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VisitorV3 } from '../src/VisitorV3';
import fixture from '../src/fixtures/unified-v3.json';
import v5Fixture from '../src/fixtures/map-v5-static.json';
import geoFixture from '../src/fixtures/map-v5-geographic.json';

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
    const destination = await screen.findByLabelText('Destination');
    expect(destination).toBeVisible();
    expect(destination).toHaveDisplayValue('Choose a destination');
    expect(destination.querySelector('option[value="s-a0"]')).toHaveTextContent('Lobby');
    expect(destination.querySelector('option[value="s-a0b"]')).toHaveTextContent('Ground corridor');
    expect(destination.querySelector('option[value="s-a0g"]')).toBeNull();
    expect(screen.queryByText('Survey point')).not.toBeInTheDocument();
    expect(screen.queryByText(/connections/)).not.toBeInTheDocument();
  });

  it('routes through a hidden generated sample using the full graph without rendering or naming it', async () => {
    const hiddenRoute = {
      ...v5Fixture,
      venueId: 'demo', version: 3, profiles: [],
      places: [
        { id: 'p-lobby', name: 'Lobby', nodeId: 's-a0', zoneId: 'b-a' },
        { id: 'p-gallery', name: 'Gallery', nodeId: 's-a1', zoneId: 'b-a' },
      ],
      edges: [
        { from: 's-a0', to: 's-a0b', kind: 'path', cost: 0.1, meters: 2 },
        { from: 's-a0b', to: 's-a0g', kind: 'path', cost: 0.1, meters: 2 },
        { from: 's-a0', to: 's-a1', kind: 'stairs', cost: 10, meters: 10 },
        { from: 's-a0g', to: 's-a1', kind: 'stairs', cost: 0.1 },
        ...v5Fixture.edges.filter((edge) => edge.from === 's-a1'),
      ],
      transitions: [...v5Fixture.transitions, { id: 'hidden-stairs', name: 'internal', kind: 'stair', nodeIds: ['s-a0g', 's-a1'] }],
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/latest')
      ? jsonResponse({ venueId: 'demo', version: 3 }) : jsonResponse(hiddenRoute)));
    const user = userEvent.setup();
    render(<VisitorV3 />);
    await user.selectOptions(await screen.findByLabelText('Starting point'), 's-a0');
    await user.selectOptions(screen.getByLabelText('Destination'), 's-a1');
    expect(screen.getByText('Walk to Building A · Ground')).toBeVisible();
    expect(screen.getByText('Take stairs to Gallery')).toBeVisible();
    expect(screen.getByLabelText('Starting point').querySelector('option[value="s-a0g"]')).toBeNull();
    expect(screen.getByLabelText('Destination').querySelector('option[value="s-a0g"]')).toBeNull();
    expect(screen.getByLabelText('Starting point')).toHaveValue('s-a0');
    expect(screen.getByLabelText('Destination')).toHaveValue('s-a1');
    expect(screen.getByLabelText('Destination').querySelector('option[value="s-a0g"]')).toBeNull();
    expect(screen.getByLabelText('Starting point').querySelector('option[value="s-a0g"]')).toBeNull();
    expect(screen.queryByText(/\d+ m/)).not.toBeInTheDocument();
    expect(document.querySelector('[data-node-id]')).toBeNull();
    expect(document.querySelectorAll('.v5-node-marker')).toHaveLength(2);
    expect(document.querySelector('.leaflet-overlay-pane svg path')).toBeNull();
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
    expect(screen.getByText(/Take stairs to Building A level 1 landing/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Destination'), 'n-b0');
    expect(screen.getByRole('alert')).toHaveTextContent('No connected route');
    expect(screen.queryByText(/Take stairs/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Destination'), 'n-a0');
    expect(screen.getByText('You’re already at your destination.')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('visitor GPS display (opt-in)', () => {
  const geoManifest = { ...geoFixture, venueId: 'demo', version: 2, profiles: [] };
  function stubManifestFetch(body: unknown, venueId = 'demo', version = 2, name = 'Geo Hall') {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/latest')
      ? jsonResponse({ venueId, version, name }) : jsonResponse(body)));
  }
  function mockGeolocation() {
    const watch = vi.fn(() => 11);
    const clear = vi.fn();
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: watch, clearWatch: clear } });
    return { watch, clear };
  }
  afterEach(() => {
    try { delete (navigator as unknown as Record<string, unknown>).geolocation; } catch { /* keep jsdom default */ }
  });

  it('makes no geolocation call until Locate me is pressed', async () => {
    stubManifestFetch(geoManifest);
    const { watch } = mockGeolocation();
    render(<VisitorV3 />);
    expect(await screen.findByLabelText('Starting point')).toBeVisible();
    expect(watch).not.toHaveBeenCalled();
    expect(screen.getByTestId('gps-status')).toHaveTextContent('GPS is off');
  });

  it('renders an unsnapped dot plus accuracy circle without setting a start', async () => {
    stubManifestFetch(geoManifest);
    const { watch } = mockGeolocation();
    const user = userEvent.setup();
    render(<VisitorV3 />);
    await user.click(await screen.findByRole('button', { name: 'Locate me' }));
    expect(watch).toHaveBeenCalledTimes(1);
    const onSuccess = watch.mock.calls[0][0] as (pos: {
      coords: { latitude: number; longitude: number; accuracy: number }; timestamp: number;
    }) => void;
    const { act } = await import('react');
    await act(async () => { onSuccess({ coords: { latitude: 13.051, longitude: 80.251, accuracy: 12 }, timestamp: Date.now() }); });
    expect(screen.getByTestId('gps-status')).toHaveTextContent('You are here (±12 m)');
    expect(document.querySelector('[data-gps-dot="13.051,80.251"]')).not.toBeNull();
    expect(document.querySelector('.gps-accuracy-ring')).not.toBeNull();
    // GPS never silently snaps to the nearest graph point or picks a start.
    expect(screen.getByLabelText('Starting point')).toHaveValue('');
    expect(screen.getByTestId('gps-status')).toHaveTextContent('does not set your starting point');
  });

  it('labels an outside-venue fix as outside without setting a start', async () => {
    stubManifestFetch(geoManifest);
    const { watch } = mockGeolocation();
    const user = userEvent.setup();
    render(<VisitorV3 />);
    await user.click(await screen.findByRole('button', { name: 'Locate me' }));
    const onSuccess = watch.mock.calls[0][0] as (pos: {
      coords: { latitude: number; longitude: number; accuracy: number }; timestamp: number;
    }) => void;
    const { act } = await import('react');
    await act(async () => { onSuccess({ coords: { latitude: 14.0, longitude: 81.0, accuracy: 30 }, timestamp: Date.now() }); });
    expect(screen.getByTestId('gps-status')).toHaveTextContent('Outside venue (±30 m)');
    expect(screen.getByLabelText('Starting point')).toHaveValue('');
  });

  it('explains denied permission and keeps manual start available', async () => {
    stubManifestFetch(geoManifest);
    const { watch } = mockGeolocation();
    const user = userEvent.setup();
    render(<VisitorV3 />);
    await user.click(await screen.findByRole('button', { name: 'Locate me' }));
    const onError = watch.mock.calls[0][1] as (err: { code: number }) => void;
    const { act } = await import('react');
    await act(async () => { onError({ code: 1 }); });
    expect(screen.getByTestId('gps-status')).toHaveTextContent('Location permission denied');
    expect(screen.getByLabelText('Starting point')).toBeVisible();
  });

  it('never offers Locate me on a static upload', async () => {
    stubManifestFetch({ ...v5Fixture, venueId: 'demo', version: 2, profiles: [] });
    const { watch } = mockGeolocation();
    render(<VisitorV3 />);
    expect(await screen.findByLabelText('Starting point')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Locate me' })).toBeNull();
    expect(screen.queryByTestId('gps-status')).toBeNull();
    expect(watch).not.toHaveBeenCalled();
    expect(document.querySelector('[data-gps-dot]')).toBeNull();
  });

  it('cancels the watch when switching maps', async () => {
    stubManifestFetch(geoManifest);
    const { watch, clear } = mockGeolocation();
    const user = userEvent.setup();
    const { rerender } = render(<VisitorV3 />);
    await user.click(await screen.findByRole('button', { name: 'Locate me' }));
    expect(watch).toHaveBeenCalledTimes(1);
    rerender(<VisitorV3 venueId="elsewhere" />);
    expect(clear).toHaveBeenCalledWith(11);
  });
});
