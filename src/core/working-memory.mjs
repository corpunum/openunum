import fs from 'node:fs';
import path from 'node:path';
import { logInfo, logError } from '../logger.mjs';

/**
 * Working Memory Anchor System
 * 
 * Keeps the original task + plan injected as a "ghost message" on every model turn.
 * Designed for weak models (9B) that lose context after 3-4 turns.
 * 
 * Structure:
 *   ANCHOR (always present, never compacted)
 *   - User origin task
 *   - Agent's initial plan
 *   - Success contract
 *   
 *   COMPACTED MIDDLE (summarized with pointer to full history)
 *   - Turns 3 to N-4 summarized
 *   - Pointer to session file for recovery
 *   
 *   RECENT TURNS (raw, last 4 turns)
 *   - Full detail for immediate context
 *   
 *   INJECTION PROMPT (directive to continue, not re-plan)
 */

export class WorkingMemoryAnchor {
  constructor({ sessionId, workspaceRoot, maxRecentTurns = 4, compactionThreshold = 12 }) {
    this.sessionId = sessionId;
    this.workspaceRoot = workspaceRoot || process.cwd();
    this.maxRecentTurns = maxRecentTurns;  // Keep last N turns raw
    this.compactionThreshold = compactionThreshold;  // Compact after N turns
    this.dataDir = path.join(this.workspaceRoot, 'data', 'working-memory');
    
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.anchor = {
      userOrigin: null,      // Original user task
      planAgreed: null,      // Agent's initial plan (may be multi-level)
      contract: null,        // Success criteria + forbidden drift
      subplans: [],          // Array of subplans if task is broken down
      currentSubplanIndex: 0,
      createdAt: null
    };
    
    this.compactedSummary = null;
    this.compactionPointer = null;  // Session ID or file path for full history
    this.turnCount = 0;
  }

  /**
   * Set the anchor (called on first turn)
   * 
   * @param {string} userTask - Original user request
   * @param {string|object} agentPlan - Initial plan (string or decomposed steps)
   * @param {object} contract - Success criteria
   */
  setAnchor(userTask, agentPlan, contract = {}) {
    const planText = typeof agentPlan === 'string' 
      ? agentPlan 
      : (agentPlan.steps || []).join(' → ');

    this.anchor = {
      userOrigin: userTask.trim(),
      planAgreed: planText,
      contract: {
        successCriteria: contract.successCriteria || 'Task completed as specified',
        forbiddenDrift: contract.forbiddenDrift || [],
        requiredOutputs: contract.requiredOutputs || [],
        ...contract
      },
      subplans: agentPlan.subplans || [],
      currentSubplanIndex: 0,
      createdAt: new Date().toISOString()
    };

    // Persist anchor to disk
    this._persistAnchor();

    logInfo('working_memory_anchor_set', {
      sessionId: this.sessionId,
      userOrigin: this.anchor.userOrigin.slice(0, 100),
      planSteps: (agentPlan.steps || []).length,
      subplans: this.anchor.subplans.length
    });
  }

  /**
   * Update current subplan (when moving to next phase of large task)
   */
  setCurrentSubplan(index) {
    if (index < 0 || index >= this.anchor.subplans.length) {
      logError('working_memory_invalid_subplan_index', { index, total: this.anchor.subplans.length });
      return false;
    }
    this.anchor.currentSubplanIndex = index;
    this._persistAnchor();
    logInfo('working_memory_subplan_changed', { index, sessionId: this.sessionId });
    return true;
  }

  /**
   * Get current subplan context
   */
  getCurrentSubplan() {
    if (!this.anchor.subplans.length) return null;
    return {
      index: this.anchor.currentSubplanIndex,
      total: this.anchor.subplans.length,
      subplan: this.anchor.subplans[this.anchor.currentSubplanIndex]
    };
  }

