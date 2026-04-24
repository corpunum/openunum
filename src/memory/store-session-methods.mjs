import { summarizeSessionTitle } from './store-helpers.mjs';

export class SessionStoreMethods {
  ensureSession(sessionId) {
    this.db
      .prepare('INSERT OR IGNORE INTO sessions (id, created_at) VALUES (?, ?)')
      .run(sessionId, new Date().toISOString());
  }

  createSession(sessionId) {
    this.ensureSession(sessionId);
    return this.getSessionSummary(sessionId);
  }

  addMessage(sessionId, role, content, {
    reasoning,
    rawReply,
    imageFiles,
    lunumCode,
    lunumSem,
    lunumFp,
    lunumMeta
  } = {}) {
    this.ensureSession(sessionId);
    this.db
      .prepare('INSERT INTO messages (session_id, role, content, reasoning, raw_reply, assets, lunum_code, lunum_sem_json, lunum_fp, lunum_meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        sessionId,
        role,
        content,
        reasoning || null,
        rawReply || null,
        imageFiles ? JSON.stringify(imageFiles) : null,
        lunumCode || null,
        lunumSem ? JSON.stringify(lunumSem) : null,
        lunumFp || null,
        lunumMeta ? JSON.stringify(lunumMeta) : null,
        new Date().toISOString()
      );
  }

