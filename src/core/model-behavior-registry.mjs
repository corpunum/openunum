const BEHAVIOR_CLASSES = {
  tool_native_strict: {
    classId: 'tool_native_strict',
    description: 'Tool-native and schema-sensitive; strict JSON and explicit verification required.',
    tuning: { turnBudgetMs: 90000, maxIters: 4, preferHttpFirst: true, requireProofForDone: true },
    needs: { generalDirections: true, systemOverview: true, repoContext: true, openunumContext: true }
  },
  tool_native_loose: {
    classId: 'tool_native_loose',
    description: 'Calls tools but may drift; needs continuation nudges and bounded loops.',
    tuning: { turnBudgetMs: 120000, maxIters: 5, preferHttpFirst: true, requireProofForDone: true },
    needs: { generalDirections: true, systemOverview: true, repoContext: true, openunumContext: true }
  },
  planner_heavy_no_exec: {
    classId: 'planner_heavy_no_exec',
    description: 'Produces plans without acting unless execution contract is explicit.',
    tuning: { turnBudgetMs: 120000, maxIters: 6, preferHttpFirst: false, requireProofForDone: true },
    needs: { generalDirections: true, systemOverview: true, repoContext: true, openunumContext: true }
  },
  local_runtime_fragile: {
    classId: 'local_runtime_fragile',
    description: 'Weak on local runtime command quality; needs anti-REPL and bounded checks.',
    tuning: { turnBudgetMs: 180000, maxIters: 6, preferHttpFirst: true, requireProofForDone: true },
    needs: { generalDirections: true, systemOverview: true, repoContext: true, openunumContext: true }
  },
  timeout_prone_deep_thinker: {
    classId: 'timeout_prone_deep_thinker',
    description: 'Good reasoning but may consume full turn budget before producing actionable output.',
    tuning: { turnBudgetMs: 60000, maxIters: 3, preferHttpFirst: true, requireProofForDone: true },
    needs: { generalDirections: true, systemOverview: true, repoContext: false, openunumContext: true }
  }
};

const registry = new Map();

function modelKey(provider, model) {
  return `${String(provider || '').toLowerCase()}::${String(model || '').toLowerCase()}`;
}

function defaultBehaviorFor(provider, model) {
  const p = String(provider || '').toLowerCase();
  const m = String(model || '').toLowerCase();

  if (p === 'openai') return 'tool_native_strict';
  if (p === 'nvidia' || p === 'openrouter') return 'timeout_prone_deep_thinker';
  if (p === 'ollama' && /cloud|kimi|minimax|qwen3\.5:397b|glm-5/.test(m)) return 'timeout_prone_deep_thinker';
  if (p === 'ollama' && /8b|9b|14b|qwen|llama|uncensored/.test(m)) return 'local_runtime_fragile';
  return 'planner_heavy_no_exec';
}

function applyOverrides(baseBehavior, provider, model, config) {
  const overrides = config?.model?.behaviorOverrides || {};
  const key = modelKey(provider, model);
  const exact = overrides[key] || null;
  const providerOnly = overrides[String(provider || '').toLowerCase()] || null;
  const classId = exact?.classId || providerOnly?.classId || baseBehavior.classId;
  const chosen = BEHAVIOR_CLASSES[classId] || baseBehavior;
  const merged = {
    ...chosen,
    tuning: { ...(chosen.tuning || {}), ...(providerOnly?.tuning || {}), ...(exact?.tuning || {}) },
    needs: { ...(chosen.needs || {}), ...(providerOnly?.needs || {}), ...(exact?.needs || {}) }
  };
  return merged;
}

export function classifyControllerBehavior({ provider, model, config }) {
  const key = modelKey(provider, model);
  const remembered = registry.get(key) || null;
  const baselineId = defaultBehaviorFor(provider, model);
  const baseline = BEHAVIOR_CLASSES[baselineId] || BEHAVIOR_CLASSES.planner_heavy_no_exec;
  const source = remembered ? 'runtime_learned' : 'heuristic_default';
  const chosenRaw = remembered?.classId && BEHAVIOR_CLASSES[remembered.classId]
    ? BEHAVIOR_CLASSES[remembered.classId]
    : baseline;
  const chosen = applyOverrides(chosenRaw, provider, model, config);
  const confidence = remembered ? Math.min(0.95, 0.55 + (remembered.sampleCount || 0) * 0.05) : 0.55;
  return {
    ...chosen,
    confidence,
    source,
    sampleCount: remembered?.sampleCount || 0,
    reasons: remembered?.reasons || [`baseline:${baselineId}`]
  };
}

export function learnControllerBehavior({ provider, model, trace }) {
  const key = modelKey(provider, model);
  const prev = registry.get(key) || { classId: defaultBehaviorFor(provider, model), sampleCount: 0, reasons: [] };
  const timedOut = Boolean(trace?.timedOut);
  const toolRuns = Number(trace?.turnSummary?.toolRuns || 0);
  const hadProviderFailure = Array.isArray(trace?.providerFailures) && trace.providerFailures.length > 0;
  let nextClass = prev.classId;
  const reasons = [...(prev.reasons || [])];

  if (timedOut) {
    nextClass = 'timeout_prone_deep_thinker';
    reasons.push('observed:turn_timeout');
  } else if (toolRuns === 0 && Array.isArray(trace?.iterations) && trace.iterations.length > 1) {
    nextClass = 'planner_heavy_no_exec';
    reasons.push('observed:planning_without_execution');
  } else if (hadProviderFailure) {
    nextClass = 'tool_native_strict';
    reasons.push('observed:provider_failure_chain');
  } else if (toolRuns > 0) {
    nextClass = 'tool_native_loose';
    reasons.push('observed:tool_execution_success');
  }

  const next = {
    classId: nextClass,
    sampleCount: Math.min(50, (prev.sampleCount || 0) + 1),
    reasons: reasons.slice(-10)
  };
  registry.set(key, next);
  return {
    key,
    provider: String(provider || '').toLowerCase(),
    model: String(model || '').toLowerCase(),
    ...next
  };
}

export function getBehaviorRegistrySnapshot(limit = 40) {
  const rows = [];
  for (const [key, value] of registry.entries()) {
    rows.push({
      key,
      classId: value.classId,
      sampleCount: value.sampleCount,
      reasons: value.reasons
    });
  }
  rows.sort((a, b) => b.sampleCount - a.sampleCount || a.key.localeCompare(b.key));
  return rows.slice(0, limit);
}

export function hydrateBehaviorRegistry(rows = []) {
  for (const row of Array.isArray(rows) ? rows : []) {
    const provider = String(row?.provider || '').toLowerCase();
    const model = String(row?.model || '').toLowerCase();
    if (!provider || !model) continue;
    const classId = String(row?.classId || row?.class_id || '').trim();
    if (!BEHAVIOR_CLASSES[classId]) continue;
    const key = modelKey(provider, model);
    const reasons = Array.isArray(row?.reasons) ? row.reasons : [];
    registry.set(key, {
      classId,
      sampleCount: Math.max(0, Number(row?.sampleCount || row?.sample_count || 0) || 0),
      reasons: reasons.slice(0, 20)
    });
  }
}
