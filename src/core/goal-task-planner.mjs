import crypto from 'node:crypto';

function trim(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function words(text) {
  return trim(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function hasAny(text, terms = []) {
  const source = ` ${trim(text).toLowerCase()} `;
  return terms.some((term) => {
    const termLower = String(term).toLowerCase();
    // Exact word match with word boundaries
    return source.includes(` ${termLower} `) ||
           source.startsWith(`${termLower} `) ||
           source.endsWith(` ${termLower}`) ||
           (source.length === termLower.length + 2 && source === ` ${termLower} `);
  });
}

function cap(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function buildSearchQuery(goal) {
  const stop = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'about', 'please', 'best']);
  const terms = words(goal).filter((token) => token.length > 2 && !stop.has(token));
  return terms.slice(0, 12).join(' ') || trim(goal);
}

function makeTaskSessionId(prefix = 'task') {
  return `${prefix}:${crypto.randomUUID()}`;
}

function classifyGoal(goal) {
  const text = trim(goal).toLowerCase();
  const isDefinitelyModelRelated =
    hasAny(text, ['huggingface', 'ollama', 'gguf', 'ggml', 'safetensors']) ||
    (hasAny(text, ['model', 'models', 'llm', 'llms']) &&
     hasAny(text, ['search', 'research', 'find', 'compare', 'download', 'import', 'best', 'open source', 'available', 'recommend', 'benchmark', 'evaluate', 'test']));

  return {
    wantsSearch: hasAny(text, ['search', 'research', 'find', 'browse', 'compare', 'online', 'latest']) &&
                 !isDefinitelyModelRelated,
    wantsRuntime: hasAny(text, ['runtime', 'inventory', 'health', 'status', 'monitor', 'service', 'port', 'host', 'hardware']),
    wantsCode: hasAny(text, ['fix', 'implement', 'refactor', 'edit', 'patch', 'write', 'code', 'bug', 'test', 'build', 'frontend', 'backend', 'ui', 'server']),
    wantsDiagnose: hasAny(text, ['diagnose', 'debug', 'investigate', 'why', 'broken', 'failing', 'error']),
    wantsDeploy: hasAny(text, ['deploy', 'release', 'publish', 'ship', 'rollout']),
    wantsBenchmark: hasAny(text, ['benchmark', 'profile', 'latency', 'speed', 'throughput', 'compare performance']),
    wantsSync: hasAny(text, ['sync', 'mirror', 'backup', 'upload', 'download', 'pull latest']),
    wantsCleanup: hasAny(text, ['cleanup', 'clean up', 'prune', 'remove old', 'delete temp']),
    wantsModelScout: isDefinitelyModelRelated,
    wantsFilesystem: hasAny(text, ['repo', 'workspace', 'file', 'directory', 'project'])
  };
}

export { classifyGoal };

export class GoalTaskPlanner {
  constructor({ runtime = {}, baseUrl = 'http://127.0.0.1:18880', workspaceRoot = process.cwd() } = {}) {
    this.runtime = runtime;
    this.baseUrl = baseUrl;
    this.workspaceRoot = workspaceRoot;
  }

  plan(payload = {}) {
    const goal = trim(payload.goal);
    if (!goal) return { ok: false, error: 'goal is required' };
    const runtime = payload.runtime && typeof payload.runtime === 'object' ? payload.runtime : this.runtime;
    const baseUrl = trim(payload.baseUrl, this.baseUrl);
    const cls = classifyGoal(goal);
    const steps = [];
    const plan = [];
    const verify = [];
    const monitor = [];
    const sessionId = trim(payload.sessionId, makeTaskSessionId(payload.sessionPrefix || 'task'));
    const missionPayload = {
      sessionId,
      maxSteps: cap(runtime?.missionDefaultHardStepCap, 2, 24, 8),
      intervalMs: cap(runtime?.missionDefaultIntervalMs, 0, 5000, 250),
      continueUntilDone: true,
      hardStepCap: cap(runtime?.missionDefaultHardStepCap, 2, 120, 12),
      maxRetries: cap(runtime?.missionDefaultMaxRetries, 0, 6, 2)
    };

    if (cls.wantsRuntime) {
      plan.push('Inspect runtime state before taking action');
      steps.push({
        kind: 'tool',
        label: 'inspect runtime overview',
        tool: 'http_request',
        args: {
          method: 'GET',
          url: `${baseUrl}/api/runtime/overview`
        },
        allowedTools: ['http_request'],
        timeoutMs: 5000
      });
      verify.push({ kind: 'step_ok', stepIndex: steps.length - 1, label: 'runtime overview fetched' });
      monitor.push({ kind: 'http', url: `${baseUrl}/api/runtime/inventory`, expectStatus: 200, label: 'runtime inventory reachable' });
    }

    if (cls.wantsSearch && !cls.wantsModelScout) {
      plan.push('Gather external context with one bounded search');
      steps.push({
        kind: 'tool',
        label: 'search external context',
        tool: 'browser_search',
        args: { query: buildSearchQuery(goal) },
        allowedTools: ['browser_search'],
        timeoutMs: 10000
      });
      verify.push({ kind: 'step_ok', stepIndex: steps.length - 1, label: 'search completed' });
    }

    if (cls.wantsFilesystem || cls.wantsCode) {
      plan.push('Inspect the workspace surface before acting');
      steps.push({
        kind: 'tool',
        label: 'inspect workspace files',
        tool: 'shell_run',
        args: {
          cmd: "pwd && rg --files -g '!node_modules' -g '!dist' -g '!coverage' | head -n 80"
        },
        allowedTools: ['shell_run'],
        timeoutMs: 8000
      });
      verify.push({ kind: 'step_ok', stepIndex: steps.length - 1, label: 'workspace scan completed' });
    }

    if (cls.wantsDiagnose) {
      plan.push('Collect bounded diagnostics before deeper execution');
      steps.push({
        kind: 'tool',
        label: 'collect diagnostics',
        tool: 'shell_run',
        args: {
          cmd: "pwd && git status --short --branch || true && printf '\\n---\\n' && node -v && printf '\\n---\\n' && ps -eo pid,comm,%cpu,%mem --sort=-%cpu | head -n 12"
        },
        allowedTools: ['shell_run'],
        timeoutMs: 10000
      });
      verify.push({ kind: 'step_ok', stepIndex: steps.length - 1, label: 'diagnostics collected' });
    }

    if (cls.wantsBenchmark) {
      plan.push('Run a bounded local benchmark probe');
      steps.push({
        kind: 'tool',
        label: 'benchmark probe',
        tool: 'shell_run',
        args: {
          cmd: "date +%s%3N && node -e \"console.log('benchmark probe ready')\" && date +%s%3N"
        },
        allowedTools: ['shell_run'],
        timeoutMs: 8000
      });
      verify.push({ kind: 'step_ok', stepIndex: steps.length - 1, label: 'benchmark probe completed' });
    }

    if (cls.wantsDeploy) {
      plan.push('Verify deployment-facing health before acting');
      steps.push({
        kind: 'tool',
        label: 'deployment preflight',
        tool: 'http_request',
        args: {
          method: 'GET',
          url: `${baseUrl}/api/health`
        },
        allowedTools: ['http_request'],
        timeoutMs: 5000
      });
      verify.push({ kind: 'step_ok', stepIndex: steps.length - 1, label: 'deployment preflight passed' });
    }

    if (cls.wantsSync || cls.wantsCleanup) {
      plan.push('Inspect filesystem state before any sync or cleanup action');
      steps.push({
        kind: 'tool',
        label: 'filesystem state',
        tool: 'shell_run',
        args: {
          cmd: "pwd && du -sh . 2>/dev/null || true && printf '\\n---\\n' && find . -maxdepth 2 -type d \\( -name tmp -o -name dist -o -name coverage \\) 2>/dev/null | head -n 40"
        },
        allowedTools: ['shell_run'],
        timeoutMs: 10000
      });
      verify.push({ kind: 'step_ok', stepIndex: steps.length - 1, label: 'filesystem state inspected' });
    }

    if (cls.wantsModelScout) {
      plan.push('Use a bounded model discovery workflow when the goal is explicitly about models');
      steps.push({
        kind: 'model_scout',
        label: 'discover candidate models',
        payload: {
          query: buildSearchQuery(goal),
          limit: 6,
          downloadStrategy: 'metadata',
          monitorLocal: false
        },
        timeoutMs: 15000
      });
    }

    plan.push('Execute the goal through the autonomous mission controller');
    steps.push({
      kind: 'mission',
      label: 'execute autonomous goal',
      goal,
      payload: missionPayload,
      timeoutMs: cap(payload.missionTimeoutMs, 2000, 60000, 12000),
      pollMs: 500
    });
    verify.push({ kind: 'step_ok', stepIndex: steps.length - 1, label: 'mission step completed' });

    return {
      ok: true,
      payload: {
        goal,
        sessionId,
        planning: {
          classifier: cls,
          baseUrl
        },
        plan,
        steps,
        verify,
        monitor
      }
    };
  }
}
