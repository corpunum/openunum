import { StateDiffEngine } from '../../core/state-diff.mjs';
import { MerkleTree } from '../../core/merkle-tree.mjs';

const diffEngine = new StateDiffEngine();
const merkle = new MerkleTree();

export async function handleStateRoute({ req, res, url, ctx }) {
  if (req.method === 'POST' && url.pathname === '/api/state/diff') {
    const body = await ctx.parseBody(req);
    const result = diffEngine.computeDiff(body?.before || {}, body?.after || {});
    ctx.sendJson(res, 200, result);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/state/root') {
    const root = merkle.computeRoot([]);
    ctx.sendJson(res, 200, { root });
    return true;
  }

  return false;
}
