import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './errors.js';
import {
  MAX_PROP_PROMPT_CHARACTERS,
  PROP_CREATION_ID_PATTERN,
  validatePropCreationPrompt,
} from './prop-creation.js';
import { MAX_LOBBY_ASSET_BYTES } from './lobby-assets.js';
import { atomicWriteJson } from './store.js';

const OWNER_ID_PATTERN = /^owner-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REMOTE_GENERATION_ID_PATTERN = /^acj_[A-Za-z0-9_-]{8,128}$/;
const REMOTE_ASSET_ID_PATTERN = /^ast_[A-Za-z0-9_-]{8,128}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const CHANNEL_PATTERN = /^\d{4,12}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const TERMINAL_STATUSES = new Set(['published', 'failed', 'cancelled']);
const PUBLIC_STATUSES = new Set(['queued', 'running', 'published', 'failed', 'cancelled']);
const MAX_OWNER_JOBS_RETURNED = 25;
const MIN_ASSET_CENTER_PROMPT_CHARACTERS = 8;

const STAGE_COPY = Object.freeze({
  queued: ['queued', '已进入 Asset Center 生成队列'],
  planning: ['preparing', '正在理解物件描述'],
  reference_image: ['generating', '正在生成物件参考图'],
  model_generation: ['generating', '正在生成 3D 模型'],
  validating: ['validating', '正在校验 GLB 模型'],
  uploading: ['uploading', '正在发布生成结果'],
  completed: ['published', '已加入“我的物件”'],
  failed: ['failed', '资产生成失败'],
});

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function normalizeText(value, maximumCharacters) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (!normalized || [...normalized].length > maximumCharacters || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function compactName(value, fallback) {
  const normalized = normalizeText(value, 80) ?? normalizeText(fallback, MAX_PROP_PROMPT_CHARACTERS) ?? 'AI 生成物件';
  return [...normalized].slice(0, 40).join('').trim() || 'AI 生成物件';
}

function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validPublicAsset(asset) {
  return Boolean(
    asset
    && typeof asset === 'object'
    && typeof asset.id === 'string'
    && typeof asset.name === 'string'
    && typeof asset.category === 'string'
    && asset.kind === 'glb'
    && typeof asset.assetUrl === 'string'
    && typeof asset.defaultScale === 'number',
  );
}

function validRecord(record, expectedId = undefined) {
  return Boolean(
    record
    && typeof record === 'object'
    && record.schemaVersion === 1
    && PROP_CREATION_ID_PATTERN.test(record.id ?? '')
    && (!expectedId || record.id === expectedId)
    && OWNER_ID_PATTERN.test(record.ownerId ?? '')
    && typeof record.prompt === 'string'
    && [...record.prompt].length >= MIN_ASSET_CENTER_PROMPT_CHARACTERS
    && [...record.prompt].length <= MAX_PROP_PROMPT_CHARACTERS
    && CHANNEL_PATTERN.test(record.channel ?? '')
    && PUBLIC_STATUSES.has(record.status)
    && record.stage
    && typeof record.stage.code === 'string'
    && typeof record.stage.message === 'string'
    && validIso(record.stage.updatedAt)
    && validIso(record.submittedAt)
    && validIso(record.updatedAt)
    && IDEMPOTENCY_KEY_PATTERN.test(record.idempotencyKey ?? '')
    && HASH_PATTERN.test(record.ipHash ?? '')
    && (record.remoteGenerationId === undefined || REMOTE_GENERATION_ID_PATTERN.test(record.remoteGenerationId))
    && (record.remoteAssetId === undefined || REMOTE_ASSET_ID_PATTERN.test(record.remoteAssetId))
    && (record.remoteSha256 === undefined || HASH_PATTERN.test(record.remoteSha256))
    && (record.asset === undefined || validPublicAsset(record.asset))
    && (record.failure === undefined || normalizeText(record.failure?.message, 500) === record.failure.message)
    && (record.nextRetryAt === undefined || validIso(record.nextRetryAt))
  );
}

function safeRemoteFailure(error) {
  if (error instanceof HttpError) {
    if (error.status === 507) return '“我的物件”空间已满，请删除部分物件后重试';
    return '生成模型未通过 WhiteRoom 安全校验，请调整描述后重试';
  }
  if (error?.status === 401 || error?.status === 403) {
    return '资产生成服务认证失败，请联系管理员';
  }
  if (error?.status === 400 || error?.status === 409) {
    return '资产生成请求未被接受，请修改描述后重试';
  }
  return '资产生成服务暂时不可用，请稍后重试';
}

function retryDelay(error) {
  if (error instanceof HttpError && error.status === 507) return 60_000;
  const supplied = Number(error?.retryAfterMs);
  return Number.isSafeInteger(supplied) && supplied > 0
    ? Math.min(supplied, 60_000)
    : 5_000;
}

function isRetryable(error) {
  if (error instanceof HttpError) return error.status === 507;
  if (
    error?.code === 'asset_center_download_failed'
    && (error.status === 401 || error.status === 403 || error.status === 404)
  ) return true;
  return error?.retryable === true || error?.status === 429 || error?.status >= 500;
}

function publicStage(stage, clock) {
  const [code, message] = STAGE_COPY[stage] ?? STAGE_COPY.queued;
  return { code, message, updatedAt: nowIso(clock) };
}

function ownerView(record) {
  return {
    id: record.id,
    prompt: record.prompt,
    channel: record.channel,
    status: record.status,
    stage: record.stage,
    submittedAt: record.submittedAt,
    updatedAt: record.updatedAt,
    ...(Number.isFinite(record.progress) ? { progress: record.progress } : {}),
    ...(record.asset ? { asset: record.asset } : {}),
    ...(record.failure ? { failure: { message: record.failure.message } } : {}),
  };
}

export class AssetCenterPropCreationService {
  constructor({
    dataDirectory,
    client,
    lobbyAssetStore,
    registerCatalogId = () => {},
    clock = Date.now,
    idFactory = () => `propjob-${randomUUID()}`,
    maxActivePerOwner = 2,
    maxDailyPerOwner = 3,
    maxDailyPerIp = 12,
  } = {}) {
    if (
      !dataDirectory
      || !client
      || !lobbyAssetStore
      || typeof registerCatalogId !== 'function'
      || typeof clock !== 'function'
      || typeof idFactory !== 'function'
      || ![maxActivePerOwner, maxDailyPerOwner, maxDailyPerIp]
        .every((value) => Number.isSafeInteger(value) && value > 0)
    ) {
      throw new Error('Asset Center prop creation settings are invalid');
    }
    this.root = path.join(path.resolve(dataDirectory), 'asset-center-prop-creations');
    this.recordsDirectory = path.join(this.root, 'records');
    this.client = client;
    this.lobbyAssetStore = lobbyAssetStore;
    this.registerCatalogId = registerCatalogId;
    this.clock = clock;
    this.idFactory = idFactory;
    this.maxActivePerOwner = maxActivePerOwner;
    this.maxDailyPerOwner = maxDailyPerOwner;
    this.maxDailyPerIp = maxDailyPerIp;
    this.createQueue = Promise.resolve();
    this.jobQueues = new Map();
    this.lastSuccessfulRequestAt = 0;
  }

  async initialize() {
    await mkdir(this.recordsDirectory, { recursive: true, mode: 0o750 });
    for (const name of (await readdir(this.recordsDirectory)).filter((entry) => entry.endsWith('.json'))) {
      const id = name.slice(0, -5);
      const record = JSON.parse(await readFile(path.join(this.recordsDirectory, name), 'utf8'));
      if (!validRecord(record, id)) throw new Error(`Invalid Asset Center prop creation record: ${name}`);
    }
  }

  get enabled() {
    return true;
  }

  workerStatus() {
    return {
      online: true,
      lastSeenAt: this.lastSuccessfulRequestAt
        ? new Date(this.lastSuccessfulRequestAt).toISOString()
        : null,
    };
  }

  recordPath(id) {
    if (!PROP_CREATION_ID_PATTERN.test(id ?? '')) {
      throw new HttpError(404, 'prop_creation_not_found', 'Prop creation was not found');
    }
    return path.join(this.recordsDirectory, `${id}.json`);
  }

  async read(id) {
    try {
      const record = JSON.parse(await readFile(this.recordPath(id), 'utf8'));
      if (!validRecord(record, id)) throw new Error(`Invalid Asset Center prop creation record: ${id}`);
      return record;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async list() {
    const records = [];
    for (const name of (await readdir(this.recordsDirectory)).filter((entry) => entry.endsWith('.json')).sort()) {
      const record = JSON.parse(await readFile(path.join(this.recordsDirectory, name), 'utf8'));
      if (!validRecord(record)) throw new Error(`Invalid Asset Center prop creation record: ${name}`);
      records.push(record);
    }
    return records;
  }

  async write(record) {
    if (!validRecord(record, record?.id)) throw new Error('Refusing to store an invalid Asset Center prop creation record');
    await atomicWriteJson(this.recordPath(record.id), record, 0o640);
    return record;
  }

  runForJob(id, action) {
    const previous = this.jobQueues.get(id) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(action);
    const tracked = run.finally(() => {
      if (this.jobQueues.get(id) === tracked) this.jobQueues.delete(id);
    });
    this.jobQueues.set(id, tracked);
    return run;
  }

  async create({ ownerId, prompt, channel, ip }) {
    if (!OWNER_ID_PATTERN.test(ownerId ?? '')) {
      throw new HttpError(401, 'account_session_required', 'A signed-in email account is required');
    }
    if (!CHANNEL_PATTERN.test(channel ?? '')) {
      throw new HttpError(422, 'invalid_lobby_channel', 'Lobby channel is invalid');
    }
    const cleanPrompt = validatePropCreationPrompt(prompt);
    if ([...cleanPrompt].length < MIN_ASSET_CENTER_PROMPT_CHARACTERS) {
      throw new HttpError(
        422,
        'invalid_prop_prompt',
        `Describe the prop using ${MIN_ASSET_CENTER_PROMPT_CHARACTERS}-${MAX_PROP_PROMPT_CHARACTERS} characters`,
      );
    }
    const operation = this.createQueue.then(async () => {
      const records = await this.list();
      const active = records.filter((record) => record.ownerId === ownerId && !TERMINAL_STATUSES.has(record.status));
      if (active.length >= this.maxActivePerOwner) {
        throw new HttpError(429, 'prop_creation_limit_reached', 'Finish an existing creation before submitting another');
      }
      const since = this.clock() - 24 * 60 * 60 * 1000;
      const recent = records.filter((record) => Date.parse(record.submittedAt) >= since);
      if (recent.filter((record) => record.ownerId === ownerId).length >= this.maxDailyPerOwner) {
        throw new HttpError(429, 'prop_creation_rate_limited', 'Daily prop creation limit reached');
      }
      const ipHash = createHash('sha256').update(`asset-center-prop\0${String(ip ?? '')}`).digest('hex');
      if (recent.filter((record) => record.ipHash === ipHash).length >= this.maxDailyPerIp) {
        throw new HttpError(429, 'prop_creation_rate_limited', 'Too many prop creations were submitted from this network');
      }
      const id = this.idFactory();
      if (!PROP_CREATION_ID_PATTERN.test(id ?? '')) throw new Error('Asset Center prop creation ID factory returned an invalid ID');
      if (await this.read(id)) throw new HttpError(409, 'prop_creation_id_conflict', 'Prop creation ID conflict');
      const at = nowIso(this.clock);
      return this.write({
        schemaVersion: 1,
        id,
        ownerId,
        prompt: cleanPrompt,
        channel,
        status: 'queued',
        stage: { code: 'queued', message: '正在连接 Asset Center', updatedAt: at },
        progress: 0,
        submittedAt: at,
        updatedAt: at,
        idempotencyKey: `wr_${id.slice('propjob-'.length)}`,
        ipHash,
      });
    });
    this.createQueue = operation.catch(() => {});
    const created = await operation;
    const synced = await this.sync(created.id);
    return ownerView(synced);
  }

  async listOwner(ownerId) {
    if (!OWNER_ID_PATTERN.test(ownerId ?? '')) return [];
    const owned = (await this.list())
      .filter((record) => record.ownerId === ownerId)
      .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
    const synchronized = await Promise.all(owned.map((record) => (
      TERMINAL_STATUSES.has(record.status) ? record : this.sync(record.id)
    )));
    return synchronized.slice(0, MAX_OWNER_JOBS_RETURNED).map(ownerView);
  }

  async get(id, ownerId) {
    if (!PROP_CREATION_ID_PATTERN.test(id ?? '') || !OWNER_ID_PATTERN.test(ownerId ?? '')) return null;
    const record = await this.read(id);
    if (!record || record.ownerId !== ownerId) return null;
    return ownerView(TERMINAL_STATUSES.has(record.status) ? record : await this.sync(id));
  }

  async getStored(id, ownerId) {
    if (!PROP_CREATION_ID_PATTERN.test(id ?? '') || !OWNER_ID_PATTERN.test(ownerId ?? '')) return null;
    const record = await this.read(id);
    return record?.ownerId === ownerId ? ownerView(record) : null;
  }

  async cancel(id, ownerId) {
    return this.runForJob(id, async () => {
      const record = await this.read(id);
      if (!record || record.ownerId !== ownerId) {
        throw new HttpError(404, 'prop_creation_not_found', 'Prop creation was not found');
      }
      if (record.status !== 'queued' || record.remoteGenerationId) {
        throw new HttpError(409, 'prop_creation_cannot_cancel', 'Asset Center has already accepted this creation');
      }
      const at = nowIso(this.clock);
      const updated = await this.write({
        ...record,
        status: 'cancelled',
        stage: { code: 'cancelled', message: '任务已取消', updatedAt: at },
        updatedAt: at,
      });
      return ownerView(updated);
    });
  }

  async sync(id) {
    return this.runForJob(id, async () => {
      let record = await this.read(id);
      if (!record) throw new HttpError(404, 'prop_creation_not_found', 'Prop creation was not found');
      if (TERMINAL_STATUSES.has(record.status)) return record;
      if (record.nextRetryAt && Date.parse(record.nextRetryAt) > this.clock()) return record;

      try {
        let generation;
        if (!record.remoteGenerationId) {
          generation = await this.client.createGeneration({
            externalUserId: record.ownerId,
            prompt: record.prompt,
            displayName: compactName(record.prompt, 'AI 生成物件'),
            idempotencyKey: record.idempotencyKey,
          });
          this.lastSuccessfulRequestAt = this.clock();
          if (!REMOTE_GENERATION_ID_PATTERN.test(generation?.id ?? '')) {
            throw new Error('Asset Center returned an invalid generation ID');
          }
          record = await this.write({
            ...record,
            remoteGenerationId: generation.id,
            updatedAt: nowIso(this.clock),
            nextRetryAt: undefined,
          });
        } else {
          generation = await this.client.getGeneration({
            externalUserId: record.ownerId,
            generationId: record.remoteGenerationId,
          });
          this.lastSuccessfulRequestAt = this.clock();
        }
        return await this.applyGeneration(record, generation);
      } catch (error) {
        return this.handleSyncError(record, error);
      }
    });
  }

  async applyGeneration(record, generation) {
    if (!generation || generation.id !== record.remoteGenerationId) {
      throw new Error('Asset Center returned a mismatched generation');
    }
    const at = nowIso(this.clock);
    if (generation.status === 'queued') {
      return this.write({
        ...record,
        status: 'running',
        stage: publicStage(generation.stage, this.clock),
        progress: Number.isFinite(generation.progress) ? generation.progress : 0,
        updatedAt: at,
        nextRetryAt: undefined,
      });
    }
    if (generation.status === 'processing') {
      return this.write({
        ...record,
        status: 'running',
        stage: publicStage(generation.stage, this.clock),
        progress: Number.isFinite(generation.progress) ? generation.progress : record.progress,
        updatedAt: at,
        nextRetryAt: undefined,
      });
    }
    if (generation.status === 'failed') {
      return this.write({
        ...record,
        status: 'failed',
        stage: publicStage('failed', this.clock),
        progress: Number.isFinite(generation.progress) ? generation.progress : record.progress,
        updatedAt: at,
        nextRetryAt: undefined,
        failure: { message: '资产生成失败，请调整描述后重试' },
      });
    }
    if (generation.status !== 'succeeded' || !generation.asset) {
      throw new Error('Asset Center returned an invalid generation status');
    }
    return this.importAsset(record, generation.asset);
  }

  async importAsset(record, remoteAsset) {
    if (!REMOTE_ASSET_ID_PATTERN.test(remoteAsset?.id ?? '')) {
      throw new Error('Asset Center returned an invalid asset ID');
    }
    const expectedSizeBytes = remoteAsset.sizeBytes;
    const expectedSha256 = remoteAsset.sha256;
    if (expectedSizeBytes !== undefined && (!Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes < 1)) {
      throw new Error('Asset Center returned an invalid asset size');
    }
    if (expectedSha256 !== undefined && !HASH_PATTERN.test(expectedSha256)) {
      throw new Error('Asset Center returned an invalid asset hash');
    }
    const syncingAt = nowIso(this.clock);
    record = await this.write({
      ...record,
      status: 'running',
      stage: { code: 'uploading', message: '正在导入到“我的物件”', updatedAt: syncingAt },
      progress: 99,
      remoteAssetId: remoteAsset.id,
      ...(expectedSha256 ? { remoteSha256: expectedSha256 } : {}),
      updatedAt: syncingAt,
      nextRetryAt: undefined,
    });
    const target = await this.client.getDownloadTarget({
      externalUserId: record.ownerId,
      assetId: remoteAsset.id,
    });
    const { buffer } = await this.client.downloadGlb({
      url: target.url,
      expectedSizeBytes,
      expectedSha256,
      maximumBytes: MAX_LOBBY_ASSET_BYTES,
    });
    const imported = await this.lobbyAssetStore.create({
      ownerId: record.ownerId,
      name: compactName(remoteAsset.displayName, record.prompt),
      category: 'AI 创作',
      defaultScale: 1,
      buffer,
    });
    await this.registerCatalogId(imported.record.id);
    const asset = this.lobbyAssetStore.get(imported.record.id);
    if (!asset) throw new Error('Imported Lobby asset is missing');
    const completedAt = nowIso(this.clock);
    return this.write({
      ...record,
      status: 'published',
      stage: { code: 'published', message: '已加入“我的物件”', updatedAt: completedAt },
      progress: 100,
      asset,
      updatedAt: completedAt,
      nextRetryAt: undefined,
      failure: undefined,
    });
  }

  async handleSyncError(record, error) {
    const at = nowIso(this.clock);
    if (isRetryable(error)) {
      const localCapacity = error instanceof HttpError && error.status === 507;
      return this.write({
        ...record,
        status: record.remoteGenerationId ? 'running' : 'queued',
        stage: {
          code: record.remoteGenerationId ? 'uploading' : 'queued',
          message: localCapacity
            ? '“我的物件”空间已满；清理空间后会自动重试导入'
            : 'Asset Center 暂时繁忙，任务将自动重试',
          updatedAt: at,
        },
        updatedAt: at,
        nextRetryAt: new Date(this.clock() + retryDelay(error)).toISOString(),
      });
    }
    return this.write({
      ...record,
      status: 'failed',
      stage: { code: 'failed', message: '资产生成失败', updatedAt: at },
      updatedAt: at,
      nextRetryAt: undefined,
      failure: { message: safeRemoteFailure(error) },
    });
  }
}
