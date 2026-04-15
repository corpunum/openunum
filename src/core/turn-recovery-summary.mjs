import { getDatasetKnowledge, scoreDatasetWithKnowledgeBoost } from './dataset-knowledge.mjs';

const recoverySummaryMetrics = {
  statusDedupeDrops: 0,
  stepDedupeDrops: 0,
  statusLineCapDrops: 0,
  stepLineCapDrops: 0,
  bodyTruncations: 0,
  lastBodyLimit: 0
};

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clipText(text, maxChars = 1200) {
  const clean = String(text || '').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 3)}...`;
}

function toolResultState(run) {
  const r = run?.result || {};
  const hasError = Boolean(r.error || r.stderr) || (r.ok === false);
  const status = Number(r.status);
  const hasHttpSuccess = Number.isFinite(status) && status >= 200 && status < 400;
  const hasHttpFailure = Number.isFinite(status) && status >= 400;
  const hasPayload = Boolean(
    r.content ||
    r.text ||
    r.stdout ||
    r.path ||
    r.outPath ||
    r.jobId ||
    (Array.isArray(r.results) && r.results.length) ||
    (Array.isArray(r.json) && r.json.length) ||
    (r.json && typeof r.json === 'object' && Object.keys(r.json).length)
  );

  if (hasError || hasHttpFailure) return 'failure';
  if (r.ok === true || hasHttpSuccess || hasPayload) return 'success';
  return 'unknown';
}

function compactToolResult(result) {
  const r = result || {};
  const state = toolResultState({ result: r });
  const compact = {};
  if (state === 'success') compact.ok = true;
  if (state === 'failure') compact.ok = false;
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

export function extractRequirements(userMessage = '') {
  const prompt = String(userMessage || '').toLowerCase();
  
  // Dataset/research requests need explicit action verbs or question patterns - not just keyword mentions
  // This prevents false positives when user is quoting/critiquing a previous dataset response
  const datasetActionPattern = /\b(recommend|find|search|list|show|suggest|get|fetch|pull|download|use|train on|evaluate with|check)\b.*(dataset|training data|benchmark data|hugging face)/;
  const datasetQuestionPattern = /\b(what|which|where|how|can|should|could|recommend|suggest)\b.*\b(dataset|training data|benchmark|hugging face)\b/i;
  const explicitDatasetAsk = /\b(show me|list|recommend|find me|check)\b.*(dataset|datasets|training data)/;
  const datasetKeywordIntent = /\bhugging ?face\b.*\bdatasets?\b|\bdatasets? for (?:ai )?training\b/;
  const asksWeather = /\b(weather|wea+ther|wether|forecast|temperature|rain|wind|humidity)\b/.test(prompt);

  return {
    asksModelRanking: /model|gguf|ollama|uncensor|unsensor|local/.test(prompt) && /top ?\d+|best|hardware|run/.test(prompt),
    asksRanking: /top ?\d+|best|rank|ranking|compare|which is better/.test(prompt),
    asksSteps: /\bhow (?:to|do i|can i|should i|would i|could i|do we|can we|should we|would we|could we)\b|steps|guide|setup|configure|install|procedure|\bonboard(?:ing)?\b/.test(prompt),
    asksStatus: /status|health|inspect|diagnose|report|what happened|why failed|why is/.test(prompt),
    asksExplanation: /\bhow is\b|\bwhat is\b|\bhow does\b|\bexplain\b|\btell me\b|\bunderstand\b|\bworking\b/.test(prompt),
    asksReview: (/\b(check|review|audit|inspect|read)\b/.test(prompt) && /\b(code|docs?|documentation|changelog|onboard|onboarding|linked|used|memory|mission(?:s)?|provider(?:s)?|routing|skill(?:s)?|tool(?:s)?)\b/.test(prompt)) || /\bmake sense\b|\bmiss something\b|\bnot linked to code\b|\bunused\b/.test(prompt),
    asksResearch: (datasetActionPattern.test(prompt) || datasetQuestionPattern.test(prompt) || explicitDatasetAsk.test(prompt) || datasetKeywordIntent.test(prompt)) && /hugging ?face|dataset|training|benchmark/.test(prompt),
    asksDataset: datasetActionPattern.test(prompt) || datasetQuestionPattern.test(prompt) || explicitDatasetAsk.test(prompt) || datasetKeywordIntent.test(prompt),
    asksDocumentDiscussion: /(https?:\/\/\S+|arxiv\.org|github\.com\/[^/\s]+\/[^/\s]+)/.test(prompt) && /\b(debate|discuss|discussion|review|read|analyze|analyse|critique|harvest|what should we harvest|approach this|summari[sz]e)\b/.test(prompt),
    asksComparison: /compare|comparison|versus|vs\b/.test(prompt),
    asksTable: /\btable\b|\btabular\b|\bmatrix\b/.test(prompt),
    asksWeather,
    wantsNoLinks: /\bno links\b|dont give me links|don't give me links|without links/.test(prompt),
    wantsLocal: /local|ollama|run for this hardware|run on this hardware|this hardware/.test(prompt),
    wantsUncensored: /uncensor|uncensored|unsensored|unsensor/.test(prompt),
    wantsGguf: /gguf|ollama|local/.test(prompt),
    wantsNoInstall: /dont install|don't install|do not install/.test(prompt),
    requestedTopN: Number(prompt.match(/top ?(\d+)/)?.[1] || 5)
  };
}

function buildWeatherAnswer({ userMessage = '', executedTools = [] }) {
  const requirements = extractRequirements(userMessage);
  if (!requirements.asksWeather) return '';
  const weatherSignals = [];
  for (const run of executedTools) {
    const name = String(run?.name || '').trim();
    const r = run?.result || {};
    const chunks = [
      String(r?.content || ''),
      String(r?.text || ''),
      String(r?.stdout || ''),
      Array.isArray(r?.results)
        ? r.results
          .map((item) => `${item?.title || ''} ${item?.snippet || ''} ${item?.url || ''}`)
          .join('\n')
        : ''
    ].join('\n');
    if (!chunks.trim()) continue;
    weatherSignals.push({ name, text: chunks });
  }
  if (!weatherSignals.length) {
    return 'I could not retrieve weather data yet. Retry and I will fetch current conditions directly.';
  }
  const blob = weatherSignals.map((item) => item.text).join('\n');
  const cityMatch = blob.match(/\b(rafina|athens|thessaloniki|greece)\b/i);
  const tempMatch = blob.match(/(-?\d{1,2}(?:\.\d)?)\s*°\s*([CF])/i) || blob.match(/(-?\d{1,2}(?:\.\d)?)\s*(?:celsius|fahrenheit)\b/i);
  const conditionMatch = blob.match(/\b(sunny|clear|cloudy|overcast|rain|rainy|showers|storm|windy|fog|mist|snow)\b/i);
  const lines = [];
  const target = cityMatch ? cityMatch[1] : 'the requested location';
  if (tempMatch) {
    const unit = tempMatch[2] ? `°${String(tempMatch[2]).toUpperCase()}` : '';
    lines.push(`Current weather for ${target}: about ${tempMatch[1]}${unit}.`);
  } else {
    lines.push(`I checked current weather sources for ${target}, but the exact temperature was not reliably extractable from the fetched content.`);
  }
  if (conditionMatch) {
    lines.push(`Conditions: ${String(conditionMatch[1]).toLowerCase()}.`);
  }
  lines.push('If you want, I can retry with a single provider and return only temperature, wind, and precipitation chance.');
  return lines.join('\n');
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
  const knowledgeBoost = scoreDatasetWithKnowledgeBoost(item);
  score += knowledgeBoost.totalBoost;
  return { ...item, score, knowledgeBoost };
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
  const knowledge = getDatasetKnowledge();
  if (!ranked.length && !knowledge.hasKnowledge) return '';

  const merged = [...ranked];
  const seen = new Set(merged.map((item) => String(item.id || '').toLowerCase()));
  if (knowledge.hasKnowledge) {
    for (const seed of knowledge.top.slice(0, 10)) {
      const id = String(seed?.id || '').trim();
      if (!id || seen.has(id.toLowerCase())) continue;
      merged.push(datasetScore({
        id,
        downloads: Number(seed?.downloads || 0),
        likes: Number(seed?.likes || 0),
        tags: Array.isArray(seed?.tags) ? seed.tags.map((tag) => String(tag).toLowerCase()) : [],
        description: String(seed?.description || ''),
        query: 'openunum-local-knowledge'
      }, requirements));
      seen.add(id.toLowerCase());
      if (merged.length >= 12) break;
    }
  }
  merged.sort((a, b) => b.score - a.score);
  if (!merged.length) return '';

  const lines = ['Usable Hugging Face datasets found for this ask:'];
  for (const item of merged.slice(0, 5)) {
    const strengths = [];
    if (item.tags.some((tag) => /tool-calling|function-calling/.test(tag))) strengths.push('tool-calling');
    if (item.tags.some((tag) => /agent|agentic/.test(tag))) strengths.push('agent');
    if (item.tags.some((tag) => /task/.test(tag)) || /multi-step|workflow|task/i.test(item.description)) strengths.push('tasks/workflows');
    if (item.tags.some((tag) => /browser/.test(tag))) strengths.push('browser');
    const pilotNote = item.knowledgeBoost?.known?.inPilot ? ' | pilot=selected' : '';
    lines.push(`- ${item.id} | downloads=${formatCount(item.downloads)} | likes=${formatCount(item.likes)} | focus=${strengths.join(', ') || 'general agent data'}${pilotNote}`);
    if (item.description) lines.push(`  ${item.description}`);
  }

  if (requirements.asksComparison) {
    const toolCalling = merged.filter((item) => /tool-calling|function-calling/.test(`${item.id} ${item.tags.join(' ')} ${item.description}`.toLowerCase())).slice(0, 2);
    const planning = merged.filter((item) => /planner|planning|workflow|multi-step|task/.test(`${item.id} ${item.tags.join(' ')} ${item.description}`.toLowerCase())).slice(0, 2);
    lines.push('Comparison:');
    lines.push(`- best tool-calling fit: ${toolCalling[0]?.id || 'none found'}`);
    lines.push(`- best planner/tasks fit: ${planning[0]?.id || 'none found'}`);
  }

  lines.push('Recommendation: use tool-calling datasets for action formatting/execution traces, pair with planner/task workflow datasets for multi-step mission evaluation, and keep benchmark datasets isolated from training to avoid leakage.');
  return lines.join('\n');
}

function overallStatusFromTools(executedTools = []) {
  const meaningfulFailures = collectMeaningfulFailures(executedTools).length;
  const successes = executedTools.filter((run) => toolResultState(run) === 'success').length;
  if (!executedTools.length) return 'unknown';
  if (!meaningfulFailures) return successes ? 'ok' : 'unknown';
  if (meaningfulFailures === executedTools.length && !successes) return 'failed';
  return 'partial';
}

function collectMeaningfulFailures(executedTools = []) {
  const successes = executedTools.filter((run) => toolResultState(run) === 'success');
  const hasSuccesses = successes.length > 0;
  return executedTools.filter((run) => {
    if (toolResultState(run) !== 'failure') return false;
    const err = String(run?.result?.error || '').toLowerCase();
    if (hasSuccesses && err === 'tool_circuit_open') return false;
    return true;
  });
}

function formatToolResultHuman(run) {
  const r = run?.result || {};
  const name = run?.name || 'unknown';
  const state = toolResultState(run);
  
  if (state === 'failure') {
    const err = clipText(r.error || r.stderr || 'failed', 120);
    return `${name}: ❌ ${err}`;
  }
  
  // Success cases with human-readable summaries
  if (name === 'shell_run' || name === 'shell_command') {
    const parsedCode = Number(r.code);
    const code = Number.isFinite(parsedCode) ? parsedCode : 0;
    const stdout = r.stdout ? clipText(r.stdout.trim().split('\n')[0], 80) : '';
    return `${name}: ✅ exit ${code}${stdout ? ` — ${stdout}` : ''}`;
  }
  
  if (name === 'file_read') {
    const path = r.path || r.filePath || 'file';
    const size = r.bytesRead ? `(${formatBytes(r.bytesRead)})` : '';
    return `${name}: ✅ read ${path} ${size}`;
  }
  
  if (name === 'file_write') {
    const path = r.path || r.filePath || 'file';
    return `${name}: ✅ wrote ${path}`;
  }
  
  if (name === 'git_commit') {
    const hash = r.hash || r.shortHash ? ` ${r.shortHash || r.hash.slice(0, 7)}` : '';
    return `${name}: ✅ committed${hash}`;
  }
  
  if (name === 'git_push') {
    return `${name}: ✅ pushed`;
  }
  
  if (name === 'http_request') {
    const statusVal = Number(r.status);
    const status = Number.isFinite(statusVal) ? statusVal : '?';
    const url = r.url ? clipText(new URL(r.url).hostname, 40) : '';
    return `${name}: ✅ HTTP ${status} ${url}`;
  }

  if (name === 'web_fetch') {
    const url = r.url ? clipText(new URL(r.url).hostname, 40) : '';
    const title = r.title ? ` — ${clipText(r.title, 60)}` : '';
    return `${name}: ✅ fetched ${url}${title}`;
  }
  
  if (name === 'browser_navigate') {
    const url = r.url ? clipText(new URL(r.url).hostname, 40) : '';
    return `${name}: ✅ navigated ${url}`;
  }
  
  if (name === 'memory_remember') {
    return `${name}: ✅ stored`;
  }
  
  // Generic success fallback
  return `${name}: ✅ completed`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function countUniqueToolSurfaces(executedTools = []) {
  const surfaces = new Set();
  for (const run of executedTools) {
    const name = String(run?.name || '').trim().toLowerCase();
    if (!name) continue;
    const path = String(run?.result?.path || run?.result?.outPath || '').trim().toLowerCase();
    const url = String(run?.result?.url || '').trim().toLowerCase();
    const status = Number.isFinite(run?.result?.status) ? String(run.result.status) : '';
    surfaces.add(`${name}|${path || url || status}`);
  }
  return Math.max(0, surfaces.size);
}

function getAdaptiveLineCap(uniqueSurfaceCount = 0, base = 2, max = 6) {
  return clampInt(base + Math.max(0, Number(uniqueSurfaceCount) || 0), base, max);
}

function capSynthesisBody(body = '', uniqueSurfaceCount = 0) {
  const text = String(body || '').trim();
  if (!text) return '';
  const limit = clampInt(1800 + (Math.max(1, Number(uniqueSurfaceCount) || 1) * 180), 1800, 5200);
  recoverySummaryMetrics.lastBodyLimit = limit;
  if (text.length <= limit) return text;
  recoverySummaryMetrics.bodyTruncations += 1;
  return `${clipText(text, limit - 48)}\n[recovery summary truncated for brevity]`;
}

function buildStatusAnswer({ executedTools = [], toolRuns = 0, uniqueSurfaceCount = 0 }) {
  if (!(toolRuns > 0)) return '';
  const status = overallStatusFromTools(executedTools);
  const successes = executedTools.filter((run) => toolResultState(run) === 'success').slice(-6).map((run) => formatToolResultHuman(run));
  const failures = collectMeaningfulFailures(executedTools).slice(-2).map((run) => formatToolResultHuman(run));
  const recentRaw = [...successes, ...failures];
  const seen = new Set();
  const uniqueRecent = [];
  let dedupeDrops = 0;
  for (const line of recentRaw) {
    const key = String(line || '').trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) {
      dedupeDrops += 1;
      continue;
    }
    seen.add(key);
    uniqueRecent.push(line);
  }
  recoverySummaryMetrics.statusDedupeDrops += dedupeDrops;
  const lineCap = getAdaptiveLineCap(uniqueSurfaceCount, 2, 6);
  const recent = uniqueRecent.slice(0, lineCap);
  recoverySummaryMetrics.statusLineCapDrops += Math.max(0, uniqueRecent.length - recent.length);
  return [
    `Status: ${status}`,
    'Findings:',
    ...recent
  ].join('\n');
}

function buildStepAnswer({ executedTools = [], toolRuns = 0, uniqueSurfaceCount = 0 }) {
  if (!(toolRuns > 0)) return '';
  const lines = ['Best next steps from current evidence:'];
  const maxSteps = getAdaptiveLineCap(uniqueSurfaceCount, 2, 6);
  let dedupeDrops = 0;
  const failed = collectMeaningfulFailures(executedTools);
  const succeeded = executedTools.filter((run) => toolResultState(run) === 'success');
  const seen = new Set();
  const pushUniqueStep = (line) => {
    const key = String(line || '').trim().toLowerCase();
    if (!key) return false;
    if (seen.has(key)) {
      dedupeDrops += 1;
      return false;
    }
    seen.add(key);
    lines.push(line);
    return true;
  };
  if (failed.length) {
    for (const run of failed.slice(0, 8)) {
      const toolName = String(run?.name || 'tool');
      const err = clipText(run?.result?.error || 'error', 80);
      pushUniqueStep(`1. Resolve the blocked/failed tool path: \`${toolName}\` returned \`${err}\`.`);
      if (lines.length > maxSteps) break;
    }
  } else if (succeeded.length) {
    for (const run of succeeded.slice(-10).reverse()) {
      const toolName = String(run?.name || 'tool');
      const pathHint = run?.result?.path ? ` at \`${clipText(run.result.path, 120)}\`` : '';
      const urlHint = !pathHint && run?.result?.url ? ` from \`${clipText(run.result.url, 120)}\`` : '';
      pushUniqueStep(`1. Use the verified result from \`${toolName}\`${pathHint || urlHint} as the next execution anchor.`);
      if (lines.length > maxSteps) break;
    }
  }
  recoverySummaryMetrics.stepDedupeDrops += dedupeDrops;
  recoverySummaryMetrics.stepLineCapDrops += Math.max(0, Math.max(0, lines.length - 1) - maxSteps);
  if (lines.length > (maxSteps + 1)) lines.splice(maxSteps + 1);
  if (lines.length === 1) {
    lines.push('1. Continue from the most recent verified tool output and avoid repeating the same route unchanged.');
  }
  return lines.join('\n');
}

