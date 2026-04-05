import { estimateMessagesTokens } from '../../core/context-budget.mjs';

export const costCommand = {
  name: 'cost',
  description: 'Show token/cost estimate for current session',
  args: [],
  source: 'builtin/cost.mjs',

  async execute(args, flags, context) {
    const { sessionId, memoryStore } = context;
    if (!memoryStore) return 'Error: memory store not available';

    const sid = sessionId || 'cli';
    const messages = memoryStore.getAllMessagesForSession(sid)
      .map(m => ({ role: m.role, content: m.content }));
    const estimatedTokens = estimateMessagesTokens(messages);

    return [
      `session_messages=${messages.length}`,
      `estimated_total_tokens=${estimatedTokens}`,
      'cost_estimate=not provider-billed; token estimate only'
    ].join('\n');
  }
};

export default costCommand;
