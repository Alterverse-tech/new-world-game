import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApplication } from '../src/server.js';
import { GRAVITY_LAW_LORE, RANKS, rankMeetsRequirement } from '../src/dreamsea.js';

const UPLOAD_TOKEN = 'upload-token-for-dreamsea-tests';
const ADMIN_TOKEN = 'admin-token-for-dreamsea-tests';

// 阶位门槛（测试用）：全部以 total 计，creations:0 表示不做凝结数要求
const TOTAL_ONLY_RANKS = {
  gleaner: { total: 1, creations: 0 },
  dreamwright: { total: 2, creations: 0 },
  deepdiver: { total: 3, creations: 0 },
};

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

function manifestFor(id) {
  return {
    schema: 'wr-level',
    schemaVersion: 1,
    engineApi: '1',
    id,
    name: '眠海测试梦域',
    version: '1.0.0',
    author: { name: 'dreamer' },
    description: '用于验证浮力法则与梦境考古。',
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
  };
}

function levelArchive(id) {
  return makeZip([
    { name: 'level.json', data: `${JSON.stringify(manifestFor(id))}\n` },
    { name: 'main.js', data: 'export default async function createLevel() { return {}; }\n' },
    { name: 'solution.md', data: '# 攻略\n\n沿平台前进并进入出口。\n' },
    { name: 'cover.png', data: makeCoverPng() },
  ]);
}

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
    asset: { version: '2.0', generator: 'DreamSea tests' },
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
  const dataDirectory = options.dataDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'whiteroom-dreamsea-test-'));
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
  assert.equal(response.status, 200);
  const body = await response.json();
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return { ownerId: body.ownerId, cookie };
}

async function jsonRequest(harness, pathname, method, body, cookie) {
  return fetch(`${harness.baseUrl}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function uploadLobbyAsset(harness, cookie, buffer, name = '梦物') {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'model/gltf-binary' }), 'prop.glb');
  form.append('name', name);
  form.append('category', '家具');
  return fetch(`${harness.baseUrl}/api/lobby/assets`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
}

async function uploadLevel(harness, archive, filename) {
  const form = new FormData();
  form.append('level', new Blob([archive], { type: 'application/zip' }), filename);
  return fetch(`${harness.baseUrl}/api/levels`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPLOAD_TOKEN}` },
    body: form,
  });
}

