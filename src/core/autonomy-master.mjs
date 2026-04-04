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
import { spawn } from 'node:child_process';
import { loadConfig, saveConfig, getHomeDir } from '../config.mjs';
import { logInfo, logWarn, logError } from '../logger.mjs';
import { SelfHealSystem } from './self-heal.mjs';
import { AutoImprovementEngine } from './auto-improve.mjs';
import { SkillLearner } from './skill-learner.mjs';

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
    this.selfHeal = new SelfHealSystem({ config, agent, memoryStore, browser });
    this.autoImprove = new AutoImprovementEngine({ config, agent, memory: memoryStore });
    this.skillLearner = new SkillLearner({ memoryStore });
    
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
      toolFailureRate: 0.4
    };
    
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
        tests: null,
        improvements: [],
        skills: [],
        issues: []
      };
      
      // Phase 1: Health Check
      logInfo('autonomy_cycle_health', { cycle: this.metrics.cycles });
      results.health = await this.selfHeal.runHealthCheck();
      
      if (results.health.status !== 'healthy') {
        this.metrics.issuesDetected += results.health.issues.length;
        results.issues.push(...results.health.issues);
        
        // Attempt auto-recovery
        const recovery = await this.selfHeal.attemptRecovery(results.health);
        if (recovery.success) {
          this.metrics.issuesResolved += recovery.actions.filter(a => a.success).length;
        }
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
    
    // Check disk space trend
    const diskIssue = health.issues?.find(i => i.check === 'disk_space');
    if (diskIssue?.details?.usagePercent > this.thresholds.diskUsagePercent) {
      predictions.push({
        type: 'disk_space_critical',
        severity: diskIssue.details.usagePercent > 90 ? 'critical' : 'warning',
        currentValue: diskIssue.details.usagePercent,
        action: 'cleanup_logs'
      });
    }
    
    // Check for repeated browser failures
    const browserIssue = health.issues?.find(i => i.check === 'browser_cdp');
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
    
    return predictions;
  }
  
  /**
   * Handle a predictive failure before it occurs
   */
  async handlePrediction(prediction) {
    logInfo('predictive_action', { type: prediction.type, action: prediction.action });
    
    switch (prediction.action) {
      case 'cleanup_logs':
        return await this.selfHeal.cleanupOldLogs(7);
        
      case 'restart_browser':
        return await this.selfHeal.restartBrowser();
        
      case 'switch_fallback':
        return await this.selfHeal.switchToFallbackProvider();
        
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
    return {
      active: this.active,
      metrics: {
        ...this.metrics,
        uptimeMs: Date.now() - this.metrics.startTime
      },
      thresholds: this.thresholds,
      subsystems: {
        selfHeal: this.selfHeal.getHealthState(),
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
}

// Singleton instance
let instance = null;
