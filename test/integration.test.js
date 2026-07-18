import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { createApplication } from '../src/server.js';

const UPLOAD_TOKEN = 'upload-token-for-integration-tests';
const ADMIN_TOKEN = 'admin-token-for-integration-tests';
const CREATOR_ORIGIN = 'https://creator.whiteroom.example';
let dataDirectory;
let application;
let baseUrl;
let previewClock = Date.now();

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function makeCoverPng() {
  const width = 960;
  const height = 540;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4 + 1;
  const pixels = Buffer.alloc(stride * height);
  const compressed = deflateSync(pixels, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function manifestFor(id, overrides = {}) {
  return {
    schema: 'wr-level',
    schemaVersion: 1,
    engineApi: '1',
    id,
    name: '测试关卡',
    version: '1.0.0',
    author: { name: 'tester' },
    description: '用于验证轻门户上传、审核和静态访问。',
    language: 'zh-CN',
    type: 'parkour',
    winCondition: { type: 'reach_zone', timeLimit: 120 },
    objective: '到达出口',
    difficulty: 2,
    estimatedMinutes: 3,
    spawn: { position: [0, 1, 0], yawDeg: 0 },
    door: null,
    killY: -20,
    entry: 'main.js',
    cover: 'cover.png',
    tags: ['测试'],
    contentRating: 'everyone',
    credits: [],
    ...overrides,
  };
}

function levelArchive(id, options = {}) {
  const manifest = manifestFor(id, options.manifest);
  const main = options.main ?? 'export default async function createLevel() { return {}; }\n';
  return makeZip([
    { name: 'level.json', data: `${JSON.stringify(manifest)}\n` },
    { name: 'main.js', data: main },
    { name: 'solution.md', data: '# 攻略\n\n沿平台前进并进入出口。\n' },
    { name: 'cover.png', data: makeCoverPng() },
  ]);
}

async function listen() {
  application = await createApplication({
    uploadToken: UPLOAD_TOKEN,
    adminToken: ADMIN_TOKEN,
    dataDirectory,
    logger: { error() {} },
    corsOrigin: CREATOR_ORIGIN,
    previewTtlSeconds: 60,
    clock: () => previewClock,
  });
  await new Promise((resolve) => application.server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${application.server.address().port}`;
}

async function close() {
  if (!application?.server.listening) return;
  await new Promise((resolve, reject) => application.server.close((error) => error ? reject(error) : resolve()));
}

async function upload(archive, filename, token = UPLOAD_TOKEN) {
  const form = new FormData();
  form.append('level', new Blob([archive], { type: 'application/zip' }), filename);
  return fetch(`${baseUrl}/api/levels`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
}

async function review(id, action, token, body = {}) {
  return fetch(`${baseUrl}/api/admin/levels/${id}/${action}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

before(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-platform-test-'));
  await listen();
});

after(async () => {
  await close();
  await rm(dataDirectory, { recursive: true, force: true });
});

test('health endpoint responds without authentication', async () => {
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'whiteroom-platform' });
});

test('creator level and avatar upload preflights retain configured CORS', async () => {
  for (const pathname of ['/api/levels', '/api/avatars']) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: 'OPTIONS',
      headers: {
        Origin: CREATOR_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type',
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), CREATOR_ORIGIN);
    assert.match(response.headers.get('access-control-allow-methods'), /(?:^|,\s*)POST(?:,|$)/);
    assert.match(response.headers.get('access-control-allow-headers'), /Authorization/);
    assert.match(response.headers.get('access-control-allow-headers'), /Content-Type/);
  }
});

test('admin dashboard assets are served without persisting the administrator token', async () => {
  const redirect = await fetch(`${baseUrl}/admin`, { redirect: 'manual' });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), '/admin/');

  const page = await fetch(`${baseUrl}/admin/`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'private, no-store');
  assert.match(await page.text(), /WhiteRoom · 关卡审核/);

  const script = await fetch(`${baseUrl}/admin/app.js`);
  assert.equal(script.status, 200);
  const source = await script.text();
  assert.match(source, /preview-token/);
  assert.doesNotMatch(source, /(?:local|session)Storage/);
});

test('upload requires the creator token', async () => {
  const response = await upload(levelArchive('auth-check-a1b2c3'), 'auth-check.wrlevel', null);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'unauthorized');
});

