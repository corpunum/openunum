/**
 * AlternativePaths — Suggest alternative tools/approaches on failure
 * Model-agnostic: rule-based, no model inference needed
 */

const TOOL_ALTERNATIVES = {
  shell_run: {
    'command not found': [
      { tool: 'shell_run', args: { cmd: 'which <command>' }, hint: 'Check if command exists' },
      { tool: 'shell_run', args: { cmd: 'apt list --installed 2>/dev/null | grep <package>' }, hint: 'Check if package installed' },
      { tool: 'http_request', hint: 'If fetching data, try http_request instead' }
    ],
    'permission denied': [
      { tool: 'shell_run', hint: 'Check permissions: ls -la <path>' },
      { tool: 'shell_run', hint: 'Try with different user or check ownership' }
    ],
    'timeout': [
      { tool: 'shell_run', hint: 'Break into smaller commands' },
      { tool: 'http_request', hint: 'If fetching URL, use http_request with timeout' }
    ],
    'no such file': [
      { tool: 'shell_run', args: { cmd: 'find / -name <filename> 2>/dev/null' }, hint: 'Search for file' },
      { tool: 'shell_run', args: { cmd: 'ls -la <directory>' }, hint: 'List directory contents' }
    ]
  },
  http_request: {
    'ECONNREFUSED': [
      { tool: 'shell_run', args: { cmd: 'ss -tlnp | grep <port>' }, hint: 'Check if port is listening' },
      { tool: 'shell_run', args: { cmd: 'systemctl status <service>' }, hint: 'Check service status' }
    ],
    '404': [
      { tool: 'browser_navigate', hint: 'Try browsing to find correct URL' },
      { tool: 'http_request', hint: 'Try without path or with different endpoint' }
    ],
    'timeout': [
      { tool: 'http_request', hint: 'Retry with longer timeoutMs' },
      { tool: 'shell_run', args: { cmd: 'curl -v <url>' }, hint: 'Debug with curl verbose' }
    ],
    '401': [
      { tool: 'http_request', hint: 'Check authentication headers' }
    ],
    '403': [
      { tool: 'http_request', hint: 'Check permissions or API key' }
    ]
  },
  file_read: {
    'ENOENT': [
      { tool: 'shell_run', args: { cmd: 'find / -name <filename> 2>/dev/null' }, hint: 'Search for file' },
      { tool: 'shell_run', args: { cmd: 'ls -la <directory>' }, hint: 'Check directory' }
    ],
    'EACCES': [
      { tool: 'shell_run', args: { cmd: 'ls -la <path>' }, hint: 'Check permissions' }
    ]
  },
  file_write: {
    'ENOENT': [
      { tool: 'shell_run', args: { cmd: 'mkdir -p <directory>' }, hint: 'Create parent directory first' }
    ],
    'EACCES': [
      { tool: 'shell_run', args: { cmd: 'ls -la <directory>' }, hint: 'Check directory permissions' }
    ]
  },
  browser_navigate: {
    'timeout': [
      { tool: 'http_request', hint: 'Try http_request for API/data instead' }
    ]
  }
};

/**
 * Get alternative suggestions for a failed tool call
 * @param {string} toolName - The tool that failed
 * @param {string} error - Error message
 * @returns {{ found: boolean, suggestions: Array }}
 */
export function suggestAlternatives(toolName, error) {
  const alternatives = TOOL_ALTERNATIVES[toolName] || {};
  const errorLower = String(error).toLowerCase();

  for (const [pattern, suggestions] of Object.entries(alternatives)) {
    if (errorLower.includes(pattern.toLowerCase())) {
      return {
        found: true,
        pattern,
        suggestions: suggestions.map(s => ({
          tool: s.tool,
          hint: s.hint,
          args: s.args || null
        }))
      };
    }
  }

  return { found: false, suggestions: [] };
}

/**
 * Format alternatives as human-readable text
 */
export function formatAlternatives(result) {
  if (!result.found) return '';

  const lines = [`Alternative approaches for "${result.pattern}":`];
  result.suggestions.forEach((s, i) => {
    lines.push(`  ${i + 1}. [${s.tool}] ${s.hint}`);
  });
  return lines.join('\n');
}
