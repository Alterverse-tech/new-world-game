import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApplication } from '../src/server.js';
import {
  FixedWindowCounter,
  isPersistentSpaceChannel,
  LobbyEventHub,
  NUMERIC_LOBBY_CHANNEL_PATTERN,
  PERSISTENT_SPACE_CHANNEL_PATTERN,
  PERSISTENT_SPACE_IDS,
  validateLobbyPortalMetadata,
  validateLobbyVehicleMetadata,
} from '../src/lobby.js';

const UPLOAD_TOKEN = 'upload-token-for-lobby-tests';
const ADMIN_TOKEN = 'admin-token-for-lobby-tests';
const DEFAULT_CHANNEL = '0000';
const identitySessions = new Map();

async function createHarness(options = {}) {
  const dataDirectory = options.dataDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'whiteroom-lobby-test-'));
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

function validObject(clientId, catalogId = 'code-glow-cube', overrides = {}) {
  return {
    clientId,
    catalogId,
    position: { x: 1, y: 0, z: -1 },
    rotationY: 0,
    scale: 1,
    ...overrides,
  };
}

async function lobbyIdentity(baseUrl, sessionKey) {
  const key = `${baseUrl}\n${sessionKey}`;
  const existing = identitySessions.get(key);
  if (existing) return existing;
  const response = await fetch(`${baseUrl}/api/lobby/identity`);
  assert.equal(response.status, 200);
  const body = await response.json();
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.match(body.ownerId, /^owner-[0-9a-f-]{36}$/i);
  assert.ok(cookie);
  const identity = { ownerId: body.ownerId, cookie };
  identitySessions.set(key, identity);
  return identity;
}

async function jsonRequest(baseUrl, pathname, method, body, headers = {}, sessionKey = body?.clientId ?? 'anonymous-test') {
  const requestPath = pathname.startsWith('/api/lobby/objects') && !pathname.includes('channel=')
    ? `${pathname}${pathname.includes('?') ? '&' : '?'}channel=${DEFAULT_CHANNEL}`
    : pathname;
  const requestHeaders = { 'Content-Type': 'application/json', ...headers };
  if (!Object.keys(requestHeaders).some((key) => key.toLowerCase() === 'cookie')) {
    requestHeaders.Cookie = (await lobbyIdentity(baseUrl, sessionKey)).cookie;
  }
  return fetch(`${baseUrl}${requestPath}`, {
    method,
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
}

async function lobbyState(baseUrl, channel = DEFAULT_CHANNEL) {
  return (await fetch(`${baseUrl}/api/lobby/state?channel=${encodeURIComponent(channel)}`)).json();
}

function persistedState(value) {
  const { serverTime: _serverTime, ...state } = value;
  return state;
}

test('lobby identity is server-signed, HttpOnly, persistent, and rejects tampering', async () => {
  const harness = await createHarness();
  try {
    const first = await fetch(`${harness.baseUrl}/api/lobby/identity`);
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    const setCookie = first.headers.get('set-cookie');
    const cookie = setCookie.split(';')[0];
    assert.match(firstBody.ownerId, /^owner-[0-9a-f-]{36}$/i);
    assert.match(setCookie, /; Path=\//);
    assert.match(setCookie, /; HttpOnly/);
    assert.match(setCookie, /; SameSite=Strict/);
    assert.match(setCookie, /; Max-Age=31536000/);

    const repeated = await fetch(`${harness.baseUrl}/api/lobby/identity`, { headers: { Cookie: cookie } });
    assert.equal((await repeated.json()).ownerId, firstBody.ownerId);
    assert.equal(repeated.headers.get('set-cookie'), null);

    const signatureStart = cookie.indexOf('.') + 1;
    const tamperedCookie = `${cookie.slice(0, signatureStart)}${cookie[signatureStart] === 'A' ? 'B' : 'A'}${cookie.slice(signatureStart + 1)}`;
    const tampered = await fetch(`${harness.baseUrl}/api/lobby/identity`, { headers: { Cookie: tamperedCookie } });
    const tamperedBody = await tampered.json();
    assert.notEqual(tamperedBody.ownerId, firstBody.ownerId);
    assert.ok(tampered.headers.get('set-cookie'));
  } finally {
    await harness.close();
  }
});

async function readSseUntil(response, predicate, timeoutMs = 2_000) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  const timeout = setTimeout(() => reader.cancel(new Error('SSE test timed out')), timeoutMs);
  try {
    while (!predicate(events)) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event = 'message';
        let id;
        const data = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('id:')) id = line.slice(3).trim();
          if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (data.length) events.push({ event, id, data: JSON.parse(data.join('\n')) });
      }
    }
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => {});
  }
  return events;
}

