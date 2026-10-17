import { useState, type FormEvent } from 'react';
import type { Rect } from '../../map-contract';
import { setBoundaryV5 } from '../model';
import type { InspectorProps } from './shared';
import { ErrorMessage } from './shared';

export function BoundaryInspector(props: InspectorProps) {
  const boundary = props.document.boundary ?? (props.document.canvas.kind === 'static'
    ? { kind: 'local' as const, left: 0, top: 0, right: 1, bottom: 1 }
    : { kind: 'geographic' as const, north: 0, south: 0, east: 0, west: 0 });
  const fields = boundary.kind === 'geographic' ? ['north', 'south', 'east', 'west'] : ['left', 'top', 'right', 'bottom'];
  const key = `${boundary.kind}:${fields.map((field) => (boundary as unknown as Record<string, unknown>)[field]).join(':')}`;
  return <BoundaryForm key={key} {...props} boundary={boundary} fields={fields} />;
}

function BoundaryForm({ document, commit, busy, activeFrameId, boundary, fields }: InspectorProps & { boundary: Rect; fields: string[] }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(boundary).filter(([key]) => key !== 'kind').map(([key, value]) => [key, String(value)])));
  const [error, setError] = useState('');
  function save(event: FormEvent) {
    event.preventDefault();
    const next = { kind: boundary.kind, ...Object.fromEntries(fields.map((field) => [field, Number(values[field])])) } as Rect;
    try {
      if (!commit('Update map boundary', (draft) => setBoundaryV5(draft, next))) setError('Boundary was not changed.');
      else setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Boundary was not changed.'); }
  }
  return <section className="v5-inspector-form" aria-labelledby="boundary-inspector-title">
    <p className="v5-context-kicker">{document.canvas.kind === 'static' ? 'Static map · frame extent' : 'Geographic map · map extent'}</p>
    <h2 id="boundary-inspector-title">Boundary</h2>
    <p>{document.canvas.kind === 'static' ? 'Local coordinates span the floor-plan frame. Static maps do not use OSM tiles or GPS.' : 'Set the geographic map extent. OSM provides the background tiles; GPS is not used for authoring.'}</p>
    <form onSubmit={save}>
      <div className="v5-coordinate-grid">{fields.map((field) => <label key={field}>{field[0]!.toUpperCase() + field.slice(1)}
        <input type="number" step="any" required value={values[field] ?? ''} aria-label={field[0]!.toUpperCase() + field.slice(1)}
          disabled={busy} onChange={(event) => setValues((current) => ({ ...current, [field]: event.currentTarget.value }))} />
      </label>)}</div>
      <button className="primary" type="submit" disabled={busy}>Save boundary</button>
    </form>
    <p className="v5-inspector-meta">Active frame: {document.frames.find((item) => item.id === activeFrameId)?.zoneId ?? 'Outdoor'}</p>
    <ErrorMessage error={error} />
  </section>;
}
