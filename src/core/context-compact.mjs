import { estimateMessagesTokens } from './context-budget.mjs';
import { SleepCycle } from './sleep-cycle.mjs';

function truncateText(text, maxChars) {
  const t = String(text || '').trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)} ...[compacted]`;
}

function extractFileRefs(text) {
  const matches = String(text || '').match(/(?:\/[\w.-]+)+|(?:[\w.-]+\/)+[\w.-]+/g) || [];
  return [...new Set(matches)].slice(0, 6);
}

function buildArtifact(type, content, sourceRef = '', metadata = {}) {
  return { type, content: String(content || ''), sourceRef: String(sourceRef || ''), metadata };
}

/**
 * Extract verified facts from messages (statements confirmed by tool results or user confirmation)
 */
function extractVerifiedFacts(messages) {
  const facts = [];
  for (const m of messages) {
    const text = String(m.content || '');
    const role = m.role || 'unknown';
    
    // Look for confirmed statements
    if (role === 'assistant') {
      // File created/modified confirmations
      const fileCreated = text.match(/(?:created|wrote|saved|modified)\s+(?:file|directory)\s+([`"]?[\/\w.-]+[`"]?)/i);
      if (fileCreated) {
        facts.push(buildArtifact('verified_fact', `File created/modified: ${fileCreated[1]}`, `msg:${m.id || ''}`, { verified: true }));
      }
      
      // Test pass confirmations
      if (/tests?\s+(?:passed|succeeded|ok)/i.test(text) && /\d+\/\d+/i.test(text)) {
        facts.push(buildArtifact('verified_fact', 'Tests passed', `msg:${m.id || ''}`, { verified: true }));
      }
      
      // Git operations
      const gitCommit = text.match(/committed\s+([a-f0-9]+)/i);
      if (gitCommit) {
        facts.push(buildArtifact('verified_fact', `Git commit: ${gitCommit[1]}`, `msg:${m.id || ''}`, { verified: true }));
      }
    }
  }
  return facts;
}

/**
 * Extract open loops (questions asked but not answered, tasks started but not finished)
 */
function extractOpenLoops(messages) {
  const loops = [];
  const answeredQuestions = new Set();
  const askedQuestions = [];
  
  for (const m of messages) {
    const text = String(m.content || '');
    const role = m.role || 'unknown';
    
    if (role === 'user') {
      // Detect questions
      if (/\?$/.test(text) || /^(can|could|will|would|do|does|is|are|what|how|why|when|where)/i.test(text)) {
        askedQuestions.push({ text: text.slice(0, 200), id: m.id || '' });
      }
    } else if (role === 'assistant') {
      // Track answered questions
      for (const q of askedQuestions) {
        if (text.toLowerCase().includes(q.text.toLowerCase().slice(0, 50))) {
          answeredQuestions.add(q.id);
        }
      }
    }
  }
  
  // Unanswered questions are open loops
  for (const q of askedQuestions) {
    if (!answeredQuestions.has(q.id)) {
      loops.push(buildArtifact('open_loop', `Unanswered: ${q.text}`, `msg:${q.id}`, { type: 'question' }));
    }
  }
  
  // Look for incomplete tasks
  for (const m of messages) {
    const text = String(m.content || '');
    if (m.role === 'assistant') {
      if (/will now|starting|beginning|about to/i.test(text) && !/(?:completed|finished|done)/i.test(text)) {
        // Check if next messages show completion
        loops.push(buildArtifact('open_loop', `Potentially incomplete: ${text.slice(0, 100)}`, `msg:${m.id || ''}`, { type: 'task' }));
      }
    }
  }
  
  return loops;
}

/**
 * Extract pending subgoals from task decomposition
 */
function extractPendingSubgoals(messages) {
  const subgoals = [];
  
  for (const m of messages) {
    const text = String(m.content || '');
    
    // Detect subplan/phase markers
    if (/phase \d+|step \d+|subplan|subgoal/i.test(text)) {
      const lines = text.split('\n');
      for (const line of lines) {
        if (/^\s*[-*•]\s*(?:phase|step|subplan|subgoal)/i.test(line) || /^\s*\d+\.\s+/i.test(line)) {
          const goal = line.trim();
          // Check if marked as complete
          if (!/(?:completed|done|✓|✅)/i.test(goal)) {
            subgoals.push(buildArtifact('pending_subgoal', goal, `msg:${m.id || ''}`));
          }
        }
      }
    }
  }
  
  return subgoals;
}

