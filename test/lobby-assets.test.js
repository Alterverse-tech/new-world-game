import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateAvatarGlb } from '../src/avatar.js';
import {
  LobbyAssetUploadGate,
  LobbyAssetUploadRateLimiter,
  MAX_LOBBY_ASSET_BYTES,
} from '../src/lobby-assets.js';
import { createApplication } from '../src/server.js';

const UPLOAD_TOKEN = 'upload-token-for-lobby-asset-tests';
const ADMIN_TOKEN = 'admin-token-for-lobby-asset-tests';
const CROSS_ORIGIN = 'https://creator.whiteroom.example';

function makeGlb({
  seed = 0,
  binaryBytes = 44,
  bufferUri,
  nodeCount = 1,
  indices = [0, 1, 2],
  triangleCount = 1,
  extensionsUsed = [],
  embeddedImage,
  mutateDocument,
  rawJsonTransform,
} = {}) {
  const indexCount = triangleCount * 3;
  const geometryLength = Math.max(44, binaryBytes, 36 + indexCount * 2);
  const imageOffset = embeddedImage ? Math.ceil(geometryLength / 4) * 4 : null;
  const binaryLength = embeddedImage ? imageOffset + embeddedImage.buffer.length : geometryLength;
  const binary = Buffer.alloc(Math.ceil(binaryLength / 4) * 4);
  binary.writeFloatLE(seed, 0);
  binary.writeFloatLE(1, 12);
  binary.writeFloatLE(1, 28);
  for (let index = 0; index < indexCount; index += 1) {
    binary.writeUInt16LE(indices[index % indices.length], 36 + index * 2);
  }
  const document = {
    asset: { version: '2.0', generator: 'WhiteRoom lobby asset tests' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: Array.from({ length: nodeCount }, (_, index) => index === 0 ? { mesh: 0 } : {}),
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: indexCount, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: indexCount * 2 },
    ],
    buffers: [{ byteLength: binaryLength }],
  };
  if (embeddedImage) {
    document.bufferViews.push({
      buffer: 0,
      byteOffset: imageOffset,
      byteLength: embeddedImage.buffer.length,
    });
    document.images = [{ bufferView: 2, mimeType: embeddedImage.mimeType }];
    document.textures = [{ source: 0 }];
    embeddedImage.buffer.copy(binary, imageOffset);
  }
  if (bufferUri !== undefined) document.buffers[0].uri = bufferUri;
  if (extensionsUsed.length) document.extensionsUsed = [...extensionsUsed];
  mutateDocument?.(document);
  const serialized = JSON.stringify(document);
  const source = Buffer.from(rawJsonTransform ? rawJsonTransform(serialized) : serialized);
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

function makeWebp(width = 1, height = 1) {
  const payload = Buffer.alloc(5);
  payload[0] = 0x2f;
  payload.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  const result = Buffer.alloc(12 + 8 + payload.length + (payload.length % 2));
  result.write('RIFF', 0, 'ascii');
  result.writeUInt32LE(result.length - 8, 4);
  result.write('WEBP', 8, 'ascii');
  result.write('VP8L', 12, 'ascii');
  result.writeUInt32LE(payload.length, 16);
  payload.copy(result, 20);
  return result;
}

async function createHarness(options = {}) {
  const dataDirectory = options.dataDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'whiteroom-lobby-assets-test-'));
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

async function identity(harness) {
  const response = await fetch(`${harness.baseUrl}/api/lobby/assets`);
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  return { cookie, ownerId: undefined };
}

async function uploadAsset(harness, cookie, buffer, {
  name = '云朵沙发',
  category = '家具',
  defaultScale = '1',
  fileName = 'prop.glb',
  fileField = 'file',
  forwardedIp,
  fetchSite,
  origin,
} = {}) {
  const form = new FormData();
  form.append(fileField, new Blob([buffer], { type: 'model/gltf-binary' }), fileName);
  form.append('name', name);
  form.append('category', category);
  if (defaultScale !== null) form.append('defaultScale', defaultScale);
  const headers = { Cookie: cookie };
  if (forwardedIp) headers['X-Real-IP'] = forwardedIp;
  if (fetchSite) headers['Sec-Fetch-Site'] = fetchSite;
  if (origin) headers.Origin = origin;
  return fetch(`${harness.baseUrl}/api/lobby/assets`, { method: 'POST', headers, body: form });
}