test('public lobby catalog exposes the reviewed production core plus safe extensions and placement constraints', async () => {
  const harness = await createHarness();
  try {
    const response = await fetch(`${harness.baseUrl}/api/lobby/catalog`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    const catalog = await response.json();
    assert.equal(catalog.schemaVersion, 1);
    const itemIds = catalog.items.map((item) => item.id);
    assert.equal(new Set(itemIds).size, itemIds.length);
    for (const coreId of [
      'code-ember-shift-sentinel',
      'code-glow-cube',
      'code-heaven-hell-door',
      'code-howls-moving-castle',
      'code-light-arch',
      'code-precision-rescue-helicopter',
      'code-soft-bench',
      'code-spacex-starship',
      'glb-lounge-chair',
      'glb-luminous-plant',
      'glb-pedestal-lamp',
      'glb-yellow-sports-car',
    ]) assert.equal(itemIds.includes(coreId), true, `missing reviewed core item ${coreId}`);
    assert.equal(catalog.items.filter((item) => item.kind === 'code').length >= 8, true);
    const vehicles = new Map(catalog.items
      .filter((item) => item.vehicle)
      .map(({ id, vehicle }) => [id, vehicle]));
    assert.deepEqual(
      vehicles.get('code-howls-moving-castle'),
      { kind: 'car', enterRadius: 6, maxSpeed: 6, maxAcceleration: 18, maxAngularSpeed: 2.2 },
    );
    assert.deepEqual(
      vehicles.get('code-precision-rescue-helicopter'),
      { kind: 'aircraft', enterRadius: 4.2, maxSpeed: 9, maxAcceleration: 8, maxAngularSpeed: 1.8 },
    );
    const portals = new Map(catalog.items
      .filter((item) => item.portal)
      .map(({ id, portal }) => [id, portal]));
    assert.deepEqual(portals.get('code-heaven-hell-door'), {
      kind: 'space',
      destinations: [
        { id: 'heaven', label: '天堂', spaceId: 'heaven' },
        { id: 'hell', label: '地狱', spaceId: 'hell' },
      ],
    });
    const glbUrls = catalog.items.filter((item) => item.kind === 'glb').map((item) => item.assetUrl);
    for (const requiredAssetUrl of [
        '/generated-assets/glb-lounge-chair.glb',
        '/generated-assets/glb-luminous-plant.glb',
        '/generated-assets/glb-pedestal-lamp.glb',
        '/generated-assets/glb-yellow-sports-car.glb',
    ]) assert.equal(glbUrls.includes(requiredAssetUrl), true, `missing reviewed GLB ${requiredAssetUrl}`);
    assert.deepEqual(catalog.constraints.bounds.x, { min: -54, max: 54 });
    assert.deepEqual(catalog.constraints.publicArea, {
      x: { min: -15, max: 15 },
      z: { min: -15, max: 15 },
    });
    assert.equal(catalog.constraints.layoutEpsilon, 1e-6);
    assert.equal(catalog.constraints.plotLayout.size, 12);
    assert.equal(catalog.constraints.plotLayout.centerSpacing, 12);
    assert.deepEqual(catalog.constraints.plotLayout.rings, { min: 2, max: 4 });
    assert.equal(catalog.constraints.plotLayout.slots.length, 72);
    assert.deepEqual(
      catalog.constraints.plotLayout.slots.map(({ id }) => id),
      Array.from({ length: 72 }, (_, index) => `plot-${String(index + 1).padStart(3, '0')}`),
    );
    assert.deepEqual(
      Object.fromEntries([2, 3, 4].map((ring) => [
        ring,
        catalog.constraints.plotLayout.slots.filter((slot) => slot.ring === ring).length,
      ])),
      { 2: 16, 3: 24, 4: 32 },
    );
    assert.equal(new Set(
      catalog.constraints.plotLayout.slots.map(({ center }) => `${center.x},${center.z}`),
    ).size, 72);
    assert.deepEqual(catalog.constraints.plotLayout.slots[0].bounds, {
      x: { min: -30, max: -18 },
      z: { min: -30, max: -18 },
    });
    assert.deepEqual(catalog.constraints.plotLayout.slots[1].bounds, {
      x: { min: -18, max: -6 },
      z: { min: -30, max: -18 },
    });
    assert.deepEqual(
      catalog.constraints.plotLayout.slots
        .filter(({ id }) => ['plot-001', 'plot-005', 'plot-006', 'plot-009', 'plot-016', 'plot-017', 'plot-041', 'plot-072'].includes(id))
        .map(({ id, ring, gridX, gridZ, center }) => ({ id, ring, gridX, gridZ, center })),
      [
        { id: 'plot-001', ring: 2, gridX: -2, gridZ: -2, center: { x: -24, z: -24 } },
        { id: 'plot-005', ring: 2, gridX: 2, gridZ: -2, center: { x: 24, z: -24 } },
        { id: 'plot-006', ring: 2, gridX: 2, gridZ: -1, center: { x: 24, z: -12 } },
        { id: 'plot-009', ring: 2, gridX: 2, gridZ: 2, center: { x: 24, z: 24 } },
        { id: 'plot-016', ring: 2, gridX: -2, gridZ: -1, center: { x: -24, z: -12 } },
        { id: 'plot-017', ring: 3, gridX: -3, gridZ: -3, center: { x: -36, z: -36 } },
        { id: 'plot-041', ring: 4, gridX: -4, gridZ: -4, center: { x: -48, z: -48 } },
        { id: 'plot-072', ring: 4, gridX: -4, gridZ: -3, center: { x: -48, z: -36 } },
      ],
    );
    assert.deepEqual(catalog.constraints.protectedZones, [
      { id: 'terminal', center: { x: 0, z: -7.42 }, radius: 3.5 },
      { id: 'spawn', center: { x: 0, z: 4.2 }, radius: 2.25 },
    ]);
    assert.equal(catalog.constraints.maxObjects, 200);
    assert.equal(JSON.stringify(catalog.items).match(/terminal|computer|system/gi), null);
  } finally {
    await harness.close();
  }
});

test('vehicle catalog metadata uses an exact bounded car or aircraft schema', () => {
  assert.deepEqual(
    validateLobbyVehicleMetadata({
      kind: 'car', enterRadius: 3, maxSpeed: 20, maxAcceleration: 12, maxAngularSpeed: 2,
    }, 'valid-car'),
    { kind: 'car', enterRadius: 3, maxSpeed: 20, maxAcceleration: 12, maxAngularSpeed: 2 },
  );
  for (const value of [
    null,
    { kind: 'boat', enterRadius: 3, maxSpeed: 20, maxAcceleration: 12, maxAngularSpeed: 2 },
    { kind: 'car', enterRadius: 3, maxSpeed: 36, maxAcceleration: 12, maxAngularSpeed: 2 },
    { kind: 'aircraft', enterRadius: 3, maxSpeed: 20, maxAcceleration: 12, maxAngularSpeed: 2, script: 'unsafe' },
  ]) {
    assert.throws(() => validateLobbyVehicleMetadata(value, 'invalid'), /invalid vehicle metadata/);
  }
});

test('portal catalog metadata is exact, bounded, and data-only', () => {
  const valid = {
    kind: 'space',
    destinations: [
      { id: 'heaven', label: '天堂', spaceId: 'heaven' },
      { id: 'hell', label: '地狱', spaceId: 'hell' },
    ],
  };
  assert.deepEqual(validateLobbyPortalMetadata(valid, 'valid-portal'), valid);
  assert.deepEqual(PERSISTENT_SPACE_IDS, ['heaven', 'hell']);
  for (const value of [
    null,
    { ...valid, script: 'unsafe' },
    { kind: 'realm', destinations: valid.destinations },
    { kind: 'space', destinations: [valid.destinations[0]] },
    { kind: 'space', destinations: [...valid.destinations, valid.destinations[0]] },
    { kind: 'space', destinations: [{ ...valid.destinations[0], spaceId: 'purgatory' }, valid.destinations[1]] },
    { kind: 'space', destinations: [{ ...valid.destinations[0], id: 'sky' }, valid.destinations[1]] },
    { kind: 'space', destinations: [{ ...valid.destinations[0], levelId: 'celestial-sanctum-official' }, valid.destinations[1]] },
    { kind: 'space', destinations: [{ ...valid.destinations[0], stateChannel: 'space-0000-heaven' }, valid.destinations[1]] },
    { kind: 'space', destinations: [{ ...valid.destinations[0], onEnter: 'eval()' }, valid.destinations[1]] },
  ]) assert.throws(() => validateLobbyPortalMetadata(value, 'invalid'), /invalid portal metadata/);
});

test('create, update, and delete strictly validate transforms and preserve audit metadata', async () => {
  const harness = await createHarness();
  try {
    const invalidClient = await jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects',
      'POST',
      validObject('short'),
    );
    assert.equal(invalidClient.status, 422);
    assert.equal((await invalidClient.json()).error.code, 'invalid_client_id');

    const outside = await jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects',
      'POST',
      validObject('bounds-client-01', 'code-glow-cube', { position: { x: 54.001, y: 0, z: 0 } }),
    );
    assert.equal(outside.status, 422);
    assert.equal((await outside.json()).error.code, 'lobby_bounds_exceeded');

    const extraField = await jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects',
      'POST',
      { ...validObject('strict-client-01'), hidden: true },
    );
    assert.equal(extraField.status, 422);
    assert.deepEqual((await extraField.json()).error.details.unexpected, ['hidden']);

    const terminalZone = await jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects',
      'POST',
      validObject('zone-client-0001', 'code-glow-cube', { position: { x: 0, y: 8, z: -7.42 } }),
    );
    assert.equal(terminalZone.status, 422);
    const terminalZoneError = (await terminalZone.json()).error;
    assert.equal(terminalZoneError.code, 'lobby_protected_zone');
    assert.equal(terminalZoneError.details.zoneId, 'terminal');

    const createdResponse = await jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects',
      'POST',
      validObject('creator-client-01'),
    );
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    const creatorIdentity = await lobbyIdentity(harness.baseUrl, 'creator-client-01');
    assert.equal(created.revision, 1);
    assert.equal(created.object.createdBy, creatorIdentity.ownerId);
    assert.equal(created.object.updatedBy, creatorIdentity.ownerId);
    assert.equal(created.object.revision, 1);
    assert.match(created.object.createdAt, /^\d{4}-\d\d-/);

    const spawnZone = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}`,
      'PATCH',
      { clientId: 'editor-client-002', position: { x: 0, y: 0, z: 4.2 } },
    );
    assert.equal(spawnZone.status, 422);
    assert.equal((await spawnZone.json()).error.details.zoneId, 'spawn');

    const updatedResponse = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}`,
      'PATCH',
      { clientId: 'editor-client-002', position: { x: -15, y: 8, z: 15 }, rotationY: Math.PI, scale: 3 },
    );
    assert.equal(updatedResponse.status, 200);
    const updated = await updatedResponse.json();
    const editorIdentity = await lobbyIdentity(harness.baseUrl, 'editor-client-002');
    assert.equal(updated.revision, 2);
    assert.equal(updated.object.createdBy, creatorIdentity.ownerId);
    assert.equal(updated.object.updatedBy, editorIdentity.ownerId);
    assert.equal(updated.object.revision, 2);
    assert.deepEqual(updated.object.position, { x: -15, y: 8, z: 15 });

    const rejectedCrossOrigin = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}`,
      'DELETE',
      { clientId: creatorIdentity.ownerId },
      { Cookie: creatorIdentity.cookie, Origin: 'https://attacker.example' },
    );
    assert.equal(rejectedCrossOrigin.status, 403);
    assert.equal((await rejectedCrossOrigin.json()).error.code, 'cross_origin_lobby_write');

    const deletedResponse = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}`,
      'DELETE',
      { clientId: 'editor-client-002' },
      { Cookie: editorIdentity.cookie },
    );
    assert.equal(deletedResponse.status, 200);
    const deleted = await deletedResponse.json();
    assert.equal(deleted.objectId, created.object.id);
    assert.equal(deleted.channel, DEFAULT_CHANNEL);
    assert.equal(deleted.revision, 3);
    assert.match(deleted.updatedAt, /^\d{4}-\d\d-/);
    const state = await lobbyState(harness.baseUrl);
    assert.equal(state.revision, 3);
    assert.deepEqual(state.objects, []);
  } finally {
    await harness.close();
  }
});

