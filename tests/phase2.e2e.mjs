import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ToolRuntime } from '../src/tools/runtime.mjs';
import { loadConfig } from '../src/config.mjs';

const cfg = loadConfig();
cfg.runtime.shellEnabled = true;
const tools = new ToolRuntime(cfg);

const p = path.join(process.cwd(), 'tests', 'phase2.tmp.txt');
await tools.run('file_write', { path: p, content: 'hello' });
const r = await tools.run('file_read', { path: p });
assert.equal(r.content, 'hello');
await tools.run('file_patch', { path: p, find: 'hello', replace: 'world' });
const r2 = await tools.run('file_read', { path: p });
assert.equal(r2.content, 'world');
const shell = await tools.run('shell_run', { cmd: 'uname -s' });
assert.equal(shell.ok, true);
fs.unlinkSync(p);
console.log('phase2 ok');
