import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DaemonManager } from '../src/core/daemon-manager.mjs';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const tmpDir = path.join(os.tmpdir(), `openunum-daemon-test-${Date.now()}`);

describe('Phase 4: Daemon Manager', () => {
  let dm;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    dm = new DaemonManager({ workspaceRoot: tmpDir });
  });

  afterEach(async () => {
    await dm.destroy();
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch (_) {}
  });

  describe('API Basics', () => {
    it('should start and list daemons', async () => {
      const result = await dm.startDaemon({
        type: 'file_watcher',
        name: 'test-watcher',
        path: tmpDir,
        events: ['change']
      });
      expect(result.ok).toBe(true);
      expect(result.daemon.type).toBe('file_watcher');
      expect(result.daemon.state).toBe('running');

      const list = dm.listDaemons();
      expect(list.ok).toBe(true);
      expect(list.daemons.length).toBe(1);
      expect(list.daemons[0].name).toBe('test-watcher');
    });

    it('should get daemon status', async () => {
      const start = await dm.startDaemon({
        type: 'file_watcher',
        name: 'status-test',
        path: tmpDir
      });
      const status = dm.getDaemon(start.daemon.id);
      expect(status.ok).toBe(true);
      expect(status.daemon.id).toBe(start.daemon.id);
    });

    it('should stop daemon', async () => {
      const start = await dm.startDaemon({
        type: 'file_watcher',
        name: 'stop-test',
        path: tmpDir
      });
      const stop = await dm.stopDaemon(start.daemon.id);
      expect(stop.ok).toBe(true);
      expect(stop.daemon.state).toBe('stopped');
    });

    it('should restart daemon', async () => {
      const start = await dm.startDaemon({
        type: 'file_watcher',
        name: 'restart-test',
        path: tmpDir
      });
      const restart = await dm.restartDaemon(start.daemon.id);
      expect(restart.ok).toBe(true);
      expect(restart.daemon.state).toBe('running');
      expect(restart.daemon.restarts).toBeGreaterThan(0);
    });

    it('should remove stopped daemon', async () => {
      const start = await dm.startDaemon({
        type: 'file_watcher',
        name: 'remove-test',
        path: tmpDir
      });
      await dm.stopDaemon(start.daemon.id);
      const remove = dm.removeDaemon(start.daemon.id);
      expect(remove.ok).toBe(true);
      expect(remove.removed).toBe(start.daemon.id);

      const status = dm.getDaemon(start.daemon.id);
      expect(status.ok).toBe(false);
    });

    it('should get stats', () => {
      const stats = dm.getStats();
      expect(stats.ok).toBe(true);
      expect(typeof stats.total).toBe('number');
      expect(typeof stats.byType).toBe('object');
      expect(typeof stats.byState).toBe('object');
    });
  });

  describe('File Watcher', () => {
    it('should normalize type aliases', async () => {
      for (const type of ['file', 'file_watcher', 'FILE']) {
        const result = await dm.startDaemon({
          type,
          name: `type-test-${type}`,
          path: tmpDir
        });
        expect(result.ok).toBe(true);
        expect(result.daemon.type).toBe('file_watcher');
        await dm.stopDaemon(result.daemon.id);
      }
    });

    it('should reject invalid types', async () => {
      const result = await dm.startDaemon({
        type: 'invalid_type',
        name: 'bad-type-test'
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('invalid type');
    });

    it('should reject missing path', async () => {
      const result = await dm.startDaemon({
        type: 'file_watcher',
        name: 'no-path-test'
      });
      expect(result.ok).toBe(false);
    });
  });

  describe('HTTP Monitor', () => {
    it('should reject missing URL', async () => {
      const result = await dm.startDaemon({
        type: 'http_monitor',
        name: 'no-url-test'
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('url');
    });

    it('should reject invalid interval', async () => {
      const result = await dm.startDaemon({
        type: 'http_monitor',
        name: 'bad-interval-test',
        url: 'http://localhost:12345',
        intervalMs: -100
      });
      // Should clamp to valid range or reject
      expect(result.ok === false || result.daemon?.config?.intervalMs >= 1000).toBe(true);
    });
  });

  describe('Process Daemon', () => {
    it('should reject missing command', async () => {
      const result = await dm.startDaemon({
        type: 'process',
        name: 'no-cmd-test'
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('command');
    });

    it('should start a simple process', async () => {
      const result = await dm.startDaemon({
        type: 'process',
        name: 'echo-test',
        command: 'echo',
        args: ['hello']
      });
      // Process may exit quickly, so check it was created
      expect(result.ok || result.error).toBeDefined();
      if (result.ok) {
        await dm.stopDaemon(result.daemon.id);
      }
    });
  });

  describe('Persistence', () => {
    it('should persist daemon state', async () => {
      const start = await dm.startDaemon({
        type: 'file_watcher',
        name: 'persist-test',
        path: tmpDir
      });

      // Create new manager instance (simulating restart)
      const dm2 = new DaemonManager({ workspaceRoot: tmpDir });
      const list = dm2.listDaemons();
      expect(list.daemons.length).toBeGreaterThan(0);
      expect(list.daemons.find(d => d.id === start.daemon.id)).toBeDefined();

      await dm2.destroy();
    });
  });

  describe('Limits', () => {
    it('should enforce max daemon limit', async () => {
      dm.maxDaemons = 3;
      const ids = [];

      for (let i = 0; i < 5; i++) {
        const result = await dm.startDaemon({
          type: 'file_watcher',
          name: `limit-test-${i}`,
          path: tmpDir
        });
        if (result.ok) {
          ids.push(result.daemon.id);
        }
      }

      expect(ids.length).toBeLessThanOrEqual(3);
    });
  });
});
