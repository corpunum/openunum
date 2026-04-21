import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

function loadDistinctLatestUserPrompts() {
  const dbPath = path.join(os.homedir(), '.openunum', 'openunum.db');
  if (!fs.existsSync(dbPath)) return [];
  let db;
  try {
    db = new DatabaseSync(dbPath);
  } catch {
    return [];
  }
  let rows;
  try {
    rows = db.prepare(`
      WITH candidate_sessions AS (
        SELECT id
        FROM sessions
        WHERE id NOT LIKE 'health-check-%'
          AND id NOT LIKE 'autotest-%'
          AND id NOT LIKE 'mission:%'
      ),
      last_user AS (
        SELECT
          m.session_id,
          m.content,
          m.created_at,
          ROW_NUMBER() OVER (PARTITION BY m.session_id ORDER BY m.id DESC) AS rn
        FROM messages m
        JOIN candidate_sessions s ON s.id = m.session_id
        WHERE m.role = 'user'
      )
      SELECT session_id, content, created_at
      FROM last_user
      WHERE rn = 1
      ORDER BY created_at DESC
    `).all();
  } catch {
    rows = [];
  } finally {
    db.close();
  }

  const dedup = new Map();
  for (const row of rows) {
    const text = String(row.content || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (text.length > 280) continue;
    const key = text.toLowerCase();
    if (!dedup.has(key)) {
      dedup.set(key, text);
    }
  }
  return Array.from(dedup.values());
}

async function sendAndAwait(sessionId, message, timeoutMs = 30000) {
  const first = await jpost('/api/chat', { sessionId, message });
  if (first.status === 200) return first.json;
  assert.equal(first.status, 202, `unexpected status for ${sessionId}: ${first.status}`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const pending = await jget(`/api/chat/pending?sessionId=${encodeURIComponent(sessionId)}`);
    assert.equal(pending.status, 200, `pending status failed for ${sessionId}`);
    if (pending.json?.completed) return pending.json;
  }
  throw new Error(`timed out waiting for chat completion: ${sessionId}`);
}

function shouldAllowStatusShape(message) {
  const t = String(message || '').toLowerCase();
  if (t.startsWith('/status')) return true;
  return /\bstatus\b/.test(t) && /\b(api|health|runtime|check)\b/.test(t);
}

function assertCleanReply(prompt, out) {
  const reply = String(out?.reply || '');
  assert.ok(reply.trim().length > 0, `empty reply for prompt: ${prompt}`);
  if (!shouldAllowStatusShape(prompt)) {
    assert.equal(/^Status:\s+/m.test(reply), false, `status stub leaked for prompt: ${prompt}`);
    assert.equal(/\nFindings:\n/m.test(reply), false, `findings block leaked for prompt: ${prompt}`);
  }
}

let proc;
try {
  const prompts = loadDistinctLatestUserPrompts();
  const caseLimit = Number(process.env.OPENUNUM_PHASE56_LIMIT || 0);
  const targetPrompts = caseLimit > 0 ? prompts.slice(0, caseLimit) : prompts;
  if (targetPrompts.length === 0) {
    console.log('phase56.user-session-imitation-sweep.e2e: skip (no prompts from existing sessions)');
    process.exit(0);
  }
  proc = await startServer();

  const failures = [];
  const traceNotes = new Map();

  for (let i = 0; i < targetPrompts.length; i += 1) {
    const prompt = targetPrompts[i];
    const sessionId = `phase56:imitation:${i}`;
    try {
      console.log(`phase56 case ${i + 1}/${targetPrompts.length}`);
      const out = await sendAndAwait(sessionId, prompt, 30000);
      assertCleanReply(prompt, out);
      const note = String(out?.trace?.note || 'none');
      traceNotes.set(note, Number(traceNotes.get(note) || 0) + 1);
    } catch (error) {
      failures.push({ prompt, error: String(error?.message || error) });
    }
  }

  if (failures.length) {
    console.error('phase56 failures:');
    for (const item of failures.slice(0, 20)) {
      console.error(`- prompt=${JSON.stringify(item.prompt)} error=${item.error}`);
    }
    throw new Error(`phase56 failed (${failures.length}/${targetPrompts.length})`);
  }

  const traceSummary = Array.from(traceNotes.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(', ');
  console.log(`phase56.user-session-imitation-sweep.e2e: ok (${targetPrompts.length} prompts)`);
  console.log(`phase56.trace_summary: ${traceSummary}`);
} finally {
  await stopServer(proc);
}
