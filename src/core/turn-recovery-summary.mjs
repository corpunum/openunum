function clipText(text, maxChars = 1200) {
  const clean = String(text || '').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 3)}...`;
}

function compactToolResult(result) {
  const r = result || {};
  const compact = {
    ok: Boolean(r.ok)
  };
  if (Number.isFinite(r.code)) compact.code = r.code;
  if (r.error) compact.error = clipText(r.error, 240);
  if (r.path || r.outPath) compact.path = r.path || r.outPath;
  if (r.url) compact.url = r.url;
  if (Number.isFinite(r.status)) compact.status = r.status;
  if (r.statusText) compact.statusText = r.statusText;
  if (r.jobId) compact.jobId = r.jobId;
  if (Number.isFinite(r.attempts)) compact.attempts = r.attempts;
  if (r.stdout) compact.stdout = clipText(r.stdout, 360);
  if (r.stderr) compact.stderr = clipText(r.stderr, 260);
  if (r.text) compact.text = clipText(r.text, 360);
  if (Array.isArray(r.json)) compact.jsonSummary = `array(${r.json.length})`;
  else if (r.json && typeof r.json === 'object') compact.jsonSummary = `object(${Object.keys(r.json).length} keys)`;
  return compact;
}

function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function parseSizeToGiB(value) {
  const text = String(value || '').trim();
  const match = text.match(/(\d+(?:\.\d+)?)\s*([tgmk]?i?b?)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = String(match[2] || '').toLowerCase();
  if (!Number.isFinite(amount)) return null;
  if (unit.startsWith('tb') || unit.startsWith('ti')) return amount * 1024;
  if (unit.startsWith('gb') || unit.startsWith('gi') || unit === 'g') return amount;
  if (unit.startsWith('mb') || unit.startsWith('mi') || unit === 'm') return amount / 1024;
  if (unit.startsWith('kb') || unit.startsWith('ki') || unit === 'k') return amount / (1024 * 1024);
  return amount;
}

function inferParamsB(text) {
  const match = String(text || '').toLowerCase().match(/(\d+(?:\.\d+)?)b/);
  return match ? Number(match[1]) : null;
}

function extractRequirements(userMessage = '') {
  const prompt = String(userMessage || '').toLowerCase();
  return {
    asksModelRanking: /model|gguf|ollama|uncensor|unsensor|local/.test(prompt) && /top ?\d+|best|hardware|run/.test(prompt),
    asksRanking: /top ?\d+|best|rank|ranking|compare|which is better/.test(prompt),
    asksSteps: /\bhow\b|steps|guide|setup|configure|install|onboard|procedure/.test(prompt),
    asksStatus: /status|health|inspect|diagnose|check|report|what happened|why failed|why is/.test(prompt),
    asksResearch: /research|check|find|search|compare|usable|recommend|look at/.test(prompt),
    asksDataset: /dataset|datasets|training data|benchmark data|planner\/tasks data|task data/.test(prompt),
    asksComparison: /compare|comparison|versus|vs\b/.test(prompt),
    wantsLocal: /local|ollama|run for this hardware|run on this hardware|this hardware/.test(prompt),
    wantsUncensored: /uncensor|uncensored|unsensored|unsensor/.test(prompt),
    wantsGguf: /gguf|ollama|local/.test(prompt),
    wantsNoInstall: /dont install|don't install|do not install/.test(prompt),
    requestedTopN: Number(prompt.match(/top ?(\d+)/)?.[1] || 5)
  };
}

function extractHardwareProfile(executedTools = []) {
  const shell = executedTools
    .filter((run) => run?.name === 'shell_run' && run?.result?.ok)
    .map((run) => String(run?.result?.stdout || ''))
    .join('\n');
  const cpu = shell.match(/Model name:\s*([^\n]+)/i)?.[1]?.trim() || null;
  const threads = Number(shell.match(/CPU\(s\):\s*(\d+)/i)?.[1] || '') || null;
  const ramGiB = parseSizeToGiB(shell.match(/^Mem:\s+([^\s]+)/im)?.[1] || '');
  const noNvidia = /no nvidia gpu detected/i.test(shell);
  return {
    cpu,
    threads,
    ramGiB: Number.isFinite(ramGiB) ? ramGiB : null,
    gpu: noNvidia ? 'none detected' : null
  };
}

function extractModelCandidates(executedTools = []) {
  const rows = [];
  for (const run of executedTools) {
    if (run?.name !== 'http_request' || !run?.result?.ok || !Array.isArray(run?.result?.json)) continue;
    for (const item of run.result.json) {
      const modelId = String(item?.modelId || item?.id || '').trim();
      if (!modelId) continue;
      rows.push({
        modelId,
        downloads: Number(item?.downloads || 0),
        likes: Number(item?.likes || 0),
        private: Boolean(item?.private),
        gated: Boolean(item?.gated),
        tags: Array.isArray(item?.tags) ? item.tags.map((tag) => String(tag).toLowerCase()) : [],
        pipelineTag: item?.pipeline_tag ? String(item.pipeline_tag).toLowerCase() : ''
      });
    }
  }
  const seen = new Set();
  return rows.filter((item) => {
    if (!item.modelId || seen.has(item.modelId)) return false;
    seen.add(item.modelId);
    return true;
  });
}

function cleanDescription(text, maxChars = 220) {
  return clipText(
    String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/See the full description.*$/i, '')
      .trim(),
    maxChars
  );
}

function extractDatasetCandidates(executedTools = []) {
  const rows = [];
  for (const run of executedTools) {
    if (run?.name !== 'http_request' || !run?.result?.ok || !Array.isArray(run?.result?.json)) continue;
    if (!/huggingface\.co\/api\/datasets/i.test(String(run?.result?.url || ''))) continue;
    const query = (() => {
      try {
        return new URL(String(run.result.url)).searchParams.get('search') || '';
      } catch {
        return '';
      }
    })();
    for (const item of run.result.json) {
      const id = String(item?.id || '').trim();
      if (!id) continue;
      rows.push({
        id,
        downloads: Number(item?.downloads || 0),
        likes: Number(item?.likes || 0),
        tags: Array.isArray(item?.tags) ? item.tags.map((tag) => String(tag).toLowerCase()) : [],
        description: cleanDescription(item?.description || ''),
        query
      });
    }
  }
  const seen = new Set();
  return rows.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function extractEvidenceResourceIds(executedTools = []) {
  const ids = new Set();
  for (const item of extractDatasetCandidates(executedTools)) ids.add(item.id);
  for (const item of extractModelCandidates(executedTools)) ids.add(item.modelId);
  return [...ids];
}

function datasetScore(item, requirements) {
  const text = `${item.id} ${item.tags.join(' ')} ${item.description}`.toLowerCase();
  let score = (item.downloads * 0.05) + (item.likes * 8);
  if (requirements.asksDataset) score += 20;
  if (/tool-calling|function-calling/.test(text)) score += 80;
  if (/agent|agentic/.test(text)) score += 40;
  if (/planner|planning|workflow|multi-step|task/.test(text)) score += 36;
  if (/browser/.test(text)) score += 12;
  if (/synthetic/.test(text)) score += 8;
  if (/sft|instruction/.test(text)) score += 8;
  return { ...item, score };
}

function candidateScore(item, requirements, hardware) {
  const text = `${item.modelId} ${item.tags.join(' ')} ${item.pipelineTag}`.toLowerCase();
  const paramsB = inferParamsB(item.modelId);
  let score = (item.downloads * 0.001) + (item.likes * 2);
  if (requirements.wantsLocal) score += /gguf/.test(text) ? 120 : -150;
  if (requirements.wantsUncensored) score += /uncensor|uncensored|abliterated|heretic/.test(text) ? 80 : -200;
  if (requirements.wantsGguf) score += /gguf/.test(text) ? 60 : -80;
  if (/conversational|text-generation/.test(text)) score += 8;
  if (/vision|image-text/.test(text)) score -= 4;
  if (Number.isFinite(paramsB) && Number.isFinite(hardware?.ramGiB)) {
    if (hardware.ramGiB <= 20) {
      if (paramsB <= 9) score += 70;
      else if (paramsB <= 14) score += 20;
      else if (paramsB <= 20) score -= 40;
      else if (paramsB <= 27) score -= 220;
      else if (paramsB <= 35) score -= 420;
      else score -= 600;
    }
  }
  if (/safetensors|transformers/.test(text) && requirements.wantsLocal) score -= 160;
  return {
    ...item,
    paramsB,
    score
  };
}

function formatHardwareLine(hardware) {
  if (!hardware?.cpu && !hardware?.threads && !hardware?.ramGiB && !hardware?.gpu) return '';
  return `Hardware: ${hardware.cpu || 'unknown CPU'} | threads=${hardware.threads || '?'} | RAM≈${hardware.ramGiB ? hardware.ramGiB.toFixed(1) : '?'} GiB | GPU=${hardware.gpu || 'unknown'}`;
}

function buildModelRankingAnswer({ userMessage = '', executedTools = [] }) {
  const requirements = extractRequirements(userMessage);
  if (!requirements.asksModelRanking) return '';
  const hardware = extractHardwareProfile(executedTools);
  const topN = Math.max(1, Math.min(10, requirements.requestedTopN || 5));
  const candidates = extractModelCandidates(executedTools)
    .filter((item) => !item.private && !item.gated)
    .map((item) => candidateScore(item, requirements, hardware))
    .filter((item) => item.score > -180)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
  if (!candidates.length) return '';

  const lines = [];
  const hardwareLine = formatHardwareLine(hardware);
  if (hardwareLine) lines.push(hardwareLine);
  lines.push('Top candidates for this hardware:');
  for (let i = 0; i < candidates.length; i += 1) {
    const item = candidates[i];
    const fit =
      Number.isFinite(item.paramsB) && Number.isFinite(hardware?.ramGiB)
        ? (item.paramsB <= 9 ? 'good fit' : item.paramsB <= 20 ? 'stretch' : 'poor fit')
        : 'check fit';
    lines.push(`${i + 1}. ${item.modelId} | params=${item.paramsB || '?'}B | downloads=${formatCount(item.downloads)} | likes=${formatCount(item.likes)} | ${fit}`);
  }
  if (Number.isFinite(hardware?.ramGiB) && hardware.ramGiB <= 20) {
    lines.push('Fit note: on this machine, 4B-9B local GGUFs are the realistic default. 18B-20B are stretch options; 27B+ is generally too slow.');
  }
  if (requirements.wantsNoInstall) {
    lines.push('No install action was taken. This is a ranking from fetched model metadata plus the local hardware probe.');
  }
  return lines.join('\n');
}

function buildDatasetResearchAnswer({ userMessage = '', executedTools = [] }) {
  const requirements = extractRequirements(userMessage);
  if (!requirements.asksDataset && !requirements.asksResearch) return '';
  const ranked = extractDatasetCandidates(executedTools)
    .map((item) => datasetScore(item, requirements))
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return '';

  const lines = ['Usable Hugging Face datasets found for this ask:'];
  for (const item of ranked.slice(0, 5)) {
    const strengths = [];
    if (item.tags.some((tag) => /tool-calling|function-calling/.test(tag))) strengths.push('tool-calling');
    if (item.tags.some((tag) => /agent|agentic/.test(tag))) strengths.push('agent');
    if (item.tags.some((tag) => /task/.test(tag)) || /multi-step|workflow|task/i.test(item.description)) strengths.push('tasks/workflows');
    if (item.tags.some((tag) => /browser/.test(tag))) strengths.push('browser');
    lines.push(`- ${item.id} | downloads=${formatCount(item.downloads)} | likes=${formatCount(item.likes)} | focus=${strengths.join(', ') || 'general agent data'}`);
    if (item.description) lines.push(`  ${item.description}`);
  }

  if (requirements.asksComparison) {
    const toolCalling = ranked.filter((item) => /tool-calling|function-calling/.test(`${item.id} ${item.tags.join(' ')} ${item.description}`.toLowerCase())).slice(0, 2);
    const planning = ranked.filter((item) => /planner|planning|workflow|multi-step|task/.test(`${item.id} ${item.tags.join(' ')} ${item.description}`.toLowerCase())).slice(0, 2);
    lines.push('Comparison:');
    lines.push(`- best tool-calling fit: ${toolCalling[0]?.id || 'none found'}`);
    lines.push(`- best planner/tasks fit: ${planning[0]?.id || 'none found'}`);
  }

  lines.push('Recommendation: use tool-calling datasets for action formatting/execution traces, and pair them with planner/task workflow datasets when you need multi-step mission evaluation. Current evidence is stronger for tool-calling than for planner-specific Hugging Face datasets.');
  return lines.join('\n');
}

function overallStatusFromTools(executedTools = []) {
  const failures = executedTools.filter((run) => run?.result?.ok === false).length;
  if (!executedTools.length) return 'unknown';
  if (!failures) return 'ok';
  if (failures === executedTools.length) return 'failed';
  return 'partial';
}

function buildStatusAnswer({ executedTools = [], toolRuns = 0 }) {
  if (!(toolRuns > 0)) return '';
  const status = overallStatusFromTools(executedTools);
  const recent = executedTools.slice(-4).map((run) => {
    const compact = compactToolResult(run.result);
    return `- ${run.name}: ${clipText(JSON.stringify(compact), 220)}`;
  });
  return [
    `Status: ${status}`,
    'Findings:',
    ...recent
  ].join('\n');
}

function buildStepAnswer({ executedTools = [], toolRuns = 0 }) {
  if (!(toolRuns > 0)) return '';
  const lines = ['Best next steps from current evidence:'];
  const failed = executedTools.filter((run) => run?.result?.ok === false);
  const succeeded = executedTools.filter((run) => run?.result?.ok);
  if (failed.length) {
    for (const run of failed.slice(0, 3)) {
      lines.push(`1. Resolve the blocked/failed tool path: \`${run.name}\` returned \`${clipText(run.result?.error || 'error', 80)}\`.`);
    }
  } else if (succeeded.length) {
    for (const run of succeeded.slice(0, 3)) {
      lines.push(`1. Use the verified result from \`${run.name}\` as the next execution anchor.`);
    }
  }
  return lines.join('\n');
}

