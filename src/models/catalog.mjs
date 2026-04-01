import fs from 'node:fs';
import { getEffectiveOpenAICodexOAuthStatus, scanLocalAuthSources } from '../secrets/store.mjs';

export const MODEL_CATALOG_CONTRACT_VERSION = '2026-04-01.model-catalog.v1';
export const PROVIDER_ORDER = ['ollama', 'nvidia', 'openrouter', 'openai'];

const PROVIDER_LABELS = {
  ollama: 'Ollama',
  nvidia: 'Nvidia',
  openrouter: 'OpenRouter',
  openai: 'OpenAI'
};

const PROVIDER_ALIASES = {
  generic: 'openai',
  'ollama-cloud': 'ollama',
  'ollama-local': 'ollama'
};

const MODEL_SEEDS = {
  ollama: [
    seedModel('ollama', 'qwen3.5:397b-cloud', 'Qwen 3.5 397B Cloud', 262144, 100, 'medium', 'medium', true, false, true),
    seedModel('ollama', 'kimi-k2.5:cloud', 'Kimi K2.5 Cloud', 262144, 97, 'medium', 'medium', true, false, true),
    seedModel('ollama', 'glm-5:cloud', 'GLM-5 Cloud', 262144, 95, 'medium', 'medium', true, false, true),
    seedModel('ollama', 'minimax-m2.7:cloud', 'MiniMax M2.7 Cloud', 1048576, 94, 'high', 'medium', true, false, true),
    seedModel('ollama', 'minimax-m2.5:cloud', 'MiniMax M2.5 Cloud', 1048576, 92, 'high', 'medium', true, false, true),
    seedModel('ollama', 'qwen3.5:9b-262k', 'Qwen 3.5 9B 262K', 262144, 82, 'low', 'low', true, false, true),
    seedModel('ollama', 'qwen3.5:9b-128k', 'Qwen 3.5 9B 128K', 131072, 80, 'low', 'low', true, false, true),
    seedModel('ollama', 'qwen3.5:9b-64k', 'Qwen 3.5 9B 64K', 65536, 78, 'low', 'low', true, false, true)
  ],
  nvidia: [
    seedModel('nvidia', 'meta/llama-3.1-405b-instruct', 'Llama 3.1 405B Instruct', 131072, 96, 'high', 'high', true, false, true),
    seedModel('nvidia', 'qwen/qwen3.5-397b-a17b', 'Qwen 3.5 397B A17B', 131072, 94, 'high', 'high', true, false, true),
    seedModel('nvidia', 'nvidia/llama-3.3-nemotron-super-49b-v1', 'Llama 3.3 Nemotron Super 49B', 131072, 91, 'medium', 'medium', true, false, true)
  ],
  openrouter: [
    seedModel('openrouter', 'anthropic/claude-3.5-sonnet', 'Claude 3.5 Sonnet', 200000, 97, 'medium', 'high', true, true, true),
    seedModel('openrouter', 'openai/gpt-4o-mini', 'GPT-4o Mini', 128000, 89, 'low', 'medium', true, true, true)
  ],
  openai: [
    seedModel('openai', 'gpt-5.4', 'GPT-5.4', 262144, 100, 'medium', 'high', true, true, true),
    seedModel('openai', 'gpt-5.3-codex', 'GPT-5.3 Codex', 262144, 98, 'medium', 'high', true, false, true),
    seedModel('openai', 'gpt-4o-mini', 'GPT-4o Mini', 128000, 89, 'low', 'medium', true, true, true)
  ]
};

function seedModel(provider, modelId, displayName, contextWindow, capabilityScore, latencyTier, costTier, supportsTools, supportsVision, supportsReasoning) {
  return {
    provider,
    model_id: modelId,
    display_name: displayName,
    context_window: contextWindow,
    supports_tools: supportsTools,
    supports_vision: supportsVision,
    supports_reasoning: supportsReasoning,
    latency_tier: latencyTier,
    cost_tier: costTier,
    capability_score: capabilityScore,
    rank: 0,
    canonical_key: canonicalKey(provider, modelId)
  };
}

