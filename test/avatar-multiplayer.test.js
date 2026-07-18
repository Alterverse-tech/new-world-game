import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { WebSocket } from 'ws';
import { MAX_AVATAR_BYTES } from '../src/avatar.js';
import { validateLobbyAssetGlb } from '../src/lobby-assets.js';
import { createApplication } from '../src/server.js';

const UPLOAD_TOKEN = 'upload-token-for-avatar-tests';
const ADMIN_TOKEN = 'admin-token-for-avatar-tests';
const DEFAULT_CHANNEL = '0000';

function makeGlb({
  seed = 0,
  nodeCount = 1,
  bufferUri,
  imageUri,
  extensionsRequired = [],
  embeddedImages = [],
  mutateDocument,
} = {}) {
  const geometry = Buffer.alloc(44);
  geometry.writeFloatLE(seed, 0);
  geometry.writeFloatLE(1, 12);
  geometry.writeFloatLE(1, 28);
  geometry.writeUInt16LE(0, 36);
  geometry.writeUInt16LE(1, 38);
  geometry.writeUInt16LE(2, 40);
  const document = {
    asset: { version: '2.0', generator: 'WhiteRoom tests' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: Array.from({ length: nodeCount }, (_, index) => index === 0 ? { mesh: 0 } : {}),
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
    ],
    buffers: [{ byteLength: 42 }],
  };
  if (bufferUri !== undefined) document.buffers[0].uri = bufferUri;
  if (imageUri !== undefined) {
    document.images = [{ uri: imageUri }];
    document.textures = [{ source: 0 }];
  }
  if (extensionsRequired.length) {
    document.extensionsUsed = [...extensionsRequired];
    document.extensionsRequired = [...extensionsRequired];
  }
  const binaryParts = [geometry];
  let binaryLength = embeddedImages.length ? geometry.length : 42;
  if (embeddedImages.length) {
    document.images = [];
    document.textures = [];
    for (const [index, embedded] of embeddedImages.entries()) {
      while (binaryLength % 4) {
        binaryParts.push(Buffer.alloc(1));
        binaryLength += 1;
      }
      const viewIndex = document.bufferViews.length;
      document.bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: embedded.buffer.length });
      document.images.push({ bufferView: viewIndex, mimeType: embedded.mimeType });
      document.textures.push({ source: index });
      binaryParts.push(embedded.buffer);
      binaryLength += embedded.buffer.length;
    }
    document.buffers[0].byteLength = binaryLength;
  }
  mutateDocument?.(document);
  const binaryChunkLength = Math.ceil(binaryLength / 4) * 4;
  const binary = Buffer.alloc(binaryChunkLength);
  Buffer.concat(binaryParts).copy(binary);
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

const pngCrcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  pngCrcTable[index] = value >>> 0;
}

function pngCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ pngCrcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  typeBuffer.copy(chunk, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(pngCrc32(Buffer.concat([typeBuffer, payload])), 8 + payload.length);
  return chunk;
}

function makePng(width = 1, height = 1, { bitDepth = 8, colorType = 6 } = {}) {
  const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(colorType);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = bitDepth;
  header[9] = colorType;
  const rowBytes = Math.ceil(width * channels * bitDepth / 8);
  const pixels = Buffer.alloc((rowBytes + 1) * height);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeJpeg(width = 1, height = 1) {
  const frame = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00]);
  const scan = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), frame, scan, Buffer.from([0xff, 0xd9])]);
}

function makeWebpFrames(frames) {
  const chunks = frames.map(({ width, height }) => {
    const payload = Buffer.alloc(5);
    payload[0] = 0x2f;
    payload.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
    const chunk = Buffer.alloc(8 + payload.length + (payload.length % 2));
    chunk.write('VP8L', 0, 'ascii');
    chunk.writeUInt32LE(payload.length, 4);
    payload.copy(chunk, 8);
    return chunk;
  });
  const result = Buffer.alloc(12 + chunks.reduce((total, chunk) => total + chunk.length, 0));
  result.write('RIFF', 0, 'ascii');
  result.writeUInt32LE(result.length - 8, 4);
  result.write('WEBP', 8, 'ascii');
  let offset = 12;
  for (const chunk of chunks) {
    chunk.copy(result, offset);
    offset += chunk.length;
  }
  return result;
}

function makeWebp(width = 1, height = 1) {
  return makeWebpFrames([{ width, height }]);
}

async function createHarness(options = {}) {
  const dataDirectory = options.dataDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'whiteroom-avatar-test-'));
  const application = await createApplication({
    uploadToken: UPLOAD_TOKEN,
    adminToken: ADMIN_TOKEN,
    dataDirectory,
    logger: { error() {} },
    ...options,
  });
  await new Promise((resolve) => application.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${application.server.address().port}`;
  return {
    application,
    dataDirectory,
    baseUrl,
    async close({ remove = true } = {}) {
      application.multiplayerHub.close();
      if (application.server.listening) {
        await new Promise((resolve, reject) => application.server.close((error) => error ? reject(error) : resolve()));
      }
      if (remove) await rm(dataDirectory, { recursive: true, force: true });
    },
  };
}

async function uploadAvatar(harness, buffer, {
  name = '测试形象',
  author = 'avatar-tester',
  token = UPLOAD_TOKEN,
  filename = 'avatar.glb',
  forwardedIp,
} = {}) {
  const form = new FormData();
  form.append('avatar', new Blob([buffer], { type: 'model/gltf-binary' }), filename);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (forwardedIp) headers['X-Real-IP'] = forwardedIp;
  return fetch(`${harness.baseUrl}/api/avatars?name=${encodeURIComponent(name)}&author=${encodeURIComponent(author)}`, {
    method: 'POST',
    headers,
    body: form,
  });
}

class TestSocket {
  constructor(url, origin, extraHeaders = {}) {
    this.messages = [];
    this.waiters = [];
    this.socket = new WebSocket(url, { headers: { Origin: origin, ...extraHeaders } });
    this.closed = new Promise((resolve) => {
      this.socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    this.socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      const waiterIndex = this.waiters.findIndex(({ predicate }) => predicate(message));
      if (waiterIndex !== -1) {
        const [waiter] = this.waiters.splice(waiterIndex, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        this.messages.push(message);
      }
    });
    this.opened = new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  next(predicate, timeoutMs = 2_000) {
    const index = this.messages.findIndex(predicate);
    if (index !== -1) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const waiterIndex = this.waiters.indexOf(waiter);
        if (waiterIndex !== -1) this.waiters.splice(waiterIndex, 1);
        reject(new Error('Timed out waiting for WebSocket message'));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  send(value) {
    this.socket.send(JSON.stringify(value));
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1000, 'test complete');
  }
}

async function connect(harness, clientId, {
  avatarId = '',
  name = clientId,
  partyId = null,
  channel = DEFAULT_CHANNEL,
} = {}) {
  const partyQuery = partyId ? `&partyId=${encodeURIComponent(partyId)}` : '';
  const url = `${harness.baseUrl.replace(/^http/, 'ws')}/api/lobby/multiplayer?channel=${encodeURIComponent(channel)}&clientId=${encodeURIComponent(clientId)}&avatarId=${encodeURIComponent(avatarId)}&name=${encodeURIComponent(name)}${partyQuery}`;
  const client = new TestSocket(url, harness.baseUrl);
  await client.opened;
  return client;
}

async function lobbyOwnerCookie(harness) {
  const response = await fetch(`${harness.baseUrl}/api/lobby/identity`);
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  return cookie;
}

async function mutateLobbyObject(harness, objectId, method, body, {
  channel = DEFAULT_CHANNEL,
  cookie,
} = {}) {
  return fetch(
    `${harness.baseUrl}/api/lobby/objects/${encodeURIComponent(objectId)}?channel=${encodeURIComponent(channel)}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie ?? await lobbyOwnerCookie(harness),
        Origin: harness.baseUrl,
      },
      body: JSON.stringify(body),
    },
  );
}

async function rejectedUpgrade(harness, clientId, {
  origin = harness.baseUrl,
  forwardedIp,
  channel = DEFAULT_CHANNEL,
} = {}) {
  const url = `${harness.baseUrl.replace(/^http/, 'ws')}/api/lobby/multiplayer?channel=${encodeURIComponent(channel)}&clientId=${clientId}&avatarId=&name=${clientId}`;
  return new Promise((resolve, reject) => {
    const headers = { Origin: origin };
    if (forwardedIp) headers['X-Real-IP'] = forwardedIp;
    const socket = new WebSocket(url, { headers });
    socket.once('unexpected-response', (_request, response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      response.resume();
    });
    socket.once('open', () => reject(new Error('Expected WebSocket upgrade to be rejected')));
    socket.once('error', () => {});
  });
}

test('avatar upload authenticates and rejects malformed, external, over-budget, and decoder-dependent GLBs', async () => {
  const harness = await createHarness({ avatarUploadLimits: { maximum: 20 } });
  try {
    const unauthorized = await uploadAvatar(harness, makeGlb(), { token: null });
    assert.equal(unauthorized.status, 401);

    const malformed = await uploadAvatar(harness, Buffer.from('not a glb'));
    assert.equal(malformed.status, 422);
    assert.equal((await malformed.json()).error.code, 'invalid_avatar_glb');

    const wrongExtension = await uploadAvatar(harness, makeGlb(), { filename: 'avatar.bin' });
    assert.equal(wrongExtension.status, 415);

    const externalBuffer = await uploadAvatar(harness, makeGlb({ bufferUri: 'https://example.com/model.bin' }));
    assert.equal(externalBuffer.status, 422);
    assert.equal((await externalBuffer.json()).error.code, 'avatar_external_resource');

    const externalImage = await uploadAvatar(harness, makeGlb({ imageUri: 'data:image/png;base64,AA==' }));
    assert.equal(externalImage.status, 422);
    assert.equal((await externalImage.json()).error.code, 'avatar_external_resource');

    const nodeBudget = await uploadAvatar(harness, makeGlb({ nodeCount: 257 }));
    assert.equal(nodeBudget.status, 422);
    assert.equal((await nodeBudget.json()).error.code, 'avatar_budget_exceeded');

    const compressed = await uploadAvatar(harness, makeGlb({ extensionsRequired: ['KHR_draco_mesh_compression'] }));
    assert.equal(compressed.status, 422);
    const compressedError = (await compressed.json()).error;
    assert.equal(compressedError.code, 'avatar_unsupported_extension');
    assert.equal(compressedError.details.extension, 'KHR_draco_mesh_compression');

    for (const [label, mutateDocument] of [
      ['self-cycle', (document) => { document.nodes[0].children = [0]; }],
      ['directed-cycle', (document) => {
        document.nodes = [{ mesh: 0, children: [1] }, { children: [0] }];
      }],
      ['multiple-parents', (document) => {
        document.nodes = [{ mesh: 0, children: [2] }, { children: [2] }, {}];
        document.scenes[0].nodes = [0, 1];
      }],
      ['bad-texture-source', (document) => { document.textures = [{ source: 99 }]; }],
      ['bad-image-view', (document) => { document.images = [{ bufferView: 99, mimeType: 'image/png' }]; }],
      ['bad-material-texture', (document) => {
        document.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 99 } } }];
      }],
      ['bad-animation-accessor', (document) => {
        document.animations = [{
          samplers: [{ input: 99, output: 0 }],
          channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
        }];
      }],
      ['bad-skin-accessor', (document) => {
        document.skins = [{ joints: [0], inverseBindMatrices: 99 }];
        document.nodes[0].skin = 0;
      }],
      ['camera', (document) => {
        document.cameras = [{ type: 'perspective', perspective: { yfov: 1, znear: 0.1 } }];
        document.nodes[0].camera = 0;
      }],
      ['light-extension-used', (document) => { document.extensionsUsed = ['KHR_lights_punctual']; }],
      ['document-light', (document) => { document.extensions = { KHR_lights_punctual: { lights: [] } }; }],
      ['node-light', (document) => { document.nodes[0].extensions = { KHR_lights_punctual: { light: 0 } }; }],
    ]) {
      const response = await uploadAvatar(harness, makeGlb({ mutateDocument }), { name: label });
      assert.equal(response.status, 422, label);
      assert.match((await response.json()).error.code, /^(?:invalid_avatar_glb|avatar_forbidden_scene_feature)$/, label);
    }

    const oversized = Buffer.alloc(MAX_AVATAR_BYTES + 1);
    const tooLarge = await uploadAvatar(harness, oversized);
    assert.equal(tooLarge.status, 413);
    assert.equal((await tooLarge.json()).error.code, 'avatar_too_large');
  } finally {
    await harness.close();
  }
});

