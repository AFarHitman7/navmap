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

  it('draws one selectable path polyline per frame stretch and hides sample markers by default', async () => {
    const draft = staticDraft();
    const polylines = vi.spyOn(L, 'polyline');
    const markers = vi.spyOn(L, 'marker');
    polylines.mockClear(); markers.mockClear();
    const callbacks = { onPathClick: vi.fn(), onEdgeClick: vi.fn() };
    render(<CanvasHost document={draft} view="editor" activeFrameId="frame-b-a-z0" mode="select" callbacks={callbacks} />);
    await waitFor(() => expect(polylines).toHaveBeenCalled());
    expect(polylines).toHaveBeenCalledTimes(1);
    expect(polylines.mock.calls[0]?.[0]).toHaveLength(3);
    expect(markers.mock.calls.some(([point]) => Array.isArray(point) && point[0] === 400 && point[1] === 460)).toBe(false);
    const pathLine = polylines.mock.results[0]?.value;
    pathLine?.fire('click', { originalEvent: { stopPropagation: vi.fn() } });
    expect(callbacks.onPathClick).toHaveBeenCalledWith('corr-ground');
  });

  it('does not render any path lines or editor handles in visitor view', async () => {
    const polylines = vi.spyOn(L, 'polyline');
    polylines.mockClear();
    const imageSpy = vi.spyOn(L, 'imageOverlay');
    imageSpy.mockClear();
    const draft = staticDraft();
    render(<CanvasHost document={draft} view="visitor" activeFrameId="frame-b-a-z0" mode="select" callbacks={{}} />);
    await waitFor(() => expect(imageSpy).toHaveBeenCalled());
    expect(polylines).not.toHaveBeenCalled();
  });
});
