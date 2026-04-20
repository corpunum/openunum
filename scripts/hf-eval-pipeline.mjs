#!/usr/bin/env node
/**
 * HF Eval Pipeline v2 — Expanded dataset exploration, better normalizers, richer schema
 *
 * Usage:
 *   node scripts/hf-eval-pipeline.mjs explore   — search HF for agent/tool/planner datasets
 *   node scripts/hf-eval-pipeline.mjs ingest    — download and normalize top datasets
 *   node scripts/hf-eval-pipeline.mjs eval      — run eval trajectories through the agent
 *   node scripts/hf-eval-pipeline.mjs grade     — grade eval results
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from '../src/config.mjs';
import { MemoryStore } from '../src/memory/store.mjs';
import { OpenUnumAgent } from '../src/core/agent.mjs';
import { loadEvalCorpus, enrichEvalTrajectory, storeEvalResult, getEvalStats } from '../src/eval/runner.mjs';
import { gradeEvalResult, computeOverallGrade } from '../src/eval/grader.mjs';
import { TrajectoryMemoryStore } from '../src/eval/trajectory-memory.mjs';

const HOME = process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');
const HF_TOKEN = (() => { try { return JSON.parse(fs.readFileSync(path.join(HOME, 'secrets.json'), 'utf8'))?.secrets?.huggingfaceApiKey || process.env.HUGGINGFACE_API_KEY || ''; } catch { return process.env.HUGGINGFACE_API_KEY || ''; } })();
const headers = HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {};

const RESEARCH_DIR = path.join(process.cwd(), 'docs', 'research');
const DATA_DIR = path.join(process.cwd(), 'data', 'hf-eval');
const PILOT_DIR = path.join(process.cwd(), 'data', 'hf-pilot');

// Expanded search queries targeting known benchmarks
const QUERIES = [
  { q: 'BFCL function calling benchmark', weight: 1.2 },
  { q: 'tool calling agent', weight: 1.0 },
  { q: 'function calling benchmark', weight: 1.0 },
  { q: 'agent trajectory', weight: 1.1 },
  { q: 'planner task decomposition', weight: 1.1 },
  { q: 'browser web agent tasks', weight: 0.9 },
  { q: 'multi step agent reasoning', weight: 0.9 },
  { q: 'tau bench policy tool', weight: 1.2 },
  { q: 'GAIA benchmark agent', weight: 1.1 },
  { q: 'SWE bench code repair', weight: 1.0 },
  { q: 'API Bank tool use', weight: 1.1 },
  { q: 'mcp tool use eval', weight: 0.8 },
  { q: 'agentic planning evaluation', weight: 0.9 }
];

const permissiveLicense = /(apache|mit|bsd|cc-by|cc0|odc|pddl)/i;

function safeParseJson(text) { try { return JSON.parse(text); } catch { return null; } }
function cleanText(value, max = 1200) { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > max ? text.slice(0, max - 3) + '...' : text; }
function lower(x) { return String(x || '').toLowerCase(); }

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
  if (has(/bfcl|berkeley function calling/)) relevance += 1.5;
  if (has(/tau.?bench|tau.?square/)) relevance += 1.5;
  if (has(/gaia|general ai assistant/)) relevance += 1.3;
  if (has(/swe.?bench|swe-bench/)) relevance += 1.3;
  if (has(/api.?bank/)) relevance += 1.2;

  const downloads = Number(item.downloads || 0);
  const likes = Number(item.likes || 0);
  const quality = Math.min(Math.log10(downloads + 1), 6) + Math.min(Math.log10(likes + 1), 4);

  const license = lower(item.cardData?.license || tags.find(t => t.startsWith('license:')) || '');
  const permissive = /(apache|mit|cc-by|cc0|bsd|openrail|odc|pddl)/.test(license);
  const restrictive = /(noncommercial|cc-by-nc|proprietary|unknown)/.test(license);
  const licenseScore = permissive ? 1.0 : restrictive ? -0.4 : 0.1;

  return { score: Math.round((relevance * queryWeight + quality + licenseScore) * 1000) / 1000, relevance, quality, license, permissive, restrictive };
}

async function fetchJson(url) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

// ---- EXPLORE ----

async function explore() {
  console.log('HF Eval Pipeline v2 — Exploring datasets...');
  const collected = [];
  for (const query of QUERIES) {
    try {
      const url = new URL('https://huggingface.co/api/datasets');
      url.searchParams.set('search', query.q);
      url.searchParams.set('sort', 'downloads');
      url.searchParams.set('direction', '-1');
      url.searchParams.set('limit', '80');
      url.searchParams.set('full', 'true');
      const data = await fetchJson(url.toString());
      if (!Array.isArray(data)) continue;
      for (const item of data) collected.push({ item, query });
    } catch (error) {
      console.error(`  query "${query.q}" failed: ${error.message}`);
    }
  }

  const merged = new Map();
  for (const row of collected) {
    const item = row.item || {};
    const id = String(item.id || '').trim();
    if (!id) continue;
    const scoring = scoreDataset(item, row.query.weight);
    const prev = merged.get(id);
    if (!prev || scoring.score > prev.score) {
      merged.set(id, { id, query: row.query.q, score: scoring.score, relevance: scoring.relevance, quality: scoring.quality, downloads: Number(item.downloads || 0), likes: Number(item.likes || 0), tags: Array.isArray(item.tags) ? item.tags.slice(0, 16) : [], license: scoring.license || '', permissive: scoring.permissive, restrictive: scoring.restrictive, lastModified: item.lastModified || '' });
    }
  }

  const ranked = [...merged.values()].filter(x => !x.private).sort((a, b) => b.score - a.score).slice(0, 50);
  const top = ranked.slice(0, 25);

  fs.mkdirSync(RESEARCH_DIR, { recursive: true });
  const date = new Date().toISOString().split('T')[0];
  const jsonPath = path.join(RESEARCH_DIR, `hf_eval_exploration_${date}.json`);
  const mdPath = path.join(RESEARCH_DIR, `hf_eval_exploration_${date}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), usedToken: Boolean(HF_TOKEN), queryCount: QUERIES.length, candidateCount: ranked.length, top }, null, 2));

  const md = ['# HF Eval Pipeline v2 — Dataset Exploration', '', `- Queries: ${QUERIES.length}`, `- Candidates (deduped): ${ranked.length}`, `- HF token used: ${HF_TOKEN ? 'yes' : 'no'}`, '', '## Top Candidates', '', '| Rank | Dataset | Score | Downloads | License | Relevance |', '| --- | --- | ---: | ---: | --- | ---: |'];
  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    md.push(`| ${i + 1} | [${r.id}](https://huggingface.co/datasets/${r.id}) | ${r.score.toFixed(3)} | ${r.downloads} | ${r.license || 'unknown'} | ${r.relevance.toFixed(3)} |`);
  }
  fs.writeFileSync(mdPath, md.join('\n') + '\n');
  console.log(`Explored ${ranked.length} datasets, top ${top.length} written to ${mdPath}`);
}

// ---- INGEST ----

function parseEmbedded(value) { if (typeof value !== 'string') return value; const text = value.trim(); if (!(text.startsWith('{') || text.startsWith('['))) return value; return safeParseJson(text) ?? value; }
function pickString(row, keys = []) { for (const k of keys) { const v = row?.[k]; if (typeof v === 'string' && v.trim()) return cleanText(v, 1800); } return ''; }
function toArray(value) { if (Array.isArray(value)) return value; if (value == null) return []; return [value]; }

function collectToolCallsFromObject(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const item of node) collectToolCallsFromObject(item, out); return out; }
  const asCall = (typeof node.name === 'string' || typeof node.tool_name === 'string' || typeof node.function_name === 'string') && (node.arguments != null || node.args != null || node.input != null || node.parameters != null || node.tool_input != null || node.function != null);
  if (asCall) { const name = String(node.name || node.tool_name || node.function_name || node.function?.name || '').trim(); const args = node.arguments ?? node.args ?? node.input ?? node.parameters ?? node.tool_input ?? node.function?.arguments ?? {}; if (name) out.push({ name, args }); }
  for (const value of Object.values(node)) collectToolCallsFromObject(value, out);
  return out;
}

function normalizeRowV2({ dataset, config, split, rowIdx, rawRow }) {
  const row = {};
  for (const [k, v] of Object.entries(rawRow || {})) row[k] = parseEmbedded(v);

  const goal = pickString(row, ['goal', 'task', 'instruction', 'prompt', 'query', 'question', 'user_message', 'message']) || pickString(row, ['conversation', 'input', 'context']);

  const plan = (() => {
    const raw = row.plan || row.steps || row.tasks || row.workflow || row.trajectory_summary || row.reasoning || row.chain_of_thought || row.thoughts;
    if (Array.isArray(raw)) return raw.map((item, idx) => `${idx + 1}. ${cleanText(typeof item === 'string' ? item : JSON.stringify(item), 220)}`).join('\n');
    if (typeof raw === 'string') return cleanText(raw, 1200);
    if (raw && typeof raw === 'object') { const steps = toArray(raw.steps || raw.plan || raw.tasks || raw.actions); if (steps.length) return steps.map((s, i) => `${i + 1}. ${cleanText(typeof s === 'string' ? s : JSON.stringify(s), 220)}`).join('\n'); return cleanText(JSON.stringify(raw), 1200); }
    return '';
  })();

  const toolCallsRaw = collectToolCallsFromObject(row, []);
  const toolCalls = toolCallsRaw.slice(0, 32).map((call, idx) => ({ id: `${dataset}:${rowIdx}:${idx}`, name: String(call.name || 'tool').slice(0, 96), arguments: call.args }));

  const observations = [...toArray(row.observations), ...toArray(row.results), ...toArray(row.output), ...toArray(row.response)].slice(0, 16).map(v => typeof v === 'string' ? cleanText(v, 300) : cleanText(JSON.stringify(v), 300)).filter(Boolean);

  const verification = pickString(row, ['verification', 'checks', 'assertions', 'validator', 'score']) || (row?.trajectory_summary && typeof row.trajectory_summary === 'object' ? cleanText(JSON.stringify(row.trajectory_summary), 600) : '');

  const finalAnswer = pickString(row, ['final', 'final_answer', 'answer', 'assistant_response', 'completion']) || (typeof row.output === 'string' ? cleanText(row.output, 1200) : '');

  // V2 additions: expected fields
  const expectedToolCalls = (() => {
    const raw = row.expected_tool_calls || row.expected_tools || row.ground_truth || row.reference_tool_calls;
    if (!raw) return toolCalls; // Default to observed tool calls if no expected
    if (Array.isArray(raw)) return raw.slice(0, 32).map((tc, idx) => ({ id: `expected:${idx}`, name: String(tc?.name || tc?.tool_name || tc?.function?.name || '').slice(0, 96), arguments: tc?.arguments ?? tc?.args ?? {} }));
    return toolCalls;
  })();

  const expectedFinal = pickString(row, ['expected_answer', 'ground_truth', 'expected_output', 'reference_answer', 'target']) || finalAnswer;

  const taskType = (() => {
    const g = String(goal || '').toLowerCase();
    if (/browser|navigate|click|search.*web|web.*page/i.test(g) || toolCalls.some(t => /browser|navigate|click/i.test(t.name))) return 'browser';
    if (/file|code|write.*file|edit|debug|fix/i.test(g) || toolCalls.some(t => /file|write|edit|shell/i.test(t.name))) return 'coding';
    if (/plan|step|decompos|strategy|workflow/i.test(g)) return 'planning';
    if (toolCalls.length >= 3) return 'multi_turn';
    if (toolCalls.length >= 1) return 'tool_call';
    return 'general';
  })();

  return {
    schema_version: 'openunum.trajectory.v2',
    source: { dataset, config, split, row_idx: rowIdx },
    goal: goal || '',
    plan: plan || '',
    tool_calls: toolCalls,
    observations,
    verification: verification || '',
    final: finalAnswer || '',
    // V2 fields
    expected_tool_calls: expectedToolCalls,
    expected_final: expectedFinal,
    task_type: taskType,
    grader_type: taskType === 'tool_call' ? 'trace' : taskType === 'multi_turn' ? 'trace_and_final' : taskType === 'coding' ? 'required_tools' : 'proof_score',
    max_steps: Number(row.max_steps || row.max_turns || 10) || 10,
    allowed_tools: toArray(row.allowed_tools || row.available_tools).map(String),
    forbidden_tools: toArray(row.forbidden_tools || row.disallowed_tools).map(String),
    has_action_trace: toolCalls.length > 0,
    raw_excerpt: cleanText(JSON.stringify(rawRow || {}), 1200)
  };
}

async function ingest() {
  console.log('HF Eval Pipeline v2 — Ingesting datasets...');
  const explorationPath = path.join(RESEARCH_DIR, 'hf_eval_exploration_' + new Date().toISOString().split('T')[0] + '.json');
  const pilotPath = path.join(RESEARCH_DIR, 'hf_dataset_exploration_2026-04-03.json');
  const exploration = safeParseJson(fs.readFileSync(fs.existsSync(explorationPath) ? explorationPath : pilotPath, 'utf8'));

  const top = Array.isArray(exploration?.top) ? exploration.top : [];
  const permissive = top.filter(r => permissiveLicense.test(String(r.license || ''))).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);

  if (!permissive.length) { console.error('No permissive-license datasets found'); process.exit(1); }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const normalized = [];
  const ingestion = [];

  for (const ds of permissive) {
    const item = { dataset: ds.id, ok: false, rowsFetched: 0, rowsNormalized: 0, error: null, config: null, split: null };
    try {
      const splitsUrl = `https://datasets-server.huggingface.co/splits?dataset=${encodeURIComponent(ds.id)}`;
      const splitsJson = await fetchJson(splitsUrl);
      const firstSplit = Array.isArray(splitsJson?.splits) && splitsJson.splits.length ? splitsJson.splits[0] : null;
      if (!firstSplit) throw new Error('no_split_found');
      const config = String(firstSplit.config || 'default');
      const split = String(firstSplit.split || 'train');
      item.config = config; item.split = split;

      const rowsUrl = `https://datasets-server.huggingface.co/first-rows?dataset=${encodeURIComponent(ds.id)}&config=${encodeURIComponent(config)}&split=${encodeURIComponent(split)}`;
      const rowsJson = await fetchJson(rowsUrl);
      const rows = Array.isArray(rowsJson?.rows) ? rowsJson.rows.slice(0, 24) : [];
      item.rowsFetched = rows.length;

      for (const row of rows) {
        const rowIdx = Number(row?.row_idx ?? -1);
        const rawRow = row?.row || {};
        const sample = normalizeRowV2({ dataset: ds.id, config, split, rowIdx, rawRow });
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

  const date = new Date().toISOString().split('T')[0];
  const stats = { generatedAt: new Date().toISOString(), selectedDatasets: permissive.length, totalNormalized: normalized.length, withToolCalls: normalized.filter(x => x.tool_calls.length > 0).length, withPlan: normalized.filter(x => Boolean(x.plan)).length, withFinal: normalized.filter(x => Boolean(x.final)).length, withExpected: normalized.filter(x => x.expected_tool_calls.length > 0 || Boolean(x.expected_final)).length };

  const jsonlPath = path.join(DATA_DIR, `openunum_eval_${date}.jsonl`);
  fs.writeFileSync(jsonlPath, normalized.map(r => JSON.stringify(r)).join('\n') + (normalized.length ? '\n' : ''));

  const manifest = { stats, datasets: permissive, ingestion };
  fs.writeFileSync(path.join(DATA_DIR, `manifest_${date}.json`), JSON.stringify(manifest, null, 2));

  const mdPath = path.join(RESEARCH_DIR, `hf_eval_ingestion_${date}.md`);
  const md = ['# HF Eval Pipeline v2 — Ingestion', '', `- Datasets: ${stats.selectedDatasets}`, `- Normalized: ${stats.totalNormalized}`, `- With tool calls: ${stats.withToolCalls}`, `- With plan: ${stats.withPlan}`, `- With final answer: ${stats.withFinal}`, `- With expected fields: ${stats.withExpected}`, '', '## Ingestion Status', ''];
  for (const row of ingestion) md.push(`- ${row.dataset}: ${row.ok ? 'ok' : 'failed'} | ${row.config}:${row.split} | fetched=${row.rowsFetched} normalized=${row.rowsNormalized}${row.error ? ` error=${row.error}` : ''}`);
  fs.writeFileSync(mdPath, md.join('\n') + '\n');

  console.log(`Ingested ${stats.totalNormalized} trajectories from ${stats.selectedDatasets} datasets`);
  console.log(`  with tool calls: ${stats.withToolCalls}`);
  console.log(`  with expected fields: ${stats.withExpected}`);
  console.log(`Output: ${jsonlPath}`);
}

// ---- EVAL ----

async function evalRun() {
  console.log('HF Eval Pipeline v2 — Running eval trajectories...');

  // Find latest eval corpus
  const corpusFiles = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('openunum_eval_') && f.endsWith('.jsonl')).sort();
  if (!corpusFiles.length) { console.error('No eval corpus found. Run "ingest" first.'); process.exit(1); }
  const corpusPath = path.join(DATA_DIR, corpusFiles[corpusFiles.length - 1]);

  const limit = Number(process.env.EVAL_LIMIT || 5);
  const taskTypes = (process.env.EVAL_TASK_TYPES || '').split(',').filter(Boolean);
  const trajectories = loadEvalCorpus({ corpusPath, limit, taskTypes });

  if (!trajectories.length) { console.error('No trajectories loaded.'); process.exit(1); }

  // Load config and create agent
  const config = loadConfig();
  const memory = new MemoryStore();
  const agent = new OpenUnumAgent({ config, memoryStore: memory });

  const evalRunId = `eval_${Date.now()}`;
  console.log(`Running ${trajectories.length} trajectories (run: ${evalRunId})`);

  for (let i = 0; i < trajectories.length; i++) {
    const traj = enrichEvalTrajectory(trajectories[i]);
    console.log(`\n[${i + 1}/${trajectories.length}] Goal: ${String(traj.goal).slice(0, 80)}...`);

    const startTime = Date.now();
    try {
      const result = await agent.chat({
        sessionId: `eval_${evalRunId}_${i}`,
        message: String(traj.goal || traj.plan || 'Complete this task').slice(0, 2000)
      });

      const latencyMs = Date.now() - startTime;
      const actualToolCalls = (result?.trace?.toolRuns || []).map(t => ({ name: t?.name || '', args: t?.args || {} }));

      // Grade the result
      const expected = { tool_calls: traj.expected_tool_calls || traj.tool_calls, final: traj.expected_final || traj.final, forbidden_tools: traj.forbidden_tools || [] };
      const actual = { tool_calls: actualToolCalls, final: result?.reply || '', proof_score: result?.trace?.proofScore || 0, verifier_passed: result?.trace?.verifierPassed || false };

      const modeResults = gradeEvalResult({ expected, actual, mode: 'all' });
      const overall = computeOverallGrade(modeResults);

      storeEvalResult(memory.db, {
        evalRunId,
        trajectoryId: `${traj.source?.dataset || 'unknown'}:${traj.source?.row_idx ?? i}`,
        taskType: traj.task_type || 'general',
        goal: String(traj.goal || '').slice(0, 500),
        expectedToolCalls: JSON.stringify(expected.tool_calls.slice(0, 16)),
        expectedFinal: String(expected.final).slice(0, 500),
        actualToolCalls: JSON.stringify(actualToolCalls.slice(0, 16)),
        actualFinal: String(actual.final).slice(0, 500),
        graderType: traj.grader_type || 'proof_score',
        gradeResult: overall.details,
        gradeScore: overall.score,
        gradeDetails: JSON.stringify(modeResults),
        proofScore: actual.proof_score,
        verifierPassed: actual.verifier_passed,
        stepCount: result?.trace?.steps || 0,
        toolCount: actualToolCalls.length,
        latencyMs,
        model: config?.runtime?.model || '',
        autonomyMode: config?.runtime?.autonomyMode || '',
        sessionId: `eval_${evalRunId}_${i}`,
        sourceDataset: traj.source?.dataset || ''
      });

      console.log(`  Score: ${overall.score.toFixed(2)} | Tools: ${actualToolCalls.length} | Latency: ${latencyMs}ms | ${overall.details}`);
    } catch (error) {
      console.error(`  Error: ${error.message}`);
      storeEvalResult(memory.db, {
        evalRunId,
        trajectoryId: `${traj.source?.dataset || 'unknown'}:${traj.source?.row_idx ?? i}`,
        taskType: traj.task_type || 'general',
        goal: String(traj.goal || '').slice(0, 500),
        graderType: 'error',
        gradeScore: 0,
        gradeDetails: JSON.stringify({ error: error.message }),
        latencyMs: Date.now() - startTime,
        sourceDataset: traj.source?.dataset || ''
      });
    }
  }

  // Print summary
  const stats = getEvalStats(memory.db);
  console.log('\n=== Eval Summary ===');
  console.log(`Total results: ${stats.total}`);
  console.log(`Average grade: ${stats.avgScore}`);
  for (const row of stats.byTaskType) console.log(`  ${row.task_type}: ${row.count} runs, avg score ${Math.round(row.avg_score * 100) / 100}`);
}

// ---- MAIN ----

const command = process.argv[2] || 'explore';

switch (command) {
  case 'explore': explore().catch(e => { console.error(e); process.exit(1); }); break;
  case 'ingest': ingest().catch(e => { console.error(e); process.exit(1); }); break;
  case 'eval': evalRun().catch(e => { console.error(e); process.exit(1); }); break;
  default: console.log('Usage: node scripts/hf-eval-pipeline.mjs [explore|ingest|eval]'); process.exit(1);
}