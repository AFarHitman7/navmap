import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { manifestV3Schema, parseManifestV3 } from '../src/draft.js';

describe('v3 manifest', () => {
  it('parses the unified-v3 fixture as a manifest with version and profiles', () => {
    const raw = JSON.parse(fs.readFileSync(new URL('../fixtures/unified-v3.json', import.meta.url), 'utf8'));
    const m = parseManifestV3({ ...raw, version: 1, profiles: [] });
    expect(m.schemaVersion).toBe(4);
    expect(m.version).toBe(1);
    expect(m.boundary).toBeTruthy();
  });

  it('the V3-named manifest schema accepts only schemaVersion 4', () => {
    const raw = JSON.parse(fs.readFileSync(new URL('../fixtures/unified-v3.json', import.meta.url), 'utf8'));
    const m = manifestV3Schema.parse({ ...raw, version: 2, profiles: [] });
    expect(m.schemaVersion).toBe(4);
  });
});
