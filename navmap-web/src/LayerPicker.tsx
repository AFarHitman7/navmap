import type { IndoorZoneV3 } from './contract-v3';
import type { FloorVisibility, ZoneFloorVisibility } from './floor-visibility';
import type { MapDraft, MapFrame } from './map-contract';

type LegacyProps = {
  zones: IndoorZoneV3[];
  visibility: ZoneFloorVisibility;
  showOutdoors: boolean;
  onFloorChange: (zoneId: string, floor: FloorVisibility) => void;
  onOutdoorsChange: (show: boolean) => void;
};
type FrameProps = {
  zones: Array<{ id: string; name: string; floors: Array<{ z: number; label: string }> }>;
  canvasKind: MapDraft['canvas']['kind'];
  frames: MapFrame[];
  activeFrameId: string;
  onFrameChange: (frameId: string) => void;
};

const frameName = (frame: MapFrame, zones: Array<{ id: string; name: string; floors: Array<{ z: number; label: string }> }>) => frame.zoneId
  ? `${zones.find((zone) => zone.id === frame.zoneId)?.name ?? 'Building'} · ${zones.find((zone) => zone.id === frame.zoneId)?.floors.find((floor) => floor.z === frame.z)?.label ?? `Floor ${frame.z}`}`
  : 'Outdoor';

export function LayerPicker(props: LegacyProps | FrameProps) {
  const hasFrames = 'frames' in props;
  if (!hasFrames) return <details className="layer-picker">
    <summary title="Choose visible floors; outdoor nodes can be shown or hidden separately.">Layers</summary>
    <div className="layer-picker-controls">
      <label className="outdoor-layer"><input type="checkbox" checked={props.showOutdoors} onChange={(e) => props.onOutdoorsChange(e.target.checked)} />Outdoor</label>
      {props.zones.map((zone) => <label key={zone.id}>{zone.name}
        <select aria-label={`Visible floor — ${zone.name}`} value={String(props.visibility[zone.id])}
          onChange={(e) => props.onFloorChange(zone.id, e.target.value === 'all' || e.target.value === 'hidden' ? e.target.value : Number(e.target.value))}>
          {zone.floors.map((floor) => <option key={floor.z} value={floor.z}>Floor {floor.z} · {floor.label}</option>)}
          <option value="all">All floors</option><option value="hidden">Hide zone</option>
        </select>
      </label>)}
    </div>
  </details>;
  const activeFrame = props.frames.find((frame) => frame.id === props.activeFrameId);
  return <div className="layer-picker layer-picker-v5" aria-label="Map layers">
    <div className="layer-picker-row">
      <span className="layer-current-frame" aria-live="polite">{activeFrame ? frameName(activeFrame, props.zones) : 'Choose a floor'}</span>
      <details className="layer-picker-popover" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
      }}>
        <summary aria-label="Layers" title={props.canvasKind === 'static' ? 'Choose the active floor plan. Static frames use independent image coordinates.' : 'Choose the active building and floor.'}>Layers</summary>
        <div className="layer-picker-options" role="group" aria-label={props.canvasKind === 'static' ? 'Map frames' : 'Buildings and floors'}>
          {props.frames.map((frame) => <button key={frame.id} type="button" aria-pressed={frame.id === props.activeFrameId}
            onClick={(event) => { props.onFrameChange(frame.id); event.currentTarget.closest('details')!.open = false; }}>
            {frameName(frame, props.zones)}{!frame.background && props.canvasKind === 'static' ? ' · no plan' : ''}
          </button>)}
        </div>
      </details>
    </div>
  </div>;
}
