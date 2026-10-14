import { useState, type FormEvent } from 'react';
import { removeNodeV5, renameNodeV5, setNodeVisibilityV5 } from '../model';
import type { InspectorProps } from './shared';
import { ErrorMessage } from './shared';

export function NodeInspector(props: InspectorProps) {
  const selectedId = props.selection.kind === 'node' ? props.selection.id : undefined;
  const node = selectedId ? props.document.nodes.find((item) => item.id === selectedId) : undefined;
  const subtype = props.tool.kind === 'node' ? props.tool.subtype : '';
  return <NodeInspectorForm key={`${node?.id ?? ''}:${node?.name ?? ''}:${subtype}`} {...props} />;
}

function NodeInspectorForm(props: InspectorProps) {
  const { document, selection, tool, commit, busy, gesture, onGestureChange, nodeName, onNodeNameChange, onFinishGesture, onCancelGesture } = props;
  const node = selection.kind === 'node' ? document.nodes.find((item) => item.id === selection.id) : undefined;
  const [name, setName] = useState(node?.name ?? '');
  const [error, setError] = useState('');
  function saveName(event: FormEvent) {
    event.preventDefault();
    try { if (!node || !commit('Rename node', (draft) => renameNodeV5(draft, node.id, name))) throw new Error('Node name was not changed.'); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Node name was not changed.'); }
  }
  if (tool.kind === 'node') {
    if (tool.subtype === 'regular') return <section className="v5-inspector-form" aria-labelledby="node-inspector-title">
      <p className="v5-context-kicker">Node · Regular</p><h2 id="node-inspector-title">Regular node</h2>
      <label>Node name<input value={nodeName} disabled={busy} onChange={(event) => onNodeNameChange(event.currentTarget.value)} /></label>
      <p>Click the active map to place one indoor node. Points on the same floor can later be joined by a regular path.</p>
      {document.canvas.kind === 'static' && !document.frames.find((frame) => frame.id === props.activeFrameId)?.background && <p role="status">Assign a floor plan before placing nodes.</p>}
    </section>;
    const subtype = tool.subtype;
    const current = gesture?.kind === (subtype === 'entrance' ? 'entrance' : 'stair') ? gesture : null;
    const count = current?.endpoints.length ?? 0;
    const roles = subtype === 'entrance' ? ['Indoor landing', 'Outdoor landing'] : ['Lower landing', 'Upper landing'];
    const setNameValue = (value: string) => {
      const base = current ?? (subtype === 'entrance' ? { kind: 'entrance' as const, endpoints: [], name: '' } : { kind: 'stair' as const, endpoints: [], name: '' });
      onGestureChange({ ...base, name: value });
    };
    return <section className="v5-inspector-form" aria-labelledby="node-inspector-title">
      <p className="v5-context-kicker">Node · {subtype === 'entrance' ? 'Entrance' : 'Stair'}</p><h2 id="node-inspector-title">{subtype === 'entrance' ? 'Entrance' : 'Stair connection'}</h2>
      <label>{subtype === 'entrance' ? 'Entrance name' : 'Stair name'}<input value={current?.name ?? ''} disabled={busy} onChange={(event) => setNameValue(event.currentTarget.value)} /></label>
      <ol className="v5-endpoint-steps">{roles.map((role, index) => <li key={role} className={count > index ? 'complete' : ''}>{role}{count > index ? ' · selected' : index === count ? ' · click an existing node or map position' : ''}</li>)}</ol>
      {subtype === 'entrance' && <p>An entrance joins an indoor ground-floor landing to an outdoor point. Existing nodes are reused.</p>}
      {subtype === 'stair' && <p>Choose two landings in one building on different floors. Existing nodes are reused; survey node IDs stay attached.</p>}
      <div className="v5-action-row"><button type="button" className="primary" disabled={busy || count !== 2} onClick={onFinishGesture}>Finish {subtype}</button>
        <button type="button" disabled={busy || count === 0} onClick={onCancelGesture}>Discard</button></div>
      {count > 0 && <p role="status">{count} of 2 endpoints</p>}
    </section>;
  }
  if (!node) return <section className="v5-inspector-form"><h2>Node</h2><p>Select a node on the map to edit its properties.</p></section>;
  return <section className="v5-inspector-form node-inspector" aria-labelledby="node-inspector-title">
    <p className="v5-context-kicker">Selected node · {node.zoneId ? document.indoorZones.find((zone) => zone.id === node.zoneId)?.name : 'Outdoor'} · {node.z}</p>
    <h2 id="node-inspector-title">Node properties</h2>
    <form onSubmit={saveName}><label>Name<input required value={name} disabled={busy} onChange={(event) => setName(event.currentTarget.value)} /></label><button type="submit" disabled={busy}>Save name</button></form>
    <p>{node.generated ? 'Generated route point' : 'Authored point'}</p>
    <label className="v5-check-row"><input type="checkbox" checked={node.visitorVisible} disabled={busy} onChange={(event) => commit('Change visitor visibility', (draft) => setNodeVisibilityV5(draft, node.id, event.currentTarget.checked))} /> Show to visitors</label>
    <button type="button" className="danger" disabled={busy} onClick={() => { if (commit('Delete node', (draft) => removeNodeV5(draft, node.id))) setError(''); else setError('Node was not deleted. Resolve linked objects first.'); }}>Delete node</button>
    {document.transitions.filter((item) => item.nodeIds.includes(node.id)).map((item) => <button key={item.id} type="button" className="v5-linked-transition"
      onClick={() => props.onSelectionChange({ kind: 'transition', id: item.id })}>Edit {item.kind === 'elevator' ? 'elevator' : item.kind} · {item.name}</button>)}
    <details><summary>Advanced</summary><p className="coordinates">ID: {node.id}</p><p className="coordinates">Revision: {node.fingerprintRevision}</p><p className="coordinates">{node.position.kind === 'local' ? `x ${node.position.x}, y ${node.position.y}` : `lat ${node.position.lat}, lng ${node.position.lng}`}</p></details>
    <ErrorMessage error={error} />
  </section>;
}
