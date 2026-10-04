import { useEffect, useRef } from 'react';

export function UnsavedChangesDialog({
  open,
  busy,
  onSave,
  onDiscard,
  onCancel,
}: {
  open: boolean;
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const saveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) saveRef.current?.focus();
  }, [open ]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Unsaved changes">
      <h2>Unsaved changes</h2>
      <p>Save your changes before leaving this map?</p>
      <button ref={saveRef} type="button" onClick={onSave} disabled={busy}>
        Save changes
      </button>
      <button type="button" onClick={onDiscard} disabled={busy}>
        Discard changes
      </button>
      <button type="button" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </div>
  );
}