test('channel numbers are canonical, lazily persisted, isolated, and grant members shared edit rights', async () => {
  const harness = await createHarness();
  try {
    const legacyCompatible = await fetch(`${harness.baseUrl}/api/lobby/state`);
    assert.equal(legacyCompatible.status, 200);
    assert.equal((await legacyCompatible.json()).channel, DEFAULT_CHANNEL);

    for (const invalidChannel of ['123', '1234567890123', '１２３４', '../0000', '12/34', ' 1234']) {
      const response = await fetch(
        `${harness.baseUrl}/api/lobby/state?channel=${encodeURIComponent(invalidChannel)}`,
      );
      assert.equal(response.status, 422);
      assert.equal((await response.json()).error.code, 'invalid_lobby_channel');
    }
    const duplicate = await fetch(`${harness.baseUrl}/api/lobby/state?channel=1111&channel=2222`);
    assert.equal(duplicate.status, 422);
    assert.equal((await duplicate.json()).error.code, 'invalid_lobby_query');

    const untouched = await lobbyState(harness.baseUrl, '001234');
    assert.equal(untouched.channel, '001234');
    assert.equal(untouched.revision, 0);
    assert.deepEqual(untouched.objects, []);
    await assert.rejects(
      stat(path.join(harness.dataDirectory, 'lobby', 'channels', '001234', 'state.json')),
      { code: 'ENOENT' },
    );
    assert.equal(harness.application.lobbyStore.channels.has('001234'), false);

    const creator = await lobbyIdentity(harness.baseUrl, 'channel-creator-01');
    const firstResponse = await jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects?channel=001234',
      'POST',
      validObject('channel-creator-01'),
      { Cookie: creator.cookie },
    );
    assert.equal(firstResponse.status, 201);
    const first = await firstResponse.json();
    assert.equal(first.channel, '001234');

    const secondResponse = await jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects?channel=9876',
      'POST',
      validObject('channel-other-0001', 'code-soft-bench', { position: { x: 5, y: 0, z: 0 } }),
    );
    assert.equal(secondResponse.status, 201);
    const second = await secondResponse.json();

    assert.deepEqual((await lobbyState(harness.baseUrl, '001234')).objects.map(({ id }) => id), [first.object.id]);
    assert.deepEqual((await lobbyState(harness.baseUrl, '9876')).objects.map(({ id }) => id), [second.object.id]);
    assert.deepEqual((await lobbyState(harness.baseUrl, DEFAULT_CHANNEL)).objects, []);

    const crossChannelUpdate = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${first.object.id}?channel=9876`,
      'PATCH',
      { clientId: 'channel-other-0001', scale: 2 },
    );
    assert.equal(crossChannelUpdate.status, 404);
    assert.equal((await crossChannelUpdate.json()).error.code, 'lobby_object_not_found');

    const crossChannelDelete = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${first.object.id}?channel=9876`,
      'DELETE',
      { clientId: 'channel-other-0001' },
    );
    assert.equal(crossChannelDelete.status, 404);
    assert.equal((await crossChannelDelete.json()).error.code, 'lobby_object_not_found');

    const crossChannelInteraction = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${first.object.id}/interactions?channel=9876`,
      'POST',
      { requestId: 'cross-channel-request-01', baseSequence: 0 },
    );
    assert.equal(crossChannelInteraction.status, 404);
    assert.equal((await crossChannelInteraction.json()).error.code, 'lobby_object_not_found');

    const member = await lobbyIdentity(harness.baseUrl, 'channel-member-0001');
    const sharedUpdate = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${first.object.id}?channel=001234`,
      'PATCH',
      { clientId: 'channel-member-0001', rotationY: 1, scale: 1.5 },
      { Cookie: member.cookie },
    );
    assert.equal(sharedUpdate.status, 200);
    assert.equal((await sharedUpdate.json()).object.updatedBy, member.ownerId);

    const sharedDelete = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${first.object.id}?channel=001234`,
      'DELETE',
      { clientId: 'channel-member-0001' },
      { Cookie: member.cookie },
    );
    assert.equal(sharedDelete.status, 200);
    assert.deepEqual((await lobbyState(harness.baseUrl, '001234')).objects, []);
    assert.equal((await stat(path.join(
      harness.dataDirectory,
      'lobby',
      'channels',
      '001234',
      'state.json',
    ))).isFile(), true);
  } finally {
    await harness.close();
  }
});

test('derived persistent-space channels are canonical, fully shared, isolated, and restart-persistent', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-space-persistence-test-'));
  let harness;
  try {
    harness = await createHarness({ dataDirectory });
    const origin = '001234';
    const heaven = `space-${origin}-heaven`;
    const hell = `space-${origin}-hell`;
    const otherOriginHeaven = 'space-9876-heaven';

    assert.equal(NUMERIC_LOBBY_CHANNEL_PATTERN.test(origin), true);
    assert.equal(PERSISTENT_SPACE_CHANNEL_PATTERN.test(heaven), true);
    assert.equal(PERSISTENT_SPACE_CHANNEL_PATTERN.test(hell), true);
    assert.equal(isPersistentSpaceChannel(heaven), true);
    assert.equal(isPersistentSpaceChannel(origin), false);

    for (const invalidChannel of [
      'space-123-heaven',
      'space-1234567890123-heaven',
      'space-001234-Heaven',
      'space-001234-purgatory',
      'space-001234-heaven-extra',
      'space-../0000-heaven',
      'realm-001234-heaven',
    ]) {
      const response = await fetch(
        `${harness.baseUrl}/api/lobby/state?channel=${encodeURIComponent(invalidChannel)}`,
      );
      assert.equal(response.status, 422);
      assert.equal((await response.json()).error.code, 'invalid_lobby_channel');
    }

    const defaultBefore = await lobbyState(harness.baseUrl, DEFAULT_CHANNEL);
    const heavenBefore = await lobbyState(harness.baseUrl, heaven);
    assert.equal(heavenBefore.channel, heaven);
    assert.equal(heavenBefore.revision, 1);
    assert.deepEqual(heavenBefore.objects.map(({ id, catalogId }) => ({ id, catalogId })), [{
      id: 'realm-celestial-dragon-0001',
      catalogId: 'code-celestial-riding-dragon',
    }]);
    assert.deepEqual(heavenBefore.plots, []);

    const creator = await lobbyIdentity(harness.baseUrl, 'persistent-space-owner');
    const createdHeavenResponse = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects?channel=${heaven}`,
      'POST',
      validObject('space-heaven-client', 'code-glow-cube', {
        position: { x: 1, y: 0, z: -26 },
      }),
      { Cookie: creator.cookie },
    );
    assert.equal(createdHeavenResponse.status, 201);
    const createdHeaven = await createdHeavenResponse.json();
    assert.equal(createdHeaven.channel, heaven);
    assert.equal(createdHeaven.revision, 2);

    const updatedHeavenResponse = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${createdHeaven.object.id}?channel=${heaven}`,
      'PATCH',
      {
        clientId: 'space-heaven-client',
        position: { x: 24, y: 3, z: -31 },
        rotationY: 0.75,
        scale: 1.5,
      },
      { Cookie: creator.cookie },
    );
    assert.equal(updatedHeavenResponse.status, 200);
    const updatedHeaven = await updatedHeavenResponse.json();
    assert.equal(updatedHeaven.revision, 3);
    assert.equal(updatedHeaven.object.plotId, null);
    assert.deepEqual(updatedHeaven.object.position, { x: 24, y: 3, z: -31 });

    const formerTerminalZoneResponse = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects?channel=${heaven}`,
      'POST',
      validObject('space-terminal-client', 'code-soft-bench', {
        position: { x: 0, y: 0, z: -7.42 },
      }),
      { Cookie: creator.cookie },
    );
    assert.equal(formerTerminalZoneResponse.status, 201);
    const formerTerminalZone = await formerTerminalZoneResponse.json();
    assert.equal(formerTerminalZone.revision, 4);
    assert.equal(formerTerminalZone.object.plotId, null);

    const createdHellResponse = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects?channel=${hell}`,
      'POST',
      validObject('space-hell-client-01', 'code-soft-bench', {
        position: { x: 5, y: 0, z: 0 },
      }),
      { Cookie: creator.cookie },
    );
    assert.equal(createdHellResponse.status, 201);
    const createdHell = await createdHellResponse.json();
    assert.equal(createdHell.revision, 2);

    const plotClaim = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-001/claim?channel=${heaven}`,
      'POST',
      { nickname: 'No private realm' },
      { Cookie: creator.cookie },
    );
    assert.equal(plotClaim.status, 403);
    assert.equal((await plotClaim.json()).error.code, 'persistent_space_plots_disabled');
    const plotUpdate = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-001?channel=${heaven}`,
      'PATCH',
      { nickname: 'Still no private realm' },
      { Cookie: creator.cookie },
    );
    assert.equal(plotUpdate.status, 403);
    assert.equal((await plotUpdate.json()).error.code, 'persistent_space_plots_disabled');
    const plotRelease = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-001?channel=${heaven}`,
      'DELETE',
      {},
      { Cookie: creator.cookie },
    );
    assert.equal(plotRelease.status, 403);
    assert.equal((await plotRelease.json()).error.code, 'persistent_space_plots_disabled');

    const protectedReturnSpawn = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects?channel=${heaven}`,
      'POST',
      validObject('space-spawn-client-01', 'code-glow-cube', {
        position: { x: 0, y: 0, z: 4.2 },
      }),
      { Cookie: creator.cookie },
    );
    assert.equal(protectedReturnSpawn.status, 422);
    const protectedReturnSpawnError = (await protectedReturnSpawn.json()).error;
    assert.equal(protectedReturnSpawnError.code, 'lobby_protected_zone');
    assert.equal(protectedReturnSpawnError.details.zoneId, 'spawn');

    const heavenState = await lobbyState(harness.baseUrl, heaven);
    const hellState = await lobbyState(harness.baseUrl, hell);
    assert.equal(heavenState.revision, 4);
    assert.deepEqual(heavenState.objects.map(({ id }) => id), [
      'realm-celestial-dragon-0001',
      createdHeaven.object.id,
      formerTerminalZone.object.id,
    ]);
    assert.deepEqual(heavenState.objects.map(({ plotId }) => plotId), [null, null, null]);
    assert.deepEqual(heavenState.plots, []);
    assert.equal(hellState.revision, 2);
    assert.deepEqual(hellState.objects.map(({ id }) => id), [
      'realm-infernal-piano-0001',
      createdHell.object.id,
    ]);
    assert.deepEqual(hellState.plots, []);
    assert.deepEqual(
      (await lobbyState(harness.baseUrl, otherOriginHeaven)).objects.map(({ id }) => id),
      ['realm-celestial-dragon-0001'],
    );

    const heavenPath = path.join(dataDirectory, 'lobby', 'channels', heaven, 'state.json');
    const hellPath = path.join(dataDirectory, 'lobby', 'channels', hell, 'state.json');
    const heavenDisk = JSON.parse(await readFile(heavenPath, 'utf8'));
    const hellDisk = JSON.parse(await readFile(hellPath, 'utf8'));
    assert.equal((await stat(heavenPath)).isFile(), true);
    assert.equal((await stat(hellPath)).isFile(), true);
    assert.equal(heavenDisk.revision, heavenState.revision);
    assert.deepEqual(heavenDisk.objects, heavenState.objects);
    assert.deepEqual(heavenDisk.plots, []);
    assert.equal(hellDisk.revision, hellState.revision);
    assert.deepEqual(hellDisk.objects, hellState.objects);

    await harness.close({ remove: false });
    harness = await createHarness({ dataDirectory });

    const restartedHeaven = await lobbyState(harness.baseUrl, heaven);
    const restartedHell = await lobbyState(harness.baseUrl, hell);
    assert.deepEqual(persistedState(restartedHeaven), persistedState(heavenState));
    assert.deepEqual(persistedState(restartedHell), persistedState(hellState));
    assert.deepEqual(
      persistedState(await lobbyState(harness.baseUrl, DEFAULT_CHANNEL)),
      persistedState(defaultBefore),
    );
    assert.equal(harness.application.lobbyStore.knownChannels.has(heaven), true);
    assert.equal(harness.application.lobbyStore.knownChannels.has(hell), true);
  } finally {
    if (harness) await harness.close({ remove: false });
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('persistent-space recovery removes private plots and non-null plot assignments from disk', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-space-recovery-test-'));
  const channel = 'space-1111-heaven';
  const statePath = path.join(dataDirectory, 'lobby', 'channels', channel, 'state.json');
  const timestamp = '2026-07-16T00:00:00.000Z';
  const ownerId = 'owner-11111111-1111-4111-8111-111111111111';
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify({
    schemaVersion: 1,
    revision: 7,
    updatedAt: timestamp,
    objects: [
      {
        id: 'space-public-object-01',
        catalogId: 'code-glow-cube',
        position: { x: 20, y: 2, z: -30 },
        rotationY: 0,
        scale: 1,
        createdBy: ownerId,
        updatedBy: ownerId,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 6,
        plotId: null,
      },
      {
        id: 'space-private-object-01',
        catalogId: 'code-soft-bench',
        position: { x: -24, y: 0, z: -24 },
        rotationY: 0,
        scale: 1,
        createdBy: ownerId,
        updatedBy: ownerId,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 7,
        plotId: 'plot-001',
      },
    ],
    plots: [{
      id: 'plot-001',
      ownerId,
      ownerNickname: 'Space Owner',
      claimedAt: timestamp,
      updatedAt: timestamp,
    }],
  })}\n`, 'utf8');

  let harness;
  try {
    harness = await createHarness({ dataDirectory });
    const recovered = await lobbyState(harness.baseUrl, channel);
    assert.equal(recovered.revision, 8);
    assert.deepEqual(recovered.objects.map(({ id }) => id), [
      'realm-celestial-dragon-0001',
      'space-public-object-01',
    ]);
    assert.deepEqual(recovered.objects.map(({ plotId }) => plotId), [null, null]);
    assert.deepEqual(recovered.plots, []);

    const disk = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(disk.revision, 8);
    assert.deepEqual(disk.objects.map(({ id }) => id), [
      'realm-celestial-dragon-0001',
      'space-public-object-01',
    ]);
    assert.deepEqual(disk.plots, []);
  } finally {
    if (harness) await harness.close({ remove: false });
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('realm landmarks are seeded, protected, interactive, and persist the dragon parked pose across restart', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-realm-landmark-test-'));
  const heaven = 'space-2222-heaven';
  const hell = 'space-2222-hell';
  let harness;
  try {
    harness = await createHarness({ dataDirectory });
    const identity = await lobbyIdentity(harness.baseUrl, 'realm-landmark-owner');
    const heavenState = await lobbyState(harness.baseUrl, heaven);
    const hellState = await lobbyState(harness.baseUrl, hell);
    assert.deepEqual(heavenState.objects.map(({ id }) => id), ['realm-celestial-dragon-0001']);
    assert.deepEqual(hellState.objects.map(({ id }) => id), ['realm-infernal-piano-0001']);

    const duplicate = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects?channel=${heaven}`,
      'POST',
      validObject('realm-create-client-01', 'code-celestial-riding-dragon', {
        position: { x: 6, y: 0, z: -6 },
      }),
      { Cookie: identity.cookie },
    );
    assert.equal(duplicate.status, 403);
    assert.equal((await duplicate.json()).error.code, 'protected_realm_item');

    const moved = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/realm-celestial-dragon-0001?channel=${heaven}`,
      'PATCH',
      { clientId: 'realm-edit-client-001', rotationY: 0.5 },
      { Cookie: identity.cookie },
    );
    assert.equal(moved.status, 403);
    assert.equal((await moved.json()).error.code, 'protected_realm_item');

    const deleted = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/realm-celestial-dragon-0001?channel=${heaven}`,
      'DELETE',
      { clientId: 'realm-edit-client-001' },
      { Cookie: identity.cookie },
    );
    assert.equal(deleted.status, 403);
    assert.equal((await deleted.json()).error.code, 'protected_realm_item');

    const performance = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/realm-infernal-piano-0001/interactions?channel=${hell}`,
      'POST',
      { requestId: 'realm-piano-request-0001', baseSequence: 0 },
      { Cookie: identity.cookie },
    );
    assert.equal(performance.status, 200);
    assert.equal((await performance.json()).object.interaction.sequence, 1);

    await harness.application.lobbyStore.persistRealmVehiclePose(
      heaven,
      'realm-celestial-dragon-0001',
      { x: 4.25, y: 0, z: -3.5, yaw: 0.65 },
    );
    const parked = await lobbyState(harness.baseUrl, heaven);
    assert.deepEqual(parked.objects[0].position, { x: 4.25, y: 0, z: -3.5 });
    assert.equal(parked.objects[0].rotationY, 0.65);

    await harness.close({ remove: false });
    harness = await createHarness({ dataDirectory });
    const restartedHeaven = await lobbyState(harness.baseUrl, heaven);
    const restartedHell = await lobbyState(harness.baseUrl, hell);
    assert.deepEqual(restartedHeaven.objects[0].position, { x: 4.25, y: 0, z: -3.5 });
    assert.equal(restartedHeaven.objects[0].rotationY, 0.65);
    assert.equal(restartedHell.objects[0].interaction.sequence, 1);
  } finally {
    if (harness) await harness.close({ remove: false });
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('home plot claims support multiple plots per owner while staying channel-isolated, unique, nickname-safe, and owner-releasable', async () => {
  const harness = await createHarness();
  try {
    const alice = await lobbyIdentity(harness.baseUrl, 'plot-alice-session');
    const bob = await lobbyIdentity(harness.baseUrl, 'plot-bob-session');
    const carol = await lobbyIdentity(harness.baseUrl, 'plot-carol-session');
    const channel = '001234';

    const initial = await lobbyState(harness.baseUrl, channel);
    assert.deepEqual(initial.plots, []);
    await assert.rejects(
      stat(path.join(harness.dataDirectory, 'lobby', 'channels', channel, 'state.json')),
      { code: 'ENOENT' },
    );

    const claimedResponse = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-001/claim?channel=${channel}`,
      'POST',
      { nickname: '  Alice   房主  ' },
      { Cookie: alice.cookie },
    );
    assert.equal(claimedResponse.status, 201);
    const claimed = await claimedResponse.json();
    assert.equal(claimed.channel, channel);
    assert.equal(claimed.revision, 1);
    assert.deepEqual(claimed.plot, {
      id: 'plot-001',
      ownerId: alice.ownerId,
      ownerNickname: 'Alice 房主',
      claimedAt: claimed.updatedAt,
      updatedAt: claimed.updatedAt,
      coAuthors: [],
    });
    assert.equal(claimed.serverTime, claimed.updatedAt);

    const secondPlot = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-002/claim?channel=${channel}`,
      'POST',
      { nickname: 'Alice' },
      { Cookie: alice.cookie },
    );
    assert.equal(secondPlot.status, 201);
    const secondClaimed = await secondPlot.json();
    assert.equal(secondClaimed.revision, 2);
    assert.equal(secondClaimed.plot.id, 'plot-002');
    assert.equal(secondClaimed.plot.ownerId, alice.ownerId);

    const occupied = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-001/claim?channel=${channel}`,
      'POST',
      { nickname: 'Bob' },
      { Cookie: bob.cookie },
    );
    assert.equal(occupied.status, 409);
    assert.equal((await occupied.json()).error.code, 'lobby_plot_already_claimed');

    const invalidNickname = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-001?channel=${channel}`,
      'PATCH',
      { nickname: '<script>' },
      { Cookie: alice.cookie },
    );
    assert.equal(invalidNickname.status, 422);
    assert.equal((await invalidNickname.json()).error.code, 'invalid_owner_nickname');

    const forbiddenUpdate = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-001?channel=${channel}`,
      'PATCH',
      { nickname: 'Bob' },
      { Cookie: bob.cookie },
    );
    assert.equal(forbiddenUpdate.status, 403);
    assert.equal((await forbiddenUpdate.json()).error.code, 'lobby_plot_permission_denied');
    assert.equal((await lobbyState(harness.baseUrl, channel)).revision, 2);

    const renamedResponse = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-001?channel=${channel}`,
      'PATCH',
      { nickname: '  Ａｌｉｃｅ　之家  ' },
      { Cookie: alice.cookie },
    );
    assert.equal(renamedResponse.status, 200);
    const renamed = await renamedResponse.json();
    assert.equal(renamed.revision, 3);
    assert.equal(renamed.plot.ownerNickname, 'Alice 之家');
    assert.equal(renamed.plot.claimedAt, claimed.plot.claimedAt);

    const crossChannel = await jsonRequest(
      harness.baseUrl,
      '/api/lobby/plots/plot-001?channel=9876',
      'PATCH',
      { nickname: 'Elsewhere' },
      { Cookie: alice.cookie },
    );
    assert.equal(crossChannel.status, 404);
    assert.equal((await crossChannel.json()).error.code, 'lobby_plot_claim_not_found');

    const forbiddenRelease = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-001?channel=${channel}`,
      'DELETE',
      {},
      { Cookie: bob.cookie },
    );
    assert.equal(forbiddenRelease.status, 403);
    assert.equal((await lobbyState(harness.baseUrl, channel)).revision, 3);

    const releasedResponse = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-001?channel=${channel}`,
      'DELETE',
      {},
      { Cookie: alice.cookie },
    );
    assert.equal(releasedResponse.status, 200);
    const released = await releasedResponse.json();
    assert.equal(released.plotId, 'plot-001');
    assert.equal(released.revision, 4);
    assert.equal(released.serverTime, released.updatedAt);
    assert.deepEqual((await lobbyState(harness.baseUrl, channel)).plots.map(({ id }) => id), ['plot-002']);

    const releasedSecondResponse = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-002?channel=${channel}`,
      'DELETE',
      {},
      { Cookie: alice.cookie },
    );
    assert.equal(releasedSecondResponse.status, 200);
    assert.equal((await releasedSecondResponse.json()).revision, 5);
    assert.deepEqual((await lobbyState(harness.baseUrl, channel)).plots, []);

    const samePlotRace = await Promise.all([
      jsonRequest(
        harness.baseUrl,
        '/api/lobby/plots/plot-009/claim?channel=3333',
        'POST',
        { nickname: 'Alice' },
        { Cookie: alice.cookie },
      ),
      jsonRequest(
        harness.baseUrl,
        '/api/lobby/plots/plot-009/claim?channel=3333',
        'POST',
        { nickname: 'Bob' },
        { Cookie: bob.cookie },
      ),
    ]);
    assert.deepEqual(samePlotRace.map(({ status }) => status).sort(), [201, 409]);
    assert.equal((await lobbyState(harness.baseUrl, '3333')).plots.length, 1);

    const multiPlotRace = await Promise.all([
      jsonRequest(
        harness.baseUrl,
        '/api/lobby/plots/plot-017/claim?channel=2222',
        'POST',
        { nickname: 'Carol A' },
        { Cookie: carol.cookie },
      ),
      jsonRequest(
        harness.baseUrl,
        '/api/lobby/plots/plot-041/claim?channel=2222',
        'POST',
        { nickname: 'Carol B' },
        { Cookie: carol.cookie },
      ),
    ]);
    assert.deepEqual(multiPlotRace.map(({ status }) => status).sort(), [201, 201]);
    const multiPlotState = await lobbyState(harness.baseUrl, '2222');
    assert.deepEqual(multiPlotState.plots.map(({ id }) => id).sort(), ['plot-017', 'plot-041']);
    assert.equal(multiPlotState.plots.every(({ ownerId }) => ownerId === carol.ownerId), true);
  } finally {
    await harness.close();
  }
});

test('adjacent plots form a continuous owner-authorized building area with deterministic shared edges', async () => {
  const harness = await createHarness();
  try {
    const owner = await lobbyIdentity(harness.baseUrl, 'continuous-owner-session');
    const guest = await lobbyIdentity(harness.baseUrl, 'continuous-guest-session');
    const channel = '2468';

    for (const plotId of ['plot-001', 'plot-002']) {
      const claim = await jsonRequest(
        harness.baseUrl,
        `/api/lobby/plots/${plotId}/claim?channel=${channel}`,
        'POST',
        { nickname: 'Continuous Owner' },
        { Cookie: owner.cookie },
      );
      assert.equal(claim.status, 201);
    }

    const createdResponse = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects?channel=${channel}`,
      'POST',
      validObject('continuous-owner-client', 'code-glow-cube', {
        position: { x: -24, y: 0, z: -24 },
      }),
      { Cookie: owner.cookie },
    );
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.object.plotId, 'plot-001');

    const movedNextDoor = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}?channel=${channel}`,
      'PATCH',
      { clientId: 'continuous-owner-client', position: { x: -12, y: 0, z: -24 } },
      { Cookie: owner.cookie },
    );
    assert.equal(movedNextDoor.status, 200);
    assert.equal((await movedNextDoor.json()).object.plotId, 'plot-002');

    const movedToSharedEdge = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}?channel=${channel}`,
      'PATCH',
      { clientId: 'continuous-owner-client', position: { x: -18, y: 0, z: -24 } },
      { Cookie: owner.cookie },
    );
    assert.equal(movedToSharedEdge.status, 200);
    assert.equal((await movedToSharedEdge.json()).object.plotId, 'plot-001');

    const movedJustInsideSecond = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}?channel=${channel}`,
      'PATCH',
      { clientId: 'continuous-owner-client', position: { x: -17.999, y: 0, z: -24 } },
      { Cookie: owner.cookie },
    );
    assert.equal(movedJustInsideSecond.status, 200);
    assert.equal((await movedJustInsideSecond.json()).object.plotId, 'plot-002');

    const guestEdit = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}?channel=${channel}`,
      'PATCH',
      { clientId: 'continuous-guest-client', rotationY: 0.5 },
      { Cookie: guest.cookie },
    );
    assert.equal(guestEdit.status, 403);
    assert.equal((await guestEdit.json()).error.code, 'lobby_plot_permission_denied');
  } finally {
    await harness.close();
  }
});

