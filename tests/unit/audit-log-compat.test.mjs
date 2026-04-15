import crypto from 'node:crypto';
import fs from 'node:fs';
import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import {
  AUDIT_LOG_PATH,
  clearAuditLog,
  getAuditDiagnostics,
  logEvent,
  verifyChain
} from '../../src/core/audit-log.mjs';

let originalAuditContent = null;

function legacyMerkleHash(entry) {
  return crypto
    .createHmac('sha256', process.env.AUDIT_HMAC_SECRET || 'openunum-audit-secret-change-in-production')
    .update(JSON.stringify({
      merkleRoot: entry.payload?.merkleRoot,
      count: entry.payload?.entryCount
    }))
    .digest('hex');
}

describe('audit log compatibility', () => {
  beforeAll(() => {
    originalAuditContent = fs.existsSync(AUDIT_LOG_PATH)
      ? fs.readFileSync(AUDIT_LOG_PATH, 'utf8')
      : null;
  });

  afterEach(() => {
    clearAuditLog();
  });

  afterAll(() => {
    if (originalAuditContent === null) {
      clearAuditLog();
      return;
    }
    fs.writeFileSync(AUDIT_LOG_PATH, originalAuditContent, 'utf8');
  });

  it('accepts legacy merkle checkpoint hashes with diagnostics', () => {
    clearAuditLog();
    for (let i = 0; i < 10; i += 1) {
      logEvent('verification', { index: i }, `compat-merkle-${i}`);
    }

    const lines = fs.readFileSync(AUDIT_LOG_PATH, 'utf8').trim().split('\n');
    const last = JSON.parse(lines.at(-1));
    last.currentHash = legacyMerkleHash(last);
    lines[lines.length - 1] = JSON.stringify(last);
    fs.writeFileSync(AUDIT_LOG_PATH, `${lines.join('\n')}\n`, 'utf8');

    const verification = verifyChain();
    expect(verification.valid).toBe(true);
    expect(verification.strictValid).toBe(false);
    expect(verification.diagnostics.legacyMerkleEntries).toBe(1);

    const diagnostics = getAuditDiagnostics();
    expect(diagnostics.ok).toBe(true);
    expect(diagnostics.issues[0]?.code).toBe('legacy_merkle_checkpoint_hash');
  });
});
