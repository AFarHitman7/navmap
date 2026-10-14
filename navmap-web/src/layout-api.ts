export interface LayoutAsset {
  assetId: string;
  width: number;
  height: number;
  sha256: string;
  byteLength: number;
}

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const MAX_PIXELS = 16_000_000;

export async function uploadLayout(venueId: string, png: Blob, signal: AbortSignal): Promise<LayoutAsset> {
  if (png.type !== 'image/png') throw new Error('Only a converted PNG layout can be uploaded');
  if (png.size === 0 || png.size > MAX_BYTES) throw new Error('Layout image exceeds the 20 MiB source limit');
  const body = new FormData();
  body.append('file', png, 'layout.png');
  const response = await fetch(`/api/admin/venues/${encodeURIComponent(venueId)}/layout-assets`, {
    method: 'POST',
    body,
    signal,
  });
  const text = await response.text();
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Server returned ${response.status} with an invalid layout response`);
  }
  if (!response.ok) {
    const message = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : `Layout upload failed with status ${response.status}`;
    throw new Error(`${message} (status ${response.status})`);
  }
  if (typeof value !== 'object' || value === null) throw new Error('Server returned invalid layout metadata');
  const asset = value as Partial<LayoutAsset>;
  if (typeof asset.assetId !== 'string' || !/^[0-9a-f]{64}$/.test(asset.assetId) ||
      !Number.isInteger(asset.width) || !Number.isInteger(asset.height) ||
      !Number.isInteger(asset.byteLength) || typeof asset.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(asset.sha256) ||
      asset.width! < 1 || asset.height! < 1 || asset.width! > MAX_DIMENSION || asset.height! > MAX_DIMENSION ||
      asset.width! * asset.height! > MAX_PIXELS || asset.byteLength! < 1 || asset.byteLength! > MAX_BYTES) {
    throw new Error('Server returned invalid layout metadata');
  }
  return asset as LayoutAsset;
}
