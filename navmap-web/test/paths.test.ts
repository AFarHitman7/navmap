import { describe, expect, it } from 'vitest';
import { addFloor, addNodeAt, connectNodes, emptyDraftV3, setNodeFloor } from '../src/editor-v3/model';
import { addDrawnPath, deleteConnection, movePathNode, removeDrawnPath } from '../src/editor-v3/paths';
import type { PathVertex } from '../src/editor-v3/paths';
import { distanceMeters } from '../src/geo-v3';

const base = () => ({
  ...emptyDraftV3(),
  boundary: { south: 13, north: 13.1, west: 80.2, east: 80.3 },
  indoorZones: [
    {
      id: 'b-a',
      name: 'A',
      bounds: { south: 13.02, north: 13.08, west: 80.22, east: 80.28 },
      floors: [
        { z: 0, label: 'Ground' },
        { z: 1, label: 'Upper' },
      ],
    },
    {
      id: 'b-b',
      name: 'B',
      bounds: { south: 13.085, north: 13.095, west: 80.285, east: 80.295 },
      floors: [{ z: 0, label: 'Ground' }],
    },
  ],
});
const vertex = (lat: number, lng: number, z = 0, zoneId: string | null = 'b-a'): PathVertex => ({ lat, lng, z, zoneId });
const key = (from: string, to: string) => JSON.stringify([from, to].sort());
const onLine = (point: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const cross = (point.lng - a.lng) * (b.lat - a.lat) - (point.lat - a.lat) * (b.lng - a.lng);
  return Math.abs(cross) < 1e-10;
};

const isOrderedSubsequence = (sequence: string[], expected: string[]) => {
  let index = 0;
  for (const id of sequence) if (id === expected[index]) index++;
  return index === expected.length;
};

