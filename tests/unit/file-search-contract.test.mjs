import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { file_search, file_grep, file_info } from '../../src/tools/file-search.mjs';

describe('file-search tool result contract', () => {
  it('returns ok=true for file_search, file_grep, and file_info', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openunum-file-search-'));
    const target = path.join(root, 'alpha.txt');
    fs.writeFileSync(target, 'hello world\nline two\n', 'utf8');

    const s = await file_search({ pattern: '*.txt', root, recursive: true });
    expect(s.ok).toBe(true);
    expect(Array.isArray(s.files)).toBe(true);

    const g = await file_grep({ search: 'hello', root, pattern: '*.txt' });
    expect(g.ok).toBe(true);
    expect(Array.isArray(g.matches)).toBe(true);

    const i = await file_info({ path: target });
    expect(i.ok).toBe(true);
    expect(i.path).toBe(target);
    expect(i.isFile).toBe(true);
  });
});

