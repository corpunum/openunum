/**
 * Autonomy Engine - Enables OpenUnum to work independently
 * Features: Self-directed missions, auto-recovery, continuous improvement
 */

import fs from 'node:fs';
import path from 'node:path';
import { getHomeDir } from '../config.mjs';

export class AutonomyEngine {
  constructor({ agent, memoryStore, config }) {
    this.agent = agent;
    this.memoryStore = memoryStore;
    this.config = config;
    this.homeDir = getHomeDir();
    this.autonomyLogPath = path.join(this.homeDir, 'autonomy.jsonl');
    this.learningPath = path.join(this.homeDir, 'learnings.json');
    this.autoMissionId = null;
    this.isAutonomous = false;
    
    // Ensure autonomy files exist
    if (!fs.existsSync(this.learningPath)) {
      fs.writeFileSync(this.learningPath, JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        successes: [],
        failures: [],
        optimizations: [],
        skills: []
      }, null, 2));
    }
  }

  /**
   * Log autonomy event for learning
   */
  logEvent(event) {
    const logLine = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...event
    }) + '\n';
    fs.appendFileSync(this.autonomyLogPath, logLine);
  }

  /**
   * Load learnings from disk
   */
  loadLearnings() {
    try {
      if (fs.existsSync(this.learningPath)) {
        return JSON.parse(fs.readFileSync(this.learningPath, 'utf8'));
      }
    } catch (error) {
      this.logEvent({ type: 'error', action: 'load_learnings', error: error.message });
    }
    return { version: 1, successes: [], failures: [], optimizations: [], skills: [] };
  }

  /**
   * Save learnings to disk
   */
  saveLearnings(learnings) {
    try {
      fs.writeFileSync(this.learningPath, JSON.stringify(learnings, null, 2));
      return true;
    } catch (error) {
      this.logEvent({ type: 'error', action: 'save_learnings', error: error.message });
      return false;
    }
  }

  /**
   * Record a success for future learning
   */
  recordSuccess(goal, strategy, evidence, toolsUsed = []) {
    const learnings = this.loadLearnings();
    learnings.successes.push({
      timestamp: new Date().toISOString(),
      goal,
      strategy,
      evidence,
      toolsUsed,
      confidence: 1.0
    });
    
    // Keep only last 100 successes
    if (learnings.successes.length > 100) {
      learnings.successes = learnings.successes.slice(-100);
    }
    
    this.saveLearnings(learnings);
    this.logEvent({ type: 'success', goal, strategy, toolsUsed });
  }

  /**
   * Record a failure for learning and avoidance
   */
  recordFailure(goal, strategy, error, recoveryAttempted = false) {
    const learnings = this.loadLearnings();
    learnings.failures.push({
      timestamp: new Date().toISOString(),
      goal,
      strategy,
      error,
      recoveryAttempted,
      avoided: false
    });
    
    // Keep only last 100 failures
    if (learnings.failures.length > 100) {
      learnings.failures = learnings.failures.slice(-100);
    }
    
    this.saveLearnings(learnings);
    this.logEvent({ type: 'failure', goal, strategy, error, recoveryAttempted });
  }

  /**
   * Record an optimization discovered
   */
  recordOptimization(description, before, after, impact) {
    const learnings = this.loadLearnings();
    learnings.optimizations.push({
      timestamp: new Date().toISOString(),
      description,
      before,
      after,
      impact
    });
    
    // Keep only last 50 optimizations
    if (learnings.optimizations.length > 50) {
      learnings.optimizations = learnings.optimizations.slice(-50);
    }
    
    this.saveLearnings(learnings);
    this.logEvent({ type: 'optimization', description, impact });
  }

  /**
   * Get similar past successes for strategy hints
   */
  findSimilarSuccesses(goal, limit = 5) {
    const learnings = this.loadLearnings();
    const goalLower = goal.toLowerCase();
    
    return learnings.successes
      .filter(s => {
        const goalMatch = s.goal.toLowerCase().includes(goalLower) || 
                         goalLower.includes(s.goal.toLowerCase());
        return goalMatch && s.confidence > 0.5;
      })
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  /**
   * Get similar past failures to avoid
   */
  findSimilarFailures(goal, limit = 5) {
    const learnings = this.loadLearnings();
    const goalLower = goal.toLowerCase();
    
    return learnings.failures
      .filter(f => {
        const goalMatch = f.goal.toLowerCase().includes(goalLower) || 
                         goalLower.includes(f.goal.toLowerCase());
        return goalMatch && !f.avoided;
      })
      .slice(0, limit);
  }

  /**
   * Build strategy prompt from learnings
   */
  buildStrategyPrompt(goal) {
    const successes = this.findSimilarSuccesses(goal);
    const failures = this.findSimilarFailures(goal);
    
    let prompt = '';
    
    if (successes.length > 0) {
      prompt += 'PROVEN STRATEGIES:\n';
      successes.forEach((s, i) => {
        prompt += `${i + 1}. ${s.strategy} (confidence: ${(s.confidence * 100).toFixed(0)}%)\n`;
      });
      prompt += '\n';
    }
    
    if (failures.length > 0) {
      prompt += 'STRATEGIES TO AVOID:\n';
      failures.forEach((f, i) => {
        prompt += `${i + 1}. ${f.strategy} - Failed: ${f.error}\n`;
      });
      prompt += '\n';
    }
    
    return prompt;
  }

  /**
   * Enable autonomous mode
   */
  async enableAutonomy() {
    this.isAutonomous = true;
    this.config.runtime.autonomyMode = 'relentless';
    this.config.runtime.shellEnabled = true;
    this.config.runtime.maxToolIterations = 20;
    this.config.runtime.executorRetryAttempts = 6;
    this.config.runtime.missionDefaultContinueUntilDone = true;
    this.config.runtime.missionDefaultHardStepCap = 300;
    this.config.runtime.missionDefaultMaxRetries = 8;
    
    this.logEvent({ type: 'autonomy_enabled', timestamp: new Date().toISOString() });
    
    return {
      ok: true,
      mode: 'relentless',
      message: 'Autonomous mode enabled - I will now work independently with self-healing'
    };
  }

  /**
   * Disable autonomous mode
   */
  disableAutonomy() {
    this.isAutonomous = false;
    this.config.runtime.autonomyMode = 'autonomy-first';
    this.config.runtime.maxToolIterations = 8;
    this.config.runtime.executorRetryAttempts = 3;
    this.config.runtime.missionDefaultMaxRetries = 3;
    
    this.logEvent({ type: 'autonomy_disabled', timestamp: new Date().toISOString() });
    
    return {
      ok: true,
      mode: 'autonomy-first',
      message: 'Autonomous mode disabled - back to autonomy-first assistance'
    };
  }

  /**
   * Start an autonomous mission
   */
  async startAutonomousMission(goal, options = {}) {
    if (!this.isAutonomous) {
      return { ok: false, error: 'autonomy_not_enabled', message: 'Enable autonomy first with enableAutonomy()' };
    }

    const strategyHint = this.buildStrategyPrompt(goal);
    
    const missionConfig = {
      goal,
      maxSteps: options.maxSteps || 300,
      intervalMs: options.intervalMs || 250,
      maxRetries: options.maxRetries || 8,
      continueUntilDone: true,
      hardStepCap: 300,
      strategyHint: strategyHint || undefined
    };

    this.logEvent({ 
      type: 'autonomous_mission_start', 
      goal, 
      config: missionConfig 
    });

    return {
      ok: true,
      missionId: `auto-${Date.now()}`,
      goal,
      strategyHint: strategyHint || 'No prior learnings for this goal type',
      message: 'Starting autonomous mission with learned strategies'
    };
  }

  /**
   * Self-assess performance after a mission
   */
  async selfAssess(missionResult) {
    const { goal, success, steps, toolsUsed, errors } = missionResult;
    
    if (success) {
      const strategy = `Completed in ${steps} steps using ${toolsUsed?.join(', ') || 'tools'}`;
      this.recordSuccess(goal, strategy, 'Mission completed successfully', toolsUsed || []);
      
      // Check if we can optimize
      if (steps > 20) {
        this.recordOptimization(
          'High step count detected',
          `${steps} steps`,
          'Target: <10 steps',
          'Consider more efficient tool combinations'
        );
      }
    } else {
      const strategy = `Failed after ${steps} steps`;
      const error = errors?.[0] || 'Unknown error';
      this.recordFailure(goal, strategy, error, true);
    }

    this.logEvent({ 
      type: 'self_assessment', 
      success, 
      steps, 
      goal 
    });

    return {
      ok: true,
      assessed: true,
      success,
      learningsUpdated: true
    };
  }

  /**
   * Get autonomy status
   */
  getStatus() {
    const learnings = this.loadLearnings();
    
    return {
      isAutonomous: this.isAutonomous,
      mode: this.config.runtime.autonomyMode,
      learnings: {
        successes: learnings.successes.length,
        failures: learnings.failures.length,
        optimizations: learnings.optimizations.length
      },
      config: {
        maxToolIterations: this.config.runtime.maxToolIterations,
        executorRetryAttempts: this.config.runtime.executorRetryAttempts,
        missionDefaultContinueUntilDone: this.config.runtime.missionDefaultContinueUntilDone,
        missionDefaultHardStepCap: this.config.runtime.missionDefaultHardStepCap,
        missionDefaultMaxRetries: this.config.runtime.missionDefaultMaxRetries
      }
    };
  }

  /**
   * Export learnings for backup/sharing
   */
  exportLearnings() {
    return this.loadLearnings();
  }

  /**
   * Import learnings from backup
   */
  importLearnings(learningsData) {
    if (!learningsData || !learningsData.version) {
      return { ok: false, error: 'invalid_learnings_format' };
    }
    
    const result = this.saveLearnings(learningsData);
    if (result) {
      this.logEvent({ type: 'learnings_imported', count: learningsData.successes?.length || 0 });
      return { ok: true, message: 'Learnings imported successfully' };
    }
    
    return { ok: false, error: 'failed_to_save_learnings' };
  }
}
