import path from 'node:path';
import { LAYOUT_ASSET_ID_RE } from './layout-assets.js';
import { normalizeVenueId } from './venue-id.js';

export function versionDir(dataDir: string, venueId: string, version: number): string {
  normalizeVenueId(venueId);
  if (!Number.isInteger(version) || version <= 0) throw new Error('unknown version');
  return path.join(dataDir, 'versions', venueId, String(version));
}

/** Application-owned immutable asset path inside a published version. */
export function versionAssetPath(dataDir: string, venueId: string, version: number, assetId: string): string {
  if (!LAYOUT_ASSET_ID_RE.test(assetId)) throw new Error('unknown version asset');
  return path.join(versionDir(dataDir, venueId, version), 'assets', `${assetId}.png`);
}
