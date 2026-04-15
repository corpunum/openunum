import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUDIT_LOG_PATH } from '../../src/core/audit-log.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('audit log path', () => {
  it('uses canonical repo-root data path', () => {
    const expected = path.resolve(__dirname, '..', '..', 'data', 'audit-log.jsonl');
    expect(path.resolve(AUDIT_LOG_PATH)).toBe(expected);
  });
});
