import type { ManifestV3 } from './contract-v3';

/** Resolve navmap://anchor/<venue>/<version>/<anchor> against a saved pack. */
export function parseAnchorUrl(
  url: string,
  manifest: ManifestV3,
): { nodeId: string; version: number } | null {
  const m = /^navmap:\/\/anchor\/([^/]+)\/(\d+)\/([^/]+)$/.exec(url.trim());
  if (!m) return null;
  const [, venue, versionStr, anchorId] = m;
  const version = Number(versionStr);
  if (venue !== manifest.venueId || version !== manifest.version) return null;
  const anchor = manifest.anchors.find((a) => a.id === anchorId);
  if (!anchor) return null;
  return { nodeId: anchor.nodeId, version };
}

/**
 * Cold-start + resumed link handling. A repeated delivery of the same URL is
 * ignored (returns null) until a new QR/manual start is requested.
 */
export function handleAnchorUrl(
  url: string,
  active: ManifestV3,
  lastHandledUrl: string | null,
): { nodeId: string } | null {
  if (url === lastHandledUrl) return null;
  const parsed = parseAnchorUrl(url, active);
  if (!parsed) return null;
  return { nodeId: parsed.nodeId };
}
