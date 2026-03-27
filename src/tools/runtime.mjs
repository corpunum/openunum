import fs from 'node:fs';
import path from 'node:path';
import { CDPBrowser } from '../browser/cdp.mjs';

function safePath(inputPath) {
  return path.resolve(process.cwd(), inputPath);
}

function applySimplePatch(original, find, replace) {
  if (!original.includes(find)) {
    throw new Error('Patch target not found');
  }
  return original.replace(find, replace);
}

export class ToolRuntime {
  constructor(config) {
    this.config = config;
    this.browser = new CDPBrowser(config.browser?.cdpUrl || 'http://127.0.0.1:9222');
  }

  toolSchemas() {
    return [
      {
        type: 'function',
        function: {
          name: 'file_read',
          description: 'Read a UTF-8 file',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'file_write',
          description: 'Write a UTF-8 file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' }, content: { type: 'string' } },
            required: ['path', 'content']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'file_patch',
          description: 'Patch a file by replacing one string with another',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              find: { type: 'string' },
              replace: { type: 'string' }
            },
            required: ['path', 'find', 'replace']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'shell_run',
          description: 'Run a shell command (disabled unless explicitly enabled)',
          parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_status',
          description: 'Get browser CDP status',
          parameters: { type: 'object', properties: {}, additionalProperties: false }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_open',
          description: 'Open URL in CDP browser',
          parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_snapshot',
          description: 'List tabs and active tab metadata',
          parameters: { type: 'object', properties: {}, additionalProperties: false }
        }
      }
    ];
  }

  async run(name, args) {
    if (name === 'file_read') {
      const p = safePath(args.path);
      const content = fs.readFileSync(p, 'utf8');
      return { ok: true, path: p, content };
    }
    if (name === 'file_write') {
      const p = safePath(args.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, args.content, 'utf8');
      return { ok: true, path: p, bytes: Buffer.byteLength(args.content, 'utf8') };
    }
    if (name === 'file_patch') {
      const p = safePath(args.path);
      const original = fs.readFileSync(p, 'utf8');
      const patched = applySimplePatch(original, args.find, args.replace);
      fs.writeFileSync(p, patched, 'utf8');
      return { ok: true, path: p };
    }
    if (name === 'shell_run') {
      if (!this.config.runtime?.shellEnabled && process.env.OPENUNUM_SHELL_ENABLED !== '1') {
        throw new Error('shell_run disabled. Set runtime.shellEnabled=true or OPENUNUM_SHELL_ENABLED=1');
      }
      const { exec } = await import('node:child_process');
      return new Promise((resolve) => {
        exec(args.cmd, { timeout: 20000 }, (error, stdout, stderr) => {
          resolve({ ok: !error, code: error?.code ?? 0, stdout, stderr, error: error?.message || null });
        });
      });
    }
    if (name === 'browser_status') return this.browser.status();
    if (name === 'browser_open') return this.browser.open(args.url);
    if (name === 'browser_snapshot') return this.browser.snapshot();

    throw new Error(`Unknown tool: ${name}`);
  }
}
