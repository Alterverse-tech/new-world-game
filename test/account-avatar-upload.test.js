import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AvatarUploadGate, AvatarUploadRateLimiter } from '../src/avatar.js';
import { HttpError } from '../src/errors.js';
import { createApplication } from '../src/server.js';

const UPLOAD_TOKEN = 'upload-token-for-account-avatar-tests';
const ADMIN_TOKEN = 'admin-token-for-account-avatar-tests';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const OWNER_A = `owner-${USER_A}`;
const OWNER_B = `owner-${USER_B}`;

function fakeSupabaseAuth(clock = Date.now) {
  const users = new Map([
    ['token-a', { subject: USER_A, email: 'alice@example.test', displayName: 'Alice' }],
    ['token-b', { subject: USER_B, email: 'bob@example.test', displayName: 'Bob' }],
  ]);
  return {
    enabled: true,
    publicConfig() {
      return {
        enabled: true,
        provider: 'email',
        supabaseUrl: 'https://project-ref.supabase.co',
        publishableKey: 'sb_publishable_account_avatar_tests',
      };
    },
    async verifyRequest(request) {
      const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? '');
      const user = users.get(match?.[1]);
      if (!user) throw new HttpError(401, 'account_token_invalid', 'Invalid test token');
      return { ...user, avatarUrl: null, expiresAt: clock() + 45 * 60 * 1000 };
    },
  };
}

async function createHarness(options = {}) {
  const dataDirectory = options.dataDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'whiteroom-account-avatar-'));
  const application = await createApplication({
    uploadToken: UPLOAD_TOKEN,
    adminToken: ADMIN_TOKEN,
    dataDirectory,
    supabaseAuth: fakeSupabaseAuth(),
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

function responseSetCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') return response.headers.getSetCookie();
  const combined = response.headers.get('set-cookie');
  return combined ? combined.split(/,(?=\s*[^;,=]+=[^;,]*)/) : [];
}

function applySetCookies(jar, response) {
  for (const header of responseSetCookies(response)) {
    const pair = header.split(';', 1)[0];
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (/Max-Age=0/i.test(header) || !value) jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader(jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function login(harness, token) {
  const jar = new Map();
  const response = await fetch(`${harness.baseUrl}/api/auth/session`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: harness.baseUrl,
      'Sec-Fetch-Site': 'same-origin',
    },
  });
  assert.equal(response.status, 200);
  applySetCookies(jar, response);
  assert.ok(jar.has('whiteroom_account_session'));
  return jar;
}

function paddedJson(document) {
  const source = Buffer.from(JSON.stringify(document));
  return Buffer.concat([source, Buffer.alloc((4 - (source.length % 4)) % 4, 0x20)]);
}

function makeAnimatedAvatarGlb({ seed = 0, invalidPosition = false } = {}) {
  const positions = new Float32Array([
    -0.5 + seed / 10_000, 0, 0,
    0.5, 0, 0,
    0, 1, 0,
  ]);
  if (invalidPosition) positions[0] = Number.NaN;
  const joints = new Uint16Array([
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  const weights = new Float32Array([
    1, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
  ]);
  const animationInput = new Float32Array([0, 1]);
  const animationOutput = new Float32Array([0, 0, 0, 0, 0.02 + seed / 100_000, 0]);
  const inverseBind = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
  const chunks = [positions, joints, weights, animationInput, animationOutput, inverseBind]
    .map((array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  const offsets = [];
  let offset = 0;
  for (const chunk of chunks) {
    offsets.push(offset);
    offset += chunk.length;
  }
  const binary = Buffer.concat(chunks);
  const document = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: binary.length }],
    bufferViews: chunks.map((chunk, index) => ({ buffer: 0, byteOffset: offsets[index], byteLength: chunk.length })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'VEC4' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 3, componentType: 5126, count: 2, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: 2, type: 'VEC3' },
      { bufferView: 5, componentType: 5126, count: 1, type: 'MAT4' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 }, mode: 4 }] }],
    nodes: [{ mesh: 0, skin: 0 }, { name: 'RootJoint' }],
    skins: [{ joints: [1], skeleton: 1, inverseBindMatrices: 5 }],
    animations: [{
      name: 'Idle',
      samplers: [{ input: 3, output: 4, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }],
    }],
    scenes: [{ nodes: [0, 1] }],
    scene: 0,
  };
  const json = paddedJson(document);
  const total = 12 + 8 + json.length + 8 + binary.length;
  const glb = Buffer.alloc(total);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(total, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  const binaryHeader = 20 + json.length;
  glb.writeUInt32LE(binary.length, binaryHeader);
  glb.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binary.copy(glb, binaryHeader + 8);
  return glb;
}

