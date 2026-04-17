import crypto from 'node:crypto';
import { buildProvider } from '../providers/index.mjs';
import { ToolRuntime } from '../tools/runtime.mjs';
import { loadSkills } from '../skills/loader.mjs';
import { buildContextBudgetInfo, estimateMessagesTokens } from './context-budget.mjs';
import { compactSessionMessages, trimMessagesToTokenBudget } from './context-compact.mjs';
import {
  assessFinalAnswerQuality,
  extractRequirements,
  normalizeRecoveredFinalText,
  synthesizeToolOnlyAnswer
} from './turn-recovery-summary.mjs';
import {
  classifyControllerBehavior,
  getBehaviorRegistrySnapshot,
  hydrateBehaviorRegistry,
  learnControllerBehavior,
  listBehaviorClasses,
  resetAllLearnedBehaviors,
  resetLearnedBehavior
} from './model-behavior-registry.mjs';
import { buildControllerSystemMessage } from './context-pack-builder.mjs';
import { recallRelevantArtifacts } from './memory-recall.mjs';
import {
  continuationDirective,
  isProofBackedDone,
  recoveryDirective,
  shouldForceContinuation
} from './execution-contract.mjs';
import { scoreProofQuality } from './proof-scorer.mjs';
import { getTaskTracker } from './task-tracker.mjs';
import { getSelfMonitor } from './self-monitor.mjs';
import { CompletionChecklist } from './completion-checklist.mjs';
import { getWorkingMemory } from './working-memory.mjs';
import {
  buildPivotHints,
  buildChannelCommandOverview,
  buildDeterministicActionConfirmationReply,
  buildDeterministicImprovementProposalReply,
  buildDeterministicSessionHistoryReviewReply,
  buildDeterministicStandaloneFastReply,
  buildDeterministicReviewFollowUpReply,
  buildSessionSupportReply,
  clipText,
  buildSkillPrompt,
  compactToolResult,
  detectLocalRuntimeTask,
  deterministicGreetingReply,
  deterministicLightChatReply,
  extractAutomaticFacts,
  formatProviderFailureReply,
  getExecutionProfile,
  getLastUserMessage,
  inferParamsB,
  inferRoutedTools,
  isConversationalAliveQuestion,
  isModelInfoQuestion,
  mergeProfileWithBehavior,
  normalizeAssistantContent,
  normalizeModelForProvider,
  parseSlashCommand,
  parseToolArgs,
  providerModelLabel,
  scoreDeterministicFastTurn,
  summarizeResult,
  toolRunFailed,
  uniq
} from './agent-helpers.mjs';
import { scoreConfidence } from './confidence-scorer.mjs';
import { decomposeTask } from './task-decomposer.mjs';
import { ContextPressure } from './context-pressure.mjs';
import { resolveExecutionEnvelope } from './model-execution-envelope.mjs';
import {
  classifyProviderFailure,
  resolveFallbackAction,
  shouldUseProvider
} from './provider-fallback-policy.mjs';
import { detectSteps } from './completion-checklist.mjs';
import { SideQuestManager } from './side-quest.mjs';
import { ToolValidator, validateToolCall } from './tool-validator.mjs';
import { PolicyLoader, buildSystemMessage } from './policy-loader.mjs';
import { PredictiveFailureDetector } from './predictive-failure.mjs';
import { TaskOrchestrator } from './task-orchestrator.mjs';
import { FastAwarenessRouter, createFastAwarenessRouter } from './fast-awareness-router.mjs';
import { classifyRoleMode, modeDirective } from './role-mode-router.mjs';
import { RoleModelResolver, roleModelRegistry } from './role-model-registry.mjs';
import { WorkerOrchestrator } from './worker-orchestrator.mjs';
import { DaemonManager } from './daemon-manager.mjs';
import { runDeterministicRepoInspection } from './deterministic-repo-inspector.mjs';
import { createHybridRetriever } from '../memory/recall.mjs';
import { FastPathRouter } from './fast-path-router.mjs';
import { SafetyCouncil } from './council/safety-council.mjs';
import { ProofScorerCouncil } from './council/proof-scorer.mjs';
import { IndependentVerifier } from './verifier.mjs';
import { logEvent } from './audit-log.mjs';
import { logInfo, logError } from '../logger.mjs';
import { saveConfig } from '../config.mjs';
import { buildConfigParityReport } from './config-parity-check.mjs';

export { isConversationalAliveQuestion };

function inferFinalizationState({ finalText = '', trace = null, progress = null }) {
  const text = String(finalText || '').trim();
  const failureSignals = [
    /^status:\s*failed/im,
    /^status:\s*partial/im,
    /^status:\s*ok[\s\S]*❌/im,
    /all configured providers failed/i,
    /all provider attempts failed/i,
    /primary provider failed/i,
    /\binsufficient evidence\b/i,
    /\btool_circuit_open\b/i,
    /\brequest is taking too long\b/i,
    /\bpartial proof\b/i,
    /completion claim was rejected/i,
    /^mission_status:\s*continue/im,
    /❌/
  ];
  const hasFailureSignal = failureSignals.some((pattern) => pattern.test(text));
  const providerFailures = Array.isArray(trace?.providerFailures) ? trace.providerFailures.length : 0;
  const answerScore = Number(trace?.answerAssessment?.score || 0);
  const weakAnswer = Boolean(trace?.answerAssessment?.shouldReplace) || (answerScore > 0 && answerScore < 70);
  const hasTask = Boolean(progress?.hasTask);
  const isComplete = hasTask && Number(progress?.percent || 0) === 100 && !hasFailureSignal && providerFailures === 0 && !weakAnswer;
  const isInProgress = hasTask && Number(progress?.percent || 0) < 100;
  return {
    state: isComplete ? 'complete' : hasFailureSignal || providerFailures > 0 || weakAnswer ? 'partial' : isInProgress ? 'in_progress' : 'none',
    hasFailureSignal,
    providerFailures,
    answerScore
  };
}

function shouldSkipCouncilRevisionForMildProofDeficit({
  proofResult = null,
  minProofScore = 0.7,
  executedTools = [],
  independentVerification = null
} = {}) {
  const reason = String(proofResult?.reason || '');
  if (!reason.startsWith('proof_quality_insufficient')) return false;
  const score = Number(proofResult?.proofScore?.score ?? proofResult?.proofScore?.overallScore ?? 0);
  if (!Number.isFinite(score)) return false;
  const threshold = Number(minProofScore);
  if (!Number.isFinite(threshold)) return false;
  const scoreGap = threshold - score;
  const mildDeficit = scoreGap > 0 && scoreGap <= 0.08;
  if (!mildDeficit) return false;
  const hasEvidence = (Array.isArray(executedTools) && executedTools.length > 0) || independentVerification?.verified === true;
  return hasEvidence;
}

export { inferFinalizationState, enforceVisibleReplyContract, shouldSkipCouncilRevisionForMildProofDeficit };

function enforceVisibleReplyContract({
  finalText = '',
  userMessage = '',
  executedTools = [],
  toolRuns = 0
} = {}) {
  const text = String(finalText || '').trim();
  if (!text) return text;
  const requirements = extractRequirements(userMessage);
  const leakedInternalFormat =
    (/^Status:\s+\w+/im.test(text) && /Findings:/im.test(text)) ||
    /^Best next steps from current evidence:/im.test(text);
  const statusExplicit =
    Boolean(requirements?.asksStatus) &&
    !Boolean(requirements?.asksWeather) &&
    !Boolean(requirements?.asksExplanation) &&
    !Boolean(requirements?.asksReview);
  if (!leakedInternalFormat || statusExplicit) return text;
  const recovered = synthesizeToolOnlyAnswer({
    userMessage,
    executedTools,
    toolRuns
  });
  if (recovered && !/^Status:\s+\w+/im.test(recovered)) return recovered;
  return 'I generated an internal diagnostics summary instead of a direct user answer. Please retry and I will answer directly.';
}

export class OpenUnumAgent {
  constructor({ config, memoryStore, sleepCycle = null }) {
    this.config = config;
    this.memoryStore = memoryStore;
    this.sleepCycle = sleepCycle;
    this.toolRuntime = new ToolRuntime(config, memoryStore);
    this.taskTracker = getTaskTracker(memoryStore);
    this.taskDecomposer = { decomposeTask };
    this.selfMonitor = getSelfMonitor(this);
    this.behaviorRegistryHydrated = false;
    this.completionChecklist = new CompletionChecklist();
    this.contextPressure = new ContextPressure();
    
    // Initialize Side Quest Manager (for branchable repair/proof/heal sessions)
    this.sideQuestManager = new SideQuestManager({
      sessionManager: memoryStore,
      agent: this,
      workspaceRoot: config?.runtime?.workspaceRoot || process.cwd()
    });
    
    // PHASE 3: Initialize Predictive Failure Detector
    this.predictiveFailure = new PredictiveFailureDetector({
      memoryStore,
      config
    });
    
    // PHASE 3: Initialize Worker Orchestrator (for background workers)
    this.workerOrchestrator = new WorkerOrchestrator({
      toolRuntime: this.toolRuntime,
      memoryStore
    });
    
    // PHASE 3: Initialize Task Orchestrator (for multi-step autonomous tasks)
    this.taskOrchestrator = new TaskOrchestrator({
      toolRuntime: this.toolRuntime,
      memoryStore,
      missions: null, // Will be wired if missions module is available
      workerOrchestrator: this.workerOrchestrator,
      selfEditPipeline: null, // Optional: wire if self-edit exists
      modelScoutWorkflow: null, // Optional: wire if model-scout exists
      planner: null, // Optional: wire if planner exists
      workspaceRoot: config?.runtime?.workspaceRoot || process.cwd()
    });
    
    // PHASE 4: Initialize Daemon Manager (for background file watchers, processes, HTTP monitors)
    this.daemonManager = new DaemonManager({
      toolRuntime: this.toolRuntime,
      memoryStore,
      workspaceRoot: config?.runtime?.workspaceRoot || process.cwd()
    });
    // Start the health loop for daemon monitoring
    this.daemonManager.startHealthLoop();
    
    // Initialize Policy Loader (hierarchical AGENTS.md loading)
    this.policyLoader = new PolicyLoader({
      workspaceRoot: config?.runtime?.workspaceRoot || process.cwd()
    });
    
    // Initialize Hybrid Retriever (R2 - Unified Memory)
    this.retriever = createHybridRetriever({
      workspaceRoot: config?.runtime?.workspaceRoot || process.cwd(),
      memoryStore: this.memoryStore,
      bm25TopK: 25,
      finalTopK: 8
    });
    
    this.fastPathRouter = new FastPathRouter({
      agent: this,
      memoryStore: this.memoryStore,
      config: this.config
    });

    // R4: Council Middleware - Pre-flight and Post-flight validation
    this.safetyCouncil = new SafetyCouncil({ config, memoryStore: this.memoryStore });
    this.proofScorerCouncil = new ProofScorerCouncil({ config });
    this.independentVerifier = new IndependentVerifier({ config, memoryStore: this.memoryStore });

    // R6: Role-Model Registry - maps task roles to appropriate model tiers
    this.roleModelResolver = new RoleModelResolver(roleModelRegistry);

    if (this.memoryStore?.listControllerBehaviors) {
      const persisted = this.memoryStore.listControllerBehaviors(200);
      hydrateBehaviorRegistry(persisted);
      this.behaviorRegistryHydrated = true;
    }
    this.lastRuntime = {
      provider: config.model.provider,
      model: config.model.model
    };
    this.providerAvailability = new Map();
    this.repairQuestCooldown = new Map();
  }

