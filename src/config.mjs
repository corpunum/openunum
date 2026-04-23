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

const DEFAULT_FALLBACK_PROVIDER_CHAIN = ['ollama-cloud', 'nvidia', 'openrouter', 'openai'];

function normalizeProviderId(rawProvider) {
  const provider = String(rawProvider || 'ollama-cloud').trim().toLowerCase();
  if (provider === 'generic') return 'openai';
  if (provider === 'ollama') return 'ollama-cloud';
  return provider;
}

function normalizeModelRef(provider, model) {
  const normalizedProvider = normalizeProviderId(provider);
  const raw = String(model || '').trim();
  if (!raw) return raw;
  return raw.replace(/^(ollama-local|ollama-cloud|ollama|openrouter|nvidia|xiaomimimo|generic|openai|llama-cpp-local)\//, `${normalizedProvider}/`);
}

function normalizeOllamaLocalModelRef(modelRef) {
  const raw = String(modelRef || '').trim().replace(/^ollama-local\//, '');
  if (!raw) return 'ollama-local/gemma4:cpu';
  // Allow explicitly configured local models, only default unknown to gemma4
  // This preserves user configuration for models like qwen2.5-coder:1.5b
  return `ollama-local/${raw || 'gemma4:cpu'}`;
}

export function normalizeModelConfig(model = {}) {
  const providerModels = { ...(model.providerModels || {}) };
  if (providerModels.generic && !providerModels.openai) {
    providerModels.openai = normalizeModelRef('openai', providerModels.generic);
  }
  delete providerModels.generic;

  if (providerModels['ollama-local']) {
    providerModels['ollama-local'] = normalizeOllamaLocalModelRef(providerModels['ollama-local']);
  } else {
    providerModels['ollama-local'] = 'ollama-local/gemma4:cpu';
  }

  const contextHints = { ...(model.contextHints || {}) };
  if (Object.prototype.hasOwnProperty.call(contextHints, 'generic/gpt-4o-mini') && !Object.prototype.hasOwnProperty.call(contextHints, 'openai/gpt-4o-mini')) {
    contextHints['openai/gpt-4o-mini'] = contextHints['generic/gpt-4o-mini'];
  }
  delete contextHints['generic/gpt-4o-mini'];

  const provider = normalizeProviderId(model.provider || 'ollama-cloud');
  let currentModel = normalizeModelRef(provider, model.model || providerModels[provider] || '');
  if (provider === 'ollama-local') {
    currentModel = normalizeOllamaLocalModelRef(currentModel);
  }
  if (currentModel) {
    providerModels[provider] = currentModel;
  }

  const disabledProviders = (model.routing?.disabledProviders || [])
    .map((item) => normalizeProviderId(item))
    .filter((item, index, arr) => item && arr.indexOf(item) === index && item !== provider);
  const fallbackEnabled = model.routing?.fallbackEnabled !== false;
  const forcePrimaryProvider = model.routing?.forcePrimaryProvider === true;
  let fallbackProviders = (model.routing?.fallbackProviders || [])
    .map((item) => normalizeProviderId(item))
    .filter((item, index, arr) => item && arr.indexOf(item) === index && item !== provider && !disabledProviders.includes(item));

  if (!fallbackEnabled) {
    fallbackProviders = [];
  } else if (!fallbackProviders.length && !forcePrimaryProvider) {
    fallbackProviders = DEFAULT_FALLBACK_PROVIDER_CHAIN
      .filter((item) => item && item !== provider && !disabledProviders.includes(item));
  }

  return {
    ...model,
    provider,
    model: currentModel,
    providerModels,
    contextHints,
    routing: {
      ...(model.routing || {}),
      fallbackEnabled,
      fallbackProviders,
      forcePrimaryProvider,
      disabledProviders
    },
    openaiBaseUrl: model.openaiBaseUrl || model.genericBaseUrl || 'https://api.openai.com/v1',
    openaiApiKey: model.openaiApiKey || model.genericApiKey || '',
    ollamaCloudBaseUrl: model.ollamaCloudBaseUrl || model.ollamaBaseUrl || 'http://127.0.0.1:11434',
    ollamaLocalBaseUrl: model.ollamaLocalBaseUrl || model.ollamaBaseUrl || 'http://127.0.0.1:11434',
    llamaCppLocalBaseUrl: model.llamaCppLocalBaseUrl || process.env.LLAMA_CPP_LOCAL_BASE_URL || 'http://127.0.0.1:18084',
    imageGenBaseUrl: model.imageGenBaseUrl || process.env.IMAGE_GEN_BASE_URL || 'http://127.0.0.1:18085'
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
      providerRequestTimeoutMs: 240000,
      agentTurnTimeoutMs: 420000,
      chatHardTimeoutMs: 300000,
      maxRequestBodyBytes: 1048576,
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
            'file_search',
            'file_grep',
            'file_info',
            'session_list',
            'http_request',
            'browser_status',
            'browser_extract',
            'browser_snapshot',
            'summarize',
            'classify',
            'extract',
            'parse_function_args',
            'embed_text',
            'skill_list',
            'email_status',
            'research_list_recent'
          ],
          odd: {
            maxConfidenceRequired: 0.7,
            allowedTools: ['file_read', 'file_search', 'file_grep', 'file_info', 'session_list', 'http_request', 'browser_status', 'browser_extract', 'browser_snapshot', 'summarize', 'classify', 'extract', 'parse_function_args', 'embed_text', 'skill_list', 'email_status', 'research_list_recent'],
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
      autonomyMasterAutoStart: true,
      consolidationIntervalMs: 86400000, // 24 hours - time-based consolidation trigger
      consolidationMemoryThreshold: 50, // new memories trigger for hippocampal replay
      researchDailyEnabled: false,
      researchScheduleHour: 3,
      modelBackedTools: {
        enabled: false,
        exposeToController: true,
        localMaxConcurrency: 1,
        queueDepth: 8,
        autoProfileTuningEnabled: true,
        profileSwitchMinSamples: 6,
        latencyWeight: 0.35,
        costWeight: 0.25,
        failurePenalty: 0.8,
        tools: {
          summarize: {
            backendProfiles: [
              { id: 'summarize.local', type: 'model', provider: 'ollama-local', model: 'ollama-local/granite3.3:2b', timeoutMs: 22000 }
            ]
          },
          classify: {
            backendProfiles: [
              { id: 'classify.local', type: 'model', provider: 'ollama-local', model: 'ollama-local/llama3.2:1b', timeoutMs: 18000 }
            ]
          },
          extract: {
            backendProfiles: [
              { id: 'extract.local', type: 'model', provider: 'ollama-local', model: 'ollama-local/granite3.3:2b', timeoutMs: 20000 }
            ]
          },
          parse_function_args: {
            backendProfiles: [
              { id: 'parse_function_args.local', type: 'model', provider: 'ollama-local', model: 'ollama-local/functiongemma:270m', timeoutMs: 15000 }
            ]
          },
          embed_text: {
            backendProfiles: [
              { id: 'embed_text.local', type: 'model', provider: 'ollama-local', model: 'ollama-local/nomic-embed-text:v1.5', timeoutMs: 15000 }
            ]
          }
        },
        recommendedLocalModels: [
          'granite3.3:2b',
          'llama3.2:1b',
          'functiongemma:270m',
          'nomic-embed-text:v1.5',
          'qwen2.5-coder:1.5b'
        ]
      }
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
      provider: 'ollama-cloud',
      model: 'ollama-cloud/qwen3.5:397b-cloud',
      providerModels: {
        'ollama-cloud': 'ollama-cloud/qwen3.5:397b-cloud',
        'ollama-local': 'ollama-local/gemma4:cpu',
        openrouter: 'openrouter/openai/gpt-4o-mini',
        nvidia: 'nvidia/qwen/qwen3-coder-480b-a35b-instruct',
        xiaomimimo: 'xiaomimimo/gpt-4o-mini',
        openai: 'openai/gpt-4o-mini',
        'llama-cpp-local': 'llama-cpp-local/supergemma4-Q5_K_M.gguf'
      },
      contextHints: {
        'ollama-cloud/qwen3.5:397b-cloud': 262144,
        'ollama-local/gemma4:cpu': 32768,
        'ollama-local/nomic-embed-text:latest': 8192,
        'openrouter/openai/gpt-4o-mini': 128000,
        'openai/gpt-4o-mini': 128000,
        'llama-cpp-local/supergemma4-Q5_K_M.gguf': 16384
      },
      routing: {
        fallbackEnabled: true,
        fallbackProviders: ['ollama-cloud', 'nvidia', 'openrouter', 'openai'],
        forcePrimaryProvider: false
      },
      behaviorOverrides: {},
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
      ollamaCloudBaseUrl: process.env.OLLAMA_CLOUD_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
      ollamaLocalBaseUrl: process.env.OLLAMA_LOCAL_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
      openrouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      nvidiaBaseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      xiaomimimoBaseUrl: process.env.XIAOMIMIMO_BASE_URL || 'https://api.x.ai/v1',
      openaiBaseUrl: process.env.OPENAI_BASE_URL || process.env.GENERIC_BASE_URL || 'https://api.openai.com/v1',
      genericBaseUrl: process.env.GENERIC_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      openrouterApiKey: '',
      nvidiaApiKey: '',
      xiaomimimoApiKey: '',
      openaiApiKey: '',
      genericApiKey: '',
      llamaCppLocalBaseUrl: process.env.LLAMA_CPP_LOCAL_BASE_URL || 'http://127.0.0.1:18084',
      imageGenBaseUrl: process.env.IMAGE_GEN_BASE_URL || 'http://127.0.0.1:18085'
    },
    channels: {
      telegram: { botToken: '', enabled: false, streaming: { enabled: true, editIntervalMs: 1500, placeholderText: 'Thinking...', showReasoning: true, showToolCalls: true } }
    },
    fastAwarenessRouter: {
      enabled: true,
      minConfidenceForSkip: 0.85,
      minConfidenceForHotOnly: 0.70,
      weakModelTokenLimit: 4096,
      cacheHitWindowMs: 30000,
      classificationRules: {
        taskMetaKeywords: ['current task', 'what am i doing', 'my task', 'step am i', 'what is my', 'where are we', 'progress', 'status'],
        continuationKeywords: ['continue', 'go on', 'proceed', 'next', 'keep going', 'and then', 'after that'],
        externalKeywords: ['search', 'latest', 'news', 'today', 'now', 'current', 'recent', 'web'],
        deepInspectKeywords: ['find files', 'search files', 'look for file', 'grep', 'locate', 'where is', 'find all']
      }
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
    runtime: {
      ...d.runtime,
      ...(config.runtime || {}),
      modelBackedTools: {
        ...d.runtime.modelBackedTools,
        ...(config.runtime?.modelBackedTools || {}),
        tools: {
          ...d.runtime.modelBackedTools.tools,
          ...(config.runtime?.modelBackedTools?.tools || {})
        }
      }
    },
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
    },
    fastAwarenessRouter: {
      ...d.fastAwarenessRouter,
      ...(config.fastAwarenessRouter || {}),
      classificationRules: {
        ...d.fastAwarenessRouter.classificationRules,
        ...(config.fastAwarenessRouter?.classificationRules || {})
      }
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
