import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OpenUnumAgent } from '../src/core/agent.mjs';
import { MemoryStore } from '../src/memory/store.mjs';

describe('Phase 4: Daemon Manager Integration (Smoke)', () => {
  let agent;
  let memoryStore;

  beforeEach(() => {
    memoryStore = new MemoryStore();
    agent = new OpenUnumAgent({
      config: {
        model: { provider: 'ollama', model: 'qwen3.5:9b-64k' },
        runtime: { workspaceRoot: process.cwd() }
      },
      memoryStore
    });
  });

  afterEach(async () => {
    if (agent?.daemonManager) {
      await agent.daemonManager.destroy();
    }
  });

  describe('Constructor Integration', () => {
    it('should initialize daemonManager in constructor', () => {
      expect(agent.daemonManager).toBeDefined();
      expect(typeof agent.daemonManager.startDaemon).toBe('function');
      expect(typeof agent.daemonManager.stopDaemon).toBe('function');
      expect(typeof agent.daemonManager.listDaemons).toBe('function');
    });

    it('should have health loop running', () => {
      expect(agent.daemonManager.healthTimer).toBeDefined();
    });
  });

  describe('Daemon Manager API', () => {
    it('should expose startDaemon method', async () => {
      const result = await agent.daemonManager.startDaemon({
        type: 'file_watcher',
        name: 'smoke-test-watcher',
        path: process.cwd()
      });
      expect(result.ok || result.error).toBeDefined();
      if (result.ok) {
        await agent.daemonManager.stopDaemon(result.daemon.id);
      }
    });

    it('should expose listDaemons method', () => {
      const result = agent.daemonManager.listDaemons();
      expect(result.ok).toBe(true);
      expect(Array.isArray(result.daemons)).toBe(true);
    });

    it('should expose getStats method', () => {
      const result = agent.daemonManager.getStats();
      expect(result.ok).toBe(true);
      expect(typeof result.total).toBe('number');
    });
  });
});
