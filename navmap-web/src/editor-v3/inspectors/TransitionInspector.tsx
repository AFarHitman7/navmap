import { useState, type FormEvent } from 'react';
import { removeTransition } from '../objects';
import { renameTransitionV5 } from '../model';
import type { InspectorProps } from './shared';
import { ErrorMessage } from './shared';

export function TransitionInspector(props: InspectorProps) {
  const selectedId = props.selection.kind === 'transition' ? props.selection.id : undefined;
  const transition = selectedId ? props.document.transitions.find((item) => item.id === selectedId) : undefined;
  return <TransitionInspectorForm key={`${transition?.id ?? ''}:${transition?.name ?? ''}`} {...props} />;
}

function TransitionInspectorForm({ document, selection, commit, busy, onSelectionChange }: InspectorProps) {
  const transition = selection.kind === 'transition' ? document.transitions.find((item) => item.id === selection.id) : undefined;
  const [name, setName] = useState(transition?.name ?? '');
  const [error, setError] = useState('');
  function save(event: FormEvent) {
    event.preventDefault();
    try { if (!transition || !commit('Rename transition', (draft) => renameTransitionV5(draft, transition.id, name))) throw new Error('Transition name was not changed.'); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Transition name was not changed.'); }
  }
  if (!transition) return <section className="v5-inspector-form" aria-labelledby="transition-inspector-title"><h2 id="transition-inspector-title">Transitions</h2>
    <p>Choose a connection to edit it. Existing elevators remain available here.</p>
    <ul className="v5-object-list">{document.transitions.map((item) => <li key={item.id}><button type="button" onClick={() => { onSelectionChange({ kind: 'transition', id: item.id }); setName(item.name); }}>
      <span>{item.name}<small>{item.kind === 'elevator' ? 'Elevator' : item.kind === 'stair' ? 'Stair' : 'Entrance'}</small></span></button></li>)}</ul>
  </section>;
  const [from, to] = transition.nodeIds;
  return <section className="v5-inspector-form" aria-labelledby="transition-inspector-title"><p className="v5-context-kicker">{transition.kind === 'elevator' ? 'Elevator' : transition.kind === 'stair' ? 'Stair' : 'Entrance'} connection</p>
    <h2 id="transition-inspector-title">Connection properties</h2><form onSubmit={save}><label>Name<input required value={name} disabled={busy} onChange={(event) => setName(event.currentTarget.value)} /></label><button type="submit" disabled={busy}>Save name</button></form>
    <p>{document.nodes.find((node) => node.id === from)?.name ?? 'Missing landing'} ↔ {document.nodes.find((node) => node.id === to)?.name ?? 'Missing landing'}</p>
    <button type="button" className="danger" disabled={busy} onClick={() => { if (!commit('Delete transition', (draft) => removeTransition(draft, transition.id))) setError('Connection was not deleted.'); else { setError(''); onSelectionChange({ kind: 'none' }); } }}>Delete connection</button>
    <details><summary>Advanced</summary><p className="coordinates">ID: {transition.id}</p></details><ErrorMessage error={error} />
  </section>;
}
