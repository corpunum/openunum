function parseK(str) {
  const m = String(str || '').toLowerCase().match(/(\d+)\s*k/);
  return m ? Number(m[1]) * 1000 : null;
}

function parseExplicitWindow(str) {
  const m = String(str || '').toLowerCase().match(/context[-_\s]?(?:window)?[-_\s]?(\d{4,7})/);
  return m ? Number(m[1]) : null;
}

export function resolveModelContextLimit({ config, provider, model }) {
  const key = `${provider}/${model}`;
  const hint = Number(config?.model?.contextHints?.[key] || 0);
  if (hint > 0) return hint;

  const kFromModel = parseK(model);
  if (kFromModel) return kFromModel;
  const explicit = parseExplicitWindow(model);
  if (explicit) return explicit;

  return Number(config?.runtime?.contextFallbackTokens || 16000);
}

export function estimateTextTokens(text) {
  const chars = String(text || '').length;
  return Math.max(1, Math.ceil(chars / 4));
}

export function estimateMessagesTokens(messages = []) {
  let total = 0;
  for (const m of messages) {
    total += 6; // role + structure overhead
    total += estimateTextTokens(m?.content || '');
  }
  return total;
}

export function buildContextBudgetInfo({ config, provider, model, messages }) {
  const contextLimit = resolveModelContextLimit({ config, provider, model });
  const usageTokens = estimateMessagesTokens(messages);
  const usagePct = contextLimit > 0 ? usageTokens / contextLimit : 1;
  const triggerPct = Number(config?.runtime?.contextCompactTriggerPct || 0.7);
  const targetPct = Number(config?.runtime?.contextCompactTargetPct || 0.4);
  const hardFailPct = Number(config?.runtime?.contextHardFailPct || 0.9);
  return {
    contextLimit,
    usageTokens,
    usagePct,
    triggerPct,
    targetPct,
    hardFailPct,
    overTrigger: usagePct >= triggerPct,
    overHardFail: usagePct >= hardFailPct
  };
}

