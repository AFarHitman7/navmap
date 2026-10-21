import { useState } from 'react';

export function NewMapDialog({ busy, onCreate, onCancel }: {
  busy: boolean;
  onCreate: (name: string, kind: 'geographic' | 'static') => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'geographic' | 'static'>('geographic');
  return <div className="map-picker-dialog" role="dialog" aria-modal="true" aria-label="New map" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
  }}><h2>New map</h2>
    <label>Map name<input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label>
    <label>Canvas type<select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="geographic">Geographic</option><option value="static">Static floor plan</option></select></label>
    <button type="button" disabled={busy || !name.trim()} onClick={() => onCreate(name.trim(), kind)}>Create map</button>
    <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
  </div>;
}
