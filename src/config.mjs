import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

dotenv.config();

export function getHomeDir() {
  return process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');
}

export function ensureHome() {
  const home = getHomeDir();
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(home, 'skills'), { recursive: true });
  return home;
}

export function getConfigPath() {
  return path.join(getHomeDir(), 'openunum.json');
}

export function defaultConfig() {
  const envPort = Number(process.env.OPENUNUM_PORT || 18880);
  return {
    server: { host: '127.0.0.1', port: Number.isFinite(envPort) ? envPort : 18880 },
    browser: { cdpUrl: 'http://127.0.0.1:9222', fallbackEnabled: true },
    runtime: {
      maxToolIterations: 8,
      shellEnabled: true,
      workspaceRoot: process.env.OPENUNUM_WORKSPACE || process.cwd(),
      ownerControlMode: process.env.OPENUNUM_OWNER_MODE || 'safe',
      selfPokeEnabled: true,
      toolCircuitFailureThreshold: 3,
      toolCircuitCooldownMs: 300000,
      contextCompactionEnabled: true,
      contextCompactTriggerPct: 0.7,
      contextCompactTargetPct: 0.4,
      contextHardFailPct: 0.9,
      contextProtectRecentTurns: 8,
      contextFallbackTokens: 16000,
      executorRetryAttempts: 3,
      executorRetryBackoffMs: 700,
      providerRequestTimeoutMs: 120000,
      agentTurnTimeoutMs: 420000,
      autonomyMode: 'standard',
      missionDefaultContinueUntilDone: true,
      missionDefaultHardStepCap: 120,
      missionDefaultMaxRetries: 3,
      missionDefaultIntervalMs: 400,
      autonomyMasterAutoStart: false,
      researchDailyEnabled: false,
      researchScheduleHour: 3
    },
    research: {
      defaultQueries: [
        'advanced autonomous agents reddit machine learning',
        'agent engineering methods x twitter',
        'google agentic workflows latest',
        'self-healing agent architecture github'
      ]
    },
    integrations: {
      googleWorkspace: {
        cliCommand: process.env.GOOGLE_CLOUD_CLI || 'gcloud',
        enabled: true
      }
    },
    model: {
      provider: 'ollama',
      model: 'ollama/minimax-m2.7:cloud',
      providerModels: {
        ollama: 'ollama/minimax-m2.7:cloud',
        openrouter: 'openrouter/openai/gpt-4o-mini',
        nvidia: 'nvidia/qwen/qwen3-coder-480b-a35b-instruct',
        generic: 'generic/gpt-4o-mini'
      },
      contextHints: {
        'ollama/qwen3.5:9b-64k': 64000,
        'ollama/minimax-m2.7:cloud': 32768,
        'openrouter/openai/gpt-4o-mini': 128000,
        'generic/gpt-4o-mini': 128000
      },
      routing: {
        fallbackEnabled: true,
        fallbackProviders: ['ollama', 'nvidia', 'openrouter', 'generic'],
        forcePrimaryProvider: false
      },
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
      openrouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      nvidiaBaseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      genericBaseUrl: process.env.GENERIC_BASE_URL || '',
      openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
      nvidiaApiKey: process.env.NVIDIA_API_KEY || '',
      genericApiKey: process.env.GENERIC_API_KEY || ''
    },
    channels: {
      telegram: { botToken: process.env.TELEGRAM_BOT_TOKEN || '', enabled: false }
    }
  };
}

function withDefaults(config) {
  const d = defaultConfig();
  return {
    ...d,
    ...config,
    server: { ...d.server, ...(config.server || {}) },
    browser: { ...d.browser, ...(config.browser || {}) },
    runtime: { ...d.runtime, ...(config.runtime || {}) },
    research: { ...d.research, ...(config.research || {}) },
    integrations: {
      ...d.integrations,
      ...(config.integrations || {}),
      googleWorkspace: {
        ...d.integrations.googleWorkspace,
        ...(config.integrations?.googleWorkspace || {})
      }
    },
    channels: {
      ...d.channels,
      ...(config.channels || {}),
      telegram: { ...d.channels.telegram, ...(config.channels?.telegram || {}) }
    },
    model: {
      ...d.model,
      ...(config.model || {}),
      providerModels: { ...d.model.providerModels, ...(config.model?.providerModels || {}) },
      routing: { ...d.model.routing, ...(config.model?.routing || {}) }
    }
  };
}

export function loadConfig() {
  ensureHome();
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    const cfg = defaultConfig();
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    return cfg;
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  return withDefaults(JSON.parse(raw));
}

export function saveConfig(config) {
  ensureHome();
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}
