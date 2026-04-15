import { buildChannelCommandOverview } from '../../core/agent-helpers.mjs';

export const startCommand = {
  name: 'start',
  description: 'Show channel-aware quick start commands',
  args: [],
  source: 'builtin/start.mjs',
  examples: ['start'],

  async execute(args, flags, context) {
    const sid = String(context?.sessionId || '').trim();
    return buildChannelCommandOverview(sid);
  }
};

export default startCommand;
