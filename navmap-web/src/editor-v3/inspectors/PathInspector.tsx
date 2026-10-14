import { useState, type FormEvent } from 'react';
import { addStairPath } from '../objects';
import { removePathV5, renamePathV5 } from '../model';
import type { InspectorProps } from './shared';
import { ErrorMessage } from './shared';

export function PathInspector(props: InspectorProps) {
  const selectedId = props.selection.kind === 'path' ? props.selection.id : undefined;
  const selected = selectedId ? (props.document.paths ?? []).find((item) => item.id === selectedId) : undefined;
  const subtype = props.tool.kind === 'path' ? props.tool.subtype : '';
  return <PathInspectorForm key={`${selected?.id ?? ''}:${selected?.name ?? ''}:${subtype}`} {...props} />;
}

function PathInspectorForm(props: InspectorProps) {
  const { document, selection, tool, commit, busy, gesture, onGestureChange, onFinishGesture, onCancelGesture } = props;
  const selected = selection.kind === 'path' ? (document.paths ?? []).find((item) => item.id === selection.id) : undefined;
  const [name, setName] = useState(selected?.name ?? '');
  const [error, setError] = useState('');
  function saveName(event: FormEvent) {
    event.preventDefault();
    try { if (!selected || !commit('Rename path', (draft) => renamePathV5(draft, selected.id, name))) throw new Error('Path name was not changed.'); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Path name was not changed.'); }
  }
  if (tool.kind === 'path' && tool.subtype === 'stair') {
    return <section className="v5-inspector-form" aria-labelledby="path-inspector-title">
      <p className="v5-context-kicker">Path · Stair</p><h2 id="path-inspector-title">Stair paths</h2>
      <p>A stair path names an existing stair transition. It uses the same two landing nodes and survey IDs.</p>
      <ul className="v5-object-list" aria-label="Stair transitions">{document.transitions.filter((item) => item.kind === 'stair').map((transition) => {
        const exists = (document.paths ?? []).some((path) => path.transitionId === transition.id);
        return <li key={transition.id}><span>{transition.name}<small>{exists ? 'Stair path added' : 'No path name yet'}</small></span>
          {!exists && <button type="button" disabled={busy} onClick={() => {
            if (!commit('Name stair path', (draft) => addStairPath(draft, transition.id, transition.name))) setError('Stair path was not added.');
            else setError('');
          }}>Add path</button>}
        </li>;
      })}</ul>
      <ErrorMessage error={error} />
    </section>;
  }
  const current = gesture?.kind === 'path' ? gesture : null;
  if (tool.kind === 'path' && tool.subtype === 'regular') return <section className="v5-inspector-form" aria-labelledby="path-inspector-title">
    <p className="v5-context-kicker">Path · Regular</p><h2 id="path-inspector-title">Regular path</h2>
    <label>Path name<input value={current?.name ?? ''} disabled={busy} onChange={(event) => onGestureChange({ kind: 'path', vertices: current?.vertices ?? [], name: event.currentTarget.value })} /></label>
    <p>Click existing nodes or map positions on one assigned floor. Generated routing points stay inside this named path.</p>
    <p className="v5-live-count" aria-live="polite">{current?.vertices.length ?? 0} {current?.vertices.length === 1 ? 'point' : 'points'}</p>
    <div className="v5-action-row"><button className="primary" type="button" disabled={busy || (current?.vertices.length ?? 0) < 2} onClick={onFinishGesture}>Finish path</button>
      <button type="button" disabled={busy || !current?.vertices.length} onClick={onCancelGesture}>Discard</button></div>
    {current?.vertices.length ? <button className="text-button" type="button" disabled={busy} onClick={() => onGestureChange({ ...current, vertices: current.vertices.slice(0, -1) })}>Undo last point</button> : null}
  </section>;
  if (!selected) return <section className="v5-inspector-form"><h2>Path</h2><p>Select a path on the map to edit it.</p></section>;
  return <section className="v5-inspector-form" aria-labelledby="path-inspector-title"><p className="v5-context-kicker">Selected {selected.kind} path</p><h2 id="path-inspector-title">Path properties</h2>
    <form onSubmit={saveName}><label>Path name<input required value={name} disabled={busy} onChange={(event) => setName(event.currentTarget.value)} /></label><button type="submit" disabled={busy}>Save name</button></form>
    <p>{selected.nodeIds.length} routing points</p><button className="danger" type="button" disabled={busy} onClick={() => {
      if (!commit('Delete path', (draft) => removePathV5(draft, selected.id))) setError('Path was not deleted.'); else setError('');
    }}>Delete path</button>
    <details><summary>Advanced</summary><p className="coordinates">ID: {selected.id}</p></details><ErrorMessage error={error} />
  </section>;
}
