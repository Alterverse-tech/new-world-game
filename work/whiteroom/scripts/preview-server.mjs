import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.ts', 'text/javascript; charset=utf-8'],
]);

function safeFilePath(root, requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  const relative = pathname === '/' ? 'preview/index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(root, relative);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return null;
  return filePath;
}

export function createPreviewServer({ root = defaultRoot } = {}) {
  const server = createServer(async (request, response) => {
    try {
      const filePath = safeFilePath(root, request.url ?? '/');
      if (!filePath || !(await stat(filePath)).isFile()) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
      const extension = path.extname(filePath).toLowerCase();
      const content = await readFile(filePath);
      response.writeHead(200, {
        'content-type': mimeTypes.get(extension) ?? 'application/octet-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      response.end(content);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
  return server;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.env.PORT ?? '4173', 10);
  const server = createPreviewServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`WhiteRoom prop preview: http://127.0.0.1:${port}`);
  });
}