function uniquePaths(items = []) {
  return [...new Set(items.filter(Boolean).map((item) => String(item).trim()).filter(Boolean))];
}

function humanizePath(path = '') {
  return `\`${clipText(String(path || ''), 100)}\``;
}

function collectShellStdout(executedTools = []) {
  return executedTools
    .filter((run) => run?.name === 'shell_run' && toolResultState(run) === 'success')
    .map((run) => String(run?.result?.stdout || ''))
    .join('\n');
}

function collectShellPaths(executedTools = []) {
  const stdout = collectShellStdout(executedTools);
  if (!stdout) return [];
  const paths = stdout
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter((line) => line.startsWith('/'))
    .map((line) => line.split(/\s+/)[0])
    .filter((line) => /\/openunum\//.test(line));
  return uniquePaths(paths);
}

function collectFileReadEvidence(executedTools = []) {
  return executedTools
    .filter((run) => run?.name === 'file_read' && toolResultState(run) === 'success')
    .map((run) => ({
      path: String(run?.result?.path || '').trim(),
      content: String(run?.result?.content || '').trim()
    }))
    .filter((item) => item.path);
}

function collectMatchedPaths(executedTools = []) {
  const files = [];
  for (const run of executedTools) {
    if (toolResultState(run) !== 'success') continue;
    if (run?.name === 'file_search' && Array.isArray(run?.result?.files)) {
      files.push(...run.result.files.map((item) => String(item || '').trim()).filter(Boolean));
    }
    if (run?.name === 'file_grep' && Array.isArray(run?.result?.matches)) {
      files.push(...run.result.matches.map((item) => String(item?.file || '').trim()).filter(Boolean));
    }
    if (run?.name === 'file_read' && run?.result?.path) {
      files.push(String(run.result.path).trim());
    }
  }
  return uniquePaths(files);
}

function buildHarnessImplementationAnswer({ userMessage = '', executedTools = [] }) {
  if (!/\bharness\b/i.test(String(userMessage || ''))) return '';
  const matchedPaths = collectMatchedPaths(executedTools);
  if (!matchedPaths.length) return '';
  const runtimeHits = matchedPaths.filter((item) => /\/src\//.test(item));
  const harnessNamedRuntimeHits = runtimeHits.filter((item) => /harness/i.test(item));
  const nudgesHit = runtimeHits.find((item) => /autonomy-nudges\.mjs$/i.test(item));
  const summary = [];
  if (harnessNamedRuntimeHits.length === 0) {
    summary.push('From current code evidence, meta harness is not implemented as a first-class runtime module.');
  } else {
    summary.push('From current code evidence, harness logic exists in runtime-facing code, but it is still spread across multiple surfaces rather than one canonical module.');
  }
  if (nudgesHit) {
    summary.push(`The strongest runtime hit is ${humanizePath(nudgesHit)}, where meta-harness review appears as an autonomy nudge rather than a standalone subsystem.`);
  }
  const docsHits = matchedPaths.filter((item) => /\/docs\//.test(item)).slice(0, 3);
  const testHits = matchedPaths.filter((item) => /\/tests\//.test(item)).slice(0, 3);
  if (docsHits.length && testHits.length) {
    summary.push('Most of the other evidence is in docs/tests, which means the concept is documented and referenced, but only partially operationalized.');
  } else if (docsHits.length) {
    summary.push('Most of the other evidence is in docs, which means the concept is documented, but only partially operationalized in runtime code.');
  } else if (testHits.length) {
    summary.push('Most of the other evidence is in tests, which means the concept is asserted in checks, but not yet cleanly centralized in runtime code.');
  }
  const topPaths = uniquePaths([...runtimeHits, ...docsHits, ...testHits]).slice(0, 5);
  if (topPaths.length) {
    summary.push(`Evidence checked: ${topPaths.map(humanizePath).join(', ')}.`);
  }
  return summary.join('\n');
}

function buildCodebaseReviewAnswer({ userMessage = '', executedTools = [] }) {
  const prompt = String(userMessage || '').toLowerCase();
  const readEvidence = collectFileReadEvidence(executedTools);
  const matchedPaths = collectMatchedPaths(executedTools);
  const shellPaths = collectShellPaths(executedTools);
  if (!readEvidence.length && !matchedPaths.length && !shellPaths.length) return '';

  const harnessAnswer = buildHarnessImplementationAnswer({ userMessage, executedTools });
  if (harnessAnswer) return harnessAnswer;

  const looksLikeCodeDocReview =
    /\b(code|docs?|documentation|changelog|onboard|onboarding|linked to code|used|unused)\b/.test(prompt) ||
    (/\b(check|review|audit|inspect|read|understand)\b/.test(prompt) && /\b(memory|mission(?:s)?|provider(?:s)?|routing|skill(?:s)?|tool(?:s)?)\b/.test(prompt)) ||
    /\bmake sense\b|\bmiss something\b|\btell me\b|\bexplain\b|\bhow is\b|\bwhat is\b/.test(prompt);
  if (!looksLikeCodeDocReview) return '';

  const shellStdout = collectShellStdout(executedTools);
  const readPaths = uniquePaths([...readEvidence.map((item) => item.path), ...shellPaths]);
  const implementationPaths = readPaths.filter((item) =>
    /\/src\/core\//.test(item) ||
    /\/src\/memory\//.test(item) ||
    /\/src\/providers\//.test(item) ||
    /\/src\/skills\//.test(item) ||
    /\/src\/tools\//.test(item) ||
    /\/src\/server\/routes\//.test(item) ||
    /\/src\/models\/catalog\.mjs$/.test(item) ||
    /\/src\/ui\/modules\//.test(item)
  ).slice(0, 5);
  const docPaths = uniquePaths([
    ...readPaths.filter((item) => /\/docs\/|\/README\.md$/i.test(item)),
    ...matchedPaths.filter((item) => /\/docs\/|\/README\.md$/i.test(item))
  ]).slice(0, 6);
  const archiveOnboarding = docPaths.find((item) => /\/docs\/archive\/.*agent-onboarding\.md$/i.test(item));
  const canonicalOnboarding =
    docPaths.find((item) => /\/docs\/AGENT_ONBOARDING\.md$/i.test(item)) ||
    (/\bAGENT_ONBOARDING\.md\b/.test(shellStdout) ? '/home/corp-unum/openunum/docs/AGENT_ONBOARDING.md' : '');
  const changelogPaths = docPaths.filter((item) => /CHANGELOG/i.test(item)).slice(0, 3);

  const lines = [];
  if (implementationPaths.length) {
    lines.push(`I checked implementation files: ${implementationPaths.map(humanizePath).join(', ')}.`);
  }
  if (docPaths.length) {
    lines.push(`I checked documentation surfaces: ${docPaths.slice(0, 5).map(humanizePath).join(', ')}.`);
  }
  if (archiveOnboarding && canonicalOnboarding) {
    lines.push(`One clear mismatch is retrieval drift: the route pulled the archived onboarding doc ${humanizePath(archiveOnboarding)} while the live onboarding doc is ${humanizePath(canonicalOnboarding)}.`);
    lines.push('That means canonical docs are still too easy to lose to archive/history files during answers.');
  } else if (archiveOnboarding) {
    lines.push(`One risk is archive drift: onboarding evidence came from ${humanizePath(archiveOnboarding)} instead of a clearly canonical onboarding surface.`);
  }
  if (changelogPaths.length && implementationPaths.length) {
    lines.push('From current evidence, the code and docs both exist, but the answer path is not reliably preferring the canonical documentation set over archive material.');
  }
  if (!lines.length) return '';
  return lines.join('\n');
}

function buildWebSearchRankingAnswer({ userMessage = '', executedTools = [] }) {
  const userText = String(userMessage || '').toLowerCase();
  const strictRepoMode = /(github|repo|repository|open source|oss)/i.test(userText);
  const strictNewEntries = /\bnew entries\b|\bnew repos?\b|\bcreated\b|\bnew projects?\b/.test(userText);
  const strictTimeWindow = /(march|april|2026|this month|last month|within)/i.test(userText);
  const mustVerifyRepoWindow = strictRepoMode && strictNewEntries && strictTimeWindow;

  const fetchedEvidence = new Map();
  for (const run of executedTools) {
    if (!run || run.name !== 'web_fetch') continue;
      const url = String(run?.result?.url || '').trim();
      if (!url) continue;
      fetchedEvidence.set(
        url.toLowerCase(),
      clipText(String(run?.result?.content || run?.result?.text || run?.result?.stdout || '').replace(/\s+/g, ' ').trim(), 3000)
      );
    }

  const candidates = [];
  for (const run of executedTools) {
    if (!run || run.name !== 'web_search') continue;
    const rows = Array.isArray(run.result?.results) ? run.result.results : [];
    for (const row of rows) {
      const title = String(row?.title || '').trim();
      const url = String(row?.url || '').trim();
      const snippet = clipText(String(row?.snippet || '').replace(/\s+/g, ' ').trim(), 180);
      if (!title || !url) continue;
      if (url.includes('duckduckgo.com/?q=')) continue;
      const fetchText = fetchedEvidence.get(url.toLowerCase()) || '';
      candidates.push({ title, url, snippet, fetchText });
    }
  }

  if (!candidates.length) return '';
  const unique = [];
  const seen = new Set();
  for (const item of candidates) {
    const key = item.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= 5) break;
  }
  if (!unique.length) return '';

  const repoSignalInResults = unique.some((item) => /(github\.com|open-source|repository|repositories|repo)/i.test(`${item.title} ${item.url} ${item.snippet || ''}`));
  const asksGithubOrRepos = /(github|repo|repository|open source|oss)/i.test(userText) || repoSignalInResults;
  const asksTimeWindow = /(march|april|2026|this month|last month|within)/i.test(userText);
  const wantsTable = /\btable\b|\btabular\b|\bmatrix\b/i.test(userText);
  const wantsNoLinks = /\bno links\b|dont give me links|don't give me links|without links/i.test(userText);

  const monthWindowRegex = /(march|april)\s+2026/i;
  const repoUrlRegex = /^https?:\/\/github\.com\/[^/\s]+\/[^/\s?#]+/i;
  const filtered = mustVerifyRepoWindow
    ? unique.filter((item) => {
      const blob = `${item.title} ${item.url} ${item.snippet || ''} ${item.fetchText || ''}`.toLowerCase();
      const hasRepoUrl = repoUrlRegex.test(item.url);
      const hasWindowEvidence = monthWindowRegex.test(blob) || /2026-03|2026-04/.test(blob);
      return hasRepoUrl && hasWindowEvidence;
    })
    : unique;

  if (mustVerifyRepoWindow && filtered.length === 0) {
    return [
      'Insufficient evidence to build a verified March-April 2026 repo-only table from current search results.',
      'Constraint check failed: missing per-row repo URL and date-window evidence.',
      'Recommendation: re-run retrieval with repo-level sources (GitHub repo URLs) that include created/updated dates for March-April 2026.'
    ].join('\n');
  }

  const recommendation = asksGithubOrRepos
    ? (asksTimeWindow
      ? 'Recommendation: open the top 2-3 links and verify repo activity dates fall within March-April 2026 before final selection.'
      : 'Recommendation: open the top 2-3 links and verify stars, recent commit cadence, and release freshness before final selection.')
    : 'Recommendation: open the top 2-3 links and confirm editorial quality, update cadence, and ownership transparency before final selection.';

  const lines = ['Top candidates from current web evidence:'];
  if (wantsTable) {
    lines.push('');
    lines.push('| Rank | Candidate | Notes |');
    lines.push('|---|---|---|');
    for (let idx = 0; idx < filtered.length; idx += 1) {
      const item = filtered[idx];
      const notes = item.snippet || (asksGithubOrRepos ? 'Candidate repository source list' : 'Candidate source list');
      const candidateText = wantsNoLinks ? item.title : `[${item.title}](${item.url})`;
      lines.push(`| ${idx + 1} | ${candidateText.replace(/\|/g, '\\|')} | ${String(notes || '').replace(/\|/g, '\\|')} |`);
    }
  } else {
    lines.push(...filtered.map((item, idx) => `${idx + 1}. ${item.title} — ${item.url}${item.snippet ? ` (${item.snippet})` : ''}`));
  }
  lines.push('');
  lines.push(recommendation);

  if (asksGithubOrRepos && (userText.includes('march') || userText.includes('april'))) {
    lines.push('Comparison: prioritize repos whose release activity and commit history are explicitly within March-April 2026.');
  }
  return lines.join('\n');
}

function extractDocumentEvidence(executedTools = []) {
  const byUrl = new Map();
  const toolPriority = {
    browser_extract: 4,
    browser_read: 3,
    web_fetch: 2,
    http_request: 1
  };
  for (const run of executedTools) {
    if (toolResultState(run) !== 'success') continue;
    const name = String(run?.name || '');
    if (!['web_fetch', 'http_request', 'browser_extract', 'browser_read'].includes(name)) continue;
    const r = run?.result || {};
    const url = String(r.url || '').trim();
    const content = String(r.content || r.text || r.body || r.stdout || '').trim();
    if (!url || content.length < 80) continue;
    const prior = byUrl.get(url) || null;
    const markupPenalty = (content.match(/<[^>]+>/g) || []).length;
    const priority = toolPriority[name] || 0;
    const qualityScore = Math.min(content.length, 12000) - (markupPenalty * 12);
    const shouldReplace =
      !prior ||
      priority > prior.priority ||
      (priority === prior.priority && qualityScore > prior.qualityScore);
    if (shouldReplace) {
      byUrl.set(url, {
        tool: name,
        url,
        title: String(r.title || '').trim(),
        content,
        qualityScore,
        priority
      });
    }
  }
  return [...byUrl.values()].sort((a, b) => (b.priority - a.priority) || (b.qualityScore - a.qualityScore));
}

function normalizeDocumentText(text = '') {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractDocumentTitle(doc = null) {
  const explicit = String(doc?.title || '').trim();
  if (explicit) return explicit;
  const content = normalizeDocumentText(doc?.content || '');
  const heading = content.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return content.split('\n').map((line) => line.trim()).find((line) => line.length > 12) || '';
}

function extractAbstractSnippet(text = '') {
  const normalized = normalizeDocumentText(text);
  const abstractMatch = normalized.match(/(?:^|\n)\s*(?:#+\s*)?Abstract\s*\n([\s\S]{80,2400}?)(?:\n\s*(?:#+\s*)?(?:\d+\s+Introduction|Introduction|1\s+Introduction)\b|$)/i);
  const sectionBody = abstractMatch?.[1] || normalized.slice(0, 1800);
  const paragraph = sectionBody
    .replace(/\[[^\]]+\]\([^)]+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clipText(paragraph, 420);
}

function hasSignal(text = '', pattern) {
  return pattern.test(String(text || ''));
}

function buildDocumentDiscussionAnswer({ userMessage = '', executedTools = [] }) {
  const requirements = extractRequirements(userMessage);
  if (!requirements.asksDocumentDiscussion) return '';
  const docs = extractDocumentEvidence(executedTools);
  if (!docs.length) {
    return [
      'Document discussion could not be grounded from current tool evidence.',
      'The page may be reachable, but no readable document body was captured for analysis yet.'
    ].join('\n');
  }

  const doc = docs[0];
  const content = normalizeDocumentText(doc.content);
  const title = extractDocumentTitle(doc);
  const abstract = extractAbstractSnippet(content);
  const lines = [];

  if (title) lines.push(`Paper: ${title}`);
  if (abstract) lines.push(`Core claim: ${abstract}`);

  const alignments = [];
  if (hasSignal(content, /\bfilesystem\b/i) || hasSignal(content, /\bgrep\b/i) || hasSignal(content, /\bcat\b/i)) {
    alignments.push('It favors selective filesystem access over packing full history into one prompt. That matches OpenUnum’s direction when we keep logs and artifacts queryable instead of over-compressing them.');
  }
  if (hasSignal(content, /\bexecution traces?\b/i) || hasSignal(content, /\bscores?\b/i) || hasSignal(content, /\bprior candidates?\b/i)) {
    alignments.push('It treats raw traces, scores, and prior variants as first-class evidence. That aligns with OpenUnum audit receipts, tool traces, and session history, but our retrieval over them is still weaker than the paper’s harness-search loop.');
  }
  if (hasSignal(content, /\bvalidation before expensive benchmarks\b/i) || hasSignal(content, /\blightweight validation\b/i)) {
    alignments.push('It explicitly recommends a cheap validation pass before costly evaluation. OpenUnum should apply the same pattern to missions, model-backed tools, and provider-routed workflows.');
  }
  if (hasSignal(content, /\bautomate evaluation outside the proposer\b/i) || hasSignal(content, /\bseparate harness should score candidates\b/i)) {
    alignments.push('It keeps proposal and evaluation separate. That is consistent with OpenUnum’s verifier and guardrail direction and should remain a design rule.');
  }
  if (alignments.length) {
    lines.push('Where OpenUnum already aligns:');
    for (const item of alignments.slice(0, 4)) lines.push(`- ${item}`);
  }

  const harvest = [];
  if (hasSignal(content, /\blog everything in a format that is easy to navigate\b/i) || hasSignal(content, /\bmachine-readable formats such as json\b/i)) {
    harvest.push('Promote every mission or harness trial into a queryable artifact directory with stable JSON summaries, trace files, and score files.');
  }
  if (hasSignal(content, /\bsmall cli\b/i) || hasSignal(content, /\bpareto frontier\b/i) || hasSignal(content, /\bdiffs code and results\b/i)) {
    harvest.push('Add a narrow CLI over run history: top candidates, diffs between runs, failure clusters, and score deltas.');
  }
  if (hasSignal(content, /\bvalidation before expensive benchmarks\b/i) || hasSignal(content, /\blightweight validation\b/i)) {
    harvest.push('Insert fast preflight validators before long evaluations or expensive provider calls.');
  }
  if (hasSignal(content, /\bfull history\b/i) || hasSignal(content, /\bprior experience\b/i)) {
    harvest.push('Keep long-horizon experience externalized and retrievable, instead of relying on compressed summaries as the only memory format.');
  }
  if (!harvest.length) {
    harvest.push('The main harvest is methodological: keep harness history external, queryable, and separable into proposal, validation, and evaluation stages.');
  }
  lines.push('What to harvest:');
  for (const item of harvest.slice(0, 4)) lines.push(`- ${item}`);

  lines.push('What OpenUnum is still missing:');
  lines.push('- A first-class harness optimization loop that proposes variants, evaluates them offline, and stores comparable run artifacts under one canonical experiment layout.');
  lines.push('- A dedicated history query surface for comparing prior runs by score, trace pattern, and code diff without manual session inspection.');

  lines.push('Bottom line: the paper is directionally aligned with OpenUnum. The strongest idea to adopt is not a single heuristic, but a disciplined outer loop where harness changes are proposed, validated, evaluated, and archived as searchable evidence.');
  return lines.join('\n');
}

function buildGenericToolSummary({ executedTools = [], toolRuns = 0, requirements = null }) {
  const uniqueSurfaceCount = countUniqueToolSurfaces(executedTools);
  if (requirements?.asksWeather) {
    const weather = buildWeatherAnswer({
      userMessage: requirements?.originalUserMessage || '',
      executedTools
    });
    if (weather) return weather;
  }
  if (requirements?.asksDocumentDiscussion) {
    const discussion = buildDocumentDiscussionAnswer({
      userMessage: requirements?.originalUserMessage || '',
      executedTools
    });
    if (discussion) return discussion;
  }
  if (requirements?.asksRanking || requirements?.asksResearch || requirements?.asksComparison || requirements?.asksTable) {
    const ranked = buildWebSearchRankingAnswer({
      userMessage: requirements?.originalUserMessage || '',
      executedTools
    });
    if (ranked) return ranked;
  }
  if (requirements?.asksDataset || requirements?.asksResearch || requirements?.asksComparison) {
    const research = buildDatasetResearchAnswer({ userMessage: requirements.originalUserMessage || '', executedTools });
    if (research) return research;
  }
  if (requirements?.asksReview || requirements?.asksExplanation) {
    const review = buildCodebaseReviewAnswer({ userMessage: requirements.originalUserMessage || '', executedTools });
    if (review) return review;
  }
  if (requirements?.asksSteps) return buildStepAnswer({ executedTools, toolRuns, uniqueSurfaceCount });
  if (requirements?.asksStatus) return buildStatusAnswer({ executedTools, toolRuns, uniqueSurfaceCount });
  return buildCodebaseReviewAnswer({ userMessage: requirements?.originalUserMessage || '', executedTools }) ||
    buildStatusAnswer({ executedTools, toolRuns, uniqueSurfaceCount });
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
  const cappedBody = capSynthesisBody(body, countUniqueToolSurfaces(executedTools));
  if (!cappedBody) return '';
  return `${cappedBody}\n${buildProvenanceFooter({ executedTools, synthesized: true })}`.trim();
}

export function getTurnRecoverySummaryMetrics() {
  return { ...recoverySummaryMetrics };
}

export function resetTurnRecoverySummaryMetrics() {
  recoverySummaryMetrics.statusDedupeDrops = 0;
  recoverySummaryMetrics.stepDedupeDrops = 0;
  recoverySummaryMetrics.statusLineCapDrops = 0;
  recoverySummaryMetrics.stepLineCapDrops = 0;
  recoverySummaryMetrics.bodyTruncations = 0;
  recoverySummaryMetrics.lastBodyLimit = 0;
}

export function classifyAnswerShape(finalText = '') {
  const text = String(finalText || '');
  if (!text.trim()) return 'empty';
  if (/\|.+\|/.test(text)) return 'table';
  if (/^Status:/im.test(text)) return 'status';
  if (/^\d+\.\s+/m.test(text)) return 'steps';
  if (/^-\s+/m.test(text) && /(Top|Comparison|Findings|Recommendation|Usable)/i.test(text)) return 'ranked_list';
  return 'summary';
}

export function assessFinalAnswerQuality({ finalText = '', userMessage = '', executedTools = [], toolRuns = 0 }) {
  const text = String(finalText || '').trim();
  const requirements = extractRequirements(userMessage);
  const evidenceIds = extractEvidenceResourceIds(executedTools);
  const datasetIds = extractDatasetCandidates(executedTools).map((item) => item.id);
  const shape = classifyAnswerShape(text);
  const mentionedIds = extractResourceLikeMentions(text);
  const unsupportedIds = mentionedIds.filter((item) => !evidenceIds.map((id) => id.toLowerCase()).includes(item.toLowerCase()));
  let score = 100;
  if (!text) score -= 100;
  if (text.length > 12000) score -= 35;
  if (requirements.asksSteps && !/^\d+\.\s+/m.test(text)) score -= 18;
  if (requirements.asksComparison && !/comparison:/i.test(text)) score -= 16;
  if ((requirements.asksResearch || requirements.asksDataset) && !/recommendation:/i.test(text)) score -= 14;
  if (requirements.asksDocumentDiscussion && !/(what to harvest:|bottom line:|where openunum already aligns:|core claim:)/i.test(text)) score -= 28;
  if ((requirements.asksReview || requirements.asksExplanation) && /^Status:/im.test(text)) score -= 28;
  if ((requirements.asksReview || requirements.asksExplanation) && /^Best next steps from current evidence:/im.test(text)) score -= 32;
  if (requirements.asksRanking && !(/top|rank|recommendation/i.test(text))) score -= 16;
  if ((requirements.asksResearch || requirements.asksRanking) && text.length < 180 && toolRuns > 0) score -= 18;
  const evidenceMentions = countEvidenceMentions(text, datasetIds.length ? datasetIds : evidenceIds);
  if ((requirements.asksResearch || requirements.asksDataset || requirements.asksComparison) && evidenceIds.length > 0 && evidenceMentions === 0) {
    score -= 30;
  }
  if (unsupportedIds.length > 0) score -= Math.min(45, unsupportedIds.length * 20);
  const shouldReplace = shouldReplaceWeakFinalText({ finalText: text, userMessage, executedTools, toolRuns });
  return {
    shape,
    score: Math.max(0, score),
    shouldReplace,
    evidenceResourceCount: evidenceIds.length,
    evidenceMentions,
    unsupportedIds,
    requirements: {
      asksRanking: requirements.asksRanking,
      asksSteps: requirements.asksSteps,
      asksStatus: requirements.asksStatus,
      asksResearch: requirements.asksResearch,
      asksDataset: requirements.asksDataset,
      asksComparison: requirements.asksComparison,
      asksDocumentDiscussion: requirements.asksDocumentDiscussion,
      asksExplanation: requirements.asksExplanation,
      asksReview: requirements.asksReview
    }
  };
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
  if (/<\s*(tool_call|function_call|minimax:tool_call)\b/i.test(text)) return true;
  if (toolRuns > 0) {
    const prefaceOnly = /^(let me|i(?:'|’)ll|i will|allow me|sure[, ]+let me|checking)\b/i.test(text);
    const danglingLeadIn = /[:;]\s*$/.test(text);
    if (prefaceOnly && (danglingLeadIn || text.length < 180)) return true;
    if (danglingLeadIn && text.length < 220) return true;
  }
  const requirements = extractRequirements(userMessage);
  const datasetIds = extractDatasetCandidates(executedTools).slice(0, 5).map((item) => item.id);
  if ((requirements.asksDataset || requirements.asksResearch || requirements.asksComparison) && datasetIds.length) {
    const mentions = countEvidenceMentions(text, datasetIds);
    const onlyStatusStub = /^Status:\s+\w+/i.test(text) && /Findings:/i.test(text);
    if (mentions === 0 || onlyStatusStub) return true;
  }
  if ((requirements.asksReview || requirements.asksExplanation) && (/^Status:\s+\w+/i.test(text) || /^Best next steps from current evidence:/i.test(text))) {
    return true;
  }
  if (requirements.asksDocumentDiscussion && /^Status:\s+\w+/i.test(text)) return true;
  if (requirements.asksResearch || requirements.asksComparison || requirements.asksDataset || requirements.asksModelRanking) {
    const evidenceIds = extractEvidenceResourceIds(executedTools).map((item) => item.toLowerCase());
    const mentionedIds = extractResourceLikeMentions(text);
    const unsupported = mentionedIds.filter((item) => !evidenceIds.includes(item.toLowerCase()));
    if (unsupported.length > 0 && evidenceIds.length > 0) return true;
  }
  const hybridNeedCount = [requirements.asksComparison, requirements.asksSteps, requirements.asksRanking, requirements.asksResearch].filter(Boolean).length;
  if (hybridNeedCount >= 2) {
    const hasComparison = /comparison:/i.test(text) || /\bcompare\b/i.test(text);
    const hasRecommendation = /recommendation:/i.test(text) || /\brecommend\b/i.test(text);
    const hasSteps = /^\d+\.\s+/m.test(text) || /phase\s+\d+/i.test(text);
    if (requirements.asksComparison && !hasComparison) return true;
    if ((requirements.asksRanking || requirements.asksResearch) && !hasRecommendation) return true;
    if (requirements.asksSteps && !hasSteps) return true;
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
