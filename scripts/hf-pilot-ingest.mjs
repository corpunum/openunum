import fs from 'node:fs';
import path from 'node:path';

const MAX_DATASETS = Number(process.env.HF_PILOT_DATASETS || 5);
const MAX_ROWS_PER_DATASET = Number(process.env.HF_PILOT_ROWS || 24);
const REQUEST_TIMEOUT_MS = Number(process.env.HF_TIMEOUT_MS || 20000);

const explorationPath = path.join(process.cwd(), 'docs', 'research', 'hf_dataset_exploration_2026-04-03.json');
const outDir = path.join(process.cwd(), 'data', 'hf-pilot');
const outJsonlPath = path.join(outDir, 'openunum_trajectory_pilot.jsonl');
const outManifestPath = path.join(outDir, 'manifest.json');
const outReportPath = path.join(process.cwd(), 'docs', 'research', 'hf_pilot_ingestion_2026-04-03.md');

const permissiveLicense = /(apache|mit|bsd|cc-by|cc0|odc|pddl)/i;

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cleanText(value, max = 1200) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function pickString(row, keys = []) {
  for (const key of keys) {
    const v = row?.[key];
    if (typeof v === 'string' && v.trim()) return cleanText(v, 1800);
  }
  return '';
}

function parseEmbedded(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return value;
  if (!(text.startsWith('{') || text.startsWith('['))) return value;
  return safeParseJson(text) ?? value;
}

function collectToolCallsFromObject(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectToolCallsFromObject(item, out);
    return out;
  }
  const asCall =
    (typeof node.name === 'string' || typeof node.tool_name === 'string' || typeof node.function_name === 'string') &&
    (node.arguments != null || node.args != null || node.input != null || node.parameters != null || node.tool_input != null || node.function != null);
  if (asCall) {
    const name = String(node.name || node.tool_name || node.function_name || node.function?.name || '').trim();
    const args = node.arguments ?? node.args ?? node.input ?? node.parameters ?? node.tool_input ?? node.function?.arguments ?? {};
    if (name) out.push({ name, args });
  }
  for (const value of Object.values(node)) collectToolCallsFromObject(value, out);
  return out;
}

function toPlan(value) {
  if (Array.isArray(value)) {
    return value
      .map((item, idx) => `${idx + 1}. ${cleanText(typeof item === 'string' ? item : JSON.stringify(item), 220)}`)
      .join('\n');
  }
  if (typeof value === 'string') return cleanText(value, 1200);
  if (value && typeof value === 'object') {
    const steps = toArray(value.steps || value.plan || value.tasks || value.actions);
    if (steps.length) return toPlan(steps);
    return cleanText(JSON.stringify(value), 1200);
  }
  return '';
}

function toObservation(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(typeof item === 'string' ? item : JSON.stringify(item), 300)).filter(Boolean);
  }
  if (typeof value === 'string') return [cleanText(value, 300)].filter(Boolean);
  if (value && typeof value === 'object') return [cleanText(JSON.stringify(value), 300)].filter(Boolean);
  return [];
}

