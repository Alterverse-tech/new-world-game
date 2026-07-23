import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './errors.js';
import { syncDirectory } from './fsync.js';
import { atomicWriteJson } from './store.js';

export const PROP_CREATION_ID_PATTERN = /^propjob-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const PROP_CREATION_STATUSES = new Set([
  'queued',
  'running',
  'pending_review',
  'approved',
  'rejected',
  'failed',
  'cancelled',
]);
export const PROP_CREATION_STAGES = new Set([
  'queued',
  'claimed',
  'preparing',
  'generating',
  'validating',
  'uploading',
  'publishing',
  'building',
  'deploying',
  'verifying',
  'published',
  'publish_failed',
  'pending_review',
  'approved',
  'rejected',
  'failed',
  'cancelled',
]);
export const PROP_PUBLICATION_PROGRESS_STAGES = new Set([
  'publishing',
  'building',
  'deploying',
  'verifying',
]);
export const MAX_PROP_PROMPT_CHARACTERS = 600;
export const MAX_PROP_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const MAX_PROP_PATCH_BYTES = 2 * 1024 * 1024;
const MAX_PROP_PROPOSAL_BYTES = 32 * 1024;
const MAX_PROP_SUMMARY_CHARACTERS = 600;
const MAX_PROP_NAME_CHARACTERS = 40;
const MAX_PROP_FAILURE_CHARACTERS = 500;
const MAX_PROP_REVIEW_REASON_CHARACTERS = 500;
const MAX_OWNER_JOBS_RETURNED = 25;
const DEFAULT_LEASE_MS = 30 * 60 * 1000;
const DEFAULT_WORKER_ONLINE_MS = 45 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_PROP_RELEASE_ID_CHARACTERS = 160;
const MAX_PROP_PUBLIC_URL_CHARACTERS = 2048;
const SAFE_PATCH_PATHS = [
  /^game\/src\/lobby-props\/generated\/[a-z0-9-]+(?:\.test)?\.ts$/,
  /^game\/src\/lobby-props\/(?:approved-modules|registry)\.ts$/,
  /^platform\/src\/lobby-catalog\.json$/,
];
const SAFE_ARTIFACT_FILES = new Set(['proposal.json', 'changes.patch']);

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizedText(value, maximumCharacters) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (!normalized || [...normalized].length > maximumCharacters || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    return null;
  }
  return normalized;
}

export function validatePropCreationPrompt(value) {
  const prompt = normalizedText(value, MAX_PROP_PROMPT_CHARACTERS);
  if (!prompt || [...prompt].length < 4) {
    throw new HttpError(
      422,
      'invalid_prop_prompt',
      `Describe the prop using 4-${MAX_PROP_PROMPT_CHARACTERS} characters`,
    );
  }
  return prompt;
}

export function validateWorkerId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(value)) {
    throw new HttpError(422, 'invalid_worker_id', 'workerId must use 3-64 safe characters');
  }
  return value;
}

function validRecord(record, expectedId = undefined) {
  return Boolean(
    record
    && typeof record === 'object'
    && PROP_CREATION_ID_PATTERN.test(record.id)
    && (!expectedId || record.id === expectedId)
    && PROP_CREATION_STATUSES.has(record.status)
    && typeof record.ownerId === 'string'
    && typeof record.prompt === 'string'
    && typeof record.channel === 'string'
    && typeof record.submittedAt === 'string'
    && typeof record.updatedAt === 'string',
  );
}

function safeArtifactRelativePath(value) {
  if (
    typeof value !== 'string'
    || !value
    || value.startsWith('/')
    || value.includes('\\')
    || value.includes('\0')
    || /[\u0000-\u001f\u007f]/.test(value)
    || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    || path.posix.normalize(value) !== value
  ) {
    throw new HttpError(422, 'invalid_prop_artifact', 'Artifact contains an unsafe path');
  }
  return value;
}

async function listArtifactFiles(root, relative = '') {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = safeArtifactRelativePath(relative ? `${relative}/${entry.name}` : entry.name);
    if (entry.isDirectory()) files.push(...await listArtifactFiles(root, child));
    else if (entry.isFile()) files.push(child);
    else throw new HttpError(422, 'invalid_prop_artifact', 'Artifact may contain only regular files');
  }
  return files.sort();
}

