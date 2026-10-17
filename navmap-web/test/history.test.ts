// Task 3 RED: transaction history with monotonic revision high-water marks.
// Works for both V4 (DraftV3) and V5 (MapDraft) documents.
import { describe, expect, it } from 'vitest';
import type { DraftV3 } from '../src/contract-v3';
import {
  addNodeAt,
  emptyDraftV3,
  moveNode,
  removeNode,
  renameNode,
} from '../src/editor-v3/model';
import { addDrawnPath, removeDrawnPath } from '../src/editor-v3/paths';
import {
  canRedo,
  canUndo,
  commitEdit,
  createHistory,
  isDirty,
  redoEdit,
  undoEdit,
  MAX_HISTORY,
} from '../src/editor-v3/history';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5';
import {
  invalidateFrameNodesV5,
  moveNodeV5,
  renameNodeV5,
  setNodeVisibilityV5,
} from '../src/editor-v3/model';
import { movePathNodeV5 } from '../src/editor-v3/paths';
import type { MapDraft } from '../src/map-contract';

const BOUNDARY = { north: 13.1, south: 13.0, east: 80.3, west: 80.2 };

function v4Base(): DraftV3 {
  let draft: DraftV3 = { ...emptyDraftV3('demo'), boundary: { ...BOUNDARY } };
  draft = addNodeAt(draft, 13.05, 80.25, null, 0);
  return draft;
}

