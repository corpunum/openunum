import { IndependentVerifier } from '../../core/verifier.mjs';
const verifier = new IndependentVerifier();

export default function verifierRoutes(app) {
  app.post('/api/verifier/check', async (req, res) => {
    const { before, after, type } = req.body || {};
    const result = type === 'tool'
      ? await verifier.verifyToolResult(req.body.toolName, req.body.args, after)
      : await verifier.verifyStateChange(before || {}, after || {});
    res.json(result);
  });
  app.get('/api/verifier/stats', (req, res) => res.json(verifier.getStats()));
}
