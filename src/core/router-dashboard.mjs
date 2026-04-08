import { logInfo, logError } from '../logger.mjs';

/**
 * FastAwarenessRouter Dashboard
 * 
 * Real-time telemetry dashboard for router performance monitoring.
 * Provides:
 * - Classification distribution visualization
 * - Latency histograms
 * - Learning effectiveness metrics
 * - Strategy success rates
 */

export class RouterDashboard {
  constructor(router) {
    this.router = router;
    this.refreshInterval = null;
    this.updateCallbacks = [];
  }

  /**
   * Start auto-refresh dashboard
   * @param {number} intervalMs - Refresh interval (default: 5s)
   */
  start(intervalMs = 5000) {
    this.refreshInterval = setInterval(() => this.refresh(), intervalMs);
    logInfo('router_dashboard_started', { intervalMs });
  }

  /**
   * Stop auto-refresh
   */
  stop() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * Register update callback
   * @param {Function} callback - Called with dashboard data on each refresh
   */
  onUpdate(callback) {
    this.updateCallbacks.push(callback);
  }

  /**
   * Refresh dashboard data
   * @returns {Object} Current dashboard state
   */
  refresh() {
    const data = this.getData();
    for (const cb of this.updateCallbacks) {
      try { cb(data); } catch (e) { /* ignore */ }
    }
    return data;
  }

  /**
   * Get current dashboard data
   * @returns {Object}
   */
  getData() {
    const stats = this.router.getStats();
    const telemetry = this.router.getTelemetrySummary(100);
    const learning = this.router.exportLearningData();

    return {
      timestamp: new Date().toISOString(),
      stats,
      telemetry,
      learning,
      health: this._calculateHealth(stats, telemetry)
    };
  }

  /**
   * Get ASCII dashboard for terminal
   * @returns {string}
   */
  getAscii() {
    const data = this.getData();
    const { stats, telemetry, learning, health } = data;

    // Classification distribution bar
    const total = stats.total || 1;
    const distBar = this._bar([
      { label: 'skip', value: stats.skipRetrieval, color: 'green' },
      { label: 'hot', value: stats.hotOnly, color: 'cyan' },
      { label: 'index', value: stats.indexedOnly, color: 'blue' },
      { label: 'search', value: stats.fullSearch, color: 'yellow' },
      { label: 'inspect', value: stats.deepInspect, color: 'magenta' }
    ], total);

    // Learning effectiveness
    const learningLines = this._formatLearning(learning);

    // Strategy success rates
    const successRates = this._formatSuccessRates(learning);

    return `
╔══════════════════════════════════════════════════════════════╗
║           FastAwarenessRouter Dashboard                       ║
╠══════════════════════════════════════════════════════════════╣
║  Health: ${this._pad(health.status, 52)}║
║  Total Classifications: ${this._pad(String(stats.total), 36)}║
║  Cache Size: ${this._pad(String(stats.cacheSize), 44)}║
║  Avg Latency: ${this._pad(telemetry.avgLatencyMs ? `${telemetry.avgLatencyMs}ms` : 'N/A', 42)}║
╠══════════════════════════════════════════════════════════════╣
║  Classification Distribution (last 100):${distBar}
║
║  Strategy Success Rates:${successRates}
║
║  Learning Data:${learningLines}
╚══════════════════════════════════════════════════════════════╝
`;
  }

  /**
   * Get JSON summary for API/UI
   * @returns {Object}
   */
  getJson() {
    return this.getData();
  }

  // Private helpers

  _calculateHealth(stats, telemetry) {
    const latencyOk = !telemetry.avgLatencyMs || telemetry.avgLatencyMs < 100;
    const cacheOk = stats.cacheSize < 500;
    const totalOk = stats.total > 0;

    if (latencyOk && cacheOk && totalOk) {
      return { status: 'HEALTHY', score: 100 };
    } else if (latencyOk && totalOk) {
      return { status: 'DEGRADED', score: 70 };
    } else {
      return { status: 'UNHEALTHY', score: 40 };
    }
  }

  _bar(items, total) {
    const width = 50;
    const lines = [];
    for (const item of items) {
      if (item.value === 0) continue;
      const pct = (item.value / total * 100).toFixed(1);
      const barLen = Math.round(item.value / total * width);
      const bar = '█'.repeat(barLen) + '░'.repeat(width - barLen);
      lines.push(`║  ${this._pad(item.label, 8)} [${bar}] ${pct}%`);
    }
    return lines.join('\n');
  }

  _formatLearning(learning) {
    const lines = [];
    const total = Object.values(learning.successByCategory).reduce((a, b) => a + b, 0) +
                  Object.values(learning.failureByCategory).reduce((a, b) => a + b, 0);

    if (total === 0) {
      return [`║    No learning data yet (${total} outcomes)`];
    }

    for (const cat of Object.keys(learning.successByCategory)) {
      const success = learning.successByCategory[cat] || 0;
      const failure = learning.failureByCategory[cat] || 0;
      const catTotal = success + failure;
      const rate = ((success / catTotal) * 100).toFixed(0);
      const factor = learning.adjustmentFactors[cat]?.toFixed(2) || '1.00';
      lines.push(`║    ${this._pad(cat, 14)} ${success}/${catTotal} (${rate}%) factor=${factor}`);
    }
    return lines;
  }

  _formatSuccessRates(learning) {
    const lines = [];
    for (const cat of ['task-meta', 'continuation', 'external', 'deep-inspect', 'knowledge']) {
      const success = learning.successByCategory[cat] || 0;
      const failure = learning.failureByCategory[cat] || 0;
      const total = success + failure;
      if (total === 0) continue;

      const rate = ((success / total) * 100).toFixed(0);
      lines.push(`║    ${this._pad(cat, 14)} ${rate}% success (${total} samples)`);
    }
    return lines.length > 0 ? lines.join('\n') : [`║    No strategy data yet`];
  }

  _pad(str, len) {
    return String(str).substring(0, len).padEnd(len);
  }
}

export default RouterDashboard;
