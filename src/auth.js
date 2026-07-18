import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.js';

export const SUPABASE_USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const LOBBY_OWNER_ID_PATTERN = /^owner-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PREVIEW_TOKEN_VERSION = 1;
const PREVIEW_TOKEN_CONTEXT = 'whiteroom-preview-v1';
const LOBBY_OWNER_TOKEN_VERSION = 1;
const LOBBY_OWNER_TOKEN_CONTEXT = 'whiteroom-lobby-owner-v1';
const ACCOUNT_SESSION_TOKEN_VERSION = 1;
const ACCOUNT_SESSION_TOKEN_CONTEXT = 'whiteroom-account-session-v1';

function safeEqual(left, right) {
  const a = createHash('sha256').update(String(left)).digest();
  const b = createHash('sha256').update(String(right)).digest();
  return timingSafeEqual(a, b);
}

function safeEqualBuffer(left, right) {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right) || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function previewSignature(payload, secret) {
  return createHmac('sha256', secret)
    .update(`${PREVIEW_TOKEN_CONTEXT}.${payload}`)
    .digest();
}

function lobbyOwnerSignature(payload, secret) {
  return createHmac('sha256', secret)
    .update(`${LOBBY_OWNER_TOKEN_CONTEXT}.${payload}`)
    .digest();
}

function accountSessionSignature(payload, secret) {
  return createHmac('sha256', secret)
    .update(`${ACCOUNT_SESSION_TOKEN_CONTEXT}.${payload}`)
    .digest();
}

export function createLobbyOwnerToken({ ownerId, expiresAt, secret }) {
  if (!LOBBY_OWNER_ID_PATTERN.test(ownerId ?? '') || !Number.isSafeInteger(expiresAt) || !secret) {
    throw new Error('Lobby owner token inputs are invalid');
  }
  const payload = Buffer.from(JSON.stringify({
    v: LOBBY_OWNER_TOKEN_VERSION,
    ownerId,
    expiresAt,
  })).toString('base64url');
  return `${payload}.${lobbyOwnerSignature(payload, secret).toString('base64url')}`;
}

export function verifyLobbyOwnerToken(token, { secret, now = Date.now() }) {
  if (typeof token !== 'string' || token.length > 1024 || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  let suppliedSignature;
  try {
    suppliedSignature = Buffer.from(parts[1], 'base64url');
  } catch {
    return null;
  }
  if (!safeEqualBuffer(suppliedSignature, lobbyOwnerSignature(parts[0], secret))) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  return payload?.v === LOBBY_OWNER_TOKEN_VERSION
    && LOBBY_OWNER_ID_PATTERN.test(payload.ownerId ?? '')
    && Number.isSafeInteger(payload.expiresAt)
    && payload.expiresAt > now
    ? payload.ownerId
    : null;
}

export function createAccountSessionToken({ subject, ownerId, expiresAt, secret }) {
  if (
    !SUPABASE_USER_ID_PATTERN.test(subject ?? '')
    || !LOBBY_OWNER_ID_PATTERN.test(ownerId ?? '')
    || !Number.isSafeInteger(expiresAt)
    || !secret
  ) {
    throw new Error('Account session token inputs are invalid');
  }
  const payload = Buffer.from(JSON.stringify({
    v: ACCOUNT_SESSION_TOKEN_VERSION,
    subject: subject.toLowerCase(),
    ownerId: ownerId.toLowerCase(),
    expiresAt,
  })).toString('base64url');
  return `${payload}.${accountSessionSignature(payload, secret).toString('base64url')}`;
}

export function verifyAccountSessionToken(token, { secret, now = Date.now() }) {
  if (typeof token !== 'string' || token.length > 2048 || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  let suppliedSignature;
  try {
    suppliedSignature = Buffer.from(parts[1], 'base64url');
  } catch {
    return null;
  }
  if (!safeEqualBuffer(suppliedSignature, accountSessionSignature(parts[0], secret))) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  return payload?.v === ACCOUNT_SESSION_TOKEN_VERSION
    && SUPABASE_USER_ID_PATTERN.test(payload.subject ?? '')
    && LOBBY_OWNER_ID_PATTERN.test(payload.ownerId ?? '')
    && Number.isSafeInteger(payload.expiresAt)
    && payload.expiresAt > now
    ? {
        subject: payload.subject.toLowerCase(),
        ownerId: payload.ownerId.toLowerCase(),
        expiresAt: payload.expiresAt,
      }
    : null;
}

export function createPreviewToken({ levelId, hash, expiresAt, secret }) {
  if (!levelId || !hash || !secret || !Number.isSafeInteger(expiresAt)) {
    throw new Error('Preview token inputs are invalid');
  }
  const payload = Buffer.from(JSON.stringify({
    v: PREVIEW_TOKEN_VERSION,
    levelId,
    hash,
    expiresAt,
    nonce: randomBytes(18).toString('base64url'),
  })).toString('base64url');
  return `${payload}.${previewSignature(payload, secret).toString('base64url')}`;
}

export function verifyPreviewToken(token, { levelId, hash, secret, now = Date.now() }) {
  if (typeof token !== 'string' || token.length > 2048) return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;

  let suppliedSignature;
  try {
    suppliedSignature = Buffer.from(parts[1], 'base64url');
  } catch {
    return false;
  }
  if (!safeEqualBuffer(suppliedSignature, previewSignature(parts[0], secret))) return false;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return false;
  }
  return payload?.v === PREVIEW_TOKEN_VERSION
    && payload.levelId === levelId
    && payload.hash === hash
    && typeof payload.nonce === 'string'
    && payload.nonce.length >= 16
    && Number.isSafeInteger(payload.expiresAt)
    && payload.expiresAt > now;
}

export function requireBearer(request, expectedToken) {
  const authorization = request.headers.authorization ?? '';
  const match = /^Bearer[ \t]+(.+)$/i.exec(authorization);
  if (!match || !safeEqual(match[1], expectedToken)) {
    throw new HttpError(401, 'unauthorized', 'A valid Bearer token is required');
  }
}

export function validateTokens(uploadToken, adminToken) {
  if (!uploadToken || !adminToken) {
    throw new Error('WHITEROOM_PORTAL_TOKEN and WHITEROOM_ADMIN_TOKEN are required');
  }
  if (Buffer.byteLength(uploadToken) < 16 || Buffer.byteLength(adminToken) < 16) {
    throw new Error('Upload and admin tokens must each be at least 16 bytes');
  }
  if (safeEqual(uploadToken, adminToken)) {
    throw new Error('Upload and admin tokens must be different');
  }
}
