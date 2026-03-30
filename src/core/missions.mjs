import crypto from 'node:crypto';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MissionRunner {
  constructor({ agent, memoryStore }) {
    this.agent = agent;
    this.memoryStore = memoryStore;
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
      error: null
    };
    this.missions.set(id, mission);
    this.run(mission);
    return { ok: true, id, status: mission.status, sessionId };
  }

  async run(mission) {
    try {
      const stepLimit = mission.continueUntilDone ? mission.hardStepCap : mission.maxSteps;
      for (let i = 0; i < stepLimit; i += 1) {
        if (mission.stopRequested) break;
        mission.step = i + 1;
        const successRuns = this.memoryStore?.countSuccessfulToolRuns
          ? this.memoryStore.countSuccessfulToolRuns(mission.sessionId)
          : 0;
        const prompt = i === 0
          ? `Autonomous mission goal: ${mission.goal}
You must act proactively using tools and complete concrete work.
At the end of this turn, append exactly one line:
MISSION_STATUS: DONE
or
MISSION_STATUS: CONTINUE`
          : `Continue autonomous mission: ${mission.goal}
Execute the next concrete step now. End with:
MISSION_STATUS: DONE
or
MISSION_STATUS: CONTINUE`;

        const out = await this.agent.chat({
          sessionId: mission.sessionId,
          message: prompt
        });
        const text = String(out.reply || '');
        const successRunsAfter = this.memoryStore?.countSuccessfulToolRuns
          ? this.memoryStore.countSuccessfulToolRuns(mission.sessionId)
          : successRuns;
        const newProof = successRunsAfter > successRuns;
        mission.log.push({
          step: mission.step,
          at: new Date().toISOString(),
          provider: out.model?.activeProvider || out.model?.provider,
          model: out.model?.activeModel || out.model?.model,
          reply: text,
          newProof
        });
        if (text.includes('MISSION_STATUS: DONE') && newProof) {
          mission.status = 'completed';
          mission.finishedAt = new Date().toISOString();
          this.memoryStore?.recordStrategyOutcome?.({
            goal: mission.goal,
            strategy: 'tool-driven iterative execution',
            success: true,
            evidence: `completed_with_proof step=${mission.step}`
          });
          return;
        }
        if (text.includes('MISSION_STATUS: DONE') && !newProof) {
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
      mission.error = String(error.message || error);
      mission.finishedAt = new Date().toISOString();
      this.memoryStore?.recordStrategyOutcome?.({
        goal: mission.goal,
        strategy: 'tool-driven iterative execution',
        success: false,
        evidence: mission.error
      });
    }
  }
}
