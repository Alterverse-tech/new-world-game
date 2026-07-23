export const MAX_LOBBY_PROP_PROMPT_CHARACTERS = 600;
const JOB_ID_PATTERN = /^propjob-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CHANNEL_PATTERN = /^\d{4,12}$/;
const THREAD_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const STATUSES = [
  'queued',
  'running',
  'pending_review',
  'approved',
  'rejected',
  'failed',
  'cancelled',
] as const;
const STAGES = [
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
] as const;

export type LobbyPropCreationStatus = typeof STATUSES[number];
export type LobbyPropCreationStageCode = typeof STAGES[number];

export interface LobbyPropCreationStage {
  code: LobbyPropCreationStageCode;
  message: string;
  updatedAt: string;
}

export interface LobbyPropCreationProposal {
  name: string;
  summary: string;
  kind: 'code';
  catalogId: string;
  codexThreadId?: string;
}

export interface LobbyPropCreationRelease {
  id: string;
  catalogId: string;
  gameRelease: string;
  platformRelease: string;
  gameSha256: string;
  platformSha256: string;
  publicUrl: string;
}

export interface LobbyPropCreationPublication {
  mode: 'automatic';
  status: 'publishing' | 'published' | 'failed';
  startedAt: string;
  updatedAt: string;
  publishedAt?: string;
  failedAt?: string;
  release?: LobbyPropCreationRelease;
  failure?: {
    code: string;
    message: string;
    rollback: { attempted: boolean; succeeded: boolean };
  };
}

export interface LobbyPropCreationJob {
  id: string;
  prompt: string;
  channel: string;
  status: LobbyPropCreationStatus;
  stage: LobbyPropCreationStage;
  submittedAt: string;
  updatedAt: string;
  proposal?: LobbyPropCreationProposal;
  publication?: LobbyPropCreationPublication;
  reason?: string;
  failure?: { message: string };
}

export interface LobbyPropCreationWorkerState {
  online: boolean;
  lastSeenAt: string | null;
}

export interface LobbyPropCreationList {
  jobs: LobbyPropCreationJob[];
  worker: LobbyPropCreationWorkerState;
}

export interface LobbyPropCreationConfig {
  enabled: boolean;
  requiresAccount: true;
  maximumPromptCharacters: number;
  publicationMode: 'automatic' | 'manual';
  worker: LobbyPropCreationWorkerState;
}

export class LobbyPropCreationRequestError extends Error {
  public readonly status: number;
  public readonly code: string;

  public constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'LobbyPropCreationRequestError';
    this.status = status;
    this.code = code;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  return typeof value === 'string' && allowed.includes(value as T[number]) ? value as T[number] : null;
}

function containsUnsafeControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if ((code < 32 && code !== 9 && code !== 10) || code === 127) return true;
  }
  return false;
}

function safeText(value: unknown, maximumCharacters: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  const length = [...normalized].length;
  return length >= 1
    && length <= maximumCharacters
    && !containsUnsafeControl(normalized)
    ? normalized
    : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function parseWorker(value: unknown): LobbyPropCreationWorkerState {
  const source = record(value);
  const lastSeenAt = source?.lastSeenAt === null ? null : timestamp(source?.lastSeenAt);
  if (!source || typeof source.online !== 'boolean' || (source.lastSeenAt !== null && !lastSeenAt)) {
    throw new LobbyPropCreationRequestError(500, 'invalid_prop_response', '平台返回了无法识别的创作电脑状态');
  }
  return { online: source.online, lastSeenAt };
}

function parseProposal(value: unknown): LobbyPropCreationProposal | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  const name = safeText(source?.name, 40);
  const summary = safeText(source?.summary, 600);
  const catalogId = typeof source?.catalogId === 'string' && /^code-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.catalogId)
    ? source.catalogId
    : null;
  const codexThreadId = source?.codexThreadId === undefined
    ? undefined
    : typeof source.codexThreadId === 'string' && THREAD_ID_PATTERN.test(source.codexThreadId)
      ? source.codexThreadId
      : null;
  if (!source || !name || !summary || source.kind !== 'code' || !catalogId || codexThreadId === null) {
    throw new LobbyPropCreationRequestError(500, 'invalid_prop_response', '平台返回了无法识别的物件候选');
  }
  return { name, summary, kind: 'code', catalogId, ...(codexThreadId ? { codexThreadId } : {}) };
}