test('home plot object permissions are server-authoritative while public objects stay collaborative', async () => {
  const harness = await createHarness();
  try {
    const owner = await lobbyIdentity(harness.baseUrl, 'territory-owner-session');
    const guest = await lobbyIdentity(harness.baseUrl, 'territory-guest-session');
    const channel = '4444';
    const claim = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-001/claim?channel=${channel}`,
      'POST',
      { nickname: '领主' },
      { Cookie: owner.cookie },
    );
    assert.equal(claim.status, 201);

    const guestCreate = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects?channel=${channel}`,
      'POST',
      validObject('territory-guest-client', 'code-glow-cube', {
        position: { x: -24, y: 0, z: -24 },
      }),
      { Cookie: guest.cookie },
    );
    assert.equal(guestCreate.status, 403);
    assert.equal((await guestCreate.json()).error.code, 'lobby_plot_permission_denied');
    assert.equal((await lobbyState(harness.baseUrl, channel)).revision, 1);

    const createdResponse = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects?channel=${channel}`,
      'POST',
      validObject('territory-owner-client', 'code-glow-cube', {
        position: { x: -24, y: 0, z: -24 },
      }),
      { Cookie: owner.cookie },
    );
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.object.plotId, 'plot-001');
    assert.equal(created.revision, 2);

    const forbiddenUpdate = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}?channel=${channel}`,
      'PATCH',
      { clientId: 'territory-guest-client', rotationY: 1, scale: 1.5 },
      { Cookie: guest.cookie },
    );
    assert.equal(forbiddenUpdate.status, 403);
    const forbiddenDelete = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}?channel=${channel}`,
      'DELETE',
      { clientId: 'territory-guest-client' },
      { Cookie: guest.cookie },
    );
    assert.equal(forbiddenDelete.status, 403);
    assert.equal((await lobbyState(harness.baseUrl, channel)).revision, 2);

    const guestInteraction = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}/interactions?channel=${channel}`,
      'POST',
      { requestId: 'territory-interaction-01', baseSequence: 0 },
      { Cookie: guest.cookie },
    );
    assert.equal(guestInteraction.status, 200);
    assert.equal((await guestInteraction.json()).object.interaction.by, guest.ownerId);
    assert.equal((await lobbyState(harness.baseUrl, channel)).revision, 3);

    const nonEmptyRelease = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-001?channel=${channel}`,
      'DELETE',
      {},
      { Cookie: owner.cookie },
    );
    assert.equal(nonEmptyRelease.status, 409);
    assert.equal((await nonEmptyRelease.json()).error.code, 'lobby_plot_not_empty');
    assert.equal((await lobbyState(harness.baseUrl, channel)).revision, 3);

    const movedPublicResponse = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}?channel=${channel}`,
      'PATCH',
      { clientId: 'territory-owner-client', position: { x: 10, y: 0, z: 10 } },
      { Cookie: owner.cookie },
    );
    assert.equal(movedPublicResponse.status, 200);
    assert.equal((await movedPublicResponse.json()).object.plotId, null);

    const guestMoveIntoPlot = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}?channel=${channel}`,
      'PATCH',
      { clientId: 'territory-guest-client', position: { x: -24, y: 0, z: -24 } },
      { Cookie: guest.cookie },
    );
    assert.equal(guestMoveIntoPlot.status, 403);
    assert.equal((await lobbyState(harness.baseUrl, channel)).revision, 4);

    const ownerMoveHome = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}?channel=${channel}`,
      'PATCH',
      { clientId: 'territory-owner-client', position: { x: -24, y: 0, z: -24 } },
      { Cookie: owner.cookie },
    );
    assert.equal(ownerMoveHome.status, 200);
    assert.equal((await ownerMoveHome.json()).object.plotId, 'plot-001');
    const ownerMovePublic = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}?channel=${channel}`,
      'PATCH',
      { clientId: 'territory-owner-client', position: { x: 8, y: 0, z: 8 } },
      { Cookie: owner.cookie },
    );
    assert.equal(ownerMovePublic.status, 200);

    const guestPublicUpdate = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}?channel=${channel}`,
      'PATCH',
      { clientId: 'territory-guest-client', scale: 2 },
      { Cookie: guest.cookie },
    );
    assert.equal(guestPublicUpdate.status, 200);
    assert.equal((await guestPublicUpdate.json()).object.updatedBy, guest.ownerId);
    const guestPublicDelete = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}?channel=${channel}`,
      'DELETE',
      { clientId: 'territory-guest-client' },
      { Cookie: guest.cookie },
    );
    assert.equal(guestPublicDelete.status, 200);

    const release = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-001?channel=${channel}`,
      'DELETE',
      {},
      { Cookie: owner.cookie },
    );
    assert.equal(release.status, 200);

    const gap = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects?channel=${channel}`,
      'POST',
      validObject('territory-owner-client', 'code-glow-cube', {
        position: { x: 16, y: 0, z: 0 },
      }),
      { Cookie: owner.cookie },
    );
    assert.equal(gap.status, 422);
    assert.equal((await gap.json()).error.code, 'lobby_placement_gap');

    const unclaimedPlot = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects?channel=${channel}`,
      'POST',
      validObject('territory-owner-client', 'code-glow-cube', {
        position: { x: -12, y: 0, z: -24 },
      }),
      { Cookie: owner.cookie },
    );
    assert.equal(unclaimedPlot.status, 403);

    const epsilonPublic = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects?channel=${channel}`,
      'POST',
      validObject('territory-owner-client', 'code-glow-cube', {
        position: { x: 15.0000005, y: 0, z: 0 },
      }),
      { Cookie: owner.cookie },
    );
    assert.equal(epsilonPublic.status, 201);
    assert.equal((await epsilonPublic.json()).object.plotId, null);
  } finally {
    await harness.close();
  }
});

test('SSE synchronizes plot claimed, updated, and released events', async () => {
  const harness = await createHarness({ lobbyHeartbeatMs: 100 });
  const controller = new AbortController();
  try {
    const owner = await lobbyIdentity(harness.baseUrl, 'sse-plot-owner-session');
    const channel = '5555';
    const stream = await fetch(
      `${harness.baseUrl}/api/lobby/events?channel=${channel}&clientId=sse-plot-client-01`,
      { signal: controller.signal },
    );
    assert.equal(stream.status, 200);
    const eventsPromise = readSseUntil(
      stream,
      (events) => events.some((event) => event.event === 'plot.released'),
    );

    const claim = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-072/claim?channel=${channel}`,
      'POST',
      { nickname: 'SSE Owner' },
      { Cookie: owner.cookie },
    );
    assert.equal(claim.status, 201);
    const update = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-072?channel=${channel}`,
      'PATCH',
      { nickname: 'SSE Home' },
      { Cookie: owner.cookie },
    );
    assert.equal(update.status, 200);
    const release = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/plots/plot-072?channel=${channel}`,
      'DELETE',
      {},
      { Cookie: owner.cookie },
    );
    assert.equal(release.status, 200);

    const events = await eventsPromise;
    const snapshot = events.find((event) => event.event === 'snapshot');
    assert.deepEqual(snapshot.data.plots, []);
    const changes = events
      .filter((event) => event.event === 'change' && event.data.type.startsWith('plot.'))
      .map((event) => [event.data.type, event.data.revision]);
    assert.deepEqual(changes, [
      ['plot.claimed', 1],
      ['plot.updated', 2],
      ['plot.released', 3],
    ]);
    assert.equal(events.find((event) => event.event === 'plot.claimed').data.plot.id, 'plot-072');
    assert.equal(events.find((event) => event.event === 'plot.updated').data.plot.ownerNickname, 'SSE Home');
    assert.equal(events.find((event) => event.event === 'plot.released').data.plotId, 'plot-072');
  } finally {
    controller.abort();
    await harness.close();
  }
});