describe('editor history core', () => {
  it('keeps save history and returns to a clean saved geometry', () => {
    const first = geographicDraft();
    let state = createHistory(first);
    const second = { ...first, nodes: first.nodes.map((n, i) => (i ? n : { ...n, name: 'Lab' })) };
    state = commitEdit(state, second, 'Rename node');
    state = { ...state, lastSaved: second };
    expect(undoEdit(state).present.nodes[0]!.name).toBe(first.nodes[0]!.name);
    expect(redoEdit(undoEdit(state)).present).toEqual(second);
  });

  it('starts clean with high-water marks from the initial document', () => {
    const first = v4Base();
    const state = createHistory(first);
    expect(state.present).toBe(first);
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(0);
    expect(isDirty(state)).toBe(false);
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(false);
    expect(state.highWater['n-1']).toBe(1);
  });

  it('ignores no-op commits without growing history', () => {
    const first = v4Base();
    let state = createHistory(first);
    const same = commitEdit(state, { ...first }, 'No-op');
    expect(same).toBe(state);
    expect(canUndo(same)).toBe(false);
  });

  it('marks dirty after a rename and clean after undo to the saved doc', () => {
    let state = createHistory(v4Base());
    const renamed = renameNode(state.present as DraftV3, 'n-1', 'Lab');
    state = commitEdit(state, renamed, 'Rename node');
    expect(isDirty(state)).toBe(true);
    expect(canUndo(state)).toBe(true);
    state = undoEdit(state);
    expect(isDirty(state)).toBe(false);
    expect((state.present as DraftV3).nodes[0]!.name).toBe('Node n-1');
  });

  it('clears redo when a new edit commits', () => {
    let state = createHistory(v4Base());
    state = commitEdit(state, renameNode(state.present as DraftV3, 'n-1', 'A'), 'Rename A');
    state = undoEdit(state);
    expect(canRedo(state)).toBe(true);
    state = commitEdit(state, renameNode(state.present as DraftV3, 'n-1', 'B'), 'Rename B');
    expect(canRedo(state)).toBe(false);
    expect((state.present as DraftV3).nodes[0]!.name).toBe('B');
  });

  it('bounds history to the newest 100 completed edits', () => {
    let state = createHistory(v4Base());
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      state = commitEdit(state, renameNode(state.present as DraftV3, 'n-1', `Name ${i}`), `Rename ${i}`);
    }
    expect(state.past).toHaveLength(MAX_HISTORY);
    expect((state.present as DraftV3).nodes[0]!.name).toBe(`Name ${MAX_HISTORY + 4}`);
  });

  it('groups a node drag into one undoable transaction', () => {
    let state = createHistory(v4Base());
    const moved = moveNode(state.present as DraftV3, 'n-1', 13.051, 80.251);
    state = commitEdit(state, moved, 'Move point');
    expect(canUndo(state)).toBe(true);
    const undone = undoEdit(state);
    expect((undone.present as DraftV3).nodes[0]).toMatchObject({ lat: 13.05, lng: 80.25 });
    // One undo returns to the pre-drag document (geometry equal, revision bumped).
    expect(undone.past).toHaveLength(0);
  });

  it('keeps geometry undone before saving dirty via a bumped revision', () => {
    let state = createHistory(v4Base());
    const before = (state.present as DraftV3).nodes[0]!;
    state = commitEdit(state, moveNode(state.present as DraftV3, 'n-1', 13.051, 80.251), 'Move point');
    state = undoEdit(state);
    const restored = (state.present as DraftV3).nodes[0]!;
    expect({ lat: restored.lat, lng: restored.lng }).toEqual({ lat: before.lat, lng: before.lng });
    expect(restored.fingerprintRevision).toBeGreaterThan(before.fingerprintRevision);
    expect(isDirty(state)).toBe(true);
  });

  it('does not bump revisions when undoing a rename', () => {
    let state = createHistory(v4Base());
    const before = (state.present as DraftV3).nodes[0]!.fingerprintRevision;
    state = commitEdit(state, renameNode(state.present as DraftV3, 'n-1', 'Lab'), 'Rename node');
    state = undoEdit(state);
    expect((state.present as DraftV3).nodes[0]!.fingerprintRevision).toBe(before);
    state = redoEdit(state);
    expect(state.present).toEqual(renameNode(v4Base(), 'n-1', 'Lab'));
  });

  it('groups drawn-path generation into one transaction', () => {
    let draft = v4Base();
    draft = addNodeAt(draft, 13.052, 80.247, null, 0);
    let state = createHistory(draft);
    const drawn = addDrawnPath(state.present as DraftV3, [
      { lat: 13.05, lng: 80.25, zoneId: null, z: 0, nodeId: 'n-1' },
      { lat: 13.052, lng: 80.247, zoneId: null, z: 0, nodeId: 'n-2' },
    ]);
    state = commitEdit(state, drawn, 'Draw path');
    expect((state.present as DraftV3).paths).toHaveLength(1);
    state = undoEdit(state);
    expect((state.present as DraftV3).paths ?? []).toHaveLength(0);
    state = redoEdit(state);
    expect((state.present as DraftV3).paths).toHaveLength(1);
  });

  it('restores deleted nodes above the high-water mark, never reusing stale revisions', () => {
    let state = createHistory(v4Base());
    const created = (state.present as DraftV3).nodes[0]!.fingerprintRevision;
    state = commitEdit(state, removeNode(state.present as DraftV3, 'n-1'), 'Delete point');
    expect((state.present as DraftV3).nodes).toHaveLength(0);
    // Deletion keeps the durable high-water mark for the removed id.
    expect(state.highWater['n-1']).toBe(created);
    const highWaterAtDelete = state.highWater['n-1']!;
    state = undoEdit(state);
    const restored = (state.present as DraftV3).nodes[0]!;
    // Never restore an old sample identity solely because geometry was undone.
    expect(restored.fingerprintRevision).toBe(Math.max(created, highWaterAtDelete) + 1);
  });
});

