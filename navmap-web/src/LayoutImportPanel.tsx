import { useEffect, useRef, useState } from 'react';
import type { MapDraft, MapFrame } from './map-contract';
import { assignBackground, calibrateFrame } from './editor-v3/model';
import { uploadLayout } from './layout-api';
import type { LayoutSource } from './pdf-import';

type Commit = (label: string, next: MapDraft | ((previous: MapDraft) => MapDraft)) => boolean;

export interface LayoutImportPanelProps {
  venueId: string;
  draft: MapDraft;
  commit: Commit;
}

export function LayoutImportPanel(props: LayoutImportPanelProps) {
  const identity = JSON.stringify([props.venueId, props.draft.venueId]);
  return <LayoutImportPanelSession key={identity} {...props} />;
}

function frameLabel(frame: MapFrame, draft: MapDraft): string {
  const zone = frame.zoneId ? draft.indoorZones.find((item) => item.id === frame.zoneId) : undefined;
  const floor = zone?.floors.find((item) => item.z === frame.z)?.label;
  const fallback = frame.z < 0 ? `Basement ${Math.abs(frame.z)}` : frame.z === 0 ? 'Ground' : `Floor ${frame.z}`;
  return `${zone?.name ?? 'Outdoor'} · ${floor ?? fallback}`;
}