export function normalizeProviderId(rawProvider) {
  const provider = String(rawProvider || 'ollama').trim().toLowerCase();
  return PROVIDER_ALIASES[provider] || (PROVIDER_ORDER.includes(provider) ? provider : 'ollama');
}

export function normalizeModelId(provider, rawModel) {
  const normalizedProvider = normalizeProviderId(provider);
  const model = String(rawModel || '').trim();
  if (!model) return '';
  const prefixes = [
    `${normalizedProvider}/`,
    `${String(provider || '').trim().toLowerCase()}/`,
    'generic/',
    'ollama-cloud/',
    'ollama-local/'
  ].filter(Boolean);
  for (const prefix of prefixes) {
    if (model.startsWith(prefix)) return model.slice(prefix.length);
  }
  return model;
}

export function canonicalKey(provider, modelId) {
  return `${normalizeProviderId(provider)}/${normalizeModelId(provider, modelId)}`;
}

function parseParameterBillions(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  const b = t.match(/(\d+(?:\.\d+)?)\s*b/);
  if (b) return Number(b[1]);
  const m = t.match(/(\d+(?:\.\d+)?)\s*m/);
  if (m) return Number(m[1]) / 1000;
  return null;
}

function benchmarkBoost(id, name = '') {
  const s = `${id} ${name}`.toLowerCase();
  if (s.includes('gpt-5') || s.includes('o3') || s.includes('claude-3.7') || s.includes('claude-3.5')) return 120;
  if (s.includes('gemini-2.5') || s.includes('qwen3.5:397b') || s.includes('glm-5') || s.includes('kimi-k2.5')) return 110;
  if (s.includes('nemotron-super') || s.includes('llama-3.3') || s.includes('llama-3.1-405b')) return 95;
  if (s.includes('qwen3.5:9b') || s.includes('llama-3.1-8b') || s.includes('nemotron-mini') || s.includes('minitron-8b')) return 80;
  return 70;
}

function modelScore({ id, name, paramsB, contextWindow }) {
  const b = benchmarkBoost(id, name);
  const p = paramsB ? Math.min(paramsB, 500) : 0;
  const c = contextWindow ? Math.min(contextWindow / 4000, 60) : 0;
  return Math.round((b + p * 0.2 + c) * 10) / 10;
}

function sortCatalogModels(models) {
  return models
    .slice()
    .sort((a, b) => {
      if (b.capability_score !== a.capability_score) return b.capability_score - a.capability_score;
      if (b.context_window !== a.context_window) return b.context_window - a.context_window;
      if (a.display_name !== b.display_name) return a.display_name.localeCompare(b.display_name);
      return a.canonical_key.localeCompare(b.canonical_key);
    })
    .map((model, index) => ({ ...model, rank: index + 1 }));
}

function resolveOllamaApiBase(configuredBaseUrl) {
  const trimmed = String(configuredBaseUrl || '').replace(/\/+$/, '');
  return trimmed.replace(/\/v1$/i, '');
}

function makeCatalogEntry(provider, modelId, displayName, contextWindow, partial = {}) {
  const normalizedProvider = normalizeProviderId(provider);
  const normalizedModelId = normalizeModelId(provider, modelId);
  const paramsB = partial.paramsB ?? parseParameterBillions(normalizedModelId) ?? parseParameterBillions(displayName);
  return {
    provider: normalizedProvider,
    model_id: normalizedModelId,
    display_name: displayName || normalizedModelId,
    context_window: Number(contextWindow || partial.contextWindow || 0) || null,
    supports_tools: partial.supports_tools ?? true,
    supports_vision: partial.supports_vision ?? /gpt-4o|gpt-5|claude/i.test(normalizedModelId),
    supports_reasoning: partial.supports_reasoning ?? true,
    latency_tier: partial.latency_tier || 'medium',
    cost_tier: partial.cost_tier || 'medium',
    capability_score: modelScore({ id: normalizedModelId, name: displayName, paramsB, contextWindow }),
    rank: 0,
    canonical_key: canonicalKey(normalizedProvider, normalizedModelId),
    source: partial.source || normalizedProvider
  };
}

