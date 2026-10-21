import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MapPicker } from '../src/maps/MapPicker';
import { AUTH_CHANGED_EVENT } from '../src/api-v3';

describe('MapPicker', () => {
  it('loads named maps, creates a typed map, and navigates by its stable ID', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/venues' && !init?.method) return Response.json([{ id: 'demo', name: 'Demo', latestVersion: 1 }]);
      if (url === '/api/admin/venues' && init?.method === 'POST') return Response.json({ id: 'stable-id', name: 'Gallery', latestVersion: 0 });
      if (url === '/api/capabilities') return Response.json({ mapV5AuthoringEnabled: true });
      throw new Error(`Unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/']}><MapPicker currentId="demo" /><Routes><Route path="/editor/:id" element={<p>Editor route</p>} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('option', { name: 'Demo' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New map' }));
    fireEvent.change(screen.getByLabelText('Map name'), { target: { value: 'Gallery' } });
    fireEvent.change(screen.getByLabelText('Canvas type'), { target: { value: 'static' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create map' }));
    await waitFor(() => expect(screen.getByText('Editor route')).toBeTruthy());
    expect(JSON.parse(String(fetchMock.mock.calls.find((call) => call[1]?.method === 'POST')?.[1]?.body))).toEqual({ name: 'Gallery', canvasKind: 'static' });
    vi.unstubAllGlobals();
  });

  it('closes the new-map dialog with Escape', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/admin/venues') return Response.json([{ id: 'demo', name: 'Demo', latestVersion: 1 }]);
      if (url === '/api/capabilities') return Response.json({ mapV5AuthoringEnabled: true });
      throw new Error(`Unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/']}><MapPicker currentId="demo" /></MemoryRouter>);
    await screen.findByRole('option', { name: 'Demo' });
    fireEvent.click(screen.getByRole('button', { name: 'New map' }));
    expect(screen.getByRole('dialog', { name: 'New map' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'New map' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'New map' })).toBeNull();
    vi.unstubAllGlobals();
  });

  it('clears a stale 401 and reloads the map list after organizer sign-in', async () => {
    let authorized = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/admin/venues') return authorized
        ? Response.json([{ id: 'demo', name: 'Demo map', latestVersion: 1 }])
        : Response.json({ error: 'login required' }, { status: 401 });
      if (url === '/api/capabilities') return Response.json({ mapV5AuthoringEnabled: true });
      throw new Error(`Unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/']}><MapPicker currentId="demo" /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('login required');
    expect(screen.getByRole('button', { name: 'New map' })).toBeDisabled();
    authorized = true;
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'Demo map' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New map' })).not.toBeDisabled();
    vi.unstubAllGlobals();
  });
});
