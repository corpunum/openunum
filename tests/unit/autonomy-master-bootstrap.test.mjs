import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AutonomyMaster } from '../../src/core/autonomy-master.mjs';

const originalHome = process.env.OPENUNUM_HOME;
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openunum-autonomy-master-'));
process.env.OPENUNUM_HOME = testHome;

afterAll(() => {
  if (originalHome == null) delete process.env.OPENUNUM_HOME;
  else process.env.OPENUNUM_HOME = originalHome;
  fs.rmSync(testHome, { recursive: true, force: true });
});

describe('AutonomyMaster bootstrap', () => {
  it('does not compute self-awareness synchronously during construction', () => {
    const memoryStore = {
      listSessions() {
        throw new Error('constructor_should_not_scan_sessions');
      }
    };
    const master = new AutonomyMaster({
      config: { runtime: {} },
      agent: {},
      memoryStore,
      browser: { status: async () => ({ ok: true }) },
      pendingChats: new Map()
    });

    expect(master.selfAwareness.status).toBe('initializing');
    expect(master.selfAwareness.issues[0]).toContain('initializing');
  });
});