test('failed mutations never persist empty channels or consume persistent channel capacity', async () => {
  const harness = await createHarness({
    lobbyChannelLimits: { maxLoaded: 2, maxPersisted: 2 },
  });
  try {
    const missingId = 'missing-object-0001';
    const failures = await Promise.all([
      jsonRequest(
        harness.baseUrl,
        `/api/lobby/objects/${missingId}?channel=4444`,
        'PATCH',
        { clientId: 'failed-patch-client', scale: 1.5 },
      ),
      jsonRequest(
        harness.baseUrl,
        `/api/lobby/objects/${missingId}?channel=5555`,
        'DELETE',
        { clientId: 'failed-delete-client' },
      ),
      jsonRequest(
        harness.baseUrl,
        `/api/lobby/objects/${missingId}/interactions?channel=6666`,
        'POST',
        { requestId: 'failed-interaction-request', baseSequence: 0 },
      ),
      jsonRequest(
        harness.baseUrl,
        '/api/lobby/plots/plot-001?channel=8888',
        'PATCH',
        { nickname: 'Missing Plot' },
      ),
      jsonRequest(
        harness.baseUrl,
        '/api/lobby/plots/plot-001?channel=9999',
        'DELETE',
        {},
      ),
    ]);
    assert.deepEqual(failures.map(({ status }) => status), [404, 404, 404, 404, 404]);
    assert.deepEqual([...harness.application.lobbyStore.knownChannels], [DEFAULT_CHANNEL]);
    for (const channel of ['4444', '5555', '6666', '8888', '9999']) {
      await assert.rejects(
        stat(path.join(harness.dataDirectory, 'lobby', 'channels', channel, 'state.json')),
        { code: 'ENOENT' },
      );
    }

    const successful = await jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects?channel=7777',
      'POST',
      validObject('successful-room-client'),
    );
    assert.equal(successful.status, 201);
    assert.equal(harness.application.lobbyStore.knownChannels.has('7777'), true);
  } finally {
    await harness.close();
  }
});

