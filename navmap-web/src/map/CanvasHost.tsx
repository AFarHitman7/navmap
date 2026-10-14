import type { MapDraft, MapManifest } from '../map-contract';
import { GeographicCanvas, type CanvasCallbacks } from './GeographicCanvas';
import { StaticCanvas } from './StaticCanvas';
import type { Selection } from '../editor-v3/tool-state';

export type CanvasHostProps = {
  document: MapDraft | MapManifest;
  view: 'editor' | 'visitor' | 'survey';
  activeFrameId: string;
  mode: string;
  callbacks: CanvasCallbacks;
  selection?: Selection;
  showReferencePoints?: boolean;
};

export function CanvasHost(props: CanvasHostProps) {
  const key = `${props.document.canvas.kind}:${props.document.canvas.kind === 'static' ? 'simple' : 'earth'}`;
  return props.document.canvas.kind === 'static'
    ? <StaticCanvas key={key} {...props} />
    : <GeographicCanvas key={key} {...props} />;
}