async function recursiveFiles(directory) {
  const result = [];
  const visit = async (current, prefix = '') => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory()) await visit(path.join(current, entry.name), relative);
      else result.push(relative);
    }
  };
  await visit(directory);
  return result.sort();
}

async function createLobbyObject(harness, cookie, catalogId, index = 0, channel = '0000') {
  return fetch(`${harness.baseUrl}/api/lobby/objects?channel=${channel}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      clientId: `asset-client-${String(index).padStart(4, '0')}`,
      catalogId,
      position: { x: -12, y: 0, z: -12 },
      rotationY: 0,
      scale: 1,
    }),
  });
}

test('player GLB assets use a private owner library, public same-origin resolution, and owner-only instancing', async () => {
  const harness = await createHarness({
    corsOrigin: CROSS_ORIGIN,
    lobbyAssetUploadLimits: { maximum: 20, globalMaximum: 100 },
  });
  try {
    const preflight = await fetch(`${harness.baseUrl}/api/lobby/assets`, {
      method: 'OPTIONS',
      headers: {
        Origin: CROSS_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), null);
    assert.equal(preflight.headers.get('access-control-allow-methods'), null);
    assert.equal(preflight.headers.get('cross-origin-resource-policy'), 'same-origin');

    const beforeGet = await recursiveFiles(path.join(harness.dataDirectory, 'lobby-assets'));
    const alice = await identity(harness);
    const afterGet = await recursiveFiles(path.join(harness.dataDirectory, 'lobby-assets'));
    assert.deepEqual(afterGet, beforeGet, 'GET /api/lobby/assets wrote persistent data');

    const empty = await fetch(`${harness.baseUrl}/api/lobby/assets`, { headers: { Cookie: alice.cookie } });
    assert.equal(empty.headers.get('cache-control'), 'private, no-store');
    assert.equal(empty.headers.get('vary'), 'Cookie');
    assert.equal(empty.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(await empty.json(), { schemaVersion: 1, assets: [] });

    const model = makeGlb();
    const uploadedResponse = await uploadAsset(harness, alice.cookie, model, { defaultScale: '1.25' });
    assert.equal(uploadedResponse.status, 201);
    assert.equal(uploadedResponse.headers.get('cache-control'), 'private, no-store');
    assert.equal(uploadedResponse.headers.get('vary'), 'Cookie');
    assert.equal(uploadedResponse.headers.get('access-control-allow-origin'), null);
    const uploaded = await uploadedResponse.json();
    assert.equal(uploaded.deduplicated, false);
    assert.match(uploaded.asset.id, /^user-glb-[a-f0-9]{32}$/);
    assert.deepEqual(Object.keys(uploaded.asset).sort(), [
      'assetUrl', 'category', 'defaultScale', 'id', 'kind', 'name',
    ]);
    assert.deepEqual(uploaded.asset, {
      id: uploaded.asset.id,
      name: '云朵沙发',
      category: '家具',
      kind: 'glb',
      assetUrl: `/lobby-assets/${uploaded.asset.id}/model.glb`,
      defaultScale: 1.25,
    });

    const mine = await (await fetch(`${harness.baseUrl}/api/lobby/assets`, {
      headers: { Cookie: alice.cookie },
    })).json();
    assert.deepEqual(mine.assets, [uploaded.asset]);
    const bob = await identity(harness);
    assert.deepEqual((await (await fetch(`${harness.baseUrl}/api/lobby/assets`, {
      headers: { Cookie: bob.cookie },
    })).json()).assets, []);

    const metadataResponse = await fetch(`${harness.baseUrl}/api/lobby/assets/${uploaded.asset.id}`);
    assert.equal(metadataResponse.status, 200);
    assert.equal(metadataResponse.headers.get('access-control-allow-origin'), null);
    assert.equal(metadataResponse.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.deepEqual(await metadataResponse.json(), { asset: uploaded.asset });

    const head = await fetch(`${harness.baseUrl}${uploaded.asset.assetUrl}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-type'), 'model/gltf-binary');
    assert.equal(head.headers.get('cache-control'), 'public, max-age=300, must-revalidate');
    assert.equal(head.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(head.headers.get('access-control-allow-origin'), null);
    assert.match(head.headers.get('etag'), /^"[a-f0-9]{64}"$/);
    const conditional = await fetch(`${harness.baseUrl}${uploaded.asset.assetUrl}`, {
      headers: { 'If-None-Match': head.headers.get('etag') },
    });
    assert.equal(conditional.status, 304);
    const downloaded = await fetch(`${harness.baseUrl}${uploaded.asset.assetUrl}`);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), model);

    const forbidden = await createLobbyObject(harness, bob.cookie, uploaded.asset.id, 1);
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).error.code, 'lobby_asset_permission_denied');
    const created = await createLobbyObject(harness, alice.cookie, uploaded.asset.id, 2);
    assert.equal(created.status, 201);
    assert.equal((await created.json()).object.catalogId, uploaded.asset.id);

    const unknown = await createLobbyObject(
      harness,
      alice.cookie,
      'user-glb-00000000000000000000000000000000',
      3,
    );
    assert.equal(unknown.status, 422);
    assert.equal((await unknown.json()).error.code, 'unknown_catalog_id');
    const systemCatalog = await (await fetch(`${harness.baseUrl}/api/lobby/catalog`)).json();
    assert.equal(systemCatalog.items.length >= 11, true);
    assert.equal(systemCatalog.items.some(({ id }) => id === 'code-precision-rescue-helicopter'), true);
    assert.equal(systemCatalog.items.some(({ id }) => id === 'code-heaven-hell-door'), true);
    assert.equal(systemCatalog.items.some(({ id }) => id === uploaded.asset.id), false);
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      assert.equal((await fetch(`${harness.baseUrl}/api/lobby/catalog`, { method })).status, 404);
    }
  } finally {
    await harness.close();
  }
});