function normalizeRow({ dataset, config, split, rowIdx, rawRow }) {
  const row = {};
  for (const [k, v] of Object.entries(rawRow || {})) row[k] = parseEmbedded(v);

  const goal = pickString(row, ['goal', 'task', 'instruction', 'prompt', 'query', 'question', 'user_message', 'message']) ||
    pickString(row, ['conversation', 'input', 'context']);

  const plan =
    toPlan(row.plan || row.steps || row.tasks || row.workflow || row.trajectory_summary || row.reasoning || row.chain_of_thought || row.thoughts);

  const toolCallsRaw = collectToolCallsFromObject(row, []);
  const toolCalls = toolCallsRaw.slice(0, 16).map((call, idx) => ({
    id: `${dataset}:${rowIdx}:${idx}`,
    name: String(call.name || 'tool').slice(0, 96),
    arguments: call.args
  }));

  const observations = [
    ...toObservation(row.observations),
    ...toObservation(row.results),
    ...toObservation(row.output),
    ...toObservation(row.response)
  ].slice(0, 12);

  const verification =
    pickString(row, ['verification', 'checks', 'assertions', 'validator', 'score']) ||
    (row?.trajectory_summary && typeof row.trajectory_summary === 'object' ? cleanText(JSON.stringify(row.trajectory_summary), 600) : '');

  const finalAnswer = pickString(row, ['final', 'final_answer', 'answer', 'assistant_response', 'completion']) ||
    (typeof row.output === 'string' ? cleanText(row.output, 1200) : '');

  return {
    schema_version: 'openunum.trajectory.v1',
    source: {
      dataset,
      config,
      split,
      row_idx: rowIdx
    },
    goal: goal || '',
    plan: plan || '',
    tool_calls: toolCalls,
    observations,
    verification: verification || '',
    final: finalAnswer || '',
    has_action_trace: toolCalls.length > 0,
    raw_excerpt: cleanText(JSON.stringify(rawRow || {}), 1200)
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

function pickPilotDatasets(top = []) {
  return top
    .filter((row) => permissiveLicense.test(String(row.license || '')))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, MAX_DATASETS)
    .map((row) => ({
      id: String(row.id || ''),
      score: Number(row.score || 0),
      license: String(row.license || ''),
      downloads: Number(row.downloads || 0),
      likes: Number(row.likes || 0)
    }))
    .filter((row) => row.id);
}

const exploration = safeParseJson(fs.readFileSync(explorationPath, 'utf8'));
if (!exploration || !Array.isArray(exploration.top)) {
  throw new Error(`invalid_exploration_file:${explorationPath}`);
}

const pilotDatasets = pickPilotDatasets(exploration.top);
if (!pilotDatasets.length) throw new Error('no_pilot_datasets_selected');

fs.mkdirSync(outDir, { recursive: true });
const normalized = [];
const ingestion = [];

for (const ds of pilotDatasets) {
  const item = { dataset: ds.id, ok: false, rowsFetched: 0, rowsNormalized: 0, error: null, config: null, split: null };
  try {
    const splitsUrl = `https://datasets-server.huggingface.co/splits?dataset=${encodeURIComponent(ds.id)}`;
    const splitsJson = await fetchJson(splitsUrl);
    const firstSplit = Array.isArray(splitsJson?.splits) && splitsJson.splits.length
      ? splitsJson.splits[0]
      : null;
    if (!firstSplit) throw new Error('no_split_found');

    const config = String(firstSplit.config || 'default');
    const split = String(firstSplit.split || 'train');
    item.config = config;
    item.split = split;

    const rowsUrl = `https://datasets-server.huggingface.co/first-rows?dataset=${encodeURIComponent(ds.id)}&config=${encodeURIComponent(config)}&split=${encodeURIComponent(split)}`;
    const rowsJson = await fetchJson(rowsUrl);
    const rows = Array.isArray(rowsJson?.rows) ? rowsJson.rows.slice(0, MAX_ROWS_PER_DATASET) : [];
    item.rowsFetched = rows.length;

    for (const row of rows) {
      const rowIdx = Number(row?.row_idx ?? -1);
      const rawRow = row?.row || {};
      const sample = normalizeRow({ dataset: ds.id, config, split, rowIdx, rawRow });
      if (!sample.goal && !sample.plan && !sample.final && sample.tool_calls.length === 0) continue;
      normalized.push(sample);
      item.rowsNormalized += 1;
    }
    item.ok = true;
  } catch (error) {
    item.error = String(error.message || error);
  }
  ingestion.push(item);
}

const stats = {
  generatedAt: new Date().toISOString(),
  selectedDatasets: pilotDatasets.length,
  totalNormalized: normalized.length,
  withToolCalls: normalized.filter((x) => x.tool_calls.length > 0).length,
  withPlan: normalized.filter((x) => Boolean(x.plan)).length,
  withFinal: normalized.filter((x) => Boolean(x.final)).length
};

fs.writeFileSync(outJsonlPath, normalized.map((row) => JSON.stringify(row)).join('\n') + (normalized.length ? '\n' : ''));
fs.writeFileSync(outManifestPath, JSON.stringify({ stats, pilotDatasets, ingestion }, null, 2));

const md = [];
md.push('# HF Pilot Ingestion (2026-04-03)');
md.push('');
md.push(`- Selected datasets: ${stats.selectedDatasets}`);
md.push(`- Normalized trajectories: ${stats.totalNormalized}`);
md.push(`- Samples with tool calls: ${stats.withToolCalls}`);
md.push(`- Samples with plan text: ${stats.withPlan}`);
md.push(`- Samples with final answer text: ${stats.withFinal}`);
md.push('');
md.push('## Selected datasets');
md.push('');
for (const ds of pilotDatasets) {
  md.push(`- ${ds.id} (score=${ds.score.toFixed(3)}, license=${ds.license || 'unknown'}, downloads=${ds.downloads}, likes=${ds.likes})`);
}
md.push('');
md.push('## Ingestion status');
md.push('');
for (const row of ingestion) {
  md.push(`- ${row.dataset}: ${row.ok ? 'ok' : 'failed'} | split=${row.config || '?'}:${row.split || '?'} | fetched=${row.rowsFetched} | normalized=${row.rowsNormalized}${row.error ? ` | error=${row.error}` : ''}`);
}
md.push('');
md.push('## Output artifacts');
md.push('');
md.push(`- \`${path.relative(process.cwd(), outJsonlPath)}\``);
md.push(`- \`${path.relative(process.cwd(), outManifestPath)}\``);

fs.writeFileSync(outReportPath, `${md.join('\n')}\n`);

console.log(`wrote ${outJsonlPath}`);
console.log(`wrote ${outManifestPath}`);
console.log(`wrote ${outReportPath}`);
console.log(`normalized trajectories: ${normalized.length}`);
