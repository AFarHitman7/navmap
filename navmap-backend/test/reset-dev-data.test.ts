import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resetDevData } from '../scripts/reset-dev-data.js';

describe('resetDevData', () => {
  it('removes local database sidecars and data assets after exact confirmation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navmap-reset-'));
    const dataDir = path.join(root, 'data');
    const dbPath = path.join(dataDir, 'navmap.db');
    fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'versions', 'demo', '1'), { recursive: true });
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.writeFileSync(file, 'local');

    try {
      resetDevData({ dataDir, dbPath, workspaceRoot: root, confirmation: 'CONFIRM-V3-RESET' });
      expect(fs.existsSync(dataDir)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses deletion without the exact confirmation token', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'navmap-reset-'));
    const dataDir = path.join(root, 'data');
    fs.mkdirSync(dataDir);
    try {
      expect(() => resetDevData({ dataDir, dbPath: path.join(dataDir, 'navmap.db'), workspaceRoot: root, confirmation: 'yes' }))
        .toThrow(/confirmation token/);
      expect(fs.existsSync(dataDir)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires the canonical target path when storage is outside the workspace', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'navmap-workspace-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'navmap-outside-'));
    try {
      expect(() => resetDevData({
        dataDir: outside,
        dbPath: path.join(outside, 'navmap.db'),
        workspaceRoot: workspace,
        confirmation: 'CONFIRM-V3-RESET',
      })).toThrow(/outside the backend workspace/);
      expect(fs.existsSync(outside)).toBe(true);
      resetDevData({
        dataDir: outside,
        dbPath: path.join(outside, 'navmap.db'),
        workspaceRoot: workspace,
        confirmation: 'CONFIRM-V3-RESET',
        confirmOutsidePath: fs.realpathSync(outside),
      });
      expect(fs.existsSync(outside)).toBe(false);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses a data target that resolves to the backend workspace itself', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'navmap-workspace-'));
    try {
      expect(() => resetDevData({
        dataDir: workspace,
        dbPath: path.join(workspace, 'navmap.db'),
        workspaceRoot: workspace,
        confirmation: 'CONFIRM-V3-RESET',
      })).toThrow(/workspace itself/);
      expect(fs.existsSync(workspace)).toBe(true);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
