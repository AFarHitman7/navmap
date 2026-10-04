// Build-time config for the bare RN app.
//
// Wiring: copy `.env.example` to `.env` with your laptop LAN IP, then export
// it in the shell before launching (debug-only LAN HTTP):
//
//   set API_BASE_URL=http://192.168.1.10:3000   (Windows cmd)
//   $env:API_BASE_URL="http://192.168.1.10:3000" (PowerShell)
//
// Metro inlines `process.env.API_BASE_URL` at bundle time via the RN Babel
// preset's inline-env transform when the variable is exported. Anything not
// provided falls back to the constants below. Release builds must use HTTPS.

export const DEFAULT_API_BASE_URL = 'http://192.0.2.10:3000';
export const DEFAULT_VENUE_ID = 'demo';

function readEnv(key: string): string | undefined {
  try {
    if (typeof process !== 'undefined' && process.env) {
      const v = process.env[key];
      if (typeof v === 'string' && v.length > 0) return v;
    }
  } catch {
    // Hermes release bundles may not have process.env — fall through.
  }
  return undefined;
}

/** Base URL of the venue backend (no trailing slash). */
export function apiBaseUrl(): string {
  return (readEnv('API_BASE_URL') ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');
}

/** Venue id for the offline pack (`packs/<venue>/<version>`). */
export function venueId(): string {
  return readEnv('VENUE_ID') ?? DEFAULT_VENUE_ID;
}
