import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AUTH_CHANGED_EVENT, createMap, getCapabilities, listMaps, renameMap, type VenueSummary } from '../api-v3';
import { NewMapDialog } from './NewMapDialog';

async function loadMaps(signal?: AbortSignal) {
  const [maps, capabilities] = await Promise.all([
    listMaps(signal),
    getCapabilities(signal).catch(() => ({ mapV5AuthoringEnabled: false })),
  ]);
  return { maps, canCreate: capabilities.mapV5AuthoringEnabled };
}

export function MapPicker({ currentId, onCurrentNameChange }: { currentId: string; onCurrentNameChange?: (name: string) => void }) {
  const [maps, setMaps] = useState<VenueSummary[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const navigate = useNavigate();
  async function refresh(signal?: AbortSignal) {
    try {
      const result = await loadMaps(signal);
      if (signal?.aborted) return;
      setMaps(result.maps); setCanCreate(result.canCreate); setError('');
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Could not load maps');
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    loadMaps(controller.signal).then(({ maps: items, canCreate: allowed }) => {
      if (controller.signal.aborted) return;
      setMaps(items); setCanCreate(allowed); setError('');
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load maps');
    });
    return () => controller.abort();
  }, []);
  // Sign-in reloads only the editor's own document, so the header's admin map
  // list (and its stale 401) must refresh when auth changes.
  useEffect(() => {
    const onAuthChanged = () => { void refresh(); };
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);
  async function add(name: string, kind: 'geographic' | 'static') {
    setBusy(true);
    try { const map = await createMap(name, kind); setMaps((items) => [...items, map]); setOpen(false); navigate(`/editor/${encodeURIComponent(map.id)}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create map'); }
    finally { setBusy(false); }
  }
  const current = maps.find((map) => map.id === currentId);
  useEffect(() => { onCurrentNameChange?.(current?.name ?? ''); }, [current?.name, onCurrentNameChange]);
  async function rename() {
    setBusy(true);
    try { const updated = await renameMap(currentId, renameValue); setMaps((items) => items.map((item) => item.id === currentId ? updated : item)); setRenameOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not rename map'); }
    finally { setBusy(false); }
  }
  return <div className="map-picker">
    <label>Map <select aria-label="Select map" value={currentId} onChange={(event) => navigate(`/editor/${encodeURIComponent(event.target.value)}`)}>
      {!maps.some((map) => map.id === 'demo') && <option value="demo">Demo</option>}
      {maps.map((map) => <option key={map.id} value={map.id}>{map.name}</option>)}
    </select></label>
    <button type="button" onClick={() => void refresh()}>Refresh maps</button>
    <button type="button" disabled={!canCreate} title={!canCreate ? 'V5 map authoring is disabled by the server.' : undefined} onClick={() => setOpen(true)}>New map</button>
    {current && <><span className="current-map-name">{current.name}</span><button type="button" onClick={() => { setRenameValue(current.name); setRenameOpen(true); }}>Rename map</button></>}
    {error && <span role="alert">{error} <button type="button" onClick={() => void refresh()}>Retry</button></span>}
    {open && <NewMapDialog busy={busy} onCreate={(name, kind) => void add(name, kind)} onCancel={() => setOpen(false)} />}
    {renameOpen && <div className="map-picker-dialog" role="dialog" aria-modal="true" aria-label="Rename map" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); setRenameOpen(false); }
    }}><h2>Rename map</h2>
      <label>Map name<input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus /></label>
      <button type="button" disabled={busy || !renameValue.trim()} onClick={() => void rename()}>Save name</button>
      <button type="button" disabled={busy} onClick={() => setRenameOpen(false)}>Cancel</button>
    </div>}
  </div>;
}
