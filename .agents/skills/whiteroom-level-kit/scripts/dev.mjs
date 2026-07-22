#!/usr/bin/env node
import { promises as fs, createReadStream } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs, sha256, validateLevel } from './lib.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm',
};

function sendJson(response, value, status = 200) {
  response.writeHead(status, {
    'Content-Type': MIME['.json'],
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function safeChild(root, relative) {
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  return candidate;
}

async function serveFile(response, absolute) {
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) return false;
  response.writeHead(200, {
    'Content-Type': MIME[path.extname(absolute).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(absolute).pipe(response);
  return true;
}

async function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

async function main() {
  const args = parseArgs();
  if (!args.level || args.help) {
    console.log('用法：node dev.mjs --level ./my-level [--port 4173] [--shell-dir /path/to/dist] [--open]');
    process.exitCode = args.help ? 0 : 2;
    return;
  }
  const levelDir = path.resolve(String(args.level));
  const validation = await validateLevel(levelDir);
  if (!validation.valid) {
    console.error(JSON.stringify(validation.errors, null, 2));
    throw new Error('本地预览已停止：请先修复静态校验错误');
  }
  const manifest = validation.manifest;
  const mainBytes = await fs.readFile(path.join(levelDir, 'main.js'));
  const hash = sha256(mainBytes);
  const registryEntry = {
    id: manifest.id,
    status: 'approved',
    name: manifest.name,
    author: manifest.author,
    description: manifest.description,
    objective: manifest.objective,
    type: manifest.type,
    winCondition: manifest.winCondition,
    difficulty: manifest.difficulty,
    estimatedMinutes: manifest.estimatedMinutes,
    minutes: manifest.estimatedMinutes,
    cover: `/levels/${manifest.id}/cover.png`,
    path: `/levels/${manifest.id}`,
    hash,
    publishedAt: new Date().toISOString(),
  };
  const port = Number(args.port ?? 4173);
  const shellDir = args['shell-dir'] ? path.resolve(String(args['shell-dir'])) : null;
  const portal = String(process.env.WHITEROOM_PORTAL_URL || 'https://altverse.fun').replace(/\/+$/, '');

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname === '/registry.json') return sendJson(response, { schemaVersion: 1, levels: [registryEntry] });
      const prefix = `/levels/${manifest.id}/`;
      if (url.pathname.startsWith(prefix)) {
        const relative = decodeURIComponent(url.pathname.slice(prefix.length));
        const absolute = safeChild(levelDir, relative);
        if (!absolute) return sendJson(response, { message: 'invalid path' }, 400);
        try {
          if (await serveFile(response, absolute)) return;
        } catch {}
        return sendJson(response, { message: 'not found' }, 404);
      }
      if (shellDir) {
        let relative = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || 'index.html';
        let absolute = safeChild(shellDir, relative);
        try {
          if (absolute && await serveFile(response, absolute)) return;
        } catch {}
        absolute = path.join(shellDir, 'index.html');
        if (await serveFile(response, absolute)) return;
        return sendJson(response, { message: 'shell not found' }, 404);
      }
      const upstream = await fetch(`${portal}${url.pathname}${url.search}`, {
        headers: { Accept: request.headers.accept || '*/*' },
        signal: AbortSignal.timeout(20_000),
      });
      const headers = Object.fromEntries(upstream.headers.entries());
      delete headers['content-encoding'];
      delete headers['content-length'];
      headers['cache-control'] = 'no-store';
      response.writeHead(upstream.status, headers);
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (caught) {
      sendJson(response, { message: caught.message }, 500);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${port}/?devLevel=${encodeURIComponent(manifest.id)}`;
  console.log(JSON.stringify({ ok: true, url, levelId: manifest.id, shell: shellDir || portal }, null, 2));
  if (args.open) await openBrowser(url);
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((caught) => {
  console.error(`预览失败：${caught.message}`);
  process.exitCode = 1;
});
