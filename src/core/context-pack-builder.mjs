function linesFromList(title, list = []) {
  if (!Array.isArray(list) || !list.length) return `${title}: none`;
  return `${title}:\n${list.map((line, idx) => `${idx + 1}. ${line}`).join('\n')}`;
}

export function buildControllerSystemMessage({
  config,
  executionProfile,
  behavior,
  provider,
  model,
  routedTools = [],
  executionEnvelope = null,
  facts = '',
  knowledgeHits = '',
  strategyPrompt = '',
  skillPrompt = ''
}) {
  const runtimeLabel = `${String(provider || '').toLowerCase()}/${String(model || '').trim()}`;
  const ownerMode = String(config?.runtime?.ownerControlMode || 'safe');
  const compactController = Boolean(executionEnvelope?.verySmallModel);
  const routeHints = routedTools.length
    ? `Heuristic tool routing hints: ${routedTools.map((item) => `${item.tool}(score=${item.score})`).join(', ')}.`
    : 'Heuristic tool routing hints: none.';

  const behaviorBlock = [
    `Behavior class: ${behavior.classId} (confidence=${behavior.confidence.toFixed(2)}, source=${behavior.source}).`,
    `Behavior description: ${behavior.description}`,
    `Behavior needs: generalDirections=${Boolean(behavior.needs?.generalDirections)} systemOverview=${Boolean(behavior.needs?.systemOverview)} repoContext=${Boolean(behavior.needs?.repoContext)} openunumContext=${Boolean(behavior.needs?.openunumContext)}`
  ].join('\n');

  const openunumOverview = behavior.needs?.openunumContext
    ? [
      'OpenUnum runtime features to use:',
      '1. Persistent memory with strategy/fact recall.',
      '2. Mission loop with retries and proof-aware completion.',
      '3. Self-poke and self-heal signals for recovery.',
      '4. Context compaction to keep long sessions operational.'
    ].join('\n')
    : '';

  const repoOverview = behavior.needs?.repoContext
    ? [
      'Repo focus:',
      '1. src/core/agent.mjs for controller loop behavior.',
      '2. src/core/missions.mjs for proof-aware mission completion.',
      '3. src/tools/runtime.mjs for tool execution and safety bounds.',
      '4. src/providers/* for provider transport contracts.',
      '5. Web UI is primarily in src/ui/index.html (includes inlined CSS/JS); prefer file_read there before broad CSS file search.'
    ].join('\n')
    : '';

  return [
    `You are OpenUnum, an Ubuntu operator agent. Active route is ${runtimeLabel}.`,
    'If user asks which model/provider you are using, answer with current runtime values only.',
    'Never claim an action completed unless tool evidence in this turn confirms it.',
    `Owner control mode: ${ownerMode}.`,
    compactController
      ? 'Compact local controller mode is active. Keep reasoning short, use at most one or two tool steps, and prefer read/verify before broad edits.'
      : '',
    routeHints,
    behaviorBlock,
    executionEnvelope
      ? `Model execution envelope: tier=${executionEnvelope.tier} maxHistoryMessages=${executionEnvelope.maxHistoryMessages} maxToolIterations=${executionEnvelope.maxToolIterations} toolAllowlist=${Array.isArray(executionEnvelope.toolAllowlist) ? executionEnvelope.toolAllowlist.join(', ') : 'all'}.`
      : '',
    linesFromList(`Execution profile: ${executionProfile.name} guidance`, executionProfile.guidance || []),
    linesFromList('Execution guardrails', executionProfile.guardrails || []),
    linesFromList('Execution verification', executionProfile.verificationHints || []),
    compactController ? '' : openunumOverview,
    compactController ? '' : repoOverview,
    facts ? `Relevant memory:\n${facts}` : '',
    compactController ? '' : (knowledgeHits ? `Smart memory recall:\n${knowledgeHits}` : ''),
    strategyPrompt ? `Previous strategy outcomes:\n${strategyPrompt}` : '',
    compactController ? '' : (skillPrompt ? `Loaded skills:\n${skillPrompt}` : '')
  ].filter(Boolean).join('\n');
}
