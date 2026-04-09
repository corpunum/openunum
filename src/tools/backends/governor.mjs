export class ModelBackedToolsGovernor {
  constructor(config = {}) {
    const cfg = config?.runtime?.modelBackedTools || {};
    this.maxConcurrentLocal = Number.isFinite(cfg.localMaxConcurrency) ? Math.max(1, Number(cfg.localMaxConcurrency)) : 1;
    this.maxQueueDepth = Number.isFinite(cfg.queueDepth) ? Math.max(1, Number(cfg.queueDepth)) : 8;
    this.localActive = 0;
    this.localQueue = [];
  }

  async runLocal(taskFn) {
    if (this.localActive >= this.maxConcurrentLocal && this.localQueue.length >= this.maxQueueDepth) {
      return { ok: false, error: 'resource_denied', details: 'model-backed local queue is full' };
    }

    if (this.localActive >= this.maxConcurrentLocal) {
      return new Promise((resolve) => {
        this.localQueue.push(async () => {
          const out = await this.runLocal(taskFn);
          resolve(out);
        });
      });
    }

    this.localActive += 1;
    try {
      return await taskFn();
    } finally {
      this.localActive = Math.max(0, this.localActive - 1);
      const next = this.localQueue.shift();
      if (typeof next === 'function') {
        Promise.resolve().then(next).catch(() => {});
      }
    }
  }
}

