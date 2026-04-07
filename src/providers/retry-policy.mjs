/**
 * Provider Health Tracker & Retry Policy (R7)
 * Handles transport-layer retries with exponential backoff
 * and per-provider health tracking.
 */

export class AuthError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

export class QuotaError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = 'QuotaError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class RetryPolicy {
  /**
   * @param {Object} options
   * @param {number} options.maxRetries - Max retry attempts (default: 2)
   * @param {number} options.baseDelayMs - Base delay in ms (default: 200)
   * @param {number} options.maxDelayMs - Max delay in ms (default: 3200)
   */
  constructor({ maxRetries = 2, baseDelayMs = 200, maxDelayMs = 3200 } = {}) {
    this.maxRetries = maxRetries;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
  }

  /**
   * Execute a function with retry logic
   * @param {Function} fn - Async function to execute
   * @param {Object} options
   * @param {string} options.provider - Provider name for logging
   * @param {string} options.operation - Operation name for logging
   * @returns {Promise<*>} Result of fn
   */
  async execute(fn, { provider = 'unknown', operation = 'invoke' } = {}) {
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const classification = this.classifyError(error);

        // Auth errors: immediate fail, no retry
        if (classification === 'auth') {
          throw new AuthError(
            `Auth failed for ${provider}/${operation}: ${error.message}`,
            error.status || error.statusCode || 401
          );
        }

        // Quota errors: immediate fail with retry-after info
        if (classification === 'quota') {
          const retryAfterMs = this._extractRetryAfter(error);
          throw new QuotaError(
            `Quota exceeded for ${provider}/${operation}: ${error.message}`,
            retryAfterMs
          );
        }

        // Permanent errors: immediate fail
        if (classification === 'permanent') {
          throw error;
        }

        // Transient errors: retry if attempts remain
        if (attempt < this.maxRetries) {
          const delayMs = this.getBackoffMs(attempt);
          await this._sleep(delayMs);
        }
      }
    }

    throw lastError;
  }

  /**
   * Classify an error for retry decisions
   * @param {Error} error
   * @returns {'transient'|'permanent'|'auth'|'quota'}
   */
  classifyError(error) {
    const status = error.status || error.statusCode;
    const message = String(error.message || '').toLowerCase();

    // Auth errors
    if (status === 401 || status === 403) {
      return 'auth';
    }

    // Quota/rate-limit errors
    if (status === 429) {
      return 'quota';
    }

    // Transient server errors (5xx)
    if (status >= 500 && status < 600) {
      return 'transient';
    }

    // Network errors (ECONNRESET, ETIMEDOUT, etc.)
    if (error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'EPIPE' ||
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('socket hang up') ||
        message.includes('fetch failed')) {
      return 'transient';
    }

    // Unknown client errors (4xx) are permanent
    if (status >= 400 && status < 500) {
      return 'permanent';
    }

    // Default to transient for unknown errors (safe retry)
    return 'transient';
  }

  /**
   * Calculate exponential backoff delay
   * @param {number} attempt - Current attempt (0-indexed)
   * @returns {number} Delay in milliseconds
   */
  getBackoffMs(attempt) {
    return Math.min(this.baseDelayMs * Math.pow(2, attempt), this.maxDelayMs);
  }

  /** @private */
  _extractRetryAfter(error) {
    // Try to extract retry-after from error or headers
    if (error.retryAfter) return Number(error.retryAfter) * 1000;
    if (error.headers?.['retry-after']) return Number(error.headers['retry-after']) * 1000;
    // Default: 60 seconds for quota errors
    return 60000;
  }

  /** @private */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Per-provider health tracking with circuit-breaker pattern.
 */
export class ProviderHealthTracker {
  /**
   * @param {Object} options
   * @param {number} options.failureThreshold - Failures before backoff (default: 3)
   * @param {number} options.backoffMs - Backoff duration in ms (default: 5min)
   */
  constructor({ failureThreshold = 3, backoffMs = 300000 } = {}) {
    this.failureThreshold = failureThreshold;
    this.backoffMs = backoffMs;
    this.providers = new Map();
  }

  /**
   * Record a failure for a provider
   * @param {string} provider - Provider name
   */
  recordFailure(provider) {
    const entry = this.providers.get(provider) || { failures: 0, backoffUntil: null, lastError: null };
    entry.failures++;
    entry.lastError = new Date().toISOString();

    if (entry.failures >= this.failureThreshold) {
      entry.backoffUntil = Date.now() + this.backoffMs;
    }

    this.providers.set(provider, entry);
  }

  /**
   * Record a success for a provider (resets failure count)
   * @param {string} provider - Provider name
   */
  recordSuccess(provider) {
    const entry = this.providers.get(provider) || { failures: 0, backoffUntil: null, lastError: null };
    entry.failures = 0;
    entry.backoffUntil = null;
    entry.lastError = null;
    this.providers.set(provider, entry);
  }

  /**
   * Check if a provider is healthy (not in backoff)
   * @param {string} provider - Provider name
   * @returns {boolean}
   */
  isHealthy(provider) {
    const entry = this.providers.get(provider);
    if (!entry) return true; // Unknown provider = healthy

    if (entry.failures >= this.failureThreshold) {
      // Check if backoff period has elapsed
      if (entry.backoffUntil && entry.backoffUntil > Date.now()) {
        return false;
      }
      // Backoff elapsed, reset
      entry.failures = 0;
      entry.backoffUntil = null;
      this.providers.set(provider, entry);
    }

    return true;
  }

  /**
   * Reset health tracking for a provider
   * @param {string} provider - Provider name
   */
  reset(provider) {
    this.providers.delete(provider);
  }

  /**
   * Get health status for all tracked providers
   * @returns {{providers: Object<string, {status: string, failures: number, backoffUntil: string|null}>}}
   */
  getHealthStatus() {
    const providers = {};

    for (const [name, entry] of this.providers.entries()) {
      const inBackoff = entry.backoffUntil && entry.backoffUntil > Date.now();
      providers[name] = {
        status: inBackoff ? 'backoff' : (entry.failures > 0 ? 'degraded' : 'healthy'),
        failures: entry.failures,
        backoffUntil: inBackoff ? new Date(entry.backoffUntil).toISOString() : null,
        lastError: entry.lastError
      };
    }

    return { providers };
  }
}

// Export singletons for convenience
export const defaultRetryPolicy = new RetryPolicy();
export const healthTracker = new ProviderHealthTracker();
