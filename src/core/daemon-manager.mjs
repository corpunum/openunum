import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { logInfo, logError, logWarn } from '../logger.mjs';
import { getHomeDir } from '../config.mjs';

/**
 * DaemonManager - Manages background processes for OpenUnum
 * Handles: health monitoring, auto-recovery, performance tracking
 */
export class DaemonManager {
  constructor({ config, agent, browser, memory, selfHealMonitor }) {
    this.config = config;
    this.agent = agent;
    this.browser = browser;
    this.memory = memory;
    selfHealMonitor = selfHealMonitor;
    this.daemons = new Map();
    this.healthCheckIntervalMs = 60000; // 1 minute
    this.autoImproveIntervalMs = 300000; // 5 minutes
    this.performanceLogPath = path.join(getHomeDir(), 'logs', 'performance.jsonl');
    this.isRunning = false;
    this.timers = [];
  }

  /**
   * Start all background daemons
   */
  startAll() {
    if (this.isRunning) {
      logWarn('daemon_manager_already_running', {});
      return { ok: false, error: 'already_running' };
    }

    this.isRunning = true;
    const results = [];

    // Start health monitor daemon
    results.push(this.startHealthDaemon());

    // Start performance tracker
    results.push(this.startPerformanceTracker());

    // Start auto-improvement daemon (if enabled)
    if (this.config.runtime?.autoImproveEnabled !== false) {
      results.push(this.startAutoImproveDaemon());
    }

    const allOk = results.every(r => r.ok !== false);
    logInfo('daemon_manager_started', { daemons: this.daemons.size });

    return { ok: allOk, daemons: [...this.daemons.keys()] };
  }

  /**
   * Stop all background daemons
   */
  stopAll() {
    if (!this.isRunning) {
      return { ok: false, error: 'not_running' };
    }

    // Clear all timers
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];

    // Stop all daemons
    for (const [name, daemon] of this.daemons.entries()) {
      try {
        if (daemon.process) {
          daemon.process.kill('SIGTERM');
        }
        if (daemon.interval) {
          clearInterval(daemon.interval);
        }
      } catch (error) {
        logError('daemon_stop_error', { name, error: String(error.message || error) });
      }
    }

    this.daemons.clear();
    this.isRunning = false;
    logInfo('daemon_manager_stopped', {});

