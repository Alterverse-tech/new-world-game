import assert from 'node:assert/strict';
import test from 'node:test';
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
} from 'jose';
import { HttpError } from '../src/errors.js';
import { SupabaseAuthVerifier } from '../src/supabase-auth.js';

const SUPABASE_URL = 'https://project-ref.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const USER_URL = `${ISSUER}/user`;
const PUBLISHABLE_KEY = 'sb_publishable_supabase_auth_tests';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const NOW = Date.now();
const NOW_SECONDS = Math.floor(NOW / 1000);
const KEY_ID = 'local-test-key';

async function asymmetricFixture() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const key = await exportJWK(publicKey);
  return {
    privateKey,
    jwks: {
      keys: [{ ...key, alg: 'RS256', kid: KEY_ID, use: 'sig' }],
    },
  };
}

async function asymmetricToken(privateKey, overrides = {}) {
  const claims = {
    sub: USER_ID,
    iss: ISSUER,
    aud: 'authenticated',
    role: 'authenticated',
    iat: NOW_SECONDS - 10,
    exp: NOW_SECONDS + 10 * 60,
    email: 'alice@example.test',
    app_metadata: {
      provider: 'email',
      providers: ['email'],
    },
    user_metadata: {
      full_name: 'Alice Example',
      avatar_url: 'https://images.example.test/alice.png',
    },
    ...overrides,
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: KEY_ID, typ: 'JWT' })
    .sign(privateKey);
}

function jwksFetch(jwks, requests = []) {
  return async (input, options) => {
    const url = String(input);
    requests.push({ url, options });
    if (url !== JWKS_URL) throw new Error(`Unexpected local test request: ${url}`);
    return new Response(JSON.stringify(jwks), {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=300',
        'Content-Type': 'application/json',
      },
    });
  };
}

function verifier(fetchImpl) {
  return new SupabaseAuthVerifier({
    url: SUPABASE_URL,
    publishableKey: PUBLISHABLE_KEY,
    fetchImpl,
    clock: () => NOW,
  });
}

function tamperSignature(token) {
  const parts = token.split('.');
  parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
  return parts.join('.');
}

async function assertAuthError(operation, status, code) {
  await assert.rejects(operation, (error) => (
    error instanceof HttpError
    && error.status === status
    && error.code === code
  ));
}

