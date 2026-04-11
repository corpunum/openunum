import { getDatasetKnowledge, scoreDatasetWithKnowledgeBoost } from './dataset-knowledge.mjs';

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

export function extractRequirements(userMessage = '') {
  const prompt = String(userMessage || '').toLowerCase();
  
  // Dataset/research requests need explicit action verbs or question patterns - not just keyword mentions
  // This prevents false positives when user is quoting/critiquing a previous dataset response
  const datasetActionPattern = /\b(recommend|find|search|list|show|suggest|get|fetch|pull|download|use|train on|evaluate with|check)\b.*(dataset|training data|benchmark data|hugging face)/;
  const datasetQuestionPattern = /\b(what|which|where|how|can|should|could|recommend|suggest)\b.*\b(dataset|training data|benchmark|hugging face)\b/i;
  const explicitDatasetAsk = /\b(show me|list|recommend|find me|check)\b.*(dataset|datasets|training data)/;
  const datasetKeywordIntent = /\bhugging ?face\b.*\bdatasets?\b|\bdatasets? for (?:ai )?training\b/;

  return {
    asksModelRanking: /model|gguf|ollama|uncensor|unsensor|local/.test(prompt) && /top ?\d+|best|hardware|run/.test(prompt),
    asksRanking: /top ?\d+|best|rank|ranking|compare|which is better/.test(prompt),
    asksSteps: /\bhow\b|steps|guide|setup|configure|install|onboard|procedure/.test(prompt),
    asksStatus: /status|health|inspect|diagnose|check|report|what happened|why failed|why is/.test(prompt),
    asksResearch: (datasetActionPattern.test(prompt) || datasetQuestionPattern.test(prompt) || explicitDatasetAsk.test(prompt) || datasetKeywordIntent.test(prompt)) && /hugging ?face|dataset|training|benchmark/.test(prompt),
    asksDataset: datasetActionPattern.test(prompt) || datasetQuestionPattern.test(prompt) || explicitDatasetAsk.test(prompt) || datasetKeywordIntent.test(prompt),
    asksComparison: /compare|comparison|versus|vs\b/.test(prompt),
    asksTable: /\btable\b|\btabular\b|\bmatrix\b/.test(prompt),
    wantsNoLinks: /\bno links\b|dont give me links|don't give me links|without links/.test(prompt),
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
  const failures = executedTools.filter((run) => run?.result?.ok === false).length;
  if (!executedTools.length) return 'unknown';
  if (!failures) return 'ok';
  if (failures === executedTools.length) return 'failed';
  return 'partial';
}

function formatToolResultHuman(run) {
  const r = run?.result || {};
  const name = run?.name || 'unknown';
  
  if (!r.ok) {
    const err = clipText(r.error || r.stderr || 'failed', 120);
    return `${name}: ❌ ${err}`;
  }
  
  // Success cases with human-readable summaries
  if (name === 'shell_run' || name === 'shell_command') {
    const code = Number(r.code) ?? 0;
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

function buildStatusAnswer({ executedTools = [], toolRuns = 0 }) {
  if (!(toolRuns > 0)) return '';
  const status = overallStatusFromTools(executedTools);
  const recentRaw = executedTools.slice(-8).map((run) => formatToolResultHuman(run));
  const seen = new Set();
  const recent = [];
  for (const line of recentRaw) {
    const key = String(line || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    recent.push(line);
    if (recent.length >= 4) break;
  }
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
  const seen = new Set();
  const pushUniqueStep = (line) => {
    const key = String(line || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    lines.push(line);
    return true;
  };
  if (failed.length) {
    for (const run of failed.slice(0, 8)) {
      const toolName = String(run?.name || 'tool');
      const err = clipText(run?.result?.error || 'error', 80);
      pushUniqueStep(`1. Resolve the blocked/failed tool path: \`${toolName}\` returned \`${err}\`.`);
      if (lines.length >= 4) break;
    }
  } else if (succeeded.length) {
    for (const run of succeeded.slice(-10).reverse()) {
      const toolName = String(run?.name || 'tool');
      const pathHint = run?.result?.path ? ` at \`${clipText(run.result.path, 120)}\`` : '';
      const urlHint = !pathHint && run?.result?.url ? ` from \`${clipText(run.result.url, 120)}\`` : '';
      pushUniqueStep(`1. Use the verified result from \`${toolName}\`${pathHint || urlHint} as the next execution anchor.`);
      if (lines.length >= 4) break;
    }
  }
  if (lines.length === 1) {
    lines.push('1. Continue from the most recent verified tool output and avoid repeating the same route unchanged.');
  }
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
      clipText(String(run?.result?.text || run?.result?.stdout || '').replace(/\s+/g, ' ').trim(), 3000)
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

function buildGenericToolSummary({ executedTools = [], toolRuns = 0, requirements = null }) {
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
      asksComparison: requirements.asksComparison
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
