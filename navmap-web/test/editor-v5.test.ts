// Task 2 RED: V5 graph editing/validation in the web editor model + drawn paths.
import { describe, expect, it } from 'vitest';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5';
import { parseMapDraft, type MapDraft } from '../src/map-contract';
import { addNodeAtV5, addPlaceToNodeV5, connectNodesV5, removePathV5 } from '../src/editor-v3/model';
import { addDrawnPathV5, removeDrawnPath } from '../src/editor-v3/paths';
import { shortestPathV3 } from '../src/route-v3';

describe('V5 graph editing', () => {
  it('accepts the same local position on different floors', () => {
    const draft = staticDraft();
    const next = addNodeAtV5(draft, 'frame-b-a-z1', { kind: 'local', x: 0.5, y: 0.7 });
    const node = next.nodes.at(-1)!;
    expect(node.frameId).toBe('frame-b-a-z1');
    expect(node.zoneId).toBe('b-a');
    expect(node.z).toBe(1);
    parseMapDraft(next);
  });

  it('rejects static authoring until the frame background is assigned', () => {
    const draft = staticDraft();
    expect(() => addNodeAtV5(draft, 'frame-outdoor-z0', { kind: 'local', x: 0.1, y: 0.1 })).toThrow(/background/);
  });

  it('rejects ordinary edges across frames', () => {
    const draft = staticDraft();
    expect(() => connectNodesV5(draft, 's-a0b', 's-a1b')).toThrow(/stairs or elevator/);
    expect(() => connectNodesV5(draft, 's-a0b', 's-a1b', 'path')).toThrow(/same frame/);
  });

  it('connects stairs across floors with a mirrored transition record', () => {
    const draft = staticDraft();
    const base = removeDrawnPath(
      { ...draft, edges: draft.edges.filter((e) => e.kind !== 'stairs'), transitions: [] },
      'corr-upper',
    );
    const next = connectNodesV5(base, 's-a0b', 's-a1b', 'stairs');
    const edge = next.edges.find((e) => e.kind === 'stairs')!;
    expect(edge.cost).toBe(4);
    expect(edge.meters).toBeUndefined();
    expect(next.transitions).toHaveLength(1);
    expect(next.transitions[0]!.kind).toBe('stair');
    parseMapDraft(next);
  });

  it('pairs entrances between outdoors and the ground floor only', () => {
    const draft = geographicDraft();
    expect(() => connectNodesV5(draft, 'n-a0b', 'n-a1', 'entrance')).toThrow(/outdoors/);
    expect(() => connectNodesV5(draft, 'n-out', 'n-a1', 'entrance')).toThrow(/ground floor/);
    const next = connectNodesV5(removeDrawnPath(draft, 'route-1'), 'n-a0b', 'n-out', 'entrance');
    expect(next.transitions.at(-1)!.kind).toBe('entrance');
    parseMapDraft(next);
  });

  it('rejects places on outdoor nodes', () => {
    const draft = geographicDraft();
    expect(() => addPlaceToNodeV5(draft, 'n-out', 'Gate')).toThrow(/indoor/);
  });

  it('draws a static path by pixel sampling with a node cap', () => {
    const draft = staticDraft();
    const clean: MapDraft = {
      ...draft,
      nodes: draft.nodes.filter((n) => !n.generated),
      edges: draft.edges.filter((e) => e.kind !== 'path'),
      paths: [],
    };
    const next = addDrawnPathV5(
      clean,
      [
        { frameId: 'frame-b-a-z0', position: { kind: 'local', x: 0.1, y: 0.1 } },
        { frameId: 'frame-b-a-z0', position: { kind: 'local', x: 0.9, y: 0.9 } },
      ],
      'Diagonal',
    );
    const path = next.paths!.find((p) => p.name === 'Diagonal')!;
    expect(path.kind).toBe('regular');
    expect(path.nodeIds.length).toBeGreaterThan(2);
    expect(next.edges.every((e) => e.cost > 0 && e.meters === undefined)).toBe(true);
    parseMapDraft(next);
  });

  it('never interpolates across stairs when drawing', () => {
    const draft = staticDraft();
    const clean: MapDraft = {
      ...draft,
      nodes: draft.nodes.filter((n) => !n.generated),
      edges: [],
      paths: [],
      transitions: [],
    };
    const next = addDrawnPathV5(clean, [
      { frameId: 'frame-b-a-z0', position: { kind: 'local', x: 0.1, y: 0.1 } },
      { frameId: 'frame-b-a-z0', position: { kind: 'local', x: 0.3, y: 0.3 } },
      { frameId: 'frame-b-a-z1', position: { kind: 'local', x: 0.3, y: 0.3 }, incomingKind: 'stairs' },
    ]);
    const stairEdges = next.edges.filter((e) => e.kind === 'stairs');
    expect(stairEdges).toHaveLength(1);
    // No generated samples on the stair link: exactly its two endpoints.
    expect(next.paths!.every((p) => p.kind === 'regular')).toBe(true);
    parseMapDraft(next);
  });

  it('rejects authored paths beyond the generated-node cap before mutating', () => {
    const draft = staticDraft();
    const before = JSON.stringify(draft);
    expect(() =>
      addDrawnPathV5(
        draft,
        [
          { frameId: 'frame-b-a-z0', position: { kind: 'local', x: 0, y: 0.5 } },
          { frameId: 'frame-b-a-z0', position: { kind: 'local', x: 1, y: 0.5 }, incomingKind: 'path' },
        ],
        undefined,
      ),
    ).not.toThrow();
    // A tiny spacing override exhausts the budget and must throw.
    expect(() =>
      addDrawnPathV5(
        draft,
        [
          { frameId: 'frame-b-a-z0', position: { kind: 'local', x: 0, y: 0.5 } },
          { frameId: 'frame-b-a-z0', position: { kind: 'local', x: 1, y: 0.5 }, incomingKind: 'path' },
        ],
        undefined,
        { spacingPixels: 0.01 },
      ),
    ).toThrow(/cap 5000/);
    expect(JSON.stringify(draft)).toBe(before);
  });

  it('preserves shared junctions, sample ids and anchors across path deletion', () => {
    const draft = staticDraft();
    const junctionId = draft.nodes.find((n) => n.generated)?.id;
    const next = removeDrawnPath(draft, 'corr-ground');
    // Anchor/place-linked nodes survive; unreferenced generated samples drop.
    expect(next.nodes.some((n) => n.id === 's-a0')).toBe(true);
    expect(next.anchors).toHaveLength(1);
    expect(next.nodes.some((n) => n.id === junctionId)).toBe(false);
    parseMapDraft(next);
  });

  it.each(['corr-ground', 'corr-shared'])('preserves an edge and routes when deleting %s from shared path ownership', (removeId) => {
    const base = staticDraft();
    const draft = parseMapDraft({ ...base, paths: [...base.paths!, { id: 'corr-shared', name: 'Shared lobby segment', kind: 'regular', nodeIds: ['s-a0', 's-a0b'] }] });
    const expectedRoute = shortestPathV3(draft, 's-a0', 's-a0b');
    const next = removePathV5(draft, removeId);
    expect(next.paths?.some((path) => path.nodeIds.includes('s-a0') && path.nodeIds.includes('s-a0b'))).toBe(true);
    expect(next.edges.some((edge) => [edge.from, edge.to].includes('s-a0') && [edge.from, edge.to].includes('s-a0b'))).toBe(true);
    expect(shortestPathV3(next, 's-a0', 's-a0b')).toEqual(expectedRoute);
    expect(() => parseMapDraft(next)).not.toThrow();
  });
});
