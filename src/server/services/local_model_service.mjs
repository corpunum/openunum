import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { fetchOllamaModels } from '../../models/catalog.mjs';

const DEFAULT_RECOMMENDED_MODELS = [
  'granite3.3:2b',
  'llama3.2:1b',
  'functiongemma:270m',
  'nomic-embed-text:v1.5',
  'qwen2.5-coder:1.5b'
];

function sanitizeModelId(value = '') {
  const model = String(value || '').trim();
  if (!model) return '';
  if (!/^[a-z0-9][a-z0-9._/-]*(:[a-z0-9._-]+)?$/i.test(model)) return '';
  return model;
}

function isAllowedSmallModel(modelId = '') {
  const id = String(modelId || '').trim().toLowerCase();
  if (!id) return false;
  if (id === 'granite3.3:2b') return true;
  if (id === 'llama3.2:1b') return true;
  if (id === 'functiongemma:270m') return true;
  if (id === 'qwen2.5-coder:1.5b') return true;
  if (id === 'gemma4:cpu' || id === 'gemma4:latest' || id === 'gemma4') return true;
  if (id.includes('embed')) return true;
  if (id.includes('nomic-embed')) return true;
  if (id.includes('mxbai-embed')) return true;
  if (id.includes('all-minilm')) return true;
  return false;
}

function nowIso() {
  return new Date().toISOString();
}

function canonicalLocalModelId(modelId = '') {
  const id = String(modelId || '').trim().toLowerCase();
  if (id === 'gemma4:cpu' || id === 'gemma4') return 'gemma4:latest';
  return String(modelId || '').trim();
}

function summarizeJob(job = {}) {
  return {
    id: job.id,
    model: job.model,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    requestedBy: job.requestedBy || 'unknown',
    exitCode: Number.isFinite(job.exitCode) ? Number(job.exitCode) : null,
    outputTail: Array.isArray(job.outputTail) ? job.outputTail.slice(-20) : [],
    error: job.error || null
  };
}

