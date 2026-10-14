import { parseDraftV3, parseManifestV3, type DraftV3, type ManifestV3 } from './contract-v3';
import { parseMapDraft, parseMapManifest, type MapDraft, type MapManifest } from './map-contract';

export class PublishValidationError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[]) {
    super(message);
    this.issues = issues;
  }
}

/** Structured 409 when a save reuses a stale fingerprint revision. */
export class RevisionConflictError extends Error {
  readonly code = 'revision_conflict' as const;
  readonly nodeIds: string[];
  readonly currentRevisions: Record<string, number>;
  constructor(message: string, nodeIds: string[], currentRevisions: Record<string, number>) {
    super(message);
    this.nodeIds = nodeIds;
    this.currentRevisions = currentRevisions;
  }
}

function throwRevisionConflictIfPresent(res: Response, body: unknown): void {
  if (res.status !== 409 || typeof body !== 'object' || body === null) return;
  const conflict = body as { code?: unknown; nodeIds?: unknown; currentRevisions?: unknown; error?: unknown };
  if (conflict.code !== 'revision_conflict' || !Array.isArray(conflict.nodeIds)) return;
  const currentRevisions: Record<string, number> = {};
  if (conflict.currentRevisions && typeof conflict.currentRevisions === 'object') {
    for (const [id, rev] of Object.entries(conflict.currentRevisions as Record<string, unknown>)) {
      if (typeof rev === 'number') currentRevisions[id] = rev;
    }
  }
  throw new RevisionConflictError(
    typeof conflict.error === 'string' ? `${conflict.error} (status 409)` : `Save conflict (status 409)`,
    conflict.nodeIds.filter((id): id is string => typeof id === 'string'),
    currentRevisions,
  );
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
  if (!res.ok) {
    throwRevisionConflictIfPresent(res, body);
    throwForStatus(res, body);
  }
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

export type Capabilities = { mapV5AuthoringEnabled: boolean };

/** Reader-first rollout gate: V5 authoring stays disabled until the server (and docs) say otherwise. */
export async function getCapabilities(signal?: AbortSignal): Promise<Capabilities> {
  const res = await fetch('/api/capabilities', { signal });
  const body = await readJson(res);
  if (!res.ok) throwForStatus(res, body);
  if (typeof body !== 'object' || body === null || typeof (body as { mapV5AuthoringEnabled?: unknown }).mapV5AuthoringEnabled !== 'boolean') {
    throw new Error('Server returned invalid capabilities');
  }
  return { mapV5AuthoringEnabled: (body as { mapV5AuthoringEnabled: boolean }).mapV5AuthoringEnabled };
}

export async function isV5AuthoringEnabled(): Promise<boolean> {
  try {
    return (await getCapabilities()).mapV5AuthoringEnabled;
  } catch {
    return false;
  }
}

async function requireV5Authoring(): Promise<void> {
  if (!(await isV5AuthoringEnabled())) {
    throw new Error('V5 map authoring is disabled on this server (MAP_V5_AUTHORING_ENABLED)');
  }
}

export async function getDraftV5(venueId = 'demo'): Promise<MapDraft> {
  const res = await fetch(`${venuePath(venueId)}/draft-v3`);
  const body = await readJson(res);
  if (!res.ok) throwForStatus(res, body);
  const draft = parseMapDraft(body);
  if (draft.venueId !== venueId) throw new Error('Server returned the wrong map');
  return draft;
}

/** Explicit V5 save: gated on the capability flag; never rewrites V4 publications. */
export async function saveDraftV5(draft: MapDraft, venueId: string = draft.venueId): Promise<MapDraft> {
  await requireV5Authoring();
  const res = await fetch(`${venuePath(venueId)}/draft-v3`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  });
  const body = await readJson(res);
  if (!res.ok) {
    throwRevisionConflictIfPresent(res, body);
    throwForStatus(res, body);
  }
  const saved = parseMapDraft(body);
  if (saved.venueId !== venueId) throw new Error('Server returned the wrong map');
  return saved;
}

export async function getPublishedManifestV5(venueId = 'demo', signal?: AbortSignal): Promise<MapManifest> {
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
  const manifest = parseMapManifest(body);
  if (manifest.venueId !== venueId || manifest.version !== latest.version) throw new Error('Server returned the wrong published map');
  return manifest;
}

/** Explicit V5 publish: gated on the capability flag. */
export async function publishV5(venueId = 'demo'): Promise<{ manifest: MapManifest; downloadUrl: string }> {
  await requireV5Authoring();
  const res = await fetch(`${venuePath(venueId)}/publish-v3`, { method: 'POST' });
  const body = await readJson(res);
  if (!res.ok && typeof body === 'object' && body && 'errors' in body && Array.isArray((body as { errors?: unknown }).errors)) {
    throw new PublishValidationError(
      String((body as { error?: string }).error ?? 'Publish failed'),
      (body as { errors: unknown[] }).errors.filter((item): item is string => typeof item === 'string'),
    );
  }
  if (!res.ok) throwForStatus(res, body);
  const manifest = parseMapManifest((body as { manifest?: unknown }).manifest ?? body);
  return { manifest, downloadUrl: `/api/venues/${manifest.venueId}/versions/${manifest.version}/manifest` };
}
