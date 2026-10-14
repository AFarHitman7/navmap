import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { getDraftV5, isV5AuthoringEnabled, publishV5, saveDraftV5 } from './api-v3';
import { LayoutImportPanel } from './LayoutImportPanel';
import type { MapDraft, Position } from './map-contract';
import { addRegularNode, addEntrance, addStair, addRegularPath } from './editor-v3/objects';
import { moveNodeV5 } from './editor-v3/model';
import { useEditorDocument } from './editor-v3/useEditorDocument';
import { CanvasHost } from './map/CanvasHost';
import { useBlocker } from 'react-router-dom';
import { UnsavedChangesDialog } from './editor/UnsavedChangesDialog';
import { Inspector } from './editor-v3/inspectors/Inspector';
import { ToolMenu } from './editor-v3/ToolMenu';
import { ObjectBrowser } from './ObjectBrowser';
import { endpointAt, endpointForNode, selectionExists, toolLabel, type InspectorView, type PendingGesture, type Selection, type Tool } from './editor-v3/tool-state';

export function OrganizerV5({ venueId, mapName = '' }: { venueId: string; mapName?: string }) {
  const [initial, setInitial] = useState<MapDraft | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const [view, setView] = useState<InspectorView>('build');
  const [activeFrameId, setActiveFrameId] = useState('');
  const [gesture, setGesture] = useState<PendingGesture | null>(null);
  const [nodeName, setNodeName] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [showReferencePoints, setShowReferencePoints] = useState(false);
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
  return <V5Editor key={venueId} initial={initial} enabled={enabled} mapName={mapName} status={status} setStatus={setStatus}
    showReferencePoints={showReferencePoints} setShowReferencePoints={setShowReferencePoints}
    tool={tool} setTool={setTool} selection={selection} setSelection={setSelection} view={view} setView={setView}
    activeFrameId={activeFrameId} setActiveFrameId={setActiveFrameId} gesture={gesture} setGesture={setGesture}
    nodeName={nodeName} setNodeName={setNodeName} busy={busy} setBusy={setBusy} />;
}

