/**
 * Asset API routes — serve and list generated images and files.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { getHomeDir } from '../../config.mjs';

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt', '.csv', '.json', '.md']);
const ALLOWED_PREFIXES = ['img-', 'file-'];
const ASSETS_DIR = () => join(getHomeDir(), 'assets', 'generated');

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
};

function isSafeFilename(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255) return false;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return false;
  const ext = extname(name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return false;
  return ALLOWED_PREFIXES.some((p) => basename(name).startsWith(p));
}

export async function handleAssetsRoute({ req, res, url, ctx }) {
  const pathname = url.pathname;

  // GET /api/assets/list
  if (req.method === 'GET' && pathname === '/api/assets/list') {
    try {
      const dir = ASSETS_DIR();
      const entries = await readdir(dir).catch(() => []);
      const assets = [];
      for (const name of entries) {
        if (name.startsWith('.')) continue;
        if (!isSafeFilename(name)) continue;
        try {
          const s = await stat(join(dir, name));
          if (!s.isFile()) continue;
          assets.push({
            filename: name,
            size: s.size,
            createdAt: s.mtime.toISOString(),
            type: CONTENT_TYPES[extname(name).toLowerCase()] || 'application/octet-stream',
          });
        } catch { /* skip unreadable */ }
      }
      assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      ctx.sendJson(res, 200, { ok: true, assets });
      return true;
    } catch (err) {
      ctx.sendApiError(res, 500, 'asset_list_error', err.message);
      return true;
    }
  }

  // GET /api/assets/:filename
  const assetMatch = pathname.match(/^\/api\/assets\/([a-zA-Z0-9_.-]+)$/);
  if (req.method === 'GET' && assetMatch) {
    const filename = decodeURIComponent(assetMatch[1]);
    if (!isSafeFilename(filename)) {
      ctx.sendApiError(res, 400, 'invalid_filename', 'Filename not allowed');
      return true;
    }
    try {
      const filePath = join(ASSETS_DIR(), filename);
      const data = await readFile(filePath);
      const contentType = CONTENT_TYPES[extname(filename).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': data.length,
        'Cache-Control': 'public, max-age=3600',
        'Content-Disposition': `inline; filename="${filename}"`,
      });
      res.end(data);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') {
        ctx.sendApiError(res, 404, 'asset_not_found', 'Asset not found');
      } else {
        ctx.sendApiError(res, 500, 'asset_read_error', err.message);
      }
      return true;
    }
  }

  return false;
}
