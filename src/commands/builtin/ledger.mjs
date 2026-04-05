export const ledgerCommand = {
  name: 'ledger',
  description: 'Show strategy/tool reliability ledger',
  args: [],
  source: 'builtin/ledger.mjs',

  async execute(args, flags, context) {
    const { memoryStore } = context;
    if (!memoryStore) return 'Error: memory store not available';

    const strategies = typeof memoryStore.getStrategyLedger === 'function'
      ? memoryStore.getStrategyLedger({ goal: '', limit: 6 })
      : [];
    const tools = typeof memoryStore.getToolReliability === 'function'
      ? memoryStore.getToolReliability(6)
      : [];

    const lines = [
      `strategy_entries=${strategies.length}`,
      ...strategies.map((item, i) =>
        `${i + 1}. ${item.success ? 'SUCCESS' : 'FAIL'} | ${item.strategy} | ${String(item.evidence || '').slice(0, 100)}`
      ),
      `tool_reliability_entries=${tools.length}`,
      ...tools.map((item, i) =>
        `${i + 1}. ${item.toolName} success_rate=${(item.successRate * 100).toFixed(0)}% total=${item.total}`
      )
    ];

    return lines.join('\n');
  }
};

export default ledgerCommand;