  getCurrentModel() {
    return {
      provider: this.config.model.provider,
      model: this.config.model.model,
      activeProvider: this.lastRuntime?.provider || this.config.model.provider,
      activeModel: this.lastRuntime?.model || this.config.model.model
    };
  }

  getControllerBehaviorSnapshot(limit = 40) {
    const inMemory = getBehaviorRegistrySnapshot(limit);
    const persisted = this.memoryStore?.listControllerBehaviors
      ? this.memoryStore.listControllerBehaviors(limit)
      : [];
    return {
      hydrated: this.behaviorRegistryHydrated,
      inMemory,
      persisted
    };
  }

  getBehaviorClasses() {
    return listBehaviorClasses();
  }

  resetControllerBehavior({ provider, model } = {}) {
    const p = String(provider || '').trim().toLowerCase();
    const m = String(model || '').trim().toLowerCase();
    const runtime = resetLearnedBehavior({ provider: p, model: m });
    const persistedRemoved = this.memoryStore?.removeControllerBehavior
      ? this.memoryStore.removeControllerBehavior({ provider: p, model: m })
      : { ok: false, removed: false };
    return {
      ok: Boolean(runtime?.ok),
      provider: p,
      model: m,
      runtimeRemoved: Boolean(runtime?.removed),
      persistedRemoved: Boolean(persistedRemoved?.removed)
    };
  }

  resetAllControllerBehaviors() {
    const runtime = resetAllLearnedBehaviors();
    const persisted = this.memoryStore?.clearControllerBehaviors
      ? this.memoryStore.clearControllerBehaviors()
      : { ok: false, removedCount: 0 };
    return {
      ok: Boolean(runtime?.ok),
      runtimeRemovedCount: Number(runtime?.removedCount || 0),
      persistedRemovedCount: Number(persisted?.removedCount || 0)
    };
  }

  getProviderAvailabilitySnapshot() {
    const now = Date.now();
    return [...this.providerAvailability.entries()].map(([provider, row]) => {
      const blockedUntil = Number(row?.blockedUntil || 0);
      return {
        provider,
        blockedUntil,
        blockedUntilIso: blockedUntil ? new Date(blockedUntil).toISOString() : null,
        blocked: blockedUntil > now,
        lastFailureKind: row?.lastFailureKind || null,
        lastAction: row?.lastAction || null,
        lastError: row?.lastError || null,
        updatedAt: row?.updatedAt || null
      };
    });
  }

  markProviderFailure(provider, { kind, action, cooldownMs = 0, errorMessage = '' } = {}) {
    const now = Date.now();
    const blockedUntil = cooldownMs > 0 ? now + Number(cooldownMs) : 0;
    this.providerAvailability.set(provider, {
      blockedUntil,
      lastFailureKind: kind || 'unknown',
      lastAction: action || 'switch_provider',
      lastError: String(errorMessage || '').slice(0, 500),
      updatedAt: new Date(now).toISOString()
    });
  }

  clearProviderFailure(provider) {
    if (!this.providerAvailability.has(provider)) return;
    this.providerAvailability.set(provider, {
      blockedUntil: 0,
      lastFailureKind: null,
      lastAction: 'success',
      lastError: null,
      updatedAt: new Date().toISOString()
    });
  }

  switchModel(provider, model) {
    provider = String(provider || 'ollama-cloud').trim().toLowerCase();
    if (provider === 'generic') provider = 'openai';
    if (provider === 'ollama') provider = 'ollama-cloud';
    this.config.model.provider = provider;
    this.config.model.model = providerModelLabel(provider, model);
    this.config.model.providerModels = this.config.model.providerModels || {};
    this.config.model.providerModels[provider] = this.config.model.model;
    return this.getCurrentModel();
  }

  async runTool(name, args, context = {}) {
    return this.toolRuntime.run(name, args || {}, context || {});
  }

  recordDetachedToolRuns(sessionId, executedTools = []) {
    if (!sessionId || !this.memoryStore?.recordToolRun) return;
    for (const run of executedTools) {
      if (!run?.name) continue;
      this.memoryStore.recordToolRun({
        sessionId,
        toolName: run.name,
        args: run.args || {},
        result: run.result || {}
      });
    }
  }

  async tryDeterministicRepoInspection({ message, sessionId }) {
    const workspaceRoot = this.config?.runtime?.workspaceRoot || process.cwd();
    const startedAt = Date.now();
    const inspection = await runDeterministicRepoInspection({
      message,
      workspaceRoot,
      runTool: (name, args, context = {}) => this.toolRuntime.run(name, args, {
        workspaceRoot,
        ...context
      })
    });
    if (!inspection?.reply) return null;

    this.memoryStore.addMessage(sessionId, 'user', message);
    this.recordDetachedToolRuns(sessionId, inspection.executedTools);
    this.memoryStore.addMessage(sessionId, 'assistant', inspection.reply);
    for (const fact of extractAutomaticFacts({
      message,
      reply: inspection.reply,
      model: this.getCurrentModel(),
      trace: null
    })) {
      this.memoryStore.rememberFact(fact.key, fact.value);
    }

    return {
      sessionId,
      reply: inspection.reply,
      model: this.getCurrentModel(),
      trace: {
        provider: this.config.model.provider,
        model: this.config.model.model,
        note: 'deterministic_repo_inspection',
        executionProfile: 'deterministic-repo-inspect',
        deterministicFastPath: true,
        fastPathCategory: 'repo-inspection',
        iterations: inspection.iterations,
        permissionDenials: [],
        turnSummary: {
          toolRuns: inspection.executedTools.length,
          iterationCount: inspection.iterations.length,
          permissionDenials: 0,
          routedTools: inspection.executedTools.map((run) => run.name),
          answerShape: inspection.answerAssessment?.shape || 'summary',
          answerScore: inspection.answerAssessment?.score || 0
        },
        answerAssessment: inspection.answerAssessment,
        latency: {
          path: 'deterministic-repo-inspect',
          awarenessMs: 0,
          providerMs: 0,
          continuationMs: 0,
          persistenceMs: 0,
          totalMs: Date.now() - startedAt
        }
      }
    };
  }

  reloadTools() {
    this.toolRuntime = new ToolRuntime(this.config, this.memoryStore);
  }

