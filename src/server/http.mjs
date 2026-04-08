function normalizeCorsOrigin(origin) {
  const value = String(origin || '').trim();
  return value || null;
}

export function noCacheHeaders(contentType, options = {}) {
  const corsOrigin = normalizeCorsOrigin(options.corsOrigin);
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE, PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-OpenUnum-Request'
  };
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin;
    headers.Vary = 'Origin';
  }
  return headers;
}

export function sendJson(res, code, obj, options = {}) {
  res.writeHead(code, noCacheHeaders('application/json', options));
  res.end(JSON.stringify(obj));
}

export function sendApiError(res, status, code, message, details = {}, contractVersion = '') {
  return sendJson(res, status, {
    ok: false,
    error: code,
    message: String(message || code),
    ...(contractVersion ? { contract_version: contractVersion } : {}),
    ...details
  });
}

export async function parseBody(req, options = {}) {
  const maxBytes = Number.isFinite(options?.maxBytes) ? Number(options.maxBytes) : 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    const declaredLength = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      const error = new Error('request_too_large');
      error.code = 'payload_too_large';
      reject(error);
      return;
    }
    req.on('data', (c) => chunks.push(c));
    req.on('data', (c) => {
      totalBytes += c.length;
      if (totalBytes > maxBytes) {
        const error = new Error('request_too_large');
        error.code = 'payload_too_large';
        req.destroy(error);
      }
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        e.code = 'invalid_json';
        reject(e);
      }
    });
    req.on('error', (error) => {
      if (String(error?.code || '') === 'payload_too_large') {
        reject(error);
        return;
      }
      reject(error);
    });
  });
}