function patchPaths(patch) {
  if (
    !patch.trim()
    || patch.includes('\0')
    || /GIT binary patch|^rename (?:from|to) |^copy (?:from|to) |^old mode |^new mode /m.test(patch)
  ) {
    throw new HttpError(422, 'invalid_prop_patch', 'Generated patch is empty or uses unsupported Git operations');
  }

  const paths = new Set();
  const createdPaths = new Set();
  let current = null;
  const finishSection = () => {
    if (!current) return;
    if (!current.oldHeader || !current.newHeader || current.newNull) {
      throw new HttpError(422, 'invalid_prop_patch', 'Every generated patch section must contain exact file headers');
    }
    if (current.oldNull) createdPaths.add(current.path);
  };

  for (const line of patch.split('\n')) {
    if (
      (line.startsWith('new file mode ') && line !== 'new file mode 100644')
      || line.startsWith('deleted file mode ')
    ) {
      throw new HttpError(422, 'invalid_prop_patch', 'Generated patch may contain only regular non-executable files');
    }
    if (line.startsWith('diff --git ')) {
      finishSection();
      const match = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
      const changedPath = match?.[1];
      if (
        !match
        || changedPath !== match[2]
        || !SAFE_PATCH_PATHS.some((pattern) => pattern.test(changedPath))
      ) {
        throw new HttpError(422, 'unsafe_prop_patch_path', 'Generated patch changes a path outside the prop allowlist', {
          path: changedPath ?? line.slice('diff --git '.length),
        });
      }
      if (paths.has(changedPath)) {
        throw new HttpError(422, 'invalid_prop_patch', 'Generated patch contains duplicate file sections');
      }
      paths.add(changedPath);
      current = {
        path: changedPath,
        oldHeader: false,
        newHeader: false,
        oldNull: false,
        newNull: false,
      };
      continue;
    }

    if (line.startsWith('--- ')) {
      if (!current || current.oldHeader || current.newHeader) {
        throw new HttpError(422, 'invalid_prop_patch', 'Generated patch has an unexpected old-file header');
      }
      if (line !== '--- /dev/null' && line !== `--- a/${current.path}`) {
        throw new HttpError(422, 'unsafe_prop_patch_path', 'Generated patch old-file header is outside the prop allowlist', {
          path: line.slice(4),
        });
      }
      current.oldHeader = true;
      current.oldNull = line === '--- /dev/null';
      continue;
    }

    if (line.startsWith('+++ ')) {
      if (!current || !current.oldHeader || current.newHeader) {
        throw new HttpError(422, 'invalid_prop_patch', 'Generated patch has an unexpected new-file header');
      }
      if (line !== '+++ /dev/null' && line !== `+++ b/${current.path}`) {
        throw new HttpError(422, 'unsafe_prop_patch_path', 'Generated patch new-file header is outside the prop allowlist', {
          path: line.slice(4),
        });
      }
      current.newHeader = true;
      current.newNull = line === '+++ /dev/null';
    }
  }
  finishSection();
  if (paths.size === 0) {
    throw new HttpError(422, 'invalid_prop_patch', 'Generated patch contains no file changes');
  }

  for (const changedPath of paths) {
    if (!SAFE_PATCH_PATHS.some((pattern) => pattern.test(changedPath))) {
      throw new HttpError(422, 'unsafe_prop_patch_path', 'Generated patch changes a path outside the prop allowlist', {
        path: changedPath,
      });
    }
  }
  return {
    changedFiles: [...paths].sort(),
    createdFiles: [...createdPaths].sort(),
  };
}

function validateProposal(value, jobId, changedFiles, createdFiles) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(422, 'invalid_prop_proposal', 'proposal.json must contain one object');
  }
  const keys = Object.keys(value).sort();
  const allowed = ['catalogId', 'codexThreadId', 'jobId', 'kind', 'name', 'schemaVersion', 'summary'].sort();
  if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) {
    throw new HttpError(422, 'invalid_prop_proposal', 'proposal.json fields do not match schema');
  }
  if (value.schemaVersion !== 1 || value.jobId !== jobId) {
    throw new HttpError(422, 'invalid_prop_proposal', 'proposal.json does not match this job');
  }
  const name = normalizedText(value.name, MAX_PROP_NAME_CHARACTERS);
  const summary = normalizedText(value.summary, MAX_PROP_SUMMARY_CHARACTERS);
  if (!name || !summary) {
    throw new HttpError(422, 'invalid_prop_proposal', 'Proposal name or summary is invalid');
  }
  if (value.kind !== 'code') {
    throw new HttpError(422, 'invalid_prop_proposal', 'The current Codex bridge accepts reviewed code props only');
  }
  if (
    typeof value.catalogId !== 'string'
    || value.catalogId.length > 80
    || !/^code-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.catalogId)
  ) {
    throw new HttpError(422, 'invalid_prop_proposal', 'Proposal catalogId is invalid');
  }
  if (value.codexThreadId !== null && (
    typeof value.codexThreadId !== 'string'
    || !/^[a-zA-Z0-9_-]{8,128}$/.test(value.codexThreadId)
  )) {
    throw new HttpError(422, 'invalid_prop_proposal', 'Proposal Codex thread ID is invalid');
  }
  const moduleSlug = value.catalogId.slice('code-'.length);
  const generatedModule = `game/src/lobby-props/generated/${moduleSlug}.ts`;
  if (!changedFiles.includes(generatedModule) || !createdFiles.includes(generatedModule)) {
    throw new HttpError(422, 'invalid_prop_proposal', 'Patch does not create the proposed generated module');
  }
  return {
    schemaVersion: 1,
    jobId,
    name,
    summary,
    kind: 'code',
    catalogId: value.catalogId,
    codexThreadId: value.codexThreadId,
  };
}

function tokenMatches(value, digest) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(digest ?? '')) return false;
  const actual = Buffer.from(sha256(value), 'hex');
  const expected = Buffer.from(digest, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function stageView(record) {
  return {
    code: PROP_CREATION_STAGES.has(record.stage?.code) ? record.stage.code : record.status,
    message: normalizedText(record.stage?.message, 240) ?? '任务状态已更新',
    updatedAt: record.stage?.updatedAt ?? record.updatedAt,
  };
}

function appendEvent(record, type, at, details = undefined) {
  const events = Array.isArray(record.events) ? record.events.slice(-99) : [];
  events.push({ type, at, ...(details ? { details } : {}) });
  return events;
}

function publicationInProgress(record) {
  return Boolean(
    record.status === 'running'
    && record.publication?.mode === 'automatic'
    && PROP_PUBLICATION_PROGRESS_STAGES.has(record.stage?.code),
  );
}

function publicationAttempt(record) {
  const value = record.publication?.attempt;
  return Number.isSafeInteger(value) && value >= 1 ? value : 1;
}

function nextPublicationAttempt(record) {
  return Math.min(publicationAttempt(record) + 1, 1_000_000);
}

function publicationView(record) {
  const publication = record.publication;
  if (!publication || publication.mode !== 'automatic') return null;
  return {
    mode: 'automatic',
    status: publication.status,
    startedAt: publication.startedAt,
    updatedAt: publication.updatedAt ?? record.updatedAt,
    ...(publication.publishedAt ? { publishedAt: publication.publishedAt } : {}),
    ...(publication.failedAt ? { failedAt: publication.failedAt } : {}),
    ...(publication.release ? { release: publication.release } : {}),
    ...(publication.failure ? { failure: publication.failure } : {}),
  };
}

function workerJobView(record) {
  const publication = publicationInProgress(record);
  return {
    id: record.id,
    prompt: record.prompt,
    channel: record.channel,
    submittedAt: record.submittedAt,
    attempt: record.attempt,
    phase: publication ? 'publication' : 'generation',
    stage: stageView(record),
    ...(publication && record.proposal ? { proposal: record.proposal } : {}),
    ...(publication && record.artifact?.sha256
      ? { artifactSha256: record.artifact.sha256 }
      : {}),
  };
}

function exactObjectKeys(value, expected, code, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(422, code, message);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new HttpError(422, code, message);
  }
  return value;
}

