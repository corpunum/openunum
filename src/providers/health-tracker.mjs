export class ProviderHealthTracker {
  constructor() {
    this.health = new Map(); // provider -> { failures, lastFailure, backoffUntil, status }
    this.BACKOFF_MS = 300000; // 5 minutes
    this.FAILURE_THRESHOLD = 3;
  }

  getOrCreate(provider) {
    if (!this.health.has(provider)) {
      this.health.set(provider, { failures: 0, status: 'healthy', backoffUntil: null, lastError: null });
    }
    return this.health.get(provider);
  }

  recordFailure(provider, error) {
    const h = this.getOrCreate(provider);
    h.failures++;
    h.lastFailure = Date.now();
    h.lastError = error?.message || 'unknown';
    if (h.failures >= this.FAILURE_THRESHOLD) {
      h.backoffUntil = Date.now() + this.BACKOFF_MS;
      h.status = 'degraded';
    }
    this.health.set(provider, h);
  }

  recordSuccess(provider) {
    this.health.set(provider, { failures: 0, status: 'healthy', backoffUntil: null, lastError: null });
  }

  isHealthy(provider) {
    const h = this.health.get(provider);
    if (!h) return true;
    if (h.backoffUntil && Date.now() < h.backoffUntil) return false;
    if (h.backoffUntil && Date.now() >= h.backoffUntil) {
      // Backoff expired, reset
      this.recordSuccess(provider);
      return true;
    }
    return h.failures < this.FAILURE_THRESHOLD;
  }

  getHealthStatus() {
    const result = {};
    for (const [provider, h] of this.health) {
      result[provider] = {
        status: h.status || 'healthy',
        failures: h.failures || 0,
        backoffUntil: h.backoffUntil ? new Date(h.backoffUntil).toISOString() : null,
        lastError: h.lastError || null
      };
    }
    return { providers: result, checkedAt: new Date().toISOString() };
  }
}

// Singleton instance
export const healthTracker = new ProviderHealthTracker();
