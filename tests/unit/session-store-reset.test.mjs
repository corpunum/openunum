import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/memory/store.mjs';
import { newCommand } from '../../src/commands/builtin/new.mjs';

let originalHome = process.env.OPENUNUM_HOME;
let currentHome = null;
let currentStore = null;

function createStore() {
  currentHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openunum-session-reset-'));
  process.env.OPENUNUM_HOME = currentHome;
  currentStore = new MemoryStore();
  return currentStore;
}

afterEach(() => {
  currentStore?.db?.close?.();
  currentStore = null;
  if (currentHome) fs.rmSync(currentHome, { recursive: true, force: true });
  currentHome = null;
  if (originalHome == null) delete process.env.OPENUNUM_HOME;
  else process.env.OPENUNUM_HOME = originalHome;
});

describe('session reset store methods', () => {
  it('clears the current session payload while keeping the session id alive', () => {
    const store = createStore();
    const sid = 'telegram:reset-test';

    store.addMessage(sid, 'user', 'hello');
    store.addMessage(sid, 'assistant', 'world');
    store.recordToolRun({ sessionId: sid, toolName: 'file_search', args: { q: 'hello' }, result: { ok: true } });
    store.recordSessionCompaction({
      sessionId: sid,
      cutoffMessageId: 2,
      model: 'ollama-local/gemma4:cpu',
      ctxLimit: 4096,
      preTokens: 200,
      postTokens: 80,
      summary: { note: 'compact' }
    });
    store.addMemoryArtifact({ sessionId: sid, artifactType: 'note', content: 'artifact', sourceRef: 'test' });

    const out = store.clearSessionMessages(sid);
    expect(out.ok).toBe(true);
    expect(out.deletedMessages).toBe(2);
    expect(out.deletedToolRuns).toBe(1);
    expect(out.deletedCompactions).toBe(1);
    expect(out.deletedArtifacts).toBe(1);
    expect(store.getAllMessagesForSession(sid)).toHaveLength(0);
    expect(store.getRecentToolRuns(sid)).toHaveLength(0);
    expect(store.getMemoryArtifacts(sid, 10)).toHaveLength(0);
    expect(store.listSessionCompactions(sid, 10)).toHaveLength(0);
    expect(store.getSessionSummary(sid)?.sessionId).toBe(sid);
  });

  it('new command uses clearSessionMessages and reports cleared counts', async () => {
    const store = createStore();
    const sid = 'telegram:new-command';

    store.addMessage(sid, 'user', 'old message');
    store.recordToolRun({ sessionId: sid, toolName: 'http_request', args: {}, result: { ok: true, status: 200 } });

    const reply = await newCommand.execute([], {}, { sessionId: sid, memoryStore: store });

    expect(reply).toContain('session_new ok=true');
    expect(reply).toContain('deleted_messages=1');
    expect(reply).toContain('deleted_tool_runs=1');
    expect(store.getAllMessagesForSession(sid)).toHaveLength(0);
  });
});
