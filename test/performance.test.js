import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createApplication } from '../src/server.js';

const UPLOAD_TOKEN = 'upload-token-for-performance-tests';
const ADMIN_TOKEN = 'admin-token-for-performance-tests';

function makeGlb({ seed = 0 } = {}) {
  const indexCount = 3;
  const geometryLength = Math.max(44, 36 + indexCount * 2);
  const binary = Buffer.alloc(Math.ceil(geometryLength / 4) * 4);
  binary.writeFloatLE(seed, 0);
  binary.writeFloatLE(1, 12);
  binary.writeFloatLE(1, 28);
  for (let index = 0; index < indexCount; index += 1) {
    binary.writeUInt16LE([0, 1, 2][index % 3], 36 + index * 2);
  }
  const document = {
    asset: { version: '2.0', generator: 'DreamSea perf tests' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: indexCount, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: indexCount * 2 },
    ],
    buffers: [{ byteLength: binary.length }],
  };
  const source = Buffer.from(JSON.stringify(document));
  const jsonLength = Math.ceil(source.length / 4) * 4;
  const json = Buffer.alloc(jsonLength, 0x20);
  source.copy(json);
  const result = Buffer.alloc(12 + 8 + json.length + 8 + binary.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  json.copy(result, 20);
  const binaryHeader = 20 + json.length;
  result.writeUInt32LE(binary.length, binaryHeader);
  result.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binary.copy(result, binaryHeader + 8);
  return result;
}

async function createHarness(options = {}) {
  const dataDirectory = options.dataDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'whiteroom-perf-test-'));
  const application = await createApplication({
    uploadToken: UPLOAD_TOKEN,
    adminToken: ADMIN_TOKEN,
    dataDirectory,
    logger: { error() {} },
    ...options,
  });
  await new Promise((resolve) => application.server.listen(0, '127.0.0.1', resolve));
  return {
    application,
    dataDirectory,
    baseUrl: `http://127.0.0.1:${application.server.address().port}`,
    async close({ remove = true } = {}) {
      if (application.server.listening) {
        await new Promise((resolve, reject) => application.server.close((error) => error ? reject(error) : resolve()));
      }
      if (remove) await rm(dataDirectory, { recursive: true, force: true });
    },
  };
}

async function newIdentity(harness) {
  const response = await fetch(`${harness.baseUrl}/api/lobby/identity`);
  const body = await response.json();
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return { ownerId: body.ownerId, cookie };
}

