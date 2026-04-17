import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_LOG_PATH } from '../../src/core/audit-log.mjs';

describe('audit log path', () => {
  it('uses canonical OPENUNUM_HOME audit path', () => {
    const expected = path.resolve(
      process.env.OPENUNUM_HOME || path.join(os.homedir(), '.openunum'),
      'audit',
      'audit-log.jsonl'
    );
    expect(path.resolve(AUDIT_LOG_PATH)).toBe(expected);
  });
});
