import crypto from 'node:crypto';
import path from 'node:path';

function nowIso() {
  return new Date().toISOString();
}

function trimString(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function cap(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function safeFileName(text) {
  return String(text || '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'artifact';
}

function firstNonEmptyLine(text, maxChars = 180) {
  const line = String(text || '').split('\n').map((item) => item.trim()).find(Boolean) || '';
  return line.length > maxChars ? `${line.slice(0, maxChars - 3)}...` : line;
}

function tokenSet(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
  );
}

function scoreCandidate(candidate, query) {
  const q = tokenSet(query);
  const id = String(candidate?.id || '').toLowerCase();
  let score = Math.log10(Number(candidate?.downloads || 0) + 10) * 3;
  score += Math.log10(Number(candidate?.likes || 0) + 10);
  for (const token of q) {
    if (id.includes(token)) score += 4;
  }
  if (id.startsWith(String(query || '').toLowerCase())) score += 6;
  return score;
}

function summarizeHttpError(res, body = '') {
  return `http_${res.status}${body ? `:${String(body).slice(0, 140)}` : ''}`;
}

function buildPublicRun(run) {
  return {
    id: run.id,
    query: run.query,
    status: run.status,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    selectedCandidate: run.selectedCandidate,
    candidates: run.candidates,
    artifact: run.artifact,
    localEvaluation: run.localEvaluation,
    errors: run.errors,
    notes: run.notes
  };
}

export class ModelScoutWorkflow {
  constructor({ toolRuntime, memoryStore, workspaceRoot, ollamaBaseUrl = 'http://127.0.0.1:11434' }) {
    this.toolRuntime = toolRuntime;
    this.memoryStore = memoryStore;
    this.workspaceRoot = workspaceRoot;
    this.ollamaBaseUrl = trimString(ollamaBaseUrl, 'http://127.0.0.1:11434');
    this.runs = new Map();
  }

  listRuns(limit = 30) {
    const rows = [...this.runs.values()]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, cap(limit, 1, 200, 30))
      .map((run) => buildPublicRun(run));
    return { ok: true, runs: rows };
  }

  getRun(id) {
    const run = this.runs.get(trimString(id));
    if (!run) return { ok: false, error: 'model_scout_run_not_found' };
    return { ok: true, run: buildPublicRun(run) };
  }

  async fetchJson(url) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OpenUnum Model Scout/1.0' }
    });
    const raw = await res.text();
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {}
    if (!res.ok) throw new Error(summarizeHttpError(res, raw));
    return json;
  }

  async inspectArtifact(baseUrl, modelId, fileName) {
    const url = `${baseUrl}/${modelId}/resolve/main/${encodeURIComponent(fileName)}?download=true`;
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'OpenUnum Model Scout/1.0' }
    });
    if (!res.ok) {
      return {
        ok: false,
        fileName,
        url,
        error: summarizeHttpError(res)
      };
    }
    const contentLength = Number(res.headers.get('content-length') || NaN);
    return {
      ok: true,
      fileName,
      url,
      contentLength: Number.isFinite(contentLength) ? contentLength : null,
      contentType: res.headers.get('content-type') || ''
    };
  }

  selectArtifact(detail, { baseUrl, maxDownloadBytes }) {
    const siblings = Array.isArray(detail?.siblings) ? detail.siblings : [];
    const names = siblings
      .map((item) => trimString(item?.rfilename || item?.path))
      .filter(Boolean);
    const preferred = [
      ...names.filter((name) => /\.gguf$/i.test(name)),
      ...names.filter((name) => /\.(safetensors|bin)$/i.test(name)),
      ...names.filter((name) => /^(README\.md|config\.json|tokenizer_config\.json)$/i.test(path.basename(name)))
    ];
    const unique = [...new Set(preferred)].slice(0, 12);
    return Promise.all(unique.map((name) => this.inspectArtifact(baseUrl, detail.id, name)))
      .then((artifacts) => {
        const good = artifacts.filter((item) => item.ok);
        const boundedWeights = good
          .filter((item) => /\.(gguf|safetensors|bin)$/i.test(item.fileName))
          .filter((item) => item.contentLength != null && item.contentLength <= maxDownloadBytes)
          .sort((a, b) => (a.contentLength || Number.MAX_SAFE_INTEGER) - (b.contentLength || Number.MAX_SAFE_INTEGER));
        if (boundedWeights.length) return boundedWeights[0];
        const metadata = good.find((item) => /README\.md|config\.json|tokenizer_config\.json/i.test(path.basename(item.fileName)));
        if (metadata) return metadata;
        return good[0] || artifacts[0] || null;
      });
  }

  async detectLocalModel(query, selectedCandidate, preferredModel = '') {
    const lookup = await this.toolRuntime.run('shell_run', { cmd: 'ollama list' }, {
      sessionId: `model-scout:ollama-list:${Date.now()}`,
      allowedTools: ['shell_run'],
      policyMode: 'execute'
    });
    if (!lookup?.ok) {
      return { ok: false, error: lookup?.error || 'ollama_list_failed', stdout: lookup?.stdout || '' };
    }
    const lines = String(lookup.stdout || '').split('\n').slice(1).map((line) => line.trim()).filter(Boolean);
    const names = lines.map((line) => line.split(/\s{2,}/)[0]).filter(Boolean);
    const queryTokens = tokenSet(`${query} ${selectedCandidate?.id || ''}`);
    const match = names.find((name) => {
      const lowered = String(name || '').toLowerCase();
      for (const token of queryTokens) {
        if (lowered.includes(token)) return true;
      }
      return false;
    });
    return {
      ok: true,
      names,
      matchedModel: trimString(preferredModel) || match || null
    };
  }

  async evaluateLocalModel(modelName, prompt, ollamaBaseUrl, timeoutMs = 15000) {
    if (!modelName) return { ok: false, skipped: true, error: 'local_model_not_found' };
    const startedAt = Date.now();
    try {
      const out = await this.toolRuntime.run('http_request', {
        url: `${ollamaBaseUrl}/api/generate`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        bodyJson: {
          model: modelName,
          prompt,
          stream: false
        },
        timeoutMs
      }, {
        sessionId: `model-scout:eval:${Date.now()}`,
        allowedTools: ['http_request'],
        policyMode: 'execute'
      });
      const latencyMs = Date.now() - startedAt;
      const responseText = String(out?.json?.response || out?.text || '');
      return {
        ok: Boolean(out?.ok),
        model: modelName,
        latencyMs,
        status: out?.status || null,
        responsePreview: firstNonEmptyLine(responseText, 220),
        error: out?.error || null
      };
    } catch (error) {
      return {
        ok: false,
        model: modelName,
        latencyMs: Date.now() - startedAt,
        status: null,
        responsePreview: '',
        error: String(error.message || error)
      };
    }
  }

  recordArtifacts(run) {
    if (this.memoryStore?.addMemoryArtifact) {
      this.memoryStore.addMemoryArtifact({
        sessionId: `model-scout:${run.id}`,
        artifactType: 'model_scout_run',
        content: JSON.stringify(buildPublicRun(run)),
        sourceRef: run.id
      });
    }
    if (this.memoryStore?.rememberFact && run.selectedCandidate?.id) {
      this.memoryStore.rememberFact('models.last_scout_candidate', run.selectedCandidate.id);
      if (run.artifact?.outPath) this.memoryStore.rememberFact('models.last_scout_download_path', run.artifact.outPath);
      if (run.localEvaluation?.model) this.memoryStore.rememberFact('models.last_scout_local_eval_model', run.localEvaluation.model);
    }
  }

  async run(payload = {}) {
    const query = trimString(payload.query);
    if (!query) return { ok: false, error: 'query is required' };
    const id = crypto.randomUUID();
    const catalogBaseUrl = trimString(payload.catalogBaseUrl, 'https://huggingface.co');
    const ollamaBaseUrl = trimString(payload.ollamaBaseUrl, this.ollamaBaseUrl);
    const searchLimit = cap(payload.searchLimit, 1, 25, 8);
    const maxDownloadBytes = cap(payload.maxDownloadBytes, 1024, 20 * 1024 * 1024 * 1024, 50 * 1024 * 1024);
    const evaluateTimeoutMs = cap(payload.evaluateTimeoutMs, 1000, 120000, 15000);
    const evaluatePrompt = trimString(payload.evaluatePrompt, 'Reply with READY and one short sentence about local autonomy.');
    const run = {
      id,
      query,
      status: 'running',
      createdAt: nowIso(),
      startedAt: nowIso(),
      finishedAt: null,
      candidates: [],
      selectedCandidate: null,
      artifact: null,
      localEvaluation: null,
      errors: [],
      notes: []
    };
    this.runs.set(id, run);

    try {
      const searchUrl = `${catalogBaseUrl}/api/models?search=${encodeURIComponent(query)}&sort=downloads&direction=-1&limit=${searchLimit}`;
      const rawCandidates = await this.fetchJson(searchUrl);
      const candidates = (Array.isArray(rawCandidates) ? rawCandidates : [])
        .map((item) => ({
          id: trimString(item?.id),
          downloads: Number(item?.downloads || 0),
          likes: Number(item?.likes || 0),
          score: scoreCandidate(item, query),
          url: `${catalogBaseUrl}/${trimString(item?.id)}`
        }))
        .filter((item) => item.id)
        .sort((a, b) => b.score - a.score || b.downloads - a.downloads)
        .slice(0, searchLimit);
      run.candidates = candidates;
      if (!candidates.length) throw new Error('no_candidates_found');
      run.selectedCandidate = candidates[0];

      const detail = await this.fetchJson(`${catalogBaseUrl}/api/models/${run.selectedCandidate.id}`);
      const artifact = await this.selectArtifact(detail, { baseUrl: catalogBaseUrl, maxDownloadBytes });
      if (artifact?.ok) {
        const outDir = trimString(payload.outDir, path.join('tmp', 'model-scout', safeFileName(run.selectedCandidate.id)));
        const outPath = path.join(outDir, path.basename(artifact.fileName));
        const downloaded = await this.toolRuntime.run('http_download', {
          url: artifact.url,
          outPath
        }, {
          sessionId: `model-scout:download:${id}`,
          allowedTools: ['http_download'],
          policyMode: 'execute'
        });
        run.artifact = {
          fileName: artifact.fileName,
          url: artifact.url,
          contentLength: artifact.contentLength,
          contentType: artifact.contentType,
          outPath: downloaded?.outPath || null,
          ok: Boolean(downloaded?.ok),
          error: downloaded?.error || null
        };
        if (!downloaded?.ok) run.errors.push(`download_failed:${run.artifact.error || artifact.fileName}`);
      } else if (artifact) {
        run.artifact = artifact;
        run.notes.push('No bounded weight artifact matched the size cap; only metadata inspection succeeded.');
      }

      if (payload.monitorLocal !== false) {
        const local = await this.detectLocalModel(query, run.selectedCandidate, payload.localModel || '');
        if (local.ok && local.matchedModel) {
          run.localEvaluation = await this.evaluateLocalModel(local.matchedModel, evaluatePrompt, ollamaBaseUrl, evaluateTimeoutMs);
          if (!run.localEvaluation.ok) {
            run.notes.push(`Local evaluation did not complete cleanly: ${run.localEvaluation.error || 'unknown_error'}`);
          }
        } else {
          run.localEvaluation = {
            ok: false,
            skipped: true,
            model: null,
            error: local.error || 'local_model_not_found',
            availableModels: local.names || []
          };
        }
      }

      run.status = 'completed';
    } catch (error) {
      run.status = 'failed';
      run.errors.push(String(error.message || error));
    } finally {
      run.finishedAt = nowIso();
      this.recordArtifacts(run);
    }

    return { ok: run.status === 'completed', run: buildPublicRun(run) };
  }
}