export async function fetchOllamaModels(baseUrl) {
  const apiBase = resolveOllamaApiBase(baseUrl);
  const res = await fetch(`${apiBase}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Ollama tags failed: ${res.status}`);
  const data = await res.json();
  const models = (data.models || []).map((m) => makeCatalogEntry('ollama', m.name, m.name, m.details?.context_length || null, {
    paramsB: parseParameterBillions(m.details?.parameter_size),
    source: 'ollama-local',
    supports_vision: false
  }));
  return sortCatalogModels(models);
}

export async function fetchOpenRouterModels(baseUrl, apiKey = '') {
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`OpenRouter models failed: ${res.status}`);
  const data = await res.json();
  const models = (data.data || []).map((m) => makeCatalogEntry('openrouter', m.id, m.name || m.id, m.context_length || null, {
    source: 'openrouter',
    supports_vision: true
  }));
  return sortCatalogModels(models);
}

export async function fetchNvidiaModels(baseUrl, apiKey) {
  if (!apiKey) throw new Error('NVIDIA API key missing');
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) throw new Error(`NVIDIA models failed: ${res.status}`);
  const data = await res.json();
  const models = (data.data || []).map((m) => makeCatalogEntry('nvidia', m.id, m.id, null, {
    source: 'nvidia',
    supports_vision: false
  }));
  return sortCatalogModels(models);
}

export async function fetchOpenAIModels(baseUrl, apiKey) {
  if (!baseUrl) throw new Error('OpenAI base URL missing');
  if (!apiKey && /api\.openai\.com/.test(baseUrl)) throw new Error('OpenAI API key missing');
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${String(baseUrl).replace(/\/$/, '')}/models`, {
    headers,
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) throw new Error(`OpenAI models failed: ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data.data) ? data.data : [];
  const models = items.map((m) => makeCatalogEntry('openai', m.id, m.id, null, {
    source: 'openai',
    supports_vision: /gpt-4o|gpt-5/i.test(m.id)
  }));
  return sortCatalogModels(models);
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i === -1) continue;
    const key = l.slice(0, i).trim();
    const value = l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    out[key] = value;
  }
  return out;
}

export function importProviderSecretsFromOpenClaw() {
  const scan = scanLocalAuthSources();
  return {
    openrouterApiKey: scan.secrets.openrouterApiKey || '',
    nvidiaApiKey: scan.secrets.nvidiaApiKey || '',
    openaiApiKey: scan.secrets.openaiApiKey || '',
    githubToken: scan.secrets.githubToken || '',
    huggingfaceApiKey: scan.secrets.huggingfaceApiKey || '',
    elevenlabsApiKey: scan.secrets.elevenlabsApiKey || '',
    telegramBotToken: scan.secrets.telegramBotToken || '',
    openrouterBaseUrl: scan.providerBaseUrls.openrouterBaseUrl || '',
    nvidiaBaseUrl: scan.providerBaseUrls.nvidiaBaseUrl || '',
    openaiBaseUrl: scan.providerBaseUrls.openaiBaseUrl || '',
    ollamaBaseUrl: scan.providerBaseUrls.ollamaBaseUrl || '',
    filesScanned: scan.filesScanned
  };
}

