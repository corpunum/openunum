import { logInfo, logError } from '../logger.mjs';

/**
 * Web Search Tool — External Strategy Implementation
 * 
 * Provides web search capabilities for the full-search routing strategy.
 * Supports multiple search backends: DuckDuckGo (default), Brave, SerpAPI.
 * Note: CDP-backed browser search is handled by runtime (`backend: cdp|auto`).
 */

const DEFAULT_BACKEND = 'duckduckgo';
const MAX_RESULTS = 10;
const REQUEST_TIMEOUT = 15000;

/**
 * Search the web
 * @param {Object} params
 * @param {string} params.query - Search query
 * @param {string} [params.backend] - 'duckduckgo' | 'brave' | 'serpapi'
 * @param {number} [params.limit] - Max results (default: 10)
 * @param {string} [params.region] - Region code (e.g., 'us-en', 'uk-en')
 * @returns {Promise<{results: Array<{title, url, snippet}>, query, backend, total}>}
 */
export async function web_search({ query, backend = DEFAULT_BACKEND, limit = MAX_RESULTS, region = 'us-en' }) {
  const selectedBackend = String(backend || DEFAULT_BACKEND).toLowerCase();
  logInfo('web_search_invoked', { query: query?.substring(0, 50), backend: selectedBackend, limit });

  try {
    switch (selectedBackend) {
      case 'duckduckgo':
        return await searchDuckDuckGo(query, limit, region);
      case 'brave':
        // Never hard-fail the turn on missing Brave key; degrade to DuckDuckGo.
        return await searchBraveWithFallback(query, limit, region);
      case 'serpapi':
        return await searchSerpApi(query, limit, region);
      default:
        throw new Error(`Unknown search backend: ${selectedBackend}`);
    }
  } catch (error) {
    logError('web_search_failed', { error: String(error.message || error), backend: selectedBackend });
    throw error;
  }
}

/**
 * Fetch content from a URL
 * @param {Object} params
 * @param {string} params.url - URL to fetch
 * @param {string} [params.extractMode] - 'markdown' | 'text' (default: markdown)
 * @param {number} [params.maxChars] - Max characters to return
 * @returns {Promise<{url, content, title, contentType}>}
 */
export async function web_fetch({ url, extractMode = 'markdown', maxChars = 10000 }) {
  logInfo('web_fetch_invoked', { url: url?.substring(0, 100), extractMode });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OpenUnum/1.0)'
      }
    });
    
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || 'text/html';
    const html = await response.text();
    
    // Simple extraction (can be enhanced with proper HTML parser)
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '';
    const content = extractMode === 'text' 
      ? stripHtml(html).substring(0, maxChars)
      : htmlToMarkdown(html).substring(0, maxChars);

    return {
      url,
      title,
      content,
      contentType,
      truncated: html.length > maxChars
    };
  } catch (error) {
    logError('web_fetch_failed', { error: String(error.message || error), url });
    throw error;
  }
}

/**
 * DuckDuckGo search (no API key required)
 * @private
 */
async function searchDuckDuckGo(query, limit, region) {
  // DuckDuckGo HTML endpoint
  const searchUrl = new URL('https://html.duckduckgo.com/html/');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('kl', region);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(searchUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html'
      }
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`DuckDuckGo returned ${response.status}`);
    }

    const html = await response.text();
    const results = parseDuckDuckGoResults(html, limit);

    return {
      ok: true,
      results,
      query,
      backend: 'duckduckgo',
      total: results.length,
      region
    };
  } catch (error) {
    logError('duckduckgo_search_failed', { error: String(error.message || error) });
    throw error;
  }
}

/**
 * Parse DuckDuckGo HTML results
 * @private
 */
function parseDuckDuckGoResults(html, limit) {
  const results = [];
  
  // Extract result blocks
  const resultRegex = /<div class="result[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi;
  const matches = html.match(resultRegex) || [];

  for (const block of matches.slice(0, limit)) {
    try {
      const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>([^<]*)<\/a>/i);
      const urlMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"/i);
      const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/i);

      if (titleMatch && urlMatch) {
        const normalizedUrl = normalizeDuckDuckGoUrl(urlMatch[1]);
        results.push({
          title: decodeHtmlEntities(titleMatch[1]),
          url: normalizedUrl,
          snippet: decodeHtmlEntities(snippetMatch?.[1] || '')
        });
      }
    } catch (e) {
      // Skip malformed results
    }
  }

  return results;
}

/**
 * Brave Search (requires API key)
 * @private
 */
