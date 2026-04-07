import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import {
  applySecretsToConfig,
  migrateLegacySecretsFromConfig,
  scrubSecretsFromConfig
} from './secrets/store.mjs';

dotenv.config();

function normalizeProviderId(rawProvider) {
  const provider = String(rawProvider || 'ollama').trim().toLowerCase();
  if (provider === 'generic') return 'openai';
  return provider;
}

function normalizeModelRef(provider, model) {
  const normalizedProvider = normalizeProviderId(provider);
  const raw = String(model || '').trim();
  if (!raw) return raw;
  return raw.replace(/^(ollama|openrouter|nvidia|generic|openai)\//, `${normalizedProvider}/`);
}

function normalizeModelConfig(model = {}) {
  const providerModels = { ...(model.providerModels || {}) };
  if (providerModels.generic && !providerModels.openai) {
    providerModels.openai = normalizeModelRef('openai', providerModels.generic);
  }
  delete providerModels.generic;

  const contextHints = { ...(model.contextHints || {}) };
  if (Object.prototype.hasOwnProperty.call(contextHints, 'generic/gpt-4o-mini') && !Object.prototype.hasOwnProperty.call(contextHints, 'openai/gpt-4o-mini')) {
    contextHints['openai/gpt-4o-mini'] = contextHints['generic/gpt-4o-mini'];
  }
  delete contextHints['generic/gpt-4o-mini'];

  const provider = normalizeProviderId(model.provider || 'ollama');
  const currentModel = normalizeModelRef(provider, model.model || providerModels[provider] || '');
  const fallbackProviders = (model.routing?.fallbackProviders || [])
    .map((item) => normalizeProviderId(item))
    .filter((item, index, arr) => item && arr.indexOf(item) === index);

  return {
    ...model,
    provider,
    model: currentModel,
    providerModels,
    contextHints,
    routing: {
      ...(model.routing || {}),
      fallbackProviders
    },
    openaiBaseUrl: model.openaiBaseUrl || model.genericBaseUrl || 'https://api.openai.com/v1',
    openaiApiKey: model.openaiApiKey || model.genericApiKey || ''
  };
}

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
      toolHooksEnabled: true,
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
      autonomyMode: 'autonomy-first',
      missionDefaultContinueUntilDone: true,
      missionDefaultHardStepCap: 120,
      missionDefaultMaxRetries: 3,
      missionDefaultIntervalMs: 400,
      enforceModelExecutionProfiles: true,
      autonomyPolicy: {
        enabled: true,
        mode: 'execute',
        enforceSelfProtection: true,
        blockShellSelfDestruct: true,
        denyMutatingToolsInPlan: true,
        allowRecoveryToolsInPlan: true
      },
      modelExecutionProfiles: {
        compact: {
          maxHistoryMessages: 220,
          maxToolIterations: 3,
          allowedTools: [
            'file_read',
            'file_write',
            'file_patch',
            'file_restore_last',
            'session_list',
            'session_delete',
            'session_clear',
            'shell_run',
            'http_request',
            'browser_status',
            'browser_extract',
            'browser_snapshot',
            'skill_list',
            'email_status',
            'research_list_recent'
          ],
          odd: {
            maxConfidenceRequired: 0.7,
            allowedTools: ['file_read', 'http_request', 'browser_snapshot', 'skill_list', 'email_status', 'research_list_recent'],
            blockedTools: ['file_write', 'shell_run', 'file_patch', 'desktop_open', 'desktop_xdotool'],
            requireHumanApproval: true
          }
        },
        balanced: {
          maxHistoryMessages: 520,
          maxToolIterations: 5,
          allowedTools: [],
          odd: {
            maxConfidenceRequired: 0.5,
            allowedTools: ['file_read', 'file_write', 'file_patch', 'http_request', 'browser_snapshot', 'browser_extract', 'shell_run'],
            blockedTools: ['desktop_open', 'desktop_xdotool'],
            requireHumanApproval: false
          }
        },
        full: {
          maxHistoryMessages: 1200,
          maxToolIterations: 8,
          allowedTools: [],
          odd: {
            maxConfidenceRequired: 0.3,
            allowedTools: 'all',
            blockedTools: [],
            requireHumanApproval: false
          }
        }
      },
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
        openai: 'openai/gpt-4o-mini'
      },
      contextHints: {
        'ollama/qwen3.5:9b-64k': 64000,
        'ollama/qwen3.5-9b-uncensored-aggressive:latest': 16384,
        'ollama/qwen3.5-9b-uncensored-local:latest': 16384,
        'ollama/minimax-m2.7:cloud': 32768,
        'openrouter/openai/gpt-4o-mini': 128000,
        'openai/gpt-4o-mini': 128000
      },
      routing: {
        fallbackEnabled: true,
        fallbackProviders: ['ollama', 'nvidia', 'openrouter', 'openai'],
        forcePrimaryProvider: false
      },
      behaviorOverrides: {},
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
      openrouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      nvidiaBaseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      openaiBaseUrl: process.env.OPENAI_BASE_URL || process.env.GENERIC_BASE_URL || 'https://api.openai.com/v1',
      genericBaseUrl: process.env.GENERIC_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      openrouterApiKey: '',
      nvidiaApiKey: '',
      openaiApiKey: '',
      genericApiKey: ''
    },
    channels: {
      telegram: { botToken: '', enabled: false }
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
    const cfg = scrubSecretsFromConfig(defaultConfig());
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    return applySecretsToConfig(cfg);
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  let config = withDefaults(JSON.parse(raw));
  const migrated = migrateLegacySecretsFromConfig(config);
  if (migrated.changed) {
    config = withDefaults(migrated.config);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
  config = applySecretsToConfig(config);
  config.model = normalizeModelConfig(config.model);
  if (!config.model.routing.fallbackProviders?.length) {
    config.model.routing.fallbackProviders = ['ollama', 'nvidia', 'openrouter', 'openai'];
  }
  return config;
}

export function saveConfig(config) {
  ensureHome();
  if (config?.model) {
    config.model = normalizeModelConfig(config.model);
    config.model.genericBaseUrl = config.model.openaiBaseUrl;
    config.model.genericApiKey = config.model.openaiApiKey;
  }
  const sanitized = scrubSecretsFromConfig(config);
  fs.writeFileSync(getConfigPath(), JSON.stringify(sanitized, null, 2));
}
