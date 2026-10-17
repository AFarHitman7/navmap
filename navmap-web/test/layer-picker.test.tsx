import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LayerPicker } from '../src/LayerPicker';

const frames = [
  { id: 'f0', zoneId: 'b1', z: 0, bounds: { kind: 'geographic' as const, north: 1, south: 0, east: 1, west: 0 } },
  { id: 'f1', zoneId: 'b1', z: 1, bounds: { kind: 'geographic' as const, north: 1, south: 0, east: 1, west: 0 } },
  { id: 'f2', zoneId: 'b2', z: 0, bounds: { kind: 'geographic' as const, north: 1, south: 0, east: 1, west: 0 } },
];
const zones = [
  { id: 'b1', name: 'North building', bounds: { north: 1, south: 0, east: 1, west: 0 }, floors: [{ z: 0, label: 'Ground' }, { z: 1, label: 'Level 1' }] },
  { id: 'b2', name: 'South building', bounds: { north: 1, south: 0, east: 1, west: 0 }, floors: [{ z: 0, label: 'Ground' }] },
];

describe('LayerPicker', () => {
  it('keeps the active floor visible in a compact closed row and switches frames from the Layers popover', () => {
    const onFrameChange = vi.fn();
    const { container } = render(<LayerPicker canvasKind="geographic" frames={frames} activeFrameId="f1" onFrameChange={onFrameChange} zones={zones} />);
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(container.querySelector('.layer-current-frame')).toHaveTextContent('North building · Level 1');
    expect(container.querySelector('.layer-picker-row')!.getBoundingClientRect().height).toBeLessThanOrEqual(56);
    fireEvent.click(screen.getByText('Layers'));
    fireEvent.click(within(details).getByRole('button', { name: 'South building · Ground' }));
    expect(onFrameChange).toHaveBeenCalledWith('f2');
  });

  it('shows many geographic zones inside one bounded popover and supports Escape', () => {
    const { container } = render(<LayerPicker canvasKind="geographic" frames={frames} activeFrameId="f0" onFrameChange={vi.fn()} zones={zones} />);
    const details = container.querySelector('details')!;
    fireEvent.click(screen.getByText('Layers'));
    fireEvent.keyDown(details, { key: 'Escape' });
    expect(details.open).toBe(false);
    expect(container.querySelector('.layer-picker-options')!.className).toContain('layer-picker-options');
  });
});
