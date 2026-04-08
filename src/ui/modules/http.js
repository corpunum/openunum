import { sleep } from './dom.js';

export function isTransientFetchError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed');
}

export async function fetchWithRetry(path, options = {}, retry = 2, backoffMs = 450) {
  let lastError;
  for (let i = 0; i < retry; i += 1) {
    try {
      return await fetch(path, options);
    } catch (error) {
      lastError = error;
      if (!isTransientFetchError(error) || i === retry - 1) break;
      await sleep(backoffMs * (i + 1));
    }
  }
  throw lastError;
}

export async function jget(path, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Number(opts.timeoutMs) : 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('request_timeout')), timeoutMs);
  try {
    const res = await fetchWithRetry(path, { signal: controller.signal }, 2, 400);
    const raw = await res.text();
    let parsed;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { ok: false, error: `invalid_json_response status=${res.status}` };
    }
    if (!res.ok) {
      const msg = parsed?.error || `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    return parsed;
  } catch (error) {
    if (String(error?.name || '') === 'AbortError') throw new Error('request_timeout');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function jpost(path, body, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Number(opts.timeoutMs) : 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('request_timeout')), timeoutMs);
  try {
    const res = await fetchWithRetry(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-OpenUnum-Request': 'webui' },
      body: JSON.stringify(body || {}),
      signal: controller.signal
    }, 2, 500);
    const raw = await res.text();
    let parsed;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { ok: false, error: `invalid_json_response status=${res.status}` };
    }
    if (!res.ok) {
      const msg = parsed?.error || `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    return parsed;
  } catch (error) {
    if (String(error?.name || '') === 'AbortError') throw new Error('request_timeout');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function jrequest(method, path, body = undefined, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Number(opts.timeoutMs) : 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('request_timeout')), timeoutMs);
  try {
    const m = String(method || 'GET').toUpperCase();
    const init = { method: m, signal: controller.signal };
    if (m !== 'GET') {
      init.headers = { 'Content-Type': 'application/json', 'X-OpenUnum-Request': 'webui' };
      init.body = JSON.stringify(body || {});
    }
    const res = await fetchWithRetry(path, init, 2, 500);
    const raw = await res.text();
    let parsed;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { ok: false, error: `invalid_json_response status=${res.status}`, raw };
    }
    if (!res.ok) {
      const msg = parsed?.error || `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    return parsed;
  } catch (error) {
    if (String(error?.name || '') === 'AbortError') throw new Error('request_timeout');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
