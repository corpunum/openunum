import fs from 'node:fs';
import path from 'node:path';
import { getHomeDir } from '../config.mjs';
import { logInfo, logWarn, logError } from '../logger.mjs';

/**
 * AutoImprovementEngine - Learns from successful operations and enhances OpenUnum
 * 
 * Capabilities:
 * - Analyzes successful tool runs to identify patterns
 * - Generates new skills from successful strategies
 * - Optimizes config based on performance metrics
 * - Suggests code improvements from error patterns
 * - Auto-creates helper scripts for common tasks
 */
export class AutoImprovementEngine {
  constructor({ memory, config, agent }) {
    this.memory = memory;
    this.config = config;
    this.agent = agent;
    this.homeDir = getHomeDir();
    this.improvementLogPath = path.join(this.homeDir, 'improvements.json');
    this.metricsPath = path.join(this.homeDir, 'metrics.json');
    this.loadMetrics();
    this.loadImprovementLog();
  }

  loadMetrics() {
    try {
      if (fs.existsSync(this.metricsPath)) {
        this.metrics = JSON.parse(fs.readFileSync(this.metricsPath, 'utf8'));
      } else {
        this.metrics = this.defaultMetrics();
      }
    } catch {
      this.metrics = this.defaultMetrics();
    }
  }

  defaultMetrics() {
    return {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      toolUsage: {},
      successRates: {},
      avgExecutionTimeMs: 0,
      lastOptimization: null,
      learnedSkills: [],
      commonErrors: {},
      performanceHistory: []
    };
  }

  loadImprovementLog() {
    try {
      if (fs.existsSync(this.improvementLogPath)) {
        this.improvementLog = JSON.parse(fs.readFileSync(this.improvementLogPath, 'utf8'));
      } else {
        this.improvementLog = [];
      }
    } catch {
      this.improvementLog = [];
    }
  }

  saveMetrics() {
    fs.writeFileSync(this.metricsPath, JSON.stringify(this.metrics, null, 2));
  }

  saveImprovementLog() {
    fs.writeFileSync(this.improvementLogPath, JSON.stringify(this.improvementLog, null, 2));
  }

  /**
   * Record a completed operation for analysis
   */
  recordOperation({ sessionId, goal, success, toolRuns, durationMs, error }) {
    this.metrics.totalRuns += 1;
    if (success) {
      this.metrics.successfulRuns += 1;
    } else {
      this.metrics.failedRuns += 1;
    }

    // Track tool usage
    if (toolRuns) {
      for (const run of toolRuns) {
        const toolName = run.toolName || 'unknown';
        if (!this.metrics.toolUsage[toolName]) {
          this.metrics.toolUsage[toolName] = { count: 0, success: 0, fail: 0 };
        }
        this.metrics.toolUsage[toolName].count += 1;
        if (run.ok) {
          this.metrics.toolUsage[toolName].success += 1;
        } else {
          this.metrics.toolUsage[toolName].fail += 1;
        }
      }
    }

    // Track errors
    if (error) {
      const errorKey = String(error).substring(0, 100);
      this.metrics.commonErrors[errorKey] = (this.metrics.commonErrors[errorKey] || 0) + 1;
    }

    // Update avg execution time
    const total = this.metrics.successfulRuns + this.metrics.failedRuns;
    this.metrics.avgExecutionTimeMs = 
      ((this.metrics.avgExecutionTimeMs * (total - 1)) + (durationMs || 0)) / total;

    // Add to performance history
    this.metrics.performanceHistory.push({
      timestamp: new Date().toISOString(),
      success,
      durationMs,
      toolCount: toolRuns?.length || 0,
      goal: goal?.substring(0, 200)
    });

    // Keep history limited
    if (this.metrics.performanceHistory.length > 1000) {
      this.metrics.performanceHistory = this.metrics.performanceHistory.slice(-500);
    }

    // Calculate success rates per tool
    for (const [toolName, stats] of Object.entries(this.metrics.toolUsage)) {
      this.metrics.successRates[toolName] = 
        stats.count > 0 ? (stats.success / stats.count) : 0;
    }

    this.saveMetrics();

    // Trigger improvement analysis periodically
    if (this.metrics.totalRuns % 10 === 0) {
      this.analyzeAndImprove();
    }

    return { recorded: true, totalRuns: this.metrics.totalRuns };
  }

