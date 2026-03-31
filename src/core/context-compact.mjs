import { estimateMessagesTokens } from './context-budget.mjs';

function truncateText(text, maxChars) {
  const t = String(text || '').trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)} ...[compacted]`;
}

function extractFileRefs(text) {
  const matches = String(text || '').match(/(?:\/[\w.-]+)+|(?:[\w.-]+\/)+[\w.-]+/g) || [];
  return [...new Set(matches)].slice(0, 6);
}

function buildArtifact(type, content, sourceRef = '') {
  return { type, content: String(content || ''), sourceRef: String(sourceRef || '') };
}

function summarizeOldMessages(oldMessages, preserveUserBias = 0.85, assistantAggression = 0.6) {
  const lines = [];
  const artifacts = [];
  for (const m of oldMessages) {
    const role = m.role || 'unknown';
    if (role === 'user') {
      const keep = Math.max(120, Math.floor(380 * preserveUserBias));
      const text = truncateText(m.content, keep);
      lines.push(`USER: ${text}`);
      if (/must|require|don't|do not|always|never|should/i.test(text)) {
        artifacts.push(buildArtifact('constraint', text, `msg:${m.id || ''}`));
      }
    } else {
      const keep = Math.max(80, Math.floor(240 * (1 - assistantAggression)));
      const text = truncateText(m.content, keep);
      lines.push(`${role.toUpperCase()}: ${text}`);
      if (/failed|error|timeout|denied/i.test(text)) {
        artifacts.push(buildArtifact('failure', text, `msg:${m.id || ''}`));
      }
      const refs = extractFileRefs(text);
      for (const ref of refs) artifacts.push(buildArtifact('file_ref', ref, `msg:${m.id || ''}`));
    }
  }
  return { summaryText: lines.join('\n'), artifacts };
}

export function compactSessionMessages({
  messages,
  targetTokens,
  protectRecentTurns = 8,
  preserveUserVerbatimBias = 0.85,
  assistantCompressionAggression = 0.6
}) {
  const all = Array.isArray(messages) ? messages : [];
  if (!all.length) {
    return { compactedMessages: [], cutoffMessageId: 0, summary: {}, artifacts: [], preTokens: 0, postTokens: 0 };
  }

  const protectEntries = Math.max(2, Number(protectRecentTurns || 8) * 2);
  if (all.length <= protectEntries + 1) {
    const pre = estimateMessagesTokens(all);
    return {
      compactedMessages: all.map((m) => ({ role: m.role, content: m.content })),
      cutoffMessageId: 0,
      summary: { note: 'no_compaction_needed' },
      artifacts: [],
      preTokens: pre,
      postTokens: pre
    };
  }

  const oldMessages = all.slice(0, -protectEntries);
  const recent = all.slice(-protectEntries);
  const preTokens = estimateMessagesTokens(all.map((m) => ({ role: m.role, content: m.content })));

  const { summaryText, artifacts } = summarizeOldMessages(oldMessages, preserveUserVerbatimBias, assistantCompressionAggression);
  const checkpoint = {
    role: 'system',
    content:
      'SESSION COMPACTION CHECKPOINT (older messages summarized):\n' +
      truncateText(summaryText, Math.max(1200, Math.floor(targetTokens * 3.5)))
  };

  const compacted = [checkpoint, ...recent.map((m) => ({ role: m.role, content: m.content }))];
  const postTokens = estimateMessagesTokens(compacted);
  const cutoffMessageId = Number(oldMessages[oldMessages.length - 1]?.id || 0);
  const summary = {
    compactedCount: oldMessages.length,
    protectedCount: recent.length,
    createdAt: new Date().toISOString()
  };

  return {
    compactedMessages: compacted,
    cutoffMessageId,
    summary,
    artifacts,
    preTokens,
    postTokens
  };
}

