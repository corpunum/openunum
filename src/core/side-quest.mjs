/**
 * Side Quest System — Branchable Sessions for Repair/Proof/Heal
 * 
 * Allows spawning isolated side sessions for:
 * - Self-healing diagnostics
 * - Proof verification
 * - Memory reconciliation
 * - Environment debugging
 * - Complex subtasks that would pollute main context
 * 
 * Side quests run independently, then condense results back to main session.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logInfo, logError } from '../logger.mjs';

export class SideQuestManager {
  constructor({ sessionManager, agent, workspaceRoot }) {
    this.sessionManager = sessionManager;
    this.agent = agent;
    this.workspaceRoot = workspaceRoot || process.cwd();
    this.activeQuests = new Map(); // questId → quest metadata
    this.dataDir = path.join(this.workspaceRoot, 'data', 'side-quests');
    
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * Fork a side quest from parent session
   * 
   * @param {string} parentSessionId - Main session ID
   * @param {string} purpose - Quest purpose (self_heal, proof_check, repair, memory_reconcile, subtask)
   * @param {string} taskDescription - Specific task for the side quest
   * @param {object} options - Optional config
   * @returns {Promise<{questId, childSessionId}>}
   */
  async forkQuest(parentSessionId, purpose, taskDescription, options = {}) {
    const questId = crypto.randomUUID();
    const childSessionId = crypto.randomUUID();
    
    const quest = {
      questId,
      parentSessionId,
      childSessionId,
      purpose,
      taskDescription,
      status: 'pending', // pending → running → completed | failed | timeout
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      result: null,
      condensedSummary: null,
      metadata: {
        maxTokens: options.maxTokens || 4000,
        timeoutMs: options.timeoutMs || 5 * 60 * 1000, // 5 min default
        modelOverride: options.modelOverride || null,
        toolsAllow: options.toolsAllow || null // Restrict tools if needed
      }
    };

    this.activeQuests.set(questId, quest);
    this._persistQuest(quest);

    logInfo('side_quest_forked', {
      questId,
      parentSessionId,
      childSessionId,
      purpose,
      taskDescription: taskDescription.slice(0, 100)
    });

    // Create child session with isolated context
    await this._createChildSession(quest);

    return { questId, childSessionId };
  }

  /**
   * Create child session with inherited but isolated context
   */
  async _createChildSession(quest) {
    const parentSession = await this.sessionManager.getSession(quest.parentSessionId);
    
    if (!parentSession) {
      throw new Error(`Parent session ${quest.parentSessionId} not found`);
    }

    // Create child session with minimal context (not full history)
    const childSession = {
      id: quest.childSessionId,
      parentSessionId: quest.parentSessionId,
      isSideQuest: true,
      purpose: quest.purpose,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [
        {
          role: 'system',
          content: this._buildSideQuestSystemMessage(quest)
        },
        {
          role: 'user',
          content: quest.taskDescription,
          created_at: new Date().toISOString()
        }
      ],
      metadata: {
        isSideQuest: true,
        parentSessionId: quest.parentSessionId,
        purpose: quest.purpose
      }
    };

    await this.sessionManager.saveSession(childSession);
    logInfo('side_quest_session_created', {
      questId: quest.questId,
      childSessionId: quest.childSessionId
    });
  }

  /**
   * Build system message for side quest
   */
  _buildSideQuestSystemMessage(quest) {
    const purposeDescriptions = {
      self_heal: 'You are diagnosing and repairing a system issue. Focus on root cause and minimal fix.',
      proof_check: 'You are verifying completion claims against evidence. Be rigorous and skeptical.',
      repair: 'You are fixing a specific problem. Understand the failure, then apply targeted repair.',
      memory_reconcile: 'You are reconciling memory state. Identify inconsistencies and resolve them.',
      subtask: 'You are handling a focused subtask. Complete it efficiently and report back.'
    };

    return `## SIDE QUEST MODE

${purposeDescriptions[quest.purpose] || 'You are handling a focused side task.'}

**Parent Session:** ${quest.parentSessionId}
**Quest ID:** ${quest.questId}
**Purpose:** ${quest.purpose}

**Your Task:**
${quest.taskDescription}

**Constraints:**
- Work independently from the main session
- Do not ask for clarification from the user
- Complete the task or determine it's impossible
- When done, produce a condensed summary (max 500 chars) for the main session
- Focus on evidence and concrete results

**Output Format:**
End your work with:
\`\`\`quest_result
status: completed|failed|partial
summary: <500 char condensed result>
evidence: [list key artifacts, paths, hashes]
\`\`\`
`;
  }

  /**
   * Execute the side quest (runs the agent in the child session)
   */
  async executeQuest(questId) {
    const quest = this.activeQuests.get(questId);
    if (!quest) {
      throw new Error(`Quest ${questId} not found`);
    }

    quest.status = 'running';
    quest.startedAt = Date.now();
    this._persistQuest(quest);

    logInfo('side_quest_started', { questId });

    try {
      // Run agent in child session with timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Quest timeout')), quest.metadata.timeoutMs);
      });

      const agentPromise = this.agent.chat({
        message: quest.taskDescription,
        sessionId: quest.childSessionId,
        sideQuestMode: true,
        modelOverride: quest.metadata.modelOverride,
        toolsAllow: quest.metadata.toolsAllow
      });

      const result = await Promise.race([agentPromise, timeoutPromise]);
      
      // Extract quest result from response
      const questResult = this._parseQuestResult(result.reply);
      
      quest.status = questResult.status || 'completed';
      quest.result = result;
      quest.condensedSummary = questResult.summary;
      quest.completedAt = Date.now();
      
      this._persistQuest(quest);
      
      logInfo('side_quest_completed', {
        questId,
        status: quest.status,
        summary: questResult.summary?.slice(0, 100)
      });

      return {
        questId,
        status: quest.status,
        summary: questResult.summary,
        evidence: questResult.evidence,
        result
      };

    } catch (error) {
      quest.status = 'failed';
      quest.result = { error: String(error.message || error) };
      quest.completedAt = Date.now();
      this._persistQuest(quest);
      
      logError('side_quest_failed', { questId, error: String(error.message || error) });
      
      return {
        questId,
        status: 'failed',
        error: String(error.message || error)
      };
    }
  }

  /**
   * Parse quest result from agent response
   */
  _parseQuestResult(reply) {
    const match = reply.match(/```quest_result\s*([\s\S]*?)```/);
    if (!match) {
      // Fallback: try to extract summary from end of response
      const summaryMatch = reply.match(/summary:\s*(.+?)(?:\n|$)/i);
      return {
        status: 'completed',
        summary: summaryMatch ? summaryMatch[1].trim() : reply.slice(-500),
        evidence: []
      };
    }

    const content = match[1];
    const statusMatch = content.match(/status:\s*(\w+)/i);
    const summaryMatch = content.match(/summary:\s*(.+?)(?:\n|$)/is);
    const evidenceMatch = content.match(/evidence:\s*\[(.+?)\]/is);

    return {
      status: statusMatch ? statusMatch[1].toLowerCase() : 'completed',
      summary: summaryMatch ? summaryMatch[1].trim() : 'No summary provided',
      evidence: evidenceMatch ? evidenceMatch[1].split(',').map(s => s.trim()) : []
    };
  }

  /**
   * Merge side quest result back into parent session
   */
  async mergeQuest(questId) {
    const quest = this.activeQuests.get(questId);
    if (!quest) {
      throw new Error(`Quest ${questId} not found`);
    }

    if (quest.status !== 'completed' && quest.status !== 'partial') {
      throw new Error(`Cannot merge quest with status ${quest.status}`);
    }

    // Add condensed result to parent session
    const parentSession = await this.sessionManager.getSession(quest.parentSessionId);
    if (!parentSession) {
      throw new Error(`Parent session ${quest.parentSessionId} not found`);
    }

    const mergeMessage = {
      role: 'system',
      content: `## SIDE QUEST RESULT

**Quest ID:** ${quest.questId}
**Purpose:** ${quest.purpose}
**Status:** ${quest.status}

**Condensed Summary:**
${quest.condensedSummary || 'No summary provided'}

${quest.result?.evidence?.length ? `**Evidence:** ${quest.result.evidence.join(', ')}` : ''}

---
*Side quest completed. Main session may now continue.*
`,
      created_at: new Date().toISOString()
    };

    parentSession.messages.push(mergeMessage);
    parentSession.updatedAt = Date.now();
    await this.sessionManager.saveSession(parentSession);

    // Clean up: remove from active quests (keep in history)
    this.activeQuests.delete(questId);

    logInfo('side_quest_merged', {
      questId,
      parentSessionId: quest.parentSessionId
    });

    return {
      questId,
      parentSessionId: quest.parentSessionId,
      summary: quest.condensedSummary
    };
  }

  /**
   * Get quest status
   */
  getQuestStatus(questId) {
    const quest = this.activeQuests.get(questId);
    if (!quest) {
      // Check persisted quests
      const persisted = this._loadQuest(questId);
      return persisted;
    }
    return quest;
  }

  /**
   * List active quests for a parent session
   */
  listActiveQuests(parentSessionId = null) {
    const quests = [...this.activeQuests.values()];
    if (parentSessionId) {
      return quests.filter(q => q.parentSessionId === parentSessionId);
    }
    return quests;
  }

  /**
   * Persist quest to disk
   */
  _persistQuest(quest) {
    const filePath = path.join(this.dataDir, `${quest.questId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(quest, null, 2));
  }

  /**
   * Load quest from disk
   */
  _loadQuest(questId) {
    const filePath = path.join(this.dataDir, `${questId}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  /**
   * Get quest history
   */
  getQuestHistory(parentSessionId = null, limit = 20) {
    const files = fs.readdirSync(this.dataDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit);

    const quests = files
      .map(f => {
        try {
          return this._loadQuest(f.replace('.json', ''));
        } catch {
          return null;
        }
      })
      .filter(q => q !== null);

    if (parentSessionId) {
      return quests.filter(q => q.parentSessionId === parentSessionId);
    }

    return quests;
  }
}
