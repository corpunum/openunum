import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { logInfo, logWarn, logError } from '../logger.mjs';
import { loadConfig, saveConfig, getHomeDir } from '../config.mjs';
import { SelfHealSystem } from './self-heal.mjs';
import { AutoRecover } from './auto-recover.mjs';
import { SkillLearner } from './skill-learner.mjs';

/**
 * Autonomy Coordinator
 * Central nervous system for OpenUnum autonomous operations
 * 
 * Features:
 * - Continuous health monitoring with predictive failure detection
 * - Automatic recovery with learning from failures
 * - Skill generation from successful patterns
 * - Resource optimization
 * - Self-improvement recommendations
 */
export class AutonomyCoordinator {
  constructor({ config, agent, memoryStore }) {
    this.config = config;
    this.agent = agent;
    this.memoryStore = memoryStore;
    
    // Sub-systems
    this.selfHeal = new SelfHealSystem({ config, agent, memoryStore });
    this.autoRecover = new AutoRecover({ config, agent });
    this.skillLearner = new SkillLearner({ config, memoryStore });
    
    // State
    this.monitoringActive = false;
    this.monitorInterval = null;
    this.monitorIntervalMs = 60000; // 60 seconds
    this.consecutiveFailures = 0;
    this.maxConsecutiveFailures = 5;
    
    // Metrics
    this.metrics = {
      startTime: Date.now(),
      healthChecks: 0,
      recoveriesAttempted: 0,
      recoveriesSuccessful: 0,
      skillsLearned: 0,
      predictionsMade: 0,
      predictionsAccurate: 0,
      issuesPrevented: 0
    };
    
    // Pattern recognition for predictive failure
    this.failurePatterns = new Map();
    this.successPatterns = new Map();
    
    // Resource thresholds
    this.thresholds = {
      diskUsagePercent: 85,
      memoryAvailableMB: 1000,
      cpuUsagePercent: 90,
      responseTimeMs: 5000,
      consecutiveToolFailures: 3
    };
    
    // Load historical data
    this.loadHistoricalData();
  }
  
  /**
   * Start continuous monitoring
   */
  startMonitoring() {
    if (this.monitoringActive) {
      logWarn('monitoring_already_active', 'Autonomy monitoring is already running');
      return false;
    }
    
    this.monitoringActive = true;
    logInfo('autonomy_monitoring_started', { intervalMs: this.monitorIntervalMs });
    
    // Run initial health check
    this.runHealthCycle();
    
    // Start periodic monitoring
    this.monitorInterval = setInterval(() => {
      this.runHealthCycle();
    }, this.monitorIntervalMs);
    
    return true;
  }
  
  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (!this.monitoringActive) return false;
    