describe('drawn paths graph lifecycle', () => {
  it('retains a bend and deletes a grouped path', () => {
    const d = addDrawnPath(base(), [vertex(13.05, 80.25), vertex(13.0501, 80.25), vertex(13.0501, 80.2501)]);
    expect(d.nodes.some((n) => n.lat === 13.0501 && n.lng === 80.25)).toBe(true);
    expect(d.paths).toHaveLength(1);
    const removed = removeDrawnPath(d, d.paths![0]!.id);
    expect(removed.edges).toEqual([]);
    expect(removed.nodes).toEqual([]);
  });

  it('shares a same-floor crossing without moving existing samples', () => {
    const first = addDrawnPath(base(), [vertex(13.05, 80.2499), vertex(13.05, 80.2501)]);
    const second = addDrawnPath(first, [vertex(13.0499, 80.25), vertex(13.0501, 80.25)]);
    const shared = second.paths![0]!.nodeIds.filter((id) => second.paths![1]!.nodeIds.includes(id));
    expect(shared).toHaveLength(1);
    for (const n of first.nodes) expect(second.nodes.find((x) => x.id === n.id)).toEqual(n);
    const removed = removeDrawnPath(second, second.paths![1]!.id);
    expect(removed.nodes.some((n) => n.id === shared[0])).toBe(true);
  });

  it('joins an endpoint onto an existing segment and updates the stored path sequence', () => {
    const first = addDrawnPath(base(), [vertex(13.05, 80.2499), vertex(13.05, 80.2501)]);
    const joined = addDrawnPath(first, [vertex(13.0499, 80.25), vertex(13.05, 80.25)]);
    const join = joined.nodes.find((n) => n.lat === 13.05 && n.lng === 80.25)!;

    expect(joined.paths![0]!.nodeIds).toContain(join.id);
    expect(joined.paths![1]!.nodeIds.at(-1)).toBe(join.id);
    expect(joined.edges.some((e) => key(e.from, e.to) === key(first.paths![0]!.nodeIds[0]!, first.paths![0]!.nodeIds.at(-1)!))).toBe(false);
  });

  it('splits a legacy path edge at a crossing without converting it to grouped ownership', () => {
    let draft = addNodeAt(base(), 13.05, 80.2499, 'b-a', 0);
    draft = addNodeAt(draft, 13.05, 80.2501, 'b-a', 0);
    draft = connectNodes(draft, 'n-1', 'n-2', 'path');

    const crossed = addDrawnPath(draft, [vertex(13.0499, 80.25), vertex(13.0501, 80.25)]);
    const junction = crossed.nodes.find((n) => n.lat === 13.05 && n.lng === 80.25)!;

    expect(crossed.paths).toHaveLength(1);
    expect(crossed.paths![0]!.nodeIds).toContain(junction.id);
    expect(crossed.edges.some((e) => key(e.from, e.to) === key('n-1', 'n-2'))).toBe(false);
    expect(crossed.edges.filter((e) => e.from === junction.id || e.to === junction.id)).toHaveLength(4);
  });

  it('isolates automatic intersections by floor and zone', () => {
    const ground = addDrawnPath(base(), [vertex(13.05, 80.2499), vertex(13.05, 80.2501)]);
    const upper = addDrawnPath(ground, [vertex(13.0499, 80.25, 1), vertex(13.0501, 80.25, 1)]);
    const otherZone = addDrawnPath(upper, [vertex(13.0899, 80.29, 0, 'b-b'), vertex(13.0901, 80.29, 0, 'b-b')]);

    expect(otherZone.paths![0]!.nodeIds.filter((id) => otherZone.paths![1]!.nodeIds.includes(id))).toEqual([]);
    expect(otherZone.paths![0]!.nodeIds.filter((id) => otherZone.paths![2]!.nodeIds.includes(id))).toEqual([]);
  });

  it('does not split or reject routes because of crossings or identical geometry on another floor', () => {
    const upperHorizontal = addDrawnPath(base(), [vertex(13.05, 80.2499, 1), vertex(13.05, 80.2501, 1)]);

    const groundVertical = addDrawnPath(upperHorizontal, [vertex(13.0499, 80.25), vertex(13.0501, 80.25)]);
    expect(groundVertical.paths![0]!.nodeIds.filter((id) => groundVertical.paths![1]!.nodeIds.includes(id))).toEqual([]);

    expect(() => addDrawnPath(groundVertical, [vertex(13.0499, 80.25, 1), vertex(13.0501, 80.25, 1)])).not.toThrow();
  });

  it('rejects duplicate ordinary vertices, overlaps, and implicit cross-floor links without mutating input', () => {
    const draft = addDrawnPath(base(), [vertex(13.05, 80.2499), vertex(13.05, 80.2501)]);
    const before = structuredClone(draft);

    expect(() => addDrawnPath(draft, [vertex(13.05, 80.25), vertex(13.05, 80.25)])).toThrow(/positive|duplicate/i);
    expect(() => addDrawnPath(draft, [vertex(13.05, 80.24995), vertex(13.05, 80.25005)])).toThrow(/overlap/i);
    expect(() => addDrawnPath(draft, [vertex(13.05, 80.25), vertex(13.05, 80.25, 1)])).toThrow(/stairs/i);
    expect(draft).toEqual(before);
  });

  it('rejects an exact duplicate grouped route immutably', () => {
    const draft = addDrawnPath(base(), [vertex(13.05, 80.25), vertex(13.05, 80.25001)]);
    const before = structuredClone(draft);

    expect(() => addDrawnPath(draft, [vertex(13.05, 80.25), vertex(13.05, 80.25001)])).toThrow(/overlap/i);

    expect(draft).toEqual(before);
  });

  it('supports explicit stairs at coincident coordinates and never treats stairs as geometric crossings', () => {
    const stair = addDrawnPath(base(), [vertex(13.05, 80.25), { ...vertex(13.05, 80.25, 1), incomingKind: 'stairs' }], 'Stairs');
    const crossed = addDrawnPath(stair, [vertex(13.0499, 80.25), vertex(13.0501, 80.25)]);

    expect(stair.edges).toHaveLength(1);
    expect(stair.edges[0]).toMatchObject({ kind: 'stairs' });
    expect(crossed.paths![0]!.nodeIds.filter((id) => crossed.paths![1]!.nodeIds.includes(id))).toEqual([]);
  });

  it('rejects self-overlap but keeps self-crossing junctions inside a single path', () => {
    const crossed = addDrawnPath(base(), [
      vertex(13.0499, 80.2499),
      vertex(13.0501, 80.2501),
      vertex(13.0499, 80.2501),
      vertex(13.0501, 80.2499),
    ]);
    const ids = crossed.paths![0]!.nodeIds;
    expect(new Set(ids).size).toBeLessThan(ids.length);
    expect(() => addDrawnPath(base(), [vertex(13.05, 80.2499), vertex(13.05, 80.2501), vertex(13.05, 80.25)])).toThrow(/overlap/i);
  });

  it('preserves manual endpoint, place, and anchor references during grouped deletion', () => {
    let draft = addNodeAt(base(), 13.05, 80.2499, 'b-a', 0);
    const manual = draft.nodes[0]!;
    draft = { ...draft, places: [{ id: 'p-manual', name: 'Manual', zoneId: 'b-a', nodeId: manual.id }], anchors: [{ id: 'a-manual', nodeId: manual.id, label: 'A' }] };
    draft = addDrawnPath(draft, [{ ...vertex(manual.lat, manual.lng), nodeId: manual.id }, vertex(13.05, 80.2501)]);

    const removed = removeDrawnPath(draft, draft.paths![0]!.id);

    expect(removed.nodes).toContainEqual(manual);
    expect(removed.places[0]!.nodeId).toBe(manual.id);
    expect(removed.anchors[0]!.nodeId).toBe(manual.id);
  });

  it('uses unique recreated generated IDs after deletion', () => {
    const first = addDrawnPath(base(), [vertex(13.05, 80.2499), vertex(13.05, 80.2501)]);
    const firstIds = new Set(first.nodes.map((n) => n.id));
    const removed = removeDrawnPath(first, first.paths![0]!.id);
    const second = addDrawnPath(removed, [vertex(13.05, 80.2499), vertex(13.05, 80.2501)]);

    expect(second.nodes.some((n) => firstIds.has(n.id))).toBe(false);
  });

  it('deletes a whole grouped route when one of its connections is deleted', () => {
    const draft = addDrawnPath(base(), [vertex(13.05, 80.2499), vertex(13.05, 80.2501)]);
    const [from, to] = draft.paths![0]!.nodeIds;

    const deleted = deleteConnection(draft, from!, to!);

    expect(deleted.paths).toEqual([]);
    expect(deleted.edges).toEqual([]);
  });

  it('removes only a legacy edge when deleting an ungrouped connection', () => {
    let draft = addNodeAt(base(), 13.05, 80.2499, 'b-a', 0);
    draft = addNodeAt(draft, 13.05, 80.2501, 'b-a', 0);
    draft = connectNodes(draft, 'n-1', 'n-2', 'path');

    const deleted = deleteConnection(draft, 'n-1', 'n-2');

    expect(deleted.nodes.map((n) => n.id)).toEqual(['n-1', 'n-2']);
    expect(deleted.edges).toEqual([]);
  });

  it('moves an unshared grouped point by rebuilding its incident route safely', () => {
    const draft = addDrawnPath(base(), [vertex(13.05, 80.2499), vertex(13.05, 80.2501)]);
    const id = draft.paths![0]!.nodeIds[0]!;
    const moved = movePathNode(draft, id, { lat: 13.05001, lng: 80.2499, zoneId: 'b-a', z: 0 });

    expect(moved.nodes.find((n) => n.id === id)).toMatchObject({ lat: 13.05001, lng: 80.2499, fingerprintRevision: 2 });
    expect(moved.paths![0]!.nodeIds).toContain(id);
  });

  it('moves a straight endpoint by regenerating adjacent interiors and preserving unaffected samples', () => {
    const draft = addDrawnPath(base(), [vertex(13.05, 80.2499), vertex(13.05, 80.2501), vertex(13.05015, 80.2501)]);
    const path = draft.paths![0]!;
    const startId = path.nodeIds[0]!;
    const corner = draft.nodes.find((n) => n.lat === 13.05 && n.lng === 80.2501)!;
    const cornerIndex = path.nodeIds.indexOf(corner.id);
    const oldAdjacentInteriorIds = path.nodeIds.slice(1, cornerIndex);
    const unaffectedSampleId = path.nodeIds[cornerIndex + 1]!;
    const unaffectedSampleBefore = draft.nodes.find((n) => n.id === unaffectedSampleId)!;

    const moved = movePathNode(draft, startId, { lat: 13.05005, lng: 80.2499, zoneId: 'b-a', z: 0 });
    const movedPath = moved.paths!.find((p) => p.id === path.id)!;
    const movedStart = moved.nodes.find((n) => n.id === startId)!;
    const movedCorner = moved.nodes.find((n) => n.id === corner.id)!;
    const movedCornerIndex = movedPath.nodeIds.indexOf(corner.id);
    const newAdjacentNodes = movedPath.nodeIds.slice(0, movedCornerIndex + 1).map((id) => moved.nodes.find((n) => n.id === id)!);

    expect(movedStart).toMatchObject({ lat: 13.05005, lng: 80.2499, fingerprintRevision: 2 });
    expect(oldAdjacentInteriorIds.some((id) => moved.nodes.some((n) => n.id === id))).toBe(false);
    expect(moved.nodes.find((n) => n.id === unaffectedSampleId)).toEqual(unaffectedSampleBefore);
    for (const node of newAdjacentNodes) expect(onLine(node, movedStart, movedCorner)).toBe(true);
    for (let i = 1; i < newAdjacentNodes.length; i++) {
      expect(distanceMeters(newAdjacentNodes[i - 1]!.lat, newAdjacentNodes[i - 1]!.lng, newAdjacentNodes[i]!.lat, newAdjacentNodes[i]!.lng)).toBeLessThanOrEqual(3.001);
    }
  });

  it('keeps externally connected generated samples as structural controls during adjacent moves', () => {
    let draft = addNodeAt(base(), 13.052, 80.25, null, 0);
    draft = addDrawnPath(draft, [vertex(13.05, 80.2499), vertex(13.05, 80.2501)]);
    const path = draft.paths![0]!;
    const interiorId = path.nodeIds[Math.floor(path.nodeIds.length / 2)]!;
    draft = connectNodes(draft, 'n-1', interiorId, 'entrance', 2);
    const beforeInterior = draft.nodes.find((n) => n.id === interiorId)!;

    const moved = movePathNode(draft, path.nodeIds[0]!, { lat: 13.05002, lng: 80.2499, zoneId: 'b-a', z: 0 });
    const movedPath = moved.paths!.find((p) => p.id === path.id)!;

    expect(movedPath.nodeIds).toContain(interiorId);
    expect(moved.nodes.find((n) => n.id === interiorId)).toEqual(beforeInterior);
    expect(moved.edges).toContainEqual(expect.objectContaining({ kind: 'entrance', from: 'n-1', to: interiorId }));
  });

  it('rejects moving an externally connected grouped endpoint and leaves draft unchanged', () => {
    let draft = addNodeAt(base(), 13.052, 80.25, null, 0);
    draft = addDrawnPath(draft, [vertex(13.05, 80.2499), vertex(13.05, 80.2501)]);
    const endpointId = draft.paths![0]!.nodeIds[0]!;
    draft = connectNodes(draft, 'n-1', endpointId, 'entrance', 2);
    const before = structuredClone(draft);

    expect(() => movePathNode(draft, endpointId, { lat: 13.05002, lng: 80.2499, zoneId: 'b-a', z: 0 })).toThrow(/disconnect|delete.*first/i);
    expect(draft).toEqual(before);
  });

  it('rejects floor changes that would invalidate legacy incident path edges without mutating input', () => {
    let draft = addFloor(base(), 'b-a', { z: 2, label: 'Second' });
    draft = addDrawnPath(draft, [vertex(13.05, 80.2499), vertex(13.05, 80.2501)]);
    const path = draft.paths![0]!;
    const interiorId = path.nodeIds[Math.floor(path.nodeIds.length / 2)]!;
    draft = addNodeAt(draft, 13.05002, 80.25, 'b-a', 0);
    draft = connectNodes(draft, 'n-1', interiorId, 'path', 1);
    const before = structuredClone(draft);

    expect(() => setNodeFloor(draft, interiorId, 1)).toThrow(/incident|connection|same zone and floor/i);
    expect(draft).toEqual(before);
  });

  it('preserves exact unchanged generated sequences and revisions when a far endpoint move introduces a junction', () => {
    const long = addDrawnPath(base(), [vertex(13.05, 80.2499), vertex(13.05, 80.25015), vertex(13.05018, 80.25015)]);
    const path = long.paths![0]!;
    const cornerId = path.controlNodeIds![1]!;
    const cornerIndex = path.nodeIds.indexOf(cornerId);
    const unchangedIds = path.nodeIds.slice(0, cornerIndex + 1);
    const unchangedNodes = unchangedIds.map((id) => long.nodes.find((n) => n.id === id)!);
    const crossed = addDrawnPath(long, [vertex(13.04996, 80.25002), vertex(13.05004, 80.25002)]);

    const moved = movePathNode(crossed, path.nodeIds.at(-1)!, { lat: 13.05018, lng: 80.25018, zoneId: 'b-a', z: 0 });
    const movedPath = moved.paths!.find((p) => p.id === path.id)!;

    expect(isOrderedSubsequence(movedPath.nodeIds, unchangedIds)).toBe(true);
    for (const node of unchangedNodes) expect(moved.nodes.find((n) => n.id === node.id)).toEqual(node);
    for (const id of unchangedIds) expect(movedPath.nodeIds).toContain(id);
  });

  it('preserves all unchanged samples when the affected interior set is empty', () => {
    const draft = addDrawnPath(base(), [vertex(13.05, 80.24999), vertex(13.05, 80.25), vertex(13.05, 80.25012)]);
    const path = draft.paths![0]!;
    const endpointId = path.controlNodeIds![0]!;
    const middleId = path.controlNodeIds![1]!;
    const unchangedIds = path.nodeIds.slice(path.nodeIds.indexOf(middleId));
    const unchangedNodes = unchangedIds.map((id) => draft.nodes.find((n) => n.id === id)!);

    const moved = movePathNode(draft, endpointId, { lat: 13.05001, lng: 80.24999, zoneId: 'b-a', z: 0 });
    const movedPath = moved.paths!.find((p) => p.id === path.id)!;

    for (const id of unchangedIds) expect(movedPath.nodeIds).toContain(id);
    for (const node of unchangedNodes) expect(moved.nodes.find((n) => n.id === node.id)).toEqual(node);
  });

  it('regenerates the closing span when moving the start of a loop', () => {
    const draft = addDrawnPath(base(), [vertex(13.05, 80.2499), vertex(13.0501, 80.25), vertex(13.05, 80.2501), vertex(13.05, 80.2499)]);
    const path = draft.paths![0]!;
    const [aId, bId, cId, repeatedAId] = path.controlNodeIds!;
    expect(aId).toBe(repeatedAId);
    const closingInteriorIds = path.nodeIds.slice(path.nodeIds.indexOf(cId!) + 1, -1);
    expect(closingInteriorIds.length).toBeGreaterThan(0);

    const moved = movePathNode(draft, aId!, { lat: 13.04995, lng: 80.2499, zoneId: 'b-a', z: 0 });
    const movedPath = moved.paths!.find((p) => p.id === path.id)!;

    for (const id of closingInteriorIds) expect(movedPath.nodeIds).not.toContain(id);
    expect(movedPath.controlNodeIds).toEqual([aId, bId, cId, repeatedAId]);
    for (let i = 1; i < movedPath.nodeIds.length; i++) {
      const a = moved.nodes.find((n) => n.id === movedPath.nodeIds[i - 1])!;
      const b = moved.nodes.find((n) => n.id === movedPath.nodeIds[i])!;
      expect(moved.edges.some((e) => key(e.from, e.to) === key(a.id, b.id))).toBe(true);
      expect(distanceMeters(a.lat, a.lng, b.lat, b.lng)).toBeLessThanOrEqual(3.001);
    }
  });

  it('distributes a supplied connection distance across split edges instead of dropping it', () => {
    const drawn = addDrawnPath(base(), [vertex(13.05, 80.2499), vertex(13.05, 80.2501)]);
    let draft = addNodeAt(drawn, 13.0499, 80.25, 'b-a', 0);
    draft = addNodeAt(draft, 13.0501, 80.25, 'b-a', 0);
    const connected = connectNodes(draft, 'n-1', 'n-2', 'path', 100);
    const junction = connected.nodes.find((n) => n.lat === 13.05 && n.lng === 80.25)!;
    const legA = connected.edges.find((e) => key(e.from, e.to) === key('n-1', junction.id))!;
    const legB = connected.edges.find((e) => key(e.from, e.to) === key(junction.id, 'n-2'))!;

    expect(legA.meters + legB.meters).toBeCloseTo(100, 6);
  });

  it('keeps repeated authored controls occurrence-aware in loops when moving a middle control', () => {
    const draft = addDrawnPath(base(), [vertex(13.05, 80.2499), vertex(13.0501, 80.25), vertex(13.05, 80.2501), vertex(13.05, 80.2499)]);
    const path = draft.paths![0]!;
    const [aId, bId, cId, repeatedAId] = path.controlNodeIds!;
    expect(aId).toBe(repeatedAId);

    const moved = movePathNode(draft, bId!, { lat: 13.05011, lng: 80.25, zoneId: 'b-a', z: 0 });
    const movedPath = moved.paths!.find((p) => p.id === path.id)!;

    expect(movedPath.controlNodeIds).toEqual([aId, bId, cId, repeatedAId]);
    expect(movedPath.controlNodeIds!.filter((id) => id === aId)).toHaveLength(2);
    expect(movedPath.controlNodeIds!.length).toBe(4);
  });

  it('rejects transition creation over existing elevator or legacy stairs without adopting ownership', () => {
    let draft = addNodeAt(base(), 13.05, 80.25, 'b-a', 0);
    draft = addNodeAt(draft, 13.05, 80.25, 'b-a', 1);
    const withElevator = connectNodes(draft, 'n-1', 'n-2', 'elevator', 4);
    expect(() => addDrawnPath(withElevator, [{ ...vertex(13.05, 80.25), nodeId: 'n-1' }, { ...vertex(13.05, 80.25, 1), nodeId: 'n-2', incomingKind: 'stairs' }])).toThrow(/existing.*transition|stairs/i);
    expect(withElevator.paths ?? []).toEqual([]);

    const withLegacyStairs = connectNodes(draft, 'n-1', 'n-2', 'stairs', 4);
    expect(() => addDrawnPath(withLegacyStairs, [{ ...vertex(13.05, 80.25), nodeId: 'n-1' }, { ...vertex(13.05, 80.25, 1), nodeId: 'n-2', incomingKind: 'stairs' }])).toThrow(/existing.*transition|stairs/i);
    expect(withLegacyStairs.paths ?? []).toEqual([]);
  });

  it('rejects outdoor routes inside or crossing an indoor zone before mutating input', () => {
    const draft = base();
    const before = structuredClone(draft);
    expect(() => addDrawnPath(draft, [vertex(13.05, 80.24, 0, null), vertex(13.05, 80.26, 0, null)])).toThrow(/outdoor.*zone|indoor/i);
    expect(() => addDrawnPath(draft, [vertex(13.01, 80.25, 0, null), vertex(13.09, 80.25, 0, null)])).toThrow(/outdoor.*zone|indoor/i);
    expect(draft).toEqual(before);
  });

  it('preserves an intentional collinear clicked control when moving an endpoint', () => {
    const draft = addDrawnPath(base(), [vertex(13.05, 80.2499), vertex(13.05, 80.25), vertex(13.05, 80.2501)]);
    const path = draft.paths![0]!;
    const startId = path.controlNodeIds![0]!;
    const middleId = path.controlNodeIds![1]!;
    const endId = path.controlNodeIds![2]!;
    const middleBefore = draft.nodes.find((n) => n.id === middleId)!;

    const moved = movePathNode(draft, startId, { lat: 13.05005, lng: 80.2499, zoneId: 'b-a', z: 0 });
    const movedPath = moved.paths!.find((p) => p.id === path.id)!;

    expect(movedPath.controlNodeIds).toEqual([startId, middleId, endId]);
    expect(movedPath.nodeIds).toContain(middleId);
    expect(moved.nodes.find((n) => n.id === middleId)).toEqual(middleBefore);
  });

  it('promotes a moved interior sample to a durable control for later adjacent moves', () => {
    const draft = addDrawnPath(base(), [vertex(13.05, 80.2499), vertex(13.05, 80.2501)]);
    const path = draft.paths![0]!;
    const startId = path.controlNodeIds![0]!;
    const interiorId = path.nodeIds[Math.floor(path.nodeIds.length / 2)]!;

    const movedInterior = movePathNode(draft, interiorId, { lat: 13.05004, lng: 80.25, zoneId: 'b-a', z: 0 });
    const afterInteriorPath = movedInterior.paths!.find((p) => p.id === path.id)!;
    const promoted = movedInterior.nodes.find((n) => n.id === interiorId)!;

    expect(afterInteriorPath.controlNodeIds).toContain(interiorId);
    expect(promoted).toMatchObject({ lat: 13.05004, lng: 80.25, fingerprintRevision: 2 });

    const movedEndpoint = movePathNode(movedInterior, startId, { lat: 13.05002, lng: 80.2499, zoneId: 'b-a', z: 0 });
    const finalPath = movedEndpoint.paths!.find((p) => p.id === path.id)!;
    const finalPromoted = movedEndpoint.nodes.find((n) => n.id === interiorId)!;

    expect(finalPath.controlNodeIds).toContain(interiorId);
    expect(finalPath.nodeIds).toContain(interiorId);
    expect(finalPromoted).toMatchObject({ id: interiorId, lat: 13.05004, lng: 80.25, fingerprintRevision: 2 });
    for (let i = 1; i < finalPath.nodeIds.length; i++) {
      const a = movedEndpoint.nodes.find((n) => n.id === finalPath.nodeIds[i - 1])!;
      const b = movedEndpoint.nodes.find((n) => n.id === finalPath.nodeIds[i])!;
      expect(distanceMeters(a.lat, a.lng, b.lat, b.lng)).toBeLessThanOrEqual(3.001);
    }
  });

  it('rejects moving a shared junction instead of detaching another route', () => {
    const first = addDrawnPath(base(), [vertex(13.05, 80.2499), vertex(13.05, 80.2501)]);
    const second = addDrawnPath(first, [vertex(13.0499, 80.25), vertex(13.0501, 80.25)]);
    const shared = second.paths![0]!.nodeIds.find((id) => second.paths![1]!.nodeIds.includes(id))!;
    const before = structuredClone(second);

    expect(() => movePathNode(second, shared, { lat: 13.05001, lng: 80.25, zoneId: 'b-a', z: 0 })).toThrow(/shared junction/i);
    expect(second).toEqual(before);
  });
});
