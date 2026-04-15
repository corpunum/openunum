import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../config.mjs';
import { buildModelCatalog } from '../../models/catalog.mjs';
import { buildProviderForModel } from '../../providers/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'council-config.json');
const CURATED_CANDIDATES = {
  'ollama-cloud': [
    { model_id: 'qwen3.5:397b-cloud', display_name: 'Qwen 3.5 397B Cloud', capability_score: 100 },
    { model_id: 'kimi-k2.5:cloud', display_name: 'Kimi K2.5 Cloud', capability_score: 97 },
    { model_id: 'glm-5:cloud', display_name: 'GLM-5 Cloud', capability_score: 95 },
    { model_id: 'minimax-m2.7:cloud', display_name: 'MiniMax M2.7 Cloud', capability_score: 94 }
  ],
  nvidia: [
    { model_id: 'meta/llama-3.1-405b-instruct', display_name: 'Llama 3.1 405B Instruct', capability_score: 96 },
    { model_id: 'qwen/qwen3.5-397b-a17b', display_name: 'Qwen 3.5 397B A17B', capability_score: 94 },
    { model_id: 'nvidia/llama-3.3-nemotron-super-49b-v1', display_name: 'Llama 3.3 Nemotron Super 49B', capability_score: 91 }
  ]
};

function readCouncilConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function safeParseJsonObject(text = '') {
  const source = String(text || '').trim();
  if (!source) return null;
  const fenced = source.match(/```json\s*([\s\S]+?)```/i)?.[1];
  const direct = fenced || source;
  try {
    return JSON.parse(direct);
  } catch {
    const objectMatch = direct.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }
}

function normalizeTextList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const text = String(item || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function normalizeVoteKey(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[`"'()[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMemberPrompt(request) {
  return [
    'You are a council member in OpenUnum.',
    'Respond with strict JSON only.',
    'Schema:',
    '{"summary":"short answer","claims":["factual or architectural claims"],"actions":["recommended concrete actions"],"risks":["main risks or objections"],"confidence":0.0}',
    'Keep claims and actions concise and deduplicated.',
    `Request: ${request}`
  ].join('\n');
}

function configuredCouncilCandidates(config) {
  const rows = [];
  const providerModels = config?.model?.providerModels || {};
  for (const provider of ['ollama-cloud', 'nvidia']) {
    const configured = String(providerModels[provider] || '').trim();
    if (!configured) continue;
    const modelId = configured.replace(new RegExp(`^${provider}/`), '');
    rows.push({
      provider,
      model_id: modelId,
      display_name: modelId,
      capability_score: 1000,
      source: 'configured'
    });
  }
  for (const [provider, models] of Object.entries(CURATED_CANDIDATES)) {
    for (const row of models) {
      rows.push({
        provider,
        model_id: row.model_id,
        display_name: row.display_name,
        capability_score: row.capability_score,
        source: 'curated'
      });
    }
  }
  return dedupeCandidates(rows);
}

function dedupeCandidates(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const provider = String(row?.provider || '').trim().toLowerCase();
    const modelId = String(row?.model_id || row?.model || '').trim();
    if (!provider || !modelId) continue;
    const key = `${provider}/${modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      provider,
      model_id: modelId,
      display_name: String(row?.display_name || modelId),
      capability_score: Number(row?.capability_score || 0),
      source: row?.source || 'catalog',
      providerStatus: String(row?.providerStatus || '').trim().toLowerCase() || 'unknown'
    });
  }
  return out;
}

function isExcludedModel(candidate, exclude = []) {
  const haystack = `${candidate.provider}/${candidate.model_id} ${candidate.display_name}`.toLowerCase();
  if (haystack.includes('embed')) return true;
  return exclude.some((term) => haystack.includes(String(term || '').toLowerCase()));
}

