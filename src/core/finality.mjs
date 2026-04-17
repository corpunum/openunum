import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class FinalityGadget {
  constructor({ requiredSuccesses = 3, statePath = null } = {}) {
    this.requiredSuccesses = requiredSuccesses;
    this.executionHistory = new Map(); // id -> [{success, timestamp}]
    this.finalized = new Map(); // id -> {finalizedAt, checkpoint}
    this.statePath = statePath || path.join(process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum'), 'finality-state.json');
    this.loadState();
  }

  loadState() {
    try {
      if (!fs.existsSync(this.statePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      this.executionHistory = new Map(Object.entries(raw?.executionHistory || {}));
      this.finalized = new Map(Object.entries(raw?.finalized || {}));
    } catch {
      this.executionHistory = new Map();
      this.finalized = new Map();
    }
  }

  saveState() {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify({
      executionHistory: Object.fromEntries(this.executionHistory.entries()),
      finalized: Object.fromEntries(this.finalized.entries())
    }, null, 2), 'utf8');
  }

  async recordExecution(executionId, success, metadata = {}) {
    const history = this.executionHistory.get(executionId) || [];
    const nextHistory = [...history, { success, timestamp: Date.now() }].slice(-12);
    this.executionHistory.set(executionId, nextHistory);
    if (success) {
      const consecutive = this.countConsecutiveSuccesses(nextHistory);
      if (consecutive >= this.requiredSuccesses) {
        return this.finalize(executionId, metadata, consecutive);
      }
      this.saveState();
      return { finalized: false, consecutiveSuccesses: consecutive };
    }
    this.finalized.delete(executionId);
    this.saveState();
    return { finalized: false, consecutiveSuccesses: this.countConsecutiveSuccesses(nextHistory) };
  }
  
  countConsecutiveSuccesses(history) {
    let count = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].success) count++;
      else break;
    }
    return count;
  }
  
  async finalize(executionId, metadata = {}, consecutiveSuccesses = this.requiredSuccesses) {
    const checkpoint = { finalizedAt: Date.now(), executionId, ...metadata };
    this.finalized.set(executionId, checkpoint);
    this.saveState();
    return { finalized: true, checkpoint, consecutiveSuccesses };
  }
  
  async isFinalized(executionId) {
    return this.finalized.has(executionId);
  }
  
  async getFinalityCheckpoint(executionId) {
    return this.finalized.get(executionId) || null;
  }
}
