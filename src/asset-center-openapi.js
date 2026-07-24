import { createHash } from 'node:crypto';

export const MAX_ASSET_CENTER_GLB_BYTES = 15 * 1024 * 1024;
const MAX_ASSET_CENTER_JSON_BYTES = 256 * 1024;

const EXTERNAL_USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const GENERATION_ID_PATTERN = /^acj_[A-Za-z0-9_-]+$/;
const ASSET_ID_PATTERN = /^ast_[A-Za-z0-9_-]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ERROR_CODE_PATTERN = /^[a-z0-9_]{3,80}$/;
const GENERATION_STATUSES = new Set(['queued', 'processing', 'succeeded', 'failed']);
const GENERATION_STAGES = new Set([
  'queued',
  'planning',
  'reference_image',
  'model_generation',
  'validating',
  'uploading',
  'completed',
  'failed',
]);

export class AssetCenterOpenApiError extends Error {
  constructor({ status, code, message, retryAfterMs = null, retryable = false }) {
    super(message);
    this.name = 'AssetCenterOpenApiError';
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.retryable = retryable;
  }
}

function clientError(code, message) {
  return new AssetCenterOpenApiError({ status: 422, code, message, retryable: false });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validIsoDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function normalizeOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error('WHITEROOM_ASSET_CENTER_ORIGIN must be an absolute URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('WHITEROOM_ASSET_CENTER_ORIGIN must be a safe HTTP(S) URL');
  }
  if (url.protocol !== 'https:' && !isLoopbackHostname(url.hostname)) {
    throw new Error('WHITEROOM_ASSET_CENTER_ORIGIN must use HTTPS outside localhost');
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname && pathname !== '/openapi/v1') {
    throw new Error('WHITEROOM_ASSET_CENTER_ORIGIN must be an origin or end at /openapi/v1');
  }
  url.pathname = '/openapi/v1/';
  return url;
}

function unbracketedHostname(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function isLoopbackHostname(hostname) {
  const normalized = unbracketedHostname(hostname).toLowerCase();
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function isUnsafeDownloadHostname(hostname) {
  const normalized = unbracketedHostname(hostname).toLowerCase();
  if (isLoopbackHostname(normalized)) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((part) => part > 255)) return true;
    const [first, second] = parts;
    return first === 0
      || first === 10
      || first === 127
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || first >= 224;
  }
  if (normalized.includes(':')) {
    if (normalized === '::' || normalized === '::1') return true;
    if (/^(?:fc|fd)[0-9a-f]{2}:/i.test(normalized) || /^fe[89ab][0-9a-f]:/i.test(normalized)) return true;
    const mapped = /(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(normalized);
    return mapped ? isUnsafeDownloadHostname(mapped[1]) : false;
  }
  return false;
}

function validateExternalUserId(value) {
  if (typeof value !== 'string' || !EXTERNAL_USER_ID_PATTERN.test(value)) {
    throw clientError('invalid_external_user_id', 'Asset Center external user ID is invalid');
  }
  return value;
}

function validateId(value, pattern, code, label) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw clientError(code, `${label} is invalid`);
  }
  return value;
}

function normalizePrompt(value) {
  if (typeof value !== 'string') {
    throw clientError('invalid_generation_prompt', 'Asset generation prompt is invalid');
  }
  const prompt = value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (
    [...prompt].length < 8
    || [...prompt].length > 1000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(prompt)
  ) {
    throw clientError('invalid_generation_prompt', 'Asset generation prompt must contain 8-1000 safe characters');
  }
  return prompt;
}

function normalizeDisplayName(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw clientError('invalid_generation_display_name', 'Asset generation display name is invalid');
  }
  const displayName = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (
    !displayName
    || [...displayName].length > 80
    || /[\u0000-\u001f\u007f]/u.test(displayName)
  ) {
    throw clientError('invalid_generation_display_name', 'Asset generation display name is invalid');
  }
  return displayName;
}

function validateIdempotencyKey(value) {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw clientError('invalid_idempotency_key', 'Asset generation idempotency key is invalid');
  }
  return value;
}

