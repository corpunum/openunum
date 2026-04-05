export const statusCommand = {
  name: 'status',
  description: 'Show current model, token usage, and context status',
  args: [],
  source: 'builtin/status.mjs',

  async execute(args, flags, context) {
    const { agent, sessionId } = context;
    if (!agent) return 'Error: agent not available in context';

    const sid = sessionId || 'cli';
    const current = agent.getCurrentModel();
    const status = agent.getContextStatus(sid);

    const lines = [
      `provider/model: ${current.activeProvider || current.provider}/${current.activeModel || current.model}`,
      `messages: ${status.messageCount}`,
      `estimated_tokens: ${status.estimatedTokens}`,
      `context_limit: ${status.budget?.contextLimit || 'unknown'}`,
      `usage_pct: ${status.budget?.usagePct ? (status.budget.usagePct * 100).toFixed(1) + '%' : 'unknown'}`,
      `latest_compaction: ${status.latestCompaction ? status.latestCompaction.createdAt : 'none'}`
    ];

    return lines.join('\n');
  }
};

export default statusCommand;
