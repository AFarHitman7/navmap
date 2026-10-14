import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { getDraftV3, login, publishV3, PublishValidationError, RevisionConflictError, saveDraftV3 } from './api-v3';
import type { BoundsV3, DraftV3, EdgeV3, ManifestV3 } from './contract-v3';
import {
  addFloor,
  addNodeAt,
  addPlaceToNode,
  addZone,
  connectNodes,
  editPlace,
  emptyDraftV3,
  moveNode,
  publicationChecks,
  removeFloor,
  removeNode,
  removePlace,
  renameNode,
  renameZone,
  setBoundary,
  updateNodeLocation,
} from './editor-v3/model';
import { PathControls } from './editor-v3/PathControls';
import { useEditorDocument } from './editor-v3/useEditorDocument';
import { addDrawnPath, deleteConnection, removeDrawnPath, type PathVertex } from './editor-v3/paths';
import { MapCanvasV3, type MapV3Mode } from './MapCanvasV3';
import { Icon } from './editor/Icon';
import { UnsavedChangesDialog } from './editor/UnsavedChangesDialog';
import { LayerPicker } from './LayerPicker';
import { isNodeVisible, resolveFloorVisibility, type ZoneFloorVisibility } from './floor-visibility';

type Tab = 'build' | 'places' | 'publish';
type Candidate = { bounds: BoundsV3; kind: 'boundary' | 'zone' };
const message = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong. Try again.');
const preferredFloor = (floors: { z: number }[]) => floors.find((f) => f.z === 0)?.z ?? floors[0]?.z ?? 0;
const nodeLabel = (n: { id: string; name: string }) => `${n.name} ${n.id}`;
const sameEdge = (edge: EdgeV3, from: string, to: string) =>
  (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from);

