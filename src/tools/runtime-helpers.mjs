import path from 'node:path';

export const TOOL_CAPABILITY_META = {
  file_read: { class: 'read', mutatesState: false, destructive: false, proofHint: 'returned file content/path' },
  file_write: { class: 'mutate', mutatesState: true, destructive: false, proofHint: 'returned bytes/path' },
  file_patch: { class: 'mutate', mutatesState: true, destructive: false, proofHint: 'returned path with ok=true' },
  file_restore_last: { class: 'mutate', mutatesState: true, destructive: false, proofHint: 'returned backupId/path' },
  session_list: { class: 'read', mutatesState: false, destructive: false, proofHint: 'returned sessions[]' },
  session_delete: { class: 'destructive', mutatesState: true, destructive: true, proofHint: 'deleted=true or explicit deletion counters' },
  session_clear: { class: 'destructive', mutatesState: true, destructive: true, proofHint: 'deletedSessions/deletedMessages counters' },
  shell_run: { class: 'execute', mutatesState: true, destructive: false, proofHint: 'command code/stdout/stderr' },
  browser_status: { class: 'read', mutatesState: false, destructive: false, proofHint: 'status payload' },
  browser_navigate: { class: 'execute', mutatesState: true, destructive: false, proofHint: 'target URL in output' },
  browser_search: { class: 'execute', mutatesState: true, destructive: false, proofHint: 'query/output' },
  browser_type: { class: 'execute', mutatesState: true, destructive: false, proofHint: 'selector and submission output' },
  browser_click: { class: 'execute', mutatesState: true, destructive: false, proofHint: 'selector click result' },
  browser_extract: { class: 'read', mutatesState: false, destructive: false, proofHint: 'extracted text' },
  browser_snapshot: { class: 'read', mutatesState: false, destructive: false, proofHint: 'tabs snapshot' },
  http_request: { class: 'execute', mutatesState: true, destructive: false, proofHint: 'status/body payload' },
  http_download: { class: 'mutate', mutatesState: true, destructive: false, proofHint: 'outPath and transfer result' },
  desktop_open: { class: 'execute', mutatesState: true, destructive: false, proofHint: 'process result' },
  desktop_xdotool: { class: 'execute', mutatesState: true, destructive: false, proofHint: 'xdotool command result' },
  skill_list: { class: 'read', mutatesState: false, destructive: false, proofHint: 'skills list' },
  skill_install: { class: 'mutate', mutatesState: true, destructive: false, proofHint: 'installed skill result' },
  skill_review: { class: 'read', mutatesState: false, destructive: false, proofHint: 'review report' },
  skill_approve: { class: 'mutate', mutatesState: true, destructive: false, proofHint: 'approval state' },
  skill_execute: { class: 'execute', mutatesState: true, destructive: false, proofHint: 'skill execution output' },
  skill_uninstall: { class: 'destructive', mutatesState: true, destructive: true, proofHint: 'uninstall confirmation' },
  email_status: { class: 'read', mutatesState: false, destructive: false, proofHint: 'auth/CLI state' },
  email_send: { class: 'mutate', mutatesState: true, destructive: false, proofHint: 'message id / delivery response' },
  email_list: { class: 'read', mutatesState: false, destructive: false, proofHint: 'message list' },
  email_read: { class: 'read', mutatesState: false, destructive: false, proofHint: 'message payload' },
  gworkspace_call: { class: 'execute', mutatesState: true, destructive: false, proofHint: 'api call response' },
  research_run_daily: { class: 'execute', mutatesState: true, destructive: false, proofHint: 'run summary' },
  research_list_recent: { class: 'read', mutatesState: false, destructive: false, proofHint: 'reports[]' },
  research_review_queue: { class: 'read', mutatesState: false, destructive: false, proofHint: 'queue[]' },
  research_approve: { class: 'mutate', mutatesState: true, destructive: false, proofHint: 'approval confirmation' }
};

export function resolveWorkspaceRoot(config) {
  const raw = String(config?.runtime?.workspaceRoot || process.env.OPENUNUM_WORKSPACE || process.cwd());
  return path.resolve(raw);
}

