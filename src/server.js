import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAccountSessionToken,
  createLobbyOwnerToken,
  createPreviewToken,
  requireBearer,
  validateTokens,
  verifyAccountSessionToken,
  verifyLobbyOwnerToken,
  verifyPreviewToken,
} from './auth.js';
import { SupabaseAuthVerifier } from './supabase-auth.js';
import {
  AvatarStore,
  AvatarUploadGate,
  AvatarUploadRateLimiter,
  AVATAR_ID_PATTERN,
  MAX_AVATAR_BYTES,
  validateAvatarText,
} from './avatar.js';
import { asHttpError, GRAVITY_LAW_LORE, HttpError } from './errors.js';
import { readJsonBody, readMultipartFile, readMultipartForm } from './multipart.js';
import { FileStore } from './store.js';
import { DreamseaStore, validateLineageHash } from './dreamsea.js';
import {
  DEFAULT_LOBBY_CHANNEL,
  LOBBY_DYNAMIC_RESOURCE_LIMITS,
  LobbyEventHub,
  LobbyRateLimiter,
  LobbyStore,
  loadLobbyCatalog,
  requestIp,
  validateClientId,
  validateClaimLobbyPlot,
  validateLobbyChannel,
  validateCreateLobbyObject,
  validateDeleteLobbyObject,
  validateGrantPlotCoAuthor,
  validateInteractLobbyObject,
  validateObjectId,
  validatePlotId,
  validateReleaseLobbyPlot,
  validateUpdateLobbyPlot,
  validateUpdateLobbyObject,
} from './lobby.js';
import {
  LobbyAssetStore,
  LobbyAssetUploadGate,
  LobbyAssetUploadRateLimiter,
  LOBBY_ASSET_ID_PATTERN,
  MAX_LOBBY_ASSET_BYTES,
} from './lobby-assets.js';
import { MultiplayerHub } from './multiplayer.js';
import {
  MAX_PROP_ARTIFACT_BYTES,
  MAX_PROP_PROMPT_CHARACTERS,
  PROP_CREATION_ID_PATTERN,
  PROP_CREATION_STATUSES,
  PropCreationStore,
  sendPropArtifact,
  validateWorkerId,
} from './prop-creation.js';
import {
  LEVEL_ID_PATTERN,
  MAX_ARCHIVE_BYTES,
  MAX_SOLUTION_BYTES,
  validatePackage,
} from './validator.js';
import { extractZip, findPackageRoot } from './zip.js';

const MAX_MULTIPART_BYTES = MAX_ARCHIVE_BYTES + 1024 * 1024;
const MAX_AVATAR_MULTIPART_BYTES = MAX_AVATAR_BYTES + 256 * 1024;
const MAX_LOBBY_ASSET_MULTIPART_BYTES = MAX_LOBBY_ASSET_BYTES + 256 * 1024;
const MAX_PROP_ARTIFACT_MULTIPART_BYTES = MAX_PROP_ARTIFACT_BYTES + 64 * 1024;
const ADMIN_ASSET_DIRECTORY = path.resolve(fileURLToPath(new URL('../public/admin/', import.meta.url)));
const ADMIN_ASSETS = new Map([
  ['/admin/', ['index.html', 'text/html; charset=utf-8']],
  ['/admin/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/admin/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/admin/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);
// 潜航门户（玩家前端）：与审核台相同的白名单式静态服务
const PORTAL_ASSET_DIRECTORY = path.resolve(fileURLToPath(new URL('../public/portal/', import.meta.url)));
const PORTAL_ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/portal/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/portal/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);
const PREVIEW_COOKIE_NAME = '__Secure-whiteroom_preview';
const LOBBY_OWNER_COOKIE_NAME = 'whiteroom_lobby_owner';
const LOBBY_OWNER_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const ACCOUNT_SESSION_COOKIE_NAME = 'whiteroom_account_session';
const ACCOUNT_SESSION_MAX_AGE_SECONDS = 60 * 60;
const DEFAULT_PREVIEW_TTL_SECONDS = 5 * 60;
const MAX_PREVIEW_TTL_SECONDS = 15 * 60;
const MAX_ADMIN_PAGE_SIZE = 100;
const MIME_TYPES = new Map([
  ['.json', 'application/json; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ktx2', 'image/ktx2'],
  ['.glb', 'model/gltf-binary'],
  ['.gltf', 'model/gltf+json'],
  ['.bin', 'application/octet-stream'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
]);

function publicHeaders(corsOrigin = '*') {
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

function sendJson(response, status, value, headers = {}) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

function sendError(response, error, logger) {
  const httpError = asHttpError(error);
  if (httpError.status >= 500) logger.error(error);
  const payload = {
    error: {
      code: httpError.code,
      message: httpError.message,
    },
  };
  if (httpError.details !== undefined) payload.error.details = httpError.details;
  // 沉重律：内容类拒绝（过大 / 类型不符 / 校验失败）统一以世界观口径解释
  if ([413, 415, 422].includes(httpError.status)) payload.error.lore = GRAVITY_LAW_LORE;
  sendJson(response, httpError.status, payload, { 'Cache-Control': 'no-store' });
}

async function sendAdminAsset(request, response, pathname) {
  const asset = ADMIN_ASSETS.get(pathname);
  if (!asset) throw new HttpError(404, 'not_found', 'Resource not found');
  const [fileName, contentType] = asset;
  const filePath = path.join(ADMIN_ASSET_DIRECTORY, fileName);
  const info = await stat(filePath);
  if (!info.isFile()) throw new HttpError(404, 'not_found', 'Resource not found');
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': info.size,
    'Cache-Control': 'private, no-store',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.once('error', reject);
    response.once('error', reject);
    response.once('finish', resolve);
    stream.pipe(response);
  });
}

async function sendPortalAsset(request, response, pathname) {
  const asset = PORTAL_ASSETS.get(pathname);
  if (!asset) throw new HttpError(404, 'not_found', 'Resource not found');
  const [fileName, contentType] = asset;
  const filePath = path.join(PORTAL_ASSET_DIRECTORY, fileName);
  const info = await stat(filePath);
  if (!info.isFile()) throw new HttpError(404, 'not_found', 'Resource not found');
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': info.size,
    'Cache-Control': 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.once('error', reject);
    response.once('error', reject);
    response.once('finish', resolve);
    stream.pipe(response);
  });
}

function decodePathname(rawUrl) {
  const url = new URL(rawUrl, 'http://localhost');
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'invalid_path', 'URL path is not valid UTF-8');
  }
}

function staticRelativePath(value) {
  const candidate = value || 'level.json';
  if (
    candidate.startsWith('/') ||
    candidate.includes('\\') ||
    candidate.includes('\0') ||
    candidate.includes('%') ||
    /[\u0000-\u001f\u007f]/.test(candidate) ||
    candidate.split('/').some((segment) => !segment || segment === '.' || segment === '..') ||
    path.posix.normalize(candidate) !== candidate
  ) {
    throw new HttpError(400, 'invalid_path', 'Static asset path is invalid');
  }
  return candidate;
}

async function sendPackageFile(request, response, store, record, requestedPath, headers) {
  const relative = staticRelativePath(requestedPath);
  const packageRoot = await realpath(store.packagePath(record));
  const candidate = path.resolve(packageRoot, relative);
  if (!candidate.startsWith(`${packageRoot}${path.sep}`)) {
    throw new HttpError(400, 'invalid_path', 'Static asset path is invalid');
  }
  let resolved;
  try {
    resolved = await realpath(candidate);
  } catch (error) {
    if (error.code === 'ENOENT') throw new HttpError(404, 'not_found', 'Resource not found');
    throw error;
  }
  if (!resolved.startsWith(`${packageRoot}${path.sep}`)) {
    throw new HttpError(400, 'invalid_path', 'Static asset path escapes its package');
  }
  const info = await stat(resolved);
  if (!info.isFile()) throw new HttpError(404, 'not_found', 'Resource not found');

  const contentType = MIME_TYPES.get(path.extname(resolved).toLowerCase()) ?? 'application/octet-stream';
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': info.size,
    ...headers,
  });
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

async function sendApprovedFile(request, response, store, id, requestedPath, corsOrigin) {
  if (!LEVEL_ID_PATTERN.test(id)) throw new HttpError(404, 'not_found', 'Resource not found');
  const record = await store.getRecord(id);
  if (!record || record.status !== 'approved') {
    throw new HttpError(404, 'not_found', 'Resource not found');
  }
  await sendPackageFile(request, response, store, record, requestedPath, {
    ...publicHeaders(corsOrigin),
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: `"${record.hash}"`,
  });
}

async function sendAvatarFile(request, response, avatarStore, id, corsOrigin) {
  if (!AVATAR_ID_PATTERN.test(id)) throw new HttpError(404, 'avatar_not_found', 'Avatar was not found');
  const record = avatarStore.getStored(id);
  if (!record) throw new HttpError(404, 'avatar_not_found', 'Avatar was not found');
  const filePath = avatarStore.modelPath(id);
  const info = await stat(filePath);
  if (!info.isFile() || info.size !== record.bytes) {
    throw new HttpError(404, 'avatar_not_found', 'Avatar was not found');
  }
  response.writeHead(200, {
    'Content-Type': 'model/gltf-binary',
    'Content-Length': info.size,
    ...publicHeaders(corsOrigin),
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: `"${record.hash}"`,
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.once('error', reject);
    response.once('error', reject);
    response.once('finish', resolve);
    stream.pipe(response);
  });
}

function sameOriginAssetHeaders() {
  return {
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

function isLobbyAssetPath(pathname) {
  return pathname === '/api/lobby/assets'
    || pathname.startsWith('/api/lobby/assets/')
    || pathname.startsWith('/lobby-assets/');
}

async function sendLobbyAssetFile(request, response, lobbyAssetStore, id) {
  if (!LOBBY_ASSET_ID_PATTERN.test(id)) {
    throw new HttpError(404, 'lobby_asset_not_found', 'Lobby asset was not found');
  }
  const record = lobbyAssetStore.getStored(id);
  if (!record) throw new HttpError(404, 'lobby_asset_not_found', 'Lobby asset was not found');
  const filePath = lobbyAssetStore.modelPath(id);
  const info = await stat(filePath);
  if (!info.isFile() || info.size !== record.bytes) {
    throw new HttpError(404, 'lobby_asset_not_found', 'Lobby asset was not found');
  }
  const headers = {
    'Content-Type': 'model/gltf-binary',
    'Content-Length': info.size,
    ...sameOriginAssetHeaders(),
    'Cache-Control': 'public, max-age=300, must-revalidate',
    ETag: `"${record.hash}"`,
  };
  if (request.headers['if-none-match'] === headers.ETag) {
    response.writeHead(304, {
      ...sameOriginAssetHeaders(),
      'Cache-Control': headers['Cache-Control'],
      ETag: headers.ETag,
    });
    response.end();
    return;
  }
  response.writeHead(200, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.once('error', reject);
    response.once('error', reject);
    response.once('finish', resolve);
    stream.pipe(response);
  });
}

function parseIntegerQuery(value, fallback, { minimum, maximum, name }) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new HttpError(400, 'invalid_query', `${name} must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpError(400, 'invalid_query', `${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function previewTtlSeconds(value) {
  const parsed = Number(value ?? DEFAULT_PREVIEW_TTL_SECONDS);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PREVIEW_TTL_SECONDS) {
    throw new Error(`WHITEROOM_PREVIEW_TTL_SECONDS must be between 1 and ${MAX_PREVIEW_TTL_SECONDS}`);
  }
  return parsed;
}

function positiveIntegerSetting(value, fallback, { name, minimum, maximum }) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function booleanSetting(value, fallback, name) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error(`${name} must be true or false`);
}

function readCookie(request, name) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function appendSetCookie(response, cookie) {
  const current = response.getHeader('Set-Cookie');
  if (!current) response.setHeader('Set-Cookie', cookie);
  else if (Array.isArray(current)) response.setHeader('Set-Cookie', [...current, cookie]);
  else response.setHeader('Set-Cookie', [String(current), cookie]);
}

function requestIsSecure(request) {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  return protocol?.split(',')[0].trim().toLowerCase() === 'https' || request.socket.encrypted === true;
}

function requireSameOriginMutation(request) {
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite === 'cross-site') {
    throw new HttpError(403, 'cross_origin_lobby_write', 'Cross-origin lobby changes are not allowed');
  }
  const origin = request.headers.origin;
  if (!origin) return;
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new HttpError(403, 'cross_origin_lobby_write', 'Cross-origin lobby changes are not allowed');
  }
  const forwardedHost = request.headers['x-forwarded-host'];
  const hostHeader = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? request.headers.host;
  const requestHost = hostHeader?.split(',')[0].trim().toLowerCase();
  const expectedProtocol = requestIsSecure(request) ? 'https:' : 'http:';
  if (!requestHost || parsedOrigin.host.toLowerCase() !== requestHost || parsedOrigin.protocol !== expectedProtocol) {
    throw new HttpError(403, 'cross_origin_lobby_write', 'Cross-origin lobby changes are not allowed');
  }
}

