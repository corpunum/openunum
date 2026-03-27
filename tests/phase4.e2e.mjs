import assert from 'node:assert/strict';
import { MemoryStore } from '../src/memory/store.mjs';

const m = new MemoryStore();
m.rememberFact('favorite_color', 'blue');
const facts = m.retrieveFacts('favorite_color', 1);
assert.ok(facts.length >= 1);
assert.equal(facts[0].key, 'favorite_color');
console.log('phase4 ok');