test('unsafe ZIP paths and forbidden APIs are rejected', async (t) => {
  await t.test('path traversal', async () => {
    const response = await upload(
      makeZip([{ name: '../escape.txt', data: 'nope' }]),
      'traversal.wrlevel',
    );
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'validation_failed');
  });

  await t.test('forbidden fetch API', async () => {
    const id = 'unsafe-fetch-deadbe';
    const response = await upload(
      levelArchive(id, { main: 'export default function level() { fetch("https://example.com"); }\n' }),
      'unsafe.wrlevel',
    );
    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.error.code, 'validation_failed');
    assert.match(JSON.stringify(payload.error.details), /fetch/);
    assert.equal((await fetch(`${baseUrl}/api/levels/${id}/status`)).status, 404);
  });

  await t.test('schema mismatch', async () => {
    const response = await upload(
      levelArchive('bad-schema-badbad', { manifest: { schemaVersion: 2 } }),
      'bad-schema.wrlevel',
    );
    assert.equal(response.status, 422);
    assert.match(JSON.stringify((await response.json()).error.details), /schemaVersion/);
  });
});

test('administrator can list, inspect, and privately preview pending levels', async () => {
  const id = 'review-room-badbee';
  assert.equal((await upload(levelArchive(id), 'review-room.wrlevel')).status, 201);

  const unauthenticatedList = await fetch(`${baseUrl}/api/admin/levels`);
  assert.equal(unauthenticatedList.status, 401);

  const listResponse = await fetch(`${baseUrl}/api/admin/levels?status=pending&limit=1&offset=0`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.headers.get('cache-control'), 'private, no-store');
  const list = await listResponse.json();
  assert.equal(list.status, 'pending');
  assert.equal(list.total, 1);
  assert.equal(list.limit, 1);
  assert.equal(list.offset, 0);
  assert.equal(list.levels[0].levelId, id);
  assert.equal(list.levels[0].name, '测试关卡');
  assert.equal(list.levels[0].author.name, 'tester');
  assert.equal(list.levels[0].hash.length, 64);

  const allResponse = await fetch(`${baseUrl}/api/admin/levels?status=all`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  assert.equal(allResponse.status, 200);
  assert.equal((await allResponse.json()).levels.some((level) => level.levelId === id), true);
  const invalidFilter = await fetch(`${baseUrl}/api/admin/levels?status=unknown`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  assert.equal(invalidFilter.status, 400);
  assert.equal((await invalidFilter.json()).error.code, 'invalid_status');

  const detailResponse = await fetch(`${baseUrl}/api/admin/levels/${id}`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  assert.equal(detailResponse.status, 200);
  const detail = (await detailResponse.json()).level;
  assert.equal(detail.levelId, id);
  assert.equal(detail.status, 'pending');
  assert.equal(detail.manifest.id, id);
  assert.match(detail.solutionMd, /沿平台前进/);
  assert.equal(detail.archiveBytes > 0, true);
  assert.equal(detail.fileCount, 4);

  assert.equal((await fetch(`${baseUrl}/api/admin/preview/${id}/main.js`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/levels/${id}/main.js`)).status, 404);

  const tokenResponse = await fetch(`${baseUrl}/api/admin/levels/${id}/preview-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  assert.equal(tokenResponse.status, 200);
  const tokenBody = await tokenResponse.json();
  assert.deepEqual(tokenBody, {
    previewUrl: `/?reviewLevel=${id}`,
    previewBaseUrl: `/api/admin/preview/${id}/`,
    expiresAt: new Date(previewClock + 60_000).toISOString(),
  });
  const setCookie = tokenResponse.headers.get('set-cookie');
  assert.match(setCookie, /^__Secure-whiteroom_preview=/);
  assert.match(setCookie, new RegExp(`Path=/api/admin/preview/${id}/`));
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Max-Age=60/);
  const cookie = setCookie.split(';', 1)[0];

  const previewMain = await fetch(`${baseUrl}${tokenBody.previewBaseUrl}main.js`, {
    headers: { Cookie: cookie },
  });
  assert.equal(previewMain.status, 200);
  assert.equal(previewMain.headers.get('cache-control'), 'private, no-store');
  assert.equal(previewMain.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.match(await previewMain.text(), /export default/);
  const previewRoot = await fetch(`${baseUrl}${tokenBody.previewBaseUrl}`, {
    headers: { Cookie: cookie },
  });
  assert.equal(previewRoot.status, 200);
  assert.equal((await previewRoot.json()).id, id);
  const previewHead = await fetch(`${baseUrl}${tokenBody.previewBaseUrl}cover.png`, {
    method: 'HEAD',
    headers: { Cookie: cookie },
  });
  assert.equal(previewHead.status, 200);
  assert.equal(previewHead.headers.get('content-type'), 'image/png');

  const [cookieName, cookieToken] = cookie.split('=');
  const [payloadPart, signaturePart] = cookieToken.split('.');
  const tamperedSignature = Buffer.from(signaturePart, 'base64url');
  tamperedSignature[Math.floor(tamperedSignature.length / 2)] ^= 0x01;
  const tamperedCookie = `${cookieName}=${payloadPart}.${tamperedSignature.toString('base64url')}`;
  assert.equal((await fetch(`${baseUrl}${tokenBody.previewBaseUrl}main.js`, {
    headers: { Cookie: tamperedCookie },
  })).status, 401);

  previewClock += 60_001;
  assert.equal((await fetch(`${baseUrl}${tokenBody.previewBaseUrl}main.js`, {
    headers: { Cookie: cookie },
  })).status, 401);
  previewClock -= 60_001;

  assert.equal((await review(id, 'reject', ADMIN_TOKEN, { reason: 'Preview flow test complete.' })).status, 200);
  assert.equal((await fetch(`${baseUrl}${tokenBody.previewBaseUrl}main.js`, {
    headers: { Cookie: cookie },
  })).status, 404);
});

test('pending upload is hidden until an administrator approves it', async () => {
  const id = 'crystal-spire-a1b2c3';
  const archive = levelArchive(id);
  const response = await upload(archive, 'crystal-spire.wrlevel');
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    levelId: id,
    status: 'pending',
    reviewUrl: `/api/levels/${id}/status`,
    deduplicated: false,
  });

  const status = await (await fetch(`${baseUrl}/api/levels/${id}/status`)).json();
  assert.equal(status.status, 'pending');
  assert.deepEqual((await (await fetch(`${baseUrl}/registry.json`)).json()).levels, []);
  assert.equal((await fetch(`${baseUrl}/levels/${id}/main.js`)).status, 404);

  const wrongToken = await review(id, 'approve', UPLOAD_TOKEN);
  assert.equal(wrongToken.status, 401);
  const approved = await review(id, 'approve', ADMIN_TOKEN);
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).status, 'approved');

  const registryResponse = await fetch(`${baseUrl}/registry.json`);
  const registry = await registryResponse.json();
  assert.equal(registry.levels.length, 1);
  assert.equal(registry.levels[0].id, id);
  assert.equal(registry.levels[0].status, 'approved');
  assert.equal(registry.levels[0].description, '用于验证轻门户上传、审核和静态访问。');
  assert.equal(registry.levels[0].objective, '到达出口');
  assert.deepEqual(registry.levels[0].winCondition, { type: 'reach_zone', timeLimit: 120 });
  assert.equal(registry.levels[0].cover, `/levels/${id}/cover.png`);

  const mainResponse = await fetch(`${baseUrl}/levels/${id}/main.js`);
  assert.equal(mainResponse.status, 200);
  assert.match(mainResponse.headers.get('cache-control'), /immutable/);
  assert.match(await mainResponse.text(), /export default/);
  const coverResponse = await fetch(`${baseUrl}/levels/${id}/cover.png`);
  assert.equal(coverResponse.status, 200);
  assert.equal(coverResponse.headers.get('content-type'), 'image/png');

  const duplicate = await upload(archive, 'crystal-spire.wrlevel');
  assert.equal(duplicate.status, 200);
  const duplicateBody = await duplicate.json();
  assert.equal(duplicateBody.deduplicated, true);
  assert.equal(duplicateBody.status, 'approved');
});

test('administrator can reject a pending level with a reason', async () => {
  const id = 'quiet-room-c0ffee';
  assert.equal((await upload(levelArchive(id), 'quiet-room.wrlevel')).status, 201);
  const rejected = await review(id, 'reject', ADMIN_TOKEN, { reason: 'Manual playtest found a soft lock.' });
  assert.equal(rejected.status, 200);
  const rejectedBody = await rejected.json();
  assert.equal(rejectedBody.status, 'rejected');
  assert.equal(rejectedBody.reason, 'Manual playtest found a soft lock.');
  assert.equal((await fetch(`${baseUrl}/levels/${id}/level.json`)).status, 404);
  const registry = await (await fetch(`${baseUrl}/registry.json`)).json();
  assert.equal(registry.levels.some((level) => level.id === id), false);
});

test('approved state survives a process restart', async () => {
  await close();
  await listen();
  const registry = await (await fetch(`${baseUrl}/registry.json`)).json();
  assert.deepEqual(registry.levels.map((level) => level.id), ['crystal-spire-a1b2c3']);
  assert.equal(registry.levels[0].status, 'approved');
  assert.equal(registry.levels[0].objective, '到达出口');
  assert.deepEqual(registry.levels[0].winCondition, { type: 'reach_zone', timeLimit: 120 });
  assert.equal((await fetch(`${baseUrl}/levels/crystal-spire-a1b2c3/main.js`)).status, 200);
  const registryOnDisk = JSON.parse(await readFile(path.join(dataDirectory, 'registry.json'), 'utf8'));
  assert.deepEqual(registryOnDisk.levels.map((level) => level.id), ['crystal-spire-a1b2c3']);
});
