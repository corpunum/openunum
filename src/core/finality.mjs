export class FinalityGadget {
  constructor({ requiredSuccesses = 3 } = {}) {
    this.requiredSuccesses = requiredSuccesses;
    this.executionHistory = new Map(); // id -> [{success, timestamp}]
    this.finalized = new Map(); // id -> {finalizedAt, checkpoint}
  }
  
  async recordExecution(executionId, success) {
    const history = this.executionHistory.get(executionId) || [];
    history.push({ success, timestamp: Date.now() });
    this.executionHistory.set(executionId, history);
    if (success) {
      const consecutive = this.countConsecutiveSuccesses(history);
      if (consecutive >= this.requiredSuccesses) {
        return this.finalize(executionId);
      }
    }
    return { finalized: false };
  }
  
  countConsecutiveSuccesses(history) {
    let count = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].success) count++;
      else break;
    }
    return count;
  }
  
  async finalize(executionId) {
    const checkpoint = { finalizedAt: Date.now(), executionId };
    this.finalized.set(executionId, checkpoint);
    return { finalized: true, checkpoint };
  }
  
  async isFinalized(executionId) {
    return this.finalized.has(executionId);
  }
  
  async getFinalityCheckpoint(executionId) {
    return this.finalized.get(executionId) || null;
  }
}