function responseError(status, payload, retryAfterHeader) {
  const upstreamCode = isPlainObject(payload?.error) && typeof payload.error.code === 'string'
    && ERROR_CODE_PATTERN.test(payload.error.code)
    ? payload.error.code
    : null;
  const retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  return new AssetCenterOpenApiError({
    status,
    code: upstreamCode ?? `asset_center_http_${status}`,
    message: status === 429
      ? 'Asset Center is rate limited; retry later'
      : retryable
        ? 'Asset Center is temporarily unavailable'
        : 'Asset Center rejected the request',
    retryAfterMs: parseRetryAfter(retryAfterHeader),
    retryable,
  });
}

function parseRetryAfter(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^\d+$/.test(value.trim())) return Math.min(Number(value.trim()) * 1000, 24 * 60 * 60_000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, Math.min(at - Date.now(), 24 * 60 * 60_000)) : null;
}

function normalizeAsset(value) {
  if (
    !isPlainObject(value)
    || value.object !== 'asset'
    || typeof value.id !== 'string'
    || !ASSET_ID_PATTERN.test(value.id)
    || typeof value.display_name !== 'string'
    || !value.display_name.trim()
    || value.format !== 'glb'
    || typeof value.download_url_endpoint !== 'string'
    || value.download_url_endpoint !== `/openapi/v1/assets/${encodeURIComponent(value.id)}/download-url`
    || !validIsoDate(value.created_at)
    || !validIsoDate(value.updated_at)
    || (value.generation_id !== undefined && (
      typeof value.generation_id !== 'string' || !GENERATION_ID_PATTERN.test(value.generation_id)
    ))
    || (value.size_bytes !== undefined && (!Number.isSafeInteger(value.size_bytes) || value.size_bytes < 1))
    || (value.sha256 !== undefined && (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)))
  ) {
    throw new AssetCenterOpenApiError({
      status: 502,
      code: 'invalid_asset_center_response',
      message: 'Asset Center returned an invalid asset response',
      retryable: true,
    });
  }
  return Object.freeze({
    id: value.id,
    object: 'asset',
    displayName: value.display_name.trim(),
    format: 'glb',
    downloadUrlEndpoint: value.download_url_endpoint,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    ...(value.generation_id ? { generationId: value.generation_id } : {}),
    ...(value.size_bytes !== undefined ? { sizeBytes: value.size_bytes } : {}),
    ...(value.sha256 !== undefined ? { sha256: value.sha256 } : {}),
  });
}

function normalizeGeneration(value) {
  if (
    !isPlainObject(value)
    || value.object !== 'asset_generation'
    || typeof value.id !== 'string'
    || !GENERATION_ID_PATTERN.test(value.id)
    || !GENERATION_STATUSES.has(value.status)
    || !Number.isSafeInteger(value.progress)
    || value.progress < 0
    || value.progress > 100
    || !GENERATION_STAGES.has(value.stage)
    || !validIsoDate(value.created_at)
    || !validIsoDate(value.updated_at)
    || (value.status === 'succeeded' && value.asset === undefined)
  ) {
    throw new AssetCenterOpenApiError({
      status: 502,
      code: 'invalid_asset_center_response',
      message: 'Asset Center returned an invalid generation response',
      retryable: true,
    });
  }
  const failure = value.failure === undefined ? undefined : (
    isPlainObject(value.failure)
    && value.failure.code === 'generation_failed'
    && value.failure.message === 'Asset generation failed'
      ? Object.freeze({ code: 'generation_failed', message: 'Asset generation failed' })
      : null
  );
  if (value.failure !== undefined && failure === null) {
    throw new AssetCenterOpenApiError({
      status: 502,
      code: 'invalid_asset_center_response',
      message: 'Asset Center returned an invalid generation failure',
      retryable: true,
    });
  }
  return Object.freeze({
    id: value.id,
    object: 'asset_generation',
    status: value.status,
    progress: value.progress,
    stage: value.stage,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    ...(value.asset !== undefined ? { asset: normalizeAsset(value.asset) } : {}),
    ...(failure ? { failure } : {}),
  });
}

function responseTooLargeError(kind) {
  return new AssetCenterOpenApiError({
    status: kind === 'json' ? 502 : 413,
    code: kind === 'json' ? 'asset_center_response_too_large' : 'asset_center_glb_too_large',
    message: kind === 'json'
      ? 'Asset Center returned an oversized response'
      : 'Generated GLB exceeds the WhiteRoom size limit',
    retryable: false,
  });
}