function getProviderConnection(modelConfig, provider) {
  if (provider === 'ollama') return { baseUrl: modelConfig.ollamaBaseUrl, apiKey: '' };
  if (provider === 'nvidia') return { baseUrl: modelConfig.nvidiaBaseUrl, apiKey: modelConfig.nvidiaApiKey };
  if (provider === 'openrouter') return { baseUrl: modelConfig.openrouterBaseUrl, apiKey: modelConfig.openrouterApiKey };
  const oauth = getEffectiveOpenAICodexOAuthStatus();
  return {
    baseUrl: modelConfig.openaiBaseUrl || modelConfig.genericBaseUrl || 'https://api.openai.com/v1',
    apiKey: modelConfig.openaiApiKey || modelConfig.genericApiKey || '',
    oauth
  };
}

function mergeProviderModels(provider, discovered = []) {
  const merged = new Map();
  for (const seed of MODEL_SEEDS[provider] || []) merged.set(seed.canonical_key, { ...seed });
  for (const model of discovered) {
    const existing = merged.get(model.canonical_key);
    merged.set(model.canonical_key, existing ? {
      ...existing,
      ...model,
      capability_score: Math.max(existing.capability_score, model.capability_score)
    } : model);
  }
  return sortCatalogModels([...merged.values()]);
}

function buildSelectedPointer(modelConfig, provider, modelId) {
  const normalizedProvider = normalizeProviderId(provider || modelConfig.provider);
  const normalizedModel = normalizeModelId(normalizedProvider, modelId || modelConfig.model || modelConfig.providerModels?.[normalizedProvider]);
  return {
    provider: normalizedProvider,
    model_id: normalizedModel,
    canonical_key: canonicalKey(normalizedProvider, normalizedModel)
  };
}

export async function buildModelCatalog(modelConfig) {
  const providers = [];
  for (const provider of PROVIDER_ORDER) {
    let status = 'healthy';
    let degradedReason = null;
    let discovered = [];
    try {
      const connection = getProviderConnection(modelConfig, provider);
      if (provider === 'ollama') discovered = await fetchOllamaModels(connection.baseUrl);
      else if (provider === 'nvidia') discovered = await fetchNvidiaModels(connection.baseUrl, connection.apiKey);
      else if (provider === 'openrouter') discovered = await fetchOpenRouterModels(connection.baseUrl, connection.apiKey);
      else if (connection.apiKey) discovered = await fetchOpenAIModels(connection.baseUrl, connection.apiKey);
      else if (connection.oauth?.active) discovered = [];
      else discovered = await fetchOpenAIModels(connection.baseUrl, connection.apiKey);
    } catch (error) {
      status = 'degraded';
      degradedReason = String(error.message || error);
    }
    providers.push({
      provider,
      display_name: PROVIDER_LABELS[provider],
      status,
      degraded_reason: degradedReason,
      models: mergeProviderModels(provider, discovered)
    });
  }
  return {
    contract_version: MODEL_CATALOG_CONTRACT_VERSION,
    generated_at: new Date().toISOString(),
    provider_order: [...PROVIDER_ORDER],
    selected: buildSelectedPointer(modelConfig),
    fallback: (() => {
      const fallbackProvider = modelConfig.routing?.fallbackProviders?.find((p) => normalizeProviderId(p) !== normalizeProviderId(modelConfig.provider)) || 'openrouter';
      const normalizedFallbackProvider = normalizeProviderId(fallbackProvider);
      const fallbackModel =
        modelConfig.providerModels?.[normalizedFallbackProvider] ||
        MODEL_SEEDS[normalizedFallbackProvider]?.[0]?.model_id ||
        modelConfig.providerModels?.openrouter ||
        modelConfig.providerModels?.openai;
      return buildSelectedPointer(modelConfig, normalizedFallbackProvider, fallbackModel);
    })(),
    providers
  };
}

export async function buildLegacyProviderModels(modelConfig, provider) {
  const catalog = await buildModelCatalog(modelConfig);
  const requestedProvider = normalizeProviderId(provider || modelConfig.provider);
  return catalog.providers.find((entry) => entry.provider === requestedProvider)?.models || [];
}