  /**
   * Build the injection payload for each turn
   * 
   * @param {Array} recentMessages - Last N turns (raw)
   * @param {number} totalTurns - Total turn count
   * @returns {string} Injection payload to prepend as system message
   */
  buildInjection(recentMessages, totalTurns) {
    this.turnCount = totalTurns;
    const parts = [];

    // 1. ANCHOR (always present)
    if (this.anchor.userOrigin) {
      parts.push('═══ WORKING MEMORY ANCHOR ═══');
      parts.push(`[USER ORIGIN]: ${this.anchor.userOrigin}`);
      
      if (this.anchor.planAgreed) {
        parts.push(`[PLAN AGREED]: ${this.anchor.planAgreed}`);
      }

      // Subplan context (if multi-phase task)
      const subplan = this.getCurrentSubplan();
      if (subplan) {
        parts.push(`[SUBPLAN]: ${subplan.index + 1}/${subplan.total} — ${subplan.subplan.title || 'Phase ' + (subplan.index + 1)}`);
        if (subplan.subplan.steps) {
          parts.push(`[SUBPLAN STEPS]: ${subplan.subplan.steps.join(' → ')}`);
        }
      }

      if (this.anchor.contract) {
        const c = this.anchor.contract;
        if (c.successCriteria) {
          parts.push(`[SUCCESS CRITERIA]: ${c.successCriteria}`);
        }
        if (c.requiredOutputs && c.requiredOutputs.length) {
          parts.push(`[REQUIRED OUTPUTS]: ${c.requiredOutputs.join(', ')}`);
        }
        if (c.forbiddenDrift && c.forbiddenDrift.length) {
          parts.push(`[FORBIDDEN DRIFT]: Avoid ${c.forbiddenDrift.join(', ')}`);
        }
      }

      parts.push('═══ END ANCHOR ═══\n');
    }

    // 2. COMPACTED MIDDLE (if exists)
    if (this.compactedSummary) {
      parts.push('═══ COMPACTED HISTORY ═══');
      parts.push(this.compactedSummary);
      if (this.compactionPointer) {
        parts.push(`Full detail: Session ${this.compactionPointer}`);
      }
      parts.push('═══ END COMPACTED ═══\n');
    }

    // 3. RECENT TURNS (raw, last N)
    if (recentMessages && recentMessages.length > 0) {
      parts.push('═══ RECENT TURNS ═══');
      const recent = recentMessages.slice(-this.maxRecentTurns * 2);  // *2 for user+assistant pairs
      for (const m of recent) {
        const role = m.role === 'assistant' ? 'AGENT' : (m.role === 'tool' ? 'TOOL RESULT' : 'USER');
        const content = String(m.content || '').slice(0, 800);  // Truncate each message
        parts.push(`[${role}]: ${content}`);
      }
      parts.push('═══ END RECENT ═══\n');
    }

    // 4. INJECTION PROMPT (the "ghost message" directive)
    parts.push('[CONTINUATION INSTRUCTION]:');
    parts.push('- You are mid-execution of the task in [USER ORIGIN].');
    
    const subplan = this.getCurrentSubplan();
    if (subplan) {
      parts.push(`- Focus on [SUBPLAN] ${subplan.index + 1}/${subplan.total}. Complete these steps before moving on.`);
    } else {
      parts.push('- Continue with the next concrete step from [PLAN AGREED].');
    }
    
    parts.push('- Do not re-plan. Do not explore unrelated topics.');
    parts.push('- If context is unclear, refer to the session history.');
    parts.push('- Only claim DONE when [SUCCESS CRITERIA] is fully satisfied.');
    parts.push('- If you are unsure about the original task or plan, check the ANCHOR above.\n');

    return parts.join('\n');
  }

  /**
   * Compact the middle turns (called when threshold exceeded)
   * 
   * @param {Array} allMessages - All messages in session
   * @returns {object} Compaction result
   */
  compactMiddle(allMessages) {
    const compactStart = 2;  // Skip first 2 messages (user origin + plan)
    const compactEnd = allMessages.length - (this.maxRecentTurns * 2);
    
    if (compactEnd <= compactStart) {
      return { compacted: false, reason: 'not enough messages' };
    }

    const toCompact = allMessages.slice(compactStart, compactEnd);
    
    // Generate heuristic summary
    const summary = this._generateSummary(toCompact);
    
    this.compactedSummary = summary;
    this.compactionPointer = this.sessionId;

    logInfo('working_memory_compacted', {
      sessionId: this.sessionId,
      turnsCompacted: Math.floor((compactEnd - compactStart) / 2),
      pointer: this.compactionPointer
    });

    return {
      compacted: true,
      turnsCompacted: Math.floor((compactEnd - compactStart) / 2),
      pointer: this.compactionPointer
    };
  }

