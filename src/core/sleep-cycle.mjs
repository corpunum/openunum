/**
 * Sleep Cycle (R9)
 * 
 * Manages idle detection, sleep mode entry (compaction + consolidation),
 * and wake events.
 */

export class SleepCycle {
  /**
   * @param {object} opts
   * @param {Function} opts.compactFn - Function to run aggressive context compaction
   * @param {object} opts.consolidator - MemoryConsolidator instance
   * @param {number} opts.idleThresholdMs - Idle time before sleep (default: 3600000 = 1 hour)
   * @param {Function} opts.onSleep - Optional callback when entering sleep
   * @param {Function} opts.onWake - Optional callback when waking
   */
  constructor({ compactFn, consolidator, idleThresholdMs = 3600000, onSleep, onWake } = {}) {
    this.compactFn = compactFn || null;
    this.consolidator = consolidator || null;
    this.idleThresholdMs = idleThresholdMs;
    this.onSleep = onSleep || null;
    this.onWake = onWake || null;

    this.state = 'awake'; // 'awake' | 'idle' | 'sleeping'
    this.lastActivityAt = Date.now();
    this.lastSleepAt = null;
    this.lastWakeAt = null;
    this.sleepEvents = [];
    this.compactionCount = 0;
    this.consolidationCount = 0;
  }

  /**
   * Check if the system has been idle long enough to enter sleep.
   * @param {number} lastActivityMs - Timestamp of last activity (ms). Defaults to this.lastActivityAt.
   * @returns {boolean}
   */
  checkIdle(lastActivityMs = null) {
    const elapsed = Date.now() - (lastActivityMs ?? this.lastActivityAt);
    return elapsed >= this.idleThresholdMs;
  }

  /**
   * Update the last activity timestamp (call on any user interaction).
   */
  touchActivity() {
    this.lastActivityAt = Date.now();
    if (this.state === 'sleeping') {
      this.wake('activity');
    }
  }

  /**
   * Enter sleep mode: compact + consolidate.
   * @returns {Promise<object>} Summary of what happened during sleep entry.
   */
  async enterSleepMode() {
    if (this.state === 'sleeping') {
      return { alreadySleeping: true };
    }

    this.state = 'sleeping';
    this.lastSleepAt = Date.now();

    const sleepEntry = {
      enteredAt: new Date().toISOString(),
      compaction: null,
      consolidation: null
    };

    // 1. Run aggressive context compaction
    if (this.compactFn) {
      try {
        sleepEntry.compaction = await this.compactFn({ aggressive: true });
        this.compactionCount++;
      } catch (err) {
        sleepEntry.compaction = { error: err.message };
      }
    }

    // 2. Run memory consolidation replay
    if (this.consolidator) {
      try {
        if (typeof this.consolidator.runAndStore === 'function') {
          sleepEntry.consolidation = this.consolidator.runAndStore();
          this.consolidationCount++;
        } else if (typeof this.consolidator.runReplayCycle === 'function') {
          sleepEntry.consolidation = this.consolidator.runReplayCycle();
          this.consolidationCount++;
        }
      } catch (err) {
        sleepEntry.consolidation = { error: err.message };
      }
    }

    // 3. Log sleep event
    this.sleepEvents.push(sleepEntry);

    // 4. Optional callback
    if (this.onSleep) {
      try { this.onSleep(sleepEntry); } catch { /* ignore callback errors */ }
    }

    return sleepEntry;
  }

  /**
   * Wake from sleep mode.
   * @param {string} event - What triggered the wake ('activity', 'message', 'scheduled', etc.)
   * @returns {Promise<object>} Summary of what happened during sleep.
   */
  async wake(event = 'unknown') {
    const wasSleeping = this.state === 'sleeping';
    const sleepDuration = this.lastSleepAt ? Date.now() - this.lastSleepAt : 0;

    this.state = 'awake';
    this.lastWakeAt = Date.now();
    this.lastActivityAt = Date.now();

    const wakeSummary = {
      wokeAt: new Date().toISOString(),
      trigger: event,
      wasSleeping,
      sleepDurationMs: sleepDuration,
      compactions: this.compactionCount,
      consolidations: this.consolidationCount,
      sleepEvents: this.sleepEvents.slice(-5) // Last 5 sleep events
    };

    // Optional callback
    if (this.onWake) {
      try { this.onWake(wakeSummary); } catch { /* ignore callback errors */ }
    }

    return wakeSummary;
  }

  /**
   * Get current sleep cycle state.
   * @returns {object}
   */
  getState() {
    return {
      state: this.state,
      lastActivityAt: this.lastActivityAt,
      lastSleepAt: this.lastSleepAt,
      lastWakeAt: this.lastWakeAt,
      idleMs: Date.now() - this.lastActivityAt,
      idleThresholdMs: this.idleThresholdMs,
      isIdle: this.checkIdle(),
      compactionCount: this.compactionCount,
      consolidationCount: this.consolidationCount,
      totalSleepEvents: this.sleepEvents.length
    };
  }

  /**
   * Check if idle threshold is exceeded and auto-enter sleep if needed.
   * @returns {Promise<{triggered: boolean, state: string}>}
   */
  async checkAndSleep() {
    if (this.state === 'sleeping') {
      return { triggered: false, state: 'sleeping' };
    }

    if (this.checkIdle()) {
      await this.enterSleepMode();
      return { triggered: true, state: 'sleeping' };
    }

    return { triggered: false, state: this.state };
  }
}
