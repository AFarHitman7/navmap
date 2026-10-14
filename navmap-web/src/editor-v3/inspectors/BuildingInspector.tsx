import { useEffect, useState, type FormEvent } from 'react';
import type { Rect } from '../../map-contract';
import { addBuildingV5, addFloorV5, renameBuildingV5, renameFloorV5 } from '../model';
import type { InspectorProps } from './shared';
import { ErrorMessage } from './shared';

export function BuildingInspector({ document, selection, commit, busy, onSelectionChange }: InspectorProps) {
  const selected = selection.kind === 'building' ? document.indoorZones.find((zone) => zone.id === selection.id) : undefined;
  const firstBounds = document.boundary ?? (document.canvas.kind === 'static'
    ? { kind: 'local' as const, left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 }
    : { kind: 'geographic' as const, north: 0, south: 0, east: 0, west: 0 });
  const [name, setName] = useState(selected?.name ?? '');
  const [floorLabels, setFloorLabels] = useState<Record<number, string>>(() => Object.fromEntries((selected?.floors ?? []).map((floor) => [floor.z, floor.label])));
  const [newName, setNewName] = useState('');
  const [floorZ, setFloorZ] = useState('1');
  const [floorLabel, setFloorLabel] = useState('Level 1');
  const [bounds, setBounds] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(firstBounds).filter(([key]) => key !== 'kind').map(([key, value]) => [key, String(value)])));
  const [error, setError] = useState('');
  useEffect(() => {
    setName(selected?.name ?? '');
    setFloorLabels(Object.fromEntries((selected?.floors ?? []).map((floor) => [floor.z, floor.label])));
  }, [selected?.id, selected?.name, selected?.floors]);
  const fields = firstBounds.kind === 'geographic' ? ['north', 'south', 'east', 'west'] : ['left', 'top', 'right', 'bottom'];
  function saveName(event: FormEvent) {
    event.preventDefault();
    try { if (!selected || !commit('Rename building', (draft) => renameBuildingV5(draft, selected.id, name))) throw new Error('Building name was not changed.'); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Building name was not changed.'); }
  }
  function addBuilding(event: FormEvent) {
    event.preventDefault();
    const rect = { kind: firstBounds.kind, ...Object.fromEntries(fields.map((field) => [field, Number(bounds[field])])) } as Rect;
    try {
      const ok = commit('Add building', (draft) => addBuildingV5(draft, newName, rect));
      if (!ok) throw new Error('Building was not added.');
      setNewName(''); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Building was not added.'); }
  }
  function addFloor(event: FormEvent) {
    event.preventDefault();
    try { if (!selected || !commit('Add floor', (draft) => addFloorV5(draft, selected.id, Number(floorZ), floorLabel))) throw new Error('Floor was not added.'); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Floor was not added.'); }
  }
  return <section className="v5-inspector-form" aria-labelledby="building-inspector-title">
    <p className="v5-context-kicker">Building and floor settings</p><h2 id="building-inspector-title">{selected?.name ?? 'Building'}</h2>
    {selected ? <>
      <form onSubmit={saveName}><label>Building name<input required value={name} disabled={busy} onChange={(event) => setName(event.currentTarget.value)} /></label><button type="submit" disabled={busy}>Save name</button></form>
      <ul className="v5-floor-list" aria-label="Building floors">{selected.floors.map((floor) => <li key={floor.z}>
        <label>Floor {floor.z}<input aria-label={`Floor ${floor.z} label`} value={floorLabels[floor.z] ?? floor.label} disabled={busy}
          onChange={(event) => setFloorLabels((current) => ({ ...current, [floor.z]: event.currentTarget.value }))}
          onBlur={(event) => {
            const nextLabel = event.currentTarget.value.trim();
            if (!nextLabel) { setError('Floor label is required.'); return; }
            if (!commit('Rename floor', (draft) => renameFloorV5(draft, selected.id, floor.z, nextLabel))) setError('Floor label was not saved.');
            else setError('');
          }} /></label>
      </li>)}</ul>
      <form onSubmit={addFloor}><h3>Add floor</h3><div className="v5-inline-fields">
        <label>Floor number<input type="number" step="1" required value={floorZ} disabled={busy} onChange={(event) => setFloorZ(event.currentTarget.value)} /></label>
        <label>Floor label<input required value={floorLabel} disabled={busy} onChange={(event) => setFloorLabel(event.currentTarget.value)} /></label>
      </div><button type="submit" disabled={busy}>Add floor plan frame</button></form>
    </> : <>
      <p>Buildings group indoor floors. New floors inherit this building’s map area and get their own frame.</p>
      {document.indoorZones.map((zone) => <button className="v5-building-choice" key={zone.id} type="button" onClick={() => { onSelectionChange({ kind: 'building', id: zone.id }); setName(zone.name); setFloorLabels(Object.fromEntries(zone.floors.map((floor) => [floor.z, floor.label]))); }}>
        <span>{zone.name}<small>{zone.floors.length} {zone.floors.length === 1 ? 'floor' : 'floors'}</small></span>
      </button>)}
      <form onSubmit={addBuilding}><h3>Add building</h3><label>Building name<input required value={newName} disabled={busy} onChange={(event) => setNewName(event.currentTarget.value)} /></label>
        <div className="v5-coordinate-grid">{fields.map((field) => <label key={field}>{field[0]!.toUpperCase() + field.slice(1)}<input type="number" step="any" required value={bounds[field] ?? ''} disabled={busy}
          onChange={(event) => setBounds((current) => ({ ...current, [field]: event.currentTarget.value }))} /></label>)}</div>
        <button type="submit" disabled={busy}>Add building</button>
      </form>
    </>}
    <ErrorMessage error={error} />
  </section>;
}
