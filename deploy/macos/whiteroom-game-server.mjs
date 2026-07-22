import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deployDirectory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(deployDirectory, '../..');
const root = path.resolve(process.env.WHITEROOM_GAME_ROOT || path.join(repository, 'public/game'));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4174);
const backendHost = process.env.WHITEROOM_BACKEND_HOST || '127.0.0.1';
const backendPort = Number(process.env.WHITEROOM_BACKEND_PORT || 8787);
const entryPath = `/${(process.env.WHITEROOM_ENTRY_PATH || 'whiteroom-dev').replace(/^\/+|\/+$/g, '')}`;

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.glb', 'model/gltf-binary'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
]);

function localFile(pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (!relative.startsWith('assets/') && !relative.startsWith('generated-assets/') && relative !== 'index.html') {
    return null;
  }
  const target = path.resolve(root, relative);
  return target === root || target.startsWith(`${root}${path.sep}`) ? target : null;
}

async function serveStatic(request, response, pathname) {
  const target = localFile(pathname);
  if (!target) return false;
  try {
    const info = await stat(target);
    if (!info.isFile()) return false;
    response.writeHead(200, {
      'Cache-Control': pathname === '/' || pathname === '/index.html'
        ? 'no-cache'
        : 'public, max-age=31536000, immutable',
      'Content-Length': info.size,
      'Content-Type': mimeTypes.get(path.extname(target)) || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(target).pipe(response);
    return true;
  } catch {
    return false;
  }
}

function proxyHttp(request, response) {
  const upstream = httpRequest({
    hostname: backendHost,
    port: backendPort,
    method: request.method,
    path: request.url,
    headers: { ...request.headers },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    response.end(JSON.stringify({
      error: { code: 'backend_unavailable', message: 'WhiteRoom backend is unavailable' },
    }));
  });
  request.pipe(upstream);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);
  if (
    (url.pathname === '/' || url.pathname === `${entryPath}/`)
    && (request.method === 'GET' || request.method === 'HEAD')
  ) {
    response.writeHead(302, {
      'Cache-Control': 'no-store',
      Location: `${entryPath}${url.search}`,
    });
    response.end();
    return;
  }
  const staticPathname = url.pathname === entryPath ? '/' : url.pathname;
  if (await serveStatic(request, response, staticPathname)) return;
  proxyHttp(request, response);
});

server.on('upgrade', (request, client, head) => {
  const upstream = net.createConnection({ host: backendHost, port: backendPort }, () => {
    const lines = [`${request.method} ${request.url} HTTP/${request.httpVersion}`];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      lines.push(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`);
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head.length) upstream.write(head);
    client.pipe(upstream).pipe(client);
  });
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
});

server.listen(port, host, () => {
  console.log(`WhiteRoom game: http://${host}:${port}${entryPath}`);
  console.log(`WhiteRoom game files: ${root}`);
  console.log(`WhiteRoom backend: http://${backendHost}:${backendPort}`);
});
