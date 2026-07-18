import { open, mkdir, readFile, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './errors.js';
import { LEVEL_ID_PATTERN } from './validator.js';

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected']);

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

export async function atomicWriteJson(filePath, value, mode = 0o600) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o750 });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  let handle;
  try {
    handle = await open(temporary, 'wx', mode);
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filePath);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export class FileStore {
  constructor(dataDirectory) {
    this.dataDirectory = path.resolve(dataDirectory);
    this.packagesDirectory = path.join(this.dataDirectory, 'packages');
    this.recordsDirectory = path.join(this.dataDirectory, 'records');
    this.locksDirectory = path.join(this.dataDirectory, 'locks');
    this.temporaryDirectory = path.join(this.dataDirectory, 'tmp');
    this.registryPath = path.join(this.dataDirectory, 'registry.json');
    this.registry = { generatedAt: new Date(0).toISOString(), engineApi: '1', levels: [] };
    this.registryQueue = Promise.resolve();
  }

  async initialize() {
    await Promise.all([
      mkdir(this.packagesDirectory, { recursive: true, mode: 0o750 }),
      mkdir(this.recordsDirectory, { recursive: true, mode: 0o750 }),
      mkdir(this.locksDirectory, { recursive: true, mode: 0o750 }),
      mkdir(this.temporaryDirectory, { recursive: true, mode: 0o700 }),
    ]);
    await this.rebuildRegistry();
  }

  recordPath(id) {
    if (!LEVEL_ID_PATTERN.test(id)) throw new HttpError(400, 'invalid_level_id', 'Invalid level ID');
    return path.join(this.recordsDirectory, `${id}.json`);
  }

  packagePath(record) {
    if (!record || !LEVEL_ID_PATTERN.test(record.id) || !/^[a-f0-9]{64}$/.test(record.hash)) {
      throw new Error('Stored level record is invalid');
    }
    return path.join(this.packagesDirectory, record.id, record.hash);
  }

  async getRecord(id) {
    try {
      const record = JSON.parse(await readFile(this.recordPath(id), 'utf8'));
      if (record.id !== id || !VALID_STATUSES.has(record.status)) throw new Error('Invalid record');
      return record;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async listRecords() {
    const names = (await readdir(this.recordsDirectory)).filter((name) => name.endsWith('.json')).sort();
    const records = [];
    for (const name of names) {
      const record = JSON.parse(await readFile(path.join(this.recordsDirectory, name), 'utf8'));
      if (!LEVEL_ID_PATTERN.test(record.id) || !VALID_STATUSES.has(record.status)) {
        throw new Error(`Invalid stored record: ${name}`);
      }
      records.push(record);
    }
    return records;
  }

  async withLevelLock(id, action) {
    const lockPath = path.join(this.locksDirectory, `${id}.lock`);
    let handle;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        handle = await open(lockPath, 'wx', 0o600);
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const info = await stat(lockPath).catch(() => null);
        if (attempt === 0 && info && Date.now() - info.mtimeMs > 5 * 60 * 1000) {
          await unlink(lockPath).catch(() => {});
          continue;
        }
        throw new HttpError(409, 'level_busy', 'This level is currently being updated');
      }
    }
    try {
      await handle.writeFile(`${process.pid}\n`, 'utf8');
      return await action();
    } finally {
      await handle?.close().catch(() => {});
      await unlink(lockPath).catch(() => {});
    }
  }

  async createPending({ manifest, hash, archiveBytes, uncompressedBytes, fileCount, packageRoot }) {
    return this.withLevelLock(manifest.id, async () => {
      const existing = await this.getRecord(manifest.id);
      if (existing) {
        if (existing.hash === hash) return { record: existing, deduplicated: true };
        throw new HttpError(
          409,
          'level_id_conflict',
          'A different package already uses this level ID',
        );
      }

      const packageParent = path.join(this.packagesDirectory, manifest.id);
      const destination = path.join(packageParent, hash);
      await mkdir(packageParent, { recursive: true, mode: 0o750 });
      try {
        await rename(packageRoot, destination);
      } catch (error) {
        if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') {
          throw new HttpError(409, 'package_conflict', 'The immutable package path already exists');
        }
        throw error;
      }

      const submittedAt = new Date().toISOString();
      const record = {
        id: manifest.id,
        status: 'pending',
        hash,
        submittedAt,
        archiveBytes,
        uncompressedBytes,
        fileCount,
        manifest,
      };
      let recordWritten = false;
      try {
        await atomicWriteJson(this.recordPath(manifest.id), record);
        recordWritten = true;
        await this.rebuildRegistry();
      } catch (error) {
        if (!recordWritten) await rm(destination, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
      return { record, deduplicated: false };
    });
  }

  async updateStatus(id, status, reason = undefined) {
    if (status !== 'approved' && status !== 'rejected') {
      throw new HttpError(400, 'invalid_status', 'Status must be approved or rejected');
    }
    return this.withLevelLock(id, async () => {
      const record = await this.getRecord(id);
      if (!record) throw new HttpError(404, 'level_not_found', 'Level was not found');
      if (record.status !== 'pending') {
        throw new HttpError(409, 'invalid_transition', 'Only pending levels can be reviewed');
      }
      if (status === 'rejected' && (typeof reason !== 'string' || !reason.trim() || reason.length > 500)) {
        throw new HttpError(400, 'invalid_reason', 'Rejection reason must be 1-500 characters');
      }

      const reviewedAt = new Date().toISOString();
      const updated = { ...record, status, reviewedAt };
      if (status === 'approved') {
        updated.publishedAt = reviewedAt;
      } else {
        updated.rejectionReason = reason.trim();
      }
      await atomicWriteJson(this.recordPath(id), updated);
      await this.rebuildRegistry();
      return updated;
    });
  }

  statusView(record) {
    const view = {
      levelId: record.id,
      status: record.status,
      submittedAt: record.submittedAt,
    };
    if (record.reviewedAt) view.reviewedAt = record.reviewedAt;
    if (record.publishedAt) view.publishedAt = record.publishedAt;
    if (record.rejectionReason) view.reason = record.rejectionReason;
    return view;
  }

  adminSummaryView(record) {
    return {
      ...this.statusView(record),
      hash: record.hash,
      name: record.manifest.name,
      version: record.manifest.version,
      author: record.manifest.author,
      description: record.manifest.description,
      language: record.manifest.language,
      type: record.manifest.type,
      objective: record.manifest.objective,
      winCondition: record.manifest.winCondition,
      difficulty: record.manifest.difficulty,
      estimatedMinutes: record.manifest.estimatedMinutes,
    };
  }

  adminDetailView(record, solutionMd) {
    return {
      ...this.statusView(record),
      hash: record.hash,
      archiveBytes: record.archiveBytes,
      uncompressedBytes: record.uncompressedBytes,
      fileCount: record.fileCount,
      manifest: record.manifest,
      solutionMd,
    };
  }

  async rebuildRegistry() {
    const task = this.registryQueue.then(async () => {
      const records = await this.listRecords();
      const levels = records
        .filter((record) => record.status === 'approved')
        .map((record) => ({
          id: record.id,
          status: 'approved',
          name: record.manifest.name,
          author: record.manifest.author.name,
          description: record.manifest.description,
          type: record.manifest.type,
          objective: record.manifest.objective,
          winCondition: record.manifest.winCondition,
          difficulty: record.manifest.difficulty,
          estimatedMinutes: record.manifest.estimatedMinutes,
          language: record.manifest.language,
          cover: `/levels/${record.id}/${record.manifest.cover}`,
          path: `/levels/${record.id}/`,
          hash: record.hash,
          publishedAt: record.publishedAt,
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
      const registry = { generatedAt: new Date().toISOString(), engineApi: '1', levels };
      this.registry = registry;
      await atomicWriteJson(this.registryPath, registry, 0o644);
      return registry;
    });
    this.registryQueue = task.catch(() => {});
    return task;
  }

  getRegistry() {
    return this.registry;
  }
}