async function discoverCandidates(config, { discoverLive = true } = {}) {
  const configured = configuredCouncilCandidates(config);
  if (!discoverLive) return configured;
  try {
    const catalog = await buildModelCatalog(config.model);
    const providerStatusByProvider = new Map(
      (catalog.providers || [])
        .filter((provider) => provider.provider === 'ollama-cloud' || provider.provider === 'nvidia')
        .map((provider) => [provider.provider, String(provider.status || 'unknown').toLowerCase()])
    );
    const live = (catalog.providers || [])
      .filter((provider) => provider.provider === 'ollama-cloud' || provider.provider === 'nvidia')
      .flatMap((provider) => (provider.models || []).map((model) => ({
        provider: provider.provider,
        model_id: model.model_id,
        display_name: model.display_name,
        capability_score: Number(model.capability_score || 0),
        source: provider.status === 'healthy' ? 'catalog-live' : 'catalog-seed',
        providerStatus: provider.status
      })));
    const merged = dedupeCandidates([...configured, ...live]);
    return merged.map((row) => ({
      ...row,
      providerStatus: row.providerStatus === 'unknown'
        ? (providerStatusByProvider.get(row.provider) || 'unknown')
        : row.providerStatus
    }));
  } catch {
    return configured;
  }
}

function selectCouncil(candidates, { count, excludeModels }) {
  return candidates
    .filter((candidate) => !isExcludedModel(candidate, excludeModels))
    .sort((a, b) => {
      if (b.capability_score !== a.capability_score) return b.capability_score - a.capability_score;
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return a.model_id.localeCompare(b.model_id);
    })
    .slice(0, count)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      modelRef: `${candidate.provider}/${candidate.model_id}`
    }));
}

function buildCouncilPool(candidates, { desiredCount, excludeModels, providerPreference = [], retryMultiplier = 2 }) {
  const healthScore = (status = '') => {
    const value = String(status || '').toLowerCase();
    if (value === 'healthy') return 4;
    if (value === 'degraded') return 3;
    if (value === 'seed' || value === 'unknown') return 2;
    if (value === 'unhealthy' || value === 'down') return 1;
    return 2;
  };
  const ranked = selectCouncil(candidates, {
    count: candidates.length,
    excludeModels
  }).sort((a, b) => {
    const aProviderRank = providerPreference.indexOf(a.provider);
    const bProviderRank = providerPreference.indexOf(b.provider);
    const aPref = aProviderRank === -1 ? Number.MAX_SAFE_INTEGER : aProviderRank;
    const bPref = bProviderRank === -1 ? Number.MAX_SAFE_INTEGER : bProviderRank;
    if (aPref !== bPref) return aPref - bPref;
    const aHealth = healthScore(a.providerStatus);
    const bHealth = healthScore(b.providerStatus);
    if (bHealth !== aHealth) return bHealth - aHealth;
    if (b.capability_score !== a.capability_score) return b.capability_score - a.capability_score;
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return a.model_id.localeCompare(b.model_id);
  });
  const maxPoolSize = Math.min(
    ranked.length,
    Math.max(desiredCount, desiredCount * Math.max(1, Number(retryMultiplier || 2)))
  );
  return ranked.slice(0, maxPoolSize).map((member, index) => ({ ...member, rank: index + 1 }));
}

async function queryMember(config, member, request, timeoutMs) {
  const provider = buildProviderForModel(config, {
    provider: member.provider,
    model: member.modelRef,
    timeoutMs
  });
  const out = await provider.chat({
    messages: [
      { role: 'system', content: 'You are an expert reviewer. Output strict JSON only.' },
      { role: 'user', content: buildMemberPrompt(request) }
    ],
    tools: [],
    timeoutMs
  });
  const parsed = safeParseJsonObject(String(out?.content || ''));
  return {
    ok: Boolean(parsed),
    member: member.modelRef,
    raw: String(out?.content || '').trim(),
    summary: String(parsed?.summary || '').trim(),
    claims: normalizeTextList(parsed?.claims),
    actions: normalizeTextList(parsed?.actions),
    risks: normalizeTextList(parsed?.risks),
    confidence: Number(parsed?.confidence || 0) || 0
  };
}

async function executeCouncilWithFallback(config, councilPool, request, timeoutMs, desiredCount, query = queryMember) {
  const successes = [];
  const memberResponses = [];
  let cursor = 0;

  while (successes.length < desiredCount && cursor < councilPool.length) {
    const missing = desiredCount - successes.length;
    const batch = councilPool.slice(cursor, cursor + missing);
    cursor += batch.length;
    if (!batch.length) break;

    const batchResponses = await Promise.all(
      batch.map(async (member) => {
        try {
          return await query(config, member, request, timeoutMs);
        } catch (error) {
          return {
            ok: false,
            member: member.modelRef,
            provider: member.provider,
            error: String(error.message || error)
          };
        }
      })
    );

    memberResponses.push(...batchResponses);
    for (const response of batchResponses) {
      if (!response.ok) continue;
      const member = councilPool.find((item) => item.modelRef === response.member);
      if (!member) continue;
      successes.push(member);
    }
  }

  return {
    council: successes,
    memberResponses,
    attemptedMembers: councilPool.slice(0, cursor).map((item) => item.modelRef)
  };
}

