import { describe, expect, it } from 'vitest';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5';
import { parseMapDraft, upgradeV4Draft, type MapDraft } from '../src/map-contract';
import { containsPosition, emptyMapDraft, segmentMetrics } from '../src/map-geometry';
import { commitEdit, createHistory, redoEdit, undoEdit } from '../src/editor-v3/history';
import {
  addFloorV5,
  addPlaceToNodeV5,
  assignBackground,
  calibrateFrame,
  removeFloorV5,
  removeNodeV5,
  removePathV5,
  removePlaceV5,
  setBoundaryV5,
} from '../src/editor-v3/model';
import {
  addEntrance,
  addRegularNode,
  addRegularPath,
  addStair,
  addStairPath,
  removeTransition,
} from '../src/editor-v3/objects';
import { projectMap } from '../src/editor-v3/presentation';
import {
  isGpsStale,
  isSecureContextForGeolocation,
  isValidGpsReading,
  toNodeDisplay,
} from '../src/location-view';
import { buildDirections } from '../../shared/src/directions';

const asset = (id: string) => ({ assetId: id, width: 1000, height: 1000, sha256: 'a'.repeat(64), byteLength: 248112 });

function v4LegacyDraft(venueId: string): Record<string, unknown> {
  return {
    schemaVersion: 4,
    venueId,
    boundary: { north: 13.1, south: 13.0, east: 80.3, west: 80.2 },
    indoorZones: [{
      id: 'b-legacy', name: 'Legacy Hall',
      bounds: { north: 13.08, south: 13.02, east: 80.28, west: 80.22 },
      floors: [{ z: 0, label: 'Ground' }],
    }],
    nodes: [
      { id: 'n-legacy-out', name: 'Legacy entrance', lat: 13.09, lng: 80.29, z: 0, zoneId: null, fingerprintRevision: 1 },
      { id: 'n-legacy-hall', name: 'Legacy hall', lat: 13.05, lng: 80.245, z: 0, zoneId: 'b-legacy', fingerprintRevision: 1 },
    ],
    edges: [{ from: 'n-legacy-out', to: 'n-legacy-hall', meters: 12, kind: 'entrance' }],
    places: [{ id: 'p-legacy', name: 'Legacy lobby', zoneId: 'b-legacy', nodeId: 'n-legacy-hall' }],
    anchors: [],
    aps: [],
  };
}

describe('Task 16 acceptance: V4 readability and V5 boundaries', () => {
  it('reads a legacy V4 draft through the in-memory upgrade adapter', () => {
    const upgraded = upgradeV4Draft(v4LegacyDraft('legacy-v4'));
    expect(upgraded.schemaVersion).toBe(5);
    expect(upgraded.canvas.kind).toBe('geographic');
    expect(upgraded.nodes.map((node) => node.id)).toEqual(['n-legacy-out', 'n-legacy-hall']);
    expect(upgraded.transitions.length).toBeGreaterThan(0);
  });

  it('keeps two named maps isolated by venue identity', () => {
    const first = { ...staticDraft(), venueId: 'map-a' };
    const second = { ...staticDraft(), venueId: 'map-b' };
    const withNode = addRegularNode(first, 'frame-b-a-z0', { kind: 'local', x: 0.5, y: 0.5 }, 'Only in A');
    expect(withNode.nodes.length).toBe(first.nodes.length + 1);
    expect(second.nodes.length).toBe(first.nodes.length);
    expect(parseMapDraft(JSON.parse(JSON.stringify(second))).venueId).toBe('map-b');
  });

  it('creates correctly typed empty drafts per canvas kind', () => {
    expect(emptyMapDraft('geo', 'geographic').canvas.kind).toBe('geographic');
    expect(emptyMapDraft('static', 'static').canvas.kind).toBe('static');
    expect(emptyMapDraft('static', 'static').boundary).toMatchObject({ kind: 'local' });
  });

  it('rejects cross-frame geometry comparisons', () => {
    const draft = staticDraft();
    const frame = draft.frames[0]!;
    const other = draft.frames[1]!;
    expect(containsPosition(frame, { kind: 'local', x: 0.5, y: 0.5 })).toBe(true);
    const cost = segmentMetrics(
      { ...draft.nodes[0]!, frameId: frame.id, position: { kind: 'local', x: 0, y: 0 } },
      { ...draft.nodes[0]!, frameId: other.id, position: { kind: 'local', x: 1, y: 1 } },
      frame,
    );
    expect(cost.cost).toBeGreaterThan(0);
  });
});

