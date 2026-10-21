import { describe, expect, it } from 'vitest';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5';
import { parseMapDraft } from '../src/map-contract';
import { addEntrance, addRegularNode, addRegularPath, addStair, addStairPath, removeTransition } from '../src/editor-v3/objects';
import { commitEdit, createHistory, undoEdit } from '../src/editor-v3/history';

describe('logical editor objects', () => {
  it('creates a regular indoor node with a stable revision', () => {
    const next = addRegularNode(staticDraft(), 'frame-b-a-z0', { kind: 'local', x: 0.2, y: 0.2 }, 'Lobby');
    expect(next.nodes.at(-1)).toMatchObject({ name: 'Lobby', zoneId: 'b-a', z: 0, fingerprintRevision: 1 });
    parseMapDraft(next);
  });

  it('creates one stair edge, mirrored transition, and explicit stair path atomically', () => {
    let draft = staticDraft();
    draft = removeTransition(draft, 'tr-s-a0-s-a1');
    const next = addStair(draft, 's-a0', 's-a1', 'East stairs');
    const transition = next.transitions.find((item) => item.name === 'East stairs')!;
    expect(next.edges.filter((edge) => edge.kind === 'stairs')).toHaveLength(1);
    const withPath = addStairPath(next, transition.id, 'East stair route');
    expect(withPath.paths?.at(-1)).toMatchObject({ kind: 'stair', nodeIds: ['s-a0', 's-a1'], transitionId: transition.id });
    expect(() => parseMapDraft({
      ...withPath,
      paths: withPath.paths?.map((path) => path.transitionId === transition.id ? { ...path, nodeIds: ['s-a1', 's-a0'] } : path),
    })).toThrow(/ordered stair landing pair/);
    expect(() => addStairPath(withPath, transition.id, 'Duplicate group')).toThrow(/already has/);
  });

  it('creates paired landing endpoints from two assigned floor descriptors', () => {
    const next = addStair(staticDraft(),
      { frameId: 'frame-b-a-z0', position: { kind: 'local', x: 0.9, y: 0.1 }, name: 'Lower' },
      { frameId: 'frame-b-a-z1', position: { kind: 'local', x: 0.9, y: 0.1 }, name: 'Upper' },
      'New stair', 7);
    expect(next.transitions.at(-1)).toMatchObject({ kind: 'stair', name: 'New stair' });
    expect(next.edges.at(-1)).toMatchObject({ kind: 'stairs', meters: 7 });
    expect(next.nodes.filter((node) => ['Lower', 'Upper'].includes(node.name))).toHaveLength(2);
  });

  it('reuses the deterministic closest same-frame landing for a positioned endpoint', () => {
    const base = removeTransition(staticDraft(), 'tr-s-a0-s-a1');
    const duplicate = { ...base.nodes.find((node) => node.id === 's-a0')!, id: 'z-duplicate' };
    const draft = { ...base, nodes: [...base.nodes, duplicate] };
    const next = addStair(draft,
      { frameId: 'frame-b-a-z0', position: { kind: 'local', x: 0.2 + 5e-10, y: 0.3 } },
      { frameId: 'frame-b-a-z1', position: { kind: 'local', x: 0.2, y: 0.3 } },
      'Reused stair');
    expect(next.nodes).toHaveLength(draft.nodes.length);
    expect(next.transitions.at(-1)?.nodeIds).toEqual(['s-a0', 's-a1']);
  });

  it('rejects duplicate transition pairs without changing the source draft', () => {
    const draft = staticDraft();
    const before = JSON.stringify(draft);
    expect(() => addStair(draft, 's-a0', 's-a1', 'Duplicate')).toThrow(/already connected/);
    expect(JSON.stringify(draft)).toBe(before);
  });

  it('does not silently remove shared or place-linked transition endpoints', () => {
    const draft = staticDraft();
    expect(() => removeTransition(draft, 'tr-s-a0-s-a1', { removeEndpoints: true })).toThrow(/shared|place|anchor/i);
  });

  it('records a compound stair creation as one undoable transaction', () => {
    const draft = removeTransition(staticDraft(), 'tr-s-a0-s-a1');
    const next = addStair(draft, 's-a0', 's-a1', 'East stairs');
    const edited = commitEdit(createHistory(draft), next, 'Add stairs');
    expect(edited.past).toHaveLength(1);
    expect(undoEdit(edited).present).toEqual(draft);
  });

  it('rejects stairs across buildings and entrances above ground level', () => {
    const draft = staticDraft();
    expect(() => addStair(draft, 's-a0', 's-a0b', 'Invalid')).toThrow(/lower to upper floors/);
    expect(() => addEntrance(geographicDraft(), 'n-a1', 'n-out', 'Upper entrance')).toThrow(/ground floor/);
  });

  it('creates a regular path category and paired entrance through endpoint descriptors', () => {
    const draft = staticDraft();
    const pathBase = { ...draft, edges: [], paths: [], transitions: [] };
    const regular = addRegularPath(pathBase, ['s-a0', 's-a0b'], 'Corridor');
    expect(regular.paths?.at(-1)?.kind).toBe('regular');
    expect(() => addEntrance(draft, 's-a0', { frameId: 'frame-outdoor-z0', position: { kind: 'local', x: 0.1, y: 0.1 }, name: 'Outside' }, 'North entrance')).toThrow(/background/);
    const outdoorReady = { ...draft, frames: draft.frames.map((frame) => frame.id === 'frame-outdoor-z0' ? { ...frame, background: { assetId: 'outdoor', width: 100, height: 100, sha256: 'a'.repeat(64), byteLength: 1000 } } : frame) };
    const entrance = addEntrance(outdoorReady, 's-a0', { frameId: 'frame-outdoor-z0', position: { kind: 'local', x: 0.1, y: 0.1 }, name: 'Outside' }, 'North entrance');
    expect(entrance.transitions.at(-1)?.kind).toBe('entrance');
  });

  it('accepts an entrance whose points were clicked outdoors first', () => {
    const base = staticDraft();
    const outdoorReady = { ...base, frames: base.frames.map((frame) => frame.id === 'frame-outdoor-z0'
      ? { ...frame, background: { assetId: 'outdoor', width: 100, height: 100, sha256: 'a'.repeat(64), byteLength: 1000 } } : frame) };
    const outside = { frameId: 'frame-outdoor-z0', position: { kind: 'local' as const, x: 0.1, y: 0.1 }, name: 'Outside' };
    const entrance = addEntrance(outdoorReady, outside, 's-a0', 'North entrance');
    const transition = entrance.transitions.at(-1)!;
    expect(transition.kind).toBe('entrance');
    expect(transition.nodeIds).toContain('s-a0');
    const other = entrance.nodes.find((node) => node.id === transition.nodeIds.find((id) => id !== 's-a0'))!;
    expect(other.zoneId).toBeNull();
    parseMapDraft(entrance);
  });

  it('explains that an entrance needs one indoor and one outdoor point', () => {
    expect(() => addEntrance(staticDraft(), 's-a0', 's-a0b', 'Indoor only')).toThrow(/one indoor landing and one outdoor point/);
  });

  it('reuses an existing path junction for a positioned endpoint without duplicating its node ID', () => {
    const draft = staticDraft();
    const pathBase = { ...draft, edges: [], paths: [], transitions: [] };
    const next = addRegularPath(pathBase, [
      's-a0',
      { frameId: 'frame-b-a-z0', position: { kind: 'local', x: 0.5, y: 0.7 } },
    ], 'Existing junction');
    expect(next.paths?.at(-1)?.nodeIds[0]).toBe('s-a0');
    expect(next.paths?.at(-1)?.nodeIds.at(-1)).toBe('s-a0b');
    expect(next.nodes.filter((node) => node.frameId === 'frame-b-a-z0' && node.position.kind === 'local' && node.position.x === 0.5 && node.position.y === 0.7).map((node) => node.id)).toEqual(['s-a0b']);
  });

  it('rejects duplicate positioned path endpoints without changing the source draft', () => {
    const draft = { ...staticDraft(), edges: [], paths: [], transitions: [] };
    const samePosition = { frameId: 'frame-b-a-z0', position: { kind: 'local' as const, x: 0.5, y: 0.7 } };
    expect(() => addRegularPath(draft, [samePosition, samePosition], 'Duplicate')).toThrow(/duplicate|positive/i);
    expect(draft.nodes.find((node) => node.id === 's-a0b')?.position).toEqual({ kind: 'local', x: 0.5, y: 0.7 });
  });

  it('rejects stair toggles inside a regular path group', () => {
    const draft = staticDraft();
    expect(() => addRegularPath(draft, [
      { frameId: 'frame-b-a-z0', position: { kind: 'local', x: 0.15, y: 0.2 }, nodeId: 's-a0' },
      { frameId: 'frame-b-a-z1', position: { kind: 'local', x: 0.2, y: 0.3 }, nodeId: 's-a1', incomingKind: 'stairs' },
    ], 'Mixed')).toThrow(/separate stair transition/);
  });
});