    this.monitoringActive = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    logInfo('autonomy_monitoring_stopped', {});
    return true;
  }
  
  /**
   * Run one complete health monitoring cycle
   */
  async runHealthCycle() {
    try {
      this.metrics.healthChecks++;
      
      // 1. Run health check
      const health = await this.selfHeal.runHealthCheck();
      
      // 2. Check for predictive failure patterns
      const predictions = await this.analyzeFailurePatterns(health);
      
      // 3. If issues detected, attempt recovery
      if (health.status !== 'healthy' || predictions.length > 0) {
        this.consecutiveFailures++;
        
        // Log predictions
        for (const pred of predictions) {
          logWarn('predictive_failure_detected', pred);
          this.metrics.predictionsMade++;
        }
        
        // Auto-recover if threshold reached
        if (this.consecutiveFailures >= 3 || health.issues.length > 0) {
          await this.attemptAutoRecovery(health, predictions);
        }
      } else {
        // Reset on success
        if (this.consecutiveFailures > 0) {
          this.metrics.issuesPrevented += this.consecutiveFailures;
        }
        this.consecutiveFailures = 0;
      }
      
      // 4. Learn from this cycle
      await this.learnFromCycle(health, predictions);
      
      // 5. Save metrics periodically
      if (this.metrics.healthChecks % 10 === 0) {
        this.saveMetrics();
      }
      
      return { health, predictions, consecutiveFailures: this.consecutiveFailures };
    } catch (error) {
      logError('health_cycle_failed', { error: String(error.message || error) });
      this.consecutiveFailures++;
      return { error: String(error.message || error) };
    }
  }
  
  /**
   * Analyze health data for predictive failure patterns
   */
  async analyzeFailurePatterns(health) {
    const predictions = [];
    
    // Check disk space trend
    const diskCheck = health.issues.find(i => i.check === 'disk_space');
    if (diskCheck?.details?.usagePercent) {
      const usage = diskCheck.details.usagePercent;
      if (usage > this.thresholds.diskUsagePercent) {
        predictions.push({
          type: 'disk_space_critical',
          severity: usage > 90 ? 'critical' : 'warning',
          currentValue: usage,
          threshold: this.thresholds.diskUsagePercent,
          recommendedAction: 'cleanup_logs_and_temp_files'
        });
      }
    }
    
    // Check memory trend
    const memCheck = health.issues.find(i => i.check === 'memory_available');
    if (memCheck?.details?.availableMB) {
      const available = memCheck.details.availableMB;
      if (available < this.thresholds.memoryAvailableMB) {
        predictions.push({
          type: 'memory_low',
          severity: available < 500 ? 'critical' : 'warning',
          currentValue: available,
          threshold: this.thresholds.memoryAvailableMB,
          recommendedAction: 'force_garbage_collection'
        });
      }
    }
    
    // Check browser CDP stability
    const browserCheck = health.issues.find(i => i.check === 'browser_cdp');
    if (browserCheck) {
      const recentBrowserFailures = this.getRecentFailureCount('browser_cdp', 5);
      if (recentBrowserFailures >= 2) {
        predictions.push({
          type: 'browser_unstable',
          severity: 'warning',
          recentFailures: recentBrowserFailures,
          recommendedAction: 'restart_browser_with_clean_profile'
        });
      }
    }
    
    // Check provider connectivity stability
    const providerCheck = health.issues.find(i => i.check === 'provider');
    if (providerCheck) {
      const recentProviderFailures = this.getRecentFailureCount('provider', 5);
      if (recentProviderFailures >= 2) {
        predictions.push({
          type: 'provider_unstable',
          severity: 'warning',
          recentFailures: recentProviderFailures,
          recommendedAction: 'switch_to_fallback_provider'
        });
      }
    }
    
    // Check response time degradation
    const serverCheck = health.checks?.find?.(c => c.name === 'server_responsive');
    // (Would need latency tracking implementation)
    
    return predictions;
  }
  
  /**
   * Attempt automatic recovery for detected issues
   */
  async attemptAutoRecovery(health, predictions) {
    const recoveries = [];
    
    // Handle actual issues
    for (const issue of health.issues) {
      try {
        this.metrics.recoveriesAttempted++;
        const recovery = await this.autoRecover.recover({
          type: issue.check,
          severity: 'high',
          details: issue
        });
        
        if (recovery.success) {
          this.metrics.recoveriesSuccessful++;
          this.recordPattern('success', issue.check, recovery);
        } else {
          this.recordPattern('failure', issue.check, recovery);
        }
        
        recoveries.push(recovery);
      } catch (error) {
        logError('recovery_failed', { issue: issue.check, error: String(error.message || error) });
        recoveries.push({ issue: issue.check, success: false, error: String(error.message || error) });
      }
    }
    
    // Handle predictive issues
    for (const prediction of predictions) {
      try {
        this.metrics.recoveriesAttempted++;
        const recovery = await this.handlePredictiveIssue(prediction);
        
        if (recovery.success) {
          this.metrics.recoveriesSuccessful++;
          this.metrics.predictionsAccurate++;
        }
        
        recoveries.push(recovery);
      } catch (error) {
        logError('predictive_recovery_failed', { 
          prediction: prediction.type, 
          error: String(error.message || error) 
        });
      }
    }
    
    return recoveries;
  }
  
  /**
   * Handle predictive issue before it becomes a failure
   */
  async handlePredictiveIssue(prediction) {
    logInfo('predictive_recovery', { type: prediction.type, severity: prediction.severity });
    
    switch (prediction.recommendedAction) {
      case 'cleanup_logs_and_temp_files':
        return await this.autoRecover.recoverDiskSpace();
        
      case 'force_garbage_collection':
        if (global.gc) {
          global.gc();
          return { success: true, action: 'forced_gc', type: prediction.type };
        }
        return { success: false, action: 'gc_not_available', type: prediction.type };
        
      case 'restart_browser_with_clean_profile':
        return await this.autoRecover.recoverBrowserCDP();
        
      case 'switch_to_fallback_provider':
        return await this.autoRecover.recoverProviderTimeout({ 
          currentProvider: this.config.model.provider 
        });
        
      default:
        return { success: false, action: 'no_handler', type: prediction.type };
    }
  }
  
  /**
   * Learn from each monitoring cycle
   */
  async learnFromCycle(health, predictions) {
    // Record successful health state
    if (health.status === 'healthy') {
      this.recordPattern('success', 'health_check', { timestamp: Date.now() });
    }
    
    // Learn from failures
    for (const issue of health.issues) {
      this.recordPattern('failure', issue.check, {
        timestamp: Date.now(),
        details: issue
      });
    }
    
    // Generate skills from successful recoveries
    if (this.metrics.recoveriesSuccessful > 0) {
      await this.generateSkillsFromRecoveries();
    }
  }
  
  /**
   * Record pattern for future analysis
   */
  recordPattern(outcome, type, data) {
    const patterns = outcome === 'success' ? this.successPatterns : this.failurePatterns;
    
    if (!patterns.has(type)) {
      patterns.set(type, []);
    }
    
    const pattern = {
      timestamp: Date.now(),
      outcome,
      type,
      data
    };
    
    patterns.get(type).push(pattern);
    
    // Keep only last 50 patterns per type
    const typePatterns = patterns.get(type);
    if (typePatterns.length > 50) {
      typePatterns.shift();
    }
  }
  
  /**
   * Get recent failure count for a pattern type
   */
  getRecentFailureCount(type, windowMinutes = 5) {
    const patterns = this.failurePatterns.get(type) || [];
    const windowMs = windowMinutes * 60 * 1000;
    const now = Date.now();
    
    return patterns.filter(p => (now - p.timestamp) < windowMs).length;
  }
  
  /**
   * Generate skills from successful recovery patterns
   */
  async generateSkillsFromRecoveries() {
    const recoveryHistory = this.autoRecover.getRecoveryHistory(10);
    const successfulRecoveries = recoveryHistory.filter(r => r.success);
    
    for (const recovery of successfulRecoveries) {
      // Create skill from recovery pattern
      const skillName = `auto_recover_${recovery.issue}`;
      const skillContent = `
# Auto-Recovery Skill: ${recovery.issue}

Pattern: ${recovery.action || 'automatic_recovery'}
Success Rate: High (based on historical data)

When this issue occurs:
1. Detect the issue type: ${recovery.issue}
2. Apply recovery action: ${recovery.action}
3. Verify recovery success
4. Log the recovery for future learning

This skill was auto-generated from successful recovery patterns.
`.trim();
      
      // Save skill
      try {
        const skillPath = path.join(getHomeDir(), 'skills', `${skillName}.md`);
        fs.mkdirSync(path.dirname(skillPath), { recursive: true });
        fs.writeFileSync(skillPath, skillContent);
        this.metrics.skillsLearned++;
        logInfo('skill_generated', { name: skillName, from: recovery.issue });
      } catch (error) {
        logError('skill_generation_failed', { 
          name: skillName, 
          error: String(error.message || error) 
        });
      }
    }
  }
  
  /**
   * Load historical data from disk
   */
  loadHistoricalData() {
    try {
      const metricsPath = path.join(getHomeDir(), 'autonomy-metrics.json');
      if (fs.existsSync(metricsPath)) {
        const saved = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
        this.metrics = { ...this.metrics, ...saved.metrics };
        this.failurePatterns = new Map(Object.entries(saved.failurePatterns || {}));
        this.successPatterns = new Map(Object.entries(saved.successPatterns || {}));
        logInfo('historical_data_loaded', { metrics: this.metrics });
      }
    } catch (error) {
      logWarn('failed_to_load_history', { error: String(error.message || error) });
    }
  }
  
  /**
   * Save metrics to disk
   */
  saveMetrics() {
    try {
      const metricsPath = path.join(getHomeDir(), 'autonomy-metrics.json');
      fs.writeFileSync(metricsPath, JSON.stringify({
        metrics: this.metrics,
        failurePatterns: Object.fromEntries(this.failurePatterns),
        successPatterns: Object.fromEntries(this.successPatterns),
        lastSaved: new Date().toISOString()
      }, null, 2));
    } catch (error) {
      logError('failed_to_save_metrics', { error: String(error.message || error) });
    }
  }
  
  /**
   * Get current autonomy status
   */
  getStatus() {
    return {
      monitoringActive: this.monitoringActive,
      metrics: { ...this.metrics, uptimeMs: Date.now() - this.metrics.startTime },
      consecutiveFailures: this.consecutiveFailures,
      thresholds: this.thresholds,
      patternsTracked: {
        failures: this.failurePatterns.size,
        successes: this.successPatterns.size
      },
      healthState: this.selfHeal.getHealthState()
    };
  }
  
  /**
   * Get recommendations for system improvement
   */
  getRecommendations() {
    const recommendations = [];
    
    // Check if monitoring interval is optimal
    if (this.consecutiveFailures > 2) {
      recommendations.push({
        type: 'increase_monitoring_frequency',
        reason: 'Multiple consecutive failures detected',
        suggestion: 'Reduce monitor interval from 60s to 30s',
        priority: 'high'
      });
    }
    
    // Check recovery success rate
    if (this.metrics.recoveriesAttempted > 0) {
      const successRate = this.metrics.recoveriesSuccessful / this.metrics.recoveriesAttempted;
      if (successRate < 0.7) {
        recommendations.push({
          type: 'improve_recovery_strategies',
          reason: `Low recovery success rate: ${(successRate * 100).toFixed(1)}%`,
          suggestion: 'Review and update recovery handlers for common failures',
          priority: 'medium'
        });
      }
    }
    
    // Check if skills are being generated
    if (this.metrics.skillsLearned === 0 && this.metrics.healthChecks > 20) {
      recommendations.push({
        type: 'enable_skill_learning',
        reason: 'No skills learned despite multiple health checks',
        suggestion: 'Review skill learner configuration',
        priority: 'low'
      });
    }
    
    // Check disk space trend
    if (this.failurePatterns.has('disk_space')) {
      const diskFailures = this.failurePatterns.get('disk_space');
      if (diskFailures.length > 3) {
        recommendations.push({
          type: 'disk_space_management',
          reason: 'Recurring disk space issues',
          suggestion: 'Implement automated log rotation and cleanup',
          priority: 'high'
        });
      }
    }
    
    return recommendations;
  }
  
  /**
   * Manual trigger for self-improvement
   */
  async selfImprove() {
    logInfo('self_improvement_triggered', {});
    
    const improvements = [];
    
    // 1. Analyze failure patterns
    const commonFailures = [...this.failurePatterns.entries()]
      .map(([type, patterns]) => ({ type, count: patterns.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    
    // 2. Generate improvement suggestions
    for (const failure of commonFailures) {
      improvements.push({
        failureType: failure.type,
        occurrenceCount: failure.count,
        suggestion: `Create targeted recovery handler for ${failure.type}`
      });
    }
    
    // 3. Optimize thresholds based on history
    improvements.push({
      type: 'threshold_optimization',
      current: this.thresholds,
      suggestion: 'Adjust thresholds based on historical failure data'
    });
    
    // 4. Save improvements
    const improvementsPath = path.join(getHomeDir(), 'self-improvements.json');
    fs.writeFileSync(improvementsPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      improvements,
      metrics: this.metrics
    }, null, 2));
    
    return { improvements, metrics: this.metrics };
  }
}
