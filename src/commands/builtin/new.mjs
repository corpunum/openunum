export const newCommand = {
  name: 'new',
  description: 'Start a fresh session (clear context)',
  args: [],
  source: 'builtin/new.mjs',

  async execute(args, flags, context) {
    const { sessionId, memoryStore } = context;
    if (!memoryStore) return 'Error: memory store not available';

    const sid = sessionId || 'cli';

    // Clear all messages for this session
    if (typeof memoryStore.clearSessionMessages === 'function') {
      memoryStore.clearSessionMessages(sid);
    }

    return [
      `Session ${sid} cleared.`,
      'Starting fresh — previous context removed.',
      'Your knowledge base and rules are preserved.'
    ].join('\n');
  }
};

export default newCommand;
