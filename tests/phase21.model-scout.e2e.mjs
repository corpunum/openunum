import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, stopServer, jget, jpost } from './_helpers.mjs';

function startMockCatalogServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/api/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([
        { id: 'org/test-model', downloads: 123456, likes: 321 }
      ]));
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/api/models/org%2Ftest-model' || url.pathname === '/api/models/org/test-model')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'org/test-model',
        siblings: [
          { rfilename: 'README.md' },
          { rfilename: 'tiny.gguf' }
        ]
      }));
      return;
    }

    if (url.pathname === '/org/test-model/resolve/main/tiny.gguf') {
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': '12'
        });
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': '12'
      });
      res.end('mock-weights');
      return;
    }

    if (url.pathname === '/org/test-model/resolve/main/README.md') {
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'Content-Type': 'text/markdown',
          'Content-Length': '16'
        });
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/markdown',
        'Content-Length': '16'
      });
      res.end('# mock model\n');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/generate') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const parsed = body ? JSON.parse(body) : {};
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          model: parsed.model || 'mock-model',
          response: 'READY local mock evaluation'
        }));
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found', path: url.pathname }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

let proc;
let mock;

try {
  mock = await startMockCatalogServer();
  proc = await startServer();

  const run = await jpost('/api/autonomy/model-scout/run', {
    query: 'test model',
    catalogBaseUrl: mock.baseUrl,
    ollamaBaseUrl: mock.baseUrl,
    localModel: 'mock-local-model',
    maxDownloadBytes: 1024,
    evaluatePrompt: 'Say READY',
    outDir: 'tmp/phase21-scout'
  });

  assert.equal(run.status, 200);
  assert.equal(run.json.ok, true);
  assert.equal(run.json.run.status, 'completed');
  assert.equal(run.json.run.selectedCandidate.id, 'org/test-model');
  assert.equal(run.json.run.artifact.fileName, 'tiny.gguf');
  assert.equal(run.json.run.artifact.ok, true);
  assert.equal(run.json.run.localEvaluation.ok, true);
  assert.equal(run.json.run.localEvaluation.model, 'mock-local-model');

  const outPath = run.json.run.artifact.outPath;
  assert.equal(Boolean(outPath), true);
  assert.equal(fs.existsSync(path.resolve(outPath)), true);

  const status = await jget(`/api/autonomy/model-scout/status?id=${encodeURIComponent(run.json.run.id)}`);
  assert.equal(status.status, 200);
  assert.equal(status.json.ok, true);
  assert.equal(status.json.run.selectedCandidate.id, 'org/test-model');

  const listed = await jget('/api/autonomy/model-scout?limit=10');
  assert.equal(listed.status, 200);
  assert.equal(listed.json.ok, true);
  assert.equal(listed.json.runs.some((item) => item.id === run.json.run.id), true);

  console.log('phase21.model-scout.e2e: ok');
} finally {
  await stopServer(proc);
  if (mock?.server) await new Promise((resolve) => mock.server.close(resolve));
  fs.rmSync('/home/corp-unum/openunum/tmp/phase21-scout', { recursive: true, force: true });
}
