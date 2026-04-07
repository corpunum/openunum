import { StateDiffEngine } from '../../core/state-diff.mjs';
import { MerkleTree } from '../../core/merkle-tree.mjs';

const diffEngine = new StateDiffEngine();
const merkle = new MerkleTree();

export default function stateRoutes(app) {
  app.post('/api/state/diff', (req, res) => {
    const result = diffEngine.computeDiff(req.body.before, req.body.after);
    res.json(result);
  });
  app.get('/api/state/root', (req, res) => {
    const root = merkle.computeRoot(req.body?.items || []);
    res.json({ root });
  });
}
