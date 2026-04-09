function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function nowIso() {
  return new Date().toISOString();
}

function profileKey(profile = {}) {
  const id = String(profile?.id || '').trim();
  if (id) return id;
  const provider = String(profile?.provider || '').trim();
  const model = String(profile?.model || '').trim();
  return `${provider}/${model}`;
}

function estimateCostScore(profile = {}) {
  const provider = String(profile?.provider || '').trim().toLowerCase();
  if (!provider) return 3;
  if (provider === 'ollama-local') return 1;
  if (provider === 'ollama-cloud') return 3;
  if (provider === 'openrouter' || provider === 'openai' || provider === 'nvidia' || provider === 'xiaomimimo') return 4;
  return 3;
}

export class ModelBackedToolsTelemetry {
  constructor(config = {}) {
    this.config = config;
    this.stats = new Map();
  }

  tuningConfig() {
    const cfg = this.config?.runtime?.modelBackedTools || {};
    return {
      enabled: cfg.autoProfileTuningEnabled !== false,
      minSamples: clamp(cfg.profileSwitchMinSamples, 1, 1000, 6),
      latencyWeight: clamp(cfg.latencyWeight, 0, 1, 0.35),
      costWeight: clamp(cfg.costWeight, 0, 1, 0.25),
      failurePenalty: clamp(cfg.failurePenalty, 0, 4, 0.8)
    };
  }

  statKey(toolName, profile = {}) {
    return `${String(toolName || '').trim()}::${profileKey(profile)}`;
  }

  ensureStat(toolName, profile = {}) {
    const key = this.statKey(toolName, profile);
    if (!this.stats.has(key)) {
      this.stats.set(key, {
        tool: String(toolName || '').trim(),
        profileKey: profileKey(profile),
        profile: {
          id: String(profile?.id || '').trim(),
          provider: String(profile?.provider || '').trim(),
          model: String(profile?.model || '').trim()
        },
        calls: 0,
        success: 0,
        failure: 0,
        consecutiveFailures: 0,
        avgLatencyMs: 0,
        lastLatencyMs: 0,
        lastError: '',
        lastUsedAt: ''
      });
    }
    return this.stats.get(key);
  }

  record(toolName, profile = {}, { ok = false, latencyMs = 0, error = '' } = {}) {
    const row = this.ensureStat(toolName, profile);
    const latency = Math.max(0, Number(latencyMs) || 0);
    row.calls += 1;
    row.lastLatencyMs = latency;
    row.avgLatencyMs = row.avgLatencyMs === 0
      ? latency
      : (row.avgLatencyMs * 0.8 + latency * 0.2);
    row.lastUsedAt = nowIso();
    if (ok) {
      row.success += 1;
      row.consecutiveFailures = 0;
      row.lastError = '';
    } else {
      row.failure += 1;
      row.consecutiveFailures += 1;
      row.lastError = String(error || 'backend_failed');
    }
  }

  successRate(row = {}) {
    const success = Number(row.success || 0);
    const calls = Number(row.calls || 0);
    return (success + 1) / (calls + 2);
  }

  profileScore(row = {}, profile = {}, tuning = this.tuningConfig()) {
    const successRate = this.successRate(row);
    const latencyPenalty = (Math.max(0, Number(row.avgLatencyMs || 0)) / 30000) * tuning.latencyWeight;
    const costPenalty = (estimateCostScore(profile) / 5) * tuning.costWeight;
    const failurePenalty = Math.max(0, Number(row.consecutiveFailures || 0)) * tuning.failurePenalty;
    return (successRate * 2) - latencyPenalty - costPenalty - failurePenalty;
  }

  orderProfiles(toolName, profiles = []) {
    const rows = Array.isArray(profiles) ? profiles.slice() : [];
    const tuning = this.tuningConfig();
    if (!tuning.enabled || rows.length <= 1) return rows;
    const totalCalls = rows.reduce((acc, profile) => acc + Number(this.ensureStat(toolName, profile).calls || 0), 0);
    if (totalCalls < tuning.minSamples) return rows;
    return rows
      .map((profile, index) => {
        const stat = this.ensureStat(toolName, profile);
        return {
          profile,
          index,
          score: this.profileScore(stat, profile, tuning)
        };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.index - b.index;
      })
      .map((row) => row.profile);
  }

  getStatsForTool(toolName) {
    const safeTool = String(toolName || '').trim();
    return [...this.stats.values()]
      .filter((row) => row.tool === safeTool)
      .map((row) => ({
        ...row,
        successRate: this.successRate(row)
      }))
      .sort((a, b) => b.successRate - a.successRate);
  }

  snapshot() {
    const out = {};
    for (const row of this.stats.values()) {
      if (!out[row.tool]) out[row.tool] = [];
      out[row.tool].push({
        ...row,
        successRate: this.successRate(row)
      });
    }
    return out;
  }
}