describe('editor history for V5 documents', () => {
  it('renames V5 nodes without bumping revisions and undoes exactly', () => {
    const first = geographicDraft();
    const before = first.nodes[0]!.fingerprintRevision;
    let state = createHistory(first);
    state = commitEdit(state, renameNodeV5(first, 'n-out', 'Gate'), 'Rename node');
    expect(state.present.nodes[0]!.fingerprintRevision).toBe(before);
    state = undoEdit(state);
    expect(state.present).toEqual(first);
  });

  it('toggles V5 visibility without bumping revisions', () => {
    const first = geographicDraft();
    let state = createHistory(first);
    const toggled = setNodeVisibilityV5(first, 'n-a0', false);
    expect(toggled.nodes.find((n) => n.id === 'n-a0')!.fingerprintRevision).toBe(
      first.nodes.find((n) => n.id === 'n-a0')!.fingerprintRevision,
    );
    state = commitEdit(state, toggled, 'Hide node');
    state = undoEdit(state);
    expect(state.present).toEqual(first);
  });

  it('moves a V5 node with a bumped revision in one transaction', () => {
    const first = geographicDraft();
    let state = createHistory(first);
    const moved = moveNodeV5(first, 'n-a0b', 'frame-b-a-z0', { kind: 'geographic', lat: 13.056, lng: 80.249 });
    expect(moved.nodes.find((n) => n.id === 'n-a0b')!.fingerprintRevision).toBe(2);
    state = commitEdit(state, moved, 'Move point');
    state = undoEdit(state);
    const restored = (state.present as MapDraft).nodes.find((n) => n.id === 'n-a0b')!;
    expect(restored.position).toEqual({ kind: 'geographic', lat: 13.055, lng: 80.248 });
    expect(restored.fingerprintRevision).toBeGreaterThan(1);
    expect(isDirty(state)).toBe(true);
  });

  it('moves a V5 path node and rebuilds the drawn path in one transaction', () => {
    const first = staticDraft();
    const target = first.nodes.find((n) => n.id === 's-a0b')!;
    let state = createHistory(first);
    const moved = movePathNodeV5(first, 's-a0b', 'frame-b-a-z0', { kind: 'local', x: 0.55, y: 0.72 });
    expect(moved.nodes.find((n) => n.id === 's-a0b')!.position).toEqual({ kind: 'local', x: 0.55, y: 0.72 });
    state = commitEdit(state, moved, 'Move path point');
    expect(target.fingerprintRevision).toBe(1);
    state = undoEdit(state);
    const restored = (state.present as MapDraft).nodes.find((n) => n.id === 's-a0b')!;
    expect(restored.position).toEqual(target.position);
    expect(restored.fingerprintRevision).toBeGreaterThan(target.fingerprintRevision);
  });

  it('rejects V5 path moves across frames and shared junctions', () => {
    const first = staticDraft();
    expect(() => movePathNodeV5(first, 's-a0b', 'frame-b-a-z1', { kind: 'local', x: 0.5, y: 0.5 })).toThrow(/same frame/);
    expect(() => movePathNodeV5(first, 'missing', 'frame-b-a-z0', { kind: 'local', x: 0.5, y: 0.5 })).toThrow(/not part of a drawn path/);
    void geographicDraft;
  });

  it('invalidates every node in a replaced frame conservatively', () => {
    const first = staticDraft();
    const frameNodes = first.nodes.filter((n) => n.frameId === 'frame-b-a-z0');
    const touched = invalidateFrameNodesV5(first, 'frame-b-a-z0');
    for (const node of frameNodes) {
      expect(touched.nodes.find((n) => n.id === node.id)!.fingerprintRevision).toBe(node.fingerprintRevision + 1);
    }
    const outside = first.nodes.filter((n) => n.frameId !== 'frame-b-a-z0');
    for (const node of outside) {
      expect(touched.nodes.find((n) => n.id === node.id)!.fingerprintRevision).toBe(node.fingerprintRevision);
    }
    expect(() => invalidateFrameNodesV5(first, 'missing-frame')).toThrow(/Unknown frame/);
  });

  it('bumps frame nodes when undoing across a background replacement', () => {
    const first = staticDraft();
    let state = createHistory(first);
    const replaced: MapDraft = {
      ...first,
      frames: first.frames.map((f) =>
        f.id === 'frame-b-a-z0'
          ? { ...f, background: { ...f.background!, assetId: 'bg-b-a-z0-v2' } }
          : f,
      ),
    };
    const touched = invalidateFrameNodesV5(replaced, 'frame-b-a-z0');
    state = commitEdit(state, touched, 'Replace background');
    state = undoEdit(state);
    const undoneNode = (state.present as MapDraft).nodes.find((n) => n.id === 's-a0')!;
    // Geometry matches the original, but the revision advanced past the replaced save.
    expect(undoneNode.position).toEqual(first.nodes.find((n) => n.id === 's-a0')!.position);
    expect(undoneNode.fingerprintRevision).toBeGreaterThan(first.nodes.find((n) => n.id === 's-a0')!.fingerprintRevision);
    expect(isDirty(state)).toBe(true);
  });

  it('removes a V5 drawn path in one transaction', () => {
    const first = staticDraft();
    let state = createHistory(first);
    state = commitEdit(state, removeDrawnPath(first, 'corr-ground'), 'Delete path');
    expect((state.present as MapDraft).paths!.some((p) => p.id === 'corr-ground')).toBe(false);
    state = undoEdit(state);
    expect((state.present as MapDraft).paths!.some((p) => p.id === 'corr-ground')).toBe(true);
  });
});