test('lobby asset GLB validation rejects external, active-scene, decoder, structural, transform, and geometry hazards', async () => {
  const harness = await createHarness({ lobbyAssetUploadLimits: { maximum: 50, globalMaximum: 100 } });
  try {
    const owner = await identity(harness);
    const withoutIdentity = await uploadAsset(harness, '', makeGlb());
    assert.equal(withoutIdentity.status, 401);
    assert.equal((await withoutIdentity.json()).error.code, 'lobby_identity_required');
    const crossSite = await uploadAsset(harness, owner.cookie, makeGlb(), {
      fetchSite: 'cross-site',
      origin: CROSS_ORIGIN,
    });
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.headers.get('access-control-allow-origin'), null);

    const overflowingJsonNumber = makeGlb({
      mutateDocument(document) {
        document.materials = [{ pbrMetallicRoughness: { metallicFactor: 1 } }];
      },
      rawJsonTransform(source) {
        const transformed = source.replace('"metallicFactor":1', '"metallicFactor":1e400');
        assert.notEqual(transformed, source);
        return transformed;
      },
    });

    const animated = await uploadAsset(harness, owner.cookie, makeGlb({ mutateDocument(document) {
      document.animations = [{
        samplers: [{ input: 1, output: 0 }],
        channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
      }];
    } }), { name: 'animation' });
    assert.equal(animated.status, 201);

    const cases = [
      ['malformed', Buffer.from('not a glb'), 'invalid_lobby_asset_glb'],
      ['external', makeGlb({ bufferUri: 'https://example.com/model.bin' }), 'lobby_asset_external_resource'],
      ['camera', makeGlb({ mutateDocument(document) {
        document.cameras = [{ type: 'perspective', perspective: { yfov: 1, znear: 0.1 } }];
        document.nodes[0].camera = 0;
      } }), 'lobby_asset_forbidden_scene_feature'],
      ['light', makeGlb({ extensionsUsed: ['KHR_lights_punctual'] }), 'lobby_asset_forbidden_scene_feature'],
      ['audio', makeGlb({ extensionsUsed: ['MSFT_audio_emitter'] }), 'lobby_asset_forbidden_scene_feature'],
      ['decoder', makeGlb({ extensionsUsed: ['KHR_draco_mesh_compression'] }), 'lobby_asset_unsupported_extension'],
      ['non-finite-material-factor', overflowingJsonNumber, 'invalid_lobby_asset_glb'],
      ['node-budget', makeGlb({ nodeCount: 129 }), 'lobby_asset_budget_exceeded'],
      ['transform-bound', makeGlb({ mutateDocument(document) {
        document.nodes[0].translation = [1001, 0, 0];
      } }), 'invalid_lobby_asset_glb'],
      ['non-affine-matrix', makeGlb({ mutateDocument(document) {
        document.nodes[0].matrix = [1, 0, 0, 0.01, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      } }), 'invalid_lobby_asset_glb'],
      ['nested-scale-world-overflow', makeGlb({ nodeCount: 8, mutateDocument(document) {
        document.nodes = Array.from({ length: 8 }, (_, index) => ({
          scale: [100, 100, 100],
          ...(index < 7 ? { children: [index + 1] } : { mesh: 0 }),
        }));
        document.scenes[0].nodes = [0];
      } }), 'invalid_lobby_asset_glb'],
      ['nested-matrix-world-overflow', makeGlb({ nodeCount: 4, mutateDocument(document) {
        const scaleMatrix = [10_000, 0, 0, 0, 0, 10_000, 0, 0, 0, 0, 10_000, 0, 0, 0, 0, 1];
        document.nodes = Array.from({ length: 4 }, (_, index) => ({
          matrix: scaleMatrix,
          ...(index < 3 ? { children: [index + 1] } : { mesh: 0 }),
        }));
        document.scenes[0].nodes = [0];
      } }), 'invalid_lobby_asset_glb'],
      ['line-mode', makeGlb({ mutateDocument(document) {
        document.meshes[0].primitives[0].mode = 1;
      } }), 'invalid_lobby_asset_glb'],
      ['bad-position-semantic', makeGlb({ mutateDocument(document) {
        document.accessors[0].componentType = 5123;
      } }), 'invalid_lobby_asset_glb'],
      ['bad-index', makeGlb({ indices: [0, 1, 7] }), 'invalid_lobby_asset_glb'],
      ['reachable-mesh-reuse', makeGlb({ nodeCount: 2, triangleCount: 25_001, mutateDocument(document) {
        document.nodes[1].mesh = 0;
        document.scenes[0].nodes = [0, 1];
      } }), 'lobby_asset_budget_exceeded'],
      ['skin', makeGlb({ mutateDocument(document) {
        document.skins = [{ joints: [0] }];
        document.nodes[0].skin = 0;
      } }), 'lobby_asset_budget_exceeded'],
      ['morph', makeGlb({ mutateDocument(document) {
        document.meshes[0].primitives[0].targets = [{ POSITION: 0 }];
      } }), 'lobby_asset_budget_exceeded'],
      ['instancing', makeGlb({ extensionsUsed: ['EXT_mesh_gpu_instancing'], mutateDocument(document) {
        document.nodes[0].extensions = { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 0 } } };
      } }), 'lobby_asset_budget_exceeded'],
    ];
    for (const [label, model, expectedCode] of cases) {
      const response = await uploadAsset(harness, owner.cookie, model, { name: label });
      assert.equal(response.status, 422, label);
      const error = (await response.json()).error;
      assert.equal(error.code, expectedCode, label);
      if (label === 'reachable-mesh-reuse') {
        assert.deepEqual(error.details, {
          field: 'renderedTriangles',
          maximum: 50_000,
          actual: 50_002,
        });
      }
    }
    assert.doesNotThrow(() => validateAvatarGlb(overflowingJsonNumber), 'Avatar non-strict compatibility changed');

    const wrongExtension = await uploadAsset(harness, owner.cookie, makeGlb(), { fileName: 'prop.bin' });
    assert.equal(wrongExtension.status, 415);
    const oversized = await uploadAsset(harness, owner.cookie, Buffer.alloc(MAX_LOBBY_ASSET_BYTES + 1));
    assert.equal(oversized.status, 413);

    const aboveAvatarLimit = makeGlb({ binaryBytes: 9 * 1024 * 1024 });
    const accepted = await uploadAsset(harness, owner.cookie, aboveAvatarLimit, { name: '九兆模型' });
    assert.equal(accepted.status, 201, 'the lobby-specific 15 MB limit regressed to the 8 MB avatar limit');
    const implicitDefaultScene = await uploadAsset(harness, owner.cookie, makeGlb({ seed: 99, mutateDocument(document) {
      delete document.scene;
    } }), { name: '默认场景模型' });
    assert.equal(implicitDefaultScene.status, 201);
  } finally {
    await harness.close();
  }
});

