import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { staticDraft } from '../src/fixtures/map-v5';
import { getDraftV5, listMaps, saveDraftV5 } from '../src/api-v3';
import { OrganizerV5 } from '../src/OrganizerV5';
import { MapPicker } from '../src/maps/MapPicker';

vi.mock('../src/api-v3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api-v3')>();
  return {
    ...actual,
    getDraftV5: vi.fn(),
    isV5AuthoringEnabled: vi.fn().mockResolvedValue(true),
    listMaps: vi.fn().mockResolvedValue([
      { id: 'alpha-id', name: 'Alpha Hall', latestVersion: 0 },
      { id: 'beta-id', name: 'Beta Gallery', latestVersion: 0 },
    ]),
    getCapabilities: vi.fn().mockResolvedValue({ mapV5AuthoringEnabled: true }),
    saveDraftV5: vi.fn(),
  };
});

vi.mock('../src/map/CanvasHost', () => ({
  CanvasHost: ({ activeFrameId, callbacks }: {
    activeFrameId: string;
    callbacks: { onPointClick: (position: { kind: 'local'; x: number; y: number }, frameId: string) => void };
  }) => <button type="button" onClick={() => callbacks.onPointClick({ kind: 'local', x: 0.5, y: 0.5 }, activeFrameId)}>Place test point</button>,
}));

function EditorRoute() {
  const { venueId = '' } = useParams();
  const [mapName, setMapName] = useState('');
  return <><MapPicker currentId={venueId} onCurrentNameChange={setMapName} /><OrganizerV5 key={venueId} venueId={venueId} mapName={mapName} /></>;
}

function mountEditor() {
  const router = createMemoryRouter([{ path: '/editor/:venueId', element: <EditorRoute /> }], { initialEntries: ['/editor/alpha-id'] });
  return render(<RouterProvider router={router} />);
}

describe('V5 map switching and pending paths', () => {
  beforeEach(() => {
    vi.mocked(getDraftV5).mockImplementation(async (id = 'demo') => ({ ...staticDraft(), venueId: id }));
    vi.mocked(listMaps).mockResolvedValue([
      { id: 'alpha-id', name: 'Alpha Hall', latestVersion: 0 },
      { id: 'beta-id', name: 'Beta Gallery', latestVersion: 0 },
    ]);
    vi.mocked(saveDraftV5).mockImplementation(async (draft) => draft);
  });

  it('preserves a started path when switching frames or tools and refuses cross-frame vertices', async () => {
    mountEditor();
    expect(await screen.findByRole('heading', { name: 'Alpha Hall' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Path', exact: true }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Regular' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place test point' }));
    expect(screen.getByText('1 points · pending path')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Building A · Level 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place test point' }));
    expect(screen.getByRole('status')).toHaveTextContent('Pending path is on another floor. Return to that floor or discard it.');
    fireEvent.click(screen.getByRole('button', { name: 'Select', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Path', exact: true }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Regular' }));
    expect(screen.getByRole('status')).toHaveTextContent('Pending path is on another floor. Return to that floor or discard it.');
    fireEvent.click(screen.getByRole('button', { name: 'Building A · Ground' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place test point' }));
    expect(screen.getByText('2 points · pending path')).toBeTruthy();
  });

  it('keeps a clean document with pending gesture on Cancel and requires explicit Discard to switch', async () => {
    mountEditor();
    expect(await screen.findByRole('heading', { name: 'Alpha Hall' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Path', exact: true }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Regular' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place test point' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Select map' }), { target: { value: 'beta-id' } });
    expect(await screen.findByRole('dialog', { name: 'Unsaved changes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Alpha Hall' })).toBeTruthy();
    expect(screen.getByText('1 points · pending path')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Select map' }), { target: { value: 'beta-id' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByRole('heading', { name: 'Beta Gallery' })).toBeTruthy();
  });

  it('switches only after Save succeeds and keeps the dirty document and history on save failure', async () => {
    mountEditor();
    expect(await screen.findByRole('heading', { name: 'Alpha Hall' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Node', exact: true }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Regular' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place test point' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Select map' }), { target: { value: 'beta-id' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('heading', { name: 'Beta Gallery' })).toBeTruthy();

    vi.mocked(saveDraftV5).mockRejectedValueOnce(new Error('network unavailable'));
    // Return to Alpha, dirty it, then ensure failed Save leaves the same editor mounted.
    fireEvent.change(screen.getByRole('combobox', { name: 'Select map' }), { target: { value: 'alpha-id' } });
    expect(await screen.findByRole('heading', { name: 'Alpha Hall' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Node', exact: true }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Regular' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place test point' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Select map' }), { target: { value: 'beta-id' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('network unavailable');
    expect(screen.getByRole('heading', { name: 'Alpha Hall' })).toBeTruthy();
    expect(screen.getByText('Static floor plan · Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Static floor plan · Saved')).toBeTruthy();
  });
});
