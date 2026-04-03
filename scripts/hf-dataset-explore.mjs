import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');
const secretsPath = path.join(HOME, 'secrets.json');

function loadHfToken() {
  try {
    const raw = fs.readFileSync(secretsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return String(parsed?.secrets?.huggingfaceApiKey || process.env.HUGGINGFACE_API_KEY || '').trim();
  } catch {
    return String(process.env.HUGGINGFACE_API_KEY || '').trim();
  }
}

const HF_TOKEN = loadHfToken();
const headers = HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {};

const queries = [
  { q: 'tool calling agent', weight: 1.0 },
  { q: 'function calling benchmark', weight: 1.0 },
  { q: 'agent trajectory', weight: 1.1 },
  { q: 'planner task decomposition', weight: 1.1 },
  { q: 'browser web agent tasks', weight: 0.9 },
  { q: 'multi step agent reasoning', weight: 0.9 },
  { q: 'code repair trajectories', weight: 0.8 },
  { q: 'mcp tool use', weight: 0.7 }
];

function lower(x) {
  return String(x || '').toLowerCase();
}

function scoreDataset(item, queryWeight) {
  const id = lower(item.id);
  const tags = Array.isArray(item.tags) ? item.tags.map(lower) : [];
  const card = lower(item.cardData?.dataset_info || item.cardData?.description || item.description || '');
  const text = `${id} ${tags.join(' ')} ${card}`;

  const has = (re) => re.test(text);

  let relevance = 0;
  if (has(/tool.?call|function.?call|api tool|tool use/)) relevance += 2.0;
  if (has(/agent|trajectory|workflow|chain.?of.?thought|multi.?step/)) relevance += 1.8;
  if (has(/planner|planning|task decomposition|task graph/)) relevance += 1.8;
  if (has(/benchmark|eval|evaluation|test set|grading/)) relevance += 1.2;
  if (has(/browser|web.?agent|ui action|dom/)) relevance += 0.8;
  if (has(/repair|bug.?fix|patch/)) relevance += 0.6;

  const downloads = Number(item.downloads || 0);
  const likes = Number(item.likes || 0);
  const quality = Math.min(Math.log10(downloads + 1), 6) + Math.min(Math.log10(likes + 1), 4);

  const license = lower(item.cardData?.license || tags.find((t) => t.startsWith('license:')) || '');
  const permissive = /(apache|mit|cc-by|cc0|bsd|openrail|odc|pddl)/.test(license);
  const restrictive = /(noncommercial|cc-by-nc|proprietary|unknown)/.test(license);
  const licenseScore = permissive ? 1.0 : restrictive ? -0.4 : 0.1;

  const final = (relevance * queryWeight) + quality + licenseScore;
  return {
    score: Math.round(final * 1000) / 1000,
    relevance: Math.round(relevance * 1000) / 1000,
    quality: Math.round(quality * 1000) / 1000,
    license,
    permissive,
    restrictive
  };
}

async function fetchQuery(query) {
  const url = new URL('https://huggingface.co/api/datasets');
  url.searchParams.set('search', query.q);
  url.searchParams.set('sort', 'downloads');
  url.searchParams.set('direction', '-1');
  url.searchParams.set('limit', '80');
  url.searchParams.set('full', 'true');
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`hf_query_failed ${query.q}: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((item) => ({ item, query }));
}

const collected = [];
for (const query of queries) {
  try {
    const items = await fetchQuery(query);
    collected.push(...items);
  } catch (error) {
    collected.push({ item: { id: `query_error:${query.q}`, downloads: 0, likes: 0, tags: [] }, query, error: String(error.message || error) });
  }
}

const merged = new Map();
for (const row of collected) {
  const item = row.item || {};
  const id = String(item.id || '').trim();
  if (!id || id.startsWith('query_error:')) continue;
  const scoring = scoreDataset(item, row.query.weight);
  const prev = merged.get(id);
  if (!prev || scoring.score > prev.score) {
    merged.set(id, {
      id,
      query: row.query.q,
      score: scoring.score,
      relevance: scoring.relevance,
      quality: scoring.quality,
      downloads: Number(item.downloads || 0),
      likes: Number(item.likes || 0),
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 16) : [],
      license: scoring.license || '',
      permissive: scoring.permissive,
      restrictive: scoring.restrictive,
      lastModified: item.lastModified || '',
      private: Boolean(item.private),
      gated: Boolean(item.gated)
    });
  }
}

const ranked = [...merged.values()]
  .filter((x) => !x.private)
  .sort((a, b) => b.score - a.score)
  .slice(0, 50);

const top = ranked.slice(0, 20);

const outDir = path.join(process.cwd(), 'docs', 'research');
fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, 'hf_dataset_exploration_2026-04-03.json');
fs.writeFileSync(jsonPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  usedToken: Boolean(HF_TOKEN),
  queryCount: queries.length,
  candidateCount: ranked.length,
  top
}, null, 2));

const mdPath = path.join(outDir, 'hf_dataset_exploration_2026-04-03.md');
const lines = [];
lines.push('# Hugging Face Dataset Exploration (2026-04-03)');
lines.push('');
lines.push(`- Queries: ${queries.length}`);
lines.push(`- Candidate set (deduped): ${ranked.length}`);
lines.push(`- HF token used: ${HF_TOKEN ? 'yes' : 'no'}`);
lines.push('');
lines.push('## Top Candidates for OpenUnum Improvement');
lines.push('');
lines.push('| Rank | Dataset | Score | Downloads | Likes | License | Why it matters |');
lines.push('| --- | --- | ---: | ---: | ---: | --- | --- |');
for (let i = 0; i < top.length; i += 1) {
  const row = top[i];
  const reason = [
    /tool|function/.test(lower(row.id)) ? 'tool-calling' : '',
    /agent|trajectory/.test(lower(row.id)) ? 'agent trajectories' : '',
    /planner|task/.test(lower(row.id)) ? 'planning/tasks' : '',
    /benchmark|eval/.test(lower(row.id)) ? 'evaluation' : ''
  ].filter(Boolean).join(', ') || 'general relevance';
  lines.push(`| ${i + 1} | [${row.id}](https://huggingface.co/datasets/${row.id}) | ${row.score.toFixed(3)} | ${row.downloads} | ${row.likes} | ${row.license || 'unknown'} | ${reason} |`);
}
lines.push('');
lines.push('## Recommended Ingestion Policy');
lines.push('');
lines.push('1. Keep only permissive or clearly-usable licenses for training/eval.');
lines.push('2. Sample first, do not bulk-download entire corpora.');
lines.push('3. Normalize to one OpenUnum trajectory schema (`goal`, `plan`, `tool_calls`, `observations`, `verification`, `final`).');
lines.push('4. Separate train corpora from benchmark corpora to avoid leakage.');
lines.push('5. Gate inclusion by measurable gains on OpenUnum e2e mission completion and proof quality.');
lines.push('');
lines.push('## Immediate Next Dataset Actions');
lines.push('');
lines.push('1. Build a 5-dataset pilot set from top-ranked entries.');
lines.push('2. Create adapters for function-calling and planner trajectories.');
lines.push('3. Run small-model eval (`4B-9B`) vs cloud-model eval and compare improvement deltas.');

fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);
console.log(`wrote ${jsonPath}`);
console.log(`wrote ${mdPath}`);
