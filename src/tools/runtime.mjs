import fs from 'node:fs';
import path from 'node:path';
import { CDPBrowser } from '../browser/cdp.mjs';
import { ExecutorDaemon } from './executor-daemon.mjs';
import { SkillManager } from '../skills/manager.mjs';
import { GoogleWorkspaceClient } from './google-workspace.mjs';
import { ResearchManager } from '../research/manager.mjs';

function resolveWorkspaceRoot(config) {
  const raw = String(config?.runtime?.workspaceRoot || process.env.OPENUNUM_WORKSPACE || process.cwd());
  return path.resolve(raw);
}

function safePath(inputPath, workspaceRoot) {
  const resolved = path.resolve(workspaceRoot, String(inputPath || ''));
  const rootWithSep = workspaceRoot.endsWith(path.sep) ? workspaceRoot : `${workspaceRoot}${path.sep}`;
  if (resolved !== workspaceRoot && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Path outside workspace is blocked: ${inputPath}`);
  }
  return resolved;
}

function hasBlockedShellPattern(cmd) {
  const patterns = [
    /\brm\s+-rf\s+\/(\s|$)/i,
    /\brm\s+-rf\s+--no-preserve-root\b/i,
    /\bmkfs(\.\w+)?\b/i,
    /\bdd\s+if=.*\bof=\/dev\//i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /:\(\)\s*\{.*\};\s*:/,
    /\bchown\s+-R\s+\/\b/i,
    /\bchmod\s+-R\s+777\s+\/\b/i
  ];
  return patterns.find((p) => p.test(String(cmd || ''))) || null;
}

function hasUnsafeShellMetacharacters(cmd) {
  return /[;&|`]/.test(String(cmd || ''));
}

function isLikelyInteractiveShellCommand(cmd) {
  const text = String(cmd || '').trim();
  if (/^ollama run\s+\S+$/i.test(text)) return true;
  if (/^python(\d+(\.\d+)*)?\s+-i\b/i.test(text)) return true;
  if (/^node\s+-i\b/i.test(text)) return true;
  if (/^(sqlite3|psql|mysql)\b/i.test(text) && !/(-c|--command|-e|--execute)\b/.test(text)) return true;
  return false;
}

function requiresUnlockedMode(cmd) {
  const patterns = [
    /\bsudo\b/i,
    /\bapt(-get)?\s+install\b/i,
    /\bsystemctl\s+(start|stop|restart|enable|disable)\b/i,
    /\buseradd\b|\buserdel\b|\bgroupadd\b|\bgroupdel\b/i,
    /\bmount\b|\bumount\b/i
  ];
  return patterns.some((p) => p.test(String(cmd || '')));
}

function applySimplePatch(original, find, replace) {
  if (!original.includes(find)) {
    throw new Error('Patch target not found');
  }
  return original.replace(find, replace);
}

function tryParseCurlAsHttpRequest(cmd) {
  const text = String(cmd || '').trim();
  if (!/^curl\b/.test(text)) return null;
  if (/[;&|`]/.test(text)) return null;
  const urlMatch = text.match(/https?:\/\/[^\s'"]+/);
  if (!urlMatch) return null;
  const url = urlMatch[0];
  const methodMatch = text.match(/(?:^|\s)-X\s+([A-Za-z]+)/);
  const method = String(methodMatch?.[1] || 'GET').toUpperCase();
  const headerMatches = [...text.matchAll(/(?:^|\s)-H\s+(['"])(.*?)\1/g)];
  const headers = {};
  for (const match of headerMatches) {
    const line = String(match[2] || '');
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  const bodyJsonMatch = text.match(/(?:^|\s)-d\s+'([^']+)'/);
  const bodyTextMatch = text.match(/(?:^|\s)-d\s+"([^"]+)"/);
  let bodyJson = undefined;
  let bodyText = undefined;
  const payload = bodyJsonMatch?.[1] ?? bodyTextMatch?.[1];
  if (payload != null) {
    try {
      bodyJson = JSON.parse(payload);
    } catch {
      bodyText = payload;
    }
  }
  return {
    url,
    method,
    headers,
    bodyJson,
    bodyText
  };
}

function parseOllamaRunIntent(cmd) {
  const text = String(cmd || '').trim();
  if (!/^ollama run\b/i.test(text)) return null;
  if (/[;&`]/.test(text)) return null;
  const promptMatch = text.match(/--prompt\s+(?:'([^']*)'|"([^"]*)")/i);
  let prompt = promptMatch?.[1] ?? promptMatch?.[2] ?? null;
  const modelFlagMatch = text.match(/--model-id\s+(\S+)|--model\s+(\S+)/i);
  let model = modelFlagMatch?.[1] || modelFlagMatch?.[2] || '';
  if (!model) {
    const positional = text.match(/^ollama run\s+(\S+)/i);
    model = positional?.[1] || '';
  }
  if (!model) return null;
  if (prompt == null) {
    const positionalPrompt = text.match(/^ollama run\s+\S+\s+(?:'([^']*)'|"([^"]*)"|(.+))$/i);
    prompt = positionalPrompt?.[1] ?? positionalPrompt?.[2] ?? positionalPrompt?.[3] ?? null;
  }
  return { model, prompt: prompt == null ? null : String(prompt).trim() };
}

