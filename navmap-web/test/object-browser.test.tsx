import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { staticDraft } from '../src/fixtures/map-v5';
import { ObjectBrowser } from '../src/ObjectBrowser';

describe('ObjectBrowser', () => {
  it('keeps generated sample IDs out of normal nodes and searches meaningful metadata', () => {
    const draft = staticDraft();
    render(<ObjectBrowser document={draft} selection={{ kind: 'none' }} onSelect={vi.fn()} />);
    expect(screen.queryByText('Survey point')).toBeNull();
    expect(screen.queryByText('s-a0g')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search objects' }), { target: { value: 'level 1' } });
    expect(screen.getByText('Level 1 corridor')).toBeTruthy();
    expect(screen.queryByText('Ground lobby')).toBeNull();
  });

  it('lists a transition once, on its own Connections tab', () => {
    const select = vi.fn();
    render(<ObjectBrowser document={staticDraft()} selection={{ kind: 'none' }} onSelect={select} />);
    expect(screen.queryByText('Stair transition')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Paths' }));
    expect(screen.queryByText('Stair transition')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Connections' }));
    fireEvent.click(screen.getByRole('button', { name: /Stair transition/ }));
    expect(select).toHaveBeenCalledWith({ kind: 'transition', id: 'tr-s-a0-s-a1' });
  });

  it('shows named logical paths and selects them as whole objects', () => {
    const select = vi.fn();
    render(<ObjectBrowser document={staticDraft()} selection={{ kind: 'none' }} onSelect={select} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Paths' }));
    expect(screen.getByText('Ground corridor')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Ground corridor/ }));
    expect(select).toHaveBeenCalledWith({ kind: 'path', id: 'corr-ground' });
  });
});