test('same-owner and cross-owner dedupe, quotas, persistence, and dynamic lobby references remain authoritative', async () => {
  const first = await createHarness({ lobbyAssetUploadLimits: { maximum: 50, globalMaximum: 100 } });
  const dataDirectory = first.dataDirectory;
  try {
    const alice = await identity(first);
    const bob = await identity(first);
    const model = makeGlb({ seed: 4 });
    const aliceFirst = await uploadAsset(first, alice.cookie, model, { name: 'Alice 模型' });
    assert.equal(aliceFirst.status, 201);
    const aliceAsset = (await aliceFirst.json()).asset;
    const aliceDuplicate = await uploadAsset(first, alice.cookie, model, { name: '改名不会复制' });
    assert.equal(aliceDuplicate.status, 200);
    assert.deepEqual((await aliceDuplicate.json()).asset, aliceAsset);

    const bobFirst = await uploadAsset(first, bob.cookie, model, { name: 'Bob 模型' });
    assert.equal(bobFirst.status, 201);
    const bobAsset = (await bobFirst.json()).asset;
    assert.notEqual(bobAsset.id, aliceAsset.id);
    assert.equal(first.application.lobbyAssetStore.count, 2);
    assert.equal(first.application.lobbyAssetStore.totalBytes, model.length);
    assert.equal(first.application.lobbyAssetStore.ownerBytes.size, 2);
    assert.equal([...first.application.lobbyAssetStore.ownerBytes.values()].every((bytes) => bytes === model.length), true);
    assert.equal((await readdir(path.join(dataDirectory, 'lobby-assets', 'records'))).length, 2);
    assert.equal((await readdir(path.join(dataDirectory, 'lobby-assets', 'blobs'))).filter((name) => name.endsWith('.glb')).length, 1);

    const placed = await createLobbyObject(first, alice.cookie, aliceAsset.id, 1);
    assert.equal(placed.status, 201);
    await first.close({ remove: false });

    const restarted = await createHarness({
      dataDirectory,
      lobbyAssetUploadLimits: { maximum: 50, globalMaximum: 100 },
    });
    try {
      assert.deepEqual((await (await fetch(`${restarted.baseUrl}/api/lobby/assets`, {
        headers: { Cookie: alice.cookie },
      })).json()).assets, [aliceAsset]);
      assert.deepEqual((await (await fetch(`${restarted.baseUrl}/api/lobby/assets`, {
        headers: { Cookie: bob.cookie },
      })).json()).assets, [bobAsset]);
      assert.equal(restarted.application.lobbyStore.catalogIds.has(aliceAsset.id), true);
      const state = await (await fetch(`${restarted.baseUrl}/api/lobby/state?channel=0000`)).json();
      assert.equal(state.objects.some(({ catalogId }) => catalogId === aliceAsset.id), true);
      assert.deepEqual(Buffer.from(await (await fetch(`${restarted.baseUrl}${aliceAsset.assetUrl}`)).arrayBuffer()), model);
    } finally {
      await restarted.close();
    }
  } catch (error) {
    if (first.application.server.listening) await first.close();
    else await rm(dataDirectory, { recursive: true, force: true });
    throw error;
  }
});

