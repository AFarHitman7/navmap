// useEditorDocument: React binding for the transaction history (Task 3).
//
// The hook owns every document mutation: components commit whole-document
// transactions and never call setDraft-style setters directly. Loading and
// map switching use reset(); server save acknowledgements use markSaved(),
// which records lastSaved without touching the local snapshot or history.
import { useCallback, useRef, useState } from 'react';
import {
  canRedo as canRedoState,
  canUndo as canUndoState,
  commitEdit,
  createHistory,
  isDirty,
  redoEdit,
  undoEdit,
  type AnyDraft,
  type HistoryState,
} from './history';

export interface EditorDocument<T extends AnyDraft = AnyDraft> {
  document: T;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Commit one transaction; false only when the updater throws. No-ops record nothing. */
  commit: (label: string, next: T | ((prev: T) => T)) => boolean;
  undo: () => boolean;
  redo: () => boolean;
  /** Record a server save without overwriting newer local edits or history. */
  markSaved: (saved: T) => void;
  /** Fresh session history for a newly loaded map. */
  reset: (next: T) => void;
}

export function useEditorDocument<T extends AnyDraft>(initial: T): EditorDocument<T> {
  const [state, setState] = useState<HistoryState<T>>(() => createHistory(initial));
  // Synchronous mirror so commit/undo/redo can report success immediately and
  // always read the latest snapshot, even for back-to-back calls in one tick.
  // Written only from stable callbacks below, never during render.
  const ref = useRef<HistoryState<T>>(state);
  const sync = useCallback((next: HistoryState<T>) => {
    ref.current = next;
    setState(next);
  }, []);

  const commit = useCallback(
    (label: string, next: T | ((prev: T) => T)) => {
      let resolved: T;
      try {
        resolved = typeof next === 'function' ? (next as (prev: T) => T)(ref.current.present) : next;
      } catch {
        return false;
      }
      sync(commitEdit(ref.current, resolved, label));
      return true;
    },
    [sync],
  );

  const undo = useCallback(() => {
    if (!canUndoState(ref.current)) return false;
    sync(undoEdit(ref.current));
    return true;
  }, [sync]);

  const redo = useCallback(() => {
    if (!canRedoState(ref.current)) return false;
    sync(redoEdit(ref.current));
    return true;
  }, [sync]);

  const markSaved = useCallback(
    (saved: T) => {
      sync({ ...ref.current, lastSaved: saved });
    },
    [sync],
  );

  const reset = useCallback(
    (next: T) => {
      sync(createHistory(next));
    },
    [sync],
  );

  return {
    document: state.present,
    dirty: isDirty(state),
    canUndo: canUndoState(state),
    canRedo: canRedoState(state),
    commit,
    undo,
    redo,
    markSaved,
    reset,
  };
}