  /**
   * Analyze patterns and generate improvements
   */
  async analyzeAndImprove() {
    const improvements = [];

    // 1. Generate skills from successful multi-step patterns
    const skillImprovements = await this.generateSkillsFromSuccess();
    improvements.push(...skillImprovements);

    // 2. Identify failing tools and suggest fixes
    const toolFixes = this.identifyToolIssues();
    improvements.push(...toolFixes);

    // 3. Optimize config based on performance
    const configOpts = this.optimizeConfig();
    improvements.push(...configOpts);

    // 4. Create helper scripts for common tasks
    const scriptCreations = await this.createHelperScripts();
    improvements.push(...scriptCreations);

    if (improvements.length > 0) {
      this.improvementLog.push({
        timestamp: new Date().toISOString(),
        totalRuns: this.metrics.totalRuns,
        improvements
      });
      this.saveImprovementLog();
      logInfo('auto_improvement_triggered', { count: improvements.length });
    }

    return { improvements, totalImprovements: this.improvementLog.length };
  }

  /**
   * Generate new skills from successful operation patterns
   */
  async generateSkillsFromSuccess() {
    const improvements = [];
    const skillsDir = path.join(this.homeDir, 'skills');
    
    // Get successful strategy outcomes
    const successfulStrategies = this.memory.retrieveStrategyHints('', 20)
      .filter(s => s.success && s.evidence?.includes('completed'));

    for (const strategy of successfulStrategies.slice(0, 3)) {
      const skillName = strategy.strategy
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .substring(0, 30);
      
      const skillPath = path.join(skillsDir, `${skillName}.md`);
      
      if (!fs.existsSync(skillPath)) {
        const skillContent = `# Skill: ${strategy.strategy}

## Pattern
${strategy.evidence}

## Success Indicators
- Task completed with tool proof
- No errors in execution chain

## Application
Use this strategy when similar goals are encountered.

## Generated
${new Date().toISOString()}
`;
        fs.writeFileSync(skillPath, skillContent);
        improvements.push({
          type: 'skill_created',
          name: skillName,
          path: skillPath,
          basedOn: strategy.strategy.substring(0, 100)
        });
        this.metrics.learnedSkills.push(skillName);
      }
    }

    this.saveMetrics();
    return improvements;
  }

  /**
   * Identify tools with high failure rates and suggest fixes
   */
  identifyToolIssues() {
    const improvements = [];
    
    for (const [toolName, stats] of Object.entries(this.metrics.toolUsage)) {
      const failRate = stats.count > 0 ? (stats.fail / stats.count) : 0;
      
      if (failRate > 0.3 && stats.count >= 5) {
        improvements.push({
          type: 'tool_warning',
          tool: toolName,
          failRate: Math.round(failRate * 100),
          suggestion: `Review ${toolName} implementation - ${Math.round(failRate * 100)}% failure rate`,
          action: 'manual_review_recommended'
        });
      }
    }

    return improvements;
  }