test('embedded PNG, JPEG, and WebP signatures, structure, dimensions, and decoded pixel budgets are enforced', async () => {
  const harness = await createHarness({ avatarUploadLimits: { maximum: 50 } });
  try {
    const duplicateFrameModel = makeGlb({
      seed: 48,
      embeddedImages: [{ mimeType: 'image/webp', buffer: makeWebpFrames([
        { width: 1, height: 1 },
        { width: 1, height: 1 },
      ]) }],
    });
    const oversizedFirstFrameModel = makeGlb({
      seed: 49,
      embeddedImages: [{ mimeType: 'image/webp', buffer: makeWebpFrames([
        { width: 2049, height: 1 },
        { width: 1, height: 1 },
      ]) }],
    });
    const fixtures = [
      { mimeType: 'image/png', buffer: makePng(), seed: 31 },
      { mimeType: 'image/jpeg', buffer: makeJpeg(), seed: 32 },
      { mimeType: 'image/webp', buffer: makeWebp(), seed: 33 },
    ];
    for (const fixture of fixtures) {
      const response = await uploadAvatar(
        harness,
        makeGlb({ seed: fixture.seed, embeddedImages: [fixture] }),
        { name: fixture.mimeType },
      );
      assert.equal(response.status, 201, fixture.mimeType);
      const uploaded = await response.json();
      const metadata = await (await fetch(`${harness.baseUrl}/api/avatars/${uploaded.avatarId}`)).json();
      assert.equal(metadata.stats.texturePixels, 1);
    }

    const invalidCases = [
      {
        label: 'bad-png-signature',
        model: makeGlb({ seed: 41, embeddedImages: [{ mimeType: 'image/png', buffer: Buffer.from('not-png') }] }),
      },
      {
        label: 'mime-mismatch',
        model: makeGlb({ seed: 42, embeddedImages: [{ mimeType: 'image/png', buffer: makeJpeg() }] }),
      },
      {
        label: 'truncated-jpeg',
        model: makeGlb({ seed: 43, embeddedImages: [{ mimeType: 'image/jpeg', buffer: makeJpeg().subarray(0, -2) }] }),
      },
      {
        label: 'bad-webp-length',
        model: makeGlb({ seed: 44, embeddedImages: [{ mimeType: 'image/webp', buffer: makeWebp().subarray(0, -1) }] }),
      },
      {
        label: 'oversize-dimension',
        model: makeGlb({ seed: 45, embeddedImages: [{ mimeType: 'image/png', buffer: makePng(2049, 1) }] }),
      },
      {
        label: 'bad-sampler-index',
        model: makeGlb({
          seed: 46,
          embeddedImages: [{ mimeType: 'image/png', buffer: makePng() }],
          mutateDocument(document) { document.textures[0].sampler = 99; },
        }),
      },
      {
        label: 'total-decoded-pixels',
        model: makeGlb({
          seed: 47,
          embeddedImages: Array.from({ length: 3 }, () => ({
            mimeType: 'image/png',
            buffer: makePng(2048, 2048, { bitDepth: 1, colorType: 0 }),
          })),
        }),
      },
      { label: 'duplicate-webp-frame', model: duplicateFrameModel },
      { label: 'oversized-first-webp-frame', model: oversizedFirstFrameModel },
    ];
    for (const { label, model } of invalidCases) {
      const response = await uploadAvatar(harness, model, { name: label });
      assert.equal(response.status, 422, label);
      assert.match((await response.json()).error.code, /^(?:invalid_avatar_image|avatar_image_dimensions_exceeded|avatar_budget_exceeded|invalid_avatar_glb)$/, label);
    }

    assert.equal(validateLobbyAssetGlb(makeGlb({
      seed: 50,
      embeddedImages: [{ mimeType: 'image/webp', buffer: makeWebp() }],
    })).texturePixels, 1);
    for (const model of [duplicateFrameModel, oversizedFirstFrameModel]) {
      assert.throws(
        () => validateLobbyAssetGlb(model),
        (error) => error.status === 422
          && /^(?:invalid_lobby_asset_image|lobby_asset_image_dimensions_exceeded)$/.test(error.code),
      );
    }
  } finally {
    await harness.close();
  }
});

