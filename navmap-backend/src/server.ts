import fs from 'node:fs';
import path from 'node:path';
import { openDb } from './db.js';
import { loadEnvFile, resolveDataPaths } from './env.js';
import { hashPassword } from './auth.js';
import { buildApp } from './app.js';

loadEnvFile();

const { dataDir, dbPath } = resolveDataPaths();
const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const adminPassword = process.env.ADMIN_PASSWORD ?? 'change-me';
const webDistDir = process.env.WEB_DIST_DIR;
const certFile = process.env.TLS_CERT_FILE;
const keyFile = process.env.TLS_KEY_FILE;

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

const db = openDb(dbPath);
// NOTE: demo prototype seeds from env on each boot; password changes require restart.
const adminPasswordHash = hashPassword(adminPassword);
const https =
  certFile && keyFile
    ? { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }
    : undefined;
const app = buildApp(db, { adminPasswordHash, dataDir, webDistDir, https });

app.listen({ host, port }).then(() => {
  console.log(`navmap-backend listening on ${https ? 'https' : 'http'}://${host}:${port}`);
});
