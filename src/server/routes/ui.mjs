import fs from 'node:fs';
import path from 'node:path';

const UI_ROOT = path.join(process.cwd(), 'src', 'ui');
const STATIC_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};
const assetCache = new Map();

function readUiAsset(filePath, encoding = 'utf8') {
  const stat = fs.statSync(filePath);
  const cacheKey = `${filePath}:${encoding}`;
  const cached = assetCache.get(cacheKey);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.content;
  const content = encoding ? fs.readFileSync(filePath, encoding) : fs.readFileSync(filePath);
  assetCache.set(cacheKey, { mtimeMs: stat.mtimeMs, content });
  return content;
}

export async function handleUiRoute({ req, res, url, ctx }) {
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const html = readUiAsset(path.join(UI_ROOT, 'index.html'), 'utf8');
    res.writeHead(200, ctx.noCacheHeaders('text/html; charset=utf-8'));
    res.end(html);
    return true;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/ui/')) {
    const relativePath = url.pathname.slice('/ui/'.length);
    if (!relativePath || relativePath.includes('..') || relativePath.includes('\\')) {
      ctx.sendJson(res, 400, { ok: false, error: 'invalid_ui_asset_path' });
      return true;
    }
    const filePath = path.join(UI_ROOT, relativePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = STATIC_TYPES[ext];
    if (!contentType || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      ctx.sendJson(res, 404, { ok: false, error: 'ui_asset_not_found' });
      return true;
    }
    const content = readUiAsset(filePath, null);
    res.writeHead(200, ctx.noCacheHeaders(contentType));
    res.end(content);
    return true;
  }
  return false;
}