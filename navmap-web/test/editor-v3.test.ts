import { describe, expect, it } from 'vitest';
import {
  addFloor,
  addNodeAt,
  addZone,
  connectNodes,
  disconnectNodes,
  emptyDraftV3,
  moveNode,
  nextNodeId,
  renameNode,
  removeFloor,
  removeNode,
  removeZone,
  setBoundary,
  setNodeFloor,
  setZoneBounds,
  updateNodeLocation,
} from '../src/editor-v3/model';

const BOUNDARY = { north: 13.1, south: 13.0, east: 80.3, west: 80.2 };
const ZONE_BOUNDS = { north: 13.08, south: 13.02, east: 80.28, west: 80.22 };

function withBoundary() {
  return { ...emptyDraftV3('demo'), boundary: { ...BOUNDARY } };
}

describe('editor-v3 zones', () => {
  it('redrawing the boundary keeps positions but rejects exclusions', () => {
    let d = withBoundary();
    d = addZone(d, { name: 'A', bounds: ZONE_BOUNDS });
    d = addNodeAt(d, 13.05, 80.25);
    expect(() => setBoundary(d, { north: 13.04, south: 13.0, east: 80.3, west: 80.2 })).toThrow(/n-1/);
    d = setBoundary(d, { north: 13.1, south: 13.0, east: 80.31, west: 80.2 });
    expect(d.nodes[0]).toMatchObject({ lat: 13.05, lng: 80.25 });
    expect(d.boundary!.east).toBe(80.31);
  });

  it('adds multiple indoor zones inside the boundary', () => {
    let d = withBoundary();
    d = addZone(d, { name: 'A', bounds: ZONE_BOUNDS });
    d = addZone(d, { name: 'B', bounds: { north: 13.09, south: 13.085, east: 80.29, west: 80.285 } });
    expect(d.indoorZones.map((z) => z.name)).toEqual(['A', 'B']);
    expect(d.indoorZones[0]!.floors).toEqual([{ z: 0, label: 'Ground' }]);
  });

  it('rejects zones outside the boundary or overlapping another zone', () => {
    const d = addZone(withBoundary(), { name: 'A', bounds: ZONE_BOUNDS });
    expect(() => addZone(d, { name: 'Far', bounds: { north: 14, south: 13.9, east: 81, west: 80.9 } })).toThrow(/boundary/);
    expect(() => addZone(d, { name: 'Over', bounds: { north: 13.07, south: 13.03, east: 80.27, west: 80.23 } })).toThrow(/overlap/);
  });

  it('resizing a zone that would exclude assigned nodes fails until they move', () => {
    let d = addZone(withBoundary(), { name: 'A', bounds: ZONE_BOUNDS });
    d = addNodeAt(d, 13.05, 80.25, 'b-a', 0);
    expect(() => setZoneBounds(d, 'b-a', { north: 13.04, south: 13.02, east: 80.28, west: 80.22 })).toThrow(/n-1/);
    d = moveNode(d, 'n-1', 13.03, 80.25);
    d = setZoneBounds(d, 'b-a', { north: 13.04, south: 13.02, east: 80.28, west: 80.22 });
    expect(d.indoorZones[0]!.bounds.north).toBe(13.04);
  });

  it('deleting a populated zone requires reassignment and will not orphan grouped paths', () => {
    let d = addZone(withBoundary(), { name: 'A', bounds: ZONE_BOUNDS });
    d = addNodeAt(d, 13.05, 80.25, 'b-a', 0);
    expect(() => removeZone(d, 'b-a')).toThrow(/[Rr]eassign/);
    d = removeZone(d, 'b-a', { nodes: 'delete', edges: 'delete' });
    expect(d.indoorZones).toHaveLength(0);
    expect(d.nodes).toHaveLength(0);
    expect(d.paths ?? []).toHaveLength(0);
  });
});

