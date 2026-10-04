import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile, resolveDataPaths } from '../src/env.js';

const CONFIRMATION_TOKEN = 'CONFIRM-V3-RESET';

export type ResetDevDataOptions = {
  dataDir: string;
  dbPath: string;
  workspaceRoot: string;
  confirmation: string;
  confirmOutsidePath?: string;
};

function canonicalPath(target: string): string {
  const resolved = path.resolve(target);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    const parent = path.dirname(resolved);
    if (parent === resolved) return resolved;
    return path.join(canonicalPath(parent), path.basename(resolved));
  }
}

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function assertDeletable(target: string): void {
  const parsed = path.parse(target);
  if (target === parsed.root || !path.basename(target)) {
    throw new Error(`Refusing to reset filesystem root: ${target}`);
  }
}

/** Destructively clear one explicitly configured local development store. */
export function resetDevData(options: ResetDevDataOptions): void {
  if (options.confirmation !== CONFIRMATION_TOKEN) {
    throw new Error(`Missing confirmation token; pass exactly ${CONFIRMATION_TOKEN}`);
  }
  if (!options.dataDir.trim() || !options.dbPath.trim()) {
    throw new Error('Refusing to reset an empty DATA_DIR or DB_PATH');
  }

  const workspace = canonicalPath(options.workspaceRoot);
  const dataDir = canonicalPath(options.dataDir);
  const dbPath = canonicalPath(options.dbPath);
  assertDeletable(dataDir);
  assertDeletable(dbPath);
  if (dataDir === workspace || dbPath === workspace) {
    throw new Error(`Refusing to reset the backend workspace itself: ${workspace}`);
  }

  const deleteTargets = [dataDir, ...(isWithin(dataDir, dbPath) ? [] : [dbPath])];
  const outside = deleteTargets.filter((target) => !isWithin(workspace, target));
  for (const target of outside) {
    if (options.confirmOutsidePath !== target) {
      throw new Error(`Storage target is outside the backend workspace: ${target}; pass its exact canonical path to confirm`);
    }
  }

  fs.rmSync(dataDir, { recursive: true, force: true });
  if (!isWithin(dataDir, dbPath)) {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      fs.rmSync(`${dbPath}${suffix}`, { force: true });
    }
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]).endsWith(path.join('scripts', 'reset-dev-data.ts'));
if (isMain) {
  loadEnvFile();
  const { dataDir, dbPath } = resolveDataPaths();
  const workspaceRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const outsideArg = process.argv.find((arg) => arg.startsWith('--confirm-outside-path='));
  const confirmOutsidePath = outsideArg?.slice('--confirm-outside-path='.length);

  console.log(`Resolved DATA_DIR: ${canonicalPath(dataDir)}`);
  console.log(`Resolved DB_PATH: ${canonicalPath(dbPath)}`);
  try {
    resetDevData({
      dataDir,
      dbPath,
      workspaceRoot,
      confirmation: process.argv.includes('--confirm-v3-reset') ? CONFIRMATION_TOKEN : '',
      ...(confirmOutsidePath ? { confirmOutsidePath: canonicalPath(confirmOutsidePath) } : {}),
    });
    console.log('Local NavMap V3 development data removed.');
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
