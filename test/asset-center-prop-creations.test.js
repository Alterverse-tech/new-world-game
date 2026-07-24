import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AssetCenterPropCreationService } from '../src/asset-center-prop-creations.js';
import { HttpError } from '../src/errors.js';

const OWNER_A = 'owner-11111111-1111-4111-8111-111111111111';
const OWNER_B = 'owner-22222222-2222-4222-8222-222222222222';
const JOB_ID = 'propjob-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GENERATION_ID = 'acj_generation_123';
const REMOTE_ASSET_ID = 'ast_asset_123';
const SERVICE_TOKEN = `acs_live_test_${'s'.repeat(40)}`;
const SIGNED_URL = 'https://downloads.example.test/model.glb?X-Amz-Signature=secret-signature';

class FakeLobbyAssetStore {
  constructor() {
    this.created = [];
    this.assets = new Map();
  }

  async create(input) {
    this.created.push(input);
    const id = `user-glb-${'a'.repeat(32)}`;
    this.assets.set(id, {
      id,
      name: input.name,
      category: input.category,
      kind: 'glb',
      assetUrl: `/lobby-assets/${id}/model.glb`,
      defaultScale: input.defaultScale,
    });
    return { record: { id }, deduplicated: false };
  }

  get(id) {
    return this.assets.get(id) ?? null;
  }
}

