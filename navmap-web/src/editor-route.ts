/**
 * The stored draft version decides the editor. A V4 draft always opens the
 * legacy rollback editor — even when V5 authoring is enabled — so saved V4
 * maps stay readable and editable across reloads and sign-ins. V5 drafts
 * open the V5 editor, which gates writes on the server capability flag
 * itself and renders read-only while the flag is off.
 */
export function resolveEditorRoute(draftVersion: 4 | 5): 'v5' | 'legacy' {
  return draftVersion === 5 ? 'v5' : 'legacy';
}
