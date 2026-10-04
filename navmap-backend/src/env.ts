import fs from 'node:fs';
import path from 'node:path';

/** Shared `.env` loader used by both the dev server and the `db:init` CLI. */
export function loadEnvFile(envPath: string = path.resolve(process.cwd(), '.env')): void {
  let raw: string;
  try {
    raw = fs.readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (!key || key in process.env) continue;
    process.env[key] = value;
  }
}

/** Resolve storage paths the same way for `db:init` and `dev`. */
export function resolveDataPaths(): { dataDir: string; dbPath: string } {
  const dataDir = process.env.DATA_DIR ?? './data';
  const dbPath = process.env.DB_PATH ?? path.join(dataDir, 'navmap.db');
  return { dataDir, dbPath };
}
