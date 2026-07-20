import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApplication } from '../src/server.js';

const UPLOAD_TOKEN = 'upload-token-for-coauthor-tests';
const ADMIN_TOKEN = 'admin-token-for-coauthor-tests';
const CHANNEL = '0000';

async function createHarness(options = {}) {
  const dataDirectory = options.dataDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'whiteroom-coauthor-test-'));
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

async function newIdentity(harness) {
  const response = await fetch(`${harness.baseUrl}/api/lobby/identity`);
  assert.equal(response.status, 200);
  const body = await response.json();
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return { ownerId: body.ownerId, cookie };
}

async function jsonRequest(harness, pathname, method, body, cookie) {
  return fetch(`${harness.baseUrl}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function plotObject(clientId, overrides = {}) {
  // plot-001 中心 (-24, -24)，边界 x/z ∈ [-30, -18]
  return {
    clientId,
    catalogId: 'code-glow-cube',
    position: { x: -24, y: 0, z: -24 },
    rotationY: 0,
    scale: 1,
    ...overrides,
  };
}

async function lobbyState(harness, channel = CHANNEL) {
  return (await fetch(`${harness.baseUrl}/api/lobby/state?channel=${channel}`)).json();
}

test('plot owners grant and revoke co-dreaming rights that gate object edits', async () => {
  const harness = await createHarness();
  try {
    const alice = await newIdentity(harness);
    const bob = await newIdentity(harness);
    const carol = await newIdentity(harness);

    const claimed = await jsonRequest(harness, `/api/lobby/plots/plot-001/claim?channel=${CHANNEL}`, 'POST', { nickname: 'Alice' }, alice.cookie);
    assert.equal(claimed.status, 201);
    const claimedPlot = (await claimed.json()).plot;
    assert.deepEqual(claimedPlot.coAuthors, []);
    const plotCenter = (await lobbyState(harness)).plots.find((plot) => plot.id === 'plot-001');
    assert.deepEqual(plotCenter.coAuthors, []);

    // 未受共笔，不动他物
    const blocked = await jsonRequest(harness, `/api/lobby/objects?channel=${CHANNEL}`, 'POST', plotObject('bob-client-0001'), bob.cookie);
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).error.code, 'lobby_plot_permission_denied');

    // 只有梦主能授共笔
    const bobGrant = await jsonRequest(harness, `/api/lobby/plots/plot-001/coauthors?channel=${CHANNEL}`, 'POST', { coAuthorId: carol.ownerId }, bob.cookie);
    assert.equal(bobGrant.status, 403);

    const granted = await jsonRequest(harness, `/api/lobby/plots/plot-001/coauthors?channel=${CHANNEL}`, 'POST', { coAuthorId: bob.ownerId }, alice.cookie);
    assert.equal(granted.status, 200);
    const grantedPlot = (await granted.json()).plot;
    assert.deepEqual(grantedPlot.coAuthors, [bob.ownerId.toLowerCase()]);

    // 重复授予 / 授予自己 / 无效 ID
    assert.equal((await jsonRequest(harness, `/api/lobby/plots/plot-001/coauthors?channel=${CHANNEL}`, 'POST', { coAuthorId: bob.ownerId }, alice.cookie)).status, 409);
    assert.equal((await jsonRequest(harness, `/api/lobby/plots/plot-001/coauthors?channel=${CHANNEL}`, 'POST', { coAuthorId: alice.ownerId }, alice.cookie)).status, 422);
    assert.equal((await jsonRequest(harness, `/api/lobby/plots/plot-001/coauthors?channel=${CHANNEL}`, 'POST', { coAuthorId: 'not-an-owner' }, alice.cookie)).status, 422);

    // 受共笔者可在域内凝结、调整、移除梦物
    const bobCreate = await jsonRequest(harness, `/api/lobby/objects?channel=${CHANNEL}`, 'POST', plotObject('bob-client-0001'), bob.cookie);
    assert.equal(bobCreate.status, 201);
    const bobObjectId = (await bobCreate.json()).object.id;

    const bobUpdate = await jsonRequest(harness, `/api/lobby/objects/${bobObjectId}?channel=${CHANNEL}`, 'PATCH', {
      clientId: 'bob-client-0001',
      position: { x: -23, y: 0, z: -23 },
    }, bob.cookie);
    assert.equal(bobUpdate.status, 200);

    // 共笔不等于主权：不可改名、不可释放、不可转授、不可赶人
    assert.equal((await jsonRequest(harness, `/api/lobby/plots/plot-001?channel=${CHANNEL}`, 'PATCH', { nickname: 'Bob 的家' }, bob.cookie)).status, 403);
    assert.equal((await jsonRequest(harness, `/api/lobby/plots/plot-001?channel=${CHANNEL}`, 'DELETE', {}, bob.cookie)).status, 403);
    assert.equal((await jsonRequest(harness, `/api/lobby/plots/plot-001/coauthors?channel=${CHANNEL}`, 'POST', { coAuthorId: carol.ownerId }, bob.cookie)).status, 403);

    // 未受共笔的 Carol 仍被排异
    assert.equal((await jsonRequest(harness, `/api/lobby/objects?channel=${CHANNEL}`, 'POST', plotObject('carol-client-001'), carol.cookie)).status, 403);

    // 梦主可动共笔者留下的梦物
    const aliceDelete = await jsonRequest(harness, `/api/lobby/objects/${bobObjectId}?channel=${CHANNEL}`, 'DELETE', { clientId: 'alice-client-001' }, alice.cookie);
    assert.equal(aliceDelete.status, 200);

    // 撤回共笔：非共笔者撤回报 404，撤回后排异恢复
    assert.equal((await jsonRequest(harness, `/api/lobby/plots/plot-001/coauthors/${carol.ownerId}?channel=${CHANNEL}`, 'DELETE', undefined, alice.cookie)).status, 404);
    const revoked = await jsonRequest(harness, `/api/lobby/plots/plot-001/coauthors/${bob.ownerId}?channel=${CHANNEL}`, 'DELETE', undefined, alice.cookie);
    assert.equal(revoked.status, 200);
    assert.deepEqual((await revoked.json()).plot.coAuthors, []);
    assert.equal((await jsonRequest(harness, `/api/lobby/objects?channel=${CHANNEL}`, 'POST', plotObject('bob-client-0001'), bob.cookie)).status, 403);

    // 受共笔者可自行退出
    assert.equal((await jsonRequest(harness, `/api/lobby/plots/plot-001/coauthors?channel=${CHANNEL}`, 'POST', { coAuthorId: bob.ownerId }, alice.cookie)).status, 200);
    const selfRevoke = await jsonRequest(harness, `/api/lobby/plots/plot-001/coauthors/${bob.ownerId}?channel=${CHANNEL}`, 'DELETE', undefined, bob.cookie);
    assert.equal(selfRevoke.status, 200);
    // 第三方不可撤回他人的共笔
    assert.equal((await jsonRequest(harness, `/api/lobby/plots/plot-001/coauthors?channel=${CHANNEL}`, 'POST', { coAuthorId: bob.ownerId }, alice.cookie)).status, 200);
    assert.equal((await jsonRequest(harness, `/api/lobby/plots/plot-001/coauthors/${bob.ownerId}?channel=${CHANNEL}`, 'DELETE', undefined, carol.cookie)).status, 403);
  } finally {
    await harness.close();
  }
});

test('co-dreaming rights cap at four dreamers and survive restarts', async () => {
  const harness = await createHarness();
  let reopened;
  try {
    const alice = await newIdentity(harness);
    const guests = await Promise.all(Array.from({ length: 5 }, () => newIdentity(harness)));

    assert.equal((await jsonRequest(harness, `/api/lobby/plots/plot-002/claim?channel=${CHANNEL}`, 'POST', { nickname: 'Alice' }, alice.cookie)).status, 201);
    for (const guest of guests.slice(0, 4)) {
      assert.equal((await jsonRequest(harness, `/api/lobby/plots/plot-002/coauthors?channel=${CHANNEL}`, 'POST', { coAuthorId: guest.ownerId }, alice.cookie)).status, 200);
    }
    const overflow = await jsonRequest(harness, `/api/lobby/plots/plot-002/coauthors?channel=${CHANNEL}`, 'POST', { coAuthorId: guests[4].ownerId }, alice.cookie);
    assert.equal(overflow.status, 409);
    assert.equal((await overflow.json()).error.code, 'lobby_plot_co_author_limit');

    const expected = guests.slice(0, 4).map(({ ownerId }) => ownerId.toLowerCase());
    assert.deepEqual((await lobbyState(harness)).plots.find((plot) => plot.id === 'plot-002').coAuthors, expected);

    await harness.close({ remove: false });
    reopened = await createHarness({ dataDirectory: harness.dataDirectory });
    const persisted = (await lobbyState(reopened)).plots.find((plot) => plot.id === 'plot-002');
    assert.deepEqual(persisted.coAuthors, expected);

    // 重启后共笔权依然有效（plot-002 中心 (-12, -24)）
    const stillGranted = await jsonRequest(reopened, `/api/lobby/objects?channel=${CHANNEL}`, 'POST', {
      clientId: 'guest-client-0001',
      catalogId: 'code-glow-cube',
      position: { x: -12, y: 0, z: -24 },
      rotationY: 0,
      scale: 1,
    }, guests[0].cookie);
    assert.equal(stillGranted.status, 201);
  } finally {
    await (reopened ?? harness).close();
    await rm(harness.dataDirectory, { recursive: true, force: true });
  }
});

test('persistent spaces reject co-dreaming grants like other plot operations', async () => {
  const harness = await createHarness();
  try {
    const alice = await newIdentity(harness);
    const bob = await newIdentity(harness);
    const denied = await jsonRequest(
      harness,
      '/api/lobby/plots/plot-001/coauthors?channel=space-0000-heaven',
      'POST',
      { coAuthorId: bob.ownerId },
      alice.cookie,
    );
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, 'persistent_space_plots_disabled');
  } finally {
    await harness.close();
  }
});
