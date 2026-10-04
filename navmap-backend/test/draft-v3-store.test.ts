import { describe, expect, it } from 'vitest';
import { createDbForTest, discardDb } from './helpers.js';
import {
  loadDraftV3Json,
  parseDraftV3,
} from '../src/draft.js';

describe('drafts_v3 store', () => {
  it('seeds a blank V4 draft in the drafts_v3 store', () => {
    const db = createDbForTest();
    try {
      const raw = loadDraftV3Json(db, 'demo')!;
      const d = parseDraftV3(JSON.parse(raw));
      expect(d.schemaVersion).toBe(4);
      expect(d.boundary).toBeNull();
    } finally {
      discardDb(db);
    }
  });
});