function V5Editor({ initial, enabled, mapName, tool, setTool, selection, setSelection, view, setView, activeFrameId, setActiveFrameId, showReferencePoints, setShowReferencePoints,
  gesture, setGesture, nodeName, setNodeName, busy, setBusy, status, setStatus }: {
  initial: MapDraft; enabled: boolean; mapName: string; tool: Tool; setTool: (tool: Tool) => void;
  selection: Selection; setSelection: (selection: Selection) => void; view: InspectorView; setView: (view: InspectorView) => void;
  showReferencePoints: boolean; setShowReferencePoints: (value: boolean) => void;
  activeFrameId: string; setActiveFrameId: (id: string) => void; gesture: PendingGesture | null; setGesture: Dispatch<SetStateAction<PendingGesture | null>>;
  nodeName: string; setNodeName: (name: string) => void; busy: boolean; setBusy: (busy: boolean) => void; status: string; setStatus: (status: string) => void;
}) {
  const doc = useEditorDocument(initial);
  const draft = doc.document;
  const blocker = useBlocker(doc.dirty || gesture !== null);
  const frame = draft.frames.find((candidate) => candidate.id === activeFrameId);
  const canAuthor = enabled && !busy && Boolean(frame) && (draft.canvas.kind !== 'static' || Boolean(frame?.background));
  function chooseTool(next: Tool) {
    setTool(next);
    setSelection({ kind: 'none' });
  }
  const appendEndpoint = useCallback((endpoint: ReturnType<typeof endpointAt> | ReturnType<typeof endpointForNode>, kind: 'entrance' | 'stair') => {
    setGesture((current) => {
      const previous = current?.kind === kind ? current : { kind, endpoints: [], name: '' } as PendingGesture;
      if (previous.kind !== kind || previous.endpoints.length >= 2) return previous;
      return { ...previous, endpoints: [...previous.endpoints, endpoint] };
    });
  }, [setGesture]);
  const callbacks = useMemo(() => ({
    onPointClick(position: Position, frameId: string) {
      if (!canAuthor || frameId !== activeFrameId) return;
      if (tool.kind === 'node' && tool.subtype === 'regular') {
        try {
          if (draft.frames.find((item) => item.id === frameId)?.zoneId === null) throw new Error('Regular nodes must be indoors. Choose an indoor floor.');
          if (!doc.commit('Place node', (current) => addRegularNode(current, frameId, position, nodeName))) throw new Error('Node could not be placed.');
          setStatus('Node placed');
        } catch (cause) { setStatus(cause instanceof Error ? cause.message : 'Node could not be placed'); }
        return;
      }
      if (tool.kind === 'node' && (tool.subtype === 'entrance' || tool.subtype === 'stair')) {
        appendEndpoint(endpointAt(frameId, position), tool.subtype);
        return;
      }
      if (tool.kind === 'path' && tool.subtype === 'regular') {
        const previous = gesture?.kind === 'path' ? gesture : { kind: 'path' as const, vertices: [], name: '' };
        if (previous.vertices.length && previous.vertices[0]!.frameId !== frameId) { setStatus('Pending path is on another floor. Return to that floor or discard it.'); return; }
        setStatus('');
        setGesture({ ...previous, vertices: [...previous.vertices, { frameId, position }] });
      }
    },
    onNodeClick(nodeId: string) {
      if (tool.kind === 'node' && (tool.subtype === 'entrance' || tool.subtype === 'stair')) {
        appendEndpoint(endpointForNode(nodeId), tool.subtype);
        return;
      }
      if (tool.kind === 'path' && tool.subtype === 'regular') {
        const node = draft.nodes.find((item) => item.id === nodeId);
        if (node) {
          const previous = gesture?.kind === 'path' ? gesture : { kind: 'path' as const, vertices: [], name: '' };
          if (previous.vertices.length && previous.vertices[0]!.frameId !== node.frameId) { setStatus('Pending path is on another floor. Return to that floor or discard it.'); return; }
          setStatus('');
          setGesture({ ...previous, vertices: [...previous.vertices, { frameId: node.frameId, position: node.position, nodeId: node.id }] });
        }
        return;
      }
      setSelection({ kind: 'node', id: nodeId });
      setView('build');
    },
    onPathClick(pathId: string) {
      setSelection({ kind: 'path', id: pathId });
      setView('build');
    },
    onTransitionClick(transitionId: string) {
      setSelection({ kind: 'transition', id: transitionId });
      setView('build');
    },
    onEdgeClick(from: string, to: string) {
      const transition = draft.transitions.find((item) => item.nodeIds.includes(from) && item.nodeIds.includes(to));
      setSelection(transition ? { kind: 'transition', id: transition.id } : { kind: 'node', id: from });
      setView('build');
    },
    onNodeMove(nodeId: string, position: Position, frameId: string) {
      if (canAuthor) doc.commit('Move node', (current) => moveNodeV5(current, nodeId, frameId, position));
    },
  }), [canAuthor, activeFrameId, tool, draft, doc, nodeName, gesture, appendEndpoint, setGesture, setStatus, setSelection, setView]);

  useEffect(() => {
    if (!selectionExists(selection, draft)) setSelection({ kind: 'none' });
  }, [draft, selection, setSelection]);

  async function save(): Promise<boolean> {
    if (!enabled || busy || gesture) return false;
    setBusy(true); setStatus('Saving…');
    try { const saved = await saveDraftV5(draft); doc.markSaved(saved); setStatus('Saved'); return true; }
    catch (cause) { setStatus(`Save failed: ${cause instanceof Error ? cause.message : 'Unknown error'}`); return false; }
    finally { setBusy(false); }
  }
  async function saveAndContinue() { if (gesture) return; if (await save()) blocker.proceed?.(); }
  async function publish() {
    if (!enabled || busy || gesture) return;
    setBusy(true); setStatus('Publishing…');
    try { const result = await publishV5(draft.venueId); setStatus(`Published version ${result.manifest.version}`); }
    catch (cause) { setStatus(cause instanceof Error ? cause.message : 'Publish failed'); }
    finally { setBusy(false); }
  }
  function finishGesture() {
    if (!gesture) return;
    try {
      let changed = false;
      if (gesture.kind === 'path') {
        if (gesture.vertices.length < 2) return;
        changed = doc.commit('Draw path', (current) => addRegularPath(current, gesture.vertices, gesture.name.trim() || 'Path'));
      } else if (gesture.endpoints.length === 2) {
        const endpoints = [...gesture.endpoints];
        if (gesture.kind === 'entrance') changed = doc.commit('Add entrance', (current) => addEntrance(current, endpoints[0]!, endpoints[1]!, gesture.name));
        else {
          const zFor = (endpoint: (typeof endpoints)[number], current: MapDraft) => {
            if (typeof endpoint === 'string') return current.nodes.find((node) => node.id === endpoint)?.z ?? 0;
            if ('nodeId' in endpoint) return current.nodes.find((node) => node.id === endpoint.nodeId)?.z ?? 0;
            return current.frames.find((item) => item.id === endpoint.frameId)?.z ?? 0;
          };
          endpoints.sort((a, b) => zFor(a, draft) - zFor(b, draft));
          changed = doc.commit('Add stairs', (current) => addStair(current, endpoints[0]!, endpoints[1]!, gesture.name));
        }
      }
      if (!changed) { setStatus('Could not finish. Check the endpoints and assigned frames; no saved objects were changed.'); return; }
      setGesture(null); setTool({ kind: 'select' }); setSelection({ kind: 'none' }); setStatus(gesture.kind === 'path' ? 'Path added' : `${gesture.kind === 'stair' ? 'Stairs' : 'Entrance'} added`);
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : 'Could not finish this operation.'); }
  }
  const cancelGesture = () => { setGesture(null); setStatus('Pending input discarded.'); };
  const canvasMode = tool.kind === 'node' && tool.subtype === 'regular' ? 'place-node'
    : tool.kind === 'node' && tool.subtype !== 'regular' ? 'endpoints'
      : tool.kind === 'path' && tool.subtype === 'regular' ? 'draw-path' : tool.kind === 'move' ? 'move' : 'select';
  return <main className="v5-editor" aria-label="Map editor">
    <header className="v5-editor-header"><div><p className="eyebrow">MAP AUTHORING · V5</p><h1>{mapName || draft.venueId}</h1><p>{draft.canvas.kind === 'static' ? 'Static floor plan' : 'Geographic map'} · {doc.dirty ? 'Unsaved changes' : 'Saved'}</p></div>
      <div className="workspace-actions v5-fixed-actions"><button type="button" disabled={!doc.canUndo || busy} onClick={doc.undo}>Undo</button><button type="button" disabled={!doc.canRedo || busy} onClick={doc.redo}>Redo</button><button type="button" disabled={!enabled || busy || !doc.dirty || gesture !== null} onClick={() => void save()}>Save</button></div>
    </header>
    <UnsavedChangesDialog open={blocker.state === 'blocked'} busy={busy} saveDisabled={gesture !== null} saveError={gesture ? 'Finish or discard pending input before saving.' : status.startsWith('Save failed') ? status : null}
      onSave={() => void saveAndContinue()} onDiscard={() => blocker.proceed?.()} onCancel={() => blocker.reset?.()} />
    {!enabled && <p className="notice" role="status">V5 authoring is disabled by the server. This map is read-only; the legacy editor remains available for V4 maps.</p>}
    <section className="v5-editor-layout">
      <div className="v5-canvas-column">
        <div className="v5-toolbar" aria-label="Map tools">
          <div className="v5-frame-switch" role="group" aria-label="Map frames">{draft.frames.map((candidate) => <button key={candidate.id} type="button" aria-pressed={candidate.id === activeFrameId} onClick={() => setActiveFrameId(candidate.id)}>{candidate.zoneId ? `${draft.indoorZones.find((z) => z.id === candidate.zoneId)?.name ?? 'Building'} · ${candidate.z}` : 'Outdoor'}{candidate.background ? '' : ' · no plan'}</button>)}</div>
          <span className="v5-tool-spacer" />
          <button type="button" aria-pressed={tool.kind === 'select'} onClick={() => chooseTool({ kind: 'select' })}>Select</button>
          <button type="button" aria-pressed={tool.kind === 'boundary'} disabled={!enabled} onClick={() => chooseTool({ kind: 'boundary' })}>Boundary</button>
          <button type="button" aria-pressed={tool.kind === 'building'} disabled={!enabled} onClick={() => chooseTool({ kind: 'building' })}>Building</button>
          <ToolMenu label="Node" active={tool.kind === 'node' ? tool.subtype[0]!.toUpperCase() + tool.subtype.slice(1) : null} disabled={!enabled}
            items={[{ label: 'Regular', subtype: 'regular', value: { kind: 'node', subtype: 'regular' } }, { label: 'Entrance', subtype: 'entrance', value: { kind: 'node', subtype: 'entrance' } }, { label: 'Stair', subtype: 'stair', value: { kind: 'node', subtype: 'stair' } }]}
            onChoose={chooseTool} />
          <ToolMenu label="Path" active={tool.kind === 'path' ? tool.subtype[0]!.toUpperCase() + tool.subtype.slice(1) : null} disabled={!enabled}
            items={[{ label: 'Regular', subtype: 'regular', value: { kind: 'path', subtype: 'regular' } }, { label: 'Stair', subtype: 'stair', value: { kind: 'path', subtype: 'stair' } }]}
            onChoose={chooseTool} />
        </div>
        <div className="v5-map-frame"><CanvasHost document={draft} view="editor" activeFrameId={activeFrameId} mode={canvasMode} callbacks={callbacks} selection={selection} showReferencePoints={showReferencePoints} />
          {draft.canvas.kind === 'static' && !frame?.background && <div className="v5-unassigned-guidance">Add a plan to this floor before placing nodes or paths.</div>}
        </div>
        <div className="v5-canvas-options"><label><input type="checkbox" checked={showReferencePoints} onChange={(event) => setShowReferencePoints(event.target.checked)} /> Show survey reference points</label></div>
        <div className="v5-status-row"><p className="v5-status" role="status">{status || (gesture ? `${gesture.kind === 'path' ? gesture.vertices.length : gesture.endpoints.length} ${gesture.kind === 'path' ? 'points' : 'endpoints'} · pending ${gesture.kind}` : `${toolLabel(tool)} · ${frame?.zoneId ? draft.indoorZones.find((zone) => zone.id === frame.zoneId)?.name : 'Outdoor'}`)}</p>
          {gesture && <div className="v5-pending-actions"><button type="button" onClick={() => setTool(gesture.kind === 'path' ? { kind: 'path', subtype: 'regular' } : { kind: 'node', subtype: gesture.kind })}>Resume</button><button type="button" className="text-button" onClick={cancelGesture}>Discard</button></div>}
        </div>
      </div>
      <ObjectBrowser document={draft} selection={selection} onSelect={(next) => { setSelection(next); setView('build'); setTool({ kind: 'select' }); }} />
      <Inspector document={draft} tool={tool} selection={selection} activeFrameId={activeFrameId} commit={doc.commit} busy={busy || !enabled}
        onSelectionChange={setSelection} onToolChange={setTool} gesture={gesture} onGestureChange={setGesture} nodeName={nodeName} onNodeNameChange={setNodeName}
        onFinishGesture={finishGesture} onCancelGesture={cancelGesture} view={view} onViewChange={setView} onPublish={() => void publish()}
        floorSettings={draft.canvas.kind === 'static' && enabled ? <LayoutImportPanel venueId={draft.venueId} draft={draft} sessionGeneration={doc.sessionGeneration} commit={doc.commit} />
          : draft.canvas.kind === 'geographic' ? <p>Geographic maps use OSM tiles. GPS is never used to assign indoor floors.</p> : <p>V5 authoring is disabled by the server.</p>} />
    </section>
    <div className="v5-publish-bar"><span>{status || (doc.dirty ? 'Draft has unsaved changes' : 'All changes saved')}</span><button type="button" className="primary" disabled={!enabled || busy || gesture !== null} onClick={() => void publish()}>Publish</button></div>
  </main>;
}
