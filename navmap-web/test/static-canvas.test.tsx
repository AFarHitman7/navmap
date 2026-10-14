import { fireEvent, render, waitFor } from '@testing-library/react';
import L from 'leaflet';
import { describe, expect, it, vi } from 'vitest';
import { CanvasHost } from '../src/map/CanvasHost';
import { fromLeaflet, toLeaflet } from '../src/map/static-coordinates';
import { staticDraft } from '../src/fixtures/map-v5';

describe('static canvas coordinate and lifecycle contract', () => {
  it.each([
    [{ x: 0, y: 0 }, 1000, 500, [500, 0]],
    [{ x: 1, y: 1 }, 1000, 500, [0, 1000]],
    [{ x: 0.5, y: 0.5 }, 320, 900, [450, 160]],
  ] as const)('round-trips top-left normalized positions %#', (position, width, height, expected) => {
    expect(toLeaflet(position, width, height)).toEqual(expected);
    expect(fromLeaflet(expected[0], expected[1], width, height)).toEqual({ kind: 'local', ...position });
  });

  it('uses CRS.Simple and one assigned frame overlay without tile requests', async () => {
    const draft = staticDraft();
    const mapSpy = vi.spyOn(L, 'map');
    const tileSpy = vi.spyOn(L, 'tileLayer');
    const imageSpy = vi.spyOn(L, 'imageOverlay');
    const callbacks = { onPointClick: vi.fn() };
    const { container, rerender } = render(<CanvasHost document={draft} view="editor" activeFrameId={draft.frames[0]!.id} mode="place-node" callbacks={callbacks} />);
    await waitFor(() => expect(imageSpy).toHaveBeenCalledTimes(1));
    expect(mapSpy.mock.calls[0]?.[1]).toMatchObject({ crs: L.CRS.Simple });
    expect(tileSpy).not.toHaveBeenCalled();
    const otherFrame = draft.frames[1]!;
    rerender(<CanvasHost document={draft} view="editor" activeFrameId={otherFrame.id} mode="place-node" callbacks={callbacks} />);
    await waitFor(() => expect(imageSpy).toHaveBeenCalledTimes(2));
    expect(callbacks.onPointClick).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('.leaflet-container')!, { detail: 1 });
    expect(callbacks.onPointClick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local' }), otherFrame.id);
  });
});
