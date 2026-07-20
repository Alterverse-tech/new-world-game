import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { validateAvatarGlb } from './avatar.js';
import { HttpError } from './errors.js';
import { FixedWindowCounter } from './lobby.js';
import { atomicWriteJson } from './store.js';

export const MAX_LOBBY_ASSET_BYTES = 15 * 1024 * 1024;
export const LOBBY_ASSET_ID_PATTERN = /^user-glb-[a-f0-9]{32}$/;
export const DEFAULT_LOBBY_ASSET_LIMITS = Object.freeze({
  maxPerOwner: 20,
  maxBytesPerOwner: 128 * 1024 * 1024,
  maxRecords: 5_000,
  maxTotalBytes: 512 * 1024 * 1024,
});
export const LOBBY_ASSET_BUDGETS = Object.freeze({
  nodes: 128,
  meshes: 32,
  primitives: 64,
  accessors: 512,
  bufferViews: 512,
  materials: 32,
  textures: 16,
  images: 16,
  samplers: 16,
  scenes: 8,
  animations: 0,
  skins: 0,
  joints: 0,
  vertices: 100_000,
  indices: 150_000,
  triangles: 50_000,
  morphTargets: 0,
  instances: 0,
  accessorElements: 500_000,
  texturePixels: 4 * 1024 * 1024,
  renderedMeshes: 128,
  renderedPrimitives: 128,
  renderedVertices: 100_000,
  renderedTriangles: 50_000,
});

