import type { MapDraft, MapManifest } from '../map-contract';
import { GeographicCanvas, type CanvasCallbacks } from './GeographicCanvas';
import { StaticCanvas } from './StaticCanvas';
import type { Selection } from '../editor-v3/tool-state';

export type GpsDot = { lat: number; lng: number; accuracyMeters: number };

export type CanvasHostProps = {
  document: MapDraft | MapManifest;
  view: 'editor' | 'visitor' | 'survey';
  activeFrameId: string;
  mode: string;
  callbacks: CanvasCallbacks;
  selection?: Selection;
  showReferencePoints?: boolean;
  /** Unsnapped geographic GPS evidence; rendered only on geographic canvases in visitor view. */
  gpsDot?: GpsDot | null;
};

export function CanvasHost(props: CanvasHostProps) {
  const key = `${props.document.canvas.kind}:${props.document.canvas.kind === 'static' ? 'simple' : 'earth'}`;
  if (props.document.canvas.kind === 'static') {
    // Static floor plans never consume GPS evidence.
    const { gpsDot: _ignored, ...rest } = props;
    return <StaticCanvas key={key} {...rest} />;
  }
  return <GeographicCanvas key={key} {...props} gpsDot={props.view === 'visitor' ? props.gpsDot : undefined} />;
}
