import fs from 'node:fs';
import path from 'node:path';
import { logInfo, logError } from '../logger.mjs';

/**
 * Context Compiler — Ordered Pipeline for Context Assembly
 * 
 * Builds the final context payload sent to the LLM with strict ordering:
 * 1. Static system instructions (cached, rarely changes)
 * 2. Execution state (semi-static — task progress, tool history)
 * 3. Working memory anchor (dynamic — origin task, plan, contract)
 * 4. Recalled memories (dynamic — retrieved from hybrid retrieval)
 * 5. Recent turns (last 4 pairs, raw — full detail)
 * 
 * This ordering ensures:
 * - Critical instructions are never lost to compaction
 * - Model always knows "where we are" in the task
 * - Recent context is fresh and complete
 */

export class ContextCompiler {
  constructor({ workspaceRoot, maxRecentTurns = 4 }) {
    this.workspaceRoot = workspaceRoot || process.cwd();
    this.maxRecentTurns = maxRecentTurns;
    this.staticCache = null;
    this.staticCachePath = path.join(this.workspaceRoot, 'data', 'static-system-instructions.md');
  }

  /**
   * Load or generate static system instructions
   * @returns {string}
   */
  getStaticInstructions() {
    if (this.staticCache) {
      return this.staticCache;
    }

    try {
      if (fs.existsSync(this.staticCachePath)) {
        this.staticCache = fs.readFileSync(this.staticCachePath, 'utf-8');
        logInfo('static_instructions_loaded', { path: this.staticCachePath });
        return this.staticCache;
      }
    } catch (error) {
      logError('static_instructions_load_failed', { error: String(error.message || error) });
    }

    // Default system instructions
    this.staticCache = this._generateDefaultStaticInstructions();
    
    // Persist for next time
    try {
      const dir = path.dirname(this.staticCachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.staticCachePath, this.staticCache);
      logInfo('static_instructions_cached', { path: this.staticCachePath });
    } catch (error) {
      logError('static_instructions_cache_write_failed', { error: String(error.message || error) });
    }

    return this.staticCache;
  }

  /**
   * Generate default static instructions
   * @returns {string}
   */
  _generateDefaultStaticInstructions() {
    return `# OpenUnum System Instructions

## Role
You are OpenUnum, an autonomous AI assistant with tool execution capabilities.

## Core Principles
1. **Be genuinely helpful, not performatively helpful** — Skip filler, just help
2. **Have opinions** — You can disagree, prefer things, find stuff amusing or boring
3. **Be resourceful before asking** — Try to figure it out first, then ask if stuck
4. **Earn trust through competence** — Come back with answers, not questions
5. **Remember you're a guest** — Treat access with respect

## Safety Boundaries
- Private things stay private. Period.
- When in doubt, ask before acting externally.
- Never send half-baked replies.
- You're not the user's voice — be careful in group contexts.

## Tool Usage
- Use tools to accomplish tasks, not as a substitute for thinking
- Always verify tool results before claiming success
- If a tool fails, try alternatives or explain the limitation
- Log tool usage for traceability

## Response Format
- Be concise when possible, thorough when it matters
- Use markdown for structure (headings, lists, code blocks)
- Include evidence/proof for claims (file paths, git hashes, test output)
- If uncertain, say so and explain what would resolve the uncertainty
`;
  }

