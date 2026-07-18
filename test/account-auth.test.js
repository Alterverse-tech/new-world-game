import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApplication } from '../src/server.js';
import { HttpError } from '../src/errors.js';

const UPLOAD_TOKEN = 'upload-token-for-account-tests';
const ADMIN_TOKEN = 'admin-token-for-account-tests';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const OWNER_A = `owner-${USER_A}`;
const OWNER_B = `owner-${USER_B}`;

function fakeSupabaseAuth(clock = Date.now) {
  const users = new Map([
    ['token-a', { subject: USER_A, email: 'alice@example.test', displayName: 'Alice' }],
    ['token-b', { subject: USER_B, email: 'bob@example.test', displayName: 'Bob' }],
  ]);
  return {
    enabled: true,
    publicConfig() {
      return {
        enabled: true,
        provider: 'email',
        supabaseUrl: 'https://project-ref.supabase.co',
        publishableKey: 'sb_publishable_account_tests',
      };
    },
    async verifyRequest(request) {
      const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? '');
      const user = users.get(match?.[1]);
      if (!user) throw new HttpError(401, 'account_token_invalid', 'Invalid test token');
      return { ...user, avatarUrl: null, expiresAt: clock() + 45 * 60 * 1000 };
    },
  };
}

async function createHarness(options = {}) {
  const dataDirectory = options.dataDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'whiteroom-account-test-'));
  const application = await createApplication({
    uploadToken: UPLOAD_TOKEN,
    adminToken: ADMIN_TOKEN,
    dataDirectory,
    logger: { error() {} },
    ...options,
  });
  await new Promise((resolve) => application.server.listen(0, '127.0.0.1', resolve));
  return {
    application,
    dataDirectory,
    baseUrl: `http://127.0.0.1:${application.server.address().port}`,
    async close({ remove = true } = {}) {
      if (application.server.listening) {
        await new Promise((resolve, reject) => application.server.close((error) => error ? reject(error) : resolve()));
      }
      if (remove) await rm(dataDirectory, { recursive: true, force: true });
    },
  };
}

function responseSetCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') return response.headers.getSetCookie();
  const combined = response.headers.get('set-cookie');
  return combined ? combined.split(/,(?=\s*[^;,=]+=[^;,]*)/) : [];
}

function applySetCookies(jar, response) {
  for (const header of responseSetCookies(response)) {
    const pair = header.split(';', 1)[0];
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (/Max-Age=0/i.test(header) || !value) jar.delete(name);
    else jar.set(name, value);
  }
  return jar;
}

function cookieHeader(jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function identity(harness, jar = new Map()) {
  const response = await fetch(`${harness.baseUrl}/api/lobby/identity`, {
    headers: jar.size ? { Cookie: cookieHeader(jar) } : {},
  });
  assert.equal(response.status, 200);
  applySetCookies(jar, response);
  return { body: await response.json(), jar };
}

async function accountSession(harness, token, jar = new Map(), headers = {}) {
  const response = await fetch(`${harness.baseUrl}/api/auth/session`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
      ...headers,
    },
  });
  applySetCookies(jar, response);
  return { response, body: await response.json(), jar };
}