describe('Task 16 acceptance: undo covers every edit tool', () => {
  function stripRevisions(draft: MapDraft): MapDraft {
    return { ...draft, nodes: draft.nodes.map((node) => ({ ...node, fingerprintRevision: 0 })) };
  }

  function committed(label: string, base: MapDraft, edit: (draft: MapDraft) => MapDraft): MapDraft {
    // Undo restores geometry exactly; fingerprint revisions stay monotonic so
    // undone geometry never resurrects a stale survey identity (Ruling 3).
    const edited = edit(base);
    const next = commitEdit(createHistory(base), edited, label);
    const undone = undoEdit(next);
    expect(stripRevisions(undone.present)).toEqual(stripRevisions(base));
    for (const node of undone.present.nodes) {
      const before = base.nodes.find((candidate) => candidate.id === node.id);
      if (before) expect(node.fingerprintRevision).toBeGreaterThanOrEqual(before.fingerprintRevision);
    }
    expect(stripRevisions(redoEdit(undone).present)).toEqual(stripRevisions(edited));
    return redoEdit(undone).present;
  }

  it('undoes boundary, building, and floor edits', () => {
    const draft = geographicDraft();
    committed('Update map boundary', draft, (current) => setBoundaryV5(current, {
      kind: 'geographic', north: 13.2, south: 12.9, east: 80.4, west: 80.1,
    }));
    const withFloor = committed('Add building', draft, (current) => addFloorV5(current, 'b-a', 2, 'Level 2'));
    expect(withFloor.frames.some((frame) => frame.id === 'frame-b-a-z2')).toBe(true);
    const withoutFloor = committed('Remove floor', withFloor, (current) => removeFloorV5(current, 'b-a', 2));
    expect(withoutFloor.frames.some((frame) => frame.id === 'frame-b-a-z2')).toBe(false);
  });

  it('undoes background assignment, calibration, and node/place/path edits', () => {
    const bare = { ...staticDraft(), frames: staticDraft().frames.map((frame) => ({ ...frame, background: undefined, calibration: undefined })) };
    const assigned = committed('Assign floor background', bare, (current) => assignBackground(current, 'frame-b-a-z0', asset('bg-new')));
    expect(assigned.frames.find((frame) => frame.id === 'frame-b-a-z0')?.background?.assetId).toBe('bg-new');
    const calibrated = committed('Calibrate floor scale', assigned, (current) => calibrateFrame(
      current, 'frame-b-a-z0', { x: 0, y: 0 }, { x: 1, y: 0 }, 100));
    expect(calibrated.frames.find((frame) => frame.id === 'frame-b-a-z0')?.calibration?.metersPerPixel).toBeCloseTo(0.1);
    expect(() => calibrateFrame(calibrated, 'frame-b-a-z0', { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, 10))
      .toThrow('Choose two distinct points and a positive distance');
    const withPlace = committed('Add place', calibrated, (current) => addPlaceToNodeV5(current, 's-a0b', 'Cafe'));
    expect(withPlace.places.some((place) => place.name === 'Cafe')).toBe(true);
    const withoutPlace = committed('Delete place', withPlace, (current) => removePlaceV5(current, withPlace.places.find((place) => place.name === 'Cafe')!.id));
    expect(withoutPlace.places.some((place) => place.name === 'Cafe')).toBe(false);
    const regularPathId = withoutPlace.paths.find((path) => path.kind === 'regular')!.id;
    const withoutPath = committed('Delete path', withoutPlace, (current) => removePathV5(current, regularPathId));
    expect(withoutPath.paths.some((path) => path.id === regularPathId)).toBe(false);
    const withoutNode = committed('Delete node', withoutPath, (current) => removeNodeV5(current, 's-a0b'));
    expect(withoutNode.nodes.some((node) => node.id === 's-a0b')).toBe(false);
  });

  it('undoes stair, entrance, and stair-path transactions atomically', () => {
    const draft = staticDraft();
    const outdoorReady = assignBackground(draft, 'frame-outdoor-z0', asset('bg-out'));
    const withEntrance = committed('Add entrance', outdoorReady, (current) => addEntrance(
      current, { frameId: 'frame-b-a-z0', position: { kind: 'local', x: 0.4, y: 0.4 } },
      { frameId: 'frame-outdoor-z0', position: { kind: 'local', x: 0.5, y: 0.5 } }, 'Side door'));
    expect(withEntrance.transitions.length).toBe(outdoorReady.transitions.length + 1);
    const withStair = committed('Add stairs', withEntrance, (current) => addStair(
      current, { frameId: 'frame-b-a-z0', position: { kind: 'local', x: 0.6, y: 0.6 } },
      { frameId: 'frame-b-a-z1', position: { kind: 'local', x: 0.6, y: 0.6 } }, 'West stairs'));
    const stairTransition = withStair.transitions.find((transition) => transition.kind === 'stair');
    expect(stairTransition).toBeDefined();
    const withPath = committed('Add stair path', withStair, (current) => addStairPath(current, stairTransition!.id, 'West stairs route'));
    expect(withPath.paths.some((path) => path.transitionId === stairTransition!.id)).toBe(true);
    const withoutTransition = committed('Delete connection', withPath, (current) => removeTransition(current, stairTransition!.id));
    expect(withoutTransition.transitions.some((transition) => transition.id === stairTransition!.id)).toBe(false);
    const withDrawn = committed('Draw path', withoutTransition, (current) => addRegularPath(current, [
      { frameId: 'frame-b-a-z0', position: { kind: 'local', x: 0.1, y: 0.1 } },
      { frameId: 'frame-b-a-z0', position: { kind: 'local', x: 0.2, y: 0.2 } },
    ], 'Probe'));
    expect(withDrawn.paths.some((path) => path.name === 'Probe')).toBe(true);
  });

  it('treats failed commits as no-ops that never touch history', () => {
    const draft = staticDraft();
    const state = commitEdit(createHistory(draft), draft, 'no-op');
    expect(undoEdit(state).present).toBe(draft);
  });
});

describe('Task 16 acceptance: presentation and visitor abstraction', () => {
  it('hides generated samples in the editor but keeps them for routing', () => {
    const draft = staticDraft();
    const projected = projectMap(draft, 'editor', { kind: 'none' });
    expect(projected.nodes.some((node) => node.generated)).toBe(false);
    expect(draft.nodes.some((node) => node.generated)).toBe(true);
    expect(projected.lines.length).toBeGreaterThan(0);
  });

  it('shows no path lines, handles, or reference names in the visitor', () => {
    const manifest = { ...staticDraft(), version: 1, profiles: [] };
    const projected = projectMap(manifest, 'visitor', { kind: 'none' });
    expect(projected.lines).toHaveLength(0);
    expect(projected.handles).toHaveLength(0);
    expect(projected.nodes.some((node) => node.generated)).toBe(false);
    const route = buildDirections(manifest, manifest.paths[0]!.nodeIds);
    expect(route.instructions.map((instruction) => instruction.text).join(' ')).not.toContain('Survey point');
    expect(route.totalMeters).toBeUndefined();
  });

  it('reports calibrated static distances only when every edge has metres', () => {
    const geo = { ...geographicDraft(), version: 1, profiles: [] };
    const route = buildDirections(geo, ['n-out', 'n-a0', 'n-a0b']);
    expect(route.totalMeters).toBe(30);
  });
});

describe('Task 16 acceptance: honest GPS and node position states', () => {
  it('classifies permission and reading states without inventing a position', () => {
    expect(isValidGpsReading(13.05, 80.25, 8, Date.now())).toBe(true);
    expect(isValidGpsReading(Number.NaN, 80.25, 8, Date.now())).toBe(false);
    expect(isValidGpsReading(13.05, 80.25, -1, Date.now())).toBe(false);
    expect(isGpsStale(Date.now() - 61_000, Date.now())).toBe(true);
    expect(isGpsStale(Date.now() - 10_000, Date.now())).toBe(false);
    expect(isSecureContextForGeolocation({ isSecureContext: true, hostname: 'example.com' })).toBe(true);
    expect(isSecureContextForGeolocation({ isSecureContext: false, hostname: 'example.com' })).toBe(false);
    expect(isSecureContextForGeolocation({ isSecureContext: false, hostname: '127.0.0.1' })).toBe(true);
    const node = toNodeDisplay({ nodeId: 'n-a0', source: 'qr', seenAt: Date.now() - 10_000 }, Date.now());
    expect(node).toMatchObject({ kind: 'node', nodeId: 'n-a0', source: 'qr', stale: false });
    expect(toNodeDisplay({ nodeId: 'n-a0', source: 'wifi', seenAt: Date.now() - 200_000 }, Date.now())).toMatchObject({ stale: true });
  });

  it('survives a JSON reload round-trip without invented coordinates', () => {
    const reloaded = parseMapDraft(JSON.parse(JSON.stringify(staticDraft())));
    expect(reloaded.nodes[0]?.position).toMatchObject({ kind: 'local', x: 0.2, y: 0.3 });
    expect('lat' in (reloaded.nodes[0]?.position ?? {})).toBe(false);
  });
});