test('interactions are authoritative, idempotent, concurrent-safe, and available to every player', async () => {
  let now = Date.now();
  const harness = await createHarness({ clock: () => now });
  try {
    const createdResponse = await jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects',
      'POST',
      validObject('interaction-creator-01'),
    );
    const created = await createdResponse.json();
    const creator = await lobbyIdentity(harness.baseUrl, 'interaction-creator-01');
    const guest = await lobbyIdentity(harness.baseUrl, 'interaction-guest-001');
    assert.deepEqual(created.object.interaction, { sequence: 0, startedAt: null, by: null, requestId: null });

    const firstResponse = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}/interactions`,
      'POST',
      { requestId: 'interaction-request-0001', baseSequence: 0 },
      { Cookie: guest.cookie },
    );
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    assert.equal(first.replayed, false);
    assert.equal(first.revision, 2);
    assert.equal(first.object.createdBy, creator.ownerId);
    assert.equal(first.object.updatedBy, guest.ownerId);
    assert.deepEqual(first.object.interaction, {
      sequence: 1,
      startedAt: new Date(now).toISOString(),
      by: guest.ownerId,
      requestId: 'interaction-request-0001',
    });

    const replayResponse = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}/interactions`,
      'POST',
      { requestId: 'interaction-request-0001', baseSequence: 0 },
      { Cookie: guest.cookie },
    );
    assert.equal(replayResponse.status, 200);
    const replay = await replayResponse.json();
    assert.equal(replay.replayed, true);
    assert.equal(replay.revision, 2);
    assert.equal((await lobbyState(harness.baseUrl)).revision, 2);

    const cooldown = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}/interactions`,
      'POST',
      { requestId: 'interaction-request-0002', baseSequence: 1 },
      { Cookie: guest.cookie },
    );
    assert.equal(cooldown.status, 409);
    assert.equal((await cooldown.json()).error.code, 'lobby_interaction_cooldown');

    now += 151;
    const second = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${created.object.id}/interactions`,
      'POST',
      { requestId: 'interaction-request-0002', baseSequence: 1 },
      { Cookie: creator.cookie },
    );
    assert.equal(second.status, 200);

    now += 151;
    const concurrent = await Promise.all([
      jsonRequest(
        harness.baseUrl,
        `/api/lobby/objects/${created.object.id}/interactions`,
        'POST',
        { requestId: 'interaction-request-0003', baseSequence: 2 },
        { Cookie: creator.cookie },
      ),
      jsonRequest(
        harness.baseUrl,
        `/api/lobby/objects/${created.object.id}/interactions`,
        'POST',
        { requestId: 'interaction-request-0004', baseSequence: 2 },
        { Cookie: guest.cookie },
      ),
    ]);
    assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 409]);
    const finalState = await lobbyState(harness.baseUrl);
    assert.equal(finalState.revision, 4);
    assert.equal(finalState.objects[0].interaction.sequence, 3);
  } finally {
    await harness.close();
  }
});

test('terminal-like catalog IDs are rejected and stripped from recovered state', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-lobby-terminal-test-'));
  const lobbyDirectory = path.join(dataDirectory, 'lobby');
  await mkdir(lobbyDirectory, { recursive: true });
  const timestamp = new Date().toISOString();
  await writeFile(path.join(lobbyDirectory, 'state.json'), `${JSON.stringify({
    schemaVersion: 1,
    revision: 3,
    updatedAt: timestamp,
    objects: [
      {
        id: 'safe-object-0001',
        catalogId: 'code-glow-cube',
        position: { x: 0, y: 0, z: 0 },
        rotationY: 0,
        scale: 1,
        createdBy: 'safe-client-0001',
        updatedBy: 'safe-client-0001',
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 'blocked-zone-001',
        catalogId: 'code-soft-bench',
        position: { x: 0, y: 0, z: 4.2 },
        rotationY: 0,
        scale: 1,
        createdBy: 'safe-client-0001',
        updatedBy: 'safe-client-0001',
        revision: 3,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 'locked-object-01',
        catalogId: 'system-computer-terminal',
        position: { x: 0, y: 0, z: 0 },
        rotationY: 0,
        scale: 1,
        createdBy: 'safe-client-0001',
        updatedBy: 'safe-client-0001',
        revision: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  })}\n`);

  const harness = await createHarness({ dataDirectory });
  try {
    const state = await lobbyState(harness.baseUrl);
    assert.equal(state.revision, 4);
    assert.deepEqual(state.objects.map((object) => object.id), ['safe-object-0001']);
    assert.doesNotMatch(JSON.stringify(state), /terminal|computer|system/i);
    const canonicalDefault = JSON.parse(await readFile(path.join(lobbyDirectory, 'state.json'), 'utf8'));
    assert.doesNotMatch(JSON.stringify(canonicalDefault), /terminal|computer|system/i);

    for (const catalogId of ['terminal', 'code-computer-desk', 'system-console']) {
      const response = await jsonRequest(
        harness.baseUrl,
        '/api/lobby/objects',
        'POST',
        validObject('locked-client-01', catalogId),
      );
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, 'protected_lobby_item');
    }
  } finally {
    await harness.close();
  }
});

test('the persisted lobby never accepts a 201st editable object', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-lobby-capacity-test-'));
  const lobbyDirectory = path.join(dataDirectory, 'lobby');
  await mkdir(lobbyDirectory, { recursive: true });
  const timestamp = new Date().toISOString();
  const objects = Array.from({ length: 200 }, (_, index) => ({
    id: `capacity-object-${String(index).padStart(3, '0')}`,
    catalogId: 'code-glow-cube',
    position: { x: 0, y: 0, z: 0 },
    rotationY: 0,
    scale: 1,
    createdBy: 'capacity-client-01',
    updatedBy: 'capacity-client-01',
    revision: index + 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  await writeFile(path.join(lobbyDirectory, 'state.json'), `${JSON.stringify({
    schemaVersion: 1,
    revision: 200,
    updatedAt: timestamp,
    objects,
  })}\n`);

  const harness = await createHarness({ dataDirectory });
  try {
    const response = await jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects',
      'POST',
      validObject('capacity-client-02'),
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'lobby_full');
    const state = await lobbyState(harness.baseUrl);
    assert.equal(state.revision, 200);
    assert.equal(state.objects.length, 200);
  } finally {
    await harness.close();
  }
});

test('serialized concurrent writes keep every object and assign unique monotonic revisions', async () => {
  const harness = await createHarness();
  try {
    const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects',
      'POST',
      validObject(`parallel-client-${String(index).padStart(2, '0')}`, index % 2 ? 'code-soft-bench' : 'code-glow-cube', {
        position: { x: -10 + index, y: 0, z: 0 },
      }),
      { 'X-Forwarded-For': '198.51.100.10' },
    )));
    assert.equal(responses.every((response) => response.status === 201), true);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    assert.deepEqual(bodies.map((body) => body.revision).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
    const state = await lobbyState(harness.baseUrl);
    assert.equal(state.revision, 20);
    assert.equal(state.objects.length, 20);
    assert.equal(new Set(state.objects.map((object) => object.id)).size, 20);
    assert.deepEqual(state.objects.map((object) => object.revision).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
  } finally {
    await harness.close();
  }
});

test('first-write promotion stays serialized when empty-channel reads race concurrent creates', async () => {
  const harness = await createHarness();
  try {
    const channel = '5555';
    const operations = [];
    for (let index = 0; index < 20; index += 1) {
      operations.push(lobbyState(harness.baseUrl, channel));
      operations.push(jsonRequest(
        harness.baseUrl,
        `/api/lobby/objects?channel=${channel}`,
        'POST',
        validObject(`promotion-client-${String(index).padStart(2, '0')}`, 'code-glow-cube', {
          position: { x: -10 + index, y: 0, z: -2 },
        }),
      ));
    }
    const results = await Promise.all(operations);
    const writes = results.filter((result) => result instanceof Response);
    assert.equal(writes.length, 20);
    assert.equal(writes.every((response) => response.status === 201), true);
    const state = await lobbyState(harness.baseUrl, channel);
    assert.equal(state.revision, 20);
    assert.equal(state.objects.length, 20);
    assert.equal(new Set(state.objects.map(({ id }) => id)).size, 20);
  } finally {
    await harness.close();
  }
});

test('channel cache is bounded and persistent channel capacity rejects unbounded creation', async () => {
  const harness = await createHarness({
    lobbyChannelLimits: { maxLoaded: 2, maxPersisted: 3 },
  });
  try {
    for (const channel of ['1111', '2222']) {
      const response = await jsonRequest(
        harness.baseUrl,
        `/api/lobby/objects?channel=${channel}`,
        'POST',
        validObject(`capacity-${channel}-client`),
      );
      assert.equal(response.status, 201);
    }
    assert.equal(harness.application.lobbyStore.knownChannels.size, 3);
    assert.ok(harness.application.lobbyStore.channels.size <= 2);

    const full = await jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects?channel=3333',
      'POST',
      validObject('capacity-3333-client'),
    );
    assert.equal(full.status, 507);
    assert.equal((await full.json()).error.code, 'lobby_channel_capacity_reached');
    await assert.rejects(
      stat(path.join(harness.dataDirectory, 'lobby', 'channels', '3333', 'state.json')),
      { code: 'ENOENT' },
    );
  } finally {
    await harness.close();
  }
});

