import crypto from 'node:crypto';

export class MerkleTree {
  computeRoot(items) {
    if (!items || items.length === 0) return crypto.createHash('sha256').update('empty').digest('hex');
    let leaves = items.map(item => crypto.createHash('sha256').update(typeof item === 'string' ? item : JSON.stringify(item)).digest('hex'));
    while (leaves.length > 1) {
      const next = [];
      for (let i = 0; i < leaves.length; i += 2) {
        const left = leaves[i];
        const right = i + 1 < leaves.length ? leaves[i + 1] : left;
        next.push(crypto.createHash('sha256').update(left + right).digest('hex'));
      }
      leaves = next;
    }
    return leaves[0];
  }
  
  buildTree(items) {
    const root = this.computeRoot(items);
    const leaves = items.map(item => crypto.createHash('sha256').update(typeof item === 'string' ? item : JSON.stringify(item)).digest('hex'));
    return { root, leaves, itemCount: items.length };
  }
  
  generateProof(leafIndex, leaves) {
    const proof = [];
    let idx = leafIndex;
    let currentLevel = [...leaves];
    while (currentLevel.length > 1) {
      const nextLevel = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
        if (i === idx || i + 1 === idx) {
          proof.push({ sibling: i === idx ? right : left, isRight: i === idx });
        }
        nextLevel.push(crypto.createHash('sha256').update(left + right).digest('hex'));
        if (i === idx || i + 1 === idx) idx = Math.floor(i / 2);
      }
      currentLevel = nextLevel;
    }
    return proof;
  }
  
  verifyProof(leaf, proof, root) {
    let hash = crypto.createHash('sha256').update(leaf).digest('hex');
    for (const p of proof) {
      hash = p.isRight
        ? crypto.createHash('sha256').update(hash + p.sibling).digest('hex')
        : crypto.createHash('sha256').update(p.sibling + hash).digest('hex');
    }
    return hash === root;
  }
}
