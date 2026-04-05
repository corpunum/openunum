export const compactCommand = {
  name: 'compact',
  description: 'Trigger context compaction to reduce token usage',
  args: [],
  source: 'builtin/compact.mjs',
  examples: ['compact', 'compact --dry-run'],

  async execute(args, flags, context) {
    const { agent, sessionId } = context;
    if (!agent) return 'Error: agent not available in context';

    const sid = sessionId || 'cli';
    const dryRun = flags['dry-run'] === true || args.includes('--dry-run');
    const out = agent.compactSessionContext({ sessionId: sid, dryRun });

    const lines = [
      `compact ok=${out.ok}`,
      `pre_tokens=${out.preTokens || 0}`,
      `post_tokens=${out.postTokens || 0}`,
      `cutoff_message_id=${out.cutoffMessageId || 'none'}`,
      `artifacts=${out.artifactsCount || 0}`
    ];

    if (dryRun) {
      lines.unshift('(dry run — no changes applied)');
    }

    return lines.join('\n');
  }
};

export default compactCommand;
