import type { EdgeV3, PathV3 } from '../contract-v3';
import type { PathVertex } from './paths';

type Props = {
  mode: string;
  vertices: PathVertex[];
  selectedPath?: PathV3 | null;
  paths?: PathV3[];
  selectedConnection?: EdgeV3 | null;
  stairsArmed: boolean;
  busy: boolean;
  onFinish: () => void;
  onCancel: () => void;
  onArmStairs: () => void;
  onDeletePath: () => void;
  onSelectPath?: (id: string) => void;
  onDeleteConnection: () => void;
};

export function PathControls({
  mode,
  vertices,
  selectedPath,
  paths = [],
  selectedConnection,
  stairsArmed,
  busy,
  onFinish,
  onCancel,
  onArmStairs,
  onDeletePath,
  onSelectPath,
  onDeleteConnection,
}: Props) {
  return (
    <section>
      <span className="eyebrow">04 / NAVIGABLE PATHS</span>
      <h2>Draw visitor routes</h2>
      <p>Click existing landings or map corners, then Finish. Cancel leaves the saved graph unchanged.</p>
      <div className="draw-actions path-actions">
        <button type="button" disabled={busy || vertices.length < 2 || stairsArmed} onClick={onFinish}>
          Finish path
        </button>
        <button type="button" disabled={busy || (mode !== 'draw-path' && vertices.length === 0)} onClick={onCancel}>
          Cancel path
        </button>
      </div>
      {mode === 'draw-path' && (
        <div className="path-draft-panel">
          <p>Pending vertices: {vertices.length}</p>
          <button type="button" disabled={busy || vertices.length < 1} aria-pressed={stairsArmed} onClick={onArmStairs}>
            Link next landing as stairs
          </button>
          {stairsArmed && <p className="notice">Select a landing on another floor in the same building.</p>}
        </div>
      )}
      <div className="path-selection-panel">
        {paths.length > 0 && (
          <ul className="point-list" aria-label="Drawn routes">
            {paths.map((path) => (
              <li key={path.id}>
                <button type="button" aria-label={`Select route ${path.name}`} aria-pressed={selectedPath?.id === path.id} onClick={() => onSelectPath?.(path.id)}>
                  <span>{path.name}<small>{path.nodeIds.length} route points</small></span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p>{selectedPath ? `${selectedPath.name} · ${selectedPath.nodeIds.length} route points` : 'No drawn route selected.'}</p>
        <button type="button" className="danger" disabled={busy || !selectedPath} onClick={onDeletePath}>
          Delete path
        </button>
      </div>
      <div className="path-selection-panel">
        <p>
          {selectedConnection
            ? `Selected connection ${selectedConnection.from} → ${selectedConnection.to} (${selectedConnection.kind})`
            : 'No legacy connection selected.'}
        </p>
        <button type="button" className="danger" disabled={busy || !selectedConnection} onClick={onDeleteConnection}>
          Delete connection
        </button>
      </div>
    </section>
  );
}
