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
  return `${goalLine}
${lastCheckpoint}${recoveryHint}${stallHint}${workspaceHint}${localRuntimeHint}${providerSurfaceHint}${dynamicHints}Execution contract:
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

function deriveRuntimeHints(mission, recentToolRuns = []) {
  const hints = [];
  if (!Array.isArray(recentToolRuns) || recentToolRuns.length === 0) return hints;
  const shellRuns = recentToolRuns.filter((run) => run?.toolName === 'shell_run');
  const httpRuns = recentToolRuns.filter((run) => run?.toolName === 'http_request');
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
  return [...new Set(hints)].slice(0, 4);
}

function deriveProviderHint(currentModel) {
  const provider = String(currentModel?.activeProvider || currentModel?.provider || '').toLowerCase();
  const model = String(currentModel?.activeModel || currentModel?.model || '').toLowerCase();
  if (provider === 'ollama') {
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
  }

  list() {
    return [...this.missions.values()].map((m) => ({
      id: m.id,
      goal: m.goal,
      status: m.status,
      startedAt: m.startedAt,
      finishedAt: m.finishedAt,
      step: m.step,
      maxSteps: m.maxSteps,
      sessionId: m.sessionId,
      error: m.error || null
    }));
  }

  get(id) {
    return this.missions.get(id) || null;
  }

  stop(id) {
    const mission = this.missions.get(id);
    if (!mission) return { ok: false, error: 'mission_not_found' };
    mission.stopRequested = true;
    if (mission.status === 'running') mission.status = 'stopping';
    return { ok: true, id, status: mission.status };
  }

  start({ goal, maxSteps = 6, intervalMs = 400, maxRetries = 3, continueUntilDone = true, hardStepCap = 120 }) {
    const trimmedGoal = String(goal || '').trim();
    if (!trimmedGoal) throw new Error('goal is required');
    const id = crypto.randomUUID();
    const sessionId = `mission:${id}`;
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
      sessionId,
      log: [],
      retries: 0,
      error: null,
      noProgressTurns: 0,
      repeatedReplyTurns: 0,
      lastReply: '',
      lastCheckpoint: '',
      recoveryHint: ''
    };
    this.missions.set(id, mission);
    this.run(mission);
    return { ok: true, id, status: mission.status, sessionId };
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
          runtimeHints: deriveRuntimeHints(mission, recentToolRuns),
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
        const timedOutTurn = /turn timed out after/i.test(text);
        const wrapUpIntent = /wrap up|finish the mission|summari[sz]e the proof|already produced output|launch path is valid/i.test(text);
        const doneWithProof = text.includes('MISSION_STATUS: DONE') && (newProof || Boolean(localResponseProof));
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
          return;
        }
        if (text.includes('MISSION_STATUS: DONE') && !newProof && !localResponseProof) {
          mission.retries += 1;
          this.memoryStore?.recordStrategyOutcome?.({
            goal: mission.goal,
            strategy: 'model_claimed_done_without_proof',
            success: false,
            evidence: `step=${mission.step}`
          });
          if (mission.retries > mission.maxRetries) {
            mission.status = 'failed';
            mission.error = 'done_without_proof_retry_exhausted';
            mission.finishedAt = new Date().toISOString();
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
    } finally {
      this.restoreMissionController(mission);
    }
  }

  prepareMissionController(mission) {
    const current = this.agent?.getCurrentModel?.();
    const currentProvider = current?.activeProvider || current?.provider || this.config?.model?.provider;
    const currentModel = current?.activeModel || current?.model || this.config?.model?.model || '';
    if (
      isLocalRuntimeMission(mission.goal) &&
      currentProvider === 'ollama' &&
      /cloud|kimi|minimax/.test(String(currentModel).toLowerCase()) &&
      this.agent?.switchModel
    ) {
      const prev = {
        providerRequestTimeoutMs: Number(this.config?.runtime?.providerRequestTimeoutMs || 120000),
        agentTurnTimeoutMs: Number(this.config?.runtime?.agentTurnTimeoutMs || 420000),
        maxToolIterations: Number(this.config?.runtime?.maxToolIterations || 8)
      };
      mission.controllerTuning = { previous: prev };
      this.config.runtime.providerRequestTimeoutMs = Math.min(prev.providerRequestTimeoutMs, 45000);
      this.config.runtime.agentTurnTimeoutMs = Math.min(prev.agentTurnTimeoutMs, 70000);
      this.config.runtime.maxToolIterations = Math.min(prev.maxToolIterations, 6);
      mission.controllerTuning.turnTimeoutMs = Math.min(
        Math.max(30000, Number(prev.agentTurnTimeoutMs || 70000) + 10000),
        90000
      );
      if (this.agent?.config?.runtime) {
        this.agent.config.runtime.providerRequestTimeoutMs = this.config.runtime.providerRequestTimeoutMs;
        this.agent.config.runtime.agentTurnTimeoutMs = this.config.runtime.agentTurnTimeoutMs;
        this.agent.config.runtime.maxToolIterations = this.config.runtime.maxToolIterations;
      }
      mission.recoveryHint =
        'Mission is running on a cloud controller for a local-runtime goal. Keep the controller, but work in narrow shell-first substeps, reuse existing local runtimes before creating duplicates, and avoid blocked file-write paths.';
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
    if (isLocalRuntimeMission(mission.goal)) {
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
