import { describe, expect, it } from 'vitest';
import {
  addNodeAt,
  addPlaceToNode,
  addZone,
  connectNodes,
  editPlace,
  emptyDraftV3,
  moveNode,
  removeNode,
  removePlace,
  renameNode,
  setNodeFloor,
  updateNodeLocation,
} from '../src/editor-v3/model';
import { addDrawnPath } from '../src/editor-v3/paths';
import { parseDraftV3 } from '../src/contract-v3';

const BOUNDARY = { north: 13.1, south: 13.0, east: 80.3, west: 80.2 };
const ZONE_BOUNDS = { north: 13.08, south: 13.02, east: 80.28, west: 80.22 };
const SECOND_ZONE_BOUNDS = { north: 13.095, south: 13.085, east: 80.295, west: 80.285 };

function withBoundary() {
  return { ...emptyDraftV3('demo'), boundary: { ...BOUNDARY } };
}

function withTwoZones() {
  let draft = withBoundary();
  draft = addZone(draft, { name: 'A', bounds: ZONE_BOUNDS, floors: [{ z: 0, label: 'Ground' }, { z: 1, label: 'Level 1' }] });
  draft = addZone(draft, { name: 'B', bounds: SECOND_ZONE_BOUNDS });
  return draft;
}

describe('editor-v3 model node operations', () => {
  it('creates V4 drafts and gives new nodes deterministic default names', () => {
    const draft = addNodeAt(withBoundary(), 13.05, 80.25);

    expect(draft.schemaVersion).toBe(4);
    expect(draft.nodes[0]).toMatchObject({ id: 'n-1', name: 'Node n-1' });
    expect(parseDraftV3(draft).nodes[0]!.name).toBe('Node n-1');
  });

  it('renames nodes without changing IDs, edges, place references, or fingerprint revisions', () => {
    let draft = withTwoZones();
    draft = addNodeAt(draft, 13.05, 80.25, 'b-a', 0);
    draft = addNodeAt(draft, 13.055, 80.255, 'b-a', 0);
    draft = connectNodes(draft, 'n-1', 'n-2', 'path', 4);
    draft = addPlaceToNode(draft, 'n-1', 'Lobby');
    const beforeNode = draft.nodes[0]!;
    const beforeEdges = draft.edges;
    const beforePlace = draft.places[0]!;

    const renamed = renameNode(draft, 'n-1', '  Main Entrance  ');

    expect(renamed.nodes[0]).toMatchObject({ id: beforeNode.id, name: 'Main Entrance', fingerprintRevision: beforeNode.fingerprintRevision });
    expect(renamed.edges).toEqual(beforeEdges);
    expect(renamed.places[0]).toMatchObject({ id: beforePlace.id, nodeId: 'n-1', zoneId: 'b-a' });
    expect(() => renameNode(renamed, 'n-1', '   ')).toThrow(/Node name is required/);
    expect(() => renameNode(renamed, 'missing', 'Name')).toThrow(/Unknown node missing/);
  });

  it('updates node position and floor while preserving zone, bounds, and fingerprint rules', () => {
    let draft = withTwoZones();
    draft = addNodeAt(draft, 13.05, 80.25, 'b-a', 0);
    draft = updateNodeLocation(draft, 'n-1', 13.055, 80.255, 'b-a', 1);

    expect(draft.nodes[0]).toMatchObject({ lat: 13.055, lng: 80.255, zoneId: 'b-a', z: 1, fingerprintRevision: 2 });
    expect(() => updateNodeLocation(draft, 'n-1', 13.09, 80.29, 'b-a', 1)).toThrow(/outside zone A/);
    expect(() => updateNodeLocation(draft, 'n-1', 13.055, 80.255, 'b-a', 9)).toThrow(/no floor 9/);
  });

  it('moves one node and increments only that node fingerprint revision once', () => {
    let draft = withBoundary();
    draft = addNodeAt(draft, 13.05, 80.25, null, 0);
    draft = addNodeAt(draft, 13.06, 80.26, null, 0);

    const moved = moveNode(draft, 'n-1', 13.055, 80.255);

    expect(moved.nodes[0]).toMatchObject({ id: 'n-1', lat: 13.055, lng: 80.255, fingerprintRevision: 2 });
    expect(moved.nodes[1]).toMatchObject({ id: 'n-2', lat: 13.06, lng: 80.26, fingerprintRevision: 1 });
  });

  it('routes grouped point moves through path regeneration and rejects direct grouped deletion', () => {
    let draft = withTwoZones();
    draft = addDrawnPath(draft, [
      { lat: 13.05, lng: 80.2499, zoneId: 'b-a', z: 0 },
      { lat: 13.05, lng: 80.2501, zoneId: 'b-a', z: 0 },
    ]);
    const id = draft.paths![0]!.nodeIds[0]!;

    const moved = moveNode(draft, id, 13.05001, 80.2499);
    expect(moved.nodes.find((n) => n.id === id)).toMatchObject({ lat: 13.05001, lng: 80.2499, fingerprintRevision: 2 });
    expect(() => removeNode(moved, id)).toThrow(/delete its path first/i);
  });

  it('routes grouped point floor changes through explicit path validation', () => {
    let draft = withTwoZones();
    draft = addDrawnPath(draft, [
      { lat: 13.05, lng: 80.2499, zoneId: 'b-a', z: 0 },
      { lat: 13.05, lng: 80.2501, zoneId: 'b-a', z: 0 },
    ]);
    const id = draft.paths![0]!.nodeIds[0]!;

    expect(() => setNodeFloor(draft, id, 1)).toThrow(/stairs|path/i);
    expect(() => updateNodeLocation(draft, id, 13.05001, 80.2499, 'b-a', 1)).toThrow(/stairs|path/i);
  });

  it('keeps linked place zone integrity when a placed node moves across zones', () => {
    let draft = withTwoZones();
    draft = addNodeAt(draft, 13.05, 80.25, 'b-a', 0);
    draft = addPlaceToNode(draft, 'n-1', 'Lobby');

    draft = updateNodeLocation(draft, 'n-1', 13.09, 80.29, 'b-b', 0);

    expect(draft.nodes[0]).toMatchObject({ id: 'n-1', zoneId: 'b-b' });
    expect(draft.places[0]).toMatchObject({ id: 'p-1', nodeId: 'n-1', zoneId: 'b-b' });
  });

  it('rejects moving a placed node outdoors so places remain assigned indoors', () => {
    let draft = withTwoZones();
    draft = addNodeAt(draft, 13.05, 80.25, 'b-a', 0);
    draft = addPlaceToNode(draft, 'n-1', 'Lobby');

    expect(() => updateNodeLocation(draft, 'n-1', 13.095, 80.275, null, 0)).toThrow(/Delete or reassign the place Lobby/);
    expect(draft.nodes[0]).toMatchObject({ id: 'n-1', zoneId: 'b-a' });
    expect(draft.places[0]).toMatchObject({ id: 'p-1', nodeId: 'n-1', zoneId: 'b-a' });
  });
});

