import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeStatus(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (['queued', 'running', 'resolved', 'failed', 'cancelled'].includes(raw)) return raw;
  return '';
}

function buildId() {
  return `rem-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function byRecent(a, b) {
  return Date.parse(b?.updatedAt || b?.createdAt || 0) - Date.parse(a?.updatedAt || a?.createdAt || 0);
}

export class AutonomyRemediationQueue {
  constructor({ homeDir, maxItems = 400 } = {}) {
    this.homeDir = String(homeDir || process.cwd());
    this.maxItems = Math.max(50, Number(maxItems || 400));
    this.filePath = path.join(this.homeDir, 'autonomy-remediations.json');
    this.items = [];
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.items = [];
        return;
      }
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const items = Array.isArray(raw?.items) ? raw.items : [];
      this.items = items
        .map((item) => ({
          id: String(item?.id || buildId()),
          status: normalizeStatus(item?.status) || 'queued',
          source: String(item?.source || 'manual'),
          sourceKey: String(item?.sourceKey || '').trim(),
          severity: String(item?.severity || 'warning'),
          title: String(item?.title || 'Untitled remediation'),
          description: String(item?.description || '').trim(),
          actions: Array.isArray(item?.actions) ? item.actions.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 10) : [],
          evidence: item?.evidence && typeof item.evidence === 'object' ? item.evidence : {},
          observedCount: Math.max(1, Number(item?.observedCount || 1)),
          createdAt: String(item?.createdAt || nowIso()),
          updatedAt: String(item?.updatedAt || item?.createdAt || nowIso()),
          startedAt: item?.startedAt ? String(item.startedAt) : null,
          closedAt: item?.closedAt ? String(item.closedAt) : null,
          resolution: String(item?.resolution || '').trim(),
          error: String(item?.error || '').trim()
        }))
        .sort(byRecent)
        .slice(0, this.maxItems);
    } catch {
      this.items = [];
    }
  }

  save() {
    const payload = {
      updatedAt: nowIso(),
      items: this.items.slice(0, this.maxItems)
    };
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2));
  }

  list({ status = '', limit = 80 } = {}) {
    const normalized = normalizeStatus(status);
    const max = Math.max(1, Math.min(200, Number(limit || 80)));
    const rows = normalized
      ? this.items.filter((item) => item.status === normalized)
      : this.items;
    return {
      ok: true,
      count: rows.length,
      items: clone(rows.slice(0, max))
    };
  }

  get(id = '') {
    const target = String(id || '').trim();
    if (!target) return { ok: false, error: 'id_required' };
    const item = this.items.find((entry) => entry.id === target);
    if (!item) return { ok: false, error: 'not_found' };
    return { ok: true, item: clone(item) };
  }

  create(input = {}) {
    const title = String(input?.title || '').trim();
    if (!title) return { ok: false, error: 'title_required' };
    const item = {
      id: buildId(),
      status: 'queued',
      source: String(input?.source || 'manual').trim() || 'manual',
      sourceKey: String(input?.sourceKey || '').trim(),
      severity: String(input?.severity || 'warning').trim() || 'warning',
      title,
      description: String(input?.description || '').trim(),
      actions: Array.isArray(input?.actions) ? input.actions.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 10) : [],
      evidence: input?.evidence && typeof input.evidence === 'object' ? input.evidence : {},
      observedCount: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      startedAt: null,
      closedAt: null,
      resolution: '',
      error: ''
    };
    this.items.unshift(item);
    this.items = this.items.sort(byRecent).slice(0, this.maxItems);
    this.save();
    return { ok: true, item: clone(item) };
  }

  ensureSelfAwarenessRemediation(snapshot = null) {
    if (!snapshot || typeof snapshot !== 'object') return { ok: false, skipped: true, reason: 'snapshot_missing' };
    const score = Number(snapshot.score || 0);
    if (!Number.isFinite(score) || score >= 75) {
      return { ok: true, skipped: true, reason: 'score_healthy' };
    }
    const sourceKey = 'self-awareness:response-quality-drift';
    const active = this.items.find((item) => item.sourceKey === sourceKey && ['queued', 'running'].includes(item.status));
    const issues = Array.isArray(snapshot.issues) ? snapshot.issues.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 6) : [];
    const baseActions = [
      'Reproduce the leaked reply shape using session imitation tests.',
      'Patch deterministic router path to keep user-facing response direct.',
      'Run unit + imitation regression tests and capture evidence.',
      'Run live canary prompt and confirm no fallback-format leak.'
    ];
    if (active) {
      active.observedCount = Math.max(1, Number(active.observedCount || 1) + 1);
      active.updatedAt = nowIso();
      active.severity = score < 65 ? 'critical' : 'warning';
      active.description = `Self-awareness score dropped to ${score}. Keep remediation active until score recovers.`;
      active.evidence = {
        ...(active.evidence || {}),
        lastSnapshot: snapshot
      };
      if (!Array.isArray(active.actions) || !active.actions.length) {
        active.actions = baseActions;
      }
      this.save();
      return { ok: true, upserted: true, item: clone(active), mode: 'updated' };
    }
    const created = this.create({
      source: 'self-awareness',
      sourceKey,
      severity: score < 65 ? 'critical' : 'warning',
      title: 'Response-quality drift remediation',
      description: `Self-awareness score is ${score}. Resolve recovery-format/generic-ack leakage before broader autonomy mutations.`,
      actions: baseActions,
      evidence: {
        snapshot,
        issues
      }
    });
    return { ...created, upserted: Boolean(created.ok), mode: 'created' };
  }

  ensurePendingQueueRemediation(diagnostics = null) {
    if (!diagnostics || typeof diagnostics !== 'object') return { ok: false, skipped: true, reason: 'diagnostics_missing' };
    const stuckCount = Math.max(0, Number(diagnostics.stuckCount || 0));
    const oldestAgeMs = Math.max(0, Number(diagnostics.oldestAgeMs || 0));
    if (stuckCount <= 0) {
      return { ok: true, skipped: true, reason: 'queue_healthy' };
    }
    const sourceKey = 'pending-queue:stalled';
    const active = this.items.find((item) => item.sourceKey === sourceKey && ['queued', 'running'].includes(item.status));
    if (active) {
      active.observedCount = Math.max(1, Number(active.observedCount || 1) + 1);
      active.updatedAt = nowIso();
      active.severity = oldestAgeMs > Number(diagnostics.thresholdMs || 45000) * 2 ? 'critical' : 'warning';
      active.description = `Detected ${stuckCount} stuck pending chat turns. Oldest age ${oldestAgeMs}ms.`;
      active.evidence = {
        ...(active.evidence || {}),
        diagnostics
      };
      this.save();
      return { ok: true, upserted: true, item: clone(active), mode: 'updated' };
    }
    const created = this.create({
      source: 'pending-queue',
      sourceKey,
      severity: oldestAgeMs > Number(diagnostics.thresholdMs || 45000) * 2 ? 'critical' : 'warning',
      title: 'Pending chat queue stalled',
      description: `Detected ${stuckCount} stuck pending chat turns. Oldest age ${oldestAgeMs}ms.`,
      actions: [
        'Inspect `/api/chat/diagnostics` for stuck sessions and timing headroom.',
        'Reproduce with canary prompt and verify pending completion path.',
        'Patch queue/runtime timeout routing if stuck pattern persists.',
        'Run phase47, phase49, and phase52 regressions before resolving.'
      ],
      evidence: { diagnostics }
    });
    return { ...created, upserted: Boolean(created.ok), mode: 'created' };
  }

  transition(id = '', targetStatus = '', extra = {}) {
    const wanted = normalizeStatus(targetStatus);
    if (!wanted) return { ok: false, error: 'invalid_status' };
    const out = this.get(id);
    if (!out.ok) return out;
    const item = this.items.find((entry) => entry.id === id);
    item.status = wanted;
    item.updatedAt = nowIso();
    if (wanted === 'running' && !item.startedAt) item.startedAt = nowIso();
    if (['resolved', 'failed', 'cancelled'].includes(wanted)) item.closedAt = nowIso();
    if (extra?.resolution != null) item.resolution = String(extra.resolution || '').trim();
    if (extra?.error != null) item.error = String(extra.error || '').trim();
    if (extra?.description != null) item.description = String(extra.description || '').trim();
    this.save();
    return { ok: true, item: clone(item) };
  }
}
