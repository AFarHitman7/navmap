import { useEffect, useMemo, useState } from 'react';
import { getDraftV5, isV5AuthoringEnabled, publishV5, saveDraftV5 } from './api-v3';
import { LayoutImportPanel } from './LayoutImportPanel';
import type { MapDraft, Position } from './map-contract';
import { addNodeAtV5, moveNodeV5 } from './editor-v3/model';
import { addDrawnPathV5, type PathVertexV5 } from './editor-v3/paths';
import { useEditorDocument } from './editor-v3/useEditorDocument';
import { CanvasHost } from './map/CanvasHost';

type Tool = 'select' | 'place-node' | 'draw-path' | 'move';

export function OrganizerV5({ venueId }: { venueId: string }) {
  const [initial, setInitial] = useState<MapDraft | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [tool, setTool] = useState<Tool>('select');
  const [activeFrameId, setActiveFrameId] = useState('');
  const [pending, setPending] = useState<PathVertexV5[]>([]);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.all([getDraftV5(venueId), isV5AuthoringEnabled()]).then(([draft, allowed]) => {
      if (!live) return;
      setInitial(draft);
      setActiveFrameId(draft.frames[0]?.id ?? '');
      setEnabled(allowed);
    }, (cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : 'Could not load this map'); });
    return () => { live = false; };
  }, [venueId]);
  if (error) return <section className="page-state" role="alert"><h1>Map unavailable</h1><p>{error}</p></section>;
  if (!initial) return <section className="page-state" role="status"><h1>Loading map</h1><span className="loading-dot" /></section>;
  return <V5Editor key={venueId} initial={initial} enabled={enabled} status={status} setStatus={setStatus}
    tool={tool} setTool={setTool} activeFrameId={activeFrameId} setActiveFrameId={setActiveFrameId}
    pending={pending} setPending={setPending} name={name} setName={setName} busy={busy} setBusy={setBusy} />;
}