    return { ok: true, stopped: true };
  }

  /**
   * Start health monitoring daemon
   */
  startHealthDaemon() {
    const name = 'health_monitor';
    let consecutiveFailures = 0;
    const maxFailures = 3;

    const checkHealth = async () => {
      try {
        if (this.selfHealMonitor) {
          const result = await this.selfHealMonitor.runFullHealthCheck();
          
          if (!result.ok) {
            consecutiveFailures += 1;
            logWarn('health_check_failed', { 
              consecutiveFailures, 
              checks: Object.entries(result.checks || {})
                .filter(([_, v]) => !v.ok)
                .map(([k]) => k)
            });

            // Auto-heal if consecutive failures exceed threshold
            if (consecutiveFailures >= maxFailures) {
              logWarn('triggering_auto_heal', { consecutiveFailures });
              try {
                const healResult = await this.selfHealMonitor.autoHeal();
                if (healResult.ok) {
                  consecutiveFailures = 0;
                  logInfo('auto_heal_successful', {});
                }
              } catch (error) {
                logError('auto_heal_failed', { error: String(error.message || error) });
              }
            }
          } else {
            consecutiveFailures = 0;
          }
        }
      } catch (error) {
        logError('health_check_error', { error: String(error.message || error) });
        consecutiveFailures += 1;
      }
    };

    // Run immediately
    checkHealth();

    // Schedule periodic checks
    const interval = setInterval(checkHealth, this.healthCheckIntervalMs);
    this.timers.push(interval);

    this.daemons.set(name, { 
      name, 
      interval, 
      startedAt: new Date().toISOString(),
      type: 'health_monitor'
    });

    logInfo('health_daemon_started', { intervalMs: this.healthCheckIntervalMs });
    return { ok: true, name };
  }

  /**
   * Start performance tracking daemon
   */
  startPerformanceTracker() {
    const name = 'performance_tracker';
    
    const trackPerformance = () => {
      try {
        const metrics = {
          timestamp: new Date().toISOString(),
          memory: process.memoryUsage(),
          uptime: process.uptime(),
          pid: process.pid,
          activeDaemons: this.daemons.size,
          eventLoopLag: this.measureEventLoopLag()
        };

        // Append to performance log
        this.appendPerformanceLog(metrics);

        // Check for memory issues
        const heapUsedMB = metrics.memory.heapUsed / (1024 * 1024);
        const heapTotalMB = metrics.memory.heapTotal / (1024 * 1024);
        
        if (heapUsedMB > 800) {
          logWarn('high_memory_usage', { heapUsedMB, heapTotalMB });
        }

        // Check for event loop lag
        if (metrics.eventLoopLag > 100) {
          logWarn('high_event_loop_lag', { lagMs: metrics.eventLoopLag });
        }

      } catch (error) {
        logError('performance_track_error', { error: String(error.message || error) });
      }
    };

    // Run immediately
    trackPerformance();

    // Schedule periodic tracking (every 30 seconds)
    const interval = setInterval(trackPerformance, 30000);
    this.timers.push(interval);

    this.daemons.set(name, { 
      name, 
      interval, 
      startedAt: new Date().toISOString(),
      type: 'performance_tracker'
    });

    logInfo('performance_daemon_started', {});
    return { ok: true, name };
  }

  /**
   * Start auto-improvement daemon
   */
  startAutoImproveDaemon() {
    const name = 'auto_improve';
    
    const runAutoImprove = async () => {
      try {
        // This would integrate with the auto-improve module
        logInfo('auto_improve_check', { note: 'Auto-improvement check triggered' });
        
        // Future: Analyze successful patterns and suggest improvements
        // Future: Auto-update skills based on successful operations
        // Future: Optimize configuration based on performance metrics
        
      } catch (error) {
        logError('auto_improve_error', { error: String(error.message || error) });
      }
    };

    // Run immediately
    runAutoImprove();

    // Schedule periodic checks (every 5 minutes)
    const interval = setInterval(runAutoImprove, this.autoImproveIntervalMs);
    this.timers.push(interval);

    this.daemons.set(name, { 
      name, 
      interval, 
      startedAt: new Date().toISOString(),
      type: 'auto_improve'
    });

    logInfo('auto_improve_daemon_started', { intervalMs: this.autoImproveIntervalMs });
    return { ok: true, name };
  }

  /**
   * Measure event loop lag
   */
  measureEventLoopLag() {
    const start = process.hrtime.bigint();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
    const end = process.hrtime.bigint();
    return Number((end - start) / BigInt(1e6));
  }

  /**
   * Append metrics to performance log
   */
  appendPerformanceLog(metrics) {
    try {
      fs.mkdirSync(path.dirname(this.performanceLogPath), { recursive: true });
      const line = JSON.stringify(metrics) + '\n';
      fs.appendFileSync(this.performanceLogPath, line, 'utf8');
    } catch (error) {
      // Silently ignore logging errors to avoid cascading failures
    }
  }

  /**
   * Get daemon status
   */
  getStatus() {
    const status = {
      isRunning: this.isRunning,
      daemons: [],
      uptime: process.uptime(),
      pid: process.pid
    };

    for (const [name, daemon] of this.daemons.entries()) {
      status.daemons.push({
        name: daemon.name,
        type: daemon.type,
        startedAt: daemon.startedAt,
        running: true
      });
    }

    return status;
  }

  /**
   * Restart a specific daemon
   */
  restartDaemon(name) {
    const daemon = this.daemons.get(name);
    if (!daemon) {
      return { ok: false, error: 'daemon_not_found', name };
    }

    // Stop existing daemon
    if (daemon.interval) {
      clearInterval(daemon.interval);
    }
    if (daemon.process) {
      daemon.process.kill('SIGTERM');
    }

    this.daemons.delete(name);

    // Restart based on type
    switch (daemon.type) {
      case 'health_monitor':
        return this.startHealthDaemon();
      case 'performance_tracker':
        return this.startPerformanceTracker();
      case 'auto_improve':
        return this.startAutoImproveDaemon();
      default:
        return { ok: false, error: 'unknown_daemon_type', type: daemon.type };
    }
  }
}
