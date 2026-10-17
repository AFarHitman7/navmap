import { describe, expect, it } from 'vitest';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5';
import { projectMap } from '../src/editor-v3/presentation';

describe('map presentation projection', () => {
  it('hides generated samples by default without changing routing data', () => {
    const draft = staticDraft();
    const before = structuredClone(draft);
    const projected = projectMap(draft, 'editor', { kind: 'none' });
    expect(projected.nodes.some((node) => node.generated)).toBe(false);
    expect(draft.nodes.some((node) => node.generated)).toBe(true);
    expect(projected.lines.length).toBeGreaterThan(0);
    expect(draft).toEqual(before);
  });

  it('keeps authored corners, but only authored controls become selected handles', () => {
    const draft = staticDraft();
    draft.paths![0] = { ...draft.paths![0]!, controlNodeIds: undefined };
    const plain = projectMap(draft, 'editor', { kind: 'none' });
    const selected = projectMap(draft, 'editor', { kind: 'path', id: 'corr-ground' });
    expect(plain.lines.find((line) => line.pathId === 'corr-ground')?.nodeIds).toContain('s-a0b');
    expect(plain.handles).toEqual([]);
    expect(selected.handles.map((node) => node.id)).toEqual(['s-a0', 's-a0b']);
  });

  it('preserves shared junction vertices and splits stair geometry into frame landings', () => {
    const draft = staticDraft();
    draft.nodes.push({ id: 's-branch', name: 'Branch end', frameId: 'frame-b-a-z0', position: { kind: 'local', x: 0.3, y: 0.2 }, zoneId: 'b-a', z: 0, fingerprintRevision: 1, visitorVisible: true });
    draft.edges.push({ from: 's-a0', to: 's-branch', kind: 'path', cost: 0.1 });
    draft.paths!.push({ id: 'branch', name: 'Branch', kind: 'regular', nodeIds: ['s-a0', 's-branch'] });
    const projected = projectMap(draft, 'editor', { kind: 'none' });
    expect(projected.lines.filter((line) => line.nodeIds.includes('s-a0')).length).toBeGreaterThan(1);
    expect(projected.lines.some((line) => line.nodeIds.includes('s-a1') && line.nodeIds.includes('s-a0'))).toBe(false);
    expect(projected.transitions.map((transition) => transition.nodeIds)).toContainEqual(['s-a0', 's-a1']);
  });

  it('shows references in survey and strips paths and editor affordances for visitors', () => {
    const draft = geographicDraft();
    expect(projectMap(draft, 'survey', { kind: 'none' }).nodes.some((node) => node.generated)).toBe(true);
    const visitor = projectMap(draft, 'visitor', { kind: 'path', id: draft.paths![0]!.id });
    expect(visitor.lines).toEqual([]);
    expect(visitor.handles).toEqual([]);
    expect(visitor.transitions).toEqual([]);
    expect(visitor.nodes.every((node) => node.visitorVisible)).toBe(true);
  });

  it('projects only transitions with a visitor-visible landing, without exposing hidden endpoints', () => {
    const base = staticDraft();
    const draft = { ...base, nodes: base.nodes.map((node) => node.id === 's-a1' ? { ...node, visitorVisible: false } : node) };
    const visitor = projectMap(draft, 'visitor', { kind: 'none' });
    expect(visitor.transitions).toEqual([]);
    expect(visitor.nodes.map((node) => node.id)).toContain('s-a0');
    expect(visitor.nodes.map((node) => node.id)).not.toContain('s-a1');
    const hidden = { ...draft, nodes: draft.nodes.map((node) => node.id === 's-a0' || node.id === 's-a1' ? { ...node, visitorVisible: false } : node) };
    expect(projectMap(hidden, 'visitor', { kind: 'none' }).transitions).toEqual([]);
  });

  it('excludes visitor-visible generated nodes unless an authored Place references them', () => {
    const draft = geographicDraft();
    draft.nodes = draft.nodes.map((node) => node.id === 'n-a0g'
      ? { ...node, visitorVisible: true, name: 'PRIVATE GENERATED NAME' } : node);
    draft.places.push({ id: 'p-survey-stop', name: 'Visitor stop', nodeId: 'n-a0g', zoneId: 'b-a' });
    const projection = projectMap(draft, 'visitor', { kind: 'none' });
    expect(projection.nodes.map((node) => node.id)).toContain('n-a0g');
    expect(projection.nodes.find((node) => node.id === 'n-a0g')?.name).toBe('PRIVATE GENERATED NAME');

    const withoutPlace = { ...draft, places: draft.places.filter((place) => place.nodeId !== 'n-a0g') };
    expect(projectMap(withoutPlace, 'visitor', { kind: 'none' }).nodes.map((node) => node.id)).not.toContain('n-a0g');
  });
});
