import path from 'node:path';
import { normalizeVenueId } from './venue-id.js';

export function versionDir(dataDir: string, venueId: string, version: number): string {
  normalizeVenueId(venueId);
  if (!Number.isInteger(version) || version <= 0) throw new Error('unknown version');
  return path.join(dataDir, 'versions', venueId, String(version));
}