function buildGenericToolSummary({ executedTools = [], toolRuns = 0, requirements = null }) {
  if (requirements?.asksDataset || requirements?.asksResearch || requirements?.asksComparison) {
    const research = buildDatasetResearchAnswer({ userMessage: requirements.originalUserMessage || '', executedTools });
    if (research) return research;
  }
  if (requirements?.asksSteps) return buildStepAnswer({ executedTools, toolRuns });
  if (requirements?.asksStatus) return buildStatusAnswer({ executedTools, toolRuns });
  return buildStatusAnswer({ executedTools, toolRuns });
}

function buildProvenanceFooter({ executedTools = [], synthesized = false }) {
  if (!synthesized) return '';
  const toolNames = [...new Set(executedTools.map((run) => String(run?.name || '').trim()).filter(Boolean))];
  if (!toolNames.length) return 'Provenance: synthesized from tool evidence.';
  return `Provenance: synthesized from ${toolNames.length} tool surface(s): ${toolNames.join(', ')}.`;
}

export function synthesizeToolOnlyAnswer({ userMessage = '', executedTools = [], toolRuns = 0 }) {
  const requirements = { ...extractRequirements(userMessage), originalUserMessage: userMessage };
  const body = buildModelRankingAnswer({ userMessage, executedTools }) ||
    buildGenericToolSummary({ executedTools, toolRuns, requirements }) ||
    '';
  if (!body) return '';
  return `${body}\n${buildProvenanceFooter({ executedTools, synthesized: true })}`.trim();
}

