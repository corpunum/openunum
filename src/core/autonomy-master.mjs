#!/usr/bin/env node
/**
 * AutonomyMaster - Central coordinator for all autonomous operations
 * 
 * This is the brain of OpenUnum's self-governance system.
 * It coordinates:
 * - Health monitoring
 * - Self-healing
 * - Self-testing
 * - Auto-improvement
 * - Skill learning
 * - Predictive failure detection
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, getHomeDir } from '../config.mjs';
import { logInfo, logWarn, logError } from '../logger.mjs';
import { SelfHealOrchestrator } from './self-heal-orchestrator.mjs';
import { AutoRecover } from './auto-recover.mjs';
import { AutoImprovementEngine } from './auto-improve.mjs';
import { SkillLearner } from './skill-learner.mjs';
import { buildAutonomyNudges } from './autonomy-nudges.mjs';
import { buildSelfAwarenessSnapshot } from './self-awareness.mjs';
import { AutonomyRemediationQueue } from './autonomy-remediation-queue.mjs';
import { SleepCycle } from './sleep-cycle.mjs';
import { MemoryConsolidator } from './memory-consolidator.mjs';

export function getAutonomyMaster({ config, agent, memoryStore, browser, pendingChats }) {
  return new AutonomyMaster({ config, agent, memoryStore, browser, pendingChats });
}

export class AutonomyMaster {
  constructor({ config, agent, memoryStore, browser, pendingChats }) {
    this.config = config;
    this.agent = agent;
    this.memoryStore = memoryStore;
    this.browser = browser;
    this.pendingChats = pendingChats || new Map();
    this.homeDir = getHomeDir();
    
    // Subsystems
    this.selfHeal = new SelfHealOrchestrator({ config, agent, browser, memory: memoryStore });
    this.autoRecover = new AutoRecover({ config, agent });
    this.autoImprove = new AutoImprovementEngine({ config, agent, memory: memoryStore });
    this.skillLearner = new SkillLearner({ memoryStore });
    this.remediationQueue = new AutonomyRemediationQueue({ homeDir: this.homeDir });
    
    // R2/R9: Memory Consolidation and Sleep Cycles
    this.consolidator = new MemoryConsolidator({ store: memoryStore });
    this.sleepCycle = new SleepCycle({
      consolidator: this.consolidator,
      idleThresholdMs: Number(config?.runtime?.sleepIdleThresholdMs || 3600000), // 1 hour default
      onSleep: (entry) => logInfo('autonomy_entering_sleep', entry),
      onWake: (summary) => logInfo('autonomy_waking_from_sleep', summary)
    });
    
    // State
    this.active = false;
    this.monitorInterval = null;
    this.monitorIntervalMs = 30000; // 30 seconds for active monitoring
    this.baseMonitorIntervalMs = 30000;
    this.activeSessionMonitorIntervalMs = 300000; // 5 minutes during active sessions
    
    // Metrics
    this.metrics = {
      startTime: Date.now(),
      cycles: 0,
      issuesDetected: 0,
      issuesResolved: 0,
      improvementsApplied: 0,
      skillsLearned: 0,
      testsRun: 0,
      testsPassed: 0,
      predictionsMade: 0,
      failuresPrevented: 0
    };
    
    // Thresholds for auto-action
    this.thresholds = {
      consecutiveFailures: 3,
      diskUsagePercent: 85,
      memoryAvailableMB: 500,
      testFailureRate: 0.3,
      toolFailureRate: 0.4,
      pendingChatStuckMs: Math.max(5000, Number(config?.runtime?.pendingChatStuckMs || 45000))
    };
    this.nudges = [];
    this.selfAwareness = buildSelfAwarenessSnapshot({ memoryStore: this.memoryStore });
    
    // Load persisted state
    this.loadState();
  }
  
  /**
   * PHASE 4: Detect if there are active user sessions
   * Returns true if any chats are currently being processed
   */
  hasActiveSessions() {
    if (!this.pendingChats || !(this.pendingChats instanceof Map)) {
      return false;
    }
    // Check if any pending chats are actively being processed (not completed)
    for (const [sessionId, entry] of this.pendingChats.entries()) {
      // If entry has no completedAt, it's still active
      if (!entry.completedAt) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * PHASE 4: Adjust monitoring interval based on active sessions
   */
  adjustMonitoringInterval() {
    const hasActive = this.hasActiveSessions();
    const targetInterval = hasActive ? this.activeSessionMonitorIntervalMs : this.baseMonitorIntervalMs;
    
    if (this.monitorIntervalMs !== targetInterval) {
      this.monitorIntervalMs = targetInterval;
      logInfo('autonomy_monitoring_interval_adjusted', {
        hasActiveSessions: hasActive,
        newIntervalMs: targetInterval,
        reason: hasActive ? 'active_sessions_detected' : 'no_active_sessions'
      });
      
      // Restart interval with new timing
      if (this.monitorInterval) {
        clearInterval(this.monitorInterval);
        this.monitorInterval = setInterval(() => {
          this.runCycle();
        }, this.monitorIntervalMs);
      }
    }
    
    return hasActive;
  }
  
  /**
   * Start autonomous operations
   */
  start() {
    if (this.active) {
      logWarn('autonomy_already_active', 'Autonomy master is already running');
      return false;
    }
    
    this.active = true;
    logInfo('autonomy_master_started', { intervalMs: this.monitorIntervalMs });
    
    // Run initial cycle
    this.runCycle();
    
    // Start periodic monitoring
    this.monitorInterval = setInterval(() => {
      this.runCycle();
    }, this.monitorIntervalMs);
    
    return true;
  }
  
  /**
   * Stop autonomous operations
   */
  stop() {
    if (!this.active) return false;
    
    this.active = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    this.saveState();
    logInfo('autonomy_master_stopped', { uptime: Date.now() - this.metrics.startTime });
    return true;
  }
  
  /**
   * Run one complete autonomy cycle
   */
  async runCycle() {
    try {
      this.metrics.cycles++;
      const cycleStart = Date.now();
      const results = {
        cycle: this.metrics.cycles,
        timestamp: new Date().toISOString(),
        health: null,
        selfAwareness: null,
        pendingQueue: null,
        remediation: null,
        tests: null,
        improvements: [],
        skills: [],
        issues: [],
        nudges: []
      };
      
      // Phase 1: Health Check
      logInfo('autonomy_cycle_health', { cycle: this.metrics.cycles });
      results.health = await this.selfHeal.runHealthCheck();
      
      // R2/R9: Background maintenance during idle
      if (!this.hasActiveSessions()) {
        const sleepCheck = await this.sleepCycle.checkAndSleep();
        if (sleepCheck.triggered) {
          logInfo('autonomy_maintenance_cycle_triggered', { state: sleepCheck.state });
          results.maintenanceCycle = sleepCheck.state;
        }
      } else {
        this.sleepCycle.touchActivity();
      }

      if (results.health.status !== 'healthy') {
        this.metrics.issuesDetected += results.health.issues.length;
        results.issues.push(...results.health.issues);
        
        // Attempt auto-recovery
        const recovery = await this.selfHeal.runSelfHeal(false);
        const successful = (recovery.results || []).filter((item) => item.success !== false).length;
        this.metrics.issuesResolved += successful;
        results.recovery = recovery;
      }

      this.selfAwareness = buildSelfAwarenessSnapshot({ memoryStore: this.memoryStore });
      results.selfAwareness = this.selfAwareness;
      results.pendingQueue = this.getPendingQueueDiagnostics();
      results.remediation = this.ensureRemediationFromSelfAwareness(this.selfAwareness);
      results.pendingQueueRemediation = this.ensureRemediationFromPendingQueue(results.pendingQueue);

      if (this.config.runtime?.selfPokeEnabled !== false) {
        this.nudges = buildAutonomyNudges({
          config: this.config,
          memoryStore: this.memoryStore,
          health: results.health,
          selfAwareness: this.selfAwareness,
          maxItems: 8
        });
        results.nudges = this.nudges;
      } else {
        this.nudges = [];
      }
      
      // Phase 2: Self-Test (every 5 cycles)
      if (this.metrics.cycles % 5 === 0) {
        logInfo('autonomy_cycle_tests', { cycle: this.metrics.cycles });
        results.tests = await this.runQuickTests();
        this.metrics.testsRun++;
        if (results.tests.overallOk) {
          this.metrics.testsPassed++;
        }
      }
      
      // Phase 3: Auto-Improvement Analysis (every 10 cycles)
      if (this.metrics.cycles % 10 === 0) {
        logInfo('autonomy_cycle_improvement', { cycle: this.metrics.cycles });
        const improvements = await this.autoImprove.analyzeAndImprove();
        results.improvements = improvements.improvements || [];
        this.metrics.improvementsApplied += results.improvements.length;
      }
      
      // Phase 4: Skill Learning (every 15 cycles)
      if (this.metrics.cycles % 15 === 0) {
        logInfo('autonomy_cycle_learning', { cycle: this.metrics.cycles });
        const skills = await this.skillLearner.learnFromRecentMissions();
        results.skills = skills;
        this.metrics.skillsLearned += skills.length;
      }
      
      // Phase 5: Predictive Analysis
      const predictions = await this.analyzePredictiveFailures(results.health);
      if (predictions.length > 0) {
        this.metrics.predictionsMade += predictions.length;
        results.issues.push(...predictions.map(p => ({
          type: 'predictive',
          ...p
        })));
        
        // Handle predictions proactively
        for (const pred of predictions) {
          await this.handlePrediction(pred);
          this.metrics.failuresPrevented++;
        }
      }
      
      // Phase 6: Save state and metrics
      this.saveState();
      
      const cycleDuration = Date.now() - cycleStart;
      logInfo('autonomy_cycle_complete', { 
        cycle: this.metrics.cycles, 
        durationMs: cycleDuration,
        issues: results.issues.length,
        improvements: results.improvements.length,
        skills: results.skills.length
      });
      
      return results;
    } catch (error) {
      logError('autonomy_cycle_failed', { error: String(error.message || error) });
      return { error: String(error.message || error) };
    }
  }
  
  /**
   * Run quick self-tests
   */
  async runQuickTests() {
    const tests = {
      overallOk: true,
      results: [],
      timestamp: new Date().toISOString()
    };
    
    // Test 1: Config integrity
    try {
      const cfg = loadConfig();
      if (!cfg.runtime || !cfg.model) {
        tests.results.push({ name: 'config', ok: false, error: 'missing_sections' });
        tests.overallOk = false;
      } else {
        tests.results.push({ name: 'config', ok: true });
      }
    } catch (error) {
      tests.results.push({ name: 'config', ok: false, error: String(error.message || error) });
      tests.overallOk = false;
    }
    
    // Test 2: Memory store
    try {
      const testId = `autotest-${Date.now()}`;
      this.memoryStore.addMessage(testId, 'system', 'test');
      const msgs = this.memoryStore.getMessages(testId, 1);
      tests.results.push({ name: 'memory', ok: msgs.length > 0 });
      if (msgs.length === 0) tests.overallOk = false;
    } catch (error) {
      tests.results.push({ name: 'memory', ok: false, error: String(error.message || error) });
      tests.overallOk = false;
    }
    
    // Test 3: Agent responsiveness
    try {
      const model = this.agent.getCurrentModel();
      tests.results.push({ name: 'agent', ok: !!model.provider && !!model.model });
      if (!model.provider || !model.model) tests.overallOk = false;
    } catch (error) {
      tests.results.push({ name: 'agent', ok: false, error: String(error.message || error) });
      tests.overallOk = false;
    }
    
    // Test 4: Browser (if configured)
    try {
      const status = await this.browser.status();
      tests.results.push({ name: 'browser', ok: status.ok === true });
      if (status.ok !== true) {
        // Browser issues are not critical
        logWarn('browser_unhealthy', status);
      }
    } catch (error) {
      tests.results.push({ name: 'browser', ok: false, error: String(error.message || error) });
    }
    
    // Test 5: File system
    try {
      const testFile = path.join(this.homeDir, 'autotest.txt');
      fs.writeFileSync(testFile, 'test', 'utf8');
      fs.unlinkSync(testFile);
      tests.results.push({ name: 'filesystem', ok: true });
    } catch (error) {
      tests.results.push({ name: 'filesystem', ok: false, error: String(error.message || error) });
      tests.overallOk = false;
    }
    
    return tests;
  }
  
  /**
   * Analyze for predictive failure patterns
   */
  async analyzePredictiveFailures(health) {
    const predictions = [];
    const pendingQueue = this.getPendingQueueDiagnostics();
    
    // Check disk space trend
    const diskIssue = health.issues?.find(i => i.check === 'disk');
    if (diskIssue?.details?.usedPercent > this.thresholds.diskUsagePercent) {
      predictions.push({
        type: 'disk_space_critical',
        severity: diskIssue.details.usedPercent > 90 ? 'critical' : 'warning',
        currentValue: diskIssue.details.usedPercent,
        action: 'cleanup_logs'
      });
    }
    
    // Check for repeated browser failures
    const browserIssue = health.issues?.find(i => i.check === 'browser');
    if (browserIssue) {
      predictions.push({
        type: 'browser_unstable',
        severity: 'warning',
        action: 'restart_browser'
      });
    }
    
    // Check for provider instability
    const providerIssue = health.issues?.find(i => i.check === 'provider');
    if (providerIssue) {
      predictions.push({
        type: 'provider_unstable',
        severity: 'warning',
        action: 'switch_fallback'
      });
    }

    if (pendingQueue.stuckCount > 0) {
      predictions.push({
        type: 'chat_queue_stalled',
        severity: pendingQueue.oldestAgeMs >= this.thresholds.pendingChatStuckMs * 2 ? 'critical' : 'warning',
        stuckCount: pendingQueue.stuckCount,
        oldestAgeMs: pendingQueue.oldestAgeMs,
        action: 'queue_watchdog'
      });
    }
    
    return predictions;
  }
  
  /**
   * Handle a predictive failure before it occurs
   */
  async handlePrediction(prediction) {
    logInfo('predictive_action', { type: prediction.type, action: prediction.action });
    
    switch (prediction.action) {
      case 'cleanup_logs': {
        const out = await this.autoRecover.recover({
          type: 'disk_space_low',
          severity: prediction.severity || 'warning',
          details: prediction
        });
        return { success: Boolean(out.success), action: out.action || 'disk_space_low' };
      }
      case 'restart_browser': {
        const out = await this.autoRecover.recover({
          type: 'browser_cdp_unreachable',
          severity: prediction.severity || 'warning',
          details: prediction
        });
        return { success: Boolean(out.success), action: out.action || 'browser_cdp_unreachable' };
      }
      case 'switch_fallback': {
        const out = await this.autoRecover.recover({
          type: 'model_provider_timeout',
          severity: prediction.severity || 'warning',
          details: { ...prediction, currentProvider: this.config.model.provider }
        });
        return { success: Boolean(out.success), action: out.action || 'model_provider_timeout' };
      }
      case 'queue_watchdog':
        return { success: true, action: 'queue_watchdog_observed' };
      default:
        return { success: false, reason: 'no_handler' };
    }
  }
  
  /**
   * Load persisted state
   */
  loadState() {
    try {
      const statePath = path.join(this.homeDir, 'autonomy-state.json');
      if (fs.existsSync(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        this.metrics = { ...this.metrics, ...state.metrics };
        this.nudges = Array.isArray(state.nudges) ? state.nudges : [];
        if (state.selfAwareness && typeof state.selfAwareness === 'object') {
          this.selfAwareness = state.selfAwareness;
        }
      }
    } catch (error) {
      logWarn('failed_to_load_state', { error: String(error.message || error) });
    }
  }
  
  /**
   * Save current state
   */
  saveState() {
    try {
      const statePath = path.join(this.homeDir, 'autonomy-state.json');
      fs.writeFileSync(statePath, JSON.stringify({
        metrics: this.metrics,
        nudges: this.nudges,
        selfAwareness: this.selfAwareness,
        lastSaved: new Date().toISOString(),
        thresholds: this.thresholds
      }, null, 2));
    } catch (error) {
      logError('failed_to_save_state', { error: String(error.message || error) });
    }
  }
  
  /**
   * Get current status
   */
  getStatus() {
    const nudges = this.nudges.length || this.config.runtime?.selfPokeEnabled === false
      ? this.nudges
      : buildAutonomyNudges({
        config: this.config,
        memoryStore: this.memoryStore,
        health: null,
        maxItems: 8
      });
    return {
      active: this.active,
      metrics: {
        ...this.metrics,
        uptimeMs: Date.now() - this.metrics.startTime
      },
      thresholds: this.thresholds,
      selfAwareness: this.selfAwareness || buildSelfAwarenessSnapshot({ memoryStore: this.memoryStore }),
      pendingQueue: this.getPendingQueueDiagnostics(),
      remediation: this.remediationQueue.list({ limit: 30 }),
      nudges,
      subsystems: {
        selfHeal: this.selfHeal.getStatus({
          pendingChatsCount: this.pendingChats?.size || 0,
          telegramRunning: false
        }),
        autoImprove: this.autoImprove.getMetrics(),
        skillLearner: this.skillLearner.getStats()
      }
    };
  }
  
  /**
   * Trigger immediate self-improvement
   */
  async selfImprove() {
    logInfo('self_improvement_triggered', {});
    const improvements = await this.autoImprove.analyzeAndImprove();
    this.metrics.improvementsApplied += improvements.improvements?.length || 0;
    return improvements;
  }
  
  /**
   * Trigger immediate skill learning
   */
  async learnSkills() {
    logInfo('skill_learning_triggered', {});
    const skills = await this.skillLearner.learnFromRecentMissions();
    this.metrics.skillsLearned += skills.length;
    return { skills };
  }
  
  /**
   * Run comprehensive self-test
   */
  async fullSelfTest() {
    logInfo('full_self_test_triggered', {});
    this.metrics.testsRun++;
    
    // Run quick tests
    const quickTests = await this.runQuickTests();
    
    // Run extended tests via shell
    try {
      const { execSync } = await import('node:child_process');
      execSync('node tests/self-test-runner.mjs', {
        cwd: path.join(process.cwd()),
        stdio: 'pipe',
        timeout: 120000
      });
      this.metrics.testsPassed++;
    } catch (error) {
      logWarn('extended_tests_failed', { error: String(error.message || error) });
    }
    
    return {
      quickTests,
      timestamp: new Date().toISOString()
    };
  }

  ensureRemediationFromSelfAwareness(snapshot = null) {
    return this.remediationQueue.ensureSelfAwarenessRemediation(snapshot);
  }

  listRemediations({ status = '', limit = 80 } = {}) {
    return this.remediationQueue.list({ status, limit });
  }

  getRemediation(id = '') {
    return this.remediationQueue.get(id);
  }

  createRemediation(input = {}) {
    return this.remediationQueue.create(input);
  }

  startRemediation(id = '') {
    return this.remediationQueue.transition(id, 'running');
  }

  resolveRemediation(id = '', resolution = '') {
    return this.remediationQueue.transition(id, 'resolved', { resolution });
  }

  failRemediation(id = '', error = '') {
    return this.remediationQueue.transition(id, 'failed', { error });
  }

  cancelRemediation(id = '', reason = '') {
    return this.remediationQueue.transition(id, 'cancelled', { resolution: reason });
  }

  getPendingQueueDiagnostics() {
    const rows = [];
    const threshold = Math.max(5000, Number(this.thresholds.pendingChatStuckMs || 45000));
    for (const [sessionId, entry] of this.pendingChats.entries()) {
      const startedAt = String(entry?.startedAt || '');
      const ts = Date.parse(startedAt);
      const ageMs = Number.isFinite(ts) ? Math.max(0, Date.now() - ts) : 0;
      rows.push({
        sessionId,
        turnId: entry?.turnId || null,
        startedAt: startedAt || null,
        ageMs,
        stuck: ageMs >= threshold
      });
    }
    rows.sort((a, b) => Number(b.ageMs || 0) - Number(a.ageMs || 0));
    const stuck = rows.filter((row) => row.stuck);
    return {
      pendingCount: rows.length,
      stuckCount: stuck.length,
      oldestAgeMs: rows[0]?.ageMs || 0,
      thresholdMs: threshold,
      stuckSessions: stuck.slice(0, 10)
    };
  }

  ensureRemediationFromPendingQueue(diagnostics = null) {
    return this.remediationQueue.ensurePendingQueueRemediation(diagnostics);
  }
}

// Singleton instance
let instance = null;
