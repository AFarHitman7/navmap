import { render, screen } from '@testing-library/react';
import L from 'leaflet';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapCanvasV3 } from '../src/MapCanvasV3';
import fixture from '../src/fixtures/unified-v3.json';

function captureLeaflet() {
  const maps: L.Map[] = [];
  const markers: L.Marker[] = [];
  const polylines: L.Polyline[] = [];
  const originalMapInitialize = L.Map.prototype.initialize;
  const originalMarkerAddTo = L.Marker.prototype.addTo;
  const originalPolylineAddTo = L.Polyline.prototype.addTo;
  vi.spyOn(L.Map.prototype, 'initialize').mockImplementation(function (this: L.Map, ...args: Parameters<typeof originalMapInitialize>) {
    maps.push(this);
    return originalMapInitialize.apply(this, args);
  });
  vi.spyOn(L.Marker.prototype, 'addTo').mockImplementation(function (this: L.Marker, target: L.Map | L.LayerGroup) {
    markers.push(this);
    return originalMarkerAddTo.call(this, target);
  });
  vi.spyOn(L.Polyline.prototype, 'addTo').mockImplementation(function (this: L.Polyline, target: L.Map | L.LayerGroup) {
    polylines.push(this);
    return originalPolylineAddTo.call(this, target);
  });
  return { maps, markers, polylines };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('MapCanvasV3', () => {
  it('hides other floors and their edges independently in each zone', async () => {
    const { container, rerender } = render(
      <MapCanvasV3 draft={fixture as never} selectedZoneId={null}
        zoneFloorVisibility={{ 'b-a': 1, 'b-b': 'hidden' }} />,
    );
    await screen.findByTestId('leaflet-map-v3');
    expect(container.querySelector('[data-node="n-a1"]')).not.toBeNull();
    expect(container.querySelector('[data-node="n-out"]')).not.toBeNull();
    expect(container.querySelector('[data-node="n-a0"]')).toBeNull();
    expect(container.querySelector('[data-node="n-b0"]')).toBeNull();
    expect(container.querySelectorAll('[data-edge]')).toHaveLength(0);

    rerender(<MapCanvasV3 draft={fixture as never} selectedZoneId={null}
      zoneFloorVisibility={{ 'b-a': 0, 'b-b': 0 }} showOutdoors={false} />);
    expect(container.querySelector('[data-node="n-a1"]')).toBeNull();
    expect(container.querySelector('[data-node="n-out"]')).toBeNull();
    expect(container.querySelector('[data-node="n-b0"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-edge]')).toHaveLength(1);
  });

  it('renders one map with the boundary, all zones, and every node', async () => {
    const onZoneClick = vi.fn();
    const onNodeClick = vi.fn();
    render(
      <MapCanvasV3
        draft={fixture as never}
        selectedZoneId={null}
        floorFilter={null}
        onZoneClick={onZoneClick}
        onNodeClick={onNodeClick}
      />,
    );
    const map = await screen.findByTestId('leaflet-map-v3');
    expect(map).toBeVisible();
    expect(map.getAttribute('data-zones')).toBe('2');
    expect(map.getAttribute('data-nodes')).toBe('5');
    expect(map.getAttribute('data-ready')).toBe('true');
  });

  it('dims nodes that are not on the filtered floor', async () => {
    render(
      <MapCanvasV3
        draft={fixture as never}
        selectedZoneId="b-a"
        floorFilter={{ zoneId: 'b-a', z: 1 }}
      />,
    );
    const map = await screen.findByTestId('leaflet-map-v3');
    expect(map.getAttribute('data-dimmed')).toBe('4');
  });

  it('drags the selected node in move mode and reports its stable id with the new coordinates', async () => {
    const leaflet = captureLeaflet();
    const onNodeMove = vi.fn();
    render(
      <MapCanvasV3
        draft={fixture as never}
        selectedZoneId={null}
        selectedNodeId="n-a0"
        mode="move"
        onNodeMove={onNodeMove}
      />,
    );
    await screen.findByTestId('leaflet-map-v3');

    const marker = leaflet.markers.find((item) => item.options.title === 'Building A ground lobby');
    expect(marker).toBeDefined();
    expect(marker?.options.draggable).toBe(true);

    marker?.setLatLng([13.0525, 80.2475]);
    marker?.fire('dragend');

    expect(onNodeMove).toHaveBeenCalledWith('n-a0', 13.0525, 80.2475);
  });

  it('disables empty-map dragging in move mode but leaves normal navigation panning enabled', async () => {
    const moveLeaflet = captureLeaflet();
    render(
      <MapCanvasV3
        draft={fixture as never}
        selectedZoneId={null}
        selectedNodeId="n-a0"
        mode="move"
      />,
    );
    await screen.findByTestId('leaflet-map-v3');
    expect(moveLeaflet.maps[0].dragging.enabled()).toBe(false);

    vi.restoreAllMocks();
    const navigateLeaflet = captureLeaflet();
    render(<MapCanvasV3 draft={fixture as never} selectedZoneId={null} mode="navigate" />);
    await screen.findAllByTestId('leaflet-map-v3');
    expect(navigateLeaflet.maps[0].dragging.enabled()).toBe(true);
  });

  it('does not move a selected node from an empty map click in move mode', async () => {
    const leaflet = captureLeaflet();
    const onPointClick = vi.fn();
    render(
      <MapCanvasV3
        draft={fixture as never}
        selectedZoneId={null}
        selectedNodeId="n-a0"
        mode="move"
        onPointClick={onPointClick}
      />,
    );
    await screen.findByTestId('leaflet-map-v3');

    leaflet.maps[0].fire('click', { latlng: L.latLng(13.06, 80.26), originalEvent: { detail: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(onPointClick).not.toHaveBeenCalled();
  });

  it('recreates selected move marker as not draggable when disabled toggles on', async () => {
    const leaflet = captureLeaflet();
    const { rerender } = render(
      <MapCanvasV3
        draft={fixture as never}
        selectedZoneId={null}
        selectedNodeId="n-a0"
        mode="move"
        disabled={false}
      />,
    );
    await screen.findByTestId('leaflet-map-v3');
    expect(leaflet.markers.findLast((item) => item.options.title === 'Building A ground lobby')?.options.draggable).toBe(true);

    rerender(
      <MapCanvasV3
        draft={fixture as never}
        selectedZoneId={null}
        selectedNodeId="n-a0"
        mode="move"
        disabled
      />,
    );

    expect(leaflet.markers.findLast((item) => item.options.title === 'Building A ground lobby')?.options.draggable).toBe(false);
  });

  it('dispatches delayed empty-map clicks in draw-path mode', async () => {
    const leaflet = captureLeaflet();
    const onPointClick = vi.fn();
    render(<MapCanvasV3 draft={fixture as never} selectedZoneId={null} mode="draw-path" onPointClick={onPointClick} />);
    await screen.findByTestId('leaflet-map-v3');

    vi.useFakeTimers();
    leaflet.maps[0].fire('click', { latlng: L.latLng(13.06, 80.26), originalEvent: { detail: 1 } });
    vi.advanceTimersByTime(241);

    expect(onPointClick).toHaveBeenCalledWith({ lat: 13.06, lng: 80.26 });
  });

  it('renders a dashed draw-path preview and clickable selectable graph edges', async () => {
    const leaflet = captureLeaflet();
    const onEdgeClick = vi.fn();
    render(
      <MapCanvasV3
        draft={fixture as never}
        selectedZoneId={null}
        mode="draw-path"
        pathPreview={[
          { lat: 13.05, lng: 80.245, zoneId: 'b-a', z: 0, nodeId: 'n-a0' },
          { lat: 13.052, lng: 80.247, zoneId: 'b-a', z: 0 },
          { lat: 13.055, lng: 80.248, zoneId: 'b-a', z: 0, nodeId: 'n-a0b' },
        ]}
        onEdgeClick={onEdgeClick}
      />,
    );
    await screen.findByTestId('leaflet-map-v3');

    expect(leaflet.polylines.some((line) => line.options.dashArray === '6 6')).toBe(true);
    const edge = leaflet.polylines.find((line) => (line.getElement()?.getAttribute('data-edge') ?? '').includes('n-out:n-a0'));
    expect(edge?.options.interactive).toBe(true);
    edge?.fire('click', { originalEvent: { stopPropagation: vi.fn() } });
    expect(onEdgeClick).toHaveBeenCalledWith('n-out', 'n-a0');
  });

  it('filters floor-local path preview markers and stretches while keeping visible stair landing indicators', async () => {
    const leaflet = captureLeaflet();
    render(
      <MapCanvasV3
        draft={fixture as never}
        selectedZoneId={null}
        mode="draw-path"
        zoneFloorVisibility={{ 'b-a': 0, 'b-b': 'hidden' }}
        showOutdoors={false}
        pathPreview={[
          { lat: 13.05, lng: 80.245, zoneId: 'b-a', z: 0, nodeId: 'n-a0' },
          { lat: 13.05, lng: 80.245, zoneId: 'b-a', z: 1, nodeId: 'n-a1', incomingKind: 'stairs' },
          { lat: 13.056, lng: 80.2485, zoneId: 'b-a', z: 1 },
        ]}
      />,
    );
    await screen.findByTestId('leaflet-map-v3');

    expect(leaflet.markers.some((marker) => marker.getElement()?.getAttribute('data-preview-transition') === '1')).toBe(true);
    expect(leaflet.polylines.some((line) => line.options.dashArray === '6 6')).toBe(false);
    expect(leaflet.markers.filter((marker) => marker.getElement()?.getAttribute('data-preview-point') === '1')).toHaveLength(1);
  });

  it('keeps edge clicks from bubbling to the map so no stray vertex is added', async () => {
    const leaflet = captureLeaflet();
    const onPointClick = vi.fn();
    const onEdgeClick = vi.fn();
    const { container } = render(
      <MapCanvasV3
        draft={fixture as never}
        selectedZoneId={null}
        mode="draw-path"
        onPointClick={onPointClick}
        onEdgeClick={onEdgeClick}
      />,
    );
    await screen.findByTestId('leaflet-map-v3');

    const edge = leaflet.polylines.find((line) => (line.getElement()?.getAttribute('data-edge') ?? '').includes('n-out:n-a0'));
    expect(edge?.options.interactive).toBe(true);
    expect(edge?.options.bubblingMouseEvents).toBe(false);
    const marker = leaflet.markers.find((item) => item.options.title === 'Building A ground lobby');
    expect(marker?.options.bubblingMouseEvents).toBe(false);

    vi.useFakeTimers();
    const line = container.querySelector('[data-edge="n-out:n-a0"]');
    expect(line).not.toBeNull();
    line!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(400);
    expect(onEdgeClick).toHaveBeenCalledWith('n-out', 'n-a0');
    expect(onPointClick).not.toHaveBeenCalled();
  });

  it('keeps destination landings above generated reference points so they stay clickable', async () => {
    const leaflet = captureLeaflet();
    const draft = {
      ...(fixture as never as typeof fixture),
      nodes: [
        ...(fixture as never as typeof fixture).nodes,
        { id: 'n-gen', name: 'Path point n-gen', lat: 13.05, lng: 80.245, z: 0, zoneId: 'b-a', fingerprintRevision: 1, generated: true },
      ],
    };
    render(<MapCanvasV3 draft={draft as never} selectedZoneId={null} />);
    await screen.findByTestId('leaflet-map-v3');

    const landing = leaflet.markers.find((item) => item.options.title === 'Building A ground lobby');
    const generated = leaflet.markers.find((item) => item.options.title === 'Path point n-gen');
    expect(landing).toBeDefined();
    expect(generated).toBeDefined();
    expect(landing?.options.zIndexOffset ?? 0).toBeGreaterThan(generated?.options.zIndexOffset ?? 0);
  });

  it('highlights selected drawn route edges and calls onPathClick for any segment', async () => {
    const leaflet = captureLeaflet();
    const onPathClick = vi.fn();
    const draft = {
      ...(fixture as never as typeof fixture),
      paths: [{ id: 'route-1', name: 'Route 1', nodeIds: ['n-a0', 'n-a0b'], controlNodeIds: ['n-a0', 'n-a0b'] }],
    };
    render(<MapCanvasV3 draft={draft as never} selectedZoneId={null} selectedPathId="route-1" onPathClick={onPathClick} />);
    await screen.findByTestId('leaflet-map-v3');

    const route = leaflet.polylines.find((line) => line.getElement()?.getAttribute('data-path') === 'route-1');
    expect(route?.options.color).toBe('#d97706');
    route?.fire('click', { originalEvent: { stopPropagation: vi.fn() } });
    expect(onPathClick).toHaveBeenCalledWith('route-1');
  });

  it('shows a labeled transition indicator when only one stair landing is visible', async () => {
    const { container } = render(
      <MapCanvasV3
        draft={fixture as never}
        selectedZoneId={null}
        zoneFloorVisibility={{ 'b-a': 0, 'b-b': 'hidden' }}
        showOutdoors={false}
      />,
    );
    await screen.findByTestId('leaflet-map-v3');

    expect(container.querySelector('[data-transition="n-a0:n-a1"]')).not.toBeNull();
    expect(container.textContent).toContain('Stairs to floor 1');
  });
});
