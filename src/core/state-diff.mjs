import crypto from 'node:crypto';

export class StateDiffEngine {
  computeDiff(before, after) {
    const changes = [];
    const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    for (const key of allKeys) {
      const bVal = before?.[key];
      const aVal = after?.[key];
      if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
        changes.push({ field: key, operation: bVal === undefined ? 'add' : aVal === undefined ? 'remove' : 'update', before: bVal, after: aVal });
      }
    }
    return {
      diffId: `diff_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date().toISOString(),
      changes,
      hash: crypto.createHash('sha256').update(JSON.stringify(changes)).digest('hex').slice(0, 16)
    };
  }
  
  previewDiff(diff) {
    return diff.changes.map(c => `${c.operation}: ${c.field} (${JSON.stringify(c.before)} → ${JSON.stringify(c.after)})`).join('\n');
  }
  
  applyDiff(state, diff) {
    const result = { ...state };
    for (const c of diff.changes) {
      if (c.operation === 'remove') delete result[c.field];
      else result[c.field] = c.after;
    }
    return result;
  }
  
  rollbackDiff(state, diff) {
    const result = { ...state };
    for (const c of diff.changes) {
      if (c.operation === 'add') delete result[c.field];
      else result[c.field] = c.before;
    }
    return result;
  }
}
