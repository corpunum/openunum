/**
 * ContextPressure — Monitor context size and compact when approaching limits
 * Model-agnostic: works with any provider/model
 */

export class ContextPressure {
  constructor({ maxTokens = 8000, compactThreshold = 0.7, aggressiveThreshold = 0.9 } = {}) {
    this.maxTokens = maxTokens;
    this.compactThreshold = compactThreshold;
    this.aggressiveThreshold = aggressiveThreshold;
  }

  /**
   * Rough token estimate (1 token ≈ 4 chars for English)
   */
  estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(String(text).length / 4);
  }

  /**
   * Estimate total tokens in message array
   */
  estimateMessageTokens(messages) {
    return messages.reduce((sum, m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
      return sum + this.estimateTokens(content);
    }, 0);
  }

  /**
   * Check if compaction is needed
   */
  shouldCompact(messages) {
    const totalTokens = this.estimateMessageTokens(messages);
    const ratio = totalTokens / this.maxTokens;
    return {
      needed: ratio > this.compactThreshold,
      aggressive: ratio > this.aggressiveThreshold,
      totalTokens,
      maxTokens: this.maxTokens,
      ratio: Math.round(ratio * 100) / 100
    };
  }

  /**
   * Compact messages by truncating old tool results
   */
  compactMessages(messages, { aggressive = false } = {}) {
    const maxResultChars = aggressive ? 100 : 300;

    return messages.map(m => {
      if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > maxResultChars) {
        const half = Math.floor(maxResultChars / 2);
        return {
          ...m,
          content: m.content.slice(0, half) + '\n...[compacted]...\n' + m.content.slice(-half)
        };
      }

      // Also compact long assistant messages with tool calls
      if (m.role === 'assistant' && typeof m.content === 'string' && m.content.length > 2000) {
        return {
          ...m,
          content: m.content.slice(0, 1000) + '\n...[compacted]...\n' + m.content.slice(-500)
        };
      }

      return m;
    });
  }

  /**
   * Get pressure report
   */
  getReport(messages) {
    const check = this.shouldCompact(messages);
    return {
      status: check.aggressive ? 'critical' : check.needed ? 'warning' : 'ok',
      tokensUsed: check.totalTokens,
      tokensMax: check.maxTokens,
      usagePercent: Math.round(check.ratio * 100),
      recommendation: check.aggressive
        ? 'Aggressive compaction recommended'
        : check.needed
          ? 'Compaction recommended'
          : 'Context size healthy'
    };
  }
}