function accountAvatarForm(model, {
  fileField = 'file',
  fileName = 'avatar.glb',
  name = '霓虹旅人',
  author = 'Alice',
  includeAuthor = true,
} = {}) {
  const form = new FormData();
  form.append(fileField, new Blob([model], { type: 'model/gltf-binary' }), fileName);
  form.append('name', name);
  if (includeAuthor) form.append('author', author);
  return form;
}

function accountRequest(harness, jar, { method = 'GET', body, headers = {} } = {}) {
  return fetch(`${harness.baseUrl}/api/account/avatars`, {
    method,
    headers: {
      Cookie: cookieHeader(jar),
      Origin: harness.baseUrl,
      'Sec-Fetch-Site': 'same-origin',
      ...headers,
    },
    ...(body ? { body } : {}),
  });
}

async function creatorUpload(harness, model, { name = 'Creator Avatar', author = 'Creator' } = {}) {
  const form = new FormData();
  form.append('avatar', new Blob([model], { type: 'model/gltf-binary' }), 'creator.glb');
  return fetch(`${harness.baseUrl}/api/avatars?name=${encodeURIComponent(name)}&author=${encodeURIComponent(author)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPLOAD_TOKEN}` },
    body: form,
  });
}

test('account Avatar endpoints require a same-origin email session and leave no state after rejected uploads', async () => {
  const harness = await createHarness({ avatarUploadLimits: { maximum: 50 } });
  try {
    const model = makeAnimatedAvatarGlb();
    const guestList = await fetch(`${harness.baseUrl}/api/account/avatars`);
    assert.equal(guestList.status, 401);
    assert.equal((await guestList.json()).error.code, 'account_session_required');

    const guestUpload = await fetch(`${harness.baseUrl}/api/account/avatars`, {
      method: 'POST',
      headers: { Origin: harness.baseUrl, 'Sec-Fetch-Site': 'same-origin' },
      body: accountAvatarForm(model),
    });
    assert.equal(guestUpload.status, 401);

    const alice = await login(harness, 'token-a');
    for (const method of ['GET', 'POST']) {
      const crossOrigin = await fetch(`${harness.baseUrl}/api/account/avatars`, {
        method,
        headers: {
          Cookie: cookieHeader(alice),
          Origin: 'https://evil.example',
          'Sec-Fetch-Site': 'cross-site',
        },
        ...(method === 'POST' ? { body: accountAvatarForm(model) } : {}),
      });
      assert.equal(crossOrigin.status, 403, method);
      assert.equal((await crossOrigin.json()).error.code, 'cross_origin_lobby_write');
    }

    const wrongField = await accountRequest(harness, alice, {
      method: 'POST',
      body: accountAvatarForm(model, { fileField: 'avatar' }),
    });
    assert.equal(wrongField.status, 400);
    assert.equal((await wrongField.json()).error.code, 'invalid_upload');

    const missingAuthor = await accountRequest(harness, alice, {
      method: 'POST',
      body: accountAvatarForm(model, { includeAuthor: false }),
    });
    assert.equal(missingAuthor.status, 422);
    assert.equal((await missingAuthor.json()).error.code, 'invalid_upload_metadata');

    const strictFailure = await accountRequest(harness, alice, {
      method: 'POST',
      body: accountAvatarForm(makeAnimatedAvatarGlb({ invalidPosition: true })),
    });
    assert.equal(strictFailure.status, 422);
    assert.equal((await strictFailure.json()).error.code, 'invalid_avatar_glb');

    const empty = await accountRequest(harness, alice);
    assert.equal(empty.status, 200);
    assert.equal(empty.headers.get('cache-control'), 'private, no-store');
    assert.match(empty.headers.get('vary') ?? '', /Cookie/i);
    assert.equal(empty.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.deepEqual(await empty.json(), { schemaVersion: 1, avatars: [] });
    assert.deepEqual((await harness.application.avatarStore.getRegistry()).avatars, []);
    assert.deepEqual(await readdir(path.join(harness.dataDirectory, 'avatars', 'models')), []);
    assert.deepEqual(JSON.parse(await readFile(path.join(harness.dataDirectory, 'avatars', 'owners.json'), 'utf8')), {
      schemaVersion: 1,
      owners: [],
    });
  } finally {
    await harness.close();
  }
});

test('account Avatar ownership is private, many-to-many, hash-deduplicated, strict, and restart-safe while creator upload stays compatible', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-account-avatar-restart-'));
  const first = await createHarness({ dataDirectory, avatarUploadLimits: { maximum: 50 } });
  const alice = await login(first, 'token-a');
  const bob = await login(first, 'token-b');
  let accountAvatar;
  try {
    const creatorModel = makeAnimatedAvatarGlb({ seed: 1 });
    const creatorResponse = await creatorUpload(first, creatorModel);
    assert.equal(creatorResponse.status, 201);
    const creatorAvatar = await creatorResponse.json();
    assert.equal(creatorAvatar.deduplicated, false);

    const aliceUpload = await accountRequest(first, alice, {
      method: 'POST',
      body: accountAvatarForm(creatorModel, { name: 'Alice Copy', author: 'Alice' }),
    });
    assert.equal(aliceUpload.status, 200);
    assert.equal(aliceUpload.headers.get('cache-control'), 'private, no-store');
    assert.match(aliceUpload.headers.get('vary') ?? '', /Cookie/i);
    const aliceCopy = await aliceUpload.json();
    assert.equal(aliceCopy.avatarId, creatorAvatar.avatarId);
    assert.equal(aliceCopy.deduplicated, true);

    const animatedModel = makeAnimatedAvatarGlb({ seed: 2 });
    const newAccountUpload = await accountRequest(first, alice, {
      method: 'POST',
      body: accountAvatarForm(animatedModel, { name: 'Alice Animated', author: 'Alice' }),
    });
    assert.equal(newAccountUpload.status, 201);
    accountAvatar = await newAccountUpload.json();
    assert.deepEqual(Object.keys(accountAvatar).sort(), [
      'author', 'avatarId', 'avatarUrl', 'deduplicated', 'hash', 'launchUrl', 'name',
    ]);
    assert.equal(accountAvatar.author, 'Alice');
    assert.equal(accountAvatar.deduplicated, false);

    const bobDedupe = await accountRequest(first, bob, {
      method: 'POST',
      body: accountAvatarForm(animatedModel, { name: 'Bob Copy', author: 'Bob' }),
    });
    assert.equal(bobDedupe.status, 200);
    assert.equal((await bobDedupe.json()).avatarId, accountAvatar.avatarId);

    const aliceList = await (await accountRequest(first, alice)).json();
    const bobList = await (await accountRequest(first, bob)).json();
    assert.deepEqual(aliceList.avatars.map((avatar) => avatar.avatarId), [creatorAvatar.avatarId, accountAvatar.avatarId]);
    assert.deepEqual(bobList.avatars.map((avatar) => avatar.avatarId), [accountAvatar.avatarId]);
    for (const avatar of [...aliceList.avatars, ...bobList.avatars]) assert.equal('ownerId' in avatar, false);

    const metadata = await (await fetch(`${first.baseUrl}/api/avatars/${accountAvatar.avatarId}`)).json();
    assert.equal(metadata.stats.skins, 1);
    assert.equal(metadata.stats.animations, 1);
    assert.equal('ownerId' in metadata, false);
    const publicRegistry = await (await fetch(`${first.baseUrl}/api/avatars`)).json();
    assert.equal(publicRegistry.avatars.length, 2);
    assert.ok(publicRegistry.avatars.every((avatar) => !('ownerId' in avatar)));

    const owners = JSON.parse(await readFile(path.join(dataDirectory, 'avatars', 'owners.json'), 'utf8'));
    assert.deepEqual(owners, {
      schemaVersion: 1,
      owners: [
        { ownerId: OWNER_A, avatarIds: [accountAvatar.avatarId, creatorAvatar.avatarId].sort() },
        { ownerId: OWNER_B, avatarIds: [accountAvatar.avatarId] },
      ],
    });
  } finally {
    await first.close({ remove: false });
  }

  const restarted = await createHarness({ dataDirectory, avatarUploadLimits: { maximum: 50 } });
  try {
    const aliceList = await (await accountRequest(restarted, alice)).json();
    const bobList = await (await accountRequest(restarted, bob)).json();
    assert.equal(aliceList.avatars.length, 2);
    assert.deepEqual(bobList.avatars.map((avatar) => avatar.avatarId), [accountAvatar.avatarId]);
  } finally {
    await restarted.close();
  }
});

