import fs from 'node:fs';
import path from 'node:path';

export async function handleUiRoute({ req, res, url, ctx }) {
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const html = fs.readFileSync(path.join(process.cwd(), 'src/ui/index.html'), 'utf8');
    res.writeHead(200, ctx.noCacheHeaders('text/html; charset=utf-8'));
    res.end(html);
    return true;
  }
  return false;
}