  getContextStatus(sessionId) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('sessionId is required');
    const history = this.memoryStore.getMessagesForContext(sid, 1000)
      .map((m) => ({ role: m.role, content: m.content }));
    const model = this.getCurrentModel();
    const budget = buildContextBudgetInfo({
      config: this.config,
      provider: model.activeProvider || model.provider,
      model: model.activeModel || model.model,
      messages: history
    });
    const latestCompaction = this.memoryStore.getLatestSessionCompaction(sid);
    return {
      ok: true,
      sessionId: sid,
      messageCount: history.length,
      estimatedTokens: estimateMessagesTokens(history),
      budget,
      latestCompaction
    };
  }

  compactSessionContext({ sessionId, dryRun = false }) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('sessionId is required');
    const model = this.getCurrentModel();
    const full = this.memoryStore.getMessagesForContext(sid, 2000);
    if (!full.length) return { ok: true, skipped: true, reason: 'no_messages' };
    const contextLimit = buildContextBudgetInfo({
      config: this.config,
      provider: model.activeProvider || model.provider,
      model: model.activeModel || model.model,
      messages: full.map((m) => ({ role: m.role, content: m.content }))
    }).contextLimit;
    const targetTokens = Math.floor(contextLimit * Number(this.config.runtime?.contextCompactTargetPct || 0.4));
    const compacted = compactSessionMessages({
      messages: full,
      targetTokens,
      protectRecentTurns: Number(this.config.runtime?.contextProtectRecentTurns || 8)
    });
    if (!dryRun && compacted.cutoffMessageId > 0) {
      const modelName = `${model.activeProvider || model.provider}/${model.activeModel || model.model}`;
      this.memoryStore.recordSessionCompaction({
        sessionId: sid,
        cutoffMessageId: compacted.cutoffMessageId,
        model: modelName,
        ctxLimit: contextLimit,
        preTokens: compacted.preTokens,
        postTokens: compacted.postTokens,
        summary: compacted.summary
      });
      this.memoryStore.addMemoryArtifacts(sid, compacted.artifacts);
      this.memoryStore.addMessage(sid, 'system', compacted.compactedMessages[0]?.content || 'SESSION COMPACTION CHECKPOINT');
    }
    return {
      ok: true,
      dryRun: Boolean(dryRun),
      cutoffMessageId: compacted.cutoffMessageId,
      preTokens: compacted.preTokens,
      postTokens: compacted.postTokens,
      summary: compacted.summary,
      artifactsCount: compacted.artifacts.length
    };
  }

  listContextCompactions(sessionId, limit = 20) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('sessionId is required');
    return { ok: true, sessionId: sid, compactions: this.memoryStore.listSessionCompactions(sid, limit) };
  }

  listContextArtifacts(sessionId, limit = 40) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('sessionId is required');
    return { ok: true, sessionId: sid, artifacts: this.memoryStore.getMemoryArtifacts(sid, limit) };
  }

  handleSlashCommand(sessionId, slash) {
    const sid = String(sessionId || '').trim();
    const current = this.getCurrentModel();
    if (slash.name === 'help') {
      return [
        'Available slash commands:',
        '/start',
        '/status',
        '/new',
        '/compact',
        '/memory',
        '/cost',
        '/ledger',
        '/session list',
        '/session clear',
        '/session delete <id>'
      ].join('\n');
    }
    if (slash.name === 'status') {
      const status = this.getContextStatus(sid);
      return [
        `provider/model: ${providerModelLabel(current.activeProvider || current.provider, current.activeModel || current.model)}`,
        `messages: ${status.messageCount}`,
        `estimated_tokens: ${status.estimatedTokens}`,
        `context_limit: ${status.budget.contextLimit}`,
        `usage_pct: ${(status.budget.usagePct * 100).toFixed(1)}%`,
        `latest_compaction: ${status.latestCompaction ? status.latestCompaction.createdAt : 'none'}`
      ].join('\n');
    }
    if (slash.name === 'start') {
      return buildChannelCommandOverview(sid);
    }
    if (slash.name === 'new') {
      if (typeof this.memoryStore.clearSessionMessages !== 'function') return 'clearSessionMessages not available';
      const out = this.memoryStore.clearSessionMessages(sid);
      return [
        `session_new ok=${out.ok}`,
        `session_id=${sid}`,
        `deleted_messages=${out.deletedMessages}`,
        `deleted_tool_runs=${out.deletedToolRuns}`,
        `deleted_compactions=${out.deletedCompactions}`,
        'Starting fresh — previous context removed.'
      ].join('\n');
    }
    if (slash.name === 'compact') {
      const out = this.compactSessionContext({ sessionId: sid, dryRun: false });
      return [
        `compact ok=${out.ok}`,
        `pre_tokens=${out.preTokens}`,
        `post_tokens=${out.postTokens}`,
        `cutoff_message_id=${out.cutoffMessageId}`,
        `artifacts=${out.artifactsCount}`
      ].join('\n');
    }
    if (slash.name === 'memory') {
      const artifacts = this.memoryStore.getMemoryArtifacts(sid, 5);
      const latestCompaction = this.memoryStore.getLatestSessionCompaction(sid);
      return [
        `artifacts: ${artifacts.length}`,
        `latest_compaction: ${latestCompaction ? latestCompaction.createdAt : 'none'}`,
        ...artifacts.slice(0, 5).map((item, index) => `${index + 1}. [${item.type}] ${String(item.content || '').slice(0, 120)}`)
      ].join('\n');
    }
    if (slash.name === 'cost') {
      const messages = this.memoryStore.getAllMessagesForSession(sid).map((m) => ({ role: m.role, content: m.content }));
      const estimatedTokens = estimateMessagesTokens(messages);
      return [
        `session_messages=${messages.length}`,
        `estimated_total_tokens=${estimatedTokens}`,
        'cost_estimate=not provider-billed; token estimate only'
      ].join('\n');
    }
    if (slash.name === 'ledger') {
      const strategies = this.memoryStore.getStrategyLedger ? this.memoryStore.getStrategyLedger({ goal: '', limit: 6 }) : [];
      const tools = this.memoryStore.getToolReliability ? this.memoryStore.getToolReliability(6) : [];
      return [
        `strategy_entries=${strategies.length}`,
        ...strategies.map((item, index) => `${index + 1}. ${item.success ? 'SUCCESS' : 'FAIL'} | ${item.strategy} | ${String(item.evidence || '').slice(0, 100)}`),
        `tool_reliability_entries=${tools.length}`,
        ...tools.map((item, index) => `${index + 1}. ${item.toolName} success_rate=${(item.successRate * 100).toFixed(0)}% total=${item.total}`)
      ].join('\n');
    }
    if (slash.name === 'session' && slash.args[0] === 'list') {
      const sessions = this.memoryStore.listSessions(12);
      return [
        `sessions=${sessions.length}`,
        ...sessions.map((item, index) => `${index + 1}. ${item.sessionId} | ${item.title} | ${item.messageCount} msgs`)
      ].join('\n');
    }
    if (slash.name === 'session' && slash.args[0] === 'clear') {
      const out = this.memoryStore.clearSessions({ keepSessionId: sid });
      return [
        `session_clear ok=${out.ok}`,
        `keep_session_id=${sid}`,
        `deleted_sessions=${out.deletedSessions}`,
        `deleted_messages=${out.deletedMessages}`
      ].join('\n');
    }
    if (slash.name === 'session' && slash.args[0] === 'delete') {
      const targetId = String(slash.args[1] || '').trim();
      if (!targetId) return 'usage: /session delete <sessionId>';
      if (targetId === sid) return 'refused: cannot delete the active session via slash command.';
      const out = this.memoryStore.deleteSession(targetId);
      return [
        `session_delete ok=${out.ok}`,
        `session_id=${targetId}`,
        `deleted=${out.deleted}`,
        `deleted_messages=${out.deletedMessages}`
      ].join('\n');
    }
    return null;
  }

  getModelForProvider(provider) {
    const fallback = normalizeModelForProvider(provider, this.config.model.model);
    return this.config.model.providerModels?.[provider] || fallback;
  }

  buildProviderAttempts() {
    const preferred = this.config.model.provider;
    const disabledProviders = new Set(
      (this.config.model.routing?.disabledProviders || [])
        .map((provider) => String(provider || '').trim())
        .filter(Boolean)
    );
    if (this.config.model.routing?.forcePrimaryProvider) {
      return disabledProviders.has(preferred)
        ? []
        : [{ provider: preferred, model: this.config.model.model }];
    }
    const fallbackEnabled = this.config.model.routing?.fallbackEnabled !== false;
    const fallbacks = fallbackEnabled ? (this.config.model.routing?.fallbackProviders || []) : [];
    const providers = uniq([preferred, ...fallbacks])
      .filter(Boolean)
      .filter((provider) => !disabledProviders.has(provider));
    const now = Date.now();
    let selected = providers.filter((provider) => shouldUseProvider(this.providerAvailability.get(provider), now));
    if (!selected.length && providers.length > 0) selected = [providers[0]];
    return selected.map((provider) => ({
      provider,
      model: provider === preferred ? this.config.model.model : this.getModelForProvider(provider)
    }));
  }

  canAttemptProviderRoute(provider, model = '') {
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    const report = buildConfigParityReport(this.config, process.env);
    const matrix = report.providerMatrix?.[normalizedProvider];
    if (!matrix) {
      return { ok: false, reason: 'provider_unknown' };
    }
    if (matrix.disabled) {
      return { ok: false, reason: 'provider_disabled' };
    }
    if (!matrix.baseUrlConfigured) {
      return { ok: false, reason: 'provider_base_url_missing' };
    }
    if (!normalizedProvider.startsWith('ollama-') && !matrix.apiKeyConfigured) {
      return { ok: false, reason: 'provider_api_key_missing' };
    }
    const resolvedModel = String(model || this.getModelForProvider(normalizedProvider) || '').trim();
    if (!resolvedModel) {
      return { ok: false, reason: 'provider_model_missing' };
    }
    return { ok: true, model: resolvedModel };
  }

  shouldSpawnRepairQuest({ sessionId, toolName, sideQuestMode = false, errorCode = '' } = {}) {
    if (sideQuestMode) return false;
    if (!toolName) return false;
    const err = String(errorCode || '').trim();
    if (err === 'tool_circuit_open') return false;
    const key = `${String(sessionId || '').trim()}::${String(toolName || '').trim()}`;
    const now = Date.now();
    const cooldownMs = Number(this.config?.runtime?.repairQuestCooldownMs || 120000);
    const last = Number(this.repairQuestCooldown.get(key) || 0);
    if (last > 0 && now - last < cooldownMs) return false;
    this.repairQuestCooldown.set(key, now);
    return true;
  }

  async runOneProviderTurn({
    provider,
    model,
    messages,
    sessionId,
    routedTools = [],
    contextPackInputs = {},
    workingMemory = null,
    toolsAllow = null,
    sideQuestMode = false
  }) {
    const originalUserMessage = getLastUserMessage(messages);
    const executionEnvelope = resolveExecutionEnvelope({
      provider,
      model,
      runtime: this.config.runtime
    });
    const behavior = classifyControllerBehavior({ provider, model, config: this.config });
    const executionProfile = mergeProfileWithBehavior(getExecutionProfile(provider, model), behavior, this.config);
    const localRuntimeTask = detectLocalRuntimeTask(messages);
    const attemptConfig = {
      ...this.config,
      model: {
        ...this.config.model,
        provider,
        model
      }
    };
    const runtimeProvider = buildProvider(attemptConfig);
    messages = [
      {
        role: 'system',
        content: buildControllerSystemMessage({
          config: this.config,
          executionProfile,
          behavior,
          provider,
          model,
          routedTools,
          ...contextPackInputs
        })
      },
      ...messages
    ];
    
    // Initialize trace early so memory recall can use it
    const trace = {
      provider,
      model,
      executionProfile: executionProfile.name,
      behaviorClass: behavior.classId,
      behaviorConfidence: behavior.confidence,
      behaviorSource: behavior.source
    };
    
    // R2: Hybrid Memory Retrieval (BM25 + embeddings + reranking)
    try {
      const recalled = await this.retriever.retrieve(originalUserMessage, {
        useHybrid: true,
        fallbackToBM25: true
      });
      trace.memoryRecall = {
        count: recalled.length,
        artifacts: recalled,
        method: 'hybrid_retriever'
      };
    } catch (e) {
      // Fallback to simple artifact recall if hybrid retriever fails
      try {
        const recalled = recallRelevantArtifacts({
          memoryStore: this.memoryStore,
          sessionId,
          currentGoal: originalUserMessage,
          limit: 5
        });
        trace.memoryRecall = { count: recalled.length, artifacts: recalled, method: 'artifact_fallback' };
      } catch (e2) {
        trace.memoryRecall = { error: e.message, fallbackError: e2.message, method: 'recall_failed' };
      }
    }
    const baseMaxIters = executionProfile.maxIters || this.config.runtime?.maxToolIterations || 4;
    const envelopeMaxIters = executionEnvelope.maxToolIterations || this.config.runtime?.maxToolIterations || 4;
    const maxIters = Math.max(
      1,
      Math.min(
        baseMaxIters,
        envelopeMaxIters
      )
    );
    const baseTurnBudgetMs = executionProfile.turnBudgetMs || this.config.runtime?.agentTurnTimeoutMs || 420000;
    const normalizedProvider = String(provider || '').toLowerCase();
    const isCloudController = ['nvidia', 'openrouter', 'openai', 'ollama-cloud'].includes(normalizedProvider) ||
      (normalizedProvider === 'ollama' && /cloud/.test(String(model || '').toLowerCase()));
    const turnBudgetMs = localRuntimeTask && !isCloudController
      ? Math.max(baseTurnBudgetMs, 180000)
      : baseTurnBudgetMs;
    const turnStartedAt = Date.now();
    const envelopeAllowlist = Array.isArray(executionEnvelope.toolAllowlist) ? executionEnvelope.toolAllowlist : null;
    const requestedAllowlist = Array.isArray(toolsAllow) ? toolsAllow.map((item) => String(item || '').trim()).filter(Boolean) : null;
    const turnToolAllowlist = envelopeAllowlist && requestedAllowlist
      ? envelopeAllowlist.filter((name) => requestedAllowlist.includes(name))
      : (requestedAllowlist || envelopeAllowlist);
    let finalText = '';
    let toolRuns = 0;
    const executedTools = [];
    let breakAfterToolLoop = false;
    // PHASE 3: Intervention trace array
    trace.intervention_trace = [];
    // Trace already initialized earlier for memory recall, now extend it
    trace.localRuntimeTask = localRuntimeTask;
    trace.executionEnvelope = executionEnvelope;
    trace.routedTools = routedTools;
    trace.iterations = [];
    trace.recoveryUsed = false;
    trace.permissionDenials = [];
    trace.toolStateTransitions = [];
    let forcedContinueCount = 0;
    const continuationRequirements = extractRequirements(originalUserMessage);
    const suppressAutonomousContinuation =
      continuationRequirements.asksExplanation ||
      continuationRequirements.asksReview ||
      continuationRequirements.asksDocumentDiscussion;

    for (let i = 0; i < maxIters; i += 1) {
      const elapsed = Date.now() - turnStartedAt;
      const remainingMs = turnBudgetMs - elapsed;
      if (remainingMs <= 0) {
        trace.timedOut = true;
        trace.timeoutMs = turnBudgetMs;
        break;
      }
      
      // INJECT WORKING MEMORY GHOST MESSAGE (before every model call)
      if (workingMemory) {
        // Check if compaction is needed
        if (messages.length > workingMemory.compactionThreshold * 2) {
          workingMemory.compactMiddle(messages);
        }
        
        // Build injection payload (PHASE 2: returns { staticPrefix, dynamicState, fullInjection, cacheHints })
        const recentMessages = messages.filter(m => m.role !== 'system' || !m.content.includes('WORKING MEMORY ANCHOR'));
        const injectionResult = workingMemory.buildInjection(recentMessages, Math.floor(messages.length / 2));
        
        // Use fullInjection for backward compatibility (can optimize to staticPrefix + dynamicState later)
        const injectionPayload = injectionResult.fullInjection || injectionResult;
        
        // Inject as system message (replaces any previous working memory injection)
        const existingWmIndex = messages.findIndex(m => m.role === 'system' && m.content.includes('WORKING MEMORY ANCHOR'));
        if (existingWmIndex >= 0) {
          messages[existingWmIndex] = { role: 'system', content: injectionPayload };
        } else {
          // Insert after the initial system message
          messages.splice(1, 0, { role: 'system', content: injectionPayload });
        }
      }
      
      let out;
      try {
        out = await runtimeProvider.chat({
          messages,
          tools: this.toolRuntime.toolSchemas({ allowedTools: turnToolAllowlist }),
          timeoutMs: remainingMs
        });
      } catch (err) {
        if (err.status === 429 || String(err.message).includes('429')) {
          logError('provider_quota_hit', { provider, model, error: err.message });
          const disabled = this.config.model?.routing?.disabledProviders || [];
          if (!disabled.includes(provider)) {
            this.config.model.routing = this.config.model.routing || {};
            this.config.model.routing.disabledProviders = [...disabled, provider];
            saveConfig(this.config);
            this.memoryStore.rememberFact(`model.${provider}.status`, 'quota_limit');
          }
        }
        throw err;
      }
      const normalizedContent = normalizeAssistantContent(out.content);

      // DRIFT DETECTION (after model responds)
      if (workingMemory && normalizedContent) {
        const driftAnalysis = workingMemory.detectDrift(normalizedContent);
        trace.driftAnalysis = driftAnalysis;
        
        if (driftAnalysis.driftDetected && driftAnalysis.confidence > 0.5) {
          const correctionPrompt = workingMemory.generateDriftCorrection(driftAnalysis);
          messages.push({
            role: 'system',
            content: correctionPrompt
          });
          // PHASE 3: Log intervention
          trace.intervention_trace.push({
            type: 'drift_correction',
            at: new Date().toISOString(),
            confidence: driftAnalysis.confidence,
            forbiddenMatches: driftAnalysis.forbiddenMatches
          });
          logInfo('working_memory_drift_corrected', {
            sessionId,
            confidence: driftAnalysis.confidence,
            forbiddenMatches: driftAnalysis.forbiddenMatches
          });
        }
      }
      
      const iter = {
        step: i + 1,
        toolCalls: [],
        assistantText: normalizedContent || ''
      };
      if (normalizedContent || (out.toolCalls && out.toolCalls.length > 0)) {
        finalText = normalizedContent;
        const assistantMessage = {
          role: 'assistant',
          content: normalizedContent || ''
        };
        if (out.toolCalls && out.toolCalls.length > 0) {
          assistantMessage.tool_calls = out.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: tc.arguments ?? '{}'
            }
          }));
        }
        messages.push(assistantMessage);
      }

      if (!out.toolCalls || out.toolCalls.length === 0) {
        trace.iterations.push(iter);
        const hasSomeAnswerOrEvidence =
          Boolean(String(normalizedContent || finalText || '').trim()) ||
          (Array.isArray(executedTools) && executedTools.length > 0);
        if (suppressAutonomousContinuation && hasSomeAnswerOrEvidence) {
          break;
        }
        const forceContinue = shouldForceContinuation({
          assistantText: normalizedContent || finalText,
          toolCalls: out.toolCalls,
          toolRuns,
          iteration: i + 1,
          maxIters,
          priorForcedCount: forcedContinueCount,
          taskGoal: originalUserMessage
        });
        // Shadow scoring — log only, no behavior change
        try {
          const shadowScore = scoreProofQuality({
            assistantText: normalizedContent || finalText,
            toolRuns: executedTools || [],
            taskGoal: originalUserMessage
          });
          trace.shadowProofScore = shadowScore;
        } catch (_) { /* shadow scoring is non-critical */ }
        if (forceContinue) {
          forcedContinueCount += 1;
          messages.push({
            role: 'system',
            content: continuationDirective('planner_without_proof')
          });
          // PHASE 3: Log intervention
          trace.intervention_trace.push({
            type: 'continuation',
            subtype: 'planner_without_proof',
            at: new Date().toISOString(),
            reason: 'Model stopped without proof-backed completion'
          });
          continue;
        }

        // CHECK 1: Completion Checklist - Are all decomposed steps complete?
        // This is the PRIMARY check - if we have explicit steps, they MUST all be done
        const checklistProgress = this.completionChecklist.getProgress();
        if (checklistProgress.total > 0 && checklistProgress.percent < 100) {
          const remaining = this.completionChecklist.getRemaining();
          messages.push({
            role: 'system',
            content: [
              `Task incomplete: ${checklistProgress.complete}/${checklistProgress.total} steps done (${checklistProgress.percent}%).`,
              `Remaining steps: ${remaining.map(r => r.description).join('; ')}`,
              'Continue with the next pending step. Do not claim completion until all steps are verified.'
            ].join('\n')
          });
          // PHASE 3: Log intervention
          trace.intervention_trace.push({
            type: 'checklist_enforcement',
            at: new Date().toISOString(),
            progress: checklistProgress,
            remainingCount: remaining.length
          });
          continue;
        }

        // CHECK 2: PREVENTIVE - Is the original task actually complete?
        // This runs BEFORE deciding to stop, preventing premature "I feel done" stalls
        try {
          const isActuallyDone = isProofBackedDone({
            text: normalizedContent || finalText,
            toolRuns: executedTools || [],
            requireProofForDone: true,
            taskGoal: originalUserMessage
          });
          
          if (!isActuallyDone && executedTools && executedTools.length > 0) {
            // Task NOT complete but model wants to stop → inject preventive continuation
            messages.push({
              role: 'system',
              content: [
                'Preventive continuation: The original task is not yet complete.',
                `Goal: ${originalUserMessage}`,
                'You have executed tools but have not verified full task completion.',
                'Continue with remaining steps. Do not generate a completion summary yet.',
                'Only claim done when you have proof-backed evidence that the full goal is satisfied.'
              ].join('\n')
            });
            // PHASE 3: Log intervention
            trace.intervention_trace.push({
              type: 'preventive_continuation',
              at: new Date().toISOString(),
              reason: 'Task incomplete but model attempted to stop',
              toolRuns: executedTools.length
            });
            continue;
          }
        } catch (_) { /* non-critical, fall through to other checks */ }

        // Check if we should auto-continue based on self-monitoring (reactive)
        if (this.selfMonitor.shouldAutoContinue(sessionId, normalizedContent || finalText, executedTools || [])) {
          const autoContinuePrompt = this.selfMonitor.generateContinuationPrompt(
            sessionId,
            normalizedContent || finalText,
            executedTools || []
          );
          messages.push({
            role: 'system',
            content: autoContinuePrompt
          });
          continue;
        }
        break;
      }

      for (const tc of out.toolCalls) {
        trace.toolStateTransitions.push({
          at: new Date().toISOString(),
          tool: tc.name,
          state: 'scheduled',
          step: i + 1
        });
        const toolRemainingMs = turnBudgetMs - (Date.now() - turnStartedAt);
        if (toolRemainingMs <= 0) {
          trace.timedOut = true;
          trace.timeoutMs = turnBudgetMs;
          break;
        }
        const args = parseToolArgs(tc.arguments);

        let result;
        try {
          trace.toolStateTransitions.push({
            at: new Date().toISOString(),
            tool: tc.name,
            state: 'executing',
            step: i + 1
          });
          result = await this.toolRuntime.run(tc.name, args, {
            sessionId,
            deadlineAt: turnStartedAt + turnBudgetMs,
            allowedTools: turnToolAllowlist,
            policyMode: this.config?.runtime?.autonomyPolicy?.mode || 'execute',
            provider,
            model
          });
        } catch (error) {
          result = { ok: false, error: String(error.message || error) };
        }
        trace.toolStateTransitions.push({
          at: new Date().toISOString(),
          tool: tc.name,
          state: result?.ok ? 'success' : 'error',
          step: i + 1,
          reason: result?.error || ''
        });

        // PHASE 2: Spawn repair side-quest after repeated failures (throttled, never recursive).
        if (
          toolRunFailed(result) &&
          this.shouldSpawnRepairQuest({
            sessionId,
            toolName: tc.name,
            sideQuestMode,
            errorCode: result?.error
          }) &&
          executedTools.filter((t) => t.name === tc.name && toolRunFailed(t.result)).length >= 1
        ) {
          try {
            const priorFailures = executedTools.filter((t) => t.name === tc.name && toolRunFailed(t.result));
            const { questId } = await this.sideQuestManager.forkQuest(
              sessionId,
              'repair',
              `Tool ${tc.name} failed ${priorFailures.length + 1} times. Last error: ${result.error}. Diagnose root cause and propose a fix or workaround.`,
              { timeoutMs: 2 * 60 * 1000, toolsAllow: ['file_read', 'exec', 'shell'] }
            );
            // Do not block the active user turn on repair investigation.
            void this.sideQuestManager.executeQuest(questId)
              .then(async (questResult) => {
                if (questResult?.status === 'completed' && questResult.summary) {
                  await this.sideQuestManager.mergeQuest(questId);
                  logInfo('side_quest_repair_completed', { questId, tool: tc.name });
                }
              })
              .catch((questError) => {
                logError('side_quest_repair_async_failed', { error: String(questError?.message || questError), questId });
              });
            logInfo('side_quest_repair_spawned', { questId, tool: tc.name, failures: priorFailures.length + 1 });
          } catch (questError) {
            logError('side_quest_repair_failed', { error: String(questError.message || questError) });
          }
        }
        
        // PHASE 3: Record tool execution for predictive failure analysis
    if (this.predictiveFailure && result) {
      if (!result.ok) {
        this.predictiveFailure.recordError({
          type: `${tc.name}_failure`,
          message: result.error || 'tool_failed',
          context: { tool: tc.name, args, sessionId }
        });
      }
      // Record response time for performance tracking
      const toolDurationMs = Date.now() - turnStartedAt;
      this.predictiveFailure.recordResponseTime(toolDurationMs);
    }
    
    // PHASE 3: Check predictive failures before next expensive operation
    if (this.predictiveFailure && (i + 1) < maxIters) {
      const predictions = this.predictiveFailure.getCurrentPredictions();
      const criticalPredictions = predictions.filter(p => p.severity === 'critical');
      if (criticalPredictions.length > 0) {
        trace.predictiveWarnings = criticalPredictions;
        const warningMsg = criticalPredictions.map(p => 
          `⚠️ Predictive Warning: ${p.type} (confidence: ${p.confidence.toFixed(2)}) - ${p.recommendation}`
        ).join('\n');
        messages.push({
          role: 'system',
          content: `**Predictive Failure Detection**\n\n${warningMsg}\n\nConsider narrowing scope or switching to lighter operations.`
        });
        logInfo('predictive_failure_warning', { predictions: criticalPredictions });
      }
    }
    
    if (toolRunFailed(result) && ['shell_blocked', 'owner_mode_restricted', 'tool_circuit_open', 'shell_disabled', 'unsafe_xdotool_command'].includes(result?.error)) {
          trace.permissionDenials.push({
            tool: tc.name,
            reason: result.error,
            detail: result.stderr || result.error
          });
          if (result?.error === 'tool_circuit_open') {
            breakAfterToolLoop = true;
          }
        }
        toolRuns += 1;
        executedTools.push({
          name: tc.name,
          args,
          result
        });

        // Mark step as complete if tool succeeded
        if (result?.ok && this.completionChecklist.initialized) {
          const remaining = this.completionChecklist.getRemaining();
          if (remaining.length > 0) {
            // Match tool action to step description (simple heuristic)
            const stepId = `step-${remaining[0].id.split('-')[1]}`;
            this.completionChecklist.markComplete(stepId, { tool: tc.name, args });
            logInfo('step_completed', { stepId, tool: tc.name, progress: this.completionChecklist.getProgress() });
          }
        }
        iter.toolCalls.push({
          name: tc.name,
          args,
          result: summarizeResult(result)
        });

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(compactToolResult(result))
        });
      }
      trace.iterations.push(iter);
      if (trace.timedOut || breakAfterToolLoop) break;
    }

    if (!finalText && toolRuns > 0) {
      const recoveryRequirements = extractRequirements(originalUserMessage);
      const shouldDirectSynthesize =
        recoveryRequirements.asksExplanation ||
        recoveryRequirements.asksReview ||
        recoveryRequirements.asksDocumentDiscussion;

      if (!shouldDirectSynthesize) {
        try {
          trace.recoveryUsed = true;
          const remainingMs = turnBudgetMs - (Date.now() - turnStartedAt);
          if (remainingMs <= 0) {
            trace.timedOut = true;
            trace.timeoutMs = turnBudgetMs;
            throw new Error('turn_deadline_exceeded');
          }
          const recoveryMessages = [
            ...messages,
            {
              role: 'system',
              content: recoveryDirective()
            }
          ];
          const recovery = await runtimeProvider.chat({ messages: recoveryMessages, tools: [], timeoutMs: remainingMs });
          if (recovery?.content) {
            const normalizedRecoveryContent = normalizeAssistantContent(recovery.content);
            if (normalizedRecoveryContent) {
              finalText = normalizedRecoveryContent;
            }
          }
        } catch {
          // ignore and fallback to synthesized summary below
        }
      }
    }

    if (!finalText && trace.timedOut) {
      finalText = [
        `Turn timed out after ${trace.timeoutMs}ms before the model produced a final response.`,
        toolRuns > 0
          ? `Tool actions executed so far: ${toolRuns}. Open execution trace for the latest results.`
          : 'No successful tool output was recorded before timeout.',
        'Retry with a narrower prompt, fewer steps, or a faster model.'
      ].join('\n');
    }

    // Shadow: proof-scorer validation at isProofBackedDone decision point
    if (finalText && toolRuns > 0) {
      try {
        const proofScore = scoreProofQuality({
          assistantText: finalText,
          toolRuns: executedTools || [],
          taskGoal: originalUserMessage || ''
        });
        trace.proofScorer = { ...proofScore, decisionPoint: 'isProofBackedDone' };
        
        // Score confidence for completion claims
        const confidenceScore = scoreConfidence('completion', { proofScore, executedTools, finalText });
        trace.confidenceScorer = confidenceScore;
        
        // PHASE 2: Spawn verification side-quest if proof score is low
        if (proofScore.totalScore < 0.5 && toolRuns >= 2) {
          try {
            const { questId } = await this.sideQuestManager.forkQuest(
              sessionId,
              'proof_check',
              `Verify completion claims. Proof score was ${proofScore.totalScore.toFixed(2)} (threshold 0.6). Review tool results and final answer. Confirm if task is actually complete or what's missing.`,
              { timeoutMs: 3 * 60 * 1000, modelOverride: 'ollama-cloud/qwen3.5:397b-cloud' }
            );
            const questResult = await this.sideQuestManager.executeQuest(questId);
            if (questResult.status === 'completed' && questResult.summary) {
              await this.sideQuestManager.mergeQuest(questId);
              finalText = finalText + '\n\n**Verification Result:** ' + questResult.summary;
              logInfo('side_quest_verification_spawned', { questId, proofScore: proofScore.totalScore });
            }
          } catch (questError) {
            logError('side_quest_verification_failed', { error: String(questError.message || questError) });
          }
        }
      } catch (e) {
        trace.proofScorer = { error: e.message, decisionPoint: 'isProofBackedDone' };
      }
    }

    if (
      finalText &&
      behavior?.tuning?.requireProofForDone &&
      !isProofBackedDone({ text: finalText, toolRuns, requireProofForDone: true, taskGoal: originalUserMessage || '' }) &&
      /mission_status:\s*done/i.test(String(finalText))
    ) {
      finalText = [
        'Completion claim was rejected by execution contract: insufficient proof-backed tool evidence in this turn.',
        'MISSION_STATUS: CONTINUE'
      ].join('\n');
    }

    if (!finalText && toolRuns > 0) {
      finalText = synthesizeToolOnlyAnswer({
        userMessage: originalUserMessage,
        executedTools,
        toolRuns
      });
      if (!finalText) {
        const recent = executedTools.slice(-4).map((t, idx) =>
          `${idx + 1}. ${t.name}(${JSON.stringify(t.args)}) => ${JSON.stringify(t.result)}`
        );
        finalText = [
          `Tool actions executed (${toolRuns}) but model returned no final message.`,
          'Executed actions:',
          ...recent,
          'Next step: continue from the current page and extract concrete results before claiming completion.'
        ].join('\n');
      }
    }
    finalText = normalizeRecoveredFinalText({
      finalText,
      userMessage: originalUserMessage,
      executedTools,
      toolRuns
    }) || 'No response generated.';
    trace.answerAssessment = assessFinalAnswerQuality({
      finalText,
      userMessage: originalUserMessage,
      executedTools,
      toolRuns
    });
    trace.pivotHints = buildPivotHints({
      executedTools,
      permissionDenials: trace.permissionDenials,
      timedOut: Boolean(trace.timedOut)
    });
    trace.turnSummary = {
      toolRuns,
      iterationCount: trace.iterations.length,
      permissionDenials: trace.permissionDenials.length,
      routedTools: routedTools.map((item) => item.tool),
      answerShape: trace.answerAssessment?.shape || 'unknown',
      answerScore: trace.answerAssessment?.score || 0
    };
    try {
      const verification = await this.independentVerifier.verify({
        userMessage: originalUserMessage,
        assistantReply: finalText,
        toolRuns: executedTools,
        context: {
          sessionId,
          toolRuns: executedTools
        }
      });
      trace.independentVerification = verification;
      const severeIssues = (verification.issues || []).filter((issue) => ['high', 'critical'].includes(String(issue?.severity || '').toLowerCase()));
      if (!verification.verified && severeIssues.length > 0) {
        const criticalIssue = severeIssues.find(i => String(i?.severity || '').toLowerCase() === 'critical');
        if (criticalIssue) {
          // Critical verification failure: trigger revision cycle instead of just warning
          logInfo('critical_verification_failure', { issue: criticalIssue.issue, sessionId });
          messages.push({
            role: 'system',
            content: `Critical verification failure: ${criticalIssue.issue}. Review your response and fix the issue before delivering. Ensure tool results support your claims and no safety/compliance issues exist.`
          });
          // Retry one more provider turn with revision instruction
          const revisionRun = await this.runOneProviderTurn({
            provider,
            model,
            messages,
            sessionId,
            routedTools,
            contextPackInputs,
            workingMemory,
            toolsAllow,
            sideQuestMode: true
          });
          if (revisionRun.finalText && revisionRun.finalText !== 'No response generated.') finalText = revisionRun.finalText;
          trace.independentVerificationPostRevision = await this.independentVerifier.verify({
            userMessage: originalUserMessage,
            assistantReply: finalText,
            toolRuns: revisionRun.trace?.iterations?.flatMap(iter => iter?.toolCalls || []) || [],
            context: { sessionId }
          });
        } else {
          // High severity but not critical: add warning but continue
          trace.finalization = {
            ...(trace.finalization || {}),
            state: 'partial'
          };
          finalText = `${finalText}\n\nVerification warning: ${String(severeIssues[0]?.issue || 'post-flight verification failed')}.`;
        }
      }
    } catch (error) {
      trace.independentVerification = {
        verified: false,
        error: String(error.message || error)
      };
    }
    this.lastRuntime = { provider, model };
    this.config.model.providerModels = this.config.model.providerModels || {};
    this.config.model.providerModels[provider] = model;
    const learned = learnControllerBehavior({ provider, model, trace });
    if (learned && this.memoryStore?.upsertControllerBehavior) {
      this.memoryStore.upsertControllerBehavior({
        provider: learned.provider,
        model: learned.model,
        classId: learned.classId,
        sampleCount: learned.sampleCount,
        reasons: learned.reasons
      });
    }

    // R4: POST-FLIGHT COUNCIL - Proof quality validation
    if (this.config.runtime?.councilEnabled !== false && finalText) {
      try {
        const proofResult = await this.proofScorerCouncil.postFlight({
          response: finalText,
          toolRuns: executedTools,
          message: originalUserMessage,
          sessionId
        });

        trace.councilProofScore = proofResult.proofScore;

        if (proofResult.requiresRevision && !sideQuestMode) {
          const shouldSkipRevision = shouldSkipCouncilRevisionForMildProofDeficit({
            proofResult,
            minProofScore: this.config.runtime?.minProofScore ?? 0.7,
            executedTools,
            independentVerification: trace?.independentVerification
          });
          if (shouldSkipRevision) {
            logInfo('council_postflight_revision_skipped_mild_deficit', {
              sessionId,
              reason: proofResult.reason,
              proofScore: Number(proofResult.proofScore?.score ?? proofResult.proofScore?.overallScore ?? 0),
              toolCalls: Array.isArray(executedTools) ? executedTools.length : 0
            });
            trace.councilProofRevision = {
              attempted: false,
              skipped: true,
              skipReason: 'mild_proof_deficit_with_evidence',
              reason: proofResult.reason,
              proofScore: Number(proofResult.proofScore?.score ?? proofResult.proofScore?.overallScore ?? 0)
            };
          } else {
            logInfo('council_postflight_revision_required', {
              sessionId,
              reason: proofResult.reason,
              proofScore: Number(proofResult.proofScore?.score ?? proofResult.proofScore?.overallScore ?? 0)
            });

            // Add revision prompt and continue iteration
            messages.push({
              role: 'system',
              content: `Proof quality insufficient: ${proofResult.reason}. Please provide stronger evidence for your claims before claiming completion.`
            });

            const revisionRun = await this.runOneProviderTurn({
              provider,
              model,
              messages,
              sessionId,
              routedTools,
              contextPackInputs,
              workingMemory,
              toolsAllow,
              sideQuestMode: true
            });
            trace.councilProofRevision = {
              attempted: true,
              reason: proofResult.reason,
              proofScore: Number(proofResult.proofScore?.score ?? proofResult.proofScore?.overallScore ?? 0)
            };
            trace.councilProofRevisionTrace = revisionRun.trace;
            if (revisionRun.finalText && revisionRun.finalText !== 'No response generated.') {
              finalText = revisionRun.finalText;
            }
          }
        }
      } catch (e) {
        logError('council_postflight_failed', { error: String(e.message || e) });
        trace.councilError = e.message;
      }
    }

    return { finalText, trace };
  }

  async chat({
    message,
    sessionId = crypto.randomUUID(),
    modelOverride = null,
    toolsAllow = null,
    sideQuestMode = false
  }) {
    // R9: Sleep Cycle Awareness - check if waking from sleep
    if (this.sleepCycle) {
      const sleepState = this.sleepCycle.getState();
      if (sleepState.state === 'sleeping') {
        await this.sleepCycle.wake('message');
        logInfo('agent_woken_from_sleep', { sessionId, sleepDurationMs: sleepState.idleMs });
      } else {
        this.sleepCycle.touchActivity();
      }
    }

    const recentMessages = this.memoryStore.getMessagesForContext
      ? this.memoryStore.getMessagesForContext(sessionId, 16)
      : [];

    // R2/R10: FastPathRouter handles deterministic and short-circuit replies
    const fastPathReply = await this.fastPathRouter.route({
      message,
      sessionId,
      recentMessages,
      modelForBudget: this.getCurrentModel()
    });
    if (fastPathReply) return fastPathReply;

    const deterministicRepoReply = await this.tryDeterministicRepoInspection({ message, sessionId });
    if (deterministicRepoReply) {
      return deterministicRepoReply;
    }

    const skills = loadSkills();
    let routedTools = inferRoutedTools(message);

    // R4: PRE-FLIGHT COUNCIL - Safety and ODD validation
    if (this.config.runtime?.councilEnabled !== false) {
      const currentModel = this.getCurrentModel();
      const provider = currentModel.activeProvider || currentModel.provider || this.config.model.provider;
      const model = currentModel.activeModel || currentModel.model || this.config.model.model;
      const envelope = resolveExecutionEnvelope({
        provider,
        model,
        runtime: this.config.runtime
      });
      const councilResult = await this.safetyCouncil.preFlight({
        message,
        sessionId,
        context: {
          provider,
          model,
          executionTier: envelope.tier,
          proposedTools: routedTools.map((item) => item.tool)
        }
      });

      if (!councilResult.passed) {
        logInfo('council_preflight_blocked', {
          sessionId,
          reason: councilResult.blockedReason,
          checks: councilResult.checks
        });

        return {
          sessionId,
          reply: `Request blocked by Safety Council: ${councilResult.blockedReason}`,
          trace: { councilBlocked: true, checks: councilResult.checks }
        };
      }
    }

    this.memoryStore.addMessage(sessionId, 'user', message);
    
    // R1: Audit mission start
    try {
      logEvent('state_change', {
        action: 'mission_start',
        message: clipText(message, 150)
      }, sessionId);
    } catch (e) { console.error('[audit_log_failed]', e); }

    // Start timing for telemetry
    const startTime = Date.now();
    const latency = {
      path: 'normal',
      awarenessMs: 0,
      providerMs: 0,
      continuationMs: 0,
      persistenceMs: 0,
      totalMs: 0
    };
    const latencyBudgetMs = {
      deterministicFastTotal: 450,
      routerFastTotal: 3500,
      awarenessStage: 150,
      providerStage: 22000,
      total: 35000
    };

    // Start self-monitoring for automatic continuation
    this.selfMonitor.startMonitoring(sessionId, message);
    
    // PHASE 3: Pre-flight predictive failure check
    const preflightPredictions = this.predictiveFailure?.getCurrentPredictions() || [];
    const criticalPreflight = preflightPredictions.filter(p => p.severity === 'critical');
    if (criticalPreflight.length > 0) {
      logInfo('predictive_preflight_critical', { predictions: criticalPreflight });
      // Add warning to system message but don't block execution
    }
    
    // Decompose task into explicit steps using taskDecomposer (more sophisticated than detectSteps)
    this.completionChecklist.reset();
    const decomposition = this.taskDecomposer.decomposeTask(message);
    if (decomposition.decomposed && decomposition.steps.length > 0) {
      this.completionChecklist.initFromSteps(decomposition.steps);
      logInfo('task_decomposed', { steps: decomposition.steps, original: decomposition.original });
    } else {
      // Fallback to simple detectSteps if decomposition found no patterns
      const detectedSteps = detectSteps(message);
      if (detectedSteps) {
        this.completionChecklist.initFromSteps(detectedSteps);
        logInfo('task_steps_detected', { steps: detectedSteps });
      }
    }

    // Initialize Working Memory Anchor (ghost message injection for weak models)
    const workspaceRoot = this.config?.runtime?.workspaceRoot || process.cwd();
    const workingMemory = getWorkingMemory({
      sessionId,
      workspaceRoot,
      userTask: message,
      agentPlan: decomposition,
      contract: {
        successCriteria: decomposition.decomposed ? `Complete all ${decomposition.steps.length} steps` : 'Task completed as specified',
        requiredOutputs: [],
        forbiddenDrift: []  // Could be inferred from task type
      }
    });
    if (workingMemory) {
      logInfo('working_memory_initialized', { sessionId, hasPlan: Boolean(decomposition.decomposed) });
    }

    // Initialize FastAwarenessRouter (MWS - task-meta fast path)
    const fastAwarenessConfig = this.config?.fastAwarenessRouter || {};
    const fastAwarenessRouter = createFastAwarenessRouter(fastAwarenessConfig, workingMemory);

    const modelForBudget = this.getCurrentModel();
    const sessionEnvelope = resolveExecutionEnvelope({
      provider: modelForBudget.activeProvider || modelForBudget.provider,
      model: modelForBudget.activeModel || modelForBudget.model,
      runtime: this.config.runtime
    });
    const compactController = Boolean(sessionEnvelope.verySmallModel);
    const strategyHints = this.memoryStore.retrieveStrategyHintsSmart
      ? this.memoryStore.retrieveStrategyHintsSmart(message, compactController ? 3 : 6)
      : this.memoryStore.retrieveStrategyHints(message, compactController ? 2 : 4);
    const strategyPrompt = strategyHints.length
      ? strategyHints
        .map((s, idx) => `${idx + 1}. ${s.success ? 'SUCCESS' : 'FAIL'} | ${clipText(s.strategy, compactController ? 80 : 180)} | ${clipText(s.evidence, compactController ? 120 : 220)}`)
        .join('\n')
      : '';

    const facts = this.memoryStore.retrieveFacts(message, compactController ? 3 : 5)
      .map((f) => `${f.key}: ${clipText(f.value, compactController ? 80 : 160)}`)
      .join('\n');
    
    // Use Unified Hybrid Retriever instead of simple searchKnowledge (R2)
    let knowledgeHits = '';
    if (!compactController && this.retriever) {
      try {
        const hybridResults = await this.retriever.retrieve(message, {
          useHybrid: !compactController,
          fallbackToBM25: true
        });
        knowledgeHits = hybridResults
          .map((k, idx) => `${idx + 1}. [${k.metadata?.type || 'memory'}] ${clipText(k.text, 180)}`)
          .join('\n');
        logInfo('hybrid_retrieval_applied', { count: hybridResults.length });
      } catch (err) {
        logError('hybrid_retrieval_failed', { error: String(err.message || err) });
      }
    }
    
    const skillPrompt = buildSkillPrompt(
      skills,
      compactController
        ? { maxSkills: 1, maxCharsPerSkill: 500 }
        : { maxSkills: 4, maxCharsPerSkill: 2000 }
    );
    const historyLimit = Number.isFinite(sessionEnvelope.maxHistoryMessages) ? Number(sessionEnvelope.maxHistoryMessages) : 1200;
    const rawHistory = this.memoryStore.getMessagesForContext(sessionId, historyLimit)
      .map((m) => ({ id: m.id, role: m.role, content: m.content }));
    const triggerInfo = buildContextBudgetInfo({
      config: this.config,
      provider: modelForBudget.activeProvider || modelForBudget.provider,
      model: modelForBudget.activeModel || modelForBudget.model,
      messages: rawHistory
    });

    let history = rawHistory.map((m) => ({ role: m.role, content: m.content }));
    let compactionMeta = null;
    
    // ContextPressure check before building messages
    const pressureCheck = this.contextPressure.getReport(history, {
      maxTokens: triggerInfo.contextLimit
    });
    if (pressureCheck.status !== 'ok') {
      logInfo('context_pressure', pressureCheck);
      if (pressureCheck.status === 'critical' || pressureCheck.status === 'warning') {
        const compacted = this.contextPressure.compactMessages(history, {
          aggressive: pressureCheck.status === 'critical'
        });
        history = compacted;
        logInfo('context_compacted', { status: pressureCheck.status, messagesCount: history.length });
      }
    }
    
    if (this.config.runtime?.contextCompactionEnabled !== false && triggerInfo.overTrigger) {
      const targetTokens = Math.floor(triggerInfo.contextLimit * Number(this.config.runtime?.contextCompactTargetPct || 0.4));
      const compacted = compactSessionMessages({
        messages: rawHistory,
        targetTokens,
        protectRecentTurns: Number(this.config.runtime?.contextProtectRecentTurns || 8)
      });
      history = compacted.compactedMessages;
      if (compacted.cutoffMessageId > 0) {
        const currentModel = `${modelForBudget.activeProvider || modelForBudget.provider}/${modelForBudget.activeModel || modelForBudget.model}`;
        this.memoryStore.recordSessionCompaction({
          sessionId,
          cutoffMessageId: compacted.cutoffMessageId,
          model: currentModel,
          ctxLimit: triggerInfo.contextLimit,
          preTokens: compacted.preTokens,
          postTokens: compacted.postTokens,
          summary: compacted.summary
        });
        this.memoryStore.addMemoryArtifacts(sessionId, compacted.artifacts);
        this.memoryStore.addMessage(sessionId, 'system', compacted.compactedMessages[0]?.content || 'SESSION COMPACTION CHECKPOINT');
      }
      compactionMeta = {
        applied: true,
        preTokens: compacted.preTokens,
        postTokens: compacted.postTokens,
        cutoffMessageId: compacted.cutoffMessageId
      };
    }
    const hardLimitTokens = Math.floor(triggerInfo.contextLimit * Number(this.config.runtime?.contextHardFailPct || 0.9));
    const hardLimited = trimMessagesToTokenBudget({
      messages: history,
      maxTokens: hardLimitTokens,
      preserveFirstSystem: true,
      minRecentMessages: Number(this.config.runtime?.contextProtectRecentTurns || 8) * 2
    });
    if (hardLimited.postTokens < estimateMessagesTokens(history)) {
      history = hardLimited.messages;
      compactionMeta = {
        ...(compactionMeta || {}),
        hardLimited: true,
        hardLimitTokens,
        hardLimitPreTokens: hardLimited.preTokens,
        hardLimitPostTokens: hardLimited.postTokens,
        hardLimitDroppedCount: hardLimited.droppedCount
      };
      logInfo('context_hard_limited', {
        sessionId,
        provider: modelForBudget.activeProvider || modelForBudget.provider,
        model: modelForBudget.activeModel || modelForBudget.model,
        hardLimitTokens,
        preTokens: hardLimited.preTokens,
        postTokens: hardLimited.postTokens,
        droppedCount: hardLimited.droppedCount
      });
    }
    const contextPackInputs = {
      routedTools,
      facts,
      knowledgeHits,
      strategyPrompt,
      skillPrompt,
      executionEnvelope: sessionEnvelope
    };

    // Load hierarchical policies (session > project > global AGENTS.md)
    const policyResult = await this.policyLoader.loadPolicies(sessionId);
    const policySystemMessage = buildSystemMessage(policyResult.policies, {
      taskGoal: null,  // Could be added if needed
      currentSubplan: null,
      constraints: []
    });

    let finalText = '';
    let trace = null;
    const attempts = this.buildProviderAttempts();
    let effectiveAttempts = attempts;
    if (modelOverride) {
      const text = String(modelOverride || '').trim();
      if (text.includes('/')) {
        const [providerPart, ...modelParts] = text.split('/');
        const forcedProvider = String(providerPart || '').trim();
        const forcedModel = modelParts.join('/').trim();
        if (forcedProvider && forcedModel) {
          effectiveAttempts = [{ provider: forcedProvider, model: forcedModel }];
        }
      } else {
        effectiveAttempts = [{ provider: this.config.model.provider, model: text }];
      }
    }
    const failures = [];
    const routeTelemetry = {};
    const roleMode = classifyRoleMode({ message });
    const roleModeInstruction = modeDirective(roleMode);

    // R6: Role-Model Registry - check if current model tier meets role requirements
    const roleConfig = this.roleModelResolver.resolve(roleMode.mode);
    const currentModelRef = `${effectiveAttempts[0]?.provider || this.config.model.provider}/${effectiveAttempts[0]?.model || this.config.model.model}`;
    const roleCheck = this.roleModelResolver.isAllowed(roleMode.mode, currentModelRef);
    routeTelemetry.roleModel = {
      role: roleMode.mode,
      minTier: roleConfig.minTier,
      currentModel: currentModelRef,
      allowed: roleCheck.allowed,
      reason: roleCheck.reason
    };
    if (!roleCheck.allowed) {
      // Auto-escalate: find a recommended model that meets the tier requirement
      // Note: This check is ALWAYS performed regardless of forcePrimaryProvider setting
      // to ensure weak models cannot be used for tasks requiring higher tiers
      const recommended = roleConfig.recommended || [];
      for (const recModel of recommended) {
        const [recProvider, ...recModelParts] = recModel.split('/');
        const recModelName = recModelParts.join('/');
        if (recProvider && recModelName) {
          const recRef = `${recProvider}/${recModelName}`;
          const recCheck = this.roleModelResolver.isAllowed(roleMode.mode, recRef);
          const routeReadiness = this.canAttemptProviderRoute(recProvider, recModelName);
          if (recCheck.allowed && routeReadiness.ok) {
            logInfo('role_model_escalation', {
              role: roleMode.mode,
              from: currentModelRef,
              to: recRef,
              minTier: roleConfig.minTier
            });
            routeTelemetry.roleModel.escalated = true;
            routeTelemetry.roleModel.escalatedTo = recRef;
            // Prepend the recommended model as first attempt
            effectiveAttempts = [
              { provider: recProvider, model: routeReadiness.model },
              ...effectiveAttempts.filter((attempt) => !(attempt.provider === recProvider && attempt.model === routeReadiness.model))
            ];
            break;
          }
        }
      }
    }
    routeTelemetry.routePolicy = {
      preferredProvider: this.config.model.provider,
      preferredModel: this.config.model.model,
      forcePrimaryProvider: this.config.model.routing?.forcePrimaryProvider === true,
      fallbackEnabled: this.config.model.routing?.fallbackEnabled !== false,
      effectiveAttempts: effectiveAttempts.map((attempt) => ({
        provider: attempt.provider,
        model: attempt.model
      }))
    };

    // FastAwarenessRouter: classify message and potentially short-circuit
    const awarenessStartedAt = Date.now();
    const fastAwarenessResult = fastAwarenessRouter.classify(message);
    latency.awarenessMs = Date.now() - awarenessStartedAt;

    // Deterministic ultra-fast greeting path: skip provider call entirely.
    if (fastAwarenessResult?.category === 'greeting' || fastAwarenessResult?.category === 'light-chat') {
      const rawHistoryUserTurns = rawHistory.filter((m) => m.role === 'user').length;
      const lowIntentScore = scoreDeterministicFastTurn(message);
      const classifierConf = Number(fastAwarenessResult?.confidence || 0);
      const canFastReturn = fastAwarenessResult.category === 'greeting'
        ? true
        : (rawHistoryUserTurns <= 4 && classifierConf >= 0.78) || lowIntentScore >= 0.88;
      const quick = !canFastReturn
        ? ''
        : (fastAwarenessResult.category === 'greeting'
            ? deterministicGreetingReply(message)
            : deterministicLightChatReply());
      if (quick) {
        finalText = quick;
        trace = {
          ...routeTelemetry,
            roleMode: roleMode.mode,
            roleModeReason: roleMode.reason,
            fastPathUsed: true,
            fastPathCategory: fastAwarenessResult.category,
            fastPathDeterministic: true,
            fastPathLatency: Date.now() - startTime,
            fastPathSignals: {
              classifierConfidence: classifierConf,
              lowIntentScore,
              userTurns: rawHistoryUserTurns
            },
            iterations: [],
            failures: [],
            turnSummary: {
            toolRuns: 0,
            iterationCount: 0,
            permissionDenials: 0,
            routedTools: [],
            answerShape: 'concise',
            answerScore: 100
          }
        };
        latency.path = 'deterministic-fast';
        fastAwarenessRouter.writeTelemetry({
          category: fastAwarenessResult.category,
          strategy: fastAwarenessResult.strategy,
          confidence: fastAwarenessResult.confidence,
          latency: Date.now() - startTime,
          shouldShortCircuit: true
        });
        fastAwarenessRouter.recordOutcome(fastAwarenessResult.category, true);
      }
    }

    // Phase 2: Use recommended tools from router to optimize tool routing
    if (fastAwarenessResult.recommendedTools && fastAwarenessResult.recommendedTools.length > 0) {
      const recommendedTools = [...new Set(fastAwarenessResult.recommendedTools.map((tool) => String(tool || '').trim()).filter(Boolean))];
      if (routedTools.length > 0) {
        routedTools = routedTools.filter((item) => recommendedTools.includes(item.tool));
      } else {
        routedTools = recommendedTools.map((tool) => ({ tool, score: 1 }));
      }
      if (Array.isArray(toolsAllow) && toolsAllow.length > 0) {
        toolsAllow = toolsAllow.filter((tool) => recommendedTools.includes(tool));
      } else {
        toolsAllow = [...recommendedTools];
      }
      routeTelemetry.recommendedTools = recommendedTools;
      routeTelemetry.actualRoutedTools = routedTools.map((item) => item.tool);
      routeTelemetry.effectiveAllowlist = toolsAllow;
    }
    contextPackInputs.routedTools = routedTools;

    // Phase 3: Write telemetry event for this classification
    if (!trace?.fastPathDeterministic) {
      fastAwarenessRouter.writeTelemetry({
        category: fastAwarenessResult.category,
        strategy: fastAwarenessResult.strategy,
        confidence: fastAwarenessResult.confidence,
        latency: Date.now() - startTime,
        shouldShortCircuit: fastAwarenessResult.shouldShortCircuit
      });
    }

    if (!finalText && fastAwarenessResult.shouldShortCircuit && effectiveAttempts.length > 0) {
      const shortcutMessages = [
        { role: 'system', content: policySystemMessage },
        { role: 'system', content: roleModeInstruction },
        {
          role: 'system',
          content: `FAST PATH: This is a ${fastAwarenessResult.category} question. Answer directly without tool execution. Be concise and accurate.`
        },
        ...history
      ];

      try {
        const providerStartedAt = Date.now();
        const shortcutRun = await this.runOneProviderTurn({
          provider: effectiveAttempts[0].provider,
          model: effectiveAttempts[0].model,
          messages: shortcutMessages,
          sessionId,
          routedTools: [],
          contextPackInputs,
          workingMemory,
          toolsAllow,
          sideQuestMode
        });
        latency.providerMs += (Date.now() - providerStartedAt);

        if (shortcutRun.finalText) {
          finalText = shortcutRun.finalText;
          trace = {
            ...(shortcutRun.trace || {}),
            ...routeTelemetry,
            roleMode: roleMode.mode,
            roleModeReason: roleMode.reason,
            fastPathUsed: true,
            fastPathCategory: fastAwarenessResult.category,
            fastPathLatency: Date.now() - startTime
          };
          latency.path = 'router-fast';
          fastAwarenessRouter.recordOutcome(fastAwarenessResult.category, true);
        }
      } catch (e) {
        logError('fast_path_failed', { error: String(e.message || e) });
        fastAwarenessRouter.recordOutcome(fastAwarenessResult.category, false, 'fast_path_exception');
      }
    }

    // Normal execution path (if not short-circuited or if fast path failed)
    if (!finalText) {
      const messages = [
        { role: 'system', content: policySystemMessage },
        { role: 'system', content: roleModeInstruction },
        ...history
      ];

      for (const attempt of effectiveAttempts) {
        let attemptNo = 0;
        while (attemptNo < 2) {
          attemptNo += 1;
          try {
            const providerStartedAt = Date.now();
            const run = await this.runOneProviderTurn({
              provider: attempt.provider,
              model: attempt.model,
              messages: [...messages],
              sessionId,
              routedTools,
              contextPackInputs,
              workingMemory,
              toolsAllow,
              sideQuestMode
            });
            latency.providerMs += (Date.now() - providerStartedAt);
            this.clearProviderFailure(attempt.provider);
            finalText = run.finalText;
            trace = {
              ...(run.trace || {}),
              ...routeTelemetry,
              roleMode: roleMode.mode,
              roleModeReason: roleMode.reason
            };
            if (failures.length) trace.providerFailures = [...failures];

            if (!trace.fastPathUsed && fastAwarenessResult) {
              fastAwarenessRouter.recordOutcome(fastAwarenessResult.category, true);
            }
            break;
          } catch (error) {
            const errorMessage = String(error.message || error);
            const kind = classifyProviderFailure(error);
            const decision = resolveFallbackAction(kind, attemptNo);
            const hasAlternateRoute = effectiveAttempts.some((candidate) =>
              candidate.provider !== attempt.provider || candidate.model !== attempt.model
            );
            const action = decision.action === 'switch_provider' && !hasAlternateRoute
              ? 'no_alternative_route'
              : decision.action;
            this.markProviderFailure(attempt.provider, {
              kind,
              action,
              cooldownMs: decision.cooldownMs,
              errorMessage
            });
            failures.push({
              provider: attempt.provider,
              model: attempt.model,
              attempt: attemptNo,
              kind,
              action,
              cooldownMs: decision.cooldownMs,
              error: errorMessage
            });
            if (action === 'retry_same_provider' && attemptNo < 2) continue;
            break;
          }
        }
        if (finalText) break;
      }

      const failureLines = failures.map((item) => `${item.provider}: kind=${item.kind} action=${item.action} error=${item.error}`);

      if (!finalText) {
        finalText = formatProviderFailureReply({
          failures,
          effectiveAttempts,
          routing: routeTelemetry.routePolicy
        });
        trace = {
          provider: this.config.model.provider,
          model: this.config.model.model,
          routedTools,
          iterations: [],
          failures: failureLines,
          providerFailures: failures,
          permissionDenials: [],
          ...routeTelemetry,
          roleMode: roleMode.mode,
          roleModeReason: roleMode.reason,
          pivotHints: buildPivotHints({
            executedTools: [],
            permissionDenials: [],
            timedOut: false,
            providerFailures: failures
          }),
          turnSummary: {
            toolRuns: 0,
            iterationCount: 0,
            permissionDenials: 0,
            routedTools: routedTools.map((item) => item.tool)
          }
        };
      }
    }
    
    // Auto-continue if task incomplete (check before storing reply)
    const executedTools = trace?.iterations?.flatMap((iter) => iter?.toolCalls || []) || [];
    const toolRuns = executedTools.length;
    const isGreetingFastPath = trace?.fastPathCategory === 'greeting' && trace?.fastPathUsed === true;
    const recoveryRequirements = extractRequirements(message);
    const continuationIntent =
      Boolean(decomposition?.decomposed) ||
      /\b(fix|implement|build|create|write|edit|refactor|run|execute|install|remove|delete|update|change|test|verify|deploy|continue|proceed)\b/i.test(message);
    const shouldBypassContinuation =
      recoveryRequirements.asksExplanation || recoveryRequirements.asksReview || recoveryRequirements.asksDocumentDiscussion;
    const shouldContinue =
      !isGreetingFastPath &&
      continuationIntent &&
      !shouldBypassContinuation &&
      this.selfMonitor.shouldAutoContinue(sessionId, finalText, executedTools);
    if (shouldContinue && (!trace?.providerFailures || trace.providerFailures.length === 0)) {
      const continuationPrompt = this.selfMonitor.generateContinuationPrompt(sessionId, finalText, executedTools);
      const continuationMessages = [
        {
          role: 'system',
          content: policySystemMessage
        },
        ...history,
        { role: 'system', content: continuationPrompt }
      ];
      
      // Retry with continuation
      try {
        const continuationStartedAt = Date.now();
        const retryRun = await this.runOneProviderTurn({
          provider: effectiveAttempts[0]?.provider || this.config.model.provider,
          model: effectiveAttempts[0]?.model || this.config.model.model,
          messages: continuationMessages,
          sessionId,
          routedTools,
          contextPackInputs,
          workingMemory,
          toolsAllow,
          sideQuestMode
        });
        const continuationElapsedMs = Date.now() - continuationStartedAt;
        latency.continuationMs += continuationElapsedMs;
        latency.providerMs += continuationElapsedMs;
        if (retryRun.finalText) {
          finalText = retryRun.finalText;
          trace = retryRun.trace;
          logInfo('auto_continued', { success: true });
        }
      } catch (e) {
        logInfo('auto_continued', { success: false, error: String(e.message || e) });
      }
    }
    
    // Add progress indicator for multi-step tasks
    const progress = this.completionChecklist.getProgress();
    const finalization = inferFinalizationState({ finalText, trace, progress });
    if (progress.total > 0 && progress.percent < 100) {
      const progressNote = `\n\n📋 Progress: ${progress.complete}/${progress.total} (${progress.percent}%)`;
      finalText = finalText + progressNote;
    } else if (finalization.state === 'complete') {
      finalText = finalText + '\n\n✅ Task complete!';
    }
    if (trace && typeof trace === 'object') {
      trace.finalization = finalization;
    }
    finalText = enforceVisibleReplyContract({
      finalText,
      userMessage: message,
      executedTools,
      toolRuns
    });
    
    const persistenceStartedAt = Date.now();
    this.memoryStore.addMessage(sessionId, 'assistant', finalText);
    for (const fact of extractAutomaticFacts({
      message,
      reply: finalText,
      model: this.getCurrentModel(),
      trace
    })) {
      this.memoryStore.rememberFact(fact.key, fact.value);
    }

    if (message.toLowerCase().startsWith('remember ')) {
      const payload = message.slice('remember '.length);
      const [key, ...rest] = payload.split(':');
      if (key && rest.length > 0) {
        this.memoryStore.rememberFact(key.trim(), rest.join(':').trim());
      }
    }

    latency.persistenceMs = Date.now() - persistenceStartedAt;
    latency.totalMs = Date.now() - startTime;
    if (trace && typeof trace === 'object') {
      trace.latency = latency;
      const breaches = [];
      if (latency.awarenessMs > latencyBudgetMs.awarenessStage) breaches.push(`awareness>${latencyBudgetMs.awarenessStage}`);
      if (latency.providerMs > latencyBudgetMs.providerStage) breaches.push(`provider>${latencyBudgetMs.providerStage}`);
      if (latency.totalMs > latencyBudgetMs.total) breaches.push(`total>${latencyBudgetMs.total}`);
      if (latency.path === 'deterministic-fast' && latency.totalMs > latencyBudgetMs.deterministicFastTotal) {
        breaches.push(`deterministicFastTotal>${latencyBudgetMs.deterministicFastTotal}`);
      }
      if (latency.path === 'router-fast' && latency.totalMs > latencyBudgetMs.routerFastTotal) {
        breaches.push(`routerFastTotal>${latencyBudgetMs.routerFastTotal}`);
      }
      trace.latencyBudget = {
        thresholdsMs: latencyBudgetMs,
        breaches,
        withinBudget: breaches.length === 0
      };
    }

    // R1: Audit mission complete
    try {
      logEvent('state_change', {
        action: 'task_complete',
        replyLength: finalText.length,
        latencyMs: Date.now() - startTime
      }, sessionId);
    } catch (e) { console.error('[audit_log_failed]', e); }

    return { sessionId, reply: finalText, model: this.getCurrentModel(), trace, context: { budget: triggerInfo, compaction: compactionMeta } };
  }
}