function LayoutImportPanelSession({ venueId, draft, commit }: LayoutImportPanelProps) {
  const [source, setSource] = useState<LayoutSource | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [page, setPage] = useState(1);
  const [frameId, setFrameId] = useState(draft.frames.find((frame) => !frame.background)?.id ?? draft.frames[0]?.id ?? '');
  const [preview, setPreview] = useState<Blob | null>(null);
  const [previewFrameId, setPreviewFrameId] = useState('');
  const [calibration, setCalibration] = useState({ ax: '', ay: '', bx: '', by: '', meters: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [replacePending, setReplacePending] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const sourceRef = useRef<LayoutSource | null>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!preview || !previewImageRef.current) return;
    const url = URL.createObjectURL(preview);
    previewImageRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  useEffect(() => () => {
    controllerRef.current?.abort();
    void sourceRef.current?.close();
  }, []);

  async function showPage(nextSource: LayoutSource, pageNumber: number, signal: AbortSignal) {
    const blob = await nextSource.renderPage(pageNumber);
    if (signal.aborted) throw new DOMException('Layout import cancelled', 'AbortError');
    setPreview(blob);
  }

  async function chooseFile(file?: File) {
    if (!file) return;
    controllerRef.current?.abort();
    await sourceRef.current?.close();
    sourceRef.current = null;
    setSource(null);
    setPreview(null);
    setPreviewFrameId('');
    setError('');
    setReplacePending(false);
    setBusy(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const { readLayoutSource } = await import('./pdf-import');
      const nextSource = await readLayoutSource(file, controller.signal);
      sourceRef.current = nextSource;
      setSource(nextSource);
      setSourceName(file.name);
      setPage(1);
      await showPage(nextSource, 1, controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not read this layout');
    } finally {
      if (controllerRef.current === controller) setBusy(false);
    }
  }

  async function selectPage(value: number) {
    if (!source || busy) return;
    setReplacePending(false);
    setPage(value);
    setPreview(null);
    setPreviewFrameId('');
    setError('');
    setBusy(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await showPage(source, value, controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not preview this page');
    } finally {
      if (controllerRef.current === controller) setBusy(false);
    }
  }

  async function assignSelectedPage() {
    const target = draft.frames.find((frame) => frame.id === frameId);
    if (!target || !source || !preview || busy) return;
    const sourceDraft = draft;
    if (target.background && !replacePending) {
      setReplacePending(true);
      return;
    }
    setReplacePending(false);
    setError('');
    setBusy(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      // Conversion and transport complete before the history transaction. A
      // failed or cancelled request never mutates the user's draft.
      const asset = await uploadLayout(venueId, preview, controller.signal);
      if (controller.signal.aborted) return;
      const committed = commit(target.background ? 'Replace floor background' : 'Assign floor background',
        (current) => {
          if (controller.signal.aborted || current !== sourceDraft || current.venueId !== venueId || sourceDraft.venueId !== venueId) {
            throw new Error('The active map or draft changed during the upload');
          }
          return assignBackground(current, target.id, asset);
        });
      if (!committed) setError('The active map or draft changed during upload. The image was uploaded but not assigned; review the map and retry.');
      else setPreviewFrameId(target.id);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not assign this layout');
    } finally {
      if (controllerRef.current === controller) setBusy(false);
    }
  }

  function cancel() {
    controllerRef.current?.abort();
    void sourceRef.current?.close();
    sourceRef.current = null;
    setSource(null);
    setPreview(null);
    setPreviewFrameId('');
    setBusy(false);
    setReplacePending(false);
  }

  const activeFrameId = draft.frames.find((frame) => frame.id === frameId)?.id ??
    draft.frames.find((frame) => !frame.background)?.id ?? draft.frames[0]?.id ?? '';
  const selectedFrame = draft.frames.find((frame) => frame.id === activeFrameId);
  const previewIsAssigned = previewFrameId === frameId && Boolean(selectedFrame?.background);
  function saveCalibration() {
    if (!selectedFrame || !previewIsAssigned) return;
    setError('');
    try {
      const next = calibrateFrame(draft, selectedFrame.id,
        { x: Number(calibration.ax), y: Number(calibration.ay) },
        { x: Number(calibration.bx), y: Number(calibration.by) }, Number(calibration.meters));
      if (!commit('Calibrate floor scale', next)) setError('Scale could not be saved. Your map was not changed.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not calibrate this floor');
    }
  }
  return (
    <section className="layout-import-panel" aria-labelledby="layout-import-title">
      <div className="layout-import-heading">
        <div>
          <p className="layout-import-kicker">Static map · floor artwork</p>
          <h2 id="layout-import-title">Add a floor plan</h2>
          <p>Import PNG or PDF pages. PDFs are converted here; only PNG images are uploaded.</p>
        </div>
        {busy && <button type="button" className="layout-import-cancel" onClick={cancel}>Cancel</button>}
      </div>

      <label className="layout-import-file">
        <span>Choose a PNG or PDF</span>
        <input
          type="file"
          accept="image/png,application/pdf,.png,.pdf"
          aria-label="Choose a PNG or PDF"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            void chooseFile(file);
          }}
        />
      </label>
      <p className="layout-import-limits">Up to 20 MiB · PDFs up to 20 pages · images up to 4096 px per side</p>
      {draft.frames.length === 0 && <p className="layout-import-incomplete" role="status">Add a floor before assigning a layout.</p>}

      {source && <div className="layout-import-controls">
        <p className="layout-import-filename" title={sourceName}>{sourceName} <span>{source.pages} {source.pages === 1 ? 'page' : 'pages'}</span></p>
        {source.pages > 1 && <label>
          PDF page
          <select aria-label="PDF page" value={page} disabled={busy} onChange={(event) => void selectPage(Number(event.currentTarget.value))}>
            {Array.from({ length: source.pages }, (_, index) => <option key={index + 1} value={index + 1}>Page {index + 1}</option>)}
          </select>
        </label>}
        <label>
          Assign to floor
          <select aria-label="Assign to floor" value={activeFrameId} disabled={busy || draft.frames.length === 0}
            onChange={(event) => {
              setFrameId(event.currentTarget.value);
              setReplacePending(false);
            }}>
            {draft.frames.map((frame) => <option key={frame.id} value={frame.id}>{frameLabel(frame, draft)}{frame.background ? ' · has plan' : ' · no plan'}</option>)}
          </select>
        </label>
      </div>}

      {preview && <figure className="layout-import-preview">
        <img ref={previewImageRef} alt={`Preview of ${sourceName}${source && source.pages > 1 ? `, page ${page}` : ''}`} />
        <figcaption>{source && source.pages > 1 ? `Page ${page} of ${source.pages}` : sourceName} · fit to preview, no cropping</figcaption>
      </figure>}

      {previewIsAssigned && selectedFrame && <section className="layout-import-calibration" aria-labelledby="layout-calibration-title">
        <div>
          <h3 id="layout-calibration-title">Set floor scale</h3>
          <p>Enter two positions on this plan as normalized coordinates (0–1), then their real-world distance.</p>
        </div>
        <div className="layout-calibration-coordinates">
          {(['ax', 'ay', 'bx', 'by'] as const).map((key) => <label key={key}>
            Point {key[0]!.toUpperCase()} · {key[1]}
            <input type="number" min="0" max="1" step="0.001" inputMode="decimal" value={calibration[key]}
              aria-label={`Point ${key[0]!.toUpperCase()} ${key[1]}`}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setCalibration((previous) => ({ ...previous, [key]: value }));
              }} />
          </label>)}
        </div>
        <label className="layout-calibration-distance">Known distance, metres
          <input type="number" min="0.001" step="any" inputMode="decimal" value={calibration.meters}
            aria-label="Known distance, metres"
            onChange={(event) => {
              const value = event.currentTarget.value;
              setCalibration((previous) => ({ ...previous, meters: value }));
            }} />
        </label>
        <button type="button" disabled={busy} onClick={saveCalibration}>
          {selectedFrame.calibration ? 'Update floor scale' : 'Save floor scale'}
        </button>
        {selectedFrame.calibration && <p className="layout-import-status">Calibrated · {selectedFrame.calibration.metersPerPixel.toPrecision(3)} metres per pixel</p>}
      </section>}

      {replacePending && selectedFrame && <div className="layout-import-confirm" role="alertdialog" aria-labelledby="replace-layout-title" aria-describedby="replace-layout-description">
        <p id="replace-layout-title">Replace the plan for {frameLabel(selectedFrame, draft)}?</p>
        <p id="replace-layout-description">Placed points keep their normalized positions. The old scale is cleared and surveys for this floor are marked outdated.</p>
        <button type="button" autoFocus disabled={busy} onClick={() => void assignSelectedPage()}>Replace background</button>
        <button type="button" disabled={busy} onClick={() => setReplacePending(false)}>Keep current plan</button>
      </div>}

      {error && <p className="layout-import-error" role="alert">{error}</p>}
      {busy && <p className="layout-import-status" role="status">Preparing floor plan…</p>}
      {source && !replacePending && <button type="button" className="layout-import-assign" disabled={busy || !selectedFrame || !preview}
        onClick={() => void assignSelectedPage()}>
        {selectedFrame?.background ? 'Replace floor background' : 'Assign page to floor'}
      </button>}
      {draft.frames.some((frame) => !frame.background) && <p className="layout-import-incomplete">Some floors still need a background before points can be placed.</p>}
      {draft.frames.map((frame) => <span className="layout-import-frame-state" key={frame.id}>
        {frameLabel(frame, draft)}: {frame.background ? 'plan assigned' : 'no plan assigned'}{frame.background && !frame.calibration ? ' · not calibrated' : ''}
      </span>)}
    </section>
  );
}