async function readLimitedBody(response, maximumBytes, controller, kind) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isSafeInteger(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel?.().catch(() => {});
    controller.abort();
    throw responseTooLargeError(kind);
  }
  if (!response.body || typeof response.body.getReader !== 'function') return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      let abortHandler;
      const aborted = new Promise((resolve, reject) => {
        abortHandler = () => reject(new DOMException('aborted', 'AbortError'));
        controller.signal.addEventListener('abort', abortHandler, { once: true });
      });
      let part;
      try {
        part = await Promise.race([reader.read(), aborted]);
      } finally {
        controller.signal.removeEventListener('abort', abortHandler);
      }
      if (part.done) break;
      const chunk = Buffer.from(part.value);
      total += chunk.length;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => {});
        controller.abort();
        throw responseTooLargeError(kind);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (controller.signal.aborted) void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function readJson(response, controller) {
  const buffer = await readLimitedBody(response, MAX_ASSET_CENTER_JSON_BYTES, controller, 'json');
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new AssetCenterOpenApiError({
      status: 502,
      code: 'invalid_asset_center_response',
      message: 'Asset Center returned invalid JSON',
      retryable: true,
    });
  }
}

export class AssetCenterOpenApiClient {
  #baseUrl;
  #serviceToken;
  #fetch;
  #timeoutMs;

