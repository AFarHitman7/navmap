import { createElement, type ReactNode } from 'react';
import type { MapDraft } from '../../map-contract';
import type { PendingGesture, Selection, Tool } from '../tool-state';

export type Commit = (label: string, next: MapDraft | ((previous: MapDraft) => MapDraft)) => boolean;
export type InspectorProps = {
  document: MapDraft;
  tool: Tool;
  selection: Selection;
  activeFrameId: string;
  commit: Commit;
  busy: boolean;
  onSelectionChange: (selection: Selection) => void;
  onToolChange: (tool: Tool) => void;
  gesture: PendingGesture | null;
  onGestureChange: (gesture: PendingGesture | null) => void;
  nodeName: string;
  onNodeNameChange: (name: string) => void;
  onFinishGesture: () => void;
  onCancelGesture: () => void;
  onPublish: () => void;
  floorSettings?: ReactNode;
};

export function ErrorMessage({ error }: { error: string }) {
  return error ? createElement('p', { role: 'alert', className: 'v5-inspector-error' }, error) : null;
}
