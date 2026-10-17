import type { Position } from '../map-contract';
import type { PathVertexV5 } from './paths';
import type { Endpoint } from './objects';

export type Tool = { kind: 'select' } | { kind: 'boundary' } | { kind: 'building' }
  | { kind: 'node'; subtype: 'regular' | 'entrance' | 'stair' }
  | { kind: 'path'; subtype: 'regular' | 'stair' } | { kind: 'move' };

export type Selection = { kind: 'none' } | { kind: 'boundary' }
  | { kind: 'building'; id: string } | { kind: 'node'; id: string }
  | { kind: 'path'; id: string } | { kind: 'transition'; id: string };

export type InspectorView = 'build' | 'floors' | 'places' | 'publish';

export type PendingGesture =
  | { kind: 'path'; vertices: PathVertexV5[]; name: string }
  | { kind: 'entrance'; endpoints: Endpoint[]; name: string }
  | { kind: 'stair'; endpoints: Endpoint[]; name: string };

export function toolLabel(tool: Tool): string {
  if (tool.kind === 'node') return `Node · ${tool.subtype[0]!.toUpperCase()}${tool.subtype.slice(1)}`;
  if (tool.kind === 'path') return `Path · ${tool.subtype[0]!.toUpperCase()}${tool.subtype.slice(1)}`;
  return tool.kind[0]!.toUpperCase() + tool.kind.slice(1);
}

export function selectionExists(selection: Selection, document: {
  boundary: unknown; indoorZones: Array<{ id: string }>; nodes: Array<{ id: string }>;
  paths?: Array<{ id: string }>; transitions: Array<{ id: string }>;
}): boolean {
  switch (selection.kind) {
    case 'none': return true;
    case 'boundary': return document.boundary !== null;
    case 'building': return document.indoorZones.some((item) => item.id === selection.id);
    case 'node': return document.nodes.some((item) => item.id === selection.id);
    case 'path': return (document.paths ?? []).some((item) => item.id === selection.id);
    case 'transition': return document.transitions.some((item) => item.id === selection.id);
  }
}

export function endpointForNode(nodeId: string): Endpoint { return { nodeId }; }
export function endpointAt(frameId: string, position: Position): Endpoint { return { frameId, position }; }