  /**
   * Build execution state section
   * @param {object} executionState 
   * @returns {string}
   */
  buildExecutionState(executionState = {}) {
    const {
      taskId,
      currentStep,
      totalSteps,
      completedSteps,
      failedSteps,
      toolHistory,
      currentSubplan
    } = executionState;

    const parts = ['## Execution State'];

    if (taskId) {
      parts.push(`**Task ID**: ${taskId}`);
    }

    if (currentSubplan) {
      parts.push(`**Current Phase**: ${currentSubplan.title || `Phase ${currentSubplan.index + 1}`}`);
      if (currentSubplan.steps) {
        parts.push(`**Phase Steps**: ${currentSubplan.steps.join(' → ')}`);
      }
    }

    if (Number.isFinite(currentStep) && Number.isFinite(totalSteps)) {
      parts.push(`**Progress**: Step ${currentStep + 1}/${totalSteps}`);
    }

    if (Array.isArray(completedSteps) && completedSteps.length > 0) {
      parts.push(`**Completed**: ${completedSteps.length} steps`);
    }

    if (Array.isArray(failedSteps) && failedSteps.length > 0) {
      parts.push(`**Failed**: ${failedSteps.length} steps (see trace for details)`);
    }

    if (Array.isArray(toolHistory) && toolHistory.length > 0) {
      const recentTools = toolHistory.slice(-5);
      parts.push(`**Recent Tools**: ${recentTools.map(t => t.tool || t.name).join(', ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Build working memory anchor section
   * @param {object} anchor 
   * @returns {string}
   */
  buildWorkingMemoryAnchor(anchor = {}) {
    const { userOrigin, planAgreed, contract, subplans, currentSubplanIndex } = anchor;

    const parts = ['## Working Memory Anchor'];

    if (userOrigin) {
      parts.push(`### Original Task`);
      parts.push(userOrigin);
      parts.push('');
    }

    if (planAgreed) {
      parts.push(`### Agreed Plan`);
      parts.push(planAgreed);
      parts.push('');
    }

    if (contract) {
      parts.push(`### Success Contract`);
      if (contract.successCriteria) {
        parts.push(`**Success**: ${contract.successCriteria}`);
      }
      if (contract.forbiddenDrift && contract.forbiddenDrift.length > 0) {
        parts.push(`**Forbidden Drift**: ${contract.forbiddenDrift.join(', ')}`);
      }
      if (contract.requiredOutputs && contract.requiredOutputs.length > 0) {
        parts.push(`**Required Outputs**: ${contract.requiredOutputs.join(', ')}`);
      }
      parts.push('');
    }

    if (subplans && subplans.length > 0) {
      parts.push(`### Subplans (${currentSubplanIndex + 1}/${subplans.length})`);
      subplans.forEach((sp, i) => {
        const marker = i === currentSubplanIndex ? '→ ' : '  ';
        const title = sp.title || `Phase ${i + 1}`;
        parts.push(`${marker}${title}`);
      });
      parts.push('');
    }

    return parts.join('\n');
  }

  /**
   * Build recalled memories section
   * @param {Array<{id: string, text: string, metadata: object, similarity?: number}>} memories 
   * @returns {string}
   */
  buildRecalledMemories(memories = []) {
    if (memories.length === 0) {
      return '## Recalled Memories\n\n(No relevant memories retrieved)';
    }

    const parts = ['## Recalled Memories'];

    memories.forEach((mem, i) => {
      parts.push(`### Memory ${i + 1}${mem.similarity ? ` (similarity: ${mem.similarity.toFixed(3)})` : ''}`);
      parts.push(`**ID**: ${mem.id}`);
      
      // Truncate long memories
      const text = mem.text.length > 800 
        ? mem.text.slice(0, 800) + '\n\n[... truncated ...]'
        : mem.text;
      
      parts.push(text);
      parts.push('');
    });

    return parts.join('\n');
  }

  /**
   * Build recent turns section (last N message pairs, raw)
   * @param {Array<{role: string, content: string}>} messages 
   * @returns {string}
   */
  buildRecentTurns(messages = []) {
    if (messages.length === 0) {
      return '## Recent Turns\n\n(No recent turns)';
    }

    const parts = ['## Recent Turns'];
    
    // Take last N turns (pairs of user+assistant)
    const recentCount = Math.min(this.maxRecentTurns * 2, messages.length);
    const recentMessages = messages.slice(-recentCount);

    recentMessages.forEach((msg, i) => {
      const roleLabel = msg.role === 'user' ? '### User' : '### Assistant';
      parts.push(roleLabel);
      parts.push(msg.content || '(empty message)');
      parts.push('');
    });

    return parts.join('\n');
  }

  /**
   * Compile full context payload
   * @param {object} options 
   * @returns {string}
   */
  compile(options = {}) {
    const {
      executionState,
      workingMemoryAnchor,
      recalledMemories,
      recentMessages,
      retrievalConfig  // NEW: from FastAwarenessRouter
    } = options;

    const sections = [];

    // 1. Static system instructions (always first)
    sections.push(this.getStaticInstructions());

    // 2. Execution state (semi-static)
    if (executionState) {
      sections.push(this.buildExecutionState(executionState));
    }

    // 3. Working memory anchor (dynamic)
    if (workingMemoryAnchor) {
      sections.push(this.buildWorkingMemoryAnchor(workingMemoryAnchor));
    }

    // 4. Recalled memories (dynamic) - SKIP if router says so
    if (recalledMemories && retrievalConfig?.skipBM25 !== true) {
      sections.push(this.buildRecalledMemories(recalledMemories));
    } else if (retrievalConfig?.skipBM25 === true) {
      logInfo('context_compiler_skipped_bm25', { reason: retrievalConfig.reason });
    }

    // 5. Recent turns (last N pairs, raw)
    if (recentMessages && recentMessages.length > 0) {
      sections.push(this.buildRecentTurns(recentMessages));
    }

    const fullContext = sections.join('\n---\n\n');
    
    logInfo('context_compiled', {
      sections: sections.length,
      totalChars: fullContext.length,
      recentTurns: recentMessages ? Math.floor(recentMessages.length / 2) : 0,
      retrievalStrategy: retrievalConfig?.strategy || 'full'
    });

    return fullContext;
  }

  /**
   * Estimate token count (rough approximation)
   * @param {string} context 
   * @returns {number}
   */
  estimateTokens(context) {
    // Rough estimate: ~4 chars per token for English text
    return Math.ceil(context.length / 4);
  }

  /**
   * Clear static cache (for testing/refresh)
   */
  clearCache() {
    this.staticCache = null;
    logInfo('context_compiler_cache_cleared');
  }
}

/**
 * Factory function
 */
export function createContextCompiler(options) {
  return new ContextCompiler(options);
}