test('account Avatar count, owner/IP upload rates, and validation concurrency are independently bounded', async (t) => {
  await t.test('owner capacity is isolated between accounts', async () => {
    const harness = await createHarness({
      avatarLimits: { maxPerOwner: 1 },
      avatarUploadLimits: { maximum: 50 },
    });
    try {
      const alice = await login(harness, 'token-a');
      const bob = await login(harness, 'token-b');
      assert.equal((await accountRequest(harness, alice, {
        method: 'POST', body: accountAvatarForm(makeAnimatedAvatarGlb({ seed: 10 })),
      })).status, 201);
      const full = await accountRequest(harness, alice, {
        method: 'POST', body: accountAvatarForm(makeAnimatedAvatarGlb({ seed: 11 })),
      });
      assert.equal(full.status, 507);
      assert.equal((await full.json()).error.code, 'avatar_owner_capacity_reached');
      assert.equal((await accountRequest(harness, bob, {
        method: 'POST', body: accountAvatarForm(makeAnimatedAvatarGlb({ seed: 11 }), { author: 'Bob' }),
      })).status, 201);
    } finally {
      await harness.close();
    }
  });

  await t.test('the account limiter enforces owner and IP windows without changing creator checks', () => {
    const ownerLimiter = new AvatarUploadRateLimiter({ maximum: 2 });
    ownerLimiter.checkOwner(OWNER_A, '203.0.113.1');
    ownerLimiter.checkOwner(OWNER_A, '203.0.113.2');
    assert.throws(
      () => ownerLimiter.checkOwner(OWNER_A, '203.0.113.3'),
      (error) => error.status === 429 && error.code === 'avatar_upload_rate_limited',
    );

    const ipLimiter = new AvatarUploadRateLimiter({ maximum: 2 });
    ipLimiter.checkOwner(OWNER_A, '203.0.113.9');
    ipLimiter.checkOwner(OWNER_B, '203.0.113.9');
    assert.throws(
      () => ipLimiter.checkOwner(OWNER_B, '203.0.113.9'),
      (error) => error.status === 429 && error.code === 'avatar_upload_rate_limited',
    );

    const creatorLimiter = new AvatarUploadRateLimiter({ maximum: 1 });
    creatorLimiter.checkOwner(OWNER_A, '203.0.113.20');
    assert.doesNotThrow(() => creatorLimiter.check('203.0.113.20'));
    assert.throws(
      () => creatorLimiter.check('203.0.113.21'),
      (error) => error.status === 429 && error.code === 'avatar_upload_rate_limited',
    );
  });

  await t.test('at most two validations can be active', () => {
    const gate = new AvatarUploadGate(2);
    const releaseA = gate.enter();
    const releaseB = gate.enter();
    assert.throws(
      () => gate.enter(),
      (error) => error.status === 429 && error.code === 'avatar_upload_busy',
    );
    releaseA();
    const releaseC = gate.enter();
    releaseC();
    releaseB();
    assert.equal(gate.active, 0);
  });
});