function countEvidenceMentions(text = '', evidenceTerms = []) {
  const source = String(text || '').toLowerCase();
  return evidenceTerms.filter((term) => term && source.includes(String(term).toLowerCase())).length;
}

function extractResourceLikeMentions(text = '') {
  const source = String(text || '');
  const matches = source.match(/\b[A-Za-z0-9._-]+\/[A-Za-z0-9][A-Za-z0-9._/-]*\b/g) || [];
  return [...new Set(matches)];
}

function shouldReplaceWeakFinalText({ finalText = '', userMessage = '', executedTools = [], toolRuns = 0 }) {
  const text = String(finalText || '').trim();
  if (!text) return true;
  if (text.length > 12000) return true;
  if (/Tool actions executed \(\d+\) but model returned no final message\./.test(text)) return true;
  const requirements = extractRequirements(userMessage);
  const datasetIds = extractDatasetCandidates(executedTools).slice(0, 5).map((item) => item.id);
  if ((requirements.asksDataset || requirements.asksResearch || requirements.asksComparison) && datasetIds.length) {
    const mentions = countEvidenceMentions(text, datasetIds);
    const onlyStatusStub = /^Status:\s+\w+/i.test(text) && /Findings:/i.test(text);
    if (mentions === 0 || onlyStatusStub) return true;
  }
  if (requirements.asksResearch || requirements.asksComparison || requirements.asksDataset || requirements.asksModelRanking) {
    const evidenceIds = extractEvidenceResourceIds(executedTools).map((item) => item.toLowerCase());
    const mentionedIds = extractResourceLikeMentions(text);
    const unsupported = mentionedIds.filter((item) => !evidenceIds.includes(item.toLowerCase()));
    if (unsupported.length > 0 && evidenceIds.length > 0) return true;
  }
  if (requirements.asksRanking && /top candidates|recommendation|comparison/i.test(text) === false && toolRuns > 0) return true;
  return false;
}

export function normalizeRecoveredFinalText({ finalText = '', userMessage = '', executedTools = [], toolRuns = 0, maxChars = 12000 } = {}) {
  const text = String(finalText || '');
  const recovered = synthesizeToolOnlyAnswer({ userMessage, executedTools, toolRuns });
  if (!text) return recovered;
  if (shouldReplaceWeakFinalText({ finalText: text, userMessage, executedTools, toolRuns })) {
    return recovered || clipText(text, maxChars);
  }
  if (text.length > maxChars) return recovered || clipText(text, maxChars);
  return text;
}
