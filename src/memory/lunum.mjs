import crypto from 'node:crypto';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'as',
  'and', 'or', 'but', 'so', 'because', 'that', 'this', 'these', 'those',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'them',
  'my', 'your', 'our', 'their', 'mine', 'yours', 'ours', 'theirs',
  'do', 'does', 'did', 'doing', 'have', 'has', 'had', 'having',
  'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must',
  'please', 'just', 'very', 'really', 'also', 'then'
]);

const LUNUM_VERSION = '2.7-shadow';

function normalizeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function estimateTextTokens(text) {
  const normalized = normalizeText(text);
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function hasStructuredBlock(text) {
  return /```|`[^`]+`|{[\s\S]*}|<[^>]+>|\[[^\]]+\]\([^)]+\)/.test(String(text || ''));
}

function isQuestion(text) {
  return /\?\s*$/.test(String(text || ''));
}

function hasNegation(text) {
  return /\b(not|never|no|cannot|can't|dont|don't|wont|won't)\b/i.test(String(text || ''));
}

function tokenizeForTelegraph(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function renderTelegraph(text) {
  const tokens = tokenizeForTelegraph(text).filter((token) => !STOPWORDS.has(token));
  if (!tokens.length) return '';
  const header = [];
  if (isQuestion(text)) header.push('q');
  if (hasNegation(text)) header.push('not');
  return [...header, ...tokens].join(' ').trim();
}

function buildFingerprint(codeText) {
  const payload = normalizeText(codeText);
  if (!payload) return null;
  return crypto.createHash('sha1').update(payload).digest('hex').slice(0, 20);
}

export function deriveLunumSidecar({ role = '', content = '' } = {}) {
  const text = normalizeText(content);
  const allowedRole = ['user', 'assistant', 'system'].includes(String(role || ''));
  const eligibleLength = text.length >= 8 && text.length <= 800;
  const eligibleStructure = !hasStructuredBlock(text);
  const eligible = Boolean(allowedRole && eligibleLength && eligibleStructure);
  const code = eligible ? renderTelegraph(text) : '';
  const lunumCode = code || null;
  const lunumFp = lunumCode ? buildFingerprint(lunumCode) : null;
  const lunumSem = lunumCode
    ? {
      v: LUNUM_VERSION,
      kind: 'telegraph',
      role: String(role || ''),
      sourceChars: text.length,
      codeChars: lunumCode.length
    }
    : null;
  const lunumMeta = {
    v: LUNUM_VERSION,
    eligible,
    reason: eligible
      ? 'eligible'
      : !allowedRole
        ? 'role_not_supported'
        : !eligibleLength
          ? 'length_out_of_bounds'
          : 'structured_or_code_content'
  };
  return {
    lunumCode,
    lunumSem,
    lunumFp,
    lunumMeta
  };
}

export function compileLunumShadowContext(messages = []) {
  const rows = Array.isArray(messages) ? messages : [];
  const natural = rows.map((m) => ({
    role: m.role,
    content: String(m.content || '')
  }));
  const mixed = rows.map((m) => {
    const preferLunum = Boolean(m.lunum_code && m.lunum_meta_json);
    if (!preferLunum) return { role: m.role, content: String(m.content || '') };
    let parsedMeta = null;
    try {
      parsedMeta = JSON.parse(m.lunum_meta_json || '{}');
    } catch {
      parsedMeta = null;
    }
    if (!parsedMeta?.eligible) {
      return { role: m.role, content: String(m.content || '') };
    }
    return { role: m.role, content: String(m.lunum_code || m.content || '') };
  });
  const naturalTokens = natural.reduce((sum, m) => sum + estimateTextTokens(m.content), 0);
  const mixedTokens = mixed.reduce((sum, m) => sum + estimateTextTokens(m.content), 0);
  const ratio = naturalTokens > 0 ? Number((mixedTokens / naturalTokens).toFixed(4)) : 1;
  return {
    version: LUNUM_VERSION,
    naturalMessages: natural.length,
    mixedMessages: mixed.length,
    naturalTokens,
    mixedTokens,
    ratio,
    estimatedSavings: naturalTokens > mixedTokens ? naturalTokens - mixedTokens : 0
  };
}