function V5Editor({ initial, enabled, tool, setTool, activeFrameId, setActiveFrameId, pending, setPending, name, setName, busy, setBusy, status, setStatus }: {
  initial: MapDraft; enabled: boolean; tool: Tool; setTool: (tool: Tool) => void; activeFrameId: string; setActiveFrameId: (id: string) => void;
  pending: PathVertexV5[]; setPending: (vertices: PathVertexV5[]) => void; name: string; setName: (name: string) => void;
  busy: boolean; setBusy: (busy: boolean) => void; status: string; setStatus: (status: string) => void;
}) {
  const doc = useEditorDocument(initial);
  const { commit } = doc;
  const draft = doc.document;
  const frame = draft.frames.find((candidate) => candidate.id === activeFrameId);
  const canAuthor = enabled && !busy && Boolean(frame) && (draft.canvas.kind !== 'static' || Boolean(frame?.background));
  const callbacks = useMemo(() => ({
    onPointClick(position: Position, frameId: string) {
      if (!canAuthor || frameId !== activeFrameId) return;
      if (tool === 'place-node') {
        commit('Place node', (current) => addNodeAtV5(current, frameId, position));
        return;
      }
      if (tool === 'draw-path') setPending([...pending, { frameId, position }]);
    },
    onNodeMove(nodeId: string, position: Position, frameId: string) {
      if (canAuthor) commit('Move node', (current) => moveNodeV5(current, nodeId, frameId, position));
    },
  }), [canAuthor, activeFrameId, tool, pending, commit, setPending]);
  async function save() {
    if (!enabled || busy) return;
    setBusy(true); setStatus('Saving…');
    try { const saved = await saveDraftV5(draft); doc.markSaved(saved); setStatus('Saved'); }
    catch (cause) { setStatus(cause instanceof Error ? cause.message : 'Save failed'); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!enabled || busy) return;
    setBusy(true); setStatus('Publishing…');
    try { const result = await publishV5(draft.venueId); setStatus(`Published version ${result.manifest.version}`); }
    catch (cause) { setStatus(cause instanceof Error ? cause.message : 'Publish failed'); }
    finally { setBusy(false); }
  }
  function finishPath() {
    if (pending.length < 2) return;
    const committed = doc.commit('Draw path', (current) => addDrawnPathV5(current, pending, name.trim() || 'Path'));
    if (!committed) setStatus('Path could not be added. Check that the frame has an assigned background.');
    else { setPending([]); setName(''); setTool('select'); setStatus('Path added'); }
  }
  return <main className="v5-editor" aria-label="Map editor">
    <header className="v5-editor-header"><div><p className="eyebrow">MAP AUTHORING · V5</p><h1>{draft.venueId}</h1><p>{draft.canvas.kind === 'static' ? 'Static floor plan' : 'Geographic map'} · {doc.dirty ? 'Unsaved changes' : 'Saved'}</p></div>
      <div className="workspace-actions"><button type="button" disabled={!doc.canUndo || busy} onClick={doc.undo}>Undo</button><button type="button" disabled={!doc.canRedo || busy} onClick={doc.redo}>Redo</button><button type="button" disabled={!enabled || busy || !doc.dirty} onClick={() => void save()}>Save</button><button type="button" className="primary" disabled={!enabled || busy} onClick={() => void publish()}>Publish</button></div>
    </header>
    {!enabled && <p className="notice" role="status">V5 authoring is disabled by the server. This map is read-only.</p>}
    <section className="v5-editor-layout">
      <div className="v5-canvas-column">
        <div className="v5-toolbar" aria-label="Map tools">
          {draft.frames.map((candidate) => <button key={candidate.id} type="button" aria-pressed={candidate.id === activeFrameId} onClick={() => { setActiveFrameId(candidate.id); setPending([]); }}>{candidate.zoneId ? `${draft.indoorZones.find((z) => z.id === candidate.zoneId)?.name ?? 'Building'} · ${candidate.z}` : 'Outdoor'}{candidate.background ? '' : ' · no plan'}</button>)}
          <span className="v5-tool-spacer" />
          {(['select', 'place-node', 'draw-path', 'move'] as const).map((kind) => <button key={kind} type="button" aria-pressed={tool === kind} disabled={!enabled && kind !== 'select'} onClick={() => { setTool(kind); setPending([]); }}>{kind === 'place-node' ? 'Node' : kind === 'draw-path' ? 'Path' : kind === 'move' ? 'Move' : 'Select'}</button>)}
        </div>
        <div className="v5-map-frame">
          <CanvasHost document={draft} view="editor" activeFrameId={activeFrameId} mode={tool} callbacks={callbacks} />
          {draft.canvas.kind === 'static' && !frame?.background && <div className="v5-unassigned-guidance">Add a plan to this floor before placing nodes or paths.</div>}
        </div>
        <p className="v5-status" role="status">{status || (tool === 'place-node' ? 'Click the map to place a node.' : tool === 'draw-path' ? `${pending.length} points · click to continue` : 'Choose a floor and edit its map.')}</p>
      </div>
      <aside className="v5-inspector">
        {draft.canvas.kind === 'static' && enabled && <LayoutImportPanel venueId={draft.venueId} draft={draft} sessionGeneration={doc.sessionGeneration} commit={doc.commit} />}
        {tool === 'draw-path' && <section aria-label="Path details"><h2>Path</h2><label>Path name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Main corridor" /></label><p>Draw at least two points on the active assigned floor.</p><button type="button" disabled={pending.length < 2 || !canAuthor} onClick={finishPath}>Finish path</button><button type="button" onClick={() => setPending([])}>Clear points</button></section>}
        {draft.canvas.kind === 'static' && <section><h2>Floor plans</h2>{draft.frames.map((candidate) => <p key={candidate.id}>{candidate.zoneId ? draft.indoorZones.find((z) => z.id === candidate.zoneId)?.name : 'Outdoor'} · Floor {candidate.z} — {candidate.background ? `${candidate.background.width} × ${candidate.background.height}` : 'Plan not assigned'}</p>)}</section>}
        {draft.canvas.kind === 'geographic' && <section><h2>Map</h2><p>Geographic coordinates and OSM tiles. GPS is not used for authoring.</p></section>}
        <section><h2>Objects</h2><p>{draft.nodes.length} nodes · {(draft.paths ?? []).length} paths</p></section>
      </aside>
    </section>
  </main>;
}
