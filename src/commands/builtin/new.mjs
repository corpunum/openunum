export const newCommand = {
  name: 'new',
  description: 'Start a fresh session (clear context)',
  args: [],
  source: 'builtin/new.mjs',

  async execute(args, flags, context) {
    const { sessionId, memoryStore } = context;
    if (!memoryStore) return 'Error: memory store not available';

    const sid = sessionId || 'cli';

    if (typeof memoryStore.clearSessionMessages !== 'function') {
      return 'clearSessionMessages not available';
    }
    const out = memoryStore.clearSessionMessages(sid);

    return [
      `session_new ok=${out.ok}`,
      `session_id=${sid}`,
      `deleted_messages=${out.deletedMessages}`,
      `deleted_tool_runs=${out.deletedToolRuns}`,
      `deleted_compactions=${out.deletedCompactions}`,
      'Starting fresh — previous context removed.',
      'Your knowledge base and rules are preserved.'
    ].join('\n');
  }
};

export default newCommand;