  importSession({ sessionId, messages = [] }) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('sessionId is required');
    this.ensureSession(sid);
    for (const message of messages) {
      const role = ['system', 'user', 'assistant', 'tool'].includes(String(message?.role || ''))
        ? String(message.role)
        : 'assistant';
      const content = String(message?.content || '');
      const createdAt = String(message?.created_at || message?.createdAt || new Date().toISOString());
      this.db
        .prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)')
        .run(sid, role, content, createdAt);
    }
    return this.getSessionSummary(sid);
  }

  cloneSession({ sourceSessionId, targetSessionId }) {
    const sourceId = String(sourceSessionId || '').trim();
    const targetId = String(targetSessionId || '').trim();
    if (!sourceId) throw new Error('sourceSessionId is required');
    if (!targetId) throw new Error('targetSessionId is required');
    const sourceMessages = this.getAllMessagesForSession(sourceId);
    if (!sourceMessages.length) throw new Error('source_session_not_found_or_empty');
    return this.importSession({
      sessionId: targetId,
      messages: sourceMessages.map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.created_at
      }))
    });
  }

  runInTransaction(fn) {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {}
      throw error;
    }
  }

  getOperationReceipt(operationId) {
    const opId = String(operationId || '').trim();
    if (!opId) return null;
    const row = this.db
      .prepare('SELECT operation_id, operation_kind, target_ref, result_json, created_at FROM operation_receipts WHERE operation_id = ?')
      .get(opId);
    if (!row) return null;
    return {
      operationId: row.operation_id,
      operationKind: row.operation_kind,
      targetRef: row.target_ref,
      result: JSON.parse(row.result_json || '{}'),
      createdAt: row.created_at
    };
  }

  recordOperationReceipt({ operationId, operationKind, targetRef, result }) {
    const opId = String(operationId || '').trim();
    if (!opId) return;
    this.db
      .prepare(
        'INSERT OR REPLACE INTO operation_receipts (operation_id, operation_kind, target_ref, result_json, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        opId,
        String(operationKind || 'unknown'),
        String(targetRef || ''),
        JSON.stringify(result || {}),
        new Date().toISOString()
      );
  }

  listOperationReceipts(limit = 50) {
    const rows = this.db
      .prepare(
        'SELECT operation_id, operation_kind, target_ref, created_at FROM operation_receipts ORDER BY created_at DESC LIMIT ?'
      )
      .all(Math.max(1, Math.min(500, Number(limit || 50))));
    return rows.map((row) => ({
      operationId: row.operation_id,
      operationKind: row.operation_kind,
      targetRef: row.target_ref,
      createdAt: row.created_at
    }));
  }

  deleteSession(sessionId, options = {}) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('sessionId is required');
    const operationId = String(options?.operationId || '').trim();
    if (operationId) {
      const prior = this.getOperationReceipt(operationId);
      if (prior) {
        return {
          ok: true,
          replayed: true,
          operationId,
          ...prior.result
        };
      }
    }
    const counts = this.runInTransaction(() => {
      const deletedMessages = this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sid);
      const deletedToolRuns = this.db.prepare('DELETE FROM tool_runs WHERE session_id = ?').run(sid);
      const deletedCompactions = this.db.prepare('DELETE FROM session_compactions WHERE session_id = ?').run(sid);
      const deletedArtifacts = this.db.prepare('DELETE FROM memory_artifacts WHERE session_id = ?').run(sid);
      const deletedRoutes = this.db.prepare('DELETE FROM route_lessons WHERE session_id = ?').run(sid);
      const deletedLunumShadowLogs = this.db.prepare('DELETE FROM lunum_shadow_logs WHERE session_id = ?').run(sid);
      const deletedSessions = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
      return {
        deletedMessages: Number(deletedMessages?.changes || 0),
        deletedToolRuns: Number(deletedToolRuns?.changes || 0),
        deletedCompactions: Number(deletedCompactions?.changes || 0),
        deletedArtifacts: Number(deletedArtifacts?.changes || 0),
        deletedRoutes: Number(deletedRoutes?.changes || 0),
        deletedLunumShadowLogs: Number(deletedLunumShadowLogs?.changes || 0),
        deletedSessions: Number(deletedSessions?.changes || 0)
      };
    });
    const out = {
      ok: true,
      sessionId: sid,
      deleted: counts.deletedSessions > 0,
      ...counts
    };
    if (operationId) {
      this.recordOperationReceipt({
        operationId,
        operationKind: 'session_delete',
        targetRef: sid,
        result: out
      });
      out.operationId = operationId;
    }
    return out;
  }

  clearSessionMessages(sessionId) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('sessionId is required');
    this.ensureSession(sid);
    const counts = this.runInTransaction(() => {
      const deletedMessages = this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sid);
      const deletedToolRuns = this.db.prepare('DELETE FROM tool_runs WHERE session_id = ?').run(sid);
      const deletedCompactions = this.db.prepare('DELETE FROM session_compactions WHERE session_id = ?').run(sid);
      const deletedArtifacts = this.db.prepare('DELETE FROM memory_artifacts WHERE session_id = ?').run(sid);
      const deletedRoutes = this.db.prepare('DELETE FROM route_lessons WHERE session_id = ?').run(sid);
      const deletedLunumShadowLogs = this.db.prepare('DELETE FROM lunum_shadow_logs WHERE session_id = ?').run(sid);
      return {
        deletedMessages: Number(deletedMessages?.changes || 0),
        deletedToolRuns: Number(deletedToolRuns?.changes || 0),
        deletedCompactions: Number(deletedCompactions?.changes || 0),
        deletedArtifacts: Number(deletedArtifacts?.changes || 0),
        deletedRoutes: Number(deletedRoutes?.changes || 0),
        deletedLunumShadowLogs: Number(deletedLunumShadowLogs?.changes || 0)
      };
    });
    return {
      ok: true,
      sessionId: sid,
      cleared: true,
      ...counts
    };
  }

  clearSessions({ keepSessionId = '', operationId = '' } = {}) {
    const keep = String(keepSessionId || '').trim();
    const opId = String(operationId || '').trim();
    if (opId) {
      const prior = this.getOperationReceipt(opId);
      if (prior) {
        return {
          ok: true,
          replayed: true,
          operationId: opId,
          ...prior.result
        };
      }
    }
    if (keep) this.ensureSession(keep);
    const counts = this.runInTransaction(() => {
      const deletedMessages = keep
        ? this.db.prepare('DELETE FROM messages WHERE session_id != ?').run(keep)
        : this.db.prepare('DELETE FROM messages').run();
      const deletedToolRuns = keep
        ? this.db.prepare('DELETE FROM tool_runs WHERE session_id != ?').run(keep)
        : this.db.prepare('DELETE FROM tool_runs').run();
      const deletedCompactions = keep
        ? this.db.prepare('DELETE FROM session_compactions WHERE session_id != ?').run(keep)
        : this.db.prepare('DELETE FROM session_compactions').run();
      const deletedArtifacts = keep
        ? this.db.prepare('DELETE FROM memory_artifacts WHERE session_id != ?').run(keep)
        : this.db.prepare('DELETE FROM memory_artifacts').run();
      const deletedRoutes = keep
        ? this.db.prepare('DELETE FROM route_lessons WHERE session_id != ?').run(keep)
        : this.db.prepare('DELETE FROM route_lessons').run();
      const deletedLunumShadowLogs = keep
        ? this.db.prepare('DELETE FROM lunum_shadow_logs WHERE session_id != ?').run(keep)
        : this.db.prepare('DELETE FROM lunum_shadow_logs').run();
      const deletedSessions = keep
        ? this.db.prepare('DELETE FROM sessions WHERE id != ?').run(keep)
        : this.db.prepare('DELETE FROM sessions').run();
      return {
        deletedMessages: Number(deletedMessages?.changes || 0),
        deletedToolRuns: Number(deletedToolRuns?.changes || 0),
        deletedCompactions: Number(deletedCompactions?.changes || 0),
        deletedArtifacts: Number(deletedArtifacts?.changes || 0),
        deletedRoutes: Number(deletedRoutes?.changes || 0),
        deletedLunumShadowLogs: Number(deletedLunumShadowLogs?.changes || 0),
        deletedSessions: Number(deletedSessions?.changes || 0)
      };
    });
    const out = {
      ok: true,
      keepSessionId: keep || null,
      ...counts
    };
    if (opId) {
      this.recordOperationReceipt({
        operationId: opId,
        operationKind: 'session_clear',
        targetRef: keep || '*',
        result: out
      });
      out.operationId = opId;
    }
    return out;
  }

  getSessionSummary(sessionId) {
    const row = this.db
      .prepare(
        `SELECT
          s.id,
          s.created_at,
          (SELECT content FROM messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.id ASC LIMIT 1) AS first_user,
          (SELECT content FROM messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_content,
          (SELECT role FROM messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_role,
          (SELECT created_at FROM messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_message_at,
          (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
         FROM sessions s
         WHERE s.id = ?`
      )
      .get(sessionId);
    if (!row) return null;
    return {
      sessionId: row.id,
      title: summarizeSessionTitle(row.first_user || row.last_content || ''),
      preview: String(row.last_content || '').slice(0, 180),
      lastRole: row.last_role || null,
      messageCount: Number(row.message_count || 0),
      createdAt: row.created_at,
      lastMessageAt: row.last_message_at || row.created_at
    };
  }

  listSessions(limit = 80) {
    const rows = this.db
      .prepare(
        `SELECT
          s.id,
          s.created_at,
          first_user.first_user,
          latest.last_content,
          latest.last_role,
          latest.last_message_at,
          COALESCE(message_counts.message_count, 0) AS message_count
         FROM sessions s
         LEFT JOIN (
           SELECT first_message.session_id, first_message.content AS first_user
           FROM messages first_message
           INNER JOIN (
             SELECT session_id, MIN(id) AS first_user_id
             FROM messages
             WHERE role = 'user'
             GROUP BY session_id
           ) first_ids
             ON first_ids.session_id = first_message.session_id
            AND first_ids.first_user_id = first_message.id
         ) first_user
           ON first_user.session_id = s.id
         LEFT JOIN (
           SELECT latest_message.session_id,
                  latest_message.content AS last_content,
                  latest_message.role AS last_role,
                  latest_message.created_at AS last_message_at
           FROM messages latest_message
           INNER JOIN (
             SELECT session_id, MAX(id) AS latest_message_id
             FROM messages
             GROUP BY session_id
           ) latest_ids
             ON latest_ids.session_id = latest_message.session_id
            AND latest_ids.latest_message_id = latest_message.id
         ) latest
           ON latest.session_id = s.id
         LEFT JOIN (
           SELECT session_id, COUNT(*) AS message_count
           FROM messages
           GROUP BY session_id
         ) message_counts
           ON message_counts.session_id = s.id
         ORDER BY COALESCE(
           latest.last_message_at,
           s.created_at
         ) DESC
         LIMIT ?`
      )
      .all(limit);
    return rows.map((row) => ({
      sessionId: row.id,
      title: summarizeSessionTitle(row.first_user || row.last_content || ''),
      preview: String(row.last_content || '').slice(0, 180),
      lastRole: row.last_role || null,
      messageCount: Number(row.message_count || 0),
      createdAt: row.created_at,
      lastMessageAt: row.last_message_at || row.created_at
    }));
  }

  getMessages(sessionId, limit = 50) {
    return this.db
      .prepare('SELECT id, role, content, reasoning, raw_reply, lunum_code, lunum_sem_json, lunum_fp, lunum_meta_json, created_at FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?')
      .all(sessionId, limit)
      .reverse();
  }

  recordLunumShadowLog(sessionId, payload = {}) {
    const sid = String(sessionId || '').trim();
    if (!sid) return;
    const modelLabel = String(payload.modelLabel || '');
    this.db
      .prepare(
        'INSERT INTO lunum_shadow_logs (session_id, model_label, source_message_count, natural_tokens, mixed_tokens, ratio, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        sid,
        modelLabel,
        Number(payload.sourceMessageCount || 0),
        Number(payload.naturalTokens || 0),
        Number(payload.mixedTokens || 0),
        Number(payload.ratio || 1),
        JSON.stringify(payload.summary || {}),
        new Date().toISOString()
      );
  }

  listLunumShadowLogs(sessionId, limit = 20) {
    const sid = String(sessionId || '').trim();
    if (!sid) return [];
    const rows = this.db
      .prepare(
        'SELECT id, model_label, source_message_count, natural_tokens, mixed_tokens, ratio, summary_json, created_at FROM lunum_shadow_logs WHERE session_id = ? ORDER BY id DESC LIMIT ?'
      )
      .all(sid, Math.max(1, Math.min(500, Number(limit || 20))));
    return rows.map((row) => ({
      id: row.id,
      modelLabel: row.model_label,
      sourceMessageCount: Number(row.source_message_count || 0),
      naturalTokens: Number(row.natural_tokens || 0),
      mixedTokens: Number(row.mixed_tokens || 0),
      ratio: Number(row.ratio || 1),
      summary: JSON.parse(row.summary_json || '{}'),
      createdAt: row.created_at
    }));
  }

  getSession(sessionId) {
    const summary = this.getSessionSummary(sessionId);
    if (!summary) return null;
    const messages = this.getMessages(sessionId, 1000);
    return { ...summary, messages };
  }

  saveSession(session) {
    if (!session || !session.id) return null;
    this.ensureSession(session.id);
    if (Array.isArray(session.messages)) {
      return this.importSession({ sessionId: session.id, messages: session.messages });
    }
    return this.getSessionSummary(session.id);
  }

}

export function installSessionStoreMethods(TargetClass) {
  for (const name of Object.getOwnPropertyNames(SessionStoreMethods.prototype)) {
    if (name === 'constructor') continue;
    Object.defineProperty(
      TargetClass.prototype,
      name,
      Object.getOwnPropertyDescriptor(SessionStoreMethods.prototype, name)
    );
  }
}
