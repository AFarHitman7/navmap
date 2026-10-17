// Frame-aware geometry: explicit coordinate dispatch for V5 maps.
//
// Geographic frames measure in metres (haversine); static frames measure in
// source pixels (never screen pixels). Cross-frame transitions use explicit
// positive costs via transitionMetrics, never interpolated distances.
import { distanceMeters } from './geo-v3.js';
import { parseMapDraft, type MapDraft, type MapFrame, type MapNode, type Position } from './map-contract.js';

/** Default local sampling density: one sample per 20 source pixels. */
export const LOCAL_SAMPLE_PIXELS = 20;
/** Hard cap on generated nodes per authored path (checked before allocation). */
export const MAX_GENERATED_PER_PATH = 5000;

export type LocalPoint = { x: number; y: number };
export type GeoPoint = { lat: number; lng: number };

function requireLocal(a: MapNode, b: MapNode): { ax: number; ay: number; bx: number; by: number } {
  if (a.position.kind !== 'local' || b.position.kind !== 'local') {
    throw new Error('Static segment needs local positions on both endpoints');
  }
  return { ax: a.position.x, ay: a.position.y, bx: b.position.x, by: b.position.y };
}

/**
 * Same-frame segment cost. Geographic edges use distanceMeters for cost and
 * metres. Static edges use source-pixel distance divided by the frame's
 * maximum dimension; metres are present only when the frame is calibrated.
 * Throws when a static frame has no assigned background (authoring is
 * disabled until the background dimensions are assigned).
 */
export function segmentMetrics(a: MapNode, b: MapNode, frame: MapFrame): { cost: number; meters?: number } {
  if (a.position.kind === 'geographic' && b.position.kind === 'geographic') {
    const meters = distanceMeters(a.position.lat, a.position.lng, b.position.lat, b.position.lng);
    if (!Number.isFinite(meters) || meters <= 0) throw new Error('Path edges need a positive distance');
    return { cost: meters, meters };
  }
  const background = frame.background;
  if (!background) throw new Error(`Frame ${frame.id} needs an assigned background before authoring`);
  const { ax, ay, bx, by } = requireLocal(a, b);
  const pixels = Math.hypot((bx - ax) * background.width, (by - ay) * background.height);
  if (!Number.isFinite(pixels) || pixels <= 0) throw new Error('Path edges need a positive distance');
  const cost = pixels / Math.max(background.width, background.height);
  const calibration = frame.calibration;
  if (calibration) return { cost, meters: pixels * calibration.metersPerPixel };
  return { cost };
}

/**
 * Cross-frame transition cost. Never interpolated: entrances default to 1,
 * stairs/elevators to 4 * abs(to.z - from.z). Metres are omitted unless
 * supplied for static transitions; these costs are routing weights, not
 * physical distances.
 */
export function transitionMetrics(
  kind: 'entrance' | 'stair' | 'elevator',
  from: MapNode,
  to: MapNode,
  meters?: number,
): { cost: number; meters?: number } {
  if (meters !== undefined) {
    if (!Number.isFinite(meters) || meters <= 0) throw new Error('Transition distances must be positive');
    return { cost: meters, meters };
  }
  const cost = kind === 'entrance' ? 1 : 4 * Math.abs(to.z - from.z);
  if (!Number.isFinite(cost) || cost <= 0) throw new Error('Transition endpoints need different floors or an entrance kind');
  return { cost };
}

/** True when the position lies inside the frame bounds (kind must match). */
export function containsPosition(frame: MapFrame, position: Position): boolean {
  const bounds = frame.bounds;
  if (bounds.kind === 'geographic' && position.kind === 'geographic') {
    return (
      position.lat <= bounds.north &&
      position.lat >= bounds.south &&
      position.lng <= bounds.east &&
      position.lng >= bounds.west
    );
  }
  if (bounds.kind === 'local' && position.kind === 'local') {
    return position.x >= bounds.left && position.x <= bounds.right && position.y >= bounds.top && position.y <= bounds.bottom;
  }
  return false;
}

/** Blank V5 draft for the requested canvas kind (strictly parsed). */
export function emptyMapDraft(venueId: string, kind: 'geographic' | 'static'): MapDraft {
  return parseMapDraft({
    schemaVersion: 5,
    venueId,
    canvas: { kind },
    boundary: kind === 'static' ? { kind: 'local', left: 0, top: 0, right: 1, bottom: 1 } : null,
    indoorZones: [],
    frames: [],
    nodes: [],
    edges: [],
    paths: [],
    transitions: [],
    places: [],
    anchors: [],
    aps: [],
  });
}

/** Reject generated-graph budgets before any large mutation/allocation. */
export function assertSampleBudget(generatedCount: number): void {
  if (!Number.isInteger(generatedCount) || generatedCount < 0) throw new Error('Invalid sample count');
  if (generatedCount > MAX_GENERATED_PER_PATH) {
    throw new Error(`Authored path would generate ${generatedCount} nodes (cap ${MAX_GENERATED_PER_PATH})`);
  }
}

/** Metre-based subdivision of a geographic segment (endpoints included). */
export function sampleGeographicSegment(a: GeoPoint, b: GeoPoint, spacingMeters = 3): GeoPoint[] {
  const length = distanceMeters(a.lat, a.lng, b.lat, b.lng);
  if (!Number.isFinite(length) || length <= 0) throw new Error('Path segments must have a positive finite length.');
  const steps = Math.ceil(length / spacingMeters);
  assertSampleBudget(steps + 1);
  return Array.from({ length: steps + 1 }, (_, i) =>
    i === 0 ? { ...a } : i === steps ? { ...b } : { lat: a.lat + ((b.lat - a.lat) * i) / steps, lng: a.lng + ((b.lng - a.lng) * i) / steps },
  );
}

/**
 * Pixel-based subdivision of a local segment in source pixels (endpoints
 * included). A calibrated frame may sample by physical spacing instead via
 * physicalSpacingMeters. The budget is enforced before allocating points.
 */
export function sampleLocalSegment(
  a: LocalPoint,
  b: LocalPoint,
  frame: Pick<MapFrame, 'id' | 'background' | 'calibration'>,
  opts?: { spacingPixels?: number; physicalSpacingMeters?: number },
): LocalPoint[] {
  const background = frame.background;
  if (!background) throw new Error(`Frame ${frame.id} needs an assigned background before authoring`);
  let spacingPixels = opts?.spacingPixels ?? LOCAL_SAMPLE_PIXELS;
  if (opts?.physicalSpacingMeters !== undefined) {
    const metersPerPixel = frame.calibration?.metersPerPixel;
    if (!metersPerPixel) throw new Error(`Frame ${frame.id} is not calibrated for physical spacing`);
    spacingPixels = opts.physicalSpacingMeters / metersPerPixel;
  }
  if (!Number.isFinite(spacingPixels) || spacingPixels <= 0) throw new Error('Sampling spacing must be positive');
  const pixels = Math.hypot((b.x - a.x) * background.width, (b.y - a.y) * background.height);
  if (!Number.isFinite(pixels) || pixels <= 0) throw new Error('Path segments must have a positive finite length.');
  const steps = Math.ceil(pixels / spacingPixels);
  assertSampleBudget(steps + 1);
  return Array.from({ length: steps + 1 }, (_, i) =>
    i === 0 ? { ...a } : i === steps ? { ...b } : { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps },
  );
}
