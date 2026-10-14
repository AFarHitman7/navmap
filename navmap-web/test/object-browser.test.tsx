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

  it('shows named logical paths and selects them as whole objects', () => {
    const select = vi.fn();
    render(<ObjectBrowser document={staticDraft()} selection={{ kind: 'none' }} onSelect={select} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Paths' }));
    expect(screen.getByText('Ground corridor')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Ground corridor/ }));
    expect(select).toHaveBeenCalledWith({ kind: 'path', id: 'corr-ground' });
    expect(screen.getByText('Stair transition')).toBeTruthy();
  });
});