function lobbyOwnerCookie(ownerId, request, context) {
  const expiresAt = context.clock() + LOBBY_OWNER_COOKIE_MAX_AGE_SECONDS * 1000;
  const token = createLobbyOwnerToken({ ownerId, expiresAt, secret: context.lobbyOwnerSecret });
  return [
    `${LOBBY_OWNER_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    ...(requestIsSecure(request) ? ['Secure'] : []),
    'SameSite=Strict',
    `Max-Age=${LOBBY_OWNER_COOKIE_MAX_AGE_SECONDS}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ].join('; ');
}

function accountSessionCookie(session, request, context) {
  const expiresAt = Math.min(
    session.expiresAt,
    context.clock() + ACCOUNT_SESSION_MAX_AGE_SECONDS * 1000,
  );
  const maxAge = Math.max(1, Math.floor((expiresAt - context.clock()) / 1000));
  const token = createAccountSessionToken({
    subject: session.subject,
    ownerId: session.ownerId,
    expiresAt,
    secret: context.accountSessionSecret,
  });
  return [
    `${ACCOUNT_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    ...(requestIsSecure(request) ? ['Secure'] : []),
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ].join('; ');
}

function expiredCookie(name, request) {
  return [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    ...(requestIsSecure(request) ? ['Secure'] : []),
    'SameSite=Strict',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ].join('; ');
}

function verifiedGuestOwner(request, context) {
  const token = readCookie(request, LOBBY_OWNER_COOKIE_NAME);
  return verifyLobbyOwnerToken(token, { secret: context.lobbyOwnerSecret, now: context.clock() });
}

function verifiedAccountSession(request, context) {
  const token = readCookie(request, ACCOUNT_SESSION_COOKIE_NAME);
  const session = verifyAccountSessionToken(token, {
    secret: context.accountSessionSecret,
    now: context.clock(),
  });
  return session && session.ownerId === `owner-${session.subject}`
    ? session
    : null;
}

function requireAccountSession(request, context) {
  const session = verifiedAccountSession(request, context);
  if (!session) {
    throw new HttpError(401, 'account_session_required', 'A signed-in email account is required');
  }
  return session;
}

function issueGuestOwner(request, response, context) {
  const ownerId = `owner-${randomUUID()}`;
  appendSetCookie(response, lobbyOwnerCookie(ownerId, request, context));
  return ownerId;
}

function ensureLobbyOwner(request, response, context) {
  const account = verifiedAccountSession(request, context);
  if (account) return account.ownerId;
  const guest = verifiedGuestOwner(request, context);
  if (guest) return guest;
  return issueGuestOwner(request, response, context);
}

function requireLobbyOwner(request, context) {
  const account = verifiedAccountSession(request, context);
  if (account) return account.ownerId;
  const guest = verifiedGuestOwner(request, context);
  if (!guest) {
    throw new HttpError(401, 'lobby_identity_required', 'Open the lobby once before uploading an asset');
  }
  return guest;
}

async function establishAccountSession(request, response, context) {
  requireSameOriginMutation(request);
  const identity = await context.supabaseAuth.verifyRequest(request);
  if (identity.expiresAt <= context.clock() + 5_000) {
    throw new HttpError(401, 'account_token_expiring', 'The Supabase access token is too close to expiry');
  }
  const ownerId = `owner-${identity.subject}`;
  const session = {
    subject: identity.subject,
    ownerId,
    expiresAt: identity.expiresAt,
  };
  appendSetCookie(response, accountSessionCookie(session, request, context));
  sendPrivateLobbyJson(response, 200, {
    account: {
      signedIn: true,
      provider: 'email',
      email: identity.email,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
    },
    ownerId,
    identityStrategy: 'supabase_user_id',
  });
}

function endAccountSession(request, response, context) {
  requireSameOriginMutation(request);
  appendSetCookie(response, expiredCookie(ACCOUNT_SESSION_COOKIE_NAME, request));
  const guestOwner = verifiedGuestOwner(request, context);
  const ownerId = guestOwner ?? issueGuestOwner(request, response, context);
  sendPrivateLobbyJson(response, 200, { account: { signedIn: false }, ownerId });
}

async function readSolutionMd(store, record) {
  const packageRoot = await realpath(store.packagePath(record));
  const solutionPath = await realpath(path.join(packageRoot, 'solution.md'));
  if (!solutionPath.startsWith(`${packageRoot}${path.sep}`)) {
    throw new Error('Stored solution path escapes its package');
  }
  const info = await stat(solutionPath);
  if (!info.isFile() || info.size > MAX_SOLUTION_BYTES) {
    throw new Error('Stored solution.md is invalid');
  }
  const solutionMd = await readFile(solutionPath, 'utf8');
  if (Buffer.byteLength(solutionMd) > MAX_SOLUTION_BYTES) {
    throw new Error('Stored solution.md is too large');
  }
  return solutionMd;
}

async function listAdminLevels(requestUrl, response, context) {
  const url = new URL(requestUrl, 'http://localhost');
  const status = url.searchParams.get('status') ?? 'pending';
  if (!['pending', 'approved', 'rejected', 'all'].includes(status)) {
    throw new HttpError(400, 'invalid_status', 'status must be pending, approved, rejected, or all');
  }
  const limit = parseIntegerQuery(url.searchParams.get('limit'), 50, {
    minimum: 1,
    maximum: MAX_ADMIN_PAGE_SIZE,
    name: 'limit',
  });
  const offset = parseIntegerQuery(url.searchParams.get('offset'), 0, {
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    name: 'offset',
  });
  const records = (await context.store.listRecords())
    .filter((record) => status === 'all' || record.status === status)
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt) || left.id.localeCompare(right.id));
  sendJson(response, 200, {
    status,
    total: records.length,
    limit,
    offset,
    levels: records.slice(offset, offset + limit).map((record) => context.store.adminSummaryView(record)),
  }, {
    'Cache-Control': 'private, no-store',
  });
}

async function getAdminLevel(response, context, id) {
  if (!LEVEL_ID_PATTERN.test(id)) throw new HttpError(404, 'level_not_found', 'Level was not found');
  const record = await context.store.getRecord(id);
  if (!record) throw new HttpError(404, 'level_not_found', 'Level was not found');
  const solutionMd = await readSolutionMd(context.store, record);
  sendJson(response, 200, {
    level: context.store.adminDetailView(record, solutionMd),
  }, {
    'Cache-Control': 'private, no-store',
  });
}

function requirePropCreationFeature(context) {
  if (!context.propWorkerToken) {
    throw new HttpError(503, 'prop_creation_unavailable', 'The local Codex bridge is not configured');
  }
}

function requirePropWorker(request, context) {
  requirePropCreationFeature(context);
  requireBearer(request, context.propWorkerToken);
}

function requirePropJsonObject(value, { allowed, required = [] }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(422, 'invalid_prop_creation', 'Prop creation request body must contain one object');
  }
  const keys = Object.keys(value);
  const allowedKeys = new Set(allowed);
  const unexpected = keys.filter((key) => !allowedKeys.has(key));
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  if (unexpected.length || missing.length) {
    throw new HttpError(422, 'invalid_prop_creation', 'Prop creation fields are invalid', {
      ...(unexpected.length ? { unexpected } : {}),
      ...(missing.length ? { missing } : {}),
    });
  }
  return value;
}

async function createPropCreation(request, response, context) {
  requirePropCreationFeature(context);
  requireSameOriginMutation(request);
  const session = requireAccountSession(request, context);
  const body = requirePropJsonObject(await readJsonBody(request, 8 * 1024), {
    allowed: ['prompt', 'channel'],
    required: ['prompt', 'channel'],
  });
  const channel = validateLobbyChannel(body.channel);
  const record = await context.propCreationStore.create({
    ownerId: session.ownerId,
    prompt: body.prompt,
    channel,
    ip: requestIp(request),
    autoPublish: context.propAutoPublish,
  });
  await recordDreamActivity(context, session.ownerId, 'wishes');
  sendPrivateLobbyJson(response, 202, {
    job: context.propCreationStore.ownerView(record),
    worker: context.propCreationStore.workerStatus(),
  });
}

async function listOwnerPropCreations(request, response, context) {
  requireSameOriginMutation(request);
  const session = requireAccountSession(request, context);
  sendPrivateLobbyJson(response, 200, {
    schemaVersion: 1,
    jobs: await context.propCreationStore.listOwner(session.ownerId),
    worker: context.propCreationStore.workerStatus(),
  });
}

async function getOwnerPropCreation(request, response, context, id) {
  requireSameOriginMutation(request);
  const session = requireAccountSession(request, context);
  if (!PROP_CREATION_ID_PATTERN.test(id)) {
    throw new HttpError(404, 'prop_creation_not_found', 'Prop creation was not found');
  }
  const record = await context.propCreationStore.get(id);
  if (!record || record.ownerId !== session.ownerId) {
    throw new HttpError(404, 'prop_creation_not_found', 'Prop creation was not found');
  }
  sendPrivateLobbyJson(response, 200, {
    job: context.propCreationStore.ownerView(record),
    worker: context.propCreationStore.workerStatus(),
  });
}

async function cancelOwnerPropCreation(request, response, context, id) {
  requireSameOriginMutation(request);
  const session = requireAccountSession(request, context);
  const job = await context.propCreationStore.cancel(id, session.ownerId);
  sendPrivateLobbyJson(response, 200, { job });
}

async function claimPropCreation(request, response, context) {
  requirePropWorker(request, context);
  const body = requirePropJsonObject(await readJsonBody(request, 4 * 1024), {
    allowed: ['workerId'],
    required: ['workerId'],
  });
  const workerId = validateWorkerId(body.workerId);
  const claim = await context.propCreationStore.claim(workerId);
  if (!claim) {
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
    return;
  }
  sendJson(response, 200, claim, { 'Cache-Control': 'no-store' });
}

async function updatePropCreationProgress(request, response, context, id) {
  requirePropWorker(request, context);
  const body = requirePropJsonObject(await readJsonBody(request, 8 * 1024), {
    allowed: ['workerId', 'leaseToken', 'stage', 'message'],
    required: ['workerId', 'leaseToken', 'stage', 'message'],
  });
  const job = await context.propCreationStore.progress(id, {
    workerId: validateWorkerId(body.workerId),
    leaseToken: body.leaseToken,
    stage: body.stage,
    message: body.message,
  });
  sendJson(response, 200, { job }, { 'Cache-Control': 'no-store' });
}

async function completePropCreation(request, response, context, id) {
  requirePropWorker(request, context);
  const upload = await readMultipartForm(request, {
    maximumBodyBytes: MAX_PROP_ARTIFACT_MULTIPART_BYTES,
    maximumFieldBytes: 4 * 1024,
    fileField: 'file',
    fileDescription: '.wrprop artifact',
    allowedFields: ['workerId', 'leaseToken'],
    requiredFields: ['workerId', 'leaseToken'],
  });
  if (!/\.wrprop$/i.test(upload.file.fileName)) {
    throw new HttpError(415, 'invalid_file_type', 'Prop artifact must use the .wrprop extension');
  }
  validateWorkerId(upload.fields.workerId);
  await context.propCreationStore.assertLease(id, {
    workerId: upload.fields.workerId,
    leaseToken: upload.fields.leaseToken,
  });
  const temporaryRoot = await mkdtemp(path.join(context.store.temporaryDirectory, 'prop-result-'));
  try {
    const archivePath = path.join(temporaryRoot, 'result.wrprop');
    const extractionRoot = path.join(temporaryRoot, 'extracted');
    await writeFile(archivePath, upload.file.buffer, { flag: 'wx', mode: 0o600 });
    await extractZip(archivePath, extractionRoot);
    const job = await context.propCreationStore.complete(id, {
      workerId: upload.fields.workerId,
      leaseToken: upload.fields.leaseToken,
      extractionRoot,
      archiveBuffer: upload.file.buffer,
      autoPublish: context.propAutoPublish,
    });
    const record = await context.propCreationStore.get(id);
    if (record?.ownerId) {
      await recordDreamActivity(context, record.ownerId, 'creations');
      if (record.artifact?.sha256) {
        await recordDreamCondensation(context, {
          hash: record.artifact.sha256,
          kind: 'prop',
          ownerId: record.ownerId,
          name: record.proposal?.name ?? null,
          isNew: false,
        });
      }
    }
    sendJson(response, 200, { job }, { 'Cache-Control': 'no-store' });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function failPropCreation(request, response, context, id) {
  requirePropWorker(request, context);
  const body = requirePropJsonObject(await readJsonBody(request, 8 * 1024), {
    allowed: ['workerId', 'leaseToken', 'code', 'message', 'retryable'],
    required: ['workerId', 'leaseToken'],
  });
  const job = await context.propCreationStore.fail(id, {
    workerId: validateWorkerId(body.workerId),
    leaseToken: body.leaseToken,
    code: body.code,
    message: body.message,
    retryable: body.retryable === true,
  });
  sendJson(response, 200, { job }, { 'Cache-Control': 'no-store' });
}

async function updatePropPublicationProgress(request, response, context, id) {
  requirePropWorker(request, context);
  const body = requirePropJsonObject(await readJsonBody(request, 8 * 1024), {
    allowed: ['workerId', 'leaseToken', 'stage', 'message'],
    required: ['workerId', 'leaseToken', 'stage', 'message'],
  });
  const job = await context.propCreationStore.publicationProgress(id, {
    workerId: validateWorkerId(body.workerId),
    leaseToken: body.leaseToken,
    stage: body.stage,
    message: body.message,
  });
  sendJson(response, 200, { job }, { 'Cache-Control': 'no-store' });
}

async function completePropPublication(request, response, context, id) {
  requirePropWorker(request, context);
  const body = requirePropJsonObject(await readJsonBody(request, 16 * 1024), {
    allowed: ['workerId', 'leaseToken', 'release'],
    required: ['workerId', 'leaseToken', 'release'],
  });
  const job = await context.propCreationStore.publicationSucceeded(id, {
    workerId: validateWorkerId(body.workerId),
    leaseToken: body.leaseToken,
    release: body.release,
  });
  sendJson(response, 200, { job }, { 'Cache-Control': 'no-store' });
}

async function failPropPublication(request, response, context, id) {
  requirePropWorker(request, context);
  const body = requirePropJsonObject(await readJsonBody(request, 16 * 1024), {
    allowed: ['workerId', 'leaseToken', 'code', 'message', 'rollback'],
    required: ['workerId', 'leaseToken', 'code', 'message', 'rollback'],
  });
  const job = await context.propCreationStore.publicationFailed(id, {
    workerId: validateWorkerId(body.workerId),
    leaseToken: body.leaseToken,
    code: body.code,
    message: body.message,
    rollback: body.rollback,
  });
  sendJson(response, 200, { job }, { 'Cache-Control': 'no-store' });
}

async function listAdminPropCreations(requestUrl, response, context) {
  const url = new URL(requestUrl, 'http://localhost');
  const status = url.searchParams.get('status') ?? 'pending_review';
  if (status !== 'all' && !PROP_CREATION_STATUSES.has(status)) {
    throw new HttpError(400, 'invalid_status', 'Prop creation status filter is invalid');
  }
  const limit = parseIntegerQuery(url.searchParams.get('limit'), 50, {
    minimum: 1,
    maximum: MAX_ADMIN_PAGE_SIZE,
    name: 'limit',
  });
  const offset = parseIntegerQuery(url.searchParams.get('offset'), 0, {
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    name: 'offset',
  });
  const records = (await context.propCreationStore.list())
    .filter((record) => status === 'all' || record.status === status)
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
  sendJson(response, 200, {
    status,
    total: records.length,
    limit,
    offset,
    autoPublish: context.propAutoPublish,
    jobs: records.slice(offset, offset + limit).map((record) => context.propCreationStore.adminSummaryView(record)),
  }, { 'Cache-Control': 'private, no-store' });
}

async function getAdminPropCreation(response, context, id) {
  const record = await context.propCreationStore.get(id);
  if (!record) throw new HttpError(404, 'prop_creation_not_found', 'Prop creation was not found');
  sendJson(response, 200, {
    job: context.propCreationStore.adminDetailView(record),
  }, { 'Cache-Control': 'private, no-store' });
}

async function createAdminPreview(response, context, id) {
  if (!LEVEL_ID_PATTERN.test(id)) throw new HttpError(404, 'level_not_found', 'Level was not found');
  const record = await context.store.getRecord(id);
  if (!record) throw new HttpError(404, 'level_not_found', 'Level was not found');
  if (record.status !== 'pending') {
    throw new HttpError(409, 'preview_not_pending', 'Only pending levels can be previewed');
  }

  const now = context.clock();
  const expiresAt = now + context.previewTtlSeconds * 1000;
  const previewBaseUrl = `/api/admin/preview/${id}/`;
  const token = createPreviewToken({
    levelId: id,
    hash: record.hash,
    expiresAt,
    secret: context.adminToken,
  });
  const cookie = [
    `${PREVIEW_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${previewBaseUrl}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${context.previewTtlSeconds}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ].join('; ');
  sendJson(response, 200, {
    previewUrl: `/?reviewLevel=${encodeURIComponent(id)}`,
    previewBaseUrl,
    expiresAt: new Date(expiresAt).toISOString(),
  }, {
    'Cache-Control': 'private, no-store',
    'Set-Cookie': cookie,
  });
}

async function sendPendingPreviewFile(request, response, context, id, requestedPath) {
  if (!LEVEL_ID_PATTERN.test(id)) throw new HttpError(404, 'not_found', 'Resource not found');
  const record = await context.store.getRecord(id);
  if (!record || record.status !== 'pending') {
    throw new HttpError(404, 'not_found', 'Resource not found');
  }
  const token = readCookie(request, PREVIEW_COOKIE_NAME);
  if (!verifyPreviewToken(token, {
    levelId: id,
    hash: record.hash,
    secret: context.adminToken,
    now: context.clock(),
  })) {
    throw new HttpError(401, 'preview_unauthorized', 'A valid preview session is required');
  }
  await sendPackageFile(request, response, context.store, record, requestedPath, {
    'Cache-Control': 'private, no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Cookie',
  });
}

async function uploadLevel(request, response, context) {
  requireBearer(request, context.uploadToken);
  const upload = await readMultipartFile(request, { maximumBodyBytes: MAX_MULTIPART_BYTES });
  if (!/\.wrlevel$/.test(upload.fileName)) {
    throw new HttpError(415, 'invalid_file_type', 'Uploaded file must use the .wrlevel extension');
  }
  if (upload.buffer.length > MAX_ARCHIVE_BYTES) {
    throw new HttpError(413, 'archive_too_large', '.wrlevel archive exceeds 40 MB');
  }

  const hash = createHash('sha256').update(upload.buffer).digest('hex');
  const temporaryRoot = await mkdtemp(path.join(context.store.temporaryDirectory, 'upload-'));
  try {
    const zipPath = path.join(temporaryRoot, 'package.wrlevel');
    const extractionRoot = path.join(temporaryRoot, 'extracted');
    await writeFile(zipPath, upload.buffer, { flag: 'wx', mode: 0o600 });
    await extractZip(zipPath, extractionRoot);
    const packageRoot = await findPackageRoot(extractionRoot);
    const validation = await validatePackage(packageRoot, { archiveSize: upload.buffer.length });
    const result = await context.store.createPending({
      manifest: validation.manifest,
      hash,
      archiveBytes: upload.buffer.length,
      uncompressedBytes: validation.uncompressedBytes,
      fileCount: validation.fileCount,
      packageRoot,
    });
    await recordDreamCondensation(context, {
      hash,
      kind: 'level',
      ownerId: null,
      name: result.record.manifest.name,
      isNew: !result.deduplicated,
    });
    sendJson(response, result.deduplicated ? 200 : 201, {
      levelId: result.record.id,
      status: result.record.status,
      reviewUrl: `/api/levels/${result.record.id}/status`,
      deduplicated: result.deduplicated,
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function avatarUploadMetadata(requestUrl) {
  const url = new URL(requestUrl, 'http://localhost');
  const allowed = ['name', 'author'];
  const unexpected = [...url.searchParams.keys()].filter((key) => !allowed.includes(key));
  if (unexpected.length || allowed.some((key) => url.searchParams.getAll(key).length !== 1)) {
    throw new HttpError(422, 'invalid_avatar_metadata', 'Exactly one name and author query parameter is required');
  }
  return {
    name: validateAvatarText(url.searchParams.get('name'), 'name'),
    author: validateAvatarText(url.searchParams.get('author'), 'author'),
  };
}

async function uploadAvatar(request, response, context) {
  requireBearer(request, context.uploadToken);
  context.avatarUploadRateLimiter.check(requestIp(request));
  const metadata = avatarUploadMetadata(request.url ?? '/api/avatars');
  const upload = await readMultipartFile(request, {
    maximumBodyBytes: MAX_AVATAR_MULTIPART_BYTES,
    fileDescription: '.glb',
  });
  if (!/\.glb$/i.test(upload.fileName)) {
    throw new HttpError(415, 'invalid_file_type', 'Uploaded avatar must use the .glb extension');
  }
  if (upload.buffer.length > MAX_AVATAR_BYTES) {
    throw new HttpError(413, 'avatar_too_large', 'Avatar GLB exceeds 8 MB');
  }
  const result = await context.avatarStore.create({ ...metadata, buffer: upload.buffer });
  const record = context.avatarStore.get(result.record.avatarId);
  await recordDreamCondensation(context, {
    hash: record.hash,
    kind: 'avatar',
    ownerId: null,
    name: record.name,
    isNew: !result.deduplicated,
  });
  sendJson(response, result.deduplicated ? 200 : 201, {
    avatarId: record.avatarId,
    name: record.name,
    author: record.author,
    hash: record.hash,
    avatarUrl: record.avatarUrl,
    launchUrl: record.launchUrl,
    deduplicated: result.deduplicated,
  }, {
    ...publicHeaders(context.corsOrigin),
    'Cache-Control': 'no-store',
  });
}

async function uploadAccountAvatar(request, response, context) {
  requireSameOriginMutation(request);
  const session = requireAccountSession(request, context);
  context.avatarUploadRateLimiter.checkOwner(session.ownerId, requestIp(request));
  const release = context.avatarUploadGate.enter();
  try {
    const upload = await readMultipartForm(request, {
      maximumBodyBytes: MAX_AVATAR_MULTIPART_BYTES,
      maximumFieldBytes: 512,
      fileDescription: '.glb',
      fileField: 'file',
      allowedFields: ['name', 'author'],
      requiredFields: ['name', 'author'],
    });
    if (!/\.glb$/i.test(upload.file.fileName)) {
      throw new HttpError(415, 'invalid_file_type', 'Uploaded avatar must use the .glb extension');
    }
    if (upload.file.buffer.length > MAX_AVATAR_BYTES) {
      throw new HttpError(413, 'avatar_too_large', 'Avatar GLB exceeds 8 MB');
    }
    const name = validateAvatarText(upload.fields.name, 'name');
    const author = validateAvatarText(upload.fields.author, 'author');
    const result = await context.avatarStore.createForOwner({
      ownerId: session.ownerId,
      name,
      author,
      buffer: upload.file.buffer,
    });
    const record = context.avatarStore.get(result.record.avatarId);
    await recordDreamCondensation(context, {
      hash: record.hash,
      kind: 'avatar',
      ownerId: session.ownerId,
      name: record.name,
      isNew: !result.deduplicated,
    });
    sendPrivateLobbyJson(response, result.deduplicated ? 200 : 201, {
      avatarId: record.avatarId,
      name: record.name,
      author: record.author,
      hash: record.hash,
      avatarUrl: record.avatarUrl,
      launchUrl: record.launchUrl,
      deduplicated: result.deduplicated,
    });
  } finally {
    release();
  }
}

async function uploadLobbyAsset(request, response, context) {
  requireSameOriginMutation(request);
  const ownerId = requireLobbyOwner(request, context);
  context.lobbyAssetUploadRateLimiter.check(ownerId, requestIp(request));
  const release = context.lobbyAssetUploadGate.enter();
  try {
    const upload = await readMultipartForm(request, {
      maximumBodyBytes: MAX_LOBBY_ASSET_MULTIPART_BYTES,
      maximumFieldBytes: 1024,
      fileDescription: '.glb',
      fileField: 'file',
      allowedFields: ['name', 'category', 'defaultScale'],
      requiredFields: ['name', 'category'],
    });
    if (!/\.glb$/i.test(upload.file.fileName)) {
      throw new HttpError(415, 'invalid_file_type', 'Uploaded lobby asset must use the .glb extension');
    }
    if (upload.file.buffer.length > MAX_LOBBY_ASSET_BYTES) {
      throw new HttpError(413, 'lobby_asset_too_large', 'Lobby asset GLB exceeds 15 MB');
    }
    const result = await context.lobbyAssetStore.create({
      ownerId,
      name: upload.fields.name,
      category: upload.fields.category,
      defaultScale: upload.fields.defaultScale ?? '1',
      buffer: upload.file.buffer,
    });
    context.lobbyStore.catalogIds?.add(result.record.id);
    await recordDreamCondensation(context, {
      hash: result.record.hash,
      kind: 'lobby-asset',
      ownerId,
      name: result.record.name,
      isNew: !result.deduplicated,
    });
    sendPrivateLobbyJson(response, result.deduplicated ? 200 : 201, {
      asset: context.lobbyAssetStore.get(result.record.id),
      deduplicated: result.deduplicated,
    });
  } finally {
    release();
  }
}

function sendLobbyJson(response, status, value, context) {
  sendJson(response, status, value, {
    ...publicHeaders(context.corsOrigin),
    'Cache-Control': 'no-store',
  });
}

function sendPrivateLobbyJson(response, status, value) {
  sendJson(response, status, value, {
    'Cache-Control': 'private, no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
    Vary: 'Cookie',
  });
}

function lobbyQuery(requestUrl, required, optional = []) {
  const url = new URL(requestUrl, 'http://localhost');
  const allowed = [...required, ...optional];
  const unexpected = [...url.searchParams.keys()].filter((key) => !allowed.includes(key));
  if (
    unexpected.length
    || required.some((key) => url.searchParams.getAll(key).length !== 1)
    || optional.some((key) => url.searchParams.getAll(key).length > 1)
  ) {
    const message = required.length
      ? `Exactly one ${required.join(', ')} query parameter is required`
      : 'Lobby query parameters are invalid';
    throw new HttpError(422, 'invalid_lobby_query', message);
  }
  return Object.fromEntries(allowed.map((key) => [key, url.searchParams.get(key)]));
}

function lobbyChannel(requestUrl) {
  return validateLobbyChannel(lobbyQuery(requestUrl, [], ['channel']).channel ?? DEFAULT_LOBBY_CHANNEL);
}

function lobbyEventQuery(requestUrl) {
  const query = lobbyQuery(requestUrl, ['clientId'], ['channel']);
  return {
    channel: validateLobbyChannel(query.channel ?? DEFAULT_LOBBY_CHANNEL),
    clientId: validateClientId(query.clientId),
  };
}

async function createLobbyObject(request, response, context) {
  requireSameOriginMutation(request);
  const channel = lobbyChannel(request.url ?? '/api/lobby/objects');
  const submitted = validateCreateLobbyObject(
    await readJsonBody(request),
    context.lobbyStore.catalogIds,
    { channel },
  );
  const ownerId = ensureLobbyOwner(request, response, context);
  if (
    LOBBY_ASSET_ID_PATTERN.test(submitted.catalogId)
    && !context.lobbyAssetStore.isOwnedBy(submitted.catalogId, ownerId)
  ) {
    throw new HttpError(403, 'lobby_asset_permission_denied', 'Only the uploaded asset owner may add new instances');
  }
  const body = { ...submitted, clientId: ownerId };
  context.lobbyRateLimiter.check(`${channel}:${body.clientId}`, requestIp(request));
  const change = await context.lobbyStore.create(channel, body);
  context.lobbyEvents.publish(channel, change);
  await recordDreamActivity(context, ownerId, 'shapes');
  sendLobbyJson(response, 201, {
    channel,
    object: change.object,
    revision: change.revision,
    updatedAt: change.updatedAt,
  }, context);
}

async function updateLobbyObject(request, response, context, rawId) {
  requireSameOriginMutation(request);
  const channel = lobbyChannel(request.url ?? '/api/lobby/objects');
  const id = validateObjectId(rawId);
  const submitted = validateUpdateLobbyObject(await readJsonBody(request), { channel });
  const body = { ...submitted, clientId: ensureLobbyOwner(request, response, context) };
  context.lobbyRateLimiter.check(`${channel}:${body.clientId}`, requestIp(request));
  const change = await context.multiplayerHub.updateLobbyObject(channel, id, body);
  context.lobbyEvents.publish(channel, change);
  sendLobbyJson(response, 200, {
    channel,
    object: change.object,
    revision: change.revision,
    updatedAt: change.updatedAt,
  }, context);
}

async function deleteLobbyObject(request, response, context, rawId) {
  requireSameOriginMutation(request);
  const channel = lobbyChannel(request.url ?? '/api/lobby/objects');
  const id = validateObjectId(rawId);
  const submitted = validateDeleteLobbyObject(await readJsonBody(request));
  const body = { ...submitted, clientId: ensureLobbyOwner(request, response, context) };
  context.lobbyRateLimiter.check(`${channel}:${body.clientId}`, requestIp(request));
  const change = await context.multiplayerHub.deleteLobbyObject(channel, id, body);
  context.lobbyEvents.publish(channel, change);
  sendLobbyJson(response, 200, {
    channel,
    objectId: change.objectId,
    revision: change.revision,
    updatedAt: change.updatedAt,
  }, context);
}

async function interactLobbyObject(request, response, context, rawId) {
  requireSameOriginMutation(request);
  const channel = lobbyChannel(request.url ?? '/api/lobby/objects');
  const id = validateObjectId(rawId);
  const submitted = validateInteractLobbyObject(await readJsonBody(request));
  const clientId = ensureLobbyOwner(request, response, context);
  context.lobbyRateLimiter.check(`${channel}:${clientId}`, requestIp(request));
  const change = await context.lobbyStore.interact(channel, id, { ...submitted, clientId });
  if (!change.replayed) {
    context.lobbyEvents.publish(channel, change);
    await recordDreamActivity(context, clientId, 'interacts');
  }
  sendLobbyJson(response, 200, {
    channel,
    object: change.object,
    revision: change.revision,
    updatedAt: change.updatedAt,
    serverTime: change.serverTime,
    replayed: change.replayed === true,
  }, context);
}

async function claimLobbyPlot(request, response, context, rawPlotId) {
  requireSameOriginMutation(request);
  const channel = lobbyChannel(request.url ?? '/api/lobby/plots');
  const plotId = validatePlotId(rawPlotId);
  const submitted = validateClaimLobbyPlot(await readJsonBody(request));
  const ownerId = ensureLobbyOwner(request, response, context);
  context.lobbyRateLimiter.check(`${channel}:${ownerId}`, requestIp(request));
  const change = await context.lobbyStore.claimPlot(channel, plotId, { ...submitted, ownerId });
  context.lobbyEvents.publish(channel, change);
  await recordDreamActivity(context, ownerId, 'anchors');
  sendLobbyJson(response, 201, {
    channel,
    plot: change.plot,
    revision: change.revision,
    updatedAt: change.updatedAt,
    serverTime: change.serverTime,
  }, context);
}

async function updateLobbyPlot(request, response, context, rawPlotId) {
  requireSameOriginMutation(request);
  const channel = lobbyChannel(request.url ?? '/api/lobby/plots');
  const plotId = validatePlotId(rawPlotId);
  const submitted = validateUpdateLobbyPlot(await readJsonBody(request));
  const ownerId = ensureLobbyOwner(request, response, context);
  context.lobbyRateLimiter.check(`${channel}:${ownerId}`, requestIp(request));
  const change = await context.lobbyStore.updatePlot(channel, plotId, { ...submitted, ownerId });
  context.lobbyEvents.publish(channel, change);
  sendLobbyJson(response, 200, {
    channel,
    plot: change.plot,
    revision: change.revision,
    updatedAt: change.updatedAt,
    serverTime: change.serverTime,
  }, context);
}

async function releaseLobbyPlot(request, response, context, rawPlotId) {
  requireSameOriginMutation(request);
  const channel = lobbyChannel(request.url ?? '/api/lobby/plots');
  const plotId = validatePlotId(rawPlotId);
  validateReleaseLobbyPlot(await readJsonBody(request));
  const ownerId = ensureLobbyOwner(request, response, context);
  context.lobbyRateLimiter.check(`${channel}:${ownerId}`, requestIp(request));
  const change = await context.lobbyStore.releasePlot(channel, plotId, { ownerId });
  context.lobbyEvents.publish(channel, change);
  sendLobbyJson(response, 200, {
    channel,
    plotId: change.plotId,
    revision: change.revision,
    updatedAt: change.updatedAt,
    serverTime: change.serverTime,
  }, context);
}

async function grantLobbyPlotCoAuthor(request, response, context, rawPlotId) {
  requireSameOriginMutation(request);
  const channel = lobbyChannel(request.url ?? '/api/lobby/plots');
  const plotId = validatePlotId(rawPlotId);
  const submitted = validateGrantPlotCoAuthor(await readJsonBody(request));
  const ownerId = ensureLobbyOwner(request, response, context);
  context.lobbyRateLimiter.check(`${channel}:${ownerId}`, requestIp(request));
  const change = await context.lobbyStore.grantPlotCoAuthor(channel, plotId, {
    ownerId,
    coAuthorId: submitted.coAuthorId,
  });
  context.lobbyEvents.publish(channel, change);
  sendLobbyJson(response, 200, {
    channel,
    plot: change.plot,
    revision: change.revision,
    updatedAt: change.updatedAt,
    serverTime: change.serverTime,
  }, context);
}

async function revokeLobbyPlotCoAuthor(request, response, context, rawPlotId, coAuthorId) {
  requireSameOriginMutation(request);
  const channel = lobbyChannel(request.url ?? '/api/lobby/plots');
  const plotId = validatePlotId(rawPlotId);
  const ownerId = ensureLobbyOwner(request, response, context);
  context.lobbyRateLimiter.check(`${channel}:${ownerId}`, requestIp(request));
  const change = await context.lobbyStore.revokePlotCoAuthor(channel, plotId, { ownerId, coAuthorId });
  context.lobbyEvents.publish(channel, change);
  sendLobbyJson(response, 200, {
    channel,
    plot: change.plot,
    revision: change.revision,
    updatedAt: change.updatedAt,
    serverTime: change.serverTime,
  }, context);
}

// ---------------------------------------------------------------------------
// 《眠海》世界观路由
// ---------------------------------------------------------------------------

async function recordDreamActivity(context, ownerId, kind, amount = 1) {
  try {
    await context.dreamseaStore.recordActivity(ownerId, kind, amount);
  } catch (error) {
    context.logger.error?.('dreamsea activity record failed', error);
  }
}

async function recordDreamCondensation(context, { hash, kind, ownerId, name, isNew }) {
  try {
    const result = await context.dreamseaStore.recordCondensation({ hash, kind, ownerId, name });
    if (ownerId && result.isOrigin && isNew) {
      await context.dreamseaStore.recordActivity(ownerId, 'creations');
    } else if (ownerId && !result.isOrigin && result.echoIsNew) {
      // 只有首次回响计入旅程；重复重凝同一份字节不再刷计数
      await context.dreamseaStore.recordActivity(ownerId, 'echoes');
    }
    return result;
  } catch (error) {
    context.logger.error?.('dreamsea lineage record failed', error);
    return null;
  }
}

// 眠海身份端点的统一门槛：必须已接入潜航协议（持有身份 Cookie），并计入大厅限流
function requireDreamer(request, context) {
  const ownerId = requireLobbyOwner(request, context);
  context.lobbyRateLimiter.check(`dreamsea:${ownerId}`, requestIp(request));
  return ownerId;
}

function getDreamseaWorldview(response, context) {
  sendJson(response, 200, context.dreamseaStore.worldviewView(), {
    ...publicHeaders(context.corsOrigin),
    'Cache-Control': 'no-store',
  });
}

async function getDreamseaTotem(request, response, context) {
  const ownerId = requireDreamer(request, context);
  const totem = await context.dreamseaStore.ensureTotem(ownerId);
  sendPrivateLobbyJson(response, 200, { totem: context.dreamseaStore.totemView(totem) });
}

async function getDreamseaTotemPublic(request, response, context, ownerId) {
  requireDreamer(request, context);
  const totem = await context.dreamseaStore.peekTotem(ownerId);
  if (!totem) throw new HttpError(404, 'dreamsea_totem_not_found', 'This dreamer has not condensed a totem yet');
  sendJson(response, 200, { totem: context.dreamseaStore.blurredTotemView(totem) }, {
    ...publicHeaders(context.corsOrigin),
    'Cache-Control': 'no-store',
  });
}

async function getDreamseaJourney(request, response, context) {
  const ownerId = requireDreamer(request, context);
  sendPrivateLobbyJson(response, 200, { journey: await context.dreamseaStore.journeyView(ownerId) });
}

async function getDreamseaLineage(response, context, hash) {
  const lineage = await context.dreamseaStore.lineageView(validateLineageHash(hash));
  if (!lineage) throw new HttpError(404, 'dreamsea_lineage_not_found', 'No condensation lineage exists for this hash');
  sendJson(response, 200, { lineage }, {
    ...publicHeaders(context.corsOrigin),
    'Cache-Control': 'no-store',
  });
}

async function grantDreamseaSeed(request, response, context) {
  requireSameOriginMutation(request);
  const ownerId = requireDreamer(request, context);
  const body = await readJsonBody(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(422, 'invalid_seed_grant', 'A JSON object with hash and toOwnerId is required');
  }
  const keys = Object.keys(body);
  if (keys.length !== 2 || !keys.includes('hash') || !keys.includes('toOwnerId')) {
    throw new HttpError(422, 'invalid_seed_grant', 'Exactly hash and toOwnerId are required');
  }
  // 授出念种需要造梦师阶位（第八章：造梦师可订立域理、授出被启发的权利）
  await context.dreamseaStore.assertRank(ownerId, 'dreamwright');
  const { seed } = await context.dreamseaStore.grantSeed({
    hash: body.hash,
    byOwnerId: ownerId,
    toOwnerId: body.toOwnerId,
  });
  await recordDreamActivity(context, ownerId, 'seedsGranted');
  await recordDreamActivity(context, seed.toOwnerId, 'seedsReceived');
  sendPrivateLobbyJson(response, 201, {
    seed,
    lore: '念种当面授受为敬。念脉将记其后续凝结为「承种」。',
  });
}

async function diveDreamseaLevel(request, response, context) {
  requireSameOriginMutation(request);
  const ownerId = requireDreamer(request, context);
  const body = await readJsonBody(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 1 || typeof body.levelId !== 'string') {
    throw new HttpError(422, 'invalid_dive', 'A JSON object with exactly levelId is required');
  }
  if (!LEVEL_ID_PATTERN.test(body.levelId)) {
    throw new HttpError(404, 'level_not_found', 'Level was not found');
  }
  const record = await context.store.getRecord(body.levelId);
  if (!record || record.status !== 'approved') {
    throw new HttpError(404, 'level_not_found', 'Level was not found');
  }
  if (context.dreamseaStore.isSunken(record.id)) {
    throw new HttpError(409, 'dreamsea_level_sunken', 'This dream domain has sunk into the lost depths', {
      lore: '此梦域已没入迷失域。需深潜者下潜打捞，才能重新浮上明海。',
    });
  }
  context.dreamseaStore.noteLevelVisit(record.id, { seedIfMissing: true });
  await recordDreamActivity(context, ownerId, 'dives');
  sendPrivateLobbyJson(response, 200, {
    levelId: record.id,
    visitedAt: new Date(context.clock()).toISOString(),
    lore: '梦以被梦见为生。你的到访为此域续了浮力。',
  });
}

async function runDreamseaSinkPatrol(context) {
  const records = await context.store.listRecords();
  const changed = context.dreamseaStore.sunkenStateChanged(records);
  if (changed) await context.store.rebuildRegistry();
  context.dreamseaStore.syncAppliedSunken(records);
  await context.dreamseaStore.flushBuoyancy();
  const sunken = records
    .filter((record) => record.status === 'approved' && context.dreamseaStore.isSunken(record.id))
    .map((record) => record.id);
  return {
    changed,
    sunken,
    floating: records.filter((record) => record.status === 'approved').length - sunken.length,
  };
}

async function listDreamseaAbyss(request, response, context) {
  const ownerId = requireDreamer(request, context);
  // 梦境考古是深潜者的权限（第八章）
  await context.dreamseaStore.assertRank(ownerId, 'deepdiver');
  const records = await context.store.listRecords();
  sendPrivateLobbyJson(response, 200, {
    domains: context.dreamseaStore.abyssView(records),
    lore: '迷失域中，失去梦主的投影仍在执行早已无意义的域理。被遗忘的杰作在海底等待重见天日。',
  });
}

async function salvageDreamseaLevel(request, response, context, levelId) {
  requireSameOriginMutation(request);
  const ownerId = requireDreamer(request, context);
  await context.dreamseaStore.assertRank(ownerId, 'deepdiver');
  if (!LEVEL_ID_PATTERN.test(levelId)) {
    throw new HttpError(404, 'level_not_found', 'Level was not found');
  }
  const record = await context.store.getRecord(levelId);
  const salvage = await context.dreamseaStore.salvageLevel(levelId, record);
  await context.store.rebuildRegistry();
  await recordDreamActivity(context, ownerId, 'salvages');
  sendPrivateLobbyJson(response, 200, { salvage });
}

async function declareDreamseaCalamity(request, response, context) {
  requireBearer(request, context.adminToken);
  const body = await readJsonBody(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(422, 'invalid_calamity', 'A JSON object is required');
  }
  const allowed = new Set(['title', 'note', 'channel', 'durationMs']);
  const unexpected = Object.keys(body).filter((key) => !allowed.has(key));
  if (unexpected.length || typeof body.title !== 'string') {
    throw new HttpError(422, 'invalid_calamity', 'title is required; note, channel and durationMs are optional', {
      unexpected,
    });
  }
  const calamity = await context.dreamseaStore.declareCalamity({
    title: body.title,
    note: body.note ?? null,
    channel: body.channel ?? null,
    ...(body.durationMs !== undefined ? { durationMs: body.durationMs } : {}),
  });
  sendJson(response, 201, { calamity }, { 'Cache-Control': 'private, no-store' });
}

async function triggerDreamseaSinkPatrol(request, response, context) {
  requireBearer(request, context.adminToken);
  const patrol = await runDreamseaSinkPatrol(context);
  sendJson(response, 200, { patrol }, { 'Cache-Control': 'private, no-store' });
}

async function route(request, response, context) {
  const pathname = decodePathname(request.url ?? '/');

  if (request.method === 'OPTIONS') {
    if (isLobbyAssetPath(pathname)) {
      response.writeHead(204, {
        ...sameOriginAssetHeaders(),
        'Cache-Control': 'no-store',
      });
      response.end();
      return;
    }
    response.writeHead(204, {
      ...publicHeaders(context.corsOrigin),
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Max-Age': '600',
    });
    response.end();
    return;
  }

  if (request.method === 'GET' && (pathname === '/health' || pathname === '/healthz')) {
    sendJson(response, 200, { status: 'ok', service: 'whiteroom-platform' }, {
      'Cache-Control': 'no-store',
    });
    return;
  }

  if ((request.method === 'GET' || request.method === 'HEAD') && PORTAL_ASSETS.has(pathname)) {
    await sendPortalAsset(request, response, pathname);
    return;
  }

  if ((request.method === 'GET' || request.method === 'HEAD') && pathname === '/admin') {
    response.writeHead(308, {
      Location: '/admin/',
      'Cache-Control': 'no-store',
    });
    response.end();
    return;
  }

  if ((request.method === 'GET' || request.method === 'HEAD') && pathname.startsWith('/admin/')) {
    await sendAdminAsset(request, response, pathname);
    return;
  }

  if (request.method === 'GET' && pathname === '/api/auth/config') {
    sendPrivateLobbyJson(response, 200, context.supabaseAuth.publicConfig());
    return;
  }

  if (request.method === 'GET' && pathname === '/api/auth/me') {
    const session = verifiedAccountSession(request, context);
    sendPrivateLobbyJson(response, 200, session
      ? { account: { signedIn: true, provider: 'email' }, ownerId: session.ownerId }
      : { account: { signedIn: false } });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/auth/session') {
    await establishAccountSession(request, response, context);
    return;
  }

  if (request.method === 'POST' && pathname === '/api/auth/logout') {
    endAccountSession(request, response, context);
    return;
  }

  if (request.method === 'GET' && pathname === '/api/account/prop-creations/config') {
    sendPrivateLobbyJson(response, 200, {
      enabled: Boolean(context.propWorkerToken),
      requiresAccount: true,
      maximumPromptCharacters: MAX_PROP_PROMPT_CHARACTERS,
      publicationMode: context.propAutoPublish ? 'automatic' : 'manual',
      worker: context.propCreationStore.workerStatus(),
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/account/prop-creations') {
    await listOwnerPropCreations(request, response, context);
    return;
  }

  if (request.method === 'POST' && pathname === '/api/account/prop-creations') {
    await createPropCreation(request, response, context);
    return;
  }

  const ownerPropCreationMatch = /^\/api\/account\/prop-creations\/([^/]+)$/.exec(pathname);
  const ownerPropCreationCancelMatch = /^\/api\/account\/prop-creations\/([^/]+)\/cancel$/.exec(pathname);
  if (request.method === 'GET' && ownerPropCreationMatch) {
    await getOwnerPropCreation(request, response, context, ownerPropCreationMatch[1]);
    return;
  }
  if (request.method === 'POST' && ownerPropCreationCancelMatch) {
    await cancelOwnerPropCreation(request, response, context, ownerPropCreationCancelMatch[1]);
    return;
  }

  if (request.method === 'POST' && pathname === '/api/worker/prop-creations/claim') {
    await claimPropCreation(request, response, context);
    return;
  }

  const workerPropProgressMatch = /^\/api\/worker\/prop-creations\/([^/]+)\/progress$/.exec(pathname);
  const workerPropCompleteMatch = /^\/api\/worker\/prop-creations\/([^/]+)\/complete$/.exec(pathname);
  const workerPropFailMatch = /^\/api\/worker\/prop-creations\/([^/]+)\/fail$/.exec(pathname);
  const workerPropPublicationProgressMatch = /^\/api\/worker\/prop-creations\/([^/]+)\/publication-progress$/.exec(pathname);
  const workerPropPublicationSuccessMatch = /^\/api\/worker\/prop-creations\/([^/]+)\/publication-success$/.exec(pathname);
  const workerPropPublicationFailureMatch = /^\/api\/worker\/prop-creations\/([^/]+)\/publication-failure$/.exec(pathname);
  if (request.method === 'POST' && workerPropProgressMatch) {
    await updatePropCreationProgress(request, response, context, workerPropProgressMatch[1]);
    return;
  }
  if (request.method === 'POST' && workerPropCompleteMatch) {
    await completePropCreation(request, response, context, workerPropCompleteMatch[1]);
    return;
  }
  if (request.method === 'POST' && workerPropFailMatch) {
    await failPropCreation(request, response, context, workerPropFailMatch[1]);
    return;
  }
  if (request.method === 'POST' && workerPropPublicationProgressMatch) {
    await updatePropPublicationProgress(request, response, context, workerPropPublicationProgressMatch[1]);
    return;
  }
  if (request.method === 'POST' && workerPropPublicationSuccessMatch) {
    await completePropPublication(request, response, context, workerPropPublicationSuccessMatch[1]);
    return;
  }
  if (request.method === 'POST' && workerPropPublicationFailureMatch) {
    await failPropPublication(request, response, context, workerPropPublicationFailureMatch[1]);
    return;
  }

  if (request.method === 'POST' && pathname === '/api/levels') {
    await uploadLevel(request, response, context);
    return;
  }

  if (request.method === 'POST' && pathname === '/api/avatars') {
    await uploadAvatar(request, response, context);
    return;
  }

  if (request.method === 'GET' && pathname === '/api/account/avatars') {
    requireSameOriginMutation(request);
    const session = requireAccountSession(request, context);
    sendPrivateLobbyJson(response, 200, context.avatarStore.getOwnerRegistry(session.ownerId));
    return;
  }

  if (request.method === 'POST' && pathname === '/api/account/avatars') {
    await uploadAccountAvatar(request, response, context);
    return;
  }

  if (request.method === 'GET' && pathname === '/api/avatars') {
    sendJson(response, 200, context.avatarStore.getRegistry(), {
      ...publicHeaders(context.corsOrigin),
      'Cache-Control': 'no-cache',
    });
    return;
  }

  const avatarMetadataMatch = /^\/api\/avatars\/([^/]+)$/.exec(pathname);
  if (request.method === 'GET' && avatarMetadataMatch) {
    const avatar = context.avatarStore.get(avatarMetadataMatch[1]);
    if (!avatar) throw new HttpError(404, 'avatar_not_found', 'Avatar was not found');
    sendJson(response, 200, avatar, {
      ...publicHeaders(context.corsOrigin),
      'Cache-Control': 'no-cache',
    });
    return;
  }

  const avatarFileMatch = /^\/avatars\/([^/]+)\/avatar\.glb$/.exec(pathname);
  if ((request.method === 'GET' || request.method === 'HEAD') && avatarFileMatch) {
    await sendAvatarFile(request, response, context.avatarStore, avatarFileMatch[1], context.corsOrigin);
    return;
  }

  if (request.method === 'POST' && pathname === '/api/lobby/assets') {
    await uploadLobbyAsset(request, response, context);
    return;
  }

  if (request.method === 'GET' && pathname === '/api/lobby/assets') {
    const ownerId = ensureLobbyOwner(request, response, context);
    sendPrivateLobbyJson(response, 200, {
      schemaVersion: 1,
      assets: context.lobbyAssetStore.listOwner(ownerId),
    });
    return;
  }

  const lobbyAssetMetadataMatch = /^\/api\/lobby\/assets\/([^/]+)$/.exec(pathname);
  if (request.method === 'GET' && lobbyAssetMetadataMatch) {
    const asset = context.lobbyAssetStore.get(lobbyAssetMetadataMatch[1]);
    if (!asset) throw new HttpError(404, 'lobby_asset_not_found', 'Lobby asset was not found');
    sendJson(response, 200, { asset }, {
      ...sameOriginAssetHeaders(),
      'Cache-Control': 'no-cache',
    });
    return;
  }

  const lobbyAssetFileMatch = /^\/lobby-assets\/([^/]+)\/model\.glb$/.exec(pathname);
  if ((request.method === 'GET' || request.method === 'HEAD') && lobbyAssetFileMatch) {
    await sendLobbyAssetFile(
      request,
      response,
      context.lobbyAssetStore,
      lobbyAssetFileMatch[1],
    );
    return;
  }

  if (request.method === 'GET' && pathname === '/registry.json') {
    sendJson(response, 200, context.store.getRegistry(), {
      ...publicHeaders(context.corsOrigin),
      'Cache-Control': 'no-cache',
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/lobby/catalog') {
    sendLobbyJson(response, 200, context.lobbyCatalog, context);
    return;
  }

  if (request.method === 'GET' && pathname === '/api/lobby/identity') {
    const ownerId = ensureLobbyOwner(request, response, context);
    sendLobbyJson(response, 200, {
      ownerId,
      account: { signedIn: Boolean(verifiedAccountSession(request, context)) },
      serverTime: new Date(context.clock()).toISOString(),
    }, context);
    return;
  }

  if (request.method === 'GET' && pathname === '/api/lobby/state') {
    const channel = lobbyChannel(request.url ?? pathname);
    sendLobbyJson(response, 200, {
      channel,
      ...await context.lobbyStore.getState(channel),
      serverTime: new Date(context.clock()).toISOString(),
    }, context);
    return;
  }

  if (request.method === 'GET' && pathname === '/api/lobby/events') {
    const { channel, clientId } = lobbyEventQuery(request.url ?? pathname);
    const initialState = {
      channel,
      ...await context.lobbyStore.getState(channel),
      serverTime: new Date(context.clock()).toISOString(),
    };
    context.lobbyEvents.connect(
      request,
      response,
      channel,
      clientId,
      initialState,
      context.corsOrigin,
      { synchronize: true },
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!context.lobbyEvents.connections.has(response)) break;
      const latestState = {
        channel,
        ...await context.lobbyStore.getState(channel),
        serverTime: new Date(context.clock()).toISOString(),
      };
      if (context.lobbyEvents.finishSynchronization(response, latestState)) break;
      if (attempt === 2) {
        context.lobbyEvents.disconnect(response, true);
        response.destroy();
      }
    }
    return;
  }

  if (request.method === 'POST' && pathname === '/api/lobby/objects') {
    await createLobbyObject(request, response, context);
    return;
  }

  const lobbyPlotClaimMatch = /^\/api\/lobby\/plots\/([^/]+)\/claim$/.exec(pathname);
  const lobbyPlotMatch = /^\/api\/lobby\/plots\/([^/]+)$/.exec(pathname);
  if (request.method === 'POST' && lobbyPlotClaimMatch) {
    await claimLobbyPlot(request, response, context, lobbyPlotClaimMatch[1]);
    return;
  }
  if (request.method === 'PATCH' && lobbyPlotMatch) {
    await updateLobbyPlot(request, response, context, lobbyPlotMatch[1]);
    return;
  }
  if (request.method === 'DELETE' && lobbyPlotMatch) {
    await releaseLobbyPlot(request, response, context, lobbyPlotMatch[1]);
    return;
  }

  const lobbyPlotCoAuthorsMatch = /^\/api\/lobby\/plots\/([^/]+)\/coauthors$/.exec(pathname);
  const lobbyPlotCoAuthorMatch = /^\/api\/lobby\/plots\/([^/]+)\/coauthors\/([^/]+)$/.exec(pathname);
  if (request.method === 'POST' && lobbyPlotCoAuthorsMatch) {
    await grantLobbyPlotCoAuthor(request, response, context, lobbyPlotCoAuthorsMatch[1]);
    return;
  }
  if (request.method === 'DELETE' && lobbyPlotCoAuthorMatch) {
    await revokeLobbyPlotCoAuthor(
      request,
      response,
      context,
      lobbyPlotCoAuthorMatch[1],
      lobbyPlotCoAuthorMatch[2],
    );
    return;
  }

  if (request.method === 'GET' && pathname === '/api/dreamsea/worldview') {
    getDreamseaWorldview(response, context);
    return;
  }
  if (request.method === 'GET' && pathname === '/api/dreamsea/totem') {
    await getDreamseaTotem(request, response, context);
    return;
  }
  const dreamseaTotemMatch = /^\/api\/dreamsea\/totems\/([^/]+)$/.exec(pathname);
  if (request.method === 'GET' && dreamseaTotemMatch) {
    await getDreamseaTotemPublic(request, response, context, dreamseaTotemMatch[1]);
    return;
  }
  if (request.method === 'GET' && pathname === '/api/dreamsea/journey') {
    await getDreamseaJourney(request, response, context);
    return;
  }
  const dreamseaLineageMatch = /^\/api\/dreamsea\/lineage\/([^/]+)$/.exec(pathname);
  if (request.method === 'GET' && dreamseaLineageMatch) {
    await getDreamseaLineage(response, context, dreamseaLineageMatch[1]);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/dreamsea/seeds') {
    await grantDreamseaSeed(request, response, context);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/dreamsea/dive') {
    await diveDreamseaLevel(request, response, context);
    return;
  }
  if (request.method === 'GET' && pathname === '/api/dreamsea/abyss') {
    await listDreamseaAbyss(request, response, context);
    return;
  }
  const dreamseaSalvageMatch = /^\/api\/dreamsea\/abyss\/([^/]+)\/salvage$/.exec(pathname);
  if (request.method === 'POST' && dreamseaSalvageMatch) {
    await salvageDreamseaLevel(request, response, context, dreamseaSalvageMatch[1]);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/admin/dreamsea/calamities') {
    await declareDreamseaCalamity(request, response, context);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/admin/dreamsea/sink-patrol') {
    await triggerDreamseaSinkPatrol(request, response, context);
    return;
  }

  const lobbyObjectMatch = /^\/api\/lobby\/objects\/([^/]+)$/.exec(pathname);
  const lobbyInteractionMatch = /^\/api\/lobby\/objects\/([^/]+)\/interactions$/.exec(pathname);
  if (request.method === 'POST' && lobbyInteractionMatch) {
    await interactLobbyObject(request, response, context, lobbyInteractionMatch[1]);
    return;
  }
  if (request.method === 'PATCH' && lobbyObjectMatch) {
    await updateLobbyObject(request, response, context, lobbyObjectMatch[1]);
    return;
  }
  if (request.method === 'DELETE' && lobbyObjectMatch) {
    await deleteLobbyObject(request, response, context, lobbyObjectMatch[1]);
    return;
  }

  const statusMatch = /^\/api\/levels\/([^/]+)\/status$/.exec(pathname);
  if (request.method === 'GET' && statusMatch) {
    const id = statusMatch[1];
    if (!LEVEL_ID_PATTERN.test(id)) throw new HttpError(404, 'level_not_found', 'Level was not found');
    const record = await context.store.getRecord(id);
    if (!record) throw new HttpError(404, 'level_not_found', 'Level was not found');
    sendJson(response, 200, context.store.statusView(record), {
      'Cache-Control': 'no-store',
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/admin/levels') {
    requireBearer(request, context.adminToken);
    await listAdminLevels(request.url ?? pathname, response, context);
    return;
  }

  if (request.method === 'GET' && pathname === '/api/admin/prop-creations') {
    requireBearer(request, context.adminToken);
    await listAdminPropCreations(request.url ?? pathname, response, context);
    return;
  }

  const adminPropDetailMatch = /^\/api\/admin\/prop-creations\/([^/]+)$/.exec(pathname);
  const adminPropArtifactMatch = /^\/api\/admin\/prop-creations\/([^/]+)\/artifact$/.exec(pathname);
  const adminPropReviewMatch = /^\/api\/admin\/prop-creations\/([^/]+)\/(approve|reject)$/.exec(pathname);
  if (request.method === 'GET' && adminPropDetailMatch) {
    requireBearer(request, context.adminToken);
    await getAdminPropCreation(response, context, adminPropDetailMatch[1]);
    return;
  }
  if ((request.method === 'GET' || request.method === 'HEAD') && adminPropArtifactMatch) {
    requireBearer(request, context.adminToken);
    const record = await context.propCreationStore.get(adminPropArtifactMatch[1]);
    if (!record?.artifact) throw new HttpError(404, 'prop_artifact_not_found', 'Prop artifact was not found');
    await sendPropArtifact(request, response, context.propCreationStore, record);
    return;
  }
  if (request.method === 'POST' && adminPropReviewMatch) {
    requireBearer(request, context.adminToken);
    const body = requirePropJsonObject(await readJsonBody(request), {
      allowed: ['reason'],
    });
    const [, id, action] = adminPropReviewMatch;
    const record = await context.propCreationStore.review(
      id,
      action === 'approve' ? 'approved' : 'rejected',
      body.reason,
    );
    sendJson(response, 200, { job: context.propCreationStore.adminDetailView(record) }, {
      'Cache-Control': 'private, no-store',
    });
    return;
  }

  const adminDetailMatch = /^\/api\/admin\/levels\/([^/]+)$/.exec(pathname);
  if (request.method === 'GET' && adminDetailMatch) {
    requireBearer(request, context.adminToken);
    await getAdminLevel(response, context, adminDetailMatch[1]);
    return;
  }

  const previewTokenMatch = /^\/api\/admin\/levels\/([^/]+)\/preview-token$/.exec(pathname);
  if (request.method === 'POST' && previewTokenMatch) {
    requireBearer(request, context.adminToken);
    await createAdminPreview(response, context, previewTokenMatch[1]);
    return;
  }

  const previewFileMatch = /^\/api\/admin\/preview\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  if ((request.method === 'GET' || request.method === 'HEAD') && previewFileMatch) {
    await sendPendingPreviewFile(
      request,
      response,
      context,
      previewFileMatch[1],
      previewFileMatch[2],
    );
    return;
  }

  const adminMatch = /^\/api\/admin\/levels\/([^/]+)\/(approve|reject)$/.exec(pathname);
  if (request.method === 'POST' && adminMatch) {
    requireBearer(request, context.adminToken);
    const [, id, action] = adminMatch;
    if (!LEVEL_ID_PATTERN.test(id)) throw new HttpError(404, 'level_not_found', 'Level was not found');
    const body = await readJsonBody(request);
    const updated = await context.store.updateStatus(
      id,
      action === 'approve' ? 'approved' : 'rejected',
      body.reason,
    );
    sendJson(response, 200, context.store.statusView(updated));
    return;
  }

  const staticMatch = /^\/levels\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  if ((request.method === 'GET' || request.method === 'HEAD') && staticMatch) {
    await sendApprovedFile(
      request,
      response,
      context.store,
      staticMatch[1],
      staticMatch[2],
      context.corsOrigin,
    );
    // 浮力法则：加载梦域主文档视为一次到访（已沉没者不因静态访问上浮，须经打捞）
    if (!staticMatch[2] || staticMatch[2] === 'level.json') {
      context.dreamseaStore.noteLevelVisit(staticMatch[1]);
    }
    return;
  }

  throw new HttpError(404, 'not_found', 'Resource not found');
}

export async function createApplication(options = {}) {
  const uploadToken = options.uploadToken ?? process.env.WHITEROOM_PORTAL_TOKEN;
  const adminToken = options.adminToken ?? process.env.WHITEROOM_ADMIN_TOKEN;
  validateTokens(uploadToken, adminToken);
  const propWorkerToken = options.propWorkerToken ?? process.env.WHITEROOM_PROP_WORKER_TOKEN ?? null;
  if (propWorkerToken !== null) {
    if (typeof propWorkerToken !== 'string' || Buffer.byteLength(propWorkerToken) < 32) {
      throw new Error('WHITEROOM_PROP_WORKER_TOKEN must be at least 32 bytes');
    }
    if (propWorkerToken === uploadToken || propWorkerToken === adminToken) {
      throw new Error('WHITEROOM_PROP_WORKER_TOKEN must be different from upload and admin tokens');
    }
  }
  const propAutoPublish = booleanSetting(
    options.propAutoPublish ?? process.env.WHITEROOM_PROP_AUTO_PUBLISH,
    false,
    'WHITEROOM_PROP_AUTO_PUBLISH',
  );
  if (propAutoPublish && !propWorkerToken) {
    throw new Error('WHITEROOM_PROP_AUTO_PUBLISH requires WHITEROOM_PROP_WORKER_TOKEN');
  }
  const configuredLobbyOwnerSecret = options.lobbyOwnerSecret ?? process.env.WHITEROOM_LOBBY_OWNER_SECRET;
  const lobbyOwnerSecret = configuredLobbyOwnerSecret ?? adminToken;
  if (configuredLobbyOwnerSecret && Buffer.byteLength(lobbyOwnerSecret) < 32) {
    throw new Error('WHITEROOM_LOBBY_OWNER_SECRET must be at least 32 bytes');
  }
  const configuredAccountSessionSecret = options.accountSessionSecret
    ?? process.env.WHITEROOM_ACCOUNT_SESSION_SECRET;
  if (configuredAccountSessionSecret && Buffer.byteLength(configuredAccountSessionSecret) < 32) {
    throw new Error('WHITEROOM_ACCOUNT_SESSION_SECRET must be at least 32 bytes');
  }
  const accountSessionSecret = configuredAccountSessionSecret
    ?? createHash('sha256').update('whiteroom-account-session\0').update(lobbyOwnerSecret).digest();

  const clock = options.clock ?? Date.now;
  if (typeof clock !== 'function' || !Number.isSafeInteger(clock())) {
    throw new Error('clock must return an integer Unix timestamp in milliseconds');
  }
  const logger = options.logger ?? console;
  const dataDirectory = options.dataDirectory ?? process.env.WHITEROOM_DATA_DIR ?? path.resolve('data');
  const supabaseAuth = options.supabaseAuth ?? new SupabaseAuthVerifier({
    url: process.env.WHITEROOM_SUPABASE_URL,
    publishableKey: process.env.WHITEROOM_SUPABASE_PUBLISHABLE_KEY,
    clock,
  });
  const dreamseaSecret = options.dreamsea?.secret
    ?? process.env.WHITEROOM_DREAMSEA_SECRET
    ?? createHash('sha256').update('whiteroom-dreamsea\0').update(lobbyOwnerSecret).digest();
  const dreamseaStore = options.dreamseaStore ?? new DreamseaStore({
    dataDirectory,
    clock,
    secret: dreamseaSecret,
    sinkAfterMs: positiveIntegerSetting(
      options.dreamsea?.sinkAfterMs ?? process.env.WHITEROOM_DREAMSEA_SINK_AFTER_MS,
      30 * 24 * 60 * 60_000,
      { name: 'WHITEROOM_DREAMSEA_SINK_AFTER_MS', minimum: 1_000, maximum: 3650 * 24 * 60 * 60_000 },
    ),
    rankThresholds: options.dreamsea?.rankThresholds,
    logger,
  });
  await dreamseaStore.initialize();
  const store = options.store ?? new FileStore(dataDirectory);
  // 浮力法则：重建海图时过滤沉没梦域（自定义 store 若已带过滤器则尊重之）
  if (!store.registryFilter) {
    store.registryFilter = (levels) => dreamseaStore.filterRegistryLevels(levels);
  }
  await store.initialize();
  const propCreationStore = options.propCreationStore ?? new PropCreationStore({
    dataDirectory: store.dataDirectory ?? dataDirectory,
    clock,
    leaseMs: positiveIntegerSetting(
      options.propCreationLimits?.leaseMs ?? process.env.WHITEROOM_PROP_LEASE_MS,
      30 * 60_000,
      { name: 'WHITEROOM_PROP_LEASE_MS', minimum: 60_000, maximum: 4 * 60 * 60_000 },
    ),
    workerOnlineMs: positiveIntegerSetting(
      options.propCreationLimits?.workerOnlineMs ?? process.env.WHITEROOM_PROP_WORKER_ONLINE_MS,
      45_000,
      { name: 'WHITEROOM_PROP_WORKER_ONLINE_MS', minimum: 5_000, maximum: 10 * 60_000 },
    ),
    maxAttempts: positiveIntegerSetting(
      options.propCreationLimits?.maxAttempts ?? process.env.WHITEROOM_PROP_MAX_ATTEMPTS,
      3,
      { name: 'WHITEROOM_PROP_MAX_ATTEMPTS', minimum: 1, maximum: 10 },
    ),
    maxActivePerOwner: positiveIntegerSetting(
      options.propCreationLimits?.maxActivePerOwner ?? process.env.WHITEROOM_PROP_MAX_ACTIVE_PER_OWNER,
      2,
      { name: 'WHITEROOM_PROP_MAX_ACTIVE_PER_OWNER', minimum: 1, maximum: 20 },
    ),
    maxDailyPerOwner: positiveIntegerSetting(
      options.propCreationLimits?.maxDailyPerOwner ?? process.env.WHITEROOM_PROP_MAX_DAILY_PER_OWNER,
      3,
      { name: 'WHITEROOM_PROP_MAX_DAILY_PER_OWNER', minimum: 1, maximum: 100 },
    ),
    maxDailyPerIp: positiveIntegerSetting(
      options.propCreationLimits?.maxDailyPerIp ?? process.env.WHITEROOM_PROP_MAX_DAILY_PER_IP,
      12,
      { name: 'WHITEROOM_PROP_MAX_DAILY_PER_IP', minimum: 1, maximum: 1_000 },
    ),
    idFactory: options.propCreationIdFactory,
  });
  await propCreationStore.initialize();
  const lobbyCatalog = options.lobbyCatalog ?? await loadLobbyCatalog();
  const lobbyAssetStore = options.lobbyAssetStore ?? new LobbyAssetStore({
    dataDirectory: store.dataDirectory ?? dataDirectory,
    clock,
    maxPerOwner: positiveIntegerSetting(
      options.lobbyAssetLimits?.maxPerOwner ?? process.env.WHITEROOM_LOBBY_ASSET_MAX_PER_OWNER,
      20,
      { name: 'WHITEROOM_LOBBY_ASSET_MAX_PER_OWNER', minimum: 1, maximum: 1_000 },
    ),
    maxBytesPerOwner: positiveIntegerSetting(
      options.lobbyAssetLimits?.maxBytesPerOwner ?? process.env.WHITEROOM_LOBBY_ASSET_MAX_BYTES_PER_OWNER,
      128 * 1024 * 1024,
      { name: 'WHITEROOM_LOBBY_ASSET_MAX_BYTES_PER_OWNER', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    ),
    maxRecords: positiveIntegerSetting(
      options.lobbyAssetLimits?.maxRecords ?? process.env.WHITEROOM_LOBBY_ASSET_MAX_RECORDS,
      5_000,
      { name: 'WHITEROOM_LOBBY_ASSET_MAX_RECORDS', minimum: 1, maximum: 100_000 },
    ),
    maxTotalBytes: positiveIntegerSetting(
      options.lobbyAssetLimits?.maxTotalBytes ?? process.env.WHITEROOM_LOBBY_ASSET_MAX_TOTAL_BYTES,
      512 * 1024 * 1024,
      { name: 'WHITEROOM_LOBBY_ASSET_MAX_TOTAL_BYTES', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    ),
    idFactory: options.lobbyAssetIdFactory,
  });
  await lobbyAssetStore.initialize();
  const lobbyStore = options.lobbyStore ?? new LobbyStore({
    dataDirectory: store.dataDirectory ?? dataDirectory,
    catalog: lobbyCatalog,
    clock,
    idFactory: options.lobbyIdFactory,
    maxLoadedChannels: positiveIntegerSetting(
      options.lobbyChannelLimits?.maxLoaded ?? process.env.WHITEROOM_LOBBY_CHANNEL_MAX_LOADED,
      512,
      { name: 'WHITEROOM_LOBBY_CHANNEL_MAX_LOADED', minimum: 2, maximum: 10_000 },
    ),
    maxPersistedChannels: positiveIntegerSetting(
      options.lobbyChannelLimits?.maxPersisted ?? process.env.WHITEROOM_LOBBY_CHANNEL_MAX_PERSISTED,
      10_000,
      { name: 'WHITEROOM_LOBBY_CHANNEL_MAX_PERSISTED', minimum: 2, maximum: 1_000_000 },
    ),
    dynamicAssetLookup: (id) => lobbyAssetStore.getStored(id),
    dynamicResourceLimits: {
      uniqueBytes: positiveIntegerSetting(
        options.lobbyDynamicResourceLimits?.uniqueBytes
          ?? process.env.WHITEROOM_LOBBY_CHANNEL_ASSET_MAX_BYTES,
        LOBBY_DYNAMIC_RESOURCE_LIMITS.uniqueBytes,
        { name: 'WHITEROOM_LOBBY_CHANNEL_ASSET_MAX_BYTES', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      ),
      uniqueTexturePixels: positiveIntegerSetting(
        options.lobbyDynamicResourceLimits?.uniqueTexturePixels
          ?? process.env.WHITEROOM_LOBBY_CHANNEL_ASSET_MAX_TEXTURE_PIXELS,
        LOBBY_DYNAMIC_RESOURCE_LIMITS.uniqueTexturePixels,
        { name: 'WHITEROOM_LOBBY_CHANNEL_ASSET_MAX_TEXTURE_PIXELS', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      ),
      renderedVertices: positiveIntegerSetting(
        options.lobbyDynamicResourceLimits?.renderedVertices
          ?? process.env.WHITEROOM_LOBBY_CHANNEL_ASSET_MAX_RENDERED_VERTICES,
        LOBBY_DYNAMIC_RESOURCE_LIMITS.renderedVertices,
        { name: 'WHITEROOM_LOBBY_CHANNEL_ASSET_MAX_RENDERED_VERTICES', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      ),
      renderedTriangles: positiveIntegerSetting(
        options.lobbyDynamicResourceLimits?.renderedTriangles
          ?? process.env.WHITEROOM_LOBBY_CHANNEL_ASSET_MAX_RENDERED_TRIANGLES,
        LOBBY_DYNAMIC_RESOURCE_LIMITS.renderedTriangles,
        { name: 'WHITEROOM_LOBBY_CHANNEL_ASSET_MAX_RENDERED_TRIANGLES', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      ),
    },
  });
  if (lobbyStore.catalogIds?.add) {
    for (const id of lobbyAssetStore.catalogIds) lobbyStore.catalogIds.add(id);
  }
  await lobbyStore.initialize();
  const lobbyRateLimiter = options.lobbyRateLimiter ?? new LobbyRateLimiter({
    clock,
    windowMs: positiveIntegerSetting(
      options.lobbyRateLimits?.windowMs ?? process.env.WHITEROOM_LOBBY_RATE_WINDOW_MS,
      60_000,
      { name: 'WHITEROOM_LOBBY_RATE_WINDOW_MS', minimum: 1_000, maximum: 3_600_000 },
    ),
    maxPerClient: positiveIntegerSetting(
      options.lobbyRateLimits?.maxPerClient ?? process.env.WHITEROOM_LOBBY_RATE_CLIENT,
      30,
      { name: 'WHITEROOM_LOBBY_RATE_CLIENT', minimum: 1, maximum: 10_000 },
    ),
    maxPerIp: positiveIntegerSetting(
      options.lobbyRateLimits?.maxPerIp ?? process.env.WHITEROOM_LOBBY_RATE_IP,
      120,
      { name: 'WHITEROOM_LOBBY_RATE_IP', minimum: 1, maximum: 100_000 },
    ),
  });
  const lobbyEvents = options.lobbyEvents ?? new LobbyEventHub({
    clock,
    heartbeatMs: positiveIntegerSetting(
      options.lobbyHeartbeatMs ?? process.env.WHITEROOM_LOBBY_HEARTBEAT_MS,
      15_000,
      { name: 'WHITEROOM_LOBBY_HEARTBEAT_MS', minimum: 100, maximum: 60_000 },
    ),
    maxTotal: positiveIntegerSetting(
      options.lobbySseLimits?.maxTotal ?? process.env.WHITEROOM_LOBBY_SSE_MAX_TOTAL,
      500,
      { name: 'WHITEROOM_LOBBY_SSE_MAX_TOTAL', minimum: 1, maximum: 100_000 },
    ),
    maxPerIp: positiveIntegerSetting(
      options.lobbySseLimits?.maxPerIp ?? process.env.WHITEROOM_LOBBY_SSE_MAX_PER_IP,
      8,
      { name: 'WHITEROOM_LOBBY_SSE_MAX_PER_IP', minimum: 1, maximum: 1_000 },
    ),
    backpressureTimeoutMs: positiveIntegerSetting(
      options.lobbySseLimits?.backpressureTimeoutMs,
      5_000,
      { name: 'lobbySseLimits.backpressureTimeoutMs', minimum: 100, maximum: 60_000 },
    ),
  });
  const avatarStore = options.avatarStore ?? new AvatarStore({
    dataDirectory: store.dataDirectory ?? dataDirectory,
    clock,
    maxAvatars: positiveIntegerSetting(
      options.avatarLimits?.maxAvatars ?? process.env.WHITEROOM_AVATAR_MAX_COUNT,
      1_000,
      { name: 'WHITEROOM_AVATAR_MAX_COUNT', minimum: 1, maximum: 100_000 },
    ),
    maxTotalBytes: positiveIntegerSetting(
      options.avatarLimits?.maxTotalBytes ?? process.env.WHITEROOM_AVATAR_MAX_TOTAL_BYTES,
      512 * 1024 * 1024,
      { name: 'WHITEROOM_AVATAR_MAX_TOTAL_BYTES', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    ),
    maxPerOwner: positiveIntegerSetting(
      options.avatarLimits?.maxPerOwner ?? process.env.WHITEROOM_AVATAR_MAX_PER_OWNER,
      10,
      { name: 'WHITEROOM_AVATAR_MAX_PER_OWNER', minimum: 1, maximum: 1_000 },
    ),
  });
  await avatarStore.initialize();
  const avatarUploadRateLimiter = options.avatarUploadRateLimiter ?? new AvatarUploadRateLimiter({
    clock,
    windowMs: positiveIntegerSetting(
      options.avatarUploadLimits?.windowMs ?? process.env.WHITEROOM_AVATAR_UPLOAD_RATE_WINDOW_MS,
      60_000,
      { name: 'WHITEROOM_AVATAR_UPLOAD_RATE_WINDOW_MS', minimum: 1_000, maximum: 3_600_000 },
    ),
    maximum: positiveIntegerSetting(
      options.avatarUploadLimits?.maximum ?? process.env.WHITEROOM_AVATAR_UPLOAD_RATE_MAX,
      10,
      { name: 'WHITEROOM_AVATAR_UPLOAD_RATE_MAX', minimum: 1, maximum: 10_000 },
    ),
  });
  const avatarUploadGate = options.avatarUploadGate ?? new AvatarUploadGate(
    positiveIntegerSetting(
      options.avatarUploadLimits?.maxConcurrent ?? process.env.WHITEROOM_AVATAR_UPLOAD_MAX_CONCURRENT,
      2,
      { name: 'WHITEROOM_AVATAR_UPLOAD_MAX_CONCURRENT', minimum: 1, maximum: 100 },
    ),
  );
  const lobbyAssetUploadRateLimiter = options.lobbyAssetUploadRateLimiter ?? new LobbyAssetUploadRateLimiter({
    clock,
    windowMs: positiveIntegerSetting(
      options.lobbyAssetUploadLimits?.windowMs ?? process.env.WHITEROOM_LOBBY_ASSET_UPLOAD_RATE_WINDOW_MS,
      3_600_000,
      { name: 'WHITEROOM_LOBBY_ASSET_UPLOAD_RATE_WINDOW_MS', minimum: 1_000, maximum: 3_600_000 },
    ),
    maximum: positiveIntegerSetting(
      options.lobbyAssetUploadLimits?.maximum ?? process.env.WHITEROOM_LOBBY_ASSET_UPLOAD_RATE_MAX,
      5,
      { name: 'WHITEROOM_LOBBY_ASSET_UPLOAD_RATE_MAX', minimum: 1, maximum: 10_000 },
    ),
    globalMaximum: positiveIntegerSetting(
      options.lobbyAssetUploadLimits?.globalMaximum ?? process.env.WHITEROOM_LOBBY_ASSET_UPLOAD_RATE_GLOBAL,
      20,
      { name: 'WHITEROOM_LOBBY_ASSET_UPLOAD_RATE_GLOBAL', minimum: 1, maximum: 100_000 },
    ),
  });
  const lobbyAssetUploadGate = options.lobbyAssetUploadGate ?? new LobbyAssetUploadGate(
    positiveIntegerSetting(
      options.lobbyAssetUploadLimits?.maxConcurrent ?? process.env.WHITEROOM_LOBBY_ASSET_UPLOAD_MAX_CONCURRENT,
      2,
      { name: 'WHITEROOM_LOBBY_ASSET_UPLOAD_MAX_CONCURRENT', minimum: 1, maximum: 100 },
    ),
  );
  const context = {
    store,
    dreamseaStore,
    logger,
    lobbyCatalog,
    lobbyStore,
    lobbyRateLimiter,
    lobbyEvents,
    lobbyAssetStore,
    lobbyAssetUploadRateLimiter,
    lobbyAssetUploadGate,
    avatarStore,
    avatarUploadRateLimiter,
    avatarUploadGate,
    multiplayerHub: null,
    propCreationStore,
    propWorkerToken,
    propAutoPublish,
    uploadToken,
    adminToken,
    lobbyOwnerSecret,
    accountSessionSecret,
    supabaseAuth,
    corsOrigin: options.corsOrigin ?? process.env.WHITEROOM_CORS_ORIGIN ?? '*',
    previewTtlSeconds: previewTtlSeconds(
      options.previewTtlSeconds ?? process.env.WHITEROOM_PREVIEW_TTL_SECONDS,
    ),
    clock,
  };
  const server = http.createServer((request, response) => {
    route(request, response, context).catch((error) => {
      if (!response.headersSent) sendError(response, error, logger);
      else response.destroy(error);
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  const multiplayerHub = options.multiplayerHub ?? new MultiplayerHub({
    avatarStore,
    lobbyStore,
    lobbyCatalog,
    clock,
    maxTotal: positiveIntegerSetting(
      options.multiplayerLimits?.maxTotal ?? process.env.WHITEROOM_MULTIPLAYER_MAX_TOTAL,
      200,
      { name: 'WHITEROOM_MULTIPLAYER_MAX_TOTAL', minimum: 1, maximum: 10_000 },
    ),
    maxPerIp: positiveIntegerSetting(
      options.multiplayerLimits?.maxPerIp ?? process.env.WHITEROOM_MULTIPLAYER_MAX_PER_IP,
      6,
      { name: 'WHITEROOM_MULTIPLAYER_MAX_PER_IP', minimum: 1, maximum: 1_000 },
    ),
    pingIntervalMs: positiveIntegerSetting(
      options.multiplayerPingIntervalMs ?? process.env.WHITEROOM_MULTIPLAYER_PING_INTERVAL_MS,
      20_000,
      { name: 'WHITEROOM_MULTIPLAYER_PING_INTERVAL_MS', minimum: 100, maximum: 60_000 },
    ),
    partyCountdownMs: positiveIntegerSetting(
      options.multiplayerParty?.countdownMs ?? process.env.WHITEROOM_MULTIPLAYER_PARTY_COUNTDOWN_MS,
      8_000,
      { name: 'WHITEROOM_MULTIPLAYER_PARTY_COUNTDOWN_MS', minimum: 250, maximum: 60_000 },
    ),
    partyLifetimeMs: positiveIntegerSetting(
      options.multiplayerParty?.lifetimeMs ?? process.env.WHITEROOM_MULTIPLAYER_PARTY_LIFETIME_MS,
      30 * 60_000,
      { name: 'WHITEROOM_MULTIPLAYER_PARTY_LIFETIME_MS', minimum: 10_000, maximum: 24 * 60 * 60_000 },
    ),
    vehicleLeaseMs: positiveIntegerSetting(
      options.multiplayerVehicle?.leaseMs ?? process.env.WHITEROOM_MULTIPLAYER_VEHICLE_LEASE_MS,
      4_000,
      { name: 'WHITEROOM_MULTIPLAYER_VEHICLE_LEASE_MS', minimum: 100, maximum: 60_000 },
    ),
    vehicleRecoveryTickMs: positiveIntegerSetting(
      options.multiplayerVehicle?.recoveryTickMs
        ?? process.env.WHITEROOM_MULTIPLAYER_VEHICLE_RECOVERY_TICK_MS,
      50,
      { name: 'WHITEROOM_MULTIPLAYER_VEHICLE_RECOVERY_TICK_MS', minimum: 10, maximum: 1_000 },
    ),
  });
  context.multiplayerHub = multiplayerHub;
  multiplayerHub.attach(server);
  // 沉没巡查：按浮力法则定期让久无人访的梦域没入迷失域
  const sinkPatrolMs = positiveIntegerSetting(
    options.dreamsea?.sinkPatrolMs ?? process.env.WHITEROOM_DREAMSEA_SINK_PATROL_MS,
    10 * 60_000,
    { name: 'WHITEROOM_DREAMSEA_SINK_PATROL_MS', minimum: 1_000, maximum: 24 * 60 * 60_000 },
  );
  const sinkPatrolTimer = setInterval(() => {
    runDreamseaSinkPatrol(context).catch((error) => {
      logger.error('dreamsea sink patrol failed', error);
    });
  }, sinkPatrolMs);
  sinkPatrolTimer.unref?.();
  const closeHttpServer = server.close.bind(server);
  server.close = (callback) => {
    clearInterval(sinkPatrolTimer);
    dreamseaStore.close();
    multiplayerHub.close();
    lobbyEvents.close();
    return closeHttpServer(callback);
  };
  server.once('close', () => {
    clearInterval(sinkPatrolTimer);
    dreamseaStore.close();
    lobbyEvents.close();
    multiplayerHub.close();
  });
  return {
    server,
    store,
    dreamseaStore,
    lobbyStore,
    lobbyEvents,
    lobbyAssetStore,
    avatarStore,
    propCreationStore,
    multiplayerHub,
  };
}

export async function startServer(options = {}) {
  const application = await createApplication(options);
  const host = options.host ?? process.env.HOST ?? '127.0.0.1';
  const port = Number(options.port ?? process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT is invalid');
  await new Promise((resolve, reject) => {
    application.server.once('error', reject);
    application.server.listen(port, host, resolve);
  });
  const address = application.server.address();
  console.log(`《眠海》(WhiteRoom) platform listening on http://${host}:${address.port}`);
  return application;
}

const isEntryPoint = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isEntryPoint) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