  /**
   * Optimize runtime config based on performance metrics
   */
  optimizeConfig() {
    const improvements = [];
    const changes = {};

    // Adjust retry attempts based on success rates
    const avgSuccessRate = Object.values(this.metrics.successRates).reduce((a, b) => a + b, 0) / 
      Math.max(1, Object.keys(this.metrics.successRates).length);

    if (avgSuccessRate < 0.7 && this.config.runtime.executorRetryAttempts < 5) {
      changes.executorRetryAttempts = Math.min(5, this.config.runtime.executorRetryAttempts + 1);
      improvements.push({
        type: 'config_increase_retry',
        reason: 'low_success_rate',
        newValue: changes.executorRetryAttempts
      });
    }

    // Adjust timeout based on avg execution time
    if (this.metrics.avgExecutionTimeMs > 60000 && 
        this.config.runtime.agentTurnTimeoutMs < 600000) {
      changes.agentTurnTimeoutMs = Math.min(600000, this.config.runtime.agentTurnTimeoutMs + 60000);
      improvements.push({
        type: 'config_increase_timeout',
        reason: 'slow_avg_execution',
        newValue: changes.agentTurnTimeoutMs
      });
    }

    // Reduce interval if tasks complete quickly
    if (this.metrics.avgExecutionTimeMs < 5000 && 
        this.config.runtime.missionDefaultIntervalMs > 200) {
      changes.missionDefaultIntervalMs = 200;
      improvements.push({
        type: 'config_reduce_interval',
        reason: 'fast_execution',
        newValue: changes.missionDefaultIntervalMs
      });
    }

    if (Object.keys(changes).length > 0) {
      for (const [key, value] of Object.entries(changes)) {
        this.config.runtime[key] = value;
      }
      improvements.push({
        type: 'config_applied',
        changes
      });
    }

    return improvements;
  }

  /**
   * Create helper scripts for common repetitive tasks
   */
  async createHelperScripts() {
    const improvements = [];
    const scriptsDir = path.join(this.homeDir, 'scripts');
    
    // Ensure scripts directory exists
    if (!fs.existsSync(scriptsDir)) {
      fs.mkdirSync(scriptsDir, { recursive: true });
    }

    // Analyze common tool sequences
    const recentRuns = this.memory.getRecentToolRuns?.('system', 50) || [];
    
    // Look for repeated patterns (simplified analysis)
    const toolSequences = {};
    for (let i = 0; i < recentRuns.length - 2; i++) {
      const seq = [recentRuns[i].toolName, recentRuns[i+1].toolName, recentRuns[i+2].toolName].join('->');
      toolSequences[seq] = (toolSequences[seq] || 0) + 1;
    }

    // Create script for most common sequence
    const commonSeq = Object.entries(toolSequences)
      .sort((a, b) => b[1] - a[1])[0];

    if (commonSeq && commonSeq[1] >= 3) {
      const [t1, t2, t3] = commonSeq[0].split('->');
      const scriptName = `auto-${t1}-${t2}-${t3}.mjs`.replace(/[^a-z0-9.-]/g, '_');
      const scriptPath = path.join(scriptsDir, scriptName);

      if (!fs.existsSync(scriptPath)) {
        const scriptContent = `// Auto-generated helper script
// Pattern: ${t1} -> ${t2} -> ${t3}
// Occurrences: ${commonSeq[1]}

import { ToolRuntime } from '../tools/runtime.mjs';
import { loadConfig } from '../config.mjs';

const config = loadConfig();
const runtime = new ToolRuntime(config);

async function run() {
  console.log('Executing common pattern: ${t1} -> ${t2} -> ${t3}');
  
  // Customize arguments for your use case
  const result1 = await runtime.run('${t1}', {});
  console.log('Step 1:', result1);
  
  const result2 = await runtime.run('${t2}', {});
  console.log('Step 2:', result2);
  
  const result3 = await runtime.run('${t3}', {});
  console.log('Step 3:', result3);
  
  return { result1, result2, result3 };
}

run().catch(console.error);
`;
        fs.writeFileSync(scriptPath, scriptContent);
        improvements.push({
          type: 'script_created',
          name: scriptName,
          path: scriptPath,
          pattern: commonSeq[0],
          occurrences: commonSeq[1]
        });
      }
    }

    return improvements;
  }

  /**
   * Get current metrics summary
   */
  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.totalRuns > 0 
        ? Math.round((this.metrics.successfulRuns / this.metrics.totalRuns) * 100) 
        : 0,
      lastOptimization: this.metrics.lastOptimization,
      learnedSkillsCount: this.metrics.learnedSkills.length
    };
  }

  /**
   * Get improvement history
   */
  getImprovementHistory(limit = 10) {
    return this.improvementLog.slice(-limit);
  }

  /**
   * Reset metrics (for testing or fresh start)
   */
  resetMetrics() {
    this.metrics = this.defaultMetrics();
    this.saveMetrics();
    return { reset: true };
  }
}
