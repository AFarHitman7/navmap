import { detectContractKind, parseManifestV3, type ManifestV3 } from './contract-v3';
import { parseMapManifest, type MapManifest } from './map-contract';
import { apiBaseUrl } from './config';

export type PackAdapter = {
  getJson: (url: string) => Promise<unknown>;
  getBytes: (url: string) => Promise<Uint8Array>;
  rename: (from: string, to: string) => Promise<void>;
  writeFile: (path: string, data: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
  writeBytes: (path: string, bytes: Uint8Array) => Promise<void>;
  readBytes: (path: string) => Promise<Uint8Array>;
  hashBytes: (bytes: Uint8Array) => Promise<string>;
  rmrf: (path: string) => Promise<void>;
};

const MAX_PACK_ASSET_BYTES = 20 * 1024 * 1024;
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function encodeBase64(bytes: Uint8Array): string {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, hasB = i + 1 < bytes.length, hasC = i + 2 < bytes.length;
    const b = hasB ? bytes[i + 1]! : 0, c = hasC ? bytes[i + 2]! : 0;
    output += BASE64[a >> 2] + BASE64[((a & 3) << 4) | (b >> 4)] + (hasB ? BASE64[((b & 15) << 2) | (c >> 6)] : '=') + (hasC ? BASE64[c & 63] : '=');
  }
  return output;
}
export function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/\s/g, '');
  if (clean.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(clean)) throw new Error('Invalid base64 offline asset');
  const output: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = BASE64.indexOf(clean[i]!), b = BASE64.indexOf(clean[i + 1]!), c = clean[i + 2] === '=' ? 0 : BASE64.indexOf(clean[i + 2]!), d = clean[i + 3] === '=' ? 0 : BASE64.indexOf(clean[i + 3]!);
    output.push((a << 2) | (b >> 4));
    if (clean[i + 2] !== '=') output.push(((b & 15) << 4) | (c >> 2));
    if (clean[i + 3] !== '=') output.push(((c & 3) << 6) | d);
  }
  return Uint8Array.from(output);
}
function safeId(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function backgroundList(manifest: AnyManifest) {
  if (manifest.schemaVersion !== 5 || manifest.canvas.kind !== 'static') return [];
  return manifest.frames.flatMap((frame) => frame.background ? [{ frameId: frame.id, ...frame.background }] : []);
}

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
  safeId(venueId, 'venue id');
  const latest = (await adapter.getJson(`${base}/api/venues/${venueId}/latest`)) as { version?: unknown };
  const target = version || latest.version;
  if (typeof target !== 'number' || !Number.isInteger(target) || target < 1) throw new Error('Server returned an invalid V3 version');
  const raw = await adapter.getJson(`${base}/api/venues/${venueId}/versions/${target}/manifest`);
  const manifest = parsePackManifest(raw);
  if (manifest.venueId !== venueId || manifest.version !== target) throw new Error('Server returned the wrong V3 pack');

  const staging = `packs/${venueId}/${target}.staging`;
  const final = packDir(venueId, target);
  try {
    const backgrounds = backgroundList(manifest);
    for (const background of backgrounds) {
      safeId(background.assetId, 'layout asset id');
      if (!Number.isInteger(background.byteLength) || background.byteLength < 1 || background.byteLength > MAX_PACK_ASSET_BYTES) {
        throw new Error(`Invalid layout asset size for frame ${background.frameId}`);
      }
      const url = `${base}/api/venues/${encodeURIComponent(venueId)}/versions/${target}/assets/${encodeURIComponent(background.assetId)}`;
      const bytes = await adapter.getBytes(url);
      if (bytes.byteLength !== background.byteLength) throw new Error(`Layout asset size mismatch for frame ${background.frameId}`);
      if ((await adapter.hashBytes(bytes)).toLowerCase() !== background.sha256.toLowerCase()) {
        throw new Error(`Layout asset integrity check failed for frame ${background.frameId}`);
      }
      await adapter.writeBytes(`${staging}/assets/${background.assetId}.png`, bytes);
    }
    await adapter.writeFile(`${staging}/manifest.json`, JSON.stringify(manifest));
    await adapter.rename(staging, final);
    const activeStaging = `packs/${venueId}/active.json.staging`;
    await adapter.writeFile(activeStaging, JSON.stringify({ activeVersion: target }));
    await adapter.rename(activeStaging, `packs/${venueId}/active.json`);
  } catch (err) {
    await adapter.rmrf(staging).catch(() => undefined);
    await adapter.rmrf(`packs/${venueId}/active.json.staging`).catch(() => undefined);
    throw err;
  }
  return manifest;
}

export async function loadActivePack(
  venueId: string,
  adapter: Pick<PackAdapter, 'readFile'> & Partial<Pick<PackAdapter, 'rmrf' | 'readBytes' | 'hashBytes'>>,
): Promise<AnyManifest | null> {
  safeId(venueId, 'venue id');
  let active: { activeVersion?: unknown };
  try { active = JSON.parse(await adapter.readFile(`packs/${venueId}/active.json`)) as { activeVersion?: unknown }; }
  catch (error) {
    if (error instanceof Error && /ENOENT|missing/i.test(error.message)) return null;
    throw new Error('Could not read the active offline pack pointer; existing packs were left untouched');
  }
  if (typeof active.activeVersion !== 'number' || !Number.isInteger(active.activeVersion) || active.activeVersion < 1) {
    throw new Error('Invalid active offline pack pointer; existing packs were left untouched');
  }
  const raw = JSON.parse(await adapter.readFile(packDir(venueId, active.activeVersion) + '/manifest.json')) as unknown;
  const manifest = parsePackManifest(raw);
  if (manifest.venueId !== venueId || manifest.version !== active.activeVersion) throw new Error('Stale offline pack pointer; existing packs were left untouched');
  if (manifest.schemaVersion === 5 && manifest.canvas.kind === 'static') {
    if (!adapter.readBytes || !adapter.hashBytes) throw new Error('Offline asset verification is unavailable');
    for (const background of backgroundList(manifest)) {
      safeId(background.assetId, 'layout asset id');
      const bytes = await adapter.readBytes(`${packDir(venueId, active.activeVersion)}/assets/${background.assetId}.png`);
      if (bytes.byteLength !== background.byteLength || (await adapter.hashBytes(bytes)).toLowerCase() !== background.sha256.toLowerCase()) {
        throw new Error(`Offline layout asset is missing or corrupt (${background.assetId}); existing pack was retained`);
      }
    }
  }
  return manifest;
}

/** Read only an application-owned path derived from a validated active manifest. */
export async function readFrameBackground(manifest: AnyManifest, frameId: string, adapter: Pick<PackAdapter, 'readBytes'>): Promise<Uint8Array> {
  if (manifest.schemaVersion !== 5 || manifest.canvas.kind !== 'static') throw new Error('Map has no static layout');
  const frame = manifest.frames.find((candidate) => candidate.id === frameId);
  if (!frame?.background) throw new Error('This frame has no assigned layout');
  safeId(manifest.venueId, 'venue id');
  safeId(frame.background.assetId, 'layout asset id');
  if (frame.background.byteLength > MAX_PACK_ASSET_BYTES) throw new Error('Layout is too large to display offline (20 MiB maximum)');
  const bytes = await adapter.readBytes(`${packDir(manifest.venueId, manifest.version)}/assets/${frame.background.assetId}.png`);
  if (bytes.byteLength !== frame.background.byteLength) throw new Error('Offline layout size mismatch');
  return bytes;
}
