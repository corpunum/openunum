import crypto from 'node:crypto';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MissionTurnTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`mission_turn_timeout_${timeoutMs}ms`);
    this.name = 'MissionTurnTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new MissionTurnTimeoutError(timeoutMs)), timeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function trimLine(text, maxChars = 220) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}...`;
}

function normalizeCmdSignature(cmd = '') {
  return String(cmd || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/["'`]/g, '')
    .replace(/\b\d+\b/g, '#')
    .trim()
    .slice(0, 220);
}

function normalizeHttpSignature(run = {}) {
  const method = String(run?.args?.method || 'GET').toUpperCase();
  const url = String(run?.args?.url || '').toLowerCase();
  const m = url.match(/^https?:\/\/[^/]+(\/[^?#]*)?/);
  const p = m ? m[1] || '/' : url.slice(0, 120);
  return `${method} ${p}`.trim().slice(0, 220);
}

function routeSignatureFromRun(run = {}) {
  const tool = String(run?.toolName || '').toLowerCase();
  if (tool === 'shell_run') return `shell:${normalizeCmdSignature(run?.args?.cmd || '')}`;
  if (tool === 'http_request') return `http:${normalizeHttpSignature(run)}`;
  if (tool.startsWith('browser_')) {
    return `browser:${tool}:${String(run?.args?.url || run?.args?.query || '').toLowerCase().slice(0, 140)}`;
  }
  return `tool:${tool}:${Object.keys(run?.args || {}).sort().join(',')}`.slice(0, 220);
}

function routeSurfaceFromRun(run = {}) {
  const tool = String(run?.toolName || '').toLowerCase();
  if (tool === 'shell_run') return 'shell';
  if (tool === 'http_request') return 'http';
  if (tool.startsWith('browser_')) return 'browser';
  if (tool.startsWith('file_')) return 'file';
  return 'tool';
}

function buildMissionPrompt(mission, { firstTurn = false, workspaceRoot = '', runtimeHints = [], providerHint = '' } = {}) {
  const lastCheckpoint = mission.lastCheckpoint ? `Previous checkpoint: ${mission.lastCheckpoint}\n` : '';
  const recoveryHint = mission.recoveryHint ? `Recovery directive: ${mission.recoveryHint}\n` : '';
  const stallHint = mission.noProgressTurns > 0
    ? `Stall warning: ${mission.noProgressTurns} turn(s) without new proof. You must either create new proof this turn or pivot to a different route.\n`
    : '';
  const workspaceHint = workspaceRoot
    ? `Workspace root for file tools: ${workspaceRoot}. file_read/file_write/file_patch only work inside this root. Use shell_run for /tmp or other external paths.\n`
    : '';
  const localRuntimeHint = isLocalRuntimeMission(mission.goal)
    ? 'Local-runtime guidance:\n' +
      '- Inspect existing local runtimes and imported models before creating anything new.\n' +
      '- If `ollama list` already shows a matching local model, prefer verifying it with one short prompt instead of importing another duplicate.\n' +
      '- Prefer decisive proof over low-value internals: once you have a plausible runtime target, verify it directly instead of inspecting blob paths or metadata.\n' +
      '- Prefer non-interactive verification surfaces when available: HTTP/JSON API or one-shot batch command first, interactive REPL/TTY path last.\n'
    : '';
  const dynamicHints = Array.isArray(runtimeHints) && runtimeHints.length
    ? `Runtime hints:\n${runtimeHints.map((line) => `- ${line}`).join('\n')}\n`
    : '';
  const providerSurfaceHint = providerHint ? `Provider path hint:\n- ${providerHint}\n` : '';
  const goalLine = firstTurn ? `Autonomous mission goal: ${mission.goal}` : `Continue autonomous mission: ${mission.goal}`;
  const contract = mission.contract || inferMissionContract(mission.goal);
  const contractLine = `Mission completion contract: ${contract.id}. DONE is valid only when checkpoint + proof requirements are satisfied.`;
  return `${goalLine}
${lastCheckpoint}${recoveryHint}${stallHint}${workspaceHint}${localRuntimeHint}${providerSurfaceHint}${dynamicHints}${contractLine}
Execution contract:
- Do exactly one verified substep per turn.
- Prefer shell-first local inspection for local-machine tasks.
- If uncertain, inspect current state before choosing a tool.
- If a route fails twice, pivot to a different route without asking for help.
- Do not dump large logs into your answer; summarize proof from tool results.
At the end of this turn append exactly:
CHECKPOINT: <one concise line>
MISSION_STATUS: DONE
or
CHECKPOINT: <one concise line>
MISSION_STATUS: CONTINUE`;
}

function isLocalRuntimeMission(goal) {
  const text = String(goal || '').toLowerCase();
  return /local|gguf|ollama|llama\.cpp|runtime|launch|server|model/.test(text);
}

function hasProviderFailureSignal(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  return /all configured providers failed|provider failed|unauthorized|401|api key|authentication|invalid api key|model .* not found/.test(t);
}

function inferMissionContract(goal = '') {
  const text = String(goal || '').toLowerCase();
  const localRuntime = /local|gguf|ollama|llama\.cpp|runtime|launch|server|model/.test(text);
  const coding = /fix|implement|refactor|code|bug|test|compile|build/.test(text);
  return {
    id: localRuntime ? 'local-runtime-proof-v1' : coding ? 'coding-proof-v1' : 'generic-proof-v1',
    requireMissionDoneMarker: true,
    requireCheckpoint: true,
    requireProofSignals: true,
    requireLocalRuntimeProof: localRuntime
  };
}

function evaluateMissionContract({ contract, replyText, checkpoint, newProof, localResponseProof }) {
  const text = String(replyText || '');
  const violations = [];
  if (contract.requireMissionDoneMarker && !/MISSION_STATUS:\s*DONE/i.test(text)) {
    violations.push('missing_done_marker');
  }
  if (contract.requireCheckpoint && !String(checkpoint || '').trim()) {
    violations.push('missing_checkpoint');
  }
  if (contract.requireProofSignals && !(newProof || localResponseProof)) {
    violations.push('missing_proof_signal');
  }
  if (contract.requireLocalRuntimeProof && !localResponseProof) {
    violations.push('missing_local_runtime_proof');
  }
  return {
    pass: violations.length === 0,
    violations
  };
}

function deriveRuntimeHints(mission, recentToolRuns = [], memoryStore = null) {
  const hints = [];
  if (!Array.isArray(recentToolRuns) || recentToolRuns.length === 0) return hints;
  const shellRuns = recentToolRuns.filter((run) => run?.toolName === 'shell_run');
  const httpRuns = recentToolRuns.filter((run) => run?.toolName === 'http_request');
  const failedRuns = recentToolRuns.filter((run) => run?.ok === false);
  const routeFailureCount = new Map();
  for (const run of failedRuns) {
    const tool = String(run?.toolName || '').toLowerCase();
    const keyRaw = tool === 'shell_run'
      ? String(run?.args?.cmd || '')
      : tool === 'http_request'
        ? String(run?.args?.url || '')
        : JSON.stringify(run?.args || {});
    const routeKey = `${tool}:${keyRaw}`.slice(0, 280);
    routeFailureCount.set(routeKey, (routeFailureCount.get(routeKey) || 0) + 1);
  }
  const shellCmds = shellRuns.map((run) => String(run?.args?.cmd || '').toLowerCase());
  const shellErrors = recentToolRuns.map((run) => String(run?.result?.error || '').toLowerCase()).filter(Boolean);
  const httpUrls = httpRuns.map((run) => String(run?.args?.url || '').toLowerCase());
  const httpErrors = httpRuns.map((run) => String(run?.result?.error || '').toLowerCase()).filter(Boolean);
  const interactiveAttempts = shellCmds.filter((cmd) => /ollama run|python\s+-i|node\s+-i|sqlite3\b|psql\b|mysql\b/.test(cmd)).length;
  if (shellErrors.some((error) => error.includes('path outside workspace is blocked'))) {
    hints.push('A recent file tool failed outside workspace. Use shell_run for /tmp or external paths.');
  }
  if (interactiveAttempts >= 1 && shellErrors.length > 0) {
    hints.push('A recent route looks interactive or REPL-like. Prefer a machine-readable API or one-shot batch command if the tool/service exposes one.');
  }
  const repeatedRouteFailure = [...routeFailureCount.values()].some((count) => count >= 2);
  if (repeatedRouteFailure) {
    hints.push('The same execution route failed repeatedly. Do not retry it unchanged; switch to a different tool/runtime surface with a narrower verification step.');
  }
  if (isLocalRuntimeMission(mission.goal)) {
    const metadataInspections = shellCmds.filter((cmd) => /blob|sha256|ollama show|find .*\.ollama|show .*--json/.test(cmd)).length;
    const directLaunches = shellCmds.filter((cmd) => /ollama run|llama-cli|llama-server|python .*llama/.test(cmd)).length;
    if (metadataInspections >= 2 && directLaunches === 0) {
      hints.push('Stop inspecting blob paths and metadata. The next verified step should be a direct short launch/test command against the best existing candidate model.');
    }
    const createAttempts = shellCmds.filter((cmd) => /ollama create/.test(cmd)).length;
    const listChecks = shellCmds.filter((cmd) => /ollama list/.test(cmd)).length;
    if (createAttempts >= 1 && listChecks >= 1 && directLaunches === 0) {
      hints.push('You already have enough evidence to try a direct `ollama run` verification. Prefer that over another create or show command.');
    }
    const ollamaGenerateTimedOut =
      httpErrors.some((error) => error.includes('aborted due to timeout')) && httpUrls.some((url) => url.includes('/api/generate')) ||
      shellErrors.some((error) => error.includes('aborted due to timeout') || error.includes('command failed')) &&
        shellCmds.some((cmd) => cmd.includes('/api/generate'));
    if (ollamaGenerateTimedOut) {
      hints.push('Ollama generation on this machine timed out. Do not repeat the same verification path immediately. Reduce verification scope sharply or pivot to a different local runtime/route.');
    }
    if (shellCmds.some((cmd) => cmd.includes('invalid model name'))) {
      hints.push('A recent local generation attempt used the wrong model identifier. Reuse an exact model name from `ollama list`.');
    }
    if (shellErrors.some((error) => error.includes('unknown command "invoke" for "ollama"'))) {
      hints.push('Do not use `ollama invoke`; this Ollama build does not support it. Pivot immediately to the local HTTP API or to a valid non-interactive `ollama run` form such as piping a short prompt on stdin.');
    }
    if (shellErrors.some((error) => error.includes('unknown flag: --prompt'))) {
      hints.push('Do not use `ollama run --prompt`; this Ollama build expects the prompt as a positional argument or on stdin. Prefer the HTTP API if you need a stable non-interactive verification path.');
    }
    if (shellCmds.some((cmd) => cmd.includes('systemctl status ollama-http-server'))) {
      hints.push('Do not probe systemd for an `ollama-http-server` service. The stable local API endpoint here is the Ollama base URL itself, typically `http://127.0.0.1:11434/api/generate`.');
    }
    if (shellCmds.some((cmd) => cmd.includes('ollama list')) && httpUrls.length === 0 && directLaunches === 0) {
      hints.push('After `ollama list`, prefer one bounded API verification call to the local Ollama base URL or pivot directly to `llama_cpp_python` if the API path already timed out.');
    }
    const exhaustedLocalRoutes =
      repeatedRouteFailure &&
      (shellErrors.length + httpErrors.length) >= 3 &&
      !recentToolRuns.some((run) => run?.ok === true);
    if (exhaustedLocalRoutes) {
      hints.push('Local routes are failing repeatedly. Use web research to find a different launch/verification approach for this exact runtime error, then apply one changed attempt and record result.');
    }
    const localResponseProof = recentToolRuns.some((run) => {
      const stdout = String(run?.result?.stdout || '');
      const text = String(run?.result?.text || '');
      return run?.toolName === 'shell_run' &&
        run?.ok !== false &&
        (/RESPONSE:\s*/.test(stdout) || /Thinking Process:/i.test(stdout) || /Assistant:/i.test(stdout) || /choices/.test(text));
    });
    if (localResponseProof) {
      hints.push('You already have proof that a local runtime loaded the target GGUF and produced output. Do not keep probing. Summarize the exact proof and finish the mission if the launch path is valid.');
    }
  }
  if (memoryStore?.getRouteGuidance) {
    const guidance = memoryStore.getRouteGuidance({ goal: mission.goal, limit: 8 });
    const unstableRoute = guidance.find((g) => g.failureCount >= 2 && g.successCount === 0);
    if (unstableRoute) {
      hints.push(`Historical lesson: route \`${unstableRoute.routeSignature}\` keeps failing. Prefer a different surface first.`);
    }
    const stableRoute = guidance.find((g) => g.successCount >= 2 && g.successRate >= 0.6);
    if (stableRoute) {
      hints.push(`Historical lesson: route \`${stableRoute.routeSignature}\` is usually reliable. Try it early for proof.`);
    }
  }
  return [...new Set(hints)].slice(0, 4);
}

function deriveProviderHint(currentModel) {
  const provider = String(currentModel?.activeProvider || currentModel?.provider || '').toLowerCase();
  const model = String(currentModel?.activeModel || currentModel?.model || '').toLowerCase();
  if (provider === 'ollama-local' || provider === 'ollama-cloud' || provider === 'ollama') {
    return 'For local Ollama verification, prefer the local HTTP/JSON API over interactive `ollama run` if both are available, and use the `http_request` tool instead of `shell_run` with curl when possible.';
  }
  if (provider === 'nvidia' || provider === 'openrouter' || provider === 'openai') {
    return `Current controller is ${provider}${model ? ` (${model})` : ''}. Keep reasoning compact and prefer API-shaped, machine-readable verification paths over interactive shell routes, using the \`http_request\` tool for JSON APIs when possible.`;
  }
  return '';
}

function findLocalResponseProof(recentToolRuns = []) {
  if (!Array.isArray(recentToolRuns) || recentToolRuns.length === 0) return null;
  for (const run of [...recentToolRuns].reverse()) {
    if (!run || run.ok === false) continue;
    const toolName = String(run?.toolName || '').trim().toLowerCase();
    const url = String(run?.args?.url || '').toLowerCase();
    const json = run?.result?.json && typeof run.result.json === 'object' ? run.result.json : null;
    if (toolName === 'http_request' && /\/api\/(generate|chat)\b/.test(url)) {
      const responseText =
        String(json?.response || json?.message?.content || json?.message || '').trim();
      const doneFlag = json?.done === true || json?.done === 'true';
      if (responseText || doneFlag) {
        return {
          toolName: run.toolName,
          cmd: trimLine(String(run?.args?.url || ''), 180),
          summary: trimLine(
            `HTTP runtime proof: ${responseText ? responseText.slice(0, 140) : 'model returned done=true'}`,
            220
          ),
          at: run.finishedAt || run.startedAt || null
        };
      }
    }
    const stdout = String(run?.result?.stdout || '');
    const stderr = String(run?.result?.stderr || '');
    const text = String(run?.result?.text || '');
    const combined = `${stdout}\n${stderr}\n${text}`;
    if (!/VERIFIED:\s*Model responded successfully|RESPONSE:|Response in \d+(\.\d+)?s:|Assistant:|Thinking Process:/i.test(combined)) {
      continue;
    }
    const cmd = trimLine(String(run?.args?.cmd || ''), 180);
    const summary = trimLine(
      combined
        .replace(/\x1b\[[0-9;]*m/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .find((line) => /VERIFIED:\s*Model responded successfully|RESPONSE:|Response in \d+(\.\d+)?s:|Assistant:|Thinking Process:/i.test(line)) || '',
      220
    );
    return {
      toolName: run.toolName,
      cmd,
      summary: summary || 'Local runtime produced model output.',
      at: run.finishedAt || run.startedAt || null
    };
  }
  return null;
}

export class MissionRunner {
  constructor({ agent, memoryStore, config = null }) {
    this.agent = agent;
    this.memoryStore = memoryStore;
    this.config = config;
    this.missions = new Map();
    this.scheduleTimer = null;
    this.schedulePollMs = 5000;
    this.memoryStore?.markRunningMissionsInterrupted?.();
    this.startScheduleLoop();
  }

  list() {
    const active = [...this.missions.values()].map((m) => ({
      id: m.id,
      goal: m.goal,
      status: m.status,
      startedAt: m.startedAt,
      finishedAt: m.finishedAt,
      step: m.step,
      maxSteps: m.maxSteps,
      sessionId: m.sessionId,
      error: m.error || null,
      contract: m.contract || null,
      contractFailures: Number(m.contractFailures || 0),
      rollbackAttempts: Number(m.rollbackAttempts || 0)
    }));
    const persisted = this.memoryStore?.listMissionRecords
      ? this.memoryStore.listMissionRecords(120)
      : [];
    const seen = new Set(active.map((item) => item.id));
    for (const m of persisted) {
      if (!m?.id || seen.has(m.id)) continue;
      active.push({
        id: m.id,
        goal: m.goal,
        status: m.status,
        startedAt: m.startedAt,
        finishedAt: m.finishedAt,
        step: m.step,
        maxSteps: m.maxSteps,
        sessionId: m.sessionId,
        error: m.error || null,
        contract: m.contract || null,
        contractFailures: Number(m.contractFailures || 0),
        rollbackAttempts: Number(m.rollbackAttempts || 0)
      });
    }
    active.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
    return active;
  }

  get(id) {
    const missionId = String(id || '').trim();
    if (!missionId) return null;
    const active = this.missions.get(missionId);
    if (active) return active;
    return this.memoryStore?.getMissionRecord
      ? this.memoryStore.getMissionRecord(missionId)
      : null;
  }

  stop(id) {
    const mission = this.missions.get(id);
    if (!mission) return { ok: false, error: 'mission_not_found' };
    mission.stopRequested = true;
    if (mission.status === 'running') mission.status = 'stopping';
    this.persistMission(mission);
    return { ok: true, id, status: mission.status };
  }

  start({ goal, maxSteps = 6, intervalMs = 400, maxRetries = 3, continueUntilDone = true, hardStepCap = 120, sessionId = '' }) {
    const trimmedGoal = String(goal || '').trim();
    if (!trimmedGoal) throw new Error('goal is required');
    const id = crypto.randomUUID();
    const resolvedSessionId = String(sessionId || '').trim() || `mission:${id}`;
    const mission = {
      id,
      goal: trimmedGoal,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      step: 0,
      maxSteps: Number(maxSteps) > 0 ? Number(maxSteps) : 6,
      maxRetries: Number(maxRetries) >= 0 ? Number(maxRetries) : 3,
      continueUntilDone: continueUntilDone !== false,
      hardStepCap: Number(hardStepCap) > 0 ? Number(hardStepCap) : 120,
      intervalMs: Number(intervalMs) >= 0 ? Number(intervalMs) : 400,
      stopRequested: false,
      sessionId: resolvedSessionId,
      log: [],
      retries: 0,
      error: null,
      noProgressTurns: 0,
      repeatedReplyTurns: 0,
      lastReply: '',
      lastCheckpoint: '',
      recoveryHint: '',
      contract: inferMissionContract(trimmedGoal),
      contractFailures: 0,
      rollbackAttempts: 0,
      lastToolScanAt: new Date().toISOString(),
      routeLessonSeen: Object.create(null)
    };
    this.missions.set(id, mission);
    this.persistMission(mission);
    this.run(mission);
    return { ok: true, id, status: mission.status, sessionId: resolvedSessionId };
  }

  startSchedule({
    goal,
    runAt = '',
    delayMs = 0,
    intervalMs = 0,
    enabled = true,
    options = {}
  }) {
    const trimmedGoal = String(goal || '').trim();
    if (!trimmedGoal) throw new Error('goal is required');
    const nowMs = Date.now();
    const delay = Math.max(0, Number(delayMs || 0));
    const parsedRunAtMs = runAt ? Date.parse(String(runAt)) : NaN;
    const runAtMs = Number.isFinite(parsedRunAtMs) ? parsedRunAtMs : (nowMs + delay);
    const schedule = this.memoryStore?.createMissionSchedule
      ? this.memoryStore.createMissionSchedule({
        id: crypto.randomUUID(),
        goal: trimmedGoal,
        runAt: new Date(runAtMs).toISOString(),
        intervalMs: Math.max(0, Number(intervalMs || 0)),
        enabled: enabled !== false,
        options: {
          maxSteps: Number(options?.maxSteps || 0) || undefined,
          maxRetries: Number(options?.maxRetries || 0) || undefined,
          continueUntilDone: options?.continueUntilDone,
          hardStepCap: Number(options?.hardStepCap || 0) || undefined,
          intervalMs: Number(options?.intervalMs || 0) || undefined
        }
      })
      : null;
    return { ok: true, schedule };
  }

  listSchedules(limit = 120) {
    return this.memoryStore?.listMissionSchedules
      ? this.memoryStore.listMissionSchedules(limit)
      : [];
  }

  updateSchedule(id, changes = {}) {
    if (!this.memoryStore?.updateMissionSchedule) return null;
    return this.memoryStore.updateMissionSchedule(id, changes);
  }

  startScheduleLoop() {
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = setInterval(() => {
      this.runDueSchedules().catch(() => {});
    }, this.schedulePollMs);
  }

  async runDueSchedules() {
    const schedules = this.listSchedules(240);
    const nowMs = Date.now();
    for (const schedule of schedules) {
      if (!schedule?.enabled || !schedule?.id) continue;
      if (schedule.status === 'running') continue;
      const dueAt = Date.parse(String(schedule.nextRunAt || schedule.runAt || ''));
      if (!Number.isFinite(dueAt) || dueAt > nowMs) continue;
      const updated = this.updateSchedule(schedule.id, {
        status: 'running',
        lastError: null
      });
      if (!updated) continue;
      try {
        const runOptions = schedule.options || {};
        const started = this.start({
          goal: schedule.goal,
          maxSteps: runOptions.maxSteps ?? 6,
          intervalMs: runOptions.intervalMs ?? this.config?.runtime?.missionDefaultIntervalMs ?? 400,
          maxRetries: runOptions.maxRetries ?? this.config?.runtime?.missionDefaultMaxRetries ?? 3,
          continueUntilDone: runOptions.continueUntilDone ?? this.config?.runtime?.missionDefaultContinueUntilDone ?? true,
          hardStepCap: runOptions.hardStepCap ?? this.config?.runtime?.missionDefaultHardStepCap ?? 120
        });
        const after = this.updateSchedule(schedule.id, {
          status: schedule.intervalMs > 0 ? 'scheduled' : 'completed',
          lastRunAt: new Date().toISOString(),
          nextRunAt: schedule.intervalMs > 0
            ? new Date(Date.now() + schedule.intervalMs).toISOString()
            : null,
          enabled: schedule.intervalMs > 0,
          lastError: null
        });
        if (!after) continue;
        if (!started?.ok) {
          this.updateSchedule(schedule.id, {
            status: 'failed',
            lastError: 'mission_start_failed'
          });
        }
      } catch (error) {
        this.updateSchedule(schedule.id, {
          status: 'failed',
          lastError: String(error.message || error),
          lastRunAt: new Date().toISOString(),
          nextRunAt: schedule.intervalMs > 0
            ? new Date(Date.now() + schedule.intervalMs).toISOString()
            : null,
          enabled: schedule.intervalMs > 0
        });
      }
    }
  }

  persistMission(mission) {
    this.memoryStore?.upsertMissionRecord?.(mission);
  }

  async run(mission) {
    try {
      this.prepareMissionController(mission);
      const missionTurnTimeoutMs = Math.max(
        30000,
        Number(
          mission?.controllerTuning?.turnTimeoutMs ||
          this.config?.runtime?.agentTurnTimeoutMs ||
          90000
        )
      );
      const stepLimit = mission.continueUntilDone ? mission.hardStepCap : mission.maxSteps;
      for (let i = 0; i < stepLimit; i += 1) {
        if (mission.stopRequested) break;
        mission.step = i + 1;
        const successRuns = this.memoryStore?.countSuccessfulToolRuns
          ? this.memoryStore.countSuccessfulToolRuns(mission.sessionId)
          : 0;
        const recentToolRuns = this.memoryStore?.getRecentToolRuns
          ? this.memoryStore.getRecentToolRuns(mission.sessionId, 8)
          : [];
        const currentModel = this.agent?.getCurrentModel?.() || null;
        const prompt = buildMissionPrompt(mission, {
          firstTurn: i === 0,
          workspaceRoot: this.config?.runtime?.workspaceRoot || process.env.OPENUNUM_WORKSPACE || process.cwd(),
          runtimeHints: deriveRuntimeHints(mission, recentToolRuns, this.memoryStore),
          providerHint: deriveProviderHint(currentModel)
        });

        const out = await withTimeout(
          this.agent.chat({
            sessionId: mission.sessionId,
            message: prompt
          }),
          missionTurnTimeoutMs
        );
        const text = String(out.reply || '');
        const recentToolRunsAfter = this.memoryStore?.getRecentToolRuns
          ? this.memoryStore.getRecentToolRuns(mission.sessionId, 8)
          : recentToolRuns;
        const successRunsAfter = this.memoryStore?.countSuccessfulToolRuns
          ? this.memoryStore.countSuccessfulToolRuns(mission.sessionId)
          : successRuns;
        const newProof = successRunsAfter > successRuns;
        const localResponseProof = isLocalRuntimeMission(mission.goal)
          ? findLocalResponseProof(recentToolRunsAfter)
          : null;
        const checkpointLine = text.split('\n').find((line) => line.trim().toUpperCase().startsWith('CHECKPOINT:')) || '';
        const checkpoint = checkpointLine ? trimLine(checkpointLine.replace(/^CHECKPOINT:\s*/i, '')) : '';
        if (this.memoryStore?.getToolRunsSince && this.memoryStore?.recordRouteLesson) {
          const deltaRuns = this.memoryStore.getToolRunsSince(
            mission.sessionId,
            mission.lastToolScanAt || mission.startedAt,
            80
          );
          for (const run of deltaRuns) {
            const signature = routeSignatureFromRun(run);
            const seenKey = `${run.createdAt || ''}|${signature}|${run.ok ? 1 : 0}`;
            if (mission.routeLessonSeen?.[seenKey]) continue;
            mission.routeLessonSeen[seenKey] = 1;
            this.memoryStore.recordRouteLesson({
              sessionId: mission.sessionId,
              goal: mission.goal,
              routeSignature: signature,
              surface: routeSurfaceFromRun(run),
              success: Boolean(run.ok),
              errorExcerpt: String(run?.result?.error || run?.result?.stderr || '').slice(0, 240),
              note: checkpoint || '',
              createdAt: run.createdAt || new Date().toISOString()
            });
          }
          const latestRunAt = deltaRuns.length ? String(deltaRuns[deltaRuns.length - 1]?.createdAt || '') : '';
          if (latestRunAt) mission.lastToolScanAt = latestRunAt;
        }
        const repeatedReply = trimLine(text, 260) === trimLine(mission.lastReply, 260);
        mission.lastReply = text;
        if (checkpoint) mission.lastCheckpoint = checkpoint;
        mission.repeatedReplyTurns = repeatedReply ? mission.repeatedReplyTurns + 1 : 0;
        mission.noProgressTurns = newProof ? 0 : mission.noProgressTurns + 1;
        mission.recoveryHint = '';
        mission.log.push({
          step: mission.step,
          at: new Date().toISOString(),
          provider: out.model?.activeProvider || out.model?.provider,
          model: out.model?.activeModel || out.model?.model,
          reply: text,
          newProof,
          localResponseProof: localResponseProof?.summary || null,
          checkpoint: checkpoint || null,
          noProgressTurns: mission.noProgressTurns
        });
        this.persistMission(mission);
        const timedOutTurn = /turn timed out after/i.test(text);
        const wrapUpIntent = /wrap up|finish the mission|summari[sz]e the proof|already produced output|launch path is valid/i.test(text);
        const declaredDone = text.includes('MISSION_STATUS: DONE');
        const contractCheck = evaluateMissionContract({
          contract: mission.contract || inferMissionContract(mission.goal),
          replyText: text,
          checkpoint,
          newProof,
          localResponseProof
        });
        const doneWithProof = declaredDone && contractCheck.pass;
        const autoCompleteFromProof =
          Boolean(localResponseProof) &&
          !text.includes('MISSION_STATUS: CONTINUE') &&
          (wrapUpIntent || timedOutTurn || mission.noProgressTurns >= 1 || mission.repeatedReplyTurns >= 1);
        if (doneWithProof || autoCompleteFromProof) {
          mission.status = 'completed';
          mission.finishedAt = new Date().toISOString();
          if (autoCompleteFromProof && !doneWithProof) {
            mission.log.push({
              step: mission.step,
              at: new Date().toISOString(),
              autoCompletedFromProof: true,
              proof: localResponseProof
            });
          }
          if (this.config?.runtime?.selfPokeEnabled) {
            const selfPoke = `Identify one high-impact improvement after goal completion: ${mission.goal}. Focus on reliability, speed, or usability and include concrete proof steps.`;
            mission.log.push({
              step: mission.step,
              at: new Date().toISOString(),
              selfPoke
            });
            this.memoryStore?.recordStrategyOutcome?.({
              goal: mission.goal,
              strategy: 'self_poke_followup',
              success: true,
              evidence: selfPoke
            });
          }
          this.memoryStore?.recordStrategyOutcome?.({
            goal: mission.goal,
            strategy: 'tool-driven iterative execution',
            success: true,
            evidence: `completed_with_proof step=${mission.step}`
          });
          this.persistMission(mission);
          return;
        }
        if (declaredDone && !contractCheck.pass) {
          mission.contractFailures += 1;
          mission.log.push({
            step: mission.step,
            at: new Date().toISOString(),
            contractViolation: {
              contractId: mission.contract?.id || 'generic-proof-v1',
              violations: contractCheck.violations
            }
          });
        } else {
          mission.contractFailures = 0;
        }

        if (declaredDone && !contractCheck.pass) {
          mission.retries += 1;
          this.memoryStore?.recordStrategyOutcome?.({
            goal: mission.goal,
            strategy: 'model_claimed_done_without_proof',
            success: false,
            evidence: `step=${mission.step} violations=${contractCheck.violations.join(',')}`
          });
          if (mission.contractFailures >= 2 && mission.rollbackAttempts < 1 && this.agent?.runTool) {
            const rollback = await this.agent.runTool('file_restore_last', {});
            mission.rollbackAttempts += 1;
            mission.log.push({
              step: mission.step,
              at: new Date().toISOString(),
              rollbackAttempt: mission.rollbackAttempts,
              rollback
            });
            mission.recoveryHint = rollback?.ok
              ? 'Rollback executed from local backup. Re-evaluate workspace state and continue with one verified corrective substep.'
              : 'Rollback attempt failed or no backup found. Continue with corrective substep and regenerate proof.';
          }
          if (mission.retries > mission.maxRetries) {
            mission.status = 'failed';
            mission.error = 'done_without_proof_retry_exhausted';
            mission.finishedAt = new Date().toISOString();
            this.persistMission(mission);
            return;
          }
        }
        if (timedOutTurn || (!newProof && (mission.noProgressTurns >= 2 || mission.repeatedReplyTurns >= 1))) {
          const recovered = this.tryRecoverMission(mission);
          mission.recoveryHint = recovered || 'Previous step produced no new proof. Switch route and verify with a short command.';
          mission.log.push({
            step: mission.step,
            at: new Date().toISOString(),
            recoveryHint: mission.recoveryHint
          });
        }
        if (mission.intervalMs > 0) await sleep(mission.intervalMs);
      }
      if (mission.stopRequested) mission.status = 'stopped';
      else if (mission.status === 'running') mission.status = mission.continueUntilDone ? 'hard_cap_reached' : 'max_steps_reached';
      mission.finishedAt = new Date().toISOString();
      this.memoryStore?.recordStrategyOutcome?.({
        goal: mission.goal,
        strategy: 'tool-driven iterative execution',
        success: false,
        evidence: mission.status
      });
      this.persistMission(mission);
    } catch (error) {
      mission.status = 'failed';
      if (error instanceof MissionTurnTimeoutError) {
        mission.log.push({
          step: mission.step,
          at: new Date().toISOString(),
          error: error.message,
          timeoutMs: error.timeoutMs
        });
      }
      mission.error = String(error.message || error);
      mission.finishedAt = new Date().toISOString();
      this.memoryStore?.recordStrategyOutcome?.({
        goal: mission.goal,
        strategy: 'tool-driven iterative execution',
        success: false,
        evidence: mission.error
      });
      this.persistMission(mission);
    } finally {
      this.restoreMissionController(mission);
      this.persistMission(mission);
      this.missions.delete(mission.id);
    }
  }

  prepareMissionController(mission) {
    const current = this.agent?.getCurrentModel?.();
    const currentProvider = current?.activeProvider || current?.provider || this.config?.model?.provider;
    const currentModel = current?.activeModel || current?.model || this.config?.model?.model || '';
    const localRuntimeGoal = isLocalRuntimeMission(mission.goal);
    const cloudController =
      currentProvider !== 'ollama' ||
      /cloud|kimi|minimax/.test(String(currentModel).toLowerCase());
    if (
      localRuntimeGoal &&
      cloudController &&
      this.agent?.switchModel
    ) {
      const prev = {
        providerRequestTimeoutMs: Number(this.config?.runtime?.providerRequestTimeoutMs || 120000),
        agentTurnTimeoutMs: Number(this.config?.runtime?.agentTurnTimeoutMs || 420000),
        maxToolIterations: Number(this.config?.runtime?.maxToolIterations || 8)
      };
      mission.controllerTuning = { previous: prev };
      this.config.runtime.providerRequestTimeoutMs = Math.min(prev.providerRequestTimeoutMs, 45000);
      this.config.runtime.agentTurnTimeoutMs = Math.min(prev.agentTurnTimeoutMs, 90000);
      this.config.runtime.maxToolIterations = Math.min(prev.maxToolIterations, 6);
      mission.controllerTuning.turnTimeoutMs = Math.min(
        Math.max(30000, Number(prev.agentTurnTimeoutMs || 70000) + 10000),
        120000
      );
      if (this.agent?.config?.runtime) {
        this.agent.config.runtime.providerRequestTimeoutMs = this.config.runtime.providerRequestTimeoutMs;
        this.agent.config.runtime.agentTurnTimeoutMs = this.config.runtime.agentTurnTimeoutMs;
        this.agent.config.runtime.maxToolIterations = this.config.runtime.maxToolIterations;
      }
      mission.recoveryHint =
        'Mission is running on a cloud controller for a local-runtime goal. Keep the controller, but work in narrow shell-first substeps, reuse existing local runtimes before creating duplicates, prefer API/batch verification, and avoid blocked file-write paths.';
      mission.log.push({
        step: 0,
        at: new Date().toISOString(),
        recoveryHint: mission.recoveryHint,
        controllerTuning: {
          providerRequestTimeoutMs: this.config.runtime.providerRequestTimeoutMs,
          agentTurnTimeoutMs: this.config.runtime.agentTurnTimeoutMs,
          maxToolIterations: this.config.runtime.maxToolIterations
        }
      });
    }
  }

  restoreMissionController(mission) {
    const prev = mission?.controllerTuning?.previous;
    if (!prev) return;
    this.config.runtime.providerRequestTimeoutMs = prev.providerRequestTimeoutMs;
    this.config.runtime.agentTurnTimeoutMs = prev.agentTurnTimeoutMs;
    this.config.runtime.maxToolIterations = prev.maxToolIterations;
    if (this.agent?.config?.runtime) {
      this.agent.config.runtime.providerRequestTimeoutMs = prev.providerRequestTimeoutMs;
      this.agent.config.runtime.agentTurnTimeoutMs = prev.agentTurnTimeoutMs;
      this.agent.config.runtime.maxToolIterations = prev.maxToolIterations;
    }
  }

  tryRecoverMission(mission) {
    const current = this.agent?.getCurrentModel?.();
    const currentProvider = current?.activeProvider || current?.provider || this.config?.model?.provider;
    const currentModel = current?.activeModel || current?.model || this.config?.model?.model || '';
    const latestReply = String(mission?.lastReply || '');
    const providerFailure = hasProviderFailureSignal(latestReply);
    const routeStuck = /\bfailed\b|timeout|timed out|error/.test(latestReply.toLowerCase()) &&
      Number(mission?.noProgressTurns || 0) >= 3;
    if (isLocalRuntimeMission(mission.goal)) {
      if (routeStuck) {
        return 'Recovery (adaptive): the current route is stalled. Next turn must use a different execution surface than the last failed one, with one short proof step. If two different surfaces fail in a row, run targeted web research for the exact error, apply one changed attempt, and record the learned fix in CHECKPOINT.';
      }
      if (providerFailure && currentProvider !== 'ollama' && this.agent?.switchModel) {
        const ollamaModel = this.agent.getModelForProvider
          ? this.agent.getModelForProvider('ollama')
          : this.config?.model?.providerModels?.ollama;
        if (ollamaModel) {
          this.agent.switchModel('ollama', ollamaModel);
          return `Provider path is failing (${currentProvider}${currentModel ? `/${currentModel}` : ''}). Switched to ollama/${ollamaModel} for local-runtime control. Continue with narrow shell-first proof steps.`;
        }
      }
      return 'Recovery: keep the current controller for now, but pivot the local execution route. Prefer API/batch verification over interactive flows, do not repeat a timed-out local generation call unchanged, and if one runtime remains too slow then switch to a different local runtime instead of repeating the same probe.';
    }
    const fallbacks = this.config?.model?.routing?.fallbackProviders || [];
    const candidates = [currentProvider, ...fallbacks].filter(Boolean);
    const nextProvider = candidates.find((provider) => provider !== currentProvider);
    if (nextProvider && this.agent?.switchModel) {
      const nextModel = this.agent.getModelForProvider
        ? this.agent.getModelForProvider(nextProvider)
        : this.config?.model?.providerModels?.[nextProvider];
      if (nextModel) {
        this.agent.switchModel(nextProvider, nextModel);
        return `No new proof detected. Switched provider to ${nextProvider}/${nextModel}. Re-plan from current machine state and do exactly one verified substep.`;
      }
    }
    if (isLocalRuntimeMission(mission.goal) && /cloud|kimi|minimax/.test(String(currentModel).toLowerCase())) {
      return 'No new proof detected. Keep the current cloud controller, but shrink scope: inspect current machine state again, reuse any existing imported local model before creating another one, avoid file tools for paths outside the workspace root, and prefer a direct short `ollama run` verification over more metadata/blob inspection.';
    }
    return 'No new proof detected. Re-plan from current machine state, pivot to a different local execution route, and verify one concrete substep.';
  }
}
