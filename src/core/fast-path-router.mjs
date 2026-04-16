import crypto from 'node:crypto';
import { logInfo } from '../logger.mjs';
import {
  parseSlashCommand,
  buildSessionSupportReply,
  buildDeterministicSessionHistoryReviewReply,
  buildDeterministicActionConfirmationReply,
  buildDeterministicReviewFollowUpReply,
  buildDeterministicImprovementProposalReply,
  buildDeterministicStandaloneFastReply,
  isModelInfoQuestion,
  isConversationalAliveQuestion,
  providerModelLabel,
  inferParamsB,
  scoreDeterministicFastTurn,
  clipText
} from './agent-helpers.mjs';
import { resolveExecutionEnvelope } from './model-execution-envelope.mjs';

/**
 * FastPathRouter - Orchestrates deterministic and short-circuit replies
 * to keep the main agent loop clean and focused on cognitive tasks.
 */
export class FastPathRouter {
  constructor({ agent, memoryStore, config }) {
    this.agent = agent;
    this.memoryStore = memoryStore;
    this.config = config;
  }

  /**
   * Detect if a message requires LLM reasoning (not suitable for fast path)
   * @param {string} message - User message
   * @returns {boolean}
   */
  requiresReasoning(message) {
    const normalized = String(message || '').toLowerCase();

    // Complex queries that need reasoning
    const reasoningPatterns = [
      /\bwhy\b.*\bbecause\b/i,  // Causal reasoning
      /\bcompare\b/i,           // Comparison
      /\banalyze\b/i,           // Analysis
      /\bevaluate\b/i,          // Evaluation
      /\bpros.*cons\b/i,        // Trade-off analysis
      /\badvantage.*disadvantage\b/i,
      /\brecommend\b/i,         // Recommendation
      /\bshould i\b/i,          // Decision making
      /\bwhat if\b/i,           // Hypothetical
      /\bhow would\b/i,         // Speculative
      /\bexplain\b.*\bwhy\b/i,  // Deep explanation
      /\bdesign\b/i,            // Creative work
      /\bimplement\b/i,         // Implementation
      /\bcreate.*from scratch\b/i,
      /\brefactor\b/i,          // Code restructuring
      /\boptimize\b/i,          // Optimization
      /\bdebug\b.*\bnot working\b/i  // Complex debugging
    ];

    return reasoningPatterns.some(pattern => pattern.test(normalized));
  }

  /**
   * Attempt to route a message through deterministic fast paths.
   * @returns {Promise<object|null>} The reply object or null if no fast path matched.
   */
  async route({ message, sessionId, recentMessages, modelForBudget }) {
    // Log fast path attempt for analysis
    logInfo('fast_path_attempt', {
      sessionId,
      messagePreview: message.slice(0, 50),
      timestamp: new Date().toISOString()
    });

    // Skip fast path for queries requiring LLM reasoning
    if (this.requiresReasoning(message)) {
      logInfo('fast_path_bypassed_for_reasoning', {
        sessionId,
        messagePreview: message.slice(0, 50)
      });
      return null;
    }

    // 1. Slash Commands
    const slash = parseSlashCommand(message);
    if (slash) {
      const slashReply = await this.handleSlashCommand(message, sessionId, slash);
      if (slashReply) {
        const result = this.wrap(sessionId, slashReply, `slash_command:${slash.name}`);
        logInfo('fast_path_routed', { sessionId, category: 'slash_command', note: slash.name });
        return result;
      }
    }

    // 2. Session Support
    const supportReply = buildSessionSupportReply({ message, sessionId, recentMessages });
    if (supportReply) {
      const result = this.wrap(sessionId, supportReply, 'session_support_reply');
      logInfo('fast_path_routed', { sessionId, category: 'session_support' });
      return result;
    }

    // 3. History Review
    const historyReply = buildDeterministicSessionHistoryReviewReply({ message, sessionId, recentMessages });
    if (historyReply) {
      const result = this.wrap(sessionId, historyReply, 'deterministic_session_history_review', 'session-history-review');
      logInfo('fast_path_routed', { sessionId, category: 'session-history-review' });
      return result;
    }

    // 4. Action Confirmation
    const actionReply = buildDeterministicActionConfirmationReply({ message, recentMessages });
    if (actionReply) {
      const result = this.wrap(sessionId, actionReply, 'deterministic_action_confirmation', 'action-confirmation');
      logInfo('fast_path_routed', { sessionId, category: 'action-confirmation' });
      return result;
    }

    // 5. Review Follow-up
    const followUpReply = buildDeterministicReviewFollowUpReply({ message, recentMessages });
    if (followUpReply) {
      const result = this.wrap(sessionId, followUpReply, 'deterministic_review_follow_up', 'review-follow-up');
      logInfo('fast_path_routed', { sessionId, category: 'review-follow-up' });
      return result;
    }

    // 6. Improvement Proposal
    const improvementReply = buildDeterministicImprovementProposalReply({ message, recentMessages });
    if (improvementReply) {
      const result = this.wrap(sessionId, improvementReply, 'deterministic_product_improvement', 'product-improvement-proposal');
      logInfo('fast_path_routed', { sessionId, category: 'product-improvement-proposal' });
      return result;
    }

    // 7. Standalone Support
    const standaloneReply = buildDeterministicStandaloneFastReply({ message, recentMessages });
    if (standaloneReply) {
      const result = this.wrap(sessionId, standaloneReply, 'deterministic_standalone_support', 'standalone-support');
      logInfo('fast_path_routed', { sessionId, category: 'standalone-support' });
      return result;
    }

    // 8. Model Info
    if (isModelInfoQuestion(message)) {
      const infoReply = this.buildModelInfoReply(modelForBudget);
      const result = this.wrap(sessionId, infoReply, 'model_info_response');
      logInfo('fast_path_routed', { sessionId, category: 'model_info' });
      return result;
    }

    // 9. Alive/Dead Question
    if (isConversationalAliveQuestion(message)) {
      const aliveReply = "Yes, I'm here and operational! I'm ready to help with any tasks you'd like me to work on. What would you like me to do?";
      const result = this.wrap(sessionId, aliveReply, 'conversational_alive_handled');
      logInfo('fast_path_routed', { sessionId, category: 'conversational_alive' });
      return result;
    }

    logInfo('fast_path_no_match', { sessionId, messagePreview: message.slice(0, 50) });
    return null;
  }