/**
 * Extract failures with reasons (error messages, tool failures, timeouts)
 */
function extractFailuresWithReasons(messages) {
  const failures = [];
  
  for (const m of messages) {
    const text = String(m.content || '');
    const role = m.role || 'unknown';
    
    if (role === 'assistant' || role === 'tool') {
      // Error patterns
      const errorMatch = text.match(/(?:error|failed|failure|timeout|denied|exception)[:\s]+(.{10,200})/i);
      if (errorMatch) {
        failures.push(buildArtifact('failure_with_reason', errorMatch[1].trim(), `msg:${m.id || ''}`, { 
          errorType: errorMatch[0].split(':')[0].toLowerCase() 
        }));
      }
      
      // Tool-specific failures
      if (/tool.*failed|invocation.*error/i.test(text)) {
        failures.push(buildArtifact('failure_with_reason', 'Tool invocation failed', `msg:${m.id || ''}`, { errorType: 'tool_failure' }));
      }
    }
  }
  
  return failures;
}

/**
 * Extract produced artifacts (files created, code written, tests added, docs updated)
 */
function extractProducedArtifacts(messages) {
  const artifacts = [];
  
  for (const m of messages) {
    const text = String(m.content || '');
    const role = m.role || 'unknown';
    
    if (role === 'assistant') {
      // File creation
      const fileMatches = text.matchAll(/(?:created|wrote|saved)\s+(?:file)?\s*[:\s]*([`"]?[\/\w.-]+\.[\w]+[`"]?)/gi);
      for (const match of fileMatches) {
        const path = match[1].replace(/[`"']/g, '');
        artifacts.push(buildArtifact('produced_artifact', `File: ${path}`, `msg:${m.id || ''}`, { artifactType: 'file', path }));
      }
      
      // Code blocks
      const codeBlocks = (text.match(/```[\w]*\n[\s\S]{50,} ```/g) || []);
      for (let i = 0; i < Math.min(codeBlocks.length, 3); i++) {
        artifacts.push(buildArtifact('produced_artifact', 'Code block', `msg:${m.id || ''}`, { artifactType: 'code', index: i }));
      }
      
      // Tests
      if (/test.*added|added.*test/i.test(text)) {
        artifacts.push(buildArtifact('produced_artifact', 'Test added', `msg:${m.id || ''}`, { artifactType: 'test' }));
      }
      
      // Documentation
      if (/docs?\s+(?:updated|created|added)/i.test(text)) {
        artifacts.push(buildArtifact('produced_artifact', 'Documentation updated', `msg:${m.id || ''}`, { artifactType: 'docs' }));
      }
    }
  }
  
  return artifacts;
}

function summarizeOldMessages(oldMessages, preserveUserBias = 0.85, assistantAggression = 0.6) {
  const lines = [];
  const basicArtifacts = [];
  
  for (const m of oldMessages) {
    const role = m.role || 'unknown';
    if (role === 'user') {
      const keep = Math.max(120, Math.floor(380 * preserveUserBias));
      const text = truncateText(m.content, keep);
      lines.push(`USER: ${text}`);
      if (/must|require|don't|do not|always|never|should/i.test(text)) {
        basicArtifacts.push(buildArtifact('constraint', text, `msg:${m.id || ''}`));
      }
    } else {
      const keep = Math.max(80, Math.floor(240 * (1 - assistantAggression)));
      const text = truncateText(m.content, keep);
      lines.push(`${role.toUpperCase()}: ${text}`);
      if (/failed|error|timeout|denied/i.test(text)) {
        basicArtifacts.push(buildArtifact('failure', text, `msg:${m.id || ''}`));
      }
      const refs = extractFileRefs(text);
      for (const ref of refs) basicArtifacts.push(buildArtifact('file_ref', ref, `msg:${m.id || ''}`));
    }
  }
  
  // Enriched artifact extraction
  const verifiedFacts = extractVerifiedFacts(oldMessages);
  const openLoops = extractOpenLoops(oldMessages);
  const pendingSubgoals = extractPendingSubgoals(oldMessages);
  const failuresWithReasons = extractFailuresWithReasons(oldMessages);
  const producedArtifacts = extractProducedArtifacts(oldMessages);
  
  return { 
    summaryText: lines.join('\n'), 
    artifacts: basicArtifacts,
    enrichedArtifacts: {
      verifiedFacts,
      openLoops,
      pendingSubgoals,
      failuresWithReasons,
      producedArtifacts
    }
  };
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
    return { compactedMessages: [], cutoffMessageId: 0, summary: {}, artifacts: [], enrichedArtifacts: {}, preTokens: 0, postTokens: 0 };
  }

  const protectEntries = Math.max(2, Number(protectRecentTurns || 8) * 2);
  if (all.length <= protectEntries + 1) {
    const pre = estimateMessagesTokens(all);
    return {
      compactedMessages: all.map((m) => ({ role: m.role, content: m.content })),
      cutoffMessageId: 0,
      summary: { note: 'no_compaction_needed' },
      artifacts: [],
      enrichedArtifacts: {},
      preTokens: pre,
      postTokens: pre
    };
  }

  const oldMessages = all.slice(0, -protectEntries);
  const recent = all.slice(-protectEntries);
  const preTokens = estimateMessagesTokens(all.map((m) => ({ role: m.role, content: m.content })));

  const { summaryText, artifacts, enrichedArtifacts } = summarizeOldMessages(oldMessages, preserveUserVerbatimBias, assistantCompressionAggression);
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
    enrichedArtifacts,
    preTokens,
    postTokens
  };
}

export function trimMessagesToTokenBudget({
  messages,
  maxTokens,
  preserveFirstSystem = true,
  minRecentMessages = 10
} = {}) {
  const rows = Array.isArray(messages) ? messages.map((m) => ({ role: m.role, content: m.content })) : [];
  const effectiveMaxTokens = Math.max(256, Number(maxTokens || 0));
  const preTokens = estimateMessagesTokens(rows);
  if (!rows.length || !Number.isFinite(effectiveMaxTokens) || preTokens <= effectiveMaxTokens) {
    return {
      messages: rows,
      preTokens,
      postTokens: preTokens,
      droppedCount: 0
    };
  }

  const front = [];
  const startIndex = preserveFirstSystem && rows[0]?.role === 'system' ? 1 : 0;
  if (startIndex === 1) front.push(rows[0]);

  const candidates = rows.slice(startIndex);
  const minKeep = Math.max(1, Number(minRecentMessages || 10));
  const keptTail = [];
  let kept = 0;

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const nextTail = [candidates[i], ...keptTail];
    const nextRows = [...front, ...nextTail];
    const nextTokens = estimateMessagesTokens(nextRows);
    if (kept < minKeep || nextTokens <= effectiveMaxTokens) {
      keptTail.unshift(candidates[i]);
      kept += 1;
      continue;
    }
  }

  const trimmed = [...front, ...keptTail];
  return {
    messages: trimmed,
    preTokens,
    postTokens: estimateMessagesTokens(trimmed),
    droppedCount: Math.max(0, rows.length - trimmed.length)
  };
}

/**
 * Create a sleep-aware compaction wrapper (R9).
 */
export function createSleepAwareCompactor({ targetTokens, idleThresholdMs = 3600000, consolidator = null, protectRecentTurns = 8 } = {}) {
  const compactFn = async (opts = {}) => {
    const turns = opts.aggressive ? Math.max(2, Math.floor(protectRecentTurns / 2)) : protectRecentTurns;
    return compactSessionMessages({
      messages: opts.messages || [],
      targetTokens: opts.targetTokens || targetTokens,
      protectRecentTurns: turns,
      preserveUserVerbatimBias: 0.9,
      assistantCompressionAggression: opts.aggressive ? 0.8 : 0.6
    });
  };

  const sleepCycle = new SleepCycle({ compactFn, consolidator, idleThresholdMs });

  async function compactWithSleep(opts = {}) {
    sleepCycle.touchActivity();
    const { triggered } = await sleepCycle.checkAndSleep();
    const result = compactSessionMessages({
      messages: opts.messages || [],
      targetTokens: opts.targetTokens || targetTokens,
      protectRecentTurns: opts.protectRecentTurns || protectRecentTurns,
      preserveUserVerbatimBias: opts.preserveUserVerbatimBias || 0.85,
      assistantCompressionAggression: opts.assistantCompressionAggression || 0.6
    });
    result.sleepTriggered = triggered;
    result.sleepState = sleepCycle.getState();
    return result;
  }

  return { sleepCycle, compactWithSleep, compactFn: compactSessionMessages };
}

export { SleepCycle } from './sleep-cycle.mjs';