test('avatar registry deduplicates immutable GLBs and is verified/rebuilt across restart', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-avatar-restart-'));
  const model = makeGlb({ seed: 7 });
  const first = await createHarness({ dataDirectory });
  let uploaded;
  try {
    const response = await uploadAvatar(first, model, { name: '霓虹信使', author: '小白' });
    assert.equal(response.status, 201);
    uploaded = await response.json();
    assert.deepEqual(Object.keys(uploaded).sort(), [
      'author', 'avatarId', 'avatarUrl', 'deduplicated', 'hash', 'launchUrl', 'name',
    ]);
    assert.equal(uploaded.deduplicated, false);
    assert.match(uploaded.avatarId, /^avatar-[a-f0-9]{16}$/);

    const duplicate = await uploadAvatar(first, model, { name: '不同名字', author: '另一作者' });
    assert.equal(duplicate.status, 200);
    const duplicateBody = await duplicate.json();
    assert.equal(duplicateBody.avatarId, uploaded.avatarId);
    assert.equal(duplicateBody.name, '霓虹信使');
    assert.equal(duplicateBody.deduplicated, true);

    const registry = await (await fetch(`${first.baseUrl}/api/avatars`)).json();
    assert.equal(registry.schemaVersion, 1);
    assert.equal(registry.avatars.length, 1);
    assert.equal(registry.avatars[0].stats.vertices, 3);
    assert.deepEqual(registry.avatars[0].stats.requiredExtensions, []);

    const metadata = await (await fetch(`${first.baseUrl}/api/avatars/${uploaded.avatarId}`)).json();
    assert.equal(metadata.hash, uploaded.hash);
    assert.equal(metadata.stats.triangles, 1);

    const head = await fetch(`${first.baseUrl}${uploaded.avatarUrl}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-type'), 'model/gltf-binary');
    assert.equal(head.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(head.headers.get('etag'), `"${uploaded.hash}"`);
    assert.equal(Number(head.headers.get('content-length')), model.length);
    assert.deepEqual(Buffer.from(await (await fetch(`${first.baseUrl}${uploaded.avatarUrl}`)).arrayBuffer()), model);
    await writeFile(path.join(dataDirectory, 'avatars', 'registry.json'), '{"stale":true}\n');
  } finally {
    await first.close({ remove: false });
  }

  const restarted = await createHarness({ dataDirectory });
  try {
    const registry = await (await fetch(`${restarted.baseUrl}/api/avatars`)).json();
    assert.equal(registry.avatars.length, 1);
    assert.equal(registry.avatars[0].avatarId, uploaded.avatarId);
    assert.deepEqual(Buffer.from(await (await fetch(`${restarted.baseUrl}${uploaded.avatarUrl}`)).arrayBuffer()), model);
    const persistedRegistry = JSON.parse(await readFile(path.join(dataDirectory, 'avatars', 'registry.json'), 'utf8'));
    assert.equal(persistedRegistry.avatars[0].hash, uploaded.hash);
  } finally {
    await restarted.close({ remove: false });
  }
  await writeFile(path.join(dataDirectory, 'avatars', 'models', uploaded.avatarId, 'avatar.glb'), Buffer.from('corrupted'));
  await assert.rejects(
    createApplication({
      uploadToken: UPLOAD_TOKEN,
      adminToken: ADMIN_TOKEN,
      dataDirectory,
      logger: { error() {} },
    }),
    /Stored avatar hash mismatch/,
  );
  await rm(dataDirectory, { recursive: true, force: true });
});

test('avatar uploads enforce creator/IP rate, record count, and total byte capacity without charging dedupe', async (t) => {
  await t.test('upload rate', async () => {
    const harness = await createHarness({ avatarUploadLimits: { maximum: 2 } });
    try {
      assert.equal((await uploadAvatar(harness, makeGlb())).status, 201);
      assert.equal((await uploadAvatar(harness, makeGlb())).status, 200);
      const limited = await uploadAvatar(harness, makeGlb());
      assert.equal(limited.status, 429);
      assert.equal((await limited.json()).error.code, 'avatar_upload_rate_limited');
      assert.equal((await fetch(`${harness.baseUrl}/api/avatars`)).status, 200);
    } finally {
      await harness.close();
    }
  });

  await t.test('record capacity', async () => {
    const harness = await createHarness({ avatarLimits: { maxAvatars: 1 } });
    try {
      const model = makeGlb();
      assert.equal((await uploadAvatar(harness, model)).status, 201);
      assert.equal((await uploadAvatar(harness, model)).status, 200);
      const full = await uploadAvatar(harness, makeGlb({ seed: 1 }));
      assert.equal(full.status, 507);
      assert.equal((await full.json()).error.code, 'avatar_capacity_reached');
      assert.equal(harness.application.avatarStore.count, 1);
    } finally {
      await harness.close();
    }
  });

  await t.test('byte capacity', async () => {
    const model = makeGlb();
    const harness = await createHarness({ avatarLimits: { maxAvatars: 10, maxTotalBytes: model.length + 1 } });
    try {
      assert.equal((await uploadAvatar(harness, model)).status, 201);
      assert.equal((await uploadAvatar(harness, model)).status, 200);
      const full = await uploadAvatar(harness, makeGlb({ seed: 2 }));
      assert.equal(full.status, 507);
      assert.equal((await full.json()).error.code, 'avatar_storage_capacity_reached');
      assert.equal(harness.application.avatarStore.totalBytes, model.length);
    } finally {
      await harness.close();
    }
  });
});

test('two to three WebSocket clients exchange welcome, join, pose, profile, and leave with avatar fallback', async () => {
  const harness = await createHarness();
  const clients = [];
  try {
    const avatar = await (await uploadAvatar(harness, makeGlb(), { name: '蓝色旅人' })).json();
    const alice = await connect(harness, 'alice-0001', { avatarId: avatar.avatarId, name: 'Alice' });
    clients.push(alice);
    const aliceWelcome = await alice.next((message) => message.type === 'welcome');
    assert.equal(aliceWelcome.selfId, 'alice-0001');
    assert.equal(aliceWelcome.players[0].avatarId, avatar.avatarId);

    const bob = await connect(harness, 'bob-user-02', { avatarId: 'missing-avatar-12345678', name: 'Bob' });
    clients.push(bob);
    const bobWelcome = await bob.next((message) => message.type === 'welcome');
    assert.equal(bobWelcome.players.length, 2);
    assert.equal(bobWelcome.players.find((player) => player.id === 'bob-user-02').avatarId, null);
    const bobJoin = await alice.next((message) => message.type === 'join' && message.player.id === 'bob-user-02');
    assert.equal(bobJoin.player.avatarUrl, null);

    bob.send({ type: 'pose', x: 2, y: 1, z: -3, yaw: 0.5, moving: true });
    const pose = await alice.next((message) => message.type === 'pose' && message.id === 'bob-user-02');
    assert.deepEqual({ x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, moving: pose.moving }, {
      x: 2, y: 1, z: -3, yaw: 0.5, moving: true,
    });
    assert.equal(pose.seq, 1);
    assert.equal(typeof pose.timestamp, 'number');

    bob.send({ type: 'profile', name: 'Bob 换装', avatarId: avatar.avatarId });
    const dressed = await alice.next((message) => message.type === 'profile');
    assert.equal(dressed.player.avatarId, avatar.avatarId);
    assert.equal(dressed.player.avatarUrl, avatar.avatarUrl);
    bob.send({ type: 'profile', name: 'Bob 墨羽', avatarId: 'preset-ink-chibi' });
    const presetDressed = await alice.next((message) => message.type === 'profile');
    assert.equal(presetDressed.player.avatarId, 'preset-ink-chibi');
    assert.equal(presetDressed.player.avatarUrl, '/generated-assets/whiteroom-avatar-ink-chibi.glb');
    const carol = await connect(harness, 'carol-003', { name: 'Carol', avatarId: 'preset-cloud-doll' });
    clients.push(carol);
    const carolJoin = await alice.next((message) => message.type === 'join' && message.player.id === 'carol-003');
    assert.equal(carolJoin.player.avatarId, 'preset-cloud-doll');
    assert.equal(carolJoin.player.avatarUrl, '/generated-assets/whiteroom-avatar-cloud-doll.glb');
    carol.send({ type: 'profile', name: 'Carol 默认', avatarId: null });
    const cleared = await alice.next((message) => message.type === 'profile' && message.player.id === 'carol-003');
    assert.equal(cleared.player.avatarId, null);
    carol.close();
    const leave = await alice.next((message) => message.type === 'leave' && message.id === 'carol-003');
    assert.equal(leave.id, 'carol-003');
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('vehicle leases validate capable objects, relay finite unbounded aircraft state, and retain runtime state', async () => {
  let now = Date.parse('2026-07-15T16:00:00.000Z');
  const harness = await createHarness({
    clock: () => now,
    multiplayerVehicle: { leaseMs: 60_000 },
  });
  const clients = [];
  try {
    const createObject = (catalogId, position) => harness.application.lobbyStore.create(DEFAULT_CHANNEL, {
      clientId: 'vehicle-owner-01', catalogId, position, rotationY: 0, scale: 1,
    });
    const roadster = (await createObject('code-precision-rescue-helicopter', { x: 0, y: 0, z: 0 })).object;
    const skywing = (await createObject('code-precision-rescue-helicopter', { x: 6, y: 0, z: 0 })).object;
    const ordinary = (await createObject('code-glow-cube', { x: -6, y: 0, z: 0 })).object;

    const alice = await connect(harness, 'vehicle-alice-01');
    const bob = await connect(harness, 'vehicle-bob-0001');
    const isolated = await connect(harness, 'vehicle-other-001', { channel: '9876' });
    clients.push(alice, bob, isolated);
    const aliceWelcome = await alice.next((message) => message.type === 'welcome');
    const bobWelcome = await bob.next((message) => message.type === 'welcome');
    const isolatedWelcome = await isolated.next((message) => message.type === 'welcome');
    assert.deepEqual(aliceWelcome.features, [
      'vehicle-lease-v1',
      'vehicle-autoland-v1',
      'persistent-space-v1',
    ]);
    assert.deepEqual(aliceWelcome.vehicles, []);
    assert.deepEqual(bobWelcome.features, [
      'vehicle-lease-v1',
      'vehicle-autoland-v1',
      'persistent-space-v1',
    ]);
    assert.deepEqual(isolatedWelcome.vehicles, []);
    await alice.next((message) => message.type === 'join' && message.player.id === 'vehicle-bob-0001');

    alice.send({ type: 'pose', x: 0, y: 0, z: 2, yaw: 0, moving: false });
    bob.send({ type: 'pose', x: 0, y: 0, z: 2, yaw: 0, moving: false });
    await bob.next((message) => message.type === 'pose' && message.id === 'vehicle-alice-01');
    alice.send({ type: 'vehicle_enter', objectId: roadster.id });
    const entered = await alice.next((message) => message.type === 'vehicle_entered');
    assert.match(entered.leaseId, /^lease-[0-9a-f-]{36}$/i);
    assert.deepEqual(entered.vehicle, {
      objectId: roadster.id,
      catalogId: 'code-precision-rescue-helicopter',
      kind: 'aircraft',
      driverId: 'vehicle-alice-01',
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0,
      vx: 0, vy: 0, vz: 0, seq: 0, timestamp: now,
    });
    const claimed = await bob.next((message) => message.type === 'vehicle_claimed');
    assert.deepEqual(claimed.vehicle, entered.vehicle);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(isolated.messages.some((message) => message.type.startsWith('vehicle_')), false);

    bob.send({ type: 'vehicle_enter', objectId: roadster.id });
    assert.equal((await bob.next((message) => message.type === 'error')).code, 'vehicle_busy');
    alice.send({ type: 'vehicle_enter', objectId: skywing.id });
    assert.equal((await alice.next((message) => message.type === 'error')).code, 'vehicle_already_driving');

    now += 1_000;
    alice.send({
      type: 'vehicle_state', objectId: roadster.id, leaseId: entered.leaseId, seq: 1,
      x: 0.04, y: 0, z: 0, yaw: 0.08, pitch: 0, roll: 0,
      vx: 0.4, vy: 0, vz: 0,
    });
    const acknowledged = await alice.next((message) => message.type === 'vehicle_state' && message.vehicle.seq === 1);
    const relayed = await bob.next((message) => message.type === 'vehicle_state');
    assert.deepEqual(relayed.vehicle, {
      ...entered.vehicle,
      x: 0.04, yaw: 0.08, vx: 0.4, seq: 1, timestamp: now,
    });
    assert.deepEqual(acknowledged, relayed);
    assert.deepEqual(Object.keys(acknowledged).sort(), ['type', 'vehicle']);
    now += 100;
    alice.send({
      type: 'vehicle_state', objectId: roadster.id, leaseId: entered.leaseId, seq: 2,
      x: 0.05, y: 0, z: 0, yaw: 0.1, pitch: 0, roll: 0,
      vx: 0, vy: 0, vz: 0,
    });
    const impactStop = await bob.next((message) => message.type === 'vehicle_state' && message.vehicle.seq === 2);
    assert.deepEqual(impactStop.vehicle, {
      ...entered.vehicle,
      x: 0.05, yaw: 0.1, seq: 2, timestamp: now,
    });
    const impactAcknowledged = await alice.next((message) => message.type === 'vehicle_state' && message.vehicle.seq === 2);
    assert.deepEqual(impactAcknowledged, impactStop);
    now += 20_000;
    // Seed an already-authoritative far-away runtime position, then verify a
    // normal bounded motion step can be relayed there. The protocol permits
    // unbounded finite flight, but a long packet gap is not teleport credit.
    const roadsterKey = `${DEFAULT_CHANNEL}:${roadster.id}`;
    Object.assign(harness.application.multiplayerHub.vehicleStates.get(roadsterKey), {
      x: 120, y: 40, z: -90, yaw: 0.3,
      vx: 0, vy: 0, vz: 0,
    });
    alice.send({
      type: 'vehicle_state', objectId: roadster.id, leaseId: entered.leaseId, seq: 3,
      x: 120, y: 40, z: -90, yaw: 0.3, pitch: 0, roll: 0,
      vx: 0, vy: 0, vz: 0,
    });
    const unboundedAcknowledged = await alice.next((message) => (
      message.type === 'vehicle_state' && message.vehicle.seq === 3
    ));
    const unboundedRelayed = await bob.next((message) => (
      message.type === 'vehicle_state' && message.vehicle.seq === 3
    ));
    assert.deepEqual(unboundedAcknowledged, unboundedRelayed);
    assert.deepEqual(
      { x: unboundedAcknowledged.vehicle.x, y: unboundedAcknowledged.vehicle.y, z: unboundedAcknowledged.vehicle.z },
      { x: 120, y: 40, z: -90 },
    );

    alice.send({ type: 'vehicle_exit', objectId: roadster.id, leaseId: entered.leaseId, seq: 4 });
    assert.equal((await alice.next((message) => message.type === 'error')).code, 'vehicle_exit_rejected');

    now += 5_000;
    Object.assign(harness.application.multiplayerHub.vehicleStates.get(roadsterKey), {
      y: 0.1, pitch: 0.01, roll: -0.01,
    });
    alice.send({
      type: 'vehicle_state', objectId: roadster.id, leaseId: entered.leaseId, seq: 4,
      x: 120, y: 0.1, z: -90, yaw: 0.3, pitch: 0.01, roll: -0.01,
      vx: 0, vy: 0, vz: 0,
    });
    await bob.next((message) => message.type === 'vehicle_state' && message.vehicle.seq === 4);
    alice.send({
      type: 'vehicle_state', objectId: roadster.id, leaseId: entered.leaseId, seq: 4,
      x: 120, y: 0, z: -90, yaw: 0.3, pitch: 0, roll: 0,
      vx: 0, vy: 0, vz: 0,
    });
    assert.equal((await alice.next((message) => message.type === 'error')).code, 'vehicle_state_stale');
    alice.send({ type: 'vehicle_exit', objectId: roadster.id, leaseId: entered.leaseId, seq: 5 });
    const released = await bob.next((message) => message.type === 'vehicle_released' && message.reason === 'exit');
    assert.equal(released.driverId, 'vehicle-alice-01');
    assert.equal(released.vehicle.driverId, null);
    assert.deepEqual(
      { y: released.vehicle.y, pitch: released.vehicle.pitch, roll: released.vehicle.roll },
      { y: 0, pitch: 0, roll: 0 },
    );
    assert.deepEqual(
      (await harness.application.lobbyStore.getState(DEFAULT_CHANNEL)).objects.find(({ id }) => id === roadster.id).position,
      { x: 0, y: 0, z: 0 },
    );

    const late = await connect(harness, 'vehicle-late-0001');
    clients.push(late);
    const lateWelcome = await late.next((message) => message.type === 'welcome');
    assert.deepEqual(lateWelcome.vehicles, [{ ...released.vehicle, seq: 5 }]);

    alice.send({ type: 'pose', x: -6, y: 0, z: 1, yaw: 0, moving: false });
    alice.send({ type: 'vehicle_enter', objectId: ordinary.id });
    assert.equal((await alice.next((message) => message.type === 'error')).code, 'vehicle_not_capable');
    alice.send({ type: 'vehicle_enter', objectId: 'missing-vehicle-0001' });
    assert.equal((await alice.next((message) => message.type === 'error')).code, 'vehicle_not_found');
    alice.send({ type: 'vehicle_enter', objectId: skywing.id });
    assert.equal((await alice.next((message) => message.type === 'error')).code, 'vehicle_too_far');

    alice.send({ type: 'pose', x: 6, y: 0, z: 2, yaw: 0, moving: false });
    alice.send({ type: 'vehicle_enter', objectId: skywing.id });
    const aircraft = await alice.next((message) => message.type === 'vehicle_entered' && message.vehicle.kind === 'aircraft');
    now += 1_000;
    alice.send({
      type: 'vehicle_state', objectId: skywing.id, leaseId: aircraft.leaseId, seq: 1,
      x: 6, y: 0.2, z: 0, yaw: 0, pitch: 0.1, roll: -0.1,
      vx: 0, vy: 0.45, vz: 0,
    });
    const airborne = await late.next((message) => message.type === 'vehicle_state' && message.vehicle.objectId === skywing.id);
    assert.equal(airborne.vehicle.y, 0.2);
    alice.send({ type: 'vehicle_exit', objectId: skywing.id, leaseId: aircraft.leaseId, seq: 2 });
    assert.equal((await alice.next((message) => message.type === 'error')).code, 'vehicle_exit_rejected');
    now += 1_000;
    alice.send({
      type: 'vehicle_state', objectId: skywing.id, leaseId: aircraft.leaseId, seq: 2,
      x: 6, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0,
      vx: 0, vy: 0, vz: 0,
    });
    await late.next((message) => message.type === 'vehicle_state'
      && message.vehicle.objectId === skywing.id && message.vehicle.seq === 2);
    alice.send({ type: 'vehicle_exit', objectId: skywing.id, leaseId: aircraft.leaseId, seq: 3 });
    await late.next((message) => message.type === 'vehicle_released' && message.vehicle.objectId === skywing.id);

    bob.send({ type: 'pose', x: 120, y: 0, z: -88, yaw: 0, moving: false });
    bob.send({ type: 'vehicle_enter', objectId: roadster.id });
    const bobEntered = await bob.next((message) => message.type === 'vehicle_entered');
    assert.equal(bobEntered.vehicle.x, 120);
    bob.close();
    const disconnected = await alice.next((message) => message.type === 'vehicle_released' && message.reason === 'disconnect');
    assert.equal(disconnected.driverId, 'vehicle-bob-0001');

    const invalid = await connect(harness, 'vehicle-invalid-1');
    clients.push(invalid);
    await invalid.next((message) => message.type === 'welcome');
    invalid.send({ type: 'vehicle_enter', objectId: roadster.id, script: 'unsafe' });
    const invalidClose = await invalid.closed;
    assert.equal(invalidClose.code, 1008);
    assert.equal(invalidClose.reason, 'invalid_multiplayer_vehicle');
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('idle vehicle PATCH reconciles runtime pose without scale snapping and DELETE clears it', async () => {
  let now = Date.parse('2026-07-16T08:00:00.000Z');
  const harness = await createHarness({ clock: () => now });
  const clients = [];
  try {
    const channel = 'space-001234-heaven';
    const vehicle = (await harness.application.lobbyStore.create(channel, {
      clientId: 'vehicle-edit-owner',
      catalogId: 'code-precision-rescue-helicopter',
      position: { x: 2, y: 0, z: 3 },
      rotationY: 0.1,
      scale: 1,
    })).object;
    const hub = harness.application.multiplayerHub;
    const key = `${channel}:${vehicle.id}`;
    const runtime = hub.initialVehicleState(
      channel,
      vehicle,
      hub.vehicleCapabilities.get(vehicle.catalogId),
      now - 1_000,
    );
    Object.assign(runtime, {
      x: 120,
      y: 0,
      z: -90,
      yaw: 0.75,
      pitch: 0.01,
      roll: -0.01,
      vx: 0.2,
      vy: 0,
      vz: -0.3,
      seq: 8,
    });
    hub.vehicleStates.set(key, runtime);

    const observer = await connect(harness, 'vehicle-edit-watch', { channel });
    clients.push(observer);
    await observer.next((message) => message.type === 'welcome');
    const cookie = await lobbyOwnerCookie(harness);

    const scaledResponse = await mutateLobbyObject(
      harness,
      vehicle.id,
      'PATCH',
      { clientId: 'vehicle-editor-01', scale: 1.75 },
      { channel, cookie },
    );
    assert.equal(scaledResponse.status, 200);
    assert.equal((await scaledResponse.json()).object.scale, 1.75);
    assert.equal(hub.vehicleStates.get(key), runtime);
    assert.deepEqual(
      {
        x: runtime.x, y: runtime.y, z: runtime.z, yaw: runtime.yaw,
        pitch: runtime.pitch, roll: runtime.roll,
        vx: runtime.vx, vy: runtime.vy, vz: runtime.vz,
        seq: runtime.seq, timestamp: runtime.timestamp,
      },
      {
        x: 120, y: 0, z: -90, yaw: 0.75,
        pitch: 0.01, roll: -0.01,
        vx: 0.2, vy: 0, vz: -0.3,
        seq: 8, timestamp: now - 1_000,
      },
    );
    const scaleSnapshot = await observer.next((message) => message.type === 'vehicle_snapshot');
    assert.deepEqual(Object.keys(scaleSnapshot).sort(), ['type', 'vehicles']);
    assert.deepEqual(
      scaleSnapshot.vehicles.map(({ objectId, x, y, z, yaw }) => ({ objectId, x, y, z, yaw })),
      [{ objectId: vehicle.id, x: 120, y: 0, z: -90, yaw: 0.75 }],
    );

    now += 1_000;
    const movedResponse = await mutateLobbyObject(
      harness,
      vehicle.id,
      'PATCH',
      {
        clientId: 'vehicle-editor-01',
        position: { x: 2, y: 0, z: 3 },
        rotationY: 0.1,
      },
      { channel, cookie },
    );
    assert.equal(movedResponse.status, 200);
    assert.deepEqual(
      {
        x: runtime.x, y: runtime.y, z: runtime.z, yaw: runtime.yaw,
        pitch: runtime.pitch, roll: runtime.roll,
        vx: runtime.vx, vy: runtime.vy, vz: runtime.vz,
        seq: runtime.seq, timestamp: runtime.timestamp,
      },
      {
        x: 2, y: 0, z: 3, yaw: 0.1,
        pitch: 0, roll: 0,
        vx: 0, vy: 0, vz: 0,
        seq: 9, timestamp: now,
      },
    );
    const moveSnapshot = await observer.next((message) => message.type === 'vehicle_snapshot');
    assert.deepEqual(
      moveSnapshot.vehicles.map(({ objectId, x, y, z, yaw, seq }) => ({ objectId, x, y, z, yaw, seq })),
      [{ objectId: vehicle.id, x: 2, y: 0, z: 3, yaw: 0.1, seq: 9 }],
    );

    const deletedResponse = await mutateLobbyObject(
      harness,
      vehicle.id,
      'DELETE',
      { clientId: 'vehicle-editor-01' },
      { channel, cookie },
    );
    assert.equal(deletedResponse.status, 200);
    assert.equal(hub.vehicleStates.has(key), false);
    assert.deepEqual(
      await observer.next((message) => message.type === 'vehicle_snapshot'),
      { type: 'vehicle_snapshot', vehicles: [] },
    );
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('vehicle object mutations reject leases, non-null drivers, and recovery without changing lobby state', async () => {
  const harness = await createHarness();
  try {
    const vehicle = (await harness.application.lobbyStore.create(DEFAULT_CHANNEL, {
      clientId: 'vehicle-guard-owner',
      catalogId: 'code-precision-rescue-helicopter',
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      scale: 1,
    })).object;
    const hub = harness.application.multiplayerHub;
    const key = `${DEFAULT_CHANNEL}:${vehicle.id}`;
    const runtime = hub.initialVehicleState(
      DEFAULT_CHANNEL,
      vehicle,
      hub.vehicleCapabilities.get(vehicle.catalogId),
      Date.now(),
    );
    hub.vehicleStates.set(key, runtime);
    const cookie = await lobbyOwnerCookie(harness);

    runtime.driverId = 'vehicle-driver-01';
    const driverResponse = await mutateLobbyObject(
      harness,
      vehicle.id,
      'PATCH',
      { clientId: 'vehicle-editor-02', scale: 1.2 },
      { cookie },
    );
    assert.equal(driverResponse.status, 409);
    assert.equal((await driverResponse.json()).error.code, 'lobby_vehicle_in_use');

    runtime.driverId = null;
    hub.vehicleLeases.set(key, { key });
    const leaseResponse = await mutateLobbyObject(
      harness,
      vehicle.id,
      'DELETE',
      { clientId: 'vehicle-editor-02' },
      { cookie },
    );
    assert.equal(leaseResponse.status, 409);
    assert.equal((await leaseResponse.json()).error.code, 'lobby_vehicle_in_use');
    hub.vehicleLeases.delete(key);

    runtime.recovering = true;
    hub.vehicleRecoveries.set(key, { key, timer: null });
    const recoveryResponse = await mutateLobbyObject(
      harness,
      vehicle.id,
      'PATCH',
      { clientId: 'vehicle-editor-02', rotationY: 0.5 },
      { cookie },
    );
    assert.equal(recoveryResponse.status, 409);
    assert.equal((await recoveryResponse.json()).error.code, 'lobby_vehicle_in_use');
    assert.equal((await harness.application.lobbyStore.getState(DEFAULT_CHANNEL)).revision, 1);
    assert.equal(hub.vehicleStates.get(key), runtime);
  } finally {
    await harness.close();
  }
});

test('vehicle mutation locks reject concurrent entry and preserve idle runtime state when storage fails', async () => {
  const harness = await createHarness();
  const clients = [];
  const lobbyStore = harness.application.lobbyStore;
  const originalUpdate = lobbyStore.update;
  const originalDelete = lobbyStore.delete;
  let releaseUpdate = null;
  try {
    const vehicle = (await lobbyStore.create(DEFAULT_CHANNEL, {
      clientId: 'vehicle-race-owner',
      catalogId: 'code-precision-rescue-helicopter',
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      scale: 1,
    })).object;
    const hub = harness.application.multiplayerHub;
    const key = `${DEFAULT_CHANNEL}:${vehicle.id}`;
    const driver = await connect(harness, 'vehicle-race-drive');
    clients.push(driver);
    await driver.next((message) => message.type === 'welcome');
    driver.send({ type: 'pose', x: 0, y: 0, z: 1, yaw: 0, moving: false });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const cookie = await lobbyOwnerCookie(harness);

    let mutationStartedResolve;
    const mutationStarted = new Promise((resolve) => { mutationStartedResolve = resolve; });
    const updateGate = new Promise((resolve) => { releaseUpdate = resolve; });
    lobbyStore.update = async (...args) => {
      mutationStartedResolve();
      await updateGate;
      return originalUpdate.call(lobbyStore, ...args);
    };
    const pendingUpdate = mutateLobbyObject(
      harness,
      vehicle.id,
      'PATCH',
      { clientId: 'vehicle-editor-03', scale: 1.1 },
      { cookie },
    );
    await mutationStarted;
    assert.equal(hub.vehicleMutationLocks.has(key), true);
    driver.send({ type: 'vehicle_enter', objectId: vehicle.id });
    assert.equal((await driver.next((message) => message.type === 'error')).code, 'vehicle_busy');
    releaseUpdate();
    releaseUpdate = null;
    assert.equal((await pendingUpdate).status, 200);
    assert.equal(hub.vehicleMutationLocks.has(key), false);

    const runtime = hub.initialVehicleState(
      DEFAULT_CHANNEL,
      vehicle,
      hub.vehicleCapabilities.get(vehicle.catalogId),
      Date.now(),
    );
    Object.assign(runtime, { x: 7, z: -8, yaw: 0.4, seq: 4 });
    hub.vehicleStates.set(key, runtime);
    lobbyStore.update = async () => {
      throw new Error('simulated lobby storage failure');
    };
    const failedUpdate = await mutateLobbyObject(
      harness,
      vehicle.id,
      'PATCH',
      { clientId: 'vehicle-editor-03', rotationY: 0.8 },
      { cookie },
    );
    assert.equal(failedUpdate.status, 500);
    assert.equal((await failedUpdate.json()).error.code, 'internal_error');
    assert.equal(hub.vehicleStates.get(key), runtime);
    assert.deepEqual(
      { x: runtime.x, z: runtime.z, yaw: runtime.yaw, seq: runtime.seq },
      { x: 7, z: -8, yaw: 0.4, seq: 4 },
    );
    assert.equal(hub.vehicleMutationLocks.has(key), false);

    lobbyStore.delete = async () => {
      throw new Error('simulated lobby delete failure');
    };
    const failedDelete = await mutateLobbyObject(
      harness,
      vehicle.id,
      'DELETE',
      { clientId: 'vehicle-editor-03' },
      { cookie },
    );
    assert.equal(failedDelete.status, 500);
    assert.equal((await failedDelete.json()).error.code, 'internal_error');
    assert.equal(hub.vehicleStates.get(key), runtime);
    assert.equal(hub.vehicleMutationLocks.has(key), false);
  } finally {
    if (releaseUpdate) releaseUpdate();
    lobbyStore.update = originalUpdate;
    lobbyStore.delete = originalDelete;
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('vehicle motion credit accepts delayed state bursts without granting unearned movement', async () => {
  let now = Date.parse('2026-07-15T17:30:00.000Z');
  const harness = await createHarness({
    clock: () => now,
    multiplayerVehicle: { leaseMs: 60_000, recoveryTickMs: 10 },
  });
  const clients = [];
  try {
    const aircraft = (await harness.application.lobbyStore.create(DEFAULT_CHANNEL, {
      clientId: 'motion-credit-owner',
      catalogId: 'code-precision-rescue-helicopter',
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      scale: 1,
    })).object;
    const driver = await connect(harness, 'motion-credit-driver');
    const observer = await connect(harness, 'motion-credit-watch');
    clients.push(driver, observer);
    await driver.next((message) => message.type === 'welcome');
    await observer.next((message) => message.type === 'welcome');
    driver.send({ type: 'pose', x: 0, y: 0, z: 2, yaw: 0, moving: false });
    driver.send({ type: 'vehicle_enter', objectId: aircraft.id });
    const entered = await driver.next((message) => message.type === 'vehicle_entered');
    await observer.next((message) => message.type === 'vehicle_claimed');

    driver.send({
      type: 'vehicle_state', objectId: aircraft.id, leaseId: entered.leaseId, seq: 1,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0,
      vx: 0, vy: 0, vz: 0,
    });
    await observer.next((message) => message.type === 'vehicle_state' && message.vehicle.seq === 1);

    // Two legitimate 100 ms simulation steps were delayed together by the
    // network. Both arrive at the same server wall-clock timestamp.
    now += 200;
    driver.send({
      type: 'vehicle_state', objectId: aircraft.id, leaseId: entered.leaseId, seq: 2,
      x: 0, y: 0.02625, z: 0, yaw: 0, pitch: 0, roll: 0,
      vx: 0, vy: 0.45, vz: 0,
    });
    driver.send({
      type: 'vehicle_state', objectId: aircraft.id, leaseId: entered.leaseId, seq: 3,
      x: 0, y: 0.0975, z: 0, yaw: 0, pitch: 0, roll: 0,
      vx: 0, vy: 0.9, vz: 0,
    });
    await observer.next((message) => message.type === 'vehicle_state' && message.vehicle.seq === 2);
    await observer.next((message) => message.type === 'vehicle_state' && message.vehicle.seq === 3);
    assert.equal(driver.messages.some((message) => message.code === 'vehicle_state_rejected'), false);

    // A third positional step at the same timestamp has no wall-time credit.
    // Keeping velocity unchanged must not let per-packet tolerance become
    // free movement, so it still triggers authoritative recovery.
    driver.send({
      type: 'vehicle_state', objectId: aircraft.id, leaseId: entered.leaseId, seq: 4,
      x: 0, y: 0.7975, z: 0, yaw: 0, pitch: 0, roll: 0,
      vx: 0, vy: 0.9, vz: 0,
    });
    assert.equal((await driver.next((message) => message.type === 'error')).code, 'vehicle_state_rejected');
    const recovery = await observer.next((message) => message.type === 'vehicle_recovery');
    assert.equal(recovery.reason, 'state_loss');
    assert.equal(recovery.vehicle.seq, 3);
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('a live WebSocket retains its vehicle lease across a render-state gap', async () => {
  const harness = await createHarness({ multiplayerVehicle: { leaseMs: 100 } });
  const clients = [];
  try {
    const aircraft = (await harness.application.lobbyStore.create(DEFAULT_CHANNEL, {
      clientId: 'live-gap-owner-01',
      catalogId: 'code-precision-rescue-helicopter',
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      scale: 1,
    })).object;
    const driver = await connect(harness, 'live-gap-driver-01');
    const observer = await connect(harness, 'live-gap-watch-001');
    clients.push(driver, observer);
    await driver.next((message) => message.type === 'welcome');
    await observer.next((message) => message.type === 'welcome');
    driver.send({ type: 'pose', x: 0, y: 0, z: 2, yaw: 0, moving: false });
    driver.send({ type: 'vehicle_enter', objectId: aircraft.id });
    const entered = await driver.next((message) => message.type === 'vehicle_entered');
    await observer.next((message) => message.type === 'vehicle_claimed');

    await new Promise((resolve) => setTimeout(resolve, 260));
    assert.equal(harness.application.multiplayerHub.vehicleLeases.size, 1);
    assert.equal(observer.messages.some((message) => message.type === 'vehicle_released'), false);
    driver.send({
      type: 'vehicle_state', objectId: aircraft.id, leaseId: entered.leaseId, seq: 1,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0,
      vx: 0, vy: 0, vz: 0,
    });
    await observer.next((message) => message.type === 'vehicle_state' && message.vehicle.seq === 1);

    driver.close();
    const released = await observer.next((message) => (
      message.type === 'vehicle_released' && message.reason === 'disconnect'
    ));
    assert.equal(released.vehicle.driverId, null);
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('the active driver can explicitly hand an airborne vehicle to safe recovery', async () => {
  const harness = await createHarness({ multiplayerVehicle: { recoveryTickMs: 10 } });
  const clients = [];
  try {
    const aircraft = (await harness.application.lobbyStore.create(DEFAULT_CHANNEL, {
      clientId: 'recover-request-owner',
      catalogId: 'code-precision-rescue-helicopter',
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      scale: 1,
    })).object;
    const driver = await connect(harness, 'recover-request-driver');
    const observer = await connect(harness, 'recover-request-watch');
    clients.push(driver, observer);
    await driver.next((message) => message.type === 'welcome');
    await observer.next((message) => message.type === 'welcome');
    driver.send({ type: 'pose', x: 0, y: 0, z: 2, yaw: 0, moving: false });
    driver.send({ type: 'vehicle_enter', objectId: aircraft.id });
    const entered = await driver.next((message) => message.type === 'vehicle_entered');
    await observer.next((message) => message.type === 'vehicle_claimed');
    driver.send({
      type: 'vehicle_state', objectId: aircraft.id, leaseId: entered.leaseId, seq: 1,
      x: 0, y: 0.2, z: 0, yaw: 0, pitch: 0.1, roll: -0.1,
      vx: 0, vy: 0.45, vz: 0,
    });
    await observer.next((message) => message.type === 'vehicle_state' && message.vehicle.seq === 1);

    driver.send({ type: 'vehicle_recover', objectId: aircraft.id, leaseId: entered.leaseId });
    const recovery = await observer.next((message) => message.type === 'vehicle_recovery');
    assert.equal(recovery.reason, 'state_loss');
    assert.equal(recovery.driverId, 'recover-request-driver');
    assert.equal(recovery.vehicle.driverId, 'recover-request-driver');
    const released = await observer.next((message) => message.type === 'vehicle_released');
    assert.equal(released.reason, 'timeout');
    assert.equal(released.vehicle.driverId, null);
    assert.equal(released.vehicle.y, 0);
    assert.equal(driver.socket.readyState, WebSocket.OPEN);
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('vehicle-autoland-v1 keeps the original occupant through state-loss recovery and snapshots it to late joiners', async () => {
  let now = Date.parse('2026-07-15T17:00:00.000Z');
  const harness = await createHarness({
    clock: () => now,
    multiplayerVehicle: { recoveryTickMs: 10 },
  });
  const clients = [];
  try {
    const aircraft = (await harness.application.lobbyStore.create(DEFAULT_CHANNEL, {
      clientId: 'recovery-owner-01',
      catalogId: 'code-precision-rescue-helicopter',
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      scale: 1,
    })).object;
    const driver = await connect(harness, 'recovery-driver1');
    const observer = await connect(harness, 'recovery-watch-01');
    const contender = await connect(harness, 'recovery-next-001');
    clients.push(driver, observer, contender);
    await driver.next((message) => message.type === 'welcome');
    await observer.next((message) => message.type === 'welcome');
    await contender.next((message) => message.type === 'welcome');
    driver.send({ type: 'pose', x: 0, y: 0, z: 2, yaw: 0, moving: false });
    contender.send({ type: 'pose', x: 0, y: 0, z: 2, yaw: 0, moving: false });
    driver.send({ type: 'vehicle_enter', objectId: aircraft.id });
    const entered = await driver.next((message) => message.type === 'vehicle_entered');
    now += 1_000;
    driver.send({
      type: 'vehicle_state', objectId: aircraft.id, leaseId: entered.leaseId, seq: 1,
      x: 0, y: 0.2, z: 0, yaw: 0.1, pitch: 0.2, roll: -0.2,
      vx: 0, vy: 0.45, vz: 0,
    });
    await observer.next((message) => message.type === 'vehicle_state' && message.vehicle.seq === 1);

    const recoveryKey = `${DEFAULT_CHANNEL}:${aircraft.id}`;
    Object.assign(harness.application.multiplayerHub.vehicleStates.get(recoveryKey), {
      y: 2,
      vy: 2,
    });

    now += 100;
    driver.send({
      type: 'vehicle_state', objectId: aircraft.id, leaseId: entered.leaseId, seq: 2,
      x: 0, y: -1, z: 0, yaw: 0.1, pitch: 0.2, roll: -0.2,
      vx: 0, vy: -2, vz: 0,
    });
    assert.equal((await driver.next((message) => message.type === 'error')).code, 'vehicle_state_rejected');
    const recovering = await observer.next((message) => message.type === 'vehicle_recovery');
    assert.equal(recovering.reason, 'state_loss');
    assert.equal(recovering.driverId, 'recovery-driver1');
    assert.equal(recovering.vehicle.driverId, 'recovery-driver1');
    assert.equal(recovering.vehicle.recovering, true);

    contender.send({ type: 'vehicle_enter', objectId: aircraft.id });
    assert.equal((await contender.next((message) => message.type === 'error')).code, 'vehicle_busy');

    const late = await connect(harness, 'recovery-late-001');
    clients.push(late);
    const lateWelcome = await late.next((message) => message.type === 'welcome');
    const lateVehicle = lateWelcome.vehicles.find(({ objectId }) => objectId === aircraft.id);
    assert.equal(lateVehicle.driverId, 'recovery-driver1');
    assert.equal(lateVehicle.recovering, true);
    const descending = await late.next((message) => message.type === 'vehicle_state'
      && message.vehicle.objectId === aircraft.id && message.vehicle.y < lateVehicle.y);
    assert.equal(descending.vehicle.driverId, 'recovery-driver1');
    assert.equal(descending.vehicle.recovering, true);

    const released = await observer.next((message) => message.type === 'vehicle_released'
      && message.reason === 'timeout');
    assert.equal(released.driverId, 'recovery-driver1');
    assert.equal(
      new Set(['exit', 'disconnect', 'timeout', 'party', 'return_lobby', 'server_shutdown'])
        .has(released.reason),
      true,
      'the final frame reason must remain accepted by the v1 release parser',
    );
    assert.equal(released.vehicle.driverId, null);
    assert.equal(Object.hasOwn(released.vehicle, 'recovering'), false);
    assert.deepEqual(
      {
        y: released.vehicle.y,
        pitch: released.vehicle.pitch,
        roll: released.vehicle.roll,
        vx: released.vehicle.vx,
        vy: released.vehicle.vy,
        vz: released.vehicle.vz,
      },
      { y: 0, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0 },
    );
    assert.equal(harness.application.multiplayerHub.driverLeases.has('recovery-driver1'), false);
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('vehicle-autoland-v1 recovers an aircraft from extreme finite altitude within 25 seconds', async () => {
  let now = Date.parse('2026-07-15T17:30:00.000Z');
  const harness = await createHarness({
    clock: () => now,
    multiplayerVehicle: { leaseMs: 60_000, recoveryTickMs: 10 },
  });
  const clients = [];
  try {
    const aircraft = (await harness.application.lobbyStore.create(DEFAULT_CHANNEL, {
      clientId: 'extreme-owner-01',
      catalogId: 'code-precision-rescue-helicopter',
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      scale: 1,
    })).object;
    const driver = await connect(harness, 'extreme-driver-01');
    const observer = await connect(harness, 'extreme-watch-001');
    clients.push(driver, observer);
    await driver.next((message) => message.type === 'welcome');
    await observer.next((message) => message.type === 'welcome');
    driver.send({ type: 'pose', x: 0, y: 0, z: 2, yaw: 0, moving: false });
    driver.send({ type: 'vehicle_enter', objectId: aircraft.id });
    const entered = await driver.next((message) => message.type === 'vehicle_entered');
    now += 1_000;
    driver.send({
      type: 'vehicle_state', objectId: aircraft.id, leaseId: entered.leaseId, seq: 1,
      x: 0, y: 0.1, z: 0, yaw: 0, pitch: 0.1, roll: -0.1,
      vx: 0, vy: 0.45, vz: 0,
    });
    await observer.next((message) => message.type === 'vehicle_state' && message.vehicle.seq === 1);

    const key = `${DEFAULT_CHANNEL}:${aircraft.id}`;
    const airborneState = harness.application.multiplayerHub.vehicleStates.get(key);
    Object.assign(airborneState, {
      y: 3_600,
      pitch: 0.3,
      roll: -0.3,
      vy: 9,
    });
    driver.close();
    const recoveryFrame = await observer.next((message) => message.type === 'vehicle_recovery');
    assert.equal(recoveryFrame.driverId, 'extreme-driver-01');
    assert.equal(recoveryFrame.vehicle.driverId, 'extreme-driver-01');
    assert.equal(recoveryFrame.vehicle.recovering, true);
    assert.equal(recoveryFrame.vehicle.y, 3_600);

    let recovery = harness.application.multiplayerHub.vehicleRecoveries.get(key);
    assert.equal(recovery.adaptiveDescent, true);
    clearTimeout(recovery.timer);
    recovery.timer = null;
    let elapsedMs = 0;
    let previousY = recoveryFrame.vehicle.y;
    while (recovery && elapsedMs < 25_000) {
      now += 1_000;
      elapsedMs += 1_000;
      harness.application.multiplayerHub.stepVehicleRecovery(recovery);
      const state = harness.application.multiplayerHub.vehicleStates.get(key);
      assert.equal([
        state.x, state.y, state.z, state.yaw, state.pitch, state.roll,
        state.vx, state.vy, state.vz,
      ].every(Number.isFinite), true, 'every recovery frame must remain finite');
      recovery = harness.application.multiplayerHub.vehicleRecoveries.get(key);
      if (recovery) {
        clearTimeout(recovery.timer);
        recovery.timer = null;
        assert.equal(state.driverId, 'extreme-driver-01');
        assert.equal(state.recovering, true);
        assert.equal(state.y < previousY, true);
        previousY = state.y;
      }
    }
    assert.equal(elapsedMs <= 25_000, true);
    assert.equal(harness.application.multiplayerHub.vehicleRecoveries.has(key), false);
    const landedState = harness.application.multiplayerHub.vehicleStates.get(key);
    assert.deepEqual(
      {
        driverId: landedState.driverId,
        recovering: landedState.recovering,
        y: landedState.y,
        pitch: landedState.pitch,
        roll: landedState.roll,
        vx: landedState.vx,
        vy: landedState.vy,
        vz: landedState.vz,
      },
      {
        driverId: null,
        recovering: false,
        y: 0,
        pitch: 0,
        roll: 0,
        vx: 0,
        vy: 0,
        vz: 0,
      },
    );
    const adaptiveFrame = await observer.next((message) => message.type === 'vehicle_state'
      && message.vehicle.recovering === true && message.vehicle.y < 3_600);
    assert.equal(adaptiveFrame.vehicle.driverId, 'extreme-driver-01');
    assert.equal(Object.values(adaptiveFrame.vehicle)
      .filter((value) => typeof value === 'number').every(Number.isFinite), true);
    const released = await observer.next((message) => message.type === 'vehicle_released'
      && message.driverId === 'extreme-driver-01');
    assert.equal(released.vehicle.driverId, null);
    assert.equal(released.vehicle.y, 0);
    assert.equal(Object.hasOwn(released.vehicle, 'recovering'), false);
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('airborne timeout and disconnect recover authoritatively before releasing the aircraft', async (t) => {
  for (const reason of ['timeout', 'disconnect']) {
    await t.test(reason, async () => {
      let now = Date.parse('2026-07-15T18:00:00.000Z');
      const harness = await createHarness({
        clock: () => now,
        multiplayerVehicle: { leaseMs: 100, recoveryTickMs: 10 },
      });
      const clients = [];
      try {
        const aircraft = (await harness.application.lobbyStore.create(DEFAULT_CHANNEL, {
          clientId: `recovery-${reason}-owner`,
          catalogId: 'code-precision-rescue-helicopter',
          position: { x: 0, y: 0, z: 0 },
          rotationY: 0,
          scale: 1,
        })).object;
        const driverId = reason === 'timeout' ? 'timeout-driver-01' : 'disconnect-fly01';
        const driver = await connect(harness, driverId);
        const observer = await connect(harness, `watch-${reason}-0001`);
        clients.push(driver, observer);
        await driver.next((message) => message.type === 'welcome');
        await observer.next((message) => message.type === 'welcome');
        driver.send({ type: 'pose', x: 0, y: 0, z: 2, yaw: 0, moving: false });
        driver.send({ type: 'vehicle_enter', objectId: aircraft.id });
        const entered = await driver.next((message) => message.type === 'vehicle_entered');
        now += 90;
        driver.send({
          type: 'vehicle_state', objectId: aircraft.id, leaseId: entered.leaseId, seq: 1,
          x: 0, y: 0.5, z: 0, yaw: 0, pitch: 0.1, roll: -0.1,
          vx: 0, vy: 0.5, vz: 0,
        });
        await observer.next((message) => message.type === 'vehicle_state' && message.vehicle.seq === 1);
        if (reason === 'timeout') {
          now += 101;
          const lease = harness.application.multiplayerHub.vehicleLeases.values().next().value;
          assert.ok(lease);
          assert.equal(harness.application.multiplayerHub.releaseVehicle(lease, 'timeout'), true);
        } else driver.close();

        const recovery = await observer.next((message) => message.type === 'vehicle_recovery'
          && message.reason === reason);
        assert.equal(recovery.driverId, driverId);
        assert.equal(recovery.vehicle.driverId, driverId);
        assert.equal(recovery.vehicle.recovering, true);
        if (reason === 'disconnect') {
          await observer.next((message) => message.type === 'leave' && message.id === driverId);
          assert.equal(harness.application.multiplayerHub.connections.has(driverId), false);
        } else {
          assert.equal(harness.application.multiplayerHub.connections.has(driverId), true);
        }
        const released = await observer.next((message) => message.type === 'vehicle_released'
          && message.reason === reason);
        assert.equal(released.driverId, driverId);
        assert.equal(released.vehicle.driverId, null);
        assert.equal(released.vehicle.y, 0);
        assert.equal(Object.hasOwn(released.vehicle, 'recovering'), false);
      } finally {
        for (const client of clients) client.close();
        await harness.close();
      }
    });
  }
});

test('server shutdown clears airborne leases without broadcasting an unsafe released snapshot', async () => {
  let now = Date.parse('2026-07-15T19:00:00.000Z');
  const harness = await createHarness({ clock: () => now });
  const clients = [];
  try {
    const aircraft = (await harness.application.lobbyStore.create(DEFAULT_CHANNEL, {
      clientId: 'shutdown-owner-01',
      catalogId: 'code-precision-rescue-helicopter',
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      scale: 1,
    })).object;
    const driver = await connect(harness, 'shutdown-driver1');
    const observer = await connect(harness, 'shutdown-watch-01');
    clients.push(driver, observer);
    await driver.next((message) => message.type === 'welcome');
    await observer.next((message) => message.type === 'welcome');
    driver.send({ type: 'pose', x: 0, y: 0, z: 2, yaw: 0, moving: false });
    driver.send({ type: 'vehicle_enter', objectId: aircraft.id });
    const entered = await driver.next((message) => message.type === 'vehicle_entered');
    now += 1_000;
    driver.send({
      type: 'vehicle_state', objectId: aircraft.id, leaseId: entered.leaseId, seq: 1,
      x: 0, y: 0.2, z: 0, yaw: 0, pitch: 0.1, roll: -0.1,
      vx: 0, vy: 0.45, vz: 0,
    });
    await observer.next((message) => message.type === 'vehicle_state' && message.vehicle.y === 0.2);

    harness.application.multiplayerHub.close();
    await observer.closed;
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(
      observer.messages.some((message) => message.type === 'vehicle_released'),
      false,
      'shutdown must not broadcast an airborne final release before disconnecting clients',
    );
    assert.equal(harness.application.multiplayerHub.vehicleLeases.size, 0);
    assert.equal(harness.application.multiplayerHub.vehicleRecoveries.size, 0);
    assert.equal(harness.application.multiplayerHub.driverLeases.size, 0);
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('vehicle leases enforce a 15/s state cap and preserve the explicit timeout path', async () => {
  const harness = await createHarness({ multiplayerVehicle: { leaseMs: 150 } });
  const clients = [];
  try {
    const roadster = (await harness.application.lobbyStore.create(DEFAULT_CHANNEL, {
      clientId: 'vehicle-owner-02',
      catalogId: 'code-precision-rescue-helicopter',
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      scale: 1,
    })).object;
    const driver = await connect(harness, 'vehicle-rate-0001');
    const observer = await connect(harness, 'vehicle-watch-001');
    clients.push(driver, observer);
    await driver.next((message) => message.type === 'welcome');
    await observer.next((message) => message.type === 'welcome');
    await driver.next((message) => message.type === 'join' && message.player.id === 'vehicle-watch-001');
    driver.send({ type: 'pose', x: 0, y: 0, z: 2, yaw: 0, moving: false });
    driver.send({ type: 'vehicle_enter', objectId: roadster.id });
    const entered = await driver.next((message) => message.type === 'vehicle_entered');
    await observer.next((message) => message.type === 'vehicle_claimed');
    for (let seq = 1; seq <= 16; seq += 1) {
      driver.send({
        type: 'vehicle_state', objectId: roadster.id, leaseId: entered.leaseId, seq,
        x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0,
        vx: 0, vy: 0, vz: 0,
      });
    }
    assert.equal((await driver.next((message) => message.type === 'error')).code, 'vehicle_state_rate_limited');
    await observer.next((message) => message.type === 'vehicle_state' && message.vehicle.seq === 15);
    const lease = harness.application.multiplayerHub.vehicleLeases.values().next().value;
    assert.ok(lease);
    assert.equal(harness.application.multiplayerHub.releaseVehicle(lease, 'timeout'), true);
    const timeout = await observer.next((message) => message.type === 'vehicle_released' && message.reason === 'timeout');
    assert.equal(timeout.vehicle.driverId, null);
    assert.equal(timeout.vehicle.seq, 15);
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('launching a party releases the driver and lobby return snapshots the retained runtime vehicle', async () => {
  const harness = await createHarness({ multiplayerParty: { countdownMs: 300, lifetimeMs: 10_000 } });
  const clients = [];
  try {
    const roadster = (await harness.application.lobbyStore.create(DEFAULT_CHANNEL, {
      clientId: 'vehicle-owner-03',
      catalogId: 'code-precision-rescue-helicopter',
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      scale: 1,
    })).object;
    const alice = await connect(harness, 'party-driver-001');
    const bob = await connect(harness, 'party-rider-0001');
    clients.push(alice, bob);
    await alice.next((message) => message.type === 'welcome');
    await bob.next((message) => message.type === 'welcome');
    await alice.next((message) => message.type === 'join' && message.player.id === 'party-rider-0001');
    alice.send({ type: 'pose', x: 0, y: 0, z: 2, yaw: 0, moving: false });
    alice.send({ type: 'vehicle_enter', objectId: roadster.id });
    await alice.next((message) => message.type === 'vehicle_entered');
    await bob.next((message) => message.type === 'vehicle_claimed');

    const levelId = 'vehicle-party-level';
    const levelVersion = `builtin:1:${levelId}`;
    alice.send({ type: 'party_create', levelId, levelVersion });
    const party = await alice.next((message) => message.type === 'party_state');
    const invite = await bob.next((message) => message.type === 'party_invite');
    bob.send({ type: 'party_respond', partyId: invite.partyId, accept: true, levelVersion });
    await alice.next((message) => message.type === 'party_state' && message.members.length === 2);
    const released = await bob.next((message) => message.type === 'vehicle_released' && message.reason === 'party');
    assert.equal(released.driverId, 'party-driver-001');
    const launched = await alice.next((message) => message.type === 'channel_snapshot' && message.channel === `level:${party.partyId}`);
    assert.deepEqual(launched.vehicles, []);
    alice.send({ type: 'return_lobby' });
    const returned = await alice.next((message) => message.type === 'channel_snapshot' && message.channel === `lobby:${DEFAULT_CHANNEL}`);
    assert.deepEqual(returned.vehicles, [released.vehicle]);
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('WebSocket players, poses, and party invitations are isolated by numeric lobby channel', async () => {
  const harness = await createHarness({ multiplayerParty: { countdownMs: 2_000, lifetimeMs: 10_000 } });
  const clients = [];
  try {
    const alice = await connect(harness, 'room-alice-0001', { channel: '001234', name: 'Alice' });
    clients.push(alice);
    const aliceWelcome = await alice.next((message) => message.type === 'welcome');
    assert.equal(aliceWelcome.channel, 'lobby:001234');
    assert.equal(aliceWelcome.lobbyChannel, '001234');
    assert.equal(aliceWelcome.players.length, 1);

    const bob = await connect(harness, 'room-bob-000001', { channel: '9876', name: 'Bob' });
    clients.push(bob);
    const bobWelcome = await bob.next((message) => message.type === 'welcome');
    assert.equal(bobWelcome.channel, 'lobby:9876');
    assert.equal(bobWelcome.players.length, 1);

    const carol = await connect(harness, 'room-carol-0001', { channel: '001234', name: 'Carol' });
    clients.push(carol);
    const carolWelcome = await carol.next((message) => message.type === 'welcome');
    assert.deepEqual(new Set(carolWelcome.players.map(({ id }) => id)), new Set([
      'room-alice-0001',
      'room-carol-0001',
    ]));
    await alice.next((message) => message.type === 'join' && message.player.id === 'room-carol-0001');

    carol.send({ type: 'pose', x: 2, y: 0, z: 2, yaw: 0, moving: true });
    await alice.next((message) => message.type === 'pose' && message.id === 'room-carol-0001');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(bob.messages.some((message) => ['join', 'pose'].includes(message.type)), false);

    const levelId = 'channel-party-level';
    const levelVersion = `builtin:1:${levelId}`;
    alice.send({ type: 'party_create', levelId, levelVersion });
    const party = await alice.next((message) => message.type === 'party_state');
    await carol.next((message) => message.type === 'party_invite' && message.partyId === party.partyId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(bob.messages.some((message) => message.type === 'party_invite'), false);

    bob.send({
      type: 'party_respond',
      partyId: party.partyId,
      accept: true,
      levelVersion,
    });
    const rejected = await bob.next((message) => message.type === 'error');
    assert.equal(rejected.code, 'party_invite_expired');
    assert.equal(harness.application.multiplayerHub.parties.get(party.partyId).members.has('room-bob-000001'), false);
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('WebSocket welcomes and isolates players in derived heaven and hell persistent-space channels', async () => {
  const harness = await createHarness();
  const clients = [];
  try {
    const heaven = 'space-001234-heaven';
    const hell = 'space-001234-hell';
    const otherOriginHeaven = 'space-9876-heaven';
    const alice = await connect(harness, 'space-alice-0001', { channel: heaven, name: 'Alice' });
    clients.push(alice);
    const aliceWelcome = await alice.next((message) => message.type === 'welcome');
    assert.equal(aliceWelcome.channel, `lobby:${heaven}`);
    assert.equal(aliceWelcome.lobbyChannel, heaven);
    assert.deepEqual(aliceWelcome.features, [
      'vehicle-lease-v1',
      'vehicle-autoland-v1',
      'persistent-space-v1',
    ]);
    assert.deepEqual(aliceWelcome.players.map(({ id }) => id), ['space-alice-0001']);

    const bob = await connect(harness, 'space-bob-000001', { channel: hell, name: 'Bob' });
    const dave = await connect(harness, 'space-dave-00001', { channel: otherOriginHeaven, name: 'Dave' });
    clients.push(bob, dave);
    const bobWelcome = await bob.next((message) => message.type === 'welcome');
    const daveWelcome = await dave.next((message) => message.type === 'welcome');
    assert.equal(bobWelcome.channel, `lobby:${hell}`);
    assert.equal(bobWelcome.lobbyChannel, hell);
    assert.equal(daveWelcome.channel, `lobby:${otherOriginHeaven}`);
    assert.equal(daveWelcome.lobbyChannel, otherOriginHeaven);
    assert.equal(bobWelcome.players.length, 1);
    assert.equal(daveWelcome.players.length, 1);

    const carol = await connect(harness, 'space-carol-0001', { channel: heaven, name: 'Carol' });
    clients.push(carol);
    const carolWelcome = await carol.next((message) => message.type === 'welcome');
    assert.deepEqual(new Set(carolWelcome.players.map(({ id }) => id)), new Set([
      'space-alice-0001',
      'space-carol-0001',
    ]));
    await alice.next((message) => message.type === 'join' && message.player.id === 'space-carol-0001');

    carol.send({ type: 'pose', x: 18, y: 3, z: -28, yaw: 0.5, moving: true });
    const relayed = await alice.next((message) => message.type === 'pose' && message.id === 'space-carol-0001');
    assert.deepEqual({ x: relayed.x, y: relayed.y, z: relayed.z }, { x: 18, y: 3, z: -28 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(bob.messages.some((message) => ['join', 'pose'].includes(message.type)), false);
    assert.equal(dave.messages.some((message) => ['join', 'pose'].includes(message.type)), false);

    const invalid = await rejectedUpgrade(harness, 'space-invalid-01', { channel: 'space-123-heaven' });
    assert.equal(invalid.status, 422);
    assert.match(invalid.body, /invalid_lobby_channel/);
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('the seeded celestial dragon uses the vehicle lease and persists its safe parked pose after dismount', async () => {
  const harness = await createHarness({ multiplayerVehicle: { leaseMs: 60_000 } });
  const clients = [];
  const channel = 'space-2468-heaven';
  try {
    const driver = await connect(harness, 'dragon-driver-001', { channel });
    const observer = await connect(harness, 'dragon-watch-0001', { channel });
    clients.push(driver, observer);
    await driver.next((message) => message.type === 'welcome');
    await observer.next((message) => message.type === 'welcome');
    await driver.next((message) => message.type === 'join' && message.player.id === 'dragon-watch-0001');

    driver.send({ type: 'pose', x: 0, y: 0, z: -7, yaw: Math.PI, moving: false });
    await observer.next((message) => message.type === 'pose' && message.id === 'dragon-driver-001');
    driver.send({ type: 'vehicle_enter', objectId: 'realm-celestial-dragon-0001' });
    const entered = await driver.next((message) => message.type === 'vehicle_entered' || message.type === 'error');
    assert.equal(entered.type, 'vehicle_entered', entered.code);
    assert.deepEqual({
      objectId: entered.vehicle.objectId,
      catalogId: entered.vehicle.catalogId,
      kind: entered.vehicle.kind,
      x: entered.vehicle.x,
      y: entered.vehicle.y,
      z: entered.vehicle.z,
      yaw: entered.vehicle.yaw,
    }, {
      objectId: 'realm-celestial-dragon-0001',
      catalogId: 'code-celestial-riding-dragon',
      kind: 'aircraft',
      x: 0,
      y: 0,
      z: -9,
      yaw: Math.PI,
    });
    await observer.next((message) => message.type === 'vehicle_claimed');

    driver.send({
      type: 'vehicle_state', objectId: entered.vehicle.objectId, leaseId: entered.leaseId, seq: 1,
      x: 0.02, y: 0, z: -8.97, yaw: 3.13, pitch: 0, roll: 0,
      vx: 0.05, vy: 0, vz: 0.05,
    });
    const firstState = await driver.next((message) => (
      (message.type === 'vehicle_state' && message.vehicle.seq === 1) || message.type === 'error'
    ));
    assert.equal(firstState.type, 'vehicle_state', firstState.code);
    await observer.next((message) => message.type === 'vehicle_state' && message.vehicle.seq === 1);
    await new Promise((resolve) => setTimeout(resolve, 75));
    driver.send({
      type: 'vehicle_state', objectId: entered.vehicle.objectId, leaseId: entered.leaseId, seq: 2,
      x: 0.02, y: 0, z: -8.97, yaw: 3.13, pitch: 0, roll: 0,
      vx: 0, vy: 0, vz: 0,
    });
    const stoppedState = await driver.next((message) => (
      (message.type === 'vehicle_state' && message.vehicle.seq === 2) || message.type === 'error'
    ));
    assert.equal(stoppedState.type, 'vehicle_state', stoppedState.code);
    await observer.next((message) => message.type === 'vehicle_state' && message.vehicle.seq === 2);
    driver.send({
      type: 'vehicle_exit', objectId: entered.vehicle.objectId, leaseId: entered.leaseId, seq: 3,
    });
    const released = await observer.next((message) => (
      message.type === 'vehicle_released' && message.vehicle.objectId === entered.vehicle.objectId
    ));
    assert.equal(released.vehicle.driverId, null);

    const persisted = (await harness.application.lobbyStore.getState(channel)).objects
      .find(({ id }) => id === entered.vehicle.objectId);
    assert.deepEqual(persisted?.position, { x: 0.02, y: 0, z: -8.97 });
    assert.equal(persisted?.rotationY, 3.13);
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('the celestial dragon stays busy until its released pose is durably parked', async () => {
  const harness = await createHarness({ multiplayerVehicle: { leaseMs: 60_000 } });
  const clients = [];
  const channel = 'space-8642-heaven';
  const lobbyStore = harness.application.lobbyStore;
  const originalPersist = lobbyStore.persistRealmVehiclePose;
  const originalConsoleError = console.error;
  let allowPersistence;
  const persistenceGate = new Promise((resolve) => { allowPersistence = resolve; });
  let signalPersistenceStarted;
  const persistenceStarted = new Promise((resolve) => { signalPersistenceStarted = resolve; });
  lobbyStore.persistRealmVehiclePose = async (...args) => {
    signalPersistenceStarted(args);
    await persistenceGate;
    return originalPersist.call(lobbyStore, ...args);
  };
  try {
    const driver = await connect(harness, 'dragon-lock-driver', { channel });
    const observer = await connect(harness, 'dragon-lock-watch', { channel });
    const contender = await connect(harness, 'dragon-lock-contender', { channel });
    clients.push(driver, observer, contender);
    await driver.next((message) => message.type === 'welcome');
    await observer.next((message) => message.type === 'welcome');
    await contender.next((message) => message.type === 'welcome');

    driver.send({ type: 'pose', x: 0, y: 0, z: -7, yaw: Math.PI, moving: false });
    contender.send({ type: 'pose', x: 0, y: 0, z: -7.5, yaw: Math.PI, moving: false });
    await observer.next((message) => message.type === 'pose' && message.id === 'dragon-lock-driver');
    await observer.next((message) => message.type === 'pose' && message.id === 'dragon-lock-contender');

    driver.send({ type: 'vehicle_enter', objectId: 'realm-celestial-dragon-0001' });
    const entered = await driver.next((message) => message.type === 'vehicle_entered' || message.type === 'error');
    assert.equal(entered.type, 'vehicle_entered', entered.code);
    await observer.next((message) => message.type === 'vehicle_claimed');

    driver.send({
      type: 'vehicle_exit', objectId: entered.vehicle.objectId, leaseId: entered.leaseId, seq: 1,
    });
    await persistenceStarted;
    assert.equal(observer.messages.some((message) => message.type === 'vehicle_released'), false);

    contender.send({ type: 'vehicle_enter', objectId: entered.vehicle.objectId });
    const blocked = await contender.next((message) => message.type === 'vehicle_entered' || message.type === 'error');
    assert.deepEqual(blocked, { type: 'error', code: 'vehicle_busy' });

    allowPersistence();
    const released = await observer.next((message) => (
      message.type === 'vehicle_released' && message.vehicle.objectId === entered.vehicle.objectId
    ));
    const persisted = (await lobbyStore.getState(channel)).objects
      .find(({ id }) => id === entered.vehicle.objectId);
    assert.deepEqual(persisted?.position, {
      x: released.vehicle.x,
      y: 0,
      z: released.vehicle.z,
    });
    assert.equal(persisted?.rotationY, released.vehicle.yaw);

    contender.send({ type: 'vehicle_enter', objectId: entered.vehicle.objectId });
    const claimed = await contender.next((message) => message.type === 'vehicle_entered' || message.type === 'error');
    assert.equal(claimed.type, 'vehicle_entered', claimed.code);
    await observer.next((message) => (
      message.type === 'vehicle_claimed' && message.vehicle.driverId === 'dragon-lock-contender'
    ));

    const loggedPersistenceErrors = [];
    console.error = (...args) => loggedPersistenceErrors.push(args);
    lobbyStore.persistRealmVehiclePose = () => {
      throw new Error('synthetic parked-pose failure');
    };
    contender.send({
      type: 'vehicle_exit', objectId: claimed.vehicle.objectId, leaseId: claimed.leaseId, seq: 1,
    });
    const fallbackRelease = await observer.next((message) => (
      message.type === 'vehicle_released' && message.driverId === 'dragon-lock-contender'
    ));
    assert.equal(fallbackRelease.vehicle.driverId, null);
    assert.equal(loggedPersistenceErrors.length, 1);
    assert.match(loggedPersistenceErrors[0][0], /Failed to persist the celestial dragon parked pose/);
    assert.match(loggedPersistenceErrors[0][1]?.message ?? '', /synthetic parked-pose failure/);
  } finally {
    allowPersistence?.();
    console.error = originalConsoleError;
    lobbyStore.persistRealmVehiclePose = originalPersist;
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('WebSocket validates channel numbers while mapping legacy missing-channel clients to 0000', async () => {
  const harness = await createHarness({ multiplayerParty: { countdownMs: 300, lifetimeMs: 10_000 } });
  const clients = [];
  try {
    const invalid = await rejectedUpgrade(harness, 'invalid-room-01', { channel: '../0000' });
    assert.equal(invalid.status, 422);
    assert.match(invalid.body, /invalid_lobby_channel/);

    const url = `${harness.baseUrl.replace(/^http/, 'ws')}/api/lobby/multiplayer?clientId=legacy-room-01&avatarId=&name=Legacy`;
    const legacy = new TestSocket(url, harness.baseUrl);
    clients.push(legacy);
    await legacy.opened;
    const welcome = await legacy.next((message) => message.type === 'welcome');
    assert.equal(welcome.channel, 'lobby');
    assert.equal(welcome.lobbyChannel, DEFAULT_CHANNEL);

    const modern = await connect(harness, 'modern-room-01', { channel: DEFAULT_CHANNEL, name: 'Modern' });
    clients.push(modern);
    const modernWelcome = await modern.next((message) => message.type === 'welcome');
    assert.equal(modernWelcome.channel, `lobby:${DEFAULT_CHANNEL}`);
    assert.equal(modernWelcome.players.length, 2);
    await legacy.next((message) => message.type === 'join' && message.player.id === 'modern-room-01');

    const levelId = 'legacy-wire-level';
    const levelVersion = `builtin:1:${levelId}`;
    legacy.send({ type: 'party_create', levelId, levelVersion });
    const party = await legacy.next((message) => message.type === 'party_state');
    await modern.next((message) => message.type === 'party_invite' && message.partyId === party.partyId);
    modern.send({ type: 'party_respond', partyId: party.partyId, accept: true, levelVersion });
    await Promise.all([
      legacy.next((message) => message.type === 'party_launch'),
      modern.next((message) => message.type === 'party_launch'),
      legacy.next((message) => message.type === 'channel_snapshot' && message.channel.startsWith('level:')),
      modern.next((message) => message.type === 'channel_snapshot' && message.channel.startsWith('level:')),
    ]);

    legacy.send({ type: 'return_lobby' });
    assert.equal((await legacy.next((message) => message.type === 'channel_snapshot')).channel, 'lobby');
    modern.send({ type: 'return_lobby' });
    assert.equal(
      (await modern.next((message) => message.type === 'channel_snapshot')).channel,
      `lobby:${DEFAULT_CHANNEL}`,
    );
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('lobby poses are finite without fixed position bounds while level poses retain the original range', async () => {
  const harness = await createHarness({ multiplayerParty: { countdownMs: 250, lifetimeMs: 10_000 } });
  const clients = [];
  try {
    const alice = await connect(harness, 'bounds-alice-001', { name: 'Alice' });
    const bob = await connect(harness, 'bounds-bob-00001', { name: 'Bob' });
    clients.push(alice, bob);
    await alice.next((message) => message.type === 'welcome');
    await bob.next((message) => message.type === 'welcome');
    await alice.next((message) => message.type === 'join' && message.player.id === 'bounds-bob-00001');

    alice.send({ type: 'pose', x: 120, y: 8, z: -90, yaw: 0, moving: true });
    const edgePose = await bob.next((message) => message.type === 'pose' && message.id === 'bounds-alice-001');
    assert.deepEqual({ x: edgePose.x, y: edgePose.y, z: edgePose.z }, { x: 120, y: 8, z: -90 });

    const levelId = 'bounds-level';
    const levelVersion = 'sha256:bounds-level-version';
    alice.send({ type: 'party_create', levelId, levelVersion });
    const party = await alice.next((message) => message.type === 'party_state');
    await bob.next((message) => message.type === 'party_invite' && message.partyId === party.partyId);
    bob.send({ type: 'party_respond', partyId: party.partyId, accept: true, levelVersion });
    await alice.next((message) => message.type === 'party_state' && message.members.length === 2);
    await bob.next((message) => message.type === 'party_state' && message.members.length === 2);
    await Promise.all([
      alice.next((message) => message.type === 'party_launch'),
      bob.next((message) => message.type === 'party_launch'),
    ]);
    await Promise.all([
      alice.next((message) => message.type === 'channel_snapshot' && message.channel.startsWith('level:')),
      bob.next((message) => message.type === 'channel_snapshot' && message.channel.startsWith('level:')),
    ]);

    alice.send({ type: 'pose', x: 41, y: 0, z: 0, yaw: 0, moving: false });
    const closed = await alice.closed;
    assert.equal(closed.code, 1008);
    assert.equal(closed.reason, 'invalid_multiplayer_pose');
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('party invitations require acceptance, launch one versioned level channel, and isolate poses from the lobby', async () => {
  const harness = await createHarness({ multiplayerParty: { countdownMs: 300, lifetimeMs: 10_000 } });
  const clients = [];
  try {
    const alice = await connect(harness, 'party-alice-01', { name: 'Alice' });
    const bob = await connect(harness, 'party-bob-0001', { name: 'Bob' });
    const carol = await connect(harness, 'party-carol-01', { name: 'Carol' });
    clients.push(alice, bob, carol);
    await Promise.all([
      alice.next((message) => message.type === 'welcome'),
      bob.next((message) => message.type === 'welcome'),
      carol.next((message) => message.type === 'welcome'),
    ]);

    const levelId = 'skyline-relay-official';
    const levelVersion = `builtin:1:${levelId}`;
    alice.send({ type: 'party_create', levelId, levelVersion });
    const leaderState = await alice.next((message) => message.type === 'party_state');
    const partyId = leaderState.partyId;
    assert.match(partyId, /^party-/);
    const bobInvite = await bob.next((message) => message.type === 'party_invite' && message.partyId === partyId);
    await carol.next((message) => message.type === 'party_invite' && message.partyId === partyId);
    assert.equal(bobInvite.levelVersion, levelVersion);

    bob.send({ type: 'party_respond', partyId, accept: true, levelVersion });
    const joined = await alice.next((message) => message.type === 'party_state' && message.members.length === 2);
    await bob.next((message) => message.type === 'party_state' && message.members.length === 2);
    assert.deepEqual(new Set(joined.members.map((member) => member.id)), new Set(['party-alice-01', 'party-bob-0001']));
    carol.send({ type: 'party_respond', partyId, accept: false, levelVersion });
    assert.equal((await carol.next((message) => message.type === 'party_cancelled' && message.partyId === partyId)).reason, 'declined');

    const [aliceLaunch, bobLaunch] = await Promise.all([
      alice.next((message) => message.type === 'party_launch'),
      bob.next((message) => message.type === 'party_launch'),
    ]);
    assert.equal(aliceLaunch.levelId, levelId);
    assert.equal(bobLaunch.levelVersion, levelVersion);
    const [aliceChannel, bobChannel] = await Promise.all([
      alice.next((message) => message.type === 'channel_snapshot'),
      bob.next((message) => message.type === 'channel_snapshot'),
    ]);
    assert.equal(aliceChannel.channel, `level:${partyId}`);
    assert.equal(bobChannel.players.length, 2);

    alice.send({ type: 'pose', x: 24, y: 1, z: -22, yaw: 0.5, moving: true });
    const levelPose = await bob.next((message) => message.type === 'pose' && message.id === 'party-alice-01');
    assert.equal(levelPose.x, 24);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(carol.messages.some((message) => message.type === 'pose' && message.id === 'party-alice-01'), false);

    bob.send({ type: 'return_lobby' });
    const bobLobby = await bob.next((message) => message.type === 'channel_snapshot' && message.channel === `lobby:${DEFAULT_CHANNEL}`);
    assert.ok(bobLobby.players.some((player) => player.id === 'party-carol-01'));
    await carol.next((message) => message.type === 'join' && message.player.id === 'party-bob-0001');
    bob.send({ type: 'pose', x: 1, y: 0, z: 1, yaw: 0, moving: false });
    await carol.next((message) => message.type === 'pose' && message.id === 'party-bob-0001');

    alice.close();
    await alice.closed;
    const resumedAlice = await connect(harness, 'party-alice-01', { name: 'Alice', partyId });
    clients.push(resumedAlice);
    const resumedWelcome = await resumedAlice.next((message) => message.type === 'welcome');
    assert.equal(resumedWelcome.channel, `level:${partyId}`);
    resumedAlice.send({ type: 'return_lobby' });
    await resumedAlice.next((message) => message.type === 'channel_snapshot' && message.channel === `lobby:${DEFAULT_CHANNEL}`);
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('a player can belong to only one forming party and may join another after leaving', async () => {
  const harness = await createHarness({ multiplayerParty: { countdownMs: 2_000, lifetimeMs: 10_000 } });
  const clients = [];
  try {
    const alice = await connect(harness, 'forming-alice-1', { name: 'Alice' });
    const bob = await connect(harness, 'forming-bob-001', { name: 'Bob' });
    const carol = await connect(harness, 'forming-carol-1', { name: 'Carol' });
    clients.push(alice, bob, carol);
    await Promise.all([
      alice.next((message) => message.type === 'welcome'),
      bob.next((message) => message.type === 'welcome'),
      carol.next((message) => message.type === 'welcome'),
    ]);

    const levelId = 'memory-garden-official';
    const levelVersion = `builtin:1:${levelId}`;
    alice.send({ type: 'party_create', levelId, levelVersion });
    const aliceParty = await alice.next((message) => message.type === 'party_state');
    await bob.next((message) => message.type === 'party_invite' && message.partyId === aliceParty.partyId);
    await carol.next((message) => message.type === 'party_invite' && message.partyId === aliceParty.partyId);

    carol.send({ type: 'party_create', levelId, levelVersion });
    const carolParty = await carol.next((message) => message.type === 'party_state');
    await bob.next((message) => message.type === 'party_invite' && message.partyId === carolParty.partyId);

    bob.send({ type: 'party_respond', partyId: aliceParty.partyId, accept: true, levelVersion });
    await alice.next((message) => message.type === 'party_state' && message.members.length === 2);
    await bob.next((message) => message.type === 'party_state' && message.partyId === aliceParty.partyId);

    bob.send({ type: 'party_respond', partyId: carolParty.partyId, accept: true, levelVersion });
    assert.equal((await bob.next((message) => message.type === 'error')).code, 'party_already_joined');
    assert.equal(harness.application.multiplayerHub.parties.get(carolParty.partyId).members.has('forming-bob-001'), false);

    bob.send({ type: 'party_cancel', partyId: aliceParty.partyId });
    await bob.next((message) => message.type === 'party_cancelled' && message.partyId === aliceParty.partyId);
    bob.send({ type: 'party_respond', partyId: carolParty.partyId, accept: true, levelVersion });
    const joinedCarol = await carol.next((message) => message.type === 'party_state' && message.members.length === 2);
    assert.deepEqual(new Set(joinedCarol.members.map((member) => member.id)), new Set(['forming-carol-1', 'forming-bob-001']));
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('WebSocket pose/profile/total-message rates, strict pose bounds, and 1 KB payload ceiling are enforced', async () => {
  let now = Date.now();
  const harness = await createHarness({ clock: () => now });
  const clients = [];
  try {
    const sender = await connect(harness, 'sender-001');
    const observer = await connect(harness, 'observer-1');
    clients.push(sender, observer);
    await sender.next((message) => message.type === 'welcome');
    await observer.next((message) => message.type === 'welcome');
    for (let index = 0; index < 20; index += 1) {
      sender.send({ type: 'pose', x: index / 10, y: 0, z: 0, yaw: 0, moving: true });
    }
    const rateNotice = await sender.next((message) => message.type === 'error');
    assert.equal(rateNotice.code, 'pose_rate_limited');
    for (let index = 0; index < 15; index += 1) await observer.next((message) => message.type === 'pose');
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(observer.messages.filter((message) => message.type === 'pose').length, 0);

    const profileChanger = await connect(harness, 'profile-01');
    clients.push(profileChanger);
    await profileChanger.next((message) => message.type === 'welcome');
    await observer.next((message) => message.type === 'join' && message.player.id === 'profile-01');
    for (let index = 0; index < 6; index += 1) {
      profileChanger.send({ type: 'profile', name: `Profile ${index}`, avatarId: index % 2 ? 'preset-ink-chibi' : null });
      const changed = await observer.next((message) => message.type === 'profile' && message.player.id === 'profile-01');
      assert.equal(changed.player.name, `Profile ${index}`);
    }
    profileChanger.send({ type: 'profile', name: 'Profile delayed', avatarId: 'preset-cloud-doll' });
    const profileNotice = await profileChanger.next((message) => message.type === 'error');
    assert.equal(profileNotice.code, 'profile_rate_limited');
    assert.equal(profileNotice.retryAfterMs, 400);
    profileChanger.send({ type: 'pose', x: 1, y: 0, z: 1, yaw: 0, moving: true });
    await observer.next((message) => message.type === 'pose' && message.id === 'profile-01');
    assert.equal(profileChanger.socket.readyState, WebSocket.OPEN);
    now += 400;
    profileChanger.send({ type: 'profile', name: 'Profile final', avatarId: 'preset-cloud-doll' });
    const finalProfile = await observer.next((message) => message.type === 'profile' && message.player.id === 'profile-01');
    assert.equal(finalProfile.player.name, 'Profile final');
    assert.equal(finalProfile.player.avatarId, 'preset-cloud-doll');

    const flood = await connect(harness, 'flooder-01');
    clients.push(flood);
    await flood.next((message) => message.type === 'welcome');
    for (let index = 0; index < 31; index += 1) {
      flood.send({ type: 'pose', x: 0, y: 0, z: 0, yaw: 0, moving: false });
    }
    const floodClose = await flood.closed;
    assert.equal(floodClose.code, 1008);
    assert.equal(floodClose.reason, 'message_rate_limited');

    const invalid = await connect(harness, 'invalid-01');
    clients.push(invalid);
    await invalid.next((message) => message.type === 'welcome');
    invalid.send({ type: 'pose', x: 0, y: 0, z: 0, yaw: Math.PI + 0.001, moving: false });
    assert.equal((await invalid.closed).code, 1008);

    const oversized = await connect(harness, 'oversize-1');
    clients.push(oversized);
    await oversized.next((message) => message.type === 'welcome');
    oversized.socket.send(JSON.stringify({ type: 'pose', padding: 'x'.repeat(1_100) }));
    assert.equal((await oversized.closed).code, 1009);
  } finally {
    for (const client of clients) client.close();
    await harness.close();
  }
});

test('WebSocket requires same Origin, enforces per-IP/total caps, and rejects duplicate live client IDs', async (t) => {
  await t.test('origin, per-IP cap, and client ID ownership', async () => {
    const harness = await createHarness({ multiplayerLimits: { maxTotal: 3, maxPerIp: 2 } });
    const clients = [];
    try {
      const badOrigin = await rejectedUpgrade(harness, 'originbad-1', { origin: 'https://evil.example' });
      assert.equal(badOrigin.status, 403);
      assert.match(badOrigin.body, /multiplayer_origin_rejected/);

      const first = await connect(harness, 'same-user-1');
      const second = await connect(harness, 'second-001');
      clients.push(first, second);
      await first.next((message) => message.type === 'welcome');
      await second.next((message) => message.type === 'welcome');
      const limited = await rejectedUpgrade(harness, 'third-user-1');
      assert.equal(limited.status, 429);
      assert.match(limited.body, /multiplayer_connection_limit/);

      const conflict = await rejectedUpgrade(harness, 'same-user-1');
      assert.equal(conflict.status, 409);
      assert.match(conflict.body, /multiplayer_client_in_use/);
      first.close();
      await first.closed;
      while (harness.application.multiplayerHub.connections.has('same-user-1')) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const reconnected = await connect(harness, 'same-user-1');
      clients.push(reconnected);
      const welcome = await reconnected.next((message) => message.type === 'welcome');
      assert.equal(welcome.players.length, 2);
      assert.equal(harness.application.multiplayerHub.connections.size, 2);
    } finally {
      for (const client of clients) client.close();
      await harness.close();
    }
  });

  await t.test('total cap across IPs', async () => {
    const harness = await createHarness({ multiplayerLimits: { maxTotal: 2, maxPerIp: 2 } });
    const clients = [];
    try {
      const url = (id) => `${harness.baseUrl.replace(/^http/, 'ws')}/api/lobby/multiplayer?channel=${DEFAULT_CHANNEL}&clientId=${id}&avatarId=&name=${id}`;
      for (const [id, ip] of [['total-one', '198.51.100.1'], ['total-two', '198.51.100.2']]) {
        const client = new TestSocket(url(id), harness.baseUrl, { 'X-Real-IP': ip });
        await client.opened;
        clients.push(client);
      }
      const limited = await rejectedUpgrade(harness, 'total-three', { forwardedIp: '198.51.100.3' });
      assert.equal(limited.status, 429);
      assert.match(limited.body, /multiplayer_connection_limit/);
    } finally {
      for (const client of clients) client.close();
      await harness.close();
    }
  });
});

test('closing the HTTP application terminates upgraded multiplayer sockets and timers', async () => {
  const harness = await createHarness({ multiplayerPingIntervalMs: 100 });
  const client = await connect(harness, 'closing-01');
  await client.next((message) => message.type === 'welcome');
  await Promise.race([
    new Promise((resolve, reject) => harness.application.server.close((error) => error ? reject(error) : resolve())),
    new Promise((_, reject) => setTimeout(() => reject(new Error('HTTP server close timed out')), 1_000)),
  ]);
  assert.equal(harness.application.multiplayerHub.connections.size, 0);
  assert.equal(harness.application.multiplayerHub.pingTimer, null);
  assert.equal((await client.closed).code, 1006);
  await harness.close();
});
