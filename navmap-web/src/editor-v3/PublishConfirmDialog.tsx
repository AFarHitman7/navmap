import { useEffect, useRef } from 'react';

/**
 * Confirms the one irreversible editor action. Publishing creates an immutable
 * visitor version, so it is never a single accidental click. Escape cancels and
 * focus lands on the confirm button when the dialog opens.
 */
export function PublishConfirmDialog({
  open,
  busy,
  dirty,
  summary,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  busy: boolean;
  dirty: boolean;
  summary: { nodes: number; transitions: number; places: number };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) confirmRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);
  if (!open) return null;
  return <div className="v5-confirm-backdrop">
    <div className="v5-confirm-dialog" role="dialog" aria-modal="true" aria-label="Publish map">
      <h2>Publish this map?</h2>
      <p>This creates a new immutable version that visitors will see{dirty ? ' and saves your unsaved changes first' : ''}.</p>
      <ul className="v5-publish-summary"><li>{summary.nodes} map nodes</li><li>{summary.transitions} connections</li><li>{summary.places} visitor places</li></ul>
      <div className="v5-confirm-actions">
        <button ref={confirmRef} type="button" className="primary" disabled={busy} onClick={onConfirm}>Publish map</button>
        <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  </div>;
}
