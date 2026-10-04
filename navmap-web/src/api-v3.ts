import { parseDraftV3, parseManifestV3, type DraftV3, type ManifestV3 } from './contract-v3';

export class PublishValidationError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[]) {
    super(message);
    this.issues = issues;
  }
}

export async function login(password: string): Promise<void> {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throwForStatus(res, await readJson(res));
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Server returned ${res.status} with a non-JSON body`);
  }
}

function throwForStatus(res: Response, body: unknown): never {
  const message =
    typeof body === 'object' && body !== null && 'error' in body && typeof (body as { error: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `Request failed with status ${res.status}`;
  throw new Error(`${message} (status ${res.status})`);
}

export type NodeSample = {
  nodeId: string;
  fingerprintRevision: number;
  capturedAt: number;
  readings: Array<{ bssid: string; rssi: number }>;
};

function venuePath(venueId: string): string {
  return `/api/admin/venues/${encodeURIComponent(venueId)}`;
}

export async function getDraftV3(venueId = 'demo'): Promise<DraftV3> {
  const res = await fetch(`${venuePath(venueId)}/draft-v3`);
  const body = await readJson(res);
  if (!res.ok) throwForStatus(res, body);
  const draft = parseDraftV3(body);
  if (draft.venueId !== venueId) throw new Error('Server returned the wrong map');
  return draft;
}

export async function saveDraftV3(draft: DraftV3, venueId: string = draft.venueId): Promise<DraftV3> {
  const res = await fetch(`${venuePath(venueId)}/draft-v3`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  });
  const body = await readJson(res);
  if (!res.ok) throwForStatus(res, body);
  const saved = parseDraftV3(body);
  if (saved.venueId !== venueId) throw new Error('Server returned the wrong map');
  return saved;
}

export async function getPublishedManifestV3(venueId = 'demo', signal?: AbortSignal): Promise<ManifestV3> {
  const path = `/api/venues/${encodeURIComponent(venueId)}`;
  const latestResponse = await fetch(`${path}/latest`, { signal });
  const latest = await readJson(latestResponse);
  if (!latestResponse.ok) throwForStatus(latestResponse, latest);
  if (typeof latest !== 'object' || latest === null || !('venueId' in latest) || latest.venueId !== venueId
    || !('version' in latest) || typeof latest.version !== 'number' || !Number.isInteger(latest.version) || latest.version <= 0) {
    throw new Error('Server returned an invalid published version');
  }
  const response = await fetch(`${path}/versions/${latest.version}/manifest`, { signal });
  const body = await readJson(response);
  if (!response.ok) throwForStatus(response, body);
  const manifest = parseManifestV3(body);
  if (manifest.venueId !== venueId || manifest.version !== latest.version) throw new Error('Server returned the wrong published map');
  return manifest;
}

export async function postNodeSamples(venueId: string, nodeId: string, scans: NodeSample[]): Promise<number> {
  const res = await fetch(`${venuePath(venueId)}/node-samples`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId, scans }),
  });
  const body = await readJson(res);
  if (!res.ok) throwForStatus(res, body);
  const count = (body as { count?: unknown }).count;
  if (typeof count !== 'number') throw new Error('Server returned an invalid sample count');
  return count;
}

export async function publishV3(venueId = 'demo'): Promise<{ manifest: ManifestV3; downloadUrl: string }> {
  const res = await fetch(`${venuePath(venueId)}/publish-v3`, { method: 'POST' });
  const body = await readJson(res);
  if (!res.ok && typeof body === 'object' && body && 'errors' in body && Array.isArray((body as { errors?: unknown }).errors)) {
    throw new PublishValidationError(
      String((body as { error?: string }).error ?? 'Publish failed'),
      (body as { errors: unknown[] }).errors.filter((item): item is string => typeof item === 'string'),
    );
  }
  if (!res.ok) throwForStatus(res, body);
  const manifest = parseManifestV3((body as { manifest?: unknown }).manifest ?? body);
  return { manifest, downloadUrl: `/api/venues/${manifest.venueId}/versions/${manifest.version}/manifest` };
}
