export const sessionCommand = {
  name: 'session',
  description: 'Manage sessions (list, clear, delete)',
  args: [
    { name: 'action', required: true, description: 'Action: list, clear, or delete' },
    { name: 'id', required: false, description: 'Session ID (required for delete)' }
  ],
  source: 'builtin/session.mjs',
  examples: ['session list', 'session clear', 'session delete <id>'],

  async execute(args, flags, context) {
    const { sessionId, memoryStore, agent } = context;
    if (!memoryStore && !agent) return 'Error: memory store not available';

    const sid = sessionId || 'cli';
    const ms = agent?.memoryStore || memoryStore;
    const action = (args[0] || '').toLowerCase();

    if (action === 'list') {
      const sessions = ms.listSessions(12);
      const lines = [
        `sessions=${sessions.length}`,
        ...sessions.map((item, i) =>
          `${i + 1}. ${item.sessionId} | ${item.title} | ${item.messageCount} msgs`
        )
      ];
      return lines.join('\n');
    }

    if (action === 'clear') {
      if (typeof ms.clearSessions !== 'function') {
        return 'clearSessions not available';
      }
      const out = ms.clearSessions({ keepSessionId: sid });
      return [
        `session_clear ok=${out.ok}`,
        `keep_session_id=${sid}`,
        `deleted_sessions=${out.deletedSessions}`,
        `deleted_messages=${out.deletedMessages}`
      ].join('\n');
    }

    if (action === 'delete') {
      const targetId = String(args[1] || '').trim();
      if (!targetId) return 'usage: /session delete <sessionId>';
      if (targetId === sid) return 'refused: cannot delete the active session via slash command.';

      if (typeof ms.deleteSession !== 'function') {
        return 'deleteSession not available';
      }

      const out = ms.deleteSession(targetId);
      return [
        `session_delete ok=${out.ok}`,
        `session_id=${targetId}`,
        `deleted=${out.deleted}`,
        `deleted_messages=${out.deletedMessages}`
      ].join('\n');
    }

    return 'Usage: /session list | /session clear | /session delete <id>';
  }
};

export default sessionCommand;
