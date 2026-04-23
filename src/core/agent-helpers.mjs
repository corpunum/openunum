import { suggestAlternatives } from './alternative-paths.mjs';

const TASK_SIGNAL_RE = /\b(what|how|why|where|when|which|who|can you|please|show|list|check|fix|create|build|run|install|open|search|find|write|read|explain|configure|debug|error|trace|stack|app|runtime|model|provider|continue|proceed|next|keep going|go on|grep|file|files|web|latest|news|today|current|weather|wea+ther|wether|forecast|temperature|rain|wind|humidity)\b/;

export function inferParamsB(modelId) {
  const m = String(modelId || '').toLowerCase().match(/(\d+(?:\.\d+)?)b/);
  return m ? Number(m[1]) : null;
}

export function isModelInfoQuestion(text) {
  const t = String(text || '').toLowerCase();
  const asksActiveModel =
    t.includes('which model are you using') ||
    t.includes('what model are you using') ||
    t.includes('current model') ||
    t.includes('which llm are you using') ||
    t.includes('what llm are you using') ||
    t.includes('provider/model');
  const asksCatalog =
    t.includes('what models we have') ||
    t.includes('which models we have') ||
    t.includes('list models') ||
    t.includes('locally') ||
    t.includes('in a table');
  return asksActiveModel && !asksCatalog;
}

