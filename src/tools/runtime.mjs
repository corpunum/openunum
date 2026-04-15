import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { CDPBrowser } from '../browser/cdp.mjs';
import { buildProvider } from '../providers/index.mjs';
import { ExecutorDaemon } from './executor-daemon.mjs';
import { SkillManager } from '../skills/manager.mjs';
import { SkillFactory } from '../skills/factory.mjs';
import { GoogleWorkspaceClient } from './google-workspace.mjs';
import { ResearchManager } from '../research/manager.mjs';
import { ExecutionPolicyEngine } from '../core/execution-policy-engine.mjs';
import { getHomeDir } from '../config.mjs';
import { validateToolCall } from '../core/preflight-validator.mjs';
import { summarizeToolResult } from '../core/tool-result-summarizer.mjs';
import { file_search, file_grep, file_info, toolDefinitions as fileSearchTools } from './file-search.mjs';
import { web_search, web_fetch, toolDefinitions as webSearchTools } from './web-search.mjs';
import { assessSearchEvidenceQuality, buildSearchBackendChain } from './search-policy.mjs';
import { buildCoreToolSchemas } from './tool-contracts.mjs';
import { createModelBackedToolRegistry } from './backends/registry.mjs';
import { logEvent } from '../core/audit-log.mjs';

import {
  TOOL_CAPABILITY_META,
  applySimplePatch,
  extractOperationalFacts,
  firstMeaningfulLine,
  hasBlockedShellPattern,
  hasUnsafeShellMetacharacters,
  isLikelyInteractiveShellCommand,
  isPlainObject,
  parseOllamaListModelName,
  parseOllamaRunIntent,
  requiresUnlockedMode,
  resolveWorkspaceRoot,
  safePath,
  tryParseCurlAsHttpRequest
} from './runtime-helpers.mjs';

