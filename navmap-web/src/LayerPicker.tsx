import type { IndoorZoneV3 } from './contract-v3';
import type { FloorVisibility, ZoneFloorVisibility } from './floor-visibility';

export function LayerPicker({ zones, visibility, showOutdoors, onFloorChange, onOutdoorsChange }: {
  zones: IndoorZoneV3[];
  visibility: ZoneFloorVisibility;
  showOutdoors: boolean;
  onFloorChange: (zoneId: string, floor: FloorVisibility) => void;
  onOutdoorsChange: (show: boolean) => void;
}) {
  return <details className="layer-picker" open>
    <summary>Layers · floor visibility</summary>
    <div className="layer-picker-controls">
      <label className="outdoor-layer">
        <input type="checkbox" checked={showOutdoors} onChange={(e) => onOutdoorsChange(e.target.checked)} />
        Outdoor paths
      </label>
      {zones.map((zone) => <label key={zone.id}>
        {zone.name}
        <select aria-label={`Visible floor — ${zone.name}`} value={String(visibility[zone.id])}
          onChange={(e) => onFloorChange(zone.id, e.target.value === 'all' || e.target.value === 'hidden'
            ? e.target.value : Number(e.target.value))}>
          {zone.floors.map((floor) => <option key={floor.z} value={floor.z}>Floor {floor.z} · {floor.label}</option>)}
          <option value="all">All floors</option>
          <option value="hidden">Hide zone</option>
        </select>
      </label>)}
    </div>
    <p>Only the selected floors and their paths are shown.</p>
  </details>;
}