export function safePath(inputPath, workspaceRoot) {
  const resolved = path.resolve(workspaceRoot, String(inputPath || ''));
  const rootWithSep = workspaceRoot.endsWith(path.sep) ? workspaceRoot : `${workspaceRoot}${path.sep}`;
  if (resolved !== workspaceRoot && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Path outside workspace is blocked: ${inputPath}`);
  }
  return resolved;
}

export function hasBlockedShellPattern(cmd) {
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

export function hasUnsafeShellMetacharacters(cmd) {
  return /[;&|`]/.test(String(cmd || ''));
}

export function isLikelyInteractiveShellCommand(cmd) {
  const text = String(cmd || '').trim();
  if (/^ollama run\s+\S+$/i.test(text)) return true;
  if (/^python(\d+(\.\d+)*)?\s+-i\b/i.test(text)) return true;
  if (/^node\s+-i\b/i.test(text)) return true;
  if (/^(sqlite3|psql|mysql)\b/i.test(text) && !/(-c|--command|-e|--execute)\b/.test(text)) return true;
  return false;
}

export function requiresUnlockedMode(cmd) {
  const patterns = [
    /\bsudo\b/i,
    /\bapt(-get)?\s+install\b/i,
    /\bsystemctl\s+(start|stop|restart|enable|disable)\b/i,
    /\buseradd\b|\buserdel\b|\bgroupadd\b|\bgroupdel\b/i,
    /\bmount\b|\bumount\b/i
  ];
  return patterns.some((p) => p.test(String(cmd || '')));
}

export function applySimplePatch(original, find, replace) {
  if (!original.includes(find)) {
    throw new Error('Patch target not found');
  }
  return original.replace(find, replace);
}

export function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function firstMeaningfulLine(text, maxChars = 160) {
  const line = String(text || '')
    .split('\n')
    .map((item) => item.trim())
    .find(Boolean) || '';
  return line.length > maxChars ? `${line.slice(0, maxChars - 3)}...` : line;
}

export function parseListeningPorts(text) {
  const ports = new Set();
  const raw = String(text || '');
  for (const match of raw.matchAll(/[:.]([0-9]{2,5})\b/g)) {
    const port = Number(match[1]);
    if (Number.isFinite(port) && port > 0 && port <= 65535) ports.add(port);
  }
  return [...ports].slice(0, 12);
}

export function extractOperationalFacts(toolName, args = {}, result = {}) {
  if (!result?.ok) return [];
  const facts = [];
  if (toolName === 'browser_navigate' && result.url) {
    facts.push({ key: 'browser.last_url', value: String(result.url) });
  }
  if (toolName === 'http_request' && args?.url) {
    facts.push({ key: 'http.last_url', value: String(args.url) });
    if (Number.isFinite(result.status)) facts.push({ key: 'http.last_status', value: String(result.status) });
  }
  if (toolName !== 'shell_run') return facts;

  const cmd = String(args?.cmd || '').trim().toLowerCase();
  const stdout = String(result?.stdout || '');
  if (!cmd) return facts;

  if (cmd === 'pwd') {
    const line = firstMeaningfulLine(stdout, 240);
    if (line) facts.push({ key: 'workspace.last_pwd', value: line });
  }
  if (cmd.startsWith('uname')) {
    const line = firstMeaningfulLine(stdout, 240);
    if (line) facts.push({ key: 'system.uname', value: line });
  }
  if (cmd.includes('git status')) {
    facts.push({ key: 'repo.git.present', value: 'true' });
    const line = firstMeaningfulLine(stdout, 240);
    if (line) facts.push({ key: 'repo.git.last_status', value: line });
  }
  if (cmd.includes('ollama list')) {
    const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    const count = Math.max(0, lines.length - 1);
    facts.push({ key: 'models.ollama.last_list_count', value: String(count) });
  }
  if (cmd.includes('ss -ltn') || cmd.includes('netstat -ltn')) {
    const ports = parseListeningPorts(stdout);
    if (ports.length) {
      facts.push({ key: 'system.listen_ports', value: ports.join(',') });
    }
  }
  if (cmd.includes('nvidia-smi')) {
    facts.push({ key: 'hardware.gpu.nvidia.present', value: 'true' });
    const line = firstMeaningfulLine(stdout, 240);
    if (line) facts.push({ key: 'hardware.gpu.nvidia.summary', value: line });
  }
  return facts;
}

export function tryParseCurlAsHttpRequest(cmd) {
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

export function parseOllamaRunIntent(cmd) {
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

export function parseOllamaListModelName(listOutput, ref) {
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