function parsePublication(value: unknown): LobbyPropCreationPublication | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  const status = oneOf(source?.status, ['publishing', 'published', 'failed'] as const);
  const startedAt = timestamp(source?.startedAt);
  const updatedAt = timestamp(source?.updatedAt);
  const publishedAt = timestamp(source?.publishedAt);
  const failedAt = timestamp(source?.failedAt);
  const releaseSource = source?.release === undefined ? undefined : record(source.release);
  const id = releaseSource === undefined ? undefined : safeText(releaseSource?.id, 160);
  const catalogId = releaseSource === undefined
    ? undefined
    : typeof releaseSource?.catalogId === 'string'
      && /^code-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(releaseSource.catalogId)
      ? releaseSource.catalogId
      : null;
  const gameRelease = releaseSource === undefined ? undefined : safeText(releaseSource?.gameRelease, 160);
  const platformRelease = releaseSource === undefined ? undefined : safeText(releaseSource?.platformRelease, 160);
  const gameSha256 = releaseSource === undefined
    ? undefined
    : typeof releaseSource?.gameSha256 === 'string' && /^[a-f0-9]{64}$/.test(releaseSource.gameSha256)
      ? releaseSource.gameSha256
      : null;
  const platformSha256 = releaseSource === undefined
    ? undefined
    : typeof releaseSource?.platformSha256 === 'string' && /^[a-f0-9]{64}$/.test(releaseSource.platformSha256)
      ? releaseSource.platformSha256
      : null;
  const publicUrl = releaseSource === undefined || typeof releaseSource?.publicUrl !== 'string'
    ? undefined
    : releaseSource.publicUrl;
  let parsedPublicUrl: URL | null = null;
  try {
    parsedPublicUrl = publicUrl ? new URL(publicUrl) : null;
  } catch {
    parsedPublicUrl = null;
  }
  const failureSource = source?.failure === undefined ? undefined : record(source.failure);
  const failureCode = failureSource === undefined
    ? undefined
    : typeof failureSource?.code === 'string' && /^[a-z0-9_]{3,80}$/.test(failureSource.code)
      ? failureSource.code
      : null;
  const failureMessage = failureSource === undefined ? undefined : safeText(failureSource?.message, 500);
  const rollbackSource = failureSource === undefined ? undefined : record(failureSource?.rollback);
  const rollback = failureSource === undefined
    ? undefined
    : rollbackSource
      && typeof rollbackSource.attempted === 'boolean'
      && typeof rollbackSource.succeeded === 'boolean'
      && (!rollbackSource.succeeded || rollbackSource.attempted)
      ? { attempted: rollbackSource.attempted, succeeded: rollbackSource.succeeded }
      : null;
  if (
    !source
    || source.mode !== 'automatic'
    || !status
    || !startedAt
    || !updatedAt
    || (source.publishedAt !== undefined && !publishedAt)
    || (source.failedAt !== undefined && !failedAt)
    || (releaseSource !== undefined && (
      !id
      || !catalogId
      || !gameRelease
      || !platformRelease
      || !gameSha256
      || !platformSha256
      || !parsedPublicUrl
      || parsedPublicUrl.protocol !== 'https:'
      || parsedPublicUrl.username
      || parsedPublicUrl.password
      || parsedPublicUrl.hash
    ))
    || (failureSource !== undefined && (!failureCode || !failureMessage || !rollback))
    || (status === 'published' && (!publishedAt || !releaseSource))
    || (status === 'failed' && (!failedAt || !failureSource))
  ) {
    throw new LobbyPropCreationRequestError(500, 'invalid_prop_response', '平台返回了无法识别的物件发布记录');
  }
  return {
    mode: 'automatic',
    status,
    startedAt,
    updatedAt,
    ...(publishedAt ? { publishedAt } : {}),
    ...(failedAt ? { failedAt } : {}),
    ...(releaseSource ? {
      release: {
        id: id!,
        catalogId: catalogId!,
        gameRelease: gameRelease!,
        platformRelease: platformRelease!,
        gameSha256: gameSha256!,
        platformSha256: platformSha256!,
        publicUrl: parsedPublicUrl!.toString(),
      },
    } : {}),
    ...(failureSource ? {
      failure: {
        code: failureCode!,
        message: failureMessage!,
        rollback: rollback!,
      },
    } : {}),
  };
}