function parseOllamaListModelName(listOutput, ref) {
  const target = String(ref || '').trim().toLowerCase();
  if (!target) return null;
  const lines = String(listOutput || '').split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines.slice(1)) {
    const parts = line.split(/\s{2,}/).filter(Boolean);
    if (parts.length < 2) continue;
    const [name, id] = parts;
    if (String(id || '').trim().toLowerCase() === target) return name;
  }
  return null;
}

export class ToolRuntime {
  constructor(config, memoryStore = null) {
    this.config = config;
    this.memoryStore = memoryStore;
    this.workspaceRoot = resolveWorkspaceRoot(config);
    this.skillManager = new SkillManager();
    this.googleWorkspace = new GoogleWorkspaceClient(config);
    this.researchManager = new ResearchManager({ config });
    this.toolCircuit = new Map();
    this.toolCircuitFailureThreshold = Number(config.runtime?.toolCircuitFailureThreshold || 3);
    this.toolCircuitCooldownMs = Number(config.runtime?.toolCircuitCooldownMs || 300000);
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
          name: 'http_request',
          description: 'Make a bounded HTTP request and return status plus parsed response when possible',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              method: { type: 'string' },
              headers: { type: 'object' },
              bodyJson: { type: 'object' },
              bodyText: { type: 'string' },
              timeoutMs: { type: 'number' }
            },
            required: ['url']
          }
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
      },
      {
        type: 'function',
        function: {
          name: 'skill_list',
          description: 'List installed local skills with review/approval status',
          parameters: { type: 'object', properties: {}, additionalProperties: false }
        }
      },
      {
        type: 'function',
        function: {
          name: 'skill_install',
          description: 'Install a skill from URL/path or inline code',
          parameters: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              name: { type: 'string' },
              content: { type: 'string' }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'skill_review',
          description: 'Run security review for an installed skill',
          parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'skill_approve',
          description: 'Approve an installed reviewed skill for execution',
          parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'skill_execute',
          description: 'Execute an approved local skill',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              args: { type: 'object' }
            },
            required: ['name']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'skill_uninstall',
          description: 'Uninstall a local skill',
          parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'email_status',
          description: 'Check googleworkspace CLI availability and auth status',
          parameters: { type: 'object', properties: {}, additionalProperties: false }
        }
      },
      {
        type: 'function',
        function: {
          name: 'email_send',
          description: 'Send Gmail message via googleworkspace CLI',
          parameters: {
            type: 'object',
            properties: {
              to: { type: 'string' },
              subject: { type: 'string' },
              body: { type: 'string' },
              cc: { type: 'string' },
              bcc: { type: 'string' }
            },
            required: ['to', 'subject', 'body']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'email_list',
          description: 'List recent Gmail messages via googleworkspace CLI',
          parameters: {
            type: 'object',
            properties: { limit: { type: 'number' }, query: { type: 'string' } }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'email_read',
          description: 'Read a Gmail message by id via googleworkspace CLI',
          parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'gworkspace_call',
          description: 'Call generic Google Workspace API via googleworkspace CLI (gws)',
          parameters: {
            type: 'object',
            properties: {
              service: { type: 'string' },
              resource: { type: 'string' },
              method: { type: 'string' },
              params: { type: 'object' },
              body: { type: 'object' }
            },
            required: ['service', 'resource', 'method']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'research_run_daily',
          description: 'Run daily research pipeline (findings require review before adoption)',
          parameters: {
            type: 'object',
            properties: { simulate: { type: 'boolean' } }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'research_list_recent',
          description: 'List recent research reports',
          parameters: { type: 'object', properties: { limit: { type: 'number' } } }
        }
      },
      {
        type: 'function',
        function: {
          name: 'research_review_queue',
          description: 'List pending research proposals requiring review',
          parameters: { type: 'object', properties: { limit: { type: 'number' } } }
        }
      },
      {
        type: 'function',
        function: {
          name: 'research_approve',
          description: 'Approve a researched proposal URL for controlled adoption',
          parameters: {
            type: 'object',
            properties: { url: { type: 'string' }, note: { type: 'string' } },
            required: ['url']
          }
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

  getCircuitState(toolName) {
    if (!this.toolCircuit.has(toolName)) {
      this.toolCircuit.set(toolName, {
        failures: 0,
        openedAt: null,
        openUntil: null,
        state: 'closed'
      });
    }
    return this.toolCircuit.get(toolName);
  }

  canExecuteTool(toolName) {
    const state = this.getCircuitState(toolName);
    if (state.state !== 'open') return { ok: true };
    if (state.openUntil && Date.now() >= state.openUntil) {
      state.state = 'half-open';
      return { ok: true };
    }
    return {
      ok: false,
      error: 'tool_circuit_open',
      details: {
        toolName,
        openUntil: state.openUntil ? new Date(state.openUntil).toISOString() : null
      }
    };
  }

  recordToolResult(toolName, success) {
    const state = this.getCircuitState(toolName);
    if (success) {
      state.failures = 0;
      state.state = 'closed';
      state.openUntil = null;
      state.openedAt = null;
      return;
    }
    state.failures += 1;
    if (state.failures >= this.toolCircuitFailureThreshold) {
      state.state = 'open';
      state.openedAt = Date.now();
      state.openUntil = Date.now() + this.toolCircuitCooldownMs;
    }
  }

  async run(name, args, context = {}) {
    const circuit = this.canExecuteTool(name);
    if (!circuit.ok) {
      const out = { ok: false, error: circuit.error, ...circuit.details };
      this.logRun(context, name, args, out);
      return out;
    }

    let result;
    try {
      result = await this.executeTool(name, args, context);
    } catch (error) {
      result = { ok: false, error: String(error.message || error) };
    }

    this.recordToolResult(name, Boolean(result?.ok));
    this.logRun(context, name, args, result);
    return result;
  }

  async executeTool(name, args, context = {}) {
    const deadlineAt = Number.isFinite(context?.deadlineAt) ? Number(context.deadlineAt) : null;
    const remainingBudgetMs = () => {
      if (deadlineAt == null) return null;
      return deadlineAt - Date.now();
    };
    const ensureBudget = () => {
      const ms = remainingBudgetMs();
      if (ms != null && ms <= 0) {
        return { ok: false, code: 1, error: 'turn_deadline_exceeded', stderr: 'Tool execution skipped because the turn budget was exhausted.', stdout: '' };
      }
      return null;
    };
    const shellTimeout = (defaultMs) => {
      const ms = remainingBudgetMs();
      if (ms == null) return defaultMs;
      return Math.max(1000, Math.min(defaultMs, ms));
    };
    const retryOptions = deadlineAt == null ? {} : { deadlineAt };

    if (name === 'file_read') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      const p = safePath(args.path, this.workspaceRoot);
      const content = fs.readFileSync(p, 'utf8');
      return { ok: true, path: p, content };
    }
    if (name === 'file_write') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      const p = safePath(args.path, this.workspaceRoot);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, args.content, 'utf8');
      return { ok: true, path: p, bytes: Buffer.byteLength(args.content, 'utf8') };
    }
    if (name === 'file_patch') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      const p = safePath(args.path, this.workspaceRoot);
      const original = fs.readFileSync(p, 'utf8');
      const patched = applySimplePatch(original, args.find, args.replace);
      fs.writeFileSync(p, patched, 'utf8');
      return { ok: true, path: p };
    }
    if (name === 'shell_run') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      const rawCmd = String(args?.cmd || '').trim();
      const ollamaRunIntent = parseOllamaRunIntent(rawCmd);
      let cmd = rawCmd;
      if (ollamaRunIntent?.model && ollamaRunIntent?.prompt) {
        let modelRef = ollamaRunIntent.model;
        const lookup = await this.executor.runShell('ollama list', shellTimeout(10000), { cwd: this.workspaceRoot, deadlineAt });
        if (/^[a-f0-9]{12,}$/i.test(modelRef)) {
          const resolvedName = lookup?.ok ? parseOllamaListModelName(lookup.stdout, modelRef) : null;
          if (resolvedName) modelRef = resolvedName;
        }
        return this.executeTool('http_request', {
          url: `${this.config.model?.ollamaBaseUrl || 'http://127.0.0.1:11434'}/api/generate`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          bodyJson: {
            model: modelRef,
            prompt: ollamaRunIntent.prompt,
            stream: false
          },
          timeoutMs: shellTimeout(30000)
        }, context);
      }
      const httpRequestArgs = tryParseCurlAsHttpRequest(cmd);
      if (httpRequestArgs) {
        return this.executeTool('http_request', {
          ...httpRequestArgs,
          timeoutMs: shellTimeout(20000)
        }, context);
      }
      const ownerMode = String(this.config.runtime?.ownerControlMode || 'safe').toLowerCase();
      if (!this.config.runtime?.shellEnabled) {
        return { ok: false, code: 1, error: 'shell_disabled', stderr: 'Shell execution is disabled by runtime config.', stdout: '' };
      }
      if (ownerMode === 'safe' && requiresUnlockedMode(cmd)) {
        return {
          ok: false,
          code: 1,
          error: 'owner_mode_restricted',
          stderr: 'Command requires owner-unlocked mode. Set runtime.ownerControlMode to owner-unlocked or owner-unrestricted.'
        };
      }
      const blocked = hasBlockedShellPattern(cmd);
      if (blocked) {
        return { ok: false, code: 1, error: 'shell_blocked', stderr: `Blocked dangerous command pattern: ${blocked}`, stdout: '' };
      }
      const effectiveTimeoutMs = isLikelyInteractiveShellCommand(cmd)
        ? Math.min(shellTimeout(120000), 15000)
        : shellTimeout(120000);
      return this.executor.runShell(cmd, effectiveTimeoutMs, { cwd: this.workspaceRoot, deadlineAt });
    }
    if (name === 'browser_status') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return this.executor.runWithRetry(name, args, () => this.browser.status(), retryOptions);
    }
    if (name === 'browser_navigate') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return this.executor.runWithRetry(name, args, () => this.browser.navigate(args.url), retryOptions);
    }
    if (name === 'browser_search') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return this.executor.runWithRetry(name, args, () => this.browser.search(args.query), retryOptions);
    }
    if (name === 'browser_type') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return this.executor.runWithRetry(name, args, () => this.browser.type(args.selector, args.text, Boolean(args.submit)), retryOptions);
    }
    if (name === 'browser_click') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return this.executor.runWithRetry(name, args, () => this.browser.click(args.selector), retryOptions);
    }
    if (name === 'browser_extract') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return this.executor.runWithRetry(name, args, () => this.browser.extractText(args.selector || 'body'), retryOptions);
    }
    if (name === 'browser_snapshot') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      return this.executor.runWithRetry(name, args, () => this.browser.snapshot(), retryOptions);
    }
    if (name === 'http_download') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      if (!this.config.runtime?.shellEnabled) {
        return { ok: false, code: 1, error: 'shell_disabled', stderr: 'http_download requires shell execution.', stdout: '' };
      }
      const outPath = safePath(args.outPath, this.workspaceRoot);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const out = await this.executor.runShell(`curl -fL ${JSON.stringify(args.url)} -o ${JSON.stringify(outPath)}`, shellTimeout(600000), {
        cwd: this.workspaceRoot,
        deadlineAt
      });
      const result = {
        ...out,
        url: args.url,
        outPath
      };
      return result;
    }
    if (name === 'http_request') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      const method = String(args?.method || 'GET').trim().toUpperCase();
      const timeoutMs = shellTimeout(Number(args?.timeoutMs || 20000));
      const headers = { ...(args?.headers || {}) };
      let body = undefined;
      if (args?.bodyJson !== undefined) {
        body = JSON.stringify(args.bodyJson);
        if (!Object.keys(headers).some((key) => String(key).toLowerCase() === 'content-type')) {
          headers['Content-Type'] = 'application/json';
        }
      } else if (typeof args?.bodyText === 'string') {
        body = args.bodyText;
      }
      const response = await fetch(String(args?.url || ''), {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs)
      });
      const rawText = await response.text();
      let parsedJson = null;
      try {
        parsedJson = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsedJson = null;
      }
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url || String(args?.url || ''),
        headers: Object.fromEntries(response.headers.entries()),
        json: parsedJson,
        text: parsedJson ? '' : rawText
      };
    }
    if (name === 'desktop_open') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      if (!this.config.runtime?.shellEnabled) {
        return { ok: false, code: 1, error: 'shell_disabled', stderr: 'desktop_open requires shell execution.', stdout: '' };
      }
      return this.executor.runShell(`xdg-open ${JSON.stringify(args.target)}`, shellTimeout(15000), { cwd: this.workspaceRoot, deadlineAt });
    }
    if (name === 'desktop_xdotool') {
      const budgetError = ensureBudget();
      if (budgetError) return budgetError;
      if (!this.config.runtime?.shellEnabled) {
        return { ok: false, code: 1, error: 'shell_disabled', stderr: 'desktop_xdotool requires shell execution.', stdout: '' };
      }
      const cmd = String(args?.cmd || '').trim();
      if (!cmd) {
        return { ok: false, code: 1, error: 'invalid_xdotool_command', stderr: 'desktop_xdotool requires a non-empty command.', stdout: '' };
      }
      if (hasUnsafeShellMetacharacters(cmd)) {
        return { ok: false, code: 1, error: 'unsafe_xdotool_command', stderr: 'desktop_xdotool command contains blocked shell metacharacters.', stdout: '' };
      }
      return this.executor.runShell(`xdotool ${cmd}`, shellTimeout(15000), { cwd: this.workspaceRoot, deadlineAt });
    }
    if (name === 'skill_list') {
      return { ok: true, skills: this.skillManager.listSkills() };
    }
    if (name === 'skill_install') {
      return this.skillManager.installSkill(args || {});
    }
    if (name === 'skill_review') {
      return this.skillManager.reviewSkill(args?.name);
    }
    if (name === 'skill_approve') {
      return this.skillManager.approveSkill(args?.name);
    }
    if (name === 'skill_execute') {
      return this.skillManager.executeSkill(args?.name, args?.args || {});
    }
    if (name === 'skill_uninstall') {
      return this.skillManager.uninstallSkill(args?.name);
    }
    if (name === 'email_status') {
      return this.googleWorkspace.status();
    }
    if (name === 'email_send') {
      return this.googleWorkspace.gmailSend(args || {});
    }
    if (name === 'email_list') {
      return this.googleWorkspace.gmailList(args || {});
    }
    if (name === 'email_read') {
      return this.googleWorkspace.gmailRead(args || {});
    }
    if (name === 'gworkspace_call') {
      return this.googleWorkspace.call(args || {});
    }
    if (name === 'research_run_daily') {
      return this.researchManager.runDailyResearch({ simulate: Boolean(args?.simulate) });
    }
    if (name === 'research_list_recent') {
      return this.researchManager.listRecent(Number(args?.limit || 10));
    }
    if (name === 'research_review_queue') {
      return this.researchManager.reviewQueue(Number(args?.limit || 50));
    }
    if (name === 'research_approve') {
      return this.researchManager.approveProposal(String(args?.url || ''), String(args?.note || ''));
    }

    throw new Error(`Unknown tool: ${name}`);
  }
}
