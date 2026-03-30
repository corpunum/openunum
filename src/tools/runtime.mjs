import fs from 'node:fs';
import path from 'node:path';
import { CDPBrowser } from '../browser/cdp.mjs';
import { ExecutorDaemon } from './executor-daemon.mjs';

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
  constructor(config, memoryStore = null) {
    this.config = config;
    this.memoryStore = memoryStore;
    this.browser = new CDPBrowser(config.browser?.cdpUrl || 'http://127.0.0.1:9222');
    this.executor = new ExecutorDaemon({
      retryAttempts: config.runtime?.executorRetryAttempts ?? 3,
      retryBackoffMs: config.runtime?.executorRetryBackoffMs ?? 700
    });
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
          description: 'Run a shell command',
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
          name: 'browser_navigate',
          description: 'Navigate browser to URL',
          parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_search',
          description: 'Search the web from browser',
          parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_type',
          description: 'Type text in element selector',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string' },
              text: { type: 'string' },
              submit: { type: 'boolean' }
            },
            required: ['selector', 'text']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_click',
          description: 'Click element selector',
          parameters: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_extract',
          description: 'Extract visible text from selector',
          parameters: { type: 'object', properties: { selector: { type: 'string' } }, required: [] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_snapshot',
          description: 'List tabs and active tab metadata',
          parameters: { type: 'object', properties: {}, additionalProperties: false }
        }
      },
      {
        type: 'function',
        function: {
          name: 'http_download',
          description: 'Download a URL to a local path via curl',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              outPath: { type: 'string' }
            },
            required: ['url', 'outPath']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'desktop_open',
          description: 'Open app/file/url via xdg-open',
          parameters: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'desktop_xdotool',
          description: 'Run xdotool command for desktop control',
          parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] }
        }
      }
    ];
  }

  logRun(context, toolName, args, result) {
    const sessionId = context?.sessionId;
    if (!sessionId || !this.memoryStore?.recordToolRun) return;
    this.memoryStore.recordToolRun({
      sessionId,
      toolName,
      args,
      result
    });
  }

  async run(name, args, context = {}) {
    if (name === 'file_read') {
      const p = safePath(args.path);
      const content = fs.readFileSync(p, 'utf8');
      const out = { ok: true, path: p, content };
      this.logRun(context, name, args, out);
      return out;
    }
    if (name === 'file_write') {
      const p = safePath(args.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, args.content, 'utf8');
      const out = { ok: true, path: p, bytes: Buffer.byteLength(args.content, 'utf8') };
      this.logRun(context, name, args, out);
      return out;
    }
    if (name === 'file_patch') {
      const p = safePath(args.path);
      const original = fs.readFileSync(p, 'utf8');
      const patched = applySimplePatch(original, args.find, args.replace);
      fs.writeFileSync(p, patched, 'utf8');
      const out = { ok: true, path: p };
      this.logRun(context, name, args, out);
      return out;
    }
    if (name === 'shell_run') {
      const out = await this.executor.runShell(args.cmd, 120000);
      this.logRun(context, name, args, out);
      return out;
    }
    if (name === 'browser_status') {
      const out = await this.executor.runWithRetry(name, args, () => this.browser.status());
      this.logRun(context, name, args, out);
      return out;
    }
    if (name === 'browser_navigate') {
      const out = await this.executor.runWithRetry(name, args, () => this.browser.navigate(args.url));
      this.logRun(context, name, args, out);
      return out;
    }
    if (name === 'browser_search') {
      const out = await this.executor.runWithRetry(name, args, () => this.browser.search(args.query));
      this.logRun(context, name, args, out);
      return out;
    }
    if (name === 'browser_type') {
      const out = await this.executor.runWithRetry(name, args, () => this.browser.type(args.selector, args.text, Boolean(args.submit)));
      this.logRun(context, name, args, out);
      return out;
    }
    if (name === 'browser_click') {
      const out = await this.executor.runWithRetry(name, args, () => this.browser.click(args.selector));
      this.logRun(context, name, args, out);
      return out;
    }
    if (name === 'browser_extract') {
      const out = await this.executor.runWithRetry(name, args, () => this.browser.extractText(args.selector || 'body'));
      this.logRun(context, name, args, out);
      return out;
    }
    if (name === 'browser_snapshot') {
      const out = await this.executor.runWithRetry(name, args, () => this.browser.snapshot());
      this.logRun(context, name, args, out);
      return out;
    }
    if (name === 'http_download') {
      const outPath = safePath(args.outPath);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const out = await this.executor.runShell(`curl -fL ${JSON.stringify(args.url)} -o ${JSON.stringify(outPath)}`, 600000);
      const result = {
        ...out,
        url: args.url,
        outPath
      };
      this.logRun(context, name, args, result);
      return result;
    }
    if (name === 'desktop_open') {
      const out = await this.executor.runShell(`xdg-open ${JSON.stringify(args.target)}`, 15000);
      this.logRun(context, name, args, out);
      return out;
    }
    if (name === 'desktop_xdotool') {
      const out = await this.executor.runShell(`xdotool ${args.cmd}`, 15000);
      this.logRun(context, name, args, out);
      return out;
    }

    throw new Error(`Unknown tool: ${name}`);
  }
}
