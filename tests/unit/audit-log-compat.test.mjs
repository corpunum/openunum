import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import {
  AUDIT_LOG_PATH,
  clearAuditLog,
  getAuditDiagnostics,
  logEvent,
  verifyChain
} from '../../src/core/audit-log.mjs';

let originalAuditContent = null;

// Resolve the actual HMAC secret being used (matches audit-log.mjs logic)
function resolveActualHmacSecret() {
  if (process.env.AUDIT_HMAC_SECRET) return process.env.AUDIT_HMAC_SECRET;
  const homeDir = process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum');
  const secretPath = path.join(homeDir, 'audit-hmac-secret');
  try {
    if (fs.existsSync(secretPath)) {
      const stored = fs.readFileSync(secretPath, 'utf8').trim();
      if (stored.length >= 32) return stored;
    }
  } catch { /* ignore */ }
  return 'openunum-audit-secret-change-in-production';
}

function legacyMerkleHash(entry) {
  const secret = resolveActualHmacSecret();
  return crypto
    .createHmac('sha256', secret)
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