async function logoutSession(harness, jar) {
  const response = await fetch(`${harness.baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: jar.size ? { Cookie: cookieHeader(jar) } : {},
  });
  applySetCookies(jar, response);
  return { response, body: await response.json(), jar };
}

async function plotRequest(harness, jar, pathname, method, body) {
  return fetch(`${harness.baseUrl}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('disabled account configuration keeps the complete guest identity flow available', async () => {
  const harness = await createHarness();
  try {
    const config = await (await fetch(`${harness.baseUrl}/api/auth/config`)).json();
    assert.deepEqual(config, { enabled: false, provider: 'email' });
    const login = await fetch(`${harness.baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { Authorization: 'Bearer unavailable' },
    });
    assert.equal(login.status, 503);
    const guest = await identity(harness);
    assert.match(guest.body.ownerId, /^owner-/);
    assert.equal(guest.body.account.signedIn, false);
  } finally {
    await harness.close();
  }
});

test('Supabase UUIDs map directly to owners while guest identities remain separate across login, devices, accounts, logout, and restart', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-account-integration-'));
  const first = await createHarness({ dataDirectory, supabaseAuth: fakeSupabaseAuth() });
  const firstDevice = new Map();
  const secondDevice = new Map();
  const otherAccountDevice = new Map();
  let firstGuestOwner;
  let secondGuestOwner;
  let firstGuestCookie;
  let secondGuestCookie;

  try {
    const firstGuest = await identity(first, firstDevice);
    firstGuestOwner = firstGuest.body.ownerId;
    firstGuestCookie = firstDevice.get('whiteroom_lobby_owner');

    const guestClaim = await plotRequest(
      first,
      firstDevice,
      '/api/lobby/plots/plot-001/claim?channel=9001',
      'POST',
      { nickname: 'Original Guest Home' },
    );
    assert.equal(guestClaim.status, 201);
    assert.equal((await guestClaim.json()).plot.ownerId, firstGuestOwner);

    const firstLogin = await accountSession(first, 'token-a', firstDevice);
    assert.equal(firstLogin.response.status, 200);
    assert.equal(firstLogin.body.ownerId, OWNER_A);
    assert.equal(firstLogin.body.identityStrategy, 'supabase_user_id');
    assert.equal(firstLogin.body.account.signedIn, true);
    assert.equal(firstLogin.body.account.provider, 'email');
    assert.equal(firstDevice.get('whiteroom_lobby_owner'), firstGuestCookie);
    assert.ok(firstDevice.has('whiteroom_account_session'));

    const signedInIdentity = await identity(first, firstDevice);
    assert.equal(signedInIdentity.body.ownerId, OWNER_A);
    assert.equal(signedInIdentity.body.account.signedIn, true);

    const cannotClaimGuestHome = await plotRequest(
      first,
      firstDevice,
      '/api/lobby/plots/plot-001?channel=9001',
      'PATCH',
      { nickname: 'Account Cannot Claim' },
    );
    assert.equal(cannotClaimGuestHome.status, 403);

    const accountClaim = await plotRequest(
      first,
      firstDevice,
      '/api/lobby/plots/plot-002/claim?channel=9001',
      'POST',
      { nickname: 'Alice Account Home' },
    );
    assert.equal(accountClaim.status, 201);
    assert.equal((await accountClaim.json()).plot.ownerId, OWNER_A);

    const secondGuest = await identity(first, secondDevice);
    secondGuestOwner = secondGuest.body.ownerId;
    secondGuestCookie = secondDevice.get('whiteroom_lobby_owner');
    assert.notEqual(secondGuestOwner, firstGuestOwner);

    const secondLogin = await accountSession(first, 'token-a', secondDevice);
    assert.equal(secondLogin.response.status, 200);
    assert.equal(secondLogin.body.ownerId, OWNER_A);
    assert.equal(secondDevice.get('whiteroom_lobby_owner'), secondGuestCookie);

    const crossDeviceRename = await plotRequest(
      first,
      secondDevice,
      '/api/lobby/plots/plot-002?channel=9001',
      'PATCH',
      { nickname: 'Alice Across Devices' },
    );
    assert.equal(crossDeviceRename.status, 200);

    const otherGuest = await identity(first, otherAccountDevice);
    const otherGuestCookie = otherAccountDevice.get('whiteroom_lobby_owner');
    const otherLogin = await accountSession(first, 'token-b', otherAccountDevice);
    assert.equal(otherLogin.response.status, 200);
    assert.equal(otherLogin.body.ownerId, OWNER_B);
    assert.notEqual(otherLogin.body.ownerId, OWNER_A);
    assert.equal(otherAccountDevice.get('whiteroom_lobby_owner'), otherGuestCookie);
    assert.notEqual(otherGuest.body.ownerId, OWNER_B);

    const isolatedAccount = await plotRequest(
      first,
      otherAccountDevice,
      '/api/lobby/plots/plot-002?channel=9001',
      'PATCH',
      { nickname: 'Bob Must Not Edit Alice' },
    );
    assert.equal(isolatedAccount.status, 403);

    const otherAccountClaim = await plotRequest(
      first,
      otherAccountDevice,
      '/api/lobby/plots/plot-003/claim?channel=9001',
      'POST',
      { nickname: 'Bob Account Home' },
    );
    assert.equal(otherAccountClaim.status, 201);
    assert.equal((await otherAccountClaim.json()).plot.ownerId, OWNER_B);

    const secondLogout = await logoutSession(first, secondDevice);
    assert.equal(secondLogout.response.status, 200);
    assert.equal(secondLogout.body.ownerId, secondGuestOwner);
    assert.equal(secondDevice.has('whiteroom_account_session'), false);
    assert.equal(secondDevice.get('whiteroom_lobby_owner'), secondGuestCookie);
    const secondGuestAgain = await identity(first, secondDevice);
    assert.equal(secondGuestAgain.body.ownerId, secondGuestOwner);
    assert.equal(secondGuestAgain.body.account.signedIn, false);

    const firstLogout = await logoutSession(first, firstDevice);
    assert.equal(firstLogout.response.status, 200);
    assert.equal(firstLogout.body.ownerId, firstGuestOwner);
    assert.equal(firstDevice.get('whiteroom_lobby_owner'), firstGuestCookie);
    const guestCanStillEditOwnHome = await plotRequest(
      first,
      firstDevice,
      '/api/lobby/plots/plot-001?channel=9001',
      'PATCH',
      { nickname: 'Original Guest Restored' },
    );
    assert.equal(guestCanStillEditOwnHome.status, 200);

    const persistentLogin = await accountSession(first, 'token-a', firstDevice);
    assert.equal(persistentLogin.body.ownerId, OWNER_A);
    assert.equal(firstDevice.get('whiteroom_lobby_owner'), firstGuestCookie);
  } finally {
    await first.close({ remove: false });
  }

  const restarted = await createHarness({ dataDirectory, supabaseAuth: fakeSupabaseAuth() });
  try {
    const restoredAccount = await identity(restarted, firstDevice);
    assert.equal(restoredAccount.body.ownerId, OWNER_A);
    assert.equal(restoredAccount.body.account.signedIn, true);
    assert.equal(firstDevice.get('whiteroom_lobby_owner'), firstGuestCookie);

    const state = await (await fetch(`${restarted.baseUrl}/api/lobby/state?channel=9001`)).json();
    assert.deepEqual(
      state.plots.map(({ id, ownerId, ownerNickname }) => ({ id, ownerId, ownerNickname })),
      [
        { id: 'plot-001', ownerId: firstGuestOwner, ownerNickname: 'Original Guest Restored' },
        { id: 'plot-002', ownerId: OWNER_A, ownerNickname: 'Alice Across Devices' },
        { id: 'plot-003', ownerId: OWNER_B, ownerNickname: 'Bob Account Home' },
      ],
    );

    const accountStillOwnsItsHome = await plotRequest(
      restarted,
      firstDevice,
      '/api/lobby/plots/plot-002?channel=9001',
      'PATCH',
      { nickname: 'Alice After Restart' },
    );
    assert.equal(accountStillOwnsItsHome.status, 200);

    const logoutAfterRestart = await logoutSession(restarted, firstDevice);
    assert.equal(logoutAfterRestart.response.status, 200);
    assert.equal(logoutAfterRestart.body.ownerId, firstGuestOwner);
    const restoredGuest = await identity(restarted, firstDevice);
    assert.equal(restoredGuest.body.ownerId, firstGuestOwner);
    assert.equal(restoredGuest.body.account.signedIn, false);

    await assert.rejects(stat(path.join(dataDirectory, 'accounts', 'links.json')), { code: 'ENOENT' });
  } finally {
    await restarted.close();
  }
});