describe('editor-v3 model place operations', () => {
  it('creates one named place per indoor node with deterministic IDs', () => {
    let draft = withTwoZones();
    draft = addNodeAt(draft, 13.05, 80.25, 'b-a', 0);
    draft = addPlaceToNode(draft, 'n-1', '  Lobby  ');

    expect(draft.places).toEqual([{ id: 'p-1', name: 'Lobby', zoneId: 'b-a', nodeId: 'n-1' }]);
    expect(() => addPlaceToNode(draft, 'n-1', 'Reception')).toThrow(/already has a place/);
    expect(() => addPlaceToNode(draft, 'n-404', 'Missing')).toThrow(/Unknown node n-404/);
    expect(() => addPlaceToNode(draft, 'n-1', '   ')).toThrow(/Place name is required/);
  });

  it('edits place names and reassigns places only to valid indoor node-zone pairs', () => {
    let draft = withTwoZones();
    draft = addNodeAt(draft, 13.05, 80.25, 'b-a', 0);
    draft = addNodeAt(draft, 13.09, 80.29, 'b-b', 0);
    draft = addNodeAt(draft, 13.095, 80.295, null, 0);
    draft = addPlaceToNode(draft, 'n-1', 'Lobby');

    draft = editPlace(draft, 'p-1', { name: '  Atrium  ', nodeId: 'n-2' });

    expect(draft.places[0]).toEqual({ id: 'p-1', name: 'Atrium', zoneId: 'b-b', nodeId: 'n-2' });
    expect(() => editPlace(draft, 'p-1', { name: '   ' })).toThrow(/Place name is required/);
    expect(() => editPlace(draft, 'p-missing', { name: 'X' })).toThrow(/Unknown place p-missing/);
    expect(() => editPlace(draft, 'p-1', { nodeId: 'n-404' })).toThrow(/Unknown node n-404/);
    expect(() => editPlace(draft, 'p-1', { nodeId: 'n-3' })).toThrow(/Place must be assigned to an indoor node/);
  });

  it('rejects place reassignment to an occupied node and removes places by ID', () => {
    let draft = withTwoZones();
    draft = addNodeAt(draft, 13.05, 80.25, 'b-a', 0);
    draft = addNodeAt(draft, 13.055, 80.255, 'b-a', 0);
    draft = addPlaceToNode(draft, 'n-1', 'Lobby');
    draft = addPlaceToNode(draft, 'n-2', 'Cafe');

    expect(() => editPlace(draft, 'p-1', { nodeId: 'n-2' })).toThrow(/already has a place/);
    draft = removePlace(draft, 'p-2');
    expect(draft.places.map((p) => p.id)).toEqual(['p-1']);
    expect(() => removePlace(draft, 'p-404')).toThrow(/Unknown place p-404/);
  });
});