test('LRU eviction never drops in-flight write queues from concurrently active channels', async () => {
  const harness = await createHarness({
    lobbyChannelLimits: { maxLoaded: 2, maxPersisted: 10 },
  });
  try {
    const channels = ['1111', '2222', '3333'];
    const responses = await Promise.all(channels.flatMap((channel, channelIndex) => (
      Array.from({ length: 10 }, (_, index) => jsonRequest(
        harness.baseUrl,
        `/api/lobby/objects?channel=${channel}`,
        'POST',
        validObject(`lru-${channel}-${String(index).padStart(2, '0')}`, 'code-glow-cube', {
          position: { x: -12 + index * 2, y: 0, z: -2 + channelIndex * 1.5 },
        }),
      ))
    )));
    assert.equal(responses.every((response) => response.status === 201), true);
    for (const channel of channels) {
      const state = await lobbyState(harness.baseUrl, channel);
      assert.equal(state.revision, 10);
      assert.equal(state.objects.length, 10);
    }
    assert.ok(harness.application.lobbyStore.channels.size <= 2);
  } finally {
    await harness.close();
  }
});

test('lobby state atomically survives an application restart', async () => {
  const first = await createHarness();
  const dataDirectory = first.dataDirectory;
  try {
    const owner = await lobbyIdentity(first.baseUrl, 'persist-client-01');
    const claimed = await jsonRequest(
      first.baseUrl,
      '/api/lobby/plots/plot-001/claim',
      'POST',
      { nickname: 'Persistent Owner' },
      { Cookie: owner.cookie },
    );
    assert.equal(claimed.status, 201);
    const adjacentClaimed = await jsonRequest(
      first.baseUrl,
      '/api/lobby/plots/plot-002/claim',
      'POST',
      { nickname: 'Persistent Owner' },
      { Cookie: owner.cookie },
    );
    assert.equal(adjacentClaimed.status, 201);
    const created = await jsonRequest(
      first.baseUrl,
      '/api/lobby/objects',
      'POST',
      validObject('persist-client-01', 'glb-luminous-plant', {
        position: { x: -24, y: 0, z: -24 },
      }),
      { Cookie: owner.cookie },
    );
    assert.equal(created.status, 201);
    const firstState = await lobbyState(first.baseUrl);
    await first.close({ remove: false });

    const second = await createHarness({ dataDirectory });
    try {
      const recovered = await lobbyState(second.baseUrl);
      const { serverTime: firstServerTime, channel: firstChannel, ...firstPersistedState } = firstState;
      const { serverTime: recoveredServerTime, channel: recoveredChannel, ...recoveredPersistedState } = recovered;
      assert.match(firstServerTime, /^\d{4}-/);
      assert.match(recoveredServerTime, /^\d{4}-/);
      assert.equal(firstChannel, DEFAULT_CHANNEL);
      assert.equal(recoveredChannel, DEFAULT_CHANNEL);
      assert.deepEqual(recoveredPersistedState, firstPersistedState);
      assert.equal(recovered.objects[0].catalogId, 'glb-luminous-plant');
      assert.equal(recovered.objects[0].plotId, 'plot-001');
      assert.deepEqual(recovered.plots.map(({ id }) => id), ['plot-001', 'plot-002']);
      assert.equal(recovered.plots.every(({ ownerId }) => ownerId === owner.ownerId), true);
      assert.equal(recovered.plots.every(({ ownerNickname }) => ownerNickname === 'Persistent Owner'), true);
      assert.deepEqual(
        JSON.parse(await readFile(path.join(dataDirectory, 'lobby', 'state.json'), 'utf8')),
        firstPersistedState,
      );
    } finally {
      await second.close();
    }
  } catch (error) {
    if (first.application.server.listening) await first.close();
    else await rm(dataDirectory, { recursive: true, force: true });
    throw error;
  }
});