test('a temporarily missing asset registry entry never causes a persisted dynamic lobby object to be sanitized away', async () => {
  const first = await createHarness({ lobbyAssetUploadLimits: { maximum: 20, globalMaximum: 100 } });
  const dataDirectory = first.dataDirectory;
  let asset;
  try {
    const owner = await identity(first);
    asset = (await (await uploadAsset(first, owner.cookie, makeGlb())).json()).asset;
    assert.equal((await createLobbyObject(first, owner.cookie, asset.id, 1)).status, 201);
    await first.close({ remove: false });
    await unlink(path.join(dataDirectory, 'lobby-assets', 'records', `${asset.id}.json`));

    const second = await createHarness({ dataDirectory });
    try {
      assert.equal(second.application.lobbyAssetStore.catalogIds.has(asset.id), false);
      const state = await (await fetch(`${second.baseUrl}/api/lobby/state?channel=0000`)).json();
      assert.equal(state.objects.filter(({ catalogId }) => catalogId === asset.id).length, 1);
      assert.equal((await fetch(`${second.baseUrl}/api/lobby/assets/${asset.id}`)).status, 404);
    } finally {
      await second.close();
    }
  } catch (error) {
    if (first.application.server.listening) await first.close();
    else await rm(dataDirectory, { recursive: true, force: true });
    throw error;
  }
});