  /**
   * Generate heuristic summary of compacted turns
   */
  _generateSummary(messages) {
    let toolRuns = 0;
    let fileOps = 0;
    let shellOps = 0;
    let browserOps = 0;
    const filesTouched = new Set();
    const commandsRun = [];

    for (const m of messages) {
      if (m.role === 'tool' && m.tool_call_id) {
        toolRuns++;
        try {
          const content = typeof m.content === 'string' ? JSON.parse(m.content) : m.content;
          if (content.path) filesTouched.add(content.path);
          if (content.cmd) commandsRun.push(content.cmd.slice(0, 50));
        } catch {}
      }
      
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          if (tc.function?.name?.startsWith('file_')) fileOps++;
          if (tc.function?.name === 'shell_run') shellOps++;
          if (tc.function?.name === 'browser_navigate' || tc.function?.name === 'browser_snapshot') browserOps++;
        }
      }
    }

    const parts = [
      `Turns 3-${Math.floor(messages.length / 2)}:`,
      `${toolRuns} tool runs total`,
      `${fileOps} file operations (${filesTouched.size} unique files)`,
      `${shellOps} shell commands`,
      browserOps > 0 ? `${browserOps} browser actions` : null
    ].filter(Boolean);

    if (filesTouched.size > 0 && filesTouched.size <= 5) {
      parts.push(`Files: ${[...filesTouched].join(', ')}`);
    }

    if (commandsRun.length > 0 && commandsRun.length <= 3) {
      parts.push(`Commands: ${commandsRun.join('; ')}`);
    }

    parts.push('Progress toward goal: ongoing.');

    return parts.join(' | ');
  }

  /**
   * Persist anchor to disk (survives restarts)
   */
  _persistAnchor() {
    const anchorPath = path.join(this.dataDir, `${this.sessionId}.json`);
    try {
      fs.writeFileSync(anchorPath, JSON.stringify(this.anchor, null, 2), 'utf8');
    } catch (error) {
      logError('working_memory_anchor_persist_failed', { sessionId: this.sessionId, error: error.message });
    }
  }

  /**
   * Load anchor from disk (for session resumption)
   */
  static load(sessionId, workspaceRoot) {
    const dataDir = path.join(workspaceRoot || process.cwd(), 'data', 'working-memory');
    const anchorPath = path.join(dataDir, `${sessionId}.json`);
    
    if (!fs.existsSync(anchorPath)) {
      return null;
    }

    try {
      const anchorData = JSON.parse(fs.readFileSync(anchorPath, 'utf8'));
      const anchor = new WorkingMemoryAnchor({ sessionId, workspaceRoot });
      anchor.anchor = anchorData;
      logInfo('working_memory_anchor_loaded', { sessionId });
      return anchor;
    } catch (error) {
      logError('working_memory_anchor_load_failed', { sessionId, error: error.message });
      return null;
    }
  }

  /**
   * Detect drift in model output
   * 
   * @param {string} modelOutput - Assistant's response
   * @returns {object} Drift analysis
   */
  detectDrift(modelOutput) {
    if (!this.anchor.userOrigin) {
      return { driftDetected: false, confidence: 0 };
    }

    const output = String(modelOutput || '').toLowerCase();
    const origin = this.anchor.userOrigin.toLowerCase();
    const forbidden = (this.anchor.contract?.forbiddenDrift || []).map(t => t.toLowerCase());

    // Check for forbidden topics
    const forbiddenMatches = forbidden.filter(term => output.includes(term));
    
    // Check if output references the original task
    const originKeywords = origin.split(/\s+/).filter(w => w.length > 4);
    const originMatches = originKeywords.filter(k => output.includes(k)).length;

    const driftDetected = forbiddenMatches.length > 0 || originMatches < 2;
    const confidence = driftDetected 
      ? Math.min(1.0, (forbiddenMatches.length * 0.4) + ((1 - originMatches / originKeywords.length) * 0.6))
      : 0;

    return {
      driftDetected,
      confidence,
      forbiddenMatches,
      originMatchRatio: originMatches / Math.max(1, originKeywords.length)
    };
  }

  /**
   * Generate drift correction prompt
   */
  generateDriftCorrection(driftAnalysis) {
    const parts = [
      '⚠️ FOCUS REMINDER:',
      `You are drifting from the original task.`,
      `[USER ORIGIN]: ${this.anchor.userOrigin}`,
    ];

    if (driftAnalysis.forbiddenMatches.length > 0) {
      parts.push(`You are discussing: ${driftAnalysis.forbiddenMatches.join(', ')} — this is off-topic.`);
    }

    if (driftAnalysis.originMatchRatio < 0.3) {
      parts.push('Your response does not reference the original task. Re-read the ANCHOR above.');
    }

    const subplan = this.getCurrentSubplan();
    if (subplan) {
      parts.push(`Current focus: [SUBPLAN] ${subplan.index + 1}/${subplan.total}`);
      if (subplan.subplan.steps) {
        parts.push(`Remaining: ${subplan.subplan.steps.join(' → ')}`);
      }
    }

    parts.push('Return to the task. Execute the next concrete step.');

    return parts.join('\n');
  }

  /**
   * Get anchor stats (for debugging/API)
   */
  getStats() {
    return {
      sessionId: this.sessionId,
      turnCount: this.turnCount,
      anchorSet: Boolean(this.anchor.userOrigin),
      subplanCount: this.anchor.subplans.length,
      currentSubplan: this.anchor.currentSubplanIndex,
      compactionActive: Boolean(this.compactedSummary),
      compactionPointer: this.compactionPointer,
      dataFile: path.join(this.dataDir, `${this.sessionId}.json`)
    };
  }
}

/**
 * Factory function to create or load working memory anchor
 */
export function getWorkingMemory({ sessionId, workspaceRoot, userTask = null, agentPlan = null, contract = null }) {
  // Try to load existing anchor first
  const existing = WorkingMemoryAnchor.load(sessionId, workspaceRoot);
  if (existing) {
    return existing;
  }

  // Create new anchor if userTask provided
  if (userTask) {
    const anchor = new WorkingMemoryAnchor({ sessionId, workspaceRoot });
    anchor.setAnchor(userTask, agentPlan || 'Execute task', contract || {});
    return anchor;
  }

  // No anchor available
  return null;
}
