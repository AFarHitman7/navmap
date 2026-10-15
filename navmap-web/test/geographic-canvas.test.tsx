import { render, waitFor } from '@testing-library/react';
import L from 'leaflet';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasHost } from '../src/map/CanvasHost';
import { geographicDraft } from '../src/fixtures/map-v5';

afterEach(() => vi.restoreAllMocks());

describe('GeographicCanvas presentation', () => {
  it('hides generated markers, draws the full path as one polyline, and supports whole-path selection', async () => {
    const draft = geographicDraft();
    const markers = vi.spyOn(L, 'marker');
    const polylines = vi.spyOn(L, 'polyline');
    markers.mockClear(); polylines.mockClear();
    const callbacks = { onPathClick: vi.fn() };
    render(<CanvasHost document={draft} view="editor" activeFrameId="frame-b-a-z0" mode="select" callbacks={callbacks} />);
    await waitFor(() => expect(polylines).toHaveBeenCalled());
    expect(polylines).toHaveBeenCalledTimes(1);
    expect(polylines.mock.calls[0]?.[0]).toHaveLength(3);
    expect(markers.mock.calls.some(([point]) => Array.isArray(point) && point[0] === 13.052 && point[1] === 80.246)).toBe(false);
    polylines.mock.results[0]?.value.fire('click', { originalEvent: { stopPropagation: vi.fn() } });
    expect(callbacks.onPathClick).toHaveBeenCalledWith('route-1');
  });

  it('projects no path lines or transition badges for visitors', async () => {
    const polylines = vi.spyOn(L, 'polyline');
    const markers = vi.spyOn(L, 'marker');
    polylines.mockClear(); markers.mockClear();
    const draft = geographicDraft();
    const { rerender } = render(<CanvasHost document={draft} view="visitor" activeFrameId="frame-b-a-z0" mode="select" callbacks={{}} />);
    await waitFor(() => expect(markers).toHaveBeenCalled());
    expect(polylines).not.toHaveBeenCalled();
    const badges = () => markers.mock.calls.filter(([, options]) => (options?.icon as L.DivIcon)?.options.className === 'v5-transition-badge');
    await waitFor(() => expect(badges()).toHaveLength(0));
    markers.mockClear();
    const hidden = { ...draft, nodes: draft.nodes.map((node) => ['n-out', 'n-a0', 'n-a1'].includes(node.id) ? { ...node, visitorVisible: false } : node) };
    rerender(<CanvasHost document={hidden} view="visitor" activeFrameId="frame-b-a-z0" mode="select" callbacks={{}} />);
    await waitFor(() => expect(markers).toHaveBeenCalled());
    expect(badges()).toHaveLength(0);
  });
});