  constructor({ origin, serviceToken, fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
    this.#baseUrl = normalizeOrigin(origin);
    if (
      typeof serviceToken !== 'string'
      || !serviceToken.startsWith('acs_live_')
      || serviceToken.length < 24
      || serviceToken.length > 4096
      || /[\u0000-\u0020\u007f]/.test(serviceToken)
    ) {
      throw new Error('WHITEROOM_ASSET_CENTER_SERVICE_TOKEN is invalid');
    }
    if (typeof fetchImpl !== 'function') throw new Error('Asset Center fetch implementation is invalid');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
      throw new Error('Asset Center timeout must be 100-120000 milliseconds');
    }
    this.#serviceToken = serviceToken;
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async createGeneration({ externalUserId, prompt, displayName, idempotencyKey } = {}) {
    const ownerId = validateExternalUserId(externalUserId);
    const body = {
      prompt: normalizePrompt(prompt),
      ...(displayName === undefined ? {} : { display_name: normalizeDisplayName(displayName) }),
    };
    const payload = await this.#requestJson('generations', {
      method: 'POST',
      externalUserId: ownerId,
      idempotencyKey: validateIdempotencyKey(idempotencyKey),
      body,
      expectedStatuses: new Set([202]),
    });
    return normalizeGeneration(payload);
  }

  async getGeneration({ externalUserId, generationId } = {}) {
    const ownerId = validateExternalUserId(externalUserId);
    const id = validateId(generationId, GENERATION_ID_PATTERN, 'invalid_generation_id', 'Generation ID');
    return normalizeGeneration(await this.#requestJson(`generations/${encodeURIComponent(id)}`, {
      method: 'GET',
      externalUserId: ownerId,
      expectedStatuses: new Set([200]),
    }));
  }

  async getDownloadTarget({ externalUserId, assetId } = {}) {
    const ownerId = validateExternalUserId(externalUserId);
    const id = validateId(assetId, ASSET_ID_PATTERN, 'invalid_asset_id', 'Asset ID');
    const payload = await this.#requestJson(`assets/${encodeURIComponent(id)}/download-url`, {
      method: 'GET',
      externalUserId: ownerId,
      expectedStatuses: new Set([200]),
    });
    let url;
    try {
      url = new URL(payload?.url);
    } catch {
      url = null;
    }
    if (
      !url
      || url.protocol !== 'https:'
      || url.username
      || url.password
      || url.hash
      || isUnsafeDownloadHostname(url.hostname)
      || !validIsoDate(payload?.expires_at)
    ) {
      throw new AssetCenterOpenApiError({
        status: 502,
        code: 'invalid_asset_center_response',
        message: 'Asset Center returned an invalid download target',
        retryable: true,
      });
    }
    return Object.freeze({ url: url.toString(), expiresAt: payload.expires_at });
  }

  async downloadGlb({ url, expectedSizeBytes, expectedSha256, maximumBytes = MAX_ASSET_CENTER_GLB_BYTES } = {}) {
    let target;
    try {
      target = new URL(url);
    } catch {
      throw clientError('invalid_asset_download_url', 'Asset download URL is invalid');
    }
    if (
      target.protocol !== 'https:'
      || target.username
      || target.password
      || target.hash
      || isUnsafeDownloadHostname(target.hostname)
    ) {
      throw clientError('invalid_asset_download_url', 'Asset download URL is invalid');
    }
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_ASSET_CENTER_GLB_BYTES) {
      throw clientError('invalid_asset_download_limit', 'Asset download byte limit is invalid');
    }
    if (expectedSizeBytes !== undefined && (
      !Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes < 1 || expectedSizeBytes > maximumBytes
    )) {
      throw clientError('invalid_asset_expected_size', 'Expected asset size is invalid');
    }
    if (expectedSha256 !== undefined && (
      typeof expectedSha256 !== 'string' || !SHA256_PATTERN.test(expectedSha256)
    )) {
      throw clientError('invalid_asset_expected_sha256', 'Expected asset checksum is invalid');
    }

    const buffer = await this.#withTimedFetch(target, {
      method: 'GET',
      headers: { Accept: 'model/gltf-binary, application/octet-stream;q=0.8' },
      redirect: 'error',
    }, async (response, controller) => {
      if (!response.ok) {
        throw new AssetCenterOpenApiError({
          status: response.status,
          code: 'asset_center_download_failed',
          message: 'Asset download failed',
          retryAfterMs: parseRetryAfter(response.headers?.get?.('retry-after')),
          retryable: response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500,
        });
      }
      return readLimitedBody(response, maximumBytes, controller, 'glb');
    });
    if (
      buffer.length < 12
      || buffer.toString('ascii', 0, 4) !== 'glTF'
      || buffer.readUInt32LE(4) !== 2
      || buffer.readUInt32LE(8) !== buffer.length
    ) {
      throw new AssetCenterOpenApiError({
        status: 422,
        code: 'invalid_asset_center_glb',
        message: 'Asset Center returned an invalid GLB',
        retryable: false,
      });
    }
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    if (expectedSizeBytes !== undefined && buffer.length !== expectedSizeBytes) {
      throw new AssetCenterOpenApiError({
        status: 422,
        code: 'asset_center_glb_size_mismatch',
        message: 'Generated GLB size does not match Asset Center metadata',
        retryable: false,
      });
    }
    if (expectedSha256 !== undefined && sha256 !== expectedSha256) {
      throw new AssetCenterOpenApiError({
        status: 422,
        code: 'asset_center_glb_checksum_mismatch',
        message: 'Generated GLB checksum does not match Asset Center metadata',
        retryable: false,
      });
    }
    return Object.freeze({ buffer, sizeBytes: buffer.length, sha256 });
  }

  async #requestJson(pathname, { method, externalUserId, idempotencyKey, body, expectedStatuses }) {
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.#serviceToken}`,
      'X-External-User-Id': externalUserId,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey }),
    };
    return this.#withTimedFetch(new URL(pathname, this.#baseUrl), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
    }, async (response, controller) => {
      const payload = await readJson(response, controller);
      if (!expectedStatuses.has(response.status)) {
        throw responseError(response.status, payload, response.headers?.get?.('retry-after'));
      }
      return payload;
    });
  }

  async #withTimedFetch(url, init, consume) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    timer.unref?.();
    try {
      const response = await this.#fetch(url, { ...init, signal: controller.signal });
      return await consume(response, controller);
    } catch (error) {
      if (error instanceof AssetCenterOpenApiError) throw error;
      if (controller.signal.aborted) {
        throw new AssetCenterOpenApiError({
          status: 504,
          code: 'asset_center_timeout',
          message: 'Asset Center request timed out',
          retryable: true,
        });
      }
      throw new AssetCenterOpenApiError({
        status: 503,
        code: 'asset_center_unavailable',
        message: 'Asset Center is temporarily unavailable',
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
