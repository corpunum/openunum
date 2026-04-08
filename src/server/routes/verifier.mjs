import { IndependentVerifier } from '../../core/verifier.mjs';

const verifier = new IndependentVerifier();

export async function handleVerifierRoute({ req, res, url, ctx }) {
  if (req.method === 'GET' && url.pathname === '/api/verifier/stats') {
    ctx.sendJson(res, 200, verifier.getStats());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/verifier/check') {
    const body = await ctx.parseBody(req);
    const type = String(body?.type || 'state').trim().toLowerCase();
    if (type === 'tool') {
      const out = await verifier.verifyToolResult(
        String(body?.toolName || ''),
        body?.args || {},
        body?.after || body?.result || {}
      );
      ctx.sendJson(res, 200, out);
      return true;
    }
    const out = await verifier.verifyStateChange(body?.before || {}, body?.after || {});
    ctx.sendJson(res, 200, out);
    return true;
  }

  return false;
}
