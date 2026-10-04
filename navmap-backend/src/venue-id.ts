export const VENUE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const VENUE_NAME_MAX = 100;

export function normalizeVenueId(venueId: string): string {
  if (!VENUE_ID_RE.test(venueId)) throw Object.assign(new Error(`unknown venue: ${venueId}`), { statusCode: 404 });
  return venueId;
}

export function normalizeVenueName(name: string): string {
  if (typeof name !== 'string') throw Object.assign(new Error('Venue name is required'), { statusCode: 400 });
  const trimmed = name.trim();
  if (!trimmed) throw Object.assign(new Error('Venue name is required'), { statusCode: 400 });
  if (trimmed.length > VENUE_NAME_MAX) {
    throw Object.assign(new Error(`Venue name must be at most ${VENUE_NAME_MAX} characters`), { statusCode: 400 });
  }
  return trimmed;
}
