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

    case 'file_search':
      summary.root = result.root;
      summary.pattern = result.pattern;
      summary.count = Number.isFinite(result.count) ? result.count : undefined;
      summary.truncated = Boolean(result.truncated);
      summary.files = Array.isArray(result.files)
        ? result.files.slice(0, 12).map((item) => truncateMiddle(item, 220))
        : [];
      break;

    case 'file_grep':
      summary.search = result.search;
      summary.pattern = result.pattern;
      summary.totalMatches = Number.isFinite(result.totalMatches) ? result.totalMatches : undefined;
      summary.truncated = Boolean(result.truncated);
      summary.matches = Array.isArray(result.matches)
        ? result.matches.slice(0, 10).map((item) => ({
          file: item?.file || '',
          lineNum: Number.isFinite(item?.lineNum) ? item.lineNum : undefined,
          line: truncateMiddle(item?.line || item?.content || '', 180)
        }))
        : [];
      break;

    case 'http_request':
      summary.status = result.status;
      summary.body = truncateMiddle(
        typeof result.body === 'string' ? result.body : JSON.stringify(result.body),
        350
      );
      break;

    case 'web_search':
      summary.backend = result.backend;
      summary.total = Number.isFinite(result.total) ? result.total : undefined;
      summary.results = Array.isArray(result.results)
        ? result.results.slice(0, 6).map((item) => ({
          title: truncateMiddle(item?.title || '', 180),
          url: item?.url || '',
          snippet: truncateMiddle(item?.snippet || '', 220)
        }))
        : [];
      if (Array.isArray(result.searchAttempts)) {
        summary.searchAttempts = result.searchAttempts.slice(0, 4);
      }
      break;

    case 'web_fetch':
      summary.url = result.url;
      summary.title = truncateMiddle(result.title || '', 180);
      summary.content = truncateMiddle(result.content || result.text || '', 320);
      summary.contentType = result.contentType;
      break;

    case 'browser_extract':
    case 'browser_snapshot':
      summary.text = truncateMiddle(
        typeof result.text === 'string' ? result.text : JSON.stringify(result),
        350
      );
      break;

    case 'image_generate':
      summary.ok = true;
      summary.imageCount = Array.isArray(result.images) ? result.images.length : 0;
      summary.parameters = result.parameters;
      summary.info = truncateMiddle(result.info || '', 200);
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
  if (toolName === 'image_generate') return true;
  const raw = JSON.stringify(result);
  return raw.length > threshold;
}