export function OrganizerV3({ venueId = 'demo' }: { venueId?: string }) {
  // The transaction history owns the document: every edit commits through it,
  // loads/switches reset it, and save acknowledgements only mark it saved.
  const doc = useEditorDocument(emptyDraftV3(venueId));
  const draft = doc.document;
  const dirty = doc.dirty;
  const { undo: undoDoc, redo: redoDoc, reset: resetDoc } = doc;
  const [phase, setPhase] = useState<'loading' | 'login' | 'ready' | 'error'>('loading');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('Pan and zoom to your venue, then draw its boundary.');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<MapV3Mode>('navigate');
  const [tab, setTab] = useState<Tab>('build');
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [from, setFrom] = useState('');
  const [connectionKind, setConnectionKind] = useState<EdgeV3['kind'] | 'auto'>('auto');
  const [pendingPath, setPendingPath] = useState<PathVertex[]>([]);
  const [stairsArmed, setStairsArmed] = useState(false);
  const [selectedPathId, setSelectedPathId] = useState('');
  const [selectedConnection, setSelectedConnection] = useState<{ from: string; to: string } | null>(null);
  const [floorChoices, setFloorChoices] = useState<ZoneFloorVisibility>({});
  const [showOutdoors, setShowOutdoors] = useState(true);
  const [placementZoneId, setPlacementZoneId] = useState<string | null>(null);
  const [placementFloorZ, setPlacementFloorZ] = useState(0);
  const [placeFormResetKey, setPlaceFormResetKey] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [published, setPublished] = useState<ManifestV3 | null>(null);
  const [publishIssues, setPublishIssues] = useState<string[]>([]);
  const lock = useRef(false);

  const zone = draft.indoorZones.find((z) => z.id === selectedZoneId) ?? null;
  const placementZone = draft.indoorZones.find((z) => z.id === placementZoneId) ?? null;
  const node = draft.nodes.find((n) => n.id === selectedNodeId);
  const nodeZone = node?.zoneId ? draft.indoorZones.find((z) => z.id === node.zoneId) : null;
  const nodePlace = node ? draft.places.find((p) => p.nodeId === node.id) : undefined;
  const indoorPlaceNodes = draft.nodes.filter((n) => n.zoneId !== null);
  const visibility = useMemo(() => resolveFloorVisibility(draft.indoorZones, floorChoices), [draft.indoorZones, floorChoices]);
  const validPlacementFloorZ = placementZone?.floors.some((f) => f.z === placementFloorZ)
    ? placementFloorZ
    : preferredFloor(placementZone?.floors ?? []);
  const checks = publicationChecks(draft);
  const connections = node ? draft.edges.filter((e) => e.from === node.id || e.to === node.id) : [];
  const selectedPath = (draft.paths ?? []).find((path) => path.id === selectedPathId) ?? null;
  const selectedConnectionEdge = selectedConnection
    ? draft.edges.find((edge) => sameEdge(edge, selectedConnection.from, selectedConnection.to)) ?? null
    : null;

  async function load() {
    setPhase('loading');
    setError('');
    try {
      const d = await getDraftV3(venueId);
      resetDoc(d);
      setPhase('ready');
    } catch (err) {
      // No v3 draft yet: start from a blank map instead of an error page.
      if (/no v3 draft for venue/.test(message(err))) {
        resetDoc(emptyDraftV3(venueId));
        setPhase('ready');
        return;
      }
      setPhase(/401|403/.test(message(err)) ? 'login' : 'error');
      if (!/401|403/.test(message(err))) setError(message(err));
    }
  }

  useEffect(() => {
    let active = true;
    getDraftV3(venueId).then(
      (d) => {
        if (active) {
          resetDoc(d);
          setPhase('ready');
        }
      },
      (err: unknown) => {
        if (!active) return;
        if (/no v3 draft for venue/.test(err instanceof Error ? err.message : '')) {
          resetDoc(emptyDraftV3(venueId));
          setPhase('ready');
          return;
        }
        setPhase(/401|403/.test(message(err)) ? 'login' : 'error');
        if (!/401|403/.test(message(err))) setError(message(err));
      },
    );
    return () => {
      active = false;
    };
  }, [venueId, resetDoc]);

  const undoEditOrPending = useCallback(() => {
    if (lock.current || busy || phase !== 'ready') return;
    if (stairsArmed) {
      setStairsArmed(false);
      setStatus('Stairs link disarmed. Undo again to remove path points.');
      return;
    }
    if (pendingPath.length > 0) {
      setPendingPath((vertices) => vertices.slice(0, -1));
      setStatus(pendingPath.length > 1 ? 'Path point removed.' : 'Path drawing cleared.');
      return;
    }
    if (undoDoc()) setStatus('Undone.');
  }, [busy, phase, stairsArmed, pendingPath.length, undoDoc]);

  const redoEditDoc = useCallback(() => {
    if (lock.current || busy || phase !== 'ready') return;
    if (redoDoc()) setStatus('Redone.');
  }, [busy, phase, redoDoc]);

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty && phase === 'ready') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const shortcuts = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMode('navigate');
        setCandidate(null);
        setFrom('');
        setPendingPath([]);
        setStairsArmed(false);
        return;
      }
      if (!e.ctrlKey && !e.metaKey) return;
      const key = e.key.toLowerCase();
      const wantUndo = key === 'z' && !e.shiftKey;
      const wantRedo = key === 'y' || (key === 'z' && e.shiftKey);
      if (!wantUndo && !wantRedo) return;
      const target = e.target as HTMLElement | null;
      if (target && typeof target.closest === 'function' && target.closest('input, textarea, select, [contenteditable="true"]')) {
        return; // Native input undo remains native.
      }
      if (lock.current || busy || phase !== 'ready') return; // Locked while loading/saving/publishing.
      e.preventDefault();
      if (wantUndo) undoEditOrPending();
      else redoEditDoc();
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('keydown', shortcuts);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('keydown', shortcuts);
    };
  }, [dirty, phase, busy, pendingPath, stairsArmed, undoEditOrPending, redoEditDoc]);

  useEffect(() => {
    if (placementZoneId && !placementZone) {
      setPlacementZoneId(null);
      setPlacementFloorZ(0);
      return;
    }
    // While drawing, bubbled zone clicks switch the placement zone but must not
    // implicitly reset the placement floor; corners use the valid floor instead.
    if (mode !== 'draw-path' && placementZone && placementFloorZ !== validPlacementFloorZ) {
      setPlacementFloorZ(validPlacementFloorZ);
    }
  }, [placementZoneId, placementZone, placementFloorZ, validPlacementFloorZ, mode]);

  let blocker: { state: string; proceed?: () => void; reset?: () => void } = { state: 'unblocked' };
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    blocker = useBlocker(dirty && phase === 'ready') as { state: string; proceed?: () => void; reset?: () => void };
  } catch {
    blocker = { state: 'unblocked' };
  }

  // History owns the document: after any commit/undo/redo/reset, drop
  // selections that no longer exist instead of showing orphan inspectors.
  // Pan, zoom, selection, and visibility are intentionally never recorded.
  useEffect(() => {
    if (selectedNodeId && !draft.nodes.some((n) => n.id === selectedNodeId)) setSelectedNodeId('');
    if (selectedZoneId && !draft.indoorZones.some((z) => z.id === selectedZoneId)) setSelectedZoneId(null);
    if (placementZoneId && !draft.indoorZones.some((z) => z.id === placementZoneId)) {
      setPlacementZoneId(null);
      setPlacementFloorZ(0);
    }
    if (selectedPathId && !(draft.paths ?? []).some((p) => p.id === selectedPathId)) setSelectedPathId('');
    if (selectedConnection && !draft.edges.some((edge) => sameEdge(edge, selectedConnection.from, selectedConnection.to))) {
      setSelectedConnection(null);
    }
  }, [draft, selectedNodeId, selectedZoneId, placementZoneId, selectedPathId, selectedConnection]);

  function commitDoc(next: DraftV3, notice: string, label?: string): boolean {
    if (lock.current) return false;
    if (!doc.commit(label ?? notice, next)) return false;
    setError('');
    setSaveError(null);
    setStatus(notice);
    return true;
  }

  function edit(change: (d: DraftV3) => DraftV3, notice = 'Changes made. Save when you’re ready.') {
    if (lock.current) return false;
    try {
      return commitDoc(change(draft), notice);
    } catch (err) {
      setError(message(err));
      return false;
    }
  }

  function selectNode(id: string) {
    setSelectedNodeId(id);
    setSelectedPathId('');
    setSelectedConnection(null);
    const n = draft.nodes.find((item) => item.id === id);
    if (n?.zoneId) {
      setSelectedZoneId(n.zoneId);
      setPlacementZoneId(n.zoneId);
      setPlacementFloorZ(n.z);
    }
  }

  function selectZoneForEditing(id: string) {
    const nextZone = draft.indoorZones.find((item) => item.id === id);
    setSelectedZoneId(id);
    setPlacementZoneId(id);
    // Zone rectangles bubble their clicks to the map while drawing, so a cross-zone
    // corner must not implicitly reset the placement floor mid-path.
    if (mode !== 'draw-path' && nextZone && id !== placementZoneId) setPlacementFloorZ(preferredFloor(nextZone.floors));
  }

  function handleNodeClick(id: string) {
    if (mode === 'draw-path') {
      appendPathVertexFromNode(id);
      return;
    }
    if (mode === 'connect') {
      if (!from) {
        setFrom(id);
        setSelectedNodeId(id);
        return;
      }
      if (from !== id) {
        edit((d) => connectNodes(d, from, id, connectionKind === 'auto' ? undefined : connectionKind), 'Points connected.');
        setFrom('');
        setMode('navigate');
      }
      return;
    }
    selectNode(id);
  }

  function handlePointClick(p: { lat: number; lng: number }) {
    if (lock.current) return;
    if (mode === 'add-nodes') {
      try {
        const next = placementZone
          ? addNodeAt(draft, p.lat, p.lng, placementZone.id, validPlacementFloorZ)
          : addNodeAt(draft, p.lat, p.lng, null, 0);
        if (commitDoc(next, 'Point added. Connect it to a neighbouring point.', 'Add point')) {
          setSelectedNodeId(next.nodes[next.nodes.length - 1]!.id);
        }
      } catch (err) {
        setError(message(err));
      }
    }
    if (mode === 'draw-path') {
      if (stairsArmed) {
        setError('Select an existing landing to link stairs.');
        return;
      }
      const vertex = placementZone
        ? { lat: p.lat, lng: p.lng, zoneId: placementZone.id, z: validPlacementFloorZ }
        : { lat: p.lat, lng: p.lng, zoneId: null, z: 0 };
      setPendingPath((vertices) => [...vertices, vertex]);
      setError('');
      setStatus('Path point added. Finish or Cancel when ready.');
    }
  }

  function appendPathVertexFromNode(id: string) {
    const target = draft.nodes.find((item) => item.id === id);
    if (!target) return;
    const previous = pendingPath.at(-1);
    const incomingKind = stairsArmed ? 'stairs' : 'path';
    if (stairsArmed) {
      if (!previous) {
        setError('Start the path before linking stairs.');
        return;
      }
      if (previous.zoneId === null || previous.zoneId !== target.zoneId || previous.z === target.z) {
        setError('Stairs must link landings in the same building on different floors.');
        return;
      }
      // Continue drawing where the stairs landed: sync placement to the linked floor.
      setPlacementZoneId(target.zoneId);
      setPlacementFloorZ(target.z);
    }
    setPendingPath((vertices) => [...vertices, { lat: target.lat, lng: target.lng, zoneId: target.zoneId, z: target.z, nodeId: id, incomingKind }]);
    setSelectedNodeId(id);
    setSelectedPathId('');
    setSelectedConnection(null);
    setStairsArmed(false);
    setError('');
    setStatus(stairsArmed ? 'Stairs transition linked. Continue drawing on the selected floor.' : 'Path point added.');
  }

  function cancelPathDrawing() {
    setPendingPath([]);
    setStairsArmed(false);
    setMode('navigate');
    setStatus('Path drawing cancelled.');
  }

  function finishPathDrawing() {
    if (stairsArmed) {
      setError('Complete or cancel the armed stairs link before finishing the path.');
      return;
    }
    if (edit((d) => addDrawnPath(d, pendingPath), 'Path saved to the draft.')) {
      setPendingPath([]);
      setStairsArmed(false);
      setMode('navigate');
    }
  }

  function selectPath(id: string) {
    const paths = draft.paths ?? [];
    const next = paths.find((path) => path.id === id) ?? (paths.length === 1 ? paths[0] : null);
    setSelectedPathId(next?.id ?? '');
    setSelectedConnection(null);
    setSelectedNodeId('');
    setMode('navigate');
  }

  function selectConnection(fromId: string, toId: string) {
    setSelectedConnection({ from: fromId, to: toId });
    setSelectedPathId('');
    setSelectedNodeId('');
    setMode('navigate');
  }

  function deleteSelectedPath() {
    if (!selectedPath) return;
    if (edit((d) => removeDrawnPath(d, selectedPath.id), 'Path deleted.')) setSelectedPathId('');
  }

  function deleteSelectedConnection() {
    if (!selectedConnectionEdge) return;
    if (edit((d) => deleteConnection(d, selectedConnectionEdge.from, selectedConnectionEdge.to), 'Connection deleted.')) setSelectedConnection(null);
  }

  function handleNodeMove(id: string, lat: number, lng: number) {
    if (lock.current) return;
    if (edit((d) => moveNode(d, id, lat, lng), 'Point moved.')) {
      setSelectedNodeId(id);
      setMode('navigate');
    }
  }

  function submitNodeDetails(data: FormData) {
    if (!node) return;
    const name = String(data.get('name') ?? '');
    const lat = Number(data.get('lat'));
    const lng = Number(data.get('lng'));
    const z = Number(data.get('z'));
    edit((d) => {
      const renamed = name.trim() !== node.name ? renameNode(d, node.id, name) : d;
      if (lat === node.lat && lng === node.lng && z === node.z) return renamed;
      return updateNodeLocation(renamed, node.id, lat, lng, node.zoneId, z);
    }, 'Point updated.');
  }

  function submitPlaceDetails(data: FormData) {
    if (!node) return;
    const name = String(data.get('placeName') ?? '');
    const nodeId = String(data.get('placeNodeId') ?? node.id);
    if (nodePlace) {
      if (edit((d) => editPlace(d, nodePlace.id, { name, nodeId }), 'Place updated.')) selectNode(nodeId);
      else setPlaceFormResetKey((key) => key + 1);
    } else {
      edit((d) => addPlaceToNode(d, node.id, name), 'Place created.');
    }
  }

  function applyCandidate() {
    if (!candidate || lock.current) return;
    try {
      if (candidate.kind === 'boundary') {
        edit((d) => setBoundary(d, candidate.bounds), 'Outdoor boundary set. Add zones inside it.');
      } else {
        const name = zoneName.trim() || 'New zone';
        const next = addZone(draft, { name, bounds: candidate.bounds, floors: [{ z: 0, label: 'Ground' }] });
        if (!commitDoc(next, `Zone ${name} added with a Ground floor.`, 'Add zone')) return;
        const nextZone = next.indoorZones[next.indoorZones.length - 1]!;
        setSelectedZoneId(nextZone.id);
        setPlacementZoneId(nextZone.id);
        setPlacementFloorZ(preferredFloor(nextZone.floors));
      }
      setCandidate(null);
      setZoneName('');
      setMode('navigate');
      setError('');
    } catch (err) {
      setError(message(err));
    }
  }

  async function save(publish = false): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true;
    setBusy(publish ? 'Publishing…' : 'Saving…');
    setError('');
    setSaveError(null);
    if (publish) setTab('publish');
    try {
      // The server acknowledgement only marks the save: history and any newer
      // local snapshot stay intact, and a 409 conflict retains the document.
      const result = await saveDraftV3(draft, venueId);
      doc.markSaved(result);
      if (publish) {
        setPublishIssues([]);
        const outcome = await publishV3(venueId);
        setPublished(outcome.manifest);
        setStatus(`Published version ${outcome.manifest.version}.`);
      } else {
        setStatus('Draft saved. You can safely return later.');
      }
      return true;
    } catch (err) {
      if (err instanceof PublishValidationError) setPublishIssues(err.issues);
      if (err instanceof RevisionConflictError) {
        const detail = err.nodeIds.map((id) => `${id} (server revision ${err.currentRevisions[id] ?? '?'})`).join(', ');
        const conflict = `Save conflict on ${detail || 'unknown nodes'}. Your edits are kept; resolve the conflict, then save again.`;
        setError(conflict);
        setSaveError(conflict);
      } else {
        setError(message(err));
        setSaveError(message(err));
      }
      return false;
    } finally {
      lock.current = false;
      setBusy('');
    }
  }

  if (phase === 'loading')
    return (
      <div className="page-state">
        <span className="loading-dot" />
        <h2>Opening your workspace</h2>
        <p>Loading your saved venue…</p>
      </div>
    );
  if (phase === 'error')
    return (
      <div className="page-state">
        <h2>Couldn’t open the draft</h2>
        <p className="error" role="alert">
          {error}
        </p>
        <button onClick={() => void load()}>Retry</button>
      </div>
    );
  if (phase === 'login')
    return (
      <div className="sign-in-page">
        <div className="sign-in-story">
          <span className="eyebrow">NAVMAP / ORGANIZER</span>
          <h1>
            A clear path
            <br />
            starts here.
          </h1>
          <p>Map your venue, connect its paths, and help visitors find their way.</p>
          <div className="route-art" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <span>OUTDOORS → INDOORS</span>
          </div>
        </div>
        <form
          className="login-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy('Signing in…');
            setError('');
            try {
              await login(password);
              await load();
            } catch (err) {
              setError(message(err));
            } finally {
              setBusy('');
            }
          }}
        >
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h2>Organizer sign in</h2>
          <p>Use your admin password to edit the venue.</p>
          <label>
            Admin password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={!!busy}>
            {busy || 'Sign in'} <Icon name="arrow" />
          </button>
        </form>
      </div>
    );

  return (
    <div className="editor-page">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">V3 VENUE EDITOR</span>
          <h1>Map editor — {venueId}</h1>
        </div>
        <div className="workspace-actions">
          <button
            type="button"
            onClick={undoEditOrPending}
            disabled={!!busy || (!doc.canUndo && pendingPath.length === 0 && !stairsArmed)}
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
          >
            ↺ Undo
          </button>
          <button
            type="button"
            onClick={redoEditDoc}
            disabled={!!busy || !doc.canRedo}
            aria-label="Redo"
            title="Redo (Ctrl+Y)"
          >
            ↻ Redo
          </button>
          <span className={`save-state ${dirty ? 'dirty' : ''}`} data-testid="save-state">
            {busy || (dirty ? 'Unsaved changes' : 'All changes saved')}
          </span>
          <button onClick={() => void save()} disabled={!!busy}>
            Save draft
          </button>
          <button className="primary" onClick={() => void save(true)} disabled={!!busy}>
            Publish <Icon name="arrow" />
          </button>
        </div>
      </div>
      <UnsavedChangesDialog
        open={blocker.state === 'blocked'}
        busy={!!busy}
        saveError={saveError}
        onSave={() =>
          void (async () => {
            const ok = await save(false);
            if (ok) blocker.proceed?.();
          })()
        }
        onDiscard={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
      <fieldset className="editor-shell" disabled={!!busy}>
        <div className="canvas-column">
          <div className="map-toolbar">
            <div className="tools" role="toolbar" aria-label="Map editing modes">
              <button
                type="button"
                aria-pressed={mode === 'navigate'}
                onClick={() => {
                  setMode('navigate');
                  setFrom('');
                  setCandidate(null);
                  setPendingPath([]);
                  setStairsArmed(false);
                }}
              >
                <Icon name="pointer" />
                Navigate
              </button>
              <button
                type="button"
                aria-pressed={mode === 'draw-boundary'}
                onClick={() => {
                  setMode('draw-boundary');
                  setFrom('');
                  setCandidate(null);
                  setPendingPath([]);
                  setStairsArmed(false);
                  setTab('build');
                }}
              >
                <Icon name="rectangle" />
                Draw boundary
              </button>
              <button
                type="button"
                aria-pressed={mode === 'draw-zone'}
                disabled={!draft.boundary}
                onClick={() => {
                  setMode('draw-zone');
                  setFrom('');
                  setCandidate(null);
                  setPendingPath([]);
                  setStairsArmed(false);
                  setTab('build');
                }}
              >
                <Icon name="rectangle" />
                Add zone
              </button>
              <button
                type="button"
                aria-pressed={mode === 'add-nodes'}
                disabled={!draft.boundary}
                onClick={() => {
                  setMode('add-nodes');
                  setFrom('');
                  setCandidate(null);
                  setPendingPath([]);
                  setStairsArmed(false);
                }}
              >
                <Icon name="point" />
                Add nodes
              </button>
              <button
                type="button"
                aria-pressed={mode === 'connect'}
                onClick={() => {
                  setMode('connect');
                  setCandidate(null);
                }}
              >
                <Icon name="link" />
                Connect
              </button>
              <button
                type="button"
                aria-pressed={mode === 'draw-path'}
                disabled={!draft.boundary}
                onClick={() => {
                  setMode('draw-path');
                  setFrom('');
                  setCandidate(null);
                  setSelectedPathId('');
                  setSelectedConnection(null);
                }}
              >
                <Icon name="link" />
                Draw path
              </button>
              <button
                type="button"
                aria-pressed={mode === 'move'}
                disabled={!node}
                onClick={() => {
                  setMode('move');
                  setFrom('');
                  setCandidate(null);
                  setPendingPath([]);
                  setStairsArmed(false);
                }}
              >
                <Icon name="pointer" />
                Move
              </button>
            </div>
          </div>
          <LayerPicker zones={draft.indoorZones} visibility={visibility} showOutdoors={showOutdoors}
            onFloorChange={(id, floor) => setFloorChoices((choices) => ({ ...choices, [id]: floor }))}
            onOutdoorsChange={setShowOutdoors} />
          <div className="map-frame">
            <MapCanvasV3
              draft={draft}
              selectedZoneId={selectedZoneId}
              selectedNodeId={selectedNodeId}
              zoneFloorVisibility={visibility}
              showOutdoors={showOutdoors}
              mode={mode}
              disabled={!!busy}
              onNodeClick={handleNodeClick}
              onZoneClick={(id) => {
                if (id) selectZoneForEditing(id);
                else setSelectedZoneId(null);
              }}
              onPointClick={handlePointClick}
              onNodeMove={handleNodeMove}
              pathPreview={pendingPath}
              selectedPathId={selectedPathId}
              onPathClick={selectPath}
              onEdgeClick={selectConnection}
              onError={setError}
              onRectangle={(bounds) => {
                setCandidate({ bounds, kind: mode === 'draw-zone' ? 'zone' : 'boundary' });
                setZoneName('');
                setError('');
              }}
            />
            {candidate && (
              <div className="rectangle-review">
                <div>
                  <strong>Use this {candidate.kind === 'boundary' ? 'boundary' : 'zone area'}?</strong>
                  <p>
                    {candidate.kind === 'boundary'
                      ? 'Outdoor points must stay inside it. You can redraw it later.'
                      : 'Zones must sit inside the outdoor boundary and must not overlap.'}
                  </p>
                  {candidate.kind === 'zone' && (
                    <label>
                      Zone name
                      <input
                        value={zoneName}
                        onChange={(e) => setZoneName(e.target.value)}
                        placeholder="e.g. Building A"
                        aria-label="New zone name"
                      />
                    </label>
                  )}
                </div>
                <button className="primary" onClick={applyCandidate}>
                  Apply rectangle
                </button>
                <button
                  onClick={() => {
                    setCandidate(null);
                    setZoneName('');
                    setMode('navigate');
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
            {busy && <div className="map-busy">{busy}</div>}
          </div>
          <div className="map-help">
            <span className="tool-indicator" />
            <span>
              {mode === 'draw-boundary' || mode === 'draw-zone'
                ? 'Draw or tap two corners. Apply to keep, Escape to cancel.'
                : mode === 'add-nodes'
                  ? 'Click an empty spot to add a point. Drag to pan.'
                  : mode === 'draw-path'
                    ? 'Click points or the map to add route vertices. Finish saves; Cancel discards.'
                  : mode === 'move'
                    ? 'Drag the selected point to move it. Empty-map drags won’t pan.'
                    : mode === 'connect'
                      ? `Connecting from ${from || '—'}. Select another point to link them.`
                      : 'Drag to pan · scroll to zoom · select a point to edit'}
            </span>
            <span className="map-count">
              {draft.nodes.length} points · {draft.edges.length} paths
            </span>
          </div>
        </div>
        <aside className="inspector">
          <div className="inspector-tabs" role="tablist" aria-label="Inspector">
            {(['build', 'places', 'publish'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
              >
                {t === 'build' ? 'Build' : t === 'places' ? 'Places' : 'Publish'}
              </button>
            ))}
          </div>
          <div className="inspector-content">
            {tab === 'build' && (
              <>
                <section>
                  <span className="eyebrow">01 / OUTDOOR BOUNDARY</span>
                  <h2>Define your outdoors</h2>
                  <p>Find your venue on OpenStreetMap, then draw a rectangle around it. Zones and points must stay inside.</p>
                  <div className="draw-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setMode('draw-boundary');
                        setFrom('');
                        setCandidate(null);
                      }}
                    >
                      {draft.boundary ? 'Redraw boundary' : 'Draw boundary'}
                    </button>
                  </div>
                  {draft.boundary && (
                    <details>
                      <summary>Boundary coordinates</summary>
                      <p className="coordinates">
                        Bounds N {draft.boundary.north.toFixed(5)} S {draft.boundary.south.toFixed(5)} E{' '}
                        {draft.boundary.east.toFixed(5)} W {draft.boundary.west.toFixed(5)}
                      </p>
                    </details>
                  )}
                </section>
                <PathControls
                  mode={mode}
                  vertices={pendingPath}
                  selectedPath={selectedPath}
                  paths={draft.paths ?? []}
                  selectedConnection={selectedConnectionEdge}
                  stairsArmed={stairsArmed}
                  busy={!!busy}
                  onFinish={finishPathDrawing}
                  onCancel={cancelPathDrawing}
                  onArmStairs={() => setStairsArmed((armed) => !armed)}
                  onDeletePath={deleteSelectedPath}
                  onSelectPath={selectPath}
                  onDeleteConnection={deleteSelectedConnection}
                />
                <section>
                  <span className="eyebrow">02 / INDOOR ZONES</span>
                  <h2>Buildings inside the boundary</h2>
                  <p>Use Add zone in the toolbar, draw a rectangle, then name it. New zones start with a Ground floor.</p>
                  {!draft.indoorZones.length && <p className="empty-hint">No zones yet. Draw the boundary first, then add a zone.</p>}
                  <ul className="point-list" aria-label="Indoor zones">
                    {draft.indoorZones.map((z) => (
                      <li key={z.id}>
                        <button
                          type="button"
                          aria-label={`Select zone ${z.name}`}
                          aria-pressed={selectedZoneId === z.id}
                          onClick={() => selectZoneForEditing(z.id)}
                        >
                          <span>
                            {z.name}
                            <small>
                              {z.floors.length} {z.floors.length === 1 ? 'floor' : 'floors'}
                            </small>
                          </span>
                          <span className="chevron">›</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {zone && (
                    <>
                      <form
                        key={zone.id}
                        onSubmit={(e) => {
                          e.preventDefault();
                          const name = String(new FormData(e.currentTarget).get('name') ?? '');
                          edit((d) => renameZone(d, zone.id, name), 'Zone renamed.');
                        }}
                      >
                        <label>
                          Zone name
                          <div className="input-action">
                            <input name="name" defaultValue={zone.name} required aria-label="Zone name" />
                            <button>Rename</button>
                          </div>
                        </label>
                      </form>
                      <h3>Floors</h3>
                      {zone.floors.map((f) => (
                        <div className="list-row" key={f.z}>
                          <span>
                            Floor {f.z} · {f.label}
                          </span>
                          <button
                            type="button"
                            className="text-button danger"
                            aria-label={`Remove floor ${f.z}`}
                            onClick={() => edit((d) => removeFloor(d, zone.id, f.z), 'Floor removed.')}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const data = new FormData(e.currentTarget);
                          const z = Number(data.get('z'));
                          const label = String(data.get('label') ?? '').trim();
                          edit((d) => addFloor(d, zone.id, { z, label }), 'Floor added.');
                          e.currentTarget.reset();
                        }}
                      >
                        <label>
                          Floor index
                          <input name="z" type="number" step="1" required placeholder="e.g. 1" aria-label="Floor index" />
                        </label>
                        <label>
                          Floor label
                          <input name="label" required placeholder="e.g. Level 1" aria-label="Floor label" />
                        </label>
                        <button className="full">Add floor</button>
                      </form>
                    </>
                  )}
                </section>
                <section>
                  <span className="eyebrow">03 / PLACEMENT</span>
                  <h2>Choose where new points go</h2>
                  <p>Placement is separate from Layers above the map. Outdoor points use ground level.</p>
                  {mode === 'add-nodes' && !isNodeVisible({ zoneId: placementZoneId, z: validPlacementFloorZ }, visibility, showOutdoors) && (
                    <p className="notice">New points will be on a hidden layer. Change Layers above the map to see them.</p>
                  )}
                  <div className="placement-controls">
                    <label>
                      Placement zone
                      <select
                        aria-label="Placement zone"
                        value={placementZoneId ?? ''}
                        onChange={(e) => {
                          const nextZone = draft.indoorZones.find((item) => item.id === e.target.value) ?? null;
                          setPlacementZoneId(nextZone?.id ?? null);
                          setPlacementFloorZ(nextZone ? preferredFloor(nextZone.floors) : 0);
                          if (nextZone) setSelectedZoneId(nextZone.id);
                        }}
                      >
                        <option value="">Outdoors</option>
                        {draft.indoorZones.map((z) => (
                          <option key={z.id} value={z.id}>
                            {z.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {placementZone && (
                      <label>
                        Placement floor
                        <select
                          aria-label="Placement floor"
                          value={String(validPlacementFloorZ)}
                          onChange={(e) => setPlacementFloorZ(Number(e.target.value))}
                        >
                          {placementZone.floors.map((f) => (
                            <option key={f.z} value={f.z}>
                              Floor {f.z} · {f.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      Connection kind
                      <select
                        aria-label="Connection kind"
                        value={connectionKind}
                        onChange={(e) => setConnectionKind(e.target.value as EdgeV3['kind'] | 'auto')}
                      >
                        <option value="auto">Auto</option>
                        <option value="path">Path</option>
                        <option value="entrance">Entrance</option>
                        <option value="stairs">Stairs</option>
                        <option value="elevator">Elevator</option>
                      </select>
                    </label>
                  </div>
                </section>
                <section>
                  <div className="section-heading">
                    <h3>Path points</h3>
                    <span className="tag">{draft.nodes.length}</span>
                  </div>
                  {node && (
                    <div className="node-inspector">
                      <div className="section-heading">
                        <h3>{node.name}</h3>
                        <span className="tag">point</span>
                      </div>
                      <p className="identity-line">ID: {node.id}</p>
                      <p className="coordinates">
                        Lat {node.lat.toFixed(5)} Lng {node.lng.toFixed(5)} · Floor {node.z} · {node.zoneId ?? 'outdoors'}
                      </p>
                      <p>Fingerprint revision {node.fingerprintRevision}</p>
                      <p>Connections: {connections.length ? connections.map((c) => `${c.from} → ${c.to} (${c.kind})`).join(', ') : 'None yet.'}</p>
                      <form
                        key={node.id}
                        onSubmit={(e) => {
                          e.preventDefault();
                          submitNodeDetails(new FormData(e.currentTarget));
                        }}
                      >
                        <label>
                          Node display name
                          <input name="name" defaultValue={node.name} required aria-label="Node display name" />
                        </label>
                        <label>
                          Latitude
                          <input name="lat" type="number" step="any" defaultValue={node.lat} required aria-label="Node latitude" />
                        </label>
                        <label>
                          Longitude
                          <input name="lng" type="number" step="any" defaultValue={node.lng} required aria-label="Node longitude" />
                        </label>
                        <label>
                          Floor
                          <select name="z" defaultValue={String(node.z)} aria-label="Node floor">
                            {node.zoneId === null ? (
                              <option value="0">Outdoors · ground level</option>
                            ) : (
                              nodeZone?.floors.map((f) => (
                                <option key={f.z} value={f.z}>
                                  Floor {f.z} · {f.label}
                                </option>
                              ))
                            )}
                          </select>
                        </label>
                        <button className="full">Update point</button>
                      </form>
                      <div className="linked-place-panel">
                        <h4>Linked place</h4>
                        {node.zoneId === null ? (
                          <p className="empty-hint">Places must be assigned to an indoor point.</p>
                        ) : (
                          <form
                            key={`${nodePlace?.id ?? `new-${node.id}`}-${placeFormResetKey}`}
                            onSubmit={(e) => {
                              e.preventDefault();
                              submitPlaceDetails(new FormData(e.currentTarget));
                            }}
                          >
                            <label>
                              Place name
                              <input name="placeName" defaultValue={nodePlace?.name ?? ''} aria-label="Place name" />
                            </label>
                            {nodePlace && (
                              <label>
                                Place node
                                <select name="placeNodeId" defaultValue={nodePlace.nodeId} aria-label="Place node">
                                  {indoorPlaceNodes
                                    .filter((n) => n.id === nodePlace.nodeId || !draft.places.some((p) => p.nodeId === n.id))
                                    .map((n) => (
                                      <option key={n.id} value={n.id}>
                                        {n.name} · {n.id}
                                      </option>
                                    ))}
                                </select>
                              </label>
                            )}
                            <div className="button-row">
                              <button type="submit">{nodePlace ? 'Update place' : 'Create place'}</button>
                              {nodePlace && (
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() => edit((d) => removePlace(d, nodePlace.id), 'Place deleted.')}
                                >
                                  Delete place
                                </button>
                              )}
                            </div>
                          </form>
                        )}
                      </div>
                      <div className="button-row">
                        <button
                          type="button"
                          onClick={() => {
                            if (from === node.id) {
                              setFrom('');
                              setMode('navigate');
                            } else {
                              setFrom(node.id);
                              setMode('connect');
                              setPendingPath([]);
                              setStairsArmed(false);
                            }
                          }}
                        >
                          {from === node.id ? 'Cancel connect' : 'Connect'}
                        </button>
                        <button type="button" onClick={() => setMode('move')}>
                          Move
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            edit((d) => removeNode(d, node.id), 'Point deleted.');
                            setSelectedNodeId('');
                          }}
                        >
                          Delete
                        </button>
                      </div>
                      {mode === 'connect' && from && <p>Connecting from {from}. Select another point to link them.</p>}
                    </div>
                  )}
                  {!draft.nodes.length && <p className="empty-hint">No points yet. Choose Add nodes, then click inside the boundary.</p>}
                  <ul className="point-list" aria-label="Graph nodes">
                    {draft.nodes.map((n) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          aria-label={`Select ${nodeLabel(n)}`}
                          aria-pressed={selectedNodeId === n.id}
                          onClick={() => selectNode(n.id)}
                        >
                          <span className="node-dot" />
                          <span>
                            {n.name}
                            <small>
                              {n.id} · {n.zoneId ?? 'outdoors'} · floor {n.z}
                            </small>
                          </span>
                          <span className="chevron">›</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}
            {tab === 'places' && (
              <section>
                <span className="eyebrow">DESTINATIONS & STARTS</span>
                <h2>Places & QR signs</h2>
                <p>Places are searchable destinations. Select one to edit its linked point and place details.</p>
                {draft.places.length ? (
                  draft.places.map((p) => (
                    <button
                      className="place-row"
                      key={p.id}
                      aria-label={`Edit place ${p.name} on ${nodeLabel(draft.nodes.find((n) => n.id === p.nodeId) ?? { id: p.nodeId, name: p.nodeId })}`}
                      onClick={() => {
                        setSelectedNodeId(p.nodeId);
                        setTab('build');
                      }}
                    >
                      <span>
                        {p.name}
                        <small>{p.nodeId} · {p.zoneId}</small>
                      </span>
                      Edit ↗
                    </button>
                  ))
                ) : (
                  <p className="empty-hint">No places yet. Add points on the Build tab first.</p>
                )}
                <h3>QR starting points</h3>
                {draft.anchors.length ? (
                  draft.anchors.map((a) => (
                    <button
                      className="place-row"
                      key={a.id}
                      onClick={() => {
                        setSelectedNodeId(a.nodeId);
                        setTab('build');
                      }}
                    >
                      <span>
                        {a.label}
                        <small>Code: {a.id}</small>
                      </span>
                      ↗
                    </button>
                  ))
                ) : (
                  <p className="empty-hint">No QR signs yet.</p>
                )}
              </section>
            )}
            {tab === 'publish' && (
              <section>
                <span className="eyebrow">PUBLISH</span>
                <h2>Share this map</h2>
                <p>Save the draft first, then publish so visitors can use it.</p>
                {checks.length ? (
                  <ul>
                    {checks.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                ) : (
                  <p>Ready to publish: boundary drawn.</p>
                )}
                {publishIssues.length > 0 && (
                  <ul>
                    {publishIssues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                )}
                {published && <p>Published version {published.version}.</p>}
                <div className="button-row">
                  <button type="button" onClick={() => void save(false)} disabled={!!busy}>
                    Save draft
                  </button>
                  <button type="button" className="primary" onClick={() => void save(true)} disabled={!!busy}>
                    Publish
                  </button>
                </div>
              </section>
            )}
          </div>
        </aside>
      </fieldset>
      <div className={`workspace-status ${error ? 'has-error' : ''}`} role={error ? 'alert' : 'status'}>
        <span>{error ? '!' : '✓'}</span>
        <p>{error || status}</p>
        {error && (
          <button className="text-button" onClick={() => setError('')}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
