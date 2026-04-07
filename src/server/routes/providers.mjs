import { healthTracker } from '../../providers/health-tracker.mjs';

export default function providerRoutes(app) {
  app.get('/api/providers/health', (_req, res) => {
    res.json(healthTracker.getHealthStatus());
  });

  app.post('/api/providers/:provider/reset', (req, res) => {
    const { provider } = req.params;
    healthTracker.recordSuccess(provider);
    res.json({ ok: true, provider, reset: true });
  });
}