export function normalizeLobbyPropPrompt(value: string): string {
  return value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

export function lobbyPropPromptIsValid(value: string): boolean {
  const prompt = normalizeLobbyPropPrompt(value);
  return [...prompt].length >= 4
    && [...prompt].length <= MAX_LOBBY_PROP_PROMPT_CHARACTERS
    && !containsUnsafeControl(prompt);
}

export function parseLobbyPropCreationJob(value: unknown): LobbyPropCreationJob {
  const source = record(value);
  const stageSource = record(source?.stage);
  const id = typeof source?.id === 'string' && JOB_ID_PATTERN.test(source.id) ? source.id : null;
  const prompt = safeText(source?.prompt, MAX_LOBBY_PROP_PROMPT_CHARACTERS);
  const channel = typeof source?.channel === 'string' && CHANNEL_PATTERN.test(source.channel) ? source.channel : null;
  const status = oneOf(source?.status, STATUSES);
  const stageCode = oneOf(stageSource?.code, STAGES);
  const stageMessage = safeText(stageSource?.message, 240);
  const stageUpdatedAt = timestamp(stageSource?.updatedAt);
  const submittedAt = timestamp(source?.submittedAt);
  const updatedAt = timestamp(source?.updatedAt);
  if (!source || !id || !prompt || !channel || !status || !stageCode || !stageMessage || !stageUpdatedAt || !submittedAt || !updatedAt) {
    throw new LobbyPropCreationRequestError(500, 'invalid_prop_response', '平台返回了无法识别的物件创作任务');
  }
  const reason = source.reason === undefined ? undefined : safeText(source.reason, 500);
  const failureSource = source.failure === undefined ? undefined : record(source.failure);
  const failureMessage = failureSource === undefined ? undefined : safeText(failureSource?.message, 500);
  if (reason === null || failureMessage === null) {
    throw new LobbyPropCreationRequestError(500, 'invalid_prop_response', '平台返回了无效的任务说明');
  }
  return {
    id,
    prompt,
    channel,
    status,
    stage: { code: stageCode, message: stageMessage, updatedAt: stageUpdatedAt },
    submittedAt,
    updatedAt,
    ...(source.proposal !== undefined ? { proposal: parseProposal(source.proposal) } : {}),
    ...(source.publication !== undefined ? { publication: parsePublication(source.publication) } : {}),
    ...(reason ? { reason } : {}),
    ...(failureMessage ? { failure: { message: failureMessage } } : {}),
  };
}

async function jsonRequest(pathname: string, options: RequestInit = {}): Promise<unknown> {
  const response = await fetch(pathname, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text) as unknown; } catch { payload = null; }
  }
  if (!response.ok) {
    const error = record(record(payload)?.error);
    const code = typeof error?.code === 'string' && /^[a-z0-9_]{3,80}$/.test(error.code)
      ? error.code
      : `prop_http_${response.status}`;
    const message = safeText(error?.message, 500) ?? `物件创作请求失败（HTTP ${response.status}）`;
    throw new LobbyPropCreationRequestError(response.status, code, message);
  }
  return payload;
}

export async function fetchLobbyPropCreationConfig(signal?: AbortSignal): Promise<LobbyPropCreationConfig> {
  const source = record(await jsonRequest('/api/account/prop-creations/config', { signal }));
  if (
    !source
    || typeof source.enabled !== 'boolean'
    || source.requiresAccount !== true
    || source.maximumPromptCharacters !== MAX_LOBBY_PROP_PROMPT_CHARACTERS
    || (source.publicationMode !== 'automatic' && source.publicationMode !== 'manual')
  ) {
    throw new LobbyPropCreationRequestError(500, 'invalid_prop_response', '平台返回了无效的创作配置');
  }
  return {
    enabled: source.enabled,
    requiresAccount: true,
    maximumPromptCharacters: source.maximumPromptCharacters,
    publicationMode: source.publicationMode,
    worker: parseWorker(source.worker),
  };
}

