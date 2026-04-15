import crypto from 'node:crypto';
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
   * Attempt to route a message through deterministic fast paths.
   * @returns {Promise<object|null>} The reply object or null if no fast path matched.
   */
  async route({ message, sessionId, recentMessages, modelForBudget }) {
    // 1. Slash Commands
    const slash = parseSlashCommand(message);
    if (slash) {
      const slashReply = await this.handleSlashCommand(message, sessionId, slash);
      if (slashReply) return this.wrap(sessionId, slashReply, `slash_command:${slash.name}`);
    }

    // 2. Session Support
    const supportReply = buildSessionSupportReply({ message, sessionId, recentMessages });
    if (supportReply) return this.wrap(sessionId, supportReply, 'session_support_reply');

    // 3. History Review
    const historyReply = buildDeterministicSessionHistoryReviewReply({ message, sessionId, recentMessages });
    if (historyReply) return this.wrap(sessionId, historyReply, 'deterministic_session_history_review', 'session-history-review');

    // 4. Action Confirmation
    const actionReply = buildDeterministicActionConfirmationReply({ message, recentMessages });
    if (actionReply) return this.wrap(sessionId, actionReply, 'deterministic_action_confirmation', 'action-confirmation');

    // 5. Review Follow-up
    const followUpReply = buildDeterministicReviewFollowUpReply({ message, recentMessages });
    if (followUpReply) return this.wrap(sessionId, followUpReply, 'deterministic_review_follow_up', 'review-follow-up');

    // 6. Improvement Proposal
    const improvementReply = buildDeterministicImprovementProposalReply({ message, recentMessages });
    if (improvementReply) return this.wrap(sessionId, improvementReply, 'deterministic_product_improvement', 'product-improvement-proposal');

    // 7. Standalone Support
    const standaloneReply = buildDeterministicStandaloneFastReply({ message, recentMessages });
    if (standaloneReply) return this.wrap(sessionId, standaloneReply, 'deterministic_standalone_support', 'standalone-support');

    // 8. Model Info
    if (isModelInfoQuestion(message)) {
      const infoReply = this.buildModelInfoReply(modelForBudget);
      return this.wrap(sessionId, infoReply, 'model_info_response');
    }

    // 9. Alive/Dead Question
    if (isConversationalAliveQuestion(message)) {
      const aliveReply = "Yes, I'm here and operational! I'm ready to help with any tasks you'd like me to work on. What would you like me to do?";
      return this.wrap(sessionId, aliveReply, 'conversational_alive_handled');
    }

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
