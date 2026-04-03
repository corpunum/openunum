/**
 * Tool Result Summarizer
 * Reduces context consumption by summarizing large tool results.
 * Small models benefit most from this — prevents context overflow.
 */

const DEFAULT_MAX_CHARS = 500;

export function summarizeToolResult(toolName, result, maxChars = DEFAULT_MAX_CHARS) {
  if (!result) return result;

  const raw = JSON.stringify(result);
  if (raw.length <= maxChars) return result; // No truncation needed

  const summary = {
    ok: result.ok,
    tool: toolName,
    _truncated: true,
    _originalBytes: raw.length
  };

  switch (toolName) {
    case 'shell_run':
      summary.code = result.code;
      summary.stdout = truncateMiddle(result.stdout, 300);
      if (result.stderr) summary.stderr = truncateMiddle(result.stderr, 100);
      break;

    case 'file_read':
      summary.path = result.path;
      summary.content = truncateMiddle(result.content, 350);
      break;

    case 'http_request':
      summary.status = result.status;
      summary.body = truncateMiddle(
        typeof result.body === 'string' ? result.body : JSON.stringify(result.body),
        350
      );
      break;

    case 'browser_extract':
    case 'browser_snapshot':
      summary.text = truncateMiddle(
        typeof result.text === 'string' ? result.text : JSON.stringify(result),
        350
      );
      break;

    default:
      // Generic: just truncate the whole thing
      summary.data = truncateMiddle(raw, maxChars);
      break;
  }

  return summary;
}

function truncateMiddle(text, maxLen) {
  if (!text) return text;
  const str = String(text);
  if (str.length <= maxLen) return str;

  const half = Math.floor((maxLen - 20) / 2);
  return str.slice(0, half) + '\n...[truncated ' + (str.length - maxLen) + ' chars]...\n' + str.slice(-half);
}

/**
 * Check if a result should be summarized based on tool name and size
 */
export function shouldSummarize(toolName, result, threshold = 2000) {
  if (!result) return false;
  const raw = JSON.stringify(result);
  return raw.length > threshold;
}
