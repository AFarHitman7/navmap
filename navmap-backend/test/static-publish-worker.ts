import { workerData, parentPort } from 'node:worker_threads';
import { openDb } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { publishV3 } from '../src/publish-v3.js';

type WorkerInput = {
  role: 'publisher' | 'cleanup';
  dbPath: string;
  dataDir: string;
  pauseAt?: 'after-stage' | 'after-rename';
  control?: SharedArrayBuffer;
};

const input = workerData as WorkerInput;
const db = openDb(input.dbPath);

try {
  if (input.role === 'publisher') {
    process.env.MAP_V5_AUTHORING_ENABLED = '1';
    const gate = new Int32Array(input.control!);
    const pause = (point: 'after-stage' | 'after-rename', dir: string): void => {
      if (input.pauseAt !== point) return;
      parentPort!.postMessage(`stage-path:${dir}`);
      parentPort!.postMessage(`paused:${point}`);
      Atomics.wait(gate, 0, 0);
    };
    publishV3(db, input.dataDir, 'demo', {
      afterStage: (dir) => pause('after-stage', dir),
      afterRename: (dir) => pause('after-rename', dir),
    });
    parentPort!.postMessage('publisher-finished');
  } else {
    const gate = new Int32Array(input.control!);
    parentPort!.postMessage('cleanup-ready');
    Atomics.wait(gate, 1, 0);
    parentPort!.postMessage('cleanup-starting');
    const app = buildApp(db, { dataDir: input.dataDir, adminPasswordHash: 'test-only' });
    void app.close().then(() => {
      db.close();
      parentPort!.postMessage('cleanup-finished');
    });
  }
} catch (err) {
  parentPort!.postMessage(`worker-error:${(err as Error).stack ?? String(err)}`);
  throw err;
} finally {
  if (input.role === 'publisher') db.close();
}
