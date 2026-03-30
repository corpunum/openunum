import { logInfo, logError, logWarn } from '../logger.mjs';

/**
 * Health Monitor - Continuously watches system health and triggers self-healing
 */
export class HealthMonitor {
  constructor({ config, agent, selfHealer }) {
    this.config = config;
    this.agent = agent;
    selfHealer = selfHealer;
    this.selfHealer = selfHealer;
    this.running = false;
    this.stopRequested = false;
    this.checkIntervalMs = config.runtime?.healthCheckIntervalMs ?? 30000;
    this.lastCheck = null;
    this.healthHistory = [];
    this.maxHistorySize = 100;
    this.consecutiveFailures = 0;
    this.maxConsecutiveFailures = 5;
    this.healthDegradationThreshold = 0.3;
  }

  /**
   * Check all critical system components
   */
  async runHealthCheck() {
    const timestamp = new Date().toISOString();
    const checks = {
      server: await this.checkServer(),
      model: await this.checkModel(),
      browser: await this.checkBrowser(),
      filesystem: await this.checkFilesystem(),
      memory: await this.checkMemory(),
      tools: await this.checkTools()
    };

    const allPassed = Object.values(checks).every(c => c.ok);
    const healthScore = Object.values(checks).filter(c => c.ok).length / Object.values(checks).length;

    const result = {
      timestamp,
      checks,
      allPassed,
      healthScore,
      consecutiveFailures: allPassed ? 0 : this.consecutiveFailures + 1
    };

    this.lastCheck = result;
    this.healthHistory.push(result);
    if (this.healthHistory.length > this.maxHistorySize) {
      this.healthHistory.shift();
    }

    if (!allPassed) {
      this.consecutiveFailures += 1;
      logWarn('health_check_failed', {
        score: healthScore,
        failedChecks: Object.entries(checks)
          .filter(([, c]) => !c.ok)
          .map(([k]) => k)
      });
    } else {
      this.consecutiveFailures = 0;
    }

    return result;
  }

  async checkServer() {
    try {
      const res = await fetch(`http://${this.config.server.host}:${this.config.server.port}/api/health`);
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}`, component: 'server' };
      }
      const data = await res.json();
      return { ok: data.ok === true, component: 'server' };
    } catch (error) {
      return { ok: false, error: String(error.message || error), component: 'server' };
    }
  }

  async checkModel() {
    try {
      const res = await fetch(`http://${this.config.server.host}:${this.config.server.port}/api/model/current`);
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}`, component: 'model' };
      }
      const data = await res.json();
      if (!data.provider || !data.model) {
        return { ok: false, error: 'Invalid model config', component: 'model' };
      }
      return { ok: true, provider: data.provider, model: data.model, component: 'model' };
    } catch (error) {
      return { ok: false, error: String(error.message || error), component: 'model' };
    }
  }

  async checkBrowser() {
    try {
      const res = await fetch(`http://${this.config.server.host}:${this.config.server.port}/api/browser/status`);
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}`, component: 'browser' };
      }
      const data = await res.json();
      return { ok: data.ok === true, component: 'browser', tabs: data.tabs?.length ?? 0 };
    } catch (error) {
      return { ok: false, error: String(error.message || error), component: 'browser' };
    }
  }

  async checkFilesystem() {
    try {
      const { execSync } = await import('node:child_process');
      execSync('touch /tmp/openunum-health-check && rm /tmp/openunum-health-check');
      return { ok: true, component: 'filesystem' };
    } catch (error) {
      return { ok: false, error: String(error.message || error), component: 'filesystem' };
    }
  }

  async checkMemory() {
    try {
      const { execSync } = await import('node:child_process');
      const output = execSync('free -m | awk \'/^Mem:/ {print $3/$2 * 100}\'', { encoding: 'utf8' });
      const usagePercent = parseFloat(output.trim());
      return {
        ok: usagePercent < 95,
        usagePercent,
        component: 'memory',
        warning: usagePercent > 80
      };
    } catch (error) {
      return { ok: false, error: String(error.message || error), component: 'memory' };
    }
  }

  async checkTools() {
    try {
      const testResult = await this.agent.runTool('shell_run', { cmd: 'echo health_check' });
      if (!testResult.ok || !testResult.stdout?.includes('health_check')) {
        return { ok: false, error: 'Tool execution failed', component: 'tools' };
      }
      return { ok: true, component: 'tools' };
    } catch (error) {
      return { ok: false, error: String(error.message || error), component: 'tools' };
    }
  }

  /**
   * Start continuous health monitoring
   */
  async start() {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;
    logInfo('health_monitor_started', { intervalMs: this.checkIntervalMs });

    while (!this.stopRequested) {
      try {
        const health = await this.runHealthCheck();

        if (!health.allPassed) {
          logWarn('health_degraded', { score: health.healthScore });

          if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
            logError('critical_health_failure', {
              consecutiveFailures: this.consecutiveFailures,
              score: health.healthScore
            });

            if (this.selfHealer) {
              await this.selfHealer.autoRecover(health);
            }
          }
        }

        await this.sleep(this.checkIntervalMs);
      } catch (error) {
        logError('health_monitor_error', { error: String(error.message || error) });
        await this.sleep(this.checkIntervalMs * 2);
      }
    }

    this.running = false;
    logInfo('health_monitor_stopped');
  }

  stop() {
    this.stopRequested = true;
  }

  getStatus() {
    return {
      running: this.running,
      stopRequested: this.stopRequested,
      lastCheck: this.lastCheck,
      consecutiveFailures: this.consecutiveFailures,
      historySize: this.healthHistory.length
    };
  }

  getHistory(limit = 10) {
    return this.healthHistory.slice(-limit);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
