function msUntilNextHour(hour) {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(Number(hour));
  if (next <= now) next.setDate(next.getDate() + 1);
  return Math.max(60 * 1000, next.getTime() - now.getTime());
}

export function createResearchRuntimeService({ config, agent, logInfo, logError }) {
  let timer = null;

  function stopResearchDailyLoop() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function startResearchDailyLoop() {
    stopResearchDailyLoop();
    if (!config.runtime?.researchDailyEnabled) return;
    const run = async () => {
      try {
        await agent.runTool('research_run_daily', { simulate: false });
        logInfo('research_daily_completed', {});
      } catch (error) {
        logError('research_daily_failed', { error: String(error.message || error) });
      } finally {
        timer = setTimeout(run, msUntilNextHour(config.runtime.researchScheduleHour ?? 3));
      }
    };
    timer = setTimeout(run, msUntilNextHour(config.runtime.researchScheduleHour ?? 3));
  }

  return { startResearchDailyLoop, stopResearchDailyLoop };
}