export function createLocalModelService({ config }) {
  const jobs = new Map();
  const queue = [];
  let active = 0;
  const maxConcurrent = 1;

  function recommendedLocalModels() {
    const configured = Array.isArray(config?.runtime?.modelBackedTools?.recommendedLocalModels)
      ? config.runtime.modelBackedTools.recommendedLocalModels
      : [];
    const base = configured.length > 0 ? configured : DEFAULT_RECOMMENDED_MODELS;
    const filtered = base
      .map((item) => sanitizeModelId(item))
      .filter(Boolean)
      .filter((item) => isAllowedSmallModel(item));
    return [...new Set(filtered)];
  }

  function ollamaBaseUrl() {
    return String(config?.model?.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  }

  async function listInstalledLocalModels() {
    try {
      const rows = await fetchOllamaModels(ollamaBaseUrl(), 'ollama-local');
      return rows
        .map((row) => String(row?.model_id || '').trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async function getRecommendedStatus() {
    const installedRaw = await listInstalledLocalModels();
    const installedCanonical = new Set(installedRaw.map((item) => canonicalLocalModelId(item).toLowerCase()));
    const recommended = recommendedLocalModels();
    return recommended.map((model) => ({
      model,
      installed: installedCanonical.has(canonicalLocalModelId(model).toLowerCase()),
      allowed: isAllowedSmallModel(model)
    }));
  }

  function pushOutput(job, chunk = '') {
    const lines = String(chunk || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return;
    job.outputTail.push(...lines);
    if (job.outputTail.length > 200) {
      job.outputTail = job.outputTail.slice(-200);
    }
  }

  function scheduleNext() {
    if (active >= maxConcurrent) return;
    const nextId = queue.shift();
    if (!nextId) return;
    const job = jobs.get(nextId);
    if (!job || job.status !== 'queued') {
      queueMicrotask(scheduleNext);
      return;
    }

    active += 1;
    job.status = 'running';
    job.startedAt = nowIso();
    const proc = spawn('ollama', ['pull', job.model], { stdio: ['ignore', 'pipe', 'pipe'] });
    job.proc = proc;

    proc.stdout.on('data', (chunk) => pushOutput(job, chunk));
    proc.stderr.on('data', (chunk) => pushOutput(job, chunk));

    proc.on('error', (error) => {
      job.status = 'failed';
      job.finishedAt = nowIso();
      job.error = String(error?.message || error);
      job.exitCode = null;
      job.proc = null;
      active = Math.max(0, active - 1);
      queueMicrotask(scheduleNext);
    });

    proc.on('close', (code) => {
      job.exitCode = Number.isFinite(code) ? Number(code) : null;
      job.finishedAt = nowIso();
      if (job.status !== 'cancelled') {
        if (code === 0) {
          job.status = 'succeeded';
          job.error = null;
        } else {
          job.status = 'failed';
          job.error = `ollama_pull_failed:${code}`;
        }
      }
      job.proc = null;
      active = Math.max(0, active - 1);
      queueMicrotask(scheduleNext);
    });
  }

  function enqueueDownload({ model, requestedBy = 'webui' }) {
    const safeModel = sanitizeModelId(model);
    if (!safeModel) {
      return { ok: false, error: 'invalid_model_id' };
    }
    const allowlist = new Set(recommendedLocalModels());
    if (!allowlist.has(safeModel) || !isAllowedSmallModel(safeModel)) {
      return { ok: false, error: 'model_not_allowlisted', allowedModels: [...allowlist] };
    }
    const resolvedModel = canonicalLocalModelId(safeModel);
    for (const job of jobs.values()) {
      if (canonicalLocalModelId(job.model) !== resolvedModel) continue;
      if (job.status === 'queued' || job.status === 'running') {
        return { ok: true, deduplicated: true, job: summarizeJob(job) };
      }
    }
    const id = crypto.randomUUID();
    const job = {
      id,
      model: resolvedModel,
      status: 'queued',
      createdAt: nowIso(),
      requestedBy,
      outputTail: [],
      proc: null
    };
    jobs.set(id, job);
    queue.push(id);
    queueMicrotask(scheduleNext);
    return { ok: true, deduplicated: false, job: summarizeJob(job) };
  }

  function listDownloads(limit = 60) {
    const jobsList = [...jobs.values()]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, Math.max(1, Math.min(Number(limit) || 60, 300)))
      .map((item) => summarizeJob(item));
    return {
      ok: true,
      downloads: jobsList,
      queueDepth: queue.length,
      active
    };
  }

  function getDownload(id) {
    const job = jobs.get(String(id || '').trim());
    if (!job) return { ok: false, error: 'download_not_found' };
    return { ok: true, job: summarizeJob(job) };
  }

  function cancelDownload(id) {
    const key = String(id || '').trim();
    const job = jobs.get(key);
    if (!job) return { ok: false, error: 'download_not_found' };
    if (job.status === 'queued') {
      const idx = queue.indexOf(key);
      if (idx >= 0) queue.splice(idx, 1);
      job.status = 'cancelled';
      job.finishedAt = nowIso();
      job.error = null;
      return { ok: true, job: summarizeJob(job) };
    }
    if (job.status === 'running' && job.proc) {
      try {
        job.proc.kill('SIGTERM');
      } catch {}
      job.status = 'cancelled';
      job.finishedAt = nowIso();
      job.error = null;
      return { ok: true, job: summarizeJob(job) };
    }
    return { ok: false, error: `cannot_cancel_${job.status}` };
  }

  async function getLocalModelStatus() {
    const installedModels = await listInstalledLocalModels();
    const recommended = await getRecommendedStatus();
    return {
      ok: true,
      baseUrl: ollamaBaseUrl(),
      installedModels,
      recommended,
      downloads: listDownloads()
    };
  }

  return {
    recommendedLocalModels,
    listInstalledLocalModels,
    getRecommendedStatus,
    enqueueDownload,
    listDownloads,
    getDownload,
    cancelDownload,
    getLocalModelStatus
  };
}