async function legacyToken(overrides = {}) {
  const claims = {
    sub: 'legacy-subject-is-confirmed-by-user-endpoint',
    iss: ISSUER,
    aud: 'authenticated',
    role: 'authenticated',
    iat: NOW_SECONDS - 10,
    exp: NOW_SECONDS + 10 * 60,
    email: 'untrusted-token-email@example.test',
    app_metadata: {
      provider: 'email',
      providers: ['email'],
    },
    user_metadata: { name: 'Untrusted token name' },
    ...overrides,
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(new TextEncoder().encode('local-hs256-secret-used-only-to-build-test-tokens'));
}

test('asymmetric Supabase JWTs are verified against local JWKS with strict claims', async (t) => {
  const { privateKey, jwks } = await asymmetricFixture();
  const requests = [];
  const auth = verifier(jwksFetch(jwks, requests));

  await t.test('accepts a valid authenticated token', async () => {
    const token = await asymmetricToken(privateKey);
    const identity = await auth.verifyRequest({
      headers: { authorization: `Bearer ${token}` },
    });
    assert.deepEqual(identity, {
      subject: USER_ID,
      expiresAt: (NOW_SECONDS + 10 * 60) * 1000,
      email: 'alice@example.test',
      displayName: 'Alice Example',
      avatarUrl: 'https://images.example.test/alice.png',
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, JWKS_URL);
  });

  await t.test('rejects a tampered signature', async () => {
    const token = tamperSignature(await asymmetricToken(privateKey));
    await assertAuthError(auth.verifyToken(token), 401, 'account_token_invalid');
  });

  await t.test('rejects an expired token', async () => {
    const token = await asymmetricToken(privateKey, { exp: NOW_SECONDS - 60 });
    await assertAuthError(auth.verifyToken(token), 401, 'account_token_invalid');
  });

  await t.test('rejects an incorrect issuer', async () => {
    const token = await asymmetricToken(privateKey, { iss: 'https://other-project.supabase.co/auth/v1' });
    await assertAuthError(auth.verifyToken(token), 401, 'account_token_invalid');
  });

  await t.test('rejects an incorrect audience', async () => {
    const token = await asymmetricToken(privateKey, { aud: 'anon' });
    await assertAuthError(auth.verifyToken(token), 401, 'account_token_invalid');
  });

  await t.test('rejects a non-authenticated role', async () => {
    const token = await asymmetricToken(privateKey, { role: 'anon' });
    await assertAuthError(auth.verifyToken(token), 401, 'account_token_invalid');
  });

  await t.test('rejects an explicitly non-email provider', async () => {
    const token = await asymmetricToken(privateKey, {
      app_metadata: { provider: 'google', providers: ['google'] },
    });
    await assertAuthError(auth.verifyToken(token), 401, 'account_token_invalid');
  });

  await t.test('rejects an anonymous authenticated token', async () => {
    const token = await asymmetricToken(privateKey, { is_anonymous: true });
    await assertAuthError(auth.verifyToken(token), 401, 'account_token_invalid');
  });

  await t.test('accepts an authenticated token when Supabase omits provider metadata', async () => {
    const token = await asymmetricToken(privateKey, { app_metadata: undefined });
    const identity = await auth.verifyToken(token);
    assert.equal(identity.subject, USER_ID);
  });

  await t.test('rejects a subject that is not a Supabase UUID', async () => {
    const token = await asymmetricToken(privateKey, { sub: 'not-a-user-uuid' });
    await assertAuthError(auth.verifyToken(token), 401, 'account_token_invalid');
  });
});

test('legacy HS256 tokens use only the local Supabase user endpoint result', async (t) => {
  const token = await legacyToken();

  await t.test('accepts a token confirmed by the user endpoint', async () => {
    const requests = [];
    const auth = verifier(async (input, options) => {
      const url = String(input);
      requests.push({ url, options });
      if (url !== USER_URL) throw new Error(`Unexpected local test request: ${url}`);
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Accept, 'application/json');
      assert.equal(options.headers.apikey, PUBLISHABLE_KEY);
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      return new Response(JSON.stringify({
        id: USER_ID,
        email: 'verified-alice@example.test',
        app_metadata: {
          provider: 'email',
          providers: ['email'],
        },
        user_metadata: {
          name: 'Verified Alice',
          picture: 'https://images.example.test/verified-alice.png',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const identity = await auth.verifyToken(token);
    assert.deepEqual(identity, {
      subject: USER_ID,
      expiresAt: (NOW_SECONDS + 10 * 60) * 1000,
      email: 'verified-alice@example.test',
      displayName: 'Verified Alice',
      avatarUrl: 'https://images.example.test/verified-alice.png',
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, USER_URL);
  });

  await t.test('rejects a confirmed token with the wrong issuer', async () => {
    const wrongIssuer = await legacyToken({ iss: 'https://other-project.supabase.co/auth/v1' });
    const auth = verifier(async () => new Response(JSON.stringify({
      id: USER_ID,
      email: 'alice@example.test',
      user_metadata: {},
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await assertAuthError(auth.verifyToken(wrongIssuer), 401, 'account_token_invalid');
  });

  await t.test('rejects an explicitly non-email provider confirmed by the user endpoint', async () => {
    const googleToken = await legacyToken({
      app_metadata: { provider: 'google', providers: ['google'] },
    });
    const auth = verifier(async () => new Response(JSON.stringify({
      id: USER_ID,
      email: 'alice@example.test',
      app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: {},
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await assertAuthError(auth.verifyToken(googleToken), 401, 'account_token_invalid');
  });

  await t.test('rejects an anonymous token confirmed by the user endpoint', async () => {
    const anonymousToken = await legacyToken({ is_anonymous: false });
    const auth = verifier(async () => new Response(JSON.stringify({
      id: USER_ID,
      email: null,
      app_metadata: {},
      user_metadata: {},
      is_anonymous: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await assertAuthError(auth.verifyToken(anonymousToken), 401, 'account_token_invalid');
  });

  await t.test('rejects a confirmed token with the wrong audience', async () => {
    const wrongAudience = await legacyToken({ aud: 'anon' });
    const auth = verifier(async () => new Response(JSON.stringify({
      id: USER_ID,
      email: 'alice@example.test',
      user_metadata: {},
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await assertAuthError(auth.verifyToken(wrongAudience), 401, 'account_token_invalid');
  });

  await t.test('rejects a token refused by the user endpoint', async () => {
    const auth = verifier(async (input) => {
      assert.equal(String(input), USER_URL);
      return new Response(JSON.stringify({ message: 'invalid JWT' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await assertAuthError(auth.verifyToken(token), 401, 'account_token_invalid');
  });

  await t.test('reports a temporarily unavailable user endpoint without falling back', async () => {
    const auth = verifier(async (input) => {
      assert.equal(String(input), USER_URL);
      throw new Error('local simulated outage');
    });
    await assertAuthError(auth.verifyToken(token), 503, 'account_auth_unavailable');
  });
});