describe('editor-v3 nodes', () => {
  it('auto-assigns zone and ground floor from position', () => {
    let d = addZone(withBoundary(), { name: 'A', bounds: ZONE_BOUNDS });
    d = addNodeAt(d, 13.05, 80.25);
    expect(d.nodes[0]).toMatchObject({ id: 'n-1', zoneId: 'b-a', z: 0 });
    d = addNodeAt(d, 13.095, 80.295);
    expect(d.nodes[1]).toMatchObject({ id: 'n-2', zoneId: null, z: 0 });
    expect(nextNodeId(d)).toBe('n-3');
  });

  it('rejects nodes outside the boundary and bumps revision on moves', () => {
    const d = withBoundary();
    expect(() => addNodeAt(d, 14, 81)).toThrow(/boundary/);
    let d2 = addNodeAt(d, 13.05, 80.25);
    expect(d2.nodes[0]!.fingerprintRevision).toBe(1);
    d2 = moveNode(d2, 'n-1', 13.06, 80.26);
    expect(d2.nodes[0]).toMatchObject({ lat: 13.06, fingerprintRevision: 2 });
    d2 = setNodeFloor(d2, 'n-1', 0);
    expect(d2.nodes[0]!.fingerprintRevision).toBe(2);
  });

  it('connects paths, entrances, and stairs with validation', () => {
    let d = addZone(withBoundary(), { name: 'A', bounds: ZONE_BOUNDS, floors: [{ z: 0, label: 'Ground' }, { z: 1, label: 'Level 1' }] });
    d = addNodeAt(d, 13.05, 80.24, 'b-a', 0);
    d = addNodeAt(d, 13.05, 80.245, 'b-a', 1);
    d = addNodeAt(d, 13.09, 80.29, null, 0);
    d = connectNodes(d, 'n-1', 'n-2', 'stairs', 4);
    expect(d.edges).toHaveLength(1);
    d = addNodeAt(d, 13.055, 80.245, 'b-a', 1);
    expect(() => connectNodes(d, 'n-1', 'n-4', 'path', 4)).toThrow(/same zone and floor/);
    d = connectNodes(d, 'n-3', 'n-1', 'entrance', 10);
    expect(d.edges).toHaveLength(2);
    expect(() => connectNodes(d, 'n-1', 'n-1', 'path', 1)).toThrow(/different/);
  });

  it('routes legacy ordinary Connect through geometric reconciliation', () => {
    let d = addZone(withBoundary(), { name: 'A', bounds: ZONE_BOUNDS });
    d = addNodeAt(d, 13.05, 80.2499, 'b-a', 0);
    d = addNodeAt(d, 13.05, 80.2501, 'b-a', 0);
    d = addNodeAt(d, 13.0499, 80.25, 'b-a', 0);
    d = addNodeAt(d, 13.0501, 80.25, 'b-a', 0);

    d = connectNodes(d, 'n-1', 'n-2', 'path');
    d = connectNodes(d, 'n-3', 'n-4', 'path');

    const junction = d.nodes.find((node) => node.generated && node.lat === 13.05 && node.lng === 80.25);
    expect(junction).toBeDefined();
    expect(d.edges.some((edge) => [edge.from, edge.to].includes('n-1') && [edge.from, edge.to].includes('n-2'))).toBe(false);
    expect(d.edges.filter((edge) => edge.from === junction!.id || edge.to === junction!.id)).toHaveLength(4);
  });

  it('rejects manual legacy path moves that would create unresolved crossings', () => {
    let d = addZone(withBoundary(), { name: 'A', bounds: ZONE_BOUNDS });
    d = addNodeAt(d, 13.05, 80.2499, 'b-a', 0);
    d = addNodeAt(d, 13.05, 80.2501, 'b-a', 0);
    d = addNodeAt(d, 13.0499, 80.2502, 'b-a', 0);
    d = addNodeAt(d, 13.0501, 80.2502, 'b-a', 0);
    d = connectNodes(d, 'n-1', 'n-2', 'path');
    d = connectNodes(d, 'n-3', 'n-4', 'path');
    const before = structuredClone(d);

    expect(() => moveNode(d, 'n-3', 13.0499, 80.25)).toThrow(/disconnect|delete|connected/i);
    expect(d).toEqual(before);
  });

  it('rejects connected ungrouped form and floor moves atomically while allowing renames and no-op updates', () => {
    let d = addZone(withBoundary(), { name: 'A', bounds: ZONE_BOUNDS, floors: [{ z: 0, label: 'Ground' }, { z: 1, label: 'Level 1' }] });
    d = addNodeAt(d, 13.05, 80.2499, 'b-a', 0);
    d = addNodeAt(d, 13.05, 80.2501, 'b-a', 0);
    d = connectNodes(d, 'n-1', 'n-2', 'path');
    const before = structuredClone(d);

    const renamed = renameNode(d, 'n-1', 'Renamed connected node');
    expect(renamed.nodes.find((n) => n.id === 'n-1')).toMatchObject({ name: 'Renamed connected node', fingerprintRevision: 1 });

    const noop = updateNodeLocation(d, 'n-1', 13.05, 80.2499, 'b-a', 0);
    expect(noop).toEqual(d);
    expect(() => updateNodeLocation(d, 'n-1', 13.05001, 80.2499, 'b-a', 0)).toThrow(/disconnect|reconnect|connected/i);
    expect(() => setNodeFloor(d, 'n-1', 1)).toThrow(/disconnect|reconnect|connected/i);
    expect(d).toEqual(before);
  });

  it('rejects disconnecting an edge owned by grouped path metadata', () => {
    let d = addZone(withBoundary(), { name: 'A', bounds: ZONE_BOUNDS });
    d = addNodeAt(d, 13.05, 80.2499, 'b-a', 0);
    d = addNodeAt(d, 13.05, 80.2501, 'b-a', 0);
    d = { ...d, edges: [{ from: 'n-1', to: 'n-2', meters: 2, kind: 'path' }], paths: [{ id: 'p', name: 'P', nodeIds: ['n-1', 'n-2'] }] };

    expect(() => disconnectNodes(d, 'n-1', 'n-2')).toThrow(/drawn path|grouped/i);
  });

  it('refuses to delete nodes with references', () => {
    let d = addZone(withBoundary(), { name: 'A', bounds: ZONE_BOUNDS });
    d = addNodeAt(d, 13.05, 80.25, 'b-a', 0);
    d = { ...d, places: [{ id: 'p', name: 'Room', zoneId: 'b-a', nodeId: 'n-1' }] };
    expect(() => removeNode(d, 'n-1')).toThrow(/place/);
  });
});

describe('editor-v3 floors', () => {
  it('adds and removes floors with usage guards', () => {
    let d = addZone(withBoundary(), { name: 'A', bounds: ZONE_BOUNDS });
    d = addFloor(d, 'b-a', { z: 1, label: 'Level 1' });
    expect(d.indoorZones[0]!.floors).toHaveLength(2);
    expect(() => addFloor(d, 'b-a', { z: 1, label: 'Dup' })).toThrow(/already has floor/);
    d = addNodeAt(d, 13.05, 80.25, 'b-a', 1);
    expect(() => removeFloor(d, 'b-a', 1)).toThrow(/n-1/);
    d = removeFloor(setNodeFloor(d, 'n-1', 0), 'b-a', 1);
    expect(d.indoorZones[0]!.floors.map((f) => f.z)).toEqual([0]);
  });
});