async function searchBrave(query, limit, region) {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    throw new Error('BRAVE_API_KEY environment variable not set');
  }
  const searchUrl = new URL('https://api.search.brave.com/res/v1/web/search');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('count', String(limit));
  searchUrl.searchParams.set('search_lang', region.split('-')[1] || 'en');
  searchUrl.searchParams.set('country', (region.split('-')[0] || 'us').toUpperCase());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  const response = await fetch(searchUrl.toString(), {
    method: 'GET',
    signal: controller.signal,
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey
    }
  });
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`Brave API returned ${response.status}`);
  }

  const data = await response.json();
  
  return {
    ok: true,
    results: (data.web?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description
    })),
    query,
    backend: 'brave',
    total: data.web?.total_results || 0,
    region
  };
}

async function searchBraveWithFallback(query, limit, region) {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    const out = await searchDuckDuckGo(query, limit, region);
    return {
      ...out,
      backend: 'duckduckgo',
      fallbackFrom: 'brave',
      warning: 'BRAVE_API_KEY not set; used duckduckgo fallback.'
    };
  }
  try {
    return await searchBrave(query, limit, region);
  } catch (error) {
    logError('brave_search_fallback_to_duckduckgo', { error: String(error.message || error) });
    const out = await searchDuckDuckGo(query, limit, region);
    return {
      ...out,
      backend: 'duckduckgo',
      fallbackFrom: 'brave',
      warning: `Brave search failed (${String(error.message || error)}); used duckduckgo fallback.`
    };
  }
}

/**
 * SerpAPI (requires API key)
 * @private
 */
async function searchSerpApi(query, limit, region) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    throw new Error('SERPAPI_KEY environment variable not set');
  }

  const searchUrl = new URL('https://serpapi.com/search');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('api_key', apiKey);
  searchUrl.searchParams.set('engine', 'google');
  searchUrl.searchParams.set('num', String(limit));
  searchUrl.searchParams.set('gl', region.split('-')[0] || 'us');

  const response = await fetch(searchUrl.toString());
  
  if (!response.ok) {
    throw new Error(`SerpAPI returned ${response.status}`);
  }

  const data = await response.json();

  return {
    ok: true,
    results: (data.organic_results || []).map(r => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet
    })),
    query,
    backend: 'serpapi',
    total: data.search_information?.total_results || 0,
    region
  };
}

/**
 * Strip HTML tags
 * @private
 */
function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convert HTML to markdown
 * @private
 */
function htmlToMarkdown(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<h1[^>]*>([^<]*)<\/h1>/gi, '# $1\n')
    .replace(/<h2[^>]*>([^<]*)<\/h2>/gi, '## $1\n')
    .replace(/<h3[^>]*>([^<]*)<\/h3>/gi, '### $1\n')
    .replace(/<p[^>]*>([^<]*)<\/p>/gi, '$1\n\n')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '[$2]($1)')
    .replace(/<li[^>]*>([^<]*)<\/li>/gi, '- $1\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Decode HTML entities
 * @private
 */
function decodeHtmlEntities(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#x27;': "'",
    '&#x2F;': '/',
    '&#39;': "'",
    '&#34;': '"'
  };
  return text.replace(/&[^;]+;/g, entity => entities[entity] || entity);
}

function normalizeDuckDuckGoUrl(rawUrl) {
  const decodedHref = decodeHtmlEntities(String(rawUrl || '').trim());
  if (!decodedHref) return '';
  try {
    if (decodedHref.startsWith('//duckduckgo.com/l/?') || decodedHref.startsWith('https://duckduckgo.com/l/?') || decodedHref.startsWith('/l/?')) {
      const href = decodedHref.startsWith('/l/?')
        ? `https://duckduckgo.com${decodedHref}`
        : (decodedHref.startsWith('//') ? `https:${decodedHref}` : decodedHref);
      const parsed = new URL(href);
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) return decodeURIComponent(uddg);
      return href;
    }
    return decodedHref;
  } catch {
    return decodedHref;
  }
}

/**
 * Tool definitions for runtime registration
 */
export const toolDefinitions = {
  web_search: {
    description: 'Search the web for current information',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query'
        },
        backend: {
          type: 'string',
          enum: ['duckduckgo', 'brave', 'serpapi', 'auto', 'cdp'],
          description: 'Search backend (runtime supports auto/cdp via Chrome CDP when available)'
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 10)'
        },
        region: {
          type: 'string',
          description: 'Region code (default: us-en)'
        }
      },
      required: ['query']
    }
  },
  web_fetch: {
    description: 'Fetch and extract content from a URL',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch'
        },
        extractMode: {
          type: 'string',
          enum: ['markdown', 'text'],
          description: 'Content extraction mode (default: markdown)'
        },
        maxChars: {
          type: 'number',
          description: 'Maximum characters to return (default: 10000)'
        }
      },
      required: ['url']
    }
  }
};

export default {
  web_search,
  web_fetch,
  toolDefinitions
};