  async handleSlashCommand(message, sessionId, slash) {
    try {
      const { getRegistry } = await import('../commands/registry.mjs');
      const registry = getRegistry();
      const result = await registry.route(message, {
        sessionId,
        agent: this.agent,
        memoryStore: this.memoryStore,
        config: this.config
      });
      if (result?.handled) return result.reply;
      if (result?.error) return result.error;
    } catch (e) {
      // Registry not available, fall back to inline handler if agent has it
      if (typeof this.agent.handleSlashCommand === 'function') {
        return this.agent.handleSlashCommand(sessionId, slash);
      }
    }
    return null;
  }

  buildModelInfoReply(modelForBudget) {
    const configuredLabel = providerModelLabel(this.config.model.provider, this.config.model.model);
    const activeLabel = providerModelLabel(
      modelForBudget.activeProvider || this.config.model.provider,
      modelForBudget.activeModel || this.config.model.model
    );
    const paramsB = inferParamsB(modelForBudget.activeModel || this.config.model.model);
    return [
      `Configured provider/model: ${configuredLabel}`,
      `Last active provider/model: ${activeLabel}`,
      paramsB ? `Estimated parameter size: ~${paramsB}B (parsed from model id)` : 'Estimated parameter size: unknown from id',
      'Context window: not guaranteed from runtime config; provider metadata endpoint is the source of truth.',
      `Execution tier: ${resolveExecutionEnvelope({
        provider: modelForBudget.activeProvider || this.config.model.provider,
        model: modelForBudget.activeModel || this.config.model.model,
        runtime: this.config.runtime
      }).tier}`
    ].join('\n');
  }

  wrap(sessionId, reply, note, category = null) {
    this.memoryStore.addMessage(sessionId, 'user', 'REDACTED_FAST_PATH_TRIGGER'); // Avoid recursion/bloat
    this.memoryStore.addMessage(sessionId, 'assistant', reply);
    
    return {
      sessionId,
      reply,
      model: this.agent.getCurrentModel(),
      trace: {
        provider: this.config.model.provider,
        model: this.config.model.model,
        routedTools: [],
        iterations: [],
        permissionDenials: [],
        turnSummary: {
          toolRuns: 0,
          iterationCount: 0,
          permissionDenials: 0,
          routedTools: [],
          answerShape: category ? 'summary' : 'concise',
          answerScore: 75
        },
        deterministicFastPath: true,
        fastPathCategory: category,
        note
      }
    };
  }
}