function publicationRelease(value, expectedCatalogId) {
  exactObjectKeys(
    value,
    ['id', 'gameRelease', 'platformRelease', 'gameSha256', 'platformSha256', 'catalogId', 'publicUrl'],
    'invalid_prop_publication',
    'Publication release fields are invalid',
  );
  const safeReleaseId = (input) => (
    typeof input === 'string'
    && input.length <= MAX_PROP_RELEASE_ID_CHARACTERS
    && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(input)
  );
  if (!safeReleaseId(value.id) || !safeReleaseId(value.gameRelease) || !safeReleaseId(value.platformRelease)) {
    throw new HttpError(422, 'invalid_prop_publication', 'Publication release IDs are invalid');
  }
  if (
    typeof value.gameSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.gameSha256)
    || typeof value.platformSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.platformSha256)
  ) {
    throw new HttpError(422, 'invalid_prop_publication', 'Publication release checksums are invalid');
  }
  if (value.catalogId !== expectedCatalogId) {
    throw new HttpError(422, 'invalid_prop_publication', 'Publication catalogId does not match the proposal');
  }
  const cleanPublicUrl = normalizedText(value.publicUrl, MAX_PROP_PUBLIC_URL_CHARACTERS);
  let publicUrl;
  try {
    publicUrl = new URL(cleanPublicUrl);
  } catch {
    throw new HttpError(422, 'invalid_prop_publication', 'Publication publicUrl is invalid');
  }
  if (
    publicUrl.protocol !== 'https:'
    || publicUrl.username
    || publicUrl.password
    || publicUrl.hash
  ) {
    throw new HttpError(422, 'invalid_prop_publication', 'Publication publicUrl must be a safe HTTPS URL');
  }
  return {
    id: value.id,
    gameRelease: value.gameRelease,
    platformRelease: value.platformRelease,
    gameSha256: value.gameSha256,
    platformSha256: value.platformSha256,
    catalogId: value.catalogId,
    publicUrl: publicUrl.toString(),
  };
}

function publicationRollback(value) {
  exactObjectKeys(
    value,
    ['attempted', 'succeeded'],
    'invalid_prop_publication',
    'Publication rollback fields are invalid',
  );
  if (typeof value.attempted !== 'boolean' || typeof value.succeeded !== 'boolean' || (value.succeeded && !value.attempted)) {
    throw new HttpError(422, 'invalid_prop_publication', 'Publication rollback state is invalid');
  }
  return { attempted: value.attempted, succeeded: value.succeeded };
}

function leaseIsActive(record, at) {
  const expiresAt = Date.parse(record.lease?.expiresAt ?? '');
  return Number.isFinite(expiresAt) && expiresAt > at;
}

export class PropCreationStore {
  constructor({
    dataDirectory,
    clock = Date.now,
    leaseMs = DEFAULT_LEASE_MS,
    workerOnlineMs = DEFAULT_WORKER_ONLINE_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    maxActivePerOwner = 2,
    maxDailyPerOwner = 3,
    maxDailyPerIp = 12,
    idFactory = () => `propjob-${randomUUID()}`,
  }) {
    this.rootDirectory = path.join(path.resolve(dataDirectory), 'prop-creations');
    this.recordsDirectory = path.join(this.rootDirectory, 'records');
    this.artifactsDirectory = path.join(this.rootDirectory, 'artifacts');
    this.locksDirectory = path.join(this.rootDirectory, 'locks');
    this.clock = clock;
    this.leaseMs = leaseMs;
    this.workerOnlineMs = workerOnlineMs;
    this.maxAttempts = maxAttempts;
    this.maxActivePerOwner = maxActivePerOwner;
    this.maxDailyPerOwner = maxDailyPerOwner;
    this.maxDailyPerIp = maxDailyPerIp;
    this.idFactory = idFactory;
    this.createQueue = Promise.resolve();
    this.claimQueue = Promise.resolve();
    this.lastWorkerPollAt = 0;
    this.lastWorkerId = null;
  }