function safeParseJsonObject(text = '') {
  const source = String(text || '').trim();
  if (!source) return null;
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(source.slice(start, end + 1));
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export class ToolRuntime {
  constructor(config, memoryStore = null, chatRuntime = null) {
    this.config = config;
    this.memoryStore = memoryStore;
    this.chatRuntime = chatRuntime;
    this.workspaceRoot = resolveWorkspaceRoot(config);
    this.skillManager = new SkillManager();
    this.skillFactory = new SkillFactory(config, chatRuntime);
    this.googleWorkspace = new GoogleWorkspaceClient(config);
    this.researchManager = new ResearchManager({ config });
    this.toolCircuit = new Map();
    this.toolCircuitFailureThreshold = Number(config.runtime?.toolCircuitFailureThreshold || 3);
    this.toolCircuitCooldownMs = Number(config.runtime?.toolCircuitCooldownMs || 300000);
    this.browser = new CDPBrowser(config.browser?.cdpUrl || 'http://127.0.0.1:9222');
    this.executor = new ExecutorDaemon({
      retryAttempts: config.runtime?.executorRetryAttempts ?? 3,
      retryBackoffMs: config.runtime?.executorRetryBackoffMs ?? 700
    });
    this.policyEngine = new ExecutionPolicyEngine(config.runtime || {});
    this.modelBackedRegistry = createModelBackedToolRegistry(config);
    this.backupRoot = path.join(os.homedir(), '.openunum', 'backups');
    this.hooksRoot = path.join(getHomeDir(), 'hooks');
    this.backupIndex = [];
    fs.mkdirSync(this.backupRoot, { recursive: true });
    fs.mkdirSync(this.hooksRoot, { recursive: true });
  }

  toolSchemas(options = {}) {
    const schemas = [
      ...buildCoreToolSchemas(),
      ...Object.entries(fileSearchTools).map(([name, def]) => ({
        type: 'function',
        function: { name, description: def.description, parameters: def.parameters }
      })),
      ...Object.entries(webSearchTools).map(([name, def]) => ({
        type: 'function',
        function: { name, description: def.description, parameters: def.parameters }
      })),
      ...(this.modelBackedRegistry?.schemas?.() || [])
    ];
    const allowedTools = Array.isArray(options?.allowedTools) ? options.allowedTools : null;
    if (!allowedTools || !allowedTools.length) return schemas;
    const allow = new Set(allowedTools.map((name) => String(name || '').trim()).filter(Boolean));
    return schemas.filter((schema) => allow.has(String(schema?.function?.name || '')));
  }

  toolCatalog(options = {}) {
    const schemas = this.toolSchemas(options);
    return schemas.map((schema) => {
      const name = String(schema?.function?.name || '');
      const meta = TOOL_CAPABILITY_META[name] || {};
      const inferredReadOnly = this.modelBackedRegistry?.has?.(name) ? { class: 'read', mutatesState: false, destructive: false } : {};
      return {
        name,
        description: String(schema?.function?.description || ''),
        parameters: schema?.function?.parameters || { type: 'object' },
        class: meta.class || inferredReadOnly.class || 'execute',
        mutatesState: Boolean(meta.mutatesState ?? inferredReadOnly.mutatesState),
        destructive: Boolean(meta.destructive ?? inferredReadOnly.destructive),
        proofHint: String(meta.proofHint || 'tool result payload')
      };
    });
  }

  isToolAllowed(toolName, context = {}) {
    const list = Array.isArray(context?.allowedTools) ? context.allowedTools : null;
    if (!list || !list.length) return true;
    const allow = new Set(list.map((name) => String(name || '').trim()).filter(Boolean));
    return allow.has(String(toolName || '').trim());
  }

  evaluatePolicy(toolName, args, context = {}) {
    return this.policyEngine.evaluate({ toolName, args, context });
  }

  createFileBackup(targetPath, originalContent = '') {
    const entry = {
      id: crypto.randomUUID(),
      path: String(targetPath || ''),
      content: String(originalContent || ''),
      createdAt: new Date().toISOString()
    };
    const filePath = path.join(this.backupRoot, `${entry.createdAt.replace(/[:.]/g, '-')}-${entry.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entry), 'utf8');
    this.backupIndex.push({ ...entry, filePath });
    if (this.backupIndex.length > 200) this.backupIndex = this.backupIndex.slice(-200);
    return { ...entry, filePath };
  }

  restoreLastBackup(targetPath = '') {
    const target = String(targetPath || '').trim();
    const candidate = [...this.backupIndex].reverse().find((item) => {
      if (!item?.path) return false;
      if (!target) return true;
      return item.path === target;
    });
    if (!candidate) {
      return { ok: false, error: 'backup_not_found', stderr: 'No matching backup was found.' };
    }
    fs.mkdirSync(path.dirname(candidate.path), { recursive: true });
    fs.writeFileSync(candidate.path, candidate.content || '', 'utf8');
    return {
      ok: true,
      path: candidate.path,
      backupId: candidate.id,
      restoredAt: new Date().toISOString()
    };
  }

  logRun(context, toolName, args, result) {
    const sessionId = context?.sessionId;
    
    // R1: Tamper-Evident Audit Logging
    try {
      logEvent('tool_call', {
        tool: toolName,
        args: args || {},
        ok: result?.ok !== false,
        error: result?.error || null
      }, sessionId);
    } catch (e) {
      // Don't crash tool execution if audit logging fails, but log it
      console.error('[audit_log_failed]', e);
    }

    if (!sessionId || !this.memoryStore?.recordToolRun) return;
    this.memoryStore.recordToolRun({
      sessionId,
      toolName,
      args,
      result
    });
    if (this.memoryStore?.rememberFact) {
      const facts = [
        ...extractOperationalFacts(toolName, args, result),
        ...(Array.isArray(result?.hookFacts) ? result.hookFacts : [])
      ];
      for (const fact of facts) {
        const key = String(fact?.key || '').trim();
        const value = String(fact?.value || '').trim();
        if (!key || !value) continue;
        this.memoryStore.rememberFact(key, value);
      }
    }
    if (this.memoryStore?.addMemoryArtifact && Array.isArray(result?.hookEvents) && result.hookEvents.length > 0) {
      this.memoryStore.addMemoryArtifact({
        sessionId,
        artifactType: 'tool_hook',
        content: JSON.stringify(result.hookEvents),
        sourceRef: toolName
      });
    }
  }

  listHookFiles(stage) {
    if (this.config.runtime?.toolHooksEnabled === false) return [];
    const prefix = `${stage}`;
    const entries = fs.existsSync(this.hooksRoot) ? fs.readdirSync(this.hooksRoot) : [];
    return entries
      .filter((name) => name === `${prefix}.mjs` || (name.startsWith(`${prefix}.`) && name.endsWith('.mjs')))
      .sort()
      .map((name) => ({ name, filePath: path.join(this.hooksRoot, name) }));
  }

  async runHookStage(stage, payload) {
    const files = this.listHookFiles(stage);
    const outcomes = [];
    for (const hook of files) {
      try {
        const mod = await import(`${pathToFileURL(hook.filePath).href}?t=${Date.now()}`);
        const handler = typeof mod.handle === 'function' ? mod.handle : (typeof mod.default === 'function' ? mod.default : null);
        if (!handler) continue;
        const out = await handler(payload);
        if (out == null) continue;
        outcomes.push({ hook: hook.name, output: out });
      } catch (error) {
        outcomes.push({
          hook: hook.name,
          output: {
            allow: false,
            reason: 'hook_execution_failed',
            stderr: String(error.message || error)
          }
        });
      }
    }
    return outcomes;
  }

  getCircuitState(toolName) {
    if (!this.toolCircuit.has(toolName)) {
      this.toolCircuit.set(toolName, {
        failures: 0,
        openedAt: null,
        openUntil: null,
        state: 'closed'
      });
    }
    return this.toolCircuit.get(toolName);
  }

  canExecuteTool(toolName) {
    const state = this.getCircuitState(toolName);
    if (state.state !== 'open') return { ok: true };
    if (state.openUntil && Date.now() >= state.openUntil) {
      state.state = 'half-open';
      return { ok: true };
    }
    return {
      ok: false,
      error: 'tool_circuit_open',
      details: {
        toolName,
        openUntil: state.openUntil ? new Date(state.openUntil).toISOString() : null
      }
    };
  }

  recordToolResult(toolName, success) {
    const state = this.getCircuitState(toolName);
    if (success) {
      state.failures = 0;
      state.state = 'closed';
      state.openUntil = null;
      state.openedAt = null;
      return;
    }
    state.failures += 1;
    if (state.failures >= this.toolCircuitFailureThreshold) {
      state.state = 'open';
      state.openedAt = Date.now();
      state.openUntil = Date.now() + this.toolCircuitCooldownMs;
    }
  }

  async run(name, args, context = {}) {
    let currentArgs = isPlainObject(args) ? { ...args } : {};
    const hookEvents = [];
    const hookFacts = [];
    const hookArtifacts = [];

    const policy = this.evaluatePolicy(name, currentArgs, context);
    if (!policy.allow) {
      const out = {
        ok: false,
        error: 'policy_denied',
        policyReason: policy.reason,
        stderr: policy.details || `Tool ${name} denied by execution policy.`,
        hookEvents
      };
      this.logRun(context, name, currentArgs, out);
      return out;
    }
    if (!this.isToolAllowed(name, context)) {
      const out = {
        ok: false,
        error: 'model_profile_tool_restricted',
        stderr: `Tool ${name} is restricted by the active model execution profile.`,
        hookEvents
      };
      this.logRun(context, name, currentArgs, out);
      return out;
    }

    // Preflight validation — check tool-specific argument constraints
    const validation = validateToolCall(name, currentArgs);
    if (!validation.valid) {
      const out = {
        ok: false,
        error: 'preflight_validation_failed',
        stderr: validation.hint || `Tool ${name} failed preflight validation.`,
        hookEvents
      };
      this.logRun(context, name, currentArgs, out);
      return out;
    }

    const preHooks = await this.runHookStage('pre-tool', {
      stage: 'pre-tool',
      toolName: name,
      args: currentArgs,
      context
    });
    for (const item of preHooks) {
      const out = item.output || {};
      const event = {
        stage: 'pre-tool',
        hook: item.hook,
        decision: out.stop ? 'synthetic_result' : out.allow === false ? 'blocked' : isPlainObject(out.args) ? 'mutated_args' : 'observed',
        note: firstMeaningfulLine(out.note || out.reason || out.stderr || '')
      };
      hookEvents.push(event);
      if (Array.isArray(out.rememberFacts)) hookFacts.push(...out.rememberFacts);
      if (Array.isArray(out.artifacts)) hookArtifacts.push(...out.artifacts);
      if (isPlainObject(out.args)) currentArgs = { ...currentArgs, ...out.args };
      if (out.allow === false) {
        const blocked = {
          ok: false,
          error: 'hook_blocked',
          stderr: out.stderr || out.reason || `Hook ${item.hook} blocked ${name}.`,
          hookEvents,
          hookFacts,
          hookArtifacts
        };
        this.logRun(context, name, currentArgs, blocked);
        return blocked;
      }
      if (out.stop === true && isPlainObject(out.result)) {
        const synthetic = {
          ...out.result,
          ok: out.result.ok !== false,
          hookEvents,
          hookFacts,
          hookArtifacts
        };
        this.recordToolResult(name, Boolean(synthetic?.ok));
        this.logRun(context, name, currentArgs, synthetic);
        return synthetic;
      }
    }

    const postMutationPolicy = this.evaluatePolicy(name, currentArgs, context);
    if (!postMutationPolicy.allow) {
      const out = {
        ok: false,
        error: 'policy_denied',
        policyReason: postMutationPolicy.reason,
        stderr: postMutationPolicy.details || `Tool ${name} denied by execution policy after hook mutation.`,
        hookEvents,
        hookFacts,
        hookArtifacts
      };
      this.logRun(context, name, currentArgs, out);
      return out;
    }
    if (!this.isToolAllowed(name, context)) {
      const out = {
        ok: false,
        error: 'model_profile_tool_restricted',
        stderr: `Tool ${name} is restricted by the active model execution profile.`,
        hookEvents,
        hookFacts,
        hookArtifacts
      };
      this.logRun(context, name, currentArgs, out);
      return out;
    }

    const circuit = this.canExecuteTool(name);
    if (!circuit.ok) {
      const out = { ok: false, error: circuit.error, ...circuit.details, hookEvents, hookFacts, hookArtifacts };
      this.logRun(context, name, currentArgs, out);
      return out;
    }

    let result;
    try {
      result = await this.executeTool(name, currentArgs, context);
    } catch (error) {
      result = { ok: false, error: String(error.message || error) };
    }

    const postHooks = await this.runHookStage('post-tool', {
      stage: 'post-tool',
      toolName: name,
      args: currentArgs,
      result,
      context
    });
    for (const item of postHooks) {
      const out = item.output || {};
      hookEvents.push({
        stage: 'post-tool',
        hook: item.hook,
        decision: isPlainObject(out.result) ? 'mutated_result' : 'observed',
        note: firstMeaningfulLine(out.note || out.reason || out.stderr || '')
      });
      if (Array.isArray(out.rememberFacts)) hookFacts.push(...out.rememberFacts);
      if (Array.isArray(out.artifacts)) hookArtifacts.push(...out.artifacts);
      if (isPlainObject(out.result)) result = { ...result, ...out.result };
    }

    result = {
      ...result,
      hookEvents,
      hookFacts,
      hookArtifacts
    };

    this.recordToolResult(name, Boolean(result?.ok));
    this.logRun(context, name, currentArgs, result);

    // Summarize large tool results to save context budget
    const summarized = summarizeToolResult(name, result);
    return summarized;
  }

  async executeTool(name, args, context = {}) {
    const deadlineAt = Number.isFinite(context?.deadlineAt) ? Number(context.deadlineAt) : null;
    const remainingBudgetMs = () => {
      if (deadlineAt == null) return null;
      return deadlineAt - Date.now();
    };
    const ensureBudget = () => {
      const ms = remainingBudgetMs();
      if (ms != null && ms <= 0) {
        return { ok: false, code: 1, error: 'turn_deadline_exceeded', stderr: 'Tool execution skipped because the turn budget was exhausted.', stdout: '' };
      }
      return null;
    };
    const shellTimeout = (defaultMs) => {
      const ms = remainingBudgetMs();
      if (ms == null) return defaultMs;
      return Math.max(1000, Math.min(defaultMs, ms));
    };
    const retryOptions = deadlineAt == null ? {} : { deadlineAt };
    if (this.modelBackedRegistry?.has?.(name)) {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return this.modelBackedRegistry.execute(name, args);
    }

    if (name === 'file_read') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      const p = safePath(args.path, this.workspaceRoot);
      const content = fs.readFileSync(p, 'utf8');
      return { ok: true, path: p, content };
    }
    if (name === 'file_write') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      const p = safePath(args.path, this.workspaceRoot);
      if (fs.existsSync(p)) {
        const original = fs.readFileSync(p, 'utf8');
        this.createFileBackup(p, original);
      }
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, args.content, 'utf8');
      return { ok: true, path: p, bytes: Buffer.byteLength(args.content, 'utf8') };
    }
    if (name === 'file_patch') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      const p = safePath(args.path, this.workspaceRoot);
      const original = fs.readFileSync(p, 'utf8');
      this.createFileBackup(p, original);
      const patched = applySimplePatch(original, args.find, args.replace);
      fs.writeFileSync(p, patched, 'utf8');
      return { ok: true, path: p };
    }
    if (name === 'file_restore_last') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      const target = args?.path ? safePath(args.path, this.workspaceRoot) : '';
      return this.restoreLastBackup(target);
    }
    
    // Phase 2: Deep-inspect strategy tools
    if (name === 'file_search') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return file_search({
        pattern: args.pattern,
        root: args.root || this.workspaceRoot,
        recursive: args.recursive !== false
      });
    }
    if (name === 'file_grep') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return file_grep({
        search: args.search,
        pattern: args.pattern,
        root: args.root || this.workspaceRoot,
        caseSensitive: Boolean(args.caseSensitive),
        contextLines: Number(args.contextLines ?? 2)
      });
    }
    if (name === 'file_info') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return file_info({ path: args.path });
    }
    
    // Phase 2: External search strategy tools
    if (name === 'web_search') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      const requestedBackend = String(args.backend || 'auto').toLowerCase();
      const query = String(args.query || '');
      const limit = Number(args.limit ?? 10);
      const region = args.region || 'us-en';
      let browserStatus = null;
      if (requestedBackend === 'cdp' || requestedBackend === 'auto') {
        browserStatus = await this.browser.status().catch(() => null);
      }

      const chain = buildSearchBackendChain({
        requestedBackend,
        browserAvailable: Boolean(browserStatus?.ok)
      });
      const attempts = [];

      for (const backend of chain) {
        if (backend === 'model-native') {
          const candidate = await this.executeModelNativeSearch({ query, limit, region }).catch((error) => {
            attempts.push({ backend, ok: false, error: String(error?.message || error) });
            return null;
          });
          if (!candidate) continue;
          const quality = assessSearchEvidenceQuality(candidate, { backend, query });
          attempts.push({ backend, quality });
          if (quality.ok) {
            if (attempts.length > 1) {
              candidate.searchAttempts = attempts;
            }
            return candidate;
          }
          continue;
        }

        if (backend === 'cdp') {
          if (!browserStatus?.ok) {
            attempts.push({ backend, ok: false, error: 'cdp_unavailable' });
            continue;
          }
          try {
            const extracted = await this.browser.search(query);
            const snapshot = await this.browser.snapshot().catch(() => ({ active: null }));
            const snippet = String(extracted?.text || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
            const candidate = {
              ok: true,
              results: [{
                title: snapshot?.active?.title || `Browser search: ${query.slice(0, 80)}`,
                url: snapshot?.active?.url || '',
                snippet
              }],
              query,
              backend: 'cdp',
              total: snippet ? 1 : 0,
              source: 'browser_cdp'
            };
            const quality = assessSearchEvidenceQuality(candidate, { backend: 'cdp', query });
            attempts.push({ backend: 'cdp', quality });
            if (quality.ok || requestedBackend === 'cdp') {
              if (!quality.ok) {
                return { ok: false, error: 'cdp_low_quality', hint: quality.reason };
              }
              return candidate;
            }
          } catch (error) {
            attempts.push({ backend: 'cdp', ok: false, error: String(error?.message || error) });
            if (requestedBackend === 'cdp') {
              return {
                ok: false,
                error: 'cdp_search_failed',
                hint: String(error?.message || error)
              };
            }
          }
          continue;
        }

        const candidate = await web_search({ query, backend, limit, region }).catch((error) => {
          attempts.push({ backend, ok: false, error: String(error?.message || error) });
          return null;
        });
        if (!candidate) continue;
        const quality = assessSearchEvidenceQuality(candidate, { backend, query });
        attempts.push({ backend, quality });
        if (quality.ok) {
          if (attempts.length > 1) {
            candidate.searchAttempts = attempts;
          }
          return candidate;
        }
      }

      return {
        ok: false,
        error: 'search_no_quality_results',
        hint: 'All configured search backends returned low-signal or blocked results.',
        attempts
      };
    }
    if (name === 'web_fetch') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return web_fetch({
        url: args.url,
        extractMode: args.extractMode || 'markdown',
        maxChars: Number(args.maxChars ?? 10000)
      });
    }
    
    if (name === 'session_list') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      if (!this.memoryStore?.listSessions) {
        return { ok: false, error: 'memory_store_unavailable' };
      }
      const limit = Math.max(1, Math.min(200, Number(args?.limit || 80)));
      return { ok: true, sessions: this.memoryStore.listSessions(limit) };
    }
    if (name === 'session_delete') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      if (!this.memoryStore?.deleteSession) {
        return { ok: false, error: 'memory_store_unavailable' };
      }
      const targetSessionId = String(args?.sessionId || '').trim();
      if (!targetSessionId) return { ok: false, error: 'sessionId is required' };
      const currentSessionId = String(context?.sessionId || '').trim();
      if (!Boolean(args?.force) && currentSessionId && targetSessionId === currentSessionId) {
        return {
          ok: false,
          error: 'active_session_protected',
          stderr: 'Refusing to delete the active session without force=true.'
        };
      }
      return this.memoryStore.deleteSession(targetSessionId, {
        operationId: String(args?.operationId || '').trim()
      });
    }
    if (name === 'session_clear') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      if (!this.memoryStore?.clearSessions) {
        return { ok: false, error: 'memory_store_unavailable' };
      }
      const keepFromArgs = String(args?.keepSessionId || '').trim();
      const keepSessionId = keepFromArgs || String(context?.sessionId || '').trim();
      if (!keepSessionId && !Boolean(args?.force)) {
        return {
          ok: false,
          error: 'keep_session_required',
          stderr: 'Missing keepSessionId. Pass keepSessionId or set force=true to clear every session.'
        };
      }
      return this.memoryStore.clearSessions({
        keepSessionId,
        operationId: String(args?.operationId || '').trim()
      });
    }
    if (name === 'shell_run') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      const rawCmd = String(args?.cmd || '').trim();
      const ollamaRunIntent = parseOllamaRunIntent(rawCmd);
      let cmd = rawCmd;
      if (ollamaRunIntent?.model && ollamaRunIntent?.prompt) {
        let modelRef = ollamaRunIntent.model;
        const lookup = await this.executor.runShell('ollama list', shellTimeout(10000), { cwd: this.workspaceRoot, deadlineAt });
        if (/^[a-f0-9]{12,}$/i.test(modelRef)) {
          const resolvedName = lookup?.ok ? parseOllamaListModelName(lookup.stdout, modelRef) : null;
          if (resolvedName) modelRef = resolvedName;
        }
        return this.executeTool('http_request', {
          url: `${this.config.model?.ollamaBaseUrl || 'http://127.0.0.1:11434'}/api/generate`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          bodyJson: {
            model: modelRef,
            prompt: ollamaRunIntent.prompt,
            stream: false
          },
          timeoutMs: shellTimeout(30000)
        }, context);
      }
      const httpRequestArgs = tryParseCurlAsHttpRequest(cmd);
      if (httpRequestArgs) {
        return this.executeTool('http_request', {
          ...httpRequestArgs,
          timeoutMs: shellTimeout(20000)
        }, context);
      }
      const ownerMode = String(this.config.runtime?.ownerControlMode || 'safe').toLowerCase();
      if (!this.config.runtime?.shellEnabled) {
        return { ok: false, code: 1, error: 'shell_disabled', stderr: 'Shell execution is disabled by runtime config.', stdout: '' };
      }
      if (ownerMode === 'safe' && requiresUnlockedMode(cmd)) {
        return {
          ok: false,
          code: 1,
          error: 'owner_mode_restricted',
          stderr: 'Command requires owner-unlocked mode. Set runtime.ownerControlMode to owner-unlocked or owner-unrestricted.'
        };
      }
      const blocked = hasBlockedShellPattern(cmd);
      if (blocked) {
        return { ok: false, code: 1, error: 'shell_blocked', stderr: `Blocked dangerous command pattern: ${blocked}`, stdout: '' };
      }
      const effectiveTimeoutMs = isLikelyInteractiveShellCommand(cmd)
        ? Math.min(shellTimeout(120000), 15000)
        : shellTimeout(120000);
      return this.executor.runShell(cmd, effectiveTimeoutMs, { cwd: this.workspaceRoot, deadlineAt });
    }
    if (name === 'browser_status') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return this.executor.runWithRetry(name, args, () => this.browser.status(), retryOptions);
    }
    if (name === 'browser_navigate') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return this.executor.runWithRetry(name, args, () => this.browser.navigate(args.url), retryOptions);
    }
    if (name === 'browser_search') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return this.executor.runWithRetry(name, args, () => this.browser.search(args.query), retryOptions);
    }
    if (name === 'browser_type') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return this.executor.runWithRetry(name, args, () => this.browser.type(args.selector, args.text, Boolean(args.submit)), retryOptions);
    }
    if (name === 'browser_click') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return this.executor.runWithRetry(name, args, () => this.browser.click(args.selector), retryOptions);
    }
    if (name === 'browser_extract') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return this.executor.runWithRetry(name, args, () => this.browser.extractText(args.selector || 'body'), retryOptions);
    }
    if (name === 'browser_snapshot') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return this.executor.runWithRetry(name, args, () => this.browser.snapshot(), retryOptions);
    }
    if (name === 'http_download') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      if (!this.config.runtime?.shellEnabled) {
        return { ok: false, code: 1, error: 'shell_disabled', stderr: 'http_download requires shell execution.', stdout: '' };
      }
      const outPath = safePath(args.outPath, this.workspaceRoot);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const out = await this.executor.runShell(`curl -fL ${JSON.stringify(args.url)} -o ${JSON.stringify(outPath)}`, shellTimeout(600000), {
        cwd: this.workspaceRoot,
        deadlineAt
      });
      const result = {
        ...out,
        url: args.url,
        outPath
      };
      return result;
    }
    if (name === 'http_request') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      const method = String(args?.method || 'GET').trim().toUpperCase();
      const timeoutMs = shellTimeout(Number(args?.timeoutMs || 20000));
      const headers = { ...(args?.headers || {}) };
      let body = undefined;
      if (args?.bodyJson !== undefined) {
        body = JSON.stringify(args.bodyJson);
        if (!Object.keys(headers).some((key) => String(key).toLowerCase() === 'content-type')) {
          headers['Content-Type'] = 'application/json';
        }
      } else if (typeof args?.bodyText === 'string') {
        body = args.bodyText;
      }
      const response = await fetch(String(args?.url || ''), {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs)
      });
      const rawText = await response.text();
      let parsedJson = null;
      try {
        parsedJson = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsedJson = null;
      }
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url || String(args?.url || ''),
        headers: Object.fromEntries(response.headers.entries()),
        json: parsedJson,
        text: parsedJson ? '' : rawText
      };
    }
    if (name === 'desktop_open') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      if (!this.config.runtime?.shellEnabled) {
        return { ok: false, code: 1, error: 'shell_disabled', stderr: 'desktop_open requires shell execution.', stdout: '' };
      }
      return this.executor.runShell(`xdg-open ${JSON.stringify(args.target)}`, shellTimeout(15000), { cwd: this.workspaceRoot, deadlineAt });
    }
    if (name === 'desktop_xdotool') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      if (!this.config.runtime?.shellEnabled) {
        return { ok: false, code: 1, error: 'shell_disabled', stderr: 'desktop_xdotool requires shell execution.', stdout: '' };
      }
      const cmd = String(args?.cmd || '').trim();
      if (!cmd) {
        return { ok: false, code: 1, error: 'invalid_xdotool_command', stderr: 'desktop_xdotool requires a non-empty command.', stdout: '' };
      }
      if (hasUnsafeShellMetacharacters(cmd)) {
        return { ok: false, code: 1, error: 'unsafe_xdotool_command', stderr: 'desktop_xdotool command contains blocked shell metacharacters.', stdout: '' };
      }
      return this.executor.runShell(`xdotool ${cmd}`, shellTimeout(15000), { cwd: this.workspaceRoot, deadlineAt });
    }
    if (name === 'skill_list') {
      return { ok: true, skills: this.skillManager.listSkills() };
    }
    if (name === 'skill_forge') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      
      let researchSummary = '';
      if (args.research) {
        const researchOut = await this.executeTool('browser_search', { query: `best practices for ${args.goal}` }, context);
        researchSummary = researchOut.ok ? researchOut.stdout || researchOut.text : '';
      }
      
      const generation = await this.skillFactory.generateBundle(args.goal, researchSummary);
      if (!generation.ok) return generation;
      
      // Get name from SKILL.md or metadata
      const nameMatch = generation.files['SKILL.md'].match(/name:\s*(\S+)/);
      const skillName = nameMatch ? nameMatch[1] : `forged-${Date.now()}`;
      
      return this.skillManager.installSkillBundle({
        name: skillName,
        files: generation.files,
        source: 'factory'
      });
    }
    if (name === 'skill_load') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      
      const bundle = await this.skillManager.loadSkillBundle(args.name);
      if (!bundle) return { ok: false, error: 'skill_load_failed' };

      // Inject into memory if available
      if (this.memoryStore?.addMemoryArtifact) {
        this.memoryStore.addMemoryArtifact({
          sessionId: context.sessionId,
          artifactType: 'skill_manual',
          content: JSON.stringify(bundle.files),
          sourceRef: args.name
        });
      }

      return { 
        ok: true, 
        name: args.name, 
        message: `Skill "${args.name}" rules loaded into context. Use its decision tree to guide your next actions.`,
        files: Object.keys(bundle.files) 
      };
    }
    if (name === 'skill_install') {
      return this.skillManager.installSkill(args || {});
    }
    if (name === 'skill_review') {
      return this.skillManager.reviewSkill(args?.name);
    }
    if (name === 'skill_approve') {
      return this.skillManager.approveSkill(args?.name);
    }
    if (name === 'skill_execute') {
      return this.skillManager.executeSkill(args?.name, args?.args || {});
    }
    if (name === 'skill_uninstall') {
      return this.skillManager.uninstallSkill(args?.name);
    }
    if (name === 'email_status') {
      return this.googleWorkspace.status();
    }
    if (name === 'email_send') {
      return this.googleWorkspace.gmailSend(args || {});
    }
    if (name === 'email_list') {
      return this.googleWorkspace.gmailList(args || {});
    }
    if (name === 'email_read') {
      return this.googleWorkspace.gmailRead(args || {});
    }
    if (name === 'gworkspace_call') {
      return this.googleWorkspace.call(args || {});
    }
    if (name === 'research_run_daily') {
      return this.researchManager.runDailyResearch({ simulate: Boolean(args?.simulate) });
    }
    if (name === 'research_list_recent') {
      return this.researchManager.listRecent(Number(args?.limit || 10));
    }
    if (name === 'research_review_queue') {
      return this.researchManager.reviewQueue(Number(args?.limit || 50));
    }
    if (name === 'research_approve') {
      return this.researchManager.approveProposal(String(args?.url || ''), String(args?.note || ''));
    }

    throw new Error(`Unknown tool: ${name}`);
  }

  async executeModelNativeSearch({ query, limit = 10, region = 'us-en' } = {}) {
    const providerId = String(this.config?.model?.provider || '').trim().toLowerCase();
    const supported = new Set(['openai', 'openrouter', 'nvidia', 'xiaomimimo']);
    if (!supported.has(providerId)) {
      throw new Error(`model_native_unsupported_provider:${providerId || 'unknown'}`);
    }
    const provider = buildProvider(this.config);
    const prompt = [
      `Search the web for: ${query}`,
      `Return up to ${Math.max(1, Math.min(Number(limit || 10), 10))} results for region ${region}.`,
      'Return strict JSON only:',
      '{"results":[{"title":"...","url":"https://...","snippet":"..."}]}'
    ].join('\n');

    const out = await provider.chat({
      messages: [
        { role: 'system', content: 'Use native web browsing/search if available. Output only valid JSON.' },
        { role: 'user', content: prompt }
      ],
      tools: [],
      nativeWebSearch: true,
      timeoutMs: Number(this.config?.runtime?.providerRequestTimeoutMs || 120000)
    });
    const parsed = safeParseJsonObject(String(out?.content || ''));
    const rows = Array.isArray(parsed?.results) ? parsed.results : [];
    const results = rows
      .map((item) => ({
        title: String(item?.title || '').trim(),
        url: String(item?.url || '').trim(),
        snippet: String(item?.snippet || '').trim()
      }))
      .filter((item) => item.title && item.url.startsWith('http'))
      .slice(0, 10);

    return {
      ok: true,
      results,
      query: String(query || ''),
      backend: 'model-native',
      total: results.length,
      source: 'provider_native_search'
    };
  }
}
