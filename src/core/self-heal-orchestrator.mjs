import { SelfHealSystem } from './self-heal.mjs';
import { AutoRecover } from './auto-recover.mjs';
import { logInfo, logWarn } from '../logger.mjs';

function mapCheckToIssueType(checkName) {
  const map = {
    browser_cdp: 'browser_cdp_unreachable',
    ollama_reachable: 'model_provider_timeout',
    disk_space: 'disk_space_low',
    database_valid: 'memory_session_lost',
    config_valid: 'server_health_check_failed'
  };
  return map[String(checkName || '').trim().toLowerCase()] || null;
}

export class SelfHealOrchestrator {
  constructor({ config, agent, browser, memory, probes = {} }) {
    this.config = config;
    this.agent = agent;
    this.browser = browser;
    this.memory = memory;
    // Use canonical SelfHealSystem instead of legacy SelfHealMonitor
    this.system = new SelfHealSystem({ config, agent, memoryStore: memory, probes });
    this.recover = new AutoRecover({ config, agent });
  }

  async runHealthCheck() {
    // Use canonical SelfHealSystem for health checks
    const systemHealth = await this.system.runHealthCheck();
    return systemHealth;
  }

  async runSelfHeal(dryRun = false) {
    const health = await this.runHealthCheck();
    if (dryRun) {
      return {
        ok: health.status === 'healthy',
        dryRun: true,
        status: health.status,
        issues: health.issues || []
      };
    }

    const recoveryResults = [];

    for (const issue of health.issues || []) {
      const issueType = mapCheckToIssueType(issue.check);
      if (!issueType) continue;
      try {
        const result = await this.system.attemptRecovery(issue);
        recoveryResults.push({
          action: `self_heal:${issue.check}`,
          success: Boolean(result.ok),
          details: result
        });
      } catch (error) {
        recoveryResults.push({
          action: `self_heal:${issue.check}`,
          success: false,
          error: String(error.message || error)
        });
      }
    }

    const ok = health.status === 'healthy' || recoveryResults.every((r) => r.success !== false);
    logInfo('self_heal_orchestrator_run', {
      ok,
      failedChecks: health.issues?.map((i) => i.check) || [],
      recoveries: recoveryResults.length
    });

    return {
      ok,
      status: health.status,
      issues: health.issues || [],
      results: recoveryResults,
      actions: recoveryResults.map((r) => ({ action: r.action, status: r.success ? 'applied' : 'failed' }))
    };
  }

  getStatus({ pendingChatsCount = 0, telegramRunning = false } = {}) {
    const systemStatus = this.system.getHealthState();
    return {
      ...systemStatus,
      pendingChats: pendingChatsCount,
      telegramRunning,
      model: this.agent?.getCurrentModel?.() || null,
      config: {
        autonomyMode: this.config.runtime?.autonomyMode,
        shellEnabled: this.config.runtime?.shellEnabled,
        maxToolIterations: this.config.runtime?.maxToolIterations
      }
    };
  }

  setAutoHealEnabled(enabled) {
    if (typeof this.monitor.setAutoHealEnabled === 'function') {
      this.monitor.setAutoHealEnabled(enabled);
      return;
    }
    logWarn('self_heal_set_auto_heal_not_supported', { enabled });
  }
}
