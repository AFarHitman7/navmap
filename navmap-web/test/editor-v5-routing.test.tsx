import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { staticDraft } from '../src/fixtures/map-v5';
import { getDraftV5 } from '../src/api-v3';

vi.mock('../src/api-v3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api-v3')>();
  return {
    ...actual,
    getDraftV5: vi.fn(),
    getDraftVersion: vi.fn().mockResolvedValue(5),
    getCapabilities: vi.fn().mockResolvedValue({ mapV5AuthoringEnabled: true }),
    listMaps: vi.fn().mockResolvedValue([]),
    isV5AuthoringEnabled: vi.fn().mockResolvedValue(true),
  };
});

describe('routed V5 authoring', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/editor/static-room');
    vi.mocked(getDraftV5).mockResolvedValue({ ...staticDraft(), venueId: 'static-room' });
  });

  it('dispatches an enabled static V5 map to the live editor with its importer and frame controls', async () => {
    const { default: App } = await import('../src/App');
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'static-room' })).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: 'Floor plans' }));
    expect(screen.getByText('Add a floor plan')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Node', exact: true })).toBeVisible();
    expect(screen.getByRole('application', { name: 'Static floor plan' })).toBeVisible();
    expect(getDraftV5).toHaveBeenCalledWith('static-room');
  });
});