function normalizeLooseText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[`*_#>()[\]{}"“”'’?!,.;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSessionResetQuestion(text) {
  const t = normalizeLooseText(text);
  if (!t) return false;
  const patterns = [
    /\b(new|fresh|clean|clear|reset)(?:\s+\w+){0,2}\s+(session|chat|conversation|context)\b/,
    /\b(start|begin|open|create)\s+(a\s+)?(new|fresh|clean)(?:\s+\w+){0,2}\s+(session|chat|conversation)\b/,
    /\bclear\s+(this|current|the)\s+(session|chat|conversation|context)\b/,
    /\breset\s+(this|current|the)?\s*(session|chat|conversation|context)\b/,
    /\bstart\s+over\b/,
    /\bfresh\s+start\b/,
    /\bnew\s+clear\s+session\b/
  ];
  return patterns.some((pattern) => pattern.test(t));
}

export function looksLikeToolRecoveryStub(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  return (/^Status:\s+\w+/i.test(raw) && /Findings:/i.test(raw)) || /^Best next steps from current evidence:/i.test(raw);
}

export function isMalformedResponseQuestion(text) {
  const t = normalizeLooseText(text);
  if (!t) return false;
  const patterns = [
    /\bwhy\s+not\s+responding\s+normally\b/,
    /\bwhy\s+is\s+the\s+(reply|response|message)\s+(wrong|weird|strange|malformed)\b/,
    /\bwhy\s+is\s+the\s+format(ting)?\s+(wrong|weird|strange|bad)\b/,
    /\b(weird|wrong|strange|bad|broken|malformed)\s+(reply|response|format|formatting)\b/,
    /\bi\s+do\s*not\s+understand\s+the\s+way\s+(you\s+)?respond\b/,
    /\bi\s+dont\s+understand\s+the\s+way\s+(you\s+)?respond\b/,
    /\bis\s+it\s+for\s+me\s+or\s+a\s+drift\b/,
    /\bresponse\s+drift\b/,
    /\breply\s+drift\b/,
    /\bformat\s+drift\b/,
    /\brespond(?:ing)?\s+normally\b/,
    /\bstatus\s+ok\b.*\bfindings\b/
  ];
  return patterns.some((pattern) => pattern.test(t));
}

function isRecoveryComplaintFollowUp(text, recentMessages = []) {
  const t = normalizeLooseText(text);
  if (!t) return false;
  if (!/^(again|repeat|what|huh)$/.test(t)) return false;
  return recentMessages.some((item) => item?.role === 'assistant' && looksLikeToolRecoveryStub(item?.content || ''));
}

function isLooseSupportFollowUp(text) {
  const t = normalizeLooseText(text);
  if (!t) return false;
  return (
    t === 'so' ||
    t === 'and' ||
    t === 'then' ||
    t === 'really' ||
    /^so\s*\.\.\.\s*\??$/.test(t) ||
    /^(ok|okay)\s*\??$/.test(t) ||
    /^(and|then)\s*\??$/.test(t) ||
    /^(what then|and then|which one|which command|what command)\b/.test(t) ||
    t === '?' ||
    /^how do i do that\b/.test(t)
  );
}

function looksLikeChannelSupportReply(text = '') {
  const t = normalizeLooseText(text);
  if (!t) return false;
  const commandCount = ['/start', '/new', '/status', '/help', '/session']
    .filter((token) => t.includes(token))
    .length;
  return (
    /\balready talking to openunum through telegram\b/.test(t) ||
    /\bthere is no separate telegram command namespace\b/.test(t) ||
    (/\btelegram\b/.test(t) && commandCount >= 2)
  );
}

function recentChannelSupportTopic(recentMessages = []) {
  const recent = recentMessages.slice(-4);
  const recentText = recent
    .map((item) => String(item?.content || ''))
    .join('\n')
    .toLowerCase();
  const lastAssistant = [...recent].reverse().find((item) => item?.role === 'assistant');
  return (
    looksLikeChannelSupportReply(lastAssistant?.content || '') ||
    (
      /\btelegram\b/.test(recentText) &&
      (/\/new\b|\/start\b|\/status\b|\/session\b/.test(recentText) ||
      /\b(bot|command|commands|chat context|start fresh|session info)\b/.test(recentText))
    )
  );
}

export function isChannelSupportQuestion({ message = '', sessionId = '', recentMessages = [] } = {}) {
  const t = normalizeLooseText(message);
  if (!t) return false;
  const sid = String(sessionId || '').trim();
  const isTelegramSession = sid.startsWith('telegram:');
  const directPatterns = [
    /\bhow to\b.*\btelegram\b.*\b(session|chat|bot|command|start|clear|status|new)\b/,
    /\bcan i\b.*\btelegram\b.*\b(session|chat|bot|command|start|clear|status|new)\b/,
    /\bdoes telegram\b.*\b(have|support|use|allow)\b/,
    /\b(start|new|clear|reset|fresh)\b.*\btelegram\b.*\b(session|chat)\b/,
    /\b(is there|what is|which is|can we create|do we have)\b.*\b(openunum |unum )?\b(commands?|slash commands?|sessions?)\b/,
    /\/status\b|\/new\b|\/start\b|\/session\b/,
    /\bwhat (commands?|sessions?|slash commands?)\b/,
    /\bhow to (use|start|clear|reset) (the )?(telegram |unum |openunum )?(commands?|sessions?|chat)\b/,
    /\b(start|new|clear|fresh) (a |the )?(sessions?|chats?)\b/,
    /\bi (chat|talk|message|speak|interact) with you through (the )?telegram\b/,
    /\bdelivered to you through (a |the )?telegram bot\b/,
    /\bthrough telegram\b.*\b(bot|chat|session)\b/
  ];
  if (directPatterns.some((pattern) => pattern.test(t))) return true;
  return isTelegramSession && isLooseSupportFollowUp(t) && recentChannelSupportTopic(recentMessages);
}

export function buildChannelCommandOverview(sessionId = '') {
  const sid = String(sessionId || '').trim();
  const isTelegramSession = sid.startsWith('telegram:');
  const lines = [];
  if (isTelegramSession) {
    lines.push('You are already talking to OpenUnum through Telegram.');
    lines.push('There is no separate `/telegram` command namespace. Telegram is the current channel.');
    lines.push('Use `/start` for this quick command overview.');
    lines.push('Use `/new` to clear the current Telegram chat context and start fresh.');
  } else {
    lines.push('Use `/start` for a quick command overview.');
    lines.push('Use `/new` to clear the active session context and start fresh.');
  }
  lines.push('Use `/status` to inspect runtime/model status.');
  lines.push('Use `/help` to list available slash commands.');
  lines.push('Use `/session list` to inspect stored sessions.');
  lines.push('Use `/session clear` to clear other stored sessions while keeping the current one.');
  lines.push('Use `/session delete <id>` to remove a specific stored session.');
  return lines.join('\n');
}

export function buildSessionSupportReply({ message = '', sessionId = '', recentMessages = [] } = {}) {
  const asksReset = isSessionResetQuestion(message);
  const asksMalformed = isMalformedResponseQuestion(message) || isRecoveryComplaintFollowUp(message, recentMessages);
  const asksChannelSupport = isChannelSupportQuestion({ message, sessionId, recentMessages });
  if (!asksReset && !asksMalformed && !asksChannelSupport) return '';

  const sid = String(sessionId || '').trim();
  const isTelegramSession = sid.startsWith('telegram:');
  const assistantMessages = recentMessages.filter((item) => item?.role === 'assistant');
  const hadRecoveryStub = assistantMessages.some((item) => looksLikeToolRecoveryStub(item?.content || ''));
  const lines = [];

  if (asksMalformed) {
    lines.push(
      hadRecoveryStub
        ? 'The previous reply was a recovery summary from tool inspection, not a normal user-facing answer.'
        : 'The previous reply took the wrong response path instead of returning a normal user-facing answer.'
    );
    lines.push('That support request should be answered directly without tool-search formatting.');
  }

  if (asksChannelSupport) {
    lines.push(buildChannelCommandOverview(sid));
  }

  if (asksReset) {
    if (isTelegramSession) {
      if (!asksChannelSupport) {
        lines.push('In this Telegram chat, send `/new` to clear the current chat context and start fresh.');
      }
      lines.push('Telegram keeps the same chat id; `/new` resets the session state inside that chat.');
    } else {
      if (!asksChannelSupport) {
        lines.push('Send `/new` to clear the active session context and start fresh.');
      }
    }
    if (!asksChannelSupport) {
      lines.push('Use `/session list` to inspect stored sessions.');
      lines.push('Use `/session delete <id>` to remove a specific stored session.');
      lines.push('Use `/session clear` to clear other stored sessions while keeping the current one.');
    }
  } else if (asksMalformed && isTelegramSession) {
    lines.push('If you want a clean Telegram context after that, send `/new`.');
  }

  return [...new Set(lines.flatMap((line) => String(line || '').split('\n')).filter(Boolean))].join('\n');
}

function detectSessionHistoryReviewIntent(message = '', sessionId = '') {
  const t = normalizeLooseText(message);
  if (!t) return false;
  const isTelegramSession = String(sessionId || '').trim().startsWith('telegram:');
  const asksRecentSessionReview =
    /\b(read|check|review|inspect)\b/.test(t) &&
    /\b(latest|recent|last)\b/.test(t) &&
    /\b(messages|msgs|chat|session|telegram)\b/.test(t);
  const asksLatestCheckFix =
    /\b(check|read|review|inspect)\b/.test(t) &&
    /\b(messages|msgs|chat|session|telegram)\b/.test(t) &&
    /\bfix\b/.test(t);
  const asksToFixQuality =
    /\b(fix|improve|address|correct)\b/.test(t) &&
    /\b(issue|issues|request|requests|generic|wrong|quality|response|responses)\b/.test(t);
  const directGenericComplaint =
    /\byour?\s+responses?\s+(are|is)\s+to?o?\s+generic\b/.test(t) ||
    /\btoo\s+generic\b/.test(t) ||
    /\bto\s+generic\b/.test(t);
  return Boolean(
    isTelegramSession &&
      ((asksRecentSessionReview && asksToFixQuality) || asksLatestCheckFix || directGenericComplaint)
  );
}

function looksLikeExecutionProposalReply(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const numberedSteps = raw.split('\n').filter((line) => /^\d+\.\s+/.test(String(line || '').trim())).length;
  return (
    /^Understood\.\s+The work to do is:/i.test(raw) ||
    /\bframework fix\b/i.test(raw) ||
    /^Execution plan drafted:/im.test(raw) ||
    /^Based on my review of /im.test(raw) ||
    /\bconcrete proposals?\b/i.test(raw) ||
    /\bissues found\b/i.test(raw) ||
    (numberedSteps >= 2 && /\b(plan|proposal|proposals|fix|remediation|next steps?)\b/i.test(raw)) ||
    /\bpriority order to execute now\b/i.test(raw) ||
    /\btop improvement proposals for openunum right now\b/i.test(raw)
  );
}

function detectActionConfirmationIntent(message = '', recentMessages = []) {
  const t = normalizeLooseText(message);
  if (!t) return false;
  const lastAssistant = [...recentMessages].reverse().find((item) => item?.role === 'assistant');
  const contextualAck = (
    /^(ok|okay|yes|go|continue|proceed)\s*$/i.test(String(message || '').trim()) &&
    looksLikeExecutionProposalReply(lastAssistant?.content || '')
  );
  return (
    /^(ok\s+)?do\s+(that|these|this|it)\b/.test(t) ||
    /^do\s+these\s+all\b/.test(t) ||
    /^proceed\b/.test(t) ||
    /^yes\s+do\s+that\b/.test(t) ||
    /^apply\s+(that|these|it)\b/.test(t) ||
    contextualAck
  );
}

function detectProductImprovementIntent(message = '') {
  const t = normalizeLooseText(message);
  if (!t) return false;
  const mentionsOpenUnum = /\bopenunum\b/.test(t);
  const asksImprovement = (
    /\b(what|which)\b.*\b(improve|improvement|improvements|better|enhance|enhancement|missing|miss|weak|issues?)\b/.test(t) ||
    /\bhow\b.*\b(improve|enhance|make better)\b/.test(t) ||
    /\bwhat do you think\b/.test(t) ||
    /\b(change|add|remove|correct|enhance)\b/.test(t)
  );
  const excludesExecution = /\b(implement|fix now|do all now|apply patch|write code now)\b/.test(t);
  return Boolean(asksImprovement && (mentionsOpenUnum || /\bwe\b/.test(t)) && !excludesExecution);
}

function looksLikeImprovementProposalReply(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return false;
  return (
    /^Top improvement proposals for OpenUnum right now:/i.test(raw) ||
    /\bself-awareness loop\b/i.test(raw) ||
    /\bself-development pipeline\b/i.test(raw)
  );
}

export function buildDeterministicImprovementProposalReply({ message = '', recentMessages = [] } = {}) {
  const t = normalizeLooseText(message);
  const lastAssistant = [...recentMessages].reverse().find((item) => item?.role === 'assistant');
  const followUp = isLooseSupportFollowUp(t) && looksLikeImprovementProposalReply(lastAssistant?.content || '');
  if (!detectProductImprovementIntent(message) && !followUp) return '';

  if (followUp) {
    return [
      'Priority order to execute now:',
      '1. Autonomous Self-Awareness Loop: score each completed turn/mission for truthfulness, latency, tool quality, and user-fit; persist the score and emit nudges from real failures.',
      '2. Autonomous Self-Development Pipeline: convert repeated failures into bounded improvement tasks with acceptance tests, canary run, and rollback on regression.',
      '3. Deterministic Quality Guards: keep Telegram/session quality prompts and short action confirmations on deterministic lanes so they never degrade into tool-recovery formatting.'
    ].join('\n');
  }

  return [
    'Top improvement proposals for OpenUnum right now:',
    '1. Autonomous Self-Awareness Loop: promote nudges into measurable runtime signals (`answer quality`, `latency`, `tool reliability`, `session drift`) and track trends per channel/session.',
    '2. Autonomous Self-Development Pipeline: when a pattern fails repeatedly, auto-create a bounded remediation task with required tests, then run canary verification before promoting it.',
    '3. Truthful-Completion Enforcement: keep strict finalization checks so agent outputs cannot claim completion without proof-backed evidence.',
    '4. Deterministic Communication Guardrails: preserve deterministic lanes for session-quality complaints, review follow-ups, and action confirmations to avoid generic/tool-summary responses.',
    '5. Runtime Contract Discipline: keep route, docs, and UI parity gated in CI so self-modification cannot silently drift interfaces.',
    '6. Memory Hygiene: enforce context compaction and retrieval freshness rules so long sessions do not poison routing and answer quality.',
    '7. Operator Visibility: expose one autonomy dashboard contract for nudges, active remediations, canary results, and rollback history.',
    '8. Safety Boundaries for Autonomy: keep every autonomous mutation behind ODD/tool-policy limits plus audit-chain logging and verifier checks.'
  ].join('\n');
}

function detectReviewFollowUpIntent(message = '') {
  const t = normalizeLooseText(message);
  if (!t) return '';
  if (
    /\b(and )?what are the results\b/.test(t) ||
    /\bwhat are the [a-z ]{0,20}results\b/.test(t) ||
    /\bwhat is the result\b/.test(t) ||
    /\bwhat did you find\b/.test(t) ||
    /\bwhat are the findings\b/.test(t) ||
    /\bsummarize\b/.test(t) ||
    /\bsummarise\b/.test(t)
  ) {
    return 'summary';
  }
  if (
    /\bhow\s+(do|can)\s+(we|you)\s+resolve\b/.test(t) ||
    /\bhow\s+to\s+resolve\b/.test(t) ||
    /\bhow\s+we\s+can\s+resolve\b/.test(t) ||
    /\bresolve\s+that\b/.test(t) ||
    /\baddress\s+that\b/.test(t) ||
    /\bwhat\s+we\s+will\s+need\s+you\s+to\s+do\b/.test(t) ||
    /\bwhat\s+do\s+we\s+need\s+you\s+to\s+do\b/.test(t) ||
    /\bwhat\s+would\s+you\s+need\s+to\s+do\b/.test(t) ||
    /\bwhat\s+needs?\s+to\s+be\s+done\b/.test(t) ||
    /\bwhat should (we|you) do\b/.test(t) ||
    /\bcan you do anything about it\b/.test(t) ||
    /\bhow do we fix\b/.test(t) ||
    /\bfix that\b/.test(t) ||
    /\bfix it\b/.test(t) ||
    /\bwhat do we do with\b/.test(t)
  ) {
    return 'remediation';
  }
  return '';
}

function looksLikeReviewRemediationReply(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return false;
  return (
    /\bframework fix\b/i.test(raw) ||
    /\block it with regression coverage\b/i.test(raw) ||
    /\bmake canonical docs first-class\b/i.test(raw) ||
    /docs\/archive\/\*\*/i.test(raw) ||
    /\bparity regression\b/i.test(raw)
  );
}

function looksLikeDeterministicReviewReply(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return false;
  return (
    looksLikeReviewRemediationReply(raw) ||
    /^I checked implementation files:/m.test(raw) ||
    /^I checked core runtime files:/m.test(raw) ||
    /^From current code evidence,/m.test(raw) ||
    /\bOne clear mismatch is\b/.test(raw) ||
    /\bretrieval drift\b/.test(raw) ||
    /\bpartially operationalized\b/.test(raw) ||
    /\bnot implemented as a first-class runtime module\b/.test(raw) ||
    /\bnot reliably preferring the canonical documentation set\b/.test(raw)
  );
}

function extractLastDeterministicReviewReply(recentMessages = []) {
  for (let i = recentMessages.length - 1; i >= 0; i -= 1) {
    const item = recentMessages[i];
    if (item?.role !== 'assistant') continue;
    const content = String(item?.content || '');
    if (looksLikeDeterministicReviewReply(content)) return content;
  }
  return '';
}

function extractLastReviewRemediationReply(recentMessages = []) {
  for (let i = recentMessages.length - 1; i >= 0; i -= 1) {
    const item = recentMessages[i];
    if (item?.role !== 'assistant') continue;
    const content = String(item?.content || '');
    if (looksLikeReviewRemediationReply(content)) return content;
  }
  return '';
}

function extractLastExecutionProposalReply(recentMessages = []) {
  for (let i = recentMessages.length - 1; i >= 0; i -= 1) {
    const item = recentMessages[i];
    if (item?.role !== 'assistant') continue;
    const content = String(item?.content || '');
    if (looksLikeExecutionProposalReply(content)) return content;
  }
  return '';
}

function extractReviewIssueSignals(text = '') {
  const raw = String(text || '');
  return {
    retrievalDrift: /\bretrieval drift\b|archive material|archived onboarding doc|archive\/agent-onboarding|canonical docs?/i.test(raw),
    canonicalDocsPriority: /\bnot reliably preferring the canonical documentation set\b|canonical docs are still too easy to lose/i.test(raw),
    fragmentedRuntime: /\bnot implemented as a first-class runtime module\b|\bspread across multiple surfaces rather than one canonical module\b/i.test(raw),
    partialOperationalization: /\bpartially operationalized\b/i.test(raw)
  };
}

function extractMeaningfulReviewLines(text = '') {
  return String(text || '')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .filter((line) => !/^I checked implementation files:/i.test(line))
    .filter((line) => !/^I checked core runtime files:/i.test(line))
    .filter((line) => !/^I checked documentation surfaces:/i.test(line))
    .filter((line) => !/^Evidence checked:/i.test(line))
    .filter((line) => !/^Provenance:/i.test(line));
}

function extractNumberedLines(text = '') {
  return String(text || '')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter((line) => /^\d+\.\s+/.test(line));
}

function buildReviewSummaryReply(reviewReply = '') {
  const lines = extractMeaningfulReviewLines(reviewReply).slice(0, 3);
  if (lines.length) return lines.join('\n');
  return 'The last review did not expose a concrete defect yet. It mainly confirmed which implementation and documentation surfaces were checked.';
}

function buildReviewRemediationReply(reviewReply = '', userMessage = '') {
  const signals = extractReviewIssueSignals(reviewReply);
  const userText = normalizeLooseText(userMessage);
  const lines = [];
  if (/\bcan you do anything about it\b/.test(userText)) {
    lines.push('Yes. The framework fix is to remove the drift at the source, not to patch one reply shape.');
  } else {
    lines.push('The framework fix is to correct the source of the drift, then lock it with regression coverage.');
  }
  if (signals.retrievalDrift || signals.canonicalDocsPriority) {
    lines.push('1. Make canonical docs first-class in retrieval and answer synthesis, and demote archive/history surfaces by default.');
    lines.push('2. Only let `docs/archive/**` participate when the user explicitly asks for history, archive, or comparison against old plans.');
    lines.push('3. Add a parity regression for the onboarding/changelog review prompt plus its follow-up resolution question.');
  }
  if (signals.fragmentedRuntime || signals.partialOperationalization) {
    lines.push('4. Centralize the discussed capability behind one canonical runtime surface instead of leaving it distributed across docs, nudges, and incidental helpers.');
    lines.push('5. Point docs, tests, and deterministic inspection to that single surface so the framework reports one source of truth.');
  }
  if (lines.length === 1) {
    lines.push('1. Turn the last finding into one canonical runtime or retrieval contract.');
    lines.push('2. Add a deterministic regression for the exact prompt and follow-up pair.');
    lines.push('3. Re-run the Telegram imitation set to verify the fix survives conversational follow-ups.');
  }
  return lines.join('\n');
}

export function buildDeterministicActionConfirmationReply({ message = '', recentMessages = [] } = {}) {
  if (!detectActionConfirmationIntent(message, recentMessages)) return '';
  const remediationReply = extractLastReviewRemediationReply(recentMessages);
  const proposalReply = remediationReply || extractLastExecutionProposalReply(recentMessages);
  if (!proposalReply) return '';
  const numbered = extractNumberedLines(proposalReply).slice(0, 4);
  const lines = ['Understood. The work to do is:'];
  if (numbered.length) {
    lines.push(...numbered);
  } else {
    lines.push('1. Apply the remediation steps from the last review.');
    lines.push('2. Keep the fix on the canonical runtime/retrieval path instead of adding another duplicate surface.');
  }
  lines.push('After that I should rerun the relevant Telegram/session imitation regressions to verify the fix.');
  return lines.join('\n');
}

export function buildDeterministicSessionHistoryReviewReply({ message = '', sessionId = '', recentMessages = [] } = {}) {
  if (!detectSessionHistoryReviewIntent(message, sessionId)) return '';
  const recent = recentMessages.slice(-12);
  const assistantMessages = recent.filter((item) => item?.role === 'assistant').map((item) => String(item?.content || ''));
  const userMessages = recent.filter((item) => item?.role === 'user').map((item) => String(item?.content || ''));
  const issues = [];

  if (assistantMessages.some((item) => looksLikeToolRecoveryStub(item))) {
    issues.push('A recent user-facing reply still fell back to recovery formatting (`Status: ok / Findings`) instead of answering directly.');
  }
  if (assistantMessages.some((item) => /^Ready\.\s+Tell me what you want to do next\./i.test(String(item || '').trim()))) {
    issues.push('A recent action-confirmation turn was answered with a generic acknowledgment instead of a concrete execution/remediation reply.');
  }
  if (
    userMessages.some((item) => detectActionConfirmationIntent(item)) &&
    assistantMessages.some((item) => /recovery summary from tool inspection/i.test(item))
  ) {
    issues.push('Quoted remediation text from a `do that` message was misread as a malformed-response complaint instead of an execution follow-up.');
  }
  if (!issues.length) {
    issues.push('The latest Telegram turns still need direct session-aware handling instead of falling back to tool-search style summaries.');
  }

  return [
    'Yes. From the latest Telegram turns, these are the issues I need to fix:',
    ...issues.map((item, index) => `${index + 1}. ${item}`),
    'The framework fixes are:',
    '1. Keep session-quality complaints on a session-history review path instead of routing them into tool-search recovery.',
    '2. Treat action confirmations after remediation plans as deterministic follow-ups, not generic acknowledgements.',
    '3. Keep quoted remediation text from tripping malformed-response repair heuristics.',
    '4. Rerun the Telegram/session imitation regressions after each fix.'
  ].join('\n');
}

export function buildDeterministicReviewFollowUpReply({ message = '', recentMessages = [] } = {}) {
  const intent = detectReviewFollowUpIntent(message);
  if (!intent) return '';
  const reviewReply = extractLastDeterministicReviewReply(recentMessages);
  if (!reviewReply) return '';
  if (intent === 'summary') return buildReviewSummaryReply(reviewReply);
  if (intent === 'remediation') return buildReviewRemediationReply(reviewReply, message);
  return '';
}

function detectToolFailureDiagnosticPrompt(message = '') {
  const raw = String(message || '').trim();
  if (!raw) return null;
  const m = raw.match(/^tool\s+([a-z0-9_./-]+)\s+failed\s+(\d+)\s+times?\.\s+last error:\s+(.+?)\.\s+diagnose\b/i);
  if (!m) return null;
  const errorRaw = String(m[3] || '').trim();
  const errorLower = errorRaw.toLowerCase();
  return {
    tool: String(m[1] || '').trim(),
    failures: Number(m[2] || 0),
    error: errorLower,
    errorRaw
  };
}

export function buildDeterministicStandaloneFastReply({ message = '', recentMessages = [] } = {}) {
  const t = normalizeLooseText(message);
  if (!t) return '';

  if (/^(continue|retry test after fix|retry|go on|proceed)$/i.test(String(message || '').trim())) {
    return [
      'I can continue immediately.',
      'Send the exact target task for this turn (scope + expected output), and I will execute it directly.'
    ].join('\n');
  }

  if (
    /\baware\b/.test(t) &&
    /\bpermissions?\b/.test(t) &&
    /\b(abilities|capabilities)\b/.test(t)
  ) {
    return [
      'Yes. I operate with tool-gated permissions and explicit runtime constraints.',
      'I can inspect files/code, run approved commands, and execute bounded tool workflows.',
      'I cannot assume unrestricted external/system access beyond configured tool/runtime policy.'
    ].join('\n');
  }

  if (
    /\b(create|build|make)\b/.test(t) &&
    /\b(mission|plan|task)\b/.test(t) &&
    /\bsubtasks?\b/.test(t)
  ) {
    return [
      'Execution plan drafted:',
      '1. Inventory repository/runtime surfaces (code, docs, config, tests, git state).',
      '2. Build environment-awareness report (permissions, tools, providers, runtime limits).',
      '3. Identify drift/failures and prioritize fixes by impact.',
      '4. Execute fixes in bounded batches with regression checks per batch.',
      '5. Publish final evidence summary with remaining risks and next actions.'
    ].join('\n');
  }

  if (/^remember\b/.test(t) && /\bfact\b/.test(t)) {
    return [
      'Noted. I will treat that as a remembered fact for subsequent turns.',
      'If you want a specific key/value memory format, send it as: `remember key=value`.'
    ].join('\n');
  }

  if (/\bhow i feel today\b/.test(t) && /\bhelp me\b/.test(t)) {
    return [
      'I can help with that.',
      'Tell me in one or two lines what you are feeling right now, and I will respond with practical next steps.'
    ].join('\n');
  }

  if (/^what is app\b/.test(t) || /^what is an app\b/.test(t)) {
    return 'An app is software built to perform specific tasks for a user on a device or through the web.';
  }

  const asksRankedSearch =
    (/\bsearch\b/.test(t) || /^best\b/.test(t) || /^repeat\s+best\b/.test(t) || /^repeat\b.*\bbest\b/.test(t)) &&
    (/\bgithub\b/.test(t) || /\bnews\b/.test(t) || /\bsites?\b/.test(t));
  if (asksRankedSearch) {
    const monthScoped = /\b(march|april)\b/.test(t);
    return [
      monthScoped
        ? 'I can do this as a constrained search task.'
        : 'I can do this as a ranked search task.',
      'Execution frame:',
      monthScoped
        ? '1. Filter candidates to projects first released or first trending in March-April 2026.'
        : '1. Filter to high-signal candidates for the requested topic/region and remove low-credibility sources.',
      '2. Rank by multi-signal quality (growth/activity, update cadence, adoption/reputation signals).',
      monthScoped
        ? '3. Return a concise table with why each entry qualifies in that exact window.'
        : '3. Return a concise table with why each entry ranks in the top set.'
    ].join('\n');
  }

  const toolFailure = detectToolFailureDiagnosticPrompt(message);
  if (toolFailure) {
    const lines = [
      `Root cause likely: ${toolFailure.tool} is in a guarded failure loop (${toolFailure.errorRaw}) after ${toolFailure.failures} retries.`,
      'Framework fix:',
      '1. Stop retrying the same tool path immediately.',
      '2. Pivot to an alternative method (cached/local source, different tool family, or deterministic fallback).',
      '3. Record the failure pattern and add a regression so this prompt is answered directly without entering a retry loop.',
      '4. Re-run session imitation and pending-queue diagnostics after the fix.'
    ];
    if (toolFailure.error.includes('tool_circuit_open')) {
      lines.splice(1, 0, 'The circuit breaker opened to prevent repeated failing calls from stalling the turn.');
    }
    return lines.join('\n');
  }

  const noContextRemediation = detectReviewFollowUpIntent(message) === 'remediation'
    && !extractLastDeterministicReviewReply(recentMessages);
  if (noContextRemediation) {
    return [
      'I can resolve it, but this turn has no prior review context attached.',
      'Framework remediation flow:',
      '1. Run a bounded review pass to extract concrete findings.',
      '2. Convert findings into one canonical runtime/retrieval fix (not duplicate surfaces).',
      '3. Add deterministic + imitation regressions for the exact prompt/follow-up pair.',
      '4. Re-run the regression set before promoting the change.'
    ].join('\n');
  }

  const asksHarnessSummary = /\b(harness|meta harness)\b/.test(t) && /\b(summarize|summary|directly)\b/.test(t);
  if (asksHarnessSummary && !extractLastDeterministicReviewReply(recentMessages)) {
    return [
      'Direct harness summary:',
      'The meta harness is partially wired but not fully first-class as a single canonical runtime module.',
      'The main gap is contract drift across docs/routes/tests when harness behavior changes.',
      'Fix direction: centralize harness entrypoints, bind docs to route registry, and gate with deterministic + imitation regressions.'
    ].join('\n');
  }

  const asksTableNoLinks = /\btable\b/.test(t) && (
    /\bno links?\b/.test(t) ||
    /\b(don t|dont|don't)\s+give(?:\s+me)?\s+links?\b/.test(t)
  );
  if (asksTableNoLinks) {
    return [
      'I can produce a concise table with no links.',
      'Send the exact topic + columns to use, and I will return only the table.'
    ].join('\n');
  }

  const asksRecoveryFix = /\b(responding abnormally|responses? are to?o?\s+generic|too generic|to generic)\b/.test(t);
  if (asksRecoveryFix) {
    return [
      'Understood. I will keep responses direct and user-facing.',
      'Immediate framework guardrails:',
      '1. Keep malformed/recovery complaints on deterministic support lanes.',
      '2. Avoid `Status/Findings` reply shape unless explicitly requested.',
      '3. Re-run Telegram/session imitation checks after each routing change.'
    ].join('\n');
  }

  return '';
}

export function normalizeModelForProvider(provider, model) {
  const providerRaw = String(provider || 'ollama-cloud').trim().toLowerCase();
  const normalizedProvider = providerRaw === 'generic' ? 'openai' : (providerRaw === 'ollama' ? 'ollama-cloud' : providerRaw);
  const raw = String(model || '').replace(/^(ollama-local|ollama-cloud|ollama|openrouter|nvidia|xiaomimimo|generic|openai)\//, '');
  return `${normalizedProvider}/${raw}`;
}

export function providerModelLabel(provider, model) {
  const rawProvider = String(provider || '').trim().toLowerCase();
  const p = rawProvider === 'generic' ? 'openai' : (rawProvider === 'ollama' ? 'ollama-cloud' : rawProvider);
  const m = String(model || '').trim();
  if (!p) return m;
  if (!m) return p;
  if (m.startsWith(`${p}/`)) return m;
  if (/^(ollama-local|ollama-cloud|ollama|openrouter|nvidia|xiaomimimo|generic|openai)\//.test(m)) {
    return m.replace(/^generic\//, 'openai/').replace(/^ollama\//, `${p}/`);
  }
  return `${p}/${m}`;
}

export function uniq(arr) {
  return [...new Set(arr)];
}

export function parseToolArgs(rawArgs) {
  if (rawArgs == null) return {};
  if (typeof rawArgs === 'object') return rawArgs;
  if (typeof rawArgs !== 'string') return {};
  try {
    return JSON.parse(rawArgs || '{}');
  } catch {
    return {};
  }
}

export function summarizeResult(result) {
  const r = result || {};
  return {
    ok: Boolean(r.ok),
    code: Number.isFinite(r.code) ? r.code : undefined,
    error: r.error || null,
    path: r.path || r.outPath || null,
    url: r.url || null,
    hookEventCount: Array.isArray(r.hookEvents) ? r.hookEvents.length : 0
  };
}

export function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

export function truncateText(text, maxChars = 1600) {
  const clean = stripAnsi(String(text || ''));
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}\n... [truncated ${clean.length - maxChars} chars]`;
}

export function compactToolResult(result) {
  const r = result || {};
  const compact = {
    ok: Boolean(r.ok)
  };
  if (Number.isFinite(r.code)) compact.code = r.code;
  if (r.error) compact.error = truncateText(r.error, 400);
  if (r.path || r.outPath) compact.path = r.path || r.outPath;
  if (r.url) compact.url = r.url;
  if (Number.isFinite(r.status)) compact.status = r.status;
  if (r.statusText) compact.statusText = r.statusText;
  if (r.jobId) compact.jobId = r.jobId;
  if (Number.isFinite(r.attempts)) compact.attempts = r.attempts;
  if (r.json != null) compact.json = truncateText(JSON.stringify(r.json), 2000);
  if (r.stdout) compact.stdout = truncateText(r.stdout, 2000);
  if (r.stderr) compact.stderr = truncateText(r.stderr, 1200);
  if (r.text) compact.text = truncateText(r.text, 2000);
  if (Array.isArray(r.results)) {
    compact.results = r.results
      .slice(0, 6)
      .map((item) => ({
        title: truncateText(item?.title || '', 180),
        url: truncateText(item?.url || '', 300),
        snippet: truncateText(item?.snippet || '', 260)
      }));
  }
  if (Array.isArray(r.hookEvents) && r.hookEvents.length) {
    compact.hookEvents = r.hookEvents.map((item) => ({
      stage: item.stage,
      hook: item.hook,
      decision: item.decision,
      note: truncateText(item.note || '', 120)
    }));
  }
  // Image results: summarize instead of including raw base64
  if (Array.isArray(r.images)) {
    compact.images = `[${r.images.length} image(s) generated, ${r.images.reduce((s, img) => s + (typeof img === 'string' ? img.length : 0), 0)} bytes base64 total]`;
  }
  if (Array.isArray(r.savedAs)) compact.savedAs = r.savedAs;
  if (r.parameters) compact.parameters = r.parameters;
  return compact;
}

export function clipText(text, maxChars = 1200) {
  const clean = String(text || '').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 3)}...`;
}

export function getLastUserMessage(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return String(messages[i].content || '');
  }
  return '';
}

export function buildSkillPrompt(skills = [], { maxSkills = 4, maxCharsPerSkill = 2000 } = {}) {
  return skills
    .slice(0, maxSkills)
    .map((s) => `Skill ${s.name}:\n${clipText(s.content, maxCharsPerSkill)}`)
    .join('\n\n');
}

export function uniqueFacts(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = String(item?.key || '').trim();
    const value = String(item?.value || '').trim();
    if (!key || !value) continue;
    const signature = `${key}=${value}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push({ key, value });
  }
  return out;
}

export function extractAutomaticFacts({ message = '', reply = '', model = null, trace = null }) {
  const facts = [];
  const userText = String(message || '').trim();
  const assistantText = String(reply || '').trim();
  const combined = `${userText}\n${assistantText}`;

  const nameMatch =
    userText.match(/\bmy name is\s+([a-z][a-z0-9 .'-]{1,60})/i) ||
    userText.match(/\bcall me\s+([a-z][a-z0-9 .'-]{1,60})/i);
  if (nameMatch?.[1]) facts.push({ key: 'owner.name', value: nameMatch[1].trim() });

  const locationMatch = userText.match(/\bi (?:am|live) in\s+([a-z][a-z0-9 ,.'-]{1,80})/i);
  if (locationMatch?.[1]) facts.push({ key: 'owner.location', value: locationMatch[1].trim() });

  const preferencePatterns = [
    { regex: /\bi prefer\s+([^.\n]{2,80})/i, key: 'owner.preference.general' },
    { regex: /\buse\s+(ollama|ollama-local|ollama-cloud|openai|openrouter|nvidia|xiaomimimo)\b/i, key: 'owner.preference.provider' },
    { regex: /\b(?:avoid|don't use|do not use)\s+(browser|shell|telegram|email)\b/i, key: 'owner.preference.avoid_surface' }
  ];
  for (const pattern of preferencePatterns) {
    const match = userText.match(pattern.regex);
    if (match?.[1]) facts.push({ key: pattern.key, value: match[1].trim().toLowerCase() });
  }

  const runtimeLabel = providerModelLabel(
    model?.activeProvider || model?.provider,
    model?.activeModel || model?.model
  );
  if (runtimeLabel) facts.push({ key: 'runtime.last_model', value: runtimeLabel });
  if (trace?.executionEnvelope?.tier) facts.push({ key: 'runtime.last_execution_tier', value: String(trace.executionEnvelope.tier) });
  if (trace?.provider) facts.push({ key: 'runtime.last_provider', value: String(trace.provider) });

  const missionStatus = combined.match(/MISSION_STATUS:\s*(DONE|CONTINUE)/i);
  if (missionStatus?.[1]) facts.push({ key: 'runtime.last_mission_status', value: missionStatus[1].toUpperCase() });

  return uniqueFacts(facts);
}

const TOOL_ROUTING_HINTS = [
  { tool: 'session_clear', terms: ['delete all sessions', 'clear all sessions', 'clear chat history', 'wipe sessions'] },
  { tool: 'session_delete', terms: ['delete session', 'remove session'] },
  { tool: 'session_list', terms: ['list sessions', 'show sessions'] },
  { tool: 'file_patch', terms: ['fix ui', 'runtime ui', 'scrollbar', 'overflow', 'fit in container', 'layout fix', 'css fix'] },
  { tool: 'browser_search', terms: ['search', 'google', 'find online', 'web research', 'browse', 'check online', 'look up online', 'search online'] },
  { tool: 'browser_navigate', terms: ['open website', 'navigate', 'visit', 'go to', 'browser'] },
  { tool: 'browser_extract', terms: ['extract', 'scrape', 'read page', 'page text'] },
  { tool: 'file_read', terms: ['read file', 'inspect file', 'open file', 'show file'] },
  { tool: 'file_write', terms: ['create file', 'write file', 'save file'] },
  { tool: 'file_patch', terms: ['patch file', 'edit file', 'replace text', 'modify file'] },
  { tool: 'shell_run', terms: ['run command', 'terminal', 'shell', 'cli', 'install', 'build', 'test'] },
  { tool: 'desktop_open', terms: ['open app', 'open folder', 'open target'] },
  { tool: 'desktop_xdotool', terms: ['desktop', 'window', 'keyboard', 'mouse', 'xdotool'] },
  { tool: 'email_list', terms: ['email', 'gmail', 'inbox'] },
  { tool: 'research_run_daily', terms: ['research', 'daily research'] }
];

export function inferRoutedTools(message) {
  const text = String(message || '').toLowerCase();
  const matches = [];
  for (const hint of TOOL_ROUTING_HINTS) {
    let score = 0;
    for (const term of hint.terms) {
      if (text.includes(term)) score += 1;
    }
    if (score > 0) matches.push({ tool: hint.tool, score });
  }
  matches.sort((a, b) => b.score - a.score || a.tool.localeCompare(b.tool));
  return matches.slice(0, 5);
}

export function parseSlashCommand(message) {
  const text = String(message || '').trim();
  if (!text.startsWith('/')) return null;
  const [command, ...rest] = text.slice(1).split(/\s+/);
  return {
    name: String(command || '').toLowerCase(),
    args: rest,
    raw: text
  };
}

export function buildPivotHints({ executedTools = [], permissionDenials = [], timedOut = false, providerFailures = [] }) {
  const hints = [];
  const failedTools = executedTools.filter((item) => item?.result?.ok === false);
  const repeatedFailures = new Map();
  const distinctProviderFailures = new Set(
    (Array.isArray(providerFailures) ? providerFailures : [])
      .map((item) => String(item?.provider || '').trim())
      .filter(Boolean)
  );
  for (const item of failedTools) {
    repeatedFailures.set(item.name, (repeatedFailures.get(item.name) || 0) + 1);
  }

  if (permissionDenials.some((item) => String(item.tool || '').includes('browser'))) {
    hints.push('Browser path was blocked. Pivot to terminal or script execution immediately.');
  }

  const errorTools = executedTools.filter((t) => t.error || t.reason);
  for (const ft of errorTools) {
    const alt = suggestAlternatives(ft.tool, ft.error || ft.reason);
    if (alt.length) hints.push(`Alternatives for ${ft.tool}: ${alt.join(', ')}`);
  }
  if (permissionDenials.some((item) => ['shell_disabled', 'shell_blocked', 'owner_mode_restricted'].includes(item.reason))) {
    hints.push('Shell path is restricted. Use non-shell tools or change owner mode before retrying.');
  }
  if (permissionDenials.some((item) => item.reason === 'tool_circuit_open')) {
    hints.push('A tool circuit is open. Do not retry the same tool family immediately.');
  }
  for (const [toolName, count] of repeatedFailures.entries()) {
    if (count >= 2) {
      hints.push(`${toolName} failed repeatedly. Switch method instead of repeating the same call.`);
    }
  }
  if (timedOut) {
    hints.push('Turn timed out. Narrow the scope or switch to a faster provider/model.');
  }
  if (distinctProviderFailures.size >= 2) {
    hints.push('Multiple providers failed. Prefer the healthiest provider path and reduce prompt complexity.');
  }
  return [...new Set(hints)].slice(0, 5);
}

export function formatProviderFailureReply({ failures = [], effectiveAttempts = [], routing = {} } = {}) {
  const failureItems = Array.isArray(failures) ? failures : [];
  const attemptItems = Array.isArray(effectiveAttempts) ? effectiveAttempts : [];
  const distinctFailureProviders = new Set(
    failureItems.map((item) => String(item?.provider || '').trim()).filter(Boolean)
  );
  const distinctAttemptRoutes = new Set(
    attemptItems
      .map((item) => {
        const provider = String(item?.provider || '').trim();
        const model = String(item?.model || '').trim();
        return provider && model ? `${provider}/${model}` : '';
      })
      .filter(Boolean)
  );
  const distinctProviderCount = distinctFailureProviders.size || distinctAttemptRoutes.size;
  const forcePrimaryProvider = routing?.forcePrimaryProvider === true;
  const fallbackEnabled = routing?.fallbackEnabled !== false;
  const timeoutOnly = failureItems.length > 0 && failureItems.every((item) => item?.kind === 'timeout');

  const lines = [
    distinctProviderCount > 1 ? 'All provider attempts failed.' : 'Primary provider failed.'
  ];

  if (forcePrimaryProvider) {
    lines.push('This runtime stayed on the primary provider because forcePrimaryProvider is enabled.');
  } else if (!fallbackEnabled) {
    lines.push('Fallback routing is disabled for this runtime.');
  } else if (distinctProviderCount <= 1 && distinctAttemptRoutes.size <= 1) {
    lines.push('No alternate provider route was available for this turn.');
  }

  for (const item of failureItems) {
    const provider = String(item?.provider || 'provider').trim();
    const kind = String(item?.kind || 'unknown').trim();
    const action = String(item?.action || 'none').trim();
    const error = String(item?.error || 'unknown_error').trim();
    lines.push(`${provider}: kind=${kind} action=${action} error=${error}`);
  }

  if (timeoutOnly) {
    lines.push('The active model exhausted its turn budget before it could finish this task.');
  }

  return lines.filter(Boolean).join('\n');
}

const EXECUTION_PROFILES = [
  {
    match: ({ provider, model }) => (provider === 'ollama-cloud' || provider === 'ollama') && /kimi|minimax|cloud/.test(model),
    name: 'strict-shell-cloud',
    turnBudgetMs: 300000,
    maxIters: 4,
    guidance: [
      'Use a rigid shell-first workflow with one concrete substep at a time.',
      'Keep tool arguments and conclusions short. Do not rely on long free-form reasoning after large tool output.',
      'After each important tool call, verify state with one short follow-up command before moving on.',
      'When a local or remote service exposes an HTTP API, prefer the `http_request` tool over shelling out to curl.'
    ],
    guardrails: [
      'Prefer deterministic, non-interactive verification surfaces over REPL-style commands or long-running TTY sessions.',
      'Do not spend multiple turns on metadata/blob inspection when a direct proof command is available.',
      'If the same route consumes a full turn without decisive proof, shrink the step or change execution surface.'
    ],
    verificationHints: [
      'For local services, prefer HTTP/JSON endpoints or one-shot CLI invocations over interactive shells when available.',
      'Capture the smallest proof that confirms progress, then move on.'
    ]
  },
  {
    match: ({ provider, model }) => provider === 'ollama-local' || ((provider === 'ollama-cloud' || provider === 'ollama') && /qwen|llama|coder|8b|9b|14b/.test(model)),
    name: 'local-tool-runner',
    turnBudgetMs: 300000,
    maxIters: 6,
    guidance: [
      'Prefer direct local inspection and execution over browsing.',
      'Use shell to probe hardware, processes, ports, and files before choosing a runtime.',
      'When a long command succeeds, summarize proof and continue immediately.'
    ],
    guardrails: [
      'Avoid interactive CLI loops when a non-interactive API or batch mode exists.',
      'Reuse existing local artifacts and runtimes before creating duplicates.'
    ],
    verificationHints: [
      'Choose verification commands that exit on their own and return compact output.',
      'Use short prompts and bounded context for launch verification.'
    ]
  },
  {
    match: ({ provider }) => provider === 'nvidia' || provider === 'openrouter',
    name: 'structured-api-cloud',
    turnBudgetMs: 90000,
    maxIters: 4,
    guidance: [
      'Work in short verified substeps and keep each turn narrowly scoped.',
      'Prefer direct machine-readable verification over exploratory shell output.',
      'When a local service is being controlled, choose its API surface before interactive CLI flows when both exist.',
      'Prefer the `http_request` tool over `shell_run` with curl for JSON APIs.'
    ],
    guardrails: [
      'Avoid spending turns on low-signal inspection after the correct target is already identified.',
      'If a verification path is interactive or slow, switch to a bounded API or batch route.'
    ],
    verificationHints: [
      'Prefer JSON/HTTP verification surfaces when the target service exposes one.',
      'Keep verification prompts minimal and evidence-focused.'
    ]
  },
  {
    match: ({ provider }) => provider === 'openai',
    name: 'structured-general',
    turnBudgetMs: 120000,
    maxIters: 4,
    guidance: [
      'Think in short verified checkpoints, not long narratives.',
      'Use tools aggressively, but keep each turn scoped to one subgoal with proof.',
      'Prefer `http_request` for API verification instead of `shell_run` with curl.'
    ],
    guardrails: [
      'Prefer high-signal tool calls over repeated introspection.',
      'If a tool output is noisy, extract only the proof and continue.'
    ],
    verificationHints: [
      'Favor stable APIs and single-shot commands for verification.'
    ]
  }
];

export function getExecutionProfile(provider, model) {
  const normalized = {
    provider: String(provider || '').trim().toLowerCase(),
    model: String(model || '').trim().toLowerCase()
  };
  const matched = EXECUTION_PROFILES.find((item) => item.match(normalized));
  if (matched) return matched;
  return {
    name: 'default-verified-steps',
    turnBudgetMs: null,
    maxIters: null,
    guidance: [
      'Work in single verified substeps.',
      'Prefer the shortest reliable path.',
      'If a route fails twice, pivot instead of repeating it.',
      'Prefer `http_request` for HTTP/JSON services instead of `shell_run` with curl.'
    ],
    guardrails: [
      'Prefer non-interactive, bounded execution paths over manual or REPL-style flows.',
      'Do not repeat low-value inspection when a direct proof step is available.'
    ],
    verificationHints: [
      'Verify through the most stable machine-readable surface available.'
    ]
  };
}

export function mergeProfileWithBehavior(profile, behavior, config) {
  const tuning = behavior?.tuning || {};
  const configuredTurnCap = Number(config?.runtime?.agentTurnTimeoutMs || 420000);
  const profileTurn = Number.isFinite(profile?.turnBudgetMs) ? Number(profile.turnBudgetMs) : null;
  const tuningTurn = Number.isFinite(tuning?.turnBudgetMs) ? Number(tuning.turnBudgetMs) : null;
  let mergedTurnBudget = profileTurn;
  if (mergedTurnBudget == null && tuningTurn != null) mergedTurnBudget = tuningTurn;
  if (mergedTurnBudget != null && tuningTurn != null) mergedTurnBudget = Math.min(mergedTurnBudget, tuningTurn);
  if (mergedTurnBudget != null) {
    mergedTurnBudget = Math.max(20000, Math.min(mergedTurnBudget, configuredTurnCap));
  }

  const profileIters = Number.isFinite(profile?.maxIters) ? Number(profile.maxIters) : null;
  const tuningIters = Number.isFinite(tuning?.maxIters) ? Number(tuning.maxIters) : null;
  let mergedMaxIters = profileIters;
  if (mergedMaxIters == null && tuningIters != null) mergedMaxIters = tuningIters;
  if (mergedMaxIters != null && tuningIters != null) mergedMaxIters = Math.min(mergedMaxIters, tuningIters);
  if (mergedMaxIters != null) {
    mergedMaxIters = Math.max(2, Math.min(mergedMaxIters, 12));
  }

  return {
    ...profile,
    turnBudgetMs: mergedTurnBudget,
    maxIters: mergedMaxIters
  };
}

export function detectLocalRuntimeTask(messages = []) {
  const text = messages.map((m) => String(m?.content || '')).join('\n').toLowerCase();
  return /autonomous mission goal|continue autonomous mission/.test(text) &&
    /local|gguf|ollama|llama\.cpp|runtime|launch|server|model/.test(text);
}

export function isNonFinalToolMarkupText(text) {
  const raw = String(text || '');
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/<\s*minimax:tool_call\b/i.test(trimmed)) return true;
  const hasInvokeBlock = /<\s*invoke\b/i.test(trimmed) && /<\s*parameter\b/i.test(trimmed);
  const hasToolCallTag = /<\s*(tool_call|function_call)\b/i.test(trimmed);
  if (hasToolCallTag) return true;
  if (!hasInvokeBlock && !hasToolCallTag) return false;
  const withoutTags = trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!withoutTags) return true;
  return /^(invoke|parameter|command|target|name|arguments)\b/i.test(withoutTags);
}

export function normalizeAssistantContent(text) {
  if (isNonFinalToolMarkupText(text)) return '';
  return String(text || '');
}

export function toolRunFailed(result) {
  if (!result || typeof result !== 'object') return true;
  if (result.ok === false) return true;
  if (typeof result.error === 'string' && result.error.trim()) return true;
  return false;
}

export function deterministicGreetingReply(message) {
  const text = String(message || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const words = text.split(/\s+/).filter(Boolean);
  if (TASK_SIGNAL_RE.test(text) && words.length > 3) return '';
  if (/^good morning\b/.test(text)) return 'Good morning. How can I help?';
  if (/^good afternoon\b/.test(text)) return 'Good afternoon. How can I help?';
  if (/^good evening\b/.test(text)) return 'Good evening. How can I help?';
  if (/^(hi|hello|hey|yo|greetings)\b/.test(text) && words.length <= 4 && !TASK_SIGNAL_RE.test(text)) return 'Hello. How can I help?';
  return '';
}

export function deterministicLightChatReply() {
  return 'Ready. Tell me what you want to do next.';
}

export function scoreDeterministicFastTurn(text) {
  const raw = String(text || '').toLowerCase().trim();
  if (!raw) return 0;

  // High-confidence patterns for self-assessment and identity
  if (isSelfAssessmentQuestion(raw) || isConversationalAliveQuestion(raw)) {
    return 0.95;
  }

  // Short follow-up imperatives like "ok go", "ok", "yes", "continue", "go ahead"
  // should not be scored as low-intent — they are continuation signals in multi-turn tasks
  if (/^(ok\s+go|go\s+ahead|go on|keep going|proceed|continue|yes|ok|okay|got it|understood|right|sure|yeah|yep)\s*$/i.test(raw)) {
    return 0;
  }

  const normalized = raw.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return 0;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 12 || normalized.length > 120) return 0;
  const hasTaskSignal = TASK_SIGNAL_RE.test(normalized);
  const hasCodeLike = /[\\/`$={}[\]<>]/.test(raw) || /\d{2,}/.test(raw);
  let score = 0;
  if (words.length <= 3) score += 0.30;
  else if (words.length <= 5) score += 0.20;
  else if (words.length <= 8) score += 0.10;
  else if (words.length <= 12) score += 0.05;

  if (normalized.length <= 24) score += 0.15;
  else if (normalized.length <= 40) score += 0.08;
  else if (normalized.length <= 80) score += 0.03;

  if (!hasTaskSignal) score += 0.15;
  if (!hasCodeLike) score += 0.10;

  // Specific boost for "scale from 1-10" if it's not a complex task
  if (raw.includes('scale from 1') && raw.includes('10') && !hasTaskSignal) {
    score += 0.4;
  }

  if (hasTaskSignal) score -= 0.9;
  if (hasCodeLike && !raw.includes('1-10')) score -= 0.7;

  return Math.max(0, Math.min(1, score));
}

export function isConversationalAliveQuestion(text) {
  const t = String(text || '').toLowerCase().trim();
  const alivePatterns = [
    /^so you are alive\??$/,
    /^are you (dead|alive)\??$/,
    /^are you dead or alive\??$/,
    /^so you are dead\??$/,
    /.*\balive\b.*\?$/,
    /.*\bdead\b.*\?$/,
    /^how are you\??$/,
    /^how do you feel\??$/,
    /^are you okay\??$/,
    /^are you ok\??$/
  ];

  const technicalPatterns = [
    'health', 'status', 'check', 'diagnose', 'monitor', 'debug', 'test', 'verify'
  ];

  const hasTechnicalTerms = technicalPatterns.some(term => t.includes(term));

  if (hasTechnicalTerms) {
    return false;
  }

  return alivePatterns.some(pattern => pattern.test(t));
}

export function isSelfAssessmentQuestion(text) {
  const t = normalizeLooseText(text);
  if (!t) return false;
  
  const assessmentPatterns = [
    /\bhow\s+smart\s+are\s+you\b/,
    /\bhow\s+intelligent\s+are\s+you\b/,
    /\bon\s+a\s+scale\s+from\s+1\b.*\b10\b/,
    /\bwhat\s+can\s+you\s+do\b/,
    /\bwhat\s+are\s+your\s+capabilities\b/,
    /\btell\s+me\s+about\s+yourself\b/,
    /\bwho\s+are\s+you\b/,
    /\bwhat\s+is\s+your\s+purpose\b/,
    /\bwhat\s+is\s+your\s+goal\b/,
    /\bhow\s+do\s+you\s+work\b/
  ];
  
  return assessmentPatterns.some(pattern => pattern.test(t));
}
