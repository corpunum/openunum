import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../src/memory/store.mjs';

const originalHome = process.env.OPENUNUM_HOME;
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openunum-phase4-'));

try {
  process.env.OPENUNUM_HOME = tempHome;
  const m = new MemoryStore();
  m.rememberFact('favorite_color', 'blue');
  const facts = m.retrieveFacts('favorite_color', 1);
  assert.ok(facts.length >= 1);
  assert.equal(facts[0].key, 'favorite_color');
  console.log('phase4 ok');
} finally {
  if (originalHome == null) delete process.env.OPENUNUM_HOME;
  else process.env.OPENUNUM_HOME = originalHome;
  fs.rmSync(tempHome, { recursive: true, force: true });
}