test('lobby asset owner/storage/rate/concurrency and channel instance ceilings are bounded', async (t) => {
  await t.test('owner count and physical-byte dedupe quotas', async () => {
    const harness = await createHarness({
      lobbyAssetLimits: { maxPerOwner: 1, maxBytesPerOwner: 64 * 1024 * 1024, maxRecords: 10, maxTotalBytes: 64 * 1024 * 1024 },
      lobbyAssetUploadLimits: { maximum: 20, globalMaximum: 100 },
    });
    try {
      const alice = await identity(harness);
      const bob = await identity(harness);
      const model = makeGlb();
      assert.equal((await uploadAsset(harness, alice.cookie, model)).status, 201);
      assert.equal((await uploadAsset(harness, alice.cookie, model)).status, 200);
      const ownerFull = await uploadAsset(harness, alice.cookie, makeGlb({ seed: 1 }));
      assert.equal(ownerFull.status, 507);
      assert.equal((await ownerFull.json()).error.code, 'lobby_asset_capacity_reached');
      assert.equal((await uploadAsset(harness, bob.cookie, model)).status, 201);
      assert.equal(harness.application.lobbyAssetStore.totalBytes, model.length);
    } finally {
      await harness.close();
    }
  });

  await t.test('default hourly owner/IP/global limits and a two-validation gate', () => {
    let now = 1_000;
    const limiter = new LobbyAssetUploadRateLimiter({ clock: () => now });
    for (let index = 0; index < 5; index += 1) limiter.check('owner-a', '203.0.113.1');
    assert.throws(
      () => limiter.check('owner-a', '203.0.113.1'),
      (error) => error.code === 'lobby_asset_upload_rate_limited' && error.details.retryAfterMs === 3_600_000,
    );
    now += 3_600_000;
    assert.doesNotThrow(() => limiter.check('owner-a', '203.0.113.1'));

    const globalLimiter = new LobbyAssetUploadRateLimiter({ maximum: 100, globalMaximum: 2 });
    globalLimiter.check('owner-a', '203.0.113.1');
    globalLimiter.check('owner-b', '203.0.113.2');
    assert.throws(() => globalLimiter.check('owner-c', '203.0.113.3'), { code: 'lobby_asset_upload_rate_limited' });

    const gate = new LobbyAssetUploadGate();
    const releaseFirst = gate.enter();
    const releaseSecond = gate.enter();
    assert.throws(() => gate.enter(), { code: 'lobby_asset_upload_busy' });
    releaseFirst();
    assert.doesNotThrow(() => gate.enter()());
    releaseSecond();
    assert.equal(gate.active, 0);
  });

  await t.test('API upload attempts charge the limit before validation or dedupe', async () => {
    const harness = await createHarness({
      lobbyAssetUploadLimits: { maximum: 1, globalMaximum: 10 },
    });
    try {
      const owner = await identity(harness);
      const model = makeGlb();
      assert.equal((await uploadAsset(harness, owner.cookie, model)).status, 201);
      const duplicate = await uploadAsset(harness, owner.cookie, model);
      assert.equal(duplicate.status, 429);
      assert.equal((await duplicate.json()).error.code, 'lobby_asset_upload_rate_limited');
    } finally {
      await harness.close();
    }
  });

  await t.test('channel aggregate GLB byte, texture, vertex, and triangle budgets are authoritative', async (resources) => {
    await resources.test('unique bytes include persisted channel state after restart', async () => {
      const models = [101, 102, 103].map((seed) => makeGlb({ seed }));
      const uniqueBytes = models[0].length + models[1].length;
      const options = {
        lobbyAssetUploadLimits: { maximum: 20, globalMaximum: 100 },
        lobbyRateLimits: { maxPerClient: 50, maxPerIp: 100 },
        lobbyDynamicResourceLimits: {
          uniqueBytes,
          uniqueTexturePixels: 1_000_000,
          renderedVertices: 1_000_000,
          renderedTriangles: 1_000_000,
        },
      };
      const first = await createHarness(options);
      const dataDirectory = first.dataDirectory;
      let closed = false;
      try {
        const owner = await identity(first);
        const assets = [];
        for (const [index, model] of models.entries()) {
          const response = await uploadAsset(first, owner.cookie, model, { name: `字节模型 ${index}` });
          assert.equal(response.status, 201);
          assets.push((await response.json()).asset);
        }
        assert.equal((await createLobbyObject(first, owner.cookie, assets[0].id, 0, '9101')).status, 201);
        assert.equal((await createLobbyObject(first, owner.cookie, assets[1].id, 1, '9101')).status, 201);
        await first.close({ remove: false });
        closed = true;

        const restarted = await createHarness({ ...options, dataDirectory });
        try {
          const rejected = await createLobbyObject(restarted, owner.cookie, assets[2].id, 2, '9101');
          assert.equal(rejected.status, 409);
          assert.deepEqual((await rejected.json()).error, {
            code: 'lobby_asset_channel_resource_limit',
            message: 'Channel uploaded assets exceed the uniqueBytes resource budget',
            details: {
              field: 'uniqueBytes',
              maximum: uniqueBytes,
              actual: models.reduce((total, model) => total + model.length, 0),
            },
          });
        } finally {
          await restarted.close();
        }
      } finally {
        if (!closed) await first.close();
      }
    });

    await resources.test('unique decoded texture pixels are counted once per asset URL', async () => {
      const harness = await createHarness({
        lobbyAssetUploadLimits: { maximum: 20, globalMaximum: 100 },
        lobbyRateLimits: { maxPerClient: 50, maxPerIp: 100 },
        lobbyDynamicResourceLimits: {
          uniqueBytes: 1_000_000,
          uniqueTexturePixels: 2,
          renderedVertices: 1_000_000,
          renderedTriangles: 1_000_000,
        },
      });
      try {
        const owner = await identity(harness);
        const assets = [];
        for (let index = 0; index < 3; index += 1) {
          const response = await uploadAsset(harness, owner.cookie, makeGlb({
            seed: 111 + index,
            embeddedImage: { mimeType: 'image/webp', buffer: makeWebp() },
          }), { name: `纹理模型 ${index}` });
          assert.equal(response.status, 201);
          assets.push((await response.json()).asset);
        }
        assert.equal((await createLobbyObject(harness, owner.cookie, assets[0].id, 0, '9102')).status, 201);
        assert.equal((await createLobbyObject(harness, owner.cookie, assets[1].id, 1, '9102')).status, 201);
        const rejected = await createLobbyObject(harness, owner.cookie, assets[2].id, 2, '9102');
        assert.equal(rejected.status, 409);
        assert.deepEqual((await rejected.json()).error.details, {
          field: 'uniqueTexturePixels', maximum: 2, actual: 3,
        });
      } finally {
        await harness.close();
      }
    });

    for (const [field, limit, expected] of [
      ['renderedVertices', 6, 9],
      ['renderedTriangles', 2, 3],
    ]) {
      await resources.test(`${field} are counted for every placed instance`, async () => {
        const harness = await createHarness({
          lobbyAssetUploadLimits: { maximum: 20, globalMaximum: 100 },
          lobbyRateLimits: { maxPerClient: 50, maxPerIp: 100 },
          lobbyDynamicResourceLimits: {
            uniqueBytes: 1_000_000,
            uniqueTexturePixels: 1_000_000,
            renderedVertices: field === 'renderedVertices' ? limit : 1_000_000,
            renderedTriangles: field === 'renderedTriangles' ? limit : 1_000_000,
          },
        });
        try {
          const owner = await identity(harness);
          const asset = (await (await uploadAsset(harness, owner.cookie, makeGlb({ seed: limit }), {
            name: field,
          })).json()).asset;
          assert.equal((await createLobbyObject(harness, owner.cookie, asset.id, 0, `920${limit}`)).status, 201);
          assert.equal((await createLobbyObject(harness, owner.cookie, asset.id, 1, `920${limit}`)).status, 201);
          const rejected = await createLobbyObject(harness, owner.cookie, asset.id, 2, `920${limit}`);
          assert.equal(rejected.status, 409);
          assert.deepEqual((await rejected.json()).error.details, {
            field, maximum: limit, actual: expected,
          });
        } finally {
          await harness.close();
        }
      });
    }
  });

  await t.test('per-asset and total dynamic channel instance limits', async () => {
    const harness = await createHarness({
      lobbyAssetLimits: { maxPerOwner: 25, maxBytesPerOwner: 128 * 1024 * 1024, maxRecords: 100, maxTotalBytes: 256 * 1024 * 1024 },
      lobbyAssetUploadLimits: { maximum: 30, globalMaximum: 100 },
      lobbyRateLimits: { maxPerClient: 200, maxPerIp: 500 },
    });
    try {
      const owner = await identity(harness);
      const firstAsset = (await (await uploadAsset(harness, owner.cookie, makeGlb())).json()).asset;
      for (let index = 0; index < 20; index += 1) {
        assert.equal((await createLobbyObject(harness, owner.cookie, firstAsset.id, index, '7777')).status, 201);
      }
      const twentyFirst = await createLobbyObject(harness, owner.cookie, firstAsset.id, 20, '7777');
      assert.equal(twentyFirst.status, 409);
      assert.equal((await twentyFirst.json()).error.code, 'lobby_asset_instance_limit');

      const additionalAssets = [];
      for (let index = 1; index <= 20; index += 1) {
        const response = await uploadAsset(harness, owner.cookie, makeGlb({ seed: index }), { name: `模型 ${index}` });
        assert.equal(response.status, 201);
        additionalAssets.push((await response.json()).asset);
      }
      for (let index = 0; index < 20; index += 1) {
        assert.equal((await createLobbyObject(harness, owner.cookie, additionalAssets[index].id, 30 + index, '8888')).status, 201);
      }
      const uniqueLimit = await createLobbyObject(harness, owner.cookie, firstAsset.id, 60, '8888');
      assert.equal(uniqueLimit.status, 409);
      assert.equal((await uniqueLimit.json()).error.code, 'lobby_asset_channel_unique_limit');

      for (let index = 0; index < 20; index += 1) {
        assert.equal((await createLobbyObject(harness, owner.cookie, additionalAssets[index].id, 70 + index, '8888')).status, 201);
      }
      const totalLimit = await createLobbyObject(harness, owner.cookie, additionalAssets[0].id, 95, '8888');
      assert.equal(totalLimit.status, 409);
      assert.equal((await totalLimit.json()).error.code, 'lobby_asset_channel_limit');
    } finally {
      await harness.close();
    }
  });
});