test('legacy production state remains the canonical 0000 channel without losing its revision or objects', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-lobby-legacy-channel-test-'));
  const lobbyDirectory = path.join(dataDirectory, 'lobby');
  await mkdir(lobbyDirectory, { recursive: true });
  const timestamp = '2026-07-13T07:00:00.000Z';
  const objects = Array.from({ length: 12 }, (_, index) => ({
    id: `legacy-object-${String(index).padStart(3, '0')}`,
    catalogId: index % 2 ? 'code-soft-bench' : 'code-glow-cube',
    position: index === 11
      ? { x: 17, y: 0, z: 0 }
      : index === 10
        ? { x: 16, y: 0, z: -18 }
        : { x: -12 + index * 2, y: 0, z: 0 },
    rotationY: 0,
    scale: 1,
    createdBy: 'legacy-owner-0001',
    updatedBy: 'legacy-owner-0001',
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: index + 1,
    interaction: { sequence: 0, startedAt: null, by: null, requestId: null },
    ...(index === 10 ? { plotId: null } : {}),
  }));
  const legacyState = {
    schemaVersion: 1,
    revision: 101,
    updatedAt: timestamp,
    objects,
  };
  const legacySerialized = `${JSON.stringify(legacyState)}\n`;
  await writeFile(path.join(lobbyDirectory, 'state.json'), legacySerialized);

  const harness = await createHarness({ dataDirectory });
  try {
    const mapped = await lobbyState(harness.baseUrl, DEFAULT_CHANNEL);
    assert.equal(mapped.channel, DEFAULT_CHANNEL);
    assert.equal(mapped.revision, 101);
    assert.equal(mapped.objects.length, 12);
    assert.deepEqual(mapped.objects.map(({ id }) => id), objects.map(({ id }) => id));
    assert.equal(mapped.objects.every(({ plotId }) => plotId === null), true);
    assert.deepEqual(mapped.objects.at(-2).position, { x: 16, y: 0, z: -18 });
    assert.deepEqual(mapped.objects.at(-1).position, { x: 17, y: 0, z: 0 });
    assert.deepEqual(mapped.plots, []);
    assert.equal(await readFile(path.join(lobbyDirectory, 'state.json'), 'utf8'), legacySerialized);

    const rotatedLegacy = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${objects.at(-1).id}`,
      'PATCH',
      { clientId: 'legacy-editor-0001', rotationY: 0.5, scale: 1.25 },
    );
    assert.equal(rotatedLegacy.status, 200);
    const rotatedLegacyBody = await rotatedLegacy.json();
    assert.equal(rotatedLegacyBody.object.plotId, null);
    assert.deepEqual(rotatedLegacyBody.object.position, { x: 17, y: 0, z: 0 });

    const remainInGap = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${objects.at(-1).id}`,
      'PATCH',
      { clientId: 'legacy-editor-0001', position: { x: 17, y: 0, z: 0 } },
    );
    assert.equal(remainInGap.status, 422);
    assert.equal((await remainInGap.json()).error.code, 'lobby_placement_gap');
    assert.equal((await lobbyState(harness.baseUrl)).revision, 102);

    const movedIntoPublic = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects/${objects.at(-1).id}`,
      'PATCH',
      { clientId: 'legacy-editor-0001', position: { x: 15, y: 0, z: 0 } },
    );
    assert.equal(movedIntoPublic.status, 200);
    assert.equal((await movedIntoPublic.json()).object.plotId, null);
    await assert.rejects(
      stat(path.join(lobbyDirectory, 'channels', DEFAULT_CHANNEL, 'state.json')),
      { code: 'ENOENT' },
    );
  } finally {
    await harness.close();
  }
});

test('SSE streams snapshot, presence, generic/specific changes, and heartbeats', async () => {
  const harness = await createHarness({ lobbyHeartbeatMs: 100 });
  const controller = new AbortController();
  try {
    const stream = await fetch(`${harness.baseUrl}/api/lobby/events?channel=${DEFAULT_CHANNEL}&clientId=sse-client-0001`, {
      signal: controller.signal,
    });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type'), /^text\/event-stream/);
    const readPromise = readSseUntil(stream, (events) => (
      ['snapshot', 'presence', 'change', 'object.created', 'heartbeat']
        .every((name) => events.some((event) => event.event === name))
    ));
    const createdResponse = await jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects',
      'POST',
      validObject('sse-writer-0001'),
    );
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    const events = await readPromise;
    const snapshot = events.find((event) => event.event === 'snapshot');
    assert.equal(snapshot.data.revision, 0);
    assert.deepEqual(snapshot.data.objects, []);
    assert.equal(events.find((event) => event.event === 'presence').data.online, 1);
    const change = events.find((event) => event.event === 'change');
    assert.equal(change.data.type, 'object.created');
    assert.equal(change.data.object.id, created.object.id);
    assert.equal(events.find((event) => event.event === 'object.created').id, '1');
    assert.match(events.find((event) => event.event === 'heartbeat').data.timestamp, /^\d{4}-/);
  } finally {
    controller.abort();
    await harness.close();
  }
});

test('SSE handshake closes the snapshot/register gap with correction snapshot then queued changes', async () => {
  const channel = '1111';
  const timestamp = '2026-07-13T08:00:00.000Z';
  const initial = { schemaVersion: 1, revision: 0, updatedAt: timestamp, objects: [] };
  const correction = {
    schemaVersion: 1,
    revision: 1,
    updatedAt: timestamp,
    objects: [{ id: 'pre-connect-object' }],
  };
  const queuedChange = {
    type: 'object.updated',
    channel,
    revision: 2,
    updatedAt: timestamp,
    serverTime: timestamp,
    object: { id: 'queued-change-object' },
  };
  const lobbyEvents = new LobbyEventHub({ heartbeatMs: 60_000 });
  let reads = 0;
  const lobbyStore = {
    catalogIds: new Set(),
    async initialize() {},
    async getState(requestedChannel) {
      assert.equal(requestedChannel, channel);
      reads += 1;
      if (reads === 1) return structuredClone(initial);
      lobbyEvents.publish(channel, queuedChange);
      return structuredClone(correction);
    },
  };
  const harness = await createHarness({ lobbyEvents, lobbyStore });
  const controller = new AbortController();
  try {
    const stream = await fetch(
      `${harness.baseUrl}/api/lobby/events?channel=${channel}&clientId=sse-race-client-01`,
      { signal: controller.signal },
    );
    assert.equal(stream.status, 200);
    const events = await readSseUntil(
      stream,
      (received) => received.some((event) => event.event === 'object.updated'),
    );
    const stateful = events.filter((event) => ['snapshot', 'change', 'object.updated'].includes(event.event));
    assert.deepEqual(stateful.map((event) => [event.event, event.data.revision]), [
      ['snapshot', 0],
      ['snapshot', 1],
      ['change', 2],
      ['object.updated', 2],
    ]);
    assert.equal(stateful[1].data.objects[0].id, 'pre-connect-object');
    assert.equal(stateful[2].data.object.id, 'queued-change-object');
  } finally {
    controller.abort();
    await harness.close();
  }
});

test('SSE snapshots, presence, and object changes never cross lobby channels', async () => {
  const harness = await createHarness({ lobbyHeartbeatMs: 100 });
  const controllers = [new AbortController(), new AbortController()];
  try {
    const [firstStream, secondStream] = await Promise.all([
      fetch(`${harness.baseUrl}/api/lobby/events?channel=1111&clientId=sse-room-one-01`, {
        signal: controllers[0].signal,
      }),
      fetch(`${harness.baseUrl}/api/lobby/events?channel=2222&clientId=sse-room-two-01`, {
        signal: controllers[1].signal,
      }),
    ]);
    assert.equal(firstStream.status, 200);
    assert.equal(secondStream.status, 200);

    const firstEventsPromise = readSseUntil(
      firstStream,
      (events) => events.some((event) => event.event === 'object.created'),
    );
    const secondEventsPromise = readSseUntil(
      secondStream,
      (events) => events.some((event) => event.event === 'heartbeat'),
    );
    const created = await jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects?channel=1111',
      'POST',
      validObject('sse-channel-writer-01'),
    );
    assert.equal(created.status, 201);

    const [firstEvents, secondEvents] = await Promise.all([firstEventsPromise, secondEventsPromise]);
    const firstSnapshot = firstEvents.find((event) => event.event === 'snapshot');
    const secondSnapshot = secondEvents.find((event) => event.event === 'snapshot');
    assert.equal(firstSnapshot.data.channel, '1111');
    assert.equal(secondSnapshot.data.channel, '2222');
    assert.equal(firstEvents.find((event) => event.event === 'presence').data.online, 1);
    assert.equal(secondEvents.find((event) => event.event === 'presence').data.online, 1);
    assert.equal(firstEvents.some((event) => event.event === 'object.created'), true);
    assert.equal(secondEvents.some((event) => event.event === 'change' || event.event === 'object.created'), false);
  } finally {
    for (const controller of controllers) controller.abort();
    await harness.close();
  }
});

test('SSE keeps heaven and hell persistent-space state changes in separate derived channels', async () => {
  const harness = await createHarness({ lobbyHeartbeatMs: 100 });
  const controllers = [new AbortController(), new AbortController()];
  const heaven = 'space-001234-heaven';
  const hell = 'space-001234-hell';
  try {
    const [heavenStream, hellStream] = await Promise.all([
      fetch(`${harness.baseUrl}/api/lobby/events?channel=${heaven}&clientId=sse-space-heaven-01`, {
        signal: controllers[0].signal,
      }),
      fetch(`${harness.baseUrl}/api/lobby/events?channel=${hell}&clientId=sse-space-hell-0001`, {
        signal: controllers[1].signal,
      }),
    ]);
    assert.equal(heavenStream.status, 200);
    assert.equal(hellStream.status, 200);

    const heavenEventsPromise = readSseUntil(
      heavenStream,
      (events) => events.some((event) => event.event === 'object.created'),
    );
    const hellEventsPromise = readSseUntil(
      hellStream,
      (events) => events.some((event) => event.event === 'heartbeat'),
    );
    const created = await jsonRequest(
      harness.baseUrl,
      `/api/lobby/objects?channel=${heaven}`,
      'POST',
      validObject('sse-space-writer-01'),
    );
    assert.equal(created.status, 201);

    const [heavenEvents, hellEvents] = await Promise.all([heavenEventsPromise, hellEventsPromise]);
    assert.equal(heavenEvents.find((event) => event.event === 'snapshot').data.channel, heaven);
    assert.equal(hellEvents.find((event) => event.event === 'snapshot').data.channel, hell);
    assert.equal(heavenEvents.some((event) => event.event === 'object.created'), true);
    assert.equal(hellEvents.some((event) => event.event === 'change' || event.event === 'object.created'), false);
  } finally {
    for (const controller of controllers) controller.abort();
    await harness.close();
  }
});

test('SSE enforces per-IP and total connection ceilings before opening a stream', async () => {
  const harness = await createHarness({
    lobbySseLimits: { maxTotal: 2, maxPerIp: 1 },
  });
  const openStreams = [];
  async function open(clientId, ip) {
    const controller = new AbortController();
    const response = await fetch(`${harness.baseUrl}/api/lobby/events?channel=${DEFAULT_CHANNEL}&clientId=${clientId}`, {
      headers: { 'X-Real-IP': ip },
      signal: controller.signal,
    });
    if (response.status === 200) openStreams.push({ controller, response });
    return response;
  }
  try {
    const first = await open('limit-sse-client-01', '198.51.100.1');
    assert.equal(first.status, 200);

    const sameIp = await open('limit-sse-client-02', '198.51.100.1');
    assert.equal(sameIp.status, 429);
    const sameIpError = (await sameIp.json()).error;
    assert.equal(sameIpError.code, 'lobby_sse_connection_limit');
    assert.deepEqual(sameIpError.details, { scope: 'ip', limit: 1 });

    const second = await open('limit-sse-client-03', '198.51.100.2');
    assert.equal(second.status, 200);
    const total = await open('limit-sse-client-04', '198.51.100.3');
    assert.equal(total.status, 429);
    const totalError = (await total.json()).error;
    assert.equal(totalError.code, 'lobby_sse_connection_limit');
    assert.deepEqual(totalError.details, { scope: 'total', limit: 2 });
    assert.equal(harness.application.lobbyEvents.connections.size, 2);
    assert.equal(harness.application.lobbyEvents.ipConnections.size, 2);
  } finally {
    for (const { controller, response } of openStreams) {
      await response.body.cancel().catch(() => {});
      controller.abort();
    }
    await harness.close();
  }
});

test('SSE backpressure keeps generic/specific changes atomic and never queues a second change', () => {
  const request = new EventEmitter();
  request.socket = { remoteAddress: '192.0.2.10' };
  request.headers = {};
  const response = new EventEmitter();
  response.destroyed = false;
  response.writableEnded = false;
  response.frames = [];
  response.writeHead = () => {};
  response.write = (frame) => {
    response.frames.push(frame);
    return response.frames.length < 3;
  };
  response.destroy = () => {
    if (response.destroyed) return;
    response.destroyed = true;
    response.emit('close');
  };

  const hub = new LobbyEventHub({ heartbeatMs: 60_000, backpressureTimeoutMs: 1_000 });
  hub.connect(
    request,
    response,
    DEFAULT_CHANNEL,
    'blocked-sse-client-01',
    { channel: DEFAULT_CHANNEL, schemaVersion: 1, revision: 0, updatedAt: new Date().toISOString(), objects: [] },
    '*',
  );
  assert.equal(hub.connections.size, 1);
  assert.equal(response.frames.length, 2);
  assert.equal(hub.connections.get(response).backpressured, false);

  const change = {
    type: 'object.created',
    revision: 1,
    updatedAt: new Date().toISOString(),
    object: { id: 'example-object-01' },
  };
  hub.publish(DEFAULT_CHANNEL, change);
  assert.equal(response.frames.length, 3);
  assert.match(response.frames[2], /event: change\n/);
  assert.match(response.frames[2], /event: object\.created\n/);
  assert.equal(hub.connections.get(response).backpressured, true);

  hub.publish(DEFAULT_CHANNEL, { ...change, revision: 2 });
  assert.equal(response.frames.length, 3);
  assert.equal(response.destroyed, true);
  assert.equal(hub.connections.size, 0);
  assert.equal(hub.ipConnections.size, 0);
  hub.close();
});

test('fixed-window counters lazily sweep expired keys and refuse unbounded growth', () => {
  let now = 0;
  const counter = new FixedWindowCounter(2, 1_000, () => now, {
    sweepEvery: 2,
    maxEntries: 3,
  });
  for (const key of ['first', 'second']) {
    const entry = counter.inspect(key);
    counter.consume(key, entry);
  }
  assert.equal(counter.size, 2);
  now = 1_001;
  const third = counter.inspect('third');
  counter.consume('third', third);
  assert.equal(counter.size, 3);
  const fourth = counter.inspect('fourth');
  assert.equal(counter.size, 1);
  counter.consume('fourth', fourth);
  assert.equal(counter.size, 2);

  now = 0;
  const bounded = new FixedWindowCounter(1, 1_000, () => now, {
    sweepEvery: 100,
    maxEntries: 2,
  });
  for (const key of ['one', 'two']) {
    const entry = bounded.inspect(key);
    bounded.consume(key, entry);
  }
  const overflow = bounded.inspect('three');
  assert.equal(overflow.count, bounded.limit);
  assert.equal(overflow.overflow, true);
  bounded.consume('three', overflow);
  assert.equal(bounded.size, 2);
});

test('write limits are enforced independently for client IDs and source IPs', async () => {
  let now = Date.now();
  const harness = await createHarness({
    clock: () => now,
    lobbyRateLimits: { windowMs: 1_000, maxPerClient: 2, maxPerIp: 3 },
  });
  try {
    for (let index = 0; index < 2; index += 1) {
      const response = await jsonRequest(
        harness.baseUrl,
        '/api/lobby/objects',
        'POST',
        validObject('limited-client-01', index ? 'code-soft-bench' : 'code-glow-cube'),
        { 'X-Forwarded-For': '203.0.113.8' },
      );
      assert.equal(response.status, 201);
    }
    const clientLimited = await jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects',
      'POST',
      validObject('limited-client-01', 'code-light-arch'),
      { 'X-Forwarded-For': '203.0.113.8' },
    );
    assert.equal(clientLimited.status, 429);
    assert.equal((await clientLimited.json()).error.code, 'lobby_rate_limited');

    assert.equal((await jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects',
      'POST',
      validObject('limited-client-02'),
      { 'X-Forwarded-For': '203.0.113.8' },
    )).status, 201);
    const ipLimited = await jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects',
      'POST',
      validObject('limited-client-03'),
      { 'X-Forwarded-For': '203.0.113.8' },
    );
    assert.equal(ipLimited.status, 429);

    now += 1_001;
    assert.equal((await jsonRequest(
      harness.baseUrl,
      '/api/lobby/objects',
      'POST',
      validObject('limited-client-01', 'glb-pedestal-lamp'),
      { 'X-Forwarded-For': '203.0.113.8' },
    )).status, 201);
  } finally {
    await harness.close();
  }
});
