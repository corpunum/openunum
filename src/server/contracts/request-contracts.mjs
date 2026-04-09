function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function inRange(value, min, max) {
  return isFiniteNumber(value) && value >= min && value <= max;
}

function addTypeError(errors, field, expected) {
  errors.push({ field, issue: `expected ${expected}` });
}

function validateUrlField(errors, field, value) {
  if (typeof value !== 'string') {
    addTypeError(errors, field, 'string');
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) return;
  if (!/^https?:\/\//i.test(trimmed)) {
    errors.push({ field, issue: 'expected http(s) URL' });
  }
}

export function ensureObjectPayload(body) {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      errors: [{ field: 'body', issue: 'expected JSON object' }]
    };
  }
  return { ok: true, value: body, errors: [] };
}

export function validateConfigPatch(body, ctx = {}) {
  const root = ensureObjectPayload(body);
  if (!root.ok) return root;
  const errors = [];
  const normalizeProviderId = typeof ctx.normalizeProviderId === 'function'
    ? ctx.normalizeProviderId
    : (value) => String(value || '').trim().toLowerCase();

  const allowedTopLevel = new Set(['runtime', 'model', 'integrations']);
  for (const key of Object.keys(body)) {
    if (!allowedTopLevel.has(key)) errors.push({ field: key, issue: 'unknown top-level key' });
  }

  const runtime = body.runtime;
  if (runtime !== undefined) {
    if (!isPlainObject(runtime)) {
      addTypeError(errors, 'runtime', 'object');
    } else {
      const boolFields = [
        'shellEnabled', 'selfPokeEnabled', 'toolHooksEnabled', 'autonomyMasterAutoStart',
        'researchDailyEnabled', 'contextCompactionEnabled', 'missionDefaultContinueUntilDone',
        'enforceModelExecutionProfiles'
      ];
      for (const field of boolFields) {
        if (runtime[field] !== undefined && typeof runtime[field] !== 'boolean') {
          addTypeError(errors, `runtime.${field}`, 'boolean');
        }
      }
      if (runtime.workspaceRoot !== undefined && typeof runtime.workspaceRoot !== 'string') addTypeError(errors, 'runtime.workspaceRoot', 'string');
      if (runtime.ownerControlMode !== undefined && typeof runtime.ownerControlMode !== 'string') addTypeError(errors, 'runtime.ownerControlMode', 'string');
      if (runtime.autonomyMode !== undefined && typeof runtime.autonomyMode !== 'string') addTypeError(errors, 'runtime.autonomyMode', 'string');

      if (runtime.toolCircuitFailureThreshold !== undefined && !inRange(runtime.toolCircuitFailureThreshold, 1, 100)) addTypeError(errors, 'runtime.toolCircuitFailureThreshold', 'number in [1,100]');
      if (runtime.toolCircuitCooldownMs !== undefined && !inRange(runtime.toolCircuitCooldownMs, 1000, 3600000)) addTypeError(errors, 'runtime.toolCircuitCooldownMs', 'number in [1000,3600000]');
      if (runtime.researchScheduleHour !== undefined && !inRange(runtime.researchScheduleHour, 0, 23)) addTypeError(errors, 'runtime.researchScheduleHour', 'number in [0,23]');
      if (runtime.contextCompactTriggerPct !== undefined && !inRange(runtime.contextCompactTriggerPct, 0.05, 0.99)) addTypeError(errors, 'runtime.contextCompactTriggerPct', 'number in [0.05,0.99]');
      if (runtime.contextCompactTargetPct !== undefined && !inRange(runtime.contextCompactTargetPct, 0.05, 0.95)) addTypeError(errors, 'runtime.contextCompactTargetPct', 'number in [0.05,0.95]');
      if (runtime.contextHardFailPct !== undefined && !inRange(runtime.contextHardFailPct, 0.1, 0.999)) addTypeError(errors, 'runtime.contextHardFailPct', 'number in [0.1,0.999]');
      if (runtime.contextProtectRecentTurns !== undefined && !inRange(runtime.contextProtectRecentTurns, 0, 1000)) addTypeError(errors, 'runtime.contextProtectRecentTurns', 'number in [0,1000]');
      if (runtime.contextFallbackTokens !== undefined && !inRange(runtime.contextFallbackTokens, 256, 2000000)) addTypeError(errors, 'runtime.contextFallbackTokens', 'number in [256,2000000]');
      if (runtime.maxToolIterations !== undefined && !inRange(runtime.maxToolIterations, 1, 100)) addTypeError(errors, 'runtime.maxToolIterations', 'number in [1,100]');
      if (runtime.executorRetryAttempts !== undefined && !inRange(runtime.executorRetryAttempts, 0, 20)) addTypeError(errors, 'runtime.executorRetryAttempts', 'number in [0,20]');
      if (runtime.executorRetryBackoffMs !== undefined && !inRange(runtime.executorRetryBackoffMs, 0, 120000)) addTypeError(errors, 'runtime.executorRetryBackoffMs', 'number in [0,120000]');
      if (runtime.maxRequestBodyBytes !== undefined && !inRange(runtime.maxRequestBodyBytes, 1024, 10485760)) addTypeError(errors, 'runtime.maxRequestBodyBytes', 'number in [1024,10485760]');
      if (runtime.missionDefaultHardStepCap !== undefined && !inRange(runtime.missionDefaultHardStepCap, 1, 10000)) addTypeError(errors, 'runtime.missionDefaultHardStepCap', 'number in [1,10000]');
      if (runtime.missionDefaultMaxRetries !== undefined && !inRange(runtime.missionDefaultMaxRetries, 0, 50)) addTypeError(errors, 'runtime.missionDefaultMaxRetries', 'number in [0,50]');
      if (runtime.missionDefaultIntervalMs !== undefined && !inRange(runtime.missionDefaultIntervalMs, 10, 60000)) addTypeError(errors, 'runtime.missionDefaultIntervalMs', 'number in [10,60000]');

      if (runtime.autonomyPolicy !== undefined) {
        if (!isPlainObject(runtime.autonomyPolicy)) {
          addTypeError(errors, 'runtime.autonomyPolicy', 'object');
        } else {
          const ap = runtime.autonomyPolicy;
          for (const key of ['enabled', 'enforceSelfProtection', 'blockShellSelfDestruct', 'denyMutatingToolsInPlan', 'allowRecoveryToolsInPlan']) {
            if (ap[key] !== undefined && typeof ap[key] !== 'boolean') addTypeError(errors, `runtime.autonomyPolicy.${key}`, 'boolean');
          }
          if (ap.mode !== undefined && !['plan', 'execute'].includes(String(ap.mode).trim().toLowerCase())) {
            errors.push({ field: 'runtime.autonomyPolicy.mode', issue: 'expected "plan" or "execute"' });
          }
        }
      }

      if (runtime.modelExecutionProfiles !== undefined) {
        if (!isPlainObject(runtime.modelExecutionProfiles)) {
          addTypeError(errors, 'runtime.modelExecutionProfiles', 'object');
        } else {
          for (const [tier, profile] of Object.entries(runtime.modelExecutionProfiles)) {
            if (!['compact', 'balanced', 'full'].includes(tier)) {
              errors.push({ field: `runtime.modelExecutionProfiles.${tier}`, issue: 'unknown tier key' });
              continue;
            }
            if (!isPlainObject(profile)) {
              addTypeError(errors, `runtime.modelExecutionProfiles.${tier}`, 'object');
              continue;
            }
            if (profile.maxHistoryMessages !== undefined && !inRange(profile.maxHistoryMessages, 1, 20000)) addTypeError(errors, `runtime.modelExecutionProfiles.${tier}.maxHistoryMessages`, 'number in [1,20000]');
            if (profile.maxToolIterations !== undefined && !inRange(profile.maxToolIterations, 1, 100)) addTypeError(errors, `runtime.modelExecutionProfiles.${tier}.maxToolIterations`, 'number in [1,100]');
            if (profile.allowedTools !== undefined && (!Array.isArray(profile.allowedTools) || !profile.allowedTools.every((x) => typeof x === 'string'))) {
              addTypeError(errors, `runtime.modelExecutionProfiles.${tier}.allowedTools`, 'string[]');
            }
          }
        }
      }

      if (runtime.modelBackedTools !== undefined) {
        if (!isPlainObject(runtime.modelBackedTools)) {
          addTypeError(errors, 'runtime.modelBackedTools', 'object');
        } else {
          const mbt = runtime.modelBackedTools;
          for (const key of ['enabled', 'exposeToController']) {
            if (mbt[key] !== undefined && typeof mbt[key] !== 'boolean') {
              addTypeError(errors, `runtime.modelBackedTools.${key}`, 'boolean');
            }
          }
          if (mbt.localMaxConcurrency !== undefined && !inRange(mbt.localMaxConcurrency, 1, 8)) {
            addTypeError(errors, 'runtime.modelBackedTools.localMaxConcurrency', 'number in [1,8]');
          }
          if (mbt.queueDepth !== undefined && !inRange(mbt.queueDepth, 1, 128)) {
            addTypeError(errors, 'runtime.modelBackedTools.queueDepth', 'number in [1,128]');
          }
          if (mbt.tools !== undefined) {
            if (!isPlainObject(mbt.tools)) {
              addTypeError(errors, 'runtime.modelBackedTools.tools', 'object');
            } else {
              for (const [toolName, toolCfg] of Object.entries(mbt.tools)) {
                if (!isPlainObject(toolCfg)) {
                  addTypeError(errors, `runtime.modelBackedTools.tools.${toolName}`, 'object');
                  continue;
                }
                if (toolCfg.backendProfiles !== undefined) {
                  if (!Array.isArray(toolCfg.backendProfiles)) {
                    addTypeError(errors, `runtime.modelBackedTools.tools.${toolName}.backendProfiles`, 'array');
                    continue;
                  }
                  for (const [idx, profile] of toolCfg.backendProfiles.entries()) {
                    if (!isPlainObject(profile)) {
                      addTypeError(errors, `runtime.modelBackedTools.tools.${toolName}.backendProfiles.${idx}`, 'object');
                      continue;
                    }
                    for (const field of ['id', 'type', 'provider', 'model']) {
                      if (profile[field] !== undefined && typeof profile[field] !== 'string') {
                        addTypeError(errors, `runtime.modelBackedTools.tools.${toolName}.backendProfiles.${idx}.${field}`, 'string');
                      }
                    }
                    if (profile.timeoutMs !== undefined && !inRange(profile.timeoutMs, 1000, 180000)) {
                      addTypeError(errors, `runtime.modelBackedTools.tools.${toolName}.backendProfiles.${idx}.timeoutMs`, 'number in [1000,180000]');
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  const model = body.model;
  if (model !== undefined) {
    if (!isPlainObject(model)) {
      addTypeError(errors, 'model', 'object');
    } else {
      if (model.provider !== undefined && typeof model.provider !== 'string') addTypeError(errors, 'model.provider', 'string');
      if (model.model !== undefined && typeof model.model !== 'string') addTypeError(errors, 'model.model', 'string');
      if (model.provider !== undefined) {
        const normalized = normalizeProviderId(model.provider);
        const allowedProviders = new Set(['ollama-local', 'ollama-cloud', 'nvidia', 'openrouter', 'xiaomimimo', 'openai']);
        if (!allowedProviders.has(normalized)) errors.push({ field: 'model.provider', issue: 'unknown provider' });
      }
      if (model.providerModels !== undefined) {
        if (!isPlainObject(model.providerModels)) {
          addTypeError(errors, 'model.providerModels', 'object');
        } else {
          for (const [provider, value] of Object.entries(model.providerModels)) {
            if (typeof value !== 'string') addTypeError(errors, `model.providerModels.${provider}`, 'string');
          }
        }
      }
      if (model.routing !== undefined) {
        if (!isPlainObject(model.routing)) {
          addTypeError(errors, 'model.routing', 'object');
        } else {
          if (model.routing.fallbackEnabled !== undefined && typeof model.routing.fallbackEnabled !== 'boolean') addTypeError(errors, 'model.routing.fallbackEnabled', 'boolean');
          if (model.routing.forcePrimaryProvider !== undefined && typeof model.routing.forcePrimaryProvider !== 'boolean') addTypeError(errors, 'model.routing.forcePrimaryProvider', 'boolean');
          if (model.routing.fallbackProviders !== undefined) {
            if (!Array.isArray(model.routing.fallbackProviders) || !model.routing.fallbackProviders.every((item) => typeof item === 'string')) {
              addTypeError(errors, 'model.routing.fallbackProviders', 'string[]');
            }
          }
        }
      }
    }
  }

  const integrations = body.integrations;
  if (integrations !== undefined) {
    if (!isPlainObject(integrations)) {
      addTypeError(errors, 'integrations', 'object');
    } else if (integrations.googleWorkspace !== undefined) {
      if (!isPlainObject(integrations.googleWorkspace)) {
        addTypeError(errors, 'integrations.googleWorkspace', 'object');
      } else if (integrations.googleWorkspace.cliCommand !== undefined && typeof integrations.googleWorkspace.cliCommand !== 'string') {
        addTypeError(errors, 'integrations.googleWorkspace.cliCommand', 'string');
      }
    }
  }

  return { ok: errors.length === 0, value: body, errors };
}

export function validateProvidersConfigPatch(body) {
  const root = ensureObjectPayload(body);
  if (!root.ok) return root;
  const errors = [];
  const allowed = new Set([
    'ollamaBaseUrl', 'openrouterBaseUrl', 'nvidiaBaseUrl', 'xiaomimimoBaseUrl', 'openaiBaseUrl', 'genericBaseUrl',
    'openrouterApiKey', 'nvidiaApiKey', 'xiaomimimoApiKey', 'openaiApiKey', 'genericApiKey'
  ]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) errors.push({ field: key, issue: 'unknown key' });
  }
  for (const key of ['ollamaBaseUrl', 'openrouterBaseUrl', 'nvidiaBaseUrl', 'xiaomimimoBaseUrl', 'openaiBaseUrl', 'genericBaseUrl']) {
    if (body[key] !== undefined) validateUrlField(errors, key, body[key]);
  }
  for (const key of ['openrouterApiKey', 'nvidiaApiKey', 'xiaomimimoApiKey', 'openaiApiKey', 'genericApiKey']) {
    if (body[key] !== undefined && typeof body[key] !== 'string') addTypeError(errors, key, 'string');
  }
  return { ok: errors.length === 0, value: body, errors };
}

export function validateChatRequest(body) {
  const root = ensureObjectPayload(body);
  if (!root.ok) return root;
  const errors = [];
  if (!String(body.sessionId || '').trim()) errors.push({ field: 'sessionId', issue: 'required non-empty string' });
  if (!String(body.message || '').trim()) errors.push({ field: 'message', issue: 'required non-empty string' });
  return { ok: errors.length === 0, value: body, errors };
}

export function validateMissionStartRequest(body) {
  const root = ensureObjectPayload(body);
  if (!root.ok) return root;
  const errors = [];
  if (!String(body.goal || '').trim()) errors.push({ field: 'goal', issue: 'required non-empty string' });
  for (const [key, min, max] of [
    ['maxSteps', 1, 10000],
    ['intervalMs', 10, 60000],
    ['maxRetries', 0, 50],
    ['hardStepCap', 1, 10000]
  ]) {
    if (body[key] !== undefined && !inRange(body[key], min, max)) {
      addTypeError(errors, key, `number in [${min},${max}]`);
    }
  }
  if (body.continueUntilDone !== undefined && typeof body.continueUntilDone !== 'boolean') {
    addTypeError(errors, 'continueUntilDone', 'boolean');
  }
  return { ok: errors.length === 0, value: body, errors };
}

export function validateMissionStopRequest(body) {
  const root = ensureObjectPayload(body);
  if (!root.ok) return root;
  const errors = [];
  if (!String(body.id || '').trim()) errors.push({ field: 'id', issue: 'required non-empty string' });
  return { ok: errors.length === 0, value: body, errors };
}

export function validateMissionScheduleRequest(body) {
  const root = ensureObjectPayload(body);
  if (!root.ok) return root;
  const errors = [];
  if (!String(body.goal || '').trim()) errors.push({ field: 'goal', issue: 'required non-empty string' });
  for (const [key, min, max] of [
    ['delayMs', 0, 31536000000],
    ['intervalMs', 10, 31536000000],
    ['maxSteps', 1, 10000],
    ['maxRetries', 0, 50],
    ['hardStepCap', 1, 10000],
    ['missionIntervalMs', 10, 60000]
  ]) {
    if (body[key] !== undefined && !inRange(body[key], min, max)) {
      addTypeError(errors, key, `number in [${min},${max}]`);
    }
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') addTypeError(errors, 'enabled', 'boolean');
  if (body.continueUntilDone !== undefined && typeof body.continueUntilDone !== 'boolean') addTypeError(errors, 'continueUntilDone', 'boolean');
  if (body.runAt !== undefined && typeof body.runAt !== 'string') addTypeError(errors, 'runAt', 'string');
  return { ok: errors.length === 0, value: body, errors };
}

export function validateMissionScheduleUpdateRequest(body) {
  const root = ensureObjectPayload(body);
  if (!root.ok) return root;
  const errors = [];
  if (!String(body.id || '').trim()) errors.push({ field: 'id', issue: 'required non-empty string' });
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') addTypeError(errors, 'enabled', 'boolean');
  if (body.status !== undefined && typeof body.status !== 'string') addTypeError(errors, 'status', 'string');
  if (body.runAt !== undefined && typeof body.runAt !== 'string') addTypeError(errors, 'runAt', 'string');
  if (body.nextRunAt !== undefined && typeof body.nextRunAt !== 'string') addTypeError(errors, 'nextRunAt', 'string');
  if (body.intervalMs !== undefined && !inRange(body.intervalMs, 10, 31536000000)) addTypeError(errors, 'intervalMs', 'number in [10,31536000000]');
  return { ok: errors.length === 0, value: body, errors };
}

export function validateAuthCatalogRequest(body) {
  const root = ensureObjectPayload(body);
  if (!root.ok) return root;
  const errors = [];
  const allowedTop = new Set(['providerBaseUrls', 'secrets', 'oauthConfig', 'clear']);
  for (const key of Object.keys(body)) {
    if (!allowedTop.has(key)) errors.push({ field: key, issue: 'unknown top-level key' });
  }

  if (body.providerBaseUrls !== undefined) {
    if (!isPlainObject(body.providerBaseUrls)) {
      addTypeError(errors, 'providerBaseUrls', 'object');
    } else {
      for (const key of ['ollamaBaseUrl', 'openrouterBaseUrl', 'nvidiaBaseUrl', 'xiaomimimoBaseUrl', 'openaiBaseUrl']) {
        if (body.providerBaseUrls[key] !== undefined) validateUrlField(errors, `providerBaseUrls.${key}`, body.providerBaseUrls[key]);
      }
    }
  }

  if (body.secrets !== undefined && !isPlainObject(body.secrets)) {
    addTypeError(errors, 'secrets', 'object');
  }
  if (body.oauthConfig !== undefined && !isPlainObject(body.oauthConfig)) {
    addTypeError(errors, 'oauthConfig', 'object');
  }
  if (body.clear !== undefined) {
    if (!Array.isArray(body.clear) || !body.clear.every((item) => typeof item === 'string')) {
      addTypeError(errors, 'clear', 'string[]');
    }
  }

  return { ok: errors.length === 0, value: body, errors };
}
