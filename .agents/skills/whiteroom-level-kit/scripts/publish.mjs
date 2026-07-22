#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packLevel, parseArgs } from './lib.mjs';

const DEFAULT_PORTAL = 'https://altverse.fun';

function portalUrl() {
  return String(process.env.WHITEROOM_PORTAL_URL || DEFAULT_PORTAL).replace(/\/+$/, '');
}

async function readResponse(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { message: text }; }
}

async function check(levelDir) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'whiteroom-check-'));
  try {
    const result = await packLevel(levelDir, temp);
    return {
      ok: true,
      levelId: result.levelId,
      contentHash: result.contentHash,
      packageHash: result.packageHash,
      bytes: result.bytes,
      warnings: result.validation.warnings,
    };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function publish(levelDir, confirmed) {
  if (!confirmed) throw new Error('远程上传前必须获得用户明确确认，然后添加 --confirmed');
  const token = process.env.WHITEROOM_PORTAL_TOKEN;
  if (!token) throw new Error('缺少 WHITEROOM_PORTAL_TOKEN；请配置创作者上传令牌');
  const target = new URL(portalUrl());
  if (target.protocol !== 'https:' && !['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) {
    throw new Error('为保护创作者令牌，远程门户必须使用 HTTPS');
  }
  const result = await packLevel(levelDir);
  const bytes = await fs.readFile(result.outputPath);
  const body = new FormData();
  body.append('level', new Blob([bytes], { type: 'application/zip' }), path.basename(result.outputPath));
  body.append('clientUploadId', result.packageHash);
  const response = await fetch(`${target.href.replace(/\/$/, '')}/api/levels`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Client-Upload-Id': result.packageHash,
    },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await readResponse(response);
  if (!response.ok) {
    const details = payload.errors ? `\n${JSON.stringify(payload.errors, null, 2)}` : '';
    throw new Error(`门户返回 ${response.status}：${payload.message || response.statusText}${details}`);
  }
  return { ...payload, package: result.outputPath, packageHash: result.packageHash };
}

async function status(levelId) {
  if (!levelId) throw new Error('status 需要 --id <level-id>');
  const response = await fetch(`${portalUrl()}/api/levels/${encodeURIComponent(levelId)}/status`, {
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await readResponse(response);
  if (!response.ok) throw new Error(`门户返回 ${response.status}：${payload.message || response.statusText}`);
  return payload;
}

async function main() {
  const args = parseArgs();
  const command = args._[0];
  if (args.help || !['check', 'publish', 'status'].includes(command)) {
    console.log(`用法：
  node publish.mjs check --dir ./my-level
  node publish.mjs publish --dir ./my-level --confirmed
  node publish.mjs status --id <level-id>`);
    process.exitCode = args.help ? 0 : 2;
    return;
  }
  let output;
  if (command === 'check') {
    if (!args.dir) throw new Error('check 需要 --dir');
    output = await check(String(args.dir));
  } else if (command === 'publish') {
    if (!args.dir) throw new Error('publish 需要 --dir');
    output = await publish(String(args.dir), Boolean(args.confirmed));
  } else {
    output = await status(String(args.id ?? ''));
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch((caught) => {
  console.error(`操作失败：${caught.message}`);
  process.exitCode = 1;
});
