import fs from 'node:fs';

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
  if (s.includes('nemotron-super') || s.includes('llama-3.3') || s.includes('llama-3.1-70b')) return 95;
  if (s.includes('qwen3.5:9b') || s.includes('llama-3.1-8b') || s.includes('nemotron-mini') || s.includes('minitron-8b')) return 80;
  return 70;
}

function modelScore({ id, name, paramsB, contextWindow }) {
  const b = benchmarkBoost(id, name);
  const p = paramsB ? Math.min(paramsB, 500) : 0;
  const c = contextWindow ? Math.min(contextWindow / 4000, 60) : 0;
  return b + p * 0.2 + c;
}

function sortModels(models) {
  return models
    .map((m) => {
      const paramsB = m.paramsB ?? parseParameterBillions(m.id) ?? parseParameterBillions(m.name);
      const score = modelScore({ ...m, paramsB });
      return { ...m, paramsB, score };
    })
    .sort((a, b) => b.score - a.score);
}

export async function fetchOllamaModels(baseUrl) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`);
  if (!res.ok) throw new Error(`Ollama tags failed: ${res.status}`);
  const data = await res.json();
  const models = (data.models || []).map((m) => ({
    id: `ollama/${m.name}`,
    name: m.name,
    provider: 'ollama',
    paramsB: parseParameterBillions(m.details?.parameter_size),
    contextWindow: m.details?.context_length || null,
    source: 'ollama-local'
  }));
  return sortModels(models);
}

export async function fetchOpenRouterModels(baseUrl, apiKey = '') {
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers });
  if (!res.ok) throw new Error(`OpenRouter models failed: ${res.status}`);
  const data = await res.json();
  const models = (data.data || []).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    provider: 'openrouter',
    paramsB: parseParameterBillions(m.id) ?? parseParameterBillions(m.name),
    contextWindow: m.context_length || null,
    source: 'openrouter'
  }));
  return sortModels(models);
}

export async function fetchNvidiaModels(baseUrl, apiKey) {
  if (!apiKey) throw new Error('NVIDIA API key missing');
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!res.ok) throw new Error(`NVIDIA models failed: ${res.status}`);
  const data = await res.json();
  const models = (data.data || []).map((m) => ({
    id: m.id,
    name: m.id,
    provider: 'nvidia',
    paramsB: parseParameterBillions(m.id),
    contextWindow: null,
    source: 'nvidia'
  }));
  return sortModels(models);
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
  const out = {
    openrouterApiKey: '',
    nvidiaApiKey: '',
    openrouterBaseUrl: '',
    nvidiaBaseUrl: ''
  };

  const configPath = '/home/corp-unum/.openclaw/openclaw.json';
  if (fs.existsSync(configPath)) {
    const json = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    out.nvidiaApiKey = json?.models?.providers?.nvidia?.apiKey || '';
    out.nvidiaBaseUrl = json?.models?.providers?.nvidia?.baseUrl || '';
    out.openrouterApiKey = json?.models?.providers?.openrouter?.apiKey || '';
    out.openrouterBaseUrl = json?.models?.providers?.openrouter?.baseUrl || '';
  }

  const envCandidates = [
    '/home/corp-unum/openclaw/.env',
    '/home/corp-unum/.openclaw/.env',
    '/home/corp-unum/.openclaw/workspace/.env.trading_agent'
  ];
  for (const p of envCandidates) {
    const env = parseEnvFile(p);
    if (!out.openrouterApiKey && env.OPENROUTER_API_KEY) out.openrouterApiKey = env.OPENROUTER_API_KEY;
    if (!out.nvidiaApiKey && (env.NVIDIA_API_KEY || env.NVIDIA_NIM_API_KEY)) {
      out.nvidiaApiKey = env.NVIDIA_API_KEY || env.NVIDIA_NIM_API_KEY;
    }
    if (!out.openrouterBaseUrl && env.OPENROUTER_BASE_URL) out.openrouterBaseUrl = env.OPENROUTER_BASE_URL;
    if (!out.nvidiaBaseUrl && env.NVIDIA_BASE_URL) out.nvidiaBaseUrl = env.NVIDIA_BASE_URL;
  }

  return out;
}

