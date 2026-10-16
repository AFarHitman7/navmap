import { describe, expect, it } from 'vitest';
import { resolveEditorRoute } from '../src/editor-route';

describe('resolveEditorRoute', () => {
  it('routes V4 drafts to the legacy rollback editor even when V5 authoring is enabled', () => {
    expect(resolveEditorRoute(4)).toBe('legacy');
  });

  it('routes V5 drafts to the V5 editor', () => {
    expect(resolveEditorRoute(5)).toBe('v5');
  });
});
