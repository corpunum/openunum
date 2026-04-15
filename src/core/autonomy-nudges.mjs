import { buildContextBudgetInfo } from './context-budget.mjs';
import { getAuditStats, verifyChain } from './audit-log.mjs';

function createNudge(type, severity, title, detail, metadata = {}) {
  return {
    type,
    severity,
    title,
    detail,
    metadata,
    createdAt: new Date().toISOString()
  };
}

function uniqueByTypeAndSession(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${item.type}:${item.metadata?.sessionId || ''}:${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function buildAutonomyNudges({ config, memoryStore, health = null, selfAwareness = null, maxItems = 8 } = {}) {
  const nudges = [];

  if (health?.status && health.status !== 'healthy') {
    for (const issue of health.issues || []) {
      nudges.push(
        createNudge(
          'health_issue',
          'warning',
          `Review health issue: ${issue.check}`,
          String(issue.error || 'health check failed'),
          { check: issue.check }
        )
      );
    }
  }

  try {
    const auditChain = verifyChain();
    const auditStats = getAuditStats();
    if (!auditChain.valid) {
      nudges.push(
        createNudge(
          'audit_integrity',
          'critical',
          'Audit chain verification failed',
          `Audit log broke at entry index ${auditChain.brokenAt}. Read audit history before any autonomous mutation.`,
          { brokenAt: auditChain.brokenAt }
        )
      );
    } else if (auditStats.totalEntries > 0) {
      nudges.push(
        createNudge(
          'audit_review',
          'info',
          'Read recent audits and extract failure patterns',
          `Audit chain is valid across ${auditStats.totalEntries} entries. Review recent event types and correlate them with current reliability issues.`,
          { totalEntries: auditStats.totalEntries, eventTypes: auditStats.eventTypes || [] }
        )
      );
    }
  } catch (error) {
    nudges.push(
      createNudge(
        'audit_read_failed',
        'warning',
        'Audit review could not run',
        String(error.message || error)
      )
    );
  }

  if (selfAwareness && typeof selfAwareness === 'object') {
    const score = Number(selfAwareness.score || 0);
    if (Number.isFinite(score) && score < 75) {
      nudges.push(
        createNudge(
          'response_quality_drift',
          score < 65 ? 'critical' : 'warning',
          'Repair response-quality drift before broader autonomy changes',
          `Self-awareness score is ${score}. Focus on deterministic response-path regressions and rerun session imitation checks.`,
          {
            score,
            status: selfAwareness.status || 'unknown'
          }
        )
      );
    }
  }

  const sessions = memoryStore?.listSessions?.(8) || [];
  for (const session of sessions) {
    const sessionId = String(session?.sessionId || '').trim();
    if (!sessionId) continue;
    try {
      const history = (memoryStore.getMessagesForContext?.(sessionId, 220) || [])
        .map((row) => ({ role: row.role, content: row.content }));
      if (history.length) {
        const budget = buildContextBudgetInfo({
          config,
          provider: config?.model?.provider,
          model: config?.model?.model,
          messages: history
        });
        if (budget.usagePct >= 0.9) {
          nudges.push(
            createNudge(
              'session_overloaded',
              budget.usagePct >= 1 ? 'critical' : 'warning',
              `Compact or reset overloaded session ${sessionId}`,
              `Estimated usage ${(budget.usagePct * 100).toFixed(1)}% of context window.`,
              { sessionId, usagePct: budget.usagePct, messageCount: history.length }
            )
          );
        }
      }
      const toolRuns = memoryStore.getRecentToolRuns?.(sessionId, 12) || [];
      const timeoutCount = toolRuns.filter((run) => /provider_timeout|timed out/i.test(`${run?.result?.error || ''} ${run?.result?.stderr || ''}`)).length;
      if (timeoutCount >= 2) {
        nudges.push(
          createNudge(
            'provider_timeout_cluster',
            'warning',
            `Review repeated provider timeouts in ${sessionId}`,
            `${timeoutCount} recent tool runs ended in provider timeout. Read the session, compare providers, and tighten the route.`,
            { sessionId, timeoutCount }
          )
        );
      }
    } catch {
      // keep nudges best-effort
    }
  }

  nudges.push(
    createNudge(
      'meta_harness_review',
      'info',
      'Consult harness evidence before changing orchestration',
      'Read recent audits, recent failed sessions, and route lessons before changing prompts, routing, or memory behavior.',
      { source: 'framework' }
    )
  );

  return uniqueByTypeAndSession(nudges).slice(0, Math.max(1, Number(maxItems || 8)));
}
