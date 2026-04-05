export const memoryCommand = {
  name: 'memory',
  description: 'Show recent memory artifacts and compaction status',
  args: [
    { name: 'limit', required: false, description: 'Number of artifacts to show (default 5)' }
  ],
  source: 'builtin/memory.mjs',

  async execute(args, flags, context) {
    const { agent, sessionId, memoryStore } = context;
    const sid = sessionId || 'cli';
    const limit = parseInt(args[0], 10) || 5;

    if (!agent && !memoryStore) return 'Error: agent or memory store not available';

    let artifacts = [];
    let latestCompaction = null;

    if (agent) {
      artifacts = agent.memoryStore?.getMemoryArtifacts(sid, limit) || [];
      latestCompaction = agent.memoryStore?.getLatestSessionCompaction(sid) || null;
    } else if (memoryStore) {
      artifacts = memoryStore.getMemoryArtifacts(sid, limit) || [];
      latestCompaction = memoryStore.getLatestSessionCompaction(sid) || null;
    }

    const lines = [
      `artifacts: ${artifacts.length}`,
      `latest_compaction: ${latestCompaction ? latestCompaction.createdAt : 'none'}`
    ];

    if (artifacts.length > 0) {
      lines.push('');
      artifacts.forEach((item, index) => {
        lines.push(`${index + 1}. [${item.type || 'unknown'}] ${String(item.content || '').slice(0, 120)}`);
      });
    }

    return lines.join('\n');
  }
};

export default memoryCommand;