async function reviewLevel(harness, id, action, body = {}) {
  return fetch(`${harness.baseUrl}/api/admin/levels/${id}/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function claimPlot(harness, cookie, plotId, nickname, channel = '0000') {
  return jsonRequest(harness, `/api/lobby/plots/${plotId}/claim?channel=${channel}`, 'POST', { nickname }, cookie);
}

test('worldview endpoint publishes the sea laws, strata, ranks, and standard dream time', async () => {
  const now = Date.UTC(2026, 6, 18, 12, 0, 0);
  const harness = await createHarness({ clock: () => now });
  try {
    const response = await fetch(`${harness.baseUrl}/api/dreamsea/worldview`);
    assert.equal(response.status, 200);
    const worldview = await response.json();
    assert.equal(worldview.sea, '眠海');
    assert.equal(worldview.standardDreamTime, new Date(now).toISOString());
    assert.deepEqual(worldview.seaLaws.map(({ id }) => id), ['exit', 'totem', 'gravity']);
    assert.deepEqual(worldview.strata.map(({ id }) => id), ['shore', 'shallows', 'brightsea', 'abyss']);
    assert.deepEqual(
      worldview.ranks.map(({ name }) => name),
      ['初醒者', '拾梦人', '造梦师', '深潜者'],
    );
    assert.deepEqual(worldview.protocol.functions.map(({ name }) => name), ['下潜', '同步', '滤念', '归航']);
    assert.equal(worldview.etiquette.length, 3);
    assert.ok(worldview.glossary.length >= 20);
    assert.deepEqual(worldview.calamities, []);
  } finally {
    await harness.close();
  }
});

test('rank helpers expose the four-rank ladder in order', () => {
  assert.deepEqual(RANKS.map(({ id }) => id), ['awakened', 'gleaner', 'dreamwright', 'deepdiver']);
  assert.equal(rankMeetsRequirement('deepdiver', 'gleaner'), true);
  assert.equal(rankMeetsRequirement('awakened', 'dreamwright'), false);
  assert.equal(rankMeetsRequirement('unknown', 'awakened'), false);
});

test('totems condense once, stay deterministic across restarts, and blur for other dreamers', async () => {
  const harness = await createHarness();
  let reopened;
  try {
    const alice = await newIdentity(harness);
    const bob = await newIdentity(harness);

    const first = await fetch(`${harness.baseUrl}/api/dreamsea/totem`, { headers: { Cookie: alice.cookie } });
    assert.equal(first.status, 200);
    const totem = (await first.json()).totem;
    assert.equal(totem.ownerId, alice.ownerId.toLowerCase());
    assert.match(totem.sigil, /^seal-[0-9a-f]{12}$/);
    assert.ok(totem.form && totem.material && totem.motif && totem.aura);
    assert.ok(totem.description.includes(totem.form));

    const repeat = await fetch(`${harness.baseUrl}/api/dreamsea/totem`, { headers: { Cookie: alice.cookie } });
    assert.deepEqual((await repeat.json()).totem, totem);

    const bobTotem = (await (await fetch(`${harness.baseUrl}/api/dreamsea/totem`, { headers: { Cookie: bob.cookie } })).json()).totem;
    assert.notEqual(bobTotem.sigil, totem.sigil);

    // 图腾律：他人视角永远失焦，只露出凝痕
    const publicView = await fetch(`${harness.baseUrl}/api/dreamsea/totems/${alice.ownerId}`, { headers: { Cookie: bob.cookie } });
    assert.equal(publicView.status, 200);
    const blurred = (await publicView.json()).totem;
    assert.equal(blurred.sigil, totem.sigil);
    assert.equal(blurred.focus, 'blurred');
    assert.equal(blurred.form, undefined);
    assert.equal(blurred.material, undefined);

    const unknown = await fetch(`${harness.baseUrl}/api/dreamsea/totems/owner-99999999-9999-4999-8999-999999999999`, { headers: { Cookie: bob.cookie } });
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error.code, 'dreamsea_totem_not_found');

    // 未接入潜航协议（无身份 Cookie）不可触及图腾端点
    const noIdentity = await fetch(`${harness.baseUrl}/api/dreamsea/totem`);
    assert.equal(noIdentity.status, 401);
    assert.equal((await noIdentity.json()).error.code, 'lobby_identity_required');

    await harness.close({ remove: false });
    reopened = await createHarness({ dataDirectory: harness.dataDirectory });
    const persisted = await fetch(`${reopened.baseUrl}/api/dreamsea/totem`, { headers: { Cookie: alice.cookie } });
    assert.deepEqual((await persisted.json()).totem, totem);
  } finally {
    await (reopened ?? harness).close();
    await rm(harness.dataDirectory, { recursive: true, force: true });
  }
});

test('journeys accumulate activity and unlock ranks that gate the abyss', async () => {
  const harness = await createHarness({ dreamsea: { rankThresholds: TOTAL_ONLY_RANKS } });
  try {
    const alice = await newIdentity(harness);

    const fresh = (await (await fetch(`${harness.baseUrl}/api/dreamsea/journey`, { headers: { Cookie: alice.cookie } })).json()).journey;
    assert.equal(fresh.rank.id, 'awakened');
    assert.equal(fresh.totalActivity, 0);
    assert.equal(fresh.nextRank.id, 'gleaner');
    assert.equal(fresh.nextRank.requirements.total.required, 1);

    // 初醒者未达深潜者阶位：迷失域不可入
    const blocked = await fetch(`${harness.baseUrl}/api/dreamsea/abyss`, { headers: { Cookie: alice.cookie } });
    assert.equal(blocked.status, 403);
    const blockedBody = await blocked.json();
    assert.equal(blockedBody.error.code, 'dreamsea_rank_required');
    assert.equal(blockedBody.error.details.requiredRank.id, 'deepdiver');
    assert.equal(blockedBody.error.details.currentRank.id, 'awakened');

    // 投锚（认领地块）→ 拾梦人
    assert.equal((await claimPlot(harness, alice.cookie, 'plot-001', 'Alice')).status, 201);
    const afterAnchor = (await (await fetch(`${harness.baseUrl}/api/dreamsea/journey`, { headers: { Cookie: alice.cookie } })).json()).journey;
    assert.equal(afterAnchor.counts.anchors, 1);
    assert.equal(afterAnchor.rank.id, 'gleaner');

    // 凝结梦物（摆放物件）→ 造梦师
    const created = await jsonRequest(harness, '/api/lobby/objects?channel=0000', 'POST', {
      clientId: 'dreamsea-client-0001',
      catalogId: 'code-glow-cube',
      position: { x: 1, y: 0, z: -1 },
      rotationY: 0,
      scale: 1,
    }, alice.cookie);
    assert.equal(created.status, 201);
    const objectId = (await created.json()).object.id;
    const afterShape = (await (await fetch(`${harness.baseUrl}/api/dreamsea/journey`, { headers: { Cookie: alice.cookie } })).json()).journey;
    assert.equal(afterShape.counts.shapes, 1);
    assert.equal(afterShape.rank.id, 'dreamwright');

    // 触碰梦物（互动）→ 深潜者
    const interacted = await jsonRequest(harness, `/api/lobby/objects/${objectId}/interactions?channel=0000`, 'POST', {
      requestId: 'dreamsea-request-0001',
      baseSequence: 0,
    }, alice.cookie);
    assert.equal(interacted.status, 200);
    const afterInteract = (await (await fetch(`${harness.baseUrl}/api/dreamsea/journey`, { headers: { Cookie: alice.cookie } })).json()).journey;
    assert.equal(afterInteract.counts.interacts, 1);
    assert.equal(afterInteract.rank.id, 'deepdiver');
    assert.equal(afterInteract.nextRank, null);

    const allowed = await fetch(`${harness.baseUrl}/api/dreamsea/abyss`, { headers: { Cookie: alice.cookie } });
    assert.equal(allowed.status, 200);
    assert.deepEqual((await allowed.json()).domains, []);
  } finally {
    await harness.close();
  }
});

test('lineage records origins, marks echoes, and honors granted seeds', async () => {
  const harness = await createHarness({
    dreamsea: { rankThresholds: { gleaner: { total: 1 }, dreamwright: { creations: 1 }, deepdiver: { creations: 2, total: 4 } } },
  });
  try {
    const alice = await newIdentity(harness);
    const bob = await newIdentity(harness);
    const sharedModel = makeGlb({ seed: 7 });
    const sharedHash = createHash('sha256').update(sharedModel).digest('hex');

    // Alice 首凝：念脉记为原凝
    const aliceUpload = await uploadLobbyAsset(harness, alice.cookie, sharedModel, '云朵沙发');
    assert.equal(aliceUpload.status, 201);
    const aliceSigil = (await (await fetch(`${harness.baseUrl}/api/dreamsea/totem`, { headers: { Cookie: alice.cookie } })).json()).totem.sigil;

    const lineage = (await (await fetch(`${harness.baseUrl}/api/dreamsea/lineage/${sharedHash}`)).json()).lineage;
    assert.equal(lineage.kind, 'lobby-asset');
    assert.equal(lineage.origin.sigil, aliceSigil);
    assert.equal(lineage.seedCount, 0);
    assert.deepEqual(lineage.echoes, []);

    // Bob 重凝同一份字节：成为回响，凝痕处叠着原作淡影
    const bobUpload = await uploadLobbyAsset(harness, bob.cookie, sharedModel, '云朵沙发（复刻）');
    assert.equal(bobUpload.status, 201);
    const echoed = (await (await fetch(`${harness.baseUrl}/api/dreamsea/lineage/${sharedHash}`)).json()).lineage;
    assert.equal(echoed.echoes.length, 1);
    assert.equal(echoed.echoes[0].honored, false);
    const bobJourney = (await (await fetch(`${harness.baseUrl}/api/dreamsea/journey`, { headers: { Cookie: bob.cookie } })).json()).journey;
    assert.equal(bobJourney.counts.echoes, 1);
    assert.equal(bobJourney.counts.creations, 0);

    // 重复重凝同一份字节：念脉与旅程都不再增长（不可刷阶位）
    assert.equal((await uploadLobbyAsset(harness, bob.cookie, sharedModel, '云朵沙发（复刻）')).status, 200);
    const echoedAgain = (await (await fetch(`${harness.baseUrl}/api/dreamsea/lineage/${sharedHash}`)).json()).lineage;
    assert.equal(echoedAgain.echoes.length, 1);
    const bobJourneyAgain = (await (await fetch(`${harness.baseUrl}/api/dreamsea/journey`, { headers: { Cookie: bob.cookie } })).json()).journey;
    assert.equal(bobJourneyAgain.counts.echoes, 1);

    // Alice（造梦师）授出念种；重复授予 409；非原凝者授予 403
    const granted = await jsonRequest(harness, '/api/dreamsea/seeds', 'POST', {
      hash: sharedHash,
      toOwnerId: bob.ownerId,
    }, alice.cookie);
    assert.equal(granted.status, 201);
    assert.equal((await granted.json()).seed.toOwnerId, bob.ownerId.toLowerCase());

    const duplicate = await jsonRequest(harness, '/api/dreamsea/seeds', 'POST', {
      hash: sharedHash,
      toOwnerId: bob.ownerId,
    }, alice.cookie);
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error.code, 'dreamsea_seed_exists');

    // Bob 先获得造梦师阶位（自凝一件新物），再试图授出他人作品的念种
    assert.equal((await uploadLobbyAsset(harness, bob.cookie, makeGlb({ seed: 11 }), '异质台灯')).status, 201);
    const bobGrant = await jsonRequest(harness, '/api/dreamsea/seeds', 'POST', {
      hash: sharedHash,
      toOwnerId: alice.ownerId,
    }, bob.cookie);
    assert.equal(bobGrant.status, 403);
    assert.equal((await bobGrant.json()).error.code, 'dreamsea_not_origin');

    // 授种后，Bob 的既有回响被追认为承种
    const honored = (await (await fetch(`${harness.baseUrl}/api/dreamsea/lineage/${sharedHash}`)).json()).lineage;
    assert.equal(honored.seedCount, 1);
    assert.equal(honored.echoes[0].honored, true);

    // 念种只能授给已凝成图腾的潜航者
    const unknownRecipient = await jsonRequest(harness, '/api/dreamsea/seeds', 'POST', {
      hash: sharedHash,
      toOwnerId: 'owner-88888888-8888-4888-8888-888888888888',
    }, alice.cookie);
    assert.equal(unknownRecipient.status, 404);
    assert.equal((await unknownRecipient.json()).error.code, 'dreamsea_dreamer_unknown');

    // 持种者的后续重凝在凝结当刻即记为承种
    const carol = await newIdentity(harness);
    assert.equal((await fetch(`${harness.baseUrl}/api/dreamsea/totem`, { headers: { Cookie: carol.cookie } })).status, 200);
    assert.equal((await jsonRequest(harness, '/api/dreamsea/seeds', 'POST', {
      hash: sharedHash,
      toOwnerId: carol.ownerId,
    }, alice.cookie)).status, 201);
    assert.equal((await uploadLobbyAsset(harness, carol.cookie, sharedModel, '云朵沙发（承种版）')).status, 201);
    const honoredAtCreation = (await (await fetch(`${harness.baseUrl}/api/dreamsea/lineage/${sharedHash}`)).json()).lineage;
    assert.equal(honoredAtCreation.echoes.length, 2);
    assert.equal(honoredAtCreation.echoes[1].honored, true);

    const seedJourneys = await Promise.all([alice, bob].map(async ({ cookie }) => (
      (await (await fetch(`${harness.baseUrl}/api/dreamsea/journey`, { headers: { Cookie: cookie } })).json()).journey
    )));
    assert.equal(seedJourneys[0].counts.seedsGranted, 2);
    assert.equal(seedJourneys[1].counts.seedsReceived, 1);

    const missing = await fetch(`${harness.baseUrl}/api/dreamsea/lineage/${'0'.repeat(64)}`);
    assert.equal(missing.status, 404);

    const badHash = await fetch(`${harness.baseUrl}/api/dreamsea/lineage/not-a-hash`);
    assert.equal(badHash.status, 422);
    assert.equal((await badHash.json()).error.lore, GRAVITY_LAW_LORE);
  } finally {
    await harness.close();
  }
});

test('buoyancy law sinks unvisited dream domains and deep divers salvage them back', async () => {
  let now = Date.UTC(2026, 6, 18, 8, 0, 0);
  const sinkAfterMs = 60_000;
  const harness = await createHarness({
    clock: () => now,
    dreamsea: { sinkAfterMs, rankThresholds: TOTAL_ONLY_RANKS },
  });
  const levelId = 'sunken-palace-a1b2c3';
  try {
    const diver = await newIdentity(harness);
    assert.equal((await uploadLevel(harness, levelArchive(levelId), 'sunken-palace.wrlevel')).status, 201);
    assert.equal((await reviewLevel(harness, levelId, 'approve')).status, 200);

    const floating = await (await fetch(`${harness.baseUrl}/registry.json`)).json();
    assert.deepEqual(floating.levels.map(({ id }) => id), [levelId]);

    // 下潜打点续浮力
    const dive = await jsonRequest(harness, '/api/dreamsea/dive', 'POST', { levelId }, diver.cookie);
    assert.equal(dive.status, 200);
    assert.equal((await dive.json()).levelId, levelId);

    // 久无人至：超过下沉时限后巡查，梦域没入迷失域
    now += sinkAfterMs + 1;
    const patrol = await fetch(`${harness.baseUrl}/api/admin/dreamsea/sink-patrol`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(patrol.status, 200);
    const patrolBody = (await patrol.json()).patrol;
    assert.equal(patrolBody.changed, true);
    assert.deepEqual(patrolBody.sunken, [levelId]);

    const sunkenRegistry = await (await fetch(`${harness.baseUrl}/registry.json`)).json();
    assert.deepEqual(sunkenRegistry.levels, []);
    const registryOnDisk = JSON.parse(await readFile(path.join(harness.dataDirectory, 'registry.json'), 'utf8'));
    assert.deepEqual(registryOnDisk.levels, []);

    // 审核状态不变（沉没≠删除），但沉没梦域不可下潜
    const status = await (await fetch(`${harness.baseUrl}/api/levels/${levelId}/status`)).json();
    assert.equal(status.status, 'approved');
    const sunkenDive = await jsonRequest(harness, '/api/dreamsea/dive', 'POST', { levelId }, diver.cookie);
    assert.equal(sunkenDive.status, 409);
    assert.equal((await sunkenDive.json()).error.code, 'dreamsea_level_sunken');

    // 深潜者巡视迷失域并打捞
    for (let index = 0; index < 3; index += 1) {
      assert.equal((await claimPlot(harness, diver.cookie, `plot-00${index + 1}`, 'Diver')).status, 201);
    }
    const abyss = await fetch(`${harness.baseUrl}/api/dreamsea/abyss`, { headers: { Cookie: diver.cookie } });
    assert.equal(abyss.status, 200);
    const domains = (await abyss.json()).domains;
    assert.equal(domains.length, 1);
    assert.equal(domains[0].levelId, levelId);
    assert.equal(domains[0].name, '眠海测试梦域');

    const salvage = await jsonRequest(harness, `/api/dreamsea/abyss/${levelId}/salvage`, 'POST', {}, diver.cookie);
    assert.equal(salvage.status, 200);
    assert.equal((await salvage.json()).salvage.levelId, levelId);

    const refloated = await (await fetch(`${harness.baseUrl}/registry.json`)).json();
    assert.deepEqual(refloated.levels.map(({ id }) => id), [levelId]);
    assert.deepEqual((await (await fetch(`${harness.baseUrl}/api/dreamsea/abyss`, { headers: { Cookie: diver.cookie } })).json()).domains, []);

    // 仍漂浮的梦域不可打捞
    const notSunken = await jsonRequest(harness, `/api/dreamsea/abyss/${levelId}/salvage`, 'POST', {}, diver.cookie);
    assert.equal(notSunken.status, 409);
    assert.equal((await notSunken.json()).error.code, 'dreamsea_not_sunken');

    // 浮力状态在重启后保持：磁盘上的 buoyancy.json 必须真实记录打捞
    await harness.close({ remove: false });
    const buoyancyOnDisk = JSON.parse(
      await readFile(path.join(harness.dataDirectory, 'dreamsea', 'buoyancy.json'), 'utf8'),
    );
    assert.equal(buoyancyOnDisk.levels[levelId].salvages, 1);
    assert.equal(buoyancyOnDisk.levels[levelId].lastVisitedAt, now);
    const reopened = await createHarness({
      dataDirectory: harness.dataDirectory,
      clock: () => now,
      dreamsea: { sinkAfterMs, rankThresholds: TOTAL_ONLY_RANKS },
    });
    try {
      const persisted = await (await fetch(`${reopened.baseUrl}/registry.json`)).json();
      assert.deepEqual(persisted.levels.map(({ id }) => id), [levelId]);
    } finally {
      await reopened.close({ remove: false });
    }
  } finally {
    await rm(harness.dataDirectory, { recursive: true, force: true });
  }
});

test('a graceful shutdown flushes buoyancy updates still inside the debounce window', async () => {
  let now = Date.UTC(2026, 6, 19, 8, 0, 0);
  const harness = await createHarness({
    clock: () => now,
    dreamsea: { sinkAfterMs: 60_000 },
  });
  const levelId = 'flush-harbor-b2c3d4';
  try {
    const diver = await newIdentity(harness);
    assert.equal((await uploadLevel(harness, levelArchive(levelId), 'flush-harbor.wrlevel')).status, 201);
    assert.equal((await reviewLevel(harness, levelId, 'approve')).status, 200);

    now += 30_000;
    assert.equal((await jsonRequest(harness, '/api/dreamsea/dive', 'POST', { levelId }, diver.cookie)).status, 200);
    // 立即关停：2 秒防抖窗口尚未到期，close() 必须补一次落盘（异步完成，轮询等待）
    await harness.close({ remove: false });
    const buoyancyPath = path.join(harness.dataDirectory, 'dreamsea', 'buoyancy.json');
    const deadline = Date.now() + 3_000;
    let buoyancy = null;
    do {
      await new Promise((resolve) => setTimeout(resolve, 50));
      try {
        buoyancy = JSON.parse(await readFile(buoyancyPath, 'utf8'));
      } catch {
        buoyancy = null;
      }
    } while (buoyancy?.levels?.[levelId]?.lastVisitedAt !== now && Date.now() < deadline);
    assert.equal(buoyancy.levels[levelId].lastVisitedAt, now);
    assert.equal(buoyancy.levels[levelId].visits >= 1, true);
  } finally {
    await rm(harness.dataDirectory, { recursive: true, force: true });
  }
});

test('the sink patrol interval retires unvisited domains without an admin nudge', async () => {
  let now = Date.UTC(2026, 6, 19, 9, 0, 0);
  const harness = await createHarness({
    clock: () => now,
    dreamsea: { sinkAfterMs: 1_000, sinkPatrolMs: 1_000 },
  });
  const levelId = 'patrol-reef-d4e5f6';
  try {
    assert.equal((await uploadLevel(harness, levelArchive(levelId), 'patrol-reef.wrlevel')).status, 201);
    assert.equal((await reviewLevel(harness, levelId, 'approve')).status, 200);
    assert.deepEqual(
      (await (await fetch(`${harness.baseUrl}/registry.json`)).json()).levels.map(({ id }) => id),
      [levelId],
    );

    now += 1_001;
    const deadline = Date.now() + 5_000;
    let levels;
    do {
      await new Promise((resolve) => setTimeout(resolve, 200));
      levels = (await (await fetch(`${harness.baseUrl}/registry.json`)).json()).levels;
    } while (levels.length > 0 && Date.now() < deadline);
    assert.deepEqual(levels, []);
  } finally {
    await harness.close();
  }
});

test('the gravity law narrates rejections and validation refusals', async () => {
  const harness = await createHarness();
  const levelId = 'heavy-thing-c0ffee';
  try {
    assert.equal((await uploadLevel(harness, levelArchive(levelId), 'heavy-thing.wrlevel')).status, 201);
    const rejected = await reviewLevel(harness, levelId, 'reject', { reason: '过于沉重。' });
    assert.equal(rejected.status, 200);
    const rejectedBody = await rejected.json();
    assert.equal(rejectedBody.status, 'rejected');
    assert.equal(rejectedBody.reason, '过于沉重。');
    assert.equal(rejectedBody.lore, GRAVITY_LAW_LORE);

    const status = await (await fetch(`${harness.baseUrl}/api/levels/${levelId}/status`)).json();
    assert.equal(status.lore, GRAVITY_LAW_LORE);

    const badType = await uploadLevel(harness, Buffer.from('not a zip'), 'not-a-level.txt');
    assert.equal(badType.status, 415);
    assert.equal((await badType.json()).error.lore, GRAVITY_LAW_LORE);
  } finally {
    await harness.close();
  }
});

test('administrators declare dream calamities that rage and then dissipate', async () => {
  let now = Date.UTC(2026, 6, 18, 20, 0, 0);
  const harness = await createHarness({ clock: () => now });
  try {
    const unauthorized = await fetch(`${harness.baseUrl}/api/admin/dreamsea/calamities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '梦灾' }),
    });
    assert.equal(unauthorized.status, 401);

    const declared = await fetch(`${harness.baseUrl}/api/admin/dreamsea/calamities`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '滤念过载：低语潮',
        note: '成片域理紊乱，投影暴走，请勿单独下潜。',
        channel: '0000',
        durationMs: 60 * 60_000,
      }),
    });
    assert.equal(declared.status, 201);
    const calamity = (await declared.json()).calamity;
    assert.match(calamity.id, /^calamity-[0-9a-f]{12}$/);
    assert.equal(calamity.endsAt, new Date(now + 60 * 60_000).toISOString());

    const active = await (await fetch(`${harness.baseUrl}/api/dreamsea/worldview`)).json();
    assert.deepEqual(active.calamities.map(({ id }) => id), [calamity.id]);

    // 梦灾无法预告，只能响应；到期自然消散
    now += 60 * 60_000 + 1;
    const dissipated = await (await fetch(`${harness.baseUrl}/api/dreamsea/worldview`)).json();
    assert.deepEqual(dissipated.calamities, []);

    const badDuration = await fetch(`${harness.baseUrl}/api/admin/dreamsea/calamities`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '短梦灾', durationMs: 100 }),
    });
    assert.equal(badDuration.status, 422);
    assert.equal((await badDuration.json()).error.code, 'invalid_calamity_duration');

    const badTitle = await fetch(`${harness.baseUrl}/api/admin/dreamsea/calamities`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    });
    assert.equal(badTitle.status, 422);

    const badChannel = await fetch(`${harness.baseUrl}/api/admin/dreamsea/calamities`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '域理紊乱', channel: ['0000'] }),
    });
    assert.equal(badChannel.status, 422);
    assert.equal((await badChannel.json()).error.code, 'invalid_calamity_channel');
  } finally {
    await harness.close();
  }
});