async function withTemporaryDirectory(action) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-asset-center-props-'));
  try {
    return await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function serviceOptions(dataDirectory, client, lobbyAssetStore, overrides = {}) {
  return {
    dataDirectory,
    client,
    lobbyAssetStore,
    idFactory: () => JOB_ID,
    ...overrides,
  };
}

test('uses the authenticated owner for every Asset Center call and publishes the imported GLB', async () => {
  await withTemporaryDirectory(async (dataDirectory) => {
    const calls = [];
    const glb = Buffer.from('glTF-test-model');
    const client = {
      serviceToken: SERVICE_TOKEN,
      async createGeneration(input) {
        calls.push(['createGeneration', input]);
        return {
          id: GENERATION_ID,
          status: 'succeeded',
          stage: 'completed',
          progress: 100,
          asset: { id: REMOTE_ASSET_ID, displayName: '蓝色能量水晶' },
        };
      },
      async getDownloadTarget(input) {
        calls.push(['getDownloadTarget', input]);
        return { url: SIGNED_URL };
      },
      async downloadGlb(input) {
        calls.push(['downloadGlb', input]);
        return { buffer: glb };
      },
    };
    const lobbyAssetStore = new FakeLobbyAssetStore();
    const registeredCatalogIds = [];
    const service = new AssetCenterPropCreationService(
      serviceOptions(dataDirectory, client, lobbyAssetStore, {
        registerCatalogId: (id) => registeredCatalogIds.push(id),
      }),
    );
    await service.initialize();

    const job = await service.create({
      ownerId: OWNER_A,
      prompt: '一个低多边形风格的蓝色能量水晶',
      channel: '0000',
      ip: '203.0.113.7',
    });

    assert.equal(job.status, 'published');
    assert.equal(job.stage.code, 'published');
    assert.equal(job.progress, 100);
    assert.equal(job.asset.id, `user-glb-${'a'.repeat(32)}`);
    assert.deepEqual(
      calls.filter(([name]) => name !== 'downloadGlb').map(([, input]) => input.externalUserId),
      [OWNER_A, OWNER_A],
    );
    assert.equal(calls.find(([name]) => name === 'createGeneration')[1].idempotencyKey, `wr_${JOB_ID.slice(8)}`);
    assert.equal(calls.find(([name]) => name === 'downloadGlb')[1].url, SIGNED_URL);
    assert.equal(lobbyAssetStore.created.length, 1);
    assert.equal(lobbyAssetStore.created[0].ownerId, OWNER_A);
    assert.deepEqual(lobbyAssetStore.created[0].buffer, glb);
    assert.deepEqual(registeredCatalogIds, [job.asset.id]);

    assert.equal(await service.get(JOB_ID, OWNER_B), null);
    assert.equal(await service.getStored(JOB_ID, OWNER_B), null);
    assert.deepEqual(await service.listOwner(OWNER_B), []);

    const recordText = await readFile(
      path.join(dataDirectory, 'asset-center-prop-creations', 'records', `${JOB_ID}.json`),
      'utf8',
    );
    assert.equal(recordText.includes(SERVICE_TOKEN), false);
    assert.equal(recordText.includes(SIGNED_URL), false);
    assert.equal(recordText.includes('X-Amz-Signature'), false);
    const stored = JSON.parse(recordText);
    assert.equal(stored.status, 'published');
    assert.deepEqual(stored.asset, job.asset);
  });
});

test('persists one idempotency key across a 429 and a service restart', async () => {
  await withTemporaryDirectory(async (dataDirectory) => {
    let now = Date.parse('2026-07-24T08:00:00.000Z');
    const firstCalls = [];
    const firstClient = {
      serviceToken: SERVICE_TOKEN,
      async createGeneration(input) {
        firstCalls.push(input);
        throw { status: 429, retryable: true, retryAfterMs: 1_000 };
      },
    };
    const firstService = new AssetCenterPropCreationService(serviceOptions(
      dataDirectory,
      firstClient,
      new FakeLobbyAssetStore(),
      { clock: () => now },
    ));
    await firstService.initialize();

    const queued = await firstService.create({
      ownerId: OWNER_A,
      prompt: '一辆可驾驶的低多边形红色小汽车',
      channel: '0000',
      ip: '203.0.113.8',
    });
    assert.equal(queued.status, 'queued');
    assert.equal(firstCalls.length, 1);
    assert.equal(firstCalls[0].externalUserId, OWNER_A);
    const originalKey = firstCalls[0].idempotencyKey;

    now += 1_001;
    const retryCalls = [];
    const restartedService = new AssetCenterPropCreationService(serviceOptions(
      dataDirectory,
      {
        serviceToken: SERVICE_TOKEN,
        async createGeneration(input) {
          retryCalls.push(input);
          return { id: GENERATION_ID, status: 'queued', stage: 'queued', progress: 0 };
        },
        async getGeneration(input) {
          retryCalls.push(input);
          return {
            id: GENERATION_ID,
            status: 'processing',
            stage: 'model_generation',
            progress: 62,
          };
        },
      },
      new FakeLobbyAssetStore(),
      { clock: () => now },
    ));
    await restartedService.initialize();

    const retried = await restartedService.get(JOB_ID, OWNER_A);
    assert.equal(retried.status, 'running');
    assert.equal(retryCalls.length, 1);
    assert.equal(retryCalls[0].externalUserId, OWNER_A);
    assert.equal(retryCalls[0].idempotencyKey, originalKey);

    const processing = await restartedService.get(JOB_ID, OWNER_A);
    assert.equal(processing.status, 'running');
    assert.equal(processing.progress, 62);
    assert.equal(processing.stage.code, 'generating');
    assert.equal(retryCalls[1].externalUserId, OWNER_A);

    const recordText = await readFile(
      path.join(dataDirectory, 'asset-center-prop-creations', 'records', `${JOB_ID}.json`),
      'utf8',
    );
    const stored = JSON.parse(recordText);
    assert.equal(stored.idempotencyKey, originalKey);
    assert.equal(stored.remoteGenerationId, GENERATION_ID);
    assert.equal(recordText.includes(SERVICE_TOKEN), false);
    assert.equal(recordText.includes('http'), false);
  });
});

test('retries local import after the owner frees Lobby asset capacity without regenerating', async () => {
  await withTemporaryDirectory(async (dataDirectory) => {
    let now = Date.parse('2026-07-24T09:00:00.000Z');
    let generationCreates = 0;
    const glb = Buffer.from('glTF-test-model');
    const remoteAsset = { id: REMOTE_ASSET_ID, displayName: '发光植物' };
    const client = {
      async createGeneration() {
        generationCreates += 1;
        return {
          id: GENERATION_ID,
          status: 'succeeded',
          stage: 'completed',
          progress: 100,
          asset: remoteAsset,
        };
      },
      async getGeneration() {
        return {
          id: GENERATION_ID,
          status: 'succeeded',
          stage: 'completed',
          progress: 100,
          asset: remoteAsset,
        };
      },
      async getDownloadTarget() {
        return { url: SIGNED_URL };
      },
      async downloadGlb() {
        return { buffer: glb };
      },
    };
    const lobbyAssetStore = new FakeLobbyAssetStore();
    const createAsset = lobbyAssetStore.create.bind(lobbyAssetStore);
    let importAttempts = 0;
    lobbyAssetStore.create = async (input) => {
      importAttempts += 1;
      if (importAttempts === 1) {
        throw new HttpError(507, 'lobby_asset_owner_capacity_reached', 'Owner asset capacity reached');
      }
      return createAsset(input);
    };
    const service = new AssetCenterPropCreationService(serviceOptions(
      dataDirectory,
      client,
      lobbyAssetStore,
      { clock: () => now },
    ));
    await service.initialize();

    const waiting = await service.create({
      ownerId: OWNER_A,
      prompt: '一个低多边形风格的蓝色发光植物',
      channel: '0000',
      ip: '203.0.113.9',
    });
    assert.equal(waiting.status, 'running');
    assert.match(waiting.stage.message, /空间已满/);

    now += 60_001;
    const published = await service.get(JOB_ID, OWNER_A);
    assert.equal(published.status, 'published');
    assert.equal(importAttempts, 2);
    assert.equal(generationCreates, 1);
  });
});
