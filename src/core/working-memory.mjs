import fs from 'node:fs';
import path from 'node:path';
import { getHomeDir } from '../config.mjs';
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
    this.dataDir = resolveWorkingMemoryDir(this.workspaceRoot);
    
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
   * PHASE 2 OPTIMIZATION: Split into static prefix + dynamic JSON state
   * 
   * @param {Array} recentMessages - Last N turns (raw)
   * @param {number} totalTurns - Total turn count
   * @returns {object} { staticPrefix, dynamicState, fullInjection, cacheHints }
   */
  buildInjection(recentMessages, totalTurns) {
    this.turnCount = totalTurns;
    
    // STATIC PREFIX (rarely changes, can be cached across turns)
    const staticParts = [];
    staticParts.push('═══ WORKING MEMORY ANCHOR ═══');
    staticParts.push(`[USER ORIGIN]: ${this.anchor.userOrigin || 'Not set'}`);
    
    if (this.anchor.planAgreed) {
      staticParts.push(`[PLAN AGREED]: ${this.anchor.planAgreed}`);
    }

    // Subplan context (changes only when moving between phases)
    const subplan = this.getCurrentSubplan();
    if (subplan) {
      staticParts.push(`[SUBPLAN]: ${subplan.index + 1}/${subplan.total} — ${subplan.subplan.title || 'Phase ' + (subplan.index + 1)}`);
      if (subplan.subplan.steps) {
        staticParts.push(`[SUBPLAN STEPS]: ${subplan.subplan.steps.join(' → ')}`);
      }
    }

    if (this.anchor.contract) {
      const c = this.anchor.contract;
      if (c.successCriteria) {
        staticParts.push(`[SUCCESS CRITERIA]: ${c.successCriteria}`);
      }
      if (c.requiredOutputs && c.requiredOutputs.length) {
        staticParts.push(`[REQUIRED OUTPUTS]: ${c.requiredOutputs.join(', ')}`);
      }
      if (c.forbiddenDrift && c.forbiddenDrift.length) {
        staticParts.push(`[FORBIDDEN DRIFT]: Avoid ${c.forbiddenDrift.join(', ')}`);
      }
    }

    staticParts.push('═══ END ANCHOR ═══\n');

    // DYNAMIC STATE (changes every turn)
    const dynamicState = {
      turnCount: this.turnCount,
      compactedSummary: this.compactedSummary,
      compactionPointer: this.compactionPointer,
      recentTurns: [],
      continuationInstruction: {
        isMidExecution: true,
        focusSubplan: subplan ? { index: subplan.index, total: subplan.total } : null,
        doNotReplan: true,
        onlyClaimDoneWhenCriteriaMet: true
      }
    };

    // Recent turns (raw, last N)
    // Phase 4: Skip recent turns for simple greetings to avoid stale context confusion
    if (recentMessages && recentMessages.length > 0) {
      const isSimpleGreeting = this._isSimpleGreeting(recentMessages);
      
      if (!isSimpleGreeting) {
        const recent = recentMessages.slice(-this.maxRecentTurns * 2);
        dynamicState.recentTurns = recent.map(m => ({
          role: m.role === 'assistant' ? 'AGENT' : (m.role === 'tool' ? 'TOOL_RESULT' : 'USER'),
          content: String(m.content || '').slice(0, 800),
          timestamp: m.created_at || null
        }));
      } else {
        // For greetings, only include the current user message, not stale history
        const lastUserMessage = recentMessages.filter(m => m.role === 'user').slice(-1);
        dynamicState.recentTurns = lastUserMessage.map(m => ({
          role: 'USER',
          content: String(m.content || '').slice(0, 800),
          timestamp: m.created_at || null
        }));
      }
    }

    // CACHE HINTS (which sections can be cached)
    const cacheHints = {
      staticPrefix: {
        cacheable: true,
        invalidatesOn: ['subplan_change', 'anchor_update'],
        ttl: 'session'
      },
      dynamicState: {
        cacheable: false,
        changesEvery: 'turn'
      },
      recentTurns: {
        cacheable: false,
        changesEvery: 'turn'
      }
    };

    // Build full injection (for backward compatibility)
    const parts = [...staticParts];
    
    if (this.compactedSummary) {
      parts.push('═══ COMPACTED HISTORY ═══');
      parts.push(this.compactedSummary);
      if (this.compactionPointer) {
        parts.push(`Full detail: Session ${this.compactionPointer}`);
      }
      parts.push('═══ END COMPACTED ═══\n');
    }

    if (dynamicState.recentTurns.length > 0) {
      parts.push('═══ RECENT TURNS ═══');
      for (const m of dynamicState.recentTurns) {
        parts.push(`[${m.role}]: ${m.content}`);
      }
      parts.push('═══ END RECENT ═══\n');
    }

    // Continuation instruction (skip for greetings)
    const isGreeting = this._isSimpleGreeting(recentMessages);
    
    if (!isGreeting && (this.hasAnchor() || dynamicState.recentTurns.length > 0)) {
      parts.push('[CONTINUATION INSTRUCTION]:');
      parts.push('- You are mid-execution of the task in [USER ORIGIN].');
      
      if (subplan) {
        parts.push(`- Focus on [SUBPLAN] ${subplan.index + 1}/${subplan.total}. Complete these steps before moving on.`);
      } else {
        parts.push('- Continue with the next concrete step from [PLAN AGREED].');
      }
      
      parts.push('- Do not re-plan. Do not explore unrelated topics.');
      parts.push('- If context is unclear, refer to the session history.');
      parts.push('- Only claim DONE when [SUCCESS CRITERIA] is fully satisfied.');
      parts.push('- If you are unsure about the original task or plan, check the ANCHOR above.\n');
    }

    return {
      staticPrefix: staticParts.join('\n'),
      dynamicState,
      fullInjection: parts.join('\n'),
      cacheHints
    };
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
    const dataDir = resolveWorkingMemoryDir(workspaceRoot);
    const anchorPath = path.join(dataDir, `${sessionId}.json`);

    if (!fs.existsSync(anchorPath)) {
      const legacyDir = path.join(workspaceRoot || process.cwd(), 'data', 'working-memory');
      const legacyPath = path.join(legacyDir, `${sessionId}.json`);
      if (legacyDir !== dataDir && fs.existsSync(legacyPath)) {
        return WorkingMemoryAnchor.loadFromPath(sessionId, workspaceRoot, legacyPath);
      }
      return null;
    }

    return WorkingMemoryAnchor.loadFromPath(sessionId, workspaceRoot, anchorPath);
  }

  static loadFromPath(sessionId, workspaceRoot, anchorPath) {
    try {
      const anchorData = JSON.parse(fs.readFileSync(anchorPath, 'utf8'));
      const anchor = new WorkingMemoryAnchor({ sessionId, workspaceRoot });
      anchor.anchor = anchorData;
      logInfo('working_memory_anchor_loaded', { sessionId, anchorPath });
      return anchor;
    } catch (error) {
      logError('working_memory_anchor_load_failed', { sessionId, error: error.message, anchorPath });
      return null;
    }
  }

  /**
   * Check if a query is about the current task (for fast-path routing)
   * 
   * @param {string} query - User's query/message
   * @returns {boolean} True if query is about current task state
   */
  isAboutCurrentTask(query) {
    if (!this.hasAnchor()) return false;
    
    const normalizedQuery = String(query || '').toLowerCase().trim();
    
    // Task-meta patterns
    const taskMetaPatterns = [
      /\b(current )?(task|step|goal|plan)\b/,
      /\bwhat (is|'s|am|i) (my|the|our) (current )?(task|step|goal|plan)\b/,
      /\bwhere (are|is) (we|you|i)\b/,
      /\bwhat should i do\b/,
      /\bwhat am i doing\b/
    ];
    
    for (const pattern of taskMetaPatterns) {
      if (pattern.test(normalizedQuery)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check if message is a simple greeting (Phase 4 fix)
   * Prevents stale context injection for greetings
   * 
   * @param {Array} messages - Recent messages
   * @returns {boolean} True if this is a simple greeting
   * @private
   */
  _isSimpleGreeting(messages) {
    if (!messages || messages.length === 0) return false;
    
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') return false;
    
    // Normalize: lowercase, remove punctuation, collapse spaces
    const content = String(lastMessage.content || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Simple greetings (1-3 words, no complex intent)
    const greetingPatterns = [
      /^hi\s*$/i,
      /^hello\s*$/i,
      /^hi\s+[a-z]+\s*$/i,  // "Hi there", "Hi John"
      /^hello\s+[a-z]+\s*$/i,  // "Hello Openunum", "Hello friend"
      /^hey\s*$/i,
      /^hey\s+[a-z]+\s*$/i,  // "Hey there"
      /^good\s*(morning|afternoon|evening)\s*$/i,
      /^morning\s*$/i,
      /^afternoon\s*$/i,
      /^evening\s*$/i,
      /^yo\s*$/i,
      /^greetings\s*$/i,
      /^[a-z]+\s*$/i  // Single word like names ("Cemeral")
    ];
    
    // Must be short (under 30 chars after normalization) and match a greeting pattern
    if (content.length < 30) {
      for (const pattern of greetingPatterns) {
        if (pattern.test(content)) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Check if anchor is set
   * @returns {boolean}
   */
  hasAnchor() {
    return Boolean(this.anchor?.userOrigin);
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

  /**
   * PHASE 1.1 MERGE: Task Tracker functionality absorbed into Working Memory
   * 
   * Track step completion state within the anchor
   */
  initTaskSteps(steps) {
    if (!Array.isArray(steps) || steps.length === 0) return;
    
    this.anchor.taskSteps = steps.map((step, index) => ({
      index,
      description: step.description || step.text || `Step ${index + 1}`,
      status: 'pending', // pending | in_progress | completed | failed
      completedAt: null,
      result: null,
      startedAt: null
    }));
    
    this._persistAnchor();
    logInfo('working_memory_task_steps_init', {
      sessionId: this.sessionId,
      stepCount: steps.length
    });
  }

  /**
   * Mark a step as in progress
   */
  startStep(stepIndex) {
    const step = this.anchor.taskSteps?.[stepIndex];
    if (!step) {
      logError('working_memory_step_not_found', { stepIndex, sessionId: this.sessionId });
      return null;
    }
    
    // Mark previous step as completed if it was in_progress
    const prevStep = this.anchor.taskSteps?.[stepIndex - 1];
    if (prevStep?.status === 'in_progress') {
      prevStep.status = 'completed';
      prevStep.completedAt = new Date().toISOString();
    }
    
    step.status = 'in_progress';
    step.startedAt = new Date().toISOString();
    this._persistAnchor();
    
    logInfo('working_memory_step_started', {
      sessionId: this.sessionId,
      stepIndex,
      description: step.description
    });
    
    return step;
  }

  /**
   * Mark a step as completed with result
   */
  completeStep(stepIndex, result = {}) {
    const step = this.anchor.taskSteps?.[stepIndex];
    if (!step) {
      logError('working_memory_step_not_found', { stepIndex, sessionId: this.sessionId });
      return null;
    }
    
    step.status = 'completed';
    step.completedAt = new Date().toISOString();
    step.result = result;
    this._persistAnchor();
    
    logInfo('working_memory_step_completed', {
      sessionId: this.sessionId,
      stepIndex,
      description: step.description
    });
    
    return step;
  }

  /**
   * Mark a step as failed
   */
  failStep(stepIndex, reason) {
    const step = this.anchor.taskSteps?.[stepIndex];
    if (!step) return null;
    
    step.status = 'failed';
    step.completedAt = new Date().toISOString();
    step.result = { error: reason };
    this._persistAnchor();
    
    logError('working_memory_step_failed', {
      sessionId: this.sessionId,
      stepIndex,
      reason
    });
    
    return step;
  }

  /**
   * Get task progress summary
   */
  getTaskProgress() {
    const steps = this.anchor.taskSteps || [];
    const total = steps.length;
    const completed = steps.filter(s => s.status === 'completed').length;
    const failed = steps.filter(s => s.status === 'failed').length;
    const inProgress = steps.filter(s => s.status === 'in_progress').length;
    const pending = steps.filter(s => s.status === 'pending').length;
    
    return {
      total,
      completed,
      failed,
      inProgress,
      pending,
      percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0,
      currentStep: steps.find(s => s.status === 'in_progress')?.index || null
    };
  }

  /**
   * Check if all steps are complete (no pending or in_progress)
   */
  areAllStepsComplete() {
    const steps = this.anchor.taskSteps || [];
    if (steps.length === 0) return false;
    return steps.every(s => s.status === 'completed');
  }

  /**
   * Get remaining steps
   */
  getRemainingSteps() {
    const steps = this.anchor.taskSteps || [];
    return steps
      .filter(s => s.status === 'pending' || s.status === 'in_progress')
      .map(s => ({ index: s.index, description: s.description, status: s.status }));
  }

  /**
   * Get completed steps with results
   */
  getCompletedSteps() {
    const steps = this.anchor.taskSteps || [];
    return steps
      .filter(s => s.status === 'completed')
      .map(s => ({ index: s.index, description: s.description, result: s.result }));
  }
}

export function resolveWorkingMemoryDir(workspaceRoot = '') {
  const homeDir = getHomeDir();
  return path.join(homeDir, 'working-memory');
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