function aggregateSupport(memberResponses, field, threshold) {
  const successResponses = memberResponses.filter((row) => row.ok);
  const requiredVotes = Math.max(1, Math.ceil(successResponses.length * threshold));
  const buckets = new Map();
  for (const row of successResponses) {
    for (const text of normalizeTextList(row[field])) {
      const key = normalizeVoteKey(text);
      const bucket = buckets.get(key) || { text, votes: 0, supporters: [] };
      bucket.votes += 1;
      bucket.supporters.push(row.member);
      buckets.set(key, bucket);
    }
  }
  return [...buckets.values()]
    .filter((bucket) => bucket.votes >= requiredVotes)
    .sort((a, b) => b.votes - a.votes || a.text.localeCompare(b.text))
    .map((bucket) => ({
      text: bucket.text,
      votes: bucket.votes,
      supporters: bucket.supporters
    }));
}

function buildCouncilSummary(memberResponses, approvedClaims, approvedActions, threshold) {
  const successful = memberResponses.filter((row) => row.ok);
  const dominantSummary = successful
    .map((row) => row.summary)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || '';
  return {
    mode: 'deterministic_consolidation',
    participatingMembers: successful.length,
    threshold,
    summary: dominantSummary,
    approvedClaims,
    approvedActions
  };
}

export async function execute(args = {}, deps = {}) {
  const config = loadConfig();
  const councilConfig = readCouncilConfig();
  const request = String(args?.request || args?.goal || '').trim();
  if (!request) {
    return { ok: false, error: 'request_required' };
  }

  const threshold = Math.max(0.5, Math.min(1, Number(args?.threshold || councilConfig.votingThreshold || 0.6)));
  const dryRun = args?.dryRun === true || args?.planOnly === true;
  const discover = deps.discoverCandidates || discoverCandidates;
  const candidates = await discover(config, { discoverLive: !dryRun });
  const desiredCount = Number(args?.count || councilConfig.maxCouncilSize || 5);
  const excludeModels = Array.isArray(councilConfig.excludeModels) ? councilConfig.excludeModels : [];
  const providerPreference = Array.isArray(councilConfig.providerPreference) ? councilConfig.providerPreference : ['ollama-cloud', 'nvidia'];
  const councilPool = buildCouncilPool(candidates, {
    desiredCount,
    excludeModels,
    providerPreference,
    retryMultiplier: Number(councilConfig.retryMultiplier || 2)
  });
  const council = councilPool.slice(0, desiredCount);
  if (!councilPool.length) {
    return { ok: false, error: 'no_council_candidates' };
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      request,
      threshold,
      council,
      councilPool,
      note: 'Dry run only. No provider calls were executed.'
    };
  }

  const execution = await executeCouncilWithFallback(
    config,
    councilPool,
    request,
    Number(councilConfig.timeoutMs || 30000),
    desiredCount,
    deps.queryMember || queryMember
  );
  const resolvedCouncil = execution.council;
  const memberResponses = execution.memberResponses;

  if (!resolvedCouncil.length) {
    return {
      ok: false,
      error: 'council_execution_failed',
      council,
      councilPool,
      attemptedMembers: execution.attemptedMembers,
      memberResponses
    };
  }

  const successful = memberResponses.filter((row) => row.ok);
  const approvedClaims = aggregateSupport(memberResponses, 'claims', threshold);
  const approvedActions = aggregateSupport(memberResponses, 'actions', threshold);
  const dissentingRisks = aggregateSupport(memberResponses, 'risks', 1 / Math.max(1, successful.length));
  const consolidated = buildCouncilSummary(memberResponses, approvedClaims, approvedActions, threshold);

  return {
    ok: true,
    request,
    threshold,
    council: resolvedCouncil,
    councilPool,
    attemptedMembers: execution.attemptedMembers,
    memberResponses,
    consolidated,
    voted: {
      approvedClaims,
      approvedActions,
      dissentingRisks
    },
    final: {
      summary: consolidated.summary,
      approvedClaims: approvedClaims.map((item) => item.text),
      approvedActions: approvedActions.map((item) => item.text),
      dissentingRisks: dissentingRisks.map((item) => item.text)
    }
  };
}

export default { execute };