const OWNER_ID_PATTERN = /^owner-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const RECORD_FIELDS = new Set([
  'schemaVersion',
  'id',
  'name',
  'category',
  'kind',
  'assetUrl',
  'defaultScale',
  'ownerId',
  'hash',
  'bytes',
  'uploadedAt',
  'stats',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateText(value, field, maximumCharacters, maximumBytes) {
  if (typeof value !== 'string') {
    throw new HttpError(422, 'invalid_lobby_asset_metadata', `${field} is required`);
  }
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const characters = [...normalized];
  if (
    !characters.length
    || characters.length > maximumCharacters
    || Buffer.byteLength(normalized) > maximumBytes
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new HttpError(
      422,
      'invalid_lobby_asset_metadata',
      `${field} must be 1-${maximumCharacters} safe characters`,
    );
  }
  return normalized;
}

export function validateLobbyAssetMetadata({ name, category, defaultScale = '1' }) {
  const scale = typeof defaultScale === 'number' ? defaultScale : Number(defaultScale);
  if (!Number.isFinite(scale) || scale < 0.25 || scale > 3) {
    throw new HttpError(422, 'invalid_lobby_asset_metadata', 'defaultScale must be between 0.25 and 3');
  }
  return {
    name: validateText(name, 'name', 40, 120),
    category: validateText(category, 'category', 20, 60),
    defaultScale: Object.is(scale, -0) ? 0 : scale,
  };
}

function translatedValidationError(error) {
  if (!(error instanceof HttpError)) return error;
  const codes = new Map([
    ['avatar_too_large', 'lobby_asset_too_large'],
    ['invalid_avatar_glb', 'invalid_lobby_asset_glb'],
    ['invalid_avatar_image', 'invalid_lobby_asset_image'],
    ['avatar_external_resource', 'lobby_asset_external_resource'],
    ['avatar_forbidden_scene_feature', 'lobby_asset_forbidden_scene_feature'],
    ['avatar_unsupported_extension', 'lobby_asset_unsupported_extension'],
    ['avatar_budget_exceeded', 'lobby_asset_budget_exceeded'],
    ['avatar_image_dimensions_exceeded', 'lobby_asset_image_dimensions_exceeded'],
  ]);
  return new HttpError(
    error.status,
    codes.get(error.code) ?? error.code,
    error.message.replaceAll('Avatar', 'Lobby asset'),
    error.details,
  );
}

export function validateLobbyAssetGlb(buffer) {
  try {
    const stats = validateAvatarGlb(buffer, {
      maximumBytes: MAX_LOBBY_ASSET_BYTES,
      label: 'Lobby asset',
      strictExtensions: true,
      strictDocument: true,
      strictGeometry: true,
    });
    for (const [field, maximum] of Object.entries(LOBBY_ASSET_BUDGETS)) {
      if (stats[field] > maximum) {
        throw new HttpError(422, 'lobby_asset_budget_exceeded', `${field} exceeds its Lobby asset safety budget`, {
          field,
          maximum,
          actual: stats[field],
        });
      }
    }
    return stats;
  } catch (error) {
    throw translatedValidationError(error);
  }
}

function publicAsset(record) {
  return Object.freeze({
    id: record.id,
    name: record.name,
    category: record.category,
    kind: 'glb',
    assetUrl: record.assetUrl,
    defaultScale: record.defaultScale,
  });
}

function storedRecordIsValid(record, expectedId) {
  return isPlainObject(record)
    && !Object.keys(record).some((key) => !RECORD_FIELDS.has(key))
    && record.schemaVersion === 1
    && record.id === expectedId
    && LOBBY_ASSET_ID_PATTERN.test(record.id)
    && OWNER_ID_PATTERN.test(record.ownerId ?? '')
    && HASH_PATTERN.test(record.hash ?? '')
    && record.kind === 'glb'
    && record.assetUrl === `/lobby-assets/${record.id}/model.glb`
    && Number.isSafeInteger(record.bytes)
    && record.bytes > 0
    && record.bytes <= MAX_LOBBY_ASSET_BYTES
    && typeof record.uploadedAt === 'string'
    && Number.isFinite(Date.parse(record.uploadedAt))
    && isPlainObject(record.stats)
    && (() => {
      try {
        const validated = validateLobbyAssetMetadata(record);
        return validated.name === record.name
          && validated.category === record.category
          && validated.defaultScale === record.defaultScale;
      } catch {
        return false;
      }
    })();
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not available on every supported filesystem.
  } finally {
    await handle?.close();
  }
}

async function writeImmutable(filePath, buffer) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o750 });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o640);
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filePath);
    await syncDirectory(path.dirname(filePath));
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export class LobbyAssetStore {
  constructor({
    dataDirectory,
    clock = Date.now,
    maxPerOwner = DEFAULT_LOBBY_ASSET_LIMITS.maxPerOwner,
    maxBytesPerOwner = DEFAULT_LOBBY_ASSET_LIMITS.maxBytesPerOwner,
    maxRecords = DEFAULT_LOBBY_ASSET_LIMITS.maxRecords,
    maxTotalBytes = DEFAULT_LOBBY_ASSET_LIMITS.maxTotalBytes,
    idFactory = randomUUID,
  } = {}) {
    if (
      !dataDirectory
      || typeof clock !== 'function'
      || typeof idFactory !== 'function'
      || ![maxPerOwner, maxBytesPerOwner, maxRecords, maxTotalBytes]
        .every((value) => Number.isSafeInteger(value) && value > 0)
    ) {
      throw new Error('LobbyAssetStore settings are invalid');
    }
    this.root = path.join(path.resolve(dataDirectory), 'lobby-assets');
    this.recordsDirectory = path.join(this.root, 'records');
    this.blobsDirectory = path.join(this.root, 'blobs');
    this.clock = clock;
    this.maxPerOwner = maxPerOwner;
    this.maxBytesPerOwner = maxBytesPerOwner;
    this.maxRecords = maxRecords;
    this.maxTotalBytes = maxTotalBytes;
    this.idFactory = idFactory;
    this.records = new Map();
    this.ownerRecords = new Map();
    this.ownerHashes = new Map();
    this.ownerBytes = new Map();
    this.blobs = new Map();
    this.catalogIds = new Set();
    this.totalBytes = 0;
    this.queue = Promise.resolve();
  }

  recordPath(id) {
    if (!LOBBY_ASSET_ID_PATTERN.test(id ?? '')) throw new HttpError(404, 'lobby_asset_not_found', 'Lobby asset was not found');
    return path.join(this.recordsDirectory, `${id}.json`);
  }

  blobPath(hash) {
    if (!HASH_PATTERN.test(hash ?? '')) throw new HttpError(404, 'lobby_asset_not_found', 'Lobby asset was not found');
    return path.join(this.blobsDirectory, `${hash}.glb`);
  }

  modelPath(id) {
    const record = this.records.get(id);
    if (!record) throw new HttpError(404, 'lobby_asset_not_found', 'Lobby asset was not found');
    return this.blobPath(record.hash);
  }

  async initialize() {
    await Promise.all([
      mkdir(this.recordsDirectory, { recursive: true, mode: 0o750 }),
      mkdir(this.blobsDirectory, { recursive: true, mode: 0o750 }),
    ]);
    this.records.clear();
    this.ownerRecords.clear();
    this.ownerHashes.clear();
    this.ownerBytes.clear();
    this.blobs.clear();
    this.catalogIds.clear();
    this.totalBytes = 0;

    const blobNames = (await readdir(this.blobsDirectory)).filter((name) => name.endsWith('.glb')).sort();
    for (const fileName of blobNames) {
      const hash = fileName.slice(0, -4);
      if (!HASH_PATTERN.test(hash)) throw new Error(`Invalid stored lobby asset blob: ${fileName}`);
      const buffer = await readFile(path.join(this.blobsDirectory, fileName));
      if (buffer.length > MAX_LOBBY_ASSET_BYTES || createHash('sha256').update(buffer).digest('hex') !== hash) {
        throw new Error(`Stored lobby asset hash mismatch: ${fileName}`);
      }
      const stats = validateLobbyAssetGlb(buffer);
      this.blobs.set(hash, Object.freeze({ bytes: buffer.length, stats }));
      this.totalBytes += buffer.length;
    }
    if (this.totalBytes > this.maxTotalBytes) throw new Error('Stored lobby assets exceed configured byte capacity');

    const recordNames = (await readdir(this.recordsDirectory)).filter((name) => name.endsWith('.json')).sort();
    if (recordNames.length > this.maxRecords) throw new Error('Stored lobby asset record count exceeds configured maximum');
    for (const fileName of recordNames) {
      const id = fileName.slice(0, -5);
      const record = JSON.parse(await readFile(path.join(this.recordsDirectory, fileName), 'utf8'));
      if (!storedRecordIsValid(record, id)) throw new Error(`Invalid stored lobby asset record: ${fileName}`);
      const blob = this.blobs.get(record.hash);
      if (!blob || blob.bytes !== record.bytes) throw new Error(`Stored lobby asset blob is missing: ${id}`);
      if (JSON.stringify(blob.stats) !== JSON.stringify(record.stats)) {
        throw new Error(`Stored lobby asset validation metadata mismatch: ${id}`);
      }
      const ownerItems = this.ownerRecords.get(record.ownerId) ?? [];
      const ownerHashes = this.ownerHashes.get(record.ownerId) ?? new Map();
      if (ownerHashes.has(record.hash)) throw new Error(`Duplicate stored lobby asset owner/hash: ${id}`);
      ownerItems.push(record);
      ownerHashes.set(record.hash, id);
      this.ownerRecords.set(record.ownerId, ownerItems);
      this.ownerHashes.set(record.ownerId, ownerHashes);
      this.ownerBytes.set(record.ownerId, (this.ownerBytes.get(record.ownerId) ?? 0) + record.bytes);
      if (ownerItems.length > this.maxPerOwner || this.ownerBytes.get(record.ownerId) > this.maxBytesPerOwner) {
        throw new Error(`Stored lobby assets exceed owner capacity: ${record.ownerId}`);
      }
      this.records.set(id, Object.freeze(record));
      this.catalogIds.add(id);
    }
  }

  get count() {
    return this.records.size;
  }

  get(id) {
    const record = this.records.get(id);
    return record ? publicAsset(record) : null;
  }

  getStored(id) {
    return this.records.get(id) ?? null;
  }

  // 资产体检用：全量存储记录（含 bytes 与几何/纹理统计）
  listStored() {
    return [...this.records.values()];
  }

  listOwner(ownerId) {
    if (!OWNER_ID_PATTERN.test(ownerId ?? '')) return [];
    return [...(this.ownerRecords.get(ownerId) ?? [])]
      .sort((left, right) => left.uploadedAt.localeCompare(right.uploadedAt) || left.id.localeCompare(right.id))
      .map(publicAsset);
  }

  isOwnedBy(id, ownerId) {
    return this.records.get(id)?.ownerId === ownerId;
  }

  create({ ownerId, name, category, defaultScale, buffer }) {
    const operation = this.queue.then(async () => {
      if (!OWNER_ID_PATTERN.test(ownerId ?? '')) throw new Error('Lobby asset ownerId is invalid');
      const metadata = validateLobbyAssetMetadata({ name, category, defaultScale });
      const stats = validateLobbyAssetGlb(buffer);
      const hash = createHash('sha256').update(buffer).digest('hex');
      const existingId = this.ownerHashes.get(ownerId)?.get(hash);
      if (existingId) return { record: this.records.get(existingId), deduplicated: true };

      const ownerItems = this.ownerRecords.get(ownerId) ?? [];
      const usedOwnerBytes = this.ownerBytes.get(ownerId) ?? 0;
      if (ownerItems.length >= this.maxPerOwner || this.records.size >= this.maxRecords) {
        throw new HttpError(507, 'lobby_asset_capacity_reached', 'Lobby asset library has reached its capacity', {
          maximumPerOwner: this.maxPerOwner,
          maximumRecords: this.maxRecords,
        });
      }
      if (usedOwnerBytes + buffer.length > this.maxBytesPerOwner) {
        throw new HttpError(507, 'lobby_asset_owner_storage_capacity_reached', 'Your lobby asset library has reached its byte capacity', {
          maximumBytes: this.maxBytesPerOwner,
          usedBytes: usedOwnerBytes,
        });
      }
      const newBlob = !this.blobs.has(hash);
      if (newBlob && this.totalBytes + buffer.length > this.maxTotalBytes) {
        throw new HttpError(507, 'lobby_asset_storage_capacity_reached', 'Lobby asset storage has reached its byte capacity', {
          maximumBytes: this.maxTotalBytes,
          usedBytes: this.totalBytes,
        });
      }

      let id;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const generated = this.idFactory();
        if (typeof generated !== 'string') throw new Error('Lobby asset idFactory returned an invalid value');
        const compact = generated.toLowerCase().replaceAll('-', '');
        if (!/^[a-f0-9]{32}$/.test(compact)) throw new Error('Lobby asset idFactory returned an invalid value');
        const candidate = `user-glb-${compact}`;
        if (!this.records.has(candidate)) {
          id = candidate;
          break;
        }
      }
      if (!id) throw new HttpError(503, 'lobby_asset_id_unavailable', 'Could not allocate a lobby asset ID');
      if (!LOBBY_ASSET_ID_PATTERN.test(id)) throw new Error('Generated lobby asset ID is invalid');
      if (this.records.has(id)) throw new HttpError(409, 'lobby_asset_id_conflict', 'Lobby asset ID conflict');
      const uploadedAt = new Date(this.clock()).toISOString();
      const record = Object.freeze({
        schemaVersion: 1,
        id,
        ...metadata,
        kind: 'glb',
        assetUrl: `/lobby-assets/${id}/model.glb`,
        ownerId,
        hash,
        bytes: buffer.length,
        uploadedAt,
        stats,
      });

      try {
        if (newBlob) await writeImmutable(this.blobPath(hash), buffer);
        await atomicWriteJson(this.recordPath(id), record, 0o640);
      } catch (error) {
        await unlink(this.recordPath(id)).catch(() => {});
        if (newBlob) await unlink(this.blobPath(hash)).catch(() => {});
        throw error;
      }

      if (newBlob) {
        this.blobs.set(hash, Object.freeze({ bytes: buffer.length, stats }));
        this.totalBytes += buffer.length;
      }
      ownerItems.push(record);
      const ownerHashes = this.ownerHashes.get(ownerId) ?? new Map();
      ownerHashes.set(hash, id);
      this.ownerRecords.set(ownerId, ownerItems);
      this.ownerHashes.set(ownerId, ownerHashes);
      this.ownerBytes.set(ownerId, usedOwnerBytes + buffer.length);
      this.records.set(id, record);
      this.catalogIds.add(id);
      return { record, deduplicated: false };
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

export class LobbyAssetUploadRateLimiter {
  constructor({ clock = Date.now, windowMs = 3_600_000, maximum = 5, globalMaximum = 20 } = {}) {
    if (![windowMs, maximum, globalMaximum].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new Error('Lobby asset upload rate limits are invalid');
    }
    this.clock = clock;
    this.ip = new FixedWindowCounter(maximum, windowMs, clock);
    this.owner = new FixedWindowCounter(maximum, windowMs, clock);
    this.global = new FixedWindowCounter(globalMaximum, windowMs, clock);
  }

  check(ownerId, ip) {
    const ipEntry = this.ip.inspect(ip);
    const ownerEntry = this.owner.inspect(ownerId);
    const globalEntry = this.global.inspect('global');
    const now = this.clock();
    if (
      ipEntry.count >= this.ip.limit
      || ownerEntry.count >= this.owner.limit
      || globalEntry.count >= this.global.limit
    ) {
      const resetAt = Math.max(
        ipEntry.count >= this.ip.limit ? ipEntry.resetAt : now,
        ownerEntry.count >= this.owner.limit ? ownerEntry.resetAt : now,
        globalEntry.count >= this.global.limit ? globalEntry.resetAt : now,
      );
      throw new HttpError(429, 'lobby_asset_upload_rate_limited', 'Too many lobby asset uploads; please try again later', {
        retryAfterMs: Math.max(1, resetAt - now),
      });
    }
    this.ip.consume(ip, ipEntry);
    this.owner.consume(ownerId, ownerEntry);
    this.global.consume('global', globalEntry);
  }
}

export class LobbyAssetUploadGate {
  constructor(maximum = 2) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error('Lobby asset upload concurrency is invalid');
    this.maximum = maximum;
    this.active = 0;
  }

  enter() {
    if (this.active >= this.maximum) {
      throw new HttpError(429, 'lobby_asset_upload_busy', 'Lobby asset validation is busy; please try again shortly');
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }
}
