export function noCacheHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE, PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

export function sendJson(res, code, obj) {
  res.writeHead(code, noCacheHeaders('application/json'));
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

export async function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        e.code = 'invalid_json';
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