  async initialize() {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o750 });
    await syncDirectory(path.dirname(this.rootDirectory));
    await Promise.all([
      mkdir(this.recordsDirectory, { recursive: true, mode: 0o750 }),
      mkdir(this.artifactsDirectory, { recursive: true, mode: 0o750 }),
      mkdir(this.locksDirectory, { recursive: true, mode: 0o750 }),
    ]);
    await syncDirectory(this.rootDirectory);
  }

  recordPath(id) {
    if (!PROP_CREATION_ID_PATTERN.test(id)) {
      throw new HttpError(404, 'prop_creation_not_found', 'Prop creation was not found');
    }
    return path.join(this.recordsDirectory, `${id}.json`);
  }

  artifactPath(record) {
    if (!validRecord(record) || !/^[a-f0-9]{64}$/.test(record.artifact?.sha256 ?? '')) {
      throw new Error('Stored prop creation artifact is invalid');
    }
    return path.join(this.artifactsDirectory, record.id, `${record.artifact.sha256}.zip`);
  }

  async get(id) {
    try {
      const record = JSON.parse(await readFile(this.recordPath(id), 'utf8'));
      if (!validRecord(record, id)) throw new Error(`Invalid prop creation record: ${id}`);
      return record;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async list() {
    const records = [];
    for (const name of (await readdir(this.recordsDirectory)).filter((entry) => entry.endsWith('.json')).sort()) {
      const record = JSON.parse(await readFile(path.join(this.recordsDirectory, name), 'utf8'));
      if (!validRecord(record)) throw new Error(`Invalid prop creation record: ${name}`);
      records.push(record);
    }
    return records;
  }

  async withLock(id, action) {
    const lockPath = path.join(this.locksDirectory, `${id}.lock`);
    let handle;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        handle = await open(lockPath, 'wx', 0o600);
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const info = await stat(lockPath).catch(() => null);
        if (attempt === 0 && info && this.clock() - info.mtimeMs > this.leaseMs) {
          await unlink(lockPath).catch(() => {});
          continue;
        }
        throw new HttpError(409, 'prop_creation_busy', 'This prop creation is being updated');
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

  workerStatus() {
    const online = this.lastWorkerPollAt > 0 && this.clock() - this.lastWorkerPollAt <= this.workerOnlineMs;
    return {
      online,
      lastSeenAt: this.lastWorkerPollAt ? new Date(this.lastWorkerPollAt).toISOString() : null,
    };
  }

  noteWorkerPoll(workerId) {
    this.lastWorkerPollAt = this.clock();
    this.lastWorkerId = workerId;
  }

  async create(submission) {
    const run = this.createQueue.then(() => this.createExclusive(submission));
    this.createQueue = run.catch(() => {});
    return run;
  }

  async createExclusive({ ownerId, prompt, channel, ip, autoPublish = false }) {
    const cleanPrompt = validatePropCreationPrompt(prompt);
    const records = await this.list();
    const activeStatuses = autoPublish
      ? new Set(['queued', 'running'])
      : new Set(['queued', 'running', 'pending_review']);
    const active = records.filter((record) => (
      record.ownerId === ownerId && activeStatuses.has(record.status)
    ));
    if (active.length >= this.maxActivePerOwner) {
      throw new HttpError(429, 'prop_creation_limit_reached', 'Finish or review an existing creation before submitting another');
    }
    const since = this.clock() - 24 * 60 * 60 * 1000;
    const recent = records.filter((record) => Date.parse(record.submittedAt) >= since);
    if (recent.filter((record) => record.ownerId === ownerId).length >= this.maxDailyPerOwner) {
      throw new HttpError(429, 'prop_creation_rate_limited', 'Daily prop creation limit reached');
    }
    const ipHash = sha256(`prop-creation-ip\0${ip}`);
    if (recent.filter((record) => record.ipHash === ipHash).length >= this.maxDailyPerIp) {
      throw new HttpError(429, 'prop_creation_rate_limited', 'Too many prop creations were submitted from this network');
    }
    const id = this.idFactory();
    if (!PROP_CREATION_ID_PATTERN.test(id)) throw new Error('Prop creation ID factory returned an invalid ID');
    const submittedAt = nowIso(this.clock);
    const record = {
      schemaVersion: 1,
      id,
      ownerId,
      prompt: cleanPrompt,
      channel,
      status: 'queued',
      stage: { code: 'queued', message: '等待这台 Mac 上的 Codex 接单', updatedAt: submittedAt },
      submittedAt,
      updatedAt: submittedAt,
      attempt: 0,
      ipHash,
      events: [{ type: 'submitted', at: submittedAt }],
    };
    await this.withLock(id, async () => atomicWriteJson(this.recordPath(id), record));
    return record;
  }

  async listOwner(ownerId) {
    return (await this.list())
      .filter((record) => record.ownerId === ownerId)
      .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt))
      .slice(0, MAX_OWNER_JOBS_RETURNED)
      .map((record) => this.ownerView(record));
  }

  ownerView(record) {
    const view = {
      id: record.id,
      prompt: record.prompt,
      channel: record.channel,
      status: record.status,
      stage: stageView(record),
      submittedAt: record.submittedAt,
      updatedAt: record.updatedAt,
    };
    if (record.proposal) {
      view.proposal = {
        name: record.proposal.name,
        summary: record.proposal.summary,
        kind: record.proposal.kind,
        catalogId: record.proposal.catalogId,
      };
    }
    if (record.review?.reason) view.reason = record.review.reason;
    if (record.failure?.message) view.failure = { message: record.failure.message };
    const publication = publicationView(record);
    if (publication) view.publication = publication;
    return view;
  }

  adminSummaryView(record) {
    return {
      ...this.ownerView(record),
      ownerId: record.ownerId,
      attempt: record.attempt,
      artifactBytes: record.artifact?.bytes ?? null,
    };
  }

  adminDetailView(record) {
    const codexThreadId = record.proposal?.codexThreadId ?? null;
    return {
      ...this.adminSummaryView(record),
      proposal: record.proposal ?? null,
      codexUrl: codexThreadId ? `codex://threads/${codexThreadId}` : null,
      changedFiles: record.artifact?.changedFiles ?? [],
      artifactSha256: record.artifact?.sha256 ?? null,
      artifactUrl: record.artifact ? `/api/admin/prop-creations/${record.id}/artifact` : null,
      review: record.review ?? null,
      publication: publicationView(record),
      events: Array.isArray(record.events) ? record.events : [],
    };
  }

  async claim(workerId) {
    const run = this.claimQueue.then(async () => {
      this.noteWorkerPoll(workerId);
      const records = (await this.list()).sort((left, right) => left.submittedAt.localeCompare(right.submittedAt));
      for (const stale of records.filter((record) => record.status === 'running' && !leaseIsActive(record, this.clock()))) {
        await this.withLock(stale.id, async () => {
          const current = await this.get(stale.id);
          if (!current || current.status !== 'running' || leaseIsActive(current, this.clock())) return;
          const publishing = publicationInProgress(current);
          const updatedAt = nowIso(this.clock);
          if (publishing) {
            const updated = {
              ...current,
              status: 'running',
              stage: {
                code: 'publishing',
                message: '上次自动发布连接中断，正在安全恢复',
                updatedAt,
              },
              updatedAt,
              publication: {
                ...current.publication,
                status: 'publishing',
                updatedAt,
              },
              events: appendEvent(current, 'publication_requeued', updatedAt, {
                code: 'publication_lease_expired',
                attempt: publicationAttempt(current),
              }),
            };
            delete updated.lease;
            delete updated.failure;
            await atomicWriteJson(this.recordPath(updated.id), updated);
            return;
          }
          const terminal = current.attempt >= this.maxAttempts;
          const failureCode = 'worker_lease_expired';
          const failureMessage = '本机 Codex 处理超时';
          const updated = {
            ...current,
            status: terminal ? 'failed' : 'queued',
            stage: {
              code: terminal ? 'failed' : 'queued',
              message: terminal ? '本机 Codex 多次超时，任务已停止' : '上次本机任务超时，正在重新排队',
              updatedAt,
            },
            updatedAt,
            events: appendEvent(
              current,
              terminal ? 'worker_failed' : 'requeued',
              updatedAt,
              { code: failureCode, attempt: current.attempt },
            ),
          };
          delete updated.lease;
          if (terminal) updated.failure = { code: failureCode, message: failureMessage, at: updatedAt };
          await atomicWriteJson(this.recordPath(updated.id), updated);
        });
      }
      const activeLease = (await this.list())
        .filter((record) => record.status === 'running' && leaseIsActive(record, this.clock()))
        .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt))[0];
      if (activeLease && activeLease.lease?.workerId !== workerId) return null;
      const existingLease = (await this.list())
        .filter((record) => (
          record.status === 'running'
          && record.lease?.workerId === workerId
          && leaseIsActive(record, this.clock())
        ))
        .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt))[0];
      if (existingLease) {
        return this.withLock(existingLease.id, async () => {
          const current = await this.get(existingLease.id);
          if (
            !current
            || current.status !== 'running'
            || current.lease?.workerId !== workerId
            || !leaseIsActive(current, this.clock())
          ) return null;
          const leaseToken = randomBytes(32).toString('hex');
          const updatedAt = nowIso(this.clock);
          const resumingPublication = publicationInProgress(current);
          const updated = {
            ...current,
            updatedAt,
            lease: {
              ...current.lease,
              tokenHash: sha256(leaseToken),
              expiresAt: new Date(this.clock() + this.leaseMs).toISOString(),
            },
            ...(resumingPublication ? {
              publication: {
                ...current.publication,
                workerId,
                tokenHash: sha256(leaseToken),
                attempt: nextPublicationAttempt(current),
                updatedAt,
              },
            } : {}),
            events: appendEvent(current, 'lease_resumed', updatedAt, {
              workerId,
              attempt: resumingPublication ? nextPublicationAttempt(current) : current.attempt,
            }),
          };
          await atomicWriteJson(this.recordPath(updated.id), updated);
          return {
            job: workerJobView(updated),
            leaseToken,
            leaseExpiresAt: updated.lease.expiresAt,
            resumed: true,
          };
        });
      }
      const resumablePublication = (await this.list())
        .filter((record) => publicationInProgress(record) && !leaseIsActive(record, this.clock()))
        .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt))[0];
      if (resumablePublication) {
        return this.withLock(resumablePublication.id, async () => {
          const current = await this.get(resumablePublication.id);
          if (!current || !publicationInProgress(current) || leaseIsActive(current, this.clock())) return null;
          const updatedAt = nowIso(this.clock);
          const leaseToken = randomBytes(32).toString('hex');
          const updated = {
            ...current,
            updatedAt,
            lease: {
              workerId,
              tokenHash: sha256(leaseToken),
              claimedAt: updatedAt,
              expiresAt: new Date(this.clock() + this.leaseMs).toISOString(),
            },
            publication: {
              ...current.publication,
              workerId,
              tokenHash: sha256(leaseToken),
              attempt: nextPublicationAttempt(current),
              updatedAt,
            },
            events: appendEvent(current, 'lease_resumed', updatedAt, {
              workerId,
              attempt: nextPublicationAttempt(current),
            }),
          };
          await atomicWriteJson(this.recordPath(updated.id), updated);
          return {
            job: workerJobView(updated),
            leaseToken,
            leaseExpiresAt: updated.lease.expiresAt,
            resumed: true,
          };
        });
      }
      const queued = (await this.list())
        .filter((record) => record.status === 'queued')
        .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt))[0];
      if (!queued) return null;
      return this.withLock(queued.id, async () => {
        const current = await this.get(queued.id);
        if (!current || current.status !== 'queued') return null;
        const leaseToken = randomBytes(32).toString('hex');
        const updatedAt = nowIso(this.clock);
        const updated = {
          ...current,
          status: 'running',
          stage: { code: 'claimed', message: '这台 Mac 上的 Codex 已接单', updatedAt },
          updatedAt,
          attempt: current.attempt + 1,
          lease: {
            workerId,
            tokenHash: sha256(leaseToken),
            claimedAt: updatedAt,
            expiresAt: new Date(this.clock() + this.leaseMs).toISOString(),
          },
          events: appendEvent(current, 'claimed', updatedAt, { workerId, attempt: current.attempt + 1 }),
        };
        delete updated.failure;
        await atomicWriteJson(this.recordPath(updated.id), updated);
        return {
          job: workerJobView(updated),
          leaseToken,
          leaseExpiresAt: updated.lease.expiresAt,
        };
      });
    });
    this.claimQueue = run.catch(() => {});
    return run;
  }

  requireLease(record, workerId, leaseToken) {
    if (
      record.status !== 'running'
      || record.lease?.workerId !== workerId
      || !leaseIsActive(record, this.clock())
      || !tokenMatches(leaseToken, record.lease.tokenHash)
    ) {
      throw new HttpError(409, 'prop_creation_lease_lost', 'This worker no longer owns the prop creation');
    }
  }

  async assertLease(id, { workerId, leaseToken }) {
    const record = await this.get(id);
    if (!record) throw new HttpError(404, 'prop_creation_not_found', 'Prop creation was not found');
    this.requireLease(record, workerId, leaseToken);
    return record;
  }

  async progress(id, { workerId, leaseToken, stage, message }) {
    if (!['preparing', 'generating', 'validating', 'uploading'].includes(stage)) {
      throw new HttpError(422, 'invalid_prop_stage', 'Worker progress stage is invalid');
    }
    const cleanMessage = normalizedText(message, 240);
    if (!cleanMessage) throw new HttpError(422, 'invalid_prop_stage', 'Worker progress message is invalid');
    return this.withLock(id, async () => {
      const record = await this.get(id);
      if (!record) throw new HttpError(404, 'prop_creation_not_found', 'Prop creation was not found');
      this.requireLease(record, workerId, leaseToken);
      const updatedAt = nowIso(this.clock);
      const updated = {
        ...record,
        stage: { code: stage, message: cleanMessage, updatedAt },
        updatedAt,
        lease: { ...record.lease, expiresAt: new Date(this.clock() + this.leaseMs).toISOString() },
      };
      await atomicWriteJson(this.recordPath(id), updated);
      return this.ownerView(updated);
    });
  }

  async complete(id, {
    workerId,
    leaseToken,
    extractionRoot,
    archiveBuffer,
    autoPublish = false,
  }) {
    if (!Buffer.isBuffer(archiveBuffer) || archiveBuffer.length === 0 || archiveBuffer.length > MAX_PROP_ARTIFACT_BYTES) {
      throw new HttpError(413, 'prop_artifact_too_large', 'Prop artifact exceeds the 8 MB limit');
    }
    await this.assertLease(id, { workerId, leaseToken });
    const root = await realpath(extractionRoot);
    const files = await listArtifactFiles(root);
    if (files.length !== SAFE_ARTIFACT_FILES.size || files.some((file) => !SAFE_ARTIFACT_FILES.has(file))) {
      throw new HttpError(422, 'invalid_prop_artifact', 'Artifact must contain only proposal.json and changes.patch');
    }
    const patchFile = path.join(root, 'changes.patch');
    const patchInfo = await stat(patchFile);
    if (!patchInfo.isFile() || patchInfo.size === 0 || patchInfo.size > MAX_PROP_PATCH_BYTES) {
      throw new HttpError(422, 'invalid_prop_patch', 'Generated patch size is invalid');
    }
    let patch;
    try {
      patch = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(patchFile));
    } catch {
      throw new HttpError(422, 'invalid_prop_patch', 'Generated patch must use valid UTF-8');
    }
    const { changedFiles, createdFiles } = patchPaths(patch);
    const proposalFile = path.join(root, 'proposal.json');
    const proposalInfo = await stat(proposalFile);
    if (!proposalInfo.isFile() || proposalInfo.size === 0 || proposalInfo.size > MAX_PROP_PROPOSAL_BYTES) {
      throw new HttpError(422, 'invalid_prop_proposal', 'proposal.json size is invalid');
    }
    let proposalJson;
    try {
      const proposalText = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(proposalFile));
      proposalJson = JSON.parse(proposalText);
    } catch {
      throw new HttpError(422, 'invalid_prop_proposal', 'proposal.json must be valid UTF-8 JSON');
    }
    const proposal = validateProposal(proposalJson, id, changedFiles, createdFiles);
    return this.withLock(id, async () => {
      const record = await this.get(id);
      if (!record) throw new HttpError(404, 'prop_creation_not_found', 'Prop creation was not found');
      this.requireLease(record, workerId, leaseToken);
      const artifactSha256 = sha256(archiveBuffer);
      const destinationDirectory = path.join(this.artifactsDirectory, id);
      const destination = path.join(destinationDirectory, `${artifactSha256}.zip`);
      await mkdir(destinationDirectory, { recursive: true, mode: 0o750 });
      await syncDirectory(this.artifactsDirectory);
      const temporary = path.join(destinationDirectory, `.${artifactSha256}.${process.pid}.${Date.now()}.tmp`);
      let handle;
      try {
        handle = await open(temporary, 'wx', 0o640);
        await handle.writeFile(archiveBuffer);
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(temporary, destination).catch(async (error) => {
          if (error.code !== 'EEXIST') throw error;
          await unlink(temporary).catch(() => {});
        });
        await syncDirectory(destinationDirectory);
      } catch (error) {
        await handle?.close().catch(() => {});
        await unlink(temporary).catch(() => {});
        throw error;
      }
      const updatedAt = nowIso(this.clock);
      const uploadedEvents = appendEvent(record, 'artifact_uploaded', updatedAt, {
        sha256: artifactSha256,
        catalogId: proposal.catalogId,
      });
      const updated = {
        ...record,
        status: autoPublish ? 'running' : 'pending_review',
        stage: autoPublish
          ? { code: 'publishing', message: '自动校验已通过，正在准备合并与发布', updatedAt }
          : { code: 'pending_review', message: 'Codex 已完成，等待管理员审核', updatedAt },
        updatedAt,
        proposal,
        artifact: {
          sha256: artifactSha256,
          bytes: archiveBuffer.length,
          changedFiles,
          uploadedAt: updatedAt,
        },
        events: autoPublish
          ? appendEvent({ ...record, events: uploadedEvents }, 'publication_started', updatedAt, {
            mode: 'automatic',
            workerId,
          })
          : uploadedEvents,
      };
      if (autoPublish) {
        updated.lease = {
          ...record.lease,
          expiresAt: new Date(this.clock() + this.leaseMs).toISOString(),
        };
        updated.publication = {
          mode: 'automatic',
          status: 'publishing',
          attempt: 1,
          workerId,
          tokenHash: record.lease.tokenHash,
          startedAt: updatedAt,
          updatedAt,
        };
      } else {
        delete updated.lease;
      }
      delete updated.failure;
      await atomicWriteJson(this.recordPath(id), updated);
      return this.ownerView(updated);
    });
  }

  requirePublicationLease(record, workerId, leaseToken) {
    if (
      record.publication?.mode !== 'automatic'
      || record.publication.workerId !== workerId
      || !tokenMatches(leaseToken, record.publication.tokenHash)
    ) {
      throw new HttpError(409, 'prop_publication_lease_lost', 'This worker no longer owns the prop publication');
    }
  }

  async publicationProgress(id, { workerId, leaseToken, stage, message }) {
    if (!PROP_PUBLICATION_PROGRESS_STAGES.has(stage)) {
      throw new HttpError(422, 'invalid_prop_stage', 'Publication progress stage is invalid');
    }
    const cleanMessage = normalizedText(message, 240);
    if (!cleanMessage) throw new HttpError(422, 'invalid_prop_stage', 'Publication progress message is invalid');
    return this.withLock(id, async () => {
      const record = await this.get(id);
      if (!record) throw new HttpError(404, 'prop_creation_not_found', 'Prop creation was not found');
      this.requirePublicationLease(record, workerId, leaseToken);
      if (!publicationInProgress(record)) {
        throw new HttpError(409, 'invalid_transition', 'Only active automatic publications can report progress');
      }
      const updatedAt = nowIso(this.clock);
      const updated = {
        ...record,
        stage: { code: stage, message: cleanMessage, updatedAt },
        updatedAt,
        lease: { ...record.lease, expiresAt: new Date(this.clock() + this.leaseMs).toISOString() },
        publication: {
          ...record.publication,
          status: 'publishing',
          updatedAt,
        },
      };
      await atomicWriteJson(this.recordPath(id), updated);
      return this.ownerView(updated);
    });
  }

  async publicationSucceeded(id, { workerId, leaseToken, release }) {
    return this.withLock(id, async () => {
      const record = await this.get(id);
      if (!record) throw new HttpError(404, 'prop_creation_not_found', 'Prop creation was not found');
      this.requirePublicationLease(record, workerId, leaseToken);
      const cleanRelease = publicationRelease(release, record.proposal?.catalogId);
      if (record.status === 'approved' && record.stage?.code === 'published') {
        if (JSON.stringify(record.publication?.release) !== JSON.stringify(cleanRelease)) {
          throw new HttpError(409, 'invalid_transition', 'Publication was already completed with different release metadata');
        }
        return this.ownerView(record);
      }
      if (!publicationInProgress(record)) {
        throw new HttpError(409, 'invalid_transition', 'Only active automatic publications can complete');
      }
      const updatedAt = nowIso(this.clock);
      const updated = {
        ...record,
        status: 'approved',
        stage: { code: 'published', message: '物件已自动发布并可在大厅目录中使用', updatedAt },
        updatedAt,
        publication: {
          ...record.publication,
          status: 'published',
          updatedAt,
          publishedAt: updatedAt,
          release: cleanRelease,
        },
        events: appendEvent(record, 'published', updatedAt, {
          releaseId: cleanRelease.id,
          catalogId: cleanRelease.catalogId,
        }),
      };
      delete updated.lease;
      delete updated.failure;
      await atomicWriteJson(this.recordPath(id), updated);
      return this.ownerView(updated);
    });
  }

  async publicationFailed(id, {
    workerId,
    leaseToken,
    code,
    message,
    rollback,
  }) {
    const cleanCode = typeof code === 'string' && /^[a-z0-9_]{3,80}$/.test(code)
      ? code
      : null;
    const cleanMessage = normalizedText(message, MAX_PROP_FAILURE_CHARACTERS);
    const cleanRollback = publicationRollback(rollback);
    if (!cleanCode || !cleanMessage) {
      throw new HttpError(422, 'invalid_prop_publication', 'Publication failure details are invalid');
    }
    return this.withLock(id, async () => {
      const record = await this.get(id);
      if (!record) throw new HttpError(404, 'prop_creation_not_found', 'Prop creation was not found');
      this.requirePublicationLease(record, workerId, leaseToken);
      if (record.status === 'failed' && record.stage?.code === 'publish_failed') {
        const existing = record.publication?.failure;
        if (
          existing?.code !== cleanCode
          || existing?.message !== cleanMessage
          || JSON.stringify(existing.rollback) !== JSON.stringify(cleanRollback)
        ) {
          throw new HttpError(409, 'invalid_transition', 'Publication failure was already recorded with different details');
        }
        return this.ownerView(record);
      }
      if (!publicationInProgress(record)) {
        throw new HttpError(409, 'invalid_transition', 'Only active automatic publications can fail');
      }
      const updatedAt = nowIso(this.clock);
      const failure = {
        code: cleanCode,
        message: cleanMessage,
        rollback: cleanRollback,
      };
      const updated = {
        ...record,
        status: 'failed',
        stage: { code: 'publish_failed', message: cleanMessage, updatedAt },
        updatedAt,
        failure: { code: cleanCode, message: cleanMessage, at: updatedAt },
        publication: {
          ...record.publication,
          status: 'failed',
          updatedAt,
          failedAt: updatedAt,
          failure,
        },
        events: appendEvent(record, 'publish_failed', updatedAt, {
          code: cleanCode,
          rollback: cleanRollback,
        }),
      };
      delete updated.lease;
      await atomicWriteJson(this.recordPath(id), updated);
      return this.ownerView(updated);
    });
  }

  async fail(id, { workerId, leaseToken, code, message, retryable = false }) {
    const cleanCode = typeof code === 'string' && /^[a-z0-9_]{3,80}$/.test(code) ? code : 'codex_worker_failed';
    const cleanMessage = normalizedText(message, MAX_PROP_FAILURE_CHARACTERS) ?? '这台 Mac 上的 Codex 未能完成物件';
    return this.withLock(id, async () => {
      const record = await this.get(id);
      if (!record) throw new HttpError(404, 'prop_creation_not_found', 'Prop creation was not found');
      this.requireLease(record, workerId, leaseToken);
      const shouldRetry = retryable === true && record.attempt < this.maxAttempts;
      const updatedAt = nowIso(this.clock);
      const updated = {
        ...record,
        status: shouldRetry ? 'queued' : 'failed',
        stage: {
          code: shouldRetry ? 'queued' : 'failed',
          message: shouldRetry ? '本机处理暂时失败，任务已重新排队' : cleanMessage,
          updatedAt,
        },
        updatedAt,
        failure: { code: cleanCode, message: cleanMessage, at: updatedAt, retryable: shouldRetry },
        events: appendEvent(record, shouldRetry ? 'requeued' : 'worker_failed', updatedAt, {
          code: cleanCode,
          attempt: record.attempt,
        }),
      };
      delete updated.lease;
      await atomicWriteJson(this.recordPath(id), updated);
      return this.ownerView(updated);
    });
  }

  async cancel(id, ownerId) {
    return this.withLock(id, async () => {
      const record = await this.get(id);
      if (!record || record.ownerId !== ownerId) {
        throw new HttpError(404, 'prop_creation_not_found', 'Prop creation was not found');
      }
      if (record.status !== 'queued') {
        throw new HttpError(409, 'prop_creation_cannot_cancel', 'Only queued prop creations can be cancelled');
      }
      const updatedAt = nowIso(this.clock);
      const updated = {
        ...record,
        status: 'cancelled',
        stage: { code: 'cancelled', message: '任务已取消', updatedAt },
        updatedAt,
        events: appendEvent(record, 'cancelled', updatedAt),
      };
      await atomicWriteJson(this.recordPath(id), updated);
      return this.ownerView(updated);
    });
  }

  async review(id, status, reason = undefined) {
    if (status !== 'approved' && status !== 'rejected') {
      throw new HttpError(422, 'invalid_prop_review', 'Review status is invalid');
    }
    const cleanReason = status === 'rejected'
      ? normalizedText(reason, MAX_PROP_REVIEW_REASON_CHARACTERS)
      : null;
    if (status === 'rejected' && !cleanReason) {
      throw new HttpError(422, 'invalid_reason', 'Rejection reason must use 1-500 characters');
    }
    return this.withLock(id, async () => {
      const record = await this.get(id);
      if (!record) throw new HttpError(404, 'prop_creation_not_found', 'Prop creation was not found');
      if (record.status !== 'pending_review') {
        throw new HttpError(409, 'invalid_transition', 'Only pending prop creations can be reviewed');
      }
      const updatedAt = nowIso(this.clock);
      const updated = {
        ...record,
        status,
        stage: {
          code: status,
          message: status === 'approved' ? '审核已通过，等待合并并随版本发布' : '审核未通过，请根据原因重新创作',
          updatedAt,
        },
        updatedAt,
        review: {
          status,
          reviewedAt: updatedAt,
          ...(cleanReason ? { reason: cleanReason } : {}),
        },
        events: appendEvent(record, 'reviewed', updatedAt, { status }),
      };
      await atomicWriteJson(this.recordPath(id), updated);
      return updated;
    });
  }

  async removeArtifact(id) {
    await rm(path.join(this.artifactsDirectory, id), { recursive: true, force: true });
  }
}

export async function sendPropArtifact(request, response, store, record) {
  const filePath = store.artifactPath(record);
  const resolved = await realpath(filePath);
  const artifactRoot = await realpath(path.join(store.artifactsDirectory, record.id));
  if (path.dirname(resolved) !== artifactRoot) {
    throw new Error('Stored prop creation artifact escapes its directory');
  }
  const info = await stat(resolved);
  if (!info.isFile()) throw new HttpError(404, 'prop_artifact_not_found', 'Prop artifact was not found');
  const headers = {
    'Content-Type': 'application/zip',
    'Content-Length': info.size,
    'Content-Disposition': `attachment; filename="${record.id}.zip"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  response.writeHead(200, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  await new Promise((resolve, reject) => {
    const stream = createReadStream(resolved);
    stream.once('error', reject);
    response.once('error', reject);
    response.once('finish', resolve);
    stream.pipe(response);
  });
}
