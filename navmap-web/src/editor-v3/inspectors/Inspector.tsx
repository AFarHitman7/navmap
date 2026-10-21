import { useState, type FormEvent, type ReactNode } from 'react';
import { addPlaceToNodeV5, editPlaceV5, removePlaceV5 } from '../model';
import type { InspectorView } from '../tool-state';
import { BuildingInspector } from './BuildingInspector';
import { BoundaryInspector } from './BoundaryInspector';
import { NodeInspector } from './NodeInspector';
import { PathInspector } from './PathInspector';
import { TransitionInspector } from './TransitionInspector';
import type { InspectorProps } from './shared';
import { ErrorMessage } from './shared';

type Props = InspectorProps & { view: InspectorView; onViewChange: (view: InspectorView) => void; floorSettings?: ReactNode };

function PlaceView({ document, commit, busy }: InspectorProps) {
  const [name, setName] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [error, setError] = useState('');
  const available = document.nodes.filter((node) => node.zoneId !== null && !document.places.some((place) => place.nodeId === node.id));
  const [selected, setSelected] = useState('');
  const current = document.places.find((place) => place.id === selected);
  function save(event: FormEvent) {
    event.preventDefault();
    try {
      const changed = current
        ? commit('Edit place', (draft) => editPlaceV5(draft, current.id, { name, nodeId }))
        : commit('Add place', (draft) => addPlaceToNodeV5(draft, nodeId, name));
      if (!changed) throw new Error('Place was not saved.');
      setError(''); setName(''); setNodeId(''); setSelected('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Place was not saved.'); }
  }
  return <section className="v5-inspector-form" aria-labelledby="places-title"><p className="v5-context-kicker">Visitor destinations</p><h2 id="places-title">Places</h2>
    {document.places.length ? <ul className="v5-object-list" aria-label="Places">{document.places.map((place) => <li key={place.id}>
      <button type="button" aria-pressed={selected === place.id} onClick={() => { setSelected(place.id); setName(place.name); setNodeId(place.nodeId); }}>
        <span>{place.name}<small>{document.nodes.find((node) => node.id === place.nodeId)?.name ?? 'Unassigned node'}</small></span></button>
      <button type="button" className="text-button danger" aria-label={`Delete ${place.name}`} disabled={busy} onClick={() => commit('Delete place', (draft) => removePlaceV5(draft, place.id))}>Delete</button>
    </li>)}</ul> : <p>No places yet. Add a destination to an indoor node.</p>}
    <form onSubmit={save}><h3>{current ? 'Edit place' : 'Add place'}</h3>
      <label>Place name<input required value={name} disabled={busy} onChange={(event) => setName(event.currentTarget.value)} /></label>
      <label>Indoor node<select required value={nodeId} disabled={busy} onChange={(event) => setNodeId(event.currentTarget.value)}>
        <option value="">Choose a node</option>{document.nodes.filter((node) => node.zoneId !== null && (available.some((item) => item.id === node.id) || current?.nodeId === node.id)).map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
      </select></label><button type="submit" disabled={busy || !nodeId}>{current ? 'Save place' : 'Add place'}</button>
      {current && <button type="button" disabled={busy} onClick={() => { setSelected(''); setName(''); setNodeId(''); }}>Cancel edit</button>}
    </form><ErrorMessage error={error} />
  </section>;
}

export function Inspector(props: Props) {
  const { document, tool, selection, view, onViewChange, onPublish, busy, floorSettings } = props;
  const tabs: Array<{ view: InspectorView; label: string }> = [
    { view: 'build', label: 'Build' },
    ...(document.canvas.kind === 'static' ? [{ view: 'floors' as const, label: 'Floor plans' }] : []),
    { view: 'places', label: 'Places' }, { view: 'publish', label: 'Publish' },
  ];
  let content: ReactNode;
  if (view === 'floors') content = <section className="v5-inspector-form" aria-labelledby="floor-settings-title"><h2 id="floor-settings-title">Floor plans</h2>{floorSettings ?? <p>Floor plan settings are unavailable.</p>}</section>;
  else if (view === 'places') content = <PlaceView {...props} />;
  else if (view === 'publish') content = <section className="v5-inspector-form publish-inspector" aria-labelledby="publish-title"><p className="v5-context-kicker">Draft · {document.canvas.kind === 'static' ? 'static map' : 'geographic map'}</p><h2 id="publish-title">Publish map</h2>
    <p>Publishing creates an immutable visitor version. Save and Publish are separate actions.</p>
    <ul className="v5-publish-summary"><li>{document.nodes.length} map nodes</li><li>{document.transitions.length} connections</li><li>{document.places.length} visitor places</li></ul>
    <button type="button" className="primary" disabled={busy} onClick={onPublish}>Publish map</button>
  </section>;
  else if (tool.kind === 'boundary' || (tool.kind === 'select' && selection.kind === 'boundary')) content = <BoundaryInspector {...props} />;
  else if (tool.kind === 'building' || (tool.kind === 'select' && selection.kind === 'building')) content = <BuildingInspector {...props} />;
  else if (tool.kind === 'node' || (tool.kind === 'select' && selection.kind === 'node')) content = <NodeInspector {...props} />;
  else if (tool.kind === 'path' || (tool.kind === 'select' && selection.kind === 'path')) content = <PathInspector {...props} />;
  else if (tool.kind === 'select' && selection.kind === 'transition') content = <TransitionInspector {...props} />;
  else if (tool.kind === 'select') content = <section className="v5-inspector-empty"><h2>Build your map</h2><p>Select an object or choose a map tool.</p>
    <button type="button" onClick={() => onViewChange('places')}>Manage places</button></section>;
  else content = <section className="v5-inspector-empty"><h2>Map settings</h2><p>Choose a map tool to edit its settings.</p></section>;
  return <aside className="v5-inspector" aria-label="Map settings">
    <nav className="v5-inspector-tabs" aria-label="Editor views">{tabs.map((tab) => <button key={tab.view} type="button" aria-current={view === tab.view ? 'page' : undefined}
      aria-pressed={view === tab.view} onClick={() => onViewChange(tab.view)}>{tab.label}</button>)}</nav>
    <div className="v5-inspector-scroll" key={`${view}:${tool.kind}:${selection.kind === 'none' || selection.kind === 'boundary' ? '' : selection.id}`}>
      {content}
    </div>
  </aside>;
}
