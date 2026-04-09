const MUTATING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const WEBUI_MUTATION_HEADER = 'x-openunum-request';
const WEBUI_MUTATION_HEADER_VALUE = 'webui';

function parseLoopbackOrigin(origin) {
  const raw = String(origin || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    const host = parsed.hostname.toLowerCase();
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return null;
    return parsed;
  } catch {
    return null;
  }
}

function isSameLoopbackOriginAsServer(origin, reqHostHeader, serverPort) {
  const parsed = parseLoopbackOrigin(origin);
  if (!parsed) return false;
  const originPort = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  if (originPort !== Number(serverPort)) return false;
  const reqHost = String(reqHostHeader || '').trim().toLowerCase();
  const reqHostPort = reqHost.includes(':') ? Number(reqHost.split(':').pop()) : Number(serverPort);
  if (!Number.isFinite(reqHostPort) || reqHostPort !== Number(serverPort)) return false;
  return true;
}

export function enforceBrowserRequestGuards({ req, res, config, noCacheHeaders, sendApiError }) {
  const requestOrigin = String(req.headers.origin || '').trim();
  const corsOrigin = isSameLoopbackOriginAsServer(
    requestOrigin,
    req.headers.host,
    config.server.port
  ) ? requestOrigin : null;

  if (req.method === 'OPTIONS') {
    if (requestOrigin && !corsOrigin) {
      sendApiError(res, 403, 'origin_not_allowed', 'Browser origin is not allowed for this local control plane');
      return { handled: true };
    }
    res.writeHead(204, noCacheHeaders('text/plain', { corsOrigin }));
    res.end();
    return { handled: true };
  }

  const isMutating = MUTATING_HTTP_METHODS.has(String(req.method || '').toUpperCase());
  if (isMutating && requestOrigin && !corsOrigin) {
    sendApiError(res, 403, 'origin_not_allowed', 'Browser origin is not allowed for mutating local control-plane requests');
    return { handled: true };
  }
  if (isMutating && requestOrigin) {
    const marker = String(req.headers[WEBUI_MUTATION_HEADER] || '').trim().toLowerCase();
    if (marker !== WEBUI_MUTATION_HEADER_VALUE) {
      sendApiError(
        res,
        403,
        'request_marker_required',
        'Browser mutating requests require X-OpenUnum-Request: webui'
      );
      return { handled: true };
    }
  }

  return { handled: false };
}