export async function fetchLobbyPropCreations(signal?: AbortSignal): Promise<LobbyPropCreationList> {
  const source = record(await jsonRequest('/api/account/prop-creations', { signal }));
  if (!source || source.schemaVersion !== 1 || !Array.isArray(source.jobs)) {
    throw new LobbyPropCreationRequestError(500, 'invalid_prop_response', '平台返回了无效的任务列表');
  }
  return {
    jobs: source.jobs.map(parseLobbyPropCreationJob),
    worker: parseWorker(source.worker),
  };
}

export async function submitLobbyPropCreation(
  promptValue: string,
  channel: string,
  signal?: AbortSignal,
): Promise<{ job: LobbyPropCreationJob; worker: LobbyPropCreationWorkerState }> {
  const prompt = normalizeLobbyPropPrompt(promptValue);
  if (!lobbyPropPromptIsValid(prompt)) {
    throw new LobbyPropCreationRequestError(422, 'invalid_prop_prompt', '请用 4–600 个字符描述想创作的物件');
  }
  if (!CHANNEL_PATTERN.test(channel)) {
    throw new LobbyPropCreationRequestError(422, 'invalid_lobby_channel', '请先进入有效频道');
  }
  const source = record(await jsonRequest('/api/account/prop-creations', {
    method: 'POST',
    body: JSON.stringify({ prompt, channel }),
    signal,
  }));
  if (!source) throw new LobbyPropCreationRequestError(500, 'invalid_prop_response', '平台没有返回创作任务');
  return {
    job: parseLobbyPropCreationJob(source.job),
    worker: parseWorker(source.worker),
  };
}

export async function cancelLobbyPropCreation(
  jobId: string,
  signal?: AbortSignal,
): Promise<LobbyPropCreationJob> {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new LobbyPropCreationRequestError(404, 'prop_creation_not_found', '任务不存在');
  }
  const source = record(await jsonRequest(`/api/account/prop-creations/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    body: '{}',
    signal,
  }));
  return parseLobbyPropCreationJob(source?.job);
}

export function lobbyPropCreationErrorMessage(error: unknown): string {
  if (!(error instanceof LobbyPropCreationRequestError)) return '暂时无法连接物件创作服务，请稍后重试';
  const messages: Record<string, string> = {
    account_session_required: '请先登录邮箱账号，再把创作需求发送到这台 Mac 上的 Codex',
    prop_creation_unavailable: '这台 Mac 的 Codex 桥接尚未配置',
    prop_creation_limit_reached: '已有任务正在创作或自动发布，请先等待现有任务完成',
    prop_creation_rate_limited: '今天的创作次数已用完，请稍后再试',
    invalid_prop_prompt: '请用 4–600 个字符描述想创作的物件',
    prop_creation_cannot_cancel: 'Codex 已经开始处理，不能再取消这个任务',
    prop_creation_not_found: '这个创作任务不存在或不属于当前账号',
  };
  return messages[error.code] ?? error.message;
}

export function lobbyPropCreationStatusLabel(job: LobbyPropCreationJob): string {
  const labels: Record<LobbyPropCreationStatus, string> = {
    queued: '等待这台 Mac',
    running: job.stage.code === 'publishing'
      || job.stage.code === 'building'
      || job.stage.code === 'deploying'
      || job.stage.code === 'verifying'
      ? '自动发布中'
      : 'Codex 创作中',
    pending_review: '历史待审核',
    approved: job.publication ? '已自动发布' : '历史已批准',
    rejected: '需修改',
    failed: '创作失败',
    cancelled: '已取消',
  };
  return labels[job.status];
}

export function lobbyPropCreationIsActive(job: LobbyPropCreationJob): boolean {
  return job.status === 'queued' || job.status === 'running';
}
