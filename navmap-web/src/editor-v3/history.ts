// Transaction history for map-authoring documents (Task 3).
//
// One generic implementation serves both the live V4 editor (DraftV3) and V5
// frame-aware drafts (MapDraft), so the later CanvasHost migration can reuse
// it unchanged. Snapshots are whole immutable documents; pending tool
// geometry (unfinished path corners, selection, pan/zoom) is never recorded.
//
// Fingerprint revisions are monotonic session tokens, not reversible fields:
// undoing or redoing a geometry change advances the affected nodes past every
// revision seen so far, so remotely stale Wi-Fi samples can never become
// current again. Renames and visibility toggles keep their revisions, and a
// geometry undone before saving stays dirty because its revision changed.
import type { DraftV3 } from '../contract-v3';
import type { MapDraft } from '../map-contract';

export type AnyDraft = DraftV3 | MapDraft;

export const MAX_HISTORY = 100;

export interface HistoryEntry<T extends AnyDraft = AnyDraft> {
  doc: T;
  label: string;
}

export interface HistoryState<T extends AnyDraft = AnyDraft> {
  past: HistoryEntry<T>[];
  present: T;
  future: HistoryEntry<T>[];
  lastSaved: T;
  /** Per-node revision high-water marks; durable across deletion/restore. */
  highWater: Record<string, number>;
}

type DocNode = {
  id: string;
  fingerprintRevision: number;
  lat?: number;
  lng?: number;
  frameId?: string;
  position?: unknown;
  zoneId?: string | null;
  z?: number;
};

function nodeList(doc: AnyDraft): DocNode[] {
  const nodes = (doc as { nodes?: DocNode[] }).nodes;
  return Array.isArray(nodes) ? nodes : [];
}

function mergeHighWater(highWater: Record<string, number>, doc: AnyDraft): Record<string, number> {
  const next: Record<string, number> = { ...highWater };
  for (const node of nodeList(doc)) {
    if (typeof node.id === 'string' && Number.isInteger(node.fingerprintRevision)) {
      next[node.id] = Math.max(next[node.id] ?? Number.NEGATIVE_INFINITY, node.fingerprintRevision);
    }
  }
  return next;
}

export function createHistory<T extends AnyDraft>(document: T): HistoryState<T> {
  return { past: [], present: document, future: [], lastSaved: document, highWater: mergeHighWater({}, document) };
}

export function sameDocument(a: AnyDraft, b: AnyDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isDirty<T extends AnyDraft>(state: HistoryState<T>): boolean {
  return !sameDocument(state.present, state.lastSaved);
}

export function canUndo<T extends AnyDraft>(state: HistoryState<T>): boolean {
  return state.past.length > 0;
}

export function canRedo<T extends AnyDraft>(state: HistoryState<T>): boolean {
  return state.future.length > 0;
}

export function commitEdit<T extends AnyDraft>(state: HistoryState<T>, next: T, label: string): HistoryState<T> {
  if (sameDocument(next, state.present)) return state;
  const past = [...state.past, { doc: state.present, label }];
  while (past.length > MAX_HISTORY) past.shift();
  return { past, present: next, future: [], lastSaved: state.lastSaved, highWater: mergeHighWater(state.highWater, next) };
}

/** Comparable geometry identity for one node (V4 lat/lng or V5 frame/position). */
function geometryKey(doc: AnyDraft, node: DocNode): string {
  if ((doc as { schemaVersion?: number }).schemaVersion === 5) {
    return JSON.stringify([node.frameId ?? null, node.position ?? null, node.zoneId ?? null, node.z ?? null]);
  }
  return JSON.stringify([node.lat ?? null, node.lng ?? null, node.zoneId ?? null, node.z ?? null]);
}

function frameSignature(frame: { background?: unknown; calibration?: unknown }): string {
  return JSON.stringify([frame.background ?? null, frame.calibration ?? null]);
}

/**
 * Frames whose background or calibration changed between two V5 snapshots.
 * Every node in such a frame is conservatively treated as geometry-changed,
 * because its surveyed coordinates may no longer mean the same thing.
 */
function changedFrameIds(from: AnyDraft, to: AnyDraft): Set<string> {
  const changed = new Set<string>();
  if ((from as { schemaVersion?: number }).schemaVersion !== 5 || (to as { schemaVersion?: number }).schemaVersion !== 5) {
    return changed;
  }
  const fromFrames = new Map(
    (((from as MapDraft).frames ?? []) as Array<{ id: string; background?: unknown; calibration?: unknown }>).map((f) => [f.id, frameSignature(f)]),
  );
  for (const frame of ((to as MapDraft).frames ?? []) as Array<{ id: string; background?: unknown; calibration?: unknown }>) {
    const before = fromFrames.get(frame.id);
    if (before !== undefined && before !== frameSignature(frame)) changed.add(frame.id);
  }
  return changed;
}

/**
 * Apply monotonic revision rules when stepping from one snapshot to another
 * via undo/redo. Geometry changes, frame background/calibration changes, and
 * node restorations advance past the high-water mark; renames and visibility
 * toggles keep their revisions untouched.
 */
function stepDoc<T extends AnyDraft>(from: T, to: T, highWater: Record<string, number>): T {
  const fromNodes = new Map(nodeList(from).map((n) => [n.id, n]));
  const invalidFrames = changedFrameIds(from, to);
  let touched = false;
  const nodes = nodeList(to).map((node) => {
    const before = fromNodes.get(node.id);
    if (!before) {
      // Restored (or genuinely new) node: never reuse a stale revision.
      // Never restore an old sample identity solely because geometry was undone.
      const rev = Math.max(node.fingerprintRevision, highWater[node.id] ?? node.fingerprintRevision) + 1;
      touched = true;
      return { ...node, fingerprintRevision: rev };
    }
    const geometryChanged = geometryKey(from, before) !== geometryKey(to, node);
    const frameInvalidated = node.frameId !== undefined && invalidFrames.has(node.frameId);
    if (!geometryChanged && !frameInvalidated) return node;
    const rev = Math.max(before.fingerprintRevision, highWater[node.id] ?? before.fingerprintRevision, node.fingerprintRevision) + 1;
    touched = true;
    return { ...node, fingerprintRevision: rev };
  });
  if (!touched) return to;
  return { ...to, nodes } as T;
}

export function undoEdit<T extends AnyDraft>(state: HistoryState<T>): HistoryState<T> {
  const target = state.past[state.past.length - 1];
  if (!target) return state;
  const present = stepDoc(state.present, target.doc, state.highWater);
  return {
    past: state.past.slice(0, -1),
    present,
    future: [{ doc: state.present, label: target.label }, ...state.future],
    lastSaved: state.lastSaved,
    highWater: mergeHighWater(state.highWater, present),
  };
}

export function redoEdit<T extends AnyDraft>(state: HistoryState<T>): HistoryState<T> {
  const target = state.future[0];
  if (!target) return state;
  const present = stepDoc(state.present, target.doc, state.highWater);
  return {
    past: [...state.past, { doc: state.present, label: target.label }],
    present,
    future: state.future.slice(1),
    lastSaved: state.lastSaved,
    highWater: mergeHighWater(state.highWater, present),
  };
}