test('json and text responses gzip on demand while binary assets stay identity-encoded', async () => {
  const harness = await createHarness();
  try {
    // 大 JSON（世界观）压缩，并声明 Vary
    const worldview = await fetch(`${harness.baseUrl}/api/dreamsea/worldview`, {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    assert.equal(worldview.status, 200);
    assert.equal(worldview.headers.get('content-encoding'), 'gzip');
    assert.match(worldview.headers.get('vary') ?? '', /Accept-Encoding/i);
    assert.equal((await worldview.json()).sea, '眠海');

    // 小 JSON 不压缩（低于阈值）
    const health = await fetch(`${harness.baseUrl}/healthz`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(health.headers.get('content-encoding'), null);

    // 不接受 gzip 的客户端拿到明文
    const plain = await fetch(`${harness.baseUrl}/api/dreamsea/worldview`, {
      headers: { 'Accept-Encoding': 'identity' },
    });
    assert.equal(plain.headers.get('content-encoding'), null);
    assert.equal((await plain.json()).sea, '眠海');

    // 门户与审核台文本资源压缩
    for (const asset of ['/', '/portal/app.js', '/admin/app.js']) {
      const response = await fetch(`${harness.baseUrl}${asset}`, { headers: { 'Accept-Encoding': 'gzip' } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-encoding'), 'gzip', `${asset} should gzip`);
    }

    // 真实压缩率验证：gzip 响应的 Content-Length 明显小于明文（≥20% 缩减）
    const compressedLength = Number(worldview.headers.get('content-length'));
    const plainLength = Number(plain.headers.get('content-length'));
    assert.equal(Number.isFinite(compressedLength) && Number.isFinite(plainLength), true);
    assert.equal(compressedLength < plainLength * 0.8, true, 'gzip should shrink the worldview payload by at least 20%');
  } finally {
    await harness.close();
  }
});

test('avatar GLBs skip compression and honor If-None-Match revalidation', async () => {
  const harness = await createHarness();
  try {
    const model = makeGlb({ seed: 3 });
    const form = new FormData();
    form.append('avatar', new Blob([model], { type: 'model/gltf-binary' }), 'avatar.glb');
    const uploaded = await fetch(`${harness.baseUrl}/api/avatars?name=测试梦身&author=perf`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPLOAD_TOKEN}` },
      body: form,
    });
    assert.equal(uploaded.status, 201);
    const { avatarId, hash } = await uploaded.json();

    const fetched = await fetch(`${harness.baseUrl}/avatars/${avatarId}/avatar.glb`, {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.headers.get('content-encoding'), null);
    assert.equal(Number(fetched.headers.get('content-length')), model.length);
    assert.equal(fetched.headers.get('etag'), `"${hash}"`);

    // 命中 ETag：304 且零字节，节省重复的 3D 资产传输
    const revalidated = await fetch(`${harness.baseUrl}/avatars/${avatarId}/avatar.glb`, {
      headers: { 'If-None-Match': `"${hash}"` },
    });
    assert.equal(revalidated.status, 304);
    assert.equal((await revalidated.arrayBuffer()).byteLength, 0);
  } finally {
    await harness.close();
  }
});

test('the multiplayer websocket negotiates permessage-deflate', async () => {
  const harness = await createHarness();
  try {
    const url = `${harness.baseUrl.replace(/^http/, 'ws')}/api/lobby/multiplayer?channel=0000&clientId=perf-client-0001&avatarId=&name=perf`;
    const socket = new WebSocket(url, {
      headers: { Origin: harness.baseUrl },
      perMessageDeflate: true,
    });
    const negotiated = new Promise((resolve) => {
      socket.once('upgrade', (upgradeResponse) => {
        resolve(String(upgradeResponse.headers['sec-websocket-extensions'] ?? ''));
      });
    });
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    assert.match(await negotiated, /permessage-deflate/);
    assert.match(String(socket.extensions), /permessage-deflate/);
    socket.close();
    await new Promise((resolve) => socket.once('close', resolve));
  } finally {
    await harness.close();
  }
});

test('the asset weight report inventories assets and answers the jank question', async () => {
  const harness = await createHarness();
  try {
    assert.equal((await fetch(`${harness.baseUrl}/api/admin/dreamsea/asset-report`)).status, 401);

    const alice = await newIdentity(harness);
    const model = makeGlb({ seed: 9 });
    const form = new FormData();
    form.append('file', new Blob([model], { type: 'model/gltf-binary' }), 'prop.glb');
    form.append('name', '体检梦物');
    form.append('category', '家具');
    const uploaded = await fetch(`${harness.baseUrl}/api/lobby/assets`, {
      method: 'POST',
      headers: { Cookie: alice.cookie },
      body: form,
    });
    assert.equal(uploaded.status, 201);
    const assetId = (await uploaded.json()).asset.id;

    const placed = await fetch(`${harness.baseUrl}/api/lobby/objects?channel=0000`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
      body: JSON.stringify({
        clientId: 'perf-client-0002',
        catalogId: assetId,
        position: { x: 1, y: 0, z: -1 },
        rotationY: 0,
        scale: 1,
      }),
    });
    assert.equal(placed.status, 201);

    const response = await fetch(`${harness.baseUrl}/api/admin/dreamsea/asset-report?channel=0000`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(response.status, 200);
    const report = (await response.json()).report;
    assert.equal(report.lobbyAssets.count, 1);
    assert.equal(report.lobbyAssets.heaviest[0].name, '体检梦物');
    assert.equal(report.channel.uniqueDynamicAssets, 1);
    assert.equal(report.channel.dynamicPayload.bytes, model.length);
    assert.equal(typeof report.channel.utilization.bytes, 'number');
    assert.deepEqual(report.transport, {
      jsonGzip: true,
      staticTextGzip: true,
      webSocketPerMessageDeflate: true,
      conditionalRequests: true,
    });
    assert.equal(report.advice.length >= 1, true);
    // 微型资产不应触发超重告警，结论应指向「预算内」
    assert.match(report.advice[0], /预算内/);
  } finally {
    await harness.close();
  }
});
