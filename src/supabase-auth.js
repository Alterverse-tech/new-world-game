import {
  createRemoteJWKSet,
  customFetch,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
} from 'jose';
import { HttpError } from './errors.js';
import { SUPABASE_USER_ID_PATTERN } from './auth.js';

const ALLOWED_ASYMMETRIC_ALGORITHMS = new Set(['ES256', 'RS256', 'EdDSA']);
const MAX_ACCESS_TOKEN_BYTES = 16 * 1024;

function normalizeSupabaseUrl(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('WHITEROOM_SUPABASE_URL must be a valid HTTPS URL');
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('WHITEROOM_SUPABASE_URL must be an HTTPS origin without credentials, path, query, or hash');
  }
  return url.origin;
}

function normalizePublishableKey(value) {
  if (!value) return null;
  if (typeof value !== 'string' || value.length < 16 || value.length > 4096 || /\s/.test(value)) {
    throw new Error('WHITEROOM_SUPABASE_PUBLISHABLE_KEY is invalid');
  }
  return value;
}

function bearerToken(request) {
  const authorization = request.headers.authorization ?? '';
  const match = /^Bearer[ \t]+([^\s]+)$/i.exec(authorization);
  if (!match || Buffer.byteLength(match[1]) > MAX_ACCESS_TOKEN_BYTES) {
    throw new HttpError(401, 'account_token_required', 'A valid Supabase access token is required');
  }
  return match[1];
}

function safeText(value, maximum) {
  return typeof value === 'string' && value.length <= maximum ? value : null;
}

function claimsAllowEmailProvider(claims) {
  const appMetadata = claims.app_metadata;
  if (!appMetadata || typeof appMetadata !== 'object' || Array.isArray(appMetadata)) return true;
  const provider = safeText(appMetadata.provider, 64)?.toLowerCase();
  if (provider && provider !== 'email') return false;
  if (!Array.isArray(appMetadata.providers)) return true;
  const providers = appMetadata.providers
    .map((value) => safeText(value, 64)?.toLowerCase())
    .filter(Boolean);
  return !providers.length || providers.includes('email');
}

function identityFromClaims(claims, now, issuer) {
  const subject = safeText(claims.sub, 64);
  const expiresAt = Number(claims.exp) * 1000;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    !SUPABASE_USER_ID_PATTERN.test(subject ?? '')
    || claims.iss !== issuer
    || !audiences.includes('authenticated')
    || claims.role !== 'authenticated'
    || claims.is_anonymous === true
    || !claimsAllowEmailProvider(claims)
    || !Number.isSafeInteger(expiresAt)
    || expiresAt <= now
  ) {
    throw new HttpError(401, 'account_token_invalid', 'The Supabase access token is invalid or expired');
  }
  const metadata = claims.user_metadata && typeof claims.user_metadata === 'object'
    ? claims.user_metadata
    : {};
  return {
    subject: subject.toLowerCase(),
    expiresAt,
    email: safeText(claims.email, 320),
    displayName: safeText(metadata.full_name, 120) ?? safeText(metadata.name, 120),
    avatarUrl: safeText(metadata.avatar_url, 2048) ?? safeText(metadata.picture, 2048),
  };
}

export class SupabaseAuthVerifier {
  constructor({ url, publishableKey, fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
    this.url = normalizeSupabaseUrl(url);
    this.publishableKey = normalizePublishableKey(publishableKey);
    if (Boolean(this.url) !== Boolean(this.publishableKey)) {
      throw new Error('WHITEROOM_SUPABASE_URL and WHITEROOM_SUPABASE_PUBLISHABLE_KEY must be configured together');
    }
    this.enabled = Boolean(this.url);
    this.fetchImpl = fetchImpl;
    this.clock = clock;
    this.issuer = this.enabled ? `${this.url}/auth/v1` : null;
    this.jwks = this.enabled
      ? createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`), {
          [customFetch]: fetchImpl,
        })
      : null;
  }

  publicConfig() {
    return this.enabled
      ? { enabled: true, provider: 'email', supabaseUrl: this.url, publishableKey: this.publishableKey }
      : { enabled: false, provider: 'email' };
  }

  async verifyRequest(request) {
    if (!this.enabled) throw new HttpError(503, 'account_auth_unavailable', 'Account login is not configured');
    return this.verifyToken(bearerToken(request));
  }

  async verifyToken(token) {
    let header;
    try {
      header = decodeProtectedHeader(token);
    } catch {
      throw new HttpError(401, 'account_token_invalid', 'The Supabase access token is invalid or expired');
    }
    if (header.alg === 'HS256') return this.verifyLegacyToken(token);
    if (!ALLOWED_ASYMMETRIC_ALGORITHMS.has(header.alg)) {
      throw new HttpError(401, 'account_token_invalid', 'The Supabase access token uses an unsupported signing algorithm');
    }
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: 'authenticated',
        algorithms: [...ALLOWED_ASYMMETRIC_ALGORITHMS],
      });
      return identityFromClaims(payload, this.clock(), this.issuer);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(401, 'account_token_invalid', 'The Supabase access token is invalid or expired');
    }
  }

  async verifyLegacyToken(token) {
    let response;
    try {
      response = await this.fetchImpl(`${this.issuer}/user`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          apikey: this.publishableKey,
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new HttpError(503, 'account_auth_unavailable', 'Account verification is temporarily unavailable');
    }
    if (!response.ok) throw new HttpError(401, 'account_token_invalid', 'The Supabase access token is invalid or expired');
    let claims;
    let user;
    try {
      claims = decodeJwt(token);
      user = await response.json();
    } catch {
      throw new HttpError(401, 'account_token_invalid', 'The Supabase access token is invalid or expired');
    }
    return identityFromClaims({
      ...claims,
      sub: user.id,
      email: user.email,
      user_metadata: user.user_metadata,
      app_metadata: user.app_metadata ?? claims.app_metadata,
      is_anonymous: user.is_anonymous ?? claims.is_anonymous,
    }, this.clock(), this.issuer);
  }
}
