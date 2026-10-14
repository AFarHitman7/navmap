import { detectContractKind, parseManifestV3, type ManifestV3 } from './contract-v3';
import { parseMapManifest, type MapManifest } from './map-contract';
import { apiBaseUrl } from './config';

export type PackAdapter = {
  getJson: (url: string) => Promise<unknown>;
  rename: (from: string, to: string) => Promise<void>;
  writeFile: (path: string, data: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
  rmrf: (path: string) => Promise<void>;
};

/** Offline pack manifest: legacy V4 or frame-aware V5 (never mixed). */
export type AnyManifest = ManifestV3 | MapManifest;

export function isV5Manifest(manifest: AnyManifest): manifest is MapManifest {
  return (manifest as MapManifest).schemaVersion === 5;
}

/**
 * Native pack reader: V4 packs keep the legacy parse; V5 packs validate
 * against the frame-aware contract. V4 bytes are never upgraded on disk.
 */
export function parsePackManifest(raw: unknown): AnyManifest {
  if (detectContractKind(raw) === 'v5') return parseMapManifest(raw);
  return parseManifestV3(raw);
}

export function apiBase(): string { return apiBaseUrl(); }
export function packDir(venueId: string, version: number): string { return `packs/${venueId}/${version}`; }
export async function downloadPack(
  venueId: string,
  version: number,
  adapter: PackAdapter,
  base: string = apiBase(),
): Promise<AnyManifest> {
  const latest = (await adapter.getJson(`${base}/api/venues/${venueId}/latest`)) as { version?: unknown };
  const target = version || latest.version;
  if (typeof target !== 'number' || !Number.isInteger(target) || target < 1) throw new Error('Server returned an invalid V3 version');
  const raw = await adapter.getJson(`${base}/api/venues/${venueId}/versions/${target}/manifest`);
  const manifest = parsePackManifest(raw);
  if (manifest.venueId !== venueId || manifest.version !== target) throw new Error('Server returned the wrong V3 pack');

  const staging = `packs/${venueId}/${target}.staging`;
  const final = packDir(venueId, target);
  try {
    await adapter.writeFile(`${staging}/manifest.json`, JSON.stringify(manifest));
    await adapter.rename(staging, final);
    await adapter.writeFile(`packs/${venueId}/active.json`, JSON.stringify({ activeVersion: target }));
  } catch (err) {
    await adapter.rmrf(staging).catch(() => undefined);
    throw err;
  }
  return manifest;
}

export async function loadActivePack(
  venueId: string,
  adapter: Pick<PackAdapter, 'readFile'> & Partial<Pick<PackAdapter, 'rmrf'>>,
): Promise<AnyManifest | null> {
  let active: { activeVersion?: unknown };
  try {
    active = JSON.parse(await adapter.readFile(`packs/${venueId}/active.json`)) as { activeVersion?: unknown };
    if (typeof active.activeVersion !== 'number' || !Number.isInteger(active.activeVersion) || active.activeVersion < 1) {
      throw new Error('invalid active pack pointer');
    }
    const raw = JSON.parse(await adapter.readFile(packDir(venueId, active.activeVersion) + '/manifest.json')) as unknown;
    const manifest = parsePackManifest(raw);
    if (manifest.venueId !== venueId || manifest.version !== active.activeVersion) throw new Error('stale pack pointer');
    return manifest;
  } catch {
    await adapter.rmrf?.(`packs/${venueId}`).catch(() => undefined);
    return null;
  }
}
